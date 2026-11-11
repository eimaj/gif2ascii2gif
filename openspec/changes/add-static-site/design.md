# Design

## Context

The repo has two Node CLI scripts: `gif2ascii.mjs` (GIF URL → ffmpeg → colored-ASCII player `.mjs`) and `ascii2gif.mjs` (player → bitmap glyphs → ffmpeg → GIF). All logic is inline in those two files. The repo is public, so it must contain no deploy configuration. The owner sets up Cloudflare from a different machine.

## Goals / Non-Goals

**Goals:** a no-build static site on Cloudflare Pages that does both directions client-side; one shared conversion core so the CLI and site cannot drift; anonymous usage counts; abuse resistance; full credit for shipped third-party code.

**Non-Goals:** server-side conversion; accounts or saved history; non-GIF inputs (video, WebP); replacing ffmpeg in the CLI; any Cloudflare configuration file in the repo.

## Decisions

### D1. Layout

```
site/                      # Pages build output directory (served as-is)
  index.html  styles.css  app.js
  lib/                     # shared core, imported by the CLI and the site
    core.mjs               # ramp, frame sizing, frameDelay, detectBackground, pickChar, frameToAnsi
    glyphs.mjs             # 6×12 bitmaps, CELL_W/CELL_H
    render.mjs             # parseAnsiFrame, renderFrameRGBA (shared by canvas preview + both GIF exports)
    player.mjs             # playerSource(frames, delayMs)
    events.mjs             # event allowlist + field enums (used by the function, the client, and the privacy note)
  vendor/
    gifenc/       gifenc.esm.js  LICENSE  SOURCE.md
    gifuct-js/    gifuct.bundle.mjs  LICENSE  LICENSE-js-binary-schema-parser  SOURCE.md
  robots.txt  _headers
functions/api/event.js     # Pages Function (Pages reads functions/ from the project root, not the output dir)
tests/  unit/  integration/  e2e/  serve.mjs
package.json               # devDependencies: @playwright/test only
```

`site/lib/` lives inside the served folder because Pages serves only `site/`. The CLI imports `./site/lib/*.mjs`. The modules use only standard JS (typed arrays, no `Buffer`, no `node:` imports) so they run unchanged in both.

### D2. Pixel pipeline in the browser

1. Decode with gifuct-js: `parseGIF` + `decompressFrames(gif, true)` gives per-frame RGBA patches, delays, and disposal types.
2. Composite patches onto a full-size RGBA canvas honoring disposal (1 keep, 2 clear to transparent, 3 restore previous), producing one full frame per GIF frame.
3. Resample each full frame to `width × height` with area averaging (box filter over the source pixels covering each cell), matching ffmpeg's `flags=area` closely enough for a recognizable result. Transparent source pixels average as the GIF's background, treated as white.
4. Run the shared core (`detectBackground`, `pickChar`, `frameToAnsi`) to get ANSI frames.
5. Preview and export both call `renderFrameRGBA` on the parsed ANSI frames; the GIF export then fits that drawing to the source size (D3).

Frame rate: average of the GIF's per-frame delays (in ms, with delays under 20 ms treated as 100 ms, as browsers do), clamped to 1–60 fps, by `frameDelay` in `site/lib/core.mjs`. Both paths read the per-frame delays from the shared block scan (`site/lib/scan.mjs`, D5): a graphic control extension sets the delay of the next frame only, and a frame with none counts as 0 ms (so 100 ms), as browsers do. The CLI downloads or reads the GIF's bytes itself, scans them, and pipes the same bytes to ffmpeg on stdin, because ffprobe carries the last graphic control extension's delay forward to frames without one. The CLI calls the same function, and extracts one frame per GIF frame (no `fps=` resample; `-fps_mode passthrough`, which needs ffmpeg 5.1 or later), so both paths produce the same frame count and the same fixed player delay.

Parity scope: the CLI decodes and resamples with ffmpeg, so CLI and site pixels can differ slightly. Parity is guaranteed from decoded-and-resampled frames onward (spec: "CLI and site parity"), which is where all the shared logic lives.

### D3. GIF export in the browser

gifenc: per frame, `quantize(rgba, 255, { format: 'rgba4444', oneBitAlpha: true })` → `applyPalette` → `writeFrame(index, w, h, { palette, delay, transparent: true, transparentIndex, dispose: 2 })`. `dispose: 2` clears each frame before the next, which prevents the trails ffmpeg's transdiff caused.

The browser GIF is exactly the source GIF's screen size, so there is no scale control. `site/lib/export.mjs` draws the grid without the one-cell margin and area-resamples it to the source width and height, cutting alpha at 50% so transparency stays 1-bit; color is averaged over opaque coverage only, so transparent pixels never darken an edge. The fit is defined as drawing at the smallest integer scale s ≥ 1 that covers the source on both axes (`exportScale`) and area-averaging down. Nearest-neighbor replication commutes with area averaging, so the code area-resamples the scale-1 drawing directly, which gives the same pixels (a unit test pins this) without a large canvas or the renderer's 1–8 scale cap (s reaches 22 for a 1024×1024 source at 8 columns). Rows are columns × h/w × 0.5 and cells are 6×12, so the grid already has the source's aspect ratio; a one-row rounding difference is stretched away by the resample. When the grid is wider than the source at 6 pixels per character, glyphs shrink into colored texture, and the page says so near the export button.

The CLI keeps `--scale 1–8` with nearest-neighbor scaling in ffmpeg, because a player file does not record the source size.

The CLI keeps ffmpeg for export; only `renderFrameRGBA` and the glyphs are shared.

### D4. Vendoring

- **gifenc 1.0.3** (MIT, no dependencies): copy `dist/gifenc.esm.js` from the npm tarball as-is.
- **gifuct-js 2.1.2** (MIT) depends on **js-binary-schema-parser 2.0.3** (MIT) and ships CommonJS. Produce one ES module by fetching the esm.sh bundle for the pinned version once, and commit it.
- Each `SOURCE.md` records: package, version, exact source URL, retrieval date, and SHA-256 of the committed file. A unit test checks those hashes so a silent edit to vendored code fails CI.
- Both license texts for gifuct-js's bundle are committed (gifuct-js and js-binary-schema-parser), and the credits section lists all three packages.

### D5. Size limits

Checked from a byte scan of the block structure (`site/lib/scan.mjs`), before `parseGIF` and before decompressing. The scan walks the header, logical screen descriptor, global color table, and every extension and image block with its sub-block chain, copying no data and keeping one small record per frame for at most 300 frames, so it costs one pass over at most 20 MB. `parseGIF` builds an object for every block, and a 19.5 MB file of 6.5 million empty comments took about 3 s and 3 GB of heap, so blocks are capped too: more than 1,264 blocks (image descriptors plus extensions) → block. A frame usually takes 2 blocks (graphic control + image); 4 per frame at 300 frames leaves room for a per-frame comment or application extension, and 64 more cover file-level extensions (loop count, XMP, ICC). Frames are checked before blocks, so an over-long animation still reports its frame count. A truncated sub-block chain, an unknown block type, or a graphic control extension that is not 4 bytes → refused as not a readable GIF; a file that ends between blocks without a trailer is accepted, as browsers do. If `parseGIF` then reads a different frame count from the scan (it stops at an extension label it does not know), the GIF is refused as not readable. From the scan: frame count over 300 → block; the logical screen wider or taller than 1024 pixels → block, with a message stating the size, the limit, and a suggestion to resize; any frame descriptor extending past the screen → block (so the screen bounds every frame, and the CLI's ffmpeg, which drops a frame wholly outside the screen, never sees a different frame count); frames × screen area over 50 megapixels → block; any frame's LZW minimum code size outside 2–8 → refused as not a readable GIF (the decompressor builds a 2^size-entry table before reading data, so one byte would otherwise set each frame's work and memory; the CLI's ffmpeg rejects sizes above 12 and uses a fixed 12-bit table). The header can declare sizes far beyond the file's byte size, so the pixel checks read only the header. Frames are then decompressed one at a time, so only one frame's decompressed pixels are alive at once. A screen more than 5 times taller than wide → block, since at 160 columns it would need over 400 rows and a canvas too tall to render; the CLI's frame sizing is unchanged. File size over 20 MB is checked before parsing; a URL download is read as a stream and stopped once it passes 20 MB whatever its `Content-Length` says, and gives up after 30 seconds. Width is capped by the control's range (160), so no separate width block is needed. A block shows a message and records `blocked_too_large`. The GIF export is bounded by these input limits, since it is the source's size and frame count: at most 1024×1024 per frame, 300 frames, and 50 megapixels in all, so it needs no export limits of its own.

### D6. Usage events

Client: `navigator.sendBeacon('/api/event', blob)` with a JSON `Blob`, falling back to `fetch(..., { keepalive: true })`. The client never reads the response.

Function `onRequest`:
1. Method must be POST, else 405.
2. `Origin` must equal `new URL(request.url).origin`, else 403. The host comes from the request, so no domain is in the repo.
3. Read at most 512 bytes (check `Content-Length`, then the actual length), else 413.
4. Parse JSON, validate against the allowlist and enums in one schema object shared with the privacy note text (the page imports the same lists from `site/lib/events.mjs`), else 400.
5. If `env.EVENTS` is missing → 503.
6. `env.EVENTS.writeDataPoint({ blobs: [event, input, width, frames], indexes: [event] })` → 204. If `writeDataPoint` throws, log the error and return 503.

The binding name `EVENTS` is the only coupling to Cloudflare and is a name, not a credential. The dataset name and binding are set in the dashboard.

### D7. Abuse resistance

In the repo: the function's checks (D6), `robots.txt` disallowing `/api/`, and `_headers` with a strict CSP (`default-src 'self'`, `connect-src` allowing any `https:` for user-pasted URLs, `img-src 'self' blob: data:`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, and `Permissions-Policy` disabling unused features. Cloudflare Web Analytics is auto-injected by Pages, so the CSP also allows `static.cloudflareinsights.com` and `cloudflareinsights.com`.

Outside the repo (private runbook): rate-limiting rule on `/api/*`, Bot Fight Mode, Web Analytics toggle, Analytics Engine binding, custom domain.

### D8. Testing

- **Unit** (`node --test tests/unit`): core sizing, background detection, character picking, ANSI color runs, glyph coverage for every ramp character, RGBA rendering (transparent vs solid, scale), player template, the event function's status codes for every rejection path and the recorded data point, vendored file hashes.
- **Integration** (`node --test tests/integration`): make a tiny GIF with ffmpeg's `lavfi` source (no network), run `gif2ascii.mjs` then `ascii2gif.mjs`, and check frame count, dimensions, and transparency with `ffprobe`. A parity test feeds identical decoded frames through the CLI path and the site path and compares player text byte for byte.
- **E2E** (`npx playwright test`, Chromium only): `tests/serve.mjs` is a zero-dependency static server for `site/` started by Playwright's `webServer`. Tests: upload a fixture GIF and see the preview play, change width and see the canvas resize, download both exports and check names and GIF frame count, upload a 301-frame fixture and see the block message. Fixtures are generated by the integration helper, not downloaded. `/api/event` returns 404 locally (no Functions runtime), which also proves events never break the page.

## Risks / Trade-offs

- **esm.sh bundle provenance.** Mitigation: pinned version, committed file, recorded hash and URL, hash test. The bundle can be regenerated and diffed.
- **Browser resampling differs from ffmpeg's.** Accepted; scoped out of the parity requirement (D2).
- **Large GIFs on slow devices.** The 300-frame and 20 MB caps bound the work, and decoding happens once per input, not per control change.
- **Pages Function free-tier exhaustion.** Rate-limit rule and same-origin check; events are optional, so exhaustion only loses counts.
- **CSP `connect-src https:`** is broad because users paste arbitrary URLs. Fetch is credential-less and read-only; acceptable.

## Open Questions

None. All decisions were settled in planning on 2026-11-10.
