import React, { useState } from 'react';
import PartGlyph from './PartGlyph.jsx';
import { COLORS } from '../engine/palette.js';
import { wantedXml, partsCsv } from '../engine/bricklink.js';
import { MAX_PER_STEP } from '../engine/steps.js';
import { LIMITS } from '../engine/spec.js';

const save = (name, text, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

/** Build instructions: current step card + list of all steps. */
export function StepsPane({ model, step, setStep }) {
  if (!model) return <div className="small">Load or generate a model first.</div>;
  const s = model.steps[step];
  const fromBelow = (id) => model.parts[id].y > 0 && !model.check.an.adj[id].some((e) => !e.up && model.parts[e.to].order < model.parts[id].order);
  // group identical pieces inside the step
  const groups = [];
  s.parts.forEach((id) => {
    const p = model.parts[id];
    const g = groups.find((x) => x.no === p.no && x.color === p.color);
    if (g) g.ids.push(id); else groups.push({ no: p.no, color: p.color, p, ids: [id] });
  });
  return (
    <>
      <div className="card" data-testid="step-card">
        <div className="h"><span>STEP {s.n} / {model.steps.length}</span><span>LAYER {s.layer}</span></div>
        <div className="chips">
          {groups.map((g) => (
            <div className="chip" key={g.no + g.color}>
              <PartGlyph w={g.p.w} d={g.p.d} color={g.color} kind={g.p.kind} />
              <b>{g.ids.length} × {g.p.name.replace(' x ', '×')}</b>
              <span>{COLORS[g.color].name}</span>
            </div>
          ))}
        </div>
        {s.parts.some(fromBelow) && <div className="note">Note: a piece here goes on from underneath (turn the model over or press it up under the piece above).</div>}
        <div className="note">Add the highlighted pieces. Max {MAX_PER_STEP} per step.</div>
      </div>
      <h3>All steps</h3>
      <div className="steplist">
        {model.steps.map((st, i) => (
          <button key={st.n} className={i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined} aria-label={`Step ${st.n}, layer ${st.layer}, ${st.parts.length} piece${st.parts.length === 1 ? '' : 's'}`} onClick={() => setStep(i)}>
            <span style={{ width: 24 }}>{String(st.n).padStart(2, '0')}</span>
            <span style={{ width: 28 }}>L{st.layer}</span>
            <span className="dots">{st.parts.map((id) => <i key={id} style={{ background: COLORS[model.parts[id].color].hex }} />)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function PartsPane({ model }) {
  const [copied, setCopied] = useState(false);
  if (!model) return <div className="small">Load or generate a model first.</div>;
  const xml = wantedXml(model.list);
  const total = model.list.reduce((n, l) => n + l.qty, 0);
  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn pri" onClick={() => save(`${model.name}.bricklink.xml`, xml, 'application/xml')}>Download XML</button>
        <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(xml); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }}>{copied ? 'Copied' : 'Copy XML'}</button>
        <button className="btn" onClick={() => save(`${model.name}.parts.csv`, partsCsv(model.list), 'text/csv')}>CSV</button>
      </div>
      <p className="small" style={{ margin: '0 0 8px' }}>BrickLink → Wanted → Upload → paste the XML (or choose the file). {total} pieces, {model.list.length} lines.</p>
      <table data-testid="parts-table">
        <thead><tr><th className="num">Qty</th><th>Part</th><th>Colour</th><th className="num">BL</th></tr></thead>
        <tbody>
          {model.list.map((l) => (
            <tr key={l.no + l.color}>
              <td className="num">{l.qty}</td>
              <td>{l.name.replace(' x ', '×')} <span className="small">#{l.no}</span></td>
              <td><span className="sw" style={{ background: COLORS[l.color].hex }} />{l.colorName}</td>
              <td className="num">{l.bl}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function ChecksPane({ model, run }) {
  if (!model) return <div className="small">Nothing to check yet.</div>;
  const c = model.check, st = c.stats;
  const maxStep = Math.max(...model.steps.map((s) => s.parts.length));
  const rows = [
    [!c.an.overlap && !c.an.uncovered && !c.an.colorMismatch && !c.an.outside, 'Every voxel covered by exactly one part, right colour'],
    [st.components === 1, `One connected piece (${st.components} group${st.components === 1 ? '' : 's'})`],
    [model.steps.length > 0, 'A build order exists: each piece attaches to what is built'],
    [maxStep <= MAX_PER_STEP, `At most ${MAX_PER_STEP} pieces per step (max ${maxStep})`],
    [st.parts <= LIMITS.maxParts, `Within ${LIMITS.maxParts} parts (${st.parts})`],
  ];
  return (
    <>
      <div className="checks" data-testid="checks">
        {rows.map(([ok, t], i) => <div key={i}><b>{ok ? '✓' : '✗'}</b><span>{t}</span></div>)}
      </div>
      {c.warnings.map((w, i) => <div className="warn" key={i}>{w.message}</div>)}
      <dl className="kv">
        <dt>size</dt><dd>{st.size[0]}×{st.size[2]} studs, {Math.round(st.size[1] * 10) / 10} bricks tall</dd>
        <dt>parts</dt><dd>{st.parts} ({st.bricks} bricks, {st.plates} plates{st.tiles ? `, ${st.tiles} tiles` : ''}{st.slopes ? `, ${st.slopes} slopes` : ''})</dd>
        <dt>colours</dt><dd>{st.colors}</dd>
        <dt>steps</dt><dd>{model.steps.length}</dd>
        {model.removedGroups ? (<><dt>repaired</dt><dd>{model.removedGroups} loose group(s) removed</dd></>) : null}
      </dl>
      {run && run.length > 0 && (
        <>
          <h3>Last AI run</h3>
          <div className="log" style={{ maxHeight: 'none' }}>
            {run.map((l, i) => <div key={i} className={l.cls || ''}>{l.text}</div>)}
          </div>
        </>
      )}
    </>
  );
}

export function SpecPane({ spec, onApply }) {
  const [text, setText] = useState(() => JSON.stringify(spec || {}, null, 1));
  const [err, setErr] = useState('');
  React.useEffect(() => { setText(JSON.stringify(spec || {}, null, 1)); setErr(''); }, [spec]);
  return (
    <>
      <p className="small" style={{ margin: '0 0 6px' }}>The AI only describes shapes like this. Edit and rebuild locally, no key needed.</p>
      <textarea className="spec-ta" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} data-testid="spec-text" />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn pri" onClick={() => { try { const r = onApply(JSON.parse(text)); setErr(r || ''); } catch (e) { setErr('Not valid JSON: ' + e.message); } }}>Rebuild</button>
      </div>
      {err && <div className="err" style={{ whiteSpace: 'pre-wrap' }}>{err}</div>}
    </>
  );
}
