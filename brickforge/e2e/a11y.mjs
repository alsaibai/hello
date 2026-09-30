// Accessibility, keyboard, framing and no-WebGL behaviour in a real browser.
import { chromium } from 'playwright-core';
import { launch, exe, URL, settle } from './lib.mjs';

const results = [];
const ok = (name, cond, extra = '') => { results.push(!!cond); console.log(cond ? 'PASS' : 'FAIL', name, extra); };

// 1) no WebGL at all: the app must still work
{
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--disable-3d-apis', '--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(URL); await settle(page, 2500);
  ok('no WebGL: app still renders', (await page.textContent('[data-testid=crumb]')).includes('Cottage'));
  ok('no WebGL: clear message instead of a blank page', await page.isVisible('[data-testid=no-webgl]'));
  await page.click('[data-testid=tab-parts]');
  ok('no WebGL: parts list still works', /Plate|Brick/.test(await page.textContent('[data-testid=parts-table]')));
  await page.click('[data-testid=preset-duck]'); await settle(page, 1200);
  ok('no WebGL: switching builds still works', (await page.textContent('[data-testid=crumb]')).includes('Rubber duck'));
  await page.screenshot({ path: 'shots/a11y-no-webgl.png' });
  ok('no WebGL: no uncaught errors', errs.length === 0, errs.join('|'));
  await browser.close();
}

const { browser, page, errors } = await launch({ width: 1440, height: 860 });
await page.goto(URL); await settle(page, 2500);

// 2) keyboard
const stepText = () => page.textContent('[data-testid=step-card]').then((t) => t.match(/STEP (\d+) \/ (\d+)/).slice(1).join('/'));
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('ArrowRight'); await settle(page, 300);
ok('first arrow enters Build at step 1 (does not skip it)', /^1\//.test(await stepText()) && (await page.getAttribute('[data-testid=mode-build]', 'aria-pressed')) === 'true', await stepText());
await page.keyboard.press('ArrowRight'); await settle(page, 200);
ok('second arrow goes to step 2', /^2\//.test(await stepText()));
await page.keyboard.press('Alt+ArrowRight'); await settle(page, 200);
ok('Alt+Arrow (browser Back) is not hijacked', /^2\//.test(await stepText()));
await page.focus('[data-testid=tab-steps]'); await page.keyboard.press('ArrowRight'); await settle(page, 300);
ok('arrows on the tab list move between tabs, not steps', (await page.getAttribute('[data-testid=tab-parts]', 'aria-selected')) === 'true' && /^2\//.test(await page.textContent('[data-testid=stepn]').then((t) => t.replace(/step (\d+) \/ (\d+)/, '$1/$2'))));
await page.keyboard.press('ArrowLeft'); await settle(page, 200);

// 3) ARIA state
ok('tabs: aria-selected + tabpanel wiring', (await page.getAttribute('[data-testid=tab-steps]', 'aria-selected')) === 'true' && (await page.getAttribute('#tabpanel', 'role')) === 'tabpanel' && (await page.getAttribute('#tabpanel', 'aria-labelledby')) === 'tab-steps');
ok('presets, looks and spin expose pressed state', (await page.getAttribute('[data-testid=preset-cottage]', 'aria-pressed')) === 'true' && (await page.getAttribute('[data-testid=look-studio]', 'aria-pressed')) === 'true' && (await page.getAttribute('[data-testid=rotate]', 'aria-pressed')) === 'false');
ok('slider announces "Step n of m"', /^Step \d+ of \d+$/.test(await page.getAttribute('.stepbar input[type=range]', 'aria-valuetext')));
ok('current step row is aria-current', (await page.$$('.steplist button[aria-current=step]')).length === 1);

// 4) key dialog: focus in, trapped, Escape closes, focus returns, arrows do nothing behind it
await page.focus('[data-testid=key-btn]'); await page.keyboard.press('Enter'); await settle(page, 300);
ok('dialog is modal and labelled', (await page.getAttribute('[role=dialog]', 'aria-modal')) === 'true' && !!(await page.getAttribute('[role=dialog]', 'aria-labelledby')));
ok('focus moves into the key field', (await page.evaluate(() => document.activeElement.getAttribute('data-testid'))) === 'key-input');
for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
ok('Tab stays inside the dialog', await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')));
const before = await stepText(); await page.keyboard.press('Escape'); await settle(page, 300);
ok('Escape closes the dialog and returns focus to the opener', !(await page.isVisible('[role=dialog]')) && (await page.evaluate(() => document.activeElement.getAttribute('data-testid'))) === 'key-btn');
await page.click('[data-testid=key-btn]'); await page.evaluate(() => document.activeElement.blur && 0);
await page.keyboard.press('ArrowRight'); await page.keyboard.press('Escape'); await settle(page, 200);
ok('arrow keys do not step the model behind an open dialog', (await stepText()) === before, `${before} -> ${await stepText()}`);
await page.click('[data-testid=key-btn]');
await page.fill('[data-testid=key-input]', 'sk-ant-bad key é'); await page.keyboard.press('Enter'); await settle(page, 300);
ok('a key with odd characters is rejected clearly, Enter submits', /plain letters/.test(await page.textContent('[data-testid=key-test]')));
await page.keyboard.press('Escape');

// 5) picture drop area is keyboard reachable
await page.focus('[data-testid=drop]');
ok('drop area is a focusable button', (await page.getAttribute('[data-testid=drop]', 'role')) === 'button');

// 6) framing: the whole model is inside the view at several window shapes
for (const [w, h] of [[1440, 860], [1000, 800], [768, 900], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h }); await settle(page, 900);
  const worst = await page.evaluate(() => {
    const v = window.__brick.viewer, m = window.__brick.model, g = m.grid;
    const pts = []; const H = g.H * 0.4;
    for (const x of [-g.W / 2, g.W / 2]) for (const y of [0, H]) for (const z of [-g.D / 2, g.D / 2]) pts.push([x, y, z]);
    v.camera.updateMatrixWorld(); let worst = 0;
    for (const [x, y, z] of pts) { const p = v.camera.position.constructor.prototype.clone.call({ x, y, z, clone() { return this; } }); }
    // project with three's Vector3 via the camera's own class
    const V = v.camera.position.constructor;
    for (const [x, y, z] of pts) { const p = new V(x, y, z).project(v.camera); worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y)); }
    return worst;
  });
  ok(`framing ${w}x${h}: whole model inside the view`, worst <= 1.0, `max |NDC| = ${worst.toFixed(2)}`);
}
await page.screenshot({ path: 'shots/a11y-390-framing.png' });

// 7) mobile: the step card is right under the 3D view, not 700px below
await page.click('[data-testid=mode-build]'); await settle(page, 600);
const gap = await page.evaluate(() => Math.round(document.querySelector('[data-testid=step-card]').getBoundingClientRect().top - document.querySelector('.stage').getBoundingClientRect().bottom));
ok('mobile: step card sits directly under the 3D view', gap < 160 && gap >= 0, `gap=${gap}px`);
await page.screenshot({ path: 'shots/a11y-390-build.png' });

// 8) contrast of secondary text >= 4.5:1
await page.setViewportSize({ width: 1440, height: 860 });
const ratio = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const parse = (c) => { const m = c.trim(); const h = m.startsWith('#') ? m : null; if (!h) return null; const n = h.length === 4 ? [...h.slice(1)].map((x) => parseInt(x + x, 16)) : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return n; };
  const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
  const a = parse(cs.getPropertyValue('--ink3')), b = parse(cs.getPropertyValue('--panel'));
  const [L1, L2] = [lum(a), lum(b)].sort((x, y) => y - x); return (L1 + 0.05) / (L2 + 0.05);
});
ok('secondary text contrast >= 4.5:1', ratio >= 4.5, ratio.toFixed(2));

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
