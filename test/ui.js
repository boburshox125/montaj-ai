'use strict';
/* Haqiqiy ilovani soxta Gemini bilan ishga tushirib, ekran rasmini oladi:
   electron test/ui.js <chiqish papkasi> */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow } = require('electron');
const out = process.argv[2] || os.tmpdir();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'montaj-'));
process.env.MONTAJ_USERDATA = dir;
let n = 0;
const srv = http.createServer((q, r) => {
  if (q.url.includes('/models?')) return r.end(JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] }] }));
  q.resume(); q.on('end', () => {
    r.writeHead(200, { 'content-type': 'text/event-stream' });
    const steps = [[{ text: 'Avval **ulanishni** tekshiraman.' }, { functionCall: { name: 'premiere_status', args: {} } }], [{ functionCall: { name: 'razor', args: { times: [3] } } }], [{ text: '### Natija\n- Holat tekshirildi\n- Kesish `rad etildi`' }]];
    for (const p of steps[n++] || [{ text: 'ok' }]) r.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [p] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 34 } })}\n\n`);
    r.end();
  });
}).listen(0, () => {
  process.env.GEMINI_BASE_URL = 'http://127.0.0.1:' + srv.address().port;
  require('../src/main.js');
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  while (!BrowserWindow.getAllWindows()[0]) await wait(200);
  const w = BrowserWindow.getAllWindows()[0];
  w.webContents.on('console-message', (e) => console.log('console:', e.message));
  const js = (c) => w.webContents.executeJavaScript(c);
  const shot = async (name) => { await wait(500); fs.writeFileSync(path.join(out, name), (await w.webContents.capturePage()).toPNG()); };
  try {
    await wait(6000); await shot('1.png');
    await js(`document.getElementById('openSettings').click(); document.getElementById('keyInput').value='TEST-KEY-000000000000000000'; document.getElementById('keyForm').requestSubmit();`);
    await wait(1500); await shot('2.png');
    await js(`document.querySelector('[data-close]').click(); document.getElementById('input').value='3-soniyadan kes'; document.getElementById('send').click();`);
    await wait(4000); await shot('3.png');
    await js(`[...document.querySelectorAll('.approval button')].pop().click()`);
    await wait(2500); await shot('4.png');
    console.log(await js(`document.getElementById('log').innerText`));
    await js("document.getElementById('newChat').click()"); await shot('4b.png'); w.setSize(440, 800); await wait(1500); await shot('5.png');
    console.log('kalit ochiq saqlanganmi:', fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('TEST-KEY'));
  } catch (e) { console.log('XATO', e); }
  app.quit();
});
