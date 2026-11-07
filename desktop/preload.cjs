const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', Object.freeze({
  version: '1.0.3',
  saveAddon: () => ipcRenderer.invoke('addon:save'),
  getUpdateState: () => ipcRenderer.invoke('updates:get'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openReleases: () => ipcRenderer.invoke('updates:releases'),
  onUpdateChanged: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('updates:changed', listener);
    return () => ipcRenderer.removeListener('updates:changed', listener);
  },
  getUIScale: () => ipcRenderer.invoke('ui-scale:get'),
  setUIScale: value => ipcRenderer.invoke('ui-scale:set', value),
  onUIScaleChanged: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('ui-scale:changed', listener);
    return () => ipcRenderer.removeListener('ui-scale:changed', listener);
  }
}));
