const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const stripAnsi = require("strip-ansi");
const kill = require("tree-kill");
const path = require("path");
const fs = require("fs");
const os = require("os");
// Biblioteca para controlar Chrome a través del protocolo DevTools
const CDP = require('chrome-remote-interface');

// ----------------------------------------------
// DETECCIÓN DEV vs PROD
// ----------------------------------------------
const isDev = !app.isPackaged;
console.log(`Running in ${isDev ? "development" : "production"} mode.`);

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
    console.log(`Loading index from: ${indexPath}`);
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
      console.log(`Matando proceso: ${key}`);
      kill(process.pid, "SIGTERM", (err) => {
        if (err) {
          console.error(`Error matando proceso ${key}:`, err);
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
  const processKey = `angular-${data.micro}`;

  if (processes[processKey]) {
    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: `Micro ${data.micro} ya está en ejecución.`,
    });
    return;
  }

  mainWindow.webContents.send("log-angular", {
    micro: data.micro,
    log: `Lanzando Angular [${data.micro}] en puerto ${data.port}...`,
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
    console.log(`Angular Log: ${logClean}`);

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
        log: `Angular ${data.micro} arrancado correctamente.`,
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
      log: `Angular process exited with code ${code}`,
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
        `❌ No se ha encontrado JAVA_HOME configurado correctamente.\n` +
        `Por favor, añade una variable de entorno de usuario llamada JAVA_HOME apuntando a tu instalación de Java (por ejemplo: C:\\DevTools\\Java\\jdk1.8.0_211) y reinicia el launcher.`,
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
        `❌ No se encontró Maven ni mvnw.cmd en el microservicio.\n` +
        `Instala Maven desde https://maven.apache.org/download.cgi o asegúrate de que mvnw.cmd existe en la carpeta del micro.`,
      status: "stopped",
    });
    return false;
  }

  return true;
}

// Lanzar Spring
ipcMain.on("start-spring", (event, data) => {
  const processKey = `spring-${data.micro || "default"}`;
  const micro = data.micro || "default";

  if (processes[processKey]) {
    mainWindow.webContents.send("log-spring", {
      micro,
      log: `Micro Spring ya está en ejecución.`,
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
  if (data.m2RepoPath) args.push(`-Dmaven.repo.local=${data.m2RepoPath}`);

  // Comillas solo si hay espacios
  const finalArgs = [
    "/c",
    [mvnCmd, ...args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))].join(
      " "
    ),
  ];

  console.log("CMD.exe final:", finalArgs.join(" "));

  mainWindow.webContents.send("log-spring", {
    micro,
    log: `Lanzando Spring con configuración personalizada...`,
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
    PATH: `${path.join(javaHome, "bin")};${path.join(mavenHome, "bin")};${
      process.env.PATH
    }`,
  });

  const springProcess = spawn("cmd.exe", finalArgs, {
    cwd: data.path,
    shell: false,
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      PATH: `${path.join(javaHome, "bin")};${path.join(mavenHome, "bin")};${
        process.env.PATH
      }`,
    },
  });

  springProcess.on("error", (err) => {
    mainWindow.webContents.send("log-spring", {
      micro,
      log: `❌ Error en spawn: ${err.message}`,
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
      log: `❗ Error: ${logClean}`,
    });
  });

  springProcess.on("close", (code, signal) => {
    mainWindow.webContents.send("log-spring", {
      micro,
      log: `❌ Spring se cerró inesperadamente (code: ${code}, signal: ${signal})`,
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
        log: `🛑 Parando proceso ${processKey}...`,
      }
    );

    kill(processes[processKey].pid, "SIGKILL", () => {
      mainWindow.webContents.send(
        processKey.startsWith("angular-") ? "log-angular" : "log-spring",
        {
          micro: processKey.replace(/^angular-|^spring-/, ""),
          log: `${processKey} process killed.`,
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
        log: `⚠️ No hay proceso activo para ${processKey}.`,
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
      password: userData.password ? '[PRESENTE]' : '[AUSENTE]'
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
      // Para que --disable-web-security funcione se requiere --user-data-dir
      // También habilitamos el puerto de depuración remota para poder inyectar el script de autologin.
      const userDataDir = path.join(os.tmpdir(), 'chrome-autologin');
      const chromeArgs = [
        '--incognito',
        `--user-data-dir=${userDataDir}`,
        '--remote-debugging-port=9222',
        portalUrl
      ];

      console.log('� Abriendo Chrome con autologin:', chromePath);
      console.log('📋 Argumentos:', chromeArgs.join(' '));

      const chromeProcess = spawn(chromePath, chromeArgs, {
        detached: true,
        stdio: 'ignore'
      });

      chromeProcess.unref();

      try {
        // Esperar a que el puerto de depuración esté disponible
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const client = await CDP({ port: 9222 });
        const { Runtime, Page } = client;
        await Page.enable();
        await Page.navigate({ url: portalUrl });
        await Page.loadEventFired();
        const script = `
          document.getElementsByName('companyID')[0].value='${userData.companyID || ''}';
          document.getElementsByName('usuario')[0].value='${userData.username || ''}';
          document.getElementsByName('password')[0].value='${userData.password || ''}';
          const btn = document.querySelector('.opLogonStandardButton');
          if (btn) { btn.click(); }
        `;
        await Runtime.evaluate({ expression: script });
        await client.close();
        console.log('✅ Autologin ejecutado correctamente');
        return {
          success: true,
          message: `Chrome abierto y autologin ejecutado para ${userData.name || 'usuario'}.`
        };
      } catch (automationError) {
        console.error('❌ Error durante autologin:', automationError);
        return {
          success: false,
          message: 'Error durante el autologin: ' + automationError.message
        };
      }
    } else {
      // Fallback: usar navegador por defecto si Chrome no se encuentra
      console.log('⚠️ Chrome no encontrado, usando navegador por defecto');
      await shell.openExternal(portalUrl);
      
      return { 
        success: true, 
        message: `Portal abierto en navegador por defecto para ${userData.name || 'usuario'}.

Datos para login manual:
Company: ${userData.companyID || 'N/A'}
Usuario: ${userData.username || 'N/A'}
Contraseña: ${userData.password || 'N/A'}` 
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
