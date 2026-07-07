import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import gsap from 'gsap';
import { NotificationService } from '../../services/notification.service';
import { ConfirmService } from '../../services/confirm.service';
import { CryptoService } from '../../services/crypto.service';
import { PageHeaderComponent } from '../../Components/page-header/page-header';

/**
 * Entornos soportados:
 *  - 'local-dev'    → Portal local + DEV (Nexus). Requiere companyID + usuario + password.
 *  - 'pre'          → Portal Preproducción (Nexus). Requiere companyID + usuario + password.
 *  - 'intranet-dev' → Intranet Digital DEV (logcorp). Requiere SOLO usuario + password.
 *  - 'digital-dev'  → Digital DEV (iciam). Requiere SOLO email + password.
 */
export type EnvironmentKey = 'local-dev' | 'pre' | 'intranet-dev' | 'digital-dev';

interface User {
  id: string;
  name: string;
  /** Solo se usa en 'local-dev' y 'pre'. Opcional para entornos nuevos. */
  companyID?: string;
  /** Para 'digital-dev' contiene el email. Para el resto, el nombre de usuario. */
  username: string;
  password: string;
  description?: string;
  /** Notas libres del usuario (multilínea). */
  notes?: string;
  environment: EnvironmentKey;
}

interface Environment {
  key: EnvironmentKey;
  name: string;
  /**
   * URLs por sub-vista. local-dev tiene 2 (local/dev); el resto tiene 1.
   */
  urls:
    | { local: string; dev: string }
    | { pre: string }
    | { 'intranet-dev': string }
    | { 'digital-dev': string };
  icon: string;
}

/** Vista del portal. 'local'/'dev' comparten el env 'local-dev' (cambia la URL). */
type PortalView = 'local' | 'dev' | 'pre' | 'intranet-dev' | 'digital-dev';

interface PortalViewDef {
  key: PortalView;
  name: string;
  icon: string;
  env: EnvironmentKey;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [FormsModule, CommonModule, PageHeaderComponent],
  templateUrl: './users.html',
  styleUrls: ['./users.scss'],
})
export class UsersComponent implements OnInit {
  private router = inject(Router);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmService);
  private crypto = inject(CryptoService);
  users: User[] = [];
  showAddForm = false;
  editingUser: User | null = null;
  /**
   * Vista activa del portal. Tres opciones:
   *  - 'local' y 'dev' → usuarios con environment='local-dev', cambia solo la URL
   *  - 'pre'           → usuarios con environment='pre'
   */
  selectedView: PortalView = 'local';

  /** Definición de las vistas que se muestran como pestañas. */
  views: PortalViewDef[] = [
    { key: 'local',        name: 'Local',         icon: '🏠', env: 'local-dev' },
    { key: 'dev',          name: 'Desarrollo',    icon: '🔧', env: 'local-dev' },
    { key: 'pre',          name: 'Preproducción', icon: '🧪', env: 'pre' },
    { key: 'intranet-dev', name: 'Intranet Dev',  icon: '🌐', env: 'intranet-dev' },
    { key: 'digital-dev',  name: 'Digital Dev',   icon: '💻', env: 'digital-dev' },
  ];

  showPassword = false; // Para toggle de contraseña

  // Estado de la libreta de direcciones
  copiedKey: string | null = null;
  private copiedTimer: any = null;
  visiblePasswords: Record<string, boolean> = {};

  // Buscador de la agenda
  searchTerm = '';

  // Filtro por grupo empresarial (vacío = todos)
  companyFilter = '';

  // Modo incógnito: abre el portal en una sesión efímera (sin cookies persistentes).
  // Persistido en localStorage para que recuerde la preferencia.
  incognitoMode = false;
  private readonly INCOGNITO_LS_KEY = 'users.incognitoMode';
  
  environments: Environment[] = [
    {
      key: 'local-dev',
      name: 'Local / Desarrollo',
      urls: {
        local: 'http://localhost:8080/GBMSGF_ESCE/BtoChannelDriver.ssobto?dse_parentContextName=&dse_processorState=initial&dse_nextEventName=start&dse_operationName=inicio',
        dev: 'https://scnp-fo-gateway-api.isban.dev.corp/scnp-fo-gateway-api/login2f/login/s'
      },
      icon: '🏠🔧'
    },
    {
      key: 'pre',
      name: 'Preproducción',
      urls: {
        pre: 'https://scnp-fo-gateway-api.cashnexus.gcb.pre.corp/scnp-fo-gateway-api/login2f/login/s'
      },
      icon: '🧪'
    },
    {
      key: 'intranet-dev',
      name: 'Intranet Digital Dev',
      urls: {
        'intranet-dev': 'https://logcorp.sgtech.dev.corp/?environment=0&okURI=https%3A%2F%2Fapp.employee-santandercib.scib.dev.corp'
      },
      icon: '🌐'
    },
    {
      key: 'digital-dev',
      name: 'Digital Dev',
      urls: {
        'digital-dev': 'https://iciam.santandercib.com/ui/#/'
      },
      icon: '💻'
    }
  ];
  
  newUser: User = {
    id: '',
    name: '',
    companyID: '',
    username: '',
    password: '',
    description: '',
    notes: '',
    environment: 'local-dev'
  };

  /** Mapa userId → (notas expandidas en la tabla). */
  expandedNotes: Record<string, boolean> = {};

  constructor() {}

  // ============================================================
  // Vistas del portal (Local / Desarrollo / Pre)
  // ============================================================

  /** Definición de la vista activa. */
  getCurrentView(): PortalViewDef {
    return this.views.find(v => v.key === this.selectedView) ?? this.views[0];
  }

  /** Entorno (modelo de datos) de la vista activa. */
  getCurrentEnv(): EnvironmentKey {
    return this.getCurrentView().env;
  }

  /** ¿El entorno indicado necesita campo "Grupo Empresarial"? */
  envRequiresCompanyID(env: EnvironmentKey): boolean {
    return env === 'local-dev' || env === 'pre';
  }

  /** Etiqueta para el campo "usuario" según el entorno. */
  getUsernameLabel(env: EnvironmentKey): string {
    return env === 'digital-dev' ? 'Email' : 'Usuario';
  }

  /** Placeholder para el campo "usuario" según el entorno. */
  getUsernamePlaceholder(env: EnvironmentKey): string {
    switch (env) {
      case 'digital-dev':  return 'Ej: nombre.apellido@santander.com';
      case 'intranet-dev': return 'Ej: x123456';
      default:             return 'Ej: Testraul';
    }
  }

  /** ¿Tiene notas el usuario? */
  hasNotes(user: User): boolean {
    return !!(user.notes && user.notes.trim().length > 0);
  }

  /** Expande/contrae la fila de notas. */
  toggleNotes(userId: string) {
    this.expandedNotes[userId] = !this.expandedNotes[userId];
  }

  isNotesExpanded(userId: string): boolean {
    return !!this.expandedNotes[userId];
  }

  /** Cambia la vista activa. */
  switchView(view: PortalView) {
    this.selectedView = view;
    // Al cambiar de entorno, el filtro por grupo puede dejar de tener sentido
    // (el grupo seleccionado quizá no exista en el nuevo entorno).
    this.companyFilter = '';
  }

  /**
   * Compatibilidad: devuelve un objeto con `name` e `icon` de la vista activa
   * para los textos que ya estaban usando `getCurrentEnvironment().name`.
   */
  getCurrentEnvironment(): { name: string; icon: string; key: PortalView } {
    const v = this.getCurrentView();
    return { name: v.name, icon: v.icon, key: v.key };
  }

  /** Número de usuarios para una vista (local y dev comparten conteo). */
  getUserCountByView(view: PortalView): number {
    const def = this.views.find(v => v.key === view);
    if (!def) return 0;
    return this.users.filter(u => u.environment === def.env).length;
  }

  /**
   * URL del portal para el usuario indicado.
   * Si el usuario es `local-dev`, la URL depende de la vista activa (`local` vs `dev`).
   */
  getEnvironmentUrl(user: User): string {
    const env = this.environments.find(e => e.key === user.environment);
    if (!env) return '';

    switch (user.environment) {
      case 'local-dev': {
        const urls = env.urls as { local: string; dev: string };
        // Si la vista activa es 'dev', usamos URL dev; cualquier otro caso → local
        return this.selectedView === 'dev' ? urls.dev : urls.local;
      }
      case 'pre':
        return (env.urls as { pre: string }).pre;
      case 'intranet-dev':
        return (env.urls as { 'intranet-dev': string })['intranet-dev'];
      case 'digital-dev':
        return (env.urls as { 'digital-dev': string })['digital-dev'];
      default:
        return '';
    }
  }

  /** Usuarios visibles según la vista activa. */
  getUsersByEnvironment(): User[] {
    return this.users.filter(u => u.environment === this.getCurrentEnv());
  }

  /**
   * Lista filtrada por entorno y término de búsqueda (nombre, login, descripción o grupo).
   * Si `searchTerm` está vacío devuelve todos los usuarios de la vista actual.
   */
  getFilteredUsers(): User[] {
    const base = this.getUsersByEnvironment();
    const term = this.searchTerm.trim().toLowerCase();
    const company = this.companyFilter.trim();

    return base.filter(u => {
      // Filtro por grupo empresarial (exacto)
      if (company) {
        const userGroup = (u.companyID || 'SCNP').trim();
        if (userGroup !== company) return false;
      }
      // Filtro por término de búsqueda
      if (term) {
        const matches =
          u.name?.toLowerCase().includes(term) ||
          u.username?.toLowerCase().includes(term) ||
          u.companyID?.toLowerCase().includes(term) ||
          (u.description ?? '').toLowerCase().includes(term);
        if (!matches) return false;
      }
      return true;
    });
  }

  /**
   * Devuelve la lista única (ordenada alfabéticamente) de grupos empresariales
   * existentes entre los usuarios del entorno actualmente seleccionado.
   * Si un usuario no tiene companyID, se considera 'SCNP' (valor por defecto).
   */
  getCompanyGroups(): string[] {
    const base = this.getUsersByEnvironment();
    const set = new Set<string>();
    for (const u of base) {
      const g = (u.companyID || 'SCNP').trim();
      if (g) set.add(g);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }

  clearSearch() {
    this.searchTerm = '';
  }

  clearCompanyFilter() {
    this.companyFilter = '';
  }

  getUserCountByEnvironment(env: EnvironmentKey): number {
    return this.users.filter(user => user.environment === env).length;
  }

  ngOnInit() {
    this.loadUsers();
    this.loadIncognitoPreference();
    this.animateEntrance();

    // Event listener removido para evitar modales
  }

  private loadIncognitoPreference() {
    try {
      this.incognitoMode = localStorage.getItem(this.INCOGNITO_LS_KEY) === '1';
    } catch {
      this.incognitoMode = false;
    }
  }

  toggleIncognito() {
    this.incognitoMode = !this.incognitoMode;
    try {
      localStorage.setItem(this.INCOGNITO_LS_KEY, this.incognitoMode ? '1' : '0');
    } catch { /* noop */ }
    if (this.incognitoMode) {
      this.notify.info('Modo incógnito activado: sesión efímera, sin cookies persistentes.', { title: '🕵️ Incógnito ON', duration: 2500 });
    } else {
      this.notify.info('Modo incógnito desactivado.', { duration: 1800 });
    }
  }

  private animateEntrance() {
    setTimeout(() => {
      gsap.fromTo('.users-container', 
        { opacity: 0, y: 30 }, 
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }
      );
    }, 0);
  }

  private async loadUsers() {
    const savedUsers = localStorage.getItem('portal-users');
    if (savedUsers) {
      const parsed: User[] = JSON.parse(savedUsers);

      // Migración 1: garantizar que todos los usuarios tienen `environment`.
      // Migración 2: descifrar contraseñas si estaban cifradas. Las que estén
      // en claro (legado) se dejan tal cual y se re-cifrarán en el próximo
      // `saveUsers()`.
      const passwords = parsed.map(u => u.password ?? '');
      const decrypted = await this.crypto.decryptMany(passwords);
      this.users = parsed.map((user, i) => ({
        ...user,
        environment: user.environment || 'local-dev',
        password: decrypted[i] ?? user.password
      }));

      // Persistimos siempre tras cargar para asegurar cifrado y migración.
      this.saveUsers();
    } else {
      // Usuarios por defecto
      this.users = [
        {
          id: '1',
          name: 'Test Raul',
          companyID: 'TESTPORTAL',
          username: 'Testraul',
          password: '85BUui!:',
          description: 'Usuario de prueba principal',
          environment: 'local-dev'
        }
      ];
      this.saveUsers();
    }
  }

  /**
   * Guarda los usuarios en localStorage cifrando SIEMPRE la contraseña
   * (si el entorno soporta `safeStorage`). La cadena cifrada lleva prefijo
   * `enc:v1:` para poder detectarla al recargar.
   *
   * En memoria (`this.users`) las contraseñas se mantienen en claro para
   * que el resto de la UI (mostrar/copiar/auto-login) siga funcionando
   * sin conocer nada del cifrado.
   */
  private async saveUsers() {
    try {
      const passwords = this.users.map(u => u.password ?? '');
      const encrypted = await this.crypto.encryptMany(passwords);
      const toStore = this.users.map((u, i) => ({
        ...u,
        password: encrypted[i] ?? u.password
      }));
      localStorage.setItem('portal-users', JSON.stringify(toStore));
    } catch (err) {
      console.error('No se pudo cifrar/guardar usuarios, se guarda en claro como fallback', err);
      localStorage.setItem('portal-users', JSON.stringify(this.users));
    }
  }

  showAddUserForm() {
    this.showAddForm = true;
    this.editingUser = null;
    this.resetNewUser();
    
    setTimeout(() => {
      gsap.fromTo('.user-form', 
        { opacity: 0, scale: 0.9 }, 
        { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.7)' }
      );
    }, 0);
  }

  editUser(user: User) {
    this.editingUser = { ...user };
    this.newUser = { ...user };
    this.showAddForm = true;
    
    setTimeout(() => {
      gsap.fromTo('.user-form', 
        { opacity: 0, scale: 0.9 }, 
        { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.7)' }
      );
    }, 0);
  }

  saveUser() {
    const needsCompany = this.envRequiresCompanyID(this.newUser.environment);
    const missingCompany = needsCompany && !this.newUser.companyID;
    if (!this.newUser.name || missingCompany || !this.newUser.username || !this.newUser.password) {
      this.notify.warning('Faltan campos obligatorios.', { title: 'Faltan datos' });
      return;
    }

    // Para entornos sin grupo empresarial, limpiamos el valor para no ensuciar el modelo.
    if (!needsCompany) {
      this.newUser.companyID = '';
    }

    const isEditing = !!this.editingUser;
    if (isEditing) {
      const index = this.users.findIndex(u => u.id === this.editingUser!.id);
      if (index !== -1) {
        this.users[index] = { ...this.newUser };
      }
    } else {
      const newId = Date.now().toString();
      this.users.push({ ...this.newUser, id: newId });
    }

    this.saveUsers();
    this.cancelForm();
    this.notify.success(isEditing ? 'Usuario actualizado.' : 'Usuario añadido.');

    // Animación de confirmación
    setTimeout(() => {
      const lastCard = document.querySelector('.user-card:last-child');
      if (lastCard) {
        gsap.fromTo(lastCard, 
          { scale: 0.8, opacity: 0 }, 
          { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' }
        );
      }
    }, 0);
  }

  async deleteUser(userId: string) {
    const user = this.users.find(u => u.id === userId);
    const ok = await this.confirm.ask({
      title: 'Eliminar usuario',
      message: user ? `¿Seguro que quieres eliminar a "${user.name}"? Esta acción no se puede deshacer.` : '¿Seguro que quieres eliminar este usuario?',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger'
    });
    if (!ok) return;

    const cardToRemove = document.querySelector(`[data-user-id="${userId}"]`);
    if (cardToRemove) {
      gsap.to(cardToRemove, {
        scale: 0.8,
        opacity: 0,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: () => {
          this.users = this.users.filter(u => u.id !== userId);
          this.saveUsers();
        }
      });
    } else {
      this.users = this.users.filter(u => u.id !== userId);
      this.saveUsers();
    }
    this.notify.info('Usuario eliminado.');
  }

  cancelForm() {
    gsap.to('.user-form', {
      opacity: 0,
      scale: 0.9,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => {
        this.showAddForm = false;
        this.editingUser = null;
        this.resetNewUser();
        this.showPassword = false; // Reset password visibility
      }
    });
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  // ------- Libreta de direcciones -------
  isPasswordVisible(userId: string): boolean {
    return !!this.visiblePasswords[userId];
  }

  toggleUserPasswordVisibility(userId: string) {
    this.visiblePasswords[userId] = !this.visiblePasswords[userId];
  }

  copyToClipboard(value: string, key: string) {
    if (!value) return;
    const markCopied = () => {
      this.copiedKey = key;
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => {
        this.copiedKey = null;
        this.copiedTimer = null;
      }, 1200);
    };

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(markCopied).catch(() => {
          this.fallbackCopy(value);
          markCopied();
        });
      } else {
        this.fallbackCopy(value);
        markCopied();
      }
    } catch {
      this.fallbackCopy(value);
      markCopied();
    }
  }

  private fallbackCopy(value: string) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {
      console.warn('No se pudo copiar al portapapeles', e);
    }
  }

  private resetNewUser() {
    this.newUser = {
      id: '',
      name: '',
      companyID: '',
      username: '',
      password: '',
      description: '',
      notes: '',
      // El entorno por defecto al añadir desde la vista activa
      environment: this.getCurrentEnv()
    };
  }

  async loginWithUser(user: User) {
    try {
      const portalUrl = this.getEnvironmentUrl(user);
      console.log('🚀 Intentando abrir portal para usuario:', user.name);
      console.log('📍 URL del portal:', portalUrl);
      console.log('🏷️ Entorno:', user.environment);

      const isElectron = !!(window as any).electronAPI;
      if (!isElectron) {
        this.notify.warning('Auto-Login solo disponible en la app de escritorio.', { title: 'No es posible aquí' });
        return;
      }

      this.loginWithElectron(user);
    } catch (error) {
      console.error('❌ Error general al abrir portal:', error);
      this.notify.error('No se pudo iniciar Auto-Login. Revisa la consola.', { title: 'Error' });
    }
  }

  private loginWithElectron(user: User) {
    try {
      const electronAPI = (window as any).electronAPI;

      if (!electronAPI?.openPortalAutoLogin) {
        this.notify.error('La función Auto-Login no está disponible en este entorno.', { title: 'Auto-Login' });
        return;
      }

      const portalUrl = this.getEnvironmentUrl(user);
      if (!portalUrl) {
        this.notify.error('URL del portal vacía. Revisa la configuración.', { title: 'Auto-Login' });
        return;
      }

      const loginData = {
        url: portalUrl,
        incognito: this.incognitoMode,
        user: {
          name: user.name,
          companyID: user.companyID || '',
          username: user.username,
          password: user.password,
          environment: user.environment
        }
      };

      this.notify.info(`Lanzando Auto-Login${this.incognitoMode ? ' 🕵️ (incógnito)' : ''} para ${user.name}…`, { duration: 2500 });

      electronAPI.openPortalAutoLogin(loginData)
        .then((result: any) => {
          if (result?.success) {
            this.notify.success(`Portal abierto y credenciales inyectadas para ${user.name}.`, { title: 'Auto-Login completado' });
          } else {
            this.notify.error(result?.error || 'Auto-Login falló. Inténtalo manualmente.', { title: 'Auto-Login' });
          }
        })
        .catch((error: any) => {
          console.error('❌ Error ejecutando auto-login:', error);
          this.notify.error('No se pudo ejecutar Auto-Login.', { title: 'Auto-Login' });
        });
    } catch (error) {
      console.error('❌ Error al ejecutar login:', error);
      this.notify.error('Error inesperado al iniciar Auto-Login.', { title: 'Auto-Login' });
    }
  }

  goBack() {
    this.router.navigate(['/launcher']);
  }

  goToConfig() {
    this.router.navigate(['/config']);
  }

  goToHome() {
    this.router.navigate(['']);
  }

  goToPorts() {
    this.router.navigate(['/ports']);
  }

  goToTodos() {
    this.router.navigate(['/todos']);
  }
}
