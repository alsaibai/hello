// Real LEGO colours. `bl` = BrickLink colour id, `hex` = approximate on-screen colour.
// Only solid colours that exist for basic bricks and plates.
export const COLORS = [
  { name: 'White', bl: 1, hex: '#F2F3F2' },
  { name: 'Black', bl: 11, hex: '#1B2A34' },
  { name: 'Light Bluish Gray', bl: 86, hex: '#A0A5A9' },
  { name: 'Dark Bluish Gray', bl: 85, hex: '#6C6E68' },
  { name: 'Red', bl: 5, hex: '#C91A09' },
  { name: 'Dark Red', bl: 59, hex: '#720E0F' },
  { name: 'Orange', bl: 4, hex: '#FE8A18' },
  { name: 'Dark Orange', bl: 68, hex: '#A95500' },
  { name: 'Bright Light Orange', bl: 110, hex: '#F8BB3D' },
  { name: 'Yellow', bl: 3, hex: '#F2CD37' },
  { name: 'Bright Light Yellow', bl: 103, hex: '#FFF03A' },
  { name: 'Lime', bl: 34, hex: '#BBE90B' },
  { name: 'Green', bl: 6, hex: '#237841' },
  { name: 'Dark Green', bl: 80, hex: '#184632' },
  { name: 'Olive Green', bl: 155, hex: '#9B9A5A' },
  { name: 'Sand Green', bl: 48, hex: '#A0BCAC' },
  { name: 'Light Aqua', bl: 152, hex: '#ADC3C0' },
  { name: 'Medium Azure', bl: 156, hex: '#36AEBF' },
  { name: 'Bright Light Blue', bl: 105, hex: '#9FC3E9' },
  { name: 'Medium Blue', bl: 42, hex: '#5A93DB' },
  { name: 'Blue', bl: 7, hex: '#0055BF' },
  { name: 'Dark Blue', bl: 63, hex: '#0A3463' },
  { name: 'Sand Blue', bl: 55, hex: '#6074A1' },
  { name: 'Purple', bl: 24, hex: '#81007B' },
  { name: 'Dark Purple', bl: 89, hex: '#3F3691' },
  { name: 'Pink', bl: 23, hex: '#FC97AC' },
  { name: 'Dark Pink', bl: 47, hex: '#C870A0' },
  { name: 'Coral', bl: 220, hex: '#FF698F' },
  { name: 'Tan', bl: 2, hex: '#E4CD9E' },
  { name: 'Dark Tan', bl: 69, hex: '#958A73' },
  { name: 'Nougat', bl: 28, hex: '#D09168' },
  { name: 'Medium Nougat', bl: 150, hex: '#AA7D55' },
  { name: 'Reddish Brown', bl: 88, hex: '#582A12' },
];

// Colours that exist in almost every basic brick and plate (safest to order). Used by 'common colours only'.
const COMMON = new Set(['White', 'Black', 'Light Bluish Gray', 'Dark Bluish Gray', 'Red', 'Dark Red', 'Orange', 'Yellow', 'Bright Light Yellow', 'Lime', 'Green', 'Dark Green', 'Medium Azure', 'Blue', 'Dark Blue', 'Tan', 'Reddish Brown', 'Nougat', 'Pink', 'Purple', 'Bright Light Orange', 'Dark Tan', 'Sand Green', 'Medium Blue']);
export const isCommon = (i) => COMMON.has(COLORS[i].name);

const byName = new Map(COLORS.map((c, i) => [c.name.toLowerCase().replace(/[^a-z]/g, ''), i]));
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** Palette index for a colour name (forgiving on case/spacing/"grey"), else -1. */
export function colorIndex(name) {
  if (typeof name !== 'string') return -1;
  const k = name.toLowerCase().replace(/grey/g, 'gray').replace(/[^a-z]/g, '');
  return byName.has(k) ? byName.get(k) : -1;
}

/** Nearest real colour to a #rrggbb value (used when the AI gives a hex from a photo). */
export function nearestColor(hex, commonOnly = false) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return -1;
  const [r, g, b] = rgb(hex);
  let best = 0, bd = Infinity;
  COLORS.forEach((c, i) => {
    if (commonOnly && !COMMON.has(c.name)) return;
    const [cr, cg, cb] = rgb(c.hex);
    const d = 2 * (r - cr) ** 2 + 4 * (g - cg) ** 2 + 3 * (b - cb) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
