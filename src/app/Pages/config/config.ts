import { AfterViewInit, Component } from '@angular/core';
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
  //#region Variables
  loading = true;
  guardadoOK = false;
  borradoOK = false;
  showSpringConfig = true;

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
  //#endregion
  constructor(private router: Router) {
    (window as any).electronAPI.getConfig().then((cfg: any) => {
      this.config = cfg;

      setTimeout(() => this.loading = false , 500);

      requestAnimationFrame(() => {
        gsap.fromTo('h1', { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' });

        gsap.fromTo('.tab-selector button', { opacity: 0, y: -10 }, {
          opacity: 1,
          y: 0,
          duration: 0.3,
          stagger: 0.1,
          delay: 0.4
        });

        gsap.fromTo('.micro-card', { opacity: 0, y: 20 }, {
          opacity: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.1,
          delay: 0.6
        });

        // 👇 Este es el bloque que te interesa
        const buttons = document.querySelectorAll('.button-bar button');
        const bar = document.querySelector('.button-bar');

        if (bar && buttons.length > 0) {
          bar.classList.remove('invisible'); // 👈 evita el parpadeo
          gsap.fromTo(buttons, { opacity: 0, y: 10 }, {
            opacity: 1,
            y: 0,
            stagger: 0.1,
            delay: 1,
            duration: 0.3
          });
        }
      });


    });
  }

  changeTab(tab: 'angular' | 'spring') {
    if (this.selectedTab !== tab) {
      this.selectedTab = tab;
      requestAnimationFrame(() => {
        gsap.from('.section', { opacity: 0, y: 20, duration: 0.4 });
        gsap.from('.micro-card', { opacity: 0, y: 20, duration: 0.4, stagger: 0.1 });
      });
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

  browseFolder(event: Event) {
    const input = (event.target as HTMLElement)
      .previousElementSibling as HTMLInputElement;

    if ((window as any).electronAPI?.showOpenDialog) {
      (window as any).electronAPI
        .showOpenDialog({ properties: ['openDirectory'] })
        .then((result: any) => {
          if (!result.canceled && result.filePaths.length > 0) {
            input.value = result.filePaths[0];

            const modelPath = input.getAttribute('ng-reflect-model');
            if (modelPath) {
              const keys = modelPath.split('.');
              let ref = this.config;
              for (let i = 0; i < keys.length - 1; i++) ref = ref[keys[i]];
              ref[keys[keys.length - 1]] = result.filePaths[0];
            }
          }
        });
    }
  }

  toggleSpringConfig() {
    this.showSpringConfig = !this.showSpringConfig;
  }
}
