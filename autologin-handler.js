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
                // Buscar campos usando los selectores correctos basados en el HTML real
                let groupField = document.querySelector('#txt_group input[type="text"]');
                let userField = document.querySelector('#txt_usuario input[type="text"]');
                let passwordField = document.querySelector('#txt_pass input[type="password"]');
                let loginButton = document.querySelector('#btn_entrar') || document.querySelector('label[for="bt_entrar"]');
                
                // Búsqueda alternativa más específica si no funcionan los selectores principales
                if (!groupField) {
                  const groupContainer = document.querySelector('#txt_group');
                  if (groupContainer) groupField = groupContainer.querySelector('input[placeholder*="Grupo"], input[placeholder*="grupo"]');
                }
                
                if (!userField) {
                  const userContainer = document.querySelector('#txt_usuario');
                  if (userContainer) userField = userContainer.querySelector('input[placeholder*="Usuario"], input[placeholder*="usuario"]');
                }
                
                if (!passwordField) {
                  const passContainer = document.querySelector('#txt_pass');
                  if (passContainer) passwordField = passContainer.querySelector('input[type="password"], input[placeholder*="Contraseña"], input[placeholder*="contraseña"]');
                }
                
                // Búsqueda alternativa por posición si aún no encontramos campos
                if (!groupField || !userField || !passwordField) {
                  console.log('🔄 Buscando campos por posición y tipo...');
                  const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="password"]'));
                  const textInputs = allInputs.filter(input => 
                    input.type === 'text' && !input.placeholder.toLowerCase().includes('token')
                  );
                  const passwordInputs = allInputs.filter(input => input.type === 'password');
                  
                  if (!groupField && textInputs.length >= 1) groupField = textInputs[0];
                  if (!userField && textInputs.length >= 2) userField = textInputs[1];
                  if (!passwordField && passwordInputs.length >= 1) passwordField = passwordInputs[0];
                }
                
                // Buscar botón de login de manera más específica
                if (!loginButton) {
                  console.log('🔄 Buscando botón de login...');
                  // Primero buscar el label específico
                  loginButton = document.querySelector('label[id="btn_entrar"], label.lab_entrar');
                  
                  if (!loginButton) {
                    // Luego buscar el div contenedor
                    const buttonContainer = document.querySelector('.bt_entrar');
                    if (buttonContainer) loginButton = buttonContainer;
                  }
                  
                  if (!loginButton) {
                    // Búsqueda general de botones
                    const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], label, div[class*="entrar"]'));
                    for (const btn of allButtons) {
                      const text = btn.textContent?.toLowerCase() || '';
                      const id = btn.id?.toLowerCase() || '';
                      const className = btn.className?.toLowerCase() || '';
                      if (text.includes('login') || text.includes('entrar') || id.includes('entrar') || className.includes('entrar')) {
                        loginButton = btn;
                        break;
                      }
                    }
                  }
                }
                
                console.log('🔍 Campos DEV encontrados:', {
                  group: !!groupField,
                  user: !!userField,
                  password: !!passwordField,
                  button: !!loginButton,
                  groupSelector: groupField ? groupField.outerHTML.substring(0, 100) : 'No encontrado',
                  userSelector: userField ? userField.outerHTML.substring(0, 100) : 'No encontrado',
                  passwordSelector: passwordField ? passwordField.outerHTML.substring(0, 100) : 'No encontrado',
                  buttonSelector: loginButton ? loginButton.outerHTML.substring(0, 100) : 'No encontrado'
                });
                
                if (groupField && userField && passwordField && loginButton) {
                  // Limpiar campos primero
                  groupField.value = '';
                  userField.value = '';
                  passwordField.value = '';
                  
                  // Llenar con los datos
                  groupField.value = '${grupoEmpresarial}';
                  userField.value = '${userData.username || ''}';
                  passwordField.value = '${userData.password || ''}';
                  
                  // Disparar eventos para notificar a Angular
                  const events = ['input', 'change', 'blur', 'keyup'];
                  events.forEach(eventType => {
                    groupField.dispatchEvent(new Event(eventType, { bubbles: true }));
                    userField.dispatchEvent(new Event(eventType, { bubbles: true }));
                    passwordField.dispatchEvent(new Event(eventType, { bubbles: true }));
                  });
                  
                  // Verificar que los valores se establecieron
                  console.log('📝 Valores establecidos:', {
                    grupo: groupField.value,
                    usuario: userField.value,
                    password: passwordField.value ? '[ESTABLECIDA]' : '[NO ESTABLECIDA]'
                  });
                  
                  setTimeout(() => {
                    // Intentar hacer click en el botón
                    if (loginButton.click) {
                      loginButton.click();
                    } else {
                      // Si es un elemento que no tiene click, buscar el div padre
                      const parentButton = loginButton.closest('.bt_entrar') || loginButton.parentElement;
                      if (parentButton && parentButton.click) {
                        parentButton.click();
                      } else {
                        // Disparar evento de click manualmente
                        loginButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                      }
                    }
                    console.log('✅ Login automático DEV ejecutado');
                  }, 1500);
                  
                  return true;
                } else {
                  console.log('❌ No se pueden llenar todos los campos DEV');
                  console.log('Faltantes:', {
                    group: !groupField,
                    user: !userField,
                    password: !passwordField,
                    button: !loginButton
                  });
                  return false;
                }
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
              // Buscar campos usando los selectores correctos basados en el HTML real
              let groupField = document.querySelector('#txt_group input[type="text"]');
              let userField = document.querySelector('#txt_usuario input[type="text"]');
              let passwordField = document.querySelector('#txt_pass input[type="password"]');
              let loginButton = document.querySelector('#btn_entrar') || document.querySelector('label[for="bt_entrar"]');
              
              // Búsqueda alternativa más específica si no funcionan los selectores principales
              if (!groupField) {
                const groupContainer = document.querySelector('#txt_group');
                if (groupContainer) groupField = groupContainer.querySelector('input[placeholder*="Grupo"], input[placeholder*="grupo"]');
              }
              
              if (!userField) {
                const userContainer = document.querySelector('#txt_usuario');
                if (userContainer) userField = userContainer.querySelector('input[placeholder*="Usuario"], input[placeholder*="usuario"]');
              }
              
              if (!passwordField) {
                const passContainer = document.querySelector('#txt_pass');
                if (passContainer) passwordField = passContainer.querySelector('input[type="password"], input[placeholder*="Contraseña"], input[placeholder*="contraseña"]');
              }
              
              // Búsqueda alternativa por posición si aún no encontramos campos
              if (!groupField || !userField || !passwordField) {
                console.log('🔄 Buscando campos por posición y tipo...');
                const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="password"]'));
                const textInputs = allInputs.filter(input => 
                  input.type === 'text' && !input.placeholder.toLowerCase().includes('token')
                );
                const passwordInputs = allInputs.filter(input => input.type === 'password');
                
                if (!groupField && textInputs.length >= 1) groupField = textInputs[0];
                if (!userField && textInputs.length >= 2) userField = textInputs[1];
                if (!passwordField && passwordInputs.length >= 1) passwordField = passwordInputs[0];
              }
              
              // Buscar botón de login de manera más específica
              if (!loginButton) {
                console.log('🔄 Buscando botón de login...');
                // Primero buscar el label específico
                loginButton = document.querySelector('label[id="btn_entrar"], label.lab_entrar');
                
                if (!loginButton) {
                  // Luego buscar el div contenedor
                  const buttonContainer = document.querySelector('.bt_entrar');
                  if (buttonContainer) loginButton = buttonContainer;
                }
                
                if (!loginButton) {
                  // Búsqueda general de botones
                  const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], label, div[class*="entrar"]'));
                  for (const btn of allButtons) {
                    const text = btn.textContent?.toLowerCase() || '';
                    const id = btn.id?.toLowerCase() || '';
                    const className = btn.className?.toLowerCase() || '';
                    if (text.includes('login') || text.includes('entrar') || id.includes('entrar') || className.includes('entrar')) {
                      loginButton = btn;
                      break;
                    }
                  }
                }
              }
              
              console.log('🔍 Campos PRE encontrados:', {
                group: !!groupField,
                user: !!userField,
                password: !!passwordField,
                button: !!loginButton,
                groupSelector: groupField ? groupField.outerHTML.substring(0, 100) : 'No encontrado',
                userSelector: userField ? userField.outerHTML.substring(0, 100) : 'No encontrado',
                passwordSelector: passwordField ? passwordField.outerHTML.substring(0, 100) : 'No encontrado',
                buttonSelector: loginButton ? loginButton.outerHTML.substring(0, 100) : 'No encontrado'
              });
              
              if (groupField && userField && passwordField && loginButton) {
                // Limpiar campos primero
                groupField.value = '';
                userField.value = '';
                passwordField.value = '';
                
                // Llenar con los datos
                groupField.value = '${grupoEmpresarial}';
                userField.value = '${userData.username || ''}';
                passwordField.value = '${userData.password || ''}';
                
                // Disparar eventos para notificar a Angular
                const events = ['input', 'change', 'blur', 'keyup'];
                events.forEach(eventType => {
                  groupField.dispatchEvent(new Event(eventType, { bubbles: true }));
                  userField.dispatchEvent(new Event(eventType, { bubbles: true }));
                  passwordField.dispatchEvent(new Event(eventType, { bubbles: true }));
                });
                
                // Verificar que los valores se establecieron
                console.log('📝 Valores establecidos:', {
                  grupo: groupField.value,
                  usuario: userField.value,
                  password: passwordField.value ? '[ESTABLECIDA]' : '[NO ESTABLECIDA]'
                });
                
                setTimeout(() => {
                  // Intentar hacer click en el botón
                  if (loginButton.click) {
                    loginButton.click();
                  } else {
                    // Si es un elemento que no tiene click, buscar el div padre
                    const parentButton = loginButton.closest('.bt_entrar') || loginButton.parentElement;
                    if (parentButton && parentButton.click) {
                      parentButton.click();
                    } else {
                      // Disparar evento de click manualmente
                      loginButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    }
                  }
                  console.log('✅ Login automático PRE ejecutado');
                }, 1500);
                
                return true;
              } else {
                console.log('❌ No se pueden llenar todos los campos PRE');
                console.log('Faltantes:', {
                  group: !groupField,
                  user: !userField,
                  password: !passwordField,
                  button: !loginButton
                });
                return false;
              }
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
      
      // NUEVA ESTRATEGIA: Redirección directa con script en localStorage
      const scriptData = {
        environment: environment,
        groupValue: userData.companyID || 'SCNP',
        userValue: userData.username || '',
        passwordValue: userData.password || '',
        userName: userData.name || 'Usuario'
      };
      
      // Crear archivo HTML que redirige inmediatamente y ejecuta el script
      const redirectHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Autologin - ${userData.name || 'Usuario'}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }
        .container {
            text-align: center;
            background: rgba(255,255,255,0.1);
            padding: 2rem;
            border-radius: 10px;
            backdrop-filter: blur(10px);
            max-width: 600px;
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
        .countdown {
            font-size: 48px;
            font-weight: bold;
            margin: 20px 0;
        }
        .info {
            background: rgba(255,255,255,0.1);
            padding: 1rem;
            border-radius: 5px;
            margin: 20px 0;
            text-align: left;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h1>🚀 Autologin Activado</h1>
        <p><strong>Usuario:</strong> ${userData.name || 'Usuario'}</p>
        <p><strong>Entorno:</strong> ${environment.toUpperCase()}</p>
        
        <div class="countdown" id="countdown">3</div>
        <p>Redirigiendo al portal...</p>
        
        <div class="info">
            <strong>📋 Datos configurados:</strong><br>
            Company: ${userData.companyID || 'N/A'}<br>
            Usuario: ${userData.username || 'N/A'}<br>
            Contraseña: ${userData.password ? '[CONFIGURADA]' : '[NO CONFIGURADA]'}
        </div>
        
        <div style="font-size: 14px; margin-top: 20px;">
            <p>⚡ El autologin se ejecutará automáticamente</p>
            <p>📱 Si no funciona, los datos aparecerán en la consola</p>
            <button onclick="executeManualAutologin()" style="
                background: rgba(255,255,255,0.2);
                border: 2px solid white;
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
                margin-top: 10px;
            ">🔧 Ejecutar Autologin Manual</button>
        </div>
    </div>

    <script>
        // Guardar datos de autologin en localStorage
        const autologinData = ${JSON.stringify(scriptData)};
        localStorage.setItem('autologin_data', JSON.stringify(autologinData));
        localStorage.setItem('autologin_timestamp', Date.now().toString());
        
        console.log('💾 Datos de autologin guardados:', autologinData);
        
        let countdown = 3;
        const countdownEl = document.getElementById('countdown');
        
        const timer = setInterval(() => {
            countdown--;
            countdownEl.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(timer);
                console.log('🌐 Redirigiendo al portal...');
                // Redirigir directamente al portal
                window.location.href = '${portalUrl}';
            }
        }, 1000);
        
        // Script de autologin completo que se ejecutará en el portal
        const portalScript = function() {
            console.log('🚀 Script de autologin iniciado en el portal');
            console.log('📍 URL actual:', window.location.href);
            
            // Crear indicador visual de que el script está funcionando
            const indicator = document.createElement('div');
            indicator.id = 'autologin-indicator';
            indicator.style.cssText = \`
                position: fixed;
                top: 10px;
                right: 10px;
                background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
                color: white;
                padding: 10px 15px;
                border-radius: 25px;
                font-family: Arial, sans-serif;
                font-size: 12px;
                font-weight: bold;
                z-index: 99999;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                border: 2px solid white;
            \`;
            indicator.innerHTML = '🚀 AUTOLOGIN ACTIVO';
            document.body.appendChild(indicator);
            
            // Animar el indicador
            let counter = 0;
            const updateIndicator = setInterval(() => {
                counter++;
                indicator.innerHTML = \`🚀 AUTOLOGIN ACTIVO (\${counter})\`;
                if (counter > 20) {
                    clearInterval(updateIndicator);
                    indicator.style.background = '#666';
                    indicator.innerHTML = '⏰ AUTOLOGIN FINALIZADO';
                }
            }, 3000);
            
            // Verificar si tenemos datos de autologin
            const autologinDataStr = localStorage.getItem('autologin_data');
            const timestamp = localStorage.getItem('autologin_timestamp');
            
            if (!autologinDataStr) {
                console.log('❌ No hay datos de autologin');
                return;
            }
            
            // Verificar que los datos no sean muy antiguos (máximo 2 minutos)
            if (Date.now() - parseInt(timestamp) > 120000) {
                console.log('⏰ Datos de autologin expirados');
                localStorage.removeItem('autologin_data');
                localStorage.removeItem('autologin_timestamp');
                return;
            }
            
            const data = JSON.parse(autologinDataStr);
            console.log('📋 Datos de autologin recuperados:', {
                environment: data.environment,
                user: data.userValue,
                hasPassword: !!data.passwordValue
            });
            
            function executeAutologin() {
                try {
                    console.log('🚀 Ejecutando autologin...');
                    console.log('📍 URL actual:', window.location.href);
                    console.log('📋 Datos disponibles:', {
                        environment: data.environment,
                        group: data.groupValue,
                        user: data.userValue,
                        hasPassword: !!data.passwordValue
                    });
                    
                    if (data.environment === 'local-dev' && window.location.href.includes('localhost:8080')) {
                        console.log('🏠 Detectado entorno LOCAL - localhost:8080');
                        
                        // Usar exactamente los mismos selectores que funcionan manualmente
                        const companyField = document.getElementsByName('companyID')[0];
                        const userField = document.getElementsByName('usuario')[0];
                        const passwordField = document.getElementsByName('password')[0];
                        const loginButton = document.querySelector('.opLogonStandardButton');
                        
                        console.log('🔍 Elementos LOCAL encontrados:', {
                            companyField: !!companyField,
                            userField: !!userField,
                            passwordField: !!passwordField,
                            loginButton: !!loginButton
                        });
                        
                        if (companyField && userField && passwordField && loginButton) {
                            console.log('✅ Todos los campos encontrados en LOCAL');
                            
                            // Usar exactamente el mismo código que funciona manualmente
                            companyField.value = data.groupValue;
                            userField.value = data.userValue;
                            passwordField.value = data.passwordValue;
                            
                            console.log('📝 Valores establecidos:', {
                                company: companyField.value,
                                user: userField.value,
                                password: passwordField.value ? '[SET]' : '[EMPTY]'
                            });
                            
                            // Click en el botón
                            setTimeout(() => {
                                loginButton.click();
                                console.log('✅ Login LOCAL ejecutado');
                                
                                // Limpiar datos después del login
                                localStorage.removeItem('autologin_data');
                                localStorage.removeItem('autologin_timestamp');
                            }, 500);
                            
                            return true;
                        } else {
                            console.log('❌ Faltan elementos en LOCAL:', {
                                companyField: !!companyField,
                                userField: !!userField,
                                passwordField: !!passwordField,
                                loginButton: !!loginButton
                            });
                        }
                        
                    } else {
                        console.log('🔧 Detectado entorno DEV/PRE - buscando campos Angular');
                        console.log('📄 HTML completo disponible:', document.documentElement.outerHTML.length + ' caracteres');
                        
                        // Mostrar todos los inputs disponibles para debugging
                        const allInputs = document.querySelectorAll('input');
                        console.log('🔍 TODOS LOS INPUTS ENCONTRADOS (' + allInputs.length + '):');
                        allInputs.forEach((input, index) => {
                            console.log('Input ' + index + ':', {
                                id: input.id,
                                name: input.name,
                                type: input.type,
                                placeholder: input.placeholder,
                                className: input.className,
                                value: input.value,
                                parentId: input.parentElement ? input.parentElement.id : 'sin parent id',
                                parentClass: input.parentElement ? input.parentElement.className : 'sin parent class',
                                html: input.outerHTML
                            });
                        });
                        
                        // Mostrar todos los botones/labels disponibles
                        const allButtons = document.querySelectorAll('button, label, div[onclick], span[onclick]');
                        console.log('🔍 TODOS LOS BOTONES/LABELS ENCONTRADOS (' + allButtons.length + '):');
                        allButtons.forEach((btn, index) => {
                            console.log('Button ' + index + ':', {
                                id: btn.id,
                                className: btn.className,
                                textContent: btn.textContent ? btn.textContent.substring(0, 50) : '',
                                tagName: btn.tagName,
                                onclick: btn.onclick ? 'tiene onclick' : 'sin onclick',
                                html: btn.outerHTML.substring(0, 200)
                            });
                        });
                        
                        // Para DEV/PRE - buscar con múltiples estrategias
                        let groupField, userField, passwordField, loginButton;
                        
                        console.log('🔍 ESTRATEGIA 1: Buscando por IDs directos...');
                        // Estrategia 1: IDs directos
                        groupField = document.querySelector('#txt_group input');
                        userField = document.querySelector('#txt_usuario input');
                        passwordField = document.querySelector('#txt_pass input');
                        loginButton = document.querySelector('#btn_entrar');
                        
                        console.log('Resultados Estrategia 1:', {
                            groupField: !!groupField,
                            userField: !!userField,
                            passwordField: !!passwordField,
                            loginButton: !!loginButton
                        });
                        
                        // Estrategia 2: Si no encuentra por IDs, buscar por contenedores
                        if (!groupField) {
                            console.log('🔍 ESTRATEGIA 2: Buscando grupo por contenedores...');
                            const groupContainer = document.querySelector('div[id*="group"], div[id*="grupo"], div[id*="txt_group"]');
                            console.log('Contenedor grupo encontrado:', groupContainer ? groupContainer.outerHTML.substring(0, 200) : 'No encontrado');
                            if (groupContainer) {
                                groupField = groupContainer.querySelector('input');
                                console.log('Input en contenedor grupo:', groupField ? groupField.outerHTML : 'No encontrado');
                            }
                        }
                        
                        if (!userField) {
                            console.log('🔍 ESTRATEGIA 2: Buscando usuario por contenedores...');
                            const userContainer = document.querySelector('div[id*="usuario"], div[id*="user"], div[id*="txt_usuario"]');
                            console.log('Contenedor usuario encontrado:', userContainer ? userContainer.outerHTML.substring(0, 200) : 'No encontrado');
                            if (userContainer) {
                                userField = userContainer.querySelector('input');
                                console.log('Input en contenedor usuario:', userField ? userField.outerHTML : 'No encontrado');
                            }
                        }
                        
                        if (!passwordField) {
                            console.log('🔍 ESTRATEGIA 2: Buscando password por contenedores...');
                            const passContainer = document.querySelector('div[id*="pass"], div[id*="password"], div[id*="txt_pass"]');
                            console.log('Contenedor password encontrado:', passContainer ? passContainer.outerHTML.substring(0, 200) : 'No encontrado');
                            if (passContainer) {
                                passwordField = passContainer.querySelector('input');
                                console.log('Input en contenedor password:', passwordField ? passwordField.outerHTML : 'No encontrado');
                            }
                        }
                        
                        // Estrategia 3: Por placeholders si aún no se encuentran
                        if (!groupField) {
                            console.log('🔍 ESTRATEGIA 3: Buscando grupo por placeholders...');
                            groupField = document.querySelector('input[placeholder*="grupo"], input[placeholder*="Grupo"], input[placeholder*="Group"], input[placeholder*="company"], input[placeholder*="Company"]');
                            console.log('Grupo por placeholder:', groupField ? groupField.outerHTML : 'No encontrado');
                        }
                        if (!userField) {
                            console.log('🔍 ESTRATEGIA 3: Buscando usuario por placeholders...');
                            userField = document.querySelector('input[placeholder*="usuario"], input[placeholder*="Usuario"], input[placeholder*="User"], input[placeholder*="user"]');
                            console.log('Usuario por placeholder:', userField ? userField.outerHTML : 'No encontrado');
                        }
                        if (!passwordField) {
                            console.log('🔍 ESTRATEGIA 3: Buscando password por tipo...');
                            passwordField = document.querySelector('input[type="password"]');
                            console.log('Password por tipo:', passwordField ? passwordField.outerHTML : 'No encontrado');
                        }
                        
                        // Estrategia 4: Buscar por índices si nada funciona
                        if (!groupField && allInputs.length >= 1) {
                            console.log('🔍 ESTRATEGIA 4: Usando primer input como grupo...');
                            groupField = allInputs[0];
                        }
                        if (!userField && allInputs.length >= 2) {
                            console.log('🔍 ESTRATEGIA 4: Usando segundo input como usuario...');
                            userField = allInputs[1];
                        }
                        if (!passwordField && allInputs.length >= 3) {
                            console.log('🔍 ESTRATEGIA 4: Usando tercer input como password...');
                            passwordField = allInputs[2];
                        }
                        
                        // Estrategia 5: Buscar botón por texto o clases
                        if (!loginButton) {
                            console.log('🔍 ESTRATEGIA 5: Buscando botón de login...');
                            loginButton = document.querySelector('label[id="btn_entrar"], .lab_entrar, .bt_entrar');
                            console.log('Botón por clase:', loginButton ? loginButton.outerHTML.substring(0, 100) : 'No encontrado');
                            
                            if (!loginButton) {
                                console.log('🔍 Buscando botón por texto "Entrar"...');
                                const buttons = document.querySelectorAll('button, label, div, span');
                                for (let btn of buttons) {
                                    if (btn.textContent && btn.textContent.toLowerCase().includes('entrar')) {
                                        loginButton = btn;
                                        console.log('Botón encontrado por texto:', btn.outerHTML.substring(0, 100));
                                        break;
                                    }
                                }
                            }
                            
                            // Si aún no encuentra, usar el primer botón/label disponible
                            if (!loginButton && allButtons.length > 0) {
                                console.log('🔍 Usando primer botón disponible...');
                                loginButton = allButtons[0];
                            }
                        }
                        
                        console.log('🔍 Elementos DEV/PRE encontrados:', {
                            groupField: !!groupField,
                            userField: !!userField,
                            passwordField: !!passwordField,
                            loginButton: !!loginButton,
                            groupHTML: groupField ? groupField.outerHTML.substring(0, 100) : 'No encontrado',
                            userHTML: userField ? userField.outerHTML.substring(0, 100) : 'No encontrado',
                            passHTML: passwordField ? passwordField.outerHTML.substring(0, 100) : 'No encontrado',
                            buttonHTML: loginButton ? loginButton.outerHTML.substring(0, 100) : 'No encontrado'
                        });
                        
                        if (groupField && userField && passwordField) {
                            console.log('✅ Campos encontrados en DEV/PRE, llenando...');
                            
                            // Limpiar campos primero
                            groupField.value = '';
                            userField.value = '';
                            passwordField.value = '';
                            
                            // Establecer valores
                            groupField.value = data.groupValue;
                            userField.value = data.userValue;
                            passwordField.value = data.passwordValue;
                            
                            // Disparar eventos para Angular
                            const events = ['input', 'change', 'blur', 'focus', 'keyup', 'keydown'];
                            events.forEach(eventType => {
                                try {
                                    groupField.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
                                    userField.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
                                    passwordField.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
                                } catch (e) {
                                    // Ignorar errores de eventos
                                }
                            });
                            
                            console.log('📝 Valores DEV/PRE establecidos:', {
                                group: groupField.value,
                                user: userField.value,
                                password: passwordField.value ? '[SET]' : '[EMPTY]'
                            });
                            
                            // Intentar click después de un delay
                            setTimeout(() => {
                                if (loginButton) {
                                    console.log('🖱️ Intentando click en botón DEV/PRE...');
                                    
                                    try {
                                        // Múltiples estrategias de click
                                        if (typeof loginButton.click === 'function') {
                                            loginButton.click();
                                        } else {
                                            loginButton.dispatchEvent(new MouseEvent('click', { 
                                                bubbles: true, 
                                                cancelable: true,
                                                view: window
                                            }));
                                        }
                                        
                                        // También intentar en el contenedor padre
                                        const parentContainer = loginButton.closest('.bt_entrar, .lab_entrar') || loginButton.parentElement;
                                        if (parentContainer && parentContainer !== loginButton) {
                                            setTimeout(() => {
                                                try {
                                                    if (typeof parentContainer.click === 'function') {
                                                        parentContainer.click();
                                                    } else {
                                                        parentContainer.dispatchEvent(new MouseEvent('click', { 
                                                            bubbles: true, 
                                                            cancelable: true,
                                                            view: window
                                                        }));
                                                    }
                                                } catch (e) {
                                                    console.log('⚠️ Error en click del contenedor:', e.message);
                                                }
                                            }, 300);
                                        }
                                        
                                        console.log('✅ Click ejecutado en DEV/PRE');
                                        
                                        // Limpiar datos después del login
                                        localStorage.removeItem('autologin_data');
                                        localStorage.removeItem('autologin_timestamp');
                                        
                                    } catch (error) {
                                        console.error('❌ Error en click DEV/PRE:', error);
                                    }
                                } else {
                                    console.log('❌ No se encontró botón de login en DEV/PRE');
                                }
                            }, 1000);
                            
                            return true;
                        } else {
                            console.log('❌ Faltan campos en DEV/PRE:', {
                                groupField: !!groupField,
                                userField: !!userField,
                                passwordField: !!passwordField
                            });
                        }
                    }
                    
                    return false;
                    
                } catch (error) {
                    console.error('❌ Error general en executeAutologin:', error);
                    return false;
                }
            }
            
            // Ejecutar inmediatamente si está listo
            if (document.readyState === 'complete') {
                console.log('📄 Documento ya listo, ejecutando autologin inmediatamente');
                setTimeout(executeAutologin, 1000);
            } else {
                console.log('📄 Documento cargando, esperando...');
                document.addEventListener('DOMContentLoaded', () => {
                    console.log('📄 DOMContentLoaded disparado');
                    setTimeout(executeAutologin, 1000);
                });
                window.addEventListener('load', () => {
                    console.log('📄 Window load disparado');
                    setTimeout(executeAutologin, 2000);
                });
            }
            
            // Reintentos más agresivos cada 3 segundos durante 60 segundos
            let attempts = 0;
            const maxAttempts = 20;
            const retryInterval = setInterval(() => {
                attempts++;
                console.log(\`🔄 Intento \${attempts}/\${maxAttempts} de autologin\`);
                
                const success = executeAutologin();
                if (success || attempts >= maxAttempts) {
                    clearInterval(retryInterval);
                    if (attempts >= maxAttempts) {
                        console.log('⏰ Tiempo agotado para autologin automático');
                        console.log('📋 DATOS PARA USAR MANUALMENTE:');
                        console.log('Grupo/Company:', data.groupValue);
                        console.log('Usuario:', data.userValue);
                        console.log('Contraseña:', data.passwordValue);
                        console.log('🔧 SCRIPT MANUAL PARA LOCAL:');
                        console.log("document.getElementsByName('companyID')[0].value='" + data.groupValue + "';");
                        console.log("document.getElementsByName('usuario')[0].value='" + data.userValue + "';");
                        console.log("document.getElementsByName('password')[0].value='" + data.passwordValue + "';");
                        console.log("document.querySelector('.opLogonStandardButton').click();");
                    }
                }
            }, 3000);
        };
        
        // Guardar el script en localStorage para que se ejecute en el portal
        localStorage.setItem('portal_script', portalScript.toString());
        
        // Función para ejecutar autologin manual desde la página de transición
        function executeManualAutologin() {
            console.log('🔧 Ejecutando autologin manual desde página de transición...');
            
            // Abrir nueva ventana con el portal
            const portalWindow = window.open('${portalUrl}', '_blank');
            
            if (portalWindow) {
                console.log('✅ Nueva ventana del portal abierta');
                
                // Intentar inyectar el script después de que cargue
                setTimeout(() => {
                    try {
                        portalWindow.postMessage({
                            type: 'EXECUTE_AUTOLOGIN',
                            data: autologinData
                        }, '*');
                        console.log('📤 Mensaje de autologin enviado a la nueva ventana');
                    } catch (error) {
                        console.log('⚠️ No se pudo enviar mensaje, ejecutando script directo');
                        
                        // Fallback: ejecutar script directamente
                        try {
                            portalWindow.eval('(' + portalScript.toString() + ')()');
                        } catch (e) {
                            console.log('⚠️ No se pudo ejecutar script directo:', e.message);
                        }
                    }
                }, 3000);
                
            } else {
                alert('No se pudo abrir nueva ventana. Verifica que las ventanas emergentes estén habilitadas.');
            }
        }
        
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

// Script de verificación automática de autologin para inyectar en todas las páginas web
const AUTO_CHECK_SCRIPT = `
  (function() {
    // Solo ejecutar si no hemos ejecutado ya
    if (window.autologinChecked) return;
    window.autologinChecked = true;
    
    console.log('🔍 Verificando autologin automático...');
    
    // Verificar si tenemos datos de autologin
    const autologinDataStr = localStorage.getItem('autologin_data');
    const timestamp = localStorage.getItem('autologin_timestamp');
    
    if (!autologinDataStr || !timestamp) {
      console.log('ℹ️ No hay datos de autologin pendientes');
      return;
    }
    
    // Verificar que los datos no sean muy antiguos (máximo 2 minutos)
    if (Date.now() - parseInt(timestamp) > 120000) {
      console.log('⏰ Datos de autologin expirados, limpiando...');
      localStorage.removeItem('autologin_data');
      localStorage.removeItem('autologin_timestamp');
      localStorage.removeItem('portal_script');
      return;
    }
    
    try {
      const data = JSON.parse(autologinDataStr);
      console.log('🎯 Datos de autologin encontrados:', {
        environment: data.environment,
        user: data.userValue,
        hasPassword: !!data.passwordValue,
        url: window.location.href
      });
      
      // Verificar si estamos en la URL correcta para ejecutar autologin
      const isLocalPortal = data.environment === 'local-dev' && window.location.href.includes('localhost:8080');
      const isExternalPortal = data.environment !== 'local-dev' && !window.location.href.includes('localhost');
      
      if (isLocalPortal || isExternalPortal) {
        console.log('✅ URL correcta detectada, ejecutando autologin...');
        
        // Obtener el script del localStorage
        const scriptFunction = localStorage.getItem('portal_script');
        if (scriptFunction) {
          // Ejecutar el script
          eval('(' + scriptFunction + ')')();
        } else {
          console.log('❌ No se encontró el script de autologin');
        }
      } else {
        console.log('ℹ️ URL no coincide con el entorno esperado');
      }
    } catch (error) {
      console.error('❌ Error procesando autologin:', error);
    }
  })();
`;

module.exports = { handlePortalAutoLogin, AUTO_CHECK_SCRIPT };