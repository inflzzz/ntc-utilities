'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ClipboardHistoryStore, validateSettings } = require('./clipboard-history.cjs');

const CLIPBOARD_CHANNELS = Object.freeze({
  state: 'clipboard-history-state',
  list: 'clipboard-history-list',
  preview: 'clipboard-history-preview',
  thumbnail: 'clipboard-history-thumbnail',
  copy: 'clipboard-history-copy',
  pin: 'clipboard-history-pin',
  delete: 'clipboard-history-delete',
  clear: 'clipboard-history-clear',
  settings: 'clipboard-history-settings'
});

function initializeClipboardHistory({ app, ipcMain, getMainWindow, clipboard, nativeImage, platform = process.platform, spawnFn = spawn }) {
  const store = new ClipboardHistoryStore(app.getPath('userData'));
  const supported = platform === 'win32';
  let child = null;
  let listenerReady = false;
  let disposed = false;
  let retryTimer = null;
  let retryDelay = 1500;
  let captureQueue = Promise.resolve();
  let lastError = '';
  const ignoredSecretHashes = new Map();

  const validSender = event => {
    const window = getMainWindow?.();
    return Boolean(window && !window.isDestroyed?.() && event?.sender === window.webContents);
  };

  function send(channel, payload) {
    const window = getMainWindow?.();
    if (!window || window.isDestroyed?.() || window.webContents.isDestroyed?.()) return;
    try { window.webContents.send(channel, payload); } catch { }
  }

  async function state() {
    await store.ready;
    const persisted = await store.getState();
    return {
      ...persisted,
      supported,
      listenerReady,
      warning: lastError || persisted.warning
    };
  }

  async function broadcastState() {
    try { send('clipboard-history-status', await state()); } catch (error) { lastError = error.message || 'Falha ao consultar o histórico da área de transferência.'; }
  }

  function setError(message, listenerFailed = false) {
    lastError = String(message || 'A captura da área de transferência falhou.');
    if (listenerFailed) listenerReady = false;
    void broadcastState();
  }

  function sendCommand(command) {
    if (!child || child.killed || !child.stdin?.writable) return false;
    try { child.stdin.write(`${command}\n`); return true; }
    catch { return false; }
  }

  async function readClipboard() {
    if (disposed || !listenerReady) return;
    try {
      const text = clipboard.readText();
      const native = clipboard.readImage();
      const image = native && !native.isEmpty() ? native.toPNG() : null;
      if (!image && text) {
        const hash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
        const expiry = ignoredSecretHashes.get(hash);
        if (expiry) {
          ignoredSecretHashes.delete(hash);
          if (expiry >= Date.now()) return;
        }
      }
      const result = await store.record({ text, image });
      lastError = result.warning || (result.saved ? '' : result.reason === 'empty' ? lastError : result.message || '');
      await broadcastState();
      send('clipboard-history-changed', { result: { saved: result.saved, deduplicated: Boolean(result.deduplicated), reason: result.reason || '' } });
    } catch (error) {
      setError(error.message || 'Não foi possível ler ou salvar o conteúdo copiado.');
    }
  }

  function enqueueClipboardRead(isFileCopy) {
    if (isFileCopy || disposed || !listenerReady) return;
    captureQueue = captureQueue.then(readClipboard, readClipboard);
  }

  function onHostLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.type === 'ready') {
      listenerReady = true;
      retryDelay = 1500;
      lastError = '';
      void broadcastState();
    } else if (message.type === 'change') {
      enqueueClipboardRead(Boolean(message.files));
    } else if (message.type === 'error') {
      setError(message.message, true);
    }
  }

  function scheduleRetry() {
    if (!supported || disposed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      startListener();
    }, retryDelay);
    retryTimer.unref?.();
    retryDelay = Math.min(30_000, retryDelay * 2);
  }

  function startListener() {
    if (!supported || disposed || child) return;
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'clipboard-listener-host.ps1')
      : path.join(__dirname, 'clipboard-listener-host.ps1');
    let processHandle;
    try {
      processHandle = spawnFn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      setError(error.message || 'Não foi possível iniciar a captura do Windows.', true);
      scheduleRetry();
      return;
    }
    child = processHandle;
    let pending = '';
    processHandle.stdout?.setEncoding('utf8');
    processHandle.stdout?.on('data', chunk => {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        onHostLine(pending.slice(0, newline).trim());
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    });
    processHandle.stderr?.setEncoding('utf8');
    processHandle.stderr?.on('data', chunk => {
      const detail = String(chunk || '').trim();
      if (detail && !disposed) setError(detail.slice(-500));
    });
    processHandle.on('error', error => {
      if (child !== processHandle || disposed) return;
      child = null;
      setError(error.message || 'Não foi possível iniciar a captura do Windows.', true);
      scheduleRetry();
    });
    processHandle.on('close', (code, signal) => {
      if (child !== processHandle) return;
      child = null;
      listenerReady = false;
      if (!disposed) {
        if (code !== 0) setError(`O observador da área de transferência foi encerrado (${signal || code || 'sem código'}).`);
        else void broadcastState();
        scheduleRetry();
      }
    });
  }

  function handle(channel, callback) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!validSender(event)) return { ok: false, message: 'Origem da solicitação inválida.' };
      return callback(...args);
    });
  }

  handle(CLIPBOARD_CHANNELS.state, () => state());
  handle(CLIPBOARD_CHANNELS.list, query => {
    const safe = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
    return store.list({ filter: safe.filter, query: safe.query, offset: safe.offset, limit: safe.limit });
  });
  handle(CLIPBOARD_CHANNELS.preview, async id => {
    const item = await store.readItem(id);
    if (!item) return null;
    let imageDataUrl = '';
    if (item.image) {
      const image = nativeImage.createFromBuffer(item.image);
      imageDataUrl = (image.getSize().width > 480 || image.getSize().height > 360)
        ? image.resize({ width: 480, height: 360, quality: 'good' }).toDataURL()
        : image.toDataURL();
    }
    return { text: item.text.slice(0, 20_000), hasMoreText: item.text.length > 20_000, imageDataUrl };
  });
  handle(CLIPBOARD_CHANNELS.thumbnail, async id => {
    const item = await store.readItem(id);
    if (!item?.image) return { imageDataUrl: '' };
    const image = nativeImage.createFromBuffer(item.image);
    const size = image.getSize();
    if (!size.width || !size.height) return { imageDataUrl: '' };
    const scale = Math.min(1, 240 / size.width, 160 / size.height);
    const thumb = scale < 1
      ? image.resize({ width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)), quality: 'good' })
      : image;
    return { imageDataUrl: thumb.toDataURL() };
  });
  handle(CLIPBOARD_CHANNELS.copy, async id => {
    const item = await store.readItem(id);
    if (!item) return { ok: false, message: 'Esse item não existe mais.' };
    if (item.text && item.image) clipboard.write({ text: item.text, image: nativeImage.createFromBuffer(item.image) });
    else if (item.text) clipboard.writeText(item.text);
    else if (item.image) clipboard.writeImage(nativeImage.createFromBuffer(item.image));
    return { ok: true };
  });
  handle(CLIPBOARD_CHANNELS.pin, (id, pinned) => store.setPinned(id, pinned));
  handle(CLIPBOARD_CHANNELS.delete, id => store.deleteItem(id));
  handle(CLIPBOARD_CHANNELS.clear, () => store.clear());
  handle(CLIPBOARD_CHANNELS.settings, async value => {
    const validation = validateSettings(value);
    if (!validation.ok) return validation;
    const result = await store.saveSettings(validation.settings);
    if (result.ok) send('clipboard-history-changed', { settingsChanged: true });
    return result;
  });
  void store.ready.then(() => {
    if (supported) startListener();
    else lastError = 'A captura da área de transferência está disponível no Windows.';
    void broadcastState();
  }).catch(error => setError(error.message || 'Não foi possível abrir o histórico local.', true));

  return {
    store,
    getState: state,
    ignoreNextText(text) {
      if (typeof text !== 'string' || !text) return;
      const hash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
      const expiresAt = Date.now() + 4_000;
      ignoredSecretHashes.set(hash, expiresAt);
      const cleanup = setTimeout(() => {
        if (ignoredSecretHashes.get(hash) === expiresAt) ignoredSecretHashes.delete(hash);
      }, 4_100);
      cleanup.unref?.();
    },
    dispose() {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (child) {
        const current = child;
        child = null;
        try { current.stdin?.write('stop\n'); } catch { }
        try { current.kill(); } catch { }
      }
      listenerReady = false;
    }
  };
}

module.exports = { CLIPBOARD_CHANNELS, initializeClipboardHistory };
