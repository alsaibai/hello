// Turns a voxel grid into real bricks and plates. Deterministic for a given seed.
import { sizesFor, partNo, partName, hasTile } from './parts.js';
import { DIR_VEC } from './spec.js';

function rng(seed) {
  let a = (seed * 2654435761 + 1013904223) >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Tile one horizontal layer with rectangles of a single colour each.
 * col: Uint8Array(W*D) colour+1 (0 = none). below: seam map of the layer beneath (to stagger joints).
 */
function packLayer(W, D, col, kind, r, below, flipX, flipZ, support = null, noise = 1.6) {
  const sizes = sizesFor(kind);
  const cand = [];
  for (const [a, b] of sizes) { cand.push([a, b]); if (a !== b) cand.push([b, a]); }
  const used = new Uint8Array(W * D);
  const ex = new Uint8Array((W + 1) * D), ez = new Uint8Array(W * (D + 1));
  const rects = [];
  const filled = (i, k) => i >= 0 && i < W && k >= 0 && k < D && col[k * W + i] > 0;
  // cells without a stud above/below are tiled first so they can grab a supported neighbour
  const order = [];
  for (let kk = 0; kk < D; kk++) for (let ii = 0; ii < W; ii++) order.push([flipX ? W - 1 - ii : ii, flipZ ? D - 1 - kk : kk]);
  if (support) order.sort((a, b) => (support[a[1] * W + a[0]] ? 1 : 0) - (support[b[1] * W + b[0]] ? 1 : 0));
  for (const [i, k] of order) {
    const c = col[k * W + i];
    if (!c || used[k * W + i]) continue;
    let best = null, bs = -Infinity;
    const needy = support && !support[k * W + i];
    for (const [w, d] of cand) {
      // normal cells anchor a rectangle at their corner; cells with no stud above/below may be covered from any side
      const offs = needy ? [] : [[flipX ? i - w + 1 : i, flipZ ? k - d + 1 : k]];
      if (needy) for (let oz = 0; oz < d; oz++) for (let ox = 0; ox < w; ox++) offs.push([i - ox, k - oz]);
      for (const [x0, z0] of offs) {
        if (x0 < 0 || z0 < 0 || x0 + w > W || z0 + d > D) continue;
        let ok = true;
        for (let z = z0; z < z0 + d && ok; z++) for (let x = x0; x < x0 + w; x++) {
          if (col[z * W + x] !== c || used[z * W + x]) { ok = false; break; }
        }
        if (!ok) continue;
        let pen = 0;
        if (below) {
          for (let z = z0; z < z0 + d; z++) {
            if (filled(x0 - 1, z) && below.ex[x0 * D + z]) pen++;
            if (filled(x0 + w, z) && below.ex[(x0 + w) * D + z]) pen++;
          }
          for (let x = x0; x < x0 + w; x++) {
            if (filled(x, z0 - 1) && below.ez[z0 * W + x]) pen++;
            if (filled(x, z0 + d) && below.ez[(z0 + d) * W + x]) pen++;
          }
        }
        let sup = 0;
        if (support) for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) sup += support[z * W + x];
        // a part with no stud above or below it can only hang on by its sides: strongly avoid
        const sc = w * d - 1.4 * pen + r() * noise - (support && !sup ? 40 : 0);
        if (sc > bs) { bs = sc; best = { x: x0, z: z0, w, d }; }
      }
    }
    if (!best) continue; // cannot happen: 1x1 always fits
    for (let z = best.z; z < best.z + best.d; z++) for (let x = best.x; x < best.x + best.w; x++) used[z * W + x] = 1;
    for (let z = best.z; z < best.z + best.d; z++) { ex[best.x * D + z] = 1; ex[(best.x + best.w) * D + z] = 1; }
    for (let x = best.x; x < best.x + best.w; x++) { ez[best.z * W + x] = 1; ez[(best.z + best.d) * W + x] = 1; }
    rects.push({ ...best, c: c - 1 });
  }
  return { rects, ex, ez };
}

/** Cells that have a filled voxel directly above or below the layer band [ja..jb]. */
function supportMap(grid, ja, jb) {
  const { W, H, D, cells } = grid;
  const m = new Uint8Array(W * D);
  for (let k = 0; k < D; k++) for (let i = 0; i < W; i++) {
    if ((ja > 0 && cells[((ja - 1) * D + k) * W + i]) || (jb + 1 < H && cells[((jb + 1) * D + k) * W + i])) m[k * W + i] = 1;
  }
  return m;
}

/**
 * grid -> parts[]. Bricks wherever 3 stacked voxels share a colour, plates for the rest.
 * `offset` (0..2) = number of plate-only layers at the bottom before the brick rhythm starts.
 */
export function pack(grid, seed = 0, offset = 0, soften = false, plateBands = null) {
  const { W, H, D, cells } = grid;
  const r = rng(seed * 3 + offset);
  const noise = seed < 3 ? 1.6 : 2 + seed; // later seeds explore more different tilings
  const parts = [];
  const seams = new Array(H).fill(null);
  const vox = (i, j, k) => cells[(j * D + k) * W + i];
  const flips = (j) => (seed === 0 ? [(j & 1) === 1, false] : [r() < 0.5, r() < 0.5]);

  let j0 = 0, band = 0;
  while (j0 < H) {
    const brickBand = j0 >= offset && j0 + 2 < H && !(plateBands && plateBands.has(band));
    const n = j0 < offset ? 1 : 3;
    const consumed = new Uint8Array(W * D);
    if (brickBand) {
      const col = new Uint8Array(W * D);
      for (let k = 0; k < D; k++) for (let i = 0; i < W; i++) {
        const c = vox(i, j0, k);
        if (c && c === vox(i, j0 + 1, k) && c === vox(i, j0 + 2, k)) { col[k * W + i] = c; consumed[k * W + i] = 1; }
      }
      // Slopes first: pair each slope-low cell with the full cell uphill of it (the part's studded end)
      const slopeUsed = new Uint8Array(W * D);
      if (grid.slope) {
        const sl = grid.slope;
        const vi = (i, j, k) => (j * D + k) * W + i;
        const lowAt = (i, k) => {
          const d = sl[vi(i, j0, k)];
          const c = vox(i, j0, k);
          return d && d === sl[vi(i, j0 + 1, k)] && d === sl[vi(i, j0 + 2, k)] && c && c === vox(i, j0 + 1, k) && c === vox(i, j0 + 2, k) ? d : 0;
        };
        const highOf = (i, k, d) => {
          const [dx, dz] = DIR_VEC[d], hi = i - dx, hk = k - dz;
          if (hi < 0 || hk < 0 || hi >= W || hk >= D) return null;
          const c = vox(i, j0, k);
          const full = col[hk * W + hi] === c && !sl[vi(hi, j0, hk)] && !sl[vi(hi, j0 + 1, hk)] && !sl[vi(hi, j0 + 2, hk)];
          return full && !slopeUsed[hk * W + hi] ? [hi, hk] : null;
        };
        for (let k = 0; k < D; k++) for (let i = 0; i < W; i++) {
          const d = lowAt(i, k);
          if (!d || slopeUsed[k * W + i]) continue;
          const hh = highOf(i, k, d);
          if (!hh) continue;
          const [dx] = DIR_VEC[d], alongX = dx !== 0;
          // try to widen across the slope to 2 studs
          const ni = alongX ? i : i + 1, nk = alongX ? k + 1 : k;
          let two = false, hh2 = null;
          if (ni < W && nk < D && !slopeUsed[nk * W + ni] && lowAt(ni, nk) === d && vox(ni, j0, nk) === vox(i, j0, k) && r() < 0.9) {
            hh2 = highOf(ni, nk, d);
            two = !!hh2 && !(hh2[0] === hh[0] && hh2[1] === hh[1]);
          }
          const cells2 = [[i, k, hh]];
          if (two) cells2.push([ni, nk, hh2]);
          const xs = cells2.flatMap(([a, , h]) => [a, h[0]]), zs = cells2.flatMap(([, b, h]) => [b, h[1]]);
          const x = Math.min(...xs), z = Math.min(...zs), w = Math.max(...xs) - x + 1, dd = Math.max(...zs) - z + 1;
          for (const [a, b, h] of cells2) { for (const [px, pz] of [[a, b], h]) { col[pz * W + px] = 0; consumed[pz * W + px] = 1; slopeUsed[pz * W + px] = 1; } }
          const across = alongX ? dd : w;
          parts.push({ kind: 'slope', x, z, w, d: dd, y: j0, h: 3, color: vox(i, j0, k) - 1, dir: d, no: partNo('slope', w, dd), name: partName('slope', w, dd), band, across });
        }
      }
      if (soften) {
        // cells where a brick column meets leftover plate voxels become plates too, so a plate can straddle the join
        const edge = [];
        for (let k = 0; k < D; k++) for (let i = 0; i < W; i++) {
          if (col[k * W + i] || slopeUsed[k * W + i]) continue;
          let any = false;
          for (let j = j0; j < j0 + 3; j++) if (vox(i, j, k)) any = true;
          if (!any) continue;
          for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const a = i + di, b = k + dk;
            if (a >= 0 && b >= 0 && a < W && b < D && col[b * W + a]) edge.push(b * W + a);
          }
        }
        for (const e of edge) { col[e] = 0; consumed[e] = 0; }
      }
      const [fx, fz] = flips(band);
      const sup = supportMap(grid, j0, j0 + 2);
      const { rects, ex, ez } = packLayer(W, D, col, 'brick', r, seams[j0 - 1] || null, fx, fz, sup, noise);
      for (const q of rects) parts.push({ ...mk('brick', q, j0, 3), band });
      for (let j = j0; j < j0 + 3; j++) seams[j] = mergeSeams(seams[j], { ex, ez });
    }
    for (let j = j0; j < Math.min(H, j0 + n); j++) {
      const col = new Uint8Array(W * D);
      let any = false;
      for (let k = 0; k < D; k++) for (let i = 0; i < W; i++) {
        if (!consumed[k * W + i] && vox(i, j, k)) { col[k * W + i] = vox(i, j, k); any = true; }
      }
      if (!any) continue;
      const [fx, fz] = flips(j + 1);
      const { rects, ex, ez } = packLayer(W, D, col, 'plate', r, seams[j - 1] || null, fx, fz, supportMap(grid, j, j), noise);
      for (const q of rects) parts.push({ ...mk('plate', q, j, 1), band });
      seams[j] = mergeSeams(seams[j], { ex, ez });
    }
    j0 += n; band++;
  }
  parts.forEach((p, id) => { p.id = id; });
  return parts;
}

function mergeSeams(a, b) {
  if (!a) return b;
  const ex = a.ex.slice(), ez = a.ez.slice();
  b.ex.forEach((v, i) => { if (v) ex[i] = 1; });
  b.ez.forEach((v, i) => { if (v) ez[i] = 1; });
  return { ex, ez };
}

function mk(kind, q, y, h) {
  return { kind, x: q.x, z: q.z, w: q.w, d: q.d, y, h, color: q.c, no: partNo(kind, q.w, q.d), name: partName(kind, q.w, q.d) };
}


/**
 * Exact search: tile `cells` (Set of z*W+x) with allowed rectangles so that EVERY rectangle contains at
 * least one supported cell (a stud above or below). Prefers big parts. Returns rects or null.
 */
function tileSupported(W, D, cells, support, kind, r, budget = 4000) {
  const sizes = [];
  for (const [a, b] of sizesFor(kind)) { sizes.push([a, b]); if (a !== b) sizes.push([b, a]); }
  const rem = new Set(cells), out = [];
  let nodes = 0;
  const order = [...cells].sort((p, q) => (p % W) + Math.floor(p / W) * 0.001 - ((q % W) + Math.floor(q / W) * 0.001));
  const dfs = () => {
    if (++nodes > budget) return false;
    let first = -1;
    for (const c of order) if (rem.has(c)) { first = c; break; }
    if (first < 0) return true;
    const x0 = first % W, z0 = Math.floor(first / W);
    const opts = [];
    for (const [w, d] of sizes) {
      if (x0 + w > W || z0 + d > D) continue;
      let ok = true, sup = false;
      for (let z = z0; z < z0 + d && ok; z++) for (let x = x0; x < x0 + w; x++) { const c = z * W + x; if (!rem.has(c)) { ok = false; break; } if (support[c]) sup = true; }
      if (ok && sup) opts.push({ x: x0, z: z0, w, d, k: w * d + r() * 3 });
    }
    opts.sort((a, b) => b.k - a.k);
    for (const o of opts) {
      for (let z = o.z; z < o.z + o.d; z++) for (let x = o.x; x < o.x + o.w; x++) rem.delete(z * W + x);
      out.push(o);
      if (dfs()) return true;
      out.pop();
      for (let z = o.z; z < o.z + o.d; z++) for (let x = o.x; x < o.x + o.w; x++) rem.add(z * W + x);
      if (nodes > budget) return false;
    }
    return false;
  };
  return dfs() ? out.map((o) => ({ x: o.x, z: o.z, w: o.w, d: o.d })) : null; // colour is set by the caller
}

const adjacent = (S, T) => {
  const xa = S.x + S.w === T.x || T.x + T.w === S.x, za = S.z + S.d === T.z || T.z + T.d === S.z;
  const zo = Math.min(S.z + S.d, T.z + T.d) > Math.max(S.z, T.z), xo = Math.min(S.x + S.w, T.x + T.w) > Math.max(S.x, T.x);
  return (xa && zo) || (za && xo);
};
const sizes = (an) => { const c = new Array(an.nComp).fill(0); an.comp.forEach((x) => { c[x]++; }); return c; };
const renumber = (arr) => arr.map((p, i) => ({ ...p, id: i }));

/** Replace a brick by three stacked plates of the same footprint (lets plate-level re-tiling straddle it). */
function decompose(list, B) {
  const plates = [0, 1, 2].map((d) => ({ ...B, kind: 'plate', y: B.y + d, h: 1, no: partNo('plate', B.w, B.d), name: partName('plate', B.w, B.d) }));
  return renumber(list.filter((p) => p !== B).concat(plates));
}

/**
 * Local repair: where a loose group touches the rest side-by-side in a layer with the same colour,
 * re-tile just those neighbouring parts so a part straddles the seam. Keeps changes that reduce the
 * number of separate groups. Pure packing fix; never changes the shape or colours.
 */
export function repair(grid, parts, analyzeFn, seed = 1, deadline = Infinity) {
  const { W, D } = grid;
  const r = rng(seed + 77);
  let cur = renumber(parts);
  let an = analyzeFn(grid, cur);

  const attempt = (list, P, Q, base) => {
    if (Date.now() > deadline) return null;
    let region = new Set([P, Q]);
    for (let hop = 0; hop <= 4; hop++) {
      if (hop) {
        const grow = new Set(region);
        for (const S of list) {
          if (S.y === P.y && S.h === P.h && S.color === P.color && S.kind === P.kind && !grow.has(S)) {
            for (const T of region) if (adjacent(S, T)) { grow.add(S); break; }
          }
        }
        const cellsN = [...grow].reduce((n, S) => n + S.w * S.d, 0);
        if (grow.size === region.size || cellsN > 60) { if (hop > 1) break; }
        region = grow;
      }
      const sup = supportMap(grid, P.y, P.y + P.h - 1);
      const cellSet = new Set();
      for (const S of region) for (let z = S.z; z < S.z + S.d; z++) for (let x = S.x; x < S.x + S.w; x++) cellSet.add(z * W + x);
      if (cellSet.size <= 60) {
        for (let t = 0; t < 4; t++) {
          if (Date.now() > deadline) return null;
          const rects = tileSupported(W, D, cellSet, sup, P.kind, r);
          if (!rects) break;
          const fresh = rects.map((q) => ({ ...mk(P.kind, { ...q, c: P.color }, P.y, P.h), band: P.band }));
          const next = renumber(list.filter((S) => !region.has(S)).concat(fresh));
          const an2 = analyzeFn(grid, next);
          if (an2.nComp < base) return { list: next, an: an2 };
        }
      }
      if (hop > 1) continue;
      const col = new Uint8Array(W * D), own = new Map();
      for (const S of region) for (let z = S.z; z < S.z + S.d; z++) for (let x = S.x; x < S.x + S.w; x++) { col[z * W + x] = S.color + 1; own.set(z * W + x, S); }
      // candidate rectangles that straddle the seam: inside the region, touching P and a different part
      const cands = [], seen = new Set();
      for (const [w0, d0] of sizesFor(P.kind)) for (const [w, d] of (w0 === d0 ? [[w0, d0]] : [[w0, d0], [d0, w0]])) {
        for (let z0 = P.z - d + 1; z0 < P.z + P.d; z0++) for (let x0 = P.x - w + 1; x0 < P.x + P.w; x0++) {
          if (x0 < 0 || z0 < 0 || x0 + w > W || z0 + d > D) continue;
          let ok = true, hasP = false, hasOther = false;
          for (let z = z0; z < z0 + d && ok; z++) for (let x = x0; x < x0 + w; x++) {
            const o = own.get(z * W + x);
            if (!o) { ok = false; break; }
            if (o === P) hasP = true; else hasOther = true;
          }
          const key = `${x0},${z0},${w},${d}`;
          if (ok && hasP && hasOther && !seen.has(key)) { seen.add(key); cands.push({ x: x0, z: z0, w, d, c: P.color }); }
        }
      }
      for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
      for (const R of cands.slice(0, 14)) {
        if (Date.now() > deadline) return null;
        const col2 = col.slice();
        for (let z = R.z; z < R.z + R.d; z++) for (let x = R.x; x < R.x + R.w; x++) col2[z * W + x] = 0;
        const { rects } = packLayer(W, D, col2, P.kind, r, null, r() < 0.5, r() < 0.5, supportMap(grid, P.y, P.y + P.h - 1), 4);
        const fresh = [R, ...rects].map((q) => ({ ...mk(P.kind, q, P.y, P.h), band: P.band }));
        const next = renumber(list.filter((S) => !region.has(S)).concat(fresh));
        const an2 = analyzeFn(grid, next);
        if (an2.nComp < base) return { list: next, an: an2 };
      }
    }
    return null;
  };

  for (let iter = 0; iter < 120 && an.nComp > 1 && Date.now() < deadline; iter++) {
    const pairs = [];
    for (const P of cur) for (const Q of cur) {
      if (P === Q || P.color !== Q.color || an.comp[P.id] === an.comp[Q.id] || !adjacent(P, Q)) continue;
      if (P.kind === 'plate' && Q.kind === 'plate' && P.y === Q.y && Q.id > P.id) pairs.push([P, Q, false]);
      else if (P.kind === 'brick' && Q.kind === 'brick' && P.y === Q.y && Q.id > P.id) pairs.push([P, Q, false]);
      else if (P.kind === 'plate' && Q.kind === 'brick' && P.y >= Q.y && P.y < Q.y + 3) pairs.push([P, Q, true]);
    }
    if (!pairs.length) break;
    let done = null;
    for (let pi = 0; pi < pairs.length && !done && Date.now() < deadline; pi++) {
      const [P, Q, dec] = pairs[(pi + iter) % pairs.length];
      if (!dec) done = attempt(cur, P, Q, an.nComp);
      else {
        const list = decompose(cur, Q);
        const same = (S, T) => S.kind === T.kind && S.y === T.y && S.x === T.x && S.z === T.z && S.w === T.w && S.d === T.d;
        const Pp = list.find((S) => same(S, P)), Qp = list.find((S) => S.kind === 'plate' && S.y === P.y && S.x === Q.x && S.z === Q.z && S.w === Q.w && S.d === Q.d && S !== Pp);
        if (Pp && Qp) done = attempt(list, Pp, Qp, an.nComp);
      }
    }
    if (!done) {
      // fall back to re-tiling whole layers that contain loose parts, with many random tilings
      const loose = cur.filter((P) => sizes(an)[an.comp[P.id]] < Math.max(...sizes(an)));
      for (const P of loose) {
        if (Date.now() >= deadline) break;
        const same = cur.filter((S) => S.y === P.y && S.h === P.h && S.kind === P.kind);
        const col = new Uint8Array(W * D);
        for (const S of same) for (let z = S.z; z < S.z + S.d; z++) for (let x = S.x; x < S.x + S.w; x++) col[z * W + x] = S.color + 1;
        for (let t = 0; t < 40 && !done && Date.now() < deadline; t++) {
          const { rects } = packLayer(W, D, col, P.kind, r, null, r() < 0.5, r() < 0.5, supportMap(grid, P.y, P.y + P.h - 1), 5);
          const fresh = rects.map((q) => ({ ...mk(P.kind, q, P.y, P.h), band: P.band }));
          const next = renumber(cur.filter((S) => !same.includes(S)).concat(fresh));
          const an2 = analyzeFn(grid, next);
          if (an2.nComp < an.nComp) done = { list: next, an: an2 };
        }
        if (done) break;
      }
    }
    if (!done) break;
    cur = done.list; an = done.an;
  }
  return cur;
}

/** Swap fully exposed top plates for smooth tiles (same footprint, no studs; nothing can sit on them anyway). */
export function applyTiles(parts, grid) {
  const { W, H, D, cells } = grid;
  return parts.map((p) => {
    if (p.kind !== 'plate' || !hasTile(p.w, p.d)) return p;
    const j = p.y + p.h;
    if (j < H) for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) if (cells[(j * D + z) * W + x]) return p;
    return { ...p, kind: 'tile', no: partNo('tile', p.w, p.d), name: partName('tile', p.w, p.d) };
  });
}
