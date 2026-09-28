'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { initializeClipboardHistory, CLIPBOARD_CHANNELS } = require('../src/clipboard-main.cjs');

test('clipboard IPC is restricted to the app window and returns only previews, never storage paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-clipboard-ipc-'));
  const handlers = new Map();
  const sent = [];
  const writes = [];
  const webContents = { send: (channel, payload) => sent.push({ channel, payload }), isDestroyed: () => false };
  const window = { webContents, isDestroyed: () => false };
  const clipboard = {
    readText: () => '',
    readImage: () => ({ isEmpty: () => true }),
    writeText: text => writes.push({ text }),
    writeImage: image => writes.push({ image }),
    write: data => writes.push(data)
  };
  const nativeImage = {
    createFromBuffer: image => ({ buffer: image, getSize: () => ({ width: 10, height: 10 }), toDataURL: () => 'data:image/png;base64,AA==' })
  };
  const service = initializeClipboardHistory({
    app: { getPath: () => root },
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    getMainWindow: () => window,
    clipboard,
    nativeImage,
    platform: 'linux',
    spawnFn: () => { throw new Error('listener should not start in this test'); }
  });
  const invoke = async (channel, sender = webContents, ...args) => handlers.get(channel)({ sender }, ...args);
  try {
    await service.store.ready;
    const untrusted = await invoke(CLIPBOARD_CHANNELS.clear, {});
    assert.equal(untrusted.ok, false);
    assert.equal((await invoke(CLIPBOARD_CHANNELS.state)).supported, false);

    const stored = await service.store.record({ text: 'conteúdo privado' });
    const listed = await invoke(CLIPBOARD_CHANNELS.list, webContents, { query: 'privado', limit: 5 });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].id, stored.item.id);
    assert.equal(Object.keys(listed.items[0]).some(key => /path|file|buffer/i.test(key)), false);

    const preview = await invoke(CLIPBOARD_CHANNELS.preview, webContents, stored.item.id);
    assert.deepEqual(preview, { text: 'conteúdo privado', hasMoreText: false, imageDataUrl: '' });
    assert.deepEqual(await invoke(CLIPBOARD_CHANNELS.copy, webContents, stored.item.id), { ok: true });
    assert.deepEqual(writes.at(-1), { text: 'conteúdo privado' });

    assert.equal((await invoke(CLIPBOARD_CHANNELS.settings, webContents, { quotaBytes: 0, retentionDays: 30 })).ok, false);
    assert.equal(CLIPBOARD_CHANNELS.pause, undefined);
    const cleared = await invoke(CLIPBOARD_CHANNELS.clear);
    assert.equal(cleared.count, 0);
    assert.ok(sent.some(entry => entry.channel === 'clipboard-history-status'));
  } finally {
    service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('clipboard copy restores a saved image without exposing its filesystem location', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-clipboard-image-'));
  const handlers = new Map();
  const copied = [];
  const webContents = { send() {}, isDestroyed: () => false };
  const image = Buffer.from([1, 2, 3, 4]);
  const service = initializeClipboardHistory({
    app: { getPath: () => root },
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    getMainWindow: () => ({ webContents, isDestroyed: () => false }),
    clipboard: { readText: () => '', readImage: () => ({ isEmpty: () => true }), writeImage: native => copied.push(native.buffer), writeText() {}, write() {} },
    nativeImage: { createFromBuffer: buffer => ({ buffer, getSize: () => ({ width: 2, height: 2 }), toDataURL: () => 'data:image/png;base64,AA==' }) },
    platform: 'linux'
  });
  try {
    await service.store.ready;
    const saved = await service.store.record({ image });
    const result = await handlers.get(CLIPBOARD_CHANNELS.copy)({ sender: webContents }, saved.item.id);
    assert.equal(result.ok, true);
    assert.deepEqual(copied, [image]);
  } finally {
    service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('clipboard thumbnail IPC is bounded, read-only and restricted to the app window', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-clipboard-thumbnail-'));
  const handlers = new Map();
  const webContents = { send() {}, isDestroyed: () => false };
  const resized = [];
  const service = initializeClipboardHistory({
    app: { getPath: () => root },
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    getMainWindow: () => ({ webContents, isDestroyed: () => false }),
    clipboard: { readText: () => '', readImage: () => ({ isEmpty: () => true }), writeImage() {}, writeText() {}, write() {} },
    nativeImage: { createFromBuffer: buffer => ({
      getSize: () => buffer[0] === 4 ? { width: 400, height: 1200 } : buffer[0] === 5 ? { width: 5000, height: 5000 } : { width: 1200, height: 800 },
      resize: size => { resized.push(size); return { toDataURL: () => 'data:image/png;base64,AA==' }; }
    }) },
    platform: 'linux'
  });
  try {
    await service.store.ready;
    const saved = await service.store.record({ image: Buffer.from([1, 2, 3]) });
    const thumbnail = handlers.get(CLIPBOARD_CHANNELS.thumbnail);
    assert.equal((await thumbnail({ sender: {} }, saved.item.id)).ok, false);
    assert.deepEqual(await thumbnail({ sender: webContents }, saved.item.id), { imageDataUrl: 'data:image/png;base64,AA==' });
    assert.deepEqual(resized, [{ width: 240, height: 160, quality: 'good' }]);
    const vertical = await service.store.record({ image: Buffer.from([4, 2, 3]) });
    assert.deepEqual(await thumbnail({ sender: webContents }, vertical.item.id), { imageDataUrl: 'data:image/png;base64,AA==' });
    assert.deepEqual(resized.at(-1), { width: 53, height: 160, quality: 'good' });
    const large = await service.store.record({ image: Buffer.from([5, 2, 3]) });
    await thumbnail({ sender: webContents }, large.item.id);
    assert.deepEqual(resized.at(-1), { width: 160, height: 160, quality: 'good' });
    const preview = handlers.get(CLIPBOARD_CHANNELS.preview);
    await preview({ sender: webContents }, saved.item.id);
    assert.deepEqual(resized.at(-1), { width: 480, height: 320, quality: 'good' }, 'landscape preview keeps its aspect ratio');
    await preview({ sender: webContents }, vertical.item.id);
    assert.deepEqual(resized.at(-1), { width: 120, height: 360, quality: 'good' }, 'portrait preview keeps its aspect ratio');
    assert.deepEqual(await thumbnail({ sender: webContents }, 'missing'), { imageDataUrl: '' });
    assert.equal(Object.keys(await thumbnail({ sender: webContents }, saved.item.id)).some(key => /path|file|buffer/i.test(key)), false);
  } finally {
    service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Windows event listener keeps capturing while the app is open and skips Explorer files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-clipboard-listener-'));
  const handlers = new Map();
  const webContents = { send() {}, isDestroyed: () => false };
  const processHandle = new EventEmitter();
  processHandle.stdin = new PassThrough();
  processHandle.stdout = new PassThrough();
  processHandle.stderr = new PassThrough();
  processHandle.killed = false;
  processHandle.kill = () => { processHandle.killed = true; processHandle.emit('close', null, 'SIGTERM'); };
  let clipboardText = 'captured from event';
  const service = initializeClipboardHistory({
    app: { getPath: () => root, isPackaged: false },
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    getMainWindow: () => ({ webContents, isDestroyed: () => false }),
    clipboard: { readText: () => clipboardText, readImage: () => ({ isEmpty: () => true }), writeText() {}, writeImage() {}, write() {} },
    nativeImage: { createFromBuffer: buffer => ({ buffer, getSize: () => ({ width: 1, height: 1 }), toDataURL: () => 'data:image/png;base64,AA==' }) },
    platform: 'win32',
    spawnFn: () => processHandle
  });
  const waitFor = async predicate => {
    const end = Date.now() + 1500;
    while (Date.now() < end) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Timed out waiting for the clipboard listener test condition.');
  };
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: webContents }, ...args);
  try {
    await service.store.ready;
    await waitFor(() => Boolean(processHandle.stdout.listenerCount('data')));
    processHandle.stdout.write('{"type":"ready"}\r\n');
    await waitFor(() => service.getState().then(state => state.listenerReady));

    processHandle.stdout.write('{"type":"change","files":false}\r\n');
    await waitFor(async () => (await service.store.list()).total === 1);
    assert.equal((await service.store.list()).items[0].textPreview, 'captured from event');

    clipboardText = 'Explorer file path should not be saved';
    processHandle.stdout.write('{"type":"change","files":true}\r\n');
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal((await service.store.list()).total, 1);

    service.ignoreNextText('generated private secret');
    clipboardText = 'generated private secret';
    processHandle.stdout.write('{"type":"change","files":false}\r\n');
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal((await service.store.list()).total, 1);

    clipboardText = 'captured while the app is open';
    processHandle.stdout.write('{"type":"change","files":false}\r\n');
    await waitFor(async () => (await service.store.list()).total === 2);
    assert.equal((await service.store.list()).items[0].textPreview, 'captured while the app is open');
  } finally {
    service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('clipboard history is reachable from navigation and Home, with persistent-data settings packaged', async () => {
  const root = path.join(__dirname, '..');
  const [html, preload, appSource, packageSource, clipboardUi] = await Promise.all([
    fs.readFile(path.join(root, 'src', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'preload.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'package.json'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'clipboard-history-ui.js'), 'utf8')
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.match(html, /data-view="clipboardHistory"/);
  assert.match(html, /data-open-tool="clipboardHistory"/);
  assert.match(html, /id="clipboardHistoryView"/);
  assert.match(html, /id="clipboardQuotaValue"/);
  assert.match(html, /id="clipboardRetentionMode"[\s\S]*?value="never"/);
  assert.match(preload, /getClipboardHistoryState/);
  assert.match(preload, /thumbnailClipboardHistoryItem/);
  assert.match(clipboardUi, /item\.hasImage \? `<div class="clipboard-thumbnail"/);
  assert.match(clipboardUi, /new IntersectionObserver/);
  assert.match(clipboardUi, /thumbnailClipboardHistoryItem\(id\)/);
  assert.doesNotMatch(preload, /setClipboardHistoryPaused|clipboard-history-pause/);
  assert.doesNotMatch(html, /clipboardPauseCapture|Pausar captura/);
  assert.match(appSource, /ntcClipboardHistoryUi\?\.initialize/);
  assert.ok(packageJson.build.asarUnpack.includes('src/clipboard-listener-host.ps1'));
  assert.ok(packageJson.build.asarUnpack.includes('src/clipboard-listener-host.cs'));
  assert.equal(packageJson.build.appId, 'com.ntccorporation.utilities');
});
