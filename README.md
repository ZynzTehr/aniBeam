# AniBeam

AniBeam is an anime discovery app drawn like a manga page. It shows what's trending, lets you search and browse by decade, and pulls a random title from a gacha machine. Each title tints the page in its own cover color. Live chat about episodes is planned for a later phase. Anime data comes from the [AniList GraphQL API](https://docs.anilist.co/). AniBeam is not affiliated with AniList.

> The project is in Phase 3. The app is one Discover page: an intro, this week's trending titles as a manga page, a random pull, titles by decade, and search. Each title opens in a full-screen title card. My List, mood sliders, live chat and sync come after the course presentation.

## Prerequisites

- Node.js 22.18 or newer (`node -v`). The tests run TypeScript files directly, which older versions can't do.
- npm 10 or newer

## Setup

```bash
npm install                                   # installs all workspaces
cp web/.env.example web/.env.local            # frontend config (optional for now)
cp server/.env.example server/.env            # chat server config (optional for now)
```

The `.env.example` files list every variable with a comment explaining it. Real `.env` files are gitignored, so never commit them.

## Scripts (run from the repo root)

| Command                | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `npm run dev`          | Starts the web app at http://localhost:5173                     |
| `npm run dev:server`   | Starts the chat server at http://localhost:3001 (`GET /health`) |
| `npm run build`        | Type-checks and builds every workspace                          |
| `npm run typecheck`    | Type-checks every workspace                                     |
| `npm run lint`         | Lints the web app with oxlint                                   |
| `npm test`             | Runs the unit tests with Node's built-in test runner            |
| `npm run test:browser` | Runs the browser checks in `web/e2e` (see below)                |
| `npm run format`       | Formats the repo with Prettier                                  |

## Deploying

The site deploys on [Vercel](https://vercel.com). Sign in with GitHub and import this repository. Vercel finds two apps, `web` and the Fastify chat server, so import only `web`. Vercel then uses its Vite settings with `web` as the root directory. It installs the workspaces, runs `npm run build`, and serves `dist`. No environment variables are needed yet.

After that, every pull request gets a preview link, and merging into `main` updates the live site. The chat server will need a host that keeps WebSocket connections open, which is planned for Phase 6.

## Project structure

This repo is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo with three packages:

```
AniBeam/
├── web/                     # Frontend: React + Vite + TypeScript + Tailwind CSS v4
│   ├── e2e/                 # Browser checks (*.e2e.ts) and the Chrome driver they share
│   │   └── anilist/         # AniList's answers, recorded for the browser checks
│   ├── public/              # Static files served as-is, including the fonts
│   ├── scripts/             # Maintenance scripts, such as the sample titles' refresh
│   └── src/
│       ├── app/             # App shell: root component, router, providers
│       ├── pages/           # One component per route (Discover, Browse, Detail, Mood, My List)
│       ├── features/        # Feature modules: logic + UI that pages are built from
│       │   ├── anime/       #   AniList queries and display helpers
│       │   ├── theming/     #   Adaptive accent color (deriveAccent, CSS variables)
│       │   ├── mood/        #   The gacha pull machine; mood sliders and scoring come later
│       │   ├── list/        #   Saved list (Saved / Want to try / Favorite)
│       │   ├── chat/        #   Live chat UI
│       │   └── sync/        #   Cross-device sync (stretch goal)
│       ├── components/      # Shared UI from the chosen design: header, panels, title card
│       ├── prototype/       # Design prototypes, development only (?variant=A|B|C|D)
│       ├── lib/             # Low-level clients and helpers (AniList client, query cache, Firebase)
│       ├── styles/          # Tailwind entry point, design tokens, custom CSS
│       └── main.tsx         # Entry point
├── server/                  # Chat API: Fastify + Socket.IO + Postgres
│   └── src/
│       ├── routes/          # REST endpoints (e.g. message history)
│       ├── sockets/         # Socket.IO event handlers (join room, send message)
│       ├── db/              # Database schema, migrations, client
│       ├── auth/            # Firebase sign-in token verification
│       ├── moderation/      # Rate limits, reports, profanity filter
│       └── index.ts         # Entry point
├── shared/                  # Types and validation schemas used by both web and server
│   └── src/
└── package.json             # Workspace root and shared scripts
```

Empty folders hold a `.gitkeep` file so git tracks them; each one is removed once real code lands in that folder. Unit tests live next to the code they test (`*.test.ts`). The browser checks live in `web/e2e` (`*.e2e.ts`).

## Notes

### AniList requests

The browser calls AniList directly, so each visitor's IP address gets its own limit of 30 requests a minute. `web/src/lib/anilist.ts` holds every request back for up to a minute after a 429, after a failed connection, or when AniList reports no requests left. Failed connections wait too, because a rate-limit reply without CORS headers reaches the browser as a plain network error. When AniList says when the limit resets, the wait ends up to 2 seconds after that, at random. Devices on one network share one IP address, and so one limit and one reset time, and this keeps them from all asking again in the same instant.

TanStack Query saves results in `localStorage` for up to a day (`web/src/lib/queryClient.ts`). When a refresh fails, the last good list stays saved. It caches each result under its exact query text and variables, so editing a query never shows results saved for the old version. Change `buster` in `queryClient.ts` only if the code that reshapes results changes.

Saved trending titles are refreshed once they are over 30 minutes old. If the refresh brings a new order while the trending panels or the intro's covers are on screen, they keep the order the visitor is looking at until they are scrolled away, so nothing reshuffles in front of the visitor (`web/src/lib/steadyList.ts`).

Every `media(...)` query in the source must include the `SAFE` filter, which excludes adult titles, and `npm test` fails if one doesn't. `SAFE` only works on top-level queries. Titles nested inside other results, such as relations or recommendations, need a filter in code.

Saved results and the rate-limit pause belong to one browser tab. With several tabs open, the last tab to save wins.

For when AniList can't be reached, `web/src/features/anime/samples.ts` bundles 30 well-known titles, 3 to 5 from each decade. A section with no titles of its own shows them, labelled, once AniList refuses it (403), rate-limits it (429) or can't be reached, until AniList answers: trending becomes "Fan favorites", with the first 9 and no rank numbers, and the decade strip shows that decade's samples (Upcoming has none). They load only then, from a file of their own, and are never saved as AniList's titles. `npm run samples --workspace web` rewrites it from the list of IDs in `web/scripts/refresh-samples.ts`, with one AniList request. Run it to change the titles, or when the type check fails after a change to the fields AniBeam asks for. It writes nothing if a title is missing, Ecchi, or has no cover color or year, and `npm test` checks the file again.

### Design

The look is the manga-page design chosen in Phase 2: paper, ink outlines, screentone and sound effects.

Design tokens are plain CSS custom properties in `web/src/styles/index.css`, such as `--paper`, `--ink` and `--spring`. Component CSS reads them directly, and an `@theme inline` block exposes them to Tailwind utilities like `bg-paper` and `font-display`. `npm test` fails if nothing reads a token, or if `components.css` copies a token's color, `clamp()` or other function instead of reading it.

The components live in `web/src/components`, with their styles in `components.css`. Every class there starts with `ab-`, so none collide with Tailwind utilities, and the file loads in the components layer.

Each title tints its panel, card or capsule with its AniList cover color. `deriveAccent` in `web/src/features/theming` turns that color into two colors. The fill reaches 4.5:1 contrast against ink, and the text color reaches 4.5:1 on the dotted paper. Only lightness and chroma change, so the hue stays the title's own. The tests check 5,832 colors spread across the RGB cube.

The design prototypes in `web/src/prototype` are for development only. Add `?variant=A`, `B`, `C` or `D` to the dev server's URL to open one. Production builds leave them out.

### Fonts

The display font is Dela Gothic One, by the Dela Gothic Project Authors. The body font is M PLUS Rounded 1c, by the Rounded M+ Project Authors. Both are self-hosted from `web/public/fonts`, so visitors' browsers never contact Google. `npm test` builds the production bundle in memory and fails if any file in it references Google Fonts.

The files are subsets with Latin letters, kana and the star symbol, about 100 KB for all three. Kanji fall back to a system font. Both fonts use the SIL Open Font License, and `web/public/fonts/OFL.txt` carries their copyright notices.

### Browser checks

`web/e2e` holds checks that run the real page in headless Chrome: layout on desktop and phone, keyboard use, reduced motion, Windows contrast themes, the title card, search, the pull, trending refreshed while it is on screen, and what a visitor sees when AniList is down. Two more check AniList's API itself. They need no extra package. Node drives Chrome over its DevTools protocol.

To run them, start the app with `npm run dev`, then point `CHROME_BIN` at a Chrome or chrome-headless-shell binary:

```bash
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
```

A run takes about five minutes. The outage checks take about two of them, because the app waits a minute before retrying a failed connection.

#### Recorded answers

Every check but the two live ones gets AniList's answers from `web/e2e/anilist/`, not from its API. A run would otherwise send AniList about 30 requests, 22 of them in its first minute, against its limit of 30 a minute for each IP address. Each file there holds AniList's real answer to one request the checks send, recorded by `npm run e2e:record`. `web/e2e/browser.ts` answers each request in Chrome with a copy of its recording, 200 ms after the page asks, about as long as AniList takes to answer. Chrome can't even look up AniList's address, so a request that got past the recordings would fail before it reached AniList.

The recordings are [AniList](https://anilist.co)'s data. The folder holds only the 20 answers the checks ask for, about 270 KB of JSON, with no images and no user data. Only the checks use it. `npm test` builds the production bundle in memory and fails if any code or file in it came from `web/e2e/`, whether an import, a glob or an alias brought it in, or a stylesheet or `index.html` named it. A second check reads the code in `web/src` for a path into `web/e2e/` and names the line it finds.

Some checks stage answers AniList rarely gives, such as a refused request or titles all tagged Ecchi. `browser.ts` rewrites the answer before the page sees it, whether it was recorded or came from AniList.

#### Recorded, live or off

`ANILIST` sets where the answers come from:

| `ANILIST`            | Answers come from                             | Requests to AniList's API in a run |
| -------------------- | --------------------------------------------- | ---------------------------------- |
| `recorded` (default) | the recordings, except in the two live checks | 2                                  |
| `live`               | AniList, unless a check asks for recordings   | about 30, 22 in the first minute   |
| `off`                | the recordings, and the two live checks skip  | none                               |

```bash
ANILIST=live CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:browser
```

Run `ANILIST=live` on its own, while nothing else on the machine uses AniList. A live run tests this week's titles. The recordings keep the titles from the day they were recorded. Under `ANILIST=off`, a check that asks for a live browser fails, so a new one must skip under `off`, as the live checks do.

#### Recording again

Run the recorder in `web/` with `npm run e2e:record`, or from the root with `npm run e2e:record --workspace web`. It sends AniList one request at a time, at least 6.5 seconds apart, so never more than 10 in a minute. All 20 take about two minutes. By default it records only the missing and stale recordings, and deletes any that no check asks for. `npm run e2e:record -- --all` records every one again, and `npm run e2e:record -- trending search-frieren` records just those two, by file name. It prints a line for each recording saying what changed.

Record again when:

- `npm test` says a recording is missing or stale. A recording goes stale when the app changes the request it answers, in its query or its variables. Asking for one more field of every title makes all 20 stale.
- A check sends a request that has no recording. The check fails, naming the request and saying how to record it. Add the search to `SEARCHES`, or the decade to `DECADES`, in `web/e2e/recordings.ts`, then run the recorder. Another kind of request, such as one for a title on its own, goes in `requests()` there instead, and the message says so. If the request is the start of a search the check typed with `search()`, the page searched mid-word on a busy machine. The message then says to run the check again, with nothing to record. If it is the start of a recorded search, the page may have searched mid-word, and the message says to run the check again first.

The recorder writes nothing unless every answer is a 200 with no errors and the titles still hold what each check relies on, such as Frieren first in a search for "frieren". If AniList's titles can't hold it any more, the recorder says which check relies on it. That check must change, and so must its rule in `RULES` in `web/e2e/recordings.ts`.

Keep `SEARCHES` and `DECADES` up to date by hand. When a check stops sending a search, take it out of `SEARCHES`, with any rule for it, and the recorder deletes its recording. Nothing else notices a recording that no check uses any more.

A new check that needs something particular of a title, such as a banner or a long name, should stage it with `rewriteAniList` in `browser.ts` instead of counting on a recording to have it.

#### Covers

Covers and banners still load from AniList's image server in every mode, so the checks need the internet. Three checks depend on those images:

- "on a 2x screen, decade covers load AniList's 460px file where there is one" waits for the first two 1990s covers to load.
- "the splash panel shows its cover when the window narrows, even after its banner failed" waits for the first sample title's cover to load.
- "every trending panel shows a brand-hot focus ring when tabbed to" counts brand-hot pixels in screenshots that take in the covers.

AniList replaces covers now and then, and an old file can disappear. A cover that can't load doesn't show, and its panel shows the title's color instead. If one of the first two 1990s covers in the recordings has gone, the first of these checks fails with "the first decade covers never loaded". `npm run e2e:record -- --all` records the answers again, with the covers' current addresses. The splash panel's cover belongs to a sample title, so `npm run samples` in `web/` refreshes it instead.

#### The two live checks

`web/e2e/live.e2e.ts` has the app send AniList's API two of its own requests: a first visit's one request for trending and the 1990s, then a search for the first trending title by its name. A run sends AniList these 2 requests and a CORS preflight, and one more of each when the first-visit check asks again (see below). The checks judge AniList's answer as it came over the network, by the rules in `web/e2e/live.ts`:

- While AniList's API is down or busy, they skip, saying why and that it's not the app. That covers a 429, a 403, no connection, no answer within 20 seconds, a 5xx that a one-line health query confirms, and a first visit's trending or 1990s list sent empty twice, with nothing else wrong. Node's test runner lists each skipped check with its reason. While the live checks skip, nothing checks AniList's API, so look out for skips.
- When AniList answers in a way the app can't use, they fail, in AniList's words when it gave some. That covers a query it turns down, a missing field, a field in a format the app can't read, and CORS headers that keep the answer from the page.
- They also rely on AniList's data: enough trending and 1990s titles for the page to show, 1990s titles from the 1990s, and a search that finds the title it searched for. If the data breaks one of these, they fail with "That's AniList's data, not its API or the app". If it lasts, every run fails until AniList's data or the rule in `live.ts` changes.

AniList always has trending and 1990s titles, but while busy it can send a list of them empty. Twice, AniList took about 13 seconds to answer a first visit and sent no trending titles, and a run 2 minutes later passed. So when either list comes back empty, and nothing else is wrong with the answer, the first-visit check asks once more, 20 seconds later, from a fresh first visit. If the second answer has the titles, the check goes on with it, and its output says that AniList's first answer was empty. If a list comes back empty again, with nothing else wrong, the check skips: "AniList answered the app's first-visit request twice, 20 seconds apart, with no titles in data.trending.media, a list it always fills: it isn't answering in full right now. It's not the app." An empty list with anything else wrong in the answer, such as a cover over http, fails at once, naming all of it: AniList being busy doesn't explain the rest. A list with some titles, but fewer than the page shows, still fails at once as AniList's data. Before changing a rule for it, run the checks again.

### Tailwind CSS v4 and custom CSS

Tailwind v4 is configured in CSS, not JavaScript. `web/src/styles/index.css` imports Tailwind and holds the design tokens. There is no `tailwind.config.js` or `postcss.config.js`; the `@tailwindcss/vite` plugin handles everything.

Tailwind v4 uses native CSS cascade layers, ordered `theme → base → components → utilities`. A later layer wins regardless of selector specificity, so no `!important` is needed. One rule to remember: **put custom component styles inside `@layer components`**. CSS written outside any layer beats every utility class, so a utility like `p-4` would stop working on that element.

### Firebase config is not secret

The `VITE_FIREBASE_*` values identify the Firebase project and are visible in every Firebase website's code. Security comes from Firebase security rules and server-side token checks, not from hiding these values.
