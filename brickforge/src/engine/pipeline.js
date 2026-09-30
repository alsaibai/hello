// spec (shapes) -> voxels -> real parts -> checks -> steps. No AI in here.
import { validateSpec, voxelize, trim, LIMITS } from './spec.js';

/** Problems for shapes that changed nothing, and warnings for shapes hidden by later ones. */
function noopFindings(spec, grid) {
  const problems = [], warnings = [];
  const visible = new Map();
  if (grid.owner) grid.owner.forEach((o) => { if (o >= 0) visible.set(o, (visible.get(o) || 0) + 1); });
  spec.shapes.forEach((s, i) => {
    const tag = `shape #${i} (${s.label})`;
    const changed = (grid.effect && grid.effect.get(i)) || 0;
    if (changed > 0) { if (s.op === 'add' && !visible.get(i)) warnings.push(`${tag} is completely covered by later shapes, so it does not show.`); return; }
    if (s.op === 'paint') problems.push(`${tag}: paint changed nothing. Paint only recolours voxels that already exist with a different colour, so list it AFTER the shape it recolours and make it overlap that shape.`);
    else if (s.op === 'subtract') problems.push(`${tag}: subtract removed nothing. It must come AFTER the shape it cuts and overlap it.`);
    else problems.push(`${tag} adds nothing: it is too small or lies where nothing can be placed. A shape must contain at least the centre of one 1-stud, 1-plate cell (size >= 1 stud in x and z, >= 0.333 in y).`);
  });
  (grid.hollowNoop ? [...grid.hollowNoop] : []).forEach((i) => warnings.push(`shape #${i} (${spec.shapes[i].label}): hollow:true removed nothing (it needs to be wider than ${2 * spec.shapes[i].wall} studs and the walls thick enough to leave a cavity).`));
  return { problems, warnings };
}

/** The shapes that account for the most parts (for the oversize message). */
function biggestShapes(parts, grid, spec) {
  const n = new Map();
  for (const p of parts) { const o = grid.owner[(p.y * grid.D + p.z) * grid.W + p.x]; n.set(o, (n.get(o) || 0) + 1); }
  return [...n.entries()].filter(([o]) => o >= 0 && spec.shapes[o]).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([o, c]) => `#${o} ${spec.shapes[o].label} (${spec.shapes[o].shape}, about ${c} parts)`).join(', ');
}
import { pack, repair, applyTiles } from './pack.js';
import { stability } from './stability.js';
import { BASEPLATES, partNo, partName } from './parts.js';
import { colorIndex } from './palette.js';

/** A real baseplate under the model (square, smallest of 16/32/48 that fits); ground-level parts attach to it. */
export function withBaseplate(parts, grid) {
  const need = Math.max(grid.W, grid.D);
  const bp = BASEPLATES.find((b) => b.n >= need) || BASEPLATES[BASEPLATES.length - 1];
  const n = bp.n;
  const base = { kind: 'baseplate', x: -Math.floor((n - grid.W) / 2), z: -Math.floor((n - grid.D) / 2), w: n, d: n, y: -1, h: 1, color: colorIndex('Green'), no: partNo('baseplate', n, n), name: partName('baseplate', n, n), band: -1, id: parts.length };
  return [...parts, base];
}
import { check, analyze } from './check.js';
import { makeSteps } from './steps.js';
import { partsList } from './bricklink.js';

/** Pack with several strategies and keep the best (fewest loose groups, then fewest parts). */
export function bestPack(grid, { budgetMs = 2500 } = {}) {
  const scratch = new Int32Array(grid.W * grid.H * grid.D);
  const analyzeFast = (g, p) => analyze(g, p, { scratch, cells: false });
  const vox = grid.cells.reduce((n, c) => n + (c ? 1 : 0), 0);
  const seeds = vox < 8000 ? 16 : vox < 25000 ? 8 : 4; // bigger models: fewer tries so the build stays fast
  const offsets = grid.slopePhase !== undefined ? [grid.slopePhase] : [0, 1, 2]; // slopes fix the brick rhythm
  const tries = [];
  for (const offset of offsets) {
    for (let s = 0; s < seeds; s++) {
      for (const soften of [false, true]) {
        const parts = pack(grid, s, offset, soften);
        const res = check(grid, parts, { shapes: [] }, { quick: true });
        tries.push({ parts, score: [res.stats.components, res.stats.parts + res.stats.weakLinks * 3], seed: s, offset, soften });
      }
    }
  }
  const over = (t) => (t.score[1] > LIMITS.maxParts ? 1 : 0);
  const cmp = (a, b) => over(a) - over(b) || a.score[0] - b.score[0] || a.score[1] - b.score[1];
  tries.sort(cmp);
  let best = tries[0];
  // Try to heal loose groups by re-tiling neighbours. Only worth it when there are a few; a model in
  // dozens of pieces is a design problem for the AI to fix, and we cap the time spent.
  // (also when the connected packings are all over the part limit but a lighter one is only a few groups away)
  const lighter = [...tries].sort((a, b) => a.score[1] - b.score[1]);
  if (best.score[0] === 1 && over(best) && lighter[0].score[1] <= LIMITS.maxParts && lighter[0].score[0] <= 12) {
    const fixed = repair(grid, lighter[0].parts, analyzeFast, lighter[0].seed, Date.now() + budgetMs);
    const res = check(grid, fixed, { shapes: [] }, { quick: true });
    const cand = { parts: fixed, score: [res.stats.components, res.stats.parts + res.stats.weakLinks * 3], seed: lighter[0].seed, offset: lighter[0].offset, repaired: true };
    if (cmp(cand, best) < 0) best = cand;
  }
  if (best.score[0] > 1 && best.score[0] <= 12) {
    const deadline = Date.now() + budgetMs;
    for (const t of tries.slice(0, 4)) {
      if (Date.now() > deadline) break;
      const fixed = repair(grid, t.parts, analyzeFast, t.seed, deadline);
      const res = check(grid, fixed, { shapes: [] }, { quick: true });
      const cand = { parts: fixed, score: [res.stats.components, res.stats.parts + res.stats.weakLinks * 3], seed: t.seed, offset: t.offset, repaired: true };
      if (cmp(cand, best) < 0) best = cand;
      if (best.score[0] === 1) break;
    }
  }
  // Loose groups made of bricks (a one-brick-thick slab, say) can often be joined by laying those bands as
  // staggered plates instead: three thin layers interlock where one thick layer cannot. Never for bands with slopes.
  for (let round = 0; round < 3 && best.score[0] > 1; round++) {
    const an = analyze(grid, best.parts, { scratch, cells: false });
    const size = new Array(an.nComp).fill(0);
    an.comp.forEach((c) => { size[c]++; });
    const main = size.indexOf(Math.max(...size));
    const slopeBands = new Set(best.parts.filter((p) => p.kind === 'slope').map((p) => p.band));
    const bands = new Set(best.plateBands || []);
    best.parts.forEach((p, i) => { if (an.comp[i] !== main && p.kind === 'brick' && !slopeBands.has(p.band)) bands.add(p.band); });
    if (bands.size === (best.plateBands ? best.plateBands.size : 0)) break;
    let improved = null;
    for (const t of tries.slice(0, 6)) {
      const parts = pack(grid, t.seed, t.offset, t.soften, bands);
      const res = check(grid, parts, { shapes: [] }, { quick: true });
      const cand = { parts, score: [res.stats.components, res.stats.parts + res.stats.weakLinks * 3], seed: t.seed, offset: t.offset, soften: t.soften, plateBands: bands };
      if (cmp(cand, improved || best) < 0) improved = cand;
    }
    if (!improved) break;
    best = improved;
  }
  return best;
}

/**
 * Build a model from raw AI/preset JSON.
 * Returns { ok, problems[], warnings[], model? }. `problems` is what gets sent back to the AI.
 */
export function buildModel(raw, opts = {}) {
  const { spec, problems } = validateSpec(raw, opts);
  if (!spec) return { ok: false, problems, warnings: [] };
  const grid = voxelize(spec);
  if (grid.slopeConflict) return { ok: false, problems: [grid.slopeConflict], warnings: [] };
  if (grid.empty) return { ok: false, problems: ['The shapes produce no voxels (everything is empty or subtracted away). Check sizes and positions.'], warnings: [] };
  const noop = noopFindings(spec, grid);
  if (noop.problems.length) return { ok: false, problems: noop.problems, warnings: noop.warnings };
  return finish(spec, grid, raw, { ...opts, _warn: noop.warnings });
}

/** A ready-made voxel grid (e.g. a picture mosaic) goes through the same pack -> check -> steps path. */
export function buildFromGrid(grid, name, opts = {}) {
  const spec = { name, footprint: [grid.W, grid.D], shapes: [{ label: 'mosaic', shape: 'box' }] };
  return finish(spec, grid, spec, opts);
}

function finish(spec, grid, raw, opts) {
  // Way over the part limit? Say so at once instead of optimising something that cannot be accepted.
  const probeParts = pack(grid, 0, grid.slopePhase || 0), probe = probeParts.length;
  if (probe > LIMITS.maxParts * 1.3) {
    return { ok: false, warnings: [], problems: [`The model needs roughly ${probe} parts but the limit is ${LIMITS.maxParts}. Biggest: ${biggestShapes(probeParts, grid, spec)}. Make those smaller, use hollow:true, or replace curved shapes (much more expensive than boxes) with boxes.`] };
  }
  let { parts } = bestPack(grid);
  if (opts.tiles) parts = applyTiles(parts, grid);
  if (opts.baseplate) parts = withBaseplate(parts, grid);
  const res = check(grid, parts, spec);
  if (res.ok) { const st = stability(parts, res.an, grid.offset); res.warnings.push(...st.warnings); }
  const errs = res.errors.map((e) => e.message);
  if (parts.length > LIMITS.maxParts) errs.unshift(`The model needs ${parts.length} parts but the limit is ${LIMITS.maxParts}. Biggest: ${biggestShapes(parts, grid, spec)}. Make those smaller or hollow (hollow:true), or use boxes instead of curved shapes.`);
  const stepData = res.ok ? makeSteps(parts, res.an) : null;
  if (res.ok && !stepData) errs.push('No valid build order exists.');
  let model = { name: spec.name, spec, raw, mosaic: !!(spec.shapes[0] && spec.shapes[0].label === 'mosaic'), grid, parts, check: res, steps: stepData ? stepData.steps : [], list: partsList(parts) };
  const ok = errs.length === 0;
  if (!ok && opts.prune) {
    const pruned = pruneLoose(model);
    if (pruned) return { ok: true, problems: [], warnings: [...(opts._warn || []), ...pruned.check.warnings.map((w) => w.message)], model: pruned, pruned: true, prunedProblems: errs };
  }
  return { ok, problems: errs, warnings: [...(opts._warn || []), ...res.warnings.map((w) => w.message)], model };
}

/** Last resort after the AI failed to fix a model: keep the biggest connected group (by volume), drop the rest. */
export function pruneLoose(model) {
  const { grid, spec, check: res } = model;
  if (res.stats.components < 2) return null;
  const vol = new Array(res.an.nComp).fill(0);
  model.parts.forEach((p, i) => { vol[res.an.comp[i]] += p.w * p.d * p.h; });
  const total = vol.reduce((a, b) => a + b, 0);
  const main = vol.indexOf(Math.max(...vol));
  const dropped = Math.round((100 * (total - vol[main])) / total);
  if (dropped > 50) return null; // would delete most of the model: better to fail loudly than to show a stump
  const cells = grid.cells.slice(), owner = grid.owner.slice(), slope = grid.slope ? grid.slope.slice() : new Uint8Array(cells.length);
  model.parts.forEach((p, i) => {
    if (res.an.comp[i] === main) return;
    for (let j = p.y; j < p.y + p.h; j++) for (let k = p.z; k < p.z + p.d; k++) for (let x = p.x; x < p.x + p.w; x++) { const a = (j * grid.D + k) * grid.W + x; cells[a] = 0; owner[a] = -1; slope[a] = 0; }
  });
  // crop to what is left so the model sits on layer 0 again
  const t = trim({ W: grid.W, H: grid.H, D: grid.D, cells, owner, slope });
  if (t.empty) return null;
  const g2 = { ...t, offset: [0, 1, 2].map((n) => (grid.offset ? grid.offset[n] : 0) + t.offset[n]), effect: grid.effect, hollowNoop: grid.hollowNoop };
  if (grid.slopePhase !== undefined) g2.slopePhase = (((grid.slopePhase - t.offset[1]) % 3) + 3) % 3;
  const { parts } = bestPack(g2, { budgetMs: 1200 }); // the prune path already spent the full search once
  const r2 = check(g2, parts, spec);
  if (!r2.ok || parts.length > LIMITS.maxParts) return null;
  const sd = makeSteps(parts, r2.an);
  if (!sd) return null;
  return { ...model, grid: g2, parts, check: r2, steps: sd.steps, list: partsList(parts), removedGroups: res.stats.components - 1, removedPercent: dropped };
}
