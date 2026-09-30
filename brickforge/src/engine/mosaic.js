// Picture -> flat LEGO mosaic, entirely in the browser (no key needed).
// Two staggered grey base layers hold everything together; the top layer is the picture in real colours.
import { COLORS, colorIndex } from './palette.js';

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const GREY = colorIndex('Light Bluish Gray');
// A friendly, widely available palette for pictures.
const PICTURE = ['White', 'Black', 'Light Bluish Gray', 'Dark Bluish Gray', 'Red', 'Dark Red', 'Orange', 'Bright Light Orange', 'Yellow', 'Lime', 'Green', 'Dark Green', 'Medium Azure', 'Blue', 'Dark Blue', 'Tan', 'Dark Tan', 'Reddish Brown', 'Nougat', 'Pink', 'Purple']
  .map((n) => colorIndex(n));
const PAL = PICTURE.map((i) => ({ i, c: rgb(COLORS[i].hex) }));

function nearest(r, g, b) {
  let best = 0, bd = Infinity;
  for (let n = 0; n < PAL.length; n++) {
    const [pr, pg, pb] = PAL[n].c;
    const d = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/**
 * pixels: { width, height, data: Uint8ClampedArray RGBA }. cols = studs across (rows follow the aspect ratio).
 * Returns a voxel grid (3 plates tall) for buildFromGrid, plus the palette indices used.
 */
export function mosaicGrid(pixels, { cols = 24, dither = true, maxRows = 48 } = {}) {
  const { width, height, data } = pixels;
  const W = cols, D = Math.max(4, Math.min(maxRows, Math.round((cols * height) / width)));
  // average the source pixels covered by each stud
  const cell = new Float32Array(W * D * 3);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor((x * width) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / W));
    const y0 = Math.floor((z * height) / D), y1 = Math.max(y0 + 1, Math.floor(((z + 1) * height) / D));
    let r = 0, g = 0, b = 0, n = 0, a = 0;
    for (let y = y0; y < y1; y++) for (let xx = x0; xx < x1; xx++) {
      const o = (y * width + xx) * 4, al = data[o + 3] / 255;
      r += data[o] * al + 255 * (1 - al); g += data[o + 1] * al + 255 * (1 - al); b += data[o + 2] * al + 255 * (1 - al); n++; a += al;
    }
    const q = (z * W + x) * 3;
    cell[q] = r / n; cell[q + 1] = g / n; cell[q + 2] = b / n;
  }
  const H = 3;
  const cells = new Uint8Array(W * H * D), owner = new Int16Array(W * H * D).fill(-1);
  const at = (i, j, k) => (j * D + k) * W + i;
  const err = new Float32Array(W * D * 3);
  const used = new Set();
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const q = (z * W + x) * 3;
    const r = Math.max(0, Math.min(255, cell[q] + (dither ? err[q] : 0))), g = Math.max(0, Math.min(255, cell[q + 1] + (dither ? err[q + 1] : 0))), b = Math.max(0, Math.min(255, cell[q + 2] + (dither ? err[q + 2] : 0)));
    const n = nearest(r, g, b), [pr, pg, pb] = PAL[n].c;
    used.add(PAL[n].i);
    cells[at(x, 2, z)] = PAL[n].i + 1;
    if (dither) { // Floyd-Steinberg
      const e = [r - pr, g - pg, b - pb];
      const push = (xx, zz, f) => { if (xx >= 0 && xx < W && zz < D) { const o = (zz * W + xx) * 3; err[o] += e[0] * f; err[o + 1] += e[1] * f; err[o + 2] += e[2] * f; } };
      push(x + 1, z, 7 / 16); push(x - 1, z + 1, 3 / 16); push(x, z + 1, 5 / 16); push(x + 1, z + 1, 1 / 16);
    }
  }
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) { cells[at(x, 0, z)] = GREY + 1; cells[at(x, 1, z)] = GREY + 1; }
  return { grid: { W, H, D, cells, owner, slope: new Uint8Array(W * H * D), offset: [0, 0, 0] }, colors: [...used] };
}
