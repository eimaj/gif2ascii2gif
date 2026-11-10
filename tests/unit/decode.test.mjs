import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIFEncoder } from '../../site/vendor/gifenc/gifenc.esm.js';
import {
  MAX_FRAMES, MAX_BYTES, LimitError, NotAGifError,
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
