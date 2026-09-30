// Real LEGO parts used by the packer. `no` = BrickLink item number.
// Sizes are [short, long] in studs. Brick height = 3 plates. Every part exists in BrickLink.
export const BRICKS = [
  { s: [1, 1], no: '3005' }, { s: [1, 2], no: '3004' }, { s: [1, 3], no: '3622' },
  { s: [1, 4], no: '3010' }, { s: [1, 6], no: '3009' }, { s: [1, 8], no: '3008' },
  { s: [2, 2], no: '3003' }, { s: [2, 3], no: '3002' }, { s: [2, 4], no: '3001' },
  { s: [2, 6], no: '2456' }, { s: [2, 8], no: '3007' },
];
export const PLATES = [
  { s: [1, 1], no: '3024' }, { s: [1, 2], no: '3023' }, { s: [1, 3], no: '3623' },
  { s: [1, 4], no: '3710' }, { s: [1, 6], no: '3666' }, { s: [1, 8], no: '3460' },
  { s: [2, 2], no: '3022' }, { s: [2, 3], no: '3021' }, { s: [2, 4], no: '3020' },
  { s: [2, 6], no: '3795' }, { s: [2, 8], no: '3034' },
  { s: [4, 4], no: '3031' }, { s: [4, 6], no: '3032' }, { s: [6, 6], no: '3958' },
];

// Smooth tiles (no studs): used for fully exposed top plates when 'smooth tops' is on.
export const TILES = [
  { s: [1, 1], no: '3070b' }, { s: [1, 2], no: '3069b' }, { s: [1, 3], no: '63864' },
  { s: [1, 4], no: '2431' }, { s: [1, 6], no: '6636' }, { s: [1, 8], no: '4162' },
  { s: [2, 2], no: '3068b' }, { s: [2, 3], no: '26603' }, { s: [2, 4], no: '87079' },
];
// Baseplates (one part, square). The smallest one that covers the model is used.
export const BASEPLATES = [{ n: 16, no: '3867' }, { n: 32, no: '3811' }, { n: 48, no: '4186' }];
// 45-degree slopes: 2 studs long (one stud on the high end), 1 or 2 studs wide.
export const SLOPES = [{ across: 1, no: '3040b' }, { across: 2, no: '3039' }];

const table = (list) => new Map(list.map((p) => [p.s.join('x'), p.no]));
const T = { brick: table(BRICKS), plate: table(PLATES), tile: table(TILES) };

export function partNo(kind, w, d) {
  const a = Math.min(w, d), b = Math.max(w, d);
  if (kind === 'slope') return (SLOPES.find((x) => x.across === a) || SLOPES[0]).no; // 2 long, `a` wide
  if (kind === 'baseplate') return (BASEPLATES.find((x) => x.n === a) || BASEPLATES[2]).no;
  return T[kind].get(`${a}x${b}`);
}
const LABEL = { brick: 'Brick', plate: 'Plate', tile: 'Tile', slope: 'Slope 45', baseplate: 'Baseplate' };
export const partName = (kind, w, d) => {
  const a = Math.min(w, d), b = Math.max(w, d);
  return kind === 'slope' ? `Slope 45 ${b} x ${a}` : `${LABEL[kind]} ${a} x ${b}`;
};
export const hasTile = (w, d) => T.tile.has(`${Math.min(w, d)}x${Math.max(w, d)}`);
export const sizesFor = (kind) => (kind === 'brick' ? BRICKS : PLATES).map((p) => p.s);

/** Cells [x,z] of a part that carry studs (all of them, except the slanted half of a slope). */
export function studCells(p) {
  const out = [];
  for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) out.push([x, z]);
  if (p.kind === 'tile' || p.kind === 'baseplate') return [];
  if (p.kind !== 'slope') return out;
  // p.dir = direction the slope descends toward; the high (studded) half is on the opposite side
  const hx = p.dir === 1 ? p.x : p.dir === 2 ? p.x + 1 : null, hz = p.dir === 3 ? p.z : p.dir === 4 ? p.z + 1 : null;
  return out.filter(([x, z]) => (hx === null || x === hx) && (hz === null || z === hz));
}
