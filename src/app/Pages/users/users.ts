import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import gsap from 'gsap';

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
  users: User[] = [];
  showAddForm = false;
  editingUser: User | null = null;
  selectedEnvironment: 'local-dev' | 'pre' = 'local-dev';
  selectedSubEnvironment: 'local' | 'dev' = 'local'; // Para saber si mostrar local o dev cuando esté en local-dev
  
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

  portalUrl = 'http://localhost:8080/GBMSGF_ESCE/BtoChannelDriver.ssobto?dse_parentContextName=&dse_processorState=initial&dse_nextEventName=start&dse_operationName=inicio';

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

  private handlePortalResult(result: any) {
    console.log('📊 Resultado de apertura del portal:', result);
    
    if (result.success) {
      console.log('✅ Portal abierto exitosamente para:', result.user.name);
      
      // Mostrar notificación de éxito
      const message = result.method === 'chrome' 
        ? `Portal abierto en Chrome para ${result.user.name}`
        : `Portal abierto para ${result.user.name}`;
        
      this.showSuccessNotification(message);
      
    } else {
      console.error('❌ Error al abrir portal:', result.error);
      
      // Mostrar script de emergencia
      this.showEmergencyScript(result.user);
    }
  }

  private showSuccessNotification(message: string) {
    const notification = document.createElement('div');
    notification.className = 'success-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">✅</span>
        <span class="notification-text">${message}</span>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animar entrada
    gsap.fromTo(notification, 
      { opacity: 0, y: -50 }, 
      { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }
    );
    
    // Remover después de 4 segundos
    setTimeout(() => {
      gsap.to(notification, {
        opacity: 0,
        y: -50,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: () => {
          document.body.removeChild(notification);
        }
      });
    }, 4000);
  }

  private showEmergencyScript(user: User) {
    const script = this.generateLoginScript(user);
    const portalUrl = this.getEnvironmentUrl(user);

    // Crear ventana de emergencia
    const emergencyWindow = window.open('', '_blank', 'width=600,height=400');
    if (emergencyWindow) {
      emergencyWindow.document.write(`
        <html>
          <head>
            <title>⚠️ Error de Apertura - ${user.name}</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                padding: 20px; 
                background: #fff5f5; 
                color: #333;
              }
              .error-container { 
                max-width: 500px; 
                margin: 0 auto; 
                background: white; 
                padding: 25px; 
                border-radius: 10px; 
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                border-left: 5px solid #ff4444;
              }
              .script-box { 
                background: #f8f8f8; 
                border: 1px solid #ddd; 
                padding: 15px; 
                border-radius: 5px; 
                font-family: monospace; 
                margin: 15px 0;
                white-space: pre-wrap;
              }
              .btn { 
                background: #007cba; 
                color: white; 
                border: none; 
                padding: 10px 20px; 
                border-radius: 5px; 
                cursor: pointer; 
                margin: 5px;
              }
              .btn:hover { background: #005a8b; }
              .manual-url { 
                background: #e7f3ff; 
                border: 1px solid #b3d9ff; 
                padding: 10px; 
                border-radius: 5px; 
                margin: 15px 0;
                word-break: break-all;
              }
            </style>
          </head>
          <body>
            <div class="error-container">
              <h2>⚠️ No se pudo abrir automáticamente</h2>
              <p><strong>Usuario:</strong> ${user.name}
                <span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 8px;">${user.environment.toUpperCase()}</span>
              </p>
              
              <h3>🔗 Opción 1: Abrir manualmente</h3>
              <div class="manual-url">
                <strong>URL:</strong><br>
                ${portalUrl}
              </div>
              <button class="btn" onclick="window.open('${portalUrl}', '_blank')">🌐 Abrir Portal</button>
              
              <h3>📋 Opción 2: Script de login</h3>
              <p>Abre la consola del navegador (F12) y pega:</p>
              <div class="script-box">${script}</div>
              <button class="btn" onclick="copyScript()">📋 Copiar Script</button>
              
              <h3>✋ Opción 3: Login manual</h3>
              <p><strong>Company ID:</strong> ${user.companyID}<br>
                 <strong>Usuario:</strong> ${user.username}<br>
                 <strong>Contraseña:</strong> ${user.password}</p>
            </div>
            
            <script>
              function copyScript() {
                const script = \`${script}\`;
                navigator.clipboard.writeText(script).then(() => {
                  alert('✅ Script copiado al portapapeles!');
                }).catch(() => {
                  prompt('Copia este script:', script);
                });
              }
            </script>
          </body>
        </html>
      `);
    }
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
      alert('⚠️ Todos los campos son obligatorios');
      return;
    }

    if (this.editingUser) {
      // Editar usuario existente
      const index = this.users.findIndex(u => u.id === this.editingUser!.id);
      if (index !== -1) {
        this.users[index] = { ...this.newUser };
      }
    } else {
      // Añadir nuevo usuario
      const newId = Date.now().toString();
      this.users.push({ ...this.newUser, id: newId });
    }

    this.saveUsers();
    this.cancelForm();
    
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

  deleteUser(userId: string) {
    if (confirm('¿Estás seguro de que quieres eliminar este usuario?')) {
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
    }
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
      }
    });
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
      
      // Verificar si estamos en Electron
      const isElectron = (window as any).electronAPI;
      
      if (isElectron) {
        console.log('⚡ Usando modo Electron para login automático');
        this.loginWithElectron(user);
      } else {
        console.log('🌐 Usando modo navegador web');
        this.loginWithBrowser(user);
      }
      
    } catch (error) {
      console.error('❌ Error general al abrir portal:', error);
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      const portalUrl = this.getEnvironmentUrl(user);
      alert(`❌ Error al abrir el portal: ${errorMessage}\n\nURL: ${portalUrl}\n\nVerifica que la URL sea correcta y que el servidor esté funcionando.`);
    }
  }

  private loginWithElectron(user: User) {
    // Mostrar mensaje de inicio
    this.showLoginConfirmation(user.name);
    
    try {
      const electronAPI = (window as any).electronAPI;
      
      if (!electronAPI) {
        console.error('❌ electronAPI no está disponible');
        throw new Error('electronAPI no está disponible');
      }

      console.log('🚀 Iniciando auto-login con Puppeteer');
      
      const portalUrl = this.getEnvironmentUrl(user);
      console.log('🔗 URL del portal generada:', portalUrl);
      console.log('🔍 Tipo de URL:', typeof portalUrl);
      console.log('📏 Longitud de URL:', portalUrl?.length);
      
      if (!portalUrl || portalUrl === '') {
        console.error('❌ URL vacía o undefined');
        alert('❌ Error: No se pudo obtener la URL del portal');
        return;
      }
      
      // Crear datos para el auto-login
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

      console.log('📦 Datos de login preparados:', JSON.stringify(loginData, null, 2));

      // Usar la nueva función de auto-login con Puppeteer
      if (electronAPI.openPortalAutoLogin) {
        console.log('✅ Llamando a openPortalAutoLogin...');
        
        electronAPI.openPortalAutoLogin(loginData)
          .then((result: any) => {
            console.log('📨 Respuesta recibida:', result);
            
            if (result.success) {
              console.log('✅ Chrome abierto con auto-login automático');
              
              // Mostrar notificación simple
              this.showLoginConfirmation(`✅ ${user.name} - Auto-login activado`);
              
            } else {
              console.error('❌ Error en auto-login:', result.error);
              alert(`❌ Error: ${result.error}\n\nIntenta el login manual.`);
            }
          })
          .catch((error: any) => {
            console.error('❌ Error ejecutando auto-login:', error);
            alert(`❌ Error: ${error}\n\nIntenta el login manual.`);
          });
      } else {
        console.error('❌ Función openPortalAutoLogin no disponible');
        throw new Error('Función openPortalAutoLogin no disponible');
      }

    } catch (error) {
      console.error('❌ Error al ejecutar login:', error);
      const portalUrl = this.getEnvironmentUrl(user);
      alert(`❌ Error: ${error}\n\nURL del portal: ${portalUrl}`);
    }
  }

  // Nuevo método para usar navegador integrado
  private generateLoginScript(user: User): string {
    // Generar script según el entorno del usuario
    switch (user.environment) {
      case 'local-dev':
        // Para local-dev, necesitamos saber si es local o dev
        const isLocalMode = this.selectedSubEnvironment === 'local';
        
        if (isLocalMode) {
          // Script para LOCAL
          return `document.getElementsByName('companyID')[0].value='${user.companyID}';
document.getElementsByName('usuario')[0].value='${user.username}';
document.getElementsByName('password')[0].value='${user.password}';
document.querySelector('.opLogonStandardButton').click();`;
        } else {
          // Script para DEV
          const grupoEmpresarial = user.companyID || 'SCNP';
          return `// Rellenar campos para DEV
document.querySelector('#txt_group input').value='${grupoEmpresarial}';
document.querySelector('#txt_usuario input').value='${user.username}';
document.querySelector('#txt_pass input').value='${user.password}';

// Hacer clic en el botón de login
document.querySelector('#btn_entrar').click();

console.log('✅ Datos introducidos en DEV');
console.log('Grupo empresarial: ${grupoEmpresarial}');
console.log('Usuario: ${user.username}');`;
        }
      
      case 'pre':
        // Script para pre
        const grupoEmpresarial = user.companyID || 'SCNP';
        return `// Rellenar campos para PRE
document.querySelector('#txt_group input').value='${grupoEmpresarial}';
document.querySelector('#txt_usuario input').value='${user.username}';
document.querySelector('#txt_pass input').value='${user.password}';

// Hacer clic en el botón de login
document.querySelector('#btn_entrar').click();

console.log('✅ Datos introducidos en PRE');
console.log('Grupo empresarial: ${grupoEmpresarial}');
console.log('Usuario: ${user.username}');`;
      
      default:
        return `console.log('Entorno no reconocido: ${user.environment}');`;
    }
  }

  private showScriptInstructions(user: User) {
    // Usar el nuevo método para generar el script según el entorno
    const script = this.generateLoginScript(user);

    // Crear una ventana con instrucciones alternativas
    setTimeout(() => {
      const instructionWindow = window.open('', '_blank', 'width=700,height=500');
      if (instructionWindow) {
        instructionWindow.document.write(`
          <html>
            <head>
              <title>Login Automático - ${user.name}</title>
              <style>
                body { 
                  font-family: Arial, sans-serif; 
                  padding: 20px; 
                  background: #f0f0f0; 
                  line-height: 1.6;
                }
                .container { 
                  max-width: 600px; 
                  margin: 0 auto; 
                  background: white; 
                  padding: 25px; 
                  border-radius: 10px; 
                  box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
                }
                .status { 
                  background: #e7f3ff; 
                  border: 1px solid #b3d9ff; 
                  padding: 15px; 
                  border-radius: 5px; 
                  margin: 15px 0; 
                  text-align: center;
                }
                .btn { 
                  background: #007cba; 
                  color: white; 
                  border: none; 
                  padding: 10px 20px; 
                  border-radius: 5px; 
                  cursor: pointer; 
                  margin: 5px; 
                }
                .btn:hover { background: #005a8b; }
                .simple-script {
                  background: #fffacd;
                  border: 2px solid #ffd700;
                  padding: 15px;
                  border-radius: 5px;
                  font-family: monospace;
                  margin: 15px 0;
                  font-size: 12px;
                  white-space: pre-wrap;
                }
                .user-data {
                  background: #f0f8ff;
                  border: 1px solid #add8e6;
                  padding: 15px;
                  border-radius: 5px;
                  margin: 15px 0;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h2>🚀 Login Automático - ${user.name}</h2>
                <p><strong>Entorno:</strong> <span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${user.environment.toUpperCase()}</span></p>
                
                <div class="status">
                  ⚡ Chrome se ha abierto con auto-login activado<br>
                  🤖 Los campos se rellenarán automáticamente<br>
                  ⏱️ Si no funciona, usa las opciones de abajo:
                </div>
                
                <h3>🎯 Script de Emergencia</h3>
                <p>Si el auto-login no funciona, abre la consola (F12) y pega:</p>
                <div class="simple-script">${script}</div>
                
                <button class="btn" onclick="copyScript()">📋 Copiar Script</button>
                
                <h3>📝 Datos Manuales</h3>
                <div class="user-data">
                  <strong>Company ID:</strong> ${user.companyID}<br>
                  <strong>Usuario:</strong> ${user.username}<br>
                  <strong>Contraseña:</strong> ${user.password}
                </div>
                
                <div style="text-align: center; margin-top: 20px;">
                  <button class="btn" onclick="window.close()">❌ Cerrar</button>
                </div>
                
                <div style="margin-top: 20px; font-size: 12px; color: #666; text-align: center;">
                  Esta ventana se cerrará automáticamente en 2 minutos
                </div>
              </div>
              
              <script>
                function copyScript() {
                  const script = \`${script}\`;
                  
                  navigator.clipboard.writeText(script).then(() => {
                    alert('✅ Script copiado! Pégalo en la consola del portal (F12)');
                  }).catch(() => {
                    prompt('Copia este script:', script);
                  });
                }
                
                // Auto-cerrar después de 2 minutos
                setTimeout(() => {
                  if (confirm('¿Cerrar esta ventana de instrucciones?')) {
                    window.close();
                  }
                }, 120000);
              </script>
            </body>
          </html>
        `);
      }
    }, 1500);
  }

  private loginWithBrowser(user: User) {
    // Verificar si la URL es accesible (básica validación)
    if (!this.portalUrl || !this.portalUrl.startsWith('http')) {
      alert('❌ URL del portal no válida. Verifica la configuración.');
      return;
    }

    // Mostrar mensaje de confirmación inmediatamente
    this.showLoginConfirmation(user.name);
    
    // Intentar abrir el portal en una nueva ventana
    const portalWindow = window.open(this.portalUrl, '_blank', 'width=1200,height=800,resizable=yes,scrollbars=yes');
    
    if (!portalWindow) {
      alert('⚠️ No se pudo abrir el portal. El navegador puede estar bloqueando las ventanas emergentes.\n\nPor favor:\n1. Permite ventanas emergentes para este sitio\n2. O copia esta URL manualmente: ' + this.portalUrl);
      return;
    }

    console.log('✅ Ventana del portal abierta correctamente');

    // Función mejorada para intentar el login
    const tryLogin = (): boolean => {
      try {
        console.log('🔐 Intentando login automático...');
        
        // Verificar si la ventana sigue abierta
        if (portalWindow.closed) {
          console.log('❌ La ventana del portal fue cerrada');
          return true; // Terminar intentos
        }

        const doc = portalWindow.document;
        
        // Buscar los campos del formulario
        const companyField = doc.querySelector('input[name="companyID"]') as HTMLInputElement;
        const userField = doc.querySelector('input[name="usuario"]') as HTMLInputElement;
        const passwordField = doc.querySelector('input[name="password"]') as HTMLInputElement;
        const loginButton = doc.querySelector('.opLogonStandardButton') as HTMLElement;

        console.log('🔍 Campos encontrados:', {
          companyField: !!companyField,
          userField: !!userField,
          passwordField: !!passwordField,
          loginButton: !!loginButton
        });

        if (companyField && userField && passwordField && loginButton) {
          console.log('📝 Rellenando campos de login...');
          
          // Limpiar campos primero
          companyField.value = '';
          userField.value = '';
          passwordField.value = '';
          
          // Rellenar con los datos del usuario
          companyField.value = user.companyID;
          userField.value = user.username;
          passwordField.value = user.password;
          
          // Disparar eventos de cambio para asegurar que se registren
          companyField.dispatchEvent(new Event('input', { bubbles: true }));
          userField.dispatchEvent(new Event('input', { bubbles: true }));
          passwordField.dispatchEvent(new Event('input', { bubbles: true }));
          
          console.log('🎯 Haciendo clic en el botón de login...');
          
          // Hacer clic en el botón de login
          setTimeout(() => {
            loginButton.click();
            console.log('✅ Login automático completado');
          }, 500);
          
          return true;
        } else {
          console.log('⏳ Campos de login aún no disponibles, reintentando...');
          return false;
        }
      } catch (error) {
        console.log('🔒 Error de acceso cross-origin (normal):', error);
        // Este error es normal cuando la página está en otro dominio
        return false;
      }
    };

    // Estrategia de múltiples intentos
    let attempts = 0;
    const maxAttempts = 30; // 15 segundos total
    
    const loginInterval = setInterval(() => {
      attempts++;
      console.log(`🔄 Intento ${attempts}/${maxAttempts} de login automático`);
      
      if (portalWindow.closed) {
        console.log('🚪 Ventana cerrada por el usuario');
        clearInterval(loginInterval);
        return;
      }
      
      if (tryLogin() || attempts >= maxAttempts) {
        clearInterval(loginInterval);
        if (attempts >= maxAttempts) {
          console.log('⏰ Se agotaron los intentos de login automático');
          this.showManualLoginInstructions(user);
        }
      }
    }, 500);

    // También intentar inmediatamente
    setTimeout(() => tryLogin(), 1000);
  }

  private showManualLoginInstructions(user: User) {
    const instructions = `
🔐 Login Manual Requerido

No se pudo realizar el login automático. 
Por favor, introduce manualmente estos datos:

Company ID: ${user.companyID}
Usuario: ${user.username}
Contraseña: ${user.password}
    `;
    
    alert(instructions);
  }

  private showLoginConfirmation(userName: string) {
    // Crear elemento de notificación temporal
    const notification = document.createElement('div');
    notification.className = 'login-notification';
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">🚀</span>
        <span class="notification-text">Abriendo portal con usuario: ${userName}</span>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animar entrada
    gsap.fromTo(notification, 
      { opacity: 0, y: -50 }, 
      { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }
    );
    
    // Remover después de 3 segundos
    setTimeout(() => {
      gsap.to(notification, {
        opacity: 0,
        y: -50,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: () => {
          document.body.removeChild(notification);
        }
      });
    }, 3000);
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

  private showAutoLoginInstructions(script: string, userName: string, environment: string) {
    const envName = environment === 'local-dev' ? 'LOCAL' : environment.toUpperCase();
    
    // Copiar el script al portapapeles automáticamente
    navigator.clipboard.writeText(script).then(() => {
      console.log('✅ Script copiado al portapapeles');
    }).catch((err) => {
      console.warn('⚠️ No se pudo copiar automáticamente:', err);
    });
    
    // Crear ventana de instrucciones
    setTimeout(() => {
      const instructionWindow = window.open('', '_blank', 'width=700,height=500');
      if (instructionWindow) {
        instructionWindow.document.write(`
          <html>
            <head>
              <title>Auto-Login - ${userName}</title>
              <style>
                body { 
                  font-family: 'Segoe UI', Arial, sans-serif; 
                  padding: 20px; 
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  line-height: 1.6;
                  margin: 0;
                }
                .container { 
                  max-width: 650px; 
                  margin: 0 auto; 
                  background: white; 
                  padding: 30px; 
                  border-radius: 15px; 
                  box-shadow: 0 10px 40px rgba(0,0,0,0.2); 
                }
                .header {
                  text-align: center;
                  margin-bottom: 25px;
                  padding-bottom: 20px;
                  border-bottom: 2px solid #f0f0f0;
                }
                .header h2 {
                  color: #333;
                  margin: 0 0 10px 0;
                }
                .status { 
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  padding: 20px; 
                  border-radius: 10px; 
                  margin: 20px 0; 
                  text-align: center;
                  font-size: 15px;
                  line-height: 1.8;
                }
                .btn { 
                  background: #667eea;
                  color: white; 
                  border: none; 
                  padding: 12px 24px; 
                  border-radius: 8px; 
                  cursor: pointer; 
                  margin: 5px; 
                  font-size: 14px;
                  font-weight: 600;
                  transition: all 0.3s ease;
                }
                .btn:hover { 
                  background: #764ba2;
                  transform: translateY(-2px);
                  box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
                }
                .script-box {
                  background: #2d2d2d;
                  color: #f8f8f2;
                  border: 2px solid #667eea;
                  padding: 20px;
                  border-radius: 8px;
                  font-family: 'Consolas', 'Monaco', monospace;
                  margin: 20px 0;
                  font-size: 13px;
                  white-space: pre-wrap;
                  max-height: 200px;
                  overflow-y: auto;
                }
                .steps {
                  background: #f8f9ff;
                  padding: 20px;
                  border-radius: 8px;
                  margin: 20px 0;
                }
                .steps ol {
                  margin: 10px 0;
                  padding-left: 25px;
                }
                .steps li {
                  margin: 8px 0;
                  color: #555;
                }
                .badge {
                  display: inline-block;
                  background: #667eea;
                  color: white;
                  padding: 4px 12px;
                  border-radius: 12px;
                  font-size: 12px;
                  font-weight: 600;
                  margin-left: 10px;
                }
                .footer {
                  text-align: center;
                  margin-top: 25px;
                  padding-top: 20px;
                  border-top: 2px solid #f0f0f0;
                  color: #666;
                  font-size: 13px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h2>🚀 Auto-Login Activado</h2>
                  <p>${userName} <span class="badge">${envName}</span></p>
                </div>
                
                <div class="status">
                  ✅ Navegador abierto correctamente<br>
                  📋 Script copiado al portapapeles<br>
                  🎯 Sigue las instrucciones para completar el login
                </div>
                
                <div class="steps">
                  <h3 style="margin-top:0; color:#333;">📍 Instrucciones:</h3>
                  <ol>
                    <li>Ve a la pestaña del portal que se abrió</li>
                    <li>Presiona <strong>F12</strong> para abrir DevTools</li>
                    <li>Ve a la pestaña <strong>Console</strong></li>
                    <li>Pega el script (Ctrl+V) y presiona <strong>Enter</strong></li>
                    <li>¡El login se completará automáticamente! ✨</li>
                  </ol>
                </div>
                
                <h3 style="color:#333;">📝 Script (ya copiado):</h3>
                <div class="script-box">${script.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                
                <div style="text-align: center;">
                  <button class="btn" onclick="copyAgain()">📋 Copiar de nuevo</button>
                  <button class="btn" onclick="window.close()">✖️ Cerrar</button>
                </div>
                
                <div class="footer">
                  Esta ventana se cerrará automáticamente en 3 minutos
                </div>
              </div>
              
              <script>
                function copyAgain() {
                  const script = \`${script.replace(/`/g, '\\`')}\`;
                  
                  navigator.clipboard.writeText(script).then(() => {
                    alert('✅ Script copiado! Pégalo en la consola del portal (F12)');
                  }).catch(() => {
                    prompt('Copia este script:', script);
                  });
                }
                
                // Auto-cerrar después de 3 minutos
                setTimeout(() => {
                  window.close();
                }, 180000);
              </script>
            </body>
          </html>
        `);
      } else {
        // Fallback si no se puede abrir ventana
        alert(`✅ Navegador abierto para ${userName}

📋 Script copiado al portapapeles

📍 INSTRUCCIONES:
1. Ve a la pestaña del portal
2. Presiona F12 (DevTools)
3. Ve a "Console"
4. Pega el script (Ctrl+V)
5. Presiona Enter

¡El login se completará automáticamente!`);
      }
    }, 500);
  }
}
