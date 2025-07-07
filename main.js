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
    env.NODE_OPTIONS = "--openssl-legacy-provider"
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

// Lanzar Spring
ipcMain.on("start-spring", (event, data) => {
  const processKey = `spring-${data.micro || "default"}`;

  if (processes[processKey]) {
    mainWindow.webContents.send("log-spring", {
      micro: data.micro || "default",
      log: `Micro Spring ya está en ejecución.`,
    });
    return;
  }

  // Si no hay JAVA_HOME definida, avisamos y salimos
  if (!process.env.JAVA_HOME) {
    mainWindow.webContents.send("log-spring", {
      micro: data.micro || "default",
      log: `❌ No se ha encontrado JAVA_HOME. No se puede arrancar el micro Spring.`,
      status: "stopped",
    });
    return;
  }

  const javaHome = process.env.JAVA_HOME.replace(/^"(.*)"$/, "$1"); // quitar comillas si las hubiera

  mainWindow.webContents.send("log-spring", {
    micro: data.micro || "default",
    log: `Lanzando Spring...`,
    status: "starting",
  });

  springStatus[data.micro || "default"] = "starting";

  const mvnCmd = fs.existsSync(path.join(data.path, "mvnw.cmd"))
    ? "mvnw.cmd"
    : "mvn";

  const springProcess = spawn(mvnCmd, ["spring-boot:run"], {
    cwd: data.path,
    shell: true,
    env: {
      ...process.env,
      JAVA_HOME: javaHome,
      PATH: `${javaHome}\\bin;${process.env.PATH}`,
    },
  });

  processes[processKey] = springProcess;

  springProcess.stdout.on("data", (dataLog) => {
    const logClean = stripAnsi(dataLog.toString());

    const isRunning = logClean.includes("Started") && logClean.includes("in");

    mainWindow.webContents.send("log-spring", {
      micro: data.micro || "default",
      log: logClean,
      status: isRunning ? "running" : undefined,
    });

    if (isRunning) {
      springStatus[data.micro || "default"] = "running";
    }
  });

  springProcess.stderr.on("data", (dataLog) => {
    const logClean = stripAnsi(dataLog.toString());
    mainWindow.webContents.send("log-spring", {
      micro: data.micro || "default",
      log: logClean,
    });
  });

  springProcess.on("close", (code) => {
    mainWindow.webContents.send("log-spring", {
      micro: data.micro || "default",
      log: `Spring process exited with code ${code}`,
      status: "stopped",
    });
    springStatus[data.micro || "default"] = "stopped";
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
