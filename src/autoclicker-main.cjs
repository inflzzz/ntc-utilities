'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalizeClickerSettings, DEFAULT_CLICKER_SETTINGS } = require('./autoclicker.cjs');

function initializeAutoClicker({ app, ipcMain, BrowserWindow, screen }) {
  const settingsFile = path.join(app.getPath('userData'), 'ntc-autoclicker.json');
  let settings = { ...DEFAULT_CLICKER_SETTINGS };
  let worker = null;
  let runtime = { active: false, paused: false, runClicks: 0, totalClicks: 0, status: 'Parado', message: 'Pronto' };
  let stopping = false;
  const overlayWindows = new Map();
  let overlayState = null;
  let overlayVisible = false;
  let overlayHideTimer = null;
  try { settings = normalizeClickerSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); } catch {}
  runtime.totalClicks = settings.totalClicks;

  function persist() {
    try {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      const temporary = settingsFile + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(settings), 'utf8');
      fs.renameSync(temporary, settingsFile);
    } catch (error) {
      broadcast({ type: 'error', message: 'Não foi possível salvar as configurações do Auto-clicker: ' + error.message });
    }
  }

  function localPoint(point, display) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
    let dip = point;
    try { if (screen && typeof screen.screenToDipPoint === 'function') dip = screen.screenToDipPoint({ x: Number(point.x), y: Number(point.y) }); }
    catch { dip = point; }
    return { x: dip.x - display.bounds.x, y: dip.y - display.bounds.y };
  }

  function overlayPayloadFor(display, state) {
    const convertRect = rect => {
      const a = localPoint({ x: rect.x, y: rect.y }, display);
      const b = localPoint({ x: Number(rect.x) + Number(rect.width), y: Number(rect.y) + Number(rect.height) }, display);
      if (!a || !b) return null;
      return { ...rect, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
    };
    const points = (settings.clickPoints || []).map(point => {
      const p = localPoint(point, display);
      return p && { ...point, x: p.x, y: p.y, radius: Number(point.radius || 0) / (display.scaleFactor || 1) };
    }).filter(Boolean);
    const zones = (settings.stopZones || []).map(convertRect).filter(Boolean);
    return {
      ...state,
      cursor: state.cursor && localPoint(state.cursor, display),
      start: state.start && localPoint(state.start, display),
      points,
      zones,
      highlightPoint: state.highlightPoint && localPoint(state.highlightPoint, display),
      highlightZone: state.highlightZone && convertRect(state.highlightZone),
    };
  }

  function sendOverlayState(window) {
    if (!overlayState || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isLoadingMainFrame()) return;
    window.webContents.send('autoclicker-overlay-state', overlayPayloadFor(window.ntcDisplay, overlayState));
  }

  function syncOverlayWindows() {
    if (!screen || typeof screen.getAllDisplays !== 'function') return;
    const displays = screen.getAllDisplays();
    const ids = new Set(displays.map(display => display.id));
    for (const [id, window] of overlayWindows) {
      if (ids.has(id)) continue;
      overlayWindows.delete(id);
      if (!window.isDestroyed()) window.destroy();
    }
    for (const display of displays) {
      let window = overlayWindows.get(display.id);
      if (window && !window.isDestroyed()) {
        window.ntcDisplay = display;
        window.setBounds(display.bounds);
        continue;
      }
      window = new BrowserWindow({
        x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
        show: false, frame: false, transparent: true, backgroundColor: '#00000000',
        resizable: false, movable: false, minimizable: false, maximizable: false,
        focusable: false, skipTaskbar: true, hasShadow: false,
        webPreferences: {
          preload: path.join(__dirname, 'autoclicker-overlay-preload.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false
        }
      });
      window.ntcDisplay = display;
      window.setAlwaysOnTop(true, 'floating');
      window.setIgnoreMouseEvents(true, { forward: true });
      window.on('closed', () => overlayWindows.delete(display.id));
      window.webContents.on('did-finish-load', () => {
        sendOverlayState(window);
        if (overlayVisible && !window.isDestroyed()) window.showInactive();
      });
      overlayWindows.set(display.id, window);
      void window.loadFile(path.join(__dirname, 'autoclicker-overlay.html'));
    }
  }

  function hideOverlay() {
    overlayVisible = false;
    overlayState = null;
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
    for (const window of overlayWindows.values()) {
      if (window.isDestroyed()) continue;
      if (!window.webContents.isLoadingMainFrame()) window.webContents.send('autoclicker-overlay-state', { mode: 'hidden' });
      window.hide();
    }
  }

  function sendOverlayStates() {
    for (const window of overlayWindows.values()) {
      if (window.isDestroyed()) continue;
      sendOverlayState(window);
      if (overlayVisible && !window.isVisible()) window.showInactive();
    }
  }

  function showOverlay(state, hideAfterMs = 0) {
    overlayState = state;
    overlayVisible = true;
    clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
    syncOverlayWindows();
    sendOverlayStates();
    if (hideAfterMs > 0) overlayHideTimer = setTimeout(hideOverlay, hideAfterMs);
  }

  function updateOverlay(event) {
    if (event.type === 'picker') {
      if (event.active) showOverlay({ mode: 'picker', kind: event.kind, action: event.action, cursor: event.cursor });
      else if (event.cancelled) hideOverlay();
    } else if (event.type === 'preview') {
      overlayState = { mode: 'picker', kind: event.kind, action: event.action, cursor: { x: event.cursorX, y: event.cursorY }, start: { x: event.startX, y: event.startY }, drawing: event.drawing };
      if (overlayVisible) sendOverlayStates();
      else showOverlay(overlayState);
    } else if (event.type === 'point') {
      showOverlay({ mode: 'flash', kind: 'point', highlightPoint: { x: event.x, y: event.y } }, 3000);
    } else if (event.type === 'zone') {
      showOverlay({ mode: 'flash', kind: 'zone', highlightZone: { x: event.x, y: event.y, width: event.width, height: event.height, action: event.action } }, 3000);
    } else if (event.type === 'delete-point' && overlayVisible && overlayState && overlayState.mode === 'picker') {
      sendOverlayStates();
    }
  }

  function broadcast(event) {
    updateOverlay(event);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('autoclicker-event', event);
    }
  }

  function send(command) {
    try { if (worker && !worker.killed && worker.stdin.writable) worker.stdin.write(JSON.stringify(command) + '\n'); } catch {}
  }

  function startWorker() {
    if (process.platform !== 'win32') return false;
    if (worker && !worker.killed) return true;
    stopping = false;
    const script = path.join(__dirname, 'autoclicker-host.ps1');
    worker = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stdout.on('data', chunk => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          let event = JSON.parse(line);
          if (event.type === 'state') {
            runtime = { ...runtime, ...event };
            const reportedTotal = Number(event.totalClicks);
            const nextTotal = Number.isFinite(reportedTotal) ? Math.max(0, Math.floor(reportedTotal)) : settings.totalClicks;
            runtime.totalClicks = nextTotal;
            if (event.totalClicks !== undefined && nextTotal !== settings.totalClicks) { settings.totalClicks = nextTotal; persist(); }
          } else if (event.type === 'point') {
            const point = { id: 'point-' + Date.now().toString(36), x: event.x, y: event.y, clicks: 1, radius: 0 };
            settings.clickPoints = [...settings.clickPoints, point].slice(0, 50);
            settings.clickPointsEnabled = true;
            persist();
            send({ type: 'configure', settings });
          } else if (event.type === 'zone') {
            const zone = { id: 'zone-' + Date.now().toString(36), x: event.x, y: event.y, width: event.width, height: event.height, action: event.action };
            settings.stopZones = [...settings.stopZones, zone].slice(0, 50);
            settings.stopZonesEnabled = true;
            persist();
            send({ type: 'configure', settings });
          } else if (event.type === 'delete-point') {
            const points = settings.clickPoints || [];
            let nearestIndex = -1;
            let nearestDistance = Infinity;
            points.forEach((point, index) => {
              const dx = Number(point.x) - Number(event.x);
              const dy = Number(point.y) - Number(event.y);
              const distance = dx * dx + dy * dy;
              if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
            });
            const deleted = nearestIndex >= 0 && nearestDistance <= 24 * 24;
            if (deleted) {
              settings.clickPoints = points.filter((_point, index) => index !== nearestIndex);
              persist();
              send({ type: 'configure', settings });
            }
            event = { ...event, deleted, settings: deleted ? settings : undefined };
          }
          broadcast(event.type === 'point' || event.type === 'zone' ? { ...event, settings } : event);
        } catch {}
      }
    });
    worker.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    worker.on('error', error => {
      worker = null;
      runtime = { ...runtime, active: false, paused: false, status: 'Erro', message: error.message };
      broadcast({ type: 'state', ...runtime });
    });
    worker.on('close', code => {
      worker = null;
      if (!stopping && code !== 0) {
        runtime = { ...runtime, active: false, paused: false, status: 'Erro', message: stderr.trim() || 'O processo do Auto-clicker foi encerrado.' };
        broadcast({ type: 'state', ...runtime });
      }
    });
    send({ type: 'configure', settings });
    return true;
  }

  ipcMain.handle('autoclicker-get-state', () => {
    const supported = process.platform === 'win32';
    return { supported, settings, ...runtime };
  });
  ipcMain.handle('autoclicker-activate', () => {
    const supported = startWorker();
    return { supported, settings, ...runtime, message: supported ? runtime.message : 'O Auto-clicker está disponível apenas no Windows.' };
  });
  ipcMain.handle('autoclicker-save-settings', (_event, value) => {
    settings = normalizeClickerSettings(value);
    persist();
    if (startWorker()) send({ type: 'configure', settings });
    const state = { settings, ...runtime };
    broadcast({ type: 'state', ...state });
    return state;
  });
  ipcMain.handle('autoclicker-set-active', (_event, active) => {
    if (!startWorker()) return { ...runtime, supported: false, message: 'O Auto-clicker está disponível apenas no Windows.' };
    send({ type: 'active', active: Boolean(active) });
    return { ...runtime, active: Boolean(active) };
  });
  ipcMain.handle('autoclicker-pick-point', () => {
    if (!startWorker()) return false;
    send({ type: 'pick-point' });
    return true;
  });
  ipcMain.handle('autoclicker-pick-zone', (_event, action) => {
    if (!startWorker()) return false;
    send({ type: 'pick-zone', action: ['stop', 'pause', 'start'].includes(action) ? action : 'stop' });
    return true;
  });
  ipcMain.handle('autoclicker-list-processes', () => {
    if (!startWorker()) return false;
    send({ type: 'list-processes' });
    return true;
  });

  return {
    setShortcutRecorderFocused(focused) { send({ type: 'recording', active: Boolean(focused) }); },
    suspend() { send({ type: 'suspend' }); },
    dispose() {
      stopping = true;
      hideOverlay();
      for (const window of overlayWindows.values()) if (!window.isDestroyed()) window.destroy();
      overlayWindows.clear();
      if (!worker) return;
      send({ type: 'shutdown' });
      const child = worker;
      setTimeout(() => { if (!child.killed) child.kill(); }, 500);
      worker = null;
    }
  };
}

module.exports = { initializeAutoClicker };
