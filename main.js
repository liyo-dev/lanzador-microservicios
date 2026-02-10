const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn, exec } = require("child_process");
const stripAnsi = require("strip-ansi");
const kill = require("tree-kill");
const path = require("path");
const fs = require("fs");
const os = require("os");
const puppeteer = require("puppeteer-core");

// ----------------------------------------------
// DETECCIÓN DEV vs PROD
// ----------------------------------------------
const isDev = !app.isPackaged;
console.log("Running in " + (isDev ? "development" : "production") + " mode");

// ----------------------------------------------

let mainWindow;
let processes = {};
let angularStatus = {};
let springStatus = {};
const gitLocks = new Set();

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
  
  // Handler para abrir Chrome con URL específica
  ipcMain.handle('open-chrome-with-url', async (event, url) => {
    try {
      // Detectar ruta de Chrome
      const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe')
      ];
      
      let chromePath = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          chromePath = p;
          break;
        }
      }
      
      if (!chromePath) {
        return { 
          success: false, 
          error: 'No se encontró Chrome instalado' 
        };
      }
      
      // Abrir Chrome con la URL específica
      spawn(chromePath, ['--new-window', url], { 
        detached: true, 
        stdio: 'ignore' 
      }).unref();
      
      return { 
        success: true, 
        message: `Chrome abierto con URL: ${url}`
      };
    } catch (error) {
      console.error('Error abriendo Chrome con URL:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

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

// ===== GESTIÓN DE GIT POR MICRO =====
const acquireGitLock = (cwd) => {
  if (gitLocks.has(cwd)) {
    return false;
  }
  gitLocks.add(cwd);
  return true;
};

const releaseGitLock = (cwd) => {
  gitLocks.delete(cwd);
};

const runGitCommand = (command, cwd) => {
  return new Promise((resolve) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          success: false,
          stdout,
          stderr,
          error: stderr?.trim() || error.message,
        });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
};

const ensureGitRepo = async (cwd) => {
  if (!cwd || !fs.existsSync(cwd)) {
    return { success: false, error: "La ruta configurada no existe" };
  }

  const checkRepo = await runGitCommand(
    "git rev-parse --is-inside-work-tree",
    cwd
  );

  if (!checkRepo.success) {
    return {
      success: false,
      error: "La carpeta no es un repositorio Git válido",
    };
  }

  return { success: true };
};

const getGitStatus = async (cwd) => {
  const validation = await ensureGitRepo(cwd);
  if (!validation.success) return validation;

  const [branch, localBranches, remoteBranches, changes] = await Promise.all([
    runGitCommand("git rev-parse --abbrev-ref HEAD", cwd),
    runGitCommand('git branch --format="%(refname:short)"', cwd),
    runGitCommand('git branch -r --format="%(refname:short)"', cwd),
    runGitCommand("git status --porcelain", cwd),
  ]);

  if (!branch.success) return branch;
  if (!localBranches.success) return localBranches;

  // Combinar ramas locales y remotas
  const localBranchList = localBranches.stdout.split(/\r?\n/).filter(Boolean);
  const remoteBranchList = remoteBranches.success 
    ? remoteBranches.stdout.split(/\r?\n/).filter(Boolean).map(b => b.replace(/^origin\//, ''))
    : [];

  // Unir y eliminar duplicados, manteniendo el orden: primero locales, luego remotas
  const allBranches = [...new Set([...localBranchList, ...remoteBranchList])];

  return {
    success: true,
    branch: branch.stdout.trim(),
    branches: allBranches,
    hasChanges: !!changes.stdout?.trim(),
  };
};

ipcMain.handle("git-info", async (event, data) => {
  return getGitStatus(data?.path);
});

ipcMain.handle("git-fetch", async (event, data) => {
  const repoPath = data?.path;
  const validation = await ensureGitRepo(repoPath);
  if (!validation.success) return validation;

  if (!acquireGitLock(repoPath)) {
    return { success: false, error: "Ya hay una operación Git en curso" };
  }

  const result = await runGitCommand("git fetch --all", repoPath);
  releaseGitLock(repoPath);

  return {
    success: result.success,
    error: result.error,
    details: result.stdout || result.stderr,
  };
});

ipcMain.handle("git-pull", async (event, data) => {
  const repoPath = data?.path;
  const force = data?.force || false;
  const validation = await ensureGitRepo(repoPath);
  if (!validation.success) return validation;

  if (!acquireGitLock(repoPath)) {
    return { success: false, error: "Ya hay una operación Git en curso" };
  }

  // Si force es true, primero descartar cambios locales
  if (force) {
    await runGitCommand("git checkout .", repoPath);
  }

  // Verificar si hay cambios locales (solo si no se forzó)
  if (!force) {
    const status = await runGitCommand("git status --porcelain", repoPath);
    if (status.success && status.stdout.trim()) {
      releaseGitLock(repoPath);
      return {
        success: false,
        error: "HasLocalChanges",
        details: "Hay cambios locales sin commitear.",
      };
    }
  }

  const result = await runGitCommand("git pull", repoPath);
  releaseGitLock(repoPath);

  return {
    success: result.success,
    error: result.error,
    details: result.stdout || result.stderr,
  };
});

ipcMain.handle("git-checkout", async (event, data) => {
  const repoPath = data?.path;
  const branch = data?.branch;
  const force = data?.force || false;
  const validation = await ensureGitRepo(repoPath);
  if (!validation.success) return validation;

  if (!branch) {
    return { success: false, error: "Debes seleccionar una rama" };
  }

  // Si force es true, primero descartar cambios locales
  if (force) {
    await runGitCommand("git checkout .", repoPath);
  }

  // Verificar si hay cambios locales (solo si no se forzó)
  if (!force) {
    const status = await runGitCommand("git status --porcelain", repoPath);
    if (status.success && status.stdout.trim()) {
      return {
        success: false,
        error: "HasLocalChanges",
        details: "Hay cambios locales sin commitear.",
      };
    }
  }

  if (!acquireGitLock(repoPath)) {
    return { success: false, error: "Ya hay una operación Git en curso" };
  }

  const result = await runGitCommand(`git checkout ${branch}`, repoPath);
  releaseGitLock(repoPath);

  return {
    success: result.success,
    error: result.error,
    details: result.stdout || result.stderr,
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

// ===== AUTOMATIZACIÓN DE LOGIN CON PUPPETEER =====

// Función para encontrar la ruta de Chrome instalado
function findChromePath() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];

  for (const chromePath of possiblePaths) {
    if (chromePath && fs.existsSync(chromePath)) {
      console.log('✅ Chrome encontrado en:', chromePath);
      return chromePath;
    }
  }

  console.error('❌ No se encontró Chrome instalado');
  return null;
}

// Handler para abrir portal con auto-login usando Chrome directamente
ipcMain.handle('open-portal-auto-login', async (event, loginData) => {
  console.log('🚀 Iniciando auto-login (método directo Chrome)');
  console.log('📦 Datos recibidos completos:', JSON.stringify(loginData, null, 2));
  
  if (!loginData || !loginData.url) {
    console.error('❌ loginData.url es undefined o null');
    return {
      success: false,
      error: 'URL no proporcionada en loginData'
    };
  }

  const chromePath = findChromePath();
  
  if (!chromePath) {
    return {
      success: false,
      error: 'No se encontró Chrome instalado en el sistema'
    };
  }

  try {
    console.log('🌐 Creando archivo HTML temporal con auto-login');
    
    // Generar script de auto-login según el entorno
    let autoScript = '';
    
    if (loginData.user.environment === 'local-dev') {
      // Script para LOCAL
      autoScript = `
function autoLogin() {
  console.log('🔍 [LOCAL] Buscando campos de login...');
  const companyField = document.getElementsByName('companyID')[0];
  const userField = document.getElementsByName('usuario')[0];
  const passwordField = document.getElementsByName('password')[0];

  if (companyField && userField && passwordField) {
    console.log('✅ [LOCAL] Campos encontrados, rellenando...');
    companyField.value = '${loginData.user.companyID}';
    userField.value = '${loginData.user.username}';
    passwordField.value = '${loginData.user.password}';
    
    companyField.dispatchEvent(new Event('input', { bubbles: true }));
    companyField.dispatchEvent(new Event('change', { bubbles: true }));
    userField.dispatchEvent(new Event('input', { bubbles: true }));
    userField.dispatchEvent(new Event('change', { bubbles: true }));
    passwordField.dispatchEvent(new Event('input', { bubbles: true }));
    passwordField.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log('✅ [LOCAL] Campos rellenados automáticamente para ${loginData.user.name}');
  } else {
    console.log('⏳ [LOCAL] Campos no disponibles aún, reintentando...');
    setTimeout(autoLogin, 500);
  }
}

setTimeout(autoLogin, 1000);
`;
    } else if (loginData.user.environment === 'pre') {
      // Script para PRE/DEV - usar intervalo para detectar cuando Angular termine de cargar
      autoScript = `
let intentos = 0;
const maxIntentos = 40; // 20 segundos

function debugDOM() {
  console.log('🔍 [DEBUG] Analizando estructura de la página...');
  const allInputs = document.querySelectorAll('input');
  console.log('📋 [DEBUG] Total de inputs:', allInputs.length);
  
  allInputs.forEach((input, index) => {
    if (input.offsetParent !== null) { // Solo inputs visibles
      console.log('Input visible ' + index + ':', {
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder
      });
    }
  });
}

function autoLogin() {
  intentos++;
  console.log('🔍 [DEV/PRE] Intento ' + intentos + '/' + maxIntentos);
  
  if (intentos === 3) {
    debugDOM();
  }
  
  // Esperar a que Angular termine de renderizar
  const appRoot = document.querySelector('app-root');
  if (!appRoot || !appRoot.children.length) {
    console.log('⏳ Esperando que Angular cargue...');
    if (intentos < maxIntentos) {
      setTimeout(autoLogin, 500);
    }
    return;
  }
  
  // Buscar todos los inputs visibles de tipo texto y password
  const textInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(i => i.offsetParent !== null);
  const passInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(i => i.offsetParent !== null);
  
  console.log('📋 Inputs texto visibles:', textInputs.length, 'Password:', passInputs.length);
  
  let grupoField = null;
  let userField = null;
  let passwordField = passInputs[0] || null;
  
  // Intentar identificar campos por orden (normalmente: grupo, usuario, password)
  if (textInputs.length >= 2) {
    grupoField = textInputs[0];
    userField = textInputs[1];
  } else if (textInputs.length === 1) {
    userField = textInputs[0];
  }
  
  // Si encontramos los campos, rellenar
  if (grupoField && userField && passwordField) {
    console.log('✅ [DEV/PRE] Campos encontrados, rellenando...');
    
    // Función auxiliar para rellenar un campo
    function fillField(field, value, name) {
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
      console.log('  ✓', name, 'rellenado');
    }
    
    fillField(grupoField, '${loginData.user.companyID}', 'Grupo');
    setTimeout(() => {
      fillField(userField, '${loginData.user.username}', 'Usuario');
      setTimeout(() => {
        fillField(passwordField, '${loginData.user.password}', 'Password');
        console.log('✅ [DEV/PRE] AUTO-LOGIN COMPLETADO para ${loginData.user.name}');
      }, 300);
    }, 300);
    
  } else {
    console.log('⏳ [DEV/PRE] Campos no encontrados:', {grupo: !!grupoField, user: !!userField, pass: !!passwordField});
    if (intentos < maxIntentos) {
      setTimeout(autoLogin, 500);
    } else {
      console.error('❌ Timeout esperando campos');
      debugDOM();
    }
  }
}

// Esperar a que la página cargue completamente
setTimeout(autoLogin, 2000);
`;
    }
    
    // Determinar el texto del entorno para mostrar
    let environmentText = '';
    if (loginData.user.environment === 'local-dev') {
      environmentText = loginData.url.includes('localhost') ? 'localhost' : 'dev';
    } else if (loginData.user.environment === 'pre') {
      environmentText = 'pre';
    }
    
    // Crear HTML temporal simple que ejecuta el script y redirige
    const tempHtmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="1;url=${loginData.url}">
  <title>Auto-Login</title>
  <style>
    body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: system-ui; background: #fff; color: #64748b; }
    .spinner { width: 40px; height: 40px; margin: 0 auto 1rem; border: 3px solid #e2e8f0; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div style="text-align: center;">
    <div class="spinner"></div>
    <div>Cargando ${environmentText}...</div>
  </div>
  <script>${autoScript}</script>
</body>
</html>`;

    // Guardar el HTML temporal
    const tempDir = app.getPath('temp');
    const tempHtmlPath = path.join(tempDir, `autologin-${Date.now()}.html`);
    
    fs.writeFileSync(tempHtmlPath, tempHtmlContent, 'utf-8');
    console.log('Archivo temporal creado:', tempHtmlPath);
    
    // Abrir Chrome con el archivo temporal
    const { spawn } = require('child_process');
    spawn(chromePath, [tempHtmlPath], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    
    // Limpiar el archivo temporal despues de 15 segundos
    setTimeout(() => {
      try {
        if (fs.existsSync(tempHtmlPath)) {
          fs.unlinkSync(tempHtmlPath);
          console.log('Archivo temporal eliminado');
        }
      } catch (e) {
        console.warn('No se pudo eliminar archivo temporal:', e.message);
      }
    }, 15000);

    console.log('Chrome abierto correctamente');
    
    return {
      success: true,
      message: 'Chrome abierto con auto-login',
      userName: loginData.user.name,
      environment: loginData.user.environment
    };

  } catch (error) {
    console.error('Error abriendo Chrome:', error);
    return {
      success: false,
      error: error.message || 'Error desconocido al abrir Chrome'
    };
  }
});

// ========================================
// GESTIÓN DE PUERTOS
// ========================================

// Handler para buscar procesos por puerto
ipcMain.handle('find-process-by-port', async (event, port) => {
  try {
    console.log(`🔍 Buscando procesos en puerto ${port}...`);
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Ejecutar netstat para buscar el puerto
    const { stdout, stderr } = await execPromise(`netstat -ano | findstr :${port}`);
    
    if (stderr) {
      console.error('❌ Error en netstat:', stderr);
      return { success: false, processes: [], error: stderr };
    }
    
    // Parsear la salida de netstat
    const lines = stdout.trim().split('\n');
    const processes = [];
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Ejemplo de línea: TCP    0.0.0.0:8081           0.0.0.0:0              LISTENING       3128
      const parts = line.trim().split(/\s+/);
      
      if (parts.length >= 5) {
        const protocol = parts[0];
        const localAddress = parts[1];
        const foreignAddress = parts[2];
        const state = parts[3];
        const pid = parts[4];
        
        // Extraer puerto de la dirección local
        const portMatch = localAddress.match(/:(\d+)$/);
        if (portMatch) {
          const foundPort = portMatch[1];
          
          // Solo añadir si coincide con el puerto buscado
          if (foundPort === port) {
            processes.push({
              protocol,
              localAddress: localAddress.split(':')[0],
              port: foundPort,
              foreignAddress,
              state,
              pid
            });
          }
        }
      }
    }
    
    console.log(`✅ Encontrados ${processes.length} proceso(s) en puerto ${port}`);
    return { success: true, processes };
    
  } catch (error) {
    // Si no hay resultados, netstat devuelve error - esto es normal
    if (error.code === 1) {
      console.log(`✅ Puerto ${port} está libre`);
      return { success: true, processes: [] };
    }
    
    console.error('❌ Error buscando procesos:', error);
    return { success: false, processes: [], error: error.message };
  }
});

// Handler para terminar un proceso
ipcMain.handle('kill-process', async (event, pid) => {
  try {
    console.log(`⛔ Terminando proceso ${pid}...`);
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    // Ejecutar taskkill para terminar el proceso
    await execPromise(`taskkill /pid ${pid} /F`);
    
    console.log(`✅ Proceso ${pid} terminado correctamente`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Error terminando proceso ${pid}:`, error);
    return { success: false, error: error.message };
  }
});
