import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_BYTES, MAX_FRAMES, MAX_SIDE, MAX_TOTAL_PIXELS, decodeGif } from '../../site/lib/decode.mjs';
import { scanGif, maxSubBlocks } from '../../site/lib/scan.mjs';
import { tempDir } from '../helpers/fixtures.mjs';

test('a real encoder\'s GIF near the size and pixel limits passes the scan with room to spare and decodes', () => {
  // ffmpeg, 1024×576, 79 frames of noise: about 20 MB and 47 megapixels.
  const path = join(tempDir(), 'large.gif');
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1024x576:r=10,noise=alls=30:allf=t+u',
    '-frames:v', '79', '-loop', '0', path,
  ]);
  const bytes = new Uint8Array(readFileSync(path));
  assert.ok(bytes.length > 0.75 * MAX_BYTES && bytes.length <= MAX_BYTES, `${bytes.length} bytes`);
  assert.ok(79 * 1024 * 576 <= MAX_TOTAL_PIXELS && 1024 <= MAX_SIDE && 79 <= MAX_FRAMES);

  const scan = scanGif(bytes);
  assert.ok(scan.subBlockCount * 3 < maxSubBlocks(bytes.length, scan.blockCount), `${scan.subBlockCount} sub-blocks`);
  const { width, height, frames } = decodeGif(bytes);
  assert.deepEqual([width, height, frames.length], [1024, 576, 79]);
});
