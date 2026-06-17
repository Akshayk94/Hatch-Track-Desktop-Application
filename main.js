const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const exec = require('child_process').exec;

// Register custom protocol 'app' as standard and secure
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

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
    title: "Hatchery Management System Version 1.0",
    icon: path.join(__dirname, 'frontend', 'images', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Loads your React frontend application static index.html via the app protocol
  mainWindow.loadURL('app:///index.html');

  // Open DevTools automatically during troubleshooting (Optional)
  // mainWindow.webContents.openDevTools();

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