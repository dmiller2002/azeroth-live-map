const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('capturePicker', Object.freeze({
  sources: () => ipcRenderer.invoke('capture:sources'),
  choose: id => ipcRenderer.invoke('capture:choose', id),
  cancel: () => ipcRenderer.invoke('capture:choose', null)
}));
