'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ntcColorPickerOverlay', {
  onCapture(callback) {
    const listener = (_event, capture) => callback(capture);
    ipcRenderer.on('color-picker-capture', listener);
    return () => ipcRenderer.removeListener('color-picker-capture', listener);
  },
  choose(sample) { ipcRenderer.send('color-picker-overlay-result', sample); },
  cancel() { ipcRenderer.send('color-picker-overlay-cancel'); }
});
