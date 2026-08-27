const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, shell } = require("electron");
const { startStaticServer } = require("./static-server.cjs");

const isDevelopment = Boolean(process.env.SLH_TMS_DESKTOP_DEV_URL);
const desktopPort = 5173;
let packagedServerPromise;

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

async function packagedOrigin() {
  if (!packagedServerPromise) {
    const rootDir = path.join(__dirname, "..", "dist");
    packagedServerPromise = startStaticServer(rootDir, { port: desktopPort });
  }
  return (await packagedServerPromise).origin;
}

async function createWindow() {
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
    await win.loadURL(process.env.SLH_TMS_DESKTOP_DEV_URL);
  } else {
    await win.loadURL(await packagedOrigin());
  }
}

function reportStartupFailure(error) {
  const detail = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(
    "SLH TMS Desktop could not start",
    `The desktop shell could not open http://localhost:${desktopPort}. Close any application using that port and try again.\n\n${detail}`,
  );
}

app.whenReady().then(createWindow).catch(reportStartupFailure);
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(reportStartupFailure);
});
app.on("before-quit", () => {
  void packagedServerPromise?.then(({ server }) => server.close()).catch(() => {});
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
