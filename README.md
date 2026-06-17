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

1. Inside your newly created `hatch-track-desktop` folder, create two empty subfolders named `frontend` and `backend`:
   ```bash
   mkdir frontend
   mkdir backend
   ```
2. Move your compiled files into these folders:
   - Copy the `backend.jar` file you generated in **Step 1** and paste it directly inside the `backend/` folder.
   - Copy the **entire contents** of the React `dist/` folder generated in **Step 2** and paste them directly inside the `frontend/` folder.

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

---

### Step 5: Understanding How `main.js` Works

Create a file named `main.js` in the root of your `hatch-track-desktop` folder and paste the following code:

```javascript
const { app, BrowserWindow } = require("electron");
const path = require("path");
const exec = require("child_process").exec;

let mainWindow;
let backendProcess;

function startBackend() {
  const isPackaged = app.isPackaged;

  // Routes to the unpacked directory if running from a built production package
  const jarPath = isPackaged
    ? path.join(__dirname, "..", "app.asar.unpacked", "backend", "backend.jar")
    : path.join(__dirname, "backend", "backend.jar");

  console.log("Launching backend from: ", jarPath);

  // Spawns the Java jar as a background process natively
  backendProcess = exec(`java -jar "${jarPath}"`, (err, stdout, stderr) => {
    if (err) {
      console.error(`Backend failed to start: ${err}`);
      return;
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Loads your React frontend application static index.html file
  mainWindow.loadFile(path.join(__dirname, "frontend", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Execution triggers here when Electron initializes
app.whenReady().then(() => {
  startBackend();
  // Gives the Spring Boot app 4 seconds to warm up before opening the UI window
  setTimeout(createWindow, 4000);
});

// Gracefully clean up child processes on app exit
app.on("window-all-closed", () => {
  if (backendProcess) {
    backendProcess.kill(); // Kills the background java process safely
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
```

#### Explanation of the Mechanics

- **ASAR Unpacking**: Production Electron apps compress files into an internal `app.asar` file. Because the native computer Java runtime cannot execute a `.jar` file trapped inside a compressed Electron archive, `main.js` uses conditional path logic to look inside the uncompressed folder (`app.asar.unpacked`) created during the build phase.
- **Background Process Spawning**: Node's native `child_process.exec` executes the command `java -jar "backend.jar"` silently in the background. This allows your Spring Boot app to boot without opening a separate terminal window on the user's screen.
- **Startup Delay Buffer**: Since Spring Boot takes a few seconds to fully initialize and open port 8080, a 4000ms (4 seconds) timeout loop delays `createWindow()`. This prevents the React UI from trying to fetch data from a backend that isn't fully awake yet.
- **Process Termination Safety**: If you close an Electron app without killing its child processes, the Spring Boot Java server will remain active in your computer's background processes (creating a "Zombie Process"). When the window closes, `backendProcess.kill()` kills the background Java app to free up system memory and local ports.

---

### Step 6: Process to Create `.exe` and `.dmg` Files

Because you are using an Apple Silicon macOS system, your machine is capable of compiling packaging configurations for both Windows and Mac from this single directory.

Open your `package.json` file inside the `hatch-track-desktop` folder and replace its entire contents with this configuration:

```json
{
  "name": "Hatchery Management System Version 1.0",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder --win portable",
    "dist:mac-arm": "electron-builder --mac dmg --arm64"
  },
  "build": {
    "appId": "com.hatchtrack.app",
    "productName": "HatchTrackAdmin",
    "directories": {
      "output": "dist-desktop"
    },
    "asar": true,
    "asarUnpack": ["backend/**/*"],
    "win": {
      "target": "portable"
    },
    "mac": {
      "target": "dmg"
    },
    "files": ["main.js", "frontend/**/*", "backend/**/*"]
  }
}
```

#### Run the Build Commands

##### A. To Generate the Portable Windows Execution File (`.exe`)

Run this command in your terminal:

```bash
npm run dist
```

- **Result**: Combines your assets and builds a portable single-binary execution container inside a newly generated `dist-desktop/` folder.
- **Output File**: `dist-desktop/HatchTrackAdmin.exe`
- **Usage**: This file runs instantly on a client's Windows computer without running an installation setup wizard.

##### B. To Generate the Native Apple Silicon macOS Runtime File (`.dmg`)

Run this command in your terminal:

```bash
npm run dist:mac-arm
```

- **Result**: Compiles your workspace into a native macOS Disk Image installer optimized for M1, M2, M3, or M4 chips.
- **Output File**: `dist-desktop/HatchTrackAdmin-1.0.0.dmg`

---

## Critical End-User Configuration Warning

> [!WARNING]
> For either the `.exe` or `.dmg` file to run successfully on a customer's machine, the client's computer **MUST** have **Java 17+** installed locally and added to their system environment variables. Additionally, a database instance must be accessible as defined in your backend connection settings.
