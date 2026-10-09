# AniBeam

AniBeam is an anime discovery app drawn like a manga page. It shows what's trending, lets you search and browse by decade, and pulls a random title from a gacha machine. Each title tints the page in its own cover color. Live chat about episodes is planned for a later phase. Anime data comes from the [AniList GraphQL API](https://docs.anilist.co/). AniBeam is not affiliated with AniList.

> The project is in Phase 2, the design phase. The design system is in place: design tokens, self-hosted fonts, a tested color function, and the components the pages will use. The pages themselves come in Phase 3. Until then the app at `/` is the plain Phase 1 debug page. Run `npm run dev` and add `?variant=D` to the URL to see the chosen design built from the real components.

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

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `npm run dev`        | Starts the web app at http://localhost:5173                     |
| `npm run dev:server` | Starts the chat server at http://localhost:3001 (`GET /health`) |
| `npm run build`      | Type-checks and builds every workspace                          |
| `npm run typecheck`  | Type-checks every workspace                                     |
| `npm run lint`       | Lints the web app with oxlint                                   |
| `npm test`           | Runs the unit tests with Node's built-in test runner            |
| `npm run format`     | Formats the repo with Prettier                                  |

## Project structure

This repo is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo with three packages:

```
AniBeam/
├── web/                     # Frontend: React + Vite + TypeScript + Tailwind CSS v4
│   ├── public/              # Static files served as-is, including the fonts
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

Empty folders hold a `.gitkeep` file so git tracks them; each one is removed once real code lands in that folder. Tests live next to the code they test (`*.test.ts`).

## Notes

### AniList requests

The browser calls AniList directly, so each visitor's IP address gets its own limit of 30 requests a minute. `web/src/lib/anilist.ts` holds every request back for up to a minute after a 429, after a failed connection, or when AniList reports no requests left. Failed connections wait too, because a rate-limit reply without CORS headers reaches the browser as a plain network error.

TanStack Query saves results in `localStorage` for up to a day (`web/src/lib/queryClient.ts`). When a refresh fails, the last good list stays saved. It caches each result under its exact query text and variables, so editing a query never shows results saved for the old version. Change `buster` in `queryClient.ts` only if the code that reshapes results changes.

Every `media(...)` query in the source must include the `SAFE` filter, which excludes adult titles, and `npm test` fails if one doesn't. `SAFE` only works on top-level queries. Titles nested inside other results, such as relations or recommendations, need a filter in code.

Saved results and the rate-limit pause belong to one browser tab. With several tabs open, the last tab to save wins.

### Design

The look is the manga-page design chosen in Phase 2: paper, ink outlines, screentone and sound effects.

Design tokens are plain CSS custom properties in `web/src/styles/index.css`, such as `--paper`, `--ink` and `--spring`. Component CSS reads them directly, and an `@theme inline` block exposes them to Tailwind utilities like `bg-paper` and `font-display`.

The components live in `web/src/components`, with their styles in `components.css`. Every class there starts with `ab-`, so none collide with Tailwind utilities, and the file loads in the components layer.

Each title tints its panel, card or capsule with its AniList cover color. `deriveAccent` in `web/src/features/theming` turns that color into two colors. The fill reaches 4.5:1 contrast against ink, and the text color reaches 4.5:1 on the dotted paper. Only lightness and chroma change, so the hue stays the title's own. The tests check 5,832 colors spread across the RGB cube.

The design prototypes in `web/src/prototype` are for development only. Add `?variant=A`, `B`, `C` or `D` to the dev server's URL to open one. Production builds leave them out.

### Fonts

The display font is Dela Gothic One, by the Dela Gothic Project Authors. The body font is M PLUS Rounded 1c, by the Rounded M+ Project Authors. Both are self-hosted from `web/public/fonts`, so visitors' browsers never contact Google, and `npm test` fails if production code references Google Fonts.

The files are subsets with Latin letters, kana and the star symbol, about 100 KB for all three. Kanji fall back to a system font. Both fonts use the SIL Open Font License, and `web/public/fonts/OFL.txt` carries their copyright notices.

### Tailwind CSS v4 and custom CSS

Tailwind v4 is configured in CSS, not JavaScript. `web/src/styles/index.css` imports Tailwind and holds the design tokens. There is no `tailwind.config.js` or `postcss.config.js`; the `@tailwindcss/vite` plugin handles everything.

Tailwind v4 uses native CSS cascade layers, ordered `theme → base → components → utilities`. A later layer wins regardless of selector specificity, so no `!important` is needed. One rule to remember: **put custom component styles inside `@layer components`**. CSS written outside any layer beats every utility class, so a utility like `p-4` would stop working on that element.

### Firebase config is not secret

The `VITE_FIREBASE_*` values identify the Firebase project and are visible in every Firebase website's code. Security comes from Firebase security rules and server-side token checks, not from hiding these values.
