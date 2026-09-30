import React, { useCallback, useEffect, useRef, useState } from 'react';
import ViewerPane, { LOOKS } from './ui/ViewerPane.jsx';
import { StepsPane, PartsPane, ChecksPane, SpecPane } from './ui/Panels.jsx';
import { PRESETS } from './presets/index.js';
import { buildAsync, buildGridAsync } from './engine/buildAsync.js';
import { mosaicGrid } from './engine/mosaic.js';
import { generate, testKey, MODELS } from './ai/claude.js';

const store = {
  get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

async function readImage(file) {
  // createImageBitmap decodes without a blob: URL, so the strict CSP (img-src 'self' data:) stays intact
  let src;
  try { src = await createImageBitmap(file); } catch {
    src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not an image.')); i.src = r.result; }; r.onerror = () => rej(new Error('Could not read that file.')); r.readAsDataURL(file); });
  }
  const k = Math.min(1, 1024 / Math.max(src.width, src.height));
  const c = document.createElement('canvas'); c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // JPEG has no alpha: transparent pixels would otherwise turn black
  g.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  const dataUrl = c.toDataURL('image/jpeg', 0.86);
  return { mediaType: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl };
}

export default function App() {
  const [model, setModel] = useState(null);
  const [source, setSource] = useState('');
  const [presetId, setPresetId] = useState('');
  const [mode, setMode] = useState('model');
  const [step, setStep] = useState(0);
  const [look, setLook] = useState('studio');
  const [rotate, setRotate] = useState(false);
  const [reset, setReset] = useState(0);
  const [tab, setTab] = useState('steps');
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState(() => store.get('bf.key'));
  const [remember, setRemember] = useState(() => !!store.get('bf.key'));
  const [aiModel, setAiModel] = useState(() => { const m = store.get('bf.model'); return MODELS.some((x) => x.id === m) ? m : MODELS[0].id; });
  const [tiles, setTiles] = useState(() => store.get('bf.tiles') === '1');
  const [commonOnly, setCommonOnly] = useState(() => store.get('bf.common') === '1');
  const [baseplate, setBaseplate] = useState(() => store.get('bf.base') === '1');
  const [building, setBuilding] = useState(false);
  const [mosaicCols, setMosaicCols] = useState(24);
  const opts = { tiles, commonOnly, baseplate };
  const token = useRef(0), cur = useRef(null); // cur = what is on screen, so options can rebuild it
  const viewer = useRef(null), abort = useRef(null), fileIn = useRef(null);

  const show = useCallback((m, src, id = '', raw = null) => { setModel(m); setSource(src); setPresetId(id); setStep(0); setError(''); cur.current = { raw, src, id, mosaic: m && m.mosaic, m }; }, []);

  /** Build (in the worker) and show. Stale results from a slower earlier build are dropped. */
  const buildShow = useCallback(async (raw, src, id, o) => {
    const t = ++token.current;
    setBuilding(true);
    try {
      const r = await buildAsync(raw, o);
      if (t !== token.current) return null;
      if (!r.ok) { setError(`"${src}" failed its checks:\n` + r.problems.join('\n')); return r; }
      show(r.model, src, id, raw);
      return r;
    } catch (e) { if (t === token.current) setError(e.message); return null; }
    finally { if (t === token.current) setBuilding(false); }
  }, [show]);

  const loadPreset = useCallback((p, o) => { setLog([]); return buildShow(p.spec, `ready-made · ${p.title}`, p.id, o); }, [buildShow]);
  const setOpt = (kind, v) => {
    const o = { tiles, commonOnly, baseplate, [kind]: v };
    if (kind === 'tiles') { setTiles(v); store.set('bf.tiles', v ? '1' : ''); }
    else if (kind === 'baseplate') { setBaseplate(v); store.set('bf.base', v ? '1' : ''); }
    else { setCommonOnly(v); store.set('bf.common', v ? '1' : ''); }
    const c = cur.current;
    if (c && c.raw && !c.mosaic) buildShow(c.raw, c.src, c.id, o);
  };
  useEffect(() => { loadPreset(PRESETS[0], { tiles: store.get('bf.tiles') === '1', commonOnly: store.get('bf.common') === '1', baseplate: store.get('bf.base') === '1' }); }, [loadPreset]);
  useEffect(() => { window.__brick = { get viewer() { return viewer.current; }, get model() { return model; } }; });

  const pick = async (file) => {
    if (!file) return;
    try { setImage(await readImage(file)); setError(''); } catch (e) { setError(e.message); }
  };
  useEffect(() => {
    const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) pick(f); };
    window.addEventListener('paste', onPaste); return () => window.removeEventListener('paste', onPaste);
  }, []);

  const saveKey = (k, rem) => { setKey(k); setRemember(rem); store.set('bf.key', rem ? k : ''); };

  const run = async () => {
    if (!key) { setKeyOpen(true); return; }
    setBusy(true); setError(''); setLog([]);
    const ctrl = new AbortController(); abort.current = ctrl;
    const add = (l) => setLog((x) => [...x, l]);
    try {
      const res = await generate({
        prompt: prompt.trim(), image, key, model: aiModel, signal: ctrl.signal, opts, build: buildAsync,
        onEvent: (e) => {
          if (e.type === 'ask') add({ text: e.repair ? `round ${e.round}: sending problems back to Claude…` : `round ${e.round}: asking Claude to describe shapes…` });
          else if (e.type === 'nudge') add({ text: `round ${e.round}: ${e.kind === 'cut-off' ? 'answer was cut off, asking for a shorter one…' : 'Claude answered in words, asking it to send the shapes…'}` });
          else if (e.type === 'fallback') add({ text: `round ${e.round}: API failed (${e.message.slice(0, 80)}); kept the previous attempt`, cls: 'bad' });
          else if (e.type === 'retry') add({ text: `round ${e.round}: ${e.why === 'network' ? 'connection dropped' : 'API busy (' + e.why + ')'}, retrying in ${Math.round(e.ms / 1000)}s…` });
          else if (e.type === 'progress') setLog((x) => { const y = x.slice(); const last = y[y.length - 1]; if (last && last.text.startsWith('round')) y[y.length - 1] = { ...last, text: last.text.replace(/ \(\d+ chars\)$/, '') + ` (${e.chars} chars)` }; return y; });
          else if (e.type === 'built') {
            const n = e.spec.shapes ? e.spec.shapes.length : 0;
            if (e.ok) add({ text: `round ${e.round}: ${n} shapes → ${e.model.parts.length} parts, one connected piece ✓${e.pruned ? ' (after removing loose bits)' : ''}`, cls: 'ok' });
            else add({ text: `round ${e.round}: ${n} shapes → ${e.problems.length} problem${e.problems.length === 1 ? '' : 's'}`, cls: 'bad' });
            if (!e.ok || e.pruned) (e.pruned ? e.prunedProblems : e.problems).slice(0, 4).forEach((p) => add({ text: '· ' + (p.length > 150 ? p.slice(0, 150) + '…' : p), cls: 'sub' }));
          }
        },
      });
      if (res.ok) { show(res.model, `AI · ${res.model.name} · ${res.rounds} round${res.rounds > 1 ? 's' : ''}`, '', res.spec); setMode('model'); }
      else setError('Claude could not produce a buildable model after 3 rounds. Last problems:\n' + res.problems.join('\n'));
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Cancelled.' : e.message);
    } finally { setBusy(false); abort.current = null; }
  };

  const applySpec = async (raw) => {
    const r = await buildAsync(raw, opts);
    if (!r.ok) return r.problems.join('\n');
    show(r.model, 'edited spec', '', raw); setLog([]); return '';
  };

  const makeMosaic = async () => {
    if (!image) return;
    setBuilding(true); setError(''); setLog([]);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read the picture.')); i.src = image.url; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const { grid, colors } = mosaicGrid(ctx.getImageData(0, 0, c.width, c.height), { cols: mosaicCols });
      const r = await buildGridAsync(grid, 'Photo mosaic', opts);
      if (!r.ok) { setError(r.problems.join('\n')); return; }
      show(r.model, `mosaic · ${grid.W}×${grid.D} studs · ${colors.length} colours`); setMode('model');
    } catch (e) { setError(e.message); } finally { setBuilding(false); }
  };

  const drop = (e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); };
  const goStep = (i) => { setStep(Math.max(0, Math.min((model?.steps.length || 1) - 1, i))); setMode('build'); };
  useEffect(() => {
    const onKey = (e) => {
      if (!model || keyOpen || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [role=tab], [role=dialog], button')) return; // let those handle their own arrows
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      if (mode !== 'build') { setMode('build'); return; } // first press enters Build at the current step
      setStep((s) => Math.max(0, Math.min(model.steps.length - 1, s + (e.key === 'ArrowRight' ? 1 : -1))));
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [model, keyOpen, mode]);

  const st = model && model.check.stats;
  const lastRun = log;
  return (
    <div className="app">
      <header>
        <span className="brand"><i />Brickforge</span>
        <span className="crumb" data-testid="crumb">{model ? `${model.name} · ${st.parts} parts · ${model.steps.length} steps · ${source}` : 'no model'}</span>
        <button className="btn sm" onClick={() => setKeyOpen(true)} data-testid="key-btn">{key ? 'API key ●' : 'Add API key'}</button>
      </header>
      <div className="main">
        <aside className="left">
          <section className="blk">
            <h3>Describe</h3>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Type anything: “a lighthouse”, “my dog”, “a tiny tram”…" data-testid="prompt" />
            <div className={`drop ${over ? 'over' : ''} ${image ? 'has' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop} onClick={() => fileIn.current.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.current.click(); } }} role="button" tabIndex={0} aria-label={image ? 'Picture attached. Press to choose another' : 'Add a picture: drop, paste or press to choose a file'} data-testid="drop">
              {image ? (<><img src={image.url} alt="" /><span>picture attached</span><button className="btn sm x" aria-label="Remove picture" onClick={(e) => { e.stopPropagation(); setImage(null); }}>×</button></>) : <span>drop or paste a picture</span>}
              <input ref={fileIn} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} data-testid="file" />
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <select className="grow" value={aiModel} onChange={(e) => { setAiModel(e.target.value); store.set('bf.model', e.target.value); }} aria-label="Model">
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div className="opts">
              <label><input type="checkbox" checked={tiles} onChange={(e) => setOpt('tiles', e.target.checked)} data-testid="opt-tiles" /> Smooth tops (tiles)</label>
              <label><input type="checkbox" checked={baseplate} onChange={(e) => setOpt('baseplate', e.target.checked)} data-testid="opt-base" /> Build on a baseplate</label>
              <label><input type="checkbox" checked={commonOnly} onChange={(e) => setOpt('commonOnly', e.target.checked)} data-testid="opt-common" /> Common colours only</label>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn pri grow" disabled={busy || (!prompt.trim() && !image)} onClick={run} data-testid="generate">{busy ? 'Working…' : key ? 'Generate' : 'Generate (needs key)'}</button>
              {busy && <button className="btn" onClick={() => abort.current && abort.current.abort()}>Stop</button>}
            </div>
            {image && (
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn grow" disabled={busy || building} onClick={makeMosaic} data-testid="mosaic">Photo mosaic · no key</button>
                <select value={mosaicCols} onChange={(e) => setMosaicCols(+e.target.value)} aria-label="Mosaic width in studs" style={{ width: 84 }}>
                  {[16, 24, 32, 48].map((n) => <option key={n} value={n}>{n} studs</option>)}
                </select>
              </div>
            )}
            {log.length > 0 && <div className="log" data-testid="log">{log.map((l, i) => <div key={i} className={l.cls || ''}>{l.text}</div>)}</div>}
            {error && <div className="err" style={{ whiteSpace: 'pre-wrap' }} data-testid="error">{error}</div>}
          </section>
          <section className="blk">
            <h3>Ready-made · no key needed</h3>
            <div className="presets">
              {PRESETS.map((p) => (
                <button key={p.id} className={`preset ${presetId === p.id ? 'on' : ''}`} aria-pressed={presetId === p.id} onClick={() => loadPreset(p, opts)} data-testid={`preset-${p.id}`}>
                  <span>{p.title}</span><small>{p.blurb}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="blk">
            <h3>How it works</h3>
            <p className="small" style={{ margin: 0 }}>Claude only describes shapes. A program voxelises them, packs real bricks and plates, and checks the result is one connected piece that builds. Problems go back to Claude, up to 3 rounds.</p>
          </section>
        </aside>

        <ViewerPane model={model} mode={mode} step={step} look={look} rotate={rotate} resetToken={reset} onReady={(v) => { viewer.current = v; }}>
          <div className="ov tl">
            <div className="seg" role="group" aria-label="View">
              <button className={mode === 'model' ? 'on' : ''} aria-pressed={mode === 'model'} onClick={() => setMode('model')} data-testid="mode-model">Model</button>
              <button className={mode === 'build' ? 'on' : ''} aria-pressed={mode === 'build'} onClick={() => setMode('build')} data-testid="mode-build">Build</button>
            </div>
          </div>
          <div className="ov tr">
            <div className="seg" role="group" aria-label="Lighting">
              {Object.entries(LOOKS).map(([k, L]) => <button key={k} className={look === k ? 'on' : ''} aria-pressed={look === k} onClick={() => setLook(k)} data-testid={`look-${k}`}>{L.label}</button>)}
            </div>
          </div>
          <div className="ov br" style={{ bottom: mode === 'build' ? 58 : 10 }}>
            <button className="pill" aria-pressed={rotate} onClick={() => setRotate((r) => !r)} data-testid="rotate">{rotate ? 'spin: on' : 'spin: off'}</button>
            <button className="pill" onClick={() => setReset((n) => n + 1)}>reset view</button>
            <button className="pill" onClick={() => { const a = document.createElement('a'); if (!viewer.current) return; a.href = viewer.current.snapshot(); a.download = `${model?.name || 'model'}.png`; a.click(); }}>png</button>
          </div>
          {mode === 'build' && model && (
            <div className="stepbar" data-testid="stepbar">
              <button className="btn sm" onClick={() => goStep(step - 1)} disabled={step === 0} aria-label="Previous step">◀</button>
              <span className="n" data-testid="stepn">step {step + 1} / {model.steps.length}</span>
              <input type="range" min={0} max={model.steps.length - 1} value={step} onChange={(e) => goStep(+e.target.value)} aria-label="Step" aria-valuetext={`Step ${step + 1} of ${model.steps.length}`} />
              <button className="btn sm" onClick={() => goStep(step + 1)} disabled={step >= model.steps.length - 1} aria-label="Next step">▶</button>
            </div>
          )}
          {(busy || building) && <div className="busy">{busy ? 'asking Claude…' : 'building…'}</div>}
          {!model && <div className="empty">pick a ready-made build or describe one</div>}
        </ViewerPane>

        <aside className="right">
          <div className="tabs" role="tablist">
            {[['steps', 'Steps'], ['parts', 'Parts'], ['checks', 'Checks'], ['spec', 'Spec']].map(([k, t]) => (
              <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls="tabpanel" tabIndex={tab === k ? 0 : -1} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} onKeyDown={(e) => { const ks = ['steps', 'parts', 'checks', 'spec']; const i = ks.indexOf(k); const n = e.key === 'ArrowRight' ? ks[(i + 1) % 4] : e.key === 'ArrowLeft' ? ks[(i + 3) % 4] : null; if (n) { e.preventDefault(); setTab(n); setTimeout(() => document.getElementById(`tab-${n}`) && document.getElementById(`tab-${n}`).focus(), 0); } }} data-testid={`tab-${k}`}>{t}</button>
            ))}
          </div>
          <div className="pane" id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} data-testid={`pane-${tab}`}>
            {tab === 'steps' && <StepsPane model={model} step={step} setStep={goStep} />}
            {tab === 'parts' && <PartsPane model={model} />}
            {tab === 'checks' && <ChecksPane model={model} run={lastRun} />}
            {tab === 'spec' && (model && model.mosaic ? <div className="small">A picture mosaic has no shape description: it is built straight from the picture’s pixels.</div> : <SpecPane spec={model && model.spec ? rawSpec(model) : null} onApply={applySpec} />)}
          </div>
        </aside>
      </div>

      {keyOpen && <KeyDialog value={key} remember={remember} onClose={() => setKeyOpen(false)} onSave={(k, r) => { saveKey(k, r); setKeyOpen(false); }} />}
    </div>
  );
}

/** The spec exactly as the user/AI wrote it (kept on the model for the Spec tab). */
function rawSpec(model) { return model.raw || model.spec; }

function KeyDialog({ value, remember, onSave, onClose }) {
  const [k, setK] = useState(value), [r, setR] = useState(remember), [t, setT] = useState('');
  const input = useRef(null), opener = useRef(document.activeElement);
  const save = () => { const v = k.trim(); if (v && !/^[\x21-\x7e]+$/.test(v)) { setT('✗ A key has only plain letters, digits and symbols. Paste it again without spaces or odd characters.'); return; } onSave(v, r); };
  useEffect(() => {
    input.current && input.current.focus();
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); if (opener.current && opener.current.focus) opener.current.focus(); }; // give focus back to what opened the dialog
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !k.trim()) onClose(); }}>
      <form className="box" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save(); }} role="dialog" aria-modal="true" aria-labelledby="key-title" onKeyDown={(e) => { if (e.key !== 'Tab') return; const f = [...e.currentTarget.querySelectorAll('input, button:not(:disabled)')]; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }}>
        <h3 id="key-title" style={{ margin: 0 }}>Anthropic API key</h3>
        <p>Paste your key. It goes only from this browser to api.anthropic.com. There is no server.</p>
        <input ref={input} aria-label="Anthropic API key" type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="sk-ant-…" autoComplete="off" data-testid="key-input" />
        <label className="row"><input type="checkbox" checked={r} onChange={(e) => setR(e.target.checked)} /> <span>Remember on this device (stored in browser storage)</span></label>
        {t && <div className="small" data-testid="key-test">{t}</div>}
        <div className="row"><button type="submit" className="btn pri" data-testid="key-save">Save</button><button type="button" className="btn" disabled={!k.trim()} onClick={async () => { setT('Testing…'); const x = await testKey(k.trim()); setT((x.ok ? '✓ ' : '✗ ') + x.message); }} data-testid="key-testbtn">Test key</button><button type="button" className="btn" onClick={() => onSave('', false)}>Forget key</button><span className="grow" /><button type="button" className="btn" onClick={onClose}>Close</button></div>
      </form>
    </div>
  );
}
