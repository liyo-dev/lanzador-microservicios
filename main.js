const { app, BrowserWindow, ipcMain } = require("electron");
const { spawn } = require("child_process");
const stripAnsi = require("strip-ansi");
const kill = require("tree-kill");
const path = require("path");
const fs = require("fs");

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
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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
      upload: { path: "", port: 4200 },
      notifica: { path: "", port: 4201 },
      pagos: { path: "", port: 4202 },
      reportes: { path: "", port: 4203 },
      psd2: { path: "", port: 4204 },
      intradia: { path: "", port: 4205 },
    },
    spring: {
      upload: { path: "" },
      pagos: { path: "" },
      reportes: { path: "" },
      gateway: { path: "" },
      notifica: { path: "" },
      psd2: { path: "" },
      intradia: { path: "" },
    },
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
