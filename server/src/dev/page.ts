// The two-tab demo's page (D9): /demo, on the dev entry alone (demo.ts), for trying the chat in
// two browser tabs before web/ has a chat. Its files are in page/: the HTML, its stylesheet and
// its script, each a file of its own, since the page's CSP runs no inline script. The page loads
// Socket.IO's browser file from this server too, which only the dev entry serves.
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'

/**
 * The page's Content Security Policy: scripts, styles and connections from this server alone,
 * and only from files, so that a script written into the page, inline or as an onerror=, never
 * runs. The page's socket, a WebSocket to its own host and port (demo.js says why not polling),
 * is 'self' too, as CSP Level 3 has it and today's browsers do. No plugin, no <base>, no form
 * posting elsewhere, and no other site may frame it.
 */
export const CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** The page's files, by the address each is served at, with its type. */
const FILES = {
  '/demo': { file: 'demo.html', type: 'text/html; charset=utf-8' },
  '/demo/demo.css': { file: 'demo.css', type: 'text/css; charset=utf-8' },
  '/demo/demo.js': { file: 'demo.js', type: 'text/javascript; charset=utf-8' },
}

/** Serves the demo page's files on `app`, each read once, now. */
export function demoPage(app: FastifyInstance) {
  for (const [path, { file, type }] of Object.entries(FILES)) {
    const content = readFileSync(new URL(`page/${file}`, import.meta.url), 'utf8')
    app.get(path, (_request, reply) =>
      reply
        .headers({
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        })
        .type(type)
        .send(content),
    )
  }
}
