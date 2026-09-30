import { studCells } from './parts.js';
// Verifies a packed model: exact coverage, ONE connected piece, and what is fragile.
// Two parts are joined only if one sits on top of the other with studs overlapping.

/** Part-id grid + stud-overlap graph + union-find components. */
export function analyze(grid, parts, o = {}) {
  const scratch = o instanceof Int32Array ? o : o.scratch || null, withCells = o.cells !== false && !(o instanceof Int32Array); // hot loops pass a scratch buffer and no cells
  const { W, H, D, cells } = grid;
  // `scratch` lets hot loops (repair) reuse one buffer instead of allocating thousands of big arrays; the result's `ids` is then only valid until the next call
  const ids = scratch && scratch.length === W * H * D ? scratch.fill(-1) : new Int32Array(W * H * D).fill(-1);
  let overlap = 0, colorMismatch = 0, outside = 0;
  for (const p of parts) {
    if (p.kind === 'baseplate') continue;
    if (p.x < 0 || p.z < 0 || p.y < 0 || p.x + p.w > W || p.z + p.d > D || p.y + p.h > H) { outside++; continue; }
    for (let j = p.y; j < p.y + p.h; j++) for (let k = p.z; k < p.z + p.d; k++) for (let i = p.x; i < p.x + p.w; i++) {
      const a = (j * D + k) * W + i;
      if (ids[a] !== -1) overlap++;
      ids[a] = p.id;
      if (cells[a] !== p.color + 1) colorMismatch++;
    }
  }
  let uncovered = 0;
  for (let a = 0; a < cells.length; a++) if (cells[a] && ids[a] === -1) uncovered++;

  const N = parts.length + 1;
  const edges = new Map(); // lo * N + hi (lo = the lower part) -> { studs, cells? }
  for (const p of parts) {
    const jt = p.y + p.h;
    if (jt >= H) continue;
    for (const [i, k] of studCells(p)) {
      const q = ids[(jt * D + k) * W + i];
      if (q >= 0 && q !== p.id) {
        const key = p.id * N + q;
        let e = edges.get(key);
        if (!e) { e = { studs: 0, cells: withCells ? [] : null }; edges.set(key, e); }
        e.studs++; if (withCells) e.cells.push([i, k]);
      }
    }
  }
  const adj = parts.map(() => []);
  const list = [];
  // a baseplate holds every ground-level part
  const base = parts.find((p) => p.kind === 'baseplate');
  if (base) for (const p of parts) if (p.kind !== 'baseplate' && p.y === 0) {
    const cs = []; if (withCells) for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) cs.push([x, z]);
    edges.set(base.id * N + p.id, { studs: p.w * p.d, cells: withCells ? cs : null });
  }
  for (const [key, { studs, cells: cs }] of edges) {
    const lo = Math.floor(key / N), hi = key % N;
    adj[lo].push({ to: hi, studs, up: true }); adj[hi].push({ to: lo, studs, up: false });
    list.push({ lo, hi, studs, cells: cs });
  }
  const comp = new Int32Array(parts.length).fill(-1);
  let n = 0;
  for (let s = 0; s < parts.length; s++) {
    if (comp[s] >= 0) continue;
    const st = [s]; comp[s] = n;
    while (st.length) { const u = st.pop(); for (const e of adj[u]) if (comp[e.to] < 0) { comp[e.to] = n; st.push(e.to); } }
    n++;
  }
  return { ids, adj, edges: list, comp, nComp: n, overlap, uncovered, colorMismatch, outside };
}

/** Bridges of the part graph (links whose loss splits the model), with the size of the smaller side. */
export function weakLinks(parts, an) {
  const n = parts.length, disc = new Int32Array(n).fill(-1), low = new Int32Array(n), size = new Int32Array(n);
  const out = [];
  let t = 0;
  const dfs = (u, pe) => {
    disc[u] = low[u] = t++; size[u] = 1;
    for (const e of an.adj[u]) {
      if (e.to === pe) continue;
      if (disc[e.to] >= 0) { low[u] = Math.min(low[u], disc[e.to]); continue; }
      dfs(e.to, u);
      size[u] += size[e.to];
      low[u] = Math.min(low[u], low[e.to]);
      if (low[e.to] > disc[u]) out.push({ a: u, b: e.to, studs: e.studs, sub: size[e.to], root: r });
    }
  };
  let r = 0;
  for (let s = 0; s < n; s++) if (disc[s] < 0) { r = s; const before = out.length; dfs(s, -1); const compSize = size[s]; for (let i = before; i < out.length; i++) { out[i].side = Math.min(out[i].sub, compSize - out[i].sub); } }
  return out;
}

const fmt = (v) => (Math.round(v * 100) / 100).toString();

/**
 * Full check. Returns { ok, errors[], warnings[], stats, an, steps[] }.
 * `errors` are worded so they can be pasted straight back to the AI.
 */
export function check(grid, parts, spec, opts = {}) {
  const errors = [], warnings = [];
  const an = analyze(grid, parts, { cells: !opts.quick });
  const off = grid.offset || [0, 0, 0];
  if (an.uncovered) errors.push({ code: 'uncovered', message: `Internal: ${an.uncovered} voxels are not covered by a part.` });
  if (an.overlap) errors.push({ code: 'overlap', message: `Internal: ${an.overlap} voxels are covered twice.` });
  if (an.colorMismatch) errors.push({ code: 'color', message: `Internal: ${an.colorMismatch} voxels have the wrong colour.` });
  if (an.outside) errors.push({ code: 'outside', message: `Internal: ${an.outside} parts lie outside the grid.` });

  if (an.nComp > 1 && !opts.quick) {
    const sizes = new Array(an.nComp).fill(0);
    an.comp.forEach((c) => { sizes[c]++; });
    const main = sizes.indexOf(Math.max(...sizes));
    const { W, H, D, cells, owner } = grid;
    // BFS through empty space from each loose component to the main body.
    const vc = new Int32Array(W * H * D).fill(-1);
    for (let a = 0; a < an.ids.length; a++) if (an.ids[a] >= 0) vc[a] = an.comp[an.ids[a]];
    // describe the biggest loose groups in detail (each needs a search); just count the rest
    const looseIds = [...sizes.keys()].filter((c) => c !== main).sort((a, b) => sizes[b] - sizes[a]);
    if (looseIds.length > 6) errors.push({ code: 'disconnected-many', message: `${looseIds.length} separate loose piece groups in total; the 6 largest are listed. Most likely thin rims or details that only touch their neighbours side-on, so give them overlap above or below.` });
    for (const c of looseIds.slice(0, 6)) {
      const mem = parts.filter((p, i) => an.comp[i] === c);
      const shapes = new Set(); let vox = 0;
      let lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
      const src = [];
      for (let a = 0; a < vc.length; a++) if (vc[a] === c) {
        vox++;
        const i = a % W, k = Math.floor(a / W) % D, j = Math.floor(a / (W * D));
        lo = [Math.min(lo[0], i), Math.min(lo[1], j), Math.min(lo[2], k)];
        hi = [Math.max(hi[0], i), Math.max(hi[1], j), Math.max(hi[2], k)];
        if (owner[a] >= 0) shapes.add(owner[a]);
        src.push(a);
      }
      const from = new Int32Array(W * H * D).fill(-1), dist = new Int32Array(W * H * D).fill(-1);
      let q = src.slice(); src.forEach((a) => { from[a] = a; dist[a] = 0; });
      let hit = null;
      for (let h = 0; h < q.length && !hit; h++) {
        const a = q[h], i = a % W, k = Math.floor(a / W) % D, j = Math.floor(a / (W * D));
        for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const ni = i + di, nj = j + dj, nk = k + dk;
          if (ni < 0 || nj < 0 || nk < 0 || ni >= W || nj >= H || nk >= D) continue;
          const b = (nj * D + nk) * W + ni;
          if (dist[b] >= 0) continue;
          if (vc[b] === main) { hit = { from: from[a], to: b, d: dist[a] + 1 }; break; }
          if (vc[b] >= 0) continue;
          dist[b] = dist[a] + 1; from[b] = from[a]; q.push(b);
        }
      }
      const xyz = (a) => [a % W, Math.floor(a / (W * D)), Math.floor(a / W) % D];
      const names = [...shapes].map((s) => `#${s} ${spec.shapes[s].label}`).join(', ') || 'unknown shapes';
      const where = `x ${lo[0] + off[0]}..${hi[0] + off[0] + 1}, y ${fmt((lo[1] + off[1]) / 3)}..${fmt((hi[1] + off[1] + 1) / 3)} bricks, z ${lo[2] + off[2]}..${hi[2] + off[2] + 1}`;
      let advice;
      if (!hit) advice = 'It has no route to the main body at all.';
      else if (hit.d === 1) advice = 'It touches the main body only side-on or at one face level: LEGO parts cannot join sideways. Make the shapes overlap so that a piece of one sits directly above or below a piece of the other (extend one shape at least 1 brick up or down into the other, with at least 1 stud of overlap).';
      else {
        const [a1, b1, c1] = xyz(hit.from), [a2, b2, c2] = xyz(hit.to);
        advice = `Nearest point of the main body is about ${Math.abs(a2 - a1)} studs in x, ${fmt(Math.abs(b2 - b1) / 3)} bricks in y, ${Math.abs(c2 - c1)} studs in z away. Extend or move one shape so they overlap by at least 1 stud and 1 brick vertically.`;
      }
      errors.push({
        code: 'disconnected', component: c, parts: mem.length, shapes: [...shapes],
        message: `Loose piece group (${mem.length} parts, ${vox} voxels; from ${names}) at ${where} is not attached to the main model. ${advice}`,
      });
    }
  }

  const weak = weakLinks(parts, an).filter((w) => w.studs <= 1 && w.side >= 6 && parts.length - w.side >= 6);
  weak.slice(0, 3).forEach((w) => {
    const p = parts[w.b];
    warnings.push({ code: 'fragile', message: `A group of ${w.side} parts hangs on a single stud near x ${p.x + off[0]}, z ${p.z + off[2]}; it will be fragile. Overlap more.` });
  });
  const overhang = parts.filter((p, i) => p.y > 0 && !an.adj[i].some((e) => !e.up)).length;
  if (overhang) warnings.push({ code: 'overhang', message: `${overhang} parts have nothing below them and are pressed on from underneath (the steps say when).` });

  const stats = {
    parts: parts.length, bricks: parts.filter((p) => p.kind === 'brick').length,
    plates: parts.filter((p) => p.kind === 'plate').length, tiles: parts.filter((p) => p.kind === 'tile').length,
    slopes: parts.filter((p) => p.kind === 'slope').length, baseplate: parts.some((p) => p.kind === 'baseplate'), components: an.nComp,
    colors: new Set(parts.map((p) => p.color)).size, weakLinks: weak.length, overhang,
    size: [grid.W, grid.H / 3, grid.D],
  };
  return { ok: errors.length === 0, errors, warnings, stats, an };
}
