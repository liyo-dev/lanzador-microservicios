import { AfterViewInit, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SpinnerComponent } from '../../Components/spinner/spinner';
import gsap from 'gsap';

// Añadir interface para microservicios personalizados
interface CustomMicroservice {
  key: string;
  label: string;
  isCustom?: boolean;
}

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [FormsModule, CommonModule, SpinnerComponent],
  templateUrl: './config.html',
  styleUrls: ['./config.scss'],
})
export class ConfigComponent {
  private router = inject(Router);
  
  //#region Variables
  loading = true;
  guardadoOK = false;
  borradoOK = false;
  showSpringConfig = true;

  // Agregar campos para el formulario de nuevo microservicio
  newMicroName = '';
  newMicroType: 'angular' | 'spring' = 'angular';
  showAddMicroForm = false;

  config: any = {
    angular: {
      // Eliminar microservicios predefinidos - ahora inicia vacío
    },
    spring: {
      // Configuración global compartida
      mavenHome: '',
      // Perfiles de Java
      profiles: {
        java8: { javaHome: '', settingsXml: '', m2RepoPath: '' },
        java17: { javaHome: '', settingsXml: '', m2RepoPath: '' }
      }
    },
    // Configuración para microservicios personalizados
    customMicros: {
      angular: [],
      spring: []
    }
  };

  // Opciones para el desplegable de perfiles Java
  javaProfiles = [
    { key: 'java8', label: 'Java 8' },
    { key: 'java17', label: 'Java 17' }
  ];

  // Eliminar listas predefinidas - ahora todo es dinámico
  angularMicros: CustomMicroservice[] = [];
  springMicros: CustomMicroservice[] = [];

  selectedTab: 'angular' | 'spring' = 'angular';
  //#endregion
  
  constructor() {
    (window as any).electronAPI.getConfig().then((cfg: any) => {
      this.config = cfg;
      
      // Cargar microservicios personalizados si existen
      if (cfg.customMicros) {
        this.loadCustomMicros();
      }

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

  // Nuevo método para cargar microservicios personalizados
  loadCustomMicros() {
    if (this.config.customMicros?.angular) {
      this.config.customMicros.angular.forEach((micro: any) => {
        if (!this.angularMicros.find(m => m.key === micro.key)) {
          this.angularMicros.push({ ...micro, isCustom: true });
          // Asegurar que la configuración exista
          if (!this.config.angular[micro.key]) {
            this.config.angular[micro.key] = { path: '', port: this.getNextAvailablePort() };
          }
        }
      });
    }

    if (this.config.customMicros?.spring) {
      this.config.customMicros.spring.forEach((micro: any) => {
        if (!this.springMicros.find(m => m.key === micro.key)) {
          this.springMicros.push({ ...micro, isCustom: true });
          // Asegurar que la configuración exista
          if (!this.config.spring[micro.key]) {
            this.config.spring[micro.key] = { path: '', javaProfile: 'java8' };
          } else {
            // Asegurar que exista el campo javaProfile
            if (this.config.spring[micro.key].javaProfile === undefined) {
              this.config.spring[micro.key].javaProfile = 'java8';
            }
          }
        }
      });
    }
    
    // Asegurar que existan los perfiles
    this.ensureProfiles();
  }

  // Asegurar que la estructura de perfiles exista
  ensureProfiles() {
    if (!this.config.spring.profiles) {
      this.config.spring.profiles = {
        java8: { javaHome: '', settingsXml: '', m2RepoPath: '' },
        java17: { javaHome: '', settingsXml: '', m2RepoPath: '' }
      };
    }
    if (!this.config.spring.profiles.java8) {
      this.config.spring.profiles.java8 = { javaHome: '', settingsXml: '', m2RepoPath: '' };
    }
    if (!this.config.spring.profiles.java17) {
      this.config.spring.profiles.java17 = { javaHome: '', settingsXml: '', m2RepoPath: '' };
    }
    
    // Asegurar que m2RepoPath exista en perfiles existentes
    if (this.config.spring.profiles.java8.m2RepoPath === undefined) {
      this.config.spring.profiles.java8.m2RepoPath = '';
    }
    if (this.config.spring.profiles.java17.m2RepoPath === undefined) {
      this.config.spring.profiles.java17.m2RepoPath = '';
    }
    
    // Migrar configuración antigua si existe
    if (this.config.spring.javaHome && !this.config.spring.profiles.java8.javaHome) {
      this.config.spring.profiles.java8.javaHome = this.config.spring.javaHome;
      delete this.config.spring.javaHome;
    }
    if (this.config.spring.settingsXml && !this.config.spring.profiles.java8.settingsXml) {
      this.config.spring.profiles.java8.settingsXml = this.config.spring.settingsXml;
      delete this.config.spring.settingsXml;
    }
    // Migrar m2RepoPath global a java8 si existe
    if (this.config.spring.m2RepoPath && !this.config.spring.profiles.java8.m2RepoPath) {
      this.config.spring.profiles.java8.m2RepoPath = this.config.spring.m2RepoPath;
      delete this.config.spring.m2RepoPath;
    }
    // Eliminar toolchains si existe
    if (this.config.spring.toolchains !== undefined) {
      delete this.config.spring.toolchains;
    }
  }

  // Método para obtener el siguiente puerto disponible
  getNextAvailablePort(): number {
    const usedPorts = Object.values(this.config.angular)
      .map((config: any) => config.port)
      .filter(port => typeof port === 'number')
      .sort((a, b) => a - b);
    
    let nextPort = 4200;
    for (const port of usedPorts) {
      if (nextPort === port) {
        nextPort++;
      } else {
        break;
      }
    }
    return nextPort;
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

  goToUsers() {
    this.router.navigate(['/users']);
  }

  goToPorts() {
    this.router.navigate(['/ports']);
  }

  clear() {
    (window as any).electronAPI.clearConfig().then(() => {
      this.config = {
        angular: {
          // Eliminar microservicios predefinidos - ahora inicia vacío
        },
        spring: {
          // Eliminar microservicios predefinidos - ahora inicia vacío
          javaHome: '',
          mavenHome: '',
          settingsXml: '',
          m2RepoPath: '',
        },
        customMicros: {
          angular: [],
          spring: []
        }
      };

      // Limpiar también las listas dinámicas
      this.angularMicros = [];
      this.springMicros = [];

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

  // Método para mostrar/ocultar formulario de agregar microservicio
  toggleAddMicroForm() {
    this.showAddMicroForm = !this.showAddMicroForm;
    this.newMicroName = '';
    this.newMicroType = this.selectedTab;
  }

  // Método para agregar un nuevo microservicio
  addCustomMicroservice() {
    if (!this.newMicroName.trim()) {
      alert('⚠️ El nombre del microservicio no puede estar vacío.');
      return;
    }

    // Convertir a key válida (sin espacios, caracteres especiales)
    const key = this.newMicroName.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20);

    if (!key) {
      alert('⚠️ El nombre debe contener al menos una letra o número.');
      return;
    }

    // Verificar que no exista ya
    const existingMicros = this.newMicroType === 'angular' ? this.angularMicros : this.springMicros;
    if (existingMicros.find(m => m.key === key)) {
      alert('⚠️ Ya existe un microservicio con ese nombre.');
      return;
    }

    // Crear el nuevo microservicio
    const newMicro: CustomMicroservice = {
      key,
      label: this.newMicroName.trim(),
      isCustom: true
    };

    // Agregarlo a la lista correspondiente
    if (this.newMicroType === 'angular') {
      this.angularMicros.push(newMicro);
      this.config.angular[key] = { path: '', port: this.getNextAvailablePort() };
      
      // Guardar en customMicros
      if (!this.config.customMicros.angular) {
        this.config.customMicros.angular = [];
      }
      this.config.customMicros.angular.push(newMicro);
    } else {
      this.springMicros.push(newMicro);
      this.config.spring[key] = { path: '', javaProfile: 'java8' };
      
      // Guardar en customMicros
      if (!this.config.customMicros.spring) {
        this.config.customMicros.spring = [];
      }
      this.config.customMicros.spring.push(newMicro);
    }

    // Limpiar formulario
    this.newMicroName = '';
    this.showAddMicroForm = false;

    // Animar la nueva card
    setTimeout(() => {
      const newCard = document.querySelector(`.micro-card[data-key="${key}"]`);
      if (newCard) {
        gsap.fromTo(newCard, 
          { opacity: 0, scale: 0.8, y: 20 }, 
          { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.7)' }
        );
      }
    }, 100);
  }

  // Método para eliminar microservicio personalizado
  removeCustomMicroservice(microKey: string, type: 'angular' | 'spring') {
    if (confirm('¿Estás seguro de que quieres eliminar este microservicio personalizado?')) {
      if (type === 'angular') {
        this.angularMicros = this.angularMicros.filter(m => m.key !== microKey);
        delete this.config.angular[microKey];
        if (this.config.customMicros?.angular) {
          this.config.customMicros.angular = this.config.customMicros.angular.filter((m: any) => m.key !== microKey);
        }
      } else {
        this.springMicros = this.springMicros.filter(m => m.key !== microKey);
        delete this.config.spring[microKey];
        if (this.config.customMicros?.spring) {
          this.config.customMicros.spring = this.config.customMicros.spring.filter((m: any) => m.key !== microKey);
        }
      }
    }
  }
}
