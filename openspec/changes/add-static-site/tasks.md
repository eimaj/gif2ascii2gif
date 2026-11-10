# Tasks

## 1. Shared conversion core

- [x] 1.1 Create `site/lib/core.mjs` (ramp, frame sizing, `detectBackground`, `pickChar`, `frameToAnsi`) and `site/lib/glyphs.mjs`, moved from the CLI scripts with no behavior change, using only typed arrays (no `Buffer`, no `node:` imports). Verify: `node --test tests/unit/core.test.mjs` covers sizing (220×366 at 40 → 40×33), white-background detection, threshold and `@`-at-180 picking, keep-bg luminance picking, and one escape per same-color run.
- [x] 1.2 Create `site/lib/render.mjs` (`parseAnsiFrame`, `renderFrameRGBA` with margin, scale, transparent or hex background) and `site/lib/player.mjs` (`playerSource`). Verify: unit tests for glyph coverage of every ramp character, unknown-character error, transparent vs solid alpha, scale dimensions, and player text containing `FRAMES`/`DELAY_MS`.
- [x] 1.3 Switch `gif2ascii.mjs` and `ascii2gif.mjs` to import from `site/lib/`. Verify: regenerate `players/dance-dancing.mjs` and its GIF and confirm the player is byte-identical to one generated before the change (save the before copy first).
- [x] 1.4 Add `tests/integration/cli.test.mjs`: build a small GIF with ffmpeg `lavfi` (no network), run both CLIs, and check frames, dimensions, and transparency with `ffprobe`. Verify: `node --test tests/integration` passes.
- [x] 1.5 Add `package.json` (private, `type: module`, scripts `test`, `test:unit`, `test:integration`, `test:e2e`, `serve`) and update `.gitignore` with `node_modules/`, `test-results/`, `playwright-report/`, `.wrangler/`, `.dev.vars`, `wrangler.toml`, `.env*`. Verify: `npm test` runs unit and integration suites.

## 2. Vendored libraries

- [x] 2.1 Vendor gifenc 1.0.3 `dist/gifenc.esm.js` with `LICENSE` and `SOURCE.md` (URL, date, SHA-256) under `site/vendor/gifenc/`. Verify: the file imports in Node and exposes `GIFEncoder`, `quantize`, `applyPalette`.
- [x] 2.2 Vendor the esm.sh bundle of gifuct-js 2.1.2 as `site/vendor/gifuct-js/gifuct.bundle.mjs` with both license files (gifuct-js, js-binary-schema-parser 2.0.3) and `SOURCE.md`. Verify: the file imports in Node and exposes `parseGIF`, `decompressFrames`.
- [x] 2.3 Add `tests/unit/vendor.test.mjs` checking each vendored file against its recorded SHA-256. Verify: test passes, and fails after a one-byte edit (revert after checking).

## 3. Browser converter

- [x] 3.1 Create `site/index.html`, `site/styles.css` (monospace, dark default, light via `prefers-color-scheme`, phone-width safe), and `site/app.js` skeleton with input area (file picker, drop zone, URL field, "Try the demo"), controls, canvas, and download buttons. Verify: `npm run serve`, page loads with no console errors at desktop and 375px width.
- [x] 3.2 Implement decoding in `site/lib/decode.mjs`: gifuct-js parse, size-limit checks (20 MB, 300 frames) before decompressing, disposal-aware compositing, area resampling, frame-rate calculation. Verify: unit test with a generated GIF using disposal 2 and 3 matches expected composited pixels; over-limit inputs throw a typed limit error with the actual value.
- [x] 3.3 Wire inputs, errors, and blocking: CORS failure message, not-a-GIF message that keeps the previous result, limit-block message stating limit, actual value, and why. Verify: manual check of each message; covered again in E2E.
- [x] 3.4 Wire controls and the canvas preview (decode once, re-convert on control change, loop at source fps, checkerboard when transparent). Verify: changing width updates the canvas size live.
- [x] 3.5 Implement exports: GIF via gifenc (transparent index, `dispose: 2`, loop) and player via `playerSource`, both named after the source. Verify: the exported GIF's frame count and size match the preview; the downloaded `.mjs` plays with `node`.
- [x] 3.6 Add the CLI-vs-site parity test to `tests/integration/`: identical decoded frames through both code paths produce byte-identical player text. Verify: `node --test tests/integration` passes.

## 4. Page content

- [x] 4.1 Add "How it works" (three steps), CLI usage with copy buttons, and the footer repo link. Verify: copy button puts the exact command on the clipboard.
- [ ] 4.2 Add "Credits and licenses" listing gifenc, gifuct-js, and js-binary-schema-parser (name, pinned version, project link, license name, link to the served license file, what it is used for) and ffmpeg for the CLI. Verify: every license link returns the license text from the local server.
- [ ] 4.3 Add the privacy note generated from `site/lib/events.mjs` so it always lists the real events and fields. Verify: unit test asserts every allowlisted event and field appears in the rendered note text.

## 5. Usage events and hardening

- [ ] 5.1 Create `site/lib/events.mjs` (allowlist, enums, bucketing helpers) and `functions/api/event.js` per design D6. Verify: `tests/unit/event.test.mjs` covers 405, 403 (wrong and missing origin), 413, 400 (bad JSON, unknown event, bad enum, extra field), 503 (no binding), and 204 with a data point containing only the allowed fields.
- [ ] 5.2 Send events from the page (`convert`, `export_gif`, `export_player`, `blocked_too_large`) with `sendBeacon` and a `keepalive` fetch fallback, never awaiting the result. Verify: with `/api/event` returning 404 locally the converter still works and shows no error.
- [ ] 5.3 Add `site/robots.txt` (allow all, disallow `/api/`) and `site/_headers` (CSP per design D7, `nosniff`, `no-referrer`, `Permissions-Policy`). Verify: the page works under the CSP in Chromium (no CSP violations in the console with the policy applied by the local server).
- [ ] 5.4 Confirm no deploy configuration is committed: grep the repo for account IDs, the custom domain, `wrangler`, and dataset names. Verify: grep finds only the `.gitignore` guards and the `EVENTS` binding name.

## 6. Browser tests and docs

- [ ] 6.1 Add `tests/serve.mjs` (zero-dependency static server for `site/` that applies `_headers`) and `playwright.config.mjs` (Chromium only, `webServer` runs `serve.mjs`). Add `@playwright/test` as the only dev dependency. Verify: `npx playwright test --list` shows the suite.
- [ ] 6.2 Write E2E tests: upload a generated fixture and see the preview play, change width and see the canvas resize, download both exports and check names and GIF frame count, upload a 301-frame fixture and see the block message. Verify: `npm run test:e2e` passes, one test at a time, Chromium only.
- [ ] 6.3 Update `README.md` with the site, the shared-core layout, and how to run each test suite. Verify: every command in the README runs as written.

## Deployment note

- Deployment is configured outside this repo (Cloudflare Pages: output directory `site`, no build command, Analytics Engine binding `EVENTS`).
