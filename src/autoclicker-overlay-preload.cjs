'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ntcOverlay', {
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('autoclicker-overlay-state', listener);
    return () => ipcRenderer.removeListener('autoclicker-overlay-state', listener);
  }
});
