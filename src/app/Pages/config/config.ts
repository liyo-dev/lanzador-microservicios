import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SpinnerComponent } from '../../Components/spinner/spinner';

@Component({
  selector: 'app-config',
  imports: [FormsModule, CommonModule, SpinnerComponent],
  templateUrl: './config.html',
  styleUrls: ['./config.scss'],
})
export class ConfigComponent {
  config: any = {
    angular: {
      intradia: { path: '', port: 4201 },
      upload: { path: '', port: 4202 },
      pagos: { path: '', port: 4203 },
      reportes: { path: '', port: 4204 },
    },
    spring: {
      upload: { path: '' },
      pagos: { path: '' },
      reportes: { path: '' },
    },
  };

  angularMicros = [
    { key: 'intradia', label: 'intradía' },
    { key: 'upload', label: 'upload' },
    { key: 'pagos', label: 'pagos' },
    { key: 'reportes', label: 'reportes' },
  ];

  springMicros = [
    { key: 'upload', label: 'upload' },
    { key: 'pagos', label: 'pagos' },
    { key: 'reportes', label: 'reportes' },
  ];

  loading = true;

  constructor(private router: Router) {
    (window as any).electronAPI.getConfig().then((cfg: any) => {
      console.log('Config cargada', cfg);
      this.config = cfg;
      this.loading = false;
    });
  }

  save() {
     (window as any).electronAPI.saveConfig(this.config).then(() => {
      this.router.navigate(['/launcher']);
    });
  }

  clear() {
    (window as any).electronAPI.clearConfig().then(() => {
      this.config = {
        angular: {
          intradia: { path: '', port: 4201 },
          upload: { path: '', port: 4202 },
          pagos: { path: '', port: 4203 },
          reportes: { path: '', port: 4204 },
        },
        spring: {
          upload: { path: '' },
          pagos: { path: '' },
          reportes: { path: '' },
        },
      };
    });
  }
}
