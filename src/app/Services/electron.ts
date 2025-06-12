import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ElectronService {
  ipcRenderer?: any;

  constructor() {
    // Detectar si estamos en Electron
    if (this.isElectron()) {
      const electron = (window as any).require
        ? (window as any).require('electron')
        : null;
      this.ipcRenderer = electron?.ipcRenderer;
    } else {
      this.ipcRenderer = undefined;
      // Solo log si estamos en navegador
      if (window.location.protocol !== 'file:') {
        console.warn(
          'ElectronService: ipcRenderer is undefined (non-Electron context)'
        );
      }
    }
  }

  isElectron(): boolean {
    return !!(window && window.process && window.process.type);
  }

  send(channel: string, data?: any): void {
    if (!this.ipcRenderer) {
      console.warn('ElectronService: ipcRenderer is undefined → send skipped');
      return;
    }
    this.ipcRenderer.send(channel, data);
  }

on(channel: string, listener: (msg: any) => void): void {
  if (!this.ipcRenderer) {
    console.warn('ElectronService: ipcRenderer is undefined → on skipped');
    return;
  }

  this.ipcRenderer.on(channel, (event: any, msg: any) => {
    listener(msg);
  });
}


  invoke(channel: string, data?: any): Promise<any> {
    if (!this.ipcRenderer) {
      console.warn('ElectronService: ipcRenderer is undefined → invoke skipped');
      return Promise.resolve();
    }
    return this.ipcRenderer.invoke(channel, data);
  }
}
