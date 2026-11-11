import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanGif, MalformedGifError } from '../../site/lib/scan.mjs';
import { RED, BLUE, encode, declaring, withExtensions, withoutGce } from '../helpers/gifs.mjs';

const frame = { w: 1, h: 1, palette: [RED, BLUE], index: [0] };

test('scanGif: screen, frame rectangles, code sizes, and block counts', () => {
  const bytes = declaring({ screen: [16, 8], frame: [4, 2], at: [3, 5], codeSize: 2, count: 3 });
  const scan = scanGif(bytes);
  assert.equal(scan.width, 16);
  assert.equal(scan.height, 8);
  assert.equal(scan.frameCount, 3);
  // gifenc writes a loop-count application extension, then a graphic control extension per frame.
  assert.equal(scan.blockCount, 1 + 3 * 2);
  assert.deepEqual(scan.frames, Array(3).fill({ left: 3, top: 5, width: 4, height: 2, codeSize: 2, delayMs: 100 }));
});

test('scanGif: a graphic control extension sets only the next frame\'s delay; a frame with none gets 0', () => {
  const bytes = withoutGce(encode([250, 500, 70, 40].map((delay) => ({ ...frame, delay }))), [1, 3]);
  assert.deepEqual(scanGif(bytes).frames.map((f) => f.delayMs), [250, 0, 70, 0]);
});

test('scanGif: counts every frame but records only the first maxFrames', () => {
  const scan = scanGif(encode(Array(5).fill(frame)), { maxFrames: 2 });
  assert.equal(scan.frameCount, 5);
  assert.equal(scan.frames.length, 2);
});

test('scanGif: counts comment extensions as blocks', () => {
  const bytes = encode([frame]);
  assert.equal(scanGif(withExtensions(bytes, 1000)).blockCount, scanGif(bytes).blockCount + 1000);
});

test('scanGif: a file that ends between blocks without a trailer is accepted', () => {
  const bytes = encode([frame, frame]);
  assert.equal(bytes.at(-1), 0x3b);
  assert.equal(scanGif(bytes.subarray(0, -1)).frameCount, 2);
});

const malformed = (bytes, pattern) => assert.throws(() => scanGif(bytes), (err) => {
  assert.ok(err instanceof MalformedGifError);
  assert.match(err.message, pattern);
  return true;
});

test('scanGif: refuses a missing header, a truncated sub-block chain, and an unknown block', () => {
  malformed(new TextEncoder().encode('<html>nope</html>'), /missing GIF header/);
  malformed(new TextEncoder().encode('GIF89a'), /truncated logical screen descriptor/);
  const bytes = encode([frame]);
  malformed(bytes.subarray(0, -3), /truncated sub-block chain/);
  const unterminated = new Uint8Array([...bytes.subarray(0, -1), 0x21, 0xfe, 0x02, 1, 2]); // no 0 terminator
  malformed(unterminated, /truncated sub-block chain/);
  const junk = bytes.slice();
  junk[junk.length - 1] = 0x00; // the trailer replaced by a byte that starts no block
  malformed(junk, /unknown block 0x00 at byte/);
});

test('scanGif: refuses a graphic control extension that is not 4 bytes', () => {
  malformed(withExtensions(encode([frame]), 1, [0x21, 0xf9, 0x03, 0, 0, 0, 0x00]), /graphic control extension of 3 bytes/);
});
