const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("business", {
  request: (payload) => ipcRenderer.invoke("business:request", payload),
});
