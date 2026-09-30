// Drives the built app in headless Chromium and saves screenshots to ./shots.
import { launch, URL, settle } from './lib.mjs';
import { PRESETS } from '../src/presets/index.js';

const { browser, page, errors } = await launch();
let workers = 0; page.on('worker', () => { workers++; });
const out = (n) => `shots/${n}.png`;
const checks = [];
const ok = (name, cond, extra = '') => { checks.push([name, !!cond, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra); };

await page.goto(URL); await settle(page, 2500);
await page.screenshot({ path: out('01-home') });

// every ready-made build
for (const p of PRESETS) {
  await page.click(`[data-testid=preset-${p.id}]`); await settle(page, 1200);
  await page.click('[data-testid=mode-model]');
  await page.screenshot({ path: out(`preset-${p.id}`), clip: { x: 268, y: 38, width: 844, height: 822 } });
  const crumb = await page.textContent('[data-testid=crumb]');
  ok(`preset ${p.id} loads`, /parts/.test(crumb), crumb);
}

// build mode: step through and check highlight + max 4
await page.click('[data-testid=preset-duck]'); await settle(page, 800);
await page.click('[data-testid=mode-build]'); await settle(page, 600);
for (const target of [1, 12, 30]) {
  await page.fill('.stepbar input[type=range]', String(target)); await settle(page, 900);
  await page.screenshot({ path: out(`build-step-${target + 1}`) });
}
const chips = await page.$$eval('[data-testid=step-card] .chip b', (els) => els.map((e) => parseInt(e.textContent)));
ok('step card lists <= 4 pieces', chips.reduce((a, b) => a + b, 0) <= 4, JSON.stringify(chips));
const stepCount = await page.$$eval('.steplist button', (b) => b.length);
const per = await page.evaluate(() => window.__brick.model.steps.map((s) => s.parts.length));
ok('every step has 1..4 pieces', per.every((n) => n >= 1 && n <= 4), `${stepCount} steps, max ${Math.max(...per)}`);
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.keyboard.press('ArrowRight'); await settle(page, 300);
ok('arrow key advances step', /step 32 /.test(await page.textContent('[data-testid=stepn]')), await page.textContent('[data-testid=stepn]'));
await page.fill('.stepbar input[type=range]', String(per.length - 1)); await settle(page, 900);
await page.screenshot({ path: out('build-last-step') });

// lighting looks
await page.click('[data-testid=preset-racer]'); await page.click('[data-testid=mode-model]');
for (const l of ['studio', 'day', 'golden', 'noir']) {
  await page.click(`[data-testid=look-${l}]`); await settle(page, 1300);
  await page.screenshot({ path: out(`look-${l}`), clip: { x: 268, y: 38, width: 844, height: 822 } });
}
await page.click('[data-testid=look-studio]');

// tabs
await page.click('[data-testid=preset-cottage]'); await settle(page, 600);
for (const t of ['parts', 'checks', 'spec']) { await page.click(`[data-testid=tab-${t}]`); await settle(page, 300); await page.screenshot({ path: out(`tab-${t}`) }); }

// smooth tops (tiles): parts list gains tiles, model still one connected piece
await page.click('[data-testid=preset-racer]'); await settle(page, 900);
await page.click('[data-testid=opt-tiles]'); await settle(page, 1500);
await page.click('[data-testid=mode-model]');
await page.screenshot({ path: out('tiles-racer'), clip: { x: 268, y: 38, width: 844, height: 822 } });
await page.click('[data-testid=tab-parts]'); await settle(page, 300);
const partsText = await page.textContent('[data-testid=parts-table]');
ok('tiles appear in the parts list when smooth tops is on', /Tile \d×\d/.test(partsText));
await page.click('[data-testid=tab-checks]'); await settle(page, 300);
const chk = await page.$$eval('[data-testid=checks] b', (b) => b.map((x) => x.textContent).join(''));
ok('tiles: all checks still tick', /^✓+$/.test(chk), chk);
await page.click('[data-testid=opt-tiles]'); await settle(page, 1200);

// roofs made of real slope parts
await page.click('[data-testid=preset-barn]'); await settle(page, 1500);
await page.screenshot({ path: out('roof-barn'), clip: { x: 268, y: 38, width: 844, height: 822 } });
await page.click('[data-testid=tab-parts]'); await settle(page, 300);
ok('slope parts listed with BrickLink numbers', /Slope 45 2×[12]/.test(await page.textContent('[data-testid=parts-table]')) && /#(3040b|3039)/.test(await page.textContent('[data-testid=parts-table]')));
await page.click('[data-testid=mode-build]'); await page.fill('.stepbar input[type=range]', '20'); await settle(page, 1000);
await page.screenshot({ path: out('roof-barn-build') });
await page.click('[data-testid=mode-model]');

// common colours only: switching does not break anything
await page.click('[data-testid=opt-common]'); await settle(page, 1200);
ok('common-colours toggle rebuilds', /Barn/.test(await page.textContent('[data-testid=crumb]')));
await page.click('[data-testid=opt-common]'); await settle(page, 800);

// baseplate: a real baseplate part is step 1 on its own, and everything is still one piece
await page.click('[data-testid=preset-cottage]'); await settle(page, 900);
await page.click('[data-testid=opt-base]'); await settle(page, 1500);
await page.click('[data-testid=mode-model]');
await page.screenshot({ path: out('baseplate-model'), clip: { x: 268, y: 38, width: 844, height: 822 } });
await page.click('[data-testid=tab-steps]'); await page.click('[data-testid=mode-build]'); await page.fill('.stepbar input[type=range]', '0'); await settle(page, 900);
ok('baseplate is step 1, alone', /1 × Baseplate 16×16/.test(await page.textContent('[data-testid=step-card]')) && (await page.$$('[data-testid=step-card] .chip')).length === 1, (await page.textContent('[data-testid=step-card]')).slice(0, 80));
await page.screenshot({ path: out('baseplate-step1') });
await page.fill('.stepbar input[type=range]', '4'); await settle(page, 900);
await page.screenshot({ path: out('baseplate-step5') });
await page.click('[data-testid=tab-parts]'); await settle(page, 300);
ok('baseplate in the parts list', /Baseplate 16×16.*#3867/.test(await page.textContent('[data-testid=parts-table]')));
await page.click('[data-testid=mode-model]');
await page.click('[data-testid=opt-base]'); await settle(page, 900);

// photo mosaic, no key needed
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 240); sky.addColorStop(0, '#2a6fdb'); sky.addColorStop(1, '#bfe0ff'); g.fillStyle = sky; g.fillRect(0, 0, 320, 240);
  g.fillStyle = '#2f9e44'; g.beginPath(); g.moveTo(0, 240); g.quadraticCurveTo(160, 120, 320, 240); g.fill();
  g.fillStyle = '#ffd43b'; g.beginPath(); g.arc(250, 55, 30, 0, 7); g.fill();
  g.fillStyle = '#e03131'; g.fillRect(120, 140, 50, 40); return c.toDataURL('image/png');
});
await page.setInputFiles('[data-testid=file]', { name: 'picture.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
await settle(page, 600);
await page.selectOption('select[aria-label="Mosaic width in studs"]', '32');
await page.click('[data-testid=mosaic]'); await settle(page, 2500);
const crumbM = await page.textContent('[data-testid=crumb]');
ok('photo mosaic builds without a key', /mosaic · 32×24 studs/.test(crumbM), crumbM);
await page.screenshot({ path: out('mosaic-model') });
await page.click('[data-testid=tab-checks]'); await settle(page, 300);
ok('mosaic passes every check', /^✓+$/.test(await page.$$eval('[data-testid=checks] b', (b) => b.map((x) => x.textContent).join(''))));
await page.screenshot({ path: out('mosaic-checks') });
await page.click('[data-testid=mode-build]'); await page.fill('.stepbar input[type=range]', '30'); await settle(page, 900);
await page.screenshot({ path: out('mosaic-build') });
await page.click('[data-testid=mode-model]');
// the options work on a mosaic too: smooth tops turns the picture layer into tiles
await page.click('[data-testid=opt-tiles]'); await settle(page, 2500);
ok('mosaic + smooth tops: still a mosaic, now with tiles', /mosaic/.test(await page.textContent('[data-testid=crumb]')));
await page.click('[data-testid=tab-parts]'); await settle(page, 300);
ok('mosaic parts list contains tiles', /Tile 1×1/.test(await page.textContent('[data-testid=parts-table]')));
await page.screenshot({ path: out('mosaic-tiles') });
await page.click('[data-testid=opt-tiles]'); await settle(page, 1500);
// a noisy picture at 48 studs needs too many parts: the app falls back by itself and says so
const noise = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 240; c.height = 240; const g = c.getContext('2d'); const d = g.createImageData(240, 240); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); return c.toDataURL('image/png'); });
await page.setInputFiles('[data-testid=file]', { name: 'noise.png', mimeType: 'image/png', buffer: Buffer.from(noise.split(',')[1], 'base64') });
await settle(page, 600);
await page.selectOption('select[aria-label="Mosaic width in studs"]', '48');
await page.click('[data-testid=mosaic]'); await settle(page, 6000);
const fb = await page.textContent('[data-testid=crumb]');
ok('48-stud noise picture falls back automatically and says so', /mosaic/.test(fb) && /(dithering off|reduced from 48)/.test(fb) && !(await page.isVisible('[data-testid=error]')), fb);
await page.click('[data-testid=mode-model]');
await page.click('[data-testid=mode-model]');

// stability warning shows in Checks
await page.click('[data-testid=preset-cottage]'); await settle(page, 900);
await page.click('[data-testid=tab-spec]');
await page.fill('[data-testid=spec-text]', JSON.stringify({ name: 'Leaning', footprint: [12, 6], shapes: [{ shape: 'box', color: 'Red', pos: [0, 0, 0], size: [2, 2, 2] }, { shape: 'box', color: 'Blue', pos: [0, 2, 0], size: [12, 3, 2] }, { shape: 'box', color: 'Yellow', pos: [10, 5, 0], size: [2, 3, 2] }] }));
await page.click('button:has-text("Rebuild")'); await settle(page, 900);
await page.click('[data-testid=tab-checks]'); await settle(page, 300);
ok('tipping warning appears in Checks', /tip over/.test(await page.textContent('[data-testid=pane-checks]')));
await page.screenshot({ path: out('stability-warning') });

ok('build ran in a Web Worker', workers > 0, `workers=${workers}`);

// spec tab: a broken description is rejected in plain words, a fixed one rebuilds
await page.click('[data-testid=tab-spec]');
const broken = { name: 'Broken', footprint: [10, 4], shapes: [{ shape: 'box', color: 'Red', pos: [0, 0, 0], size: [2, 3, 2], label: 'left' }, { shape: 'box', color: 'Blue', pos: [7, 0, 0], size: [2, 3, 2], label: 'right' }] };
await page.fill('[data-testid=spec-text]', JSON.stringify(broken));
await page.click('button:has-text("Rebuild")'); await settle(page, 400);
const specErr = await page.textContent('.err');
ok('spec tab rejects a disconnected model with reasons', /not attached to the main model/.test(specErr), specErr.slice(0, 90));
await page.screenshot({ path: out('tab-spec-rejected') });
broken.shapes.push({ shape: 'box', color: 'Yellow', pos: [1, 3, 0], size: [7, 1, 2] });
await page.fill('[data-testid=spec-text]', JSON.stringify(broken));
await page.click('button:has-text("Rebuild")'); await settle(page, 800);
ok('spec tab rebuilds once bridged', /Broken · \d+ parts · \d+ steps · edited spec/.test(await page.textContent('[data-testid=crumb]')), await page.textContent('[data-testid=crumb]'));

// mobile layout
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(URL); await m.waitForTimeout(2500); await m.screenshot({ path: out('mobile'), fullPage: false });
const hscroll = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
ok('mobile has no horizontal scroll', !hscroll);

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(checks.every((c) => c[1]) ? 0 : 1);
