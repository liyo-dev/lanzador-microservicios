const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu } = require("electron");
const { spawn, exec } = require("child_process");
const stripAnsi = require("strip-ansi");
const kill = require("tree-kill");
const path = require("path");
const fs = require("fs");
const os = require("os");

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

  // Función para escapar rutas con espacios
  const quotePath = (p) => p ? `"${p}"` : '';
  
  // Construir comando como string para manejar espacios correctamente
  let cmdParts = [quotePath(mvnCmd), "spring-boot:run"];
  if (data.settingsXml) cmdParts.push("-s", quotePath(data.settingsXml));
  if (data.m2RepoPath) cmdParts.push(`"-Dmaven.repo.local=${data.m2RepoPath}"`);
  
  const fullCommand = cmdParts.join(" ");

  console.log("Comando completo:", fullCommand);
  console.log("CWD:", data.path);
  console.log("JAVA_HOME:", javaHome);
  console.log("MAVEN_HOME:", mavenHome);

  mainWindow.webContents.send("log-spring", {
    micro,
    log: 'Lanzando Spring con configuración personalizada...',
    status: "starting",
  });

  springStatus[micro] = "starting";

  const springProcess = spawn(fullCommand, [], {
    cwd: data.path,
    shell: true,
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
// ========================================
// AUTO-LOGIN CON SCRIPT EN CONSOLA
// ========================================

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

// Handler para abrir portal con auto-login.
// Estrategia: abrimos una BrowserWindow de Electron (Chromium embebido) en lugar de
// spawnear Chrome externo. Esto nos permite inyectar el script de login directamente
// con webContents.executeJavaScript() sin pasar por el portapapeles ni DevTools.
// Beneficio: 100% automático y no depende de Chrome instalado ni de permisos del SO.
ipcMain.handle('open-portal-auto-login', async (event, loginData) => {
  console.log('🚀 Iniciando auto-login en ventana embebida');
  console.log('Datos recibidos:', JSON.stringify({ url: loginData?.url, user: loginData?.user?.name }, null, 2));

  if (!loginData || !loginData.url) {
    console.error('❌ loginData.url es undefined o null');
    return {
      success: false,
      error: 'URL no proporcionada en loginData'
    };
  }

  try {
    const credentials = {
      companyID: loginData.user.companyID,
      username: loginData.user.username,
      password: loginData.user.password
    };

    // Detectar si es LOCAL o DEV/PRE
    const isLocal = loginData.url.includes('localhost') || loginData.url.includes('127.0.0.1');
    const environment = loginData.user.environment;

    console.log('🔍 Detectando entorno:', {
      url: loginData.url,
      isLocal,
      environment,
      userName: loginData.user.name
    });

    // Construir el script de auto-login (sin IIFE: lo encapsulamos al inyectar)
    const autoLoginScript = isLocal
      ? buildLocalAutoLoginScript(credentials)
      : buildNexusAutoLoginScript(credentials);

    // Abrir nueva ventana embebida
    const portalWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      title: `Auto-Login · ${loginData.user.name}`,
      autoHideMenuBar: false, // Mostramos el menú con atajos de navegación
      webPreferences: {
        // Esta ventana es un navegador "tonto" para mostrar el portal externo.
        // No necesita acceso a Node ni preload: aislada y segura.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Permitimos contenido inseguro si la URL fuese http://localhost (caso LOCAL)
        webSecurity: !isLocal
      }
    });

    // Menú con controles de navegación, DevTools y utilidades.
    // Cada portalWindow tiene su propio menú independiente.
    const portalMenu = buildPortalMenu(portalWindow);
    portalWindow.setMenu(portalMenu);

    // Atajos de teclado adicionales por si el foco está en la página y
    // se quieren las teclas estándar de navegador (algunas ya las gestiona
    // Chromium internamente, pero F12 lo forzamos aquí).
    portalWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;

      // F12 -> abrir/cerrar DevTools
      if (input.key === 'F12') {
        event.preventDefault();
        if (portalWindow.webContents.isDevToolsOpened()) {
          portalWindow.webContents.closeDevTools();
        } else {
          portalWindow.webContents.openDevTools({ mode: 'right' });
        }
        return;
      }

      // Ctrl+Shift+I -> también DevTools (alternativa)
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
        portalWindow.webContents.openDevTools({ mode: 'right' });
        return;
      }

      // Ctrl+L -> copiar URL actual al portapapeles (sustituto de "enfocar barra")
      if (input.control && input.key.toLowerCase() === 'l') {
        event.preventDefault();
        clipboard.writeText(portalWindow.webContents.getURL());
        return;
      }

      // Ctrl+R / F5 -> recargar (Chromium ya lo hace, lo dejamos explícito)
      if ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5') {
        event.preventDefault();
        portalWindow.webContents.reload();
        return;
      }
    });

    portalWindow.loadURL(loginData.url);

    // Inyectamos el script una vez la página termine de cargar.
    // Usamos 'did-finish-load' (DOM listo + recursos básicos) y reintentamos
    // ante navegaciones (login devuelve a otra URL, etc.) limitando reintentos.
    let injectionsDone = 0;
    const MAX_INJECTIONS = 1; // Solo la primera carga; el script ya reintenta dentro

    const tryInject = async (reason) => {
      if (injectionsDone >= MAX_INJECTIONS) return;
      injectionsDone++;
      try {
        console.log(`� Inyectando script de auto-login (${reason})`);
        await portalWindow.webContents.executeJavaScript(autoLoginScript, true);
        console.log('✅ Script inyectado correctamente');
      } catch (err) {
        console.error('⚠️ Error inyectando script:', err?.message || err);
      }
    };

    portalWindow.webContents.once('did-finish-load', () => tryInject('did-finish-load'));

    // Si el script falla por algún motivo, el usuario puede abrir DevTools manualmente
    // con F12. Lo permitimos sin abrirlo por defecto (no molestamos al usuario normal).

    // Logs de errores de carga (útil para debugging si la URL es inalcanzable)
    portalWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      if (code === -3) return; // -3 = aborted (típico al redirigir tras login)
      console.warn(`⚠️ did-fail-load (${code}) en ${url}: ${desc}`);
    });

    return {
      success: true,
      message: 'Ventana de portal abierta con inyección automática',
      userName: loginData.user.name,
      environment: loginData.user.environment
    };

  } catch (error) {
    console.error('❌ Error abriendo ventana de portal:', error);
    return {
      success: false,
      error: error.message || 'Error desconocido al abrir el portal'
    };
  }
});

// ============================================================
// Generadores de scripts de auto-login
// ============================================================

/** Script para portal LOCAL (formulario HTML clásico). */
function buildLocalAutoLoginScript(credentials) {
  return `
(function() {
  const credentials = ${JSON.stringify(credentials)};
  console.log('🔐 Auto-Login LOCAL iniciado');

  function realClick(el) {
    if (!el) return false;
    try {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
      });
      return true;
    } catch {
      try { el.click(); return true; } catch { return false; }
    }
  }

  function fillFields() {
    const companyField = document.getElementsByName('companyID')[0];
    const userField = document.getElementsByName('usuario')[0];
    const passwordField = document.getElementsByName('password')[0];
    const submitButton = document.querySelector('button[type="submit"], input[type="submit"], button.btn-primary');

    if (companyField && userField && passwordField) {
      companyField.value = credentials.companyID;
      userField.value = credentials.username;
      passwordField.value = credentials.password;

      [companyField, userField, passwordField].forEach(field => {
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));
      });

      console.log('✅ Campos rellenados correctamente');

      // Esperamos a que el botón esté habilitado antes de pulsarlo
      let clickAttempts = 0;
      const clickInterval = setInterval(() => {
        clickAttempts++;
        const btn = submitButton || document.querySelector('button[type="submit"], input[type="submit"], button.btn-primary');
        if (btn && !btn.disabled) {
          clearInterval(clickInterval);
          realClick(btn);
          console.log('🚀 Botón de login pulsado automáticamente');
        } else if (clickAttempts > 20) {
          clearInterval(clickInterval);
          // Fallback: submit del formulario
          const form = companyField.closest('form');
          if (form) {
            form.submit();
            console.log('🚀 Submit del formulario lanzado (fallback)');
          } else {
            console.warn('⚠️ Botón de login no encontrado o sigue deshabilitado');
          }
        }
      }, 250);

      return true;
    }
    return false;
  }

  if (!fillFields()) {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (fillFields() || attempts > 20) {
        clearInterval(interval);
        if (attempts > 20) console.warn('⏱️ Timeout: No se encontraron los campos');
      }
    }, 500);
  }
})();
`.trim();
}

/** Script para portal DEV/PRE (Angular - Santander Nexus). */
function buildNexusAutoLoginScript(credentials) {
  return `
(function() {
  const credentials = ${JSON.stringify(credentials)};
  console.log('🔐 Auto-Login Nexus (DEV/PRE) iniciado');

  function realClick(el) {
    if (!el) return false;
    try {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
      });
      return true;
    } catch {
      try { el.click(); return true; } catch { return false; }
    }
  }

  function fillField(field, value) {
    field.focus();
    field.click();
    field.value = '';
    for (let i = 0; i < value.length; i++) {
      field.value = value.substring(0, i + 1);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /**
   * En Nexus el "botón" de Login es un <label id="btn_entrar"> dentro de
   * un <div class="bt_entrar">. Cuando está deshabilitado, el DIV tiene
   * inline 'background-color: rgb(194, 194, 194)' (gris) y cambia a rojo
   * Santander cuando el formulario es válido.
   */
  function findNexusSubmit() {
    const wrapperDiv = document.querySelector('.bt_entrar');
    const labelBtn  = document.getElementById('btn_entrar') || document.querySelector('.lab_entrar');
    return { wrapperDiv, labelBtn };
  }

  function isNexusReady(wrapperDiv) {
    if (!wrapperDiv) return false;
    const bg = (wrapperDiv.style.backgroundColor || '').replace(/\\s/g, '').toLowerCase();
    // Gris exacto del estado deshabilitado: rgb(194,194,194)
    if (bg.includes('rgb(194,194,194)')) return false;
    // Cualquier otro color (típicamente rojo Santander) -> habilitado
    return true;
  }

  function autoSubmitNexus() {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const { wrapperDiv, labelBtn } = findNexusSubmit();

      if (wrapperDiv && labelBtn && isNexusReady(wrapperDiv)) {
        clearInterval(interval);
        // Pequeño delay para que Angular termine de propagar el estado
        setTimeout(() => {
          // Hacemos click en el div Y en el label: el handler Angular puede
          // estar atado a cualquiera de los dos. Es idempotente.
          realClick(wrapperDiv);
          realClick(labelBtn);
          console.log('🚀 Botón Nexus pulsado automáticamente');
        }, 80);
      } else if (attempts > 28) { // ~7s
        clearInterval(interval);
        if (wrapperDiv && labelBtn) {
          realClick(wrapperDiv);
          realClick(labelBtn);
          console.warn('⚠️ El botón seguía gris (rgb(194,194,194)), clic forzado de todas formas');
        } else {
          console.error('❌ Botón Nexus no encontrado (.bt_entrar / #btn_entrar)');
        }
      }
    }, 250);
  }

  function fillFields() {
    const grupoContainer = document.getElementById('txt_group');
    const userContainer = document.getElementById('txt_usuario');
    const passContainer = document.getElementById('txt_pass');

    const grupoField = grupoContainer ? grupoContainer.querySelector('input') : null;
    const userField  = userContainer  ? userContainer.querySelector('input')  : null;
    const passField  = passContainer  ? passContainer.querySelector('input')  : null;

    if (grupoField && userField && passField) {
      fillField(grupoField, credentials.companyID);
      setTimeout(() => {
        fillField(userField, credentials.username);
        setTimeout(() => {
          fillField(passField, credentials.password);
          // Esperar a que el botón quede habilitado (cambia de gris a rojo)
          setTimeout(autoSubmitNexus, 250);
        }, 300);
      }, 300);
      return true;
    }
    return false;
  }

  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (fillFields()) {
      clearInterval(interval);
      console.log('✅ Campos Nexus rellenados, esperando habilitación del botón...');
    } else if (attempts > 20) {
      clearInterval(interval);
      console.error('❌ Timeout: campos no encontrados (txt_group / txt_usuario / txt_pass)');
    }
  }, 500);
})();
`.trim();
}

/**
 * Construye el menú nativo de una ventana de portal Auto-Login con
 * controles de navegación, DevTools y utilidades. Los accelerators
 * funcionan automáticamente al estar el foco en la ventana.
 */
function buildPortalMenu(portalWindow) {
  const wc = portalWindow.webContents;

  return Menu.buildFromTemplate([
    {
      label: 'Navegación',
      submenu: [
        {
          label: '⬅️  Atrás',
          accelerator: 'Alt+Left',
          click: () => { if (wc.canGoBack()) wc.goBack(); }
        },
        {
          label: '➡️  Adelante',
          accelerator: 'Alt+Right',
          click: () => { if (wc.canGoForward()) wc.goForward(); }
        },
        {
          label: '🔄  Recargar',
          accelerator: 'CmdOrCtrl+R',
          click: () => wc.reload()
        },
        {
          label: '🔁  Recarga forzada (sin caché)',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => wc.reloadIgnoringCache()
        },
        { type: 'separator' },
        {
          label: '🏠  Ir al inicio del portal',
          click: () => {
            try {
              const u = new URL(wc.getURL());
              wc.loadURL(`${u.protocol}//${u.host}/`);
            } catch { /* noop */ }
          }
        },
        { type: 'separator' },
        { role: 'close', label: 'Cerrar ventana' }
      ]
    },
    {
      label: 'URL',
      submenu: [
        {
          label: '📋  Copiar URL actual',
          accelerator: 'CmdOrCtrl+L',
          click: () => clipboard.writeText(wc.getURL())
        },
        {
          label: '🌐  Abrir en navegador externo',
          click: () => shell.openExternal(wc.getURL())
        }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo',       label: 'Deshacer' },
        { role: 'redo',       label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut',        label: 'Cortar' },
        { role: 'copy',       label: 'Copiar' },
        { role: 'paste',      label: 'Pegar' },
        { role: 'selectAll',  label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'zoomIn',     label: 'Acercar',           accelerator: 'CmdOrCtrl+Plus' },
        { role: 'zoomOut',    label: 'Alejar',            accelerator: 'CmdOrCtrl+-' },
        { role: 'resetZoom',  label: 'Tamaño original',   accelerator: 'CmdOrCtrl+0' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' }
      ]
    },
    {
      label: 'Desarrollador',
      submenu: [
        {
          label: '🛠️  DevTools',
          accelerator: 'F12',
          click: () => {
            if (wc.isDevToolsOpened()) wc.closeDevTools();
            else wc.openDevTools({ mode: 'right' });
          }
        },
        {
          label: 'Inspeccionar (DevTools abajo)',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => wc.openDevTools({ mode: 'bottom' })
        }
      ]
    }
  ]);
}

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
