// Nuevo handler de autologin mejorado
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { shell } = require("electron");

// Función mejorada de autologin que no depende de CDP
async function handlePortalAutoLogin(loginData) {
  // Extraer datos del usuario de la estructura anidada
  const userData = loginData.user || {};
  console.log('🌐 Abriendo portal para:', userData.name || 'Usuario desconocido');
  
  try {
    // URL correcta del portal
    const portalUrl = loginData.url || 'http://localhost:8080/GBMSGF_ESCE/BtoChannelDriver.ssobto?dse_parentContextName=&dse_processorState=initial&dse_nextEventName=start&dse_operationName=inicio';
    
    console.log('📊 Datos extraídos:', {
      name: userData.name,
      companyID: userData.companyID,
      username: userData.username,
      password: userData.password ? '[PRESENTE]' : '[AUSENTE]',
      environment: userData.environment || 'local'
    });
    
    // Detectar Chrome específicamente
    const platform = os.platform();
    let chromePath = '';
    
    if (platform === 'win32') {
      // Windows - buscar Chrome en ubicaciones típicas
      const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
      ];
      
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          chromePath = possiblePath;
          console.log('✅ Chrome encontrado en:', chromePath);
          break;
        }
      }
    } else if (platform === 'darwin') {
      // macOS
      chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
      // Linux
      chromePath = 'google-chrome';
    }

    if (chromePath && fs.existsSync(chromePath)) {
      console.log('🚀 Iniciando Chrome con estrategia mejorada...');
      
      // NUEVA ESTRATEGIA: Crear archivo HTML temporal con autologin
      const tempDir = path.join(os.tmpdir(), 'chrome-autologin-launcher');
      
      // Crear directorio temporal si no existe
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Generar script de autologin según el entorno
      let autoLoginScript = '';
      const environment = userData.environment || 'local-dev';
      
      if (environment === 'local-dev') {
        const isLocalUrl = portalUrl.includes('localhost:8080');
        
        if (isLocalUrl) {
          // Script para LOCAL
          autoLoginScript = `
            console.log('🏠 Ejecutando autologin para LOCAL');
            
            function fillLoginFieldsLocal() {
              try {
                const companyField = document.getElementsByName('companyID')[0];
                const userField = document.getElementsByName('usuario')[0];
                const passwordField = document.getElementsByName('password')[0];
                const loginButton = document.querySelector('.opLogonStandardButton');
                
                console.log('🔍 Campos encontrados:', {
                  company: !!companyField,
                  user: !!userField,
                  password: !!passwordField,
                  button: !!loginButton
                });
                
                if (companyField && userField && passwordField && loginButton) {
                  companyField.value = '${userData.companyID || ''}';
                  userField.value = '${userData.username || ''}';
                  passwordField.value = '${userData.password || ''}';
                  
                  // Disparar eventos
                  companyField.dispatchEvent(new Event('input', { bubbles: true }));
                  userField.dispatchEvent(new Event('input', { bubbles: true }));
                  passwordField.dispatchEvent(new Event('input', { bubbles: true }));
                  
                  setTimeout(() => {
                    loginButton.click();
                    console.log('✅ Login automático LOCAL ejecutado');
                  }, 500);
                  
                  return true;
                }
                return false;
              } catch (error) {
                console.error('❌ Error en autologin LOCAL:', error);
                return false;
              }
            }
            
            // Intentar llenar campos inmediatamente y con intervalos
            if (document.readyState === 'complete') {
              fillLoginFieldsLocal();
            } else {
              window.addEventListener('load', fillLoginFieldsLocal);
            }
            
            // Reintentar cada segundo durante 10 segundos
            let attempts = 0;
            const maxAttempts = 10;
            const interval = setInterval(() => {
              attempts++;
              if (fillLoginFieldsLocal() || attempts >= maxAttempts) {
                clearInterval(interval);
              }
            }, 1000);
          `;
        } else {
          // Script para DEV
          const grupoEmpresarial = userData.companyID || 'SCNP';
          autoLoginScript = `
            console.log('🔧 Ejecutando autologin para DEV');
            
            function fillLoginFieldsDev() {
              try {
                let groupField = document.querySelector('#txt_group input');
                let userField = document.querySelector('#txt_usuario input');
                let passwordField = document.querySelector('#txt_pass input');
                let loginButton = document.querySelector('#btn_entrar');
                
                // Búsqueda alternativa de campos
                if (!groupField || !userField || !passwordField) {
                  const allInputs = Array.from(document.querySelectorAll('input'));
                  const textInputs = allInputs.filter(input => 
                    input.type === 'text' || input.type === '' || !input.type
                  );
                  const passwordInputs = allInputs.filter(input => input.type === 'password');
                  
                  if (!groupField && textInputs.length >= 1) groupField = textInputs[0];
                  if (!userField && textInputs.length >= 2) userField = textInputs[1];
                  if (!passwordField && passwordInputs.length >= 1) passwordField = passwordInputs[0];
                }
                
                // Búsqueda alternativa de botón
                if (!loginButton) {
                  const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                  for (const btn of allButtons) {
                    const text = btn.textContent?.toLowerCase() || '';
                    const id = btn.id?.toLowerCase() || '';
                    if (text.includes('entrar') || text.includes('login') || id.includes('entrar')) {
                      loginButton = btn;
                      break;
                    }
                  }
                }
                
                console.log('🔍 Campos DEV encontrados:', {
                  group: !!groupField,
                  user: !!userField,
                  password: !!passwordField,
                  button: !!loginButton
                });
                
                if (groupField && userField && passwordField && loginButton) {
                  groupField.value = '${grupoEmpresarial}';
                  userField.value = '${userData.username || ''}';
                  passwordField.value = '${userData.password || ''}';
                  
                  // Disparar eventos
                  groupField.dispatchEvent(new Event('input', { bubbles: true }));
                  userField.dispatchEvent(new Event('input', { bubbles: true }));
                  passwordField.dispatchEvent(new Event('input', { bubbles: true }));
                  
                  setTimeout(() => {
                    loginButton.click();
                    console.log('✅ Login automático DEV ejecutado');
                  }, 1000);
                  
                  return true;
                }
                return false;
              } catch (error) {
                console.error('❌ Error en autologin DEV:', error);
                return false;
              }
            }
            
            // Estrategia de múltiples intentos para DEV
            if (document.readyState === 'complete') {
              fillLoginFieldsDev();
            } else {
              window.addEventListener('load', () => {
                setTimeout(fillLoginFieldsDev, 1000);
              });
            }
            
            let attempts = 0;
            const maxAttempts = 15;
            const interval = setInterval(() => {
              attempts++;
              if (fillLoginFieldsDev() || attempts >= maxAttempts) {
                clearInterval(interval);
              }
            }, 1000);
          `;
        }
      } else if (environment === 'pre') {
        // Script para PRE (similar a DEV)
        const grupoEmpresarial = userData.companyID || 'SCNP';
        autoLoginScript = `
          console.log('🧪 Ejecutando autologin para PRE');
          
          function fillLoginFieldsPre() {
            try {
              let groupField = document.querySelector('#txt_group input');
              let userField = document.querySelector('#txt_usuario input');
              let passwordField = document.querySelector('#txt_pass input');
              let loginButton = document.querySelector('#btn_entrar');
              
              // Búsqueda alternativa de campos (igual que DEV)
              if (!groupField || !userField || !passwordField) {
                const allInputs = Array.from(document.querySelectorAll('input'));
                const textInputs = allInputs.filter(input => 
                  input.type === 'text' || input.type === '' || !input.type
                );
                const passwordInputs = allInputs.filter(input => input.type === 'password');
                
                if (!groupField && textInputs.length >= 1) groupField = textInputs[0];
                if (!userField && textInputs.length >= 2) userField = textInputs[1];
                if (!passwordField && passwordInputs.length >= 1) passwordField = passwordInputs[0];
              }
              
              if (!loginButton) {
                const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                for (const btn of allButtons) {
                  const text = btn.textContent?.toLowerCase() || '';
                  const id = btn.id?.toLowerCase() || '';
                  if (text.includes('entrar') || text.includes('login') || id.includes('entrar')) {
                    loginButton = btn;
                    break;
                  }
                }
              }
              
              console.log('🔍 Campos PRE encontrados:', {
                group: !!groupField,
                user: !!userField,
                password: !!passwordField,
                button: !!loginButton
              });
              
              if (groupField && userField && passwordField && loginButton) {
                groupField.value = '${grupoEmpresarial}';
                userField.value = '${userData.username || ''}';
                passwordField.value = '${userData.password || ''}';
                
                // Disparar eventos
                groupField.dispatchEvent(new Event('input', { bubbles: true }));
                userField.dispatchEvent(new Event('input', { bubbles: true }));
                passwordField.dispatchEvent(new Event('input', { bubbles: true }));
                
                setTimeout(() => {
                  loginButton.click();
                  console.log('✅ Login automático PRE ejecutado');
                }, 1000);
                
                return true;
              }
              return false;
            } catch (error) {
              console.error('❌ Error en autologin PRE:', error);
              return false;
            }
          }
          
          // Estrategia de múltiples intentos para PRE
          if (document.readyState === 'complete') {
            fillLoginFieldsPre();
          } else {
            window.addEventListener('load', () => {
              setTimeout(fillLoginFieldsPre, 1000);
            });
          }
          
          let attempts = 0;
          const maxAttempts = 15;
          const interval = setInterval(() => {
            attempts++;
            if (fillLoginFieldsPre() || attempts >= maxAttempts) {
              clearInterval(interval);
            }
          }, 1000);
        `;
      }
      
      // Crear archivo HTML de redirección con autologin
      const redirectHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Autologin - ${userData.name || 'Usuario'}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            text-align: center;
            background: rgba(255,255,255,0.1);
            padding: 2rem;
            border-radius: 10px;
            backdrop-filter: blur(10px);
        }
        .spinner {
            border: 4px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top: 4px solid white;
            width: 40px;
            height: 40px;
            animation: spin 2s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .user-info {
            background: rgba(255,255,255,0.1);
            padding: 1rem;
            border-radius: 5px;
            margin-top: 20px;
            text-align: left;
        }
        .countdown {
            font-size: 24px;
            font-weight: bold;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h2>🚀 Iniciando Autologin</h2>
        <p>Redirigiendo al portal para: <strong>${userData.name || 'Usuario'}</strong></p>
        <p>Entorno: <strong>${environment.toUpperCase()}</strong></p>
        <div class="countdown" id="countdown">3</div>
        <p>Cerrando automáticamente...</p>
        
        <div class="user-info">
            <strong>📋 Datos de login:</strong><br>
            Company: ${userData.companyID || 'N/A'}<br>
            Usuario: ${userData.username || 'N/A'}<br>
            Contraseña: ${userData.password ? '[CONFIGURADA]' : '[NO CONFIGURADA]'}
        </div>
    </div>

    <script>
        let countdown = 3;
        const countdownEl = document.getElementById('countdown');
        
        const timer = setInterval(() => {
            countdown--;
            countdownEl.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(timer);
                // Redirigir al portal
                window.location.href = '${portalUrl}';
            }
        }, 1000);
        
        // Inyectar script de autologin cuando llegue al portal
        window.addEventListener('load', () => {
            // Detectar cuando estemos en el portal
            setTimeout(() => {
                if (window.location.href.includes('${portalUrl.split('?')[0]}')) {
                  // Estamos en el portal, ejecutar autologin
                  ${autoLoginScript}
                }
            }, 2000);
        });
        
        // También inyectar después del redirect
        setTimeout(() => {
            ${autoLoginScript}
        }, 5000);
    </script>
</body>
</html>
      `;
      
      const tempHtmlPath = path.join(tempDir, `autologin_${Date.now()}.html`);
      fs.writeFileSync(tempHtmlPath, redirectHtml, 'utf8');
      
      console.log('📄 Archivo temporal creado:', tempHtmlPath);
      
      // Abrir Chrome con el archivo temporal
      const chromeArgs = [
        '--new-window',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--allow-running-insecure-content',
        `file://${tempHtmlPath.replace(/\\/g, '/')}`
      ];

      console.log('🚀 Abriendo Chrome con autologin mejorado');
      console.log('📋 Argumentos:', chromeArgs.join(' '));

      const chromeProcess = spawn(chromePath, chromeArgs, {
        detached: true,
        stdio: 'ignore'
      });

      chromeProcess.unref();
      
      // Limpiar archivo temporal después de 30 segundos
      setTimeout(() => {
        try {
          if (fs.existsSync(tempHtmlPath)) {
            fs.unlinkSync(tempHtmlPath);
            console.log('🧹 Archivo temporal limpiado');
          }
        } catch (cleanupError) {
          console.log('⚠️ No se pudo limpiar archivo temporal:', cleanupError.message);
        }
      }, 30000);
      
      console.log('✅ Chrome abierto con nueva estrategia de autologin');
      return {
        success: true,
        message: 'Chrome abierto con autologin mejorado para ' + (userData.name || 'usuario') + '. El login se realizará automáticamente.'
      };
      
    } else {
      // Fallback: usar navegador por defecto si Chrome no se encuentra
      await shell.openExternal(portalUrl);
      
      return { 
        success: true, 
        message: "Portal abierto en navegador por defecto para " + (userData.name || 'usuario') + ".\n\nDatos para login manual:\nCompany: " + (userData.companyID || 'N/A') + "\nUsuario: " + (userData.username || 'N/A') + "\nContraseña: " + (userData.password || 'N/A')
      };
    }
    
  } catch (error) {
    console.error('❌ Error al abrir portal:', error);
    return { 
      success: false, 
      message: 'Error al abrir el portal: ' + error.message 
    };
  }
}

module.exports = { handlePortalAutoLogin };