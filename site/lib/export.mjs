// Browser GIF export at the source GIF's exact pixel size.
// The ASCII grid is drawn without a margin and fitted to the source with area averaging.
import { CELL_W, CELL_H } from './glyphs.mjs';
import { renderFrameRGBA } from './render.mjs';
import { axisWeights } from './decode.mjs';

// Smallest integer glyph scale at which the marginless grid (cols × 6 by rows × 12 pixels) is at
// least as large as the source on both axes.
export function exportScale(cols, rows, srcWidth, srcHeight) {
  return Math.max(1, Math.ceil(srcWidth / (cols * CELL_W)), Math.ceil(srcHeight / (rows * CELL_H)));
}

// True when the export draws each character narrower than its 6-pixel glyph.
export function glyphsShrink(cols, srcWidth) {
  return cols * CELL_W > srcWidth;
}

// Area-average (box filter) resample of RGBA from srcW×srcH to w×h. Color is averaged over the
// opaque coverage only, so transparent pixels never darken an edge; alpha is then cut at 50%,
// keeping transparency 1-bit.
export function resampleRGBA(rgba, srcW, srcH, w, h) {
  const xs = axisWeights(srcW, w);
  const ys = axisWeights(srcH, h);
  const out = new Uint8Array(w * h * 4);
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      let r = 0, g = 0, b = 0, a = 0, total = 0;
      for (const [sy, wy] of ys[oy]) {
        for (const [sx, wx] of xs[ox]) {
          const wgt = wx * wy;
          const i = (sy * srcW + sx) * 4;
          const wa = wgt * rgba[i + 3];
          r += rgba[i] * wa; g += rgba[i + 1] * wa; b += rgba[i + 2] * wa;
          a += wa;
          total += wgt;
        }
      }
      if (a * 2 < 255 * total) continue; // under 50% coverage: stays transparent (all zero)
      const o = (oy * w + ox) * 4;
      out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = 255;
    }
  }
  return out;
}

// One export frame at exactly width × height. Drawing the grid at exportScale and area-averaging
// that down gives the same pixels as area-averaging the scale-1 drawing directly, since every
// scaled pixel repeats its scale-1 pixel; the direct path keeps one small canvas per frame.
export function renderExportFrame(grid, cols, rows, { background = 'transparent', width, height }) {
  const glyphs = renderFrameRGBA(grid, cols, rows, { background, scale: 1, margin: 0 });
  return { data: resampleRGBA(glyphs.data, glyphs.width, glyphs.height, width, height), width, height };
}
