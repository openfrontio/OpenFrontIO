const { app, BrowserWindow } = require("electron");
const path = require("path");

// Keep a global reference of the window object
let mainWindow = null;

const GAME_SERVER_URL = "http://openfront.io";

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Maximize the window
  mainWindow.maximize();
  mainWindow.show();
  // Automatically open DevTools when the window is created
  // mainWindow.webContents.openDevTools();

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      const { requestHeaders } = details;
      requestHeaders["X-Electron-App"] = "true";
      callback({ requestHeaders });
    },
  );

  // Load directly from your server
  mainWindow.loadURL(GAME_SERVER_URL);

  // Add keyboard shortcut to toggle fullscreen (F11 or F)
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F11" || (input.key === "f" && input.control)) {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    } else if (input.key === "Escape" && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      event.preventDefault();
    }
  });

  // Handle window being closed
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.session.setCacheSize(1024 * 1024 * 100); // 100MB cache
}

// Create window when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
