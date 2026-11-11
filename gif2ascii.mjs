#!/usr/bin/env node
// Convert a GIF (URL) into a standalone, colored-ASCII terminal player script.
// Usage: node gif2ascii.mjs <gif-url> [--width 40] [--bg-threshold 40] [--keep-bg] [-o out.mjs]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WIDTH, DEFAULT_BG_THRESHOLD, MAX_BG_DISTANCE, frameSize, frameDelay, convertFrames,
} from './site/lib/core.mjs';
import { playerSource } from './site/lib/player.mjs';
import { scanGif, MalformedGifError } from './site/lib/scan.mjs';
import { checkCodeSizes, NotAGifError } from './site/lib/decode.mjs';

const PLAYERS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'players');

const USAGE = `usage: node gif2ascii.mjs <gif-url> [--width ${DEFAULT_WIDTH}] [--bg-threshold ${DEFAULT_BG_THRESHOLD}] [--keep-bg] [-o out.mjs]`;

function parseArgs(argv) {
  const opts = { width: DEFAULT_WIDTH, out: null, input: null, keepBg: false, bgThreshold: DEFAULT_BG_THRESHOLD };
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

// The GIF's bytes, downloaded for an http(s) URL and read from disk otherwise.
async function readInput(input) {
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${input}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(readFileSync(input));
}

// Dimensions, frame count, the player delay, and where the GIF ends, from the shared block scan the
// site also uses, so a frame without a graphic control extension counts as 0 ms in both (ffprobe would
// carry the last one forward). The site's LZW code-size check runs too, since ffmpeg drops such frames.
function probe(bytes) {
  let scan;
  try {
    scan = scanGif(bytes);
    checkCodeSizes(scan);
  } catch (err) {
    if (err instanceof MalformedGifError) throw new Error(`not a readable GIF (${err.message})`, { cause: err });
    if (err instanceof NotAGifError) throw new Error(`not a readable GIF (${err.detail})`, { cause: err });
    throw err;
  }
  if (scan.frameCount === 0) throw new Error('not a readable GIF (no frames)');
  if (!scan.width || !scan.height) throw new Error('not a readable GIF (zero size)');
  return {
    width: scan.width, height: scan.height, frameCount: scan.frameCount, end: scan.end,
    delayMs: frameDelay(scan.frames.map((f) => f.delayMs)),
  };
}

// One RGB frame per GIF frame (no frame-rate resampling), scaled with area averaging. `bytes` are the
// scanned GIF only (up to its trailer), so ffmpeg, which would go on to decode a second GIF appended
// to the file, decodes exactly what was scanned. They go through a temporary file rather than stdin,
// so ffmpeg reads at its own pace and an early ffmpeg failure reports its own error, not a broken pipe.
function extractFrames(bytes, w, h) {
  const dir = mkdtempSync(join(tmpdir(), 'gif2ascii-'));
  let raw;
  try {
    const gif = join(dir, 'input.gif');
    writeFileSync(gif, bytes);
    raw = execFileSync('ffmpeg', [
      '-v', 'error', '-nostdin', '-f', 'gif', '-i', gif,
      '-vf', `scale=${w}:${h}:flags=area`, '-fps_mode', 'passthrough',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ], { maxBuffer: 1 << 30 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const size = w * h * 3;
  if (raw.length === 0 || raw.length % size !== 0) {
    throw new Error(`unexpected ffmpeg output: ${raw.length} bytes is not a multiple of frame size ${size}`);
  }
  const frames = [];
  for (let off = 0; off < raw.length; off += size) frames.push(raw.subarray(off, off + size));
  return frames;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const bytes = await readInput(opts.input);
  const src = probe(bytes);
  const { w, h } = frameSize(src.width, src.height, opts.width);
  const raw = extractFrames(bytes.subarray(0, src.end), w, h);
  // ffmpeg drops a frame it cannot draw, such as one wholly outside the GIF's screen or one with corrupt
  // image data; the site refuses such GIFs, so do the same.
  if (raw.length !== src.frameCount) {
    throw new Error(`ffmpeg decoded ${raw.length} of the GIF's ${src.frameCount} frames; a frame outside the GIF's screen or with corrupt image data is not supported`);
  }
  const frames = convertFrames(raw, w, h, { keepBg: opts.keepBg, bgThreshold: opts.bgThreshold });
  const name = basename(new URL(opts.input, 'file:///').pathname).replace(/\.gif$/i, '') || 'animation';
  const out = opts.out ?? join(PLAYERS_DIR, `${name}.mjs`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, playerSource(frames, src.delayMs), { mode: 0o755 });
  console.log(`wrote ${out}: ${frames.length} frames, ${w}x${h}, ${(1000 / src.delayMs).toFixed(2)} fps`);
}

try {
  await main();
} catch (err) {
  console.error(`gif2ascii: ${err.message}`);
  process.exit(1);
}
