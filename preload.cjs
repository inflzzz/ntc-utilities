const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ntc', {
  defaultDownloadFolder: () => ipcRenderer.invoke('get-default-download-folder'),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  chooseDownloadFolder: () => ipcRenderer.invoke('choose-download-folder'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  copyPath: (filePath) => ipcRenderer.invoke('copy-path', filePath),
  previewUrl: (url) => ipcRenderer.invoke('preview-url', url),
  playlistPreview: (url) => ipcRenderer.invoke('playlist-preview', url),
  startDownload: (payload) => ipcRenderer.invoke('start-download', payload),
  cancelDownload: (downloadId) => ipcRenderer.invoke('cancel-download', downloadId),
  toolVersions: () => ipcRenderer.invoke('tool-versions'),
  onDownloadEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('download-event', listener);
    return () => ipcRenderer.removeListener('download-event', listener);
  }
});
