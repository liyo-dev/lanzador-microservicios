const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const stripAnsi = require("strip-ansi");
const kill = require("tree-kill");
const path = require("path");
const fs = require("fs");
const os = require("os");
// Biblioteca para controlar Chrome a través del protocolo DevTools
const CDP = require('chrome-remote-interface');
// Nuevo handler de autologin mejorado
const { handlePortalAutoLogin } = require('./autologin-handler');

// ----------------------------------------------
// DETECCIÓN DEV vs PROD
// -----------------------------------------      const chromeProcess = spawn(chromePath, chromeArgs, {-
const isDev = !app.isPackaged;
console.log("Running in " + (isDev ? "development" : "production") + " mode");

// ----------------------------------------------

let mainWindow;
let processes = {};
let angularStatus = {};
let springStatus = {};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:4200");
  } else {
    const indexPath = path.join(
      __dirname,
      "dist",
      "launcher",
      "browser",
      "index.html"
    );
    console.log('Loading index from: ' + indexPath);
    mainWindow.loadFile(indexPath);
  }

  // Manejar intento de cierre de la ventana principal
  mainWindow.on("close", (event) => {
    const hasActiveProcesses = checkForActiveProcesses();
    
    if (hasActiveProcesses) {
      event.preventDefault();
      
      // Mostrar diálogo de confirmación
      const response = dialog.showMessageBoxSync(mainWindow, {
        type: "warning",
        buttons: ["Cancelar", "Forzar cierre"],
        defaultId: 0,
        title: "Microservicios activos",
        message: "⚠️ Hay microservicios ejecutándose",
        detail: "Tienes microservicios Angular o Spring corriendo. Se recomienda pararlos antes de cerrar la aplicación.\n\n¿Qué deseas hacer?",
        icon: path.join(__dirname, "icon.ico")
      });
      
      if (response === 1) {
        // Usuario eligió "Forzar cierre" - matar todos los procesos y cerrar
        forceKillAllProcesses();
        mainWindow.destroy();
      }
      // Si response === 0 (Cancelar), no hacemos nada y la ventana sigue abierta
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Manejar intento de cierre de la aplicación
app.on("before-quit", (event) => {
  const hasActiveProcesses = checkForActiveProcesses();
  
  if (hasActiveProcesses) {
    event.preventDefault();
    
    // Mostrar diálogo de confirmación
    const response = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      buttons: ["Cancelar", "Forzar cierre"],
      defaultId: 0,
      title: "Microservicios activos",
      message: "⚠️ Hay microservicios ejecutándose",
      detail: "Tienes microservicios Angular o Spring corriendo. Se recomienda pararlos antes de cerrar la aplicación.\n\n¿Qué deseas hacer?",
      icon: path.join(__dirname, "icon.ico")
    });
    
    if (response === 1) {
      // Usuario eligió "Forzar cierre" - matar todos los procesos y cerrar
      forceKillAllProcesses();
      app.quit();
    }
    // Si response === 0 (Cancelar), no hacemos nada y la app sigue abierta
  }
});

// Función para verificar si hay procesos activos
function checkForActiveProcesses() {
  const activeAngular = Object.values(angularStatus).some(status => status === "running");
  const activeSpring = Object.values(springStatus).some(status => status === "running");
  return activeAngular || activeSpring;
}

// Función para matar todos los procesos de forma forzada
function forceKillAllProcesses() {
  console.log("Forzando cierre de todos los procesos...");
  
  Object.keys(processes).forEach((key) => {
    const process = processes[key];
    if (process && !process.killed) {
      console.log('Matando proceso: ' + key);
      kill(process.pid, "SIGTERM", (err) => {
        if (err) {
          console.error('Error matando proceso ' + key + ':', err);
        }
      });
    }
  });
  
  // Limpiar estados
  processes = {};
  angularStatus = {};
  springStatus = {};
}

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

//#region Electron Store
const Store = require("electron-store");
const store = new Store.default();

ipcMain.handle("get-config", () => {
  return store.get("launcherConfig", {
    angular: {
      // Eliminar microservicios predefinidos - ahora inicia vacío
    },
    spring: {
      // Eliminar microservicios predefinidos - ahora inicia vacío
      javaHome: "",
      mavenHome: "",
      settingsXml: "",
      m2RepoPath: "",
    },
    // Soporte para microservicios personalizados
    customMicros: {
      angular: [],
      spring: []
    }
  });
});

ipcMain.handle("save-config", (event, config) => {
  store.set("launcherConfig", config);
});

ipcMain.handle("clear-config", () => {
  store.delete("launcherConfig");
});
//#endregion

// Lanzar Angular
ipcMain.on("start-angular", (event, data) => {
  const processKey = 'angular-' + data.micro;

  if (processes[processKey]) {
    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: 'Micro ' + data.micro + ' ya está en ejecución.',
    });
    return;
  }

  mainWindow.webContents.send("log-angular", {
    micro: data.micro,
    log: 'Lanzando Angular [' + data.micro + '] en puerto ' + data.port + '...',
    status: "starting",
  });

  angularStatus[data.micro] = "starting";

  const env = { ...process.env };

  if (data.useLegacyProvider) {
    env.NODE_OPTIONS = "--openssl-legacy-provider";
  }

  const angularProcess = spawn("ng.cmd", ["serve", "--port", data.port], {
    cwd: data.path,
    shell: true,
    env,
  });

  processes[processKey] = angularProcess;
  let runningNotified = false;

  angularProcess.stdout.on("data", (dataLog) => {
    const logClean = stripAnsi(dataLog.toString());
    console.log('Angular Log: ' + logClean);

    const isRunning =
      logClean.toLowerCase().includes("compiled successfully") ||
      logClean.toLowerCase().includes("client compiled successfully") ||
      logClean.toLowerCase().includes("listening on") ||
      logClean.toLowerCase().includes("open your browser on") ||
      logClean
        .toLowerCase()
        .includes("application bundle generation complete.");

    if (isRunning && !runningNotified) {
      console.log("FIRST time running detected → sending running");
      mainWindow.webContents.send("log-angular", {
        micro: data.micro,
        log: 'Angular ' + data.micro + ' arrancado correctamente.',
        status: "running",
      });
      angularStatus[data.micro] = "running";
      runningNotified = true;
    }

    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: logClean,
    });
  });

  angularProcess.stderr.on("data", (dataLog) => {
    const logClean = stripAnsi(dataLog.toString());
    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: logClean,
    });
  });

  angularProcess.on("close", (code) => {
    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: 'Angular process exited with code ' + code,
      status: "stopped",
    });
    angularStatus[data.micro] = "stopped";
    delete processes[processKey];
  });
});

// Verificación previa de entorno antes de arrancar Spring
function validateJavaAndMavenForSpring(micro, microPath) {
  const javaHome = (process.env.JAVA_HOME || "").replace(/^"+|"+$/g, "");

  if (!javaHome || !fs.existsSync(javaHome)) {
    mainWindow.webContents.send("log-spring", {
      micro,
      log:
        '❌ No se ha encontrado JAVA_HOME configurado correctamente.\n' +
        'Por favor, añade una variable de entorno de usuario llamada JAVA_HOME apuntando a tu instalación de Java (por ejemplo: C:\\DevTools\\Java\\jdk1.8.0_211) y reinicia el launcher.',
      status: "stopped",
    });
    return false;
  }

  const hasWrapper = fs.existsSync(path.join(microPath, "mvnw.cmd"));
  const mavenOk =
    hasWrapper ||
    (process.env.PATH && process.env.PATH.toLowerCase().includes("maven"));

  if (!mavenOk) {
    mainWindow.webContents.send("log-spring", {
      micro,
      log:
        '❌ No se encontró Maven ni mvnw.cmd en el microservicio.\n' +
        'Instala Maven desde https://maven.apache.org/download.cgi o asegúrate de que mvnw.cmd existe en la carpeta del micro.',
      status: "stopped",
    });
    return false;
  }

  return true;
}

// Lanzar Spring
ipcMain.on("start-spring", (event, data) => {
  const processKey = 'spring-' + (data.micro || "default");
  const micro = data.micro || "default";

  if (processes[processKey]) {
    mainWindow.webContents.send("log-spring", {
      micro,
      log: 'Micro Spring ya está en ejecución.',
    });
    return;
  }

  const javaHome = (data.javaHome || process.env.JAVA_HOME || "").replace(
    /^"+|"+$/g,
    ""
  );
  const mavenHome = (data.mavenHome || "").replace(/^"+|"+$/g, "");
  const mvnCmd = path.join(mavenHome, "bin", "mvn.cmd");

  const args = ["spring-boot:run"];
  if (data.settingsXml) args.push("-s", data.settingsXml);
  if (data.m2RepoPath) args.push('-Dmaven.repo.local=' + data.m2RepoPath);

  // Comillas solo si hay espacios
  const finalArgs = [
    "/c",
    [mvnCmd, ...args.map((arg) => (arg.includes(" ") ? '"' + arg + '"' : arg))].join(
      " "
    ),
  ];

  console.log("CMD.exe final:", finalArgs.join(" "));

  mainWindow.webContents.send("log-spring", {
    micro,
    log: 'Lanzando Spring con configuración personalizada...',
    status: "starting",
  });

  springStatus[micro] = "starting";

  console.log("RUTA mvn:", mvnCmd);
  console.log("ARGS:", args);
  console.log("CWD:", data.path);
  console.log("JAVA_HOME:", javaHome);
  console.log("MAVEN_HOME:", mavenHome);
  console.log("ENV:", {
    JAVA_HOME: javaHome,
    PATH: path.join(javaHome, "bin") + ";" + path.join(mavenHome, "bin") + ";" + process.env.PATH,
  });

  const springProcess = spawn("cmd.exe", finalArgs, {
    cwd: data.path,
    shell: false,
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      PATH: path.join(javaHome, "bin") + ";" + path.join(mavenHome, "bin") + ";" + process.env.PATH,
    },
  });

  springProcess.on("error", (err) => {
    mainWindow.webContents.send("log-spring", {
      micro,
      log: '❌ Error en spawn: ' + err.message,
      status: "stopped",
    });
    console.error("Error en spawn:", err);
  });

  processes[processKey] = springProcess;

  springProcess.stdout.on("data", (dataLog) => {
    const logClean = stripAnsi(dataLog.toString());
    const isRunning = logClean.includes("Started") && logClean.includes("in");

    mainWindow.webContents.send("log-spring", {
      micro,
      log: logClean,
      status: isRunning ? "running" : undefined,
    });

    if (isRunning) {
      springStatus[micro] = "running";
    }
  });

  springProcess.stderr.on("data", (dataLog) => {
    const logClean = stripAnsi(dataLog.toString());
    mainWindow.webContents.send("log-spring", {
      micro,
      log: '❗ Error: ' + logClean,
    });
  });

  springProcess.on("close", (code, signal) => {
    mainWindow.webContents.send("log-spring", {
      micro,
      log: '❌ Spring se cerró inesperadamente (code: ' + code + ', signal: ' + signal + ')',
      status: "stopped",
    });
    springStatus[micro] = "stopped";
    delete processes[processKey];
  });
});

// Parar proceso
ipcMain.on("stop-process", (event, processKey) => {
  if (processes[processKey]) {
    mainWindow.webContents.send(
      processKey.startsWith("angular-") ? "log-angular" : "log-spring",
      {
        micro: processKey.replace(/^angular-|^spring-/, ""),
        log: '🛑 Parando proceso ' + processKey + '...',
      }
    );

    kill(processes[processKey].pid, "SIGKILL", () => {
      mainWindow.webContents.send(
        processKey.startsWith("angular-") ? "log-angular" : "log-spring",
        {
          micro: processKey.replace(/^angular-|^spring-/, ""),
          log: processKey + ' process killed.',
          status: "stopped",
        }
      );

      if (processKey.startsWith("angular-")) {
        angularStatus[processKey.replace(/^angular-/, "")] = "stopped";
      } else {
        springStatus[processKey.replace(/^spring-/, "")] = "stopped";
      }

      delete processes[processKey];
    });
  } else {
    mainWindow.webContents.send(
      processKey.startsWith("angular-") ? "log-angular" : "log-spring",
      {
        micro: processKey.replace(/^angular-|^spring-/, ""),
        log: '⚠️ No hay proceso activo para ' + processKey + '.',
      }
    );
  }
});

// Último status
ipcMain.handle("get-last-status", () => {
  return {
    angular: angularStatus,
    spring: springStatus,
  };
});

// ===== GESTIÓN DE USUARIOS =====

// Obtener usuarios guardados
ipcMain.handle('get-users', () => {
  return store.get('users', []);
});

// Guardar usuarios
ipcMain.handle('save-users', (event, users) => {
  store.set('users', users);
  return { success: true };
});

// Abrir portal con navegador
ipcMain.handle('open-portal-with-autologin', async (event, loginData) => {
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

      console.log('� Abriendo Chrome con autologin:', chromePath);
      console.log('📋 Argumentos:', chromeArgs.join(' '));

      const chromeProcess = spawn(chromePath, chromeArgs, {
        detached: true,
        stdio: 'ignore'
      });

      chromeProcess.unref();

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const connectToChrome = async () => {
        const maxAttempts = 20;
        let lastError = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            // Verificar primero si el puerto está disponible
            const { default: net } = await import('net');
            await new Promise((resolve, reject) => {
              const socket = new net.Socket();
              socket.setTimeout(1000);
              
              socket.once('connect', () => {
                socket.destroy();
                resolve();
              });
              
              socket.once('timeout', () => {
                socket.destroy();
                reject(new Error('Timeout connecting to port 9222'));
              });
              
              socket.once('error', (err) => {
                socket.destroy();
                reject(err);
              });
              
              socket.connect(9222, '127.0.0.1');
            });

            const targets = await CDP.List({ port: 9222 });
            const candidateTarget =
              targets.find((t) => t.type === 'page' && t.url && !t.url.startsWith('chrome://')) ||
              targets.find((t) => t.type === 'page');

            if (candidateTarget) {
              return await CDP({ port: 9222, target: candidateTarget.targetId });
            }
          } catch (error) {
            lastError = error;
            console.log(`Intento ${attempt + 1}/${maxAttempts} fallido:`, error.message);
          }

          await wait(500);
        }

        if (lastError) {
          throw new Error(`No se pudo conectar a Chrome después de ${maxAttempts} intentos. Error: ${lastError.message}`);
        }

        throw new Error('No se pudo conectar a Chrome para ejecutar el autologin.');
      };

      try {
        // Esperar a que el puerto de depuración esté disponible
        await wait(3000);
        
        console.log('🔌 Intentando conectar al puerto de depuración de Chrome...');
        const client = await connectToChrome();
        
        console.log('✅ Conectado a Chrome, navegando al portal...');
        const { Runtime, Page } = client;
        await Page.enable();
        await Page.navigate({ url: portalUrl });
        await Page.loadEventFired();
        // Generar script específico según el entorno
        let script;
        const environment = userData.environment || 'local-dev';
        
        console.log('🎯 Entorno detectado:', environment);
        
        if (environment === 'local-dev') {
          // Para local-dev, determinar si usar script de local o dev basado en la URL
          const isLocalUrl = portalUrl.includes('localhost:8080');
          
          if (isLocalUrl) {
            console.log('🏠 Usando script para LOCAL (localhost)');
            script = 
              "console.log('🏠 Ejecutando autologin para LOCAL');" +
              "try {" +
              "  const companyField = document.getElementsByName('companyID')[0];" +
              "  const userField = document.getElementsByName('usuario')[0];" +
              "  const passwordField = document.getElementsByName('password')[0];" +
              "  const loginButton = document.querySelector('.opLogonStandardButton');" +
              "  " +
              "  if (companyField) companyField.value = '" + (userData.companyID || '') + "';" +
              "  if (userField) userField.value = '" + (userData.username || '') + "';" +
              "  if (passwordField) passwordField.value = '" + (userData.password || '') + "';" +
              "  " +
              "  if (loginButton) {" +
              "    loginButton.click();" +
              "    console.log('✅ Click en botón LOCAL ejecutado');" +
              "  } else {" +
              "    console.log('❌ Botón de login LOCAL no encontrado');" +
              "  }" +
              "} catch (error) {" +
              "  console.error('❌ Error en autologin LOCAL:', error);" +
              "}";
          } else {
            console.log('🔧 Usando script para DEV (isban.dev.corp)');
            const grupoEmpresarial = userData.companyID || 'SCNP';
            script = 
              "console.log('🔧 Ejecutando autologin para DEV');" +
              "function fillLoginFields() {" +
              "  try {" +
              "    let groupField = document.querySelector('#txt_group input');" +
              "    let userField = document.querySelector('#txt_usuario input');" +
              "    let passwordField = document.querySelector('#txt_pass input');" +
              "    let loginButton = document.querySelector('#btn_entrar');" +
              "    " +
              "    console.log('🔍 Campos encontrados:', {" +
              "      groupField: !!groupField," +
              "      userField: !!userField," +
              "      passwordField: !!passwordField," +
              "      loginButton: !!loginButton" +
              "    });" +
              "    " +
              "    if (!groupField) {" +
              "      const groupContainer = document.querySelector('#txt_group');" +
              "      if (groupContainer) groupField = groupContainer.querySelector('input');" +
              "    }" +
              "    " +
              "    if (!userField) {" +
              "      const userContainer = document.querySelector('#txt_usuario');" +
              "      if (userContainer) userField = userContainer.querySelector('input');" +
              "    }" +
              "    " +
              "    if (!passwordField) {" +
              "      const passContainer = document.querySelector('#txt_pass');" +
              "      if (passContainer) passwordField = passContainer.querySelector('input');" +
              "    }" +
              "    " +
              "    if (!groupField || !userField || !passwordField) {" +
              "      console.log('🔄 Buscando campos por posición...');" +
              "      const allInputs = Array.from(document.querySelectorAll('input'));" +
              "      const textInputs = allInputs.filter(input => " +
              "        input.type === 'text' || input.type === '' || !input.type" +
              "      );" +
              "      const passwordInputs = allInputs.filter(input => input.type === 'password');" +
              "      " +
              "      if (!groupField && textInputs.length >= 1) groupField = textInputs[0];" +
              "      if (!userField && textInputs.length >= 2) userField = textInputs[1];" +
              "      if (!passwordField && passwordInputs.length >= 1) passwordField = passwordInputs[0];" +
              "    }" +
              "    " +
              "    if (!loginButton) {" +
              "      console.log('🔄 Buscando botón de login...');" +
              "      const allButtons = Array.from(document.querySelectorAll('button, input[type=\"submit\"]'));" +
              "      for (const btn of allButtons) {" +
              "        const text = btn.textContent?.toLowerCase() || '';" +
              "        const id = btn.id?.toLowerCase() || '';" +
              "        if (text.includes('entrar') || text.includes('login') || id.includes('entrar')) {" +
              "          loginButton = btn;" +
              "          break;" +
              "        }" +
              "      }" +
              "      " +
              "      if (!loginButton && allButtons.length > 0) {" +
              "        loginButton = allButtons[0];" +
              "      }" +
              "    }" +
              "    " +
              "    if (groupField) {" +
              "      groupField.value = '" + grupoEmpresarial + "';" +
              "      groupField.dispatchEvent(new Event('input', { bubbles: true }));" +
              "      groupField.dispatchEvent(new Event('change', { bubbles: true }));" +
              "      console.log('✅ Grupo llenado:', '" + grupoEmpresarial + "');" +
              "    }" +
              "    " +
              "    if (userField) {" +
              "      userField.value = '" + (userData.username || '') + "';" +
              "      userField.dispatchEvent(new Event('input', { bubbles: true }));" +
              "      userField.dispatchEvent(new Event('change', { bubbles: true }));" +
              "      console.log('✅ Usuario llenado:', '" + (userData.username || '') + "');" +
              "    }" +
              "    " +
              "    if (passwordField) {" +
              "      passwordField.value = '" + (userData.password || '') + "';" +
              "      passwordField.dispatchEvent(new Event('input', { bubbles: true }));" +
              "      passwordField.dispatchEvent(new Event('change', { bubbles: true }));" +
              "      console.log('✅ Password llenado');" +
              "    }" +
              "    " +
              "    if (loginButton && groupField && userField && passwordField) {" +
              "      setTimeout(() => {" +
              "        loginButton.click();" +
              "        console.log('✅ Click en botón DEV ejecutado');" +
              "      }, 1000);" +
              "    } else {" +
              "      console.log('❌ No se pueden llenar todos los campos DEV');" +
              "    }" +
              "  } catch (error) {" +
              "    console.error('❌ Error en autologin DEV:', error);" +
              "  }" +
              "}" +
              "" +
              "fillLoginFields();" +
              "setTimeout(fillLoginFields, 2000);" +
              "setTimeout(fillLoginFields, 5000);" +
              "" +
              "if (document.readyState !== 'complete') {" +
              "  window.addEventListener('load', fillLoginFields);" +
              "}";
          }
        } else if (environment === 'pre') {
          console.log('🧪 Usando script para PRE');
          const grupoEmpresarial = userData.companyID || 'SCNP';
          script = 
            "console.log('🧪 Ejecutando autologin para PRE');" +
            "function fillLoginFields() {" +
            "  try {" +
            "    let groupField = document.querySelector('#txt_group input');" +
            "    let userField = document.querySelector('#txt_usuario input');" +
            "    let passwordField = document.querySelector('#txt_pass input');" +
            "    let loginButton = document.querySelector('#btn_entrar');" +
            "    " +
            "    console.log('🔍 Campos encontrados:', {" +
            "      groupField: !!groupField," +
            "      userField: !!userField," +
            "      passwordField: !!passwordField," +
            "      loginButton: !!loginButton" +
            "    });" +
            "    " +
            "    if (!groupField) {" +
            "      const groupContainer = document.querySelector('#txt_group');" +
            "      if (groupContainer) groupField = groupContainer.querySelector('input');" +
            "    }" +
            "    " +
            "    if (!userField) {" +
            "      const userContainer = document.querySelector('#txt_usuario');" +
            "      if (userContainer) userField = userContainer.querySelector('input');" +
            "    }" +
            "    " +
            "    if (!passwordField) {" +
            "      const passContainer = document.querySelector('#txt_pass');" +
            "      if (passContainer) passwordField = passContainer.querySelector('input');" +
            "    }" +
            "    " +
            "    if (!groupField || !userField || !passwordField) {" +
            "      console.log('🔄 Buscando campos por posición...');" +
            "      const allInputs = Array.from(document.querySelectorAll('input'));" +
            "      const textInputs = allInputs.filter(input => " +
            "        input.type === 'text' || input.type === '' || !input.type" +
            "      );" +
            "      const passwordInputs = allInputs.filter(input => input.type === 'password');" +
            "      " +
            "      if (!groupField && textInputs.length >= 1) groupField = textInputs[0];" +
            "      if (!userField && textInputs.length >= 2) userField = textInputs[1];" +
            "      if (!passwordField && passwordInputs.length >= 1) passwordField = passwordInputs[0];" +
            "    }" +
            "    " +
            "    if (!loginButton) {" +
            "      console.log('🔄 Buscando botón de login...');" +
            "      const allButtons = Array.from(document.querySelectorAll('button, input[type=\"submit\"]'));" +
            "      for (const btn of allButtons) {" +
            "        const text = btn.textContent?.toLowerCase() || '';" +
            "        const id = btn.id?.toLowerCase() || '';" +
            "        if (text.includes('entrar') || text.includes('login') || id.includes('entrar')) {" +
            "          loginButton = btn;" +
            "          break;" +
            "        }" +
            "      }" +
            "      " +
            "      if (!loginButton && allButtons.length > 0) {" +
            "        loginButton = allButtons[0];" +
            "      }" +
            "    }" +
            "    " +
            "    if (groupField) {" +
            "      groupField.value = '" + grupoEmpresarial + "';" +
            "      groupField.dispatchEvent(new Event('input', { bubbles: true }));" +
            "      groupField.dispatchEvent(new Event('change', { bubbles: true }));" +
            "      console.log('✅ Grupo llenado:', '" + grupoEmpresarial + "');" +
            "    }" +
            "    " +
            "    if (userField) {" +
            "      userField.value = '" + (userData.username || '') + "';" +
            "      userField.dispatchEvent(new Event('input', { bubbles: true }));" +
            "      userField.dispatchEvent(new Event('change', { bubbles: true }));" +
            "      console.log('✅ Usuario llenado:', '" + (userData.username || '') + "');" +
            "    }" +
            "    " +
            "    if (passwordField) {" +
            "      passwordField.value = '" + (userData.password || '') + "';" +
            "      passwordField.dispatchEvent(new Event('input', { bubbles: true }));" +
            "      passwordField.dispatchEvent(new Event('change', { bubbles: true }));" +
            "      console.log('✅ Password llenado');" +
            "    }" +
            "    " +
            "    if (loginButton && groupField && userField && passwordField) {" +
            "      setTimeout(() => {" +
            "        loginButton.click();" +
            "        console.log('✅ Click en botón PRE ejecutado');" +
            "      }, 1000);" +
            "    } else {" +
            "      console.log('❌ No se pueden llenar todos los campos PRE');" +
            "    }" +
            "  } catch (error) {" +
            "    console.error('❌ Error en autologin PRE:', error);" +
            "  }" +
            "}" +
            "" +
            "fillLoginFields();" +
            "setTimeout(fillLoginFields, 2000);" +
            "setTimeout(fillLoginFields, 5000);" +
            "" +
            "if (document.readyState !== 'complete') {" +
            "  window.addEventListener('load', fillLoginFields);" +
            "}";
        } else {
          console.log('❌ Entorno no reconocido:', environment);
          script = "console.log('❌ Entorno no reconocido: " + environment + "');";
        }
        
        try {
          
          // Intentar diagnóstico simple primero
          const simpleTest = await Runtime.evaluate({ 
            expression: 'document.title' 
          });
          
          // Ejecutar el script de autologin
          const loginResult = await Runtime.evaluate({ expression: script });
          console.log('� Resultado del script de login:', loginResult);
          
        } catch (evaluationError) {
          console.error('❌ Error durante evaluación del script:', evaluationError);
        }
        
        await client.close();
        console.log('✅ Autologin ejecutado correctamente');
        return {
          success: true,
          message: 'Chrome abierto y autologin ejecutado para ' + (userData.name || 'usuario') + '.'
        };
      } catch (automationError) {
        console.error('❌ Error durante autologin:', automationError);
        
        // Si es un error de conexión, abrir Chrome sin autologin
        if (automationError.message.includes('ECONNREFUSED') || 
            automationError.message.includes('No se pudo conectar a Chrome')) {
          console.log('🌐 Fallback: Abriendo Chrome sin autologin automático');
          
          // Abrir Chrome sin argumentos de depuración
          const simpleChromeArgs = [portalUrl];
          const simpleChromeProcess = spawn(chromePath, simpleChromeArgs, {
            detached: true,
            stdio: 'ignore'
          });
          simpleChromeProcess.unref();
          
          return {
            success: true,
            message: 'Chrome abierto para ' + (userData.name || 'usuario') + '. El autologin automático no está disponible, por favor introduce los datos manualmente:\n\nCompany: ' + (userData.companyID || 'N/A') + '\nUsuario: ' + (userData.username || 'N/A') + '\nContraseña: [Ver en la aplicación]'
          };
        }
        
        return {
          success: false,
          message: 'Error durante el autologin: ' + automationError.message
        };
      }
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
});
