// Browser-side GIF decoding: size limits, disposal-aware compositing, area resampling, frame rate.
// Standard JS only, so it also runs under Node for tests.
import { parseGIF, decompressFrames } from '../vendor/gifuct-js/gifuct.bundle.mjs';
import { frameDelay } from './core.mjs';

export const MAX_FRAMES = 300;
export const MAX_BYTES = 20 * 1024 * 1024;
export const MAX_SIDE = 4096; // pixels per side: the GIF's screen, and each frame's own rectangle
export const MAX_TOTAL_PIXELS = 50_000_000; // across all frames, so decoded frames fit in a tab's memory
// Height ÷ width. At the widest setting (160 columns) this caps the preview at 400 rows.
export const MAX_ASPECT = 5;

const count = (n) => n.toLocaleString('en-US');
const LIMIT_MESSAGES = {
  frames: (actual, limit) => `This GIF has ${actual} frames; the limit is ${limit}.`,
  bytes: (actual, limit) => `This file is ${formatBytes(actual)}; the limit is ${formatBytes(limit)}.`,
  download: (actual, limit) => `The download was stopped after ${formatBytes(actual)}; the limit is ${formatBytes(limit)}.`,
  pixels: (actual, limit) => `This GIF is ${actual.width}×${actual.height} pixels; the limit is ${limit}×${limit}.`,
  total: (actual, limit) => `This GIF has ${count(actual)} pixels across all its frames (frames × width × height); the limit is ${count(limit)}.`,
  // Rounded up, so a GIF just over the limit never reads as equal to it.
  aspect: (actual, limit) => `This GIF is ${(Math.ceil(actual * 10 - 1e-9) / 10).toFixed(1)} times taller than it is wide; the limit is ${limit}.`,
};

// Thrown when a GIF would take too much work to convert in a browser tab.
export class LimitError extends Error {
  constructor(kind, limit, actual) {
    super(LIMIT_MESSAGES[kind](actual, limit));
    this.name = 'LimitError';
    // 'frames' | 'bytes' | 'download' | 'total' | 'aspect': numbers.
    // 'pixels': limit is MAX_SIDE, actual the oversized screen or frame { width, height }.
    this.kind = kind;
    this.limit = limit;
    this.actual = actual;
  }
}

// Thrown when the input cannot be decoded as a GIF.
export class NotAGifError extends Error {
  constructor(detail, options) {
    super(`Not a readable GIF${detail ? ` (${detail})` : ''}.`, options);
    this.name = 'NotAGifError';
  }
}

export function formatBytes(n) {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function checkFileSize(bytes) {
  if (bytes > MAX_BYTES) throw new LimitError('bytes', MAX_BYTES, bytes);
}

// Read a response body stream into an ArrayBuffer, stopping with a download LimitError once it
// passes `limit` bytes, so a body with no (or a false) Content-Length cannot exhaust memory.
export async function readCapped(body, limit = MAX_BYTES) {
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new LimitError('download', limit, total);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out.buffer;
}

// The GIF header can declare sizes far beyond its byte size; check them before any pixel buffer exists.
export function checkPixels(gif) {
  const { width, height } = gif.lsd;
  const tooBig = (w, h) => w > MAX_SIDE || h > MAX_SIDE;
  if (tooBig(width, height)) throw new LimitError('pixels', MAX_SIDE, { width, height });
  let frameCount = 0;
  let patchTotal = 0;
  for (const f of gif.frames) {
    if (!f.image) continue;
    frameCount++;
    const { width: fw, height: fh } = f.image.descriptor;
    if (tooBig(fw, fh)) throw new LimitError('pixels', MAX_SIDE, { width: fw, height: fh });
    patchTotal += fw * fh;
  }
  const total = Math.max(frameCount * width * height, patchTotal);
  if (total > MAX_TOTAL_PIXELS) throw new LimitError('total', MAX_TOTAL_PIXELS, total);
}

// Parse and check limits, then composite every frame to full size, flattened to RGB on white.
export function decodeGif(buffer) {
  const bytes = new Uint8Array(buffer);
  checkFileSize(bytes.length);
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new NotAGifError('missing GIF header');
  let gif;
  try {
    gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  } catch (err) {
    throw new NotAGifError(err.message, { cause: err });
  }
  const frameCount = gif.frames.filter((f) => f.image).length;
  if (frameCount > MAX_FRAMES) throw new LimitError('frames', MAX_FRAMES, frameCount);
  if (frameCount === 0) throw new NotAGifError('no frames');
  const { width, height } = gif.lsd;
  if (!width || !height) throw new NotAGifError('zero size');
  checkPixels(gif);
  if (height / width > MAX_ASPECT) throw new LimitError('aspect', MAX_ASPECT, height / width);
  let patches;
  try {
    patches = decompressFrames(gif, true);
  } catch (err) {
    throw new NotAGifError(err.message, { cause: err });
  }
  return {
    width,
    height,
    frames: compositeFrames(patches, width, height),
    delayMs: frameDelay(patches.map((p) => p.delay)),
  };
}

// Draw each patch onto a full-size RGBA canvas, honoring disposal:
// 0/1 keep, 2 clear the patch area to transparent, 3 restore the canvas from before the patch.
// Each frame is flattened to RGB on white as it is drawn, so only one RGBA canvas is ever alive.
export function compositeFrames(patches, width, height) {
  const canvas = new Uint8ClampedArray(width * height * 4);
  const out = [];
  for (const p of patches) {
    const { top, left, width: pw, height: ph } = p.dims;
    const before = p.disposalType === 3 ? canvas.slice() : null;
    for (let y = 0; y < ph; y++) {
      const cy = top + y;
      if (cy < 0 || cy >= height) continue;
      for (let x = 0; x < pw; x++) {
        const cx = left + x;
        if (cx < 0 || cx >= width) continue;
        const s = (y * pw + x) * 4;
        if (p.patch[s + 3] === 0) continue; // transparent pixel: keep what's underneath
        const d = (cy * width + cx) * 4;
        canvas[d] = p.patch[s]; canvas[d + 1] = p.patch[s + 1]; canvas[d + 2] = p.patch[s + 2]; canvas[d + 3] = 255;
      }
    }
    out.push(flattenOnWhite(canvas));
    if (p.disposalType === 2) {
      for (let y = Math.max(0, top); y < Math.min(height, top + ph); y++) {
        canvas.fill(0, (y * width + Math.max(0, left)) * 4, (y * width + Math.min(width, left + pw)) * 4);
      }
    } else if (before) {
      canvas.set(before);
    }
  }
  return out;
}

// RGBA → packed RGB, transparent pixels as white (the GIF's background).
export function flattenOnWhite(rgba) {
  const n = rgba.length / 4;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + 255 * (1 - a));
  }
  return rgb;
}

// Per-axis area weights: for each output index, the source indices it covers and their overlap.
function axisWeights(src, dst) {
  const scale = src / dst;
  const out = [];
  for (let o = 0; o < dst; o++) {
    const start = o * scale;
    const end = start + scale;
    const taps = [];
    for (let s = Math.floor(start); s < Math.min(src, Math.ceil(end)); s++) {
      const w = Math.min(end, s + 1) - Math.max(start, s);
      if (w > 0) taps.push([s, w]);
    }
    out.push(taps);
  }
  return out;
}

// Area-average (box filter) resample of packed RGB from srcW×srcH to w×h.
export function resampleArea(rgb, srcW, srcH, w, h) {
  const xs = axisWeights(srcW, w);
  const ys = axisWeights(srcH, h);
  const out = new Uint8Array(w * h * 3);
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      let r = 0, g = 0, b = 0, total = 0;
      for (const [sy, wy] of ys[oy]) {
        for (const [sx, wx] of xs[ox]) {
          const wgt = wx * wy;
          const i = (sy * srcW + sx) * 3;
          r += rgb[i] * wgt; g += rgb[i + 1] * wgt; b += rgb[i + 2] * wgt;
          total += wgt;
        }
      }
      const o = (oy * w + ox) * 3;
      out[o] = Math.round(r / total); out[o + 1] = Math.round(g / total); out[o + 2] = Math.round(b / total);
    }
  }
  return out;
}
