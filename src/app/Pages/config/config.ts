import { AfterViewInit, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SpinnerComponent } from '../../Components/spinner/spinner';
import gsap from 'gsap';
import { NotificationService } from '../../services/notification.service';
import { ConfirmService } from '../../services/confirm.service';
import { PageHeaderComponent } from '../../Components/page-header/page-header';
// Añadir interface para microservicios personalizados
interface CustomMicroservice {
  key: string;
  label: string;
  isCustom?: boolean;
}

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [FormsModule, CommonModule, SpinnerComponent, PageHeaderComponent],
  templateUrl: './config.html',
  styleUrls: ['./config.scss'],
})
export class ConfigComponent {
  private router = inject(Router);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmService);
  
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

  // Validación de campos por microKey. undefined = no validado, true = OK, false = inválido.
  pathValidity: Record<string, boolean | undefined> = {};
  portValidity: Record<string, boolean | undefined> = {};
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

  /** Comprueba si la ruta configurada para un micro existe y es un directorio. */
  async validatePath(microKey: string) {
    const api = (window as any).electronAPI;
    if (!api?.checkPath) return;
    const path =
      this.config?.angular?.[microKey]?.path ||
      this.config?.spring?.[microKey]?.path;
    if (!path) {
      // Vacío: no marcamos como inválido (será obligatorio al lanzar)
      this.pathValidity[microKey] = undefined;
      return;
    }
    try {
      const res = await api.checkPath(path);
      this.pathValidity[microKey] = !!(res?.exists && res?.isDirectory);
    } catch {
      this.pathValidity[microKey] = false;
    }
  }

  /** Comprueba si el puerto está ocupado (colisión potencial). */
  async validatePort(microKey: string, port: number | string | null | undefined) {
    const api = (window as any).electronAPI;
    if (!api?.checkPort) return;
    if (!port || Number(port) <= 0) {
      this.portValidity[microKey] = undefined;
      return;
    }
    try {
      const inUse: boolean = await api.checkPort(Number(port));
      // Si está en uso, marcamos como inválido (advertencia). Si no, OK.
      this.portValidity[microKey] = !inUse;
    } catch {
      this.portValidity[microKey] = undefined;
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

  async exportConfig() {
    try {
      const api = (window as any).electronAPI;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const suggested = `launcher-config-${stamp}.json`;
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        config: this.config,
        angularMicros: this.angularMicros,
        springMicros: this.springMicros,
      };
      const result = await api.showSaveDialog?.({
        title: 'Exportar configuración',
        defaultPath: suggested,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!result || result.canceled || !result.filePath) return;
      const written = await api.writeFile?.(result.filePath, JSON.stringify(payload, null, 2));
      if (written?.success) {
        this.notify.success('Configuración exportada correctamente.');
      } else {
        this.notify.error('No se pudo escribir el fichero: ' + (written?.error || 'error desconocido'));
      }
    } catch (err: any) {
      this.notify.error('Error exportando: ' + (err?.message || err));
    }
  }

  async importConfig() {
    try {
      const api = (window as any).electronAPI;
      const result = await api.showOpenDialog?.({
        title: 'Importar configuración',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (!result || result.canceled || !result.filePaths?.[0]) return;

      const read = await api.readFile?.(result.filePaths[0]);
      if (!read?.success) {
        this.notify.error('No se pudo leer el fichero: ' + (read?.error || 'error desconocido'));
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(read.contents);
      } catch {
        this.notify.error('El fichero no contiene JSON válido.');
        return;
      }

      // Soportar tanto exports nuestros ({config, ...}) como un config bruto.
      const cfg = parsed?.config ?? parsed;
      if (!cfg || typeof cfg !== 'object') {
        this.notify.error('El JSON no tiene el formato esperado.');
        return;
      }

      const ok = await this.confirm.ask({
        title: 'Importar configuración',
        message: '¿Sobrescribir la configuración actual con la importada? Esta acción no se puede deshacer.',
        confirmLabel: 'Sí, importar',
        cancelLabel: 'Cancelar',
        tone: 'warning',
      });
      if (!ok) return;

      this.config = cfg;
      if (Array.isArray(parsed?.angularMicros)) this.angularMicros = parsed.angularMicros;
      if (Array.isArray(parsed?.springMicros)) this.springMicros = parsed.springMicros;
      await api.saveConfig(this.config);
      this.notify.success('Configuración importada. Recarga la vista si no ves los cambios.');
    } catch (err: any) {
      this.notify.error('Error importando: ' + (err?.message || err));
    }
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
      this.notify.warning('El nombre del microservicio no puede estar vacío.', { title: 'Nombre requerido' });
      return;
    }

    // Convertir a key válida (sin espacios, caracteres especiales)
    const key = this.newMicroName.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20);

    if (!key) {
      this.notify.warning('El nombre debe contener al menos una letra o número.', { title: 'Nombre no válido' });
      return;
    }

    // Verificar que no exista ya
    const existingMicros = this.newMicroType === 'angular' ? this.angularMicros : this.springMicros;
    if (existingMicros.find(m => m.key === key)) {
      this.notify.warning('Ya existe un microservicio con ese nombre.', { title: 'Duplicado' });
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
    this.notify.success(`Microservicio "${newMicro.label}" añadido.`);

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
  async removeCustomMicroservice(microKey: string, type: 'angular' | 'spring') {
    const list = type === 'angular' ? this.angularMicros : this.springMicros;
    const micro = list.find(m => m.key === microKey);
    const ok = await this.confirm.ask({
      title: 'Eliminar microservicio',
      message: micro
        ? `¿Seguro que quieres eliminar el microservicio "${micro.label}"? Se borrará su configuración.`
        : '¿Seguro que quieres eliminar este microservicio personalizado?',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger'
    });
    if (!ok) return;

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
    this.notify.info(micro ? `Microservicio "${micro.label}" eliminado.` : 'Microservicio eliminado.');
  }
}
