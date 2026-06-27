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
  durationDays: null, // Set to trial length in days (e.g. 30), or null to use minutes
  durationMinutes: 15, // Set to trial length in minutes for testing (e.g. 5)
};
// ==========================================

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
    title: "Trial Period Expired",
    icon: path.join(__dirname, "frontend", "images", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "frontend", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL("app:///trial_expired.html");

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
    }
  }, 10000); // Check every 10 seconds
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

// Configurable DB variables
let dbConfig = null;
let isBackendStarting = false;
let startTimeoutId = null;
let lastStartupError = null;
let isIntentionallyStopping = false;

const configPath = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, "utf8");
      dbConfig = JSON.parse(data);
    } catch (e) {
      console.error("Failed to load configuration:", e);
    }
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
    dbConfig = config;
    return true;
  } catch (e) {
    console.error("Failed to save configuration:", e);
    return false;
  }
}

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

function setupRequestInterception() {
  const port = dbConfig && dbConfig.apiPort ? dbConfig.apiPort : 8080;

  // Clear any existing listeners
  session.defaultSession.webRequest.onBeforeRequest(null);

  if (port !== 8080) {
    console.log(
      `Setting up request redirection from port 8080 to configured port ${port}`,
    );
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://localhost:8080/*"] },
      (details, callback) => {
        const redirectUrl = details.url.replace(
          "http://localhost:8080",
          `http://localhost:${port}`,
        );
        callback({ redirectURL: redirectUrl });
      },
    );
  } else {
    console.log(
      "Using default API port 8080, no webRequest redirection needed.",
    );
  }
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

  const args = ["-jar", jarPath];
  if (dbConfig) {
    if (dbConfig.dbUrl) {
      args.push(`--spring.datasource.url=${dbConfig.dbUrl}`);
      logStream.write(`Override DB URL: ${dbConfig.dbUrl}\n`);
    }
    if (dbConfig.dbUser) {
      args.push(`--spring.datasource.username=${dbConfig.dbUser}`);
      logStream.write(`Override DB User: ${dbConfig.dbUser}\n`);
    }
    if (dbConfig.dbPassword) {
      args.push(`--spring.datasource.password=${dbConfig.dbPassword}`);
      logStream.write(`Override DB Password: [HIDDEN]\n`);
    }
    if (dbConfig.apiPort) {
      args.push(`--server.port=${dbConfig.apiPort}`);
      logStream.write(`Override Server Port: ${dbConfig.apiPort}\n`);
    }
  }

  isBackendStarting = true;
  lastStartupError = null;

  backendProcess = spawn(javaPath, args);

  backendProcess.stdout.pipe(logStream);
  backendProcess.stderr.pipe(logStream);

  let stderrBuffer = "";
  backendProcess.stderr.on("data", (data) => {
    stderrBuffer += data.toString();
  });

  backendProcess.on("error", (err) => {
    console.error(`Backend failed to start: ${err}`);
    logStream.write(`Backend failed to start: ${err}\n`);
    isBackendStarting = false;
    lastStartupError = err.message;

    if (startTimeoutId) {
      clearTimeout(startTimeoutId);
      startTimeoutId = null;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("start-progress", { error: err.message });
      if (!mainWindow.getURL().includes("config.html")) {
        mainWindow.loadFile(path.join(__dirname, "frontend", "config.html"));
      }
    } else {
      createWindow();
    }
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
      let errorReason = "Connection failed or port already in use.";
      if (stderrBuffer.includes("Address already in use")) {
        errorReason = "The API port is already in use by another program.";
      } else if (
        stderrBuffer.includes("Connection refused") ||
        stderrBuffer.includes("FATAL: password authentication failed")
      ) {
        errorReason =
          "Failed to connect to the database. Verify your URL, username, and password.";
      } else if (stderrBuffer.includes("Driver")) {
        errorReason =
          "Database driver error. Verify database URL configuration.";
      }

      lastStartupError = errorReason;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("start-progress", { error: errorReason });
        if (!mainWindow.getURL().includes("config.html")) {
          mainWindow.loadFile(path.join(__dirname, "frontend", "config.html"));
        }
      } else {
        createWindow();
      }
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
      label: "Database",
      submenu: [
        // {
        //   label: "Backup Database",
        //   click: () => {
        //     if (mainWindow) {
        //       const port =
        //         dbConfig && dbConfig.apiPort ? dbConfig.apiPort : 8080;
        //       mainWindow.webContents.downloadURL(
        //         `http://localhost:${port}/api/v1/backup/download`,
        //       );
        //     }
        //   },
        // },
        {
          label: "Database Settings",
          click: () => {
            if (mainWindow) {
              lastStartupError = null;
              killBackend(() => {
                mainWindow.loadFile(
                  path.join(__dirname, "frontend", "config.html"),
                );
              });
            }
          },
        },
      ],
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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `Hatchery Management System Version ${app.getVersion()}`,
    icon: path.join(__dirname, "frontend", "images", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "frontend", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (lastStartupError) {
    mainWindow.loadFile(path.join(__dirname, "frontend", "config.html"));
  } else {
    mainWindow.loadURL("app:///index.html");
  }

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

  loadConfig();

  // Enforce trial period checks before setting up database or starting backend
  const trial = checkTrialStatus();
  if (trial.expired) {
    createTrialExpiredWindow();
    return;
  }

  setupRequestInterception();
  startBackend();

  const port = dbConfig && dbConfig.apiPort ? dbConfig.apiPort : 8080;
  waitForBackend(port, 40, 500, (online) => {
    isBackendStarting = false;
    if (online) {
      createWindow();
      startLiveTrialCheck();
    } else {
      if (!lastStartupError) {
        lastStartupError =
          "Backend service startup timed out. Please check database settings.";
      }
      createWindow();
      startLiveTrialCheck();
    }
  });
});

// Helper to read backend defaults from source properties file (in dev) or fall back to production defaults
function getBackendDefaultCredentials() {
  const defaults = {
    dbUrl:
      "jdbc:postgresql://localhost:5432/hatchery?createDatabaseIfNotExist=false",
    dbUser: "postgres",
    dbPassword: "root",
    apiPort: 8080,
  };

  const devResourcesPath = path.join(
    __dirname,
    "..",
    "hatch-track-spring-backend",
    "code",
    "src",
    "main",
    "resources",
  );
  if (fs.existsSync(devResourcesPath)) {
    try {
      console.log(
        "Loading default credentials from local backend source files...",
      );
      const appPropsPath = path.join(
        devResourcesPath,
        "application.properties",
      );
      if (fs.existsSync(appPropsPath)) {
        const appPropsContent = fs.readFileSync(appPropsPath, "utf8");
        const lines = appPropsContent.split(/\r?\n/);
        let profile = "dev";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
            continue;
          }
          const parts = trimmed.split("=");
          if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts[1].trim();
            if (key === "spring.profiles.active") {
              profile = value;
              break;
            }
          }
        }

        const profilePropsPath = path.join(
          devResourcesPath,
          `application-${profile}.properties`,
        );
        if (fs.existsSync(profilePropsPath)) {
          const profilePropsContent = fs.readFileSync(profilePropsPath, "utf8");
          const profileLines = profilePropsContent.split(/\r?\n/);

          for (const line of profileLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
              continue;
            }
            const parts = trimmed.split("=");
            if (parts.length >= 2) {
              const key = parts[0].trim();
              const value = parts.slice(1).join("=").trim();

              if (key === "spring.datasource.url") defaults.dbUrl = value;
              if (key === "spring.datasource.username") defaults.dbUser = value;
              if (key === "spring.datasource.password")
                defaults.dbPassword = value;
              if (key === "server.port") {
                const portVal = parseInt(value, 10);
                if (!isNaN(portVal)) defaults.apiPort = portVal;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("Failed to parse backend source properties:", e);
    }
  }

  return defaults;
}

// IPC communication handlers
ipcMain.handle("get-config", () => {
  const backendDefaults = getBackendDefaultCredentials();

  return {
    dbUrl: dbConfig && dbConfig.dbUrl ? dbConfig.dbUrl : backendDefaults.dbUrl,
    dbUser:
      dbConfig && dbConfig.dbUser ? dbConfig.dbUser : backendDefaults.dbUser,
    dbPassword:
      dbConfig && dbConfig.dbPassword
        ? dbConfig.dbPassword
        : backendDefaults.dbPassword,
    apiPort:
      dbConfig && dbConfig.apiPort ? dbConfig.apiPort : backendDefaults.apiPort,
    lastError: lastStartupError,
  };
});

ipcMain.on("save-config", (event, config) => {
  const success = saveConfig(config);
  event.reply("config-saved", { success });

  if (success) {
    dialog.showMessageBoxSync(mainWindow, {
      type: "info",
      title: "Restart Required",
      message: "Database settings saved successfully!",
      detail:
        "The application needs to restart to apply your new settings. Clicking OK will relaunch the app.",
      buttons: ["OK"],
    });

    killBackend(() => {
      app.relaunch();
      app.exit(0);
    });
  }
});

ipcMain.on("go-back", () => {
  if (mainWindow) {
    lastStartupError = null;
    mainWindow.loadURL("app:///index.html");
  }
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
