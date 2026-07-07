import { Component, ViewChild, ElementRef, NgZone, OnDestroy, OnInit, inject, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SpinnerComponent } from '../../Components/spinner/spinner';
import { Router } from '@angular/router';
import gsap from 'gsap';
import { NotificationService } from '../../services/notification.service';
import { PageHeaderComponent } from '../../Components/page-header/page-header';

// Interface para microservicios
interface MicroService {
  key: string;
  label: string;
  selected: boolean;
  status: 'stopped' | 'starting' | 'running' | 'stopping';
  useLegacyProvider?: boolean;
  isCustom?: boolean;
  /** Timestamp (ms) del momento en que se detectó como "running". */
  startedAt?: number;
  /** Puerto asociado, cacheado desde la configuración. */
  port?: number | null;
}

interface GitInfo {
  branch?: string;
  branches?: string[];
  hasChanges?: boolean;
  loading?: boolean;
  error?: string;
  ahead?: number | null;
  behind?: number | null;
  upstream?: string | null;
}

interface GitDialog {
  open: boolean;
  title: string;
  message: string;
  tone: 'danger' | 'success' | 'warning';
  type?: 'error' | 'confirm-checkout' | 'confirm-pull';
  confirmCallback?: () => void;
}

@Component({
  selector: 'app-launcher',
  standalone: true,
  imports: [FormsModule, CommonModule, SpinnerComponent, PageHeaderComponent],
  templateUrl: './launcher.html',
  styleUrls: ['./launcher.scss'],
})
export class Launcher implements OnInit, OnDestroy {
  private router = inject(Router);
  private notify = inject(NotificationService);
  config: any = {};
  selectedTab: 'angular' | 'spring' = 'angular';
  angularMicros: MicroService[] = [];
  springMicros: MicroService[] = [];

  /**
   * Feature flag: muestra/oculta el toggle "Compatibilidad Node" (legacy provider).
   * Actualmente no aplica, pero se mantiene oculto por si vuelve a ser necesario.
   * Pon a `true` para volver a mostrarlo en las dos vistas y el formulario.
   */
  readonly showLegacyToggle = false;

  logs: string[] = [];
  microLogs: Record<string, string[]> = {}; // Logs separados por microservicio (con prefijo angular-key o spring-key)
  selectedLogTab: string = 'all'; // 'all', 'angular-all', 'spring-all', o 'angular-key'/'spring-key'
  logSearchTerm: string = ''; // Término de búsqueda en logs
  filteredLogs: string[] = []; // Logs filtrados por búsqueda

  // Filtro por nivel del log (error/warn/info/debug)
  selectedLogLevel: 'all' | 'error' | 'warn' | 'info' | 'debug' = 'all';
  // Auto-scroll inteligente: el usuario puede desactivarlo y al hacer scroll arriba se pausa
  autoScrollEnabled = true;
  userScrolledUp = false;
  pendingNewLogs = 0; // Logs nuevos no vistos cuando el auto-scroll está pausado
  private readonly LOG_PREFS_KEY = 'launcher-log-prefs';

  // Patrones para detectar nivel de log. Orden importa: primero error, luego warn, luego debug.
  private static readonly LEVEL_PATTERNS: Array<{ level: 'error' | 'warn' | 'debug'; re: RegExp }> = [
    { level: 'error', re: /\b(ERROR|ERR!|FATAL|SEVERE|Exception|Traceback|EADDRINUSE|ECONN|failed|FAIL\b|✖|❌|💥)\b|\b5\d{2}\b\s/i },
    { level: 'warn',  re: /\b(WARN(ING)?|WARN!|deprecated|deprecation)\b|\b4\d{2}\b\s|⚠️/i },
    { level: 'debug', re: /\b(DEBUG|TRACE|VERBOSE)\b/i },
  ];
  loading = false;
  loadingMessage = 'Procesando microservicios...';
  initialLoading = true;
  pendingGitOperations = 0;
  showLogs = true;
  showSuccessMessage = false;
  gitEnabled: Record<string, boolean> = {}; // Control de conexión Git por microservicio

  gitState: Record<string, GitInfo> = {};
  gitSelections: Record<string, string> = {};
  gitActions: Record<string, string | null> = {};
  gitStatuses: Record<string, { tone: 'warning' | 'success' | 'loading'; message: string }> = {};
  gitDialog: GitDialog | null = null;

  /** Popup con el panel Git detallado (rama, fetch/pull/checkout) para un micro concreto. */
  gitPanelDialog: { open: boolean; type: 'angular' | 'spring'; micro: MicroService } | null = null;

  // Configuración para gestión de logs - hacemos públicas las constantes que necesita el template
  readonly MAX_LOGS = 500; // Máximo número de logs antes de limpiar
  private readonly AUTO_CLEAN_INTERVAL = 5 * 60 * 1000; // 5 minutos en milisegundos
  private readonly LOGS_TO_KEEP_AFTER_CLEAN = 100; // Logs a mantener después de limpiar
  private logCleanTimer: any = null;
  private uptimeTicker: any = null;
  private healthCheckTimer: any = null;
  /** Cadena de "tick" que fuerza recomputo de uptimes (change detection). */
  uptimeTick = 0;

  @ViewChild('logBox') logBox!: ElementRef;
  @ViewChild('logSearchInput') logSearchInput?: ElementRef<HTMLInputElement>;

  constructor(private ngZone: NgZone) {
    this.loadLogPreferences();
    this.loadConfiguration();
    this.setupElectronListeners();
    this.setupLogCleanup();
    this.startUptimeTicker();
    this.startHealthCheck();
  }

  ngOnInit() {
    this.showSuccessMessage = false;
    this.loading = false;
    this.initialLoading = true;
    
    // Timeout de seguridad: ocultar spinner después de 5 segundos máximo
    setTimeout(() => {
      if (this.initialLoading) {
        console.warn('⚠️ Timeout de carga inicial alcanzado, forzando ocultamiento del spinner');
        this.initialLoading = false;
      }
    }, 5000);
    
    // Verificar estado actual de los microservicios cuando volvemos a la página
    this.checkCurrentStatus();
  }
  
  private checkCurrentStatus() {
    // Verificar si hay microservicios en estado 'starting'
    const hasStartingMicros = this.angularMicros.some(m => m.status === 'starting') || 
                             this.springMicros.some(m => m.status === 'starting');
    
    if (hasStartingMicros) {
      console.log('🔄 Detectados microservicios arrancando, solicitando estado actual...');
      this.loading = true;
      this.loadingMessage = 'Verificando estado de microservicios...';
      
      // Solicitar actualización de estado desde el proceso principal
      (window as any).electronAPI.requestStatusUpdate?.().then((statuses: any) => {
        console.log('📊 Estados recibidos:', statuses);
        this.ngZone.run(() => {
          if (statuses) {
            // Actualizar estados
            Object.keys(statuses).forEach(key => {
              const angularMicro = this.angularMicros.find(m => m.key === key);
              const springMicro = this.springMicros.find(m => m.key === key);
              const micro = angularMicro || springMicro;
              
              if (micro) {
                micro.status = statuses[key];
              }
            });
          }
          
          // Verificar de nuevo si hay microservicios arrancando
          const stillStarting = this.angularMicros.some(m => m.status === 'starting') || 
                               this.springMicros.some(m => m.status === 'starting');
          
          if (!stillStarting) {
            this.loading = false;
          }
        });
      }).catch((err: any) => {
        console.warn('⚠️ No se pudo obtener estado actualizado:', err);
        // Fallback: verificar puertos después de un delay
        setTimeout(() => {
          this.verifyPortsForRunningServices();
        }, 2000);
      });
    }
  }
  
  private verifyPortsForRunningServices() {
    // Verificar puertos de todos los microservicios que están "starting"
    const allMicros = [...this.angularMicros, ...this.springMicros];
    const startingMicros = allMicros.filter(m => m.status === 'starting');
    
    if (startingMicros.length === 0) {
      this.loading = false;
      return;
    }
    
    console.log(`🔍 Verificando puertos de ${startingMicros.length} microservicios...`);
    
    startingMicros.forEach(micro => {
      const port = this.getMicroPort(micro.key);
      if (port) {
        (window as any).electronAPI.checkPort(port).then((isOccupied: boolean) => {
          this.ngZone.run(() => {
            if (isOccupied) {
              micro.status = 'running';
              micro.startedAt = micro.startedAt ?? Date.now();
              micro.port = port;
              this.pushLog(`[${micro.key}] ✅ Verificado como arrancado (puerto ${port} ocupado)`, micro.key);
            }
            
            // Si ya no hay microservicios "starting", desactivar loading
            const stillStarting = this.angularMicros.some(m => m.status === 'starting') || 
                                 this.springMicros.some(m => m.status === 'starting');
            if (!stillStarting) {
              this.loading = false;
            }
          });
        });
      }
    });
  }
  
  private getMicroPort(key: string): number | null {
    // Obtener puerto desde la configuración
    const angularMicro = this.config.angularMicroservices?.find((m: any) => m.key === key);
    const springMicro = this.config.springMicroservices?.find((m: any) => m.key === key);
    const micro = angularMicro || springMicro;
    
    return micro?.port || null;
  }

  private loadConfiguration() {
    (window as any).electronAPI.getConfig().then((cfg: any) => {
      this.config = cfg;
      this.buildMicroServiceLists();
      // Cargar el último estado guardado sin verificar puertos
      this.loadLastStatus();
      // NO cargar Git automáticamente - esperar a que el usuario active el switch
      // this.refreshAllGitInfo();
      this.initialLoading = false; // Ocultar spinner inmediatamente
    }).catch((error: any) => {
      console.error('❌ Error cargando configuración:', error);
      // Asegurar que se oculte el spinner incluso si hay error
      this.initialLoading = false;
    });
  }

  private checkAndHideInitialLoading() {
    // Solo ocultar el loading inicial cuando todas las operaciones Git hayan terminado
    if (this.pendingGitOperations === 0 && this.initialLoading) {
      setTimeout(() => {
        this.initialLoading = false;
      }, 300); // Un pequeño delay para una transición suave
    }
  }

  repoKey(type: 'angular' | 'spring', microKey: string) {
    return `${type}-${microKey}`;
  }

  /** Etiqueta legible mostrada junto al spinner mientras se ejecuta una acción Git. */
  gitActionLabel(action: string | null | undefined): string {
    switch (action) {
      case 'fetch':    return 'Haciendo fetch…';
      case 'pull':     return 'Haciendo pull…';
      case 'checkout': return 'Cambiando rama…';
      default:         return 'Procesando…';
    }
  }

  getGitState(type: 'angular' | 'spring', microKey: string): GitInfo {
    const key = this.repoKey(type, microKey);
    return this.gitState[key] || {};
  }

  isGitEnabled(type: 'angular' | 'spring', microKey: string): boolean {
    const key = this.repoKey(type, microKey);
    return this.gitEnabled[key] || false;
  }

  toggleGit(micro: MicroService, type: 'angular' | 'spring') {
    const key = this.repoKey(type, micro.key);
    this.gitEnabled[key] = !this.gitEnabled[key];
    
    if (this.gitEnabled[key]) {
      console.log(`🔌 Conectando Git para ${micro.label}...`);
      this.refreshGitInfo(micro, type);
    } else {
      console.log(`🔌 Desconectando Git para ${micro.label}...`);
      // Limpiar estado de Git para este micro
      delete this.gitState[key];
      delete this.gitSelections[key];
      delete this.gitActions[key];
      delete this.gitStatuses[key];
    }
  }

  /** Abre el popup con el panel Git detallado para un microservicio. */
  openGitPanel(micro: MicroService, type: 'angular' | 'spring') {
    this.gitPanelDialog = { open: true, type, micro };
    // Si Git está habilitado pero no tenemos info cargada aún, refrescamos.
    const key = this.repoKey(type, micro.key);
    if (this.gitEnabled[key] && !this.gitState[key]) {
      this.refreshGitInfo(micro, type);
    }
  }

  /** Cierra el popup del panel Git. */
  closeGitPanel() {
    this.gitPanelDialog = null;
  }

  private getPathFor(type: 'angular' | 'spring', microKey: string) {
    return type === 'angular'
      ? this.config.angular?.[microKey]?.path
      : this.config.spring?.[microKey]?.path;
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

  private refreshAllGitInfo() {
    const totalMicros = this.angularMicros.length + this.springMicros.length;
    this.pendingGitOperations = totalMicros;
    
    // Si no hay microservicios, ocultar el loading inmediatamente
    if (totalMicros === 0) {
      this.checkAndHideInitialLoading();
      return;
    }
    
    this.angularMicros.forEach((micro) => this.refreshGitInfo(micro, 'angular'));
    this.springMicros.forEach((micro) => this.refreshGitInfo(micro, 'spring'));
  }

  refreshGitInfo(micro: MicroService, type: 'angular' | 'spring') {
    const key = this.repoKey(type, micro.key);
    
    // No hacer nada si Git no está habilitado para este micro
    if (!this.gitEnabled[key]) {
      if (this.initialLoading) {
        this.pendingGitOperations--;
        this.checkAndHideInitialLoading();
      }
      return;
    }
    
    const path = this.getPathFor(type, micro.key);

    if (!path) {
      this.gitState[key] = {
        loading: false,
        error: 'Configura la ruta del microservicio antes de usar Git',
      };
      // Solo decrementar si estamos en carga inicial
      if (this.initialLoading) {
        this.pendingGitOperations--;
        this.checkAndHideInitialLoading();
      }
      return;
    }

    this.gitState[key] = {
      ...(this.gitState[key] || {}),
      loading: true,
      error: undefined,
    };

    // Ejecutar operaciones Git FUERA de Angular Zone para no bloquear el spinner
    this.ngZone.runOutsideAngular(() => {
      (window as any).electronAPI
        .getGitInfo({ path })
        .then((result: any) => {
          // Solo entrar a Angular Zone para actualizar la UI con el resultado
          this.ngZone.run(() => {
            if (result.success) {
              this.gitState[key] = {
                branch: result.branch,
                branches: result.branches,
                hasChanges: result.hasChanges,
                ahead: result.ahead ?? null,
                behind: result.behind ?? null,
                upstream: result.upstream ?? null,
                loading: false,
              };
              this.gitSelections[key] = result.branch;
            } else {
              this.gitState[key] = {
                loading: false,
                error:
                  result.error ||
                  'No se pudo leer la información de Git para este microservicio',
              };
            }
            // Solo decrementar si estamos en carga inicial
            if (this.initialLoading) {
              this.pendingGitOperations--;
              this.checkAndHideInitialLoading();
            }
          });
        })
        .catch((error: any) => {
          this.ngZone.run(() => {
            this.gitState[key] = {
              loading: false,
              error: error?.message || 'No se pudo obtener la información de Git',
            };
            // Solo decrementar si estamos en carga inicial
            if (this.initialLoading) {
              this.pendingGitOperations--;
              this.checkAndHideInitialLoading();
            }
          });
        });
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

  private showGitDialog(title: string, message: string, tone: 'danger' | 'success' | 'warning', type: 'error' | 'confirm-checkout' | 'confirm-pull' = 'error', confirmCallback?: () => void) {
    this.gitDialog = {
      open: true,
      title,
      message,
      tone,
      type,
      confirmCallback,
    };
  }

  closeGitDialog() {
    this.gitDialog = null;
  }

  confirmGitDialog() {
    if (this.gitDialog?.confirmCallback) {
      this.gitDialog.confirmCallback();
    }
    this.gitDialog = null;
  }

  async runGitAction(
    action: 'fetch' | 'pull' | 'checkout',
    micro: MicroService,
    type: 'angular' | 'spring',
    force: boolean = false
  ) {
    const repoKey = this.repoKey(type, micro.key);
    const path = this.getPathFor(type, micro.key);
    const selectedBranch = this.gitSelections[repoKey];
    const typeLabel = type === 'angular' ? 'Angular' : 'Spring';

    if (!path) {
      this.showGitDialog(
        'Ruta no configurada',
        'Debes configurar la ruta del microservicio antes de usar los comandos de Git.',
        'danger'
      );
      return;
    }

    if (action === 'checkout' && !selectedBranch) {
      this.showGitDialog(
        'Selecciona una rama',
        'Elige una rama destino antes de intentar cambiarla.',
        'danger'
      );
      return;
    }

    this.gitActions[repoKey] = action;

    const startMessage =
      action === 'fetch'
        ? 'Actualizando referencias remotas...'
        : action === 'pull'
        ? 'Ejecutando pull...'
        : `Cambiando a la rama ${selectedBranch}...`;

    this.gitStatuses[repoKey] = { tone: 'loading', message: startMessage };

    // Ejecutar operaciones Git FUERA de Angular Zone para mantener el spinner fluido
    this.ngZone.runOutsideAngular(async () => {
      const api = (window as any).electronAPI;
      const actionPromise =
        action === 'fetch'
          ? api.gitFetch({ path })
          : action === 'pull'
          ? api.gitPull({ path, force })
          : api.gitCheckout({ path, branch: selectedBranch, force });

      try {
        const result = await actionPromise;
        // Solo volver a Angular Zone para actualizar la UI
        this.ngZone.run(() => {
          this.gitActions[repoKey] = null;

          if (result?.success) {
            const successLabel =
              action === 'fetch'
                ? 'Fetch completado'
                : action === 'pull'
                ? 'Pull realizado correctamente'
                : `Cambio a rama ${selectedBranch}`;

            this.gitStatuses[repoKey] = {
              tone: 'success',
              message: successLabel,
            };
            this.pushLog(`[${typeLabel} ${micro.label}] ${successLabel}`);
            this.refreshGitInfo(micro, type);
          } else {
            // Detectar si el error es por cambios locales
            if (result?.error === 'HasLocalChanges') {
              delete this.gitStatuses[repoKey];
              
              // Mostrar popup de confirmación
              const confirmMessage = action === 'checkout'
                ? `Tienes cambios locales en ${micro.label}. ¿Quieres descartarlos y cambiar a la rama ${selectedBranch}?`
                : `Tienes cambios locales en ${micro.label}. ¿Quieres descartarlos y hacer pull?`;
              
              const confirmTitle = 'Cambios locales detectados';
              
              this.showGitDialog(
                confirmTitle,
                confirmMessage,
                'warning',
                action === 'checkout' ? 'confirm-checkout' : 'confirm-pull',
                () => {
                  // Volver a ejecutar la acción con force=true
                  this.runGitAction(action, micro, type, true);
                }
              );
            } else {
              const errorMessage = result?.error || result?.details || 'La operación no pudo completarse.';
              this.showGitDialog(
                'Git devolvió un error',
                errorMessage,
                'danger'
              );
              delete this.gitStatuses[repoKey];
            }
          }
        });
      } catch (error: any) {
        this.ngZone.run(() => {
          this.gitActions[repoKey] = null;
          this.showGitDialog(
            'Git devolvió un error',
            error?.message || 'Se produjo un error inesperado al ejecutar Git.',
            'danger'
          );
          delete this.gitStatuses[repoKey];
        });
      }
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

  // ============================================================
  // Selección masiva
  // ============================================================

  /** Número de microservicios seleccionados en la pestaña actual. */
  selectedCount(): number {
    return this.getDisplayedMicros().filter(m => m.selected).length;
  }

  /** Indica si TODOS los microservicios visibles están seleccionados. */
  areAllSelected(): boolean {
    const micros = this.getDisplayedMicros();
    return micros.length > 0 && micros.every(m => m.selected);
  }

  /** Indica si hay selección parcial (algunos sí, otros no). Útil para estado indeterminado. */
  areSomeSelected(): boolean {
    const micros = this.getDisplayedMicros();
    const count = micros.filter(m => m.selected).length;
    return count > 0 && count < micros.length;
  }

  /** Selecciona o deselecciona todos los microservicios de la pestaña actual. */
  toggleSelectAll(checked?: boolean) {
    const target = typeof checked === 'boolean' ? checked : !this.areAllSelected();
    this.getDisplayedMicros().forEach(m => (m.selected = target));
  }

  /** Invierte la selección actual. */
  invertSelection() {
    this.getDisplayedMicros().forEach(m => (m.selected = !m.selected));
  }

  handleLog(msg: any, type: 'Angular' | 'Spring') {
    this.ngZone.run(() => {
      const list = type === 'Angular' ? this.angularMicros : this.springMicros;
      const micro = list.find((m) => m.key === msg.micro);

      if (micro && msg.status) {
        micro.status = msg.status;
        this.animateMicroCard(micro.key, msg.status);

        // Al arrancar guardamos startedAt para calcular uptime.
        if (msg.status === 'running') {
          micro.startedAt = micro.startedAt ?? Date.now();
          if (!micro.port) micro.port = this.getMicroPort(micro.key);
        } else if (msg.status === 'stopped') {
          micro.startedAt = undefined;
        }

        // Desactivar checkbox cuando el microservicio se arranca correctamente
        if (msg.status === 'running' && micro.selected) {
          micro.selected = false;
        }
      }

      if (msg.status === 'starting' && !this.loading) {
        this.pushLog(`[${type} ${msg.micro}] 🚀 Lanzando...`, msg.micro, type);
      }

      if (msg.status === 'running') {
        this.pushLog(`[${type} ${msg.micro}] ✅ Arrancado correctamente.`, msg.micro, type);
        
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
        } else {
          // Actualizar mensaje con los microservicios que aún están arrancando
          this.updateLoadingMessage();
        }
      }

      if (msg.status === 'stopped') {
        this.pushLog(`[${type} ${msg.micro}] 🛑 Detenido.`, msg.micro, type);
        
        // Solo desactivar el spinner si no hay más microservicios arrancando o parando
        const hasStartingMicros = this.angularMicros.some(m => m.status === 'starting') || 
                                 this.springMicros.some(m => m.status === 'starting');
        const hasStoppingMicros = this.angularMicros.some(m => m.status === 'stopping') || 
                                 this.springMicros.some(m => m.status === 'stopping');
        
        if (!hasStartingMicros && !hasStoppingMicros) {
          this.loading = false;
        } else {
          // Actualizar mensaje con los microservicios que aún están parando
          this.updateLoadingMessage();
        }
      }

      if (!msg.status) {
        this.pushLog(`[${type} ${msg.micro}] ${msg.log}`, msg.micro, type);
      }

      this.scrollToBottom();
    });
  }

  pushLog(message: string, microKey?: string, type?: 'Angular' | 'Spring') {
    // Agregar timestamp al mensaje
    const timestamp = new Date().toLocaleTimeString('es-ES', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    const timestampedMessage = `[${timestamp}] ${message}`;
    
    // Agregar al log general
    this.logs.push(timestampedMessage);
    
    // Si hay un microKey, agregar también al log específico
    if (microKey && type) {
      // Crear una key única combinando tipo y microKey (ej: 'angular-notifica', 'spring-notifica')
      const uniqueKey = `${type.toLowerCase()}-${microKey}`;
      
      if (!this.microLogs[uniqueKey]) {
        this.microLogs[uniqueKey] = [];
      }
      this.microLogs[uniqueKey].push(timestampedMessage);
      
      // Limpiar logs viejos del microservicio también
      if (this.microLogs[uniqueKey].length > this.MAX_LOGS) {
        this.microLogs[uniqueKey] = this.microLogs[uniqueKey].slice(-this.LOGS_TO_KEEP_AFTER_CLEAN);
      }
    }
    
    // Verificar si necesitamos limpiar logs inmediatamente
    if (this.logs.length > this.MAX_LOGS) {
      this.cleanOldLogs();
    }
    
    // Actualizar logs filtrados si hay búsqueda activa
    if (this.logSearchTerm) {
      this.filterLogs();
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

  updateLoadingMessage() {
    const startingMicros = [
      ...this.angularMicros.filter(m => m.status === 'starting'),
      ...this.springMicros.filter(m => m.status === 'starting')
    ];
    
    const stoppingMicros = [
      ...this.angularMicros.filter(m => m.status === 'stopping'),
      ...this.springMicros.filter(m => m.status === 'stopping')
    ];

    if (startingMicros.length > 0) {
      const names = startingMicros.map(m => m.label).join(', ');
      this.loadingMessage = startingMicros.length === 1 
        ? `Arrancando ${names}...`
        : `Arrancando ${startingMicros.length} microservicios...`;
    } else if (stoppingMicros.length > 0) {
      const names = stoppingMicros.map(m => m.label).join(', ');
      this.loadingMessage = stoppingMicros.length === 1 
        ? `Deteniendo ${names}...`
        : `Deteniendo ${stoppingMicros.length} microservicios...`;
    }
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
    this.loadingMessage = 'Arrancando microservicios...';
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
        this.notify.warning(`El micro Angular ${micro.label} no tiene ruta configurada.`, { title: 'Configuración incompleta' });
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
        this.notify.warning(`El micro Spring ${micro.label} no tiene ruta configurada.`, { title: 'Configuración incompleta' });
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
      // Obtener el perfil de Java seleccionado para este micro (java8 o java17)
      const microConfig = this.config.spring[micro.key] || {};
      const profileKey = microConfig.javaProfile || 'java8';
      const profile = this.config.spring.profiles?.[profileKey] || {};
      
      const javaHome = profile.javaHome || '';
      const settingsXml = profile.settingsXml || '';
      
      (window as any).electronAPI.startSpring({
        micro: micro.key,
        path: config.path,
        javaHome: javaHome,
        mavenHome: this.config.spring.mavenHome,
        settingsXml: settingsXml,
        m2RepoPath: profile.m2RepoPath || '',
      });
      
      // Indicar qué perfil se está usando
      const profileLabel = profileKey === 'java17' ? 'Java 17' : 'Java 8';
      this.pushLog(`→ Arrancando Spring ${micro.label} con ${profileLabel}...`);
    }
    
    micro.status = 'starting';
  }

  stopSelected() {
    this.pushLog('Parando micros seleccionados...');
    this.loading = true;
    this.loadingMessage = 'Deteniendo microservicios...';

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
      if (!this.logBox) return;
      // Si el usuario ha desactivado o ha hecho scroll arriba, no forzamos
      if (!this.autoScrollEnabled || this.userScrolledUp) {
        this.pendingNewLogs++;
        return;
      }
      setTimeout(() => {
        this.logBox.nativeElement.scrollTop =
          this.logBox.nativeElement.scrollHeight;
      }, 0);
    } catch {}
  }

  /** El usuario hace scroll dentro del log-box: detectamos si está leyendo arriba. */
  onLogsScroll() {
    if (!this.logBox) return;
    const el = this.logBox.nativeElement as HTMLElement;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Más de 60px del fondo -> está leyendo arriba, pausamos auto-scroll
    const wasUp = this.userScrolledUp;
    this.userScrolledUp = distanceFromBottom > 60;
    if (wasUp && !this.userScrolledUp) {
      this.pendingNewLogs = 0; // volvió al fondo
    }
  }

  /** Vuelve al fondo de los logs y reactiva el auto-scroll. */
  jumpToLatestLogs() {
    this.userScrolledUp = false;
    this.pendingNewLogs = 0;
    if (this.logBox) {
      this.logBox.nativeElement.scrollTop = this.logBox.nativeElement.scrollHeight;
    }
  }

  toggleAutoScroll() {
    this.autoScrollEnabled = !this.autoScrollEnabled;
    if (this.autoScrollEnabled) {
      this.jumpToLatestLogs();
    }
    this.saveLogPreferences();
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
    this.router.navigate(['']);
  }

  goToPorts() {
    this.router.navigate(['/ports']);
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
    if (this.selectedLogTab === 'all') {
      const clearedCount = this.logs.length;
      this.logs = [];
      // También limpiar todos los logs de microservicios
      this.microLogs = {};
      const timestamp = new Date().toLocaleTimeString('es-ES', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      this.logs.push(`[${timestamp}] 🗑️ ${clearedCount} logs limpiados manualmente`);
      console.log(`🗑️ Logs limpiados manualmente: ${clearedCount} logs eliminados`);
    } else {
      // Limpiar solo los logs del microservicio seleccionado
      const clearedCount = this.microLogs[this.selectedLogTab]?.length || 0;
      this.microLogs[this.selectedLogTab] = [];
      const timestamp = new Date().toLocaleTimeString('es-ES', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      this.microLogs[this.selectedLogTab].push(`[${timestamp}] 🗑️ ${clearedCount} logs limpiados manualmente`);
      console.log(`🗑️ Logs de ${this.selectedLogTab} limpiados: ${clearedCount} logs eliminados`);
    }
  }

  /**
   * Descarga los logs actualmente visibles (respeta pestaña, búsqueda y filtro por nivel)
   * como un fichero de texto plano usando un blob URL en el navegador embebido.
   */
  downloadLogs() {
    try {
      const lines = this.getVisibleLogs();
      if (!lines.length) {
        this.notify.info('No hay logs para descargar en la pestaña actual.');
        return;
      }
      const header = [
        `# Launcher logs — ${new Date().toISOString()}`,
        `# Pestaña: ${this.selectedLogTab}`,
        `# Nivel: ${this.selectedLogLevel}`,
        `# Búsqueda: ${this.logSearchTerm || '(ninguna)'}`,
        `# Líneas: ${lines.length}`,
        '',
      ].join('\n');
      const content = header + lines.join('\n') + '\n';
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeTab = this.selectedLogTab.replace(/[^a-zA-Z0-9_-]/g, '_');
      const a = document.createElement('a');
      a.href = url;
      a.download = `launcher-logs-${safeTab}-${stamp}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
      this.notify.success(`Descargados ${lines.length} logs.`);
    } catch (err: any) {
      this.notify.error('Error descargando logs: ' + (err?.message || err));
    }
  }

  // Obtener los logs actualmente visibles
  // Obtener todas las pestañas de logs disponibles
  getLogTabs(): Array<{ key: string; label: string; count: number }> {
    const tabs = [{ 
      key: 'all', 
      label: 'Todos', 
      count: this.logs.length 
    }];

    // Agregar pestañas para Angular (todos) y Spring (todos)
    const angularLogs = this.logs.filter(log => log.includes('[Angular '));
    const springLogs = this.logs.filter(log => log.includes('[Spring '));
    
    if (angularLogs.length > 0) {
      tabs.push({
        key: 'angular-all',
        label: '🅰️ Angular (todos)',
        count: angularLogs.length
      });
    }
    
    if (springLogs.length > 0) {
      tabs.push({
        key: 'spring-all',
        label: '🍃 Spring (todos)',
        count: springLogs.length
      });
    }

    // Usar un Set para evitar duplicados
    const processedKeys = new Set<string>();

    // Agregar pestañas para microservicios individuales que tienen logs
    Object.keys(this.microLogs).forEach(uniqueKey => {
      if (this.microLogs[uniqueKey].length > 0) {
        // Extraer el nombre del microservicio y el tipo (ej: 'angular-notifica' -> 'notifica')
        const [type, ...nameParts] = uniqueKey.split('-');
        const microName = nameParts.join('-');
        const label = type === 'angular' ? `🅰️ ${microName}` : `🍃 ${microName}`;
        
        tabs.push({
          key: uniqueKey,
          label: label,
          count: this.microLogs[uniqueKey].length
        });
      }
    });

    return tabs;
  }

  // Cambiar la pestaña de logs activa
  selectLogTab(tabKey: string) {
    this.selectedLogTab = tabKey;
    this.logSearchTerm = ''; // Limpiar búsqueda al cambiar de tab
    this.filteredLogs = [];
    setTimeout(() => this.scrollToBottom(), 0);
  }

  // Filtrar logs por término de búsqueda
  filterLogs() {
    if (!this.logSearchTerm.trim()) {
      this.filteredLogs = [];
      return;
    }

    const searchTerm = this.logSearchTerm.toLowerCase();
    const logsToFilter = this.getDisplayedLogs();
    
    this.filteredLogs = logsToFilter.filter(log => 
      log.toLowerCase().includes(searchTerm)
    );
  }

  // Limpiar búsqueda
  clearSearch() {
    this.logSearchTerm = '';
    this.filteredLogs = [];
  }

  // Exportar logs a archivo TXT
  exportLogs() {
    const logsToExport = this.logSearchTerm.trim() 
      ? this.filteredLogs 
      : this.getDisplayedLogs();

    if (logsToExport.length === 0) {
      this.notify.info('No hay logs para exportar.');
      return;
    }

    // Crear contenido del archivo
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const tabName = this.selectedLogTab === 'all' 
      ? 'todos' 
      : this.selectedLogTab === 'angular-all'
      ? 'angular'
      : this.selectedLogTab === 'spring-all'
      ? 'spring'
      : this.selectedLogTab.replace('-', '_');
    
    const filename = `logs_${tabName}_${timestamp}.txt`;
    const content = logsToExport.join('\n');

    // Crear blob y descargar
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.pushLog(`📥 Logs exportados: ${filename} (${logsToExport.length} líneas)`);
  }

  // Obtener logs para mostrar según la pestaña seleccionada y la búsqueda
  getDisplayedLogs(): string[] {
    // Si hay búsqueda activa, mostrar logs filtrados
    if (this.logSearchTerm.trim() && this.filteredLogs.length > 0) {
      return this.filteredLogs;
    }

    // Si no hay búsqueda, mostrar según la pestaña
    if (this.selectedLogTab === 'all') {
      return this.logs;
    } else if (this.selectedLogTab === 'angular-all') {
      // Todos los logs de microservicios Angular
      return this.logs.filter(log => log.includes('[Angular '));
    } else if (this.selectedLogTab === 'spring-all') {
      // Todos los logs de microservicios Spring
      return this.logs.filter(log => log.includes('[Spring '));
    } else if (this.microLogs[this.selectedLogTab]) {
      return this.microLogs[this.selectedLogTab];
    }
    
    return [];
  }

  // ============================================================
  // Nivel del log, filtro y highlight de búsqueda
  // ============================================================

  /** Detecta el nivel de un log a partir de patrones. Por defecto 'info'. */
  getLogLevel(line: string): 'error' | 'warn' | 'info' | 'debug' {
    for (const { level, re } of Launcher.LEVEL_PATTERNS) {
      if (re.test(line)) return level;
    }
    return 'info';
  }

  setLogLevel(level: 'all' | 'error' | 'warn' | 'info' | 'debug') {
    this.selectedLogLevel = level;
    this.saveLogPreferences();
    // Reaplica filtro de búsqueda si lo hubiera, sobre el nuevo conjunto
    if (this.logSearchTerm.trim()) {
      this.filterLogs();
    }
    setTimeout(() => this.scrollToBottom(), 0);
  }

  /** Devuelve los logs visibles aplicando además el filtro por nivel. */
  getVisibleLogs(): string[] {
    const base = this.getDisplayedLogs();
    if (this.selectedLogLevel === 'all') return base;
    return base.filter(l => this.getLogLevel(l) === this.selectedLogLevel);
  }

  /** Cuenta de niveles del log para la pestaña activa (sin filtro de nivel, sin búsqueda). */
  getLevelCounts(): { error: number; warn: number; info: number; debug: number; total: number } {
    // Saltamos getDisplayedLogs para no respetar la búsqueda: queremos el panorama de la pestaña.
    let source: string[];
    if (this.selectedLogTab === 'all') source = this.logs;
    else if (this.selectedLogTab === 'angular-all') source = this.logs.filter(l => l.includes('[Angular '));
    else if (this.selectedLogTab === 'spring-all')  source = this.logs.filter(l => l.includes('[Spring '));
    else source = this.microLogs[this.selectedLogTab] || [];

    const counts = { error: 0, warn: 0, info: 0, debug: 0, total: source.length };
    for (const l of source) {
      const lv = this.getLogLevel(l);
      counts[lv]++;
    }
    return counts;
  }

  /** Devuelve cuántos errores tiene una pestaña concreta (para badge en el tab). */
  getTabErrorCount(tabKey: string): number {
    let source: string[];
    if (tabKey === 'all') source = this.logs;
    else if (tabKey === 'angular-all') source = this.logs.filter(l => l.includes('[Angular '));
    else if (tabKey === 'spring-all')  source = this.logs.filter(l => l.includes('[Spring '));
    else source = this.microLogs[tabKey] || [];
    let n = 0;
    for (const l of source) if (this.getLogLevel(l) === 'error') n++;
    return n;
  }

  getTabWarnCount(tabKey: string): number {
    let source: string[];
    if (tabKey === 'all') source = this.logs;
    else if (tabKey === 'angular-all') source = this.logs.filter(l => l.includes('[Angular '));
    else if (tabKey === 'spring-all')  source = this.logs.filter(l => l.includes('[Spring '));
    else source = this.microLogs[tabKey] || [];
    let n = 0;
    for (const l of source) if (this.getLogLevel(l) === 'warn') n++;
    return n;
  }

  /** Devuelve el HTML seguro de una línea: escapado + búsqueda resaltada. */
  getLogHtml(line: string): string {
    const escaped = this.escapeHtml(line);
    const term = this.logSearchTerm.trim();
    if (!term) return escaped;
    const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${safeTerm})`, 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ============================================================
  // Persistencia de preferencias de logs
  // ============================================================
  private loadLogPreferences() {
    try {
      const raw = localStorage.getItem(this.LOG_PREFS_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (typeof prefs.autoScrollEnabled === 'boolean') this.autoScrollEnabled = prefs.autoScrollEnabled;
      if (typeof prefs.selectedLogLevel === 'string') this.selectedLogLevel = prefs.selectedLogLevel;
    } catch {}
  }

  private saveLogPreferences() {
    try {
      localStorage.setItem(this.LOG_PREFS_KEY, JSON.stringify({
        autoScrollEnabled: this.autoScrollEnabled,
        selectedLogLevel: this.selectedLogLevel,
      }));
    } catch {}
  }

  // ============================================================
  // Atajos de teclado
  //  - Ctrl/Cmd + F : foco al buscador de logs (si están visibles)
  //  - Esc          : limpiar búsqueda
  // ============================================================
  @HostListener('document:keydown', ['$event'])
  handleLogShortcuts(ev: KeyboardEvent) {
    const isFind = (ev.ctrlKey || ev.metaKey) && (ev.key === 'f' || ev.key === 'F');
    if (isFind && this.showLogs) {
      ev.preventDefault();
      setTimeout(() => this.logSearchInput?.nativeElement.focus(), 0);
      return;
    }
    if (ev.key === 'Escape' && this.logSearchTerm) {
      const active = document.activeElement as HTMLElement | null;
      // Solo si el foco está en el input de búsqueda de logs
      if (active && active === this.logSearchInput?.nativeElement) {
        ev.preventDefault();
        this.clearSearch();
      }
    }
  }

  // Limpiar timer al destruir el componente
  ngOnDestroy() {
    if (this.logCleanTimer) {
      clearInterval(this.logCleanTimer);
      this.logCleanTimer = null;
    }
    if (this.uptimeTicker) {
      clearInterval(this.uptimeTicker);
      this.uptimeTicker = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ============================================================
  // Uptime + health-check por microservicio
  // ============================================================

  /** Formatea segundos como "1h 3m 42s" (omite unidades a 0 a la izquierda). */
  formatUptime(fromMs?: number): string {
    if (!fromMs) return '';
    const totalSec = Math.max(0, Math.floor((Date.now() - fromMs) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  getMicroUptime(micro: MicroService): string {
    // uptimeTick fuerza recomputo cada segundo (referenciado desde template)
    void this.uptimeTick;
    return this.formatUptime(micro.startedAt);
  }

  private startUptimeTicker() {
    if (this.uptimeTicker) return;
    // Fuera de Angular Zone para no disparar CD innecesario cuando no hay running
    this.ngZone.runOutsideAngular(() => {
      this.uptimeTicker = setInterval(() => {
        const anyRunning =
          this.angularMicros.some(m => m.status === 'running' && m.startedAt) ||
          this.springMicros.some(m => m.status === 'running' && m.startedAt);
        if (!anyRunning) return;
        // Entrar a la zone solo para provocar la re-lectura de uptimes en template
        this.ngZone.run(() => { this.uptimeTick++; });
      }, 1000);
    });
  }

  private startHealthCheck() {
    if (this.healthCheckTimer) return;
    const api = (window as any).electronAPI;
    if (!api?.checkPort) return;
    this.ngZone.runOutsideAngular(() => {
      this.healthCheckTimer = setInterval(async () => {
        const running: MicroService[] = [
          ...this.angularMicros.filter(m => m.status === 'running'),
          ...this.springMicros.filter(m => m.status === 'running'),
        ];
        for (const micro of running) {
          const port = micro.port || this.getMicroPort(micro.key);
          if (!port) continue;
          try {
            const isUp: boolean = await api.checkPort(port);
            if (!isUp) {
              this.ngZone.run(() => {
                micro.status = 'stopped';
                micro.startedAt = undefined;
                this.pushLog(`[${micro.key}] ⛔ Health-check falló (puerto ${port} no responde)`, micro.key);
              });
            }
          } catch {
            // silencioso: un fallo puntual no debe apagar el micro
          }
        }
      }, 10_000);
    });
  }
}
