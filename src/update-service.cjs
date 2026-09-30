'use strict';
const history = require('./release-history.js');
const INTERVAL = 15 * 60 * 1000;
async function fetchHistory(version, fetcher = fetch) {
  if (!history.valid(version)) return [];
  const response = await fetcher(`https://github.com/inflzzz/ntc-utilities/releases/download/v${version}/changelog.json`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Changelog HTTP ${response.status}`);
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > 2 * 1024 * 1024) throw new Error('Changelog too large'); chunks.push(Buffer.from(result.value)); }
  } finally { await reader.cancel().catch(() => {}); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (data.schema !== 1 || data.version !== version) throw new Error('Invalid changelog');
  const entries = history.normalize(data.releases);
  if (!entries.some(entry => entry.version === version)) throw new Error('Missing release notes');
  return entries;
}
function createUpdateService({ updater, version, emit, loadHistory = fetchHistory, now = Date.now, timers = globalThis }) {
  let state = { status: 'idle', currentVersion: version }, inFlight = null, manual = false, lastCheck = -Infinity, startup, interval, stopped = false, enriching = Promise.resolve();
  const listeners = [];
  function publish(payload) { state = { ...state, ...payload, currentVersion: version }; emit({ ...state }); }
  const on = (name, callback) => { updater.on(name, callback); listeners.push([name, callback]); };
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.fullChangelog = true;
  on('checking-for-update', () => { if (!['available', 'downloaded'].includes(state.status)) publish({ status: 'checking', manual }); });
  on('update-available', info => {
    const releases = history.between(history.fromNotes(info.releaseNotes, info.version), version, info.version);
    publish({ status: state.version === info.version && state.status === 'downloaded' ? 'downloaded' : 'available', version: info.version, releases, manual, message: '' });
    enriching = Promise.resolve().then(() => loadHistory(info.version)).then(entries => {
      if (state.version === info.version && !stopped) publish({ releases: history.between(entries, version, info.version), manual });
    }).catch(() => {}); // Missing/offline history never prevents updating; GitHub feed remains available.
  });
  on('update-not-available', () => { if (!['available', 'downloaded'].includes(state.status)) publish({ status: 'current', manual, version }); });
  on('download-progress', progress => publish({ status: 'downloading', percent: Math.round(progress.percent || 0), manual: true }));
  on('update-downloaded', info => publish({ status: 'downloaded', version: info.version, percent: 100, manual: true }));
  on('error', () => {
    const status = state.status === 'downloaded' ? 'downloaded' : ['available', 'downloading'].includes(state.status) ? 'available' : 'error';
    publish({ status, manual, message: 'Não foi possível verificar ou baixar a atualização. Tente novamente mais tarde.' });
  });
  async function check(options = {}) {
    if (stopped) return { ...state };
    if (inFlight) { if (options.manual) manual = true; await inFlight; return { ...state, manual: !!options.manual }; }
    if (state.status === 'downloading' || state.status === 'downloaded') return { ...state, manual: !!options.manual };
    if (!options.manual && now() - lastCheck < (options.resume ? 60000 : INTERVAL)) return { ...state };
    lastCheck = now(); manual = !!options.manual;
    inFlight = Promise.resolve().then(() => updater.checkForUpdates()).then(() => enriching).catch(() => {});
    try { await inFlight; return { ...state, manual: !!options.manual }; } finally { inFlight = null; manual = false; }
  }
  async function download() {
    if (state.status !== 'available') return { ...state };
    manual = true; publish({ status: 'downloading', percent: 0, manual: true, message: '' });
    try { await updater.downloadUpdate(); } catch { publish({ status: 'available', manual: true, message: 'Não foi possível baixar a atualização. Tente novamente.' }); }
    finally { manual = false; }
    return { ...state };
  }
  return { check, download, snapshot: () => ({ ...state, manual: false }),
    start() { if (interval || stopped) return; startup = timers.setTimeout(() => void check(), 2500); interval = timers.setInterval(() => void check(), INTERVAL); startup?.unref?.(); interval?.unref?.(); },
    stop() { stopped = true; timers.clearTimeout(startup); timers.clearInterval(interval); for (const [event, listener] of listeners) updater.removeListener(event, listener); }
  };
}
module.exports = { createUpdateService, fetchHistory, INTERVAL };
