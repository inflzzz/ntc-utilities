const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ntc', {
  appVersion: () => ipcRenderer.invoke('get-app-version'),
  defaultDownloadFolder: () => ipcRenderer.invoke('get-default-download-folder'),
  freeSpace: folderPath => ipcRenderer.invoke('get-free-space', folderPath),
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  forceCloseWindow: () => ipcRenderer.invoke('window-force-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  chooseDownloadFolder: () => ipcRenderer.invoke('choose-download-folder'),
  chooseMediaFiles: () => ipcRenderer.invoke('choose-media-files'),
  chooseVideoFiles: () => ipcRenderer.invoke('choose-video-files'),
  chooseVideoEditorFile: () => ipcRenderer.invoke('choose-video-editor-file'),
  chooseVideoEditorAudio: () => ipcRenderer.invoke('choose-video-editor-audio'),
  chooseImageFiles: () => ipcRenderer.invoke('choose-image-files'),
  chooseCompressorFiles: () => ipcRenderer.invoke('choose-compressor-files'),
  chooseCoverFile: () => ipcRenderer.invoke('choose-cover-file'),
  inspectMedia: (filePath) => ipcRenderer.invoke('inspect-media', filePath),
  inspectVideo: (filePath) => ipcRenderer.invoke('inspect-video', filePath),
  inspectImage: (filePath) => ipcRenderer.invoke('inspect-image', filePath),
  previewImage: (payload) => ipcRenderer.invoke('preview-image', payload),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
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
  startVideoConversion: (payload) => ipcRenderer.invoke('start-video-conversion', payload),
  cancelVideoConversion: (id) => ipcRenderer.invoke('cancel-video-conversion', id),
  startVideoEdit: (payload) => ipcRenderer.invoke('start-video-edit', payload),
  cancelVideoEdit: (id) => ipcRenderer.invoke('cancel-video-edit', id),
  startImageConversion: (payload) => ipcRenderer.invoke('start-image-conversion', payload),
  cancelImageConversion: (id) => ipcRenderer.invoke('cancel-image-conversion', id),
  startCompression: (payload) => ipcRenderer.invoke('start-compression', payload),
  toolVersions: () => ipcRenderer.invoke('tool-versions'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  screenSources: () => ipcRenderer.invoke('screen-sources'),
  startScreenRecording: (options) => ipcRenderer.invoke('screen-recording-start', options),
  sendScreenRecordingChunk: (id, chunk) => ipcRenderer.invoke('screen-recording-chunk', id, chunk),
  stopScreenRecording: (id) => ipcRenderer.invoke('screen-recording-stop', id),
  cancelScreenRecording: (id) => ipcRenderer.invoke('screen-recording-cancel', id),
  registerScreenShortcut: (accelerator) => ipcRenderer.invoke('register-screen-shortcut', accelerator),
  unregisterScreenShortcut: () => ipcRenderer.invoke('unregister-screen-shortcut'),
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
  },
  onVideoEvent: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('video-event', listener); return () => ipcRenderer.removeListener('video-event', listener); },
  onImageEvent: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('image-event', listener); return () => ipcRenderer.removeListener('image-event', listener); },
  onVideoEditorEvent: (callback) => { const listener = (_event, payload) => callback(payload); ipcRenderer.on('video-editor-event', listener); return () => ipcRenderer.removeListener('video-editor-event', listener); }
  ,onScreenHotkey: (callback) => { const listener = () => callback(); ipcRenderer.on('screen-hotkey', listener); return () => ipcRenderer.removeListener('screen-hotkey', listener); },
  onScreenCloseRequest: (callback) => { const listener = () => callback(); ipcRenderer.on('screen-close-request', listener); return () => ipcRenderer.removeListener('screen-close-request', listener); }
});
