# Hatch-Track Desktop Application Build & Packaging Guide

Welcome to the packaging and deployment guide for the **Hatch-Track Desktop Application**. This document provides a step-by-step walkthrough of how to package the Spring Boot backend and the React frontend into a unified, standalone desktop application using Electron and Electron Builder.

---

## Overview of the Architecture

The desktop application wraps two main components:

1. **Spring Boot Backend**: Runs as a background process (`backend.jar`).
2. **React Frontend**: Loaded as a static web application (`index.html` and assets) via Electron's `BrowserWindow`.

---

## Step-by-Step Setup

### Step 1: Generate the Executable JAR File in Spring Boot

1. Open your terminal and navigate to your Spring Boot project root directory (the folder containing the `pom.xml` file).
2. Run the following Maven command:
   ```bash
   mvn clean package
   ```

#### Command Explanation

- **`clean`**: Wipes out the old `target/` folder, deleting old compiled classes and cached assets so they don't corrupt your new build.
- **`package`**: Compiles your Java code, runs your unit tests, and packages the verified code into a deployable JAR file.

#### Output Artifact

Once the command finishes, your executable JAR file will be generated inside the newly created `target/` folder:

- **Path**: `target/hatch-track-backend-0.0.1-SNAPSHOT.jar`

#### Preparation for Electron

- Rename that generated `.jar` file to exactly: **`backend.jar`**
- Keep it ready to move into the Electron project later.

---

### Step 2: Create the React Production Build

1. Open your React project root directory (the folder containing `package.json` and `vite.config.js`).

> [!IMPORTANT]
> **Crucial Prerequisite:** Open your `vite.config.js` file and ensure the `base` property is set to relative routing (`./`). If this is missing, Electron will show a blank white screen because it won't find the assets on the local disk.

Your `vite.config.js` should look like this:

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  base: "./", // <--- This forces relative asset paths (./) instead of absolute (/)
  plugins: [react(), svgr()],
});
```

2. Run the production build command in your terminal:
   ```bash
   npm run build
   ```

#### Command Explanation

This command compiles and compresses your React code, runs tree-shaking optimization to remove dead code, and generates optimized static web assets.

#### Output Artifact

A new folder named `dist/` will be created at your React project root, containing `index.html` and an `assets/` folder. Keep this folder ready.

---

### Step 3: Create and Initialize the Electron Project

You need to create a completely separate project directory that will act as the master wrapper for both your backend and frontend.

1. Open a new terminal window, navigate to your workspace folder, and run these commands to create and initialize the project:
   ```bash
   mkdir hatch-track-desktop
   cd hatch-track-desktop
   npm init -y
   ```
2. Install Electron and Electron-Builder as development dependencies:
   ```bash
   npm install electron --save-dev
   npm install electron-builder --save-dev
   ```

---

### Step 4: Add Frontend and Backend Files into the Electron Project

1. Inside your newly created `hatch-track-desktop` (or the Electron wrapper project directory), create two empty subfolders named `frontend` and `backend`:
   ```bash
   mkdir frontend
   mkdir backend
   ```
2. Move your compiled files into these folders:
   - Copy the `backend.jar` file you generated in **Step 1** and paste it directly inside the [backend/](file:///d:/Private_Work/React_Train/Commercial/project_space/electron-js-desktop-app/backend) folder.
   - Copy the **entire contents** of the React `dist/` folder generated in **Step 2** and paste them directly inside the [frontend/](file:///d:/Private_Work/React_Train/Commercial/project_space/electron-js-desktop-app/frontend) folder.

#### Final Folder Structure

Your final project folder structure **must** look exactly like this:

```text
hatch-track-desktop/
├── package.json
├── main.js
├── backend/
│   └── backend.jar
└── frontend/
    ├── index.html (This must sit right here, not nested deeper)
    ├── assets/
    └── ...
```

#### Complete End-to-End Build and Setup Example (Windows)

To help visualize how the files flow, let's look at a concrete example. Assume you have three project folders on your machine:
* **Spring Boot Backend Repo**: `C:\projects\hatch-track-backend`
* **React Frontend Repo**: `C:\projects\hatch-track-frontend`
* **Electron Wrapper Repo**: `C:\projects\electron-js-desktop-app` (Your current workspace)

Here are the automated commands you can run to compile, copy, and bundle everything into an executable `.exe` file.

##### Option A: Using Windows PowerShell (Recommended)
```powershell
# 1. Compile the Spring Boot backend
cd "C:\projects\hatch-track-backend"
mvn clean package

# 2. Build the React frontend
cd "C:\projects\hatch-track-frontend"
npm run build

# 3. Navigate to the Electron project and prepare directories
cd "C:\projects\electron-js-desktop-app"
mkdir -Force backend
mkdir -Force frontend

# 4. Copy backend JAR file into backend/ and rename it to backend.jar
Copy-Item -Path "C:\projects\hatch-track-backend\target\hatch-track-backend-0.0.1-SNAPSHOT.jar" -Destination "C:\projects\electron-js-desktop-app\backend\backend.jar" -Force

# 5. Clean up old frontend folder in Electron (if any) and copy the new production dist contents
Remove-Item -Path "C:\projects\electron-js-desktop-app\frontend\*" -Recurse -ErrorAction SilentlyContinue
Copy-Item -Path "C:\projects\hatch-track-frontend\dist\*" -Destination "C:\projects\electron-js-desktop-app\frontend\" -Recurse -Force

# 6. Build the Windows Setup Installer (.exe)
npm run dist:win
```

##### Option B: Using Windows Command Prompt (CMD)
```cmd
:: 1. Compile the Spring Boot backend
cd /d C:\projects\hatch-track-backend
call mvn clean package

:: 2. Build the React frontend
cd /d C:\projects\hatch-track-frontend
call npm run build

:: 3. Navigate to the Electron project and prepare directories
cd /d C:\projects\electron-js-desktop-app
if not exist backend mkdir backend
if not exist frontend mkdir frontend

:: 4. Copy backend JAR file and rename it
copy /y "C:\projects\hatch-track-backend\target\hatch-track-backend-0.0.1-SNAPSHOT.jar" "C:\projects\electron-js-desktop-app\backend\backend.jar"

:: 5. Copy frontend build files
xcopy /y /e /i "C:\projects\hatch-track-frontend\dist\*.*" "C:\projects\electron-js-desktop-app\frontend\"

:: 6. Build the Windows Setup Installer (.exe)
npm run dist:win
```

---

### Step 5: Understanding How `main.js` Works

Create a file named [main.js](file:///d:/Private_Work/React_Train/Commercial/project_space/electron-js-desktop-app/main.js) in the root of your project folder and paste the following code:

```javascript
const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Register custom protocol 'app' as standard and secure
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow;
let backendProcess;
let logStream;
let logFilePath;

function startBackend() {
  const isPackaged = app.isPackaged;
  
  // Routes to the unpacked directory if running from a built application package
  const jarPath = isPackaged
    ? path.join(__dirname, '..', 'app.asar.unpacked', 'backend', 'backend.jar')
    : path.join(__dirname, 'backend', 'backend.jar');

  console.log("Launching backend from: ", jarPath);

  const fs = require('fs');
  logFilePath = path.join(app.getPath('userData'), 'backend.log');
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  logStream.write(`\n--- Backend Log Started: ${new Date().toISOString()} ---\n`);
  logStream.write(`Launching backend from: ${jarPath}\n`);

  const { spawn } = require('child_process');
  backendProcess = spawn('java', ['-jar', jarPath]);

  backendProcess.stdout.pipe(logStream);
  backendProcess.stderr.pipe(logStream);

  backendProcess.on('error', (err) => {
    console.error(`Backend failed to start: ${err}`);
    logStream.write(`Backend failed to start: ${err}\n`);
  });

  backendProcess.on('exit', (code, signal) => {
    logStream.write(`Backend process exited with code ${code} and signal ${signal}\n`);
  });
}

function createMenu() {
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' }
      ]
    },
    {
      label: 'Logs',
      submenu: [
        {
          label: 'View Backend Logs',
          click: () => {
            if (logFilePath) {
              shell.openPath(logFilePath).catch((err) => {
                console.error("Failed to open logs:", err);
              });
            }
          }
        },
        {
          label: 'Open Logs Folder',
          click: () => {
            shell.openPath(app.getPath('userData')).catch((err) => {
              console.error("Failed to open logs directory:", err);
            });
          }
        }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About Hatch-Track',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Hatch-Track',
              message: 'Hatchery Management System',
              detail: `Version: ${app.getVersion()}\nPowered by Electron & Spring Boot.`
            });
          }
        }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
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
    icon: path.join(__dirname, 'frontend', 'images', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Loads your React frontend application static index.html via the app protocol
  mainWindow.loadURL('app:///index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start backend and initialize window
app.whenReady().then(() => {
  // Handle custom protocol 'app' to resolve relative/absolute static paths correctly
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    }
    const relativePath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const filePath = path.join(__dirname, 'frontend', relativePath);
    return net.fetch(pathToFileURL(filePath).toString(), { bypassCustomProtocolHandlers: true });
  });

  startBackend();
  
  // Give the Spring Boot app 4 seconds to warm up before opening the UI window
  setTimeout(createWindow, 4000); 
});

// Gracefully clean up child processes on app exit
app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill(); 
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

#### Explanation of the Mechanics

- **ASAR Unpacking**: Production Electron apps compress files into an internal `app.asar` file. Because the native computer Java runtime cannot execute a `.jar` file trapped inside a compressed Electron archive, `main.js` uses conditional path logic to look inside the uncompressed folder (`app.asar.unpacked`) created during the build phase.
- **Log Streaming & Spawning**: We use `child_process.spawn` to start the Spring Boot process as a background stream instead of buffering it. The process outputs (`stdout` and `stderr`) are piped directly into a write stream connected to `backend.log` within the user's standard application data directory (`app.getPath('userData')`).
- **Interactive Upper Menu**: Custom application menus are initialized and rendered through `Menu.buildFromTemplate()`. Under the **Logs** tab, users can click **View Backend Logs** or **Open Logs Folder** to open the log output files immediately using their operating system's default text editor (e.g. Notepad).
- **Custom `app://` Protocol Handling**: Standard web pages loaded via standard file routing can run into origin policy, CORS restrictions, or broken absolute paths. Registering and handling a custom `app` protocol maps `app:///` requests securely and dynamically to local assets inside the `frontend` folder, avoiding blank screens and routing errors.
- **Startup Delay Buffer**: Since Spring Boot takes a few seconds to fully initialize and open port 8080, a 4000ms (4 seconds) timeout loop delays `createWindow()`. This prevents the React UI from trying to fetch data from a backend that isn't fully awake yet.
- **Process Termination Safety**: If you close an Electron app without killing its child processes, the Spring Boot Java server will remain active in your computer's background processes (creating a "Zombie Process"). When the window closes, `backendProcess.kill()` kills the background Java app to free up system memory and local ports.

---

### Step 6: Process to Create `.exe`, `.dmg`, and AppImage Files

You can compile packaging configurations for Windows, macOS, and Linux. Note that to successfully build the macOS `.dmg` installer, you must run the build command on a macOS machine.

Open your `package.json` file inside your Electron project root and ensure it includes the following scripts and configuration:

```json
{
  "name": "hatchery-management-system",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder --win nsis",
    "dist:win": "electron-builder --win nsis",
    "dist:mac-arm": "electron-builder --mac dmg --arm64",
    "dist:mac-intel": "electron-builder --mac dmg --x64",
    "dist:mac-universal": "electron-builder --mac dmg --universal",
    "dist:linux": "electron-builder --linux AppImage"
  },
  "build": {
    "appId": "com.hatcherymanagementsystem.app",
    "productName": "Hatchery Management System",
    "directories": {
      "output": "dist-desktop"
    },
    "asar": true,
    "asarUnpack": [
      "backend/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "frontend/images/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": "always",
      "createStartMenuShortcut": true,
      "shortcutName": "Hatchery Management System",
      "deleteAppDataOnUninstall": true,
      "include": "build/installer.nsh"
    },
    "mac": {
      "target": "dmg"
    },
    "linux": {
      "target": "AppImage"
    },
    "files": [
      "main.js",
      "frontend/**/*",
      "backend/**/*"
    ]
  }
}
```

#### Run the Build Commands

##### A. To Generate the Windows Setup Installer (`.exe`)
Run this command in your terminal (can be run on Windows or macOS):
```bash
npm run dist:win
```
* **Result**: Combines assets and builds a Windows Setup Wizard Installer (.exe) inside a newly generated `dist-desktop/` folder.
* **Output File**: `dist-desktop/Hatchery Management System Setup 1.0.0.exe`
* **Usage**: This file runs a standard installation wizard that guides the user to select the installation path, shows progress, and creates standard desktop and start menu shortcuts.

##### B. To Generate macOS Installer Files (`.dmg`)
> [!IMPORTANT]
> **Host Requirement:** These commands must be run on a macOS machine.

* **For Apple Silicon Macs (M1/M2/M3/M4):**
  ```bash
  npm run dist:mac-arm
  ```
  * **Output File**: `dist-desktop/Hatchery Management System-1.0.0-arm64.dmg`

* **For Intel-based Macs:**
  ```bash
  npm run dist:mac-intel
  ```
  * **Output File**: `dist-desktop/Hatchery Management System-1.0.0.dmg`

* **Universal (Works on both architectures):**
  ```bash
  npm run dist:mac-universal
  ```
  * **Output File**: `dist-desktop/Hatchery Management System-1.0.0-universal.dmg`

##### C. To Generate the Linux AppImage File
Run this command in your terminal:
```bash
npm run dist:linux
```
* **Result**: Builds a universal self-contained AppImage executable package for Linux distributions.
* **Output File**: `dist-desktop/Hatchery Management System-1.0.0.AppImage`

---

## Critical End-User Configuration Warning

> [!WARNING]
> For either the `.exe` or `.dmg` file to run successfully on a customer's machine, the client's computer **MUST** have **Java 17+** installed locally and added to their system environment variables. Additionally, a database instance must be accessible as defined in your backend connection settings.

---

## Trial Period Settings & Configuration

The application includes a trial period enforcement mechanism. Once the trial expires, the user is prevented from opening the application or starting the database backend, and a custom "Trial Period Expired" warning page is displayed. Additionally, if the trial expires while the user is actively using the application, the app will show a native warning popup, terminate the backend server, and automatically redirect the user to the Trial Expired window.

### 1. How to Configure the Trial Settings
Trial settings can be managed directly in the [main.js](file:///d:/Private_Work/React_Train/Commercial/project_space/electron-js-desktop-app/main.js) file at the top of the script:

```javascript
const TRIAL_SETTINGS = {
  enabled: true,            // Toggle trial checks (true/false)
  durationDays: null,       // Set to the duration in days (e.g. 30), or null to use minutes
  durationMinutes: 15,      // Set to the duration in minutes for testing (e.g. 5)
  // Configurable template for the application title bar
  titleTemplate: "{title} (Trial Version: {remaining} remaining of {duration} trial)",
};
```

- **`enabled`**: If set to `false`, trial checks are skipped entirely and the app launches directly.
- **`durationDays`**: Specifies the trial length in days. In production, this should be set to your desired trial duration (e.g., `30`) and `durationMinutes` should be set to `null`.
- **`durationMinutes`**: For rapid testing, you can set `durationDays` to `null` and configure the duration in minutes (e.g., `15`).
- **`titleTemplate`**: The format of the trial notification in the application's top window title bar. It supports the following placeholders:
  - `{title}`: The page's raw document title (e.g., `Sign In | Hatchery Admin`).
  - `{version}`: The application version (e.g., `1.0.0`).
  - `{remaining}`: The remaining trial time (e.g., `12 minutes` or `14 days`).
  - `{duration}`: The total trial duration (e.g., `15 minutes` or `30 days`).

### 2. How the Trial state is Tracked
- **Storage Location**: The application records the first launch timestamp in an obfuscated format (`Base64`) within a system file named `.app_state.json` inside the user's standard application data directory:
  - **Windows**: `C:\Users\<username>\AppData\Roaming\hatchery-management-system\.app_state.json`
- **Clock Tampering Protection**: If the system clock is set back to a date earlier than the original installation date, the application will detect the rollback and treat the trial as expired.
- **Resetting the Trial (for testing)**: To reset the trial period on a test machine, delete the `.app_state.json` file in the directory above. Relaunching the application will then start a fresh trial period.

