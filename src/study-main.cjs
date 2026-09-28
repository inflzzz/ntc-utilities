'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PHASES = new Set(['focus', 'shortBreak', 'longBreak']);
const MAX_DATE = new Date('2100-01-01T00:00:00.000Z').getTime();

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function timestamp(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_DATE ? Math.round(parsed) : fallback;
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, maxLength).trim();
}

function defaultState() {
  return {
    version: 1,
    pomodoro: {
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      phase: 'focus',
      remainingSeconds: 1500,
      running: false,
      endsAt: null,
      completedSessions: 0,
      focusSeconds: 0,
      completedCycles: 0
    },
    activeDeckId: '',
    decks: []
  };
}

function sanitizeState(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const prior = source.pomodoro && typeof source.pomodoro === 'object' ? source.pomodoro : {};
  const focusMinutes = integer(prior.focusMinutes, 25, 1, 180);
  const phase = PHASES.has(prior.phase) ? prior.phase : 'focus';
  const defaultMinutes = phase === 'shortBreak'
    ? integer(prior.shortBreakMinutes, 5, 1, 60)
    : phase === 'longBreak'
      ? integer(prior.longBreakMinutes, 15, 1, 90)
      : focusMinutes;
  const endsAt = timestamp(prior.endsAt, null);
  const decks = [];
  const deckIds = new Set();
  const cardIds = new Set();
  let totalCards = 0;

  for (const item of Array.isArray(source.decks) ? source.decks.slice(0, 200) : []) {
    if (!item || typeof item !== 'object') continue;
    const id = cleanText(item.id, 100);
    const name = cleanText(item.name, 60);
    if (!id || !name || deckIds.has(id)) continue;
    deckIds.add(id);
    const cards = [];
    for (const raw of Array.isArray(item.cards) ? item.cards : []) {
      if (totalCards >= 20000 || !raw || typeof raw !== 'object') break;
      const cardId = cleanText(raw.id, 100);
      const front = cleanText(raw.front, 4000);
      const back = cleanText(raw.back, 8000);
      if (!cardId || cardIds.has(cardId) || !front || !back) continue;
      cardIds.add(cardId);
      totalCards++;
      cards.push({
        id: cardId,
        front,
        back,
        createdAt: timestamp(raw.createdAt, Date.now()),
        dueAt: timestamp(raw.dueAt, 0),
        intervalDays: Math.max(0, Math.min(36500, Number.isFinite(Number(raw.intervalDays)) ? Number(raw.intervalDays) : 0)),
        ease: Math.max(1.3, Math.min(3.2, Number.isFinite(Number(raw.ease)) ? Number(raw.ease) : 2.5)),
        repetitions: integer(raw.repetitions, 0, 0, 1000000),
        lapses: integer(raw.lapses, 0, 0, 1000000),
        lastReviewedAt: timestamp(raw.lastReviewedAt, 0)
      });
    }
    decks.push({ id, name, cards });
  }

  const validActiveDeck = decks.some(deck => deck.id === source.activeDeckId) ? source.activeDeckId : decks[0]?.id || '';
  const remainingSeconds = integer(prior.remainingSeconds, defaultMinutes * 60, 0, 10800);
  const running = Boolean(prior.running && endsAt && remainingSeconds >= 0);

  return {
    version: 1,
    pomodoro: {
      focusMinutes,
      shortBreakMinutes: integer(prior.shortBreakMinutes, 5, 1, 60),
      longBreakMinutes: integer(prior.longBreakMinutes, 15, 1, 90),
      longBreakEvery: integer(prior.longBreakEvery, 4, 2, 12),
      phase,
      remainingSeconds,
      running,
      endsAt: running ? endsAt : null,
      completedSessions: integer(prior.completedSessions, 0, 0, 100000000),
      focusSeconds: integer(prior.focusSeconds, 0, 0, 100000000000),
      completedCycles: integer(prior.completedCycles, 0, 0, 100000000)
    },
    activeDeckId: validActiveDeck,
    decks
  };
}

function createStudyService({ app, ipcMain, getMainWindow }) {
  const statePath = path.join(app.getPath('userData'), 'ntc-study-state.json');

  const read = () => {
    try { return sanitizeState(JSON.parse(fs.readFileSync(statePath, 'utf8'))); }
    catch { return defaultState(); }
  };

  const write = state => {
    const safe = sanitizeState(state);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tempPath = `${statePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(safe), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, statePath);
    } catch (error) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      throw error;
    }
    return safe;
  };

  const authorized = event => Boolean(getMainWindow() && !getMainWindow().isDestroyed() && event.sender === getMainWindow().webContents);
  ipcMain.handle('study-state-load', event => authorized(event) ? read() : null);
  ipcMain.handle('study-state-save', (event, state) => {
    if (!authorized(event)) return { ok: false, reason: 'invalid-sender' };
    try { return { ok: true, state: write(state) }; }
    catch { return { ok: false, reason: 'storage-error' }; }
  });

  return { read, write };
}

module.exports = { createStudyService, sanitizeState, defaultState };
