// Drives a headless Chrome over the DevTools protocol for the browser checks in this folder.
// No dependency: Node's built-in fetch and WebSocket talk to the browser.
//
//   CHROME_BIN  path to Chrome or chrome-headless-shell (required)
//   BASE_URL    the running app (default http://localhost:5173/, from `npm run dev`)
//
// The checks use the real AniList API, which allows 30 requests a minute per IP address.
// One browser profile is kept for a whole test file, so its saved cache spares requests. A check
// can open a browser that answers AniList from recordings of its answers instead, and sends it
// nothing (see Browser.open).
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173/'

type Message = {
  id?: number
  method?: string
  params?: any
  result?: any
  error?: { message: string }
}

/** One AniList answer as rewriteAniList sees it: the request's GraphQL and what came back. */
export type Answer = {
  request: { query: string; variables: Record<string, unknown> }
  status: number
  body: any
}
type Rewrite = (answer: Answer) => { status: number; body: unknown } | null

/** Where a browser's AniList answers come from: AniList itself, or recordings (see open). */
export type AniListMode = 'live' | 'recorded'
/** An answer AniList gave, kept to answer the same request again. */
export type Recording = Answer

// A recorded browser's recordings, unless the check hands it its own: one JSON file per request.
const RECORDINGS = new URL('./anilist/', import.meta.url)
const readRecordings = (): Recording[] =>
  existsSync(RECORDINGS)
    ? readdirSync(RECORDINGS)
        .filter((file) => file.endsWith('.json'))
        .map((file) => JSON.parse(readFileSync(new URL(file, RECORDINGS), 'utf8')))
    : []

// JSON keeps variables in the order they were written, which says nothing about the request.
const sorted = (variables: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(variables)
      .sort()
      .map((name) => [name, variables[name]]),
  )
// A recording answers only a request with its exact query text and variables, as the page's
// cache keys a list (['anilist', query, variables]): a query edited since it was recorded misses,
// rather than getting an answer without the fields it now asks for.
const keyOf = ({ query, variables = {} }: Answer['request']) =>
  JSON.stringify([query, sorted(variables)])
// A request in a few words, for messages: how it sorts each list it asks for (or, with no list,
// how its query starts), and its variables.
const nameOf = ({ query, variables = {} }: Answer['request']) => {
  const lists = [...query.matchAll(/sort: (\w+)/g)].map(([, sort]) => sort).join(' + ')
  return `${lists || JSON.stringify(query.slice(0, 60))} with ${JSON.stringify(sorted(variables))}`
}

// What AniList sends with its answer to a CORS preflight, and with its answer to a request, as a
// live run's network log shows them. The page may send only the headers AniList allows, and read
// only those it exposes, so a recorded browser lets the page do no more than AniList does.
const PREFLIGHT_HEADERS = [
  { name: 'Access-Control-Allow-Origin', value: '*' },
  {
    name: 'Access-Control-Allow-Headers',
    value:
      'Authorization,Accept,DNT,X-CustomHeader,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Content-Range,Range',
  },
  { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
]
const ANSWER_HEADERS = [
  { name: 'Content-Type', value: 'application/json' },
  { name: 'Access-Control-Allow-Origin', value: '*' },
  {
    name: 'Access-Control-Expose-Headers',
    value:
      'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Content-Length, Content-Range',
  },
  { name: 'X-RateLimit-Limit', value: '30' },
  { name: 'X-RateLimit-Remaining', value: '29' },
]
// AniList answers in about 230 ms (the median in a gate's network logs), and the checks were made
// against that: some look at the page while a request is out. So a recorded answer comes as late.
const ANSWER_MS = 200

export class Browser {
  #chrome: ChildProcess
  #profile: string
  #socket: WebSocket
  #nextId = 0
  #pending = new Map<number, (message: Message) => void>()
  #aniList: AniListMode
  // A recorded browser's recordings by keyOf, and where they came from, for messages.
  #recordings: Map<string, Recording>
  #where: string
  #blocking = false
  #holdMs = 0
  // What each request on hold does once let go: go on to AniList, or get its recorded answer.
  #held = new Map<string, () => Promise<unknown>>()
  #rewrite: Rewrite | null = null
  #answering = new Set<Promise<unknown>>()
  // Requests a recorded browser had no recording for, until waitFor() or close() throws them.
  #misses = new Set<string>()
  // Called once Chrome has moved a stopped clock on as far as tick() asked.
  #clockMoved: (() => void) | null = null
  /** Uncaught exceptions and console errors or warnings, for the "clean console" check. */
  problems: string[] = []

  private constructor(
    chrome: ChildProcess,
    profile: string,
    socket: WebSocket,
    aniList: AniListMode,
    recordings: Recording[] | undefined,
  ) {
    this.#chrome = chrome
    this.#profile = profile
    this.#socket = socket
    this.#aniList = aniList
    this.#recordings = new Map(
      (aniList === 'recorded' ? (recordings ?? readRecordings()) : []).map((recording) => [
        keyOf(recording.request),
        recording,
      ]),
    )
    this.#where = recordings
      ? 'among the ones the check gave Browser.open()'
      : 'in web/e2e/anilist/'
    socket.addEventListener('message', (event) => {
      const message: Message = JSON.parse(String(event.data))
      if (message.id !== undefined) {
        this.#pending.get(message.id)?.(message)
        this.#pending.delete(message.id)
      }
      if (message.method === 'Emulation.virtualTimeBudgetExpired') this.#clockMoved?.()
      if (message.method === 'Runtime.exceptionThrown')
        this.problems.push(
          'exception: ' +
            String(
              message.params.exceptionDetails.exception?.description ??
                message.params.exceptionDetails.text,
            ).split('\n')[0],
        )
      if (
        message.method === 'Runtime.consoleAPICalled' &&
        ['error', 'warning'].includes(message.params.type)
      )
        this.problems.push(
          `console.${message.params.type}: ` +
            message.params.args.map((arg: any) => arg.value ?? arg.description ?? '').join(' '),
        )
      if (message.method === 'Fetch.requestPaused') this.#paused(message.params)
    })
  }

  /**
   * Starts Chrome with a fresh profile; port 0 lets Chrome pick a free debugging port. Its AniList
   * answers come from AniList itself, unless `aniList` is 'recorded': then each request gets a
   * copy of its recording, from `recordings` if the check hands some in, or else from
   * web/e2e/anilist/, 200 ms after it is made, as AniList's answer would come. A request with no
   * recording gets a 404, not a failed connection, which would bring up the bundled samples that
   * titlesShown() can't tell from AniList's titles; and the next waitFor() throws, naming it.
   * Nothing is sent to AniList: Chrome doesn't even resolve its address, so a request that got
   * past the recordings would fail rather than reach it.
   */
  static async open({
    aniList = 'live',
    recordings,
  }: { aniList?: AniListMode; recordings?: Recording[] } = {}): Promise<Browser> {
    const chromeBin = process.env.CHROME_BIN
    if (!chromeBin || !existsSync(chromeBin))
      throw new Error(
        'Set CHROME_BIN to a Chrome or chrome-headless-shell binary to run the browser checks.',
      )
    const reachable = await fetch(BASE_URL)
      .then((response) => response.ok)
      .catch(() => false)
    if (!reachable)
      throw new Error(`Nothing is serving ${BASE_URL}. Start it with \`npm run dev\` first.`)

    const profile = mkdtempSync(join(tmpdir(), 'anibeam-e2e-'))
    const chrome = spawn(
      chromeBin,
      [
        '--headless',
        '--no-first-run',
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=0',
        ...(aniList === 'recorded'
          ? ['--host-resolver-rules=MAP graphql.anilist.co ~NOTFOUND']
          : []),
        'about:blank',
      ],
      { stdio: 'ignore' },
    )
    let failedToRun: Error | undefined
    chrome.once('error', (error) => (failedToRun = error))
    // Whatever goes wrong from here, Chrome and its profile go too.
    try {
      const portFile = join(profile, 'DevToolsActivePort')
      for (let i = 0; i < 200 && !existsSync(portFile); i++) {
        if (failedToRun) throw failedToRun
        if (exited(chrome)) throw new Error('Chrome exited before it was ready.')
        await sleep(100)
      }
      if (!existsSync(portFile)) throw new Error('Chrome opened no debugging port in 20 seconds.')
      const port = readFileSync(portFile, 'utf8').split('\n')[0]
      let target: { type: string; webSocketDebuggerUrl: string } | undefined
      for (let i = 0; i < 100 && !target; i++) {
        target = await fetch(`http://127.0.0.1:${port}/json/list`)
          .then((response) => response.json())
          .then((targets: { type: string; webSocketDebuggerUrl: string }[]) =>
            targets.find((t) => t.type === 'page'),
          )
          .catch(() => undefined)
        if (!target) await sleep(100)
      }
      if (!target) throw new Error('Chrome started but exposed no page to control.')
      const socket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome.')), {
          once: true,
        })
      })
      const browser = new Browser(chrome, profile, socket, aniList, recordings)
      await browser.send('Page.enable')
      await browser.send('Runtime.enable')
      if (aniList === 'recorded') await browser.#intercept()
      return browser
    } catch (error) {
      await stop(chrome, profile)
      throw error
    }
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.#nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 60_000)
      this.#pending.set(id, (message) => {
        clearTimeout(timer)
        if (message.error) reject(new Error(`${method}: ${message.error.message}`))
        else resolve(message.result)
      })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Runs an expression in the page and returns its JSON value. */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails)
      throw new Error(
        `${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}\n  in: ${expression.slice(0, 160)}`,
      )
    return result.result?.value as T
  }

  /**
   * Polls a true/false expression until it is true or the time runs out; returns the last answer.
   * Throws instead once the page has asked a recorded browser for anything with no recording.
   */
  async waitFor(expression: string, ms = 20_000): Promise<boolean> {
    for (let waited = 0; waited < ms; waited += 250) {
      this.#throwMisses()
      if (await this.evaluate<boolean>(`Boolean(${expression})`)) return true
      await sleep(250)
    }
    this.#throwMisses()
    return false
  }

  /** Sets the screen size and motion preference, loads the app, and waits for titles and fonts. */
  async load({
    width = 1440,
    height = 900,
    phone = false,
    reduceMotion = false,
    url = BASE_URL,
  } = {}) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: phone ? 2 : 1,
      mobile: phone,
    })
    await this.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: reduceMotion ? 'reduce' : 'no-preference' },
      ],
    })
    await this.send('Page.navigate', { url })
    await this.waitFor(
      `document.readyState === 'complete' && document.querySelector('#main')`,
      30_000,
    )
    await this.evaluate('document.fonts.ready.then(() => true)')
  }

  /** Leaves the app and deletes what it saved (titles and all), so the next load is a first visit. */
  async forget() {
    // Away from the app first, so it can't save again in between.
    await this.send('Page.navigate', { url: 'about:blank' })
    await this.waitFor(`location.href === 'about:blank'`)
    await this.send('Storage.clearDataForOrigin', {
      origin: new URL(BASE_URL).origin,
      storageTypes: 'local_storage',
    })
  }

  /** Resolves once the trending panels and the decade strip show real titles. */
  titlesShown(ms = 60_000) {
    return this.waitFor(
      `document.querySelectorAll('.ab-grid .ab-link').length >= 9 && document.querySelectorAll('.ab-strip-row .ab-strip-panel[href]').length > 3`,
      ms,
    )
  }

  /**
   * Resolves once every finite, time-based animation (entrances, pops, wipes) has finished.
   * Scroll-driven ones are skipped: they only finish when scrolled through.
   */
  animationsDone() {
    return this.evaluate(
      `Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))).then(() => true)`,
    )
  }

  /**
   * A PNG of part of the page, as base64. The clip is in CSS pixels from the top left of the
   * page, not of the screen: add scrollX and scrollY to a getBoundingClientRect() box. On a 2x
   * screen the PNG has twice as many pixels each way.
   */
  async screenshot(clip: { x: number; y: number; width: number; height: number }) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...clip, scale: 1 },
    })
    return data as string
  }

  async press(key: 'Tab' | 'Enter' | 'Escape' | 'Backspace' | 'ArrowRight', shift = false) {
    const code = { Tab: 9, Enter: 13, Escape: 27, Backspace: 8, ArrowRight: 39 }[key]
    const base = { key, code: key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 }
    // A real Enter also types "\r": buttons activate on that character, links on the key alone.
    const text = key === 'Enter' ? { text: '\r' } : {}
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...text })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /**
   * Replaces the header search text the way typing does (one input event per character). The
   * first character replaces the selected old text, so the box never sits empty in between.
   */
  async search(text: string) {
    await this.evaluate(
      `(() => { const input = document.querySelector('.ab-search input'); input.focus(); input.select(); return true })()`,
    )
    if (!text) await this.press('Backspace')
    for (const character of text) await this.send('Input.insertText', { text: character })
  }

  /**
   * Stops the page's clock: its timers, Date.now() and performance.now() then move only when
   * tick() moves them, so a check's pauses last exactly as long as it says, however busy the
   * machine is. Keys and rendering don't wait for it, unless the CPU is throttled as well
   * (Emulation.setCPUThrottlingRate): then keys stop going in. Stop it once the page has
   * settled: while its entrance animations run, the first tick can go 10 ms further than asked.
   * Chrome can't start the real clock again, even for another page, so stop it only in a
   * browser opened for that. A recorded AniList answer comes on Node's clock, 200 ms (or a hold)
   * after the page asks: with the page's clock stopped, the page takes it in only during a tick,
   * so tick once it is due.
   */
  stopClock() {
    return this.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
  }

  /**
   * Moves a stopped clock on by `ms`, running each timer that comes due on the way. One due
   * right as the tick ends may wait for the next one, so leave a margin.
   */
  async tick(ms: number) {
    const moved = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`The page's clock didn't move on by ${ms} ms within a minute.`)),
        60_000,
      )
      this.#clockMoved = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    await Promise.all([
      this.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: ms }),
      moved,
    ])
  }

  /**
   * Makes every request to AniList fail, as if it were down (`false` undoes it), in a recorded
   * browser too. There, Network.emulateNetworkConditions offline doesn't: its AniList requests
   * are answered before they reach the network. So a check that needs AniList to fail uses this.
   */
  async blockAniList(blocked = true) {
    this.#blocking = blocked
    return this.#intercept()
  }

  /**
   * Delays every AniList answer by `ms`, to look at loading states (0 undoes it). A recorded
   * answer comes after the hold, in place of its usual 200 ms.
   */
  async holdAniList(ms: number) {
    this.#holdMs = ms
    // Requests still on hold go through now: switching interception off would drop them.
    if (ms === 0) await Promise.all([...this.#held.keys()].map((id) => this.#release(id)))
    return this.#intercept()
  }

  /**
   * Changes AniList's answers before the page sees them, to stage what AniList rarely does.
   * `rewrite` gets each answer and returns a new status and body, or null to pass it on as
   * it is. `null` stops rewriting. In a live browser the requests still go to AniList (and count
   * toward its limit), and the answers keep its headers. In a recorded browser the rewrite gets a
   * copy of the request's recording, so it can change it where it is. A request with no recording
   * comes as a 404: a rewrite that answers it with another status needs no recording, but a 404
   * passed on, or changed and still a 404, leaves it a request with no recording (see open).
   */
  async rewriteAniList(rewrite: Rewrite | null) {
    this.#rewrite = rewrite
    return this.#intercept()
  }

  /** Answers, fails, holds or lets go a request to AniList that Chrome has paused. */
  #paused(params: any) {
    const { requestId, request, responseStatusCode, responseErrorReason } = params
    // Paused again once the answer (or a failure) is in (see rewriteAniList).
    if (responseStatusCode !== undefined || responseErrorReason !== undefined) {
      const answering = this.#answer(params).finally(() => this.#answering.delete(answering))
      this.#answering.add(answering)
    }
    // The CORS preflight Chrome sends before the page's request, answered as AniList answers it.
    else if (this.#aniList === 'recorded' && request.method === 'OPTIONS')
      void this.#fulfill(requestId, 204, PREFLIGHT_HEADERS, '')
    else if (this.#blocking)
      void this.send('Fetch.failRequest', {
        requestId,
        errorReason: 'ConnectionRefused',
      }).catch(() => {})
    else if (this.#aniList === 'recorded') {
      const { status, body } = this.#recorded(request)
      this.#hold(requestId, this.#holdMs || ANSWER_MS, () =>
        this.#fulfill(requestId, status, ANSWER_HEADERS, JSON.stringify(body)),
      )
    } else
      this.#hold(requestId, this.#holdMs, () =>
        this.send('Fetch.continueRequest', { requestId }).catch(() => {}),
      )
  }

  /**
   * A recorded browser's answer to a request: a copy of its recording, then any rewrite. With no
   * recording, a 404; unless a rewrite answers it with another status, it is noted for
   * waitFor() and close() to throw.
   */
  #recorded(request: { method: string; url: string; postData?: string }) {
    let graphql: Answer['request'] | undefined
    try {
      graphql = JSON.parse(request.postData ?? '')
    } catch {}
    const name = graphql?.query ? nameOf(graphql) : `${request.method} ${request.url}`
    const recording = graphql?.query ? this.#recordings.get(keyOf(graphql)) : undefined
    const answer: Answer = {
      request: { query: graphql?.query ?? '', variables: graphql?.variables ?? {} },
      status: recording?.status ?? 404,
      body: recording
        ? structuredClone(recording.body)
        : { data: null, errors: [{ message: `No recording for ${name}`, status: 404 }] },
    }
    let changed: { status: number; body: unknown } | null = null
    try {
      changed = this.#rewrite?.(answer) ?? null
    } catch {}
    // A rewrite that tags or passes on every answer, as some checks have for a whole file, would
    // otherwise hide a request with no recording.
    if (!recording && (changed ?? answer).status === 404)
      this.#misses.add(`The page asked AniList for ${name}, which has no recording ${this.#where}.`)
    return changed ?? answer
  }

  /** Throws for the requests a recorded browser had no recording for, each once. */
  #throwMisses() {
    if (!this.#misses.size) return
    const message = [...this.#misses].join('\n')
    this.#misses.clear()
    throw new Error(message)
  }

  #fulfill(requestId: string, status: number, headers: object[], body: string) {
    return this.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: status,
      responseHeaders: headers,
      body: Buffer.from(body).toString('base64'),
    }).catch(() => {})
  }

  /** Lets a paused request go its way, `release`, once `ms` is up or holdAniList(0) says so. */
  #hold(requestId: string, ms: number, release: () => Promise<unknown>) {
    this.#held.set(requestId, release)
    setTimeout(() => void this.#release(requestId), ms)
  }

  async #release(requestId: string) {
    const release = this.#held.get(requestId)
    if (!release) return
    this.#held.delete(requestId)
    await release()
  }

  async #answer({ requestId, request, responseStatusCode, responseHeaders }: any) {
    const rewrite = this.#rewrite
    // CORS preflights (OPTIONS) carry no GraphQL; let them and everything else pass.
    const changed =
      rewrite && request.method === 'POST'
        ? await this.send('Fetch.getResponseBody', { requestId })
            .then(({ body, base64Encoded }) =>
              rewrite({
                request: JSON.parse(request.postData),
                status: responseStatusCode,
                body: JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString() : body),
              }),
            )
            .catch(() => null)
        : null
    if (!changed) return this.send('Fetch.continueRequest', { requestId }).catch(() => {})
    await this.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: changed.status,
      // The new body is plain JSON of a new length.
      responseHeaders: responseHeaders.filter(
        (header: { name: string }) => !/^content-(encoding|length)$/i.test(header.name),
      ),
      body: Buffer.from(JSON.stringify(changed.body)).toString('base64'),
    }).catch(() => {})
  }

  async #intercept() {
    const urlPattern = 'https://graphql.anilist.co/*'
    const recorded = this.#aniList === 'recorded'
    const patterns = [
      // A recorded browser answers every request itself, as it is made.
      ...(recorded || this.#blocking || this.#holdMs > 0
        ? [{ urlPattern, requestStage: 'Request' }]
        : []),
      ...(!recorded && this.#rewrite ? [{ urlPattern, requestStage: 'Response' }] : []),
    ]
    // Answers still being rewritten go through first: switching interception off drops them.
    await Promise.all(this.#answering)
    return patterns.length ? this.send('Fetch.enable', { patterns }) : this.send('Fetch.disable')
  }

  /**
   * Ends Chrome. Then throws if the page asked a recorded browser for anything with no recording
   * that no waitFor() has thrown for: in after(), that fails the file.
   */
  async close() {
    this.#socket.close()
    await stop(this.#chrome, this.#profile)
    this.#throwMisses()
  }
}

const exited = (chrome: ChildProcess) => chrome.exitCode !== null || chrome.signalCode !== null

/** Ends Chrome, waits until it has gone, and deletes its throwaway profile. */
async function stop(chrome: ChildProcess, profile: string) {
  // With no pid, Chrome never ran, and there may never be an exit event to wait for.
  if (chrome.pid !== undefined && !exited(chrome)) {
    chrome.kill()
    await once(chrome, 'exit')
  }
  rmSync(profile, { recursive: true, force: true })
}
