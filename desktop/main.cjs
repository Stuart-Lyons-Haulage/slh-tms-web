const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, shell } = require("electron");

const isDevelopment = Boolean(process.env.SLH_TMS_DESKTOP_DEV_URL);

function runtimeConfigPath() {
  if (isDevelopment) return path.join(__dirname, "runtime-config", "tms-runtime-config.js");
  return path.join(process.resourcesPath, "runtime-config", "tms-runtime-config.js");
}

function ensureRuntimeConfig() {
  const source = runtimeConfigPath();
  const target = isDevelopment
    ? source
    : path.join(app.getPath("userData"), "tms-runtime-config.js");

  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }

  return target;
}

function createWindow() {
  const configPath = ensureRuntimeConfig();
  const preload = path.join(__dirname, "preload.cjs");
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    title: "SLH TMS Desktop",
    backgroundColor: "#f7f8fa",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload,
      additionalArguments: [`--slh-tms-config=${configPath}`],
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDevelopment) {
    win.loadURL(process.env.SLH_TMS_DESKTOP_DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
