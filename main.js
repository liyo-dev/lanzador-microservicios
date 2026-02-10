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

// Intentar login cuando la página cargue
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(autoLogin, 1000));
} else {
  setTimeout(autoLogin, 1000);
}`;
    } else if (loginData.user.environment === 'pre') {
      // Script para PRE/DEV - más robusto con múltiples selectores
      autoScript = `
let intentos = 0;
const maxIntentos = 20; // 10 segundos de reintentos

function autoLogin() {
  intentos++;
  console.log('🔍 [DEV/PRE] Intento ' + intentos + '/' + maxIntentos + ' - Buscando campos de login...');
  
  // Probar múltiples selectores para cada campo
  const grupoSelectors = [
    '#txt_group input',
    'input[name="grupoEmpresarial"]',
    'input[placeholder*="Grupo"]',
    'input[placeholder*="grupo"]',
    'input[id*="group"]',
    'input[id*="grupo"]'
  ];
  
  const userSelectors = [
    '#txt_usuario input',
    'input[name="usuario"]',
    'input[name="username"]',
    'input[placeholder*="Usuario"]',
    'input[placeholder*="usuario"]',
    'input[id*="usuario"]',
    'input[id*="user"]'
  ];
  
  const passwordSelectors = [
    '#txt_pass input',
    'input[name="password"]',
    'input[name="contrasena"]',
    'input[type="password"]',
    'input[placeholder*="Contraseña"]',
    'input[placeholder*="contraseña"]',
    'input[id*="pass"]'
  ];
  
  let grupoField = null;
  let userField = null;
  let passwordField = null;
  
  // Buscar campo de grupo empresarial
  for (let selector of grupoSelectors) {
    try {
      grupoField = document.querySelector(selector);
      if (grupoField) {
        console.log('✅ [DEV/PRE] Campo grupo encontrado con:', selector);
        break;
      }
    } catch (e) {}
  }
  
  // Buscar campo de usuario
  for (let selector of userSelectors) {
    try {
      userField = document.querySelector(selector);
      if (userField) {
        console.log('✅ [DEV/PRE] Campo usuario encontrado con:', selector);
        break;
      }
    } catch (e) {}
  }
  
  // Buscar campo de contraseña
  for (let selector of passwordSelectors) {
    try {
      passwordField = document.querySelector(selector);
      if (passwordField) {
        console.log('✅ [DEV/PRE] Campo password encontrado con:', selector);
        break;
      }
    } catch (e) {}
  }

  if (grupoField && userField && passwordField) {
    console.log('✅ [DEV/PRE] Todos los campos encontrados, rellenando...');
    
    // Rellenar campos
    grupoField.value = '${loginData.user.companyID}';
    userField.value = '${loginData.user.username}';
    passwordField.value = '${loginData.user.password}';
    
    // Disparar todos los eventos posibles para que se registren los cambios
    [grupoField, userField, passwordField].forEach(field => {
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      field.dispatchEvent(new Event('blur', { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    });
    
    console.log('✅ [DEV/PRE] Campos rellenados automáticamente para ${loginData.user.name}');
    console.log('📋 Valores:', {
      grupo: grupoField.value,
      usuario: userField.value,
      password: '***'
    });
  } else {
    console.log('⏳ [DEV/PRE] Campos no disponibles aún...');
    console.log('   Grupo:', !!grupoField, 'Usuario:', !!userField, 'Password:', !!passwordField);
    
    if (intentos < maxIntentos) {
      setTimeout(autoLogin, 500);
    } else {
      console.error('❌ [DEV/PRE] No se encontraron los campos después de ' + maxIntentos + ' intentos');
      console.log('💡 Revisa la consola para ver la estructura de la página');
    }
  }
}

// Intentar login cuando la página cargue
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(autoLogin, 1500));
} else {
  setTimeout(autoLogin, 1500);
}`;
    }
    
    // Crear HTML temporal que redirige e inyecta el script
    const tempHtmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Auto-Login - ${loginData.user.name}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .loader {
      text-align: center;
    }
    .spinner {
      border: 4px solid rgba(255,255,255,0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <h2>🚀 Cargando portal...</h2>
    <p>Preparando auto-login para ${loginData.user.name}</p>
  </div>
  
  <script>
    // Redirigir inmediatamente al portal
    setTimeout(() => {
      window.location.href = '${loginData.url}';
    }, 500);
    
    // Inyectar script de auto-login cuando se cargue el portal
    window.addEventListener('load', () => {
      ${autoScript}
    });
  </script>
</body>
</html>`;

    // Guardar el HTML temporal
    const tempDir = app.getPath('temp');
    const tempHtmlPath = path.join(tempDir, `autologin-${Date.now()}.html`);
    
    fs.writeFileSync(tempHtmlPath, tempHtmlContent, 'utf-8');
    console.log('📄 Archivo temporal creado:', tempHtmlPath);
    
    // Abrir Chrome con el archivo temporal
    console.log('🌐 Abriendo Chrome con auto-login...');
    const { spawn } = require('child_process');
    spawn(chromePath, [tempHtmlPath], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    
    // Limpiar el archivo temporal después de 10 segundos
    setTimeout(() => {
      try {
        if (fs.existsSync(tempHtmlPath)) {
          fs.unlinkSync(tempHtmlPath);
          console.log('🗑️ Archivo temporal eliminado');
        }
      } catch (e) {
        console.warn('⚠️ No se pudo eliminar archivo temporal:', e.message);
      }
    }, 10000);
    
    console.log('✅ Chrome abierto correctamente con auto-login');
    
    return {
      success: true,
      message: 'Chrome abierto con auto-login automático',
      userName: loginData.user.name,
      environment: loginData.user.environment
    };

  } catch (error) {
    console.error('❌ Error abriendo Chrome:', error);
    return {
      success: false,
      error: error.message || 'Error desconocido al abrir Chrome'
    };
  }
});
