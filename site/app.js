// gif2ascii in the browser: everything runs client-side.
import { decodeGif, checkFileSize, readCapped, resampleArea, LimitError, NotAGifError } from './lib/decode.mjs';
import { frameSize, convertFrames } from './lib/core.mjs';
import { parseAnsiFrame, gridBounds, renderFrameRGBA } from './lib/render.mjs';
import { playerSource } from './lib/player.mjs';
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc/gifenc.esm.js';
import { privacyNote, validateEvent, widthBucket, framesBucket } from './lib/events.mjs';

const DEMO_URL = 'https://media.tenor.com/1iOUXZFLpBgAAAAM/dance-dancing.gif';

const $ =(id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
};

const ui = {
  file: $('file'),
  demo: $('demo'),
  urlForm: $('url-form'),
  url: $('url'),
  message: $('message'),
  width: $('width'),
  threshold: $('threshold'),
  keepBg: $('keep-bg'),
  scale: $('scale'),
  transparent: $('transparent'),
  bgColor: $('bg-color'),
  stage: $('stage'),
  canvas: $('preview'),
  placeholder: $('placeholder'),
  info: $('info'),
  downloadGif: $('download-gif'),
  downloadPlayer: $('download-player'),
};

function syncOutputs() {
  $('width-out').value = ui.width.value;
  $('threshold-out').value = ui.threshold.value;
  $('scale-out').value = ui.scale.value;
  ui.bgColor.disabled = ui.transparent.checked;
  ui.threshold.disabled = ui.keepBg.checked;
}

for (const el of [ui.width, ui.threshold, ui.keepBg, ui.scale, ui.transparent, ui.bgColor]) {
  el.addEventListener('input', syncOutputs);
}
syncOutputs();

// ---- Input -------------------------------------------------------------------------------

// The loaded GIF: decoded once, re-converted on every control change.
let source = null; // { name, input, width, height, frames, delayMs }

// The fetch failed before any response: the host blocks cross-origin reads, or the network failed.
class FetchBlockedError extends Error {
  constructor(options) {
    super('fetch blocked', options);
    this.name = 'FetchBlockedError';
  }
}

function showMessage(text, kind = 'info') {
  ui.message.textContent = text;
  ui.message.classList.toggle('error', kind === 'error');
}

function setBusy(busy) {
  for (const el of [ui.file, ui.demo, ui.url, ...ui.urlForm.querySelectorAll('button')]) el.disabled = busy;
}

// Download-safe base name: the source's file name without `.gif`, like the CLI.
function baseName(str) {
  const last = str.split(/[/\\]/).filter(Boolean).pop() ?? '';
  return last.replace(/\.gif$/i, '').replace(/[\x00-\x1f/\\:*?"<>|]+/g, '-').trim() || 'animation';
}

// URL path with percent-escapes decoded; malformed escapes stay as written.
function decodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch (err) {
    if (err instanceof URIError) return path;
    throw err;
  }
}

// The server did not finish sending the GIF in time.
class FetchTimeoutError extends Error {
  constructor(options) {
    super('fetch timed out', options);
    this.name = 'FetchTimeoutError';
  }
}

const FETCH_TIMEOUT_MS = 30_000;

// Fetch a GIF by URL, giving up after FETCH_TIMEOUT_MS and reading at most MAX_BYTES of the body,
// whatever Content-Length says.
async function fetchGif(url, signal) {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const both = AbortSignal.any([signal, timeout]);
  const failed = (err) => {
    if (signal.aborted) return err;
    if (timeout.aborted) return new FetchTimeoutError({ cause: err });
    return null;
  };
  let res;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: both });
  } catch (err) {
    throw failed(err) ?? new FetchBlockedError({ cause: err });
  }
  if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText} for that URL.`);
  const length = Number(res.headers.get('content-length'));
  if (length) checkFileSize(length);
  try {
    return await readCapped(res.body);
  } catch (err) {
    throw failed(err) ?? err;
  }
}

function errorMessage(err) {
  if (err instanceof LimitError) {
    return `${err.message} Nothing was converted: the limit keeps your browser tab responsive while it converts.`;
  }
  if (err instanceof NotAGifError) {
    return `That is not a readable GIF.${source ? ' The previous result is still shown.' : ''}`;
  }
  if (err instanceof FetchBlockedError) {
    return 'That host blocks downloads from other websites, so your browser cannot fetch it. Save the GIF to your device and upload it instead.';
  }
  if (err instanceof FetchTimeoutError) {
    return `That server did not send the GIF within ${FETCH_TIMEOUT_MS / 1000} seconds, so the download was stopped. Try again, or save the GIF to your device and upload it instead.`;
  }
  return `Something went wrong: ${err.message}`;
}

// Each load gets a generation number; a newer load aborts the older one, and only the newest
// load may change the result, the message, or the busy state.
let loadGen = 0;
let loadController = null;

// Read, decode, and convert one input. Errors leave the previous result in place.
async function load(getBuffer, { name, input }) {
  const gen = ++loadGen;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  setBusy(true);
  showMessage(`Loading ${name}.gif…`);
  try {
    const buffer = await getBuffer(controller.signal);
    if (gen !== loadGen) return;
    const decoded = decodeGif(buffer);
    source = { ...decoded, name, input };
    onSourceLoaded();
    sendEvent('convert', usageFields());
    showMessage(`Converted ${name}.gif: ${decoded.frames.length} frames, ${decoded.width}×${decoded.height} px.`);
  } catch (err) {
    if (gen !== loadGen) {
      console.debug(`load of ${name}.gif superseded by a newer load`, err);
      return;
    }
    const expected = [LimitError, NotAGifError, FetchBlockedError, FetchTimeoutError].some((E) => err instanceof E);
    if (!expected) console.error(err);
    showMessage(errorMessage(err), 'error');
    if (err instanceof LimitError) onBlocked(err, input);
  } finally {
    if (gen === loadGen) {
      loadController = null;
      setBusy(false);
    }
  }
}

function loadFile(file, input) {
  return load(async () => {
    checkFileSize(file.size);
    return file.arrayBuffer();
  }, { name: baseName(file.name), input });
}

function loadUrl(raw, input) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    showMessage('That is not a valid URL.', 'error');
    return;
  }
  if (url.protocol !== 'https:') {
    showMessage('Use an https:// URL.', 'error');
    return;
  }
  return load((signal) => fetchGif(url.href, signal), { name: baseName(decodePath(url.pathname)), input });
}

ui.file.addEventListener('change', () => {
  const [file] = ui.file.files;
  if (file) loadFile(file, 'file');
  ui.file.value = '';
});

ui.urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (ui.url.value.trim()) loadUrl(ui.url.value, 'url');
});

ui.demo.addEventListener('click', () => loadUrl(DEMO_URL, 'demo'));

// Drag and drop anywhere on the page.
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const [file] = e.dataTransfer?.files ?? [];
  if (file) loadFile(file, 'drop');
  else showMessage('Drop a GIF file.', 'error');
});

// ---- Conversion and preview --------------------------------------------------------------

const PREVIEW_CACHE_BYTES = 64 * 1024 * 1024;

// The current conversion: ANSI frames plus parsed grids, shared by the preview and both exports.
let result = null; // { w, h, ansi, grids, cols, rows, delayMs }
let resampled = new Map(); // width → resampled RGB frames for the current source
let previewFrames = []; // ImageData per frame, filled lazily when small enough
let frameIndex = 0;
let timer = 0;
let pending = 0;

function settings() {
  return {
    width: Number(ui.width.value),
    bgThreshold: Number(ui.threshold.value),
    keepBg: ui.keepBg.checked,
    scale: Number(ui.scale.value),
    background: ui.transparent.checked ? 'transparent' : ui.bgColor.value,
  };
}

function convert() {
  if (!source) return;
  const s = settings();
  const { w, h } = frameSize(source.width, source.height, s.width);
  if (!resampled.has(w)) resampled.set(w, source.frames.map((f) => resampleArea(f, source.width, source.height, w, h)));
  const ansi = convertFrames(resampled.get(w), w, h, { keepBg: s.keepBg, bgThreshold: s.bgThreshold });
  const grids = ansi.map(parseAnsiFrame);
  result = { w, h, ansi, grids, ...gridBounds(grids), delayMs: source.delayMs };
  previewFrames = [];
  const first = drawFrame(frameIndex % ansi.length);
  ui.canvas.style.width = `${first.width * s.scale}px`;
  ui.stage.classList.toggle('checker', s.background === 'transparent');
  const fps = (1000 / source.delayMs).toFixed(1);
  ui.info.textContent = `${ansi.length} frames · ${w}×${h} characters · ${fps} fps · export ${first.width * s.scale}×${first.height * s.scale} px`;
  play();
}

// Render one frame at scale 1; the canvas is scaled up with nearest-neighbor CSS, so it matches the export.
function drawFrame(i) {
  let img = previewFrames[i];
  if (!img) {
    const { data, width, height } = renderFrameRGBA(result.grids[i], result.cols, result.rows, { background: settings().background });
    img = new ImageData(new Uint8ClampedArray(data.buffer), width, height);
    if (data.length * result.grids.length <= PREVIEW_CACHE_BYTES) previewFrames[i] = img;
  }
  if (ui.canvas.width !== img.width || ui.canvas.height !== img.height) {
    ui.canvas.width = img.width;
    ui.canvas.height = img.height;
  }
  ui.canvas.getContext('2d').putImageData(img, 0, 0);
  return img;
}

function play() {
  clearTimeout(timer);
  const tick = () => {
    frameIndex = (frameIndex + 1) % result.grids.length;
    drawFrame(frameIndex);
    timer = setTimeout(tick, result.delayMs);
  };
  timer = setTimeout(tick, result.delayMs);
}

// Coalesce rapid control changes into one conversion per animation frame.
function scheduleConvert() {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    convert();
  });
}

for (const el of [ui.width, ui.threshold, ui.keepBg, ui.scale, ui.transparent, ui.bgColor]) {
  el.addEventListener('input', scheduleConvert);
}

function onSourceLoaded() {
  ui.placeholder.hidden = true;
  resampled = new Map();
  frameIndex = 0;
  convert();
  ui.downloadGif.disabled = false;
  ui.downloadPlayer.disabled = false;
}

// ---- Exports -----------------------------------------------------------------------------

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

// Encode the current frames with gifenc: one palette per frame, transparent index, dispose 2, looping.
async function encodeGif({ grids, cols, rows, delayMs }, { background, scale }, onProgress) {
  const enc = GIFEncoder();
  for (let i = 0; i < grids.length; i++) {
    const { data, width, height } = renderFrameRGBA(grids[i], cols, rows, { background, scale });
    const palette = quantize(data, 255, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(data, palette, 'rgba4444');
    const transparentIndex = palette.findIndex((c) => c[3] === 0);
    enc.writeFrame(index, width, height, {
      palette,
      delay: delayMs,
      repeat: 0,
      dispose: 2,
      ...(transparentIndex >= 0 ? { transparent: true, transparentIndex } : {}),
    });
    onProgress(i + 1, grids.length);
    await nextTask();
  }
  enc.finish();
  return enc.bytes();
}

ui.downloadGif.addEventListener('click', async () => {
  if (!result) return;
  const snapshot = result;
  const name = source.name;
  ui.downloadGif.disabled = true;
  try {
    const bytes = await encodeGif(snapshot, settings(), (i, n) => showMessage(`Encoding GIF… frame ${i} of ${n}`));
    download(new Blob([bytes], { type: 'image/gif' }), `${name}.gif`);
    showMessage(`Saved ${name}.gif (${snapshot.grids.length} frames).`);
    onExport('export_gif');
  } catch (err) {
    console.error(err);
    showMessage(`Could not encode the GIF: ${err.message}`, 'error');
  } finally {
    ui.downloadGif.disabled = false;
  }
});

ui.downloadPlayer.addEventListener('click', () => {
  if (!result) return;
  download(new Blob([playerSource(result.ansi, result.delayMs)], { type: 'text/javascript' }), `${source.name}.mjs`);
  showMessage(`Saved ${source.name}.mjs. Run it with: node ${source.name}.mjs`);
  onExport('export_player');
});

function onExport(event) {
  sendEvent(event, usageFields());
}

// ---- Page content ------------------------------------------------------------------------

// The privacy note comes from the same schema the event endpoint enforces.
$('privacy-note').replaceChildren(...privacyNote().map((block) => {
  if (block.p) {
    const p = document.createElement('p');
    p.textContent = block.p;
    if (block.link) {
      const a = document.createElement('a');
      a.href = block.link.href;
      a.textContent = block.link.text;
      p.append(' ', a, '.');
    }
    return p;
  }
  const ul = document.createElement('ul');
  ul.append(...block.ul.map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
  return ul;
}));

for (const button of document.querySelectorAll('button[data-copy]')) {
  button.addEventListener('click', async () => {
    const text = $(button.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch (err) {
      console.error(err);
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  });
}

// ---- Usage events ------------------------------------------------------------------------

// Fire and forget: never awaited, and a failure never reaches the visitor.
function sendEvent(event, fields) {
  const body = { event, ...fields };
  const problem = validateEvent(body);
  if (problem) {
    console.error(`usage event not sent (${problem})`, body);
    return;
  }
  const json = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.('/api/event', new Blob([json], { type: 'application/json' }))) return;
  } catch (err) {
    console.debug('sendBeacon failed, falling back to fetch', err);
  }
  fetch('/api/event', { method: 'POST', body: json, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit' })
    .catch((err) => console.debug('usage event not delivered', err));
}

function usageFields() {
  return { input: source.input, width: widthBucket(Number(ui.width.value)), frames: framesBucket(source.frames.length) };
}

function onBlocked(err, input) {
  sendEvent('blocked_too_large', err.kind === 'frames' ? { input, frames: framesBucket(err.actual) } : { input });
}
