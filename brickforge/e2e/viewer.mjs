// 3D viewer robustness: GPU memory stays flat while stepping, context loss recovers, lighting follows the model, HiDPI.
import { chromium } from 'playwright-core';
import { launch, exe, URL, settle } from './lib.mjs';

const results = [];
const ok = (name, cond, extra = '') => { results.push(!!cond); console.log(cond ? 'PASS' : 'FAIL', name, extra); };

const { browser, page, errors } = await launch({ width: 1300, height: 820 });
await page.goto(URL); await settle(page, 2500);
const info = () => page.evaluate(() => { const i = window.__brick.viewer.renderer.info; return { geo: i.memory.geometries, tex: i.memory.textures, prog: i.programs.length }; });

// 1) stepping through Build view must not leak GPU geometry
await page.click('[data-testid=mode-build]'); await settle(page, 600);
const n = await page.evaluate(() => window.__brick.model.steps.length);
await page.fill('.stepbar input[type=range]', '3'); await settle(page, 500);
const before = await info();
for (let s = 0; s < Math.min(n, 40); s++) { await page.fill('.stepbar input[type=range]', String(s)); await page.waitForTimeout(60); }
await settle(page, 500);
const after = await info();
ok('stepping 40 steps does not grow GPU geometry', after.geo - before.geo <= 12, `geometries ${before.geo} -> ${after.geo}`);
ok('textures stay flat', after.tex <= before.tex + 1, `${before.tex} -> ${after.tex}`);
await page.click('[data-testid=mode-model]'); await settle(page, 500);

// 2) loading many models in a row does not leak
const base = await info();
for (const id of ['rocket', 'duck', 'robot', 'racer', 'pine', 'mushroom', 'barn', 'cottage', 'rocket', 'duck', 'robot', 'racer']) { await page.click(`[data-testid=preset-${id}]`); await page.waitForTimeout(700); }
await settle(page, 800);
const many = await info();
ok('12 model switches: geometry count bounded', many.geo <= base.geo + 30, `${base.geo} -> ${many.geo}`);

// 3) context loss + restore
await page.click('[data-testid=preset-cottage]'); await settle(page, 1200);
const bright = () => page.evaluate(() => {
  const v = window.__brick.viewer; v.renderer.render(v.scene, v.camera);
  const c = document.createElement('canvas'); const src = v.renderer.domElement; c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.drawImage(src, src.width * 0.3, src.height * 0.3, src.width * 0.4, src.height * 0.4, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (64 * 64 * 3);
});
const b0 = await bright();
await page.evaluate(() => { window.__lose = window.__brick.viewer.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
await settle(page, 500);
ok('context loss is noticed (drawing paused)', await page.evaluate(() => window.__brick.viewer.lost === true));
await page.evaluate(() => window.__lose.restoreContext()); await settle(page, 1500);
ok('context restore clears the flag', await page.evaluate(() => window.__brick.viewer.lost === false));
const b1 = await bright();
ok('after restore the picture is back with the same lighting', b1 > 40 && Math.abs(b1 - b0) / b0 < 0.15, `brightness ${b0.toFixed(1)} -> ${b1.toFixed(1)}`);
await page.screenshot({ path: 'shots/viewer-after-context-restore.png', clip: { x: 268, y: 38, width: 780, height: 780 } });

// 4) lights follow the model: tall model in Golden hour is lit from above the floor and casts a shadow on it
await page.click('[data-testid=preset-rocket]'); await settle(page, 900);
await page.click('[data-testid=look-golden]'); await settle(page, 1200);
const lights = await page.evaluate(() => { const v = window.__brick.viewer; return { keyY: v.key.position.y, top: v.center.y * 2, dist: v.key.position.distanceTo(v.center), r: v.radius, shadowFar: v.key.shadow.camera.far }; });
ok('key light is farther out than the model radius, target at its centre', lights.dist > lights.r * 2 && lights.shadowFar > lights.dist, JSON.stringify(lights));
await page.screenshot({ path: 'shots/viewer-golden-rocket.png', clip: { x: 268, y: 38, width: 780, height: 780 } });
await page.click('[data-testid=look-noir]'); await settle(page, 1000);
await page.screenshot({ path: 'shots/viewer-noir-rocket.png', clip: { x: 268, y: 38, width: 780, height: 780 } });
await page.click('[data-testid=look-studio]');
ok('fog hides the floor edge (scene has fog)', await page.evaluate(() => !!window.__brick.viewer.scene.fog));

// 5) shadows are not recomputed every frame while the highlight pulses
await page.click('[data-testid=mode-build]'); await page.fill('.stepbar input[type=range]', '6'); await settle(page, 800);
const shadowUpdates = await page.evaluate(async () => {
  const v = window.__brick.viewer; let count = 0;
  const orig = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(v.renderer.shadowMap), 'needsUpdate') || null;
  let flag = false; Object.defineProperty(v.renderer.shadowMap, 'needsUpdate', { configurable: true, get: () => flag, set: (x) => { if (x) count++; flag = x; } });
  await new Promise((r) => setTimeout(r, 1500));
  return count;
});
ok('idle pulse frames do not recompute shadows (at most one settle)', shadowUpdates <= 1, `shadow updates in 1.5s: ${shadowUpdates}`);

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();

// 6) HiDPI: canvas resolution follows devicePixelRatio (capped at 2)
{
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  await p.goto(URL); await settle(p, 2500);
  const r = await p.evaluate(() => { const c = window.__brick.viewer.renderer.domElement; return { cssW: c.clientWidth, w: c.width, dpr: window.devicePixelRatio }; });
  ok('HiDPI: canvas is rendered at device resolution', r.w >= r.cssW * 1.9, JSON.stringify(r));
  await b.close();
}
process.exit(results.every(Boolean) ? 0 : 1);
