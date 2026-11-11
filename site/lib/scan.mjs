// A GIF block-structure scanner: walks the header, the logical screen descriptor, the global color
// table, and every extension and image block with its sub-block chain, without copying any data.
// It allocates only one small record per frame, for at most `maxFrames` frames, so a file of millions
// of tiny blocks costs one pass over its bytes. Standard JS only: the site and the CLI both use it.

// Thrown when the bytes are not a structurally valid GIF.
export class MalformedGifError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MalformedGifError';
  }
}

const EXTENSION = 0x21, IMAGE = 0x2c, TRAILER = 0x3b, GCE = 0xf9;

// Bytes in the color table that a packed-fields byte declares (0 when it has none).
const colorTableSize = (flags) => (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);

// Data sub-blocks (not counting the zero-size terminators) a file may hold. Encoders write 255-byte
// sub-blocks except the last of each chain, so a real GIF has about one per 256 bytes plus one or two
// per block (a 20 MB ffmpeg GIF: 81,260). The decoder builds an object per sub-block, and a file of
// one-byte sub-blocks would hold 10 million of them, so a file averaging under 64 bytes per sub-block
// is refused; 2 per block and a floor of 4,096 cover short chains and XMP packets, whose text the
// format reads as sub-blocks of any size.
export const maxSubBlocks = (byteLength, blockCount) => 4096 + 2 * blockCount + Math.floor(byteLength / 64);

// Offset just past the sub-block chain starting at `p` (each sub-block is a size byte and that many
// bytes; a zero size ends the chain), and the number of data sub-blocks in it.
function skipSubBlocks(bytes, p) {
  for (let n = 0; ; n++) {
    if (p >= bytes.length) throw new MalformedGifError('truncated sub-block chain');
    const size = bytes[p];
    p += size + 1;
    if (size === 0) return [p, n];
  }
}

// Returns the screen size, the number of frames (image descriptors), of blocks (extensions plus
// image descriptors), and of data sub-blocks (refused above maxSubBlocks), and for the first `maxFrames` frames their rectangle, LZW minimum code size, and
// delay in ms. A graphic control extension sets the delay of the next frame only; a frame with none
// gets 0, as browsers do (ffmpeg instead carries the last one forward).
// A file that ends cleanly between blocks without a trailer is accepted, as browsers do.
export function scanGif(bytes, { maxFrames = Infinity } = {}) {
  const u16 = (p) => bytes[p] | (bytes[p + 1] << 8);
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new MalformedGifError('missing GIF header');
  if (bytes.length < 13) throw new MalformedGifError('truncated logical screen descriptor');
  const width = u16(6), height = u16(8);
  let p = 13 + colorTableSize(bytes[10]);
  if (p > bytes.length) throw new MalformedGifError('truncated global color table');

  const frames = [];
  let frameCount = 0, blockCount = 0, subBlockCount = 0, delayMs = 0;
  const chain = (start) => {
    const [end, n] = skipSubBlocks(bytes, start);
    subBlockCount += n;
    return end;
  };
  while (p < bytes.length && bytes[p] !== TRAILER) {
    const introducer = bytes[p];
    blockCount++;
    if (introducer === EXTENSION) {
      if (p + 2 >= bytes.length) throw new MalformedGifError('truncated extension');
      // The decoder reads a GCE as exactly 4 data bytes, so any other size would desynchronize it.
      if (bytes[p + 1] === GCE) {
        if (bytes[p + 2] !== 4) throw new MalformedGifError(`graphic control extension of ${bytes[p + 2]} bytes, not 4`);
        if (p + 5 >= bytes.length) throw new MalformedGifError('truncated graphic control extension');
        delayMs = u16(p + 4) * 10;
      }
      p = chain(p + 2);
    } else if (introducer === IMAGE) {
      if (p + 10 >= bytes.length) throw new MalformedGifError('truncated image descriptor');
      const codeAt = p + 10 + colorTableSize(bytes[p + 9]);
      if (codeAt >= bytes.length) throw new MalformedGifError('truncated local color table');
      frameCount++;
      if (frames.length < maxFrames) {
        frames.push({ left: u16(p + 1), top: u16(p + 3), width: u16(p + 5), height: u16(p + 7), codeSize: bytes[codeAt], delayMs });
      }
      delayMs = 0;
      p = chain(codeAt + 1);
    } else {
      throw new MalformedGifError(`unknown block 0x${introducer.toString(16).padStart(2, '0')} at byte ${p}`);
    }
  }
  const limit = maxSubBlocks(bytes.length, blockCount);
  if (subBlockCount > limit) {
    const count = (n) => n.toLocaleString('en-US');
    throw new MalformedGifError(`${count(subBlockCount)} data sub-blocks in ${count(bytes.length)} bytes; the limit is ${count(limit)}`);
  }
  return { width, height, frameCount, blockCount, subBlockCount, frames };
}
