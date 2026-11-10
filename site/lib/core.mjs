// Shared conversion core: frame sizing, background detection, character picking, ANSI frames.
// Standard JS only (typed arrays, no Buffer, no node: imports) so the CLI and the browser share it.
// Frames are packed RGB (3 bytes per pixel), row-major, `w × h` pixels.

export const RAMP = ' .:-=+*#%@';
export const CHAR_ASPECT = 0.5; // terminal cells are ~2x taller than wide
export const MAX_BG_DISTANCE = 180; // RGB distance from the background that maps to the densest character
export const DEFAULT_WIDTH = 40;
export const MAX_WIDTH = 160; // the site's width control maximum (site/index.html); MAX_ASPECT relies on it
export const DEFAULT_BG_THRESHOLD = 40;
export const MIN_FPS = 1;
export const MAX_FPS = 60;
export const MIN_GIF_DELAY_MS = 20; // shorter GIF delays are treated as DEFAULT_GIF_DELAY_MS, as browsers do
export const DEFAULT_GIF_DELAY_MS = 100;

// The player's one fixed delay, from the GIF's own per-frame delays in ms: their average
// (delays under MIN_GIF_DELAY_MS count as DEFAULT_GIF_DELAY_MS), clamped to MIN_FPS–MAX_FPS.
// The CLI (delays from ffprobe) and the site (delays from gifuct-js) both use this rule.
export function frameDelay(delays) {
  if (!delays.length) return DEFAULT_GIF_DELAY_MS;
  // The comparison also catches missing (null, NaN) delays.
  const fixed = delays.map((d) => (d >= MIN_GIF_DELAY_MS ? d : DEFAULT_GIF_DELAY_MS));
  const avg = fixed.reduce((a, b) => a + b, 0) / fixed.length;
  const fps = Math.min(MAX_FPS, Math.max(MIN_FPS, 1000 / avg));
  return Math.round(1000 / fps);
}

// Rows for a frame `width` columns wide, corrected for tall terminal cells.
export function frameSize(srcWidth, srcHeight, width) {
  return { w: width, h: Math.max(1, Math.round(width * (srcHeight / srcWidth) * CHAR_ASPECT)) };
}

// Background = the most common color along the border of every frame. Border pixels are grouped
// into 32-level-per-channel buckets so near-identical dithered shades count together; the result
// is the mean color of the largest bucket.
export function detectBackground(frames, w, h) {
  const buckets = new Map();
  const add = (buf, x, y) => {
    const i = (y * w + x) * 3;
    const key = ((buf[i] >> 3) << 10) | ((buf[i + 1] >> 3) << 5) | (buf[i + 2] >> 3);
    const s = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    s.n++; s.r += buf[i]; s.g += buf[i + 1]; s.b += buf[i + 2];
    buckets.set(key, s);
  };
  for (const buf of frames) {
    for (let x = 0; x < w; x++) { add(buf, x, 0); add(buf, x, h - 1); }
    for (let y = 1; y < h - 1; y++) { add(buf, 0, y); add(buf, w - 1, y); }
  }
  let best = null;
  for (const s of buckets.values()) if (!best || s.n > best.n) best = s;
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
}

export function pickChar(r, g, b, bg, threshold) {
  if (!bg) {
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
  }
  const d = Math.hypot(r - bg.r, g - bg.g, b - bg.b);
  if (d < threshold) return ' ';
  const t = Math.min(1, (d - threshold) / (MAX_BG_DISTANCE - threshold));
  return RAMP[1 + Math.min(RAMP.length - 2, Math.floor(t * (RAMP.length - 1)))];
}

export function frameToAnsi(buf, w, h, bg, threshold) {
  const lines = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    let lastColor = '';
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const ch = pickChar(r, g, b, bg, threshold);
      const color = `\x1b[38;2;${r};${g};${b}m`;
      if (ch !== ' ' && color !== lastColor) { line += color; lastColor = color; }
      line += ch;
    }
    lines.push(line + '\x1b[0m');
  }
  return lines.join('\n');
}

// Full pipeline from resampled RGB frames to ANSI frames.
export function convertFrames(frames, w, h, { keepBg = false, bgThreshold = DEFAULT_BG_THRESHOLD } = {}) {
  const bg = keepBg ? null : detectBackground(frames, w, h);
  return frames.map((f) => frameToAnsi(f, w, h, bg, bgThreshold));
}
