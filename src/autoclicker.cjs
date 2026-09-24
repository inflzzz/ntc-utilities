'use strict';

const DEFAULT_CLICKER_SETTINGS = Object.freeze({
  clickSpeed: 10,
  clickInterval: 's',
  rateInputMode: 'rate',
  durationHours: 0,
  durationMinutes: 0,
  durationSeconds: 0,
  durationMilliseconds: 100,
  inputType: 'mouse',
  keyboardKey: 'A',
  keyboardKeyCase: 'lower',
  mouseButton: 'Left',
  mode: 'Toggle',
  hotkey: 'F6',
  dutyCycleMode: 'Click',
  dutyCycleEnabled: true,
  dutyCycle: 45,
  speedRandomizationEnabled: false,
  speedRandomization: 35,
  doubleClickEnabled: false,
  doubleClickGapMs: 45,
  clickLimitEnabled: false,
  clickLimit: 1_000,
  timeLimitEnabled: false,
  timeLimit: 60,
  timeLimitUnit: 's',
  clickPointsEnabled: false,
  clickPoints: [],
  stopZonesEnabled: false,
  stopZones: [],
  cornerStopEnabled: true,
  cornerStopTL: 50,
  cornerStopTR: 50,
  cornerStopBL: 50,
  cornerStopBR: 50,
  edgeStopEnabled: true,
  edgeStopTop: 40,
  edgeStopRight: 40,
  edgeStopBottom: 40,
  edgeStopLeft: 40,
  offset: 0,
  offsetChance: 100,
  smoothing: 0,
  processListEnabled: false,
  processListMode: 'whitelist',
  processListEntries: [],
  taskSwitcherStopEnabled: true,
  stopWhenComplete: false,
  totalClicks: 0,
  advancedOptions: false
});

const MS_PER_INTERVAL = Object.freeze({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 });
const MAX_CPS = 500;
const KEY_PATTERN = /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|SPACE|TAB|ENTER|ESCAPE|BACKSPACE|INSERT|DELETE|HOME|END|PAGEUP|PAGEDOWN|UP|DOWN|LEFT|RIGHT|PRINTSCREEN|CAPSLOCK|NUMLOCK|SCROLLLOCK|PAUSE|PLUS|MINUS|NUMPAD[0-9]|DECIMAL|MULTIPLY|ADD|SUBTRACT|DIVIDE)$/;
const HOTKEY_MODIFIERS = new Set(['CTRL', 'CONTROL', 'ALT', 'SHIFT', 'WIN', 'WINDOWS']);

function numberInRange(value, fallback, min, max, integer = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const safe = Math.min(max, Math.max(min, parsed));
  return integer ? Math.round(safe) : safe;
}

function normalizeKey(value, fallback = 'A') {
  const key = String(value ?? '').trim().toUpperCase();
  const aliases = { ' ': 'SPACE', ESC: 'ESCAPE', RETURN: 'ENTER', PRNTSCRN: 'PRINTSCREEN', PRTSC: 'PRINTSCREEN' };
  const normalized = aliases[key] || key;
  return KEY_PATTERN.test(normalized) ? normalized : fallback;
}

function normalizeHotkey(value) {
  const tokens = String(value || '').trim().split('+').map(token => token.trim().toUpperCase()).filter(Boolean);
  if (!tokens.length) return DEFAULT_CLICKER_SETTINGS.hotkey;
  const modifiers = [];
  let key = '';
  for (const token of tokens) {
    if (HOTKEY_MODIFIERS.has(token)) {
      const canonical = token === 'CTRL' ? 'CONTROL' : token === 'WIN' ? 'WINDOWS' : token;
      if (!modifiers.includes(canonical)) modifiers.push(canonical);
    } else {
      const candidate = normalizeKey(token, '');
      if (!candidate || key) return DEFAULT_CLICKER_SETTINGS.hotkey;
      key = candidate;
    }
  }
  return key ? [...modifiers, key].join('+') : DEFAULT_CLICKER_SETTINGS.hotkey;
}

function normalizePoint(point, index) {
  if (!point || typeof point !== 'object') return null;
  const x = numberInRange(point.x, NaN, -32_768, 32_767, true);
  const y = numberInRange(point.y, NaN, -32_768, 32_767, true);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    id: String(point.id || `point-${index + 1}`).slice(0, 64),
    x,
    y,
    clicks: numberInRange(point.clicks, 1, 1, 1_000_000, true),
    radius: numberInRange(point.radius, 0, 0, 2_000, true)
  };
}

function normalizeStopZone(zone, index) {
  if (!zone || typeof zone !== 'object') return null;
  const x = numberInRange(zone.x, NaN, -32_768, 32_767, true);
  const y = numberInRange(zone.y, NaN, -32_768, 32_767, true);
  if (Number(zone.width) < 1 || Number(zone.height) < 1) return null;
  const width = numberInRange(zone.width, NaN, 1, 32_768, true);
  const height = numberInRange(zone.height, NaN, 1, 32_768, true);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    id: String(zone.id || `zone-${index + 1}`).slice(0, 64),
    x,
    y,
    width,
    height,
    action: ['stop', 'pause', 'start'].includes(zone.action) ? zone.action : 'stop'
  };
}

function normalizeProcessEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = String(entry.name || '').trim().replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').slice(0, 128);
  if (!/^[\w .()\-]+$/u.test(name)) return null;
  return { name, enabled: entry.enabled !== false };
}

function normalizeClickerSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const settings = { ...DEFAULT_CLICKER_SETTINGS };
  settings.clickSpeed = numberInRange(source.clickSpeed, settings.clickSpeed, 1, MAX_CPS, false);
  settings.clickInterval = Object.hasOwn(MS_PER_INTERVAL, source.clickInterval) ? source.clickInterval : settings.clickInterval;
  settings.rateInputMode = source.rateInputMode === 'duration' ? 'duration' : 'rate';
  for (const field of ['durationHours', 'durationMinutes', 'durationSeconds', 'durationMilliseconds']) {
    settings[field] = numberInRange(source[field], settings[field], 0, field === 'durationHours' ? 999 : field === 'durationMilliseconds' ? 999 : 59, true);
  }
  settings.inputType = source.inputType === 'keyboard' ? 'keyboard' : 'mouse';
  settings.keyboardKey = normalizeKey(source.keyboardKey, settings.keyboardKey);
  settings.keyboardKeyCase = source.keyboardKeyCase === 'upper' ? 'upper' : 'lower';
  settings.mouseButton = ['Left', 'Middle', 'Right'].includes(source.mouseButton) ? source.mouseButton : settings.mouseButton;
  settings.mode = source.mode === 'Hold' ? 'Hold' : 'Toggle';
  settings.hotkey = normalizeHotkey(source.hotkey);
  settings.dutyCycleMode = source.dutyCycleMode === 'Hold' ? 'Hold' : 'Click';
  settings.dutyCycleEnabled = source.dutyCycleEnabled !== false;
  settings.dutyCycle = numberInRange(source.dutyCycle, settings.dutyCycle, 0, 100, false);
  settings.speedRandomizationEnabled = Boolean(source.speedRandomizationEnabled);
  settings.speedRandomization = numberInRange(source.speedRandomization, settings.speedRandomization, 0, 200, false);
  settings.doubleClickEnabled = Boolean(source.doubleClickEnabled);
  settings.doubleClickGapMs = numberInRange(source.doubleClickGapMs, settings.doubleClickGapMs, 20, 500, true);
  settings.clickLimitEnabled = Boolean(source.clickLimitEnabled);
  settings.clickLimit = numberInRange(source.clickLimit, settings.clickLimit, 1, 100_000_000, true);
  settings.timeLimitEnabled = Boolean(source.timeLimitEnabled);
  settings.timeLimit = numberInRange(source.timeLimit, settings.timeLimit, 1, 999, false);
  settings.timeLimitUnit = ['s', 'm', 'h'].includes(source.timeLimitUnit) ? source.timeLimitUnit : 's';
  settings.clickPointsEnabled = Boolean(source.clickPointsEnabled);
  settings.clickPoints = (Array.isArray(source.clickPoints) ? source.clickPoints : []).map(normalizePoint).filter(Boolean).slice(0, 50);
  settings.stopZonesEnabled = Boolean(source.stopZonesEnabled);
  settings.stopZones = (Array.isArray(source.stopZones) ? source.stopZones : []).map(normalizeStopZone).filter(Boolean).slice(0, 50);
  settings.cornerStopEnabled = source.cornerStopEnabled !== false;
  settings.edgeStopEnabled = source.edgeStopEnabled !== false;
  for (const field of ['cornerStopTL', 'cornerStopTR', 'cornerStopBL', 'cornerStopBR', 'edgeStopTop', 'edgeStopRight', 'edgeStopBottom', 'edgeStopLeft']) {
    settings[field] = numberInRange(source[field], settings[field], 0, 10_000, true);
  }
  settings.offset = numberInRange(source.offset, settings.offset, 0, 10_000, true);
  settings.offsetChance = numberInRange(source.offsetChance, settings.offsetChance, 0, 100, true);
  settings.smoothing = numberInRange(source.smoothing, settings.smoothing, 0, 100, true);
  settings.processListEnabled = Boolean(source.processListEnabled);
  settings.processListMode = source.processListMode === 'blacklist' ? 'blacklist' : 'whitelist';
  settings.processListEntries = (Array.isArray(source.processListEntries) ? source.processListEntries : []).map(normalizeProcessEntry).filter(Boolean).slice(0, 100);
  settings.taskSwitcherStopEnabled = source.taskSwitcherStopEnabled !== false;
  settings.stopWhenComplete = Boolean(source.stopWhenComplete);
  settings.totalClicks = numberInRange(source.totalClicks, settings.totalClicks, 0, Number.MAX_SAFE_INTEGER, true);
  settings.advancedOptions = Boolean(source.advancedOptions);
  return settings;
}

function intervalMilliseconds(input) {
  const settings = normalizeClickerSettings(input);
  if (settings.rateInputMode === 'duration') {
    const total = settings.durationHours * 3_600_000 + settings.durationMinutes * 60_000 + settings.durationSeconds * 1_000 + settings.durationMilliseconds;
    return Math.max(1_000 / MAX_CPS, total || 1_000);
  }
  return Math.max(1_000 / MAX_CPS, MS_PER_INTERVAL[settings.clickInterval] / settings.clickSpeed);
}

function clickRateRange(input) {
  const settings = normalizeClickerSettings(input);
  const cps = 1_000 / intervalMilliseconds(settings);
  if (!settings.speedRandomizationEnabled || settings.speedRandomization === 0) return { minCps: cps, maxCps: cps };
  const spread = settings.speedRandomization / 100;
  return { minCps: Math.max(0.001, cps * (1 - spread)), maxCps: Math.min(MAX_CPS, cps * (1 + spread)) };
}

module.exports = { DEFAULT_CLICKER_SETTINGS, MS_PER_INTERVAL, MAX_CPS, normalizeClickerSettings, intervalMilliseconds, clickRateRange, normalizeHotkey, normalizePoint, normalizeStopZone };
