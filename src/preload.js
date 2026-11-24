'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const CALLS = ['init', 'settings:save', 'key:add', 'key:remove', 'extra:save', 'models', 'chat:list', 'chat:load', 'chat:delete', 'chat:export',
  'agent:start', 'agent:stop', 'approve', 'voice', 'mcp:reconnect', 'mcp:check', 'mcp:servers', 'mcp:add', 'mcp:remove', 'timeline', 'frame', 'quick',
  'premiere:open', 'backups:open', 'pick', 'link', 'update:install'];
const EVENTS = ['status', 'agent', 'approval', 'approval-closed', 'update'];
contextBridge.exposeInMainWorld('api', {
  call: async (ch, ...a) => {
    if (!CALLS.includes(ch)) throw new Error('noma\'lum: ' + ch);
    const r = await ipcRenderer.invoke(ch, ...a);
    if (r && r.ok === false) throw new Error(r.error);
    return r?.data;
  },
  on: (ch, fn) => { if (EVENTS.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d)); },
  pathOf: (file) => webUtils.getPathForFile(file),
});
