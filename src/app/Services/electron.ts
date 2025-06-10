import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ElectronService {

  ipcRenderer: any;

  constructor() {
    // Detectar si estamos en Electron
    if (this.isElectron()) {
      const electron = window.require ? window.require('electron') : null;
      this.ipcRenderer = electron?.ipcRenderer;
    } else {
      console.warn("Electron's IPC was not loaded");
    }
  }

  isElectron(): boolean {
    return !!(window && window.process && window.process.type);
  }

  send(channel: string, data?: any) {
    if (!this.ipcRenderer) {
      console.warn('ElectronService: ipcRenderer is undefined');
      return;
    }
    this.ipcRenderer.send(channel, data);
  }

  on(channel: string, listener: (event: any, ...args: any[]) => void) {
    if (!this.ipcRenderer) {
      console.warn('ElectronService: ipcRenderer is undefined');
      return;
    }
    this.ipcRenderer.on(channel, listener);
  }

  invoke(channel: string, data?: any): Promise<any> {
    if (!this.ipcRenderer) {
      console.warn('ElectronService: ipcRenderer is undefined');
      return Promise.resolve();
    }
    return this.ipcRenderer.invoke(channel, data);
  }
}
