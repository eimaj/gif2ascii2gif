import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameSize, MAX_WIDTH } from '../../site/lib/core.mjs';
import { MAX_SIDE } from '../../site/lib/decode.mjs';
import { CELL_W, CELL_H } from '../../site/lib/glyphs.mjs';
import { parseAnsiFrame, renderFrameRGBA } from '../../site/lib/render.mjs';
import { exportScale, glyphsShrink, resampleRGBA, renderExportFrame } from '../../site/lib/export.mjs';

// A grid `cols` wide and `rows` tall of red '@' characters.
const gridOf = (cols, rows) => parseAnsiFrame(Array(rows).fill(`\x1b[38;2;255;0;0m${'@'.repeat(cols)}\x1b[0m`).join('\n'));

// The export for a srcW×srcH source at `width` columns: rows from the shared frame sizing.
function fit(srcW, srcH, width) {
  const { w: cols, h: rows } = frameSize(srcW, srcH, width);
  const frame = renderExportFrame(gridOf(cols, rows), cols, rows, { width: srcW, height: srcH });
  return { cols, rows, scale: exportScale(cols, rows, srcW, srcH), width: frame.width, height: frame.height, bytes: frame.data.length };
}

test('export: the 220×366 demo exports at exactly 220×366 at widths 40, 80, and 160', () => {
  assert.deepEqual(fit(220, 366, 40), { cols: 40, rows: 33, scale: 1, width: 220, height: 366, bytes: 220 * 366 * 4 });
  assert.deepEqual(fit(220, 366, 80), { cols: 80, rows: 67, scale: 1, width: 220, height: 366, bytes: 220 * 366 * 4 });
  assert.deepEqual(fit(220, 366, 160), { cols: 160, rows: 133, scale: 1, width: 220, height: 366, bytes: 220 * 366 * 4 });
});

test('export: a 1024×1024 source exports at exactly 1024×1024, with the scale that covers it', () => {
  assert.equal(MAX_SIDE, 1024);
  assert.deepEqual(fit(1024, 1024, 8), { cols: 8, rows: 4, scale: 22, width: 1024, height: 1024, bytes: 1024 * 1024 * 4 });
  assert.deepEqual(fit(1024, 1024, 40), { cols: 40, rows: 20, scale: 5, width: 1024, height: 1024, bytes: 1024 * 1024 * 4 });
  assert.deepEqual(fit(1024, 1024, MAX_WIDTH), { cols: 160, rows: 80, scale: 2, width: 1024, height: 1024, bytes: 1024 * 1024 * 4 });
});

test('exportScale: smallest integer scale covering both axes, never below 1', () => {
  assert.equal(exportScale(10, 5, 60, 60), 1); // exactly 60×60
  assert.equal(exportScale(10, 5, 61, 60), 2); // one pixel too narrow at scale 1
  assert.equal(exportScale(10, 5, 60, 61), 2); // one pixel too short at scale 1
  assert.equal(exportScale(160, 133, 220, 366), 1); // grid larger than the source
  for (const [cols, rows, w, h] of [[8, 4, 1024, 1024], [40, 33, 220, 366], [13, 41, 100, 640]]) {
    const s = exportScale(cols, rows, w, h);
    assert.ok(cols * CELL_W * s >= w && rows * CELL_H * s >= h, `scale ${s} covers ${w}×${h}`);
    assert.ok(s === 1 || cols * CELL_W * (s - 1) < w || rows * CELL_H * (s - 1) < h, `scale ${s - 1} does not`);
  }
});

test('glyphsShrink: true only when the grid is wider than the source at 6 pixels per character', () => {
  assert.equal(glyphsShrink(36, 220), false); // 216 px
  assert.equal(glyphsShrink(37, 222), false); // exactly 222 px
  assert.equal(glyphsShrink(37, 220), true); // 222 px
  assert.equal(glyphsShrink(160, 220), true);
});

test('renderExportFrame equals drawing at exportScale and area-averaging down', () => {
  const grid = parseAnsiFrame('\x1b[38;2;10;200;30m@#\x1b[0m\n\x1b[38;2;250;250;0m.:\x1b[0m');
  for (const background of ['transparent', '336699']) {
    const [w, h] = [31, 47];
    const s = exportScale(2, 2, w, h);
    assert.equal(s, 3); // 31 / 12 rounds up to 3; 47 / 24 to 2
    const big = renderFrameRGBA(grid, 2, 2, { background, scale: s, margin: 0 });
    const viaScale = resampleRGBA(big.data, big.width, big.height, w, h);
    const direct = renderExportFrame(grid, 2, 2, { background, width: w, height: h }).data;
    assert.equal(direct.length, viaScale.length);
    for (let i = 0; i < direct.length; i++) assert.ok(Math.abs(direct[i] - viaScale[i]) <= 1, `byte ${i}: ${direct[i]} vs ${viaScale[i]}`);
  }
});

test('resampleRGBA: alpha is 1-bit at 50% coverage, and transparent pixels do not darken color', () => {
  // 4×1: two opaque red pixels then two transparent ones.
  const src = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...resampleRGBA(src, 4, 1, 1, 1)], [255, 0, 0, 255]); // exactly 50%: opaque
  assert.deepEqual([...resampleRGBA(src, 4, 1, 2, 1)], [255, 0, 0, 255, 0, 0, 0, 0]);
  // 3 → 1 with one opaque pixel: 33% coverage, transparent.
  assert.deepEqual([...resampleRGBA(src.subarray(4), 3, 1, 1, 1)], [0, 0, 0, 0]);
  const three = resampleRGBA(src, 4, 1, 3, 1);
  for (let i = 3; i < three.length; i += 4) assert.ok([0, 255].includes(three[i]), `alpha ${three[i]}`);
});

test('renderFrameRGBA: margin 0 drops the empty border cells', () => {
  const grid = gridOf(3, 2);
  const plain = renderFrameRGBA(grid, 3, 2, { margin: 0 });
  assert.equal(plain.width, 3 * CELL_W);
  assert.equal(plain.height, 2 * CELL_H);
  assert.throws(() => renderFrameRGBA(grid, 3, 2, { margin: -1 }), /margin/);
});
