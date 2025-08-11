import { Component, ViewChild, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';
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
export class Launcher implements OnInit, OnDestroy {
  config: any = {};
  selectedTab: 'angular' | 'spring' = 'angular';
  angularMicros: MicroService[] = [];
  springMicros: MicroService[] = [];

  logs: string[] = [];
  loading = false;
  showLogs = false;
  showSuccessMessage = false;

  // Configuración para gestión de logs - hacemos públicas las constantes que necesita el template
  readonly MAX_LOGS = 500; // Máximo número de logs antes de limpiar
  private readonly AUTO_CLEAN_INTERVAL = 5 * 60 * 1000; // 5 minutos en milisegundos
  private readonly LOGS_TO_KEEP_AFTER_CLEAN = 100; // Logs a mantener después de limpiar
  private logCleanTimer: any = null;

  @ViewChild('logBox') logBox!: ElementRef;

  constructor(private ngZone: NgZone, private router: Router) {
    this.loadConfiguration();
    this.setupElectronListeners();
    this.setupLogCleanup();
  }

  ngOnInit() {
    this.showSuccessMessage = false;
    this.loading = false;
  }

  private loadConfiguration() {
    (window as any).electronAPI.getConfig().then((cfg: any) => {
      this.config = cfg;
      this.buildMicroServiceLists();
      // Cargar el último estado guardado sin verificar puertos
      this.loadLastStatus();
    });
  }

  private loadLastStatus() {
    (window as any).electronAPI.getLastStatus().then((statuses: any) => {
      let anyActiveAngular = false;
      let anyActiveSpring = false;

      // Verificar microservicios Angular
      this.angularMicros.forEach((micro) => {
        const lastStatus = statuses.angular?.[micro.key];
        if (lastStatus) {
          micro.status = lastStatus;
          // Solo considerar como "activo" los estados transitorios (starting/stopping)
          // Los microservicios en "running" no necesitan spinner
          if (lastStatus === 'starting' || lastStatus === 'stopping') {
            anyActiveAngular = true;
            console.log(`🔵 Angular ${micro.label}: ${lastStatus}`);
          }
        }
      });

      // Verificar microservicios Spring
      this.springMicros.forEach((micro) => {
        const lastStatus = statuses.spring?.[micro.key];
        if (lastStatus) {
          micro.status = lastStatus;
          // Solo considerar como "activo" los estados transitorios (starting/stopping)
          // Los microservicios en "running" no necesitan spinner
          if (lastStatus === 'starting' || lastStatus === 'stopping') {
            anyActiveSpring = true;
            console.log(`🟢 Spring ${micro.label}: ${lastStatus}`);
          }
        }
      });

      // Solo mostrar spinner si hay microservicios en estados transitorios
      const shouldBeLoading = anyActiveAngular || anyActiveSpring;
      this.loading = shouldBeLoading;
      
      console.log(`📊 Estado final del spinner: ${shouldBeLoading} (Angular activos: ${anyActiveAngular}, Spring activos: ${anyActiveSpring})`);
      
      if (shouldBeLoading) {
        this.pushLog('🔄 Restaurando estado de microservicios desde sesión anterior');
        
        // Mostrar específicamente qué microservicios están en estados transitorios
        const activeMicros = [
          ...this.angularMicros.filter(m => m.status === 'starting' || m.status === 'stopping'),
          ...this.springMicros.filter(m => m.status === 'starting' || m.status === 'stopping')
        ];
        
        if (activeMicros.length > 0) {
          this.pushLog(`🔄 Microservicios en proceso: ${activeMicros.map(m => `${m.label}(${m.status})`).join(', ')}`);
        }
      } else {
        // Mostrar mensaje final del estado
        const runningMicros = [
          ...this.angularMicros.filter(m => m.status === 'running'),
          ...this.springMicros.filter(m => m.status === 'running')
        ];
        
        if (runningMicros.length > 0) {
          this.pushLog(`✅ Microservicios corriendo: ${runningMicros.map(m => m.label).join(', ')}`);
        } else {
          this.pushLog('💤 Todos los microservicios están detenidos');
        }
      }
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
        this.pushLog(`[${type} ${msg.micro}] 🚀 Lanzando...`);
      }

      if (msg.status === 'running') {
        this.pushLog(`[${type} ${msg.micro}] ✅ Arrancado correctamente.`);
        
        // Solo desactivar el spinner si no hay más microservicios arrancando
        const hasStartingMicros = this.angularMicros.some(m => m.status === 'starting') || 
                                 this.springMicros.some(m => m.status === 'starting');
        
        if (!hasStartingMicros) {
          this.loading = false;
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
      }

      if (msg.status === 'stopped') {
        this.pushLog(`[${type} ${msg.micro}] 🛑 Detenido.`);
        
        // Solo desactivar el spinner si no hay más microservicios arrancando o parando
        const hasStartingMicros = this.angularMicros.some(m => m.status === 'starting') || 
                                 this.springMicros.some(m => m.status === 'starting');
        const hasStoppingMicros = this.angularMicros.some(m => m.status === 'stopping') || 
                                 this.springMicros.some(m => m.status === 'stopping');
        
        if (!hasStartingMicros && !hasStoppingMicros) {
          this.loading = false;
        }
      }

      if (!msg.status) {
        this.pushLog(`[${type} ${msg.micro}] ${msg.log}`);
      }

      this.scrollToBottom();
    });
  }

  pushLog(message: string) {
    // Agregar timestamp al mensaje
    const timestamp = new Date().toLocaleTimeString('es-ES', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    const timestampedMessage = `[${timestamp}] ${message}`;
    
    this.logs.push(timestampedMessage);
    
    // Verificar si necesitamos limpiar logs inmediatamente
    if (this.logs.length > this.MAX_LOGS) {
      this.cleanOldLogs();
    }
    
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
    this.pushLog('Verificando puertos y arrancando micros seleccionados...');
    this.loading = true;
    this.showSuccessMessage = false;

    this.startSelectedMicros();
  }

  private async startSelectedMicros() {
    let started = false;

    // Procesar microservicios Angular
    for (const micro of this.angularMicros.filter(m => m.selected)) {
      const path = this.config.angular[micro.key]?.path;
      const port = this.config.angular[micro.key]?.port;

      if (!path || path.trim() === '') {
        alert(`El micro Angular ${micro.label} no tiene ruta configurada.`);
        continue;
      }

      // Verificar si ya está corriendo basado en el estado guardado
      if (micro.status === 'running') {
        micro.selected = false; // Desseleccionar automáticamente
        this.pushLog(`→ Angular ${micro.label} ya está corriendo en puerto ${port} ✅`);
      } else {
        // Arrancar normalmente
        this.startMicroservice('angular', micro, { path, port });
        started = true;
      }
    }

    // Procesar microservicios Spring
    for (const micro of this.springMicros.filter(m => m.selected)) {
      const path = this.config.spring[micro.key]?.path;

      if (!path || path.trim() === '') {
        alert(`El micro Spring ${micro.label} no tiene ruta configurada.`);
        continue;
      }

      // Verificar si ya está corriendo basado en el estado guardado
      if (micro.status === 'running') {
        micro.selected = false;
        this.pushLog(`→ Spring ${micro.label} ya está corriendo ✅`);
      } else {
        // Arrancar normalmente
        this.startMicroservice('spring', micro, { path });
        started = true;
      }
    }

    // Ajustar el estado de loading basado en los resultados
    if (!started) {
      this.loading = false;
      this.showSuccessMessage = true;
      this.pushLog('✅ Todos los microservicios seleccionados ya estaban corriendo.');
    }

    this.scrollToBottom();
  }

  private startMicroservice(type: 'angular' | 'spring', micro: any, config: any) {
    if (type === 'angular') {
      (window as any).electronAPI.startAngular({
        micro: micro.key,
        path: config.path,
        port: config.port,
        useLegacyProvider: micro.useLegacyProvider,
      });
      this.pushLog(`→ Arrancando Angular ${micro.label} en puerto ${config.port}...`);
    } else {
      (window as any).electronAPI.startSpring({
        micro: micro.key,
        path: config.path,
        javaHome: this.config.spring.javaHome,
        mavenHome: this.config.spring.mavenHome,
        settingsXml: this.config.spring.settingsXml,
        m2RepoPath: this.config.spring.m2RepoPath,
      });
      this.pushLog(`→ Arrancando Spring ${micro.label}...`);
    }
    
    micro.status = 'starting';
  }

  stopSelected() {
    this.pushLog('Parando micros seleccionados...');
    this.loading = true; // Activar spinner cuando se comienza a parar microservicios

    let anyMicroStopped = false;

    this.angularMicros
      .filter((micro) => micro.selected && micro.status === 'running')
      .forEach((micro) => {
        if (micro.selected && micro.status === 'running') {
          (window as any).electronAPI.stopProcess(`angular-${micro.key}`);
          this.pushLog(`→ Parando Angular ${micro.label}...`);
          micro.status = 'stopping';
          anyMicroStopped = true;
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
          anyMicroStopped = true;
        } else if (micro.selected && micro.status === 'stopped') {
          this.pushLog(`→ Spring ${micro.label} ya está detenido.`);
        }
      });

    // Si no se paró ningún microservicio, desactivar el spinner
    if (!anyMicroStopped) {
      this.loading = false;
      this.pushLog('✅ Todos los microservicios seleccionados ya estaban detenidos.');
    }

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
    this.router.navigate(['/config']);
  }

  goToUsers() {
    this.router.navigate(['/users']);
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

  private setupLogCleanup() {
    // Limpiar logs antiguos al iniciar
    this.cleanOldLogs();

    // Configurar limpieza automática de logs
    this.logCleanTimer = setInterval(() => {
      this.cleanOldLogs();
    }, this.AUTO_CLEAN_INTERVAL);
  }

  private cleanOldLogs() {
    if (this.logs.length > this.LOGS_TO_KEEP_AFTER_CLEAN) {
      const removedLogs = this.logs.length - this.LOGS_TO_KEEP_AFTER_CLEAN;
      // Mantener solo los últimos LOGS_TO_KEEP_AFTER_CLEAN logs
      this.logs = this.logs.slice(-this.LOGS_TO_KEEP_AFTER_CLEAN);
      
      // Notificar la limpieza
      const timestamp = new Date().toLocaleTimeString('es-ES', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      this.logs.push(`[${timestamp}] 🧹 Limpiados ${removedLogs} logs antiguos para optimizar rendimiento`);
      
      console.log(`🧹 Logs limpiados: ${removedLogs} logs eliminados, ${this.logs.length} logs restantes`);
    }
  }

  // Método para limpiar logs manualmente
  clearLogs() {
    const clearedCount = this.logs.length;
    this.logs = [];
    const timestamp = new Date().toLocaleTimeString('es-ES', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    this.logs.push(`[${timestamp}] 🗑️ ${clearedCount} logs limpiados manualmente`);
    console.log(`🗑️ Logs limpiados manualmente: ${clearedCount} logs eliminados`);
  }

  // Limpiar timer al destruir el componente
  ngOnDestroy() {
    if (this.logCleanTimer) {
      clearInterval(this.logCleanTimer);
      this.logCleanTimer = null;
    }
  }
}
