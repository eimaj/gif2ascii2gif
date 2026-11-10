import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FRAMES, MAX_BYTES, MAX_SIDE, MAX_TOTAL_PIXELS, MAX_ASPECT, LimitError, NotAGifError,
  decodeGif, checkPixels, readCapped, resampleArea, flattenOnWhite, compositeFrames,
} from '../../site/lib/decode.mjs';
import { readFileSync } from 'node:fs';
import { frameDelay, frameSize, MAX_WIDTH, CHAR_ASPECT } from '../../site/lib/core.mjs';
import { RED, BLUE, GREEN, WHITE, encode, declaring, codeSizeOffset } from '../helpers/gifs.mjs';

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

test('decodeGif: a tiny GIF declaring a huge screen throws a pixels LimitError before allocating', () => {
  const bytes = declaring({ screen: [60000, 60000] });
  assert.ok(bytes.length < 100);
  assert.throws(() => decodeGif(bytes), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'pixels');
    assert.equal(err.limit, MAX_SIDE);
    assert.deepEqual(err.actual, { width: 60000, height: 60000 });
    assert.equal(err.message, 'This GIF is 60000×60000 pixels; the limit is 4096×4096.');
    return true;
  });
});

test('decodeGif: a screen over 4096 on one side throws pixels even when its area is small', () => {
  assert.throws(() => decodeGif(declaring({ screen: [65535, 200] })), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'pixels');
    assert.deepEqual(err.actual, { width: 65535, height: 200 });
    return true;
  });
});

test('decodeGif: a frame rectangle larger than its screen throws a bounds LimitError', () => {
  const bytes = declaring({ screen: [2, 2], frame: [30000, 30000] });
  assert.throws(() => decodeGif(bytes), (err) => err instanceof LimitError && err.kind === 'bounds' && err.actual.width === 30000);
});

test('decodeGif: a tiny GIF whose interlaced frames overhang the screen is refused before allocating', () => {
  const bytes = declaring({ screen: [4082, 4082], frame: [4096, 4069], at: [0, 0], interlaced: true, count: 3 });
  assert.ok(bytes.length < 200);
  const before = process.memoryUsage().arrayBuffers;
  assert.throws(() => decodeGif(bytes), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'bounds');
    assert.deepEqual(err.limit, { width: 4082, height: 4082 });
    assert.deepEqual(err.actual, { left: 0, top: 0, width: 4096, height: 4069 });
    assert.equal(err.message, 'A 4096×4069 frame of this GIF at 0,0 extends past its 4082×4082 screen; every frame must fit inside the screen.');
    return true;
  });
  // One decompressed frame would be a 66 MB RGBA patch.
  assert.ok(process.memoryUsage().arrayBuffers - before < 1 << 20);
});

test('decodeGif: a frame wholly outside the screen is refused', () => {
  const bytes = declaring({ screen: [16, 16], frame: [8, 8], at: [40, 40] });
  assert.throws(() => decodeGif(bytes), (err) => err instanceof LimitError && err.kind === 'bounds' && err.actual.left === 40);
});

test('decodeGif: a tiny GIF declaring LZW code size 27 is refused before decompressing', () => {
  const bytes = declaring({ codeSize: 27, count: 10 });
  assert.ok(bytes.length < 400);
  const before = process.memoryUsage().arrayBuffers;
  const started = performance.now();
  assert.throws(() => decodeGif(bytes), (err) => {
    assert.ok(err instanceof NotAGifError);
    assert.equal(err.message, 'Not a readable GIF (LZW minimum code size 27 is outside 2–8).');
    return true;
  });
  // Decompressing one such frame takes about 1.6 s and 3 GB.
  assert.ok(performance.now() - started < 200);
  assert.ok(process.memoryUsage().arrayBuffers - before < 1 << 20);
});

test('decodeGif: LZW code sizes 2 and 8 decode, 1 and 9 are refused', () => {
  for (const codeSize of [1, 9]) {
    assert.throws(() => decodeGif(declaring({ codeSize })), (err) => err instanceof NotAGifError && err.message.includes(`size ${codeSize} is`));
  }
  assert.equal(decodeGif(declaring({ codeSize: 2 })).frames.length, 1);
  // A 256-color palette makes gifenc write code size 8.
  const palette = Array.from({ length: 256 }, (_, i) => [i, i, i]);
  const bytes = encode([{ w: 2, h: 1, palette, index: [0, 255] }]);
  assert.equal(bytes[codeSizeOffset(bytes)], 8);
  const { frames } = decodeGif(bytes);
  assert.deepEqual(pixel(frames[0], 2, 1, 0), [255, 255, 255]);
});

test('decodeGif: frame rectangles that fit the screen are counted by frames × screen size', () => {
  // Four full-screen 4000×4000 frames: each frame's own pixels are inside the screen budget.
  const bytes = declaring({ screen: [4000, 4000], frame: [4000, 4000], count: 4 });
  assert.throws(() => decodeGif(bytes), (err) => err instanceof LimitError && err.kind === 'total' && err.actual === 4 * 4000 * 4000);
});

test('decodeGif: frames × screen size over the total budget throws a total LimitError', () => {
  const bytes = declaring({ screen: [4000, 4000], count: 10 });
  assert.throws(() => decodeGif(bytes), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'total');
    assert.equal(err.limit, MAX_TOTAL_PIXELS);
    assert.equal(err.actual, 10 * 4000 * 4000);
    assert.equal(err.message, 'This GIF has 160,000,000 pixels across all its frames (frames × width × height); the limit is 50,000,000.');
    return true;
  });
});

// A parsed-GIF stand-in for checkPixels: a screen and `count` frames covering it.
const header = (width, height, count = 1) => ({
  lsd: { width, height },
  frames: Array(count).fill({ image: { descriptor: { left: 0, top: 0, width, height } } }),
});
const kindOf = (gif) => {
  try { checkPixels(gif); return null; } catch (err) { if (err instanceof LimitError) return err.kind; throw err; }
};

test('limits are the documented numbers', () => {
  assert.equal(MAX_SIDE, 4096);
  assert.equal(MAX_TOTAL_PIXELS, 50_000_000);
  assert.equal(MAX_ASPECT, 5);
});

test('checkPixels: exact boundaries', () => {
  assert.equal(kindOf(header(4096, 4096)), null);
  assert.equal(kindOf(header(4097, 4096)), 'pixels');
  assert.equal(kindOf(header(4096, 4097)), 'pixels');
  assert.equal(kindOf(header(2500, 2000, 10)), null); // exactly 50,000,000
  assert.equal(kindOf(header(2500, 2000, 11)), 'total');
  const overhang = header(100, 100);
  overhang.frames = [{ image: { descriptor: { left: 1, top: 0, width: 100, height: 100 } } }];
  assert.equal(kindOf(overhang), 'bounds');
});

test('LimitError: a value just over a limit never reads as equal to it', () => {
  assert.match(new LimitError('total', MAX_TOTAL_PIXELS, 50_000_001).message, /50,000,001 pixels.*limit is 50,000,000/);
  assert.match(new LimitError('aspect', MAX_ASPECT, 501 / 100).message, /5\.1 times taller.*limit is 5\./);
  assert.match(new LimitError('aspect', MAX_ASPECT, 5.1).message, /5\.1 times taller/);
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

test('compositeFrames: returns RGB frames, not full RGBA copies', () => {
  const patch = { dims: { top: 0, left: 0, width: 2, height: 1 }, patch: new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0]), disposalType: 1 };
  const [frame] = compositeFrames([patch], 2, 1);
  assert.ok(frame instanceof Uint8Array);
  assert.deepEqual([...frame], [1, 2, 3, 255, 255, 255]);
});

test('decodeGif: a source more than 5 times taller than wide throws an aspect LimitError', () => {
  const bytes = declaring({ screen: [10, 2000] });
  assert.throws(() => decodeGif(bytes), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'aspect');
    assert.equal(err.limit, MAX_ASPECT);
    assert.equal(err.actual, 200);
    assert.match(err.message, /200\.0 times taller.*limit is 5/);
    return true;
  });
});

test('readCapped: stops a stream with no length once it passes the limit', async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); }, // endless, like a server that never stops
    cancel() { cancelled = true; },
  });
  await assert.rejects(readCapped(body, 10 * 1024), (err) => {
    assert.ok(err instanceof LimitError);
    assert.equal(err.kind, 'download');
    assert.equal(err.limit, 10 * 1024);
    assert.equal(err.actual, 11 * 1024);
    assert.match(err.message, /stopped after 11 KB.*limit is 10 KB/);
    return true;
  });
  assert.ok(cancelled);
  assert.ok(pulled <= 12);
});

test('readCapped: returns the whole body when it fits', async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); } });
  assert.deepEqual([...new Uint8Array(await readCapped(body, 3))], [1, 2, 3]);
});

test('decodeGif: at the aspect limit the widest preview stays within 400 rows', () => {
  const { frames, width, height } = decodeGif(declaring({ screen: [2, 10] }));
  assert.equal(frames.length, 1);
  assert.equal(frameSize(width, height, MAX_WIDTH).h, 400);
  assert.ok(MAX_ASPECT * MAX_WIDTH * CHAR_ASPECT <= 400);
});

test('the page width control stops at MAX_WIDTH, which the aspect limit relies on', () => {
  const html = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
  const input = html.match(/<input id="width"[^>]*>/)?.[0];
  assert.ok(input, 'width input found');
  assert.equal(Number(input.match(/\bmax="(\d+)"/)?.[1]), MAX_WIDTH);
});
