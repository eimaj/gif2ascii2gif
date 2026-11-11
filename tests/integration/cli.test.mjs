import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WIDTH, DEFAULT_BG_THRESHOLD } from '../../site/lib/core.mjs';
import { parsePlayer, playerSource } from '../../site/lib/player.mjs';
import { MAX_SCALE, parseAnsiFrame, renderFrameRGBA } from '../../site/lib/render.mjs';
import { tempDir, makeGif, probeGif, firstFrameAlpha, firstFrameRGBA } from '../helpers/fixtures.mjs';
import { RED, BLUE, encode, declaring, withSubBlockFlood } from '../helpers/gifs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (script, args) => execFileSync('node', [join(ROOT, script), ...args], { encoding: 'utf8' });
const visible = (line) => line.replace(/\x1b\[[0-9;]*m/g, '');

test('CLI round trip: GIF → player → transparent GIF', () => {
  const dir = tempDir();
  const gif = makeGif(join(dir, 'fixture.gif'), { frames: 8, fps: 10, width: 80, height: 60 });
  const player = join(dir, 'fixture.mjs');
  const out = join(dir, 'fixture-out.gif');

  run('gif2ascii.mjs', [gif, '--width', '20', '-o', player]);
  const { frames, delayMs } = parsePlayer(readFileSync(player, 'utf8'));
  assert.equal(frames.length, 8);
  assert.equal(delayMs, 100);
  const rows = 8; // round(20 * 60/80 * 0.5)
  for (const f of frames) {
    const lines = f.split('\n');
    assert.equal(lines.length, rows);
    for (const l of lines) assert.equal(visible(l).length, 20);
  }
  assert.ok(frames.some((f) => /@/.test(f)), 'the red square should render as dense characters');

  run('ascii2gif.mjs', [player, '-o', out]); // default scale 2
  const info = probeGif(out);
  assert.equal(info.frames, 8);
  assert.equal(info.fps, 10);
  // Literals, not the imported constants: one 6×12 cell of margin per side, scale 2.
  assert.equal(info.width, (20 + 2) * 6 * 2);
  assert.equal(info.height, (rows + 2) * 12 * 2);

  const alpha = firstFrameAlpha(out);
  assert.ok(alpha.includes(0), 'background should be transparent');
  assert.ok(alpha.includes(255), 'glyphs should be opaque');
});

test('CLI pixel export: --scale 3 makes each glyph pixel a 3×3 block inside a one-cell margin', () => {
  const dir = tempDir();
  const player = join(dir, 'glyphs.mjs');
  // One row: a red '@' and a green '#', on black.
  const frame = '\x1b[38;2;255;0;0m@\x1b[38;2;0;255;0m#\x1b[0m';
  writeFileSync(player, playerSource([frame], 100));
  const out = join(dir, 'glyphs.gif');
  run('ascii2gif.mjs', [player, '--scale', '3', '--bg', '000000', '-o', out]);

  const cols = 2, rows = 1, scale = 3;
  const info = probeGif(out);
  assert.equal(info.width, (cols + 2) * 6 * scale);
  assert.equal(info.height, (rows + 2) * 12 * scale);

  // The glyphs at scale 1 with no margin: what each 3×3 block inside the margin must show.
  const glyphs = renderFrameRGBA(parseAnsiFrame(frame), cols, rows, { background: '000000', scale: 1, margin: 0 });
  const rgba = firstFrameRGBA(out);
  let glyphPixels = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const gx = Math.floor(x / scale) - 6, gy = Math.floor(y / scale) - 12; // minus one 6×12 cell of margin
      const inside = gx >= 0 && gx < glyphs.width && gy >= 0 && gy < glyphs.height;
      const want = inside ? [...glyphs.data.subarray((gy * glyphs.width + gx) * 4, (gy * glyphs.width + gx) * 4 + 4)] : [0, 0, 0, 255];
      const got = [...rgba.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
      assert.deepEqual(got, want, `pixel ${x},${y}`);
      if (inside && want[0] + want[1] > 0) glyphPixels++;
    }
  }
  assert.ok(glyphPixels > 0 && glyphPixels % (scale * scale) === 0, 'glyph pixels come in whole 3×3 blocks');
});

test('CLI: solid --bg gives a fully opaque GIF', () => {
  const dir = tempDir();
  const gif = makeGif(join(dir, 'solid.gif'), { frames: 3 });
  const player = join(dir, 'solid.mjs');
  const out = join(dir, 'solid-out.gif');
  run('gif2ascii.mjs', [gif, '-o', player]);
  run('ascii2gif.mjs', [player, '--bg', '000000', '--scale', '1', '-o', out]);
  assert.ok(firstFrameAlpha(out).every((a) => a === 255));
});

test('CLI: a sub-block flood is refused by the shared scan before ffmpeg runs', () => {
  const gif = join(tempDir(), 'flood.gif');
  writeFileSync(gif, withSubBlockFlood('comment', 100_000));
  const r = spawnSync('node', [join(ROOT, 'gif2ascii.mjs'), gif, '-o', join(dirname(gif), 'flood.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^gif2ascii: not a readable GIF \(100,004 data sub-blocks in 200,\d{3} bytes; the limit is 7,\d{3}\)$/m);
});

const gif2ascii = (gif) => spawnSync('node', [join(ROOT, 'gif2ascii.mjs'), gif, '-o', join(dirname(gif), 'out.mjs')], { encoding: 'utf8' });

test('CLI: bytes after the trailer, such as a second GIF appended to the file, are not converted', () => {
  const dir = tempDir();
  const one = encode([{ w: 2, h: 2, palette: [RED, BLUE], index: [0, 0, 0, 0] }, { w: 2, h: 2, palette: [BLUE, RED], index: [0, 0, 0, 0] }]);
  const gif = join(dir, 'concat.gif');
  writeFileSync(gif, new Uint8Array([...one, ...one]));
  const r = gif2ascii(gif);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(parsePlayer(readFileSync(join(dir, 'out.mjs'), 'utf8')).frames.length, 2);
});

test('CLI: an LZW minimum code size above 8 is refused by the shared check, not blamed on the screen', () => {
  const gif = join(tempDir(), 'codesize.gif');
  writeFileSync(gif, declaring({ codeSize: 9 }));
  const r = gif2ascii(gif);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^gif2ascii: not a readable GIF \(LZW minimum code size 9 is outside 2–8\)$/m);
});

test('CLI: option checks use the shared limits and background parser', () => {
  const fail = (args) => {
    const r = spawnSync('node', [join(ROOT, 'ascii2gif.mjs'), 'x.mjs', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    return r.stderr;
  };
  assert.match(fail(['--scale', String(MAX_SCALE + 1)]), new RegExp(`--scale must be an integer 1-${MAX_SCALE}`));
  assert.match(fail(['--bg', 'red']), /--bg: background must be "transparent" or a 6-digit hex color, got red/);
  const usage = spawnSync('node', [join(ROOT, 'gif2ascii.mjs')], { encoding: 'utf8' }).stderr;
  assert.match(usage, new RegExp(`--width ${DEFAULT_WIDTH}\\] \\[--bg-threshold ${DEFAULT_BG_THRESHOLD}\\]`));
});
