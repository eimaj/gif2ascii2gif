# In the browser

`site/` is a static site that does both directions client-side: load a GIF by file, drag-and-drop, URL, or the demo button, adjust every option with live controls, watch the preview, and download the transparent GIF or the standalone player. Nothing is uploaded. GIFs over 300 frames, 1,264 blocks (frames plus extensions such as comments), 20 MB, 1024 pixels on a side, or 50 megapixels in all (frames × width × height), with a frame that extends past the GIF's screen, or more than 5 times taller than wide are refused so the tab stays responsive.

The site exports the GIF at exactly the source GIF's width and height, while the CLI's `ascii2gif.mjs` uses `--scale`, because a player file does not record the source size.

Run it locally with no build step, from the repo root:

```bash
npm run serve
# serving .../site at http://127.0.0.1:4173
```

The local server applies `site/_headers` (the same security headers the host serves). There is no Functions runtime locally, so `/api/event` returns 404, which the page ignores.

`functions/api/event.js` is a Cloudflare Pages Function that counts anonymous usage events (`convert`, `export_gif`, `export_player`, `blocked_too_large`) with only coarse, enumerated fields. Its only Cloudflare coupling is the Analytics Engine binding name `EVENTS`; all deploy configuration lives outside this repo.
