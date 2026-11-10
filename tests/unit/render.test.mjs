import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RAMP } from '../../site/lib/core.mjs';
import { CELL_W, CELL_H, GLYPHS } from '../../site/lib/glyphs.mjs';
import { MARGIN, parseAnsiFrame, parseBackground, renderFrameRGBA, renderFrames } from '../../site/lib/render.mjs';
import { playerSource, parsePlayer } from '../../site/lib/player.mjs';

test('glyphs: every ramp character has a 6x12 glyph', () => {
  for (const ch of RAMP) {
    assert.ok(ch in GLYPHS, `missing glyph for ${JSON.stringify(ch)}`);
    for (const [row, bits] of Object.entries(GLYPHS[ch])) {
      assert.ok(Number(row) >= 0 && Number(row) < CELL_H);
      assert.equal(bits.length, CELL_W);
    }
  }
});

test('parseAnsiFrame: reads characters with their colors', () => {
  const grid = parseAnsiFrame('\x1b[38;2;10;20;30m@@ \x1b[0m\n.\x1b[0m');
  assert.equal(grid.length, 2);
  assert.deepEqual(grid[0].map((c) => c.ch), ['@', '@', ' ']);
  assert.deepEqual(grid[0][1].rgb, [10, 20, 30]);
  assert.deepEqual(grid[1][0].rgb, [255, 255, 255]);
});

test('parseAnsiFrame: unknown character errors naming it', () => {
  assert.throws(() => parseAnsiFrame('@X'), /no glyph for character "X"/);
});

test('renderFrameRGBA: transparent background, glyph pixels opaque', () => {
  const grid = parseAnsiFrame('\x1b[38;2;200;100;50m@\x1b[0m');
  const { data, width, height } = renderFrameRGBA(grid, 1, 1);
  assert.equal(width, (1 + 2 * MARGIN) * CELL_W);
  assert.equal(height, (1 + 2 * MARGIN) * CELL_H);
  let lit = 0;
  for (let p = 0; p < width * height; p++) {
    const a = data[p * 4 + 3];
    assert.ok(a === 0 || a === 255, `partial alpha ${a}`);
    if (a === 255) {
      lit++;
      assert.deepEqual([...data.subarray(p * 4, p * 4 + 3)], [200, 100, 50]);
    }
  }
  const expected = Object.values(GLYPHS['@']).join('').split('').filter((b) => b === '#').length;
  assert.equal(lit, expected);
});

test('renderFrameRGBA: solid hex background is fully opaque', () => {
  const { data } = renderFrameRGBA(parseAnsiFrame(' '), 1, 1, { background: '#102030' });
  for (let p = 0; p < data.length; p += 4) assert.deepEqual([...data.subarray(p, p + 4)], [16, 32, 48, 255]);
});

test('renderFrameRGBA: scale multiplies dimensions and lit pixels', () => {
  const grid = parseAnsiFrame('@');
  const one = renderFrameRGBA(grid, 1, 1, { scale: 1 });
  const three = renderFrameRGBA(grid, 1, 1, { scale: 3 });
  assert.equal(three.width, one.width * 3);
  assert.equal(three.height, one.height * 3);
  const count = (d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; };
  assert.equal(count(three.data), count(one.data) * 9);
});

test('renderFrameRGBA: rejects out-of-range scale and bad background', () => {
  assert.throws(() => renderFrameRGBA([], 1, 1, { scale: 9 }), /scale/);
  assert.throws(() => parseBackground('red'), /hex color/);
});

test('renderFrames: all frames share the widest size', () => {
  const out = renderFrames(['@', '@@\n@']);
  assert.equal(out[0].width, out[1].width);
  assert.equal(out[0].height, out[1].height);
});

test('playerSource: contains FRAMES and DELAY_MS and parses back', () => {
  const frames = ['\x1b[38;2;1;2;3m@\x1b[0m', ' \x1b[0m'];
  const src = playerSource(frames, 100);
  assert.match(src, /^const FRAMES = /m);
  assert.match(src, /^const DELAY_MS = 100;$/m);
  assert.deepEqual(parsePlayer(src), { frames, delayMs: 100 });
});
