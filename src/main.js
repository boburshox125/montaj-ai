'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, globalShortcut, Notification, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Store } = require('./core/store');
const { McpHub, detectPremiereServer, claudeServers, resultText, resultImages } = require('./core/mcp');
const gemini = require('./core/gemini');
const { runAgent, repair } = require('./core/agent');

if (process.env.MONTAJ_USERDATA) app.setPath('userData', process.env.MONTAJ_USERDATA);
app.setAppUserModelId('uz.montaj.ai');
if (!app.requestSingleInstanceLock()) app.quit();

let win, store, hub, run = null, premiere = { ok: false, text: '' };
const keyState = { keyIndex: 0 };
const pending = new Map();
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 520, show: false,
    backgroundColor: '#101114', autoHideMenuBar: true, title: 'Montaj AI',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.setAlwaysOnTop(!!store.data.onTop);
  win.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
function openLink(url) { if (/^https:\/\//.test(url)) shell.openExternal(url); }
function focusWin() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }

/* ---------- MCP ---------- */
function serverDefs() {
  const custom = store.data.servers.filter((s) => s.enabled !== false && s.command);
  const own = custom.find((s) => s.name === 'premiere');
  const detected = own ? null : detectPremiereServer();
  return detected ? [detected, ...custom] : custom;
}
async function connectAll() {
  const defs = serverDefs();
  for (const n of [...hub.servers.keys()]) if (!defs.some((d) => d.name === n)) await hub.disconnect(n);
  // Qo'shimcha kalitlar faqat Premiere serveriga beriladi
  await Promise.all(defs.map((d) => hub.connect(d, d.name === 'premiere' ? store.data.extraKeys : {})));
  await checkPremiere();
}
let checking = false;
async function checkPremiere() {
  if (checking) return;
  checking = true;
  try {
    const s = hub.servers.get('premiere');
    if (!s || s.state !== 'ready') premiere = { ok: false, text: s ? s.error || 'MCP ulanmoqda' : 'Premiere MCP topilmadi' };
    else {
      const t = resultText(await hub.callByName('premiere_status', {}, { timeout: 15000 }));
      let j = {}; try { j = JSON.parse(t); } catch { /* matn */ }
      premiere = { ok: !!j.premiere?.ok, text: j.premiere?.ok ? (j.premiere.projectName || j.premiere.version || 'Ulandi') : 'Premiere yopiq yoki PR MCP Bridge paneli yoqilmagan' };
    }
  } catch (e) { premiere = { ok: false, text: e.message }; }
  checking = false;
  pushStatus();
}
function pushStatus() { send('status', { servers: hub.status(), premiere, running: !!run }); }

/* ---------- Agent ---------- */
function newChat() { return { id: crypto.randomUUID(), title: 'Yangi suhbat', contents: [], ui: [], tokens: 0, updated: Date.now() }; }

function modelChain() {
  const list = [store.data.model];
  if (store.data.fallback) for (const m of ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']) if (!list.includes(m)) list.push(m);
  return list;
}

const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function buildParts(text, files) {
  const parts = [], notes = [];
  for (const f of files || []) {
    const mime = IMG[path.extname(f).toLowerCase()];
    let st; try { st = fs.statSync(f); } catch { continue; }
    notes.push(`- ${f}${st.isDirectory() ? ' (papka)' : ''}`);
    if (mime && st.size < 5e6) parts.push({ inlineData: { mimeType: mime, data: fs.readFileSync(f).toString('base64') } });
  }
  parts.push({ text: text + (notes.length ? `\n\nBiriktirilgan fayllar:\n${notes.join('\n')}` : '') });
  return parts;
}

async function startRun({ chatId, text, files }) {
  if (run) throw new Error('Agent hozir ishlayapti');
  const chat = chatId ? store.loadChat(chatId) : newChat();
  if (!chat.ui.length) chat.title = text.trim().slice(0, 60) || 'Suhbat';
  const ctrl = new AbortController();
  run = { ctrl, chatId: chat.id };
  chat.ui.push({ t: 'user', text, files: files || [] });
  store.saveChat(chat);
  pushStatus();
  send('agent', { chatId: chat.id, type: 'begin', data: { title: chat.title } });

  const emit = (type, data) => {
    const last = chat.ui[chat.ui.length - 1];
    if (type === 'text') { if (last?.t === 'ai') last.text += data; else chat.ui.push({ t: 'ai', text: data }); }
    else if (type === 'reset') { if (last?.t === 'ai') chat.ui.pop(); }
    else if (type === 'notice') chat.ui.push({ t: 'notice', text: data });
    else if (type === 'tool-start') chat.ui.push({ t: 'tool', ...data, state: 'running' });
    else if (type === 'tool-end') { const i = chat.ui.find((x) => x.uid === data.uid); if (i) Object.assign(i, { state: data.state, text: data.text, images: data.images }); }
    else if (type === 'usage') chat.tokens += data.input + data.output;
    send('agent', { chatId: chat.id, type, data });
  };
  const approve = (req) => new Promise((resolve) => {
    const id = crypto.randomUUID();
    const done = (a) => { if (pending.delete(id)) { ctrl.signal.removeEventListener('abort', onAbort); send('approval-closed', id); resolve(a); } };
    const onAbort = () => done('deny');
    pending.set(id, done);
    ctrl.signal.addEventListener('abort', onAbort, { once: true });
    send('approval', { id, chatId: chat.id, ...req });
    if (!win.isFocused()) win.flashFrame(true);
  });

  (async () => {
    let error = '', stopped = false;
    try {
      await runAgent({
        hub, keys: store.data.keys, models: modelChain(), keyState, mode: store.data.mode, rules: store.data.rules,
        autoBackup: store.data.autoBackup, contents: chat.contents, userParts: buildParts(text, files), signal: ctrl.signal, emit, approve,
      });
    } catch (e) {
      if (ctrl.signal.aborted) { stopped = true; emit('notice', "To'xtatildi"); }
      else { error = e.message; chat.ui.push({ t: 'error', text: error }); }
      repair(chat.contents);
    }
    run = null;
    try { if (fs.existsSync(store.chatPath(chat.id))) store.saveChat(chat); } catch (e) { console.error(e); }
    send('agent', { chatId: chat.id, type: 'end', data: { error, stopped, tokens: chat.tokens } });
    pushStatus();
    if (store.data.notify && win && !win.isDestroyed() && !win.isFocused() && Notification.isSupported()) {
      const n = new Notification({ title: 'Montaj AI', body: error ? 'Xato: ' + error : stopped ? "To'xtatildi" : 'Vazifa tugadi' });
      n.on('click', focusWin); n.show();
    }
    checkPremiere();
  })();
  return { chatId: chat.id };
}

/* ---------- IPC ---------- */
const mask = (k) => (k.length > 8 ? k.slice(0, 4) + '••••' + k.slice(-4) : '••••');
function publicSettings() {
  const { keys, extraKeys, ...rest } = store.data;
  return { ...rest, keys: keys.map(mask), extraKeys: Object.fromEntries(Object.entries(extraKeys).map(([k, v]) => [k, v ? mask(v) : ''])) };
}
function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...a) => {
    if (e.senderFrame !== win.webContents.mainFrame) throw new Error('ruxsat yo\'q');
    try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message }; }
  });
}
function registerIpc() {
  handle('init', () => ({ settings: publicSettings(), chats: store.listChats(), status: { servers: hub.status(), premiere, running: !!run }, version: app.getVersion() }));
  handle('settings:save', (p) => {
    for (const k of ['keys', 'extraKeys', 'servers']) delete p[k];
    store.save(p);
    win.setAlwaysOnTop(!!store.data.onTop);
    return publicSettings();
  });
  handle('key:add', async (key) => {
    key = String(key || '').trim();
    if (key.length < 20 || /\s/.test(key)) throw new Error("Kalit noto'g'ri ko'rinadi");
    if (store.data.keys.includes(key)) throw new Error('Bu kalit allaqachon qo\'shilgan');
    const models = await gemini.listModels(key); // kalitni tekshirish
    const patch = { keys: [...store.data.keys, key] };
    if (!models.some((m) => m.id === store.data.model)) {
      const pick = models.find((m) => /flash/.test(m.id) && !/lite|preview/.test(m.id)) || models[0];
      if (pick) patch.model = pick.id;
    }
    store.save(patch);
    return { settings: publicSettings(), models };
  });
  handle('key:remove', (i) => { store.save({ keys: store.data.keys.filter((_, n) => n !== i) }); return publicSettings(); });
  handle('extra:save', async (p) => {
    const x = { ...store.data.extraKeys };
    for (const k of Object.keys(x)) if (typeof p[k] === 'string' && !p[k].includes('•')) x[k] = p[k].trim();
    store.save({ extraKeys: x });
    if (!run) await connectAll();
    return publicSettings();
  });
  handle('models', () => { if (!store.data.keys.length) return []; return gemini.listModels(store.data.keys[keyState.keyIndex % store.data.keys.length]); });
  handle('chat:list', () => store.listChats());
  handle('chat:load', (id) => { const c = store.loadChat(id); return { id: c.id, title: c.title, ui: c.ui, tokens: c.tokens }; });
  handle('chat:delete', (id) => { if (run?.chatId === id) throw new Error('Avval agentni to\'xtating'); store.deleteChat(id); return store.listChats(); });
  handle('chat:export', async (id) => {
    const c = store.loadChat(id);
    const r = await dialog.showSaveDialog(win, { defaultPath: 'montaj-ai-suhbat.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled) return false;
    const md = c.ui.map((u) => u.t === 'user' ? `## Siz\n${u.text}` : u.t === 'ai' ? `## Montaj AI\n${u.text}` : u.t === 'tool' ? `- \`${u.name}\` — ${u.state}` : `> ${u.text}`).join('\n\n');
    fs.writeFileSync(r.filePath, `# ${c.title}\n\n${md}\n`);
    return true;
  });
  handle('agent:start', startRun);
  handle('agent:stop', () => { run?.ctrl.abort(); });
  handle('approve', (id, a) => { pending.get(id)?.(['once', 'task'].includes(a) ? a : 'deny'); });
  handle('voice', async (wav) => {
    if (!store.data.keys.length) throw new Error('Avval API kalit kiriting');
    return gemini.transcribe({ key: store.data.keys[keyState.keyIndex % store.data.keys.length], model: store.data.model, wavBase64: wav });
  });
  handle('mcp:reconnect', async () => { if (run) throw new Error('Agent ishlayapti'); await connectAll(); });
  handle('mcp:check', checkPremiere);
  handle('mcp:servers', () => ({ custom: store.data.servers.map(({ env, ...s }) => s), claude: claudeServers().map(({ env, ...s }) => s).filter((s) => !/uzbek-mcp|premiere/i.test(s.name)), detected: detectPremiereServer() && { ...detectPremiereServer(), env: undefined } }));
  handle('mcp:add', async ({ name, command, args, fromClaude }) => {
    if (run) throw new Error('Agent ishlayapti');
    let def;
    if (fromClaude) { def = claudeServers().find((s) => s.name === name); if (!def) throw new Error('Topilmadi'); }
    else def = { name: String(name).trim(), command: String(command).trim().replace(/^"|"$/g, ''), args: (args || []).map(String) };
    if (!/^[\w-]{1,30}$/.test(def.name)) throw new Error('Nom: harf, raqam, _ yoki -');
    if (!def.command) throw new Error('Buyruq kiritilmagan');
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Qo\'shish', 'Bekor'], defaultId: 1, cancelId: 1, message: `"${def.name}" MCP serveri kompyuteringizda quyidagi buyruqni ishga tushiradi:`, detail: [def.command, ...def.args].join(' ') });
    if (r.response !== 0) return false;
    store.save({ servers: [...store.data.servers.filter((s) => s.name !== def.name), { ...def, enabled: true }] });
    await connectAll();
    return true;
  });
  handle('mcp:remove', async (name) => { if (run) throw new Error('Agent ishlayapti'); store.save({ servers: store.data.servers.filter((s) => s.name !== name) }); await connectAll(); });
  handle('timeline', async () => {
    const r = await hub.callByName('get_sequence_state', {}, { timeout: 30000 });
    if (r.isError) throw new Error(resultText(r));
    return JSON.parse(resultText(r));
  });
  handle('frame', async () => { const r = await hub.callByName('export_frame', { width: 640 }, { timeout: 60000 }); if (r.isError) throw new Error(resultText(r)); return resultImages(r)[0] || null; });
  handle('quick', async (name) => {
    if (!['save_project', 'backup_project'].includes(name)) throw new Error('ruxsat yo\'q');
    const r = await hub.callByName(name, {}, { timeout: 120000 });
    if (r.isError) throw new Error(resultText(r));
    return resultText(r);
  });
  handle('premiere:open', () => {
    const root = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Adobe');
    const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^Adobe Premiere Pro/.test(d)).sort().reverse() : [];
    for (const d of dirs) {
      const exe = path.join(root, d, 'Adobe Premiere Pro.exe');
      if (fs.existsSync(exe)) { spawn(exe, [], { detached: true, stdio: 'ignore' }).unref(); return d; }
    }
    throw new Error('Premiere Pro topilmadi');
  });
  handle('backups:open', async () => {
    const r = await hub.callByName('get_project_state', {}, { timeout: 15000 });
    const p = JSON.parse(resultText(r)).projectPath;
    const dir = path.join(path.dirname(String(p).replace(/^\\\\\?\\/, '')), 'AI_Backups');
    if (!fs.existsSync(dir)) throw new Error('Hali zaxira yo\'q');
    const e = await shell.openPath(dir); if (e) throw new Error(e);
  });
  handle('pick', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }); return r.filePaths; });
  handle('link', openLink);
}

function setupUpdates() {
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-downloaded', (i) => send('update', i.version));
    autoUpdater.on('error', (e) => console.error('update:', e.message));
    ipcMain.handle('update:install', () => { if (!run) autoUpdater.quitAndInstall(); });
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (e) { console.error('update:', e.message); }
}

app.on('second-instance', focusWin);
app.whenReady().then(() => {
  const crypt = {
    encrypt: (s) => { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows shifrlash ishlamayapti'); return safeStorage.encryptString(s).toString('base64'); },
    decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
  };
  store = new Store(app.getPath('userData'), crypt);
  hub = new McpHub();
  hub.on('change', pushStatus);
  // Faqat mikrofon (ovozli buyruq) va clipboard
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d) => cb(perm === 'clipboard-sanitized-write' || (perm === 'media' && !(d.mediaTypes || []).includes('video'))));
  registerIpc();
  createWindow();
  globalShortcut.register('CommandOrControl+Alt+M', () => { if (win.isVisible() && win.isFocused()) win.minimize(); else focusWin(); });
  connectAll();
  setInterval(() => { if (!run) checkPremiere(); }, 15000);
  setupUpdates();
});
app.on('window-all-closed', () => app.quit());
let closing = false;
app.on('before-quit', (e) => {
  if (closing || !hub) return;
  e.preventDefault(); closing = true;
  run?.ctrl.abort();
  Promise.race([hub.closeAll(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
});
