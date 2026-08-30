const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadParams: (regionKey) => ipcRenderer.invoke('params:load', regionKey),
  saveParams: (regionKey, params) => ipcRenderer.invoke('params:save', regionKey, params),
  resetParams: (regionKey) => ipcRenderer.invoke('params:reset', regionKey),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  fetchRemote: (url) => ipcRenderer.invoke('params:fetch-remote', url),
  pickJsonFile: () => ipcRenderer.invoke('file:pick-json'),
  saveJsonFile: (content, defaultName) =>
    ipcRenderer.invoke('file:save-json', content, defaultName),
});
