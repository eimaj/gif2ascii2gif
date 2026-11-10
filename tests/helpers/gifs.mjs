// GIFs built in memory with gifenc, and header rewrites that declare sizes the data does not have.
import { GIFEncoder } from '../../site/vendor/gifenc/gifenc.esm.js';

export const RED = [255, 0, 0], BLUE = [0, 0, 255], GREEN = [0, 255, 0], WHITE = [255, 255, 255];

// Write a GIF with explicit per-frame palettes, index data, delay (ms), disposal, and transparency.
export function encode(frames) {
  const enc = GIFEncoder();
  for (const f of frames) {
    enc.writeFrame(new Uint8Array(f.index), f.w, f.h, {
      palette: f.palette, delay: f.delay ?? 100, dispose: f.dispose ?? 1,
      ...(f.transparentIndex != null ? { transparent: true, transparentIndex: f.transparentIndex } : {}),
    });
  }
  enc.finish();
  return enc.bytes();
}

// Byte offset of every image descriptor (0x2C), found by walking the GIF's blocks.
export function imageDescriptorOffsets(bytes) {
  const tableSize = (flags) => (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  const skipSubBlocks = (p) => { while (bytes[p]) p += bytes[p] + 1; return p + 1; };
  const out = [];
  let p = 13 + tableSize(bytes[10]);
  while (p < bytes.length && bytes[p] !== 0x3b) {
    if (bytes[p] === 0x21) {
      p = skipSubBlocks(p + 2);
    } else if (bytes[p] === 0x2c) {
      out.push(p);
      p = skipSubBlocks(p + 10 + tableSize(bytes[p + 9]) + 1); // + 1 skips the LZW minimum code size
    } else {
      throw new Error(`unexpected GIF block 0x${bytes[p].toString(16)} at byte ${p}`);
    }
  }
  return out;
}

// `count` 1×1 frames whose header is rewritten to declare `screen` [w, h], and for every frame a
// rectangle `frame` [w, h] at `at` [left, top], optionally interlaced. Nothing else in the file grows.
export function declaring({ screen, frame, at, interlaced = false, count = 1 }) {
  const bytes = encode(Array(count).fill({ w: 1, h: 1, palette: [RED, BLUE], index: [0] }));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (screen) { view.setUint16(6, screen[0], true); view.setUint16(8, screen[1], true); }
  for (const d of imageDescriptorOffsets(bytes)) {
    if (at) { view.setUint16(d + 1, at[0], true); view.setUint16(d + 3, at[1], true); }
    if (frame) { view.setUint16(d + 5, frame[0], true); view.setUint16(d + 7, frame[1], true); }
    if (interlaced) bytes[d + 9] |= 0x40;
  }
  return bytes;
}
