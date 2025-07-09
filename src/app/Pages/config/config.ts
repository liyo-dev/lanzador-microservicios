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
  guardadoOK = false;
  borradoOK = false;

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
      gateway: { path: '' },
      notifica: { path: '' },
      psd2: { path: '' },
      intradia: { path: '' },
      javaHome: '',
      mavenHome: '',
      settingsXml: '',
      m2RepoPath: '',
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
    { key: 'gateway', label: 'gateway' },
    { key: 'notifica', label: 'notifica' },
    { key: 'psd2', label: 'psd2' },
    { key: 'intradia', label: 'intradía' },
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
    this.guardadoOK = true;

    setTimeout(() => {
      const msg = document.querySelector('.msg-guardar');
      if (msg) {
        gsap.fromTo(
          msg,
          { opacity: 0, y: -10 },
          { opacity: 1, y: 0, duration: 0.4 }
        );
        setTimeout(() => {
          gsap.to(msg, { opacity: 0, y: -10, duration: 0.4 });
          this.guardadoOK = false;
        }, 2000);
      }
    }, 0);
  }

  goToLauncher() {
    this.router.navigate(['/launcher']);
  }

  goToHome() {
    this.router.navigate(['']);
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
          gateway: { path: '' },
          notifica: { path: '' },
          psd2: { path: '' },
          intradia: { path: '' },
          javaHome: '',
          mavenHome: '',
          settingsXml: '',
          m2RepoPath: '',
        },
      };

      this.borradoOK = true;

      setTimeout(() => {
        const msg = document.querySelector('.msg-borrar');
        if (msg) {
          gsap.fromTo(
            msg,
            { opacity: 0, y: -10 },
            { opacity: 1, y: 0, duration: 0.4 }
          );
          setTimeout(() => {
            gsap.to(msg, { opacity: 0, y: -10, duration: 0.4 });
            this.borradoOK = false;
          }, 2000);
        }
      }, 0);
    });
  }
}
