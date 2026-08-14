const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadParams: () => ipcRenderer.invoke('params:load'),
  saveParams: (params) => ipcRenderer.invoke('params:save', params),
  resetParams: () => ipcRenderer.invoke('params:reset'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
});
