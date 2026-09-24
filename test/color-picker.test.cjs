'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeSample, rgbToHsl } = require('../src/color-picker.cjs');
const { initializeColorPicker } = require('../src/color-picker-main.cjs');

test('normalizes a screen sample into exact RGB channels and uppercase HEX', () => {
  assert.deepEqual(normalizeSample({ r: 18, g: 171, b: 255 }), { r: 18, g: 171, b: 255, hex: '#12ABFF' });
});

test('clamps color channels to the valid byte range', () => {
  assert.deepEqual(normalizeSample({ r: -1, g: 256.4, b: 12.5 }), { r: 0, g: 255, b: 13, hex: '#00FF0D' });
});

test('converts black, white, primaries and a neutral sample to HSL', () => {
  assert.equal(rgbToHsl({ r: 0, g: 0, b: 0 }), 'hsl(0, 0%, 0%)');
  assert.equal(rgbToHsl({ r: 255, g: 255, b: 255 }), 'hsl(0, 0%, 100%)');
  assert.equal(rgbToHsl({ r: 255, g: 0, b: 0 }), 'hsl(0, 100%, 50%)');
  assert.equal(rgbToHsl({ r: 0, g: 255, b: 0 }), 'hsl(120, 100%, 50%)');
  assert.equal(rgbToHsl({ r: 128, g: 128, b: 128 }), 'hsl(0, 0%, 50%)');
});

test('rejects samples that do not contain valid numeric channels', () => {
  assert.throws(() => normalizeSample(null), /amostra de cor é inválida/i);
  assert.throws(() => normalizeSample({ r: 1, g: 'blue', b: 3 }), /amostra de cor é inválida/i);
});

test('captures the selected display color and closes its overlay', async () => {
  const handlers = new Map();
  const listeners = new Map();
  const windows = [];
  class FakeWindow {
    static byWebContents = new Map();
    static fromWebContents(webContents) { return this.byWebContents.get(webContents) || null; }
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.events = new Map();
      this.webContents = {
        once: (event, callback) => this.events.set(event, callback),
        send: (channel, payload) => { this.sent = { channel, payload }; },
        isDestroyed: () => false,
        isLoadingMainFrame: () => false
      };
      FakeWindow.byWebContents.set(this.webContents, this);
      windows.push(this);
    }
    on(event, callback) { this.events.set(event, callback); }
    setAlwaysOnTop() {}
    show() {}
    focus() {}
    loadFile() { queueMicrotask(() => this.events.get('did-finish-load')?.()); return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.events.get('closed')?.(); }
  }
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: (channel, listener) => listeners.set(channel, listener)
  };
  class FakeMainWindow extends EventEmitter {
    visible = true;
    minimized = false;
    destroyed = false;
    focused = false;
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    minimize() { this.minimized = true; this.visible = false; queueMicrotask(() => this.emit('minimize')); }
    restore() { this.minimized = false; }
    show() { this.visible = true; }
    focus() { this.focused = true; }
  }
  const mainWindow = new FakeMainWindow();
  initializeColorPicker({
    ipcMain,
    BrowserWindow: FakeWindow,
    screen: { getAllDisplays: () => [{ id: 7, scaleFactor: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    desktopCapturer: { getSources: async () => {
      assert.equal(mainWindow.isMinimized(), true, 'the app must leave the screen before capture');
      return [{ display_id: '7', thumbnail: { isEmpty: () => false, getSize: () => ({ width: 1920, height: 1080 }), toDataURL: () => 'data:image/png;base64,screen' } }];
    } },
    getMainWindow: () => mainWindow
  });

  const pending = handlers.get('color-picker-start')();
  await new Promise(resolve => setImmediate(resolve));
  const overlay = windows[0];
  assert.equal(overlay.sent.channel, 'color-picker-capture');
  assert.equal(overlay.sent.payload.dataUrl, 'data:image/png;base64,screen');
  listeners.get('color-picker-overlay-result')({ sender: overlay.webContents }, { r: 255, g: 128, b: 0 });
  assert.deepEqual(await pending, { r: 255, g: 128, b: 0, hex: '#FF8000', hsl: 'hsl(30, 100%, 50%)' });
  assert.equal(overlay.destroyed, true);
  assert.equal(mainWindow.isMinimized(), false);
  assert.equal(mainWindow.isVisible(), true);
  assert.equal(mainWindow.focused, true);
});

test('screen color picker is reachable, and the autoclicker help/footer match the requested limit', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'color-picker-ui.js'), 'utf8');
  const overlay = fs.readFileSync(path.join(__dirname, '..', 'src', 'color-picker-overlay.html'), 'utf8');
  const overlayUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'color-picker-overlay.js'), 'utf8');
  const host = fs.readFileSync(path.join(__dirname, '..', 'src', 'autoclicker-host.cs'), 'utf8');
  assert.match(html, /data-view="colorPicker"/);
  assert.match(html, /id="colorPickerView"/);
  assert.match(html, /id="autoclickerSpeed"[^>]*max="500"/);
  assert.match(html, /Acima de ~500 CPS/);
  assert.doesNotMatch(html, /Atalho global ativo enquanto o NTC estiver aberto/);
  assert.match(preload, /pickScreenColor:.*color-picker-start/);
  assert.match(ui, /colorPickerHsl/);
  assert.match(html, /id="colorPickerHistory"/);
  assert.doesNotMatch(html, /Últimas 5/);
  assert.match(overlay, /canvas width="148" height="148"/);
  assert.match(overlay, /mira na tela e o centro da lupa indicam o mesmo pixel/i);
  assert.match(overlay, /id="targetMark"/);
  assert.match(overlayUi, /strokeRect\(\(lensCanvas\.width - scaleX\) \/ 2/);
  assert.match(host, /MinimumClickIntervalMs = 2\.0/);
  assert.match(host, /Math\.Max\(MinimumClickIntervalMs, interval\)/);
});
