import { COLORS } from './palette.js';

/** Parts list aggregated by (part number, colour). */
export function partsList(parts) {
  const m = new Map();
  for (const p of parts) {
    const key = p.no + '|' + p.color;
    if (!m.has(key)) m.set(key, { no: p.no, name: p.name, kind: p.kind, w: Math.min(p.w, p.d), d: Math.max(p.w, p.d), color: p.color, colorName: COLORS[p.color].name, bl: COLORS[p.color].bl, qty: 0 });
    m.get(key).qty++;
  }
  return [...m.values()].sort((a, b) => a.colorName.localeCompare(b.colorName) || a.kind.localeCompare(b.kind) || a.w * a.d - b.w * b.d);
}

/** BrickLink "Wanted list" upload XML (Wanted > Upload > paste XML). */
export function wantedXml(list) {
  const items = list.map((l) => `  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${l.no}</ITEMID>\n    <COLOR>${l.bl}</COLOR>\n    <MINQTY>${l.qty}</MINQTY>\n  </ITEM>`).join('\n');
  return `<INVENTORY>\n${items}\n</INVENTORY>\n`;
}

export function partsCsv(list) {
  const rows = list.map((l) => [l.qty, l.no, l.name, l.colorName, l.bl].join(','));
  return 'Qty,BrickLink part,Name,Colour,BrickLink colour id\n' + rows.join('\n') + '\n';
}
