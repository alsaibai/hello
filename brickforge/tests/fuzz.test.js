import { describe, it, expect } from 'vitest';
import { buildModel } from '../src/engine/pipeline.js';
import { analyze } from '../src/engine/check.js';
import { COLORS } from '../src/engine/palette.js';

// Random shape soups (every shape, op, mirror, option): buildModel must never throw, always explain a rejection,
// and every model it accepts must satisfy the invariants.
describe('fuzz: random specs', () => {
  it('never crashes; every accepted model is exact, one piece, buildable, <= 4 per step', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const SH = ['box', 'cylinder', 'cone', 'ellipsoid', 'pyramid', 'wedge', 'gable', 'slope', 'roof'];
    const names = COLORS.map((c) => c.name);
    let accepted = 0;
    for (let t = 0; t < 45; t++) {
      const W = 4 + Math.floor(rnd() * 16), D = 4 + Math.floor(rnd() * 16), shapes = [];
      for (let i = 0, n = 1 + Math.floor(rnd() * 8); i < n; i++) {
        const shape = pick(SH), sx = 1 + Math.floor(rnd() * (W - 1)), sz = 1 + Math.floor(rnd() * (D - 1));
        const s = { shape, color: pick(names), pos: [Math.floor(rnd() * (W - sx + 1)), Math.floor(rnd() * 4) * (rnd() < 0.7 ? 1 : 0.333), Math.floor(rnd() * (D - sz + 1))], size: [sx, 1 + Math.floor(rnd() * 5), sz] };
        if (rnd() < 0.3) s.hollow = rnd() < 0.7;
        if (rnd() < 0.2) s.op = pick(['add', 'subtract', 'paint']);
        if (rnd() < 0.3) s.mirror = pick(['x', 'z', 'xz']);
        if (rnd() < 0.2) s.axis = pick(['x', 'y', 'z']);
        if (rnd() < 0.2) s.dir = pick(['+x', '-x', '+z', '-z']);
        if (i === 0) s.op = 'add';
        shapes.push(s);
      }
      const opts = { tiles: rnd() < 0.3, baseplate: rnd() < 0.3, commonOnly: rnd() < 0.2, prune: rnd() < 0.3 };
      const r = buildModel({ name: 'fuzz', footprint: [W, D], shapes }, opts);
      if (!r.ok) { expect(r.problems.length).toBeGreaterThan(0); continue; }
      accepted++;
      const m = r.model, an = analyze(m.grid, m.parts);
      expect(an.overlap + an.uncovered + an.colorMismatch + an.outside).toBe(0);
      expect(m.check.stats.components).toBe(1);
      expect(m.steps.every((s) => s.parts.length >= 1 && s.parts.length <= 4)).toBe(true);
      const placed = new Set();
      for (const p of m.parts.slice().sort((a, b) => a.order - b.order)) {
        expect(p.kind === 'baseplate' || p.y === 0 || an.adj[p.id].some((e) => placed.has(e.to))).toBe(true);
        placed.add(p.id);
      }
    }
    expect(accepted).toBeGreaterThan(3);
  }, 240000);
});
