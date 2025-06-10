const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const stripAnsi = require("strip-ansi"); // recuerda: npm install strip-ansi

let mainWindow;
let processes = {}; // GLOBAL

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadURL("http://localhost:4200");
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

// Electron Store
const Store = require("electron-store");
const store = new Store.default(); // <--- CORRECTO

// Handlers para la configuración
ipcMain.handle("get-config", () => {
  return store.get("launcherConfig", {
    angular: {
      intradia: { path: "", port: 4201 },
      upload: { path: "", port: 4202 },
      pagos: { path: "", port: 4203 },
      reportes: { path: "", port: 4204 },
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

// Lanzar Angular
ipcMain.on("start-angular", (event, data) => {
  const processKey = `angular-${data.micro}`;

  // Si ya hay un proceso para ese micro, no lo volvemos a lanzar
  if (processes[processKey]) {
    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: `⚠️ Micro ${data.micro} ya está en ejecución.`,
    });
    return;
  }

  // PRIMER LOG
  mainWindow.webContents.send("log-angular", {
    micro: data.micro,
    log: `🚀 Lanzando Angular [${data.micro}] en puerto ${data.port}...`,
  });

  const angularProcess = spawn(
    "ng.cmd",
    ["serve", "--port", data.port],
    {
      cwd: data.path,
      shell: true,
    }
  );

  processes[processKey] = angularProcess;

  angularProcess.stdout.on("data", (dataLog) => {
    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: stripAnsi(dataLog.toString()),
    });
  });

  angularProcess.stderr.on("data", (dataLog) => {
    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: stripAnsi(dataLog.toString()),
    });
  });

  angularProcess.on("close", (code) => {
    mainWindow.webContents.send("log-angular", {
      micro: data.micro,
      log: `🛑 Angular process exited with code ${code}`,
      status: 'stopped',
    });
    delete processes[processKey];
  });
});

// Lanzar Spring
ipcMain.on("start-spring", (event, data) => {
  const processKey = `spring-${data.micro || 'default'}`;

  if (processes[processKey]) {
    mainWindow.webContents.send("log-spring", {
      micro: data.micro || 'default',
      log: `⚠️ Micro Spring ya está en ejecución.`,
    });
    return;
  }

  mainWindow.webContents.send("log-spring", {
    micro: data.micro || 'default',
    log: `🚀 Lanzando Spring...`,
  });

  const springProcess = spawn(
    "cmd.exe",
    ["/c", `cd ${data.path} && mvn spring-boot:run`],
    {
      cwd: data.path,
      shell: true,
    }
  );

  processes[processKey] = springProcess;

  springProcess.stdout.on("data", (dataLog) => {
    mainWindow.webContents.send("log-spring", {
      micro: data.micro || 'default',
      log: stripAnsi(dataLog.toString()),
    });
  });

  springProcess.stderr.on("data", (dataLog) => {
    mainWindow.webContents.send("log-spring", {
      micro: data.micro || 'default',
      log: stripAnsi(dataLog.toString()),
    });
  });

  springProcess.on("close", (code) => {
    mainWindow.webContents.send("log-spring", {
      micro: data.micro || 'default',
      log: `🛑 Spring process exited with code ${code}`,
      status: 'stopped',
    });
    delete processes[processKey];
  });
});

// Parar proceso (Angular o Spring)
ipcMain.on("stop-process", (event, processKey) => {
  if (processes[processKey]) {
    mainWindow.webContents.send(processKey.startsWith("angular-") ? "log-angular" : "log-spring", {
      micro: processKey.replace(/^angular-|^spring-/, ""),
      log: `🛑 Parando proceso ${processKey}...`,
    });

    // Parar proceso con SIGKILL (fuerte)
    processes[processKey].kill("SIGKILL");

    // Notificar parada
    mainWindow.webContents.send(processKey.startsWith("angular-") ? "log-angular" : "log-spring", {
      micro: processKey.replace(/^angular-|^spring-/, ""),
      log: `${processKey} process killed.`,
      status: 'stopped',
    });

    delete processes[processKey];
  } else {
    // Si no existe el proceso, notificar
    mainWindow.webContents.send(processKey.startsWith("angular-") ? "log-angular" : "log-spring", {
      micro: processKey.replace(/^angular-|^spring-/, ""),
      log: `⚠️ No hay proceso activo para ${processKey}.`,
    });
  }
});
