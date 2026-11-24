const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const startUrl = process.env.ELECTRON_START_URL;

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    const allowedOrigins = ["http://localhost:5173", "https://accounts.google.com"];
    if (allowedOrigins.some((origin) => url.startsWith(origin))) {
      return { action: "allow" };
    }

    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (startUrl) {
    window.loadURL(startUrl);
  } else if (!app.isPackaged) {
    window.loadURL("http://localhost:5173");
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.faithscore.app");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
