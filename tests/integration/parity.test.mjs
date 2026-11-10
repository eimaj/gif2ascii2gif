// CLI and site parity: from the same decoded-and-resampled frames, both paths write the same player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameSize, convertFrames } from '../../site/lib/core.mjs';
import { decodeGif } from '../../site/lib/decode.mjs';
import { playerSource } from '../../site/lib/player.mjs';
import { tempDir, makeGif, probeGif } from '../helpers/fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The frames the CLI hands to the shared core, decoded by ffmpeg exactly as gif2ascii.mjs does.
function ffmpegFrames(gif, w, h, fps) {
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', gif, '-vf', `fps=${fps},scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 1 << 28 });
  const size = w * h * 3;
  const frames = [];
  for (let off = 0; off < raw.length; off += size) frames.push(new Uint8Array(raw.subarray(off, off + size)));
  return frames;
}

const CASES = [
  { label: 'defaults', args: [], opts: {} },
  { label: 'width 24, threshold 70', args: ['--width', '24', '--bg-threshold', '70'], opts: { width: 24, bgThreshold: 70 } },
  { label: 'keep background', args: ['--keep-bg'], opts: { keepBg: true } },
];

for (const { label, args, opts } of CASES) {
  test(`parity: CLI and site write byte-identical players (${label})`, () => {
    const dir = tempDir();
    const gif = makeGif(join(dir, 'parity.gif'), { frames: 6, fps: 10, width: 64, height: 48 });
    const cliOut = join(dir, 'cli.mjs');
    execFileSync('node', [join(ROOT, 'gif2ascii.mjs'), gif, ...args, '-o', cliOut]);
    const cliText = readFileSync(cliOut, 'utf8');

    // Site path: the browser's settings → convertFrames → playerSource, with the browser's frame delay.
    const src = probeGif(gif);
    const { w, h } = frameSize(src.width, src.height, opts.width ?? 40);
    const frames = ffmpegFrames(gif, w, h, src.fps);
    const { delayMs } = decodeGif(readFileSync(gif));
    const ansi = convertFrames(frames, w, h, { keepBg: opts.keepBg ?? false, bgThreshold: opts.bgThreshold ?? 40 });
    const siteText = playerSource(ansi, delayMs);

    assert.equal(siteText, cliText);
  });
}
