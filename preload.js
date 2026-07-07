const { contextBridge, ipcRenderer } = require('electron');

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
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  
  // === GESTIÓN DE USUARIOS ===
  getUsers: () => ipcRenderer.invoke('get-users'),
  saveUsers: (users) => ipcRenderer.invoke('save-users', users),

  // === CHROME CON URL ESPECÍFICA ===
  openChromeWithUrl: (url) => ipcRenderer.invoke('open-chrome-with-url', url),
  
  // === AUTO-LOGIN (BrowserWindow embebida con inyección de script) ===
  openPortalAutoLogin: (loginData) => ipcRenderer.invoke('open-portal-auto-login', loginData),

  // === GIT POR MICRO ===
  getGitInfo: (payload) => ipcRenderer.invoke('git-info', payload),
  gitFetch: (payload) => ipcRenderer.invoke('git-fetch', payload),
  gitPull: (payload) => ipcRenderer.invoke('git-pull', payload),
  gitCheckout: (payload) => ipcRenderer.invoke('git-checkout', payload),

  // === GESTIÓN DE PUERTOS ===
  findProcessByPort: (port) => ipcRenderer.invoke('find-process-by-port', port),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),

  // === CIFRADO LOCAL (safeStorage) ===
  cryptoIsAvailable: () => ipcRenderer.invoke('crypto:is-available'),
  encryptText: (plain) => ipcRenderer.invoke('crypto:encrypt', plain),
  decryptText: (cipher) => ipcRenderer.invoke('crypto:decrypt', cipher),
  encryptTexts: (list) => ipcRenderer.invoke('crypto:encrypt-batch', list),
  decryptTexts: (list) => ipcRenderer.invoke('crypto:decrypt-batch', list),

  // === UTILIDADES DE FS / RED / DIÁLOGO ===
  checkPath: (targetPath) => ipcRenderer.invoke('check-path', targetPath),
  checkPort: (port) => ipcRenderer.invoke('check-port', port),
  probeHttp: (url, timeoutMs) => ipcRenderer.invoke('probe-http', url, timeoutMs),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  writeFile: (targetPath, contents) => ipcRenderer.invoke('write-file', targetPath, contents),
  readFile: (targetPath) => ipcRenderer.invoke('read-file', targetPath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
