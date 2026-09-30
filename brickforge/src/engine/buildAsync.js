// Same API as buildModel/buildFromGrid, but in a Web Worker when the browser has one (falls back to the main thread).
import { buildModel, buildFromGrid } from './pipeline.js';

let worker = null, broken = false, seq = 0;
const pending = new Map();

function getWorker() {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
    };
    worker.onerror = () => { // could not start: run everything on the main thread from now on
      broken = true; worker = null;
      for (const [, p] of pending) p.fallback();
      pending.clear();
    };
    return worker;
  } catch { broken = true; return null; }
}

function run(kind, payload, opts, sync) {
  const w = getWorker();
  if (!w) return Promise.resolve(sync());
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, fallback: () => { try { resolve(sync()); } catch (e) { reject(e); } } });
    try { w.postMessage({ id, kind, payload, opts }); } catch { pending.delete(id); try { resolve(sync()); } catch (e) { reject(e); } }
  });
}

export const buildAsync = (raw, opts = {}) => run('spec', raw, opts, () => buildModel(raw, opts));
export const buildGridAsync = (grid, name, opts = {}) => run('grid', { grid, name }, opts, () => buildFromGrid(grid, name, opts));
