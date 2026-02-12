// Content script que se ejecuta en las páginas del portal
console.log('🔌 Portal Auto-Login extension cargada');

// Función para obtener credenciales desde el hash de la URL
function getCredentialsFromURL() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('autologin=')) return null;
  
  try {
    const params = new URLSearchParams(hash.substring(1));
    const dataStr = params.get('autologin');
    if (!dataStr) return null;
    
    const data = JSON.parse(decodeURIComponent(dataStr));
    console.log('✅ Credenciales obtenidas del hash');
    
    // Limpiar el hash de la URL
    window.location.hash = '';
    
    return data;
  } catch (e) {
    console.error('❌ Error parseando credenciales:', e);
    return null;
  }
}

// Función para auto-rellenar campos LOCAL
function autoLoginLocal(credentials) {
  console.log('🔍 [LOCAL] Buscando campos de login...');
  
  const companyField = document.getElementsByName('companyID')[0];
  const userField = document.getElementsByName('usuario')[0];
  const passwordField = document.getElementsByName('password')[0];
  
  if (companyField && userField && passwordField) {
    console.log('✅ [LOCAL] Campos encontrados, rellenando...');
    
    companyField.value = credentials.companyID;
    userField.value = credentials.username;
    passwordField.value = credentials.password;
    
    // Disparar eventos
    [companyField, userField, passwordField].forEach(field => {
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    
    console.log('✅ [LOCAL] Campos rellenados automáticamente');
    return true;
  }
  
  return false;
}

// Función para auto-rellenar campos PRE/DEV (Angular)
function autoLoginAngular(credentials) {
  console.log('🔍 [ANGULAR] Buscando campos de login...');
  
  // Esperar a que Angular cargue
  const appRoot = document.querySelector('app-root');
  if (!appRoot || !appRoot.children.length) {
    console.log('⏳ Esperando que Angular cargue...');
    return false;
  }
  
  // Buscar inputs visibles
  const textInputs = Array.from(document.querySelectorAll('input[type="text"]'))
    .filter(i => i.offsetParent !== null);
  const passInputs = Array.from(document.querySelectorAll('input[type="password"]'))
    .filter(i => i.offsetParent !== null);
  
  console.log('📋 Inputs encontrados - Texto:', textInputs.length, 'Password:', passInputs.length);
  
  if (textInputs.length >= 2 && passInputs.length >= 1) {
    const grupoField = textInputs[0];
    const userField = textInputs[1];
    const passwordField = passInputs[0];
    
    console.log('✅ [ANGULAR] Campos encontrados, rellenando...');
    
    // Función auxiliar para rellenar un campo simulando escritura
    function fillField(field, value) {
      field.focus();
      field.click();
      field.value = '';
      
      // Simular escritura carácter por carácter
      for (let i = 0; i < value.length; i++) {
        field.value = value.substring(0, i + 1);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      field.dispatchEvent(new Event('change', { bubbles: true }));
      field.dispatchEvent(new Event('blur', { bubbles: true }));
    }
    
    fillField(grupoField, credentials.companyID);
    setTimeout(() => {
      fillField(userField, credentials.username);
      setTimeout(() => {
        fillField(passwordField, credentials.password);
        console.log('✅ [ANGULAR] AUTO-LOGIN COMPLETADO');
      }, 200);
    }, 200);
    
    return true;
  }
  
  return false;
}

// Función principal de auto-login con reintentos
function tryAutoLogin(credentials, maxAttempts = 20) {
  let attempts = 0;
  
  function attempt() {
    attempts++;
    console.log(`🔄 Intento ${attempts}/${maxAttempts}`);
    
    // Detectar tipo de página
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isAngular = document.querySelector('app-root') !== null;
    
    let success = false;
    
    if (isLocal && !isAngular) {
      success = autoLoginLocal(credentials);
    } else if (isAngular) {
      success = autoLoginAngular(credentials);
    }
    
    if (!success && attempts < maxAttempts) {
      setTimeout(attempt, 500);
    } else if (success) {
      console.log('🎉 Auto-login completado exitosamente');
    } else {
      console.warn('⏱️ Timeout: No se pudieron encontrar los campos de login');
    }
  }
  
  // Esperar un poco antes del primer intento
  setTimeout(attempt, 1000);
}

// Iniciar el proceso
const credentials = getCredentialsFromURL();
if (credentials) {
  console.log('🚀 Iniciando auto-login con credenciales');
  tryAutoLogin(credentials);
} else {
  console.log('ℹ️ No hay credenciales en la URL, extension en espera');
}
