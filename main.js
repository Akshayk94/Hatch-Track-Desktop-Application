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

let mainWindow = null;
let backendProcess;
let logStream;
let logFilePath;
let isQuitting = false;

function getJavaExecutablePath() {
  if (process.platform !== "darwin") {
    return "java";
  }

  const { execSync } = require("child_process");
  const fs = require("fs");

  // Add common macOS paths to process.env.PATH so spawn can find java if installed via Homebrew or standard installers
  const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin"];
  
  // Try to get java_home dynamically
  try {
    const javaHome = execSync("/usr/libexec/java_home", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (javaHome) {
      const javaHomeBin = path.join(javaHome, "bin");
      extraPaths.unshift(javaHomeBin);
      const javaPath = path.join(javaHomeBin, "java");
      if (fs.existsSync(javaPath)) {
        console.log("Found Java via java_home:", javaPath);
        return javaPath;
      }
    }
  } catch (err) {
    console.warn("Failed to find java via /usr/libexec/java_home:", err.message);
  }

  // Update process.env.PATH to include common directories
  const currentPath = process.env.PATH || "";
  const newPaths = extraPaths.filter(p => !currentPath.includes(p));
  if (newPaths.length > 0) {
    process.env.PATH = `${newPaths.join(":")}:${currentPath}`;
  }

  // Check common paths directly
  const commonPaths = [
    "/opt/homebrew/bin/java",
    "/usr/local/bin/java",
    "/usr/bin/java"
  ];

  for (const javaPath of commonPaths) {
    if (fs.existsSync(javaPath)) {
      console.log("Found Java at common path:", javaPath);
      return javaPath;
    }
  }

  return "java";
}

function startBackend() {
  const isPackaged = app.isPackaged;

  // Routes to the unpacked directory if running from a built application package
  const jarPath = isPackaged
    ? path.join(__dirname, "..", "app.asar.unpacked", "backend", "backend.jar")
    : path.join(__dirname, "backend", "backend.jar");

  const javaPath = getJavaExecutablePath();
  console.log("Launching backend using:", javaPath, "from jar:", jarPath);

  const fs = require("fs");
  logFilePath = path.join(app.getPath("userData"), "backend.log");
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  logStream.write(
    `\n--- Backend Log Started: ${new Date().toISOString()} ---\n`,
  );
  logStream.write(`Launching backend with Java command: ${javaPath}\n`);
  logStream.write(`JAR Path: ${jarPath}\n`);

  const { spawn } = require("child_process");
  backendProcess = spawn(javaPath, ["-jar", jarPath]);

  backendProcess.stdout.pipe(logStream);
  backendProcess.stderr.pipe(logStream);

  backendProcess.on("error", (err) => {
    console.error(`Backend failed to start: ${err}`);
    logStream.write(`Backend failed to start: ${err}\n`);

    // Show visual native dialog box error if backend failed to start
    const { dialog } = require("electron");
    dialog.showErrorBox(
      "Hatch-Track Backend Failure",
      `Failed to launch the backend server.\n\nJava executable used: ${javaPath}\nError details: ${err.message}\n\nPlease verify that Java 17+ is installed and configured on your system.`
    );
  });

  backendProcess.on("exit", (code, signal) => {
    logStream.write(
      `Backend process exited with code ${code} and signal ${signal}\n`,
    );
    if (code !== 0 && code !== null && !isQuitting) {
      const { dialog } = require("electron");
      dialog.showErrorBox(
        "Backend Server Terminated",
        `The backend process exited unexpectedly with code ${code}.\n\nThis typically happens if port 8080 is already in use by another application (like a zombie process from a previous run or another server), or if the database is unreachable.\n\nPlease free up port 8080 or check the logs, and restart Hatch-Track.`
      );
    }
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
  isQuitting = true;
  if (backendProcess) {
    backendProcess.kill();
  }
  app.quit();
});
