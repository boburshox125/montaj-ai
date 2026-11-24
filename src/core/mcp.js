'use strict';
/** MCP serverlarni ishga tushiradi va barcha vositalarni bitta ro'yxatga yig'adi. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { cleanSchema } = require('./gemini');

/** Claude Desktop konfiguratsiyasi va odatiy o'rnatish joyidan Premiere MCP'ni topadi. */
function detectPremiereServer() {
  const local = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PremiereAI');
  const node = path.join(local, 'runtime', 'node.exe');
  const entry = path.join(local, 'server', 'src', 'index.js');
  if (fs.existsSync(node) && fs.existsSync(entry)) return { name: 'premiere', command: node, args: [entry] };
  for (const s of claudeServers()) if (/premiere|uzbek-mcp/i.test(s.name + ' ' + s.command + ' ' + s.args.join(' '))) return { ...s, name: 'premiere' };
  return null;
}

function claudeServers() {
  try {
    const f = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    return Object.entries(j.mcpServers || {}).filter(([, v]) => v.command)
      .map(([name, v]) => ({ name, command: v.command, args: v.args || [], env: v.env || {} }));
  } catch { return []; }
}

class McpHub extends EventEmitter {
  constructor() { super(); this.servers = new Map(); }

  status() {
    return [...this.servers.values()].map((s) => ({ name: s.def.name, state: s.state, error: s.error || '', tools: s.tools.length }));
  }

  async connect(def, extraEnv = {}) {
    await this.disconnect(def.name);
    const s = { def, state: 'connecting', tools: [], error: '', log: '', instructions: '' };
    this.servers.set(def.name, s);
    this.emit('change');
    try {
      const env = {};
      for (const [k, v] of Object.entries({ ...process.env, ...extraEnv, ...(def.env || {}) })) if (typeof v === 'string' && v !== '') env[k] = v;
      delete env.ELECTRON_RUN_AS_NODE;
      const transport = new StdioClientTransport({ command: def.command, args: def.args || [], env, stderr: 'pipe' });
      transport.stderr?.on('data', (d) => { s.log = (s.log + d).slice(-8000); });
      const client = new Client({ name: 'montaj-ai', version: '1.0.0' });
      client.onclose = () => { if (this.servers.get(def.name) === s && s.state !== 'error') { s.state = 'stopped'; s.error = 'Server to\'xtadi'; this.emit('change'); } };
      s.client = client;
      await client.connect(transport, { timeout: 30000 });
      let cursor, tools = [];
      do {
        const r = await client.listTools(cursor ? { cursor } : undefined);
        tools = tools.concat(r.tools); cursor = r.nextCursor;
      } while (cursor);
      s.tools = tools;
      s.instructions = client.getInstructions() || '';
      s.state = 'ready';
    } catch (e) {
      s.state = 'error';
      s.error = (e.code === 'ENOENT' ? `Dastur topilmadi: ${def.command}` : e.message) + (s.log ? '\n' + s.log.slice(-400) : '');
      try { await s.client?.close(); } catch { /* yopilgan */ }
    }
    this.emit('change');
    return s.state === 'ready';
  }

  async disconnect(name) {
    const s = this.servers.get(name);
    if (!s) return;
    this.servers.delete(name);
    try { await s.client?.close(); } catch { /* yopilgan */ }
  }
  async closeAll() { await Promise.all([...this.servers.keys()].map((n) => this.disconnect(n))); }

  /** Gemini nomi -> { server, tool } */
  tools() {
    const map = new Map();
    for (const s of this.servers.values()) {
      if (s.state !== 'ready') continue;
      for (const t of s.tools) {
        let name = t.name.replace(/[^A-Za-z0-9_-]/g, '_');
        if (!/^[A-Za-z_]/.test(name)) name = '_' + name;
        if (map.has(name)) name = `${s.def.name.replace(/[^A-Za-z0-9_]/g, '_')}_${name}`;
        name = name.slice(0, 64);
        if (!map.has(name)) map.set(name, { server: s, tool: t });
      }
    }
    return map;
  }

  declarations(map, filter) {
    const out = [];
    for (const [name, e] of map) {
      if (filter && !filter(name, e)) continue;
      const d = { name, description: e.tool.description || name };
      const sch = cleanSchema(e.tool.inputSchema);
      if (Object.keys(sch.properties).length) d.parametersJsonSchema = sch;
      out.push(d);
    }
    return out;
  }

  instructions() {
    return [...this.servers.values()].filter((s) => s.state === 'ready' && s.instructions)
      .map((s) => `## ${s.def.name}\n${s.instructions}`).join('\n\n');
  }

  async call(entry, args, { signal, timeout = 60 * 60 * 1000 } = {}) {
    if (entry.server.state !== 'ready') throw new Error(`MCP "${entry.server.def.name}" ulanmagan`);
    return entry.server.client.callTool({ name: entry.tool.name, arguments: args || {} }, undefined, { signal, timeout, resetTimeoutOnProgress: true });
  }

  async callByName(name, args, opts) {
    const e = this.tools().get(name);
    if (!e) throw new Error(`"${name}" vositasi yo'q`);
    return this.call(e, args, opts);
  }
}

function resultText(r) {
  return (r.content || []).map((c) => c.type === 'text' ? c.text : c.type === 'resource' ? (c.resource?.text || c.resource?.uri || '') : '').filter(Boolean).join('\n');
}
function resultImages(r) {
  return (r.content || []).filter((c) => c.type === 'image').map((c) => ({ mimeType: c.mimeType, data: c.data }));
}

module.exports = { McpHub, detectPremiereServer, claudeServers, resultText, resultImages };
