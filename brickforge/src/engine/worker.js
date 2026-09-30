// Runs the (CPU-heavy) build off the main thread.
import { buildModel, buildFromGrid } from './pipeline.js';

self.onmessage = (e) => {
  const { id, kind, payload, opts } = e.data;
  try {
    const result = kind === 'grid' ? buildFromGrid(payload.grid, payload.name, opts) : buildModel(payload, opts);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
