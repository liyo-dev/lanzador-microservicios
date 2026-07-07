const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu, session, safeStorage } = require("electron");
const { spawn, exec } = require("child_process");
const stripAnsi = require("strip-ansi");
const kill = require("tree-kill");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ----------------------------------------------
// CIFRADO LOCAL (safeStorage / DPAPI en Windows)
// ----------------------------------------------
// Prefijo con versión para poder migrar formatos en el futuro y para
// distinguir claramente cadenas cifradas de las que están en texto plano
// (necesario para migrar credenciales heredadas guardadas antes de esta
// funcionalidad).
const ENC_PREFIX = 'enc:v1:';

function cryptoIsAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptText(plain) {
  if (plain == null) return plain;
  const str = String(plain);
  if (!str) return str;
  if (str.startsWith(ENC_PREFIX)) return str; // ya cifrado
  if (!cryptoIsAvailable()) return str;      // fallback: se guarda en claro
  try {
    const buf = safeStorage.encryptString(str);
    return ENC_PREFIX + buf.toString('base64');
  } catch (err) {
    console.error('encryptText error:', err);
    return str;
  }
}

function decryptText(cipher) {
  if (cipher == null) return cipher;
  const str = String(cipher);
  if (!str.startsWith(ENC_PREFIX)) return str; // ya está en claro (legado)
  if (!cryptoIsAvailable()) return '';         // no podemos descifrar
  try {
    const b64 = str.slice(ENC_PREFIX.length);
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch (err) {
    console.error('decryptText error:', err);
    return '';
  }
}

ipcMain.handle('crypto:is-available', () => cryptoIsAvailable());
ipcMain.handle('crypto:encrypt', (_event, plain) => encryptText(plain));
ipcMain.handle('crypto:decrypt', (_event, cipher) => decryptText(cipher));
ipcMain.handle('crypto:encrypt-batch', (_event, list) =>
  Array.isArray(list) ? list.map(encryptText) : []
);
ipcMain.handle('crypto:decrypt-batch', (_event, list) =>
  Array.isArray(list) ? list.map(decryptText) : []
);

ipcMain.handle('show-open-dialog', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow || undefined, options || {});
    return result;
  } catch (err) {
    return { canceled: true, filePaths: [], error: err.message };
  }
});

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

// ----------------------------------------------
// UTILIDADES COMPARTIDAS
// ----------------------------------------------

// Dénde puede estar Chrome instalado en Windows.
const CHROME_CANDIDATE_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google\\Chrome\\Application\\chrome.exe'),
].filter(Boolean);

function findChromePath() {
  for (const candidate of CHROME_CANDIDATE_PATHS) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Confirmación única de cierre cuando hay servicios corriendo.
// Devuelve `true` si el usuario acepta forzar el cierre (o si no hay
// nada corriendo). En ese caso el llamante debe permitir el cierre.
function confirmCloseIfActive() {
  if (!checkForActiveProcesses()) return true;

  const response = dialog.showMessageBoxSync(mainWindow || undefined, {
    type: 'warning',
    buttons: ['Cancelar', 'Forzar cierre'],
    defaultId: 0,
    title: 'Microservicios activos',
    message: '⚠️ Hay microservicios ejecutándose',
    detail: 'Tienes microservicios Angular o Spring corriendo. Se recomienda pararlos antes de cerrar la aplicación.\n\n¿Qué deseas hacer?',
    icon: path.join(__dirname, 'icon.ico')
  });

  if (response === 1) {
    forceKillAllProcesses();
    return true;
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Sandbox: el preload solo usa 'electron' (ipcRenderer + contextBridge),
      // por lo que es compatible con sandbox y mejora significativamente
      // el aislamiento del renderer.
      sandbox: true,
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
    if (!confirmCloseIfActive()) {
      event.preventDefault();
      return;
    }
    // Si venimos aquí y el usuario aceptó, dejamos que el ciclo natural cierre.
  });
}

app.whenReady().then(() => {
  createWindow();

  // Handler para abrir Chrome con URL específica
  ipcMain.handle('open-chrome-with-url', async (event, url) => {
    try {
      const chromePath = findChromePath();
      if (!chromePath) {
        return { success: false, error: 'No se encontró Chrome instalado' };
      }
      spawn(chromePath, ['--new-window', url], { detached: true, stdio: 'ignore' }).unref();
      return { success: true, message: `Chrome abierto con URL: ${url}` };
    } catch (error) {
      console.error('Error abriendo Chrome con URL:', error);
      return { success: false, error: error.message };
    }
  });

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Manejar intento de cierre de la aplicación
app.on("before-quit", (event) => {
  if (!confirmCloseIfActive()) {
    event.preventDefault();
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

  const [branch, localBranches, remoteBranches, changes, upstream] = await Promise.all([
    runGitCommand("git rev-parse --abbrev-ref HEAD", cwd),
    runGitCommand('git branch --format="%(refname:short)"', cwd),
    runGitCommand('git branch -r --format="%(refname:short)"', cwd),
    runGitCommand("git status --porcelain", cwd),
    runGitCommand("git rev-parse --abbrev-ref --symbolic-full-name @{u}", cwd),
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

  // Ahead/behind respecto al upstream (si existe)
  let ahead = null;
  let behind = null;
  let upstreamName = null;
  if (upstream.success && upstream.stdout.trim()) {
    upstreamName = upstream.stdout.trim();
    const counts = await runGitCommand(
      "git rev-list --left-right --count HEAD...@{u}",
      cwd
    );
    if (counts.success && counts.stdout) {
      const m = counts.stdout.trim().match(/^(\d+)\s+(\d+)/);
      if (m) {
        ahead = parseInt(m[1], 10);
        behind = parseInt(m[2], 10);
      }
    }
  }

  return {
    success: true,
    branch: branch.stdout.trim(),
    branches: allBranches,
    hasChanges: !!changes.stdout?.trim(),
    ahead,
    behind,
    upstream: upstreamName,
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

// (findChromePath está definido arriba junto con CHROME_CANDIDATE_PATHS)

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
    let autoLoginScript;
    switch (environment) {
      case 'intranet-dev':
        autoLoginScript = buildIntranetDigitalDevAutoLoginScript(credentials);
        break;
      case 'digital-dev':
        autoLoginScript = buildDigitalDevAutoLoginScript(credentials);
        break;
      case 'pre':
      case 'local-dev':
      default:
        autoLoginScript = isLocal
          ? buildLocalAutoLoginScript(credentials)
          : buildNexusAutoLoginScript(credentials);
        break;
    }

    // ¿Modo incógnito? Usamos una sesión en memoria (partición sin "persist:")
    // que se destruye al cerrar la ventana. Sin cookies, sin caché, sin
    // storage persistente entre ejecuciones.
    const incognito = !!loginData.incognito;
    let portalSession;
    if (incognito) {
      // Partición única por ventana para aislar también de otras ventanas incógnito abiertas.
      const partitionName = `incognito-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      portalSession = session.fromPartition(partitionName, { cache: false });
      console.log(`🕵️ Modo incógnito activado (partición: ${partitionName})`);
    }

    // Abrir nueva ventana embebida
    const portalWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      title: `${incognito ? '🕵️ Incógnito · ' : 'Auto-Login · '}${loginData.user.name}`,
      autoHideMenuBar: false, // Mostramos el menú con atajos de navegación
      webPreferences: {
        // Esta ventana es un navegador "tonto" para mostrar el portal externo.
        // No necesita acceso a Node ni preload: aislada y segura.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Permitimos contenido inseguro si la URL fuese http://localhost (caso LOCAL)
        webSecurity: !isLocal,
        // Sesión efímera si estamos en incógnito
        ...(portalSession ? { session: portalSession } : {})
      }
    });

    // Menú con controles de navegación, DevTools y utilidades.
    // Cada portalWindow tiene su propio menú independiente.
    // reloadLogin se define más abajo en el mismo closure; se pasa como referencia.
    const reloadLogin = () => {
      console.log('🔄 Recargando login...');
      injectionsDone = 0;
      portalWindow.loadURL(loginData.url);
      portalWindow.webContents.once('did-finish-load', () => tryInject('reload-login'));
    };
    const portalMenu = buildPortalMenu(portalWindow, reloadLogin);
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

      // Ctrl+Shift+L -> recargar login (volver a la URL original y reinyectar autologin)
      if (input.control && input.shift && input.key.toLowerCase() === 'l') {
        event.preventDefault();
        reloadLogin();
        return;
      }

      // Ctrl+L -> copiar URL actual al portapapeles (sustituto de "enfocar barra")
      if (input.control && !input.shift && input.key.toLowerCase() === 'l') {
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

      // Ctrl+0 -> restablecer zoom
      if (input.control && input.key === '0') {
        event.preventDefault();
        portalWindow.webContents.setZoomFactor(1.0);
        return;
      }
    });

    // Ctrl+Rueda del ratón -> zoom in/out
    portalWindow.webContents.on('zoom-changed', (event, zoomDirection) => {
      const current = portalWindow.webContents.getZoomFactor();
      const step = 0.1;
      if (zoomDirection === 'in') {
        portalWindow.webContents.setZoomFactor(Math.min(parseFloat((current + step).toFixed(1)), 3.0));
      } else {
        portalWindow.webContents.setZoomFactor(Math.max(parseFloat((current - step).toFixed(1)), 0.3));
      }
    });

    // En modo incógnito, mantener siempre el prefijo en el título de la ventana
    // (la página intentará sobrescribirlo con su propio <title>).
    if (incognito) {
      portalWindow.on('page-title-updated', (e, pageTitle) => {
        e.preventDefault();
        portalWindow.setTitle(`🕵️ Incógnito · ${pageTitle}`);
      });
    }

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

// ============================================================
// Intranet Digital DEV (logcorp.sgtech.dev.corp)
// ============================================================
// Formulario React. Inputs:
//   #User      → name="User",     type="text",     pattern="[A-Za-z0-9]{5,}"
//   #Password  → name="Password", type="password", pattern="\\S{5,}"
//   button[type="submit"]  (texto "Login")
//
// Importante: React no reacciona a `input.value = …` directamente. Usamos
// el setter nativo del prototipo HTMLInputElement para forzar la actualización
// del state interno de React antes de despachar el evento 'input'.
function buildIntranetDigitalDevAutoLoginScript(credentials) {
  return `
(function() {
  const credentials = ${JSON.stringify(credentials)};
  console.log('🔐 Auto-Login Intranet Digital DEV iniciado');

  function realClick(el) {
    if (!el) return false;
    try {
      ['mousedown','mouseup','click'].forEach(t =>
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })));
      return true;
    } catch { try { el.click(); return true; } catch { return false; } }
  }

  // React-friendly value setter: usa el setter nativo del prototipo del input
  // para que React detecte el cambio y actualice su estado interno.
  function setReactInputValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillFields() {
    const userField = document.getElementById('User');
    const passField = document.getElementById('Password');
    if (!userField || !passField) return false;

    userField.focus();
    setReactInputValue(userField, credentials.username);

    passField.focus();
    setReactInputValue(passField, credentials.password);

    userField.dispatchEvent(new Event('blur', { bubbles: true }));
    passField.dispatchEvent(new Event('blur', { bubbles: true }));
    console.log('✅ Campos User/Password rellenados');

    // Submit: esperar a que el botón esté habilitado (React valida el form).
    let clickAttempts = 0;
    const clickItv = setInterval(() => {
      clickAttempts++;
      const form = userField.closest('form');
      const submitBtn =
        (form && form.querySelector('button[type="submit"], input[type="submit"]')) ||
        document.querySelector('button[type="submit"], input[type="submit"]');

      if (submitBtn && !submitBtn.disabled) {
        clearInterval(clickItv);
        setTimeout(() => {
          realClick(submitBtn);
          console.log('🚀 Botón Login pulsado automáticamente');
        }, 80);
      } else if (clickAttempts > 24) { // ~6s
        clearInterval(clickItv);
        if (form) {
          try { form.requestSubmit ? form.requestSubmit() : form.submit(); }
          catch { /* noop */ }
          console.warn('⚠️ Botón seguía deshabilitado; submit del formulario como fallback');
        } else {
          console.error('❌ No se encontró botón Login ni formulario para hacer submit');
        }
      }
    }, 250);

    return true;
  }

  if (!fillFields()) {
    let attempts = 0;
    const itv = setInterval(() => {
      attempts++;
      if (fillFields() || attempts > 24) {
        clearInterval(itv);
        if (attempts > 24) console.error('❌ Timeout: no se encontraron #User / #Password');
      }
    }, 500);
  }
})();
`.trim();
}

// ============================================================
// Digital DEV (iciam.santandercib.com)
// ============================================================
// Vue 3 + Vuetify. Inputs:
//   #email     → type="email",    class="v-field__input"  (label "Enter email")
//   #password  → type="password", class="v-field__input"  (label "Password", maxlength 14)
//   button.btn-login                (texto interior "Login" en <a class="btn-login-text">)
//
// Mientras el form sea inválido, el botón tiene la clase `v-btn--disabled` y el
// atributo `disabled`. Esperamos a que se habilite tras rellenar los campos.
//
// Vue (v-model) escucha sobre el evento 'input'. Usamos el setter nativo del
// prototipo para que Vue detecte el cambio y revalide el formulario.
function buildDigitalDevAutoLoginScript(credentials) {
  return `
(function() {
  const credentials = ${JSON.stringify(credentials)};
  console.log('🔐 Auto-Login Digital DEV (iciam) iniciado');

  function realClick(el) {
    if (!el) return false;
    try {
      ['mousedown','mouseup','click'].forEach(t =>
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })));
      return true;
    } catch { try { el.click(); return true; } catch { return false; } }
  }

  // Setter nativo de HTMLInputElement.value → Vue/React detectan el cambio.
  function setFrameworkInputValue(input, value) {
    const proto = HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findSubmitButton() {
    // Botón principal con clase específica
    return document.querySelector('button.btn-login')
        || document.querySelector('button.v-btn.btn-login')
        // Fallback: cualquier botón cuyo texto sea "Login" dentro del form panel
        || Array.from(document.querySelectorAll('button')).find(b =>
             (b.textContent || '').trim().toLowerCase() === 'login');
  }

  function isSubmitEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.classList && btn.classList.contains('v-btn--disabled')) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function fillFields() {
    const emailField = document.getElementById('email');
    const passField  = document.getElementById('password');
    if (!emailField || !passField) return false;

    // Email
    emailField.focus();
    setFrameworkInputValue(emailField, credentials.username);
    emailField.dispatchEvent(new Event('blur', { bubbles: true }));

    // Password (respeta max-length="14" si está presente)
    passField.focus();
    const maxAttr = passField.getAttribute('max-length') || passField.getAttribute('maxlength');
    const maxLen  = maxAttr ? parseInt(maxAttr, 10) : 0;
    const pwd     = (maxLen > 0 && credentials.password.length > maxLen)
      ? credentials.password.slice(0, maxLen)
      : credentials.password;
    setFrameworkInputValue(passField, pwd);
    passField.dispatchEvent(new Event('blur', { bubbles: true }));

    console.log('✅ Campos email/password rellenados');

    // Esperar a que Vuetify habilite el botón "Login"
    let clickAttempts = 0;
    const clickItv = setInterval(() => {
      clickAttempts++;
      const submitBtn = findSubmitButton();
      if (submitBtn && isSubmitEnabled(submitBtn)) {
        clearInterval(clickItv);
        setTimeout(() => {
          // Click sintético en el botón. Por si Vuetify tiene el handler en el
          // <a> interno, lo intentamos también; los clicks son idempotentes.
          realClick(submitBtn);
          const innerLink = submitBtn.querySelector('a.btn-login-text, a.text-btn-login');
          if (innerLink) realClick(innerLink);
          console.log('🚀 Botón Login pulsado automáticamente');
        }, 120);
      } else if (clickAttempts > 28) { // ~7s
        clearInterval(clickItv);
        if (submitBtn) {
          realClick(submitBtn);
          console.warn('⚠️ Botón seguía deshabilitado; click forzado de todas formas');
        } else {
          console.error('❌ No se encontró el botón Login (button.btn-login)');
        }
      }
    }, 250);

    return true;
  }

  if (!fillFields()) {
    let attempts = 0;
    const itv = setInterval(() => {
      attempts++;
      if (fillFields() || attempts > 24) {
        clearInterval(itv);
        if (attempts > 24) console.error('❌ Timeout: no se encontraron #email / #password');
      }
    }, 500);
  }
})();
`.trim();
}

/**
 * Construye el menú nativo de una ventana de portal Auto-Login con
 * controles de navegación, DevTools y utilidades. Los accelerators
 * funcionan automáticamente al estar el foco en la ventana.
 */
function buildPortalMenu(portalWindow, onReloadLogin) {
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
          label: '🔐  Recargar Login',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => onReloadLogin && onReloadLogin()
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
        }
      ]
    },
    {
      label: 'Herramientas',
      submenu: [
        {
          label: '📸  Captura de pantalla',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: async () => {
            try {
              const image = await wc.capturePage();
              const defaultName = `captura-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
              const { filePath: savePath, canceled } = await dialog.showSaveDialog(portalWindow, {
                title: 'Guardar captura de pantalla',
                defaultPath: path.join(app.getPath('pictures'), defaultName),
                filters: [{ name: 'Imágenes PNG', extensions: ['png'] }]
              });
              if (!canceled && savePath) {
                fs.writeFileSync(savePath, image.toPNG());
                shell.showItemInFolder(savePath);
              }
            } catch (err) {
              console.error('❌ Error al capturar pantalla:', err);
            }
          }
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

// ========================================
// UTILIDADES DE FICHERO Y RED
// ========================================

// Comprueba si una ruta existe y qué tipo de nodo es.
ipcMain.handle('check-path', async (event, targetPath) => {
  try {
    if (!targetPath || typeof targetPath !== 'string') {
      return { exists: false, isDirectory: false, isFile: false };
    }
    const stat = fs.statSync(targetPath);
    return {
      exists: true,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
    };
  } catch {
    return { exists: false, isDirectory: false, isFile: false };
  }
});

// Comprueba si un puerto TCP está en uso (LISTEN).
ipcMain.handle('check-port', async (event, port) => {
  return new Promise((resolve) => {
    try {
      const net = require('net');
      const socket = new net.Socket();
      let done = false;
      const finish = (inUse) => {
        if (done) return;
        done = true;
        try { socket.destroy(); } catch {}
        resolve(!!inUse);
      };
      socket.setTimeout(400);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(Number(port), '127.0.0.1');
    } catch {
      resolve(false);
    }
  });
});

// Probe HTTP simple (por ejemplo /actuator/health). Devuelve el status code
// o null si no responde.
ipcMain.handle('probe-http', async (event, url, timeoutMs = 1500) => {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? require('https') : require('http');
      const req = mod.get(url, (res) => {
        resolve({ ok: true, status: res.statusCode || 0 });
        res.resume();
      });
      req.on('error', () => resolve({ ok: false, status: null }));
      req.setTimeout(Number(timeoutMs) || 1500, () => {
        req.destroy();
        resolve({ ok: false, status: null });
      });
    } catch {
      resolve({ ok: false, status: null });
    }
  });
});

// Diálogos y ficheros (para import/export de configuración y descarga de logs)
ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow || undefined, options || {});
  return {
    canceled: result.canceled,
    filePath: result.filePath || null,
  };
});

ipcMain.handle('write-file', async (event, targetPath, contents) => {
  try {
    fs.writeFileSync(targetPath, contents, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-file', async (event, targetPath) => {
  try {
    const contents = fs.readFileSync(targetPath, 'utf8');
    return { success: true, contents };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-app-version', () => {
  try {
    return app.getVersion();
  } catch {
    return null;
  }
});
