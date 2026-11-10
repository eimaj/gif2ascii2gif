// gif2ascii in the browser: everything runs client-side.
import { decodeGif, checkFileSize, LimitError, NotAGifError } from './lib/decode.mjs';

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

async function fetchGif(url) {
  let res;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (err) {
    throw new FetchBlockedError({ cause: err });
  }
  if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText} for that URL.`);
  const length = Number(res.headers.get('content-length'));
  if (length) checkFileSize(length);
  return res.arrayBuffer();
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
  return `Something went wrong: ${err.message}`;
}

// Read, decode, and convert one input. Errors leave the previous result in place.
async function load(getBuffer, { name, input }) {
  setBusy(true);
  showMessage(`Loading ${name}.gif…`);
  try {
    const decoded = decodeGif(await getBuffer());
    source = { ...decoded, name, input };
    onSourceLoaded();
    showMessage(`Converted ${name}.gif: ${decoded.frames.length} frames, ${decoded.width}×${decoded.height} px.`);
  } catch (err) {
    if (!(err instanceof LimitError || err instanceof NotAGifError || err instanceof FetchBlockedError)) console.error(err);
    showMessage(errorMessage(err), 'error');
    if (err instanceof LimitError) onBlocked(err, input);
  } finally {
    setBusy(false);
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
  return load(() => fetchGif(url.href), { name: baseName(decodePath(url.pathname)), input });
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

function onSourceLoaded() {
  ui.placeholder.hidden = true;
  ui.info.textContent = `${source.frames.length} frames · ${source.width}×${source.height} px`;
}

function onBlocked() {}
