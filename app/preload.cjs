'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Keep the renderer isolated: expose task operations, never raw IPC or Node.js.
contextBridge.exposeInMainWorld('gravity', Object.freeze({
  getState: () => ipcRenderer.invoke('gravity-state'),
  createSession: () => ipcRenderer.invoke('gravity-create-session'),
  selectFolder: (sessionId) => ipcRenderer.invoke('gravity-select-folder', sessionId),
  connect: () => ipcRenderer.invoke('gravity-connect'),
  prepareEngine: () => ipcRenderer.invoke('gravity-prepare-engine'),
  send: ({ sessionId, text, model }) => ipcRenderer.invoke('gravity-send', { sessionId, text, model }),
  cancel: (sessionId) => ipcRenderer.invoke('gravity-cancel', sessionId),
  decidePermission: ({ id, allow }) => ipcRenderer.invoke('gravity-permission', { id, allow }),
  onEvent: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('O evento precisa de uma função.');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('gravity-event', listener);
    return () => ipcRenderer.removeListener('gravity-event', listener);
  },
}));
