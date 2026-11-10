// CLI and site parity: from the same decoded-and-resampled frames, both paths write the same player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameSize, convertFrames } from '../../site/lib/core.mjs';
import { decodeGif, LimitError } from '../../site/lib/decode.mjs';
import { playerSource, parsePlayer } from '../../site/lib/player.mjs';
import { tempDir, makeGif, probeGif } from '../helpers/fixtures.mjs';
import { RED, BLUE, encode, imageDescriptorOffsets } from '../helpers/gifs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The frames the CLI hands to the shared core, decoded by ffmpeg exactly as gif2ascii.mjs does.
function ffmpegFrames(gif, w, h) {
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', gif, '-vf', `scale=${w}:${h}:flags=area`, '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 1 << 28 });
  const size = w * h * 3;
  const frames = [];
  for (let off = 0; off < raw.length; off += size) frames.push(new Uint8Array(raw.subarray(off, off + size)));
  return frames;
}

// Writes the CLI player and the site player for one GIF and option set, asserts they are identical,
// and returns the parsed player.
function assertParity(gif, args, opts) {
  const cliOut = join(dirname(gif), 'cli.mjs');
  execFileSync('node', [join(ROOT, 'gif2ascii.mjs'), gif, ...args, '-o', cliOut]);
  const cliText = readFileSync(cliOut, 'utf8');

  // Site path: the browser's settings → convertFrames → playerSource, with the browser's frame delay.
  const src = probeGif(gif);
  const { w, h } = frameSize(src.width, src.height, opts.width ?? 40);
  const frames = ffmpegFrames(gif, w, h);
  const decoded = decodeGif(readFileSync(gif));
  assert.equal(frames.length, decoded.frames.length, 'ffmpeg and the site decode the same number of frames');
  const ansi = convertFrames(frames, w, h, { keepBg: opts.keepBg ?? false, bgThreshold: opts.bgThreshold ?? 40 });
  const siteText = playerSource(ansi, decoded.delayMs);

  assert.equal(siteText, cliText);
  return parsePlayer(cliText);
}

const CASES = [
  { label: 'defaults', args: [], opts: {} },
  { label: 'width 24, threshold 70', args: ['--width', '24', '--bg-threshold', '70'], opts: { width: 24, bgThreshold: 70 } },
  { label: 'keep background', args: ['--keep-bg'], opts: { keepBg: true } },
];

for (const { label, args, opts } of CASES) {
  test(`parity: CLI and site write byte-identical players (${label})`, () => {
    const gif = makeGif(join(tempDir(), 'parity.gif'), { frames: 6, fps: 10, width: 64, height: 48 });
    assertParity(gif, args, opts);
  });
}

// Rates whose GIF delays are uneven (15, 24, 30 fps), slow (7 fps), or below the 1 fps floor (0.5 fps).
// GIF delays are whole centiseconds, so the averaged delay lands within a few ms of the nominal rate.
const RATES = [
  { fps: 7, frames: 6, nominalMs: 143 },
  { fps: 15, frames: 12, nominalMs: 67 },
  { fps: 24, frames: 12, nominalMs: 42 },
  { fps: 30, frames: 12, nominalMs: 33 },
  { fps: 0.5, frames: 3, nominalMs: 1000 }, // clamped to 1 fps
];

for (const { fps, frames, nominalMs } of RATES) {
  test(`parity: CLI and site agree on frame count and delay at ${fps} fps`, () => {
    const gif = makeGif(join(tempDir(), 'rate.gif'), { frames, fps, width: 64, height: 48 });
    const player = assertParity(gif, [], {});
    assert.equal(player.frames.length, frames);
    assert.ok(Math.abs(player.delayMs - nominalMs) <= 5, `delay ${player.delayMs} ms, expected about ${nominalMs}`);
  });
}

test('parity: a GIF with a frame wholly outside its screen is refused by both the CLI and the site', () => {
  const full = { w: 16, h: 16, palette: [RED, BLUE], index: Array.from({ length: 256 }, (_, i) => i % 2) };
  const bytes = encode([full, { w: 8, h: 8, palette: [BLUE, RED], index: Array(64).fill(0) }, full]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const second = imageDescriptorOffsets(bytes)[1];
  view.setUint16(second + 1, 40, true);
  view.setUint16(second + 3, 40, true);
  const gif = join(tempDir(), 'offscreen.gif');
  writeFileSync(gif, bytes);

  assert.throws(() => decodeGif(bytes), (err) => err instanceof LimitError && err.kind === 'bounds');
  assert.throws(
    () => execFileSync('node', [join(ROOT, 'gif2ascii.mjs'), gif, '-o', join(dirname(gif), 'cli.mjs')], { stdio: 'pipe' }),
    (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /decoded 2 of the GIF's 3 frames.*outside the GIF's screen/);
      return true;
    },
  );
});
