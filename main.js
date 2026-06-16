const { app, BrowserWindow } = require('electron');
const path = require('path');
const exec = require('child_process').exec;

let mainWindow;
let backendProcess;

function startBackend() {
  const isPackaged = app.isPackaged;
  
  // Routes to the unpacked directory if running from a built application package
  const jarPath = isPackaged
    ? path.join(__dirname, '..', 'app.asar.unpacked', 'backend', 'backend.jar')
    : path.join(__dirname, 'backend', 'backend.jar');

  console.log("Launching backend from: ", jarPath);

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
      contextIsolation: true
    }
  });

  // Loads your React frontend application static index.html
  mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));

  // Open DevTools automatically during troubleshooting (Optional)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start backend and initialize window
app.whenReady().then(() => {
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