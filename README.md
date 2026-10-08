# AniBeam

An anime discovery app with cinematic, color-adaptive theming, mood-based exploration, a gacha roll for random picks, and live episode chat. Anime data comes from the [AniList GraphQL API](https://docs.anilist.co/) (unofficial; not affiliated with AniList).

> The project is in Phase 1. The app is a plain debug page that lists trending titles, titles by decade, and search results from AniList. Results are saved in the browser, so a reload shows them without new API requests.

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
│   ├── public/              # Static files served as-is
│   └── src/
│       ├── app/             # App shell: root component, router, providers
│       ├── pages/           # One component per route (Discover, Browse, Detail, Mood, My List)
│       ├── features/        # Feature modules: logic + UI that pages are built from
│       │   ├── anime/       #   AniList queries, hooks, title cards
│       │   ├── theming/     #   Adaptive accent color (deriveAccent, CSS variables)
│       │   ├── mood/        #   Mood sliders, scoring, gacha
│       │   ├── list/        #   Saved list (Saved / Want to try / Favorite)
│       │   ├── chat/        #   Live chat UI
│       │   └── sync/        #   Cross-device sync (stretch goal)
│       ├── components/      # Generic, reusable UI (buttons, dialogs, skeletons)
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

The browser calls AniList directly, so each visitor's IP address gets its own limit of 30 requests a minute. When AniList answers with a 429 or reports no requests left, `web/src/lib/anilist.ts` holds every request until the limit resets.

TanStack Query saves results in `localStorage` for 24 hours (`web/src/lib/queryClient.ts`). After changing the fields a query asks for, change `buster` in that file so browsers drop results saved in the old shape.

Every query in `web/src/features/anime/queries.ts` must include the `SAFE` filter, which excludes adult titles. `npm test` fails if one doesn't.

### Tailwind CSS v4 and custom CSS

Tailwind v4 is configured in CSS, not JavaScript: `web/src/styles/index.css` imports Tailwind, and design tokens go in an `@theme` block there. There is no `tailwind.config.js` or `postcss.config.js`; the `@tailwindcss/vite` plugin handles everything.

Tailwind v4 uses native CSS cascade layers, ordered `theme → base → components → utilities`. A later layer wins regardless of selector specificity, so no `!important` is needed. One rule to remember: **put custom component styles inside `@layer components`**. CSS written outside any layer beats every utility class, so a utility like `p-4` would stop working on that element.

### Firebase config is not secret

The `VITE_FIREBASE_*` values identify the Firebase project and are visible in every Firebase website's code. Security comes from Firebase security rules and server-side token checks, not from hiding these values.
