import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import gsap from 'gsap';
import { NotificationService } from '../../services/notification.service';
import { ConfirmService } from '../../services/confirm.service';

interface User {
  id: string;
  name: string;
  companyID: string;
  username: string;
  password: string;
  description?: string;
  environment: 'local-dev' | 'pre'; // Unificado: local-dev y pre separado
}

interface Environment {
  key: 'local-dev' | 'pre';
  name: string;
  urls: { local: string; dev: string } | { pre: string }; // URLs múltiples para local-dev
  icon: string;
}

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './users.html',
  styleUrls: ['./users.scss'],
})
export class UsersComponent implements OnInit {
  private router = inject(Router);
  private notify = inject(NotificationService);
  private confirm = inject(ConfirmService);
  users: User[] = [];
  showAddForm = false;
  editingUser: User | null = null;
  selectedEnvironment: 'local-dev' | 'pre' = 'local-dev';
  selectedSubEnvironment: 'local' | 'dev' = 'local'; // Para saber si mostrar local o dev cuando esté en local-dev
  showPassword = false; // Para toggle de contraseña

  // Estado de la libreta de direcciones
  copiedKey: string | null = null;
  private copiedTimer: any = null;
  visiblePasswords: Record<string, boolean> = {};
  
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
    }
  ];
  
  newUser: User = {
    id: '',
    name: '',
    companyID: '',
    username: '',
    password: '',
    description: '',
    environment: 'local-dev'
  };

  constructor() {}

  // Métodos auxiliares para manejar entornos
  getCurrentEnvironment(): Environment {
    return this.environments.find(env => env.key === this.selectedEnvironment) || this.environments[0];
  }

  getEnvironmentUrl(user: User, subEnv?: 'local' | 'dev'): string {
    const env = this.environments.find(e => e.key === user.environment);
    if (!env) return '';
    
    if (user.environment === 'local-dev') {
      const urls = env.urls as { local: string; dev: string };
      if (subEnv) {
        return subEnv === 'local' ? urls.local : urls.dev;
      }
      // Por defecto usar local, pero permitir cambiar
      return this.selectedSubEnvironment === 'local' ? urls.local : urls.dev;
    } else {
      const urls = env.urls as { pre: string };
      return urls.pre;
    }
  }

  getUsersByEnvironment(): User[] {
    return this.users.filter(user => user.environment === this.selectedEnvironment);
  }

  getUserCountByEnvironment(env: 'local-dev' | 'pre'): number {
    return this.users.filter(user => user.environment === env).length;
  }

  switchEnvironment(envKey: 'local-dev' | 'pre') {
    this.selectedEnvironment = envKey;
  }
  
  // Método para cambiar entre local y dev cuando estamos en local-dev
  switchSubEnvironment(subEnv: 'local' | 'dev') {
    if (this.selectedEnvironment === 'local-dev') {
      this.selectedSubEnvironment = subEnv;
    }
  }

  ngOnInit() {
    this.loadUsers();
    this.animateEntrance();
    
    // Event listener removido para evitar modales
  }

  private animateEntrance() {
    setTimeout(() => {
      gsap.fromTo('.users-container', 
        { opacity: 0, y: 30 }, 
        { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }
      );
    }, 0);
  }

  private loadUsers() {
    const savedUsers = localStorage.getItem('portal-users');
    if (savedUsers) {
      this.users = JSON.parse(savedUsers);
      // Migrar usuarios existentes que no tengan environment
      this.users = this.users.map(user => ({
        ...user,
        environment: user.environment || 'local-dev'
      }));
      this.saveUsers(); // Guardar la migración
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

  private saveUsers() {
    localStorage.setItem('portal-users', JSON.stringify(this.users));
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
    if (!this.newUser.name || !this.newUser.companyID || !this.newUser.username || !this.newUser.password) {
      this.notify.warning('Todos los campos son obligatorios.', { title: 'Faltan datos' });
      return;
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
      environment: this.selectedEnvironment
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
        user: {
          name: user.name,
          companyID: user.companyID,
          username: user.username,
          password: user.password,
          environment: user.environment
        }
      };

      this.notify.info(`Lanzando Auto-Login para ${user.name}…`, { duration: 2500 });

      electronAPI.openPortalAutoLogin(loginData)
        .then((result: any) => {
          if (result?.success) {
            this.notify.success(`Navegador abierto para ${user.name}.`, { title: 'Auto-Login listo' });
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
}
