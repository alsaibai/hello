// End-to-end: the real app in a real browser, with api.anthropic.com replaced by a fake streaming server.
import { launch, URL, settle } from './lib.mjs';

const box = (color, pos, size, label) => ({ shape: 'box', color, pos, size, label });
const broken = { name: 'Twin towers', footprint: [12, 4], shapes: [box('Red', [1, 0, 1], [3, 4, 2], 'left tower'), box('Blue', [8, 0, 1], [3, 4, 2], 'right tower')] };
const fixedSpec = { ...broken, shapes: [...broken.shapes, box('Yellow', [2, 4, 1], [8, 1, 2], 'bridge'), box('Yellow', [4, 5, 1], [4, 1, 2], 'top block')] };

const sse = (spec) => {
  const json = JSON.stringify(spec), parts = json.match(/[\s\S]{1,90}/g);
  const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;
  return ev('message_start', { type: 'message_start', message: { id: 'm', role: 'assistant', content: [] } })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'submit_model', input: {} } })
    + parts.map((p) => ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: p } })).join('')
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' } })
    + ev('message_stop', { type: 'message_stop' });
};
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

const results = [];
const ok = (name, cond, extra = '') => { results.push(cond); console.log(cond ? 'PASS' : 'FAIL', name, extra); };

const { browser, page, errors } = await launch();
const requests = [];
let mode = 'repair', modelsCalls = 0;
await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (req.method() === 'GET' && /\/v1\/models/.test(req.url())) {
    modelsCalls++;
    return mode === 'badkey' ? route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: '{"error":{"message":"invalid x-api-key"}}' }) : route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"data":[]}' });
  }
  const body = JSON.parse(req.postData());
  requests.push({ headers: req.headers(), body });
  if (mode === 'badkey') return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
  if (mode === 'busy' && requests.length === 1) return route.fulfill({ status: 529, headers: { ...cors, 'content-type': 'application/json', 'retry-after': '1' }, body: '{"error":{"message":"Overloaded"}}' });
  const spec = mode === 'repair' && requests.length === 1 ? broken : fixedSpec;
  return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: sse(spec) });
});

await page.goto(URL); await settle(page, 2000);

// no key yet: generate asks for one
await page.fill('[data-testid=prompt]', 'two towers joined by a bridge');
await page.click('[data-testid=generate]');
ok('asks for a key when none is set', await page.isVisible('[data-testid=key-input]'));
await page.screenshot({ path: 'shots/ai-0-key-dialog.png' });
await page.fill('[data-testid=key-input]', 'sk-ant-test-123');
await page.click('[data-testid=key-save]');
ok('key saved (button shows dot)', /●/.test(await page.textContent('[data-testid=key-btn]')));

// 1) text prompt with one repair round
await page.click('[data-testid=generate]');
await page.waitForSelector('[data-testid=log] .ok', { timeout: 30000 });
await settle(page, 1500);
const logText = await page.textContent('[data-testid=log]');
console.log('   log:', logText.replace(/\s+/g, ' ').slice(0, 400));
ok('two API calls were made (build, then repair)', requests.length === 2, `calls=${requests.length}`);
ok('key + browser-access headers sent to api.anthropic.com', requests[0].headers['x-api-key'] === 'sk-ant-test-123' && requests[0].headers['anthropic-dangerous-direct-browser-access'] === 'true' && requests[0].headers['anthropic-version'] === '2023-06-01');
ok('request uses the chosen model and a submit_model tool', requests[0].body.model === 'claude-sonnet-5-5' && requests[0].body.tools[0].name === 'submit_model' && requests[0].body.stream === true);
const second = requests[1].body.messages;
ok('2nd call carries the checker problems back', second.length === 3 && /not attached to the main model/.test(second[2].content[0].text) && /right tower|left tower/.test(second[2].content[0].text), second[2] && second[2].content[0].text.slice(0, 120));
ok('log shows the problem then success', /problem/.test(logText) && /one connected piece ✓/.test(logText));
ok('crumb says AI · 2 rounds', /AI · Twin towers · 2 rounds/.test(await page.textContent('[data-testid=crumb]')), await page.textContent('[data-testid=crumb]'));
await page.screenshot({ path: 'shots/ai-1-repaired-model.png' });
await page.click('[data-testid=tab-checks]'); await settle(page, 300);
await page.screenshot({ path: 'shots/ai-2-checks.png' });
const checkMarks = await page.$$eval('[data-testid=checks] b', (b) => b.map((x) => x.textContent));
ok('all checks tick', checkMarks.length >= 5 && checkMarks.every((m) => m === '✓'), checkMarks.join(''));
await page.click('[data-testid=tab-steps]'); await page.click('[data-testid=mode-build]');
await page.fill('.stepbar input[type=range]', '3'); await settle(page, 900);
await page.screenshot({ path: 'shots/ai-3-build-step.png' });

// 2) picture drop
requests.length = 0; mode = 'ok';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await page.fill('[data-testid=prompt]', '');
await page.setInputFiles('[data-testid=file]', { name: 'pic.png', mimeType: 'image/png', buffer: png });
await settle(page, 500);
await page.screenshot({ path: 'shots/ai-4-image-attached.png' });
await page.click('[data-testid=generate]');
await page.waitForSelector('[data-testid=log] .ok', { timeout: 30000 });
const content = requests[0].body.messages[0].content;
ok('picture sent as an image block (jpeg base64)', content[0].type === 'image' && content[0].source.media_type === 'image/jpeg' && content[0].source.data.length > 50, content[0].type);

// 2b) API busy: 529 first, then success, with a visible retry notice
requests.length = 0; mode = 'busy';
await page.setInputFiles('[data-testid=file]', []); 
await page.click('button:has-text("×")').catch(() => {});
await page.fill('[data-testid=prompt]', 'a tiny tower');
await page.click('[data-testid=generate]');
await page.waitForSelector('[data-testid=log] .ok', { timeout: 30000 });
const busyLog = await page.textContent('[data-testid=log]');
ok('529 is retried and the log says so', /API busy \(529\), retrying/.test(busyLog) && requests.length === 2, busyLog.replace(/\s+/g, ' ').slice(0, 160));
await page.screenshot({ path: 'shots/ai-4b-retry.png' });

// 2c) test key button
await page.click('[data-testid=key-btn]');
mode = 'ok'; await page.click('[data-testid=key-testbtn]'); await settle(page, 600);
ok('Test key accepts a good key', /✓ Key accepted/.test(await page.textContent('[data-testid=key-test]')));
mode = 'badkey'; await page.click('[data-testid=key-testbtn]'); await settle(page, 600);
ok('Test key rejects a bad key', /✗ .*401/.test(await page.textContent('[data-testid=key-test]')));
await page.screenshot({ path: 'shots/ai-4c-test-key.png' });
await page.keyboard.press('Escape'); await settle(page, 300);
ok('Escape closes the key dialog', !(await page.isVisible('[data-testid=key-input]')));

// 3) rejected key
requests.length = 0; mode = 'badkey';
await page.click('[data-testid=generate]');
await page.waitForSelector('[data-testid=error]', { timeout: 15000 });
const err = await page.textContent('[data-testid=error]');
ok('bad key shows a clear message', /401|rejected/i.test(err), err);
await page.screenshot({ path: 'shots/ai-5-bad-key.png' });

const real = errors.filter((e) => !/401|529/.test(e)); // the 401/529 are the deliberate bad-key and overload cases
ok('no page errors', real.length === 0, real.join(' | '));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
