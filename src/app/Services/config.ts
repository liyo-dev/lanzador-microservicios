import { Injectable } from '@angular/core';
import { ElectronService } from './electron';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  constructor(private electronService: ElectronService) {}

  getConfig(): Promise<any> {
    return this.electronService.invoke('get-config');
  }

  saveConfig(config: any): Promise<void> {
    return this.electronService.invoke('save-config', config);
  }

  clearConfig(): Promise<void> {
    return this.electronService.invoke('clear-config');
  }
}
