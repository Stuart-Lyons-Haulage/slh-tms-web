const fs = require("node:fs");
const vm = require("node:vm");
const { contextBridge } = require("electron");

const configArg = process.argv.find((arg) => arg.startsWith("--slh-tms-config="));
const configPath = configArg ? configArg.slice("--slh-tms-config=".length) : "";

contextBridge.exposeInMainWorld("__SLH_TMS_DESKTOP__", true);

if (configPath && fs.existsSync(configPath)) {
  const source = fs.readFileSync(configPath, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: configPath, timeout: 1000 });
  contextBridge.exposeInMainWorld("__SLH_TMS_CONFIG__", sandbox.window.__SLH_TMS_CONFIG__ || {});
}
