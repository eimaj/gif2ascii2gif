import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanGif, maxSubBlocks, MalformedGifError } from '../../site/lib/scan.mjs';
import {
  RED, BLUE, COMMENT, NETSCAPE, ICC, encode, declaring, beforeImage, withExtensions, withoutGce, withSubBlockFlood,
} from '../helpers/gifs.mjs';

const frame = { w: 1, h: 1, palette: [RED, BLUE], index: [0] };

test('scanGif: screen, frame rectangles, code sizes, and block counts', () => {
  const bytes = declaring({ screen: [16, 8], frame: [4, 2], at: [3, 5], codeSize: 2, count: 3 });
  const scan = scanGif(bytes);
  assert.equal(scan.width, 16);
  assert.equal(scan.height, 8);
  assert.equal(scan.frameCount, 3);
  // gifenc writes a loop-count application extension, then a graphic control extension per frame.
  assert.equal(scan.blockCount, 1 + 3 * 2);
  assert.deepEqual(scan.frames, Array(3).fill({ left: 3, top: 5, width: 4, height: 2, codeSize: 2, delayMs: 100, disposal: 1, transparentIndex: null }));
});

test('scanGif: a frame takes disposal and transparency from its graphic control extension, whatever lies between', () => {
  const bytes = encode([{ ...frame, dispose: 2 }, { ...frame, transparentIndex: 1 }, frame]);
  const spaced = beforeImage(withoutGce(bytes, [2]), 1, COMMENT, COMMENT, NETSCAPE, ICC);
  assert.deepEqual(scanGif(spaced).frames.map(({ disposal, transparentIndex }) => [disposal, transparentIndex]), [[2, null], [1, 1], [0, null]]);
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
  assert.equal(scanGif(bytes.subarray(0, -1)).end, bytes.length - 1);
});

test('scanGif: stops at the trailer and reports the offset just past it', () => {
  const bytes = encode([frame, frame]);
  const scan = scanGif(new Uint8Array([...bytes, ...bytes]));
  assert.equal(scan.frameCount, 2);
  assert.equal(scan.end, bytes.length);
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

test('scanGif: counts data sub-blocks, not the zero-size terminators', () => {
  // Loop-count extension (2: id + data), graphic control (1), and the frame's LZW data (1).
  assert.equal(scanGif(encode([frame])).subBlockCount, 4);
  assert.equal(scanGif(withSubBlockFlood('comment', 10)).subBlockCount, 4 + 10);
});

test('scanGif: refuses a file with more data sub-blocks than maxSubBlocks, and accepts one at it', () => {
  assert.equal(maxSubBlocks(20 * 1024 * 1024, 1264), 4096 + 2 * 1264 + 327_680);
  // The largest one-byte comment flood within the limit: each sub-block adds 2 bytes.
  const empty = withSubBlockFlood('comment', 0);
  const { subBlockCount, blockCount } = scanGif(empty);
  let n = 0;
  while (subBlockCount + n + 1 <= maxSubBlocks(empty.length + 2 * (n + 1), blockCount)) n++;
  assert.equal(scanGif(withSubBlockFlood('comment', n)).subBlockCount, subBlockCount + n);
  malformed(withSubBlockFlood('comment', n + 1), /data sub-blocks in [\d,]+ bytes; the limit is [\d,]+$/);
});
