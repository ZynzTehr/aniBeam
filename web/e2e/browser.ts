// Drives a headless Chrome over the DevTools protocol for the browser checks in this folder.
// No dependency: Node's built-in fetch and WebSocket talk to the browser.
//
//   CHROME_BIN  path to Chrome or chrome-headless-shell (required)
//   BASE_URL    the running app (default http://localhost:5173/, from `npm run dev`)
//
// The checks use the real AniList API, which allows 30 requests a minute per IP address.
// One browser profile is kept for a whole test file, so its saved cache spares requests.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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

export class Browser {
  #chrome: ChildProcess
  #profile: string
  #socket: WebSocket
  #nextId = 0
  #pending = new Map<number, (message: Message) => void>()
  #blocking = false
  #holdMs = 0
  #held = new Set<string>()
  /** Uncaught exceptions and console errors or warnings, for the "clean console" check. */
  problems: string[] = []

  private constructor(chrome: ChildProcess, profile: string, socket: WebSocket) {
    this.#chrome = chrome
    this.#profile = profile
    this.#socket = socket
    socket.addEventListener('message', (event) => {
      const message: Message = JSON.parse(String(event.data))
      if (message.id !== undefined) {
        this.#pending.get(message.id)?.(message)
        this.#pending.delete(message.id)
      }
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
      if (message.method === 'Fetch.requestPaused') {
        const { requestId } = message.params
        if (this.#blocking)
          void this.send('Fetch.failRequest', {
            requestId,
            errorReason: 'ConnectionRefused',
          }).catch(() => {})
        else {
          this.#held.add(requestId)
          setTimeout(() => void this.#release(requestId), this.#holdMs)
        }
      }
    })
  }

  /** Starts Chrome with a fresh profile; port 0 lets Chrome pick a free debugging port. */
  static async open(): Promise<Browser> {
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
        'about:blank',
      ],
      { stdio: 'ignore' },
    )
    const portFile = join(profile, 'DevToolsActivePort')
    for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(100)
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
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
    const browser = new Browser(chrome, profile, socket)
    await browser.send('Page.enable')
    await browser.send('Runtime.enable')
    return browser
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

  /** Polls a true/false expression until it is true or the time runs out; returns the last answer. */
  async waitFor(expression: string, ms = 20_000): Promise<boolean> {
    for (let waited = 0; waited < ms; waited += 250) {
      if (await this.evaluate<boolean>(`Boolean(${expression})`)) return true
      await sleep(250)
    }
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

  async press(key: 'Tab' | 'Enter' | 'Escape' | 'Backspace' | 'ArrowRight', shift = false) {
    const code = { Tab: 9, Enter: 13, Escape: 27, Backspace: 8, ArrowRight: 39 }[key]
    const base = { key, code: key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 }
    // A real Enter also types "\r": buttons activate on that character, links on the key alone.
    const text = key === 'Enter' ? { text: '\r' } : {}
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...text })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /** Replaces the header search text the way typing does (one input event per character). */
  async search(text: string) {
    await this.evaluate(
      `(() => { const input = document.querySelector('.ab-search input'); input.focus(); input.select(); return true })()`,
    )
    await this.press('Backspace')
    for (const character of text) await this.send('Input.insertText', { text: character })
  }

  /** Makes every request to AniList fail, as if it were down (`false` undoes it). */
  async blockAniList(blocked = true) {
    this.#blocking = blocked
    return this.#intercept(blocked || this.#holdMs > 0)
  }

  /** Delays every AniList answer by `ms`, to look at loading states (0 undoes it). */
  async holdAniList(ms: number) {
    this.#holdMs = ms
    // Requests still on hold go through now: switching interception off would drop them.
    if (ms === 0) await Promise.all([...this.#held].map((id) => this.#release(id)))
    return this.#intercept(this.#blocking || ms > 0)
  }

  async #release(requestId: string) {
    if (!this.#held.delete(requestId)) return
    await this.send('Fetch.continueRequest', { requestId }).catch(() => {})
  }

  #intercept(on: boolean) {
    if (!on) return this.send('Fetch.disable')
    return this.send('Fetch.enable', { patterns: [{ urlPattern: 'https://graphql.anilist.co/*' }] })
  }

  async close() {
    this.#socket.close()
    this.#chrome.kill()
    await new Promise((resolve) =>
      this.#chrome.exitCode !== null ? resolve(null) : this.#chrome.once('exit', resolve),
    )
    rmSync(this.#profile, { recursive: true, force: true })
  }
}
