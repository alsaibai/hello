import { describe, it, expect } from 'vitest';
import { validateSpec, voxelize } from '../src/engine/spec.js';
import { pack } from '../src/engine/pack.js';
import { analyze } from '../src/engine/check.js';
import { buildModel } from '../src/engine/pipeline.js';
import { partsList, wantedXml } from '../src/engine/bricklink.js';
import { PRESETS } from '../src/presets/index.js';
import { COLORS, colorIndex } from '../src/engine/palette.js';
import { BRICKS, PLATES } from '../src/engine/parts.js';
import { generate } from '../src/ai/claude.js';

const box = (color, pos, size, extra = {}) => ({ shape: 'box', color, pos, size, ...extra });

describe('spec validation', () => {
  it('rejects unknown colours, bad shapes and shapes outside the footprint, in plain words', () => {
    const r = validateSpec({ footprint: [4, 4], shapes: [box('Chartreuse', [0, 0, 0], [1, 1, 1]), { shape: 'torus', color: 'Red', pos: [0, 0, 0], size: [1, 1, 1] }, box('Red', [3, 0, 3], [3, 1, 3])] });
    expect(r.spec).toBeNull();
    expect(r.problems.join('\n')).toMatch(/not in the LEGO palette/);
    expect(r.problems.join('\n')).toMatch(/unknown shape "torus"/);
    expect(r.problems.join('\n')).toMatch(/outside the footprint/);
  });
  it('accepts colour spellings and snaps hex colours to a real LEGO colour', () => {
    expect(colorIndex('light bluish grey')).toBe(colorIndex('Light Bluish Gray'));
    const r = validateSpec({ footprint: [2, 2], shapes: [box('#ff0000', [0, 0, 0], [2, 1, 2])] });
    expect(COLORS[r.spec.shapes[0].color].name).toBe('Red');
  });
});

describe('voxelizer', () => {
  it('a 2x1x2 box of 1 brick is 4 x 3 voxels', () => {
    const { spec } = validateSpec({ footprint: [2, 2], shapes: [box('Red', [0, 0, 0], [2, 1, 2])] });
    const g = voxelize(spec);
    expect(g.cells.filter(Boolean).length).toBe(12);
    expect([g.W, g.H, g.D]).toEqual([2, 3, 2]);
  });
  it('subtract carves and paint recolours without adding', () => {
    const { spec } = validateSpec({ footprint: [4, 4], shapes: [box('Red', [0, 0, 0], [4, 1, 4]), box(null, [1, 0, 1], [2, 1, 2], { op: 'subtract' }), box('Blue', [0, 0, 0], [4, 1, 1], { op: 'paint' })] });
    const g = voxelize(spec);
    expect(g.cells.filter(Boolean).length).toBe(48 - 12);
    expect(g.cells.filter((c) => c === colorIndex('Blue') + 1).length).toBe(12);
  });
  it('mirror duplicates across the footprint centre', () => {
    const { spec } = validateSpec({ footprint: [8, 2], shapes: [box('Red', [0, 0, 0], [1, 1, 2], { mirror: 'x' })] });
    const g = voxelize(spec);
    expect(g.W).toBe(8);
    expect(g.cells.filter(Boolean).length).toBe(2 * 2 * 3);
  });
});

describe('packing produces only real parts and covers every voxel exactly once', () => {
  const rnd = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  it('random shape soups', () => {
    const shapes = ['box', 'ellipsoid', 'cylinder', 'cone', 'pyramid', 'wedge', 'gable'];
    const names = COLORS.map((c) => c.name);
    for (let t = 0; t < 25; t++) {
      const r = rnd(t + 1);
      const list = [];
      for (let i = 0; i < 6; i++) {
        const sx = 1 + Math.floor(r() * 8), sz = 1 + Math.floor(r() * 8);
        list.push({ shape: shapes[Math.floor(r() * shapes.length)], color: names[Math.floor(r() * 6)], pos: [Math.floor(r() * (12 - sx)), Math.floor(r() * 3), Math.floor(r() * (12 - sz))], size: [sx, 1 + Math.floor(r() * 3), sz] });
      }
      const { spec } = validateSpec({ footprint: [12, 12], shapes: list });
      const g = voxelize(spec);
      if (g.empty) continue;
      for (const [seed, off, soft] of [[0, 0, false], [3, 1, true], [7, 2, false]]) {
        const parts = pack(g, seed, off, soft);
        const an = analyze(g, parts);
        expect(an.overlap + an.uncovered + an.colorMismatch + an.outside).toBe(0);
        const allowed = new Set([...BRICKS.map((b) => 'brick' + b.s.join('x')), ...PLATES.map((b) => 'plate' + b.s.join('x'))]);
        parts.forEach((p) => expect(allowed.has(p.kind + Math.min(p.w, p.d) + 'x' + Math.max(p.w, p.d))).toBe(true));
      }
    }
  });
});

describe('connectivity check', () => {
  const tower = (x) => box('Red', [x, 0, 0], [2, 3, 2]);
  it('flags two separate towers and names them for the AI', () => {
    const r = buildModel({ footprint: [10, 2], shapes: [tower(0), tower(6)] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/not attached to the main model/);
    expect(r.problems[0]).toMatch(/studs in x/);
    expect(r.model.steps).toHaveLength(0);
  });
  it('flags side-by-side contact as not joined (LEGO parts cannot clip sideways)', () => {
    const r = buildModel({ footprint: [4, 2], shapes: [box('Red', [0, 0, 0], [2, 1, 2]), box('Blue', [2, 0, 0], [2, 1, 2])] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/only side-on/);
  });
  it('accepts the same two blocks once a bridge overlaps both vertically', () => {
    const r = buildModel({ footprint: [4, 2], shapes: [box('Red', [0, 0, 0], [2, 1, 2]), box('Blue', [2, 0, 0], [2, 1, 2]), box('Yellow', [1, 1, 0], [2, 1, 2])] });
    expect(r.ok).toBe(true);
    expect(r.model.check.stats.components).toBe(1);
  });
  it('a hidden single-stud hinge is reported as fragile', () => {
    const r = buildModel({ footprint: [12, 2], shapes: [box('Red', [0, 0, 0], [5, 8, 2]), box('Blue', [6, 0, 0], [6, 8, 2]), box('Yellow', [4, 8, 0], [3, 1, 1])] });
    expect(r.warnings.join(' ')).toMatch(/single stud|fragile/);
  });
});

describe('every ready-made build passes the same checks', () => {
  for (const p of PRESETS) {
    it(p.title, () => {
      const r = buildModel(p.spec);
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
      const m = r.model;
      expect(m.check.stats.components).toBe(1);
      // steps: 1..4 pieces, every part exactly once
      const seen = new Set();
      m.steps.forEach((s) => { expect(s.parts.length).toBeGreaterThanOrEqual(1); expect(s.parts.length).toBeLessThanOrEqual(4); s.parts.forEach((id) => { expect(seen.has(id)).toBe(false); seen.add(id); }); });
      expect(seen.size).toBe(m.parts.length);
      // build order: every part is on the ground or touches something placed earlier
      const byOrder = m.parts.slice().sort((a, b) => a.order - b.order);
      const placed = new Set();
      byOrder.forEach((part) => {
        const ok = part.y === 0 || m.check.an.adj[part.id].some((e) => placed.has(e.to));
        expect(ok).toBe(true);
        placed.add(part.id);
      });
    });
  }
});

describe('BrickLink export', () => {
  it('quantities add up and XML has the wanted-list fields', () => {
    const { model } = buildModel(PRESETS[0].spec);
    const list = partsList(model.parts);
    expect(list.reduce((n, l) => n + l.qty, 0)).toBe(model.parts.length);
    const xml = wantedXml(list);
    expect(xml.startsWith('<INVENTORY>')).toBe(true);
    expect((xml.match(/<ITEM>/g) || []).length).toBe(list.length);
    expect(xml).toMatch(/<ITEMTYPE>P<\/ITEMTYPE>\s*<ITEMID>\d+<\/ITEMID>\s*<COLOR>\d+<\/COLOR>\s*<MINQTY>\d+<\/MINQTY>/);
  });
});

describe('AI loop (model replaced by a fake)', () => {
  const broken = { name: 'Two towers', footprint: [10, 2], shapes: [box('Red', [0, 0, 0], [2, 3, 2], { label: 'left' }), box('Blue', [6, 0, 0], [2, 3, 2], { label: 'right' })] };
  const fixed = { ...broken, shapes: [...broken.shapes, box('Yellow', [1, 3, 0], [6, 1, 2], { label: 'bridge' })] };

  it('sends the problems back, then accepts the fixed description', async () => {
    const seen = [];
    const answers = [broken, fixed];
    const events = [];
    const res = await generate({
      prompt: 'two towers with a bridge', key: 'k', model: 'm', onEvent: (e) => events.push(e.type + (e.ok !== undefined ? ':' + e.ok : '')),
      request: async ({ messages }) => { seen.push(JSON.parse(JSON.stringify(messages))); return answers.shift(); },
    });
    expect(res.ok).toBe(true);
    expect(res.rounds).toBe(2);
    expect(seen[0]).toHaveLength(1);
    expect(seen[1]).toHaveLength(3);
    const feedback = seen[1][2].content[0].text;
    expect(feedback).toMatch(/not attached to the main model/);
    expect(feedback).toMatch(/#1 right|#0 left/);
    expect(seen[1][1].content[0].text).toMatch(/Two towers/); // the previous description is echoed
    expect(events).toEqual(['ask', 'built:false', 'ask', 'built:true']);
  });

  it('after 3 failed rounds it drops the loose group and says so instead of failing silently', async () => {
    let calls = 0;
    const res = await generate({ prompt: 'x', key: 'k', model: 'm', request: async () => { calls++; return broken; } });
    expect(calls).toBe(3);
    expect(res.ok).toBe(true);
    expect(res.pruned).toBe(true);
    expect(res.model.check.stats.components).toBe(1);
    expect(res.prunedProblems.length).toBeGreaterThan(0);
  });

  it('sends a picture as an image block', async () => {
    let first;
    await generate({ prompt: '', image: { mediaType: 'image/jpeg', data: 'AAAA' }, key: 'k', model: 'm', request: async ({ messages }) => { first = messages[0]; return fixed; } });
    expect(first.content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  });
});
