import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAMP, frameSize, detectBackground, pickChar, frameToAnsi, convertFrames } from '../../site/lib/core.mjs';

const ESC = /\x1b\[38;2;\d+;\d+;\d+m/g;

function solidFrame(w, h, [r, g, b]) {
  const buf = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) buf.set([r, g, b], p * 3);
  return buf;
}

test('frameSize: 220x366 at width 40 gives 40x33', () => {
  assert.deepEqual(frameSize(220, 366, 40), { w: 40, h: 33 });
});

test('frameSize: never fewer than one row', () => {
  assert.deepEqual(frameSize(1000, 1, 8), { w: 8, h: 1 });
});

test('detectBackground: white border with dark centre detects near-white', () => {
  const w = 10, h = 10;
  const frames = [0, 1].map(() => {
    const buf = solidFrame(w, h, [252, 250, 255]);
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) buf.set([20, 20, 30], (y * w + x) * 3);
    return buf;
  });
  const bg = detectBackground(frames, w, h);
  for (const c of [bg.r, bg.g, bg.b]) assert.ok(255 - c <= 8, `channel ${c} not within 8 of white`);
});

test('pickChar: below threshold is a space', () => {
  const bg = { r: 255, g: 255, b: 255 };
  assert.equal(pickChar(250, 250, 250, bg, 40), ' ');
});

test('pickChar: distance 180 or more is @', () => {
  const bg = { r: 0, g: 0, b: 0 };
  assert.equal(pickChar(180, 0, 0, bg, 40), '@');
  assert.equal(pickChar(255, 255, 255, bg, 40), '@');
});

test('pickChar: just over threshold is the lightest non-space character', () => {
  const bg = { r: 0, g: 0, b: 0 };
  assert.equal(pickChar(41, 0, 0, bg, 40), RAMP[1]);
});

test('pickChar: keep-bg uses luminance, white is @ and black is space', () => {
  assert.equal(pickChar(255, 255, 255, null, 40), '@');
  assert.equal(pickChar(0, 0, 0, null, 40), ' ');
});

test('frameToAnsi: one escape per same-color run, reset at line end, none for spaces', () => {
  const w = 4, h = 1;
  const buf = new Uint8Array([200, 0, 0, 200, 0, 0, 200, 0, 0, 255, 255, 255]);
  const line = frameToAnsi(buf, w, h, { r: 255, g: 255, b: 255 }, 40);
  assert.equal(line.match(ESC).length, 1);
  assert.ok(line.startsWith('\x1b[38;2;200;0;0m'));
  assert.ok(line.endsWith(' \x1b[0m'));
});

test('frameToAnsi: new escape when color changes', () => {
  const buf = new Uint8Array([200, 0, 0, 0, 0, 200]);
  const line = frameToAnsi(buf, 2, 1, { r: 255, g: 255, b: 255 }, 40);
  assert.equal(line.match(ESC).length, 2);
});

test('frameToAnsi: one line per row joined by newlines', () => {
  const out = frameToAnsi(solidFrame(3, 2, [0, 0, 0]), 3, 2, null, 40);
  assert.equal(out.split('\n').length, 2);
});

test('convertFrames: keepBg skips background detection', () => {
  const frames = [solidFrame(2, 2, [255, 255, 255])];
  assert.match(convertFrames(frames, 2, 2, { keepBg: true })[0], /@@/);
  assert.doesNotMatch(convertFrames(frames, 2, 2)[0], /@/);
});
