const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ntc', {
  appVersion: () => ipcRenderer.invoke('get-app-version'),
  defaultDownloadFolder: () => ipcRenderer.invoke('get-default-download-folder'),
  freeSpace: folderPath => ipcRenderer.invoke('get-free-space', folderPath),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  chooseDownloadFolder: () => ipcRenderer.invoke('choose-download-folder'),
  chooseMediaFiles: () => ipcRenderer.invoke('choose-media-files'),
  chooseCoverFile: () => ipcRenderer.invoke('choose-cover-file'),
  inspectMedia: (filePath) => ipcRenderer.invoke('inspect-media', filePath),
  getWaveform: (filePath) => ipcRenderer.invoke('get-waveform', filePath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  openFileFolder: (filePath) => ipcRenderer.invoke('open-file-folder', filePath),
  copyPath: (filePath) => ipcRenderer.invoke('copy-path', filePath),
  previewUrl: (url) => ipcRenderer.invoke('preview-url', url),
  playlistPreview: (url) => ipcRenderer.invoke('playlist-preview', url),
  startDownload: (payload) => ipcRenderer.invoke('start-download', payload),
  cancelDownload: (downloadId) => ipcRenderer.invoke('cancel-download', downloadId),
  startConversion: (payload) => ipcRenderer.invoke('start-conversion', payload),
  cancelConversion: (conversionId) => ipcRenderer.invoke('cancel-conversion', conversionId),
  toolVersions: () => ipcRenderer.invoke('tool-versions'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update-event', listener);
    return () => ipcRenderer.removeListener('update-event', listener);
  },
  onDownloadEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download-event', listener);
    return () => ipcRenderer.removeListener('download-event', listener);
  },
  onConversionEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('conversion-event', listener);
    return () => ipcRenderer.removeListener('conversion-event', listener);
  }
});
