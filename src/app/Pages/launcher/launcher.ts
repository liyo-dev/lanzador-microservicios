import { Component, ViewChild, ElementRef, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SpinnerComponent } from '../../Components/spinner/spinner';
import { Router } from '@angular/router';
import gsap from 'gsap';

// Interface para microservicios
interface MicroService {
  key: string;
  label: string;
  selected: boolean;
  status: 'stopped' | 'starting' | 'running' | 'stopping';
  useLegacyProvider?: boolean;
  isCustom?: boolean;
}

@Component({
  selector: 'app-launcher',
  standalone: true,
  imports: [FormsModule, CommonModule, SpinnerComponent],
  templateUrl: './launcher.html',
  styleUrls: ['./launcher.scss'],
})
export class Launcher {
  config: any = {};
  selectedTab: 'angular' | 'spring' = 'angular';
  angularMicros: MicroService[] = [];
  springMicros: MicroService[] = [];

  logs: string[] = [];
  loading = false;
  showLogs = false;
  showSuccessMessage = false;

  @ViewChild('logBox') logBox!: ElementRef;

  constructor(private ngZone: NgZone, private router: Router) {
    this.loadConfiguration();
    this.setupElectronListeners();
  }

  private loadConfiguration() {
    (window as any).electronAPI.getConfig().then((cfg: any) => {
      this.config = cfg;
      this.buildMicroServiceLists();
      this.loadLastStatus();
    });
  }

  private buildMicroServiceLists() {
    // Limpiar listas
    this.angularMicros = [];
    this.springMicros = [];

    // Cargar microservicios Angular que tienen configuración válida
    if (this.config.angular) {
      Object.keys(this.config.angular).forEach((key) => {
        // Excluir campos de configuración que no son microservicios
        if (
          key !== 'javaHome' &&
          key !== 'mavenHome' &&
          key !== 'settingsXml' &&
          key !== 'm2RepoPath'
        ) {
          const config = this.config.angular[key];
          // Solo agregar si tiene configuración válida Y ruta no vacía
          if (
            config &&
            typeof config === 'object' &&
            config.path &&
            config.path.trim() !== '' &&
            config.port
          ) {
            // Determinar si es personalizado
            const isCustom =
              this.config.customMicros?.angular?.some(
                (m: any) => m.key === key
              ) || false;
            const label = isCustom
              ? this.config.customMicros.angular.find(
                  (m: any) => m.key === key
                )?.label || key
              : key;

            this.angularMicros.push({
              key,
              label,
              selected: false,
              status: 'stopped',
              useLegacyProvider: false,
              isCustom,
            });
          }
        }
      });
    }

    // Cargar microservicios Spring que tienen configuración válida
    if (this.config.spring) {
      Object.keys(this.config.spring).forEach((key) => {
        // Excluir campos de configuración que no son microservicios
        if (
          key !== 'javaHome' &&
          key !== 'mavenHome' &&
          key !== 'settingsXml' &&
          key !== 'm2RepoPath'
        ) {
          const config = this.config.spring[key];
          // Solo agregar si tiene configuración válida Y ruta no vacía
          if (
            config &&
            typeof config === 'object' &&
            config.path &&
            config.path.trim() !== ''
          ) {
            // Determinar si es personalizado
            const isCustom =
              this.config.customMicros?.spring?.some(
                (m: any) => m.key === key
              ) || false;
            const label = isCustom
              ? this.config.customMicros.spring.find(
                  (m: any) => m.key === key
                )?.label || key
              : key;

            this.springMicros.push({
              key,
              label,
              selected: false,
              status: 'stopped',
              isCustom,
            });
          }
        }
      });
    }

    // Si no hay microservicios configurados, mostrar mensaje
    if (this.angularMicros.length === 0 && this.springMicros.length === 0) {
      this.showEmptyState();
    }

    // Debug: Mostrar en consola qué microservicios se están cargando
    console.log('🔍 Microservicios cargados:', {
      angular: this.angularMicros.map((m) => ({
        key: m.key,
        label: m.label,
        isCustom: m.isCustom,
      })),
      spring: this.springMicros.map((m) => ({
        key: m.key,
        label: m.label,
        isCustom: m.isCustom,
      })),
      configCompleta: this.config,
    });
  }

  private showEmptyState() {
    setTimeout(() => {
      const emptyMessage = document.querySelector('.empty-state');
      if (emptyMessage) {
        gsap.fromTo(
          emptyMessage,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }
        );
      }
    }, 100);
  }

  private loadLastStatus() {
    (window as any).electronAPI.getLastStatus().then((statuses: any) => {
      let anyStarting = false;

      this.angularMicros.forEach((micro) => {
        const lastStatus = statuses.angular?.[micro.key];
        if (lastStatus) {
          micro.status = lastStatus;
          if (lastStatus === 'starting' || lastStatus === 'running')
            anyStarting = true;
        }
      });

      this.springMicros.forEach((micro) => {
        const lastStatus = statuses.spring?.[micro.key];
        if (lastStatus) {
          micro.status = lastStatus;
          if (lastStatus === 'starting' || lastStatus === 'running')
            anyStarting = true;
        }
      });

      this.loading = anyStarting;
    });
  }

  private setupElectronListeners() {
    (window as any).electronAPI.onLogAngular((msg: any) => {
      this.handleLog(msg, 'Angular');
    });

    (window as any).electronAPI.onLogSpring((msg: any) => {
      this.handleLog(msg, 'Spring');
    });
  }

  // Obtener microservicios filtrados por tab
  getDisplayedMicros(): MicroService[] {
    return this.selectedTab === 'angular' ? this.angularMicros : this.springMicros;
  }

  // Verificar si hay microservicios para mostrar
  hasMicrosToShow(): boolean {
    return this.getDisplayedMicros().length > 0;
  }

  handleLog(msg: any, type: 'Angular' | 'Spring') {
    this.ngZone.run(() => {
      const list = type === 'Angular' ? this.angularMicros : this.springMicros;
      const micro = list.find((m) => m.key === msg.micro);

      if (micro && msg.status) {
        micro.status = msg.status;
        this.animateMicroCard(micro.key, msg.status);

        // Desactivar checkbox cuando el microservicio se arranca correctamente
        if (msg.status === 'running' && micro.selected) {
          micro.selected = false;
        }
      }

      if (msg.status === 'starting' && !this.loading) {
        this.loading = true;
        this.pushLog(`[${type} ${msg.micro}] 🚀 Lanzando...`);
      }

      if (msg.status === 'running') {
        this.loading = false;
        this.pushLog(`[${type} ${msg.micro}] ✅ Arrancado correctamente.`);
        this.showSuccessMessage = true;

        setTimeout(() => {
          const box = document.querySelector('.success-message');
          if (box) {
            gsap.fromTo(
              box,
              { opacity: 0, y: -10 },
              { opacity: 1, y: 0, duration: 0.5, ease: 'bounce.out' }
            );
          }
        }, 0);
      }

      if (msg.status === 'stopped') {
        this.loading = false;
        this.pushLog(`[${type} ${msg.micro}] 🛑 Detenido.`);
      }

      if (!msg.status) {
        this.pushLog(`[${type} ${msg.micro}] ${msg.log}`);
      }

      this.scrollToBottom();
    });
  }

  pushLog(message: string) {
    this.logs.push(message);
    setTimeout(() => {
      const lastLog = document.querySelector('.log-box .log-line:last-child');
      if (lastLog) {
        gsap.fromTo(
          lastLog,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.3 }
        );
      }
    }, 0);
  }

  animateMicroCard(microKey: string, status: string) {
    const card = document.querySelector(`.micro-card[data-key="${microKey}"]`);
    if (!card) return;

    // Solo una pequeña animación de escalado para indicar cambio visual
    gsap.fromTo(
      card,
      { scale: 0.97 },
      { scale: 1, duration: 0.3, ease: 'power2.out' }
    );
  }

  startSelected() {
    this.pushLog('Arrancando micros seleccionados...');
    this.loading = true;
    this.showSuccessMessage = false;

    let started = false;

    this.angularMicros
      .filter((micro) => micro.selected && micro.status !== 'running')
      .forEach((micro) => {
        if (micro.selected) {
          const path = this.config.angular[micro.key]?.path;
          const port = this.config.angular[micro.key]?.port;
          const useLegacyProvider = micro.useLegacyProvider;

          if (!path || path.trim() === '') {
            alert(`El micro Angular ${micro.label} no tiene ruta configurada.`);
            this.loading = false;
            return;
          }

          (window as any).electronAPI.startAngular({
            micro: micro.key,
            path,
            port,
            useLegacyProvider,
          });
          this.pushLog(`→ Arrancando Angular ${micro.label}...`);
          micro.status = 'starting';
          started = true;
        }
      });

    this.springMicros
      .filter((micro) => micro.selected && micro.status !== 'running')
      .forEach((micro) => {
        if (micro.selected) {
          const path = this.config.spring[micro.key]?.path;

          if (!path || path.trim() === '') {
            alert(`El micro Spring ${micro.label} no tiene ruta configurada.`);
            this.loading = false;
            return;
          }

          (window as any).electronAPI.startSpring({
            micro: micro.key,
            path,
            javaHome: this.config.spring.javaHome,
            mavenHome: this.config.spring.mavenHome,
            settingsXml: this.config.spring.settingsXml,
            m2RepoPath: this.config.spring.m2RepoPath,
          });

          this.pushLog(`→ Arrancando Spring ${micro.label}...`);
          micro.status = 'starting';
          started = true;
        }
      });

    if (!started) this.loading = false;

    this.scrollToBottom();
  }

  stopSelected() {
    this.pushLog('Parando micros seleccionados...');

    this.angularMicros
      .filter((micro) => micro.selected && micro.status === 'running')
      .forEach((micro) => {
        if (micro.selected && micro.status === 'running') {
          (window as any).electronAPI.stopProcess(`angular-${micro.key}`);
          this.pushLog(`→ Parando Angular ${micro.label}...`);
          micro.status = 'stopping';
        } else if (micro.selected && micro.status === 'stopped') {
          this.pushLog(`→ Angular ${micro.label} ya está detenido.`);
        }
      });

    this.springMicros
      .filter((micro) => micro.selected && micro.status === 'running')
      .forEach((micro) => {
        if (micro.selected && micro.status === 'running') {
          (window as any).electronAPI.stopProcess(`spring-${micro.key}`);
          this.pushLog(`→ Parando Spring ${micro.label}...`);
          micro.status = 'stopping';
        } else if (micro.selected && micro.status === 'stopped') {
          this.pushLog(`→ Spring ${micro.label} ya está detenido.`);
        }
      });

    this.scrollToBottom();
  }

  scrollToBottom() {
    try {
      if (this.logBox) {
        setTimeout(() => {
          this.logBox.nativeElement.scrollTop =
            this.logBox.nativeElement.scrollHeight;
        }, 0);
      }
    } catch {}
  }

  toggleLogs() {
    this.showLogs = !this.showLogs;
    if (this.showLogs) {
      setTimeout(() => {
        gsap.from('.log-box', { opacity: 0, y: 20, duration: 0.4 });
      }, 0);
    }
  }

  goToConfig() {
    const angularActivos = this.angularMicros.some(
      (m) => m.status !== 'stopped'
    );
    const springActivos = this.springMicros.some((m) => m.status !== 'stopped');

    if (angularActivos || springActivos) {
      alert('⚠️ No puedes ir a la configuración mientras haya micros activos.');
      return;
    }

    this.router.navigate(['/config']);
  }

  goToHome() {
    const angularActivos = this.angularMicros.some(
      (m) => m.status !== 'stopped'
    );
    const springActivos = this.springMicros.some((m) => m.status !== 'stopped');

    if (angularActivos || springActivos) {
      alert('⚠️ No puedes ir a la configuración mientras haya micros activos.');
      return;
    }

    this.router.navigate(['']);
  }
}
