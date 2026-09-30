import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const URL = process.env.APP_URL || 'http://localhost:4173/';
const candidates = [process.env.CHROMIUM_PATH,'/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'];
export const exe = candidates.find((p) => { try { return p && fs.statSync(p).isFile(); } catch { return false; } }); // undefined -> Playwright's own download (npx playwright-core install chromium)

export async function launch(viewport = { width: 1440, height: 860 }) {
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return { browser, page, errors };
}
export const settle = (page, ms = 900) => page.waitForTimeout(ms);
