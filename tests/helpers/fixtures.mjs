// Test fixtures generated locally with ffmpeg's lavfi sources (no network).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const created = [];
process.on('exit', () => { for (const d of created) rmSync(d, { recursive: true, force: true }); });

// A fresh temp directory, removed when the process exits.
export function tempDir(prefix = 'gif2ascii-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

// A white-background GIF with a red square sliding right, `frames` frames at `fps`.
export function makeGif(path, { frames = 8, fps = 10, width = 80, height = 60 } = {}) {
  const d = (frames / fps).toFixed(3);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=white:s=${width}x${height}:r=${fps}:d=${d}`,
    '-f', 'lavfi', '-i', `color=c=red:s=${Math.round(width / 4)}x${Math.round(height / 3)}:r=${fps}:d=${d}`,
    '-filter_complex', `[0][1]overlay=x='mod(t*${width},${width})':y=${Math.round(height / 3)}`,
    '-frames:v', String(frames), '-loop', '0', path,
  ]);
  return path;
}

export function probeGif(path) {
  const json = execFileSync('ffprobe', [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate',
    '-of', 'json', path,
  ], { encoding: 'utf8' });
  const s = JSON.parse(json).streams[0];
  const [num, den] = s.r_frame_rate.split('/').map(Number);
  return { width: s.width, height: s.height, frames: Number(s.nb_read_frames), fps: num / den };
}

// Alpha values of the first frame, decoded by ffmpeg.
export function firstFrameAlpha(path) {
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
  ], { maxBuffer: 1 << 28 });
  const alpha = new Uint8Array(raw.length / 4);
  for (let i = 0; i < alpha.length; i++) alpha[i] = raw[i * 4 + 3];
  return alpha;
}
