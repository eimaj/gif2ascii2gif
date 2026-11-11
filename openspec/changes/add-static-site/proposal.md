# Proposal

## Why

gif2ascii only runs as a CLI that needs Node and ffmpeg, so sharing it means asking people to clone a repo. A static site lets anyone convert a GIF to colored ASCII and back in their browser, with no install and no server-side processing.

## What Changes

- Add a static site under `site/` that converts a GIF to a colored-ASCII animation fully client-side: file, drag-and-drop, or URL input; live canvas preview; every CLI option as a live control; downloads for a transparent GIF and the standalone terminal player.
- Extract the conversion logic (character ramp, background detection, character picking, ANSI frames, glyph bitmaps, glyph rasterizing, player template) into shared ES modules in `site/lib/`, imported by both CLI scripts and the site. CLI behavior and output stay identical.
- Vendor two MIT libraries into `site/vendor/` (gifuct-js to decode, gifenc to encode) with their license files, and credit them on the page with versions, links, and what each is used for.
- Block conversions that would freeze the tab (too many frames, too large a file) and say why.
- Add a Cloudflare Pages Function at `/api/event` that counts anonymous usage events into Workers Analytics Engine, rejecting cross-origin and malformed requests. No personal data is stored.
- Add `robots.txt` and security headers. Keep all deploy configuration (account, project, domain, bindings, dashboard rules) out of the public repo.
- Add tests: unit tests for the shared core and the event function, a CLI round-trip integration test, and Playwright browser tests (dev-only dependency).

## Capabilities

### New Capabilities

- `ascii-conversion`: How a GIF's frames become colored ASCII frames and back into pixels: background detection and removal, character selection, ANSI frame output, glyph rendering, and the standalone player format. Shared by the CLI and the site.
- `web-converter`: The browser converter: inputs, controls, live preview, size limits, exports, and the page's content (how it works, a pointer to the repo for the command line, credits and licenses, privacy note).
- `usage-events`: Anonymous usage counting: which events are recorded, which fields they may carry, and how the endpoint rejects abuse.

### Modified Capabilities

None. No specs exist yet.

## Impact

- New: `site/` (HTML, CSS, JS, `lib/`, `vendor/`, `robots.txt`, `_headers`), `functions/api/event.js`, `tests/`, `package.json` (dev-only `@playwright/test`).
- Changed: `gif2ascii.mjs` and `ascii2gif.mjs` import from `site/lib/` instead of defining the logic inline. Flags and output unchanged.
- Changed: `.gitignore` gains deploy-config guards (`.wrangler/`, `.dev.vars`, `wrangler.toml`, `.env*`), `node_modules/`, and Playwright output.
- Changed: `README.md` gains a section on the site and on running tests.
- Hosting: Cloudflare Pages connected to the GitHub repo, configured outside the repo. The runbook lives in private notes, not here.
