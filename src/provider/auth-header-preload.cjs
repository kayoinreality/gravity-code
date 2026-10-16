const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gravityAccount', {
  back: () => ipcRenderer.send('gravity-account-action', 'back'),
  reload: () => ipcRenderer.send('gravity-account-action', 'reload'),
  onStatus: callback => ipcRenderer.on('gravity-account-status', (_event, value) => callback(value)),
});
