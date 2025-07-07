import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SpinnerComponent } from '../../Components/spinner/spinner';
import gsap from 'gsap';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [FormsModule, CommonModule, SpinnerComponent],
  templateUrl: './config.html',
  styleUrls: ['./config.scss'],
})
export class ConfigComponent {
  loading = true;

  config: any = {
    angular: {
      upload: { path: '', port: 4200 },
      notifica: { path: '', port: 4201 },
      pagos: { path: '', port: 4202 },
      reportes: { path: '', port: 4203 },
      psd2: { path: '', port: 4204 },
      intradia: { path: '', port: 4205 },
    },
    spring: {
      upload: { path: '' },
      pagos: { path: '' },
      reportes: { path: '' },
    },
  };

  angularMicros = [
    { key: 'upload', label: 'upload' },
    { key: 'notifica', label: 'notifica' },
    { key: 'pagos', label: 'pagos' },
    { key: 'reportes', label: 'reportes' },
    { key: 'psd2', label: 'psd2' },
    { key: 'intradia', label: 'intradía' },
  ];

  springMicros = [
    { key: 'upload', label: 'upload' },
    { key: 'pagos', label: 'pagos' },
    { key: 'reportes', label: 'reportes' },
  ];

  selectedTab: 'angular' | 'spring' = 'angular';

  constructor(private router: Router) {
    (window as any).electronAPI.getConfig().then((cfg: any) => {
      this.config = cfg;
      this.loading = false;
      setTimeout(
        () => gsap.from('.section', { opacity: 0, y: 20, duration: 0.5 }),
        0
      );
    });
  }

  changeTab(tab: 'angular' | 'spring') {
    if (this.selectedTab !== tab) {
      this.selectedTab = tab;
      setTimeout(
        () => gsap.from('.section', { opacity: 0, y: 20, duration: 0.4 }),
        0
      );
    }
  }

  save() {
    (window as any).electronAPI.saveConfig(this.config);
  }

  goToLauncher() {
    this.router.navigate(['/launcher']);
  }

  clear() {
    (window as any).electronAPI.clearConfig().then(() => {
      this.config = {
        angular: {
          upload: { path: '', port: 4200 },
          notifica: { path: '', port: 4201 },
          pagos: { path: '', port: 4202 },
          reportes: { path: '', port: 4203 },
          psd2: { path: '', port: 4204 },
          intradia: { path: '', port: 4205 },
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
