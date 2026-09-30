import { describe, it, expect, vi } from 'vitest';
import { buildModel, buildFromGrid, pruneLoose } from '../src/engine/pipeline.js';
import { validateSpec, voxelize, LIMITS } from '../src/engine/spec.js';
import { analyze } from '../src/engine/check.js';
import { stability } from '../src/engine/stability.js';
import { mosaicGrid } from '../src/engine/mosaic.js';
import { studCells, partNo, hasTile } from '../src/engine/parts.js';
import { COLORS, isCommon } from '../src/engine/palette.js';
import { PRESETS } from '../src/presets/index.js';
import { requestSpec, readStream, extractJson, fetchRetry, testKey, generate, NoModelError } from '../src/ai/claude.js';
import { systemPrompt, TOOL } from '../src/ai/prompt.js';

const box = (color, pos, size, extra = {}) => ({ shape: 'box', color, pos, size, ...extra });
const roofHouse = (over = {}) => ({
  name: 'House', footprint: [12, 10], shapes: [
    box('White', [1, 0, 1], [10, 2, 8], { hollow: true }),
    { shape: 'roof', axis: 'z', color: 'Dark Red', pos: [0, 2, 0], size: [12, 3, 10], ...over },
  ],
});

describe('limits are raised', () => {
  it('allows a 48-stud footprint and 1500 parts', () => {
    expect(LIMITS).toMatchObject({ maxFootprint: 48, maxHeightBricks: 40, maxParts: 1500 });
    const r = validateSpec({ footprint: [48, 48], shapes: [box('Red', [0, 0, 0], [48, 40, 48])] });
    expect(r.problems).toEqual([]);
    expect(validateSpec({ footprint: [49, 10], shapes: [box('Red', [0, 0, 0], [1, 1, 1])] }).problems[0]).toMatch(/too big/);
  });
  it('builds a 40x40 model without blocking for long', () => {
    const t = Date.now();
    const r = buildModel({ footprint: [40, 40], shapes: [box('Tan', [0, 0, 0], [40, 2, 40], { hollow: true }), box('Red', [4, 0, 4], [8, 4, 8], { hollow: true }), box('Blue', [26, 0, 26], [8, 4, 8], { hollow: true })] });
    expect(Date.now() - t).toBeLessThan(15000);
    expect(r.ok || r.problems.length > 0).toBe(true);
  });
});

describe('review fixes: engine (round 2)', () => {
  const vox = (raw) => { const { spec } = validateSpec(raw); return voxelize(spec); };
  const cols = (g) => { const c = new Set(); for (let j = 0; j < g.H; j++) for (let k = 0; k < g.D; k++) for (let i = 0; i < g.W; i++) if (g.cells[(j * g.D + k) * g.W + i]) c.add(i); return [...c].sort((a, b) => a - b); };
  it('a mirrored half-stud shape is the exact reflection of the original', () => {
    const g = vox({ footprint: [4, 2], shapes: [box('Red', [0.5, 0, 0], [1, 1, 2], { mirror: 'x' })] });
    expect(g.W).toBe(4);
    expect(cols(g)).toEqual([0, 3]);
    // a half-stud-placed pair (like the robot's legs) is left/right symmetric
    const legs = vox({ footprint: [12, 4], shapes: [box('Red', [2.5, 0, 0.5], [2, 1, 2], { mirror: 'x' })] });
    for (let k = 0; k < legs.D; k++) for (let i = 0; i < legs.W; i++) {
      expect(legs.cells[k * legs.W + i] > 0).toBe(legs.cells[k * legs.W + (legs.W - 1 - i)] > 0);
    }
  });
  it('mirrored slopes and roofs descend the other way', () => {
    const g = vox({ footprint: [12, 4], shapes: [{ shape: 'slope', dir: '+x', color: 'Red', pos: [0, 0, 0], size: [4, 2, 2], mirror: 'x' }] });
    const codes = new Set(); g.slope.forEach((v) => { if (v) codes.add(v); });
    expect([...codes].sort()).toEqual([1, 2]);
    // reflection of the raster: cell (i) has slope code d  <=>  cell (W-1-i) has the opposite code
    for (let j = 0; j < g.H; j++) for (let k = 0; k < g.D; k++) for (let i = 0; i < g.W; i++) {
      const a = g.slope[(j * g.D + k) * g.W + i], b = g.slope[(j * g.D + k) * g.W + (g.W - 1 - i)];
      if (a) expect(b).toBe(3 - a);
    }
  });
  it('a bad footprint no longer hides the shape problems, and colours get suggestions', () => {
    const r = validateSpec({ footprint: 'big', shapes: [box('Brown', [0, 0, 0], [1, 1, 1]), box(undefined, [0, 0, 0], [1, 1, 1]), { shape: 'torus', color: 'Red', pos: [0, 0, 0], size: [1, 1, 1] }] });
    const all = r.problems.join('\n');
    expect(all).toMatch(/"footprint" must be/);
    expect(all).toMatch(/colour "Brown" is not in the LEGO palette\. Did you mean .*Brown/);
    expect(all).toMatch(/colour is missing/);
    expect(all).toMatch(/unknown shape "torus"/);
  });
});

describe('review fixes: engine', () => {
  const vox = (raw) => { const { spec } = validateSpec(raw); return voxelize(spec); };
  it('shapes at half-stud positions are exactly as big as asked (half-open bounds)', () => {
    for (const x of [0, 0.5, 1, 1.5]) for (const n of [1, 2, 3]) {
      const g = vox({ footprint: [8, 2], shapes: [box('Red', [x, 0, 0], [n, 1, 1])] });
      expect(g.W).toBe(n);
      expect(g.cells.filter(Boolean).length).toBe(n * 3);
    }
    const y = vox({ footprint: [2, 2], shapes: [box('Red', [0, 0.5, 0], [1, 1, 1])] }); // starts half a brick up, 1 brick tall
    expect(y.cells.filter(Boolean).length).toBe(3);
  });
  it('a mirrored cone or tapered cylinder along the mirrored axis is a true mirror image', () => {
    for (const shape of ['cone', 'cylinder']) for (const axis of ['x', 'z']) {
      const g = vox({ footprint: [axis === 'x' ? 12 : 4, axis === 'z' ? 12 : 4], shapes: [{ shape, axis, taper: 0.3, color: 'Red', pos: [0, 0, 0], size: [axis === 'x' ? 6 : 4, 3, axis === 'z' ? 6 : 4], mirror: axis }] });
      let bad = 0;
      for (let j = 0; j < g.H; j++) for (let k = 0; k < g.D; k++) for (let i = 0; i < g.W; i++) {
        const a = g.cells[(j * g.D + k) * g.W + i] > 0, b = g.cells[(j * g.D + (axis === 'z' ? g.D - 1 - k : k)) * g.W + (axis === 'x' ? g.W - 1 - i : i)] > 0;
        if (a !== b) bad++;
      }
      expect(bad).toBe(0);
    }
  });
  it('hollow works on 2-brick walls (walls only) and warns when it removes nothing', () => {
    const solid = vox({ footprint: [10, 10], shapes: [box('Red', [0, 0, 0], [10, 2, 10])] }).cells.filter(Boolean).length;
    const hollow = vox({ footprint: [10, 10], shapes: [box('Red', [0, 0, 0], [10, 2, 10], { hollow: true })] }).cells.filter(Boolean).length;
    expect(hollow).toBe(solid - 8 * 8 * 6); // interior 8x8 studs, 6 plates, open top and bottom
    const noop = buildModel({ footprint: [2, 2], shapes: [box('Red', [0, 0, 0], [2, 2, 2], { hollow: true })] });
    expect(noop.warnings.join(' ')).toMatch(/hollow:true removed nothing/);
  });
  it('bad dir / mirror / axis / wall / hollow / taper values are reported, not silently defaulted', () => {
    const bad = (extra) => validateSpec({ footprint: [4, 4], shapes: [box('Red', [0, 0, 0], [2, 1, 2], extra)] }).problems.join(' ');
    expect(bad({ dir: 'north' })).toMatch(/"dir" must be one of \+x, -x, \+z, -z \(got "north"\)/);
    expect(bad({ mirror: 'zx' })).toMatch(/"mirror" must be one of/);
    expect(bad({ axis: 'w' })).toMatch(/"axis" must be one of/);
    expect(bad({ hollow: 'false' })).toMatch(/"hollow" must be true or false/);
    expect(bad({ wall: 7 })).toMatch(/"wall" must be a number from 1 to 3/);
    expect(bad({ taper: 2 })).toMatch(/"taper" must be a number/);
    expect(bad({})).toBe('');
  });
  it('the last-resort prune keeps the biggest part BY VOLUME and refuses to delete most of the model', () => {
    const base = box('Red', [0, 0, 0], [12, 1, 12], { label: 'wide base' }), mast = box('Blue', [20, 0, 0], [1, 30, 1], { label: 'mast' });
    const r = buildModel({ footprint: [24, 12], shapes: [base, mast] });
    expect(r.ok).toBe(false);
    expect(pruneLoose(r.model)).not.toBeNull(); // dropping the mast (small volume) is fine
    const kept = pruneLoose(r.model);
    expect(kept.parts.some((p) => p.color === 4 || p.w * p.d >= 4)).toBe(true);
    expect(kept.removedPercent).toBeLessThan(50);
    // a model where the loose part is most of the volume is not pruned into a stump
    const r2 = buildModel({ footprint: [30, 12], shapes: [box('Red', [0, 0, 0], [2, 1, 2]), box('Blue', [10, 0, 0], [12, 3, 12])] });
    expect(r2.ok).toBe(false);
    expect(buildModel({ footprint: [30, 12], shapes: [box('Red', [0, 0, 0], [2, 1, 2]), box('Blue', [10, 0, 0], [12, 3, 12])] }, { prune: true }).ok).toBe(true); // keeps the big Blue block
  });
  it('after pruning, the model is re-cropped so it sits on layer 0 and can be built', () => {
    const r = buildModel({ footprint: [10, 10], shapes: [box('Red', [0, 0, 0], [2, 1, 2]), box('Blue', [0, 2, 4], [8, 2, 4])] }, { prune: true });
    expect(r.ok).toBe(true);
    expect(r.pruned).toBe(true);
    expect(r.model.steps.length).toBeGreaterThan(0);
    expect(Math.min(...r.model.parts.map((p) => p.y))).toBe(0);
    expect(r.model.check.stats.size[1]).toBeCloseTo(2, 5);
  });
});

describe('loose brick slabs are re-laid as staggered plates', () => {
  it('a one-brick ground slab under a roof (which fixes the brick rhythm) still ends up one piece', () => {
    const r = buildModel({ footprint: [30, 30], shapes: [
      box('Tan', [0, 0, 0], [30, 1, 30]), box('White', [5, 1, 5], [20, 2, 20], { hollow: true }),
      { shape: 'roof', axis: 'x', color: 'Dark Red', pos: [4, 3, 4], size: [22, 3, 22] },
    ] });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.model.check.stats.slopes).toBeGreaterThan(10);
  });
});

describe('slopes and roofs (real 45-degree slope parts)', () => {
  it('a roof over walls builds into slope parts, one connected piece, exact coverage', () => {
    const r = buildModel(roofHouse());
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    const st = r.model.check.stats;
    expect(st.slopes).toBeGreaterThanOrEqual(2 * 3); // at least 3 rows on each side
    expect(st.components).toBe(1);
    const an = analyze(r.model.grid, r.model.parts);
    expect(an.overlap + an.uncovered + an.colorMismatch + an.outside).toBe(0);
    r.model.parts.filter((p) => p.kind === 'slope').forEach((p) => {
      expect(['3040b', '3039']).toContain(p.no);
      expect(Math.max(p.w, p.d)).toBe(2);
      expect(Math.min(p.w, p.d)).toBeLessThanOrEqual(2);
      expect(studCells(p).length).toBe(Math.min(p.w, p.d)); // studs only on the high half
    });
  });
  it('a slope has no studs on its slanted half: something floating over only that half is not attached', () => {
    const r = buildModel({ footprint: [8, 2], shapes: [
      { shape: 'slope', dir: '+x', color: 'Red', pos: [0, 0, 0], size: [3, 2, 2] },
      box('Blue', [2, 1, 0], [1, 1, 2]), // sits over the slanted low end only (x=2 is the low end of a '+x' slope)
    ] });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/not attached/);
  });
  it('tells the AI plainly when the geometry cannot be built from 45-degree slopes', () => {
    const tooNarrow = validateSpec(roofHouse({ size: [6, 3, 10] }));
    expect(tooNarrow.problems.join(' ')).toMatch(/needs at least 8 studs across/);
    const tooShort = validateSpec({ footprint: [4, 4], shapes: [{ shape: 'slope', dir: '+x', color: 'Red', pos: [0, 0, 0], size: [2, 3, 4] }] });
    expect(tooShort.problems.join(' ')).toMatch(/at least 4 studs along/);
    const sub = validateSpec({ footprint: [4, 4], shapes: [{ shape: 'roof', op: 'subtract', pos: [0, 0, 0], size: [4, 1, 4] }] });
    expect(sub.problems.join(' ')).toMatch(/only supports op "add"/);
  });
  it('rejects slopes on different brick phases in one model', () => {
    const r = buildModel({ footprint: [12, 10], shapes: [
      box('White', [1, 0, 1], [10, 2, 8], { hollow: true }),
      { shape: 'roof', color: 'Red', pos: [0, 2, 0], size: [12, 2, 10] },
      { shape: 'slope', dir: '+z', color: 'Blue', pos: [0, 0.333, 0], size: [2, 1, 3] },
    ] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/different vertical steps/);
  });
  it('mirror of a slope flips its direction', () => {
    const { spec } = validateSpec({ footprint: [10, 2], shapes: [{ shape: 'slope', dir: '+x', color: 'Red', pos: [0, 0, 0], size: [3, 2, 2], mirror: 'x' }] });
    const g = voxelize(spec);
    const codes = new Set(); g.slope.forEach((v) => { if (v) codes.add(v); });
    expect([...codes].sort()).toEqual([1, 2]);
  });
  it('the cottage preset uses real slope parts', () => {
    const r = buildModel(PRESETS.find((p) => p.id === 'cottage').spec);
    expect(r.ok).toBe(true);
    expect(r.model.check.stats.slopes).toBeGreaterThan(10);
  });
});

describe('tiles (smooth tops)', () => {
  it('only fully exposed plates become tiles, and connectivity is unchanged', () => {
    const spec = { footprint: [6, 6], shapes: [box('Red', [0, 0, 0], [6, 1, 6]), box('Blue', [1, 1, 1], [2, 0.333, 2]), box('Yellow', [0, 1, 4], [4, 0.333, 2])] };
    const plain = buildModel(spec), smooth = buildModel(spec, { tiles: true });
    expect(plain.ok && smooth.ok).toBe(true);
    expect(smooth.model.check.stats.tiles).toBeGreaterThan(0);
    expect(smooth.model.check.stats.components).toBe(1);
    expect(smooth.model.parts.length).toBe(plain.model.parts.length);
    const g = smooth.model.grid;
    smooth.model.parts.filter((p) => p.kind === 'tile').forEach((p) => {
      expect(hasTile(p.w, p.d)).toBe(true);
      expect(studCells(p)).toEqual([]);
      const j = p.y + p.h;
      if (j < g.H) for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) expect(g.cells[(j * g.D + z) * g.W + x]).toBe(0);
    });
    expect(partNo('tile', 2, 4)).toBe('87079');
  });
});

describe('stability warnings', () => {
  it('flags a model whose weight is outside its footprint', () => {
    const r = buildModel({ footprint: [12, 6], shapes: [box('Red', [0, 0, 0], [2, 2, 2]), box('Blue', [0, 2, 0], [12, 3, 2]), box('Yellow', [10, 5, 0], [2, 3, 2])] });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/tip over/);
  });
  it('is quiet for a sensible, well-supported model', () => {
    const r = buildModel(PRESETS.find((p) => p.id === 'pine').spec);
    expect(r.warnings.filter((w) => /tip over|sticks out/.test(w))).toEqual([]);
  });
  it('flags a heavy arm hanging off a single stud', () => {
    const r = buildModel({ footprint: [14, 4], shapes: [box('Red', [0, 0, 0], [3, 4, 3]), box('Blue', [2, 4, 0], [12, 1, 1]), box('Yellow', [9, 5, 0], [4, 2, 2])] });
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/sticks out|hangs on|tip over/);
  });
});

describe('common colours only', () => {
  it('snaps a rare colour to a common one and a hex to a common colour', () => {
    const rare = COLORS.findIndex((c) => !isCommon(COLORS.indexOf(c)));
    const rareName = COLORS[rare].name;
    const a = validateSpec({ footprint: [2, 2], shapes: [box(rareName, [0, 0, 0], [2, 1, 2])] }, { commonOnly: true });
    expect(isCommon(a.spec.shapes[0].color)).toBe(true);
    const b = validateSpec({ footprint: [2, 2], shapes: [box('#c91a09', [0, 0, 0], [2, 1, 2])] }, { commonOnly: true });
    expect(COLORS[b.spec.shapes[0].color].name).toBe('Red');
    const off = validateSpec({ footprint: [2, 2], shapes: [box(rareName, [0, 0, 0], [2, 1, 2])] });
    expect(COLORS[off.spec.shapes[0].color].name).toBe(rareName);
  });
});

describe('photo mosaic (no key)', () => {
  const picture = (w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(x < w / 2 ? [200, 30, 30, 255] : [30, 60, 200, 255], (y * w + x) * 4);
    return { width: w, height: h, data };
  };
  it('is turned into real parts, one connected piece, at most 4 pieces per step', () => {
    const { grid, colors } = mosaicGrid(picture(80, 60), { cols: 20 });
    expect(grid.W).toBe(20);
    expect(grid.D).toBe(15);
    const r = buildFromGrid(grid, 'Mosaic', {});
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.model.check.stats.components).toBe(1);
    expect(r.model.steps.every((s) => s.parts.length >= 1 && s.parts.length <= 4)).toBe(true);
    expect(colors.length).toBeGreaterThanOrEqual(2);
    expect(r.model.mosaic).toBe(true);
    const top = new Set(); for (let z = 0; z < grid.D; z++) for (let x = 0; x < grid.W; x++) top.add(grid.cells[(2 * grid.D + z) * grid.W + x]);
    expect(top.size).toBeLessThanOrEqual(4); // red/blue with a little dithering, all real palette colours
  });
});

describe('baseplate option', () => {
  const twoTowers = { footprint: [10, 2], shapes: [box('Red', [0, 0, 0], [2, 3, 2]), box('Blue', [6, 0, 0], [2, 3, 2])] };
  it('holds separate ground-level pieces, is the first step on its own, and appears in the parts list', () => {
    expect(buildModel(twoTowers).ok).toBe(false); // without a baseplate the two towers are loose
    const r = buildModel(twoTowers, { baseplate: true });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    const bp = r.model.parts.find((p) => p.kind === 'baseplate');
    expect(bp).toMatchObject({ w: 16, d: 16, no: '3867', name: 'Baseplate 16 x 16' });
    expect(r.model.steps[0].parts).toEqual([bp.id]);
    expect(r.model.steps.every((s) => s.parts.length <= 4)).toBe(true);
    expect(r.model.check.stats.components).toBe(1);
    expect(r.model.list.find((l) => l.no === '3867')).toMatchObject({ qty: 1, bl: 6 });
    const an = analyze(r.model.grid, r.model.parts);
    expect(an.overlap + an.uncovered + an.colorMismatch + an.outside).toBe(0);
  });
  it('picks the smallest baseplate that fits: 16, 32 or 48', () => {
    const big = (n) => buildModel({ footprint: [n, n], shapes: [box('Red', [0, 0, 0], [n, 1, n])] }, { baseplate: true });
    expect(big(16).model.parts.find((p) => p.kind === 'baseplate').no).toBe('3867');
    expect(big(20).model.parts.find((p) => p.kind === 'baseplate').no).toBe('3811');
    expect(big(40).model.parts.find((p) => p.kind === 'baseplate').no).toBe('4186');
  });
  it('a lawn plus a detached garden shed: loose alone, fine on a baseplate', () => {
    const scene = { footprint: [30, 30], shapes: [box('Tan', [0, 0, 0], [8, 1, 8]), box('Red', [20, 0, 20], [4, 2, 4])] };
    expect(buildModel(scene).ok).toBe(false);
    expect(buildModel(scene, { baseplate: true }).ok).toBe(true);
  });
  it('everything above the ground must still connect to the ground pieces', () => {
    const r = buildModel({ footprint: [6, 2], shapes: [box('Red', [0, 0, 0], [2, 2, 2]), box('Blue', [4, 3, 0], [2, 1, 2])] }, { baseplate: true });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/not attached/);
  });
  it('no tipping warning on a baseplate; the AI is told about it', () => {
    const r = buildModel({ footprint: [12, 6], shapes: [box('Red', [0, 0, 0], [2, 2, 2]), box('Blue', [0, 2, 0], [12, 3, 2]), box('Yellow', [10, 5, 0], [2, 3, 2])] }, { baseplate: true });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/tip over/);
  });
});

describe('shapes that do nothing are reported to the AI', () => {
  it('paint or subtract listed before the shape they act on', () => {
    const r = buildModel({ footprint: [6, 6], shapes: [box('Blue', [1, 1, 1], [2, 1, 2], { op: 'paint', label: 'eyes' }), box('Red', [0, 0, 0], [6, 2, 6], { label: 'body' })] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/shape #0 \(eyes\): paint changed nothing.*AFTER/);
    const c = buildModel({ footprint: [6, 6], shapes: [box('Red', [0, 0, 0], [6, 2, 6]), box(null, [1, 3, 1], [1, 1, 1], { op: 'subtract', label: 'door' })] });
    expect(c.ok).toBe(false);
    expect(c.problems[0]).toMatch(/subtract removed nothing/);
  });
  it('a shape smaller than one stud cell adds nothing (e.g. a 1-stud cylinder half a stud off)', () => {
    const r = buildModel({ footprint: [6, 6], shapes: [box('Red', [0, 0, 0], [6, 2, 6]), { shape: 'cylinder', color: 'Blue', pos: [2.5, 2, 2.5], size: [1, 1, 1], label: 'antenna' }] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/shape #1 \(antenna\) adds nothing/);
  });
  it('a shape fully hidden by a later one is only a warning', () => {
    const r = buildModel({ footprint: [4, 4], shapes: [box('Red', [1, 0, 1], [2, 1, 2], { label: 'hidden' }), box('Blue', [0, 0, 0], [4, 1, 4], { label: 'cover' })] });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/hidden\) is completely covered/);
  });
});

describe('oversize feedback names the expensive shapes', () => {
  it('points at the shape that costs the most parts', () => {
    const r = buildModel({ footprint: [48, 48], shapes: [{ shape: 'ellipsoid', color: 'Red', pos: [0, 0, 0], size: [48, 14, 48], label: 'giant dome' }, box('Blue', [0, 0, 0], [2, 1, 2], { label: 'tiny' })] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/limit is 1500\. Biggest: #0 giant dome \(ellipsoid, about \d+ parts\)/);
  });
});

describe('Anthropic client', () => {
  const enc = new TextEncoder();
  const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const stream = (text, size = 7) => new ReadableStream({
    start(c) { const b = enc.encode(text); for (let i = 0; i < b.length; i += size) c.enqueue(b.slice(i, i + size)); c.close(); },
  });
  const tool = (obj, stop = 'tool_use') => sse([
    { type: 'message_start', message: {} }, { type: 'ping' },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't', name: 'submit_model', input: {} } },
    ...JSON.stringify(obj).match(/[\s\S]{1,11}/g).map((p) => ({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: p } })),
    { type: 'message_delta', delta: { stop_reason: stop } }, { type: 'message_stop' },
  ]);
  const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), body });
  const spec = { name: 'x', footprint: [2, 2], shapes: [box('Red', [0, 0, 0], [2, 1, 2])] };

  it('reassembles a tool call split across tiny chunks, ignoring thinking and ping events', async () => {
    const got = await requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => ok(stream(tool(spec), 5)) });
    expect(got).toEqual(spec);
  });
  it('copes with CRLF line endings', async () => {
    const got = await requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => ok(stream(tool(spec).replace(/\n/g, '\r\n'), 9)) });
    expect(got).toEqual(spec);
  });
  it('falls back to JSON in plain text, including code fences and braces inside strings', async () => {
    const tricky = { name: 'a } { "b"', footprint: [2, 2], shapes: [] };
    const text = sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Here you go:\n```json\n' + JSON.stringify(tricky) + '\n```' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]);
    expect(await requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => ok(stream(text)) })).toEqual(tricky);
    expect(extractJson('nothing here')).toBeNull();
  });
  it('reports refusal, truncation, and mid-stream errors without leaking the key', async () => {
    await expect(requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => ok(stream(tool(spec, 'refusal'))) })).rejects.toThrow(/declined/);
    const truncated = tool(spec, 'max_tokens').replace(/\"shapes\":\[.*?\]\}/, '\\"shapes\\":[{\\"sha');
    const cut = sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'submit_model', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"name":"x","footprint":[2,2],"shapes":[{"sha' } },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    ]);
    await expect(requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => ok(stream(cut)) })).rejects.toThrow(/cut off/);
    expect(truncated.length).toBeGreaterThan(0);
    // a complete answer is used even if the stop reason says max_tokens
    expect(await requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => ok(stream(tool(spec, 'max_tokens'))) })).toEqual(spec);
    const err = sse([{ type: 'error', error: { message: 'boom sk-ant-SECRET' } }]);
    await expect(requestSpec({ key: 'sk-ant-SECRET', model: 'm', messages: [], fetchFn: async () => ok(stream(err)) })).rejects.toThrow(/boom \[key\]/);
  });
  it('says what the model said when it never sent a model', async () => {
    const text = sse([{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I cannot draw that.' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }]);
    await expect(requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => ok(stream(text)) })).rejects.toThrow(/I cannot draw that/);
  });
  it('retries 529 and 429 with back-off, honouring retry-after, then succeeds', async () => {
    vi.useFakeTimers();
    const calls = []; const seen = [];
    const fetchFn = async () => {
      calls.push(1);
      if (calls.length === 1) return { ok: false, status: 529, headers: new Headers() };
      if (calls.length === 2) return { ok: false, status: 429, headers: new Headers({ 'retry-after': '2' }) };
      return ok(stream(tool(spec)));
    };
    const p = requestSpec({ key: 'k', model: 'm', messages: [], fetchFn, onRetry: (n, why, ms) => seen.push([n, why, ms]) });
    await vi.advanceTimersByTimeAsync(20000);
    expect(await p).toEqual(spec);
    expect(seen).toEqual([[1, 529, 1500], [2, 429, 2000]]);
    vi.useRealTimers();
  });
  it('gives up after the retries and explains a 401 without echoing the key', async () => {
    const res = await fetchRetry('u', {}, { retries: 0, fetchFn: async () => ({ ok: false, status: 401, headers: new Headers() }) });
    expect(res.status).toBe(401);
    const bad = { ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers(), json: async () => ({ error: { message: 'invalid x-api-key sk-ant-XYZ' } }) };
    await expect(requestSpec({ key: 'sk-ant-XYZ', model: 'm', messages: [], fetchFn: async () => bad })).rejects.toThrow(/rejected \(401\)/);
    await expect(requestSpec({ key: 'sk-ant-XYZ', model: 'm', messages: [], fetchFn: async () => bad })).rejects.not.toThrow(/sk-ant-XYZ/);
  });
  it('can be aborted while waiting to retry', async () => {
    const ctrl = new AbortController();
    const p = fetchRetry('u', {}, { signal: ctrl.signal, fetchFn: async () => ({ ok: false, status: 529, headers: new Headers() }) });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toThrow(/Abort/);
  });
  it('testKey: accepts, rejects, and never leaks the key', async () => {
    expect((await testKey('k', { fetchFn: async () => ({ ok: true, status: 200, headers: new Headers() }) })).ok).toBe(true);
    const r = await testKey('sk-ant-QQ', { fetchFn: async () => ({ ok: false, status: 401, statusText: 'x', headers: new Headers(), json: async () => ({}) }) });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/401/);
    const net = await testKey('sk-ant-QQ', { fetchFn: async () => { throw new Error('offline sk-ant-QQ'); } });
    expect(net.message).not.toMatch(/sk-ant-QQ/);
  }, 20000);
  it('sends the request the API expects (streaming, tool, auto choice, browser-access header, restricted palette)', async () => {
    let sent;
    await requestSpec({ key: 'kk', model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'x' }], opts: { commonOnly: true }, fetchFn: async (url, init) => { sent = { url, init }; return ok(stream(tool(spec))); } });
    const body = JSON.parse(sent.init.body);
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent.init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(sent.init.headers['x-api-key']).toBe('kk');
    expect(body).toMatchObject({ stream: true, tool_choice: { type: 'auto' }, model: 'claude-sonnet-5-5' });
    expect(body.tools[0].name).toBe('submit_model');
    expect(body.system).not.toMatch(/Coral/); // a rare colour is not offered
    expect(body.system).toMatch(/slope/);
    expect(body.system).not.toMatch(/pressed onto a real baseplate/);
  });
  it('mentions the baseplate to the AI when that option is on', async () => {
    let sent;
    await requestSpec({ key: 'kk', model: 'm', messages: [], opts: { baseplate: true }, fetchFn: async (u, init) => { sent = init; return ok(stream(tool(spec))); } });
    expect(JSON.parse(sent.body).system).toMatch(/pressed onto a real baseplate/);
  });
  it('generate passes options to the builder and surfaces retries', async () => {
    const events = [], builtWith = [];
    const res = await generate({
      prompt: 'x', key: 'k', model: 'm', opts: { tiles: true },
      onEvent: (e) => events.push(e.type),
      request: async ({ onRetry }) => { onRetry(1, 529, 1500); return spec; },
      build: async (s, o) => { builtWith.push(o); return buildModel(s, o); },
    });
    expect(res.ok).toBe(true);
    expect(builtWith[0]).toMatchObject({ tiles: true, prune: false });
    expect(events).toContain('retry');
  });

  it('only uses the first submit_model call when the model sends several blocks', async () => {
    const two = sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'a', name: 'submit_model', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(spec) } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'b', name: 'submit_model', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"other":1}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ]);
    expect(await requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => ok(stream(two)) })).toEqual(spec);
  });
  it('asks once more when Claude answers in words, then builds', async () => {
    const seen = []; const ev = [];
    const res = await generate({
      prompt: 'my dog', key: 'k', model: 'm', onEvent: (e) => ev.push(e.type),
      request: async ({ messages }) => { seen.push(messages.length); if (seen.length === 1) throw new NoModelError('x', 'no-model', 'What breed is your dog?'); return spec; },
    });
    expect(res.ok).toBe(true);
    expect(seen).toEqual([1, 3]);
    expect(ev).toContain('nudge');
  });
  it('a cut-off answer is retried with a request for a shorter one', async () => {
    let asked;
    await generate({ prompt: 'x', key: 'k', model: 'm', request: async ({ messages }) => { if (messages.length === 1) throw new NoModelError('x', 'cut-off'); asked = messages[messages.length - 1].content[0].text; return spec; } });
    expect(asked).toMatch(/MORE COMPACT/);
  });
  it('an API failure in round 2 keeps the best earlier attempt instead of losing the run', async () => {
    const broken = { name: 'Two towers', footprint: [10, 2], shapes: [box('Red', [0, 0, 0], [2, 3, 2]), box('Blue', [6, 0, 0], [2, 3, 2])] };
    let n = 0; const ev = [];
    const res = await generate({ prompt: 'x', key: 'k', model: 'm', onEvent: (e) => ev.push(e.type), request: async () => { if (++n === 2) throw new Error('Anthropic API 529: overloaded'); return broken; } });
    expect(res.ok).toBe(true);
    expect(res.pruned).toBe(true);
    expect(res.apiFailure).toMatch(/529/);
    expect(ev).toContain('fallback');
  });
  it('an abort is never swallowed by the fallback', async () => {
    let n = 0;
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    await expect(generate({ prompt: 'x', key: 'k', model: 'm', request: async () => { if (++n === 2) throw abort; return { name: 't', footprint: [10, 2], shapes: [box('Red', [0, 0, 0], [2, 3, 2]), box('Blue', [6, 0, 0], [2, 3, 2])] }; } })).rejects.toThrow(/Abort/);
  });
});

describe('review round 2', () => {
  const towers = (n) => ({ footprint: [n * 4, 2], shapes: Array.from({ length: n }, (_, i) => box(['Red', 'Blue', 'Yellow'][i % 3], [i * 4, 0, 0], [2, 3, 2])) });
  const okStream = (spec) => {
    const enc = new TextEncoder();
    const ev = (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
    const txt = ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'submit_model', input: {} } })
      + ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(spec) } })
      + ev({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }) + ev({ type: 'message_stop' });
    return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(enc.encode(txt)); c.close(); } }) };
  };
  const rawStream = (txt) => ({ ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(txt)); c.close(); } }) });
  const good = { name: 'x', footprint: [2, 2], shapes: [box('Red', [0, 0, 0], [2, 1, 2])] };

  it('two overlapping roofs never produce fake slope parts (every slope has a direction and a real size)', () => {
    const r = buildModel({ footprint: [10, 14], shapes: [box('White', [0, 0, 0], [10, 2, 14], { hollow: true }), { shape: 'roof', axis: 'x', color: 'Blue', pos: [1, 2, 2], size: [8, 2, 11] }, { shape: 'roof', axis: 'z', color: 'Tan', pos: [3, 2, 0], size: [6, 2, 10] }] });
    const parts = (r.model || {}).parts || [];
    parts.filter((p) => p.kind === 'slope').forEach((p) => {
      expect([1, 2, 3, 4]).toContain(p.dir);
      expect(Math.max(p.w, p.d)).toBe(2);
      expect([1, 2]).toContain(Math.min(p.w, p.d));
      expect(studCells(p).length).toBe(Math.min(p.w, p.d));
    });
    if (r.ok) { const an = analyze(r.model.grid, r.model.parts); expect(an.nComp).toBe(1); }
  });

  it('pruning ignores the baseplate when choosing what to keep, and keeps tiles, baseplate and warnings', () => {
    const spec = { footprint: [20, 8], shapes: [box('Red', [0, 0, 0], [4, 1, 4]), box('Blue', [8, 3, 0], [10, 3, 6])] };
    const r = buildModel(spec, { baseplate: true, prune: true });
    expect(r.ok).toBe(true);
    expect(r.pruned).toBe(true);
    expect(r.model.parts.some((p) => p.kind === 'baseplate')).toBe(true);
    const keptBlue = r.model.parts.filter((p) => p.kind !== 'baseplate').some((p) => p.w * p.d * p.h >= 20 && p.color === COLORS.findIndex((c) => c.name === 'Blue'));
    expect(keptBlue).toBe(true); // the big group survived, not the small one
    const plates = { footprint: [12, 12], shapes: [box('Red', [0, 0, 0], [6, 0.667, 6]), box('Blue', [8, 3, 8], [2, 1, 2])] };
    const t = buildModel(plates, { tiles: true, baseplate: true, prune: true });
    expect(t.ok).toBe(true);
    expect(t.pruned).toBe(true);
    expect(t.model.check.stats.baseplate).toBe(true);
    expect(t.model.opts).toMatchObject({ tiles: true, baseplate: true });
  });

  it('a stack of joints under one overhang gives one warning, and a second overhang is still reported', () => {
    const r = buildModel({ footprint: [40, 8], shapes: [
      box('Red', [0, 0, 0], [2, 5, 2]), box('Blue', [0, 5, 0], [14, 1, 8]),
      box('Yellow', [24, 0, 0], [2, 2, 2]), box('Green', [24, 2, 0], [12, 1, 8]),
    ] }, { baseplate: true });
    expect(r.ok).toBe(true);
    const side = r.warnings.filter((w) => /rests on only|hangs/.test(w));
    expect(side.length).toBeGreaterThanOrEqual(2);
    expect(side.length).toBeLessThanOrEqual(3);
    expect(side.some((w) => /near x [0-3],/.test(w))).toBe(true);
    expect(side.some((w) => /near x 2[4-9],/.test(w))).toBe(true);
  });

  it('a slope placed at half-stud positions stays inside the footprint', () => {
    const { spec } = validateSpec({ footprint: [4, 2], shapes: [{ shape: 'slope', dir: '+x', color: 'Red', pos: [0.5, 0, 0], size: [3, 1, 2] }] });
    const g = voxelize(spec);
    expect(g.W).toBe(3);
    expect(g.cells.filter(Boolean).length).toBeGreaterThan(0);
  });

  describe('mosaic', () => {
    const noise = (w, h) => { const d = new Uint8ClampedArray(w * h * 4); let s = 5; for (let i = 0; i < w * h; i++) { s = (s * 1664525 + 1013904223) >>> 0; d.set([s & 255, (s >> 8) & 255, (s >> 16) & 255, 255], i * 4); } return { width: w, height: h, data: d }; };
    it('a tall picture is narrowed, not squashed', () => {
      const { grid } = mosaicGrid(noise(100, 400), { cols: 32 });
      expect(grid.D).toBe(48);
      expect(Math.abs(grid.W / grid.D - 100 / 400)).toBeLessThan(0.03);
    });
    it('too many parts gives a mosaic-specific message (no shape or hollow advice)', () => {
      const { grid } = mosaicGrid(noise(100, 100), { cols: 48 });
      const r = buildFromGrid(grid, 'Photo mosaic', {});
      expect(r.ok).toBe(false);
      expect(r.problems[0]).toMatch(/The mosaic needs .* parts but the limit is 1500\. Choose fewer studs/);
      expect(r.problems[0]).not.toMatch(/Biggest|hollow|curved/);
    });
    it('turning dithering off (or fewer studs) fits the limit', () => {
      const { grid } = mosaicGrid(noise(100, 100), { cols: 32, dither: false });
      expect(buildFromGrid(grid, 'Photo mosaic', {}).ok).toBe(true);
    });
    it('an AI spec whose first shape is labelled "mosaic" is a normal model, not a photo mosaic', () => {
      const r = buildModel({ footprint: [4, 4], shapes: [box('Red', [0, 0, 0], [4, 1, 4], { label: 'mosaic' })] });
      expect(r.ok).toBe(true);
      expect(r.model.mosaic).toBe(false);
    });
  });

  describe('client', () => {
    it('a cut-off reply is not mistaken for an inner shape object', async () => {
      const cut = '{"name":"x","footprint":[2,2],"shapes":[{"shape":"box","color":"Red","pos":[0,0,0],"size":[1,1,1]},{"shape":"bo';
      const txt = `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sure: ' + cut } })}\n\nevent: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } })}\n\n`;
      await expect(requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => rawStream(txt) })).rejects.toMatchObject({ name: 'NoModelError', kind: 'cut-off' });
    });
    it('an overloaded_error inside a 200 stream is retried like an HTTP 529', async () => {
      vi.useFakeTimers();
      let n = 0; const seen = [];
      const overloaded = `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}\n\n`;
      const p = requestSpec({ key: 'k', model: 'm', messages: [], onRetry: (a, why) => seen.push(why), fetchFn: async () => (++n === 1 ? rawStream(overloaded) : okStream(good)) });
      await vi.advanceTimersByTimeAsync(10000);
      expect(await p).toEqual(good);
      expect(n).toBe(2);
      expect(seen).toEqual(['stream']);
      vi.useRealTimers();
    });
    it('a stream cut before message_stop is retried, and is not reported as "answered in words"', async () => {
      vi.useFakeTimers();
      let n = 0;
      const cutStream = `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'submit_model', input: {} } })}\n\nevent: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"name":"x","footprint":[2,2],"shapes":[{"sha' } })}\n\n`;
      const p = requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => (++n === 1 ? rawStream(cutStream) : okStream(good)) });
      await vi.advanceTimersByTimeAsync(10000);
      expect(await p).toEqual(good);
      expect(n).toBe(2);
      vi.useRealTimers();
    });
    it('a non-retryable stream error (invalid request) is not retried', async () => {
      let n = 0;
      const bad = `event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'nope' } })}\n\n`;
      await expect(requestSpec({ key: 'k', model: 'm', messages: [], fetchFn: async () => { n++; return rawStream(bad); } })).rejects.toThrow(/nope/);
      expect(n).toBe(1);
    });
    it('after a late API failure the BEST earlier attempt is used, not the latest', async () => {
      const better = { name: 'Better', ...towers(2), shapes: [box('Red', [0, 0, 0], [2, 3, 2]), box('Blue', [4, 0, 0], [1, 1, 1])] };
      const worse = { name: 'Worse', ...towers(3) };
      let n = 0; const ev = [];
      const res = await generate({ prompt: 'x', key: 'k', model: 'm', onEvent: (e) => ev.push(e), request: async () => { n++; if (n === 3) throw new Error('Anthropic API 529: overloaded'); return n === 1 ? better : worse; } });
      expect(res.ok).toBe(true);
      expect(res.spec.name).toBe('Better');
      expect(res.rounds).toBe(1);
      expect(res.apiFailure).toMatch(/529/);
      const fb = ev.find((e) => e.type === 'fallback');
      expect(fb).toMatchObject({ fromRound: 1, pruned: true });
    });
  });

  describe('prompt states only true engine facts', () => {
    it('hollow threshold and cone cost match the engine', () => {
      const prompt = systemPrompt({});
      expect(JSON.stringify(TOOL)).toMatch(/MORE than 2 bricks tall \(7\+ plates\)/);
      expect(prompt).toMatch(/hollow cone about 80 and 240/);
      const vox = (h) => { const { spec } = validateSpec({ footprint: [10, 10], shapes: [box('Red', [0, 0, 0], [10, h, 10], { hollow: true })] }); return voxelize(spec); };
      const floor = (g) => { let n = 0; for (let k = 0; k < g.D; k++) for (let i = 0; i < g.W; i++) if (g.cells[k * g.W + i]) n++; return n; };
      expect(floor(vox(2))).toBe(36); // exactly 2 bricks: walls only (10x10 ring = 36 cells)
      expect(floor(vox(2.333))).toBe(100); // 7 plates: floor and roof appear
    });
  });
});
