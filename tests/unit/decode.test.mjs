import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIFEncoder } from '../../site/vendor/gifenc/gifenc.esm.js';
import {
  MAX_FRAMES, MAX_BYTES, MAX_PIXELS, MAX_TOTAL_PIXELS, LimitError, NotAGifError,
  decodeGif, resampleArea, frameDelay, flattenOnWhite,
} from '../../site/lib/decode.mjs';

const RED = [255, 0, 0], BLUE = [0, 0, 255], GREEN = [0, 255, 0], WHITE = [255, 255, 255];

// Write a GIF with explicit per-frame palettes, index data, disposal, and transparency.
function encode(frames) {
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

const pixel = (rgb, w, x, y) => [...rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)];

test('decodeGif: disposal 3 restores the previous frame, disposal 2 clears to transparent', () => {
  const bytes = encode([
    { w: 4, h: 4, palette: [RED, BLUE], index: Array(16).fill(0), dispose: 1 },
    { w: 2, h: 2, palette: [BLUE, RED], index: Array(4).fill(0), dispose: 3 },
    { w: 1, h: 1, palette: [GREEN, RED], index: [0], dispose: 2 },
    { w: 1, h: 1, palette: [BLUE, RED], index: [0], transparentIndex: 0, dispose: 1 },
  ]);
  const { width, height, frames } = decodeGif(bytes);
  assert.equal(width, 4);
  assert.equal(height, 4);
  assert.equal(frames.length, 4);
  // Frame 1: blue 2x2 over red.
  assert.deepEqual(pixel(frames[1], 4, 1, 1), BLUE);
  assert.deepEqual(pixel(frames[1], 4, 2, 2), RED);
  // Frame 2: disposal 3 removed the blue, green pixel drawn at the origin.
  assert.deepEqual(pixel(frames[2], 4, 0, 0), GREEN);
  assert.deepEqual(pixel(frames[2], 4, 1, 1), RED);
  // Frame 3: disposal 2 cleared the origin; a transparent pixel shows it as white.
  assert.deepEqual(pixel(frames[3], 4, 0, 0), WHITE);
  assert.deepEqual(pixel(frames[3], 4, 1, 0), RED);
});

test('decodeGif: more than 300 frames throws a frames LimitError with the actual count', () => {
  const frame = { w: 1, h: 1, palette: [RED, BLUE], index: [0] };
  const bytes = encode(Array(MAX_FRAMES + 1).fill(frame));
  assert.throws(() => decodeGif(bytes), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'frames');
    assert.equal(err.limit, 300);
    assert.equal(err.actual, 301);
    assert.match(err.message, /301 frames.*300/);
    return true;
  });
});

test('decodeGif: oversized input throws a bytes LimitError before parsing', () => {
  const big = new Uint8Array(MAX_BYTES + 1);
  assert.throws(() => decodeGif(big), (err) => err instanceof LimitError && err.kind === 'bytes' && err.actual === MAX_BYTES + 1);
});

// A tiny 1×1 GIF whose header is rewritten to declare a bigger screen or frame rectangle.
function declaring({ screen, frame }) {
  const bytes = encode([{ w: 1, h: 1, palette: [RED, BLUE], index: [0] }]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (screen) { view.setUint16(6, screen[0], true); view.setUint16(8, screen[1], true); }
  if (frame) {
    // Image descriptor: 0x2C right after the 8-byte graphic control extension (21 F9 04 …).
    const gce = bytes.findIndex((b, i) => b === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04);
    const desc = gce + 8;
    assert.equal(bytes[desc], 0x2c);
    view.setUint16(desc + 5, frame[0], true);
    view.setUint16(desc + 7, frame[1], true);
  }
  return bytes;
}

test('decodeGif: a tiny GIF declaring a huge screen throws a pixels LimitError before allocating', () => {
  const bytes = declaring({ screen: [60000, 60000] });
  assert.ok(bytes.length < 100);
  assert.throws(() => decodeGif(bytes), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'pixels');
    assert.equal(err.limit, MAX_PIXELS);
    assert.equal(err.actual, 60000 * 60000);
    assert.match(err.message, /megapixels.*limit/);
    return true;
  });
});

test('decodeGif: a frame rectangle larger than the limit throws before decompressing', () => {
  const bytes = declaring({ screen: [2, 2], frame: [30000, 30000] });
  assert.throws(() => decodeGif(bytes), (err) => err instanceof LimitError && err.kind === 'pixels' && err.actual === 30000 * 30000);
});

test('decodeGif: frames × screen size over the total budget throws a total LimitError', () => {
  const frame = { w: 1, h: 1, palette: [RED, BLUE], index: [0] };
  const bytes = encode(Array(10).fill(frame));
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(6, 4000, true);
  new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, 4000, true);
  assert.ok(4000 * 4000 <= MAX_PIXELS);
  assert.throws(() => decodeGif(bytes), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'total');
    assert.equal(err.limit, MAX_TOTAL_PIXELS);
    assert.equal(err.actual, 10 * 4000 * 4000);
    return true;
  });
});

test('decodeGif: non-GIF input throws NotAGifError', () => {
  assert.throws(() => decodeGif(new TextEncoder().encode('<html>nope</html>')), NotAGifError);
  assert.throws(() => decodeGif(new TextEncoder().encode('GIF89a')), NotAGifError);
});

test('resampleArea: 2x2 average of a 4x4 checker block', () => {
  const src = new Uint8Array(4 * 4 * 3);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) src.set((x + y) % 2 ? [0, 0, 0] : [200, 100, 50], (y * 4 + x) * 3);
  const out = resampleArea(src, 4, 4, 2, 2);
  assert.deepEqual([...out.subarray(0, 3)], [100, 50, 25]);
});

test('resampleArea: fractional coverage weights partial pixels', () => {
  const src = new Uint8Array([0, 0, 0, 90, 90, 90, 180, 180, 180]); // 3x1
  const out = resampleArea(src, 3, 1, 2, 1);
  assert.deepEqual([...out], [30, 30, 30, 150, 150, 150]);
});

test('flattenOnWhite: transparent pixels become white', () => {
  assert.deepEqual([...flattenOnWhite(new Uint8ClampedArray([10, 20, 30, 0, 10, 20, 30, 255]))], [255, 255, 255, 10, 20, 30]);
});

test('frameDelay: averages, treats tiny delays as 100 ms, clamps to 1-60 fps', () => {
  assert.equal(frameDelay([100, 100]), 100);
  assert.equal(frameDelay([0, 10]), 100);
  assert.equal(frameDelay([40, 60]), 50);
  assert.equal(frameDelay([5000]), 1000);
  assert.equal(frameDelay([]), 100);
});
