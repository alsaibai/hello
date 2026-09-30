import React, { useEffect, useRef, useState } from 'react';
import { Viewer, LOOKS } from '../three/viewer.js';

/** Owns the three.js viewer. Model view shows everything; build view shows steps with new pieces highlighted. */
export default function ViewerPane({ model, mode, step, look, rotate, resetToken, onReady, children }) {
  const host = useRef(null), v = useRef(null);
  const [noGl, setNoGl] = useState(false);
  useEffect(() => {
    try { v.current = new Viewer(host.current); } catch (e) { setNoGl(true); onReady && onReady(null); return undefined; } // no WebGL: the rest of the app still works
    onReady && onReady(v.current);
    return () => v.current.dispose();
  }, []);
  useEffect(() => { if (v.current) v.current.setModel(model && model.steps.length ? model : null); }, [model]);
  useEffect(() => { if (v.current) v.current.applyLook(look); }, [look]);
  useEffect(() => { if (v.current) v.current.setAutoRotate(rotate); }, [rotate]);
  useEffect(() => { if (v.current) v.current.resetView(); }, [resetToken]);
  useEffect(() => {
    if (!v.current || !model || !model.steps.length) return;
    if (mode === 'build') {
      const s = model.steps[Math.min(step, model.steps.length - 1)];
      const first = Math.min(...s.parts.map((id) => model.parts[id].order));
      v.current.showUpTo(first, s.parts, 0.5);
    } else v.current.showUpTo(model.parts.length, [], 1);
  }, [model, mode, step]);
  return (
    <div className="stage">
      <div className="cv" ref={host} data-testid="canvas-host" />
      {noGl && <div className="empty" role="alert" data-testid="no-webgl">3D view unavailable: this browser has WebGL turned off. The steps, parts list and downloads still work.</div>}
      {children}
    </div>
  );
}
export { LOOKS };
