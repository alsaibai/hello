// The AI describes SHAPES only. This module validates the description and turns it into a voxel grid.
// Units: x/z in studs, y in bricks (1 brick = 3 plates, so 0.333 = one plate).
import { COLORS, colorIndex, nearestColor, isCommon } from './palette.js';

export const LIMITS = { maxFootprint: 48, maxHeightBricks: 40, maxShapes: 120, maxParts: 1500 };
export const SHAPES = ['box', 'cylinder', 'cone', 'ellipsoid', 'pyramid', 'wedge', 'gable', 'slope', 'roof'];
export const DIR_CODE = { '+x': 1, '-x': 2, '+z': 3, '-z': 4 };
export const DIR_VEC = { 1: [1, 0], 2: [-1, 0], 3: [0, 1], 4: [0, -1] };

/** " Did you mean X or Y?" for a colour name that is not in the palette. */
function suggest(name) {
  const norm = (t) => String(t).toLowerCase().replace(/grey/g, 'gray').replace(/[^a-z ]/g, '').trim();
  const a = norm(name);
  const dist = (x, y) => { const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]); for (let j = 1; j <= y.length; j++) d[0][j] = j; for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); return d[x.length][y.length]; };
  const words = a.split(/\s+/).filter(Boolean);
  const scored = COLORS.map((c) => { const n = norm(c.name); const shared = words.filter((w) => n.split(' ').includes(w)).length; return { name: c.name, score: dist(a, n) - shared * 6 }; }).sort((p, q) => p.score - q.score).slice(0, 2);
  return scored.length ? ` Did you mean ${scored.map((x) => x.name).join(' or ')}?` : '';
}
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const vec = (v, n) => Array.isArray(v) && v.length === n && v.every(num);

/** Validate + normalise a spec. Returns { spec, problems[] }. Problems are plain sentences for the AI. */
export function validateSpec(raw, opts = {}) {
  const problems = [];
  if (!raw || typeof raw !== 'object') return { spec: null, problems: ['The description is not a JSON object.'] };
  const fp = raw.footprint;
  if (!vec(fp, 2) || fp.some((v) => v < 1)) problems.push('"footprint" must be [width, depth] in studs, e.g. [12, 10].');
  else if (fp.some((v) => v > LIMITS.maxFootprint)) problems.push(`"footprint" is too big: keep both sides <= ${LIMITS.maxFootprint} studs.`);
  const fpOk = problems.length === 0;
  if (!Array.isArray(raw.shapes) || raw.shapes.length === 0) { problems.push('"shapes" must be a non-empty array.'); return { spec: null, problems }; }
  if (raw.shapes.length > LIMITS.maxShapes) { problems.push(`Too many shapes (${raw.shapes.length}); use at most ${LIMITS.maxShapes}.`); return { spec: null, problems }; }
  // keep checking the shapes even if the footprint is wrong, so one round can fix everything at once

  const shapes = [];
  raw.shapes.forEach((s, i) => {
    const tag = `shape #${i} (${s && s.label ? s.label : s && s.shape})`;
    const bad = (m) => problems.push(`${tag}: ${m}`);
    if (!s || typeof s !== 'object') return bad('not an object.');
    const op = s.op || 'add';
    if (!['add', 'subtract', 'paint'].includes(op)) return bad(`op must be add, subtract or paint (got "${s.op}").`);
    if (!SHAPES.includes(s.shape)) return bad(`unknown shape "${s.shape}". Use one of: ${SHAPES.join(', ')}.`);
    const oneOf = (field, allowed) => s[field] !== undefined && !allowed.includes(s[field]) ? `"${field}" must be one of ${allowed.join(', ')} (got ${JSON.stringify(s[field])}).` : null;
    const enumErr = oneOf('dir', ['+x', '-x', '+z', '-z']) || oneOf('mirror', ['x', 'z', 'xz']) || oneOf('axis', ['x', 'y', 'z'])
      || (s.hollow !== undefined && typeof s.hollow !== 'boolean' ? '"hollow" must be true or false.' : null)
      || (s.wall !== undefined && !(num(s.wall) && s.wall >= 1 && s.wall <= 3) ? '"wall" must be a number from 1 to 3.' : null)
      || (s.taper !== undefined && !(num(s.taper) && s.taper >= 0 && s.taper <= 1) ? '"taper" must be a number from 0 to 1.' : null);
    if (enumErr) return bad(enumErr);
    if (!vec(s.pos, 3)) return bad('"pos" must be [x, y, z] numbers.');
    if (!vec(s.size, 3) || s.size.some((v) => v <= 0)) return bad('"size" must be [sx, sy, sz], all > 0.');
    let color = -1;
    if (op !== 'subtract') {
      color = colorIndex(s.color);
      if (color < 0 && typeof s.color === 'string' && s.color.startsWith('#')) color = nearestColor(s.color, !!opts.commonOnly);
      if (color >= 0 && opts.commonOnly && !isCommon(color)) color = nearestColor(COLORS[color].hex, true); // snap rare colours to a common one
      if (color < 0) return bad(s.color === undefined || s.color === null ? 'colour is missing: give it a "color" from the palette.' : `colour ${JSON.stringify(s.color)} is not in the LEGO palette.${suggest(s.color)} Use one of the listed names exactly.`);
    }
    const [x, y, z] = s.pos, [sx, sy, sz] = s.size;
    const eps = 1e-6;
    if (fpOk && (x < -eps || z < -eps || x + sx > fp[0] + eps || z + sz > fp[1] + eps))
      bad(`extends outside the footprint ${fp[0]}x${fp[1]} (x ${x}..${x + sx}, z ${z}..${z + sz}). Move or shrink it.`);
    if (y < -eps) bad(`pos.y is ${y}; y must be >= 0 (bricks above the ground).`);
    if (y + sy > LIMITS.maxHeightBricks) bad(`too tall: top at ${y + sy} bricks, max ${LIMITS.maxHeightBricks}.`);
    const mirror = ['x', 'z', 'xz'].includes(s.mirror) ? s.mirror : null;
    if (s.shape === 'slope' || s.shape === 'roof') {
      if (op !== 'add') return bad(`${s.shape} only supports op "add".`);
      const rise = Math.max(1, Math.round(sy));
      if (s.shape === 'slope') {
        const d = ['+x', '-x', '+z', '-z'].includes(s.dir) ? s.dir : '+x';
        const run = d.endsWith('x') ? Math.round(sx) : Math.round(sz);
        if (run < rise + 1) return bad(`a slope rises 1 brick per stud, so ${rise} bricks of rise needs at least ${rise + 1} studs along "${d}" (size is ${run}). Lengthen it or lower sy.`);
      } else {
        const ax = s.axis === 'x' ? 'x' : 'z';
        const across = ax === 'z' ? Math.round(sx) : Math.round(sz);
        if (across < 2 * rise + 2) return bad(`a roof rises 1 brick per stud on each side, so ${rise} bricks of rise needs at least ${2 * rise + 2} studs across (the ridge runs along ${ax}; size across is ${across}). Widen it or lower sy.`);
      }
    }
    shapes.push({
      shape: s.shape, op, color, pos: [x, y, z], size: [sx, sy, sz],
      taper: num(s.taper) ? Math.min(1, Math.max(0, s.taper)) : (s.shape === 'cone' || s.shape === 'pyramid' ? 0 : 1),
      axis: ['x', 'y', 'z'].includes(s.axis) ? s.axis : (s.shape === 'gable' ? 'z' : 'y'),
      dir: ['+x', '-x', '+z', '-z'].includes(s.dir) ? s.dir : '+x',
      hollow: s.hollow === undefined ? s.shape === 'roof' : !!s.hollow, mirror, label: s.label || s.shape,
      // curved or tapered shells need 2 studs of wall or the widest ring floats free of the layers above and below
      wall: num(s.wall) ? Math.min(3, Math.max(1, Math.round(s.wall))) : (['box', 'cylinder', 'wedge', 'gable'].includes(s.shape) ? 1 : 2),
    });
  });
  if (problems.length) return { spec: null, problems };
  return { spec: { name: String(raw.name || 'Model'), footprint: fp.slice(), shapes }, problems };
}

/** Does the point (u,v,w in 0..1 of the shape's bounding box) lie inside the shape? */
export function inside(sh, u, v, w) {
  const { shape, taper, axis, dir } = sh;
  if (shape === 'box') return true;
  const round = (a, b, c) => {
    const s = 1 + (taper - 1) * c;
    if (s <= 0) return false;
    const p = (a - 0.5) / (0.5 * s), q = (b - 0.5) / (0.5 * s);
    return p * p + q * q <= 1 + 1e-9;
  };
  switch (shape) {
    case 'ellipsoid': { const a = (u - .5) * 2, b = (v - .5) * 2, c = (w - .5) * 2; return a * a + b * b + c * c <= 1 + 1e-9; }
    case 'cylinder':
    case 'cone':
      return axis === 'y' ? round(u, w, v) : axis === 'x' ? round(v, w, u) : round(u, v, w);
    case 'pyramid': {
      const s = 1 + (taper - 1) * v;
      return Math.abs(u - .5) <= .5 * s + 1e-9 && Math.abs(w - .5) <= .5 * s + 1e-9;
    }
    case 'wedge': {
      const t = dir === '+x' ? u : dir === '-x' ? 1 - u : dir === '+z' ? w : 1 - w;
      return v <= 1 - t + 1e-9;
    }
    case 'gable': {
      const t = axis === 'z' ? u : w; // ridge runs along `axis`
      return v <= 1 - Math.abs(2 * t - 1) + 1e-9;
    }
  }
  return false;
}

/**
 * Rasterise to a voxel grid: 1 stud x 1 plate x 1 stud cells.
 * Returns { W, H, D, cells: Uint8Array (palette index+1, 0=empty), owner: Int16Array (shape index) }, index = (j*D + k)*W + i.
 */
export function voxelize(spec) {
  const [FW, FD] = spec.footprint;
  const W = Math.ceil(FW - 1e-9), D = Math.ceil(FD - 1e-9);
  let topBricks = 0;
  spec.shapes.forEach((s) => { topBricks = Math.max(topBricks, s.pos[1] + (s.shape === 'roof' ? Math.max(1, Math.round(s.size[1])) + 1 / 3 : s.shape === 'slope' ? Math.max(1, Math.round(s.size[1])) : s.size[1])); });
  const H = Math.max(1, Math.ceil(topBricks * 3 - 1e-9));
  const cells = new Uint8Array(W * H * D), owner = new Int16Array(W * H * D).fill(-1);
  const slope = new Uint8Array(W * H * D); // 0, or DIR_CODE of a slope-low cell (the slanted half of a slope part)
  const phases = new Set();
  const effect = new Map(); // shape index -> voxels it actually changed
  const hollowNoop = new Set(); // hollow:true shapes that had no interior to remove
  const bump = (idx, n = 1) => effect.set(idx, (effect.get(idx) || 0) + n);
  const at = (i, j, k) => (j * D + k) * W + i;
  // A mirrored copy is the REFLECTION of the rasterised original (cell i -> W-1-i), so it is always an exact mirror image,
  // whatever the shape, position (even half studs) or taper.
  let mx = false, mz = false;
  const rx = (i) => (mx ? W - 1 - i : i), rz = (k) => (mz ? D - 1 - k : k);
  const rdir = (d) => (mx && d <= 2 ? 3 - d : mz && d >= 3 ? 7 - d : d); // 1<->2, 3<->4

  // Slopes and roofs: a staircase of 45-degree slope parts, 1 stud of run per brick of rise.
  // Column c (counted from the low end) has c full bricks under a slope-low cell at level c; a slope part
  // = that low cell + the high cell (level c-1 of column c+1) next to it, so the packer can pair them.
  const rasterSlope = (s, idx) => {
    const i0 = Math.round(s.pos[0]), k0 = Math.round(s.pos[2]);
    const nx = Math.max(1, Math.round(s.pos[0] + s.size[0]) - i0), nz = Math.max(1, Math.round(s.pos[2] + s.size[2]) - k0); // rounded edges, so a shape that validates inside the footprint stays inside
    const y0 = Math.round(s.pos[1] * 3), Hb = Math.max(1, Math.round(s.size[1]));
    phases.add(((y0 % 3) + 3) % 3);
    const put = (i0_, k0_, level, low, dirCode) => {
      if (i0_ < 0 || k0_ < 0 || i0_ >= W || k0_ >= D) return;
      const i = rx(i0_), k = rz(k0_);
      for (let p = 0; p < 3; p++) {
        const j = y0 + level * 3 + p;
        if (j < 0 || j >= H) continue;
        const a = at(i, j, k);
        cells[a] = s.color + 1; owner[a] = idx; slope[a] = low ? rdir(dirCode) : 0; bump(idx);
      }
    };
    const column = (i, k, c, dirCode) => {
      const cc = Math.min(c, Hb);
      if (s.hollow) { if (cc >= 1) put(i, k, cc - 1, false, 0); }
      else for (let l = 0; l < cc; l++) put(i, k, l, false, 0);
      if (cc < Hb) put(i, k, cc, true, dirCode);
    };
    if (s.shape === 'slope') {
      const code = DIR_CODE[s.dir], alongX = code <= 2, L = alongX ? nx : nz;
      for (let c = 0; c < L; c++) {
        const pos = code === 1 ? i0 + nx - 1 - c : code === 2 ? i0 + c : code === 3 ? k0 + nz - 1 - c : k0 + c;
        if (alongX) for (let k = k0; k < k0 + nz; k++) column(pos, k, c, code);
        else for (let i = i0; i < i0 + nx; i++) column(i, pos, c, code);
      }
    } else { // roof: ridge along `axis`
      const ridgeZ = s.axis !== 'x', P = ridgeZ ? nx : nz;
      for (let a = 0; a < P; a++) {
        const cl = a, cr = P - 1 - a;
        const fromLeft = cl < Hb, fromRight = !fromLeft && cr < Hb;
        const c = fromLeft ? cl : fromRight ? cr : Hb;
        const code = fromLeft ? (ridgeZ ? 2 : 4) : (ridgeZ ? 1 : 3);
        if (ridgeZ) for (let k = k0; k < k0 + nz; k++) column(i0 + a, k, c, code);
        else for (let i = i0; i < i0 + nx; i++) column(i, k0 + a, c, code);
        if (c >= Hb) { // ridge cap: one plate resting on the studs of the two high slope ends
          const j = y0 + Hb * 3;
          const cap = (i0_, k0_) => { if (j < H && i0_ >= 0 && k0_ >= 0 && i0_ < W && k0_ < D) { const q = at(rx(i0_), j, rz(k0_)); cells[q] = s.color + 1; owner[q] = idx; slope[q] = 0; bump(idx); } };
          if (ridgeZ) for (let k = k0; k < k0 + nz; k++) cap(i0 + a, k); else for (let i = i0; i < i0 + nx; i++) cap(i, k0 + a);
        }
      }
    }
  };

  const apply = (sh, idx, s) => {
    if (s.shape === 'slope' || s.shape === 'roof') return rasterSlope(s, idx);
    const [px, py, pz] = s.pos, [sx, sy, sz] = s.size;
    const i0 = Math.max(0, Math.floor(px)), i1 = Math.min(W - 1, Math.ceil(px + sx)),
      k0 = Math.max(0, Math.floor(pz)), k1 = Math.min(D - 1, Math.ceil(pz + sz)),
      j0 = Math.max(0, Math.floor(py * 3)), j1 = Math.min(H - 1, Math.ceil((py + sy) * 3));
    const hit = new Uint8Array((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1));
    const ni = i1 - i0 + 1, nj = j1 - j0 + 1, nk = k1 - k0 + 1;
    const hi = (i, j, k) => ((j - j0) * nk + (k - k0)) * ni + (i - i0);
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const x = i + .5, y = (j + .5) / 3, z = k + .5;
      // half-open: a shape [0.5, 1.5) is exactly one stud wide, not two
      if (x < px - 1e-9 || x >= px + sx - 1e-9 || y < py - 1e-9 || y >= py + sy - 1e-9 || z < pz - 1e-9 || z >= pz + sz - 1e-9) continue;
      if (inside(s, (x - px) / sx, (y - py) / sy, (z - pz) / sz)) hit[hi(i, j, k)] = 1;
    }
    const has = (i, j, k) => i >= i0 && i <= i1 && j >= j0 && j <= j1 && k >= k0 && k <= k1 && hit[hi(i, j, k)] === 1;
    let hollowed = 0;
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      if (!hit[hi(i, j, k)]) continue;
      const t = s.wall, vt = Math.round(sy * 3) >= 7 ? 3 : 0; // 1-brick floor and roof; shapes under 3 bricks tall are just walls (open top and bottom)
      if (s.hollow && s.op === 'add' && has(i - t, j, k) && has(i + t, j, k) && has(i, j, k - t) && has(i, j, k + t) && (vt === 0 || (has(i, j - vt, k) && has(i, j + vt, k)))) { hollowed++; continue; }
      const a = at(rx(i), j, rz(k));
      if (s.op === 'subtract') { if (cells[a]) bump(idx); cells[a] = 0; owner[a] = -1; slope[a] = 0; }
      else if (s.op === 'paint') { if (cells[a] && cells[a] !== s.color + 1) bump(idx); if (cells[a]) cells[a] = s.color + 1; }
      else { cells[a] = s.color + 1; owner[a] = idx; slope[a] = 0; bump(idx); }
    }
    if (s.hollow && s.op === 'add' && hollowed === 0) hollowNoop.add(idx);
  };

  spec.shapes.forEach((s, idx) => {
    mx = false; mz = false; apply(s, idx, s);
    if (s.mirror) {
      if (s.mirror.includes('x')) { mx = true; mz = false; apply(s, idx, s); }
      if (s.mirror === 'z' || s.mirror === 'xz') { mx = false; mz = true; apply(s, idx, s); }
      if (s.mirror === 'xz') { mx = true; mz = true; apply(s, idx, s); }
      mx = false; mz = false;
    }
  });
  const g = trim({ W, H, D, cells, owner, slope, phases });
  g.effect = effect; g.hollowNoop = hollowNoop;
  return g;
}

/** Crop to the occupied box so the model sits at the origin; drop empty layers. */
export function trim(g) {
  const { W, H, D, cells, owner, slope, phases } = g;
  let a = [W, H, D], b = [-1, -1, -1];
  for (let j = 0; j < H; j++) for (let k = 0; k < D; k++) for (let i = 0; i < W; i++) if (cells[(j * D + k) * W + i]) {
    a = [Math.min(a[0], i), Math.min(a[1], j), Math.min(a[2], k)];
    b = [Math.max(b[0], i), Math.max(b[1], j), Math.max(b[2], k)];
  }
  if (b[0] < 0) return { W: 0, H: 0, D: 0, cells: new Uint8Array(0), owner: new Int16Array(0), slope: new Uint8Array(0), empty: true };
  const nW = b[0] - a[0] + 1, nH = b[1] - a[1] + 1, nD = b[2] - a[2] + 1;
  const nc = new Uint8Array(nW * nH * nD), no = new Int16Array(nW * nH * nD), ns = new Uint8Array(nW * nH * nD);
  for (let j = 0; j < nH; j++) for (let k = 0; k < nD; k++) for (let i = 0; i < nW; i++) {
    const s = ((j + a[1]) * D + (k + a[2])) * W + (i + a[0]), d = (j * nD + k) * nW + i;
    nc[d] = cells[s]; no[d] = owner[s]; ns[d] = slope[s];
  }
  const out = { W: nW, H: nH, D: nD, cells: nc, owner: no, slope: ns, offset: a };
  if (phases && phases.size) {
    // slope parts are one brick tall, so the brick rhythm of the whole model must line up with them
    out.slopePhase = (((([...phases][0] - a[1]) % 3) + 3) % 3);
    if (phases.size > 1) out.slopeConflict = 'Slopes and roofs are on different vertical steps (their pos.y differ by a fraction of a brick that is not a whole brick). Put every slope/roof base at the same 1/3-brick phase, e.g. all at whole bricks or all at whole bricks + 0.333.';
  }
  return out;
}

export const paletteSize = COLORS.length;
