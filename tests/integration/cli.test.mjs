import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WIDTH, DEFAULT_BG_THRESHOLD } from '../../site/lib/core.mjs';
import { parsePlayer } from '../../site/lib/player.mjs';
import { CELL_W, CELL_H } from '../../site/lib/glyphs.mjs';
import { MARGIN, MAX_SCALE } from '../../site/lib/render.mjs';
import { tempDir, makeGif, probeGif, firstFrameAlpha } from '../helpers/fixtures.mjs';

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

  run('ascii2gif.mjs', [player, '--scale', '2', '-o', out]);
  const info = probeGif(out);
  assert.equal(info.frames, 8);
  assert.equal(info.fps, 10);
  assert.equal(info.width, (20 + 2 * MARGIN) * CELL_W * 2);
  assert.equal(info.height, (rows + 2 * MARGIN) * CELL_H * 2);

  const alpha = firstFrameAlpha(out);
  assert.ok(alpha.includes(0), 'background should be transparent');
  assert.ok(alpha.includes(255), 'glyphs should be opaque');
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
