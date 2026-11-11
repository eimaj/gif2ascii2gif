// Render ANSI frames back into RGBA pixels with the 6x12 glyphs.
// Shared by the CLI (ascii2gif.mjs), the canvas preview, and the browser GIF export.
import { CELL_W, CELL_H, GLYPHS } from './glyphs.mjs';

export const MARGIN = 1; // in cells
export const MAX_SCALE = 8;
const WHITE = [255, 255, 255];

// Turn one ANSI frame into rows of { ch, rgb } cells.
export function parseAnsiFrame(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const cells = [];
    let rgb = WHITE;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\x1b') {
        const end = line.indexOf('m', i);
        if (end === -1) throw new Error('unterminated escape sequence in frame');
        const params = line.slice(i + 2, end).split(';').map(Number);
        if (params[0] === 38 && params[1] === 2) rgb = params.slice(2, 5);
        else if (params[0] === 0) rgb = WHITE;
        i = end;
        continue;
      }
      const ch = line[i];
      if (!(ch in GLYPHS)) throw new Error(`no glyph for character ${JSON.stringify(ch)}`);
      cells.push({ ch, rgb });
    }
    rows.push(cells);
  }
  return rows;
}

// 'transparent', 'RRGGBB' or '#RRGGBB' → [r, g, b, a]; a = 0 for transparent.
export function parseBackground(bg) {
  if (bg === 'transparent') return [0, 0, 0, 0];
  const hex = String(bg).replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`background must be "transparent" or a 6-digit hex color, got ${bg}`);
  return [...[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)), 255];
}

// Columns and rows that fit every grid, so all frames share one size.
export function gridBounds(grids) {
  return {
    cols: Math.max(...grids.flatMap((g) => g.map((r) => r.length))),
    rows: Math.max(...grids.map((g) => g.length)),
  };
}

// One RGBA frame with `margin` empty cells on every side. Each glyph pixel becomes a
// `scale × scale` block (nearest neighbor).
export function renderFrameRGBA(grid, cols, rows, { background = 'transparent', scale = 1, margin = MARGIN } = {}) {
  if (!Number.isInteger(scale) || scale < 1 || scale > MAX_SCALE) throw new Error(`scale must be an integer 1-${MAX_SCALE}, got ${scale}`);
  if (!Number.isInteger(margin) || margin < 0) throw new Error(`margin must be a whole number of cells, got ${margin}`);
  const bg = parseBackground(background);
  const width = (cols + 2 * margin) * CELL_W * scale;
  const height = (rows + 2 * margin) * CELL_H * scale;
  const data = new Uint8Array(width * height * 4);
  if (bg[3] !== 0) for (let p = 0; p < width * height; p++) data.set(bg, p * 4);
  grid.forEach((cells, row) => {
    cells.forEach(({ ch, rgb }, col) => {
      const glyph = GLYPHS[ch];
      const x0 = (col + margin) * CELL_W;
      const y0 = (row + margin) * CELL_H;
      for (const [gy, bits] of Object.entries(glyph)) {
        for (let gx = 0; gx < CELL_W; gx++) {
          if (bits[gx] !== '#') continue;
          const px = (x0 + gx) * scale;
          const py = (y0 + Number(gy)) * scale;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const o = ((py + dy) * width + px + dx) * 4;
              data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
            }
          }
        }
      }
    });
  });
  return { data, width, height };
}

// Parse and render every ANSI frame at one shared size.
export function renderFrames(ansiFrames, opts) {
  const grids = ansiFrames.map(parseAnsiFrame);
  const { cols, rows } = gridBounds(grids);
  return grids.map((g) => renderFrameRGBA(g, cols, rows, opts));
}
