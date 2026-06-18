const { app, BrowserWindow, protocol, net, Menu, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

// Register custom protocol 'app' as standard and secure
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

let mainWindow;
let backendProcess;
let logStream;
let logFilePath;

function startBackend() {
  const isPackaged = app.isPackaged;

  // Routes to the unpacked directory if running from a built application package
  const jarPath = isPackaged
    ? path.join(__dirname, "..", "app.asar.unpacked", "backend", "backend.jar")
    : path.join(__dirname, "backend", "backend.jar");

  console.log("Launching backend from: ", jarPath);

  const fs = require("fs");
  logFilePath = path.join(app.getPath("userData"), "backend.log");
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  logStream.write(
    `\n--- Backend Log Started: ${new Date().toISOString()} ---\n`,
  );
  logStream.write(`Launching backend from: ${jarPath}\n`);

  const { spawn } = require("child_process");
  backendProcess = spawn("java", ["-jar", jarPath]);

  backendProcess.stdout.pipe(logStream);
  backendProcess.stderr.pipe(logStream);

  backendProcess.on("error", (err) => {
    console.error(`Backend failed to start: ${err}`);
    logStream.write(`Backend failed to start: ${err}\n`);
  });

  backendProcess.on("exit", (code, signal) => {
    logStream.write(
      `Backend process exited with code ${code} and signal ${signal}\n`,
    );
  });
}

function createMenu() {
  const template = [
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      label: "Logs",
      submenu: [
        {
          label: "View Backend Logs",
          click: () => {
            if (logFilePath) {
              shell.openPath(logFilePath).catch((err) => {
                console.error("Failed to open logs:", err);
              });
            }
          },
        },
        {
          label: "Open Logs Folder",
          click: () => {
            shell.openPath(app.getPath("userData")).catch((err) => {
              console.error("Failed to open logs directory:", err);
            });
          },
        },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "About App",
          click: () => {
            const { dialog } = require("electron");
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About App",
              message: "Hatchery Management System",
              detail: `Version: ${app.getVersion()}\nPowered by Electron JS.`,
            });
          },
        },
      ],
    },
  ];

  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  createMenu();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `Hatchery Management System Version ${app.getVersion()}`,
    icon: path.join(__dirname, "frontend", "images", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Loads your React frontend application static index.html via the app protocol
  mainWindow.loadURL("app:///index.html");

  // Open DevTools automatically during troubleshooting (Optional)
  // mainWindow.webContents.openDevTools();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Start backend and initialize window
app.whenReady().then(() => {
  // Handle custom protocol 'app' to resolve relative/absolute static paths correctly
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname === "/" || pathname === "") {
      pathname = "/index.html";
    }
    const relativePath = pathname.startsWith("/")
      ? pathname.slice(1)
      : pathname;
    const filePath = path.join(__dirname, "frontend", relativePath);
    return net.fetch(pathToFileURL(filePath).toString(), {
      bypassCustomProtocolHandlers: true,
    });
  });

  startBackend();

  // Give the Spring Boot app 4 seconds to warm up before opening the UI window
  setTimeout(createWindow, 4000);
});

// Gracefully clean up child processes on app exit
app.on("window-all-closed", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
