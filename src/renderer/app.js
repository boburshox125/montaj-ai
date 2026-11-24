(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const api = window.api;
let S, status = { servers: [], premiere: {} }, chatId = null, running = false, runChat = null, files = [], ui = [], busyStart = false;

const TASKS = [
  ['Reels tayyorla', '9:16, pauzasiz, subtitrli', "Aktiv sequence'dan Instagram Reels tayyorla: 9:16 qil, kadrga moslashtir, pauzalarni kes, ovozni tozala, subtitr qo'sh va natijani ko'rib tekshir. Eksport qilma."],
  ['Pauzalarni kes', 'Jim joylarni olib tashlash', 'Jim joylarni aqlli usulda top va kesib tashla. Nechta joy va necha soniya qisqarganini ayt.'],
  ['Subtitr qo\'sh', "O'zbekcha, uslubli", "Aktiv sequence'ga o'zbekcha uslubli subtitr qo'sh va bir kadrda ko'rinishini tekshir."],
  ['Ortiqcha so\'zlar', 'eee, anaqa, takrorlar', "Ortiqcha so'zlar va takrorlarni topib marker bilan belgilab ber. Hali kesma."],
  ['Musiqaga moslab kes', 'Bitga tushadigan montaj', 'Timeline\'dagi musiqaning bitlarini top va kliplarni bitga moslab kes.'],
  ['Ovozni tozala', 'Shovqin va balandlik', 'Nutq ovozini tozala, balandligini tekisla va musiqani nutq ostida pasaytir.'],
  ['B-roll qo\'y', 'Gapga mos kadrlar', "Nutqni transkripsiya qil va mavzuga mos bepul stok B-roll topib, yuqori trekka qo'y."],
  ['Xatolarni tekshir', 'Bo\'shliq, offline, dublikat', 'Sequence\'ni to\'liq tekshir: bo\'shliqlar, qisqa kadrlar, offline media. Topilganlarni ro\'yxat qil.'],
  ['Slayd-shou', 'Rasmlardan video', "Biriktirilgan rasmlar yoki papkadan chiroyli slayd-shou yasa: har rasm 3 soniya, Ken Burns va yumshoq o'tish bilan."],
  ['Kamera sinxron', 'Ovoz bo\'yicha', 'Loyihadagi kameralar va tashqi ovozni tovush to\'lqini bo\'yicha sinxronla.'],
  ['Muqova variantlari', 'Thumbnail kadrlari', 'Video muqovasi uchun eng yaxshi kadrlardan variantlar tayyorla.'],
  ['Eksport', 'Platformaga mos', 'Aktiv sequence\'ni Instagram Reels uchun eksport qil va fayl joyini ayt.'],
];
const LABEL = { get_sequence_state: 'Timeline\'ni o\'qish', get_project_state: 'Loyihani o\'qish', premiere_status: 'Ulanishni tekshirish', list_project_items: 'Fayllar ro\'yxati', export_frame: 'Kadrni ko\'rish', contact_sheet: 'Natijani ko\'rish', smart_jump_cut: 'Pauzalarni kesish', jump_cut: 'Pauzalarni kesish', styled_captions: 'Uslubli subtitr', auto_captions: 'Subtitr', transcribe_sequence: 'Nutqni matnga o\'girish', transcribe_media: 'Nutqni matnga o\'girish', find_filler_words: 'Ortiqcha so\'zlar', audio_cleanup: 'Ovozni tozalash', duck_music: 'Musiqani pasaytirish', place_clip: 'Klip qo\'yish', place_broll: 'B-roll qo\'yish', remove_clips: 'Kliplarni o\'chirish', remove_ranges: 'Oraliqlarni kesish', razor: 'Kesish', apply_effect: 'Effekt berish', add_transition: 'O\'tish qo\'shish', add_keyframes: 'Animatsiya', export_sequence: 'Eksport', export_social: 'Eksport', save_project: 'Saqlash', backup_project: 'Zaxira olish', import_files: 'Fayl import qilish', fit_to_frame: 'Kadrga moslash', reframe_vertical: 'Vertikal format', set_clip_properties: 'Klip xossalari', run_extendscript: 'Premiere skripti', stock_search: 'Stok qidirish', stock_insert: 'Stok qo\'yish', beat_markers: 'Bitlarni topish', cut_to_beat: 'Bitga kesish', add_markers: 'Marker qo\'yish', trim_clip: 'Klipni qirqish', set_text: 'Matnni o\'zgartirish' };

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
let toastT;
function toast(t) { ($('settings').open ? $('settings') : document.body).append($('toast')); $('toast').textContent = t; $('toast').classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.remove('show'), 3500); }
async function call(...a) { try { return await api.call(...a); } catch (e) { toast(e.message); throw e; } }
const quiet = (p) => p.catch(() => {});

/* ---------- Suhbat ---------- */
function toolNode(u) {
  const d = el('details', 'tool ' + u.state);
  d.dataset.uid = u.uid;
  const s = el('summary');
  s.append(el('i'), el('span', '', LABEL[u.name] || u.name.replace(/_/g, ' ')), el('code', '', u.name));
  if (u.state === 'denied') s.append(el('span', 'muted', 'bajarilmadi'));
  if (u.state === 'error') s.append(el('span', 'muted', 'xato'));
  const b = el('div', 'body');
  if (u.args && Object.keys(u.args).length) b.append(el('pre', '', JSON.stringify(u.args, null, 1)));
  if (u.text) b.append(el('pre', '', u.text));
  d.append(s); if (b.children.length) d.append(b);
  return d;
}
function imgsNode(images) {
  const w = el('div', 'imgs');
  for (const im of images) { const i = el('img'); i.src = `data:${im.mimeType};base64,${im.data}`; i.alt = 'Natija'; i.onclick = () => i.classList.toggle('big'); w.append(i); }
  return w;
}
function node(u) {
  if (u.t === 'user') {
    const d = el('div', 'msg user', u.text);
    for (const f of u.files || []) d.append(el('small', '', f.split(/[\\/]/).pop()));
    return d;
  }
  if (u.t === 'ai') { const d = el('div', 'msg ai'); d.innerHTML = md(u.text); return d; }
  if (u.t === 'tool') { const w = el('div'); w.append(toolNode(u)); if (u.images?.length) w.append(imgsNode(u.images)); w.dataset.wrap = u.uid; return w; }
  return el('div', 'msg ' + u.t, u.text);
}
const nearEnd = () => { const l = $('log'); return l.scrollHeight - l.scrollTop - l.clientHeight < 130; };
function scroll(force) { if (force) $('log').scrollTop = 1e9; }
function renderLog() {
  const l = $('log'); l.replaceChildren();
  if (!ui.length) {
    const w = el('div', 'welcome');
    w.append(el('h1', '', 'Bugun nimani montaj qilamiz?'), el('div', 'muted', 'O\'z so\'zingiz bilan yozing yoki tayyor vazifani tanlang.'));
    const g = el('div', 'tasks');
    for (const [t, d, p] of TASKS) { const b = el('button'); b.append(el('b', '', t), el('span', 'muted', d)); b.onclick = () => setInput(p); g.append(b); }
    w.append(g); l.append(w);
  } else for (const u of ui) l.append(node(u));
  if (running && runChat === chatId) think('O\'ylayapti');
  if (ui.length) scroll(true); else $('log').scrollTop = 0;
}
function think(t) {
  let n = $('think');
  if (!t) { n?.remove(); return; }
  if (!n) { n = el('div'); n.id = 'think'; n.append(el('i'), el('span')); }
  n.lastChild.textContent = t;
  $('log').append(n);
}
let thoughtBuf = '', raf = 0;
function onAgent({ chatId: id, type, data }) {
  if (type === 'begin') { running = true; runChat = id; setRunning(); refreshChats(); }
  if (type === 'end') { running = false; runChat = null; setRunning(); refreshChats(); if (!$('right').hidden) loadTimeline(); }
  if (id !== chatId) return;
  const end = nearEnd();
  const last = ui[ui.length - 1];
  const log = $('log');
  const add = (u) => { ui.push(u); log.append(node(u)); };
  switch (type) {
    case 'text':
      think();
      if (last?.t === 'ai') last.text += data; else add({ t: 'ai', text: data });
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; const u = ui[ui.length - 1], n = [...log.querySelectorAll('.ai')].pop(); if (u?.t === 'ai' && n) { n.innerHTML = md(u.text); scroll(end); } });
      break;
    case 'reset': if (last?.t === 'ai') { ui.pop(); [...log.querySelectorAll('.ai')].pop()?.remove(); } break;
    case 'thought': thoughtBuf = (thoughtBuf + data).slice(-600); { const m = [...thoughtBuf.matchAll(/\*\*([^*]+)\*\*/g)].pop(); think(m ? m[1] : 'O\'ylayapti'); } break;
    case 'notice': add({ t: 'notice', text: data }); break;
    case 'tool-start': think(); add({ t: 'tool', ...data, state: 'running' }); break;
    case 'tool-end': {
      const u = ui.find((x) => x.uid === data.uid); if (!u) break;
      Object.assign(u, data);
      log.querySelector(`[data-wrap="${data.uid}"]`)?.replaceWith(node(u));
      thoughtBuf = ''; think('O\'ylayapti'); break;
    }
    case 'usage': tokenCount += data.input + data.output; showTokens(); break;
    case 'end': think(); if (data.error) add({ t: 'error', text: data.error }); break;
  }
  scroll(end);
}
let tokenCount = 0;
function showTokens() { $('tokens').textContent = tokenCount ? tokenCount.toLocaleString('ru') + ' token' : ''; }
function setRunning() {
  $('send').textContent = running ? 'To\'xtatish' : 'Yuborish';
  $('send').className = running ? 'danger' : 'primary';
  $('mode').disabled = running;
}
async function refreshChats() { renderChats(await api.call('chat:list')); }
function renderChats(list) {
  const c = $('chats'); c.replaceChildren();
  for (const x of list) {
    const r = el('div', 'chat' + (x.id === chatId ? ' sel' : ''));
    const b = el('button', '', (x.id === runChat ? '● ' : '') + x.title); b.title = x.title; b.onclick = () => openChat(x.id);
    const d = el('button', 'del', '✕'); d.setAttribute('aria-label', 'O\'chirish');
    d.onclick = async () => { if (!confirm(`"${x.title}" suhbati o'chirilsinmi?`)) return; const l = await call('chat:delete', x.id); if (x.id === chatId) newChat(); renderChats(l); };
    r.append(b, d); c.append(r);
  }
}
async function openChat(id) { const c = await call('chat:load', id); chatId = id; ui = c.ui; tokenCount = c.tokens || 0; showTokens(); renderLog(); refreshChats(); }
function newChat() { chatId = null; ui = []; tokenCount = 0; showTokens(); renderLog(); refreshChats(); $('input').focus(); }

/* ---------- Kiritish ---------- */
function grow() { const t = $('input'); t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function setInput(t) { $('input').value = t; grow(); $('input').focus(); }
async function submit() {
  if (running) { call('agent:stop'); think('To\'xtatilmoqda'); return; }
  const text = $('input').value.trim();
  if (!text || busyStart) return;
  if (!S.keys.length) { openSettings(); toast('Avval Gemini API kalitni kiriting'); return; }
  busyStart = true;
  const f = files; const pre = { t: 'user', text, files: f };
  if (!ui.length) $('log').replaceChildren();
  ui.push(pre); $('log').append(node(pre));
  $('input').value = ''; files = []; renderFiles(); grow(); thoughtBuf = ''; think('O\'ylayapti'); scroll(true);
  const wasNew = !chatId;
  // begin hodisasi javobdan oldin kelishi mumkin
  if (wasNew) awaitingId = true;
  try { const r = await call('agent:start', { chatId, text, files: f }); chatId = r.chatId; refreshChats(); }
  catch { ui.pop(); renderLog(); setInput(text); files = f; renderFiles(); }
  awaitingId = false; busyStart = false;
}
let awaitingId = false;
api.on('agent', (m) => { if (awaitingId && m.type === 'begin') { chatId = m.chatId; awaitingId = false; } onAgent(m); });
function renderFiles() { const w = $('files'); w.replaceChildren(); files.forEach((f, i) => { const b = el('button', '', f.split(/[\\/]/).pop() + '  ✕'); b.title = f; b.onclick = () => { files.splice(i, 1); renderFiles(); }; w.append(b); }); }
function addFiles(l) { for (const f of l) if (f && !files.includes(f)) files.push(f); renderFiles(); }
function renderChips() {
  const c = $('chips'); c.replaceChildren();
  S.favorites.forEach((t, i) => {
    const b = el('button', '', t.length > 34 ? t.slice(0, 34) + '…' : t); b.title = t; b.onclick = () => setInput(t);
    const x = el('span', 'x', '✕'); x.onclick = async (e) => { e.stopPropagation(); await save({ favorites: S.favorites.filter((_, n) => n !== i) }); renderChips(); };
    b.append(x); c.append(b);
  });
}
async function save(p) { S = await call('settings:save', p); applyTheme(); }
function applyTheme() { document.documentElement.dataset.theme = S.theme; $('pin').classList.toggle('on', S.onTop); }

$('send').onclick = submit;
$('input').oninput = grow;
$('input').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!running) submit(); } };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && running && !$('settings').open) submit(); if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newChat(); } });
$('newChat').onclick = newChat;
$('attach').onclick = async () => addFiles(await call('pick'));
$('mode').onchange = () => quiet(save({ mode: $('mode').value }));
$('saveFav').onclick = async () => { const t = $('input').value.trim(); if (!t) return toast('Avval buyruqni yozing'); if (!S.favorites.includes(t)) await save({ favorites: [...S.favorites, t] }); renderChips(); toast('Buyruq saqlandi'); };
$('pin').onclick = () => quiet(save({ onTop: !S.onTop }));
$('exportChat').onclick = async () => { if (!chatId) return toast('Suhbat bo\'sh'); if (await call('chat:export', chatId)) toast('Saqlandi'); };
$('toggleLeft').onclick = () => document.body.classList.toggle('noleft');
$('toggleRight').onclick = () => document.body.classList.toggle('noright');
let dragN = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; $('drop').hidden = false; });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('drop').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('drop').hidden = true; addFiles([...e.dataTransfer.files].map((f) => api.pathOf(f))); });
document.addEventListener('click', (e) => { const a = e.target.closest('[data-link]'); if (a) { e.preventDefault(); quiet(call('link', a.dataset.link)); } });

/* ---------- Ovoz ---------- */
let rec = null;
$('mic').onclick = async () => {
  if (rec) { rec.stop(); return; }
  if (!S.keys.length) { openSettings(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Mikrofon topilmadi yoki ruxsat yo\'q'); }
  const chunks = []; rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); rec = null; $('mic').classList.remove('rec'); clearTimeout(limit);
    try {
      toast('Ovoz matnga o\'girilmoqda');
      const text = await api.call('voice', await toWav(new Blob(chunks)));
      if (text) setInput(($('input').value + ' ' + text).trim()); else toast('Gap eshitilmadi');
    } catch (e) { toast(e.message); }
  };
  const limit = setTimeout(() => rec?.stop(), 120000);
  rec.start(); $('mic').classList.add('rec'); toast('Gapiring. Tugatish uchun yana bosing');
};
async function toWav(blob) {
  const ctx = new AudioContext(); const src = await ctx.decodeAudioData(await blob.arrayBuffer()); ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(src.duration * 16000), 16000);
  const n = off.createBufferSource(); n.buffer = src; n.connect(off.destination); n.start();
  const d = (await off.startRendering()).getChannelData(0);
  const v = new DataView(new ArrayBuffer(44 + d.length * 2)); const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + d.length * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, d.length * 2, true);
  d.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true));
  const b = new Uint8Array(v.buffer); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}

/* ---------- Ruxsat ---------- */
api.on('approval', (a) => {
  const d = el('div', 'approval'); d.dataset.id = a.id;
  d.append(el('b', '', a.reason || (a.level === 'code' ? 'Agent Premiere ichida skript ishga tushirmoqchi' : 'Agent ruxsat so\'rayapti: ' + (LABEL[a.name] || a.name))));
  const args = a.args?.code && a.level === 'code' ? a.args.code : JSON.stringify(a.args, null, 1);
  if (args && args !== '{}') d.append(el('pre', '', args));
  const r = el('div', 'row');
  const btn = (t, c, v) => { const b = el('button', c, t); b.onclick = () => quiet(call('approve', a.id, v)); r.append(b); };
  btn('Ruxsat berish', 'primary', 'once');
  if (a.level !== 'code' && !a.reason) btn('Shu vazifada so\'rama', 'ghost', 'task');
  btn('Rad etish', 'ghost', 'deny');
  d.append(r); $('approvals').append(d);
});
api.on('approval-closed', (id) => document.querySelector(`.approval[data-id="${id}"]`)?.remove());

/* ---------- Holat ---------- */
let wasOk = false;
function onStatus(s) {
  status = s; running = s.running; setRunning();
  const p = $('premiere'); p.classList.toggle('ok', s.premiere.ok);
  p.lastChild.textContent = s.premiere.ok ? 'Premiere ulangan' : 'Premiere ulanmagan';
  p.title = s.premiere.text;
  renderBanner();
  if (s.premiere.ok && !wasOk) loadTimeline();
  wasOk = s.premiere.ok;
  if ($('settings').open) renderServers();
}
function renderBanner() {
  const b = $('banner'); b.replaceChildren(); b.hidden = false;
  const btn = (t, fn) => { const x = el('button', 'ghost sm', t); x.onclick = fn; b.append(x); };
  if (!S.keys.length) { b.append(el('span', '', 'Boshlash uchun Google Gemini API kalitini kiriting.')); btn('Kalit kiritish', openSettings); return; }
  if (!status.premiere.ok) {
    const srv = status.servers.find((x) => x.name === 'premiere');
    b.append(el('span', '', !srv ? 'Premiere MCP topilmadi. Sozlamalarda qo\'shing.' : srv.state === 'error' ? 'Premiere MCP ishga tushmadi.' : 'Premiere Pro\'da Window > Extensions > PR MCP Bridge panelini oching.'));
    if (srv?.state === 'ready') btn('Premiere\'ni ochish', async () => toast(await call('premiere:open') + ' ochilmoqda')); else btn('Sozlamalar', openSettings);
    btn('Qayta tekshirish', () => quiet(call(srv?.state === 'ready' ? 'mcp:check' : 'mcp:reconnect')));
    return;
  }
  b.hidden = true;
}
$('premiere').onclick = () => quiet(call('mcp:check'));
api.on('status', (s) => { if (S) onStatus(s); });
api.on('update', (v) => { const b = el('button', 'primary sm', `${v} versiyaga yangilash`); b.onclick = () => quiet(call('update:install')); document.querySelector('header').append(b); });

/* ---------- Timeline ---------- */
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let tlBusy = false;
async function loadTimeline(manual) {
  if (tlBusy || !status.premiere.ok) { if (manual) toast('Premiere ulanmagan'); return; }
  tlBusy = true;
  try {
    const s = await api.call('timeline'); const w = $('tl'); w.replaceChildren();
    const total = s.duration || 1;
    w.append(el('div', '', s.name), el('div', 'muted', `${s.width}×${s.height}, ${s.fps} fps, ${fmt(s.duration)}`));
    const draw = (t, cls) => {
      const r = el('div', 'track ' + cls); const lane = el('div', 'lane');
      for (const c of t.clips || []) { const x = el('div', 'clip'); x.style.left = (c.start / total * 100) + '%'; x.style.width = ((c.end - c.start) / total * 100) + '%'; x.title = `${c.name || ''} ${fmt(c.start)}–${fmt(c.end)}`; lane.append(x); }
      const h = el('div', 'head'); h.style.left = (s.playhead / total * 100) + '%'; lane.append(h);
      r.append(el('b', '', t.label), lane); w.append(r);
    };
    [...s.video].reverse().forEach((t) => draw(t, 'video')); s.audio.forEach((t) => draw(t, 'audio'));
  } catch (e) { $('tl').textContent = e.message; }
  tlBusy = false;
}
$('refresh').onclick = () => loadTimeline(true);
$('qFrame').onclick = async () => { const i = await call('frame'); if (i) { $('frame').src = `data:${i.mimeType};base64,${i.data}`; $('frame').hidden = false; } };
$('qSave').onclick = async () => { await call('quick', 'save_project'); toast('Loyiha saqlandi'); };
$('qBackup').onclick = async () => { await call('quick', 'backup_project'); toast('Zaxira olindi'); };
$('qBackups').onclick = () => quiet(call('backups:open'));

/* ---------- Sozlamalar ---------- */
const EXTRA = { GROQ_API_KEY: 'Groq (subtitr)', PEXELS_API_KEY: 'Pexels', PIXABAY_API_KEY: 'Pixabay', GIPHY_API_KEY: 'GIPHY' };
function openSettings() { renderSettings(); if (!$('settings').open) $('settings').showModal(); if (!S.keys.length) $('keyInput').focus(); }
function renderSettings() {
  const k = $('keys'); k.replaceChildren();
  S.keys.forEach((m, i) => { const r = el('div', 'item'); const b = el('button', 'ghost sm', 'O\'chirish'); b.onclick = async () => { S = await call('key:remove', i); renderSettings(); renderBanner(); }; r.append(el('span', '', m), el('span', 'grow'), b); k.append(r); });
  if (![...$('model').options].some((o) => o.value === S.model)) $('model').append(new Option(S.model, S.model));
  $('model').value = S.model;
  for (const id of ['fallback', 'autoBackup', 'notify']) $(id).checked = S[id];
  $('light').checked = S.theme === 'light'; $('rules').value = S.rules;
  const f = $('extraForm'); f.replaceChildren();
  for (const [n, l] of Object.entries(EXTRA)) { const i = el('input'); i.name = n; i.type = 'password'; i.autocomplete = 'off'; i.placeholder = S.extraKeys[n] ? `${l}: ${S.extraKeys[n]}` : l; f.append(i); }
  f.append(el('button', 'ghost', 'Kalitlarni saqlash'));
  renderServers();
}
async function renderServers() {
  const w = $('servers'); const info = await api.call('mcp:servers'); w.replaceChildren();
  if (!status.servers.length) w.append(el('p', 'muted', 'MCP server topilmadi.'));
  for (const s of status.servers) {
    const r = el('div', 'item'); const t = el('div', '', s.name);
    t.append(el('small', '', s.state === 'ready' ? `Ulangan, ${s.tools} ta vosita` : s.state === 'connecting' ? 'Ulanmoqda' : s.error)); r.append(t, el('span', 'grow'));
    if (info.custom.some((c) => c.name === s.name)) { const b = el('button', 'ghost sm', 'O\'chirish'); b.onclick = () => quiet(call('mcp:remove', s.name)); r.append(b); }
    w.append(r);
  }
}
function fillModels(list) { if (!list.length) return; $('model').replaceChildren(...list.map((m) => new Option(m.name === m.id ? m.id : `${m.name} (${m.id})`, m.id))); if (!list.some((m) => m.id === S.model)) $('model').append(new Option(S.model, S.model)); $('model').value = S.model; }
$('openSettings').onclick = openSettings;
document.querySelector('[data-close]').onclick = () => $('settings').close();
$('settings').addEventListener('close', () => { if ($('rules').value !== S.rules) quiet(save({ rules: $('rules').value })); });
$('keyForm').onsubmit = async (e) => {
  e.preventDefault(); const b = e.submitter || $('keyForm').lastChild; b.disabled = true;
  try { const r = await call('key:add', $('keyInput').value); S = r.settings; $('keyInput').value = ''; fillModels(r.models); renderSettings(); renderBanner(); toast('Kalit ishlayapti va saqlandi'); } catch { /* toast */ }
  b.disabled = false;
};
$('loadModels').onclick = async () => { const l = await call('models'); if (!l.length) return toast('Avval kalit kiriting'); fillModels(l); toast(l.length + ' ta model'); };
$('model').onchange = () => quiet(save({ model: $('model').value }));
for (const id of ['fallback', 'autoBackup', 'notify']) $(id).onchange = () => quiet(save({ [id]: $(id).checked }));
$('light').onchange = () => quiet(save({ theme: $('light').checked ? 'light' : 'dark' }));
$('reconnect').onclick = () => quiet(call('mcp:reconnect'));
$('importClaude').onclick = async () => {
  const { claude } = await call('mcp:servers'); const w = $('claudeList'); w.replaceChildren();
  if (!claude.length) return toast('Boshqa MCP topilmadi');
  for (const s of claude) { const r = el('div', 'item'); const b = el('button', 'ghost sm', 'Qo\'shish'); b.onclick = async () => { if (await call('mcp:add', { name: s.name, fromClaude: true })) r.remove(); }; r.append(el('span', '', s.name), el('span', 'grow'), b); w.append(r); }
};
$('mcpForm').onsubmit = async (e) => { e.preventDefault(); try { if (await call('mcp:add', { name: $('mcpName').value, command: $('mcpCmd').value, args: $('mcpArgs').value.split('\n').map((x) => x.trim()).filter(Boolean) })) e.target.reset(); } catch { /* toast */ } };
$('extraForm').onsubmit = async (e) => { e.preventDefault(); const p = {}; for (const i of e.target.querySelectorAll('input')) if (i.value) p[i.name] = i.value; S = await call('extra:save', p); renderSettings(); toast('Saqlandi'); };

(async () => {
  const i = await api.call('init'); S = i.settings;
  applyTheme(); $('mode').value = S.mode; $('ver').textContent = 'Montaj AI ' + i.version + '. Ctrl+Alt+M oynani chaqiradi, Esc agentni to\'xtatadi.';
  for (const [q, c] of [['(max-width:1000px)', 'noright'], ['(max-width:760px)', 'noleft']]) { const m = matchMedia(q); const go = () => document.body.classList.toggle(c, m.matches); m.onchange = go; go(); }
  renderChips(); renderLog(); renderChats(i.chats); onStatus(i.status); $('input').focus();
})();
})();
