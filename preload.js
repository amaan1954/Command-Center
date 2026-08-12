const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("commandCenterFile", {
  read: () => ipcRenderer.invoke("dashboard:read"),
  save: (data) => ipcRenderer.invoke("dashboard:save", data)
});
