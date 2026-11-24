'use strict';
/** Sozlamalar (kalitlar Windows DPAPI bilan shifrlanadi) va suhbatlar tarixi. */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  keys: [], model: 'gemini-3.8-flash', fallback: true, mode: 'ask', autoBackup: true, rules: '',
  servers: [], extraKeys: { GROQ_API_KEY: '', PEXELS_API_KEY: '', PIXABAY_API_KEY: '', GIPHY_API_KEY: '' },
  favorites: [], theme: 'dark', onTop: false, notify: true,
};

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

class Store {
  constructor(dir, crypt) {
    this.file = path.join(dir, 'settings.json');
    this.chatDir = path.join(dir, 'chats');
    this.crypt = crypt;
    fs.mkdirSync(this.chatDir, { recursive: true });
    this.data = structuredClone(DEFAULTS);
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const { secret, ...rest } = j;
      Object.assign(this.data, rest);
      if (secret) {
        const s = JSON.parse(crypt.decrypt(secret));
        this.data.keys = s.keys || [];
        this.data.servers = s.servers || [];
        this.data.extraKeys = { ...DEFAULTS.extraKeys, ...s.extraKeys };
      }
    } catch (e) { if (e.code !== 'ENOENT') console.error('settings:', e.message); }
  }

  save(patch) {
    for (const k of Object.keys(DEFAULTS)) if (patch[k] !== undefined) this.data[k] = patch[k];
    const { keys, extraKeys, servers, ...rest } = this.data;
    writeAtomic(this.file, JSON.stringify({ ...rest, secret: this.crypt.encrypt(JSON.stringify({ keys, extraKeys, servers })) }, null, 2));
  }

  chatPath(id) {
    if (!/^[a-z0-9-]{1,40}$/i.test(id)) throw new Error('chat id');
    return path.join(this.chatDir, id + '.json');
  }
  listChats() {
    const out = [];
    for (const f of fs.readdirSync(this.chatDir)) {
      if (!f.endsWith('.json')) continue;
      try { const j = JSON.parse(fs.readFileSync(path.join(this.chatDir, f), 'utf8')); out.push({ id: j.id, title: j.title, updated: j.updated }); } catch { /* buzuq fayl */ }
    }
    return out.sort((a, b) => b.updated - a.updated);
  }
  loadChat(id) { return JSON.parse(fs.readFileSync(this.chatPath(id), 'utf8')); }
  saveChat(c) { c.updated = Date.now(); writeAtomic(this.chatPath(c.id), JSON.stringify(c)); }
  deleteChat(id) { fs.rmSync(this.chatPath(id), { force: true }); }
}

module.exports = { Store, DEFAULTS };
