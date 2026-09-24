'use strict';

const path = require('node:path');
const { normalizeSample, rgbToHsl } = require('./color-picker.cjs');

function initializeColorPicker({ ipcMain, BrowserWindow, screen, desktopCapturer, getMainWindow = () => null }) {
  let session = null;
  let starting = false;

  async function minimizeMainWindow() {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return null;
    await new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        window.removeListener('minimize', finish);
        resolve();
      };
      const timeout = setTimeout(finish, 300);
      window.once('minimize', finish);
      try { window.minimize(); } catch { finish(); }
    });
    return window.isDestroyed() ? null : window;
  }

  function restoreMainWindow(window) {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  async function captureDisplay(display) {
    const scale = Number(display.scaleFactor) || 1;
    const width = Math.max(1, Math.min(16_384, Math.round(display.size.width * scale)));
    const height = Math.max(1, Math.min(16_384, Math.round(display.size.height * scale)));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false
    });
    const source = sources.find(item => String(item.display_id) === String(display.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error(`Não foi possível capturar o monitor ${display.id}.`);
    const image = source.thumbnail.getSize();
    return {
      displayId: String(display.id),
      bounds: display.bounds,
      width: image.width,
      height: image.height,
      dataUrl: source.thumbnail.toDataURL()
    };
  }

  function finish(activeSession, result, error, { restore = true } = {}) {
    if (!activeSession || activeSession !== session || activeSession.done) return;
    activeSession.done = true;
    session = null;
    for (const window of activeSession.windows) {
      if (!window.isDestroyed()) window.destroy();
    }
    if (restore) restoreMainWindow(activeSession.restoreWindow);
    if (error) activeSession.reject(error);
    else activeSession.resolve(result);
  }

  ipcMain.handle('color-picker-start', async () => {
    if (starting || session) throw new Error('O seletor de cor já está aberto.');
    starting = true;
    let captures;
    let restoreWindow = null;
    try {
      restoreWindow = await minimizeMainWindow();
      const displays = screen.getAllDisplays();
      captures = [];
      for (const display of displays) captures.push(await captureDisplay(display));
      if (!captures.length) throw new Error('Nenhum monitor disponível para capturar.');
    } catch (error) {
      starting = false;
      restoreMainWindow(restoreWindow);
      throw error;
    }

    return new Promise((resolve, reject) => {
      const activeSession = { windows: new Set(), resolve, reject, done: false, restoreWindow };
      session = activeSession;
      starting = false;
      try {
        for (const capture of captures) {
          const window = new BrowserWindow({
            x: capture.bounds.x,
            y: capture.bounds.y,
            width: capture.bounds.width,
            height: capture.bounds.height,
            show: false,
            frame: false,
            transparent: false,
            backgroundColor: '#101114',
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            focusable: true,
            skipTaskbar: true,
            hasShadow: false,
            webPreferences: {
              preload: path.join(__dirname, 'color-picker-overlay-preload.cjs'),
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              backgroundThrottling: false
            }
          });
          activeSession.windows.add(window);
          window.setAlwaysOnTop(true, 'screen-saver');
          window.on('closed', () => {
            activeSession.windows.delete(window);
            if (!activeSession.done && activeSession.windows.size === 0) finish(activeSession, null);
          });
          window.webContents.once('did-finish-load', () => {
            if (activeSession.done || window.isDestroyed()) return;
            window.webContents.send('color-picker-capture', capture);
            window.show();
            window.focus();
          });
          void window.loadFile(path.join(__dirname, 'color-picker-overlay.html')).catch(error => finish(activeSession, null, error));
        }
      } catch (error) {
        finish(activeSession, null, error);
      }
    });
  });

  ipcMain.on('color-picker-overlay-result', (event, sample) => {
    if (!session || !BrowserWindow.fromWebContents(event.sender) || !Array.from(session.windows).some(window => window.webContents === event.sender)) return;
    try {
      const color = normalizeSample(sample);
      finish(session, { ...color, hsl: rgbToHsl(color) });
    }
    catch (error) { finish(session, null, error); }
  });

  ipcMain.on('color-picker-overlay-cancel', event => {
    if (!session || !Array.from(session.windows).some(window => window.webContents === event.sender)) return;
    finish(session, null);
  });

  return {
    dispose() { if (session) finish(session, null, null, { restore: false }); }
  };
}

module.exports = { initializeColorPicker };
