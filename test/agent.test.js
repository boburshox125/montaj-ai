'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let script = [], seen = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    seen.push({ key: req.headers['x-goog-api-key'], url: req.url, body: JSON.parse(b) });
    const r = script.shift();
    if (r.status) { res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: r.msg || 'err', details: r.details } })); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const p of r.parts) res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [p] } }] })}\r\n\r\n`);
    res.end(`data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5 } })}\n\n`);
  });
});
let runAgent, repair, compact, cleanSchema, policy;
test.before(async () => {
  await new Promise((r) => srv.listen(0, r));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
  ({ runAgent, repair, compact } = require('../src/core/agent'));
  ({ cleanSchema } = require('../src/core/gemini'));
  policy = require('../src/core/policy');
});
test.after(() => srv.close());

function fakeHub(calls) {
  const server = { def: { name: 'premiere' }, state: 'ready' };
  const map = new Map(['get_sequence_state', 'remove_clips', 'apply_effect', 'backup_project', 'run_extendscript', 'export_frame'].map((n) => [n, { server, tool: { name: n, inputSchema: { type: 'object', properties: {} } } }]));
  return {
    tools: () => map, declarations: (m, f) => [...m].filter(([n, e]) => f(n, e)).map(([name]) => ({ name, description: name })), instructions: () => '',
    call: async (e, args) => { calls.push(e.tool.name); return { content: e.tool.name === 'export_frame' ? [{ type: 'text', text: 'k' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] : [{ type: 'text', text: 'ok' }] }; },
  };
}
async function go(s, o = {}) {
  script = s; seen = [];
  const calls = [], events = [], contents = [];
  await runAgent({ hub: fakeHub(calls), keys: ['k1'], models: ['gemini-3.8-flash'], keyState: { keyIndex: 0 }, mode: 'ask', rules: '', autoBackup: true, contents, userParts: [{ text: 'x' }], signal: new AbortController().signal, emit: (t, d) => events.push([t, d]), approve: async () => 'once', ...o });
  return { calls, events, contents };
}
const fc = (name, args = {}, sig) => ({ functionCall: { name, args, id: 'id1' }, ...(sig ? { thoughtSignature: sig } : {}) });

test('vosita chaqiruvi, imzo va id saqlanadi', async () => {
  const r = await go([{ parts: [fc('get_sequence_state', {}, 'SIG')] }, { parts: [{ text: 'Tay' }, { text: 'yor' }] }]);
  assert.deepEqual(r.calls, ['get_sequence_state']);
  assert.equal(seen[1].body.contents[1].parts[0].thoughtSignature, 'SIG');
  assert.equal(seen[1].body.contents[2].parts[0].functionResponse.id, 'id1');
  assert.equal(r.contents.at(-1).parts[0].text, 'Tayyor');
});
test('o\'zgartirishdan oldin bir marta zaxira', async () => {
  const r = await go([{ parts: [fc('apply_effect'), fc('apply_effect')] }, { parts: [{ text: 'ok' }] }]);
  assert.deepEqual(r.calls, ['backup_project', 'apply_effect', 'apply_effect']);
});
test('rad etilsa bajarilmaydi', async () => {
  const r = await go([{ parts: [fc('remove_clips')] }, { parts: [{ text: 'ok' }] }], { approve: async () => 'deny' });
  assert.deepEqual(r.calls, []);
});
test('reja rejimi o\'zgartirmaydi', async () => {
  const r = await go([{ parts: [fc('apply_effect')] }, { parts: [{ text: 'reja' }] }], { mode: 'plan' });
  assert.deepEqual(r.calls, []);
  assert.ok(!seen[0].body.tools[0].functionDeclarations.some((d) => d.name === 'apply_effect'));
});
test('avto rejimda ham skript so\'raladi', async () => {
  let asked = 0;
  await go([{ parts: [fc('run_extendscript', { code: '1' })] }, { parts: [{ text: 'ok' }] }], { mode: 'auto', approve: async () => { asked++; return 'deny'; } });
  assert.equal(asked, 1);
});
test('rasm functionResponse ichida ketadi', async () => {
  await go([{ parts: [fc('export_frame')] }, { parts: [{ text: 'ok' }] }]);
  assert.equal(seen[1].body.contents[2].parts[0].functionResponse.parts[0].inlineData.data, 'AAAA');
});
test('429: keyingi kalitga o\'tadi', async () => {
  await go([{ status: 429 }, { parts: [{ text: 'ok' }] }], { keys: ['k1', 'k2'] });
  assert.deepEqual(seen.map((s) => s.key), ['k1', 'k2']);
});
test('404: zaxira model', async () => {
  await go([{ status: 404 }, { parts: [{ text: 'ok' }] }], { models: ['a', 'b'] });
  assert.match(seen[1].url, /models\/b:/);
});
test('thinking qo\'llanmasa olib tashlanadi', async () => {
  await go([{ status: 400, msg: 'thinking is not supported' }, { parts: [{ text: 'ok' }] }]);
  assert.ok(!seen[1].body.generationConfig.thinkingConfig);
});
test('bekor qilish vosita paytida', async () => {
  const c = new AbortController(), calls = [], hub = fakeHub(calls);
  hub.call = async () => { c.abort(); throw new Error('aborted'); };
  const contents = []; script = [{ parts: [fc('get_sequence_state')] }];
  await assert.rejects(runAgent({ hub, keys: ['k'], models: ['m'], keyState: { keyIndex: 0 }, mode: 'ask', contents, userParts: [{ text: 'x' }], signal: c.signal, emit() {}, approve: async () => 'once' }), { name: 'AbortError' });
  repair(contents);
  assert.equal(contents.at(-1).role, 'model');
});
test('siyosat', () => {
  const e = (n, s = 'premiere') => ({ tool: { name: n }, server: { def: { name: s } } });
  assert.equal(policy.classify(e('smart_jump_cut'), { preview: false }), 'danger');
  assert.equal(policy.classify(e('smart_jump_cut'), {}), 'safe');
  assert.equal(policy.classify(e('get_x', 'boshqa')), 'danger');
});
test('compact eski rasmlarni olib tashlaydi', () => {
  const c = Array.from({ length: 6 }, () => ({ role: 'user', parts: [{ inlineData: { data: 'x' } }] })); compact(c);
  assert.equal(c.filter((x) => x.parts[0].inlineData).length, 3);
});
test('schema $ref va bo\'sh tur', () => {
  const s = cleanSchema({ type: 'object', properties: { a: { type: 'object', properties: { n: { type: 'string' } } }, b: { type: 'array', items: { $ref: '#/properties/a' } }, v: {} }, additionalProperties: false, $schema: 'x' });
  assert.equal(s.properties.b.items.properties.n.type, 'string');
  assert.ok(s.properties.v.anyOf && !s.$schema && !('additionalProperties' in s));
});
test('markdown xavfsiz', () => {
  const md = require('../src/renderer/md');
  assert.ok(!md('<img src=x onerror=1> [a](javascript:1) [b](https://x"onclick=1)').match(/<img|href="javascript|"onclick=1/));
});
test('haqiqiy MCP serverga ulanish', { skip: !require('../src/core/mcp').detectPremiereServer() }, async () => {
  const { McpHub, detectPremiereServer, resultText } = require('../src/core/mcp');
  const h = new McpHub();
  assert.ok(await h.connect(detectPremiereServer()), JSON.stringify(h.status()));
  const d = h.declarations(h.tools());
  console.log('vositalar:', d.length, '| $ref:', JSON.stringify(d).includes('$ref'));
  assert.ok(d.length > 50 && !JSON.stringify(d).includes('$ref'));
  assert.match(resultText(await h.callByName('premiere_status', {})), /premiere/);
  await h.closeAll();
});
