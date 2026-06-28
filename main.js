const {
  app,
  BrowserWindow,
  protocol,
  net,
  Menu,
  shell,
  dialog,
  ipcMain,
  session,
} = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const fs = require("fs");
const http = require("http");

// ==========================================
// TRIAL PERIOD CONFIGURATION SETTINGS
// ==========================================
const TRIAL_SETTINGS = {
  enabled: true, // Toggle trial period checks
  durationDays: 12, // Set to trial length in days (e.g. 30), or null to use minutes
  durationMinutes: null, // Set to trial length in minutes for testing (e.g. 5)
  // Configurable template for the application title bar
  titleTemplate:
    "{title} (Trial Version: {remaining} remaining of {duration} trial)",
};
// ==========================================

let trialStartDate = null;
let lastRawPageTitle = "";

function getFormattedTrialTitle(pageTitle) {
  const version = app.getVersion();
  if (!TRIAL_SETTINGS.enabled || !trialStartDate) {
    return pageTitle || `Hatchery Management System Version ${version}`;
  }

  const now = new Date();

  // Calculate total duration in ms
  let durationMs = 0;
  let durationText = "";
  if (
    TRIAL_SETTINGS.durationDays !== null &&
    TRIAL_SETTINGS.durationDays !== undefined
  ) {
    durationMs = TRIAL_SETTINGS.durationDays * 24 * 60 * 60 * 1000;
    durationText = `${TRIAL_SETTINGS.durationDays} day${TRIAL_SETTINGS.durationDays > 1 ? "s" : ""}`;
  } else if (
    TRIAL_SETTINGS.durationMinutes !== null &&
    TRIAL_SETTINGS.durationMinutes !== undefined
  ) {
    durationMs = TRIAL_SETTINGS.durationMinutes * 60 * 1000;
    durationText = `${TRIAL_SETTINGS.durationMinutes} minute${TRIAL_SETTINGS.durationMinutes > 1 ? "s" : ""}`;
  }

  const expirationDate = new Date(trialStartDate.getTime() + durationMs);
  const remainingMs = expirationDate.getTime() - now.getTime();

  let remainingText = "Expired";
  if (remainingMs > 0) {
    if (
      TRIAL_SETTINGS.durationDays !== null &&
      TRIAL_SETTINGS.durationDays !== undefined
    ) {
      const remainingDays = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
      if (remainingDays >= 1) {
        remainingText = `${remainingDays} day${remainingDays > 1 ? "s" : ""}`;
      } else {
        const remainingMins = Math.ceil(remainingMs / (60 * 1000));
        remainingText = `${remainingMins} minute${remainingMins > 1 ? "s" : ""}`;
      }
    } else {
      const remainingMins = Math.ceil(remainingMs / (60 * 1000));
      remainingText = `${remainingMins} minute${remainingMins > 1 ? "s" : ""}`;
    }
  }

  const template =
    TRIAL_SETTINGS.titleTemplate ||
    "{title} (Trial Version: {remaining} remaining of {duration} trial)";
  const baseTitle = pageTitle || "Hatchery Management System";

  return template
    .replace("{title}", baseTitle)
    .replace("{version}", version)
    .replace("{remaining}", remainingText)
    .replace("{duration}", durationText);
}

function checkTrialStatus() {
  if (!TRIAL_SETTINGS.enabled) {
    return { expired: false };
  }

  const trialPath = path.join(app.getPath("userData"), ".app_state.json");
  let startDateStr;

  if (fs.existsSync(trialPath)) {
    try {
      const data = fs.readFileSync(trialPath, "utf8");
      // Decrypt the obfuscated base64 data
      const decrypted = Buffer.from(data, "base64").toString("utf8");
      const trialInfo = JSON.parse(decrypted);
      startDateStr = trialInfo.startDate;
    } catch (e) {
      console.error("Failed to read trial configuration:", e);
    }
  }

  // If no start date exists, record the current time as the start date (first launch/installation)
  if (!startDateStr) {
    startDateStr = new Date().toISOString();
    try {
      const data = JSON.stringify({ startDate: startDateStr }, null, 2);
      // Encrypt/obfuscate the data with base64
      const obfuscated = Buffer.from(data).toString("base64");
      fs.writeFileSync(trialPath, obfuscated, "utf8");
    } catch (e) {
      console.error("Failed to save trial configuration:", e);
    }
  }

  const startDate = new Date(startDateStr);
  trialStartDate = startDate; // Cache start date in memory
  const now = new Date();

  // Determine trial duration in milliseconds
  let durationMs = 0;
  if (
    TRIAL_SETTINGS.durationDays !== null &&
    TRIAL_SETTINGS.durationDays !== undefined
  ) {
    durationMs = TRIAL_SETTINGS.durationDays * 24 * 60 * 60 * 1000;
  } else if (
    TRIAL_SETTINGS.durationMinutes !== null &&
    TRIAL_SETTINGS.durationMinutes !== undefined
  ) {
    durationMs = TRIAL_SETTINGS.durationMinutes * 60 * 1000;
  }

  const expirationDate = new Date(startDate.getTime() + durationMs);

  // Clock rollback detection: current time is before the recorded startup time
  if (now < startDate) {
    return {
      expired: true,
      reason:
        "System clock rollback detected. Please correct your system time.",
    };
  }

  if (now >= expirationDate) {
    return {
      expired: true,
      reason:
        "Trial period expired. Please contact software provider for support.",
    };
  }

  return { expired: false };
}

function createTrialExpiredWindow() {
  createMenu();
  mainWindow = new BrowserWindow({
    width: 650,
    height: 450,
    resizable: false,
    minimizable: true,
    maximizable: false,
    show: false, // Prevent white flash
    backgroundColor: "#0f172a", // Match theme
    title: "Trial Period Expired",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "frontend", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL("app:///trial_expired.html");

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

let trialCheckInterval = null;

function startLiveTrialCheck() {
  if (!TRIAL_SETTINGS.enabled) return;

  if (trialCheckInterval) {
    clearInterval(trialCheckInterval);
  }

  trialCheckInterval = setInterval(() => {
    const trial = checkTrialStatus();
    if (trial.expired) {
      clearInterval(trialCheckInterval);
      trialCheckInterval = null;

      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBoxSync(mainWindow, {
          type: "warning",
          title: "Trial Period Expired",
          message: "Trial period expired.",
          detail: "Please contact software provider for support.",
          buttons: ["OK"],
        });

        killBackend(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy();
          }
          createTrialExpiredWindow();
        });
      }
    } else {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle(getFormattedTrialTitle(lastRawPageTitle));
      }
    }
  }, 5000); // Check and update title every 5 seconds
}

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

let isBackendStarting = false;
let startTimeoutId = null;
let lastStartupError = null;
let isIntentionallyStopping = false;

function checkBackendHealth(port, callback) {
  const options = {
    hostname: "localhost",
    port: port,
    path: "/",
    method: "GET",
    timeout: 1000,
  };

  const req = http.request(options, (res) => {
    // If it responds, it means the server is listening!
    callback(true);
  });

  req.on("error", () => {
    callback(false);
  });

  req.on("timeout", () => {
    req.destroy();
    callback(false);
  });

  req.end();
}

function waitForBackend(port, maxAttempts, delayMs, callback) {
  let attempts = 0;

  function poll() {
    if (!isBackendStarting) {
      console.log("Backend start aborted. Stopping health check.");
      callback(false);
      return;
    }

    attempts++;
    console.log(
      `Checking backend health (attempt ${attempts}/${maxAttempts})...`,
    );
    checkBackendHealth(port, (isAlive) => {
      if (isAlive) {
        console.log("Backend is online!");
        callback(true);
      } else if (attempts >= maxAttempts) {
        console.log(
          "Reached maximum health check attempts. Backend did not start.",
        );
        callback(false);
      } else {
        if (isBackendStarting) {
          setTimeout(poll, delayMs);
        } else {
          console.log(
            "Backend start aborted before next poll. Stopping health check.",
          );
          callback(false);
        }
      }
    });
  }

  poll();
}



function getJavaExecutablePath() {
  if (process.platform !== "darwin") {
    return "java";
  }

  const { execSync } = require("child_process");
  const fs = require("fs");

  const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin"];

  try {
    const javaHome = execSync("/usr/libexec/java_home", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
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
    console.warn(
      "Failed to find java via /usr/libexec/java_home:",
      err.message,
    );
  }

  const currentPath = process.env.PATH || "";
  const newPaths = extraPaths.filter((p) => !currentPath.includes(p));
  if (newPaths.length > 0) {
    process.env.PATH = `${newPaths.join(":")}:${currentPath}`;
  }

  const commonPaths = [
    "/opt/homebrew/bin/java",
    "/usr/local/bin/java",
    "/usr/bin/java",
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

  const jarPath = isPackaged
    ? path.join(__dirname, "..", "app.asar.unpacked", "backend", "backend.jar")
    : path.join(__dirname, "backend", "backend.jar");

  const javaPath = getJavaExecutablePath();
  console.log("Launching backend using:", javaPath, "from jar:", jarPath);

  logFilePath = path.join(app.getPath("userData"), "backend.log");
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  logStream.write(
    `\n--- Backend Log Started: ${new Date().toISOString()} ---\n`,
  );
  logStream.write(`Launching backend with Java command: ${javaPath}\n`);
  logStream.write(`JAR Path: ${jarPath}\n`);

  const { spawn } = require("child_process");

  isBackendStarting = true;
  lastStartupError = null;

  backendProcess = spawn(javaPath, ["-jar", jarPath]);

  backendProcess.stdout.pipe(logStream);
  backendProcess.stderr.pipe(logStream);

  backendProcess.on("error", (err) => {
    console.error(`Backend failed to start: ${err}`);
    logStream.write(`Backend failed to start: ${err}\n`);
    isBackendStarting = false;

    if (startTimeoutId) {
      clearTimeout(startTimeoutId);
      startTimeoutId = null;
    }

    dialog.showErrorBox(
      "Java Runtime Environment Missing",
      `Failed to launch the backend server.\n\n` +
      `Executable attempted: "${javaPath}"\n` +
      `Error details: ${err.message}\n\n` +
      `Requirements:\n` +
      `- Hatch-Track requires Java 17 or higher to be installed and available in the system PATH.\n\n` +
      `Log File location:\n` +
      `"${logFilePath}"`
    );
  });

  backendProcess.on("exit", (code, signal) => {
    logStream.write(
      `Backend process exited with code ${code} and signal ${signal}\n`,
    );
    isBackendStarting = false;
    backendProcess = null;

    if (startTimeoutId) {
      clearTimeout(startTimeoutId);
      startTimeoutId = null;
    }

    const wasIntentional = isIntentionallyStopping;
    isIntentionallyStopping = false; // Reset flag

    if (code !== 0 && code !== null && !isQuitting && !wasIntentional) {
      dialog.showErrorBox(
        "Backend Server Terminated",
        `The backend server exited unexpectedly with code ${code}.\n\n` +
        `Possible causes:\n` +
        `1. Port 8080 is already in use by another program (e.g. docker, local dev server, or a zombie Java process).\n` +
        `2. The database server is unreachable or offline.\n` +
        `3. An incompatible Java version is installed (Java 17+ is required).\n\n` +
        `Please inspect the detailed logs at:\n` +
        `"${logFilePath}"\n\n` +
        `Troubleshooting:\n` +
        `- Free up port 8080 and restart the application.\n` +
        `- Verify database connectivity.`
      );
    }
  });
}

function killBackend(callback) {
  if (!backendProcess) {
    if (callback) callback();
    return;
  }

  if (
    backendProcess.exitCode !== null &&
    backendProcess.exitCode !== undefined
  ) {
    backendProcess = null;
    if (callback) callback();
    return;
  }

  console.log(`Terminating backend process with PID: ${backendProcess.pid}`);
  isIntentionallyStopping = true;

  backendProcess.once("exit", () => {
    backendProcess = null;
    if (callback) callback();
  });

  if (process.platform === "win32") {
    try {
      const { execSync } = require("child_process");
      execSync(`taskkill /pid ${backendProcess.pid} /t /f`, {
        stdio: "ignore",
      });
    } catch (e) {
      console.warn(
        "Failed to taskkill process tree, falling back to process.kill():",
        e.message,
      );
      backendProcess.kill();
    }
  } else {
    backendProcess.kill();
  }
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }
  createMenu();

  lastRawPageTitle = `Hatchery Management System Version ${app.getVersion()}`;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Prevent white flash
    backgroundColor: "#0f172a", // Match theme
    title: getFormattedTrialTitle(lastRawPageTitle),
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "frontend", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Intercept renderer document title changes and append trial status
  mainWindow.on("page-title-updated", (event, title) => {
    event.preventDefault();
    lastRawPageTitle = title;
    mainWindow.setTitle(getFormattedTrialTitle(title));
  });

  mainWindow.loadURL("app:///index.html");

  // Safety: if the page fails to load (e.g. missing file), show the window anyway
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load ${validatedURL}: ${errorDescription} (code: ${errorCode})`);
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;

    event.preventDefault();

    const response = dialog.showMessageBoxSync(mainWindow, {
      type: "question",
      buttons: ["Yes", "No"],
      defaultId: 1,
      cancelId: 1,
      title: "Confirm Exit",
      message: "Are you sure you want to close Hatchery Management System?",
      detail:
        "This will terminate all running services related to the application.",
    });

    if (response === 0) {
      isQuitting = true;
      killBackend();
      app.quit();
    }
  });

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

    // Normalize custom protocol routing (e.g. app://trial_expired.html/ -> trial_expired.html)
    if (
      (pathname === "/" || pathname === "") &&
      url.hostname &&
      url.hostname !== ""
    ) {
      pathname = "/" + url.hostname;
    }

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

  // Enforce trial period checks before setting up database or starting backend
  const trial = checkTrialStatus();
  if (trial.expired) {
    createTrialExpiredWindow();
    return;
  }

  startBackend();

  waitForBackend(8080, 180, 500, (online) => {
    isBackendStarting = false;
    if (online) {
      createWindow();
      startLiveTrialCheck();
    } else {
      dialog.showErrorBox(
        "Backend Service Startup Timed Out",
        "The backend server took too long to start. Please check Java installation and logs."
      );
    }
  });
});

ipcMain.on("close-app", () => {
  isQuitting = true;
  killBackend();
  app.quit();
});

// Gracefully clean up child processes on app exit
app.on("window-all-closed", () => {
  isQuitting = true;
  killBackend();
  app.quit();
});

// Ensure backend is killed under any other normal exit path
app.on("will-quit", () => {
  if (trialCheckInterval) {
    clearInterval(trialCheckInterval);
  }
  killBackend();
});
