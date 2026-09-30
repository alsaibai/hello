import React from 'react';
import { COLORS } from '../engine/palette.js';

/** Top-down drawing of a part (studs as circles) in its colour. */
export default function PartGlyph({ w, d, color, kind }) {
  const a = Math.max(w, d), b = Math.min(w, d), S = 12, pad = 2;
  if (kind === 'baseplate') {
    return (
      <svg viewBox="0 0 84 60" aria-label="baseplate">
        <rect x="2" y="6" width="80" height="52" rx="3" fill={COLORS[color].hex} stroke="rgba(0,0,0,.6)" />
        {Array.from({ length: 40 }, (_, n) => <circle key={n} cx={10 + (n % 10) * 7.4} cy={14 + Math.floor(n / 10) * 12} r="2.6" fill="none" stroke="rgba(255,255,255,.55)" />)}
      </svg>
    );
  }
  if (kind === 'slope') { // top view: studs on the high end, diagonal hatching on the slanted end
    const c0 = COLORS[color].hex;
    return (
      <svg viewBox={`0 0 ${a * S + pad * 2} ${b * S + pad * 2 + 6}`} aria-label={`slope ${b} by ${a}`}>
        <rect x={pad} y={pad + 4} width={a * S} height={b * S} rx="2" fill={c0} stroke="rgba(0,0,0,.6)" />
        {Array.from({ length: b }, (_, j) => <circle key={j} cx={pad + S / 2} cy={pad + 4 + S * j + S / 2} r={4} fill="none" stroke="rgba(255,255,255,.6)" />)}
        {Array.from({ length: b * 3 }, (_, n) => <line key={n} x1={pad + S + 2} y1={pad + 4 + (n * S) / 3 + 2} x2={pad + 2 * S - 2} y2={pad + 4 + (n * S) / 3 + 6} stroke="rgba(0,0,0,.35)" />)}
        <rect x={pad} y={pad} width={a * S} height={4} fill={c0} stroke="rgba(0,0,0,.6)" />
      </svg>
    );
  }
  const c = COLORS[color].hex;
  const dark = ['#1B2A34', '#720E0F', '#582A12', '#0A3463', '#184632', '#3F3691', '#6C6E68', '#81007B', '#0055BF', '#237841', '#C91A09'].includes(c);
  const studs = kind === 'tile' ? null : [];
  if (studs) for (let i = 0; i < a; i++) for (let j = 0; j < b; j++) studs.push(<circle key={i + ',' + j} cx={pad + S * i + S / 2} cy={pad + S * j + S / 2} r={4} fill="none" stroke={dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.4)'} strokeWidth="1" />);
  return (
    <svg viewBox={`0 0 ${a * S + pad * 2} ${b * S + pad * 2 + 6}`} aria-label={`${kind} ${b} by ${a}`}>
      <rect x={pad} y={pad + 4} width={a * S} height={b * S} rx="2" fill={c} stroke="rgba(0,0,0,.6)" strokeWidth="1" opacity={kind === 'plate' ? 0.92 : 1} />
      <g transform="translate(0,4)">{studs}</g>
      <rect x={pad} y={pad} width={a * S} height={kind === 'plate' ? 2 : 4} fill={c} stroke="rgba(0,0,0,.6)" strokeWidth="1" />
    </svg>
  );
}
