'use strict';
/** Gemini REST mijozi: streaming, kalitlarni almashtirish, qayta urinish. */
const base = () => process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

class GeminiError extends Error {
  constructor(message, status, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

function friendly(status, msg) {
  if (status === 400 && /api key/i.test(msg)) return "API kalit noto'g'ri. Sozlamalarda tekshiring.";
  if (status === 401 || status === 403) return 'API kalitga ruxsat yo\'q: ' + msg;
  if (status === 404) return 'Bu model topilmadi. Sozlamalardan boshqa model tanlang.';
  if (status === 429) return 'Gemini limiti tugadi. Biroz kuting yoki ikkinchi API kalit qo\'shing.';
  if (status >= 500) return 'Gemini serveri band, keyinroq urinib ko\'ring.';
  return `Gemini xatosi (${status}): ${msg}`;
}

async function toError(res) {
  let msg = '', retryAfter = 0;
  try {
    const text = await res.text();
    msg = text.slice(0, 500);
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0].error : j.error;
    msg = e.message || msg;
    for (const d of e.details || []) if (d.retryDelay) retryAfter = parseFloat(d.retryDelay) || 0;
  } catch { /* JSON emas */ }
  const err = new GeminiError(friendly(res.status, msg), res.status, retryAfter);
  err.raw = msg;
  return err;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
function abortError() { const e = new Error("To'xtatildi"); e.name = 'AbortError'; return e; }

function headers(key) { return { 'content-type': 'application/json', 'x-goog-api-key': key }; }

async function listModels(key) {
  const res = await fetch(`${base()}/models?pageSize=1000`, { headers: headers(key), signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw await toError(res);
  const j = await res.json();
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
    .filter((m) => /^gemini/.test(m.id) && !/tts|image|audio|live|embedding|robotics|computer-use|omni|transcribe/.test(m.id));
}

/** Oqimdan kelgan qismlarni birlashtiradi; thoughtSignature'lar o'zgarmasdan saqlanadi. */
function addPart(parts, p) {
  const last = parts[parts.length - 1];
  if (typeof p.text === 'string' && !p.thought && last && typeof last.text === 'string' && !last.thoughtSignature) {
    last.text += p.text;
    if (p.thoughtSignature) last.thoughtSignature = p.thoughtSignature;
  } else parts.push({ ...p });
}

async function streamOnce({ key, model, body, signal, onText, onThought }) {
  const res = await fetch(`${base()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: headers(key), body: JSON.stringify(body), signal,
  });
  if (!res.ok) throw await toError(res);
  const parts = [];
  let usage = null, finish = '', blocked = '', buf = '', emitted = false;
  const dec = new TextDecoder();
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    const j = JSON.parse(raw);
    if (j.error) throw new GeminiError(friendly(j.error.code, j.error.message), j.error.code);
    if (j.usageMetadata) usage = j.usageMetadata;
    if (j.promptFeedback?.blockReason) blocked = j.promptFeedback.blockReason;
    const c = j.candidates?.[0];
    if (!c) return;
    if (c.finishReason) finish = c.finishReason;
    for (const p of c.content?.parts || []) {
      if (p.thought) { if (p.text) onThought?.(p.text); continue; }
      if (p.text) { emitted = true; onText?.(p.text); }
      addPart(parts, p);
    }
  };
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); }
    }
    if (buf.trim()) handle(buf.trim());
  } catch (e) { e.emitted = emitted; throw e; }
  if (blocked) throw new GeminiError('So\'rov Gemini tomonidan bloklandi: ' + blocked, 0);
  return { parts: parts.filter((p) => p.text !== '' || p.thoughtSignature), usage, finish };
}

/**
 * keys: string[]; models: [asosiy, zaxira...]. state: { keyIndex } chaqiruvlar orasida saqlanadi.
 */
async function generate({ keys, models, state, body, signal, onText, onThought, onReset, onNotice }) {
  if (!keys.length) throw new GeminiError('API kalit kiritilmagan. Sozlamalarni oching.', 0);
  let b = body, lastErr;
  for (const model of models) {
    let keyTries = 0, waits = 0, thinkingDropped = false;
    while (true) {
      const key = keys[state.keyIndex % keys.length];
      try {
        const r = await streamOnce({ key, model, body: b, signal, onText, onThought });
        return { ...r, model };
      } catch (e) {
        if (e.name === 'AbortError' || signal?.aborted) throw abortError();
        lastErr = e;
        if (e.emitted) onReset?.();
        if (e.status === 400 && !thinkingDropped && /think/i.test(e.raw || '') && b.generationConfig?.thinkingConfig) {
          thinkingDropped = true;
          const { thinkingConfig, ...rest } = b.generationConfig;
          b = { ...b, generationConfig: rest };
          continue;
        }
        const network = !(e instanceof GeminiError);
        if (e.status === 429 || e.status === 403 || e.status === 401 || (e.status === 400 && /api key/i.test(e.raw || ''))) {
          if (++keyTries < keys.length) { state.keyIndex++; onNotice?.('Keyingi API kalitga o\'tildi'); continue; }
          if (e.status !== 429) throw e;
          keyTries = 0;
        }
        if (e.status === 404) { onNotice?.(`${model} mavjud emas, zaxira model sinaladi`); break; }
        if (e.status === 429 || e.status >= 500 || network) {
          const hasNext = model !== models[models.length - 1];
          const wait = e.retryAfter || Math.min(30, 3 * 2 ** waits);
          if (waits++ < (hasNext ? 1 : 4) && wait <= 65) {
            onNotice?.(`${network ? 'Internetda uzilish' : e.status === 429 ? 'Limit' : 'Server band'}: ${Math.ceil(wait)} soniyadan keyin qayta urinaman`);
            await sleep(wait * 1000, signal);
            continue;
          }
          if (hasNext) { onNotice?.('Zaxira modelga o\'tildi'); break; }
          if (network) throw new GeminiError('Internetga ulanib bo\'lmadi: ' + e.message, 0);
        }
        throw e;
      }
    }
  }
  throw lastErr;
}

async function transcribe({ key, model, wavBase64 }) {
  const res = await fetch(`${base()}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: headers(key), signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: 'audio/wav', data: wavBase64 } },
        { text: "Audiodagi gapni aynan yozib ber (odatda o'zbekcha, lotin alifbosida; ruscha bo'lsa ruscha). Faqat matnning o'zi. Gap bo'lmasa bo'sh qaytar." },
      ] }],
    }),
  });
  if (!res.ok) throw await toError(res);
  const j = await res.json();
  return (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
}

/** MCP JSON Schema'sini Gemini qabul qiladigan ko'rinishga keltiradi. */
const KEEP = ['type', 'title', 'description', 'enum', 'format', 'items', 'prefixItems', 'minItems', 'maxItems',
  'minimum', 'maximum', 'anyOf', 'oneOf', 'properties', 'required'];
function cleanSchema(schema) {
  const root = schema;
  const walk = (s, depth) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { type: 'string' };
    if (depth > 12) return { type: 'object' };
    if (s.$ref && s.$ref.startsWith('#')) {
      let t = root;
      for (const k of s.$ref.slice(1).split('/').filter(Boolean)) t = t?.[k.replace(/~1/g, '/').replace(/~0/g, '~')];
      return walk(t, depth + 1);
    }
    const o = {};
    for (const k of KEEP) if (s[k] !== undefined) o[k] = s[k];
    if (s.const !== undefined) o.enum = [s.const];
    if (o.format && !['date-time', 'date', 'time'].includes(o.format)) delete o.format;
    if (s.default !== undefined) o.description = `${o.description ? o.description + '. ' : ''}Default: ${JSON.stringify(s.default)}`;
    if (o.properties) o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, walk(v, depth + 1)]));
    if (Array.isArray(o.items)) o.items = o.items[0] || {};
    if (o.items) o.items = walk(o.items, depth + 1);
    for (const k of ['prefixItems', 'anyOf', 'oneOf']) if (o[k]) o[k] = o[k].map((x) => walk(x, depth + 1));
    if (!o.type && !o.anyOf && !o.oneOf && !o.enum) {
      if (o.properties) o.type = 'object';
      else o.anyOf = [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }, { type: 'array', items: { type: 'number' } }];
    }
    if (o.type === 'array' && !o.items) o.items = { type: 'string' };
    return o;
  };
  const out = walk(schema || {}, 0);
  return { ...out, type: 'object', properties: out.properties || {} };
}

module.exports = { generate, listModels, transcribe, cleanSchema, GeminiError };
