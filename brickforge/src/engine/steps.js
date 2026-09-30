// Build order + instruction steps (max 4 parts per step). Every part attaches to something already placed.
export const MAX_PER_STEP = 4;

export function orderParts(parts, an) {
  const n = parts.length, placed = new Uint8Array(n), order = [];
  const cx = (p) => p.x + p.w / 2, cz = (p) => p.z + p.d / 2;
  let last = null;
  while (order.length < n) {
    let best = -1, bk = null;
    for (let i = 0; i < n; i++) {
      if (placed[i]) continue;
      const p = parts[i];
      // available: sits on the ground, on a placed part, or (overhang) under a placed part
      const ok = p.kind === 'baseplate' || p.y === 0 || an.adj[i].some((e) => placed[e.to]);
      if (!ok) continue;
      const level = p.kind === 'baseplate' ? -1 : p.band;
      const same = last && last.color === p.color ? 0 : 1;
      const dist = last ? Math.abs(cx(p) - cx(last)) + Math.abs(cz(p) - cz(last)) : 0;
      const k = [level, p.kind === 'baseplate' ? -1 : p.y, same, dist];
      if (!bk || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] || (k[1] === bk[1] && (k[2] < bk[2] || (k[2] === bk[2] && k[3] < bk[3])))))) { bk = k; best = i; }
    }
    if (best < 0) return null; // unreachable parts: the model is not connected
    placed[best] = 1; order.push(best); last = parts[best];
  }
  return order;
}

/** -> { order, steps:[{n, layer, parts:[id]}] } or null if not buildable. */
export function makeSteps(parts, an) {
  const order = orderParts(parts, an);
  if (!order) return null;
  const steps = [];
  let cur = null;
  for (const id of order) {
    const layer = parts[id].band + 1;
    if (!cur || cur.parts.length >= MAX_PER_STEP || cur.layer !== layer) {
      cur = { n: steps.length + 1, layer, parts: [] };
      steps.push(cur);
    }
    cur.parts.push(id);
  }
  const idx = new Map(order.map((id, i) => [id, i]));
  parts.forEach((p) => { p.order = idx.get(p.id); });
  steps.forEach((s) => s.parts.forEach((id) => { parts[id].step = s.n; }));
  return { order, steps };
}
