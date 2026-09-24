'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_CLICKER_SETTINGS,
  clickRateRange,
  intervalMilliseconds,
  normalizeClickerSettings,
  normalizeHotkey
} = require('../src/autoclicker.cjs');

test('default settings are safe and start with a moderate 10 clicks per second', () => {
  assert.equal(intervalMilliseconds(DEFAULT_CLICKER_SETTINGS), 100);
  assert.equal(DEFAULT_CLICKER_SETTINGS.mode, 'Toggle');
  assert.equal(DEFAULT_CLICKER_SETTINGS.hotkey, 'F6');
  assert.equal(DEFAULT_CLICKER_SETTINGS.doubleClickEnabled, false);
});
test('cadence supports every reference time unit and duration entry', () => {
  assert.equal(intervalMilliseconds({ clickSpeed: 2, clickInterval: 's' }), 500);
  assert.equal(intervalMilliseconds({ clickSpeed: 3, clickInterval: 'm' }), 20_000);
  assert.equal(intervalMilliseconds({ clickSpeed: 2, clickInterval: 'h' }), 1_800_000);
  assert.equal(intervalMilliseconds({ clickSpeed: 1, clickInterval: 'd' }), 86_400_000);
  assert.equal(intervalMilliseconds({ rateInputMode: 'duration', durationMinutes: 1, durationSeconds: 2 }), 62_100);
});

test('both rate and duration modes enforce the 500 CPS ceiling', () => {
  assert.equal(intervalMilliseconds({ clickSpeed: 500, clickInterval: 's' }), 2);
  assert.equal(intervalMilliseconds({ clickSpeed: 5_000, clickInterval: 's' }), 2);
  assert.equal(intervalMilliseconds({ rateInputMode: 'duration', durationMilliseconds: 1 }), 2);
  assert.equal(intervalMilliseconds({ rateInputMode: 'duration', durationMilliseconds: 0 }), 1_000);
});

test('click rate randomization produces bounded CPS range', () => {
  assert.deepEqual(clickRateRange({ clickSpeed: 10, clickInterval: 's', speedRandomizationEnabled: true, speedRandomization: 50 }), { minCps: 5, maxCps: 15 });
  assert.deepEqual(clickRateRange({ clickSpeed: 500, clickInterval: 's', speedRandomizationEnabled: true, speedRandomization: 200 }), { minCps: 0.001, maxCps: 500 });
});

test('hotkey normalizer accepts modifier chords and rejects ambiguous keys', () => {
  assert.equal(normalizeHotkey('ctrl + shift + printscreen'), 'CONTROL+SHIFT+PRINTSCREEN');
  assert.equal(normalizeHotkey('alt + f8'), 'ALT+F8');
  assert.equal(normalizeHotkey('ctrl+alt'), 'F6');
  assert.equal(normalizeHotkey('ctrl+a+b'), 'F6');
});

test('settings migration sanitizes unsupported data and preserves supported point/zone settings', () => {
  const settings = normalizeClickerSettings({
    clickSpeed: 5_000,
    mouseButton: 'Invalid',
    inputType: 'keyboard',
    keyboardKey: 'b',
    mode: 'Hold',
    clickPointsEnabled: true,
    clickPoints: [{ id: 'p1', x: -200, y: 400, clicks: 3, radius: 12 }, { x: NaN, y: 0 }],
    stopZonesEnabled: true,
    stopZones: [{ id: 'z1', x: 10, y: 20, width: 300, height: 100, action: 'pause' }, { x: 0, y: 0, width: 0, height: 0 }],
    processListMode: 'blacklist',
    processListEntries: [{ name: 'game.exe', enabled: true }, { name: 'C:\\bad|name.exe' }]
  });
  assert.equal(settings.clickSpeed, 500);
  assert.equal(settings.mouseButton, 'Left');
  assert.equal(settings.keyboardKey, 'B');
  assert.equal(settings.mode, 'Hold');
  assert.deepEqual(settings.clickPoints, [{ id: 'p1', x: -200, y: 400, clicks: 3, radius: 12 }]);
  assert.deepEqual(settings.stopZones, [{ id: 'z1', x: 10, y: 20, width: 300, height: 100, action: 'pause' }]);
  assert.deepEqual(settings.processListEntries, [{ name: 'game', enabled: true }]);
});

test('screen pickers show live overlays and process filters use detected applications', () => {
  const source = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const host = source('src/autoclicker-host.cs');
  const main = source('src/autoclicker-main.cjs');
  const ui = source('src/autoclicker-ui.js');
  const html = source('src/index.html');
  const overlay = source('src/autoclicker-overlay.js');

  assert.match(host, /EmitPickerPreview\(point\)/);
  assert.match(host, /MainWindowTitle/);
  assert.match(host, /SetWindowsHookEx\(14/);
  assert.match(host, /SetWindowsHookEx\(13/);
  assert.match(host, /KeyboardHookCallbackReference/);
  assert.match(host, /keyboardHook == IntPtr\.Zero \? IsDown\(0x10\) : shiftDown/);
  assert.match(host, /picker-delete-point/);
  assert.match(host, /0x0204/);
  assert.match(main, /screenToDipPoint/);
  assert.match(main, /setIgnoreMouseEvents\(true/);
  assert.match(main, /nearestDistance <= 24 \* 24/);
  assert.match(ui, /data-process-toggle/);
  assert.match(ui, /data-point-clicks/);
  assert.match(ui, /point\.clicks = Math\.max\(1, Math\.min\(100000/);
  assert.match(html, /<details class="autoclicker-process-dropdown">/);
  assert.match(html, /<span>Processos<\/span>/);
  assert.match(html, /autoclicker-option-row/);
  assert.match(html, /autoclickerRefreshProcesses/);
  assert.doesNotMatch(html, /autoclickerProcessName|autoclickerAddProcess/);
  assert.match(overlay, /Arraste com o botão direito/);
  assert.match(overlay, /Ponto \$\{index \+ 1\}/);
});

test('lifetime auto-click total is labeled, restored on startup, and persisted as it changes', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src/autoclicker-main.cjs'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/index.html'), 'utf8');
  assert.match(html, /Cliques em todo tempo/);
  assert.match(html, /Salvo neste dispositivo/);
  assert.match(main, /ntc-autoclicker\.json/);
  assert.match(main, /runtime\.totalClicks = settings\.totalClicks/);
  assert.match(main, /runtime\.totalClicks = nextTotal/);
  assert.match(main, /settings\.totalClicks = nextTotal; persist\(\)/);
});
