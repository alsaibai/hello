// Talks to the Anthropic Messages API straight from the browser (the user's own key).
import { TOOL, systemPrompt, userContent, repairText } from './prompt.js';
import { buildModel } from '../engine/pipeline.js';

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (fast, default)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (best shapes)' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1 (most capable, slowest)' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (cheapest)' },
];
export const API_URL = 'https://api.anthropic.com/v1/messages';
const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1';
const headers = (key) => ({ 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/** Never echo the key: strip it from anything that might reach the screen. */
const scrub = (text, key) => (key ? String(text).split(key).join('[key]') : String(text));

/** First balanced {...} in text (handles code fences and prose around it). */
export function extractJson(text) {
  const t = String(text || '');
  for (let start = t.indexOf('{'); start >= 0; start = t.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { break; } }
    }
  }
  return null;
}

/** fetch with retries for rate limits, overload and dropped connections. */
export async function fetchRetry(url, init, { retries = 3, signal, fetchFn = (...a) => fetch(...a), onRetry } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, { ...init, signal });
      if (![429, 500, 502, 503, 529].includes(res.status) || attempt === retries) return res;
      const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
      const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : Math.min(2 ** attempt * 1500, 12000);
      if (onRetry) onRetry(attempt + 1, res.status, wait);
      last = res;
      await sleep(wait, signal);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (attempt === retries) throw e;
      const wait = Math.min(2 ** attempt * 1500, 12000);
      if (onRetry) onRetry(attempt + 1, 'network', wait);
      await sleep(wait, signal);
    }
  }
  return last;
}

async function apiError(res, key) {
  let msg = res.statusText;
  try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch { /* keep statusText */ }
  if (res.status === 401) msg = 'The API key was rejected (401). Check it.';
  else if (res.status === 403) msg = 'This key is not allowed to use that model (403).';
  else if (res.status === 429) msg = 'Rate limited (429). Wait a moment and try again.';
  else if (res.status === 529 || res.status === 503) msg = 'The API is overloaded right now. Try again shortly.';
  return new Error(scrub(`Anthropic API ${res.status}: ${msg}`, key));
}

/** Check a key without spending tokens (lists one model). Resolves { ok, message }. */
export async function testKey(key, { signal, fetchFn } = {}) {
  try {
    const res = await fetchRetry(MODELS_URL, { method: 'GET', headers: headers(key) }, { retries: 1, signal, fetchFn });
    if (res.ok) return { ok: true, message: 'Key accepted.' };
    return { ok: false, message: (await apiError(res, key)).message };
  } catch (e) {
    return { ok: false, message: scrub(e.message || 'Network error', key) };
  }
}

/** Parse a Server-Sent-Events byte stream into { blocks, text, stop }. Blocks are tracked by index. */
export async function readStream(body, onProgress, key) {
  const reader = body.getReader(), dec = new TextDecoder();
  const blocks = new Map();
  let buf = '', text = '', stop = null, chars = 0, sawStop = false;
  const block = (i) => { if (!blocks.has(i)) blocks.set(i, { type: 'other', name: '', json: '' }); return blocks.get(i); };
  const handle = (chunk) => {
    const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) return;
    let ev; try { ev = JSON.parse(data); } catch { return; }
    if (ev.type === 'content_block_start') { const b = block(ev.index); b.type = ev.content_block.type; b.name = ev.content_block.name || ''; }
    else if (ev.type === 'content_block_delta') {
      if (ev.delta.type === 'input_json_delta') { block(ev.index).json += ev.delta.partial_json; chars += ev.delta.partial_json.length; }
      else if (ev.delta.type === 'text_delta') { text += ev.delta.text; chars += ev.delta.text.length; }
      if (onProgress) onProgress(chars);
    } else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; }
    else if (ev.type === 'message_stop') sawStop = true;
    else if (ev.type === 'error') {
      const kind = ev.error && ev.error.type;
      throw new StreamError(scrub(`Anthropic API error: ${(ev.error && ev.error.message) || kind}`, key), ['overloaded_error', 'api_error', 'rate_limit_error'].includes(kind));
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n'); // normalise the whole buffer: a CRLF can straddle two chunks
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, cut); buf = buf.slice(cut + 2); handle(chunk); }
  }
  buf += dec.decode();
  if (buf.trim()) handle(buf);
  return { blocks: [...blocks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]), text, stop, complete: sawStop || stop !== null };
}

/** A failure inside an otherwise successful (200) stream: overloads and dropped connections are worth retrying. */
export class StreamError extends Error {
  constructor(message, retryable) { super(message); this.name = 'StreamError'; this.retryable = retryable; }
}

/** Errors the loop can recover from by asking again (the model answered in words, or ran out of room). */
export class NoModelError extends Error {
  constructor(message, kind, said = '') { super(message); this.name = 'NoModelError'; this.kind = kind; this.said = said; }
}

/** One streamed request. Resolves to the submitted spec object. Retries HTTP failures AND stream-level overloads/dropped connections. */
export async function requestSpec({ key, model, messages, signal, onProgress, onRetry, fetchFn, opts = {} }) {
  const body = JSON.stringify({ model, max_tokens: 24000, stream: true, system: systemPrompt(opts), tools: [TOOL], tool_choice: { type: 'auto', disable_parallel_tool_use: true }, messages });
  const usable = (v) => (v && typeof v === 'object' && Array.isArray(v.shapes) ? v : null); // a fragment of a cut-off answer is not a model
  for (let attempt = 0; ; attempt++) {
    const res = await fetchRetry(API_URL, { method: 'POST', headers: headers(key), body }, { signal, fetchFn, onRetry });
    if (!res.ok) throw await apiError(res, key);
    let streamed;
    try {
      streamed = await readStream(res.body, onProgress, key);
      if (!streamed.complete && !(streamed.blocks.some((b) => b.type === 'tool_use' && usable(safeParse(b.json))))) throw new StreamError('The connection dropped before the answer finished.', true);
    } catch (e) {
      const retryable = e instanceof StreamError ? e.retryable : (e && e.name !== 'AbortError' && e instanceof TypeError); // network failure while reading
      if (!retryable || attempt >= 2) throw e;
      const wait = Math.min(2 ** attempt * 1500, 12000);
      if (onRetry) onRetry(attempt + 1, 'stream', wait);
      await sleep(wait, signal);
      continue;
    }
    const { blocks, text, stop } = streamed;
    if (stop === 'refusal') throw new Error('The model declined this request.');
    let spec = null;
    const tool = blocks.find((b) => b.type === 'tool_use' && b.name === 'submit_model' && b.json);
    if (tool) spec = usable(safeParse(tool.json));
    if (!spec) spec = usable(extractJson(text));
    if (spec) return spec;
    if (stop === 'max_tokens') throw new NoModelError('The answer was cut off (too long).', 'cut-off');
    const said = scrub(text.trim().slice(0, 300), key);
    throw new NoModelError('The model did not return a usable shape description.' + (said ? ` It said: "${said.slice(0, 160)}"` : ''), 'no-model', said);
  }
}

function safeParse(t) { try { return JSON.parse(t); } catch { return null; } }

/**
 * Ask -> build -> check -> (send problems back) x maxRounds.
 * onEvent receives: {type:'ask'|'progress'|'retry'|'built', ...}. `build` may be async (web worker).
 */
export async function generate({ prompt, image, key, model, signal, onEvent = () => {}, maxRounds = 3, request = requestSpec, build = buildModel, opts = {} }) {
  const messages = [{ role: 'user', content: userContent(prompt, image) }];
  const attempts = []; // { spec, problems } of every round so far
  for (let round = 1; round <= maxRounds; round++) {
    onEvent({ type: 'ask', round, repair: round > 1 });
    let spec;
    try {
      spec = await askWithNudge({ request, key, model, messages, signal, opts, round, onEvent });
    } catch (e) {
      // A later round failed (network, overload): fall back to the best earlier attempt instead of losing everything
      if (round > 1 && attempts.length && !(e && e.name === 'AbortError')) {
        const ranked = attempts.slice().sort((a, b) => a.problems - b.problems || b.round - a.round); // fewest problems first, then newest
        for (const a of ranked) {
          const out = await build(a.spec, { ...opts, prune: true });
          if (out.ok) {
            onEvent({ type: 'fallback', round, message: e.message, pruned: !!out.pruned, fromRound: a.round });
            return { ...out, spec: a.spec, rounds: a.round, apiFailure: e.message };
          }
        }
      }
      throw e;
    }
    const last = round === maxRounds;
    const out = await build(spec, { ...opts, prune: last });
    attempts.push({ spec, round, problems: out.ok ? 0 : out.problems.length });
    onEvent({ type: 'built', round, ok: out.ok, problems: out.problems, warnings: out.warnings, spec, model: out.model, pruned: !!out.pruned, prunedProblems: out.prunedProblems });
    if (out.ok) return { ...out, spec, rounds: round };
    if (last) return { ...out, spec, rounds: round };
    messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Submitted description:\n' + JSON.stringify(spec) }] });
    messages.push({ role: 'user', content: [{ type: 'text', text: repairText(out.problems) }] });
  }
}

/** Ask once; if the model answered in words or was cut off, nudge it once to call the tool with a compact answer. */
async function askWithNudge({ request, key, model, messages, signal, opts, round, onEvent }) {
  const go = () => request({
    key, model, messages, signal, opts,
    onProgress: (chars) => onEvent({ type: 'progress', round, chars }),
    onRetry: (n, why, ms) => onEvent({ type: 'retry', round, attempt: n, why, ms }),
  });
  try { return await go(); } catch (e) {
    if (!(e instanceof NoModelError)) throw e;
    onEvent({ type: 'nudge', round, kind: e.kind });
    const ask = e.kind === 'cut-off'
      ? 'Your answer was cut off. Call submit_model again with a MORE COMPACT description: fewer, larger shapes, no long labels.'
      : 'Please do not ask questions or explain. Call the submit_model tool now with your best attempt.';
    const nudged = [...messages, { role: 'assistant', content: [{ type: 'text', text: e.said || 'Understood.' }] }, { role: 'user', content: [{ type: 'text', text: ask }] }];
    return request({
      key, model, messages: nudged, signal, opts,
      onProgress: (chars) => onEvent({ type: 'progress', round, chars }),
      onRetry: (n, why, ms) => onEvent({ type: 'retry', round, attempt: n, why, ms }),
    });
  }
}
