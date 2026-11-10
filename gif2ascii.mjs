#!/usr/bin/env node
// Convert a GIF (URL) into a standalone, colored-ASCII terminal player script.
// Usage: node gif2ascii.mjs <gif-url> [--width 40] [--bg-threshold 40] [--keep-bg] [-o out.mjs]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BG_DISTANCE, frameSize, frameDelay, convertFrames } from './site/lib/core.mjs';
import { playerSource } from './site/lib/player.mjs';

const PLAYERS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'players');

const USAGE = 'usage: node gif2ascii.mjs <gif-url> [--width 40] [--bg-threshold 40] [--keep-bg] [-o out.mjs]';

function parseArgs(argv) {
  const opts = { width: 40, out: null, input: null, keepBg: false, bgThreshold: 40 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--bg-threshold') opts.bgThreshold = Number(argv[++i]);
    else if (a === '--keep-bg') opts.keepBg = true;
    else if (a === '-o') opts.out = argv[++i];
    else if (a.startsWith('-')) throw new Error(`unknown flag: ${a}`);
    else opts.input = a;
  }
  if (!opts.input) throw new Error(USAGE);
  if (!Number.isInteger(opts.width) || opts.width < 8) throw new Error(`--width must be an integer >= 8, got ${opts.width}`);
  if (!(opts.bgThreshold >= 0 && opts.bgThreshold < MAX_BG_DISTANCE)) {
    throw new Error(`--bg-threshold must be between 0 and ${MAX_BG_DISTANCE - 1}, got ${opts.bgThreshold}`);
  }
  return opts;
}

// Dimensions and the player delay, from the GIF's own per-frame delays (same rule as the site).
function probe(input) {
  const json = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,time_base:packet=duration',
    '-of', 'json', input,
  ], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const { streams, packets = [] } = JSON.parse(json);
  const s = streams?.[0];
  if (!s) throw new Error(`no video stream found in ${input}`);
  const [num, den] = s.time_base.split('/').map(Number);
  const delays = packets.map((p) => (Number(p.duration) * num * 1000) / den);
  return { width: s.width, height: s.height, delayMs: frameDelay(delays) };
}

// One RGB frame per GIF frame (no frame-rate resampling), scaled with area averaging.
function extractFrames(input, w, h) {
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', input,
    '-vf', `scale=${w}:${h}:flags=area`, '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 1 << 30 });
  const size = w * h * 3;
  if (raw.length === 0 || raw.length % size !== 0) {
    throw new Error(`unexpected ffmpeg output: ${raw.length} bytes is not a multiple of frame size ${size}`);
  }
  const frames = [];
  for (let off = 0; off < raw.length; off += size) frames.push(raw.subarray(off, off + size));
  return frames;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const src = probe(opts.input);
  const { w, h } = frameSize(src.width, src.height, opts.width);
  const raw = extractFrames(opts.input, w, h);
  const frames = convertFrames(raw, w, h, { keepBg: opts.keepBg, bgThreshold: opts.bgThreshold });
  const name = basename(new URL(opts.input, 'file:///').pathname).replace(/\.gif$/i, '') || 'animation';
  const out = opts.out ?? join(PLAYERS_DIR, `${name}.mjs`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, playerSource(frames, src.delayMs), { mode: 0o755 });
  console.log(`wrote ${out}: ${frames.length} frames, ${w}x${h}, ${(1000 / src.delayMs).toFixed(2)} fps`);
}

try {
  main();
} catch (err) {
  console.error(`gif2ascii: ${err.message}`);
  process.exit(1);
}
