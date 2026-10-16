'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gravity', Object.freeze({
  getState: () => ipcRenderer.invoke('gravity-state'),
  createSession: (mode) => ipcRenderer.invoke('gravity-create-session', mode),
  setMode: (sessionId, mode) => ipcRenderer.invoke('gravity-set-mode', { sessionId, mode }),
  deleteSession: (id) => ipcRenderer.invoke('gravity-delete-session', id),
  selectFolder: (sessionId) => ipcRenderer.invoke('gravity-select-folder', sessionId),
  connect: () => ipcRenderer.invoke('gravity-connect'),
  disconnect: () => ipcRenderer.invoke('gravity-disconnect'),
  setActive: (id) => ipcRenderer.invoke('gravity-set-active', id),
  prepareEngine: () => ipcRenderer.invoke('gravity-prepare-engine'),
  send: ({ sessionId, text, model }) => ipcRenderer.invoke('gravity-send', { sessionId, text, model }),
  cancel: (sessionId) => ipcRenderer.invoke('gravity-cancel', sessionId),
  decidePermission: ({ id, allow }) => ipcRenderer.invoke('gravity-permission', { id, allow }),
  alwaysAllowTool: ({ sessionId, toolName }) => ipcRenderer.invoke('gravity-always-allow-tool', { sessionId, toolName }),
  toggleSkill: ({ sessionId, skillId }) => ipcRenderer.invoke('gravity-toggle-skill', { sessionId, skillId }),
  refreshSkills: () => ipcRenderer.invoke('gravity-refresh-skills'),
  getGitStatus: () => ipcRenderer.invoke('gravity-get-git-status'),
  updateSettings: (settings) => ipcRenderer.invoke('gravity-update-settings', settings),
  onEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('O evento precisa de uma função.');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('gravity-event', listener);
    return () => ipcRenderer.removeListener('gravity-event', listener);
  },
}));
