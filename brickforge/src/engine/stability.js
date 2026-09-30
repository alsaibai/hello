// Simple structural sanity checks, reported as WARNINGS (a heuristic, not a physics simulation):
//  1. tipping: is the centre of mass over the footprint that touches the ground?
//  2. cantilevers: a heavy group hanging sideways off a joint with only a few studs.
const massOf = (p) => (p.kind === 'baseplate' ? 0 : p.kind === 'brick' ? p.w * p.d * 3 : p.kind === 'slope' ? p.w * p.d * 2.25 : p.w * p.d);

function hull(points) {
  const pts = [...new Map(points.map((p) => [p.join(','), p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function inHull(h, [x, z]) {
  if (h.length < 3) return false;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-9) return false;
  }
  return true;
}

export function stability(parts, an, off = [0, 0, 0]) {
  const warnings = [];
  const M = parts.map(massOf), total = M.reduce((a, b) => a + b, 0);
  const cx = (p) => p.x + p.w / 2, cz = (p) => p.z + p.d / 2;

  // 1. tipping
  let sx = 0, sz = 0;
  parts.forEach((p, i) => { sx += M[i] * cx(p); sz += M[i] * cz(p); });
  const com = [sx / total, sz / total];
  const ground = parts.filter((p) => p.y === 0);
  const h = hull(ground.flatMap((p) => [[p.x, p.z], [p.x + p.w, p.z], [p.x, p.z + p.d], [p.x + p.w, p.z + p.d]]));
  const onBase = parts.some((p) => p.kind === 'baseplate'); // pressed onto a baseplate: tipping is not a concern
  if (!onBase && ground.length && !inHull(h, com)) {
    warnings.push({ code: 'tips', message: `Centre of mass (x ${Math.round((com[0] + off[0]) * 10) / 10}, z ${Math.round((com[1] + off[2]) * 10) / 10}) is outside the area touching the ground, so it will tip over unless pressed onto a baseplate. Widen the base or move weight over it.` });
  }

  // 2. sideways loads. For every link that splits the model in two, look at the side that does NOT touch the
  // ground (the load). If it rests on the joint, what matters is how far its centre of mass is from the contact
  // patch; if it hangs from the joint, how far it is from the joint. Torque is resisted by the studs (heuristic).
  const n = parts.length, disc = new Int32Array(n).fill(-1), low = new Int32Array(n);
  const sm = new Float64Array(n), sxm = new Float64Array(n), szm = new Float64Array(n), sc = new Int32Array(n), sg = new Int32Array(n);
  let t = 0;
  const found = [];
  const dfs = (u, pe) => {
    disc[u] = low[u] = t++; sm[u] = M[u]; sxm[u] = M[u] * cx(parts[u]); szm[u] = M[u] * cz(parts[u]); sc[u] = 1; sg[u] = parts[u].y === 0 ? 1 : 0;
    for (const e of an.adj[u]) {
      if (e.to === pe) continue;
      if (disc[e.to] >= 0) { low[u] = Math.min(low[u], disc[e.to]); continue; }
      dfs(e.to, u);
      sm[u] += sm[e.to]; sxm[u] += sxm[e.to]; szm[u] += szm[e.to]; sc[u] += sc[e.to]; sg[u] += sg[e.to];
      low[u] = Math.min(low[u], low[e.to]);
      if (low[e.to] > disc[u]) found.push({ u, v: e.to, studs: e.studs });
    }
  };
  for (let s = 0; s < n; s++) if (disc[s] < 0) dfs(s, -1);
  const groundTotal = ground.length;
  const edgeOf = new Map(an.edges.map((e) => [e.lo + ',' + e.hi, e]));
  const distToHull = (pt, cellsList) => {
    const pts = hull(cellsList.flatMap(([x, z]) => [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]]));
    if (inHull(pts, pt)) return 0;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / L2));
      best = Math.min(best, Math.hypot(pt[0] - (a[0] + u * dx), pt[1] - (a[1] + u * dz)));
    }
    return best;
  };
  const scored = [];
  for (const f of found) {
    const sub = { m: sm[f.v], gx: sxm[f.v] / sm[f.v], gz: szm[f.v] / sm[f.v], cnt: sc[f.v], ground: sg[f.v] };
    const rest = { m: total - sm[f.v], gx: (sx - sxm[f.v]) / (total - sm[f.v]), gz: (sz - szm[f.v]) / (total - sm[f.v]), cnt: n - sc[f.v], ground: groundTotal - sg[f.v] };
    // the load is the side that does not touch the ground; if both (or neither) do, nothing to check
    const load = sub.ground === 0 ? sub : rest.ground === 0 ? rest : null;
    if (!load || load.cnt < 3) continue;
    const e = edgeOf.get(f.u + ',' + f.v) || edgeOf.get(f.v + ',' + f.u);
    if (!e) continue;
    const loadIsSub = load === sub;
    const upperInLoad = loadIsSub ? f.v === e.hi : f.u === e.hi; // does the load contain the upper part of the joint?
    const contact = e.cells;
    const jx = contact.reduce((a, c) => a + c[0] + 0.5, 0) / contact.length, jz = contact.reduce((a, c) => a + c[1] + 0.5, 0) / contact.length;
    const lever = upperInLoad ? distToHull([load.gx, load.gz], contact) : Math.hypot(load.gx - jx, load.gz - jz);
    const torque = load.m * lever, capacity = 5 * e.studs;
    if (lever > 1 && torque > capacity) {
      scored.push({ torque, msg: upperInLoad
        ? `A group of ${load.cnt} parts rests on only ${e.studs} stud${e.studs === 1 ? '' : 's'} near x ${Math.round(jx + off[0])}, z ${Math.round(jz + off[2])} with its weight ${Math.round(lever * 10) / 10} studs off to the side, so it may tip off. Give it a wider seat.`
        : `A group of ${load.cnt} parts hangs ${Math.round(lever * 10) / 10} studs off-centre from ${e.studs} stud${e.studs === 1 ? '' : 's'} near x ${Math.round(jx + off[0])}, z ${Math.round(jz + off[2])}. It is likely to sag or twist off; add support or overlap more.` });
    }
  }
  scored.sort((a, b) => b.torque - a.torque).slice(0, 3).forEach((s) => warnings.push({ code: 'sideways', message: s.msg }));
  return { warnings, com };
}
