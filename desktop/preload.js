// Preload runs before the renderer and is the only place with access to both
// Node and the page. The backend port is picked at runtime, but Vite bakes env
// vars at build time, so the resolved URLs are handed to the app here instead.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__SHOT2CODE_BACKEND__", {
  http: process.env.SHOT2CODE_BACKEND_HTTP || "",
  ws: process.env.SHOT2CODE_BACKEND_WS || "",
});

contextBridge.exposeInMainWorld("__SHOT2CODE_APP__", {
  openLogs: () => ipcRenderer.invoke("shot2code:open-logs"),
  getAppInfo: () => ipcRenderer.invoke("shot2code:get-app-info"),
  checkForUpdates: () => ipcRenderer.invoke("shot2code:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("shot2code:install-update"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("shot2code:update-state", listener);
    return () => ipcRenderer.removeListener("shot2code:update-state", listener);
  },
});
