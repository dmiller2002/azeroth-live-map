const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('companion', Object.freeze({
  version: '1.0.0',
  saveAddon: () => ipcRenderer.invoke('addon:save'),
  getUIScale: () => ipcRenderer.invoke('ui-scale:get'),
  setUIScale: value => ipcRenderer.invoke('ui-scale:set', value),
  onUIScaleChanged: callback => {
    if (typeof callback !== 'function') throw new TypeError('Expected a callback');
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('ui-scale:changed', listener);
    return () => ipcRenderer.removeListener('ui-scale:changed', listener);
  }
}));
