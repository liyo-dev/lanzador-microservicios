const { contextBridge, ipcRenderer, dialog } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  clearConfig: () => ipcRenderer.invoke('clear-config'),
  getLastStatus: () => ipcRenderer.invoke('get-last-status'),
  startAngular: (data) => ipcRenderer.send('start-angular', data),
  startSpring: (data) => ipcRenderer.send('start-spring', data),
  stopProcess: (processKey) => ipcRenderer.send('stop-process', processKey),
  onLogAngular: (callback) => ipcRenderer.on('log-angular', (event, data) => callback(data)),
  onLogSpring: (callback) => ipcRenderer.on('log-spring', (event, data) => callback(data)),
  showOpenDialog: (options) => dialog.showOpenDialog(options),
});
