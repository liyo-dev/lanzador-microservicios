import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ConfigService } from '../../Services/config';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-config',
  imports: [FormsModule, CommonModule],
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

  constructor(private configService: ConfigService, private router: Router) {
    this.configService.getConfig().then((cfg) => {
      this.config = cfg;
    });
  }

  save() {
    this.configService.saveConfig(this.config).then(() => {
      this.router.navigate(['/launcher']);
    });
  }

  clear() {
    this.configService.clearConfig().then(() => {
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
