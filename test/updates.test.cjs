const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const history = require('../src/release-history.js');
const { createUpdateService, fetchHistory, INTERVAL } = require('../src/update-service.cjs');
const releases = ['1.4.0', '1.3.0', '1.2.1', '1.2.0', '1.1.0', '1.0.1', '1.0.0'].map(version => ({ version, changes: [`Novidade ${version}`] }));
function fixture() {
  const updater = new EventEmitter(), emitted = [], scheduled = new Map(); let clock = 0, calls = 0, downloads = 0;
  updater.checkForUpdates = async () => { calls++; updater.emit('checking-for-update'); updater.emit('update-available', { version: '1.4.0', releaseNotes: 'Uma novidade' }); };
  updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 70 }); updater.emit('update-downloaded', { version: '1.4.0' }); };
  const timers = { setTimeout(fn, ms) { scheduled.set(ms, fn); return ms; }, setInterval(fn, ms) { scheduled.set(ms, fn); return ms; }, clearTimeout(id) { scheduled.delete(id); }, clearInterval(id) { scheduled.delete(id); } };
  const service = createUpdateService({ updater, version: '1.0.0', emit: value => emitted.push(value), loadHistory: async () => releases, now: () => clock, timers });
  return { service, updater, emitted, scheduled, setClock: value => clock = value, calls: () => calls, downloads: () => downloads };
}
test('complete skipped history is stable, numeric, bounded and excludes old or future versions', () => {
  assert.deepEqual(history.between([...releases, { version: '1.4.0', changes: ['Duplicate'] }, { version: 'ambient-packs-v1' }], '1.0.0', '1.3.0').map(entry => entry.version), ['1.3.0', '1.2.1', '1.2.0', '1.1.0', '1.0.1']);
  assert.equal(history.compare('1.10.0', '1.9.9'), 1); assert.equal(history.between(releases, '1.4.0', '1.3.0').length, 0);
  const notes = history.fromNotes([{ version: '1.3.0', note: '<h2>Novas ferramentas</h2><ul><li>Uma</li><li>Duas &amp; mais</li></ul>' }, { version: '1.4.0', note: '## Novo\\n\\n- Teste' }]);
  assert.deepEqual(notes.map(note => note.version), ['1.4.0', '1.3.0']); assert.deepEqual(notes[1].changes, ['Novas ferramentas', 'Uma', 'Duas & mais']);
});
test('scheduled checks happen while open; focus is throttled; checks are coalesced; stop cancels scheduling', async () => {
  const f = fixture(); f.service.start(); assert.equal(f.scheduled.size, 2);
  await Promise.all([f.service.check(), f.service.check()]); assert.equal(f.calls(), 1);
  await f.service.check(); assert.equal(f.calls(), 1);
  f.setClock(INTERVAL); f.scheduled.get(INTERVAL)(); await f.service.check({ manual: true }); assert.equal(f.calls(), 2);
  await f.service.check({ manual: true }); assert.equal(f.calls(), 3);
  f.setClock(INTERVAL + 60000); await f.service.check({ resume: true }); assert.equal(f.calls(), 4);
  assert.equal(f.updater.fullChangelog, true); assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false);
  f.service.stop(); assert.equal(f.scheduled.size, 0); assert.equal(f.updater.listenerCount('update-available'), 0); await f.service.check({ manual: true }); assert.equal(f.calls(), 4);
});
test('all version boundaries and history survive download and install-ready events', async () => {
  const f = fixture(); await f.service.check(); assert.equal(f.downloads(), 0);
  assert.equal(f.service.snapshot().releases.length, 6);
  const downloaded = await f.service.download(); assert.equal(f.downloads(), 1); assert.equal(downloaded.status, 'downloaded'); assert.equal(downloaded.currentVersion, '1.0.0'); assert.equal(downloaded.version, '1.4.0'); assert.equal(downloaded.releases.length, 6);
  const progress = f.emitted.find(entry => entry.status === 'downloading' && entry.percent === 70); assert.equal(progress.releases.length, 6); assert.equal(progress.version, '1.4.0');
  f.setClock(INTERVAL); await f.service.check(); assert.equal(f.calls(), 1);
  f.updater.emit('error', new Error('offline')); assert.equal(f.service.snapshot().status, 'downloaded'); f.service.stop();
});
test('missing remote asset falls back to GitHub feed without blocking download', async () => {
  const updater = new EventEmitter(); updater.checkForUpdates = async () => updater.emit('update-available', { version: '1.4.0', releaseNotes: releases.map(entry => ({ version: entry.version, note: entry.changes[0] })) });
  const service = createUpdateService({ updater, version: '1.0.0', emit() {}, loadHistory: async () => { throw new Error('offline'); } });
  const result = await service.check(); assert.equal(result.status, 'available'); assert.equal(result.releases.length, 6);
  updater.emit('error'); assert.equal(service.snapshot().status, 'available'); service.stop();
});
test('dismissal suppresses only the same version and stage; manual and downloaded can reopen', () => {
  const gate = history.createNoticeGate(), update = { version: '1.4.0', status: 'available' };
  gate.dismiss(update); assert.equal(gate.shouldShow(update), false); assert.equal(gate.shouldShow({ ...update, status: 'downloading' }), false);
  assert.equal(gate.shouldShow({ ...update, manual: true }), true); assert.equal(gate.shouldShow({ ...update, status: 'downloaded' }), true); assert.equal(gate.shouldShow({ ...update, version: '1.5.0' }), true);
});
test('remote history validates schema, version, size and fixed GitHub URL', async () => {
  let seen;
  const fetcher = async url => { seen = url; return new Response(JSON.stringify({ schema: 1, version: '1.4.0', releases })); };
  assert.equal((await fetchHistory('1.4.0', fetcher)).length, 7); assert.equal(seen, 'https://github.com/inflzzz/ntc-utilities/releases/download/v1.4.0/changelog.json');
  assert.deepEqual(await fetchHistory('../unsafe', fetcher), []);
  await assert.rejects(fetchHistory('1.4.0', async () => new Response(JSON.stringify({ schema: 1, version: '1.3.0', releases }))), /Invalid/);
  await assert.rejects(fetchHistory('1.4.0', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), /too large/);
});
