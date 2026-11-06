const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("path");
const { backupDatabase } = require("./backup.cjs");

// Ensure single instance lock for POS stability
const gotTheLock = app.requestSingleInstanceLock();

let mainWindow = null;
let store = null;

// Saves a consistent copy of the database wherever the owner chooses
// (for example a USB drive). Without this, the only copy of the books is
// the one file on this computer.
async function backupNow() {
  if (!store) return;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
  const choice = await dialog.showSaveDialog(mainWindow, {
    title: "Back up database",
    defaultPath: `FuelStation-backup-${day}.sqlite`,
    filters: [{ name: "SQLite database", extensions: ["sqlite"] }],
  });
  if (choice.canceled || !choice.filePath) return;
  try {
    backupDatabase(store.db, choice.filePath);
    store.audit("BACKUP", { file: path.basename(choice.filePath) });
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      message: "Backup saved.",
      detail: choice.filePath,
    });
  } catch (error) {
    dialog.showErrorBox("Backup failed", error.message || String(error));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: "FuelStation Manager",
    backgroundColor: "#f1f5f9",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
      partition: "persist:fuel-station-main",
    },
  });

  const indexPath = path.join(app.getAppPath(), "dist", "index.html");

  mainWindow.loadFile(indexPath).catch((err) => {
    console.error("Failed to load HTML file:", err);
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Fallback: Show window after 1s anyway
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.maximize();
      mainWindow.show();
    }
  }, 1000);

  // Setup POS Menu
  const appMenu = [
    {
      label: "File",
      submenu: [
        { label: "Back up database…", accelerator: "CmdOrCtrl+B", click: () => backupNow() },
        { type: "separator" },
        { label: "Exit", accelerator: "Alt+F4", click: () => app.quit() },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload", accelerator: "CmdOrCtrl+R" },
        { role: "forceReload", accelerator: "CmdOrCtrl+Shift+R" },
        // Developer tools only when running from source, not in the packaged app.
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools", accelerator: "F12" }]),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(appMenu);
  Menu.setApplicationMenu(menu);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    store = require("./business-ipc.cjs").installBusinessIpc(() => mainWindow);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
