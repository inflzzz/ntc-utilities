'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { MusicStore } = require('../src/music-store.cjs');
const { MusicService, probeAudio, convertForPlayback } = require('../src/music-service.cjs');
const model = require('../src/music-player-model.js');
const { MusicSearchCache } = require('../src/music-search-cache.cjs');

async function fixture(work) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-music2-test-'));
  const store = new MusicStore(path.join(root, 'library.sqlite'));
  try { await work({ root, store }); } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
}
const tags = file => ({ metadata: { title: path.basename(file).replace(/\.mp3$/, ''), artist: 'Frank Sinatra', album: '1957', year: '1957', genre: 'Jazz' }, duration: 123, format: 'mp3', codec: 'mp3', bitrate: 320000, sample_rate: 44100, channels: 2 });

test('incremental folder scan indexes subfolders, tags and unchanged files without duplication', () => fixture(async ({ root, store }) => {
  const album = path.join(root, 'artist', 'album'); await fs.mkdir(album, { recursive: true });
  const song = path.join(album, 'track.mp3'); await fs.writeFile(song, 'audio'); await fs.writeFile(path.join(album, 'cover.jpg'), 'image');
  const source = store.addSources([root, root], 'folder')[0]; let probes = 0;
  const service = new MusicService({ store, ffprobe: '', probe: async (_exe, file) => { probes++; return tags(file); } });
  await service.scan();
  assert.equal(store.count(), 1); assert.equal(probes, 1);
  assert.equal(store.list({ query: 'sinatra 1957' }).items[0].title, 'track');
  const id = store.byPath(song).id;
  store.overrideMetadata([id], { title: 'Local Title', genre: 'Swing' });
  assert.equal(store.list({ query: 'local swing' }).total, 1);
  store.updateMetadata(id, tags(song)); assert.equal(store.getTrack(id).title, 'Local Title');
  assert.equal(store.list({ view: 'album', group: '1957' }).total, 1);
  assert.equal(store.groups('albums')[0].sample_id, id);
  assert.equal(store.groups('albums')[0].artist, 'Frank Sinatra');
  assert.equal(store.groups('artists')[0].name, 'Frank Sinatra');
  await service.scan(); assert.equal(store.count(), 1); assert.equal(probes, 1);
  assert.equal(store.sources()[0].id, source.id);
  assert.equal(store.folderChildren(source.id, root)[0].child, 'artist');
  assert.equal(store.folderChildren(source.id, path.join(root, 'artist'))[0].child, 'album');
  assert.equal((await fs.stat(song)).isFile(), true);
}));

test('missing files survive rescan and a removed source never deletes user files', () => fixture(async ({ root, store }) => {
  const folder = path.join(root, 'original-folder'); await fs.mkdir(folder);
  const song = path.join(folder, 'original.mp3'); await fs.writeFile(song, 'audio');
  const source = store.addSources([folder], 'folder')[0]; const service = new MusicService({ store, ffprobe: '', probe: async () => tags(song) });
  await service.scan(); const id = store.byPath(song).id;
  await fs.unlink(song); await service.scan(); assert.equal(store.getTrack(id).available, 0); assert.equal(store.list({ view: 'missing' }).total, 1);
  const replacement = path.join(root, 'moved.mp3'); await fs.writeFile(replacement, 'audio');
  store.relocateTrack(id, replacement); assert.equal(store.getTrack(id).available, 1);
  await service.scan(); assert.equal(store.count(), 1); assert.equal(store.hasActivePath(replacement), true);
  store.removeSource(source.id); assert.equal(store.count(), 1); assert.equal((await fs.stat(replacement)).isFile(), true);
}));

test('ignored subfolders leave the library after rescan but remain untouched on disk', () => fixture(async ({ root, store }) => {
  const kept = path.join(root, 'Music'); const ignored = path.join(root, 'Drafts'); await fs.mkdir(kept); await fs.mkdir(ignored);
  const keepFile = path.join(kept, 'song.mp3'); const ignoredFile = path.join(ignored, 'draft.mp3'); await fs.writeFile(keepFile, 'audio'); await fs.writeFile(ignoredFile, 'audio');
  const source = store.addSources([root], 'folder')[0]; const service = new MusicService({ store, ffprobe: '', probe: async (_exe, file) => tags(file) });
  await service.scan(); assert.equal(store.count(), 2);
  store.ignoreSubfolder(source.id, 'Drafts'); await service.scan();
  assert.equal(store.count(), 1); assert.equal(store.list().items[0].path, keepFile); assert.equal((await fs.stat(ignoredFile)).isFile(), true);
}));

test('relocation keeps a track id and its playlist/favorite references', () => fixture(async ({ root, store }) => {
  const oldFolder = path.join(root, 'old'); const newFolder = path.join(root, 'new'); await fs.mkdir(oldFolder); await fs.mkdir(newFolder);
  const oldFile = path.join(oldFolder, 'song.mp3'); const newFile = path.join(newFolder, 'song.mp3'); await fs.writeFile(oldFile, 'audio');
  const source = store.addSources([oldFolder], 'folder')[0]; const id = store.upsertFile(oldFile, await fs.stat(oldFile), source.id).id;
  store.toggleLike(id); const playlist = Number(store.createPlaylist('Relocated')); store.addPlaylistItems(playlist, [id]); await fs.rename(oldFile, newFile);
  store.relocateSource(source.id, newFolder); store.relocateTrack(id, newFile);
  assert.equal(store.getTrack(id).path, newFile); assert.equal(store.getTrack(id).liked, 1); assert.equal(store.playlistItems(playlist)[0].id, id);
}));

test('relinking an individually imported missing file replaces the old file source', () => fixture(async ({ root, store }) => {
  const original = path.join(root, 'original.mp3'), replacement = path.join(root, 'replacement.mp3');
  await fs.writeFile(original, 'audio'); const source = store.addSources([original], 'file')[0];
  const id = store.upsertFile(original, await fs.stat(original), source.id).id;
  await fs.rename(original, replacement); store.relocateTrack(id, replacement);
  const service = new MusicService({ store, ffprobe: '', probe: async () => tags(replacement) }); await service.scan();
  assert.equal(store.count(), 1); assert.equal(store.byPath(replacement).id, id);
  assert.equal(store.sources().length, 1); assert.equal(store.sources()[0].path, replacement);
}));

test('individual file imports, playlists, favorites, ratings, history and session persist independently', () => fixture(async ({ root, store }) => {
  const file = path.join(root, 'single.mp3'); await fs.writeFile(file, 'audio');
  const source = store.addSources([file], 'file')[0]; const service = new MusicService({ store, ffprobe: '', probe: async () => tags(file) });
  await service.scan(); const track = store.byPath(file); assert.ok(track); assert.equal(store.sources()[0].kind, 'file');
  assert.equal(store.toggleLike(track.id), 1); store.setRating(track.id, 4); store.recordPlay(track.id, 12345);
  const playlist = Number(store.createPlaylist('Favoritas')); store.addPlaylistItems(playlist, [track.id, track.id]);
  assert.equal(store.playlistItems(playlist).length, 2);
  store.reorderPlaylistItem(store.playlistItems(playlist)[1].item_id, store.playlistItems(playlist)[0].item_id);
  assert.equal(store.playlistItems(playlist)[0].id, track.id);
  store.removePlaylistItem(store.playlistItems(playlist)[0].item_id); assert.equal(store.playlistItems(playlist).length, 1);
  store.setSetting('session', { currentId: track.id, queue: [track.id, track.id], volume: .35 });
  assert.equal(store.list({ view: 'liked' }).total, 1); assert.equal(store.list({ sort: 'plays' }).items[0].play_count, 1);
  assert.equal(store.history()[0].played_at, 12345); assert.equal(store.getTrack(track.id).rating, 4);
  assert.deepEqual(store.setting('session').queue, [track.id, track.id]);
  store.removeTrack(track.id); assert.equal(store.count(), 0); assert.equal(store.playlistItems(playlist).length, 1); assert.equal((await fs.stat(file)).isFile(), true);
  assert.equal(source.available, 1);
}));

test('playlist rename and description persist while preserving playlist identity', () => fixture(async ({ store }) => {
  const id = Number(store.createPlaylist('Minhas músicas'));
  store.renamePlaylist(id, 'Músicas favoritas');
  store.updatePlaylist(id, { description: 'Seleção para ouvir depois.' });
  const playlist = store.playlists().find(item => Number(item.id) === id);
  assert.ok(playlist);
  assert.equal(playlist.name, 'Músicas favoritas');
  assert.equal(playlist.description, 'Seleção para ouvir depois.');
}));

test('playlist rename and description use an inline editor and persist while keeping details open', async () => {
  const playerSource = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.js'), 'utf8');
  const editorStart = playerSource.indexOf('async function openPlaylist(playlist)');
  const editorEnd = playerSource.indexOf('async function switchView(view)', editorStart);
  const playlistActions = playerSource.slice(editorStart, editorEnd);
  assert.ok(editorStart >= 0 && editorEnd > editorStart);
  assert.match(playlistActions, /rename\.onclick = \(\) => \{ state\.playlistEditor = 'name'/);
  assert.match(playlistActions, /editDescription\.onclick = \(\) => \{ state\.playlistEditor = 'description'/);
  assert.match(playlistActions, /form\.onsubmit = async event =>[\s\S]*?await api\.renamePlaylist\(playlist\.id, value\)[\s\S]*?await refreshPlaylistDetails\(playlist\.id\)/);
  assert.match(playlistActions, /await api\.updatePlaylist\(playlist\.id, \{ description: value \}\)[\s\S]*?await refreshPlaylistDetails\(playlist\.id\)/);
  assert.match(playlistActions, /cancel\.onclick = \(\) => \{ state\.playlistEditor = null/);
  assert.match(playlistActions, /role', 'alert'/);
  assert.doesNotMatch(playlistActions, /editPlaylistField|showModal/);
});

test('removing a track remains excluded across folder rescans; explicit file import restores it', () => fixture(async ({ root, store }) => {
  const file = path.join(root, 'keep-on-disk.mp3'); await fs.writeFile(file, 'audio');
  store.addSources([root], 'folder'); const service = new MusicService({ store, ffprobe: '', probe: async () => tags(file) });
  await service.scan(); const id = store.byPath(file).id;
  store.toggleLike(id); store.removeTrack(id);
  await service.scan(); assert.equal(store.count(), 0); assert.equal(store.getTrack(id).excluded, 1);
  assert.equal((await fs.stat(file)).isFile(), true);
  const direct = store.addSources([file], 'file')[0]; await service.scan([direct.id]);
  assert.equal(store.count(), 1); assert.equal(store.byPath(file).id, id); assert.equal(store.byPath(file).liked, 1);
}));

test('legacy removed tracks remain excluded when importing an old folder', () => fixture(async ({ root, store }) => {
  const file = path.join(root, 'removed-before-upgrade.mp3'); await fs.writeFile(file, 'audio');
  store.addSources([root], 'folder'); store.excludePaths([file]);
  const service = new MusicService({ store, ffprobe: '', probe: async () => tags(file) });
  await service.scan(); assert.equal(store.count(), 0); assert.equal(store.byPath(file).excluded, 1);
}));

test('legacy favorites and playlists migrate without erasing the original data or duplicating memberships', () => fixture(async ({ root, store }) => {
  const file = path.join(root, 'legacy.mp3'); await fs.writeFile(file, 'audio'); const source = store.addSources([file], 'file')[0];
  const id = store.upsertFile(file, await fs.stat(file), source.id).id;
  const legacy = { liked: [file], playlists: [{ id: 'old-1', name: 'Old mix', trackIds: [file] }] };
  store.importLegacy(legacy); store.importLegacy(legacy);
  assert.equal(store.getTrack(id).liked, 1); assert.equal(store.playlists().length, 1); assert.equal(store.playlistItems(store.playlists()[0].id).length, 1);
  const missing = path.join(root, 'missing.mp3'); store.importLegacy({ liked: [missing], playlists: [{ id: 'old-2', name: 'Lost', trackIds: [missing] }] });
  assert.equal(store.byPath(missing).available, 0); assert.equal(store.byPath(missing).liked, 1); assert.equal(store.playlistItems(store.playlists().find(item => item.name === 'Lost').id).length, 1);
}));

test('legacy playback session migrates after indexing and restores paused position without replaying', () => fixture(async ({ root, store }) => {
  const file = path.join(root, 'resume.mp3'); await fs.writeFile(file, 'audio');
  const source = store.addSources([file], 'file')[0];
  const legacy = { playback: { trackId: file, queueIds: [file, file], time: 34 }, volume: '45', crossfade: '3' };
  store.importLegacy(legacy); assert.equal(store.setting('session'), null);
  const id = store.upsertFile(file, await fs.stat(file), source.id).id;
  store.importLegacy(legacy);
  assert.equal(store.setting('session').currentId, id); assert.deepEqual(store.setting('session').queue.map(item => item.id), [id, id]);
  assert.equal(store.setting('session').volume, .45); assert.equal(store.setting('session').crossfade, 3);
  assert.deepEqual(store.setting('position'), { id, seconds: 34 });
}));

test('untagged files remain visible; search, sorting and automatic collections query the index', () => fixture(async ({ root, store }) => {
  const files = ['Jazz Night.mp3', 'Second.mp3']; for (const name of files) await fs.writeFile(path.join(root, name), 'audio');
  const source = store.addSources([root], 'folder')[0];
  const first = store.upsertFile(path.join(root, files[0]), await fs.stat(path.join(root, files[0])), source.id).id;
  const second = store.upsertFile(path.join(root, files[1]), await fs.stat(path.join(root, files[1])), source.id).id;
  store.updateMetadata(first, { metadata: { artist: 'Sinatra', year: '1957', genre: 'Jazz' }, duration: 100 });
  store.updateMetadata(second, { metadata: { artist: 'Another', year: '2020' }, duration: 40 });
  assert.equal(store.getTrack(first).title, 'Jazz Night');
  assert.equal(store.list({ query: 'sinatra 1957' }).items[0].id, first);
  assert.equal(store.list({ query: 'jazz night' }).total, 1);
  assert.equal(store.list({ sort: 'duration' }).items[0].id, second);
  assert.equal(store.list({ view: 'unplayed' }).total, 2);
  store.toggleLike(first); store.recordPlay(second, 1000);
  assert.equal(store.list({ view: 'liked' }).items[0].id, first);
  assert.equal(store.list({ view: 'recent' }).items[0].id, second);
  assert.equal(store.list({ view: 'unplayed' }).total, 1);
}));

test('indexing can be cancelled without marking unseen tracks missing', () => fixture(async ({ root, store }) => {
  for (let i = 0; i < 250; i++) await fs.writeFile(path.join(root, `track-${i}.mp3`), 'audio');
  store.addSources([root], 'folder'); let service; let cancelFirst = true;
  service = new MusicService({ store, ffprobe: '', probe: async () => tags('song.mp3'), onProgress: progress => { if (progress.scanned >= 100 && cancelFirst) { cancelFirst = false; service.cancelScan(); } } });
  const result = await service.scan(); assert.equal(result.cancelled, true); assert.ok(store.count() >= 100 && store.count() < 250);
  await service.scan(); assert.equal(store.count(), 250);
}));

test('model keeps queue duplicates, bounded virtual range, LRC and play threshold', () => {
  assert.deepEqual(model.visibleRange(0, 580, 1_000_000), { first: 0, last: 18 });
  assert.deepEqual(model.visibleRange(5_800_000, 580, 1_000_000), { first: 99992, last: 100018 });
  const queue = [{ id: 5, key: 'a' }, { id: 5, key: 'b' }, { id: 7, key: 'c' }];
  assert.deepEqual(model.moveQueueItem(queue, 0, 2).map(item => item.key), ['b', 'c', 'a']);
  assert.equal(model.nextQueueIndex({ length: 3, index: 2, repeat: 'off' }), -1);
  assert.equal(model.nextQueueIndex({ length: 3, index: 2, repeat: 'all' }), 0);
  assert.equal(model.nextQueueIndex({ length: 3, index: 1, repeat: 'one' }), 1);
  assert.equal(model.shouldRecordPlay(2, 120, false), false); assert.equal(model.shouldRecordPlay(30, 120, false), true);
  assert.equal(model.shouldRecordPlay(4, 10, false), false); assert.equal(model.shouldRecordPlay(5, 10, false), true);
  assert.deepEqual(model.crossfadeVolumes(0, 4, .8), { from: .8, to: 0 });
  assert.deepEqual(model.crossfadeVolumes(2, 4, .8), { from: .4, to: .4 });
  assert.deepEqual(model.crossfadeVolumes(5, 4, .8), { from: 0, to: .8 });
  assert.equal(model.nextQueueIndex({ length: 3, index: 0, repeat: 'off', shuffle: true }, () => .1), 1);
  assert.equal(model.parseLrc('[00:02.50]Hello\n[00:01.00]First')[0].text, 'First');
  assert.equal(model.libraryCountLabel(4, 4), '4 faixas');
  assert.equal(model.libraryCountLabel(1, 4), '1 de 4 faixas');
  assert.equal(model.libraryCountLabel(0, 4), '0 de 4 faixas');
});

test('library selection is independent from current playback across click and double-click', async () => {
  let player = { selectedTrackId: null, currentTrackId: null, playing: false, selectedQueueKey: 'queue-a', selectedPlaylistItemId: 17 };
  player = { ...player, ...model.transitionTrackIdentity(player, { type: 'play', id: 41, select: true }), playing: true };
  assert.equal(player.currentTrackId, 41);
  assert.equal(player.selectedTrackId, 41);

  // A simple click selects B, but must not retarget or pause A.
  player = { ...player, ...model.selectTrackInView(player, 52, 'library') };
  assert.equal(player.selectedTrackId, 52);
  assert.equal(player.selectedQueueKey, null);
  assert.equal(player.selectedPlaylistItemId, null);
  assert.equal(player.currentTrackId, 41);
  assert.equal(player.playing, true);
  assert.deepEqual(model.trackRowState(player, 41), { selected: false, current: true, playing: true });
  assert.deepEqual(model.trackRowState(player, 52), { selected: true, current: false, playing: false });
  assert.equal([41, 52].filter(id => model.trackRowState(player, id).selected).length, 1);

  // Double-clicking B deliberately selects and starts it; there is still only one selected row.
  player = { ...player, ...model.transitionTrackIdentity(player, { type: 'play', id: 52, select: true }), playing: true };
  assert.equal(player.selectedTrackId, 52);
  assert.equal(player.currentTrackId, 52);
  assert.deepEqual(model.trackRowState(player, 41), { selected: false, current: false, playing: false });
  assert.deepEqual(model.trackRowState(player, 52), { selected: true, current: true, playing: true });
  assert.equal([41, 52].filter(id => model.trackRowState(player, id).selected).length, 1);
  const playerSource = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.js'), 'utf8');
  const playerCss = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.css'), 'utf8');
  assert.match(playerSource, /row\.onclick = event => selectRow\(event, index, track\.id\)/);
  assert.match(playerSource, /if \(rowState\.current\) \{ const marker = document\.createElement\('span'\); marker\.className = 'mv-current-indicator'/);
  assert.match(playerCss, /\.mv-row\.selected \{ background: #[0-9a-f]{6}; \}/i);
  assert.match(playerCss, /\.mv-row\.current \{ box-shadow: inset 2px 0 #[0-9a-f]{6}; \}/i);
  assert.doesNotMatch(playerCss, /\.mv-row\.current \{ background:/i);
});

test('library renderer creates a row element before applying track state', async () => {
  const playerSource = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.js'), 'utf8');
  const renderVisible = playerSource.match(/function renderVisible\(\) \{([\s\S]*?)\n  \}\n  function updateEmpty/);
  assert.ok(renderVisible, 'renderVisible function should exist');
  const body = renderVisible[1];
  const createRow = body.indexOf("const row = document.createElement('div')");
  const assignClass = body.indexOf('row.className =');
  const appendRow = body.indexOf('rows.append(row)');
  assert.ok(createRow >= 0, 'each visible library track must create its own DOM row');
  assert.ok(assignClass > createRow, 'track state must be applied after the row exists');
  assert.ok(appendRow > assignClass, 'the rendered row must be appended to the visible list');
});

test('restored library filter is validated and reflected in the active tab instead of masquerading as Todas', async () => {
  const playerSource = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.js'), 'utf8');
  assert.match(playerSource, /state\.filter = libraryFilters\.has\(saved\.filter\) \? saved\.filter : 'songs'/);
  assert.match(playerSource, /function renderFilterButtons\(\)[\s\S]*?button\.classList\.toggle\('active', active\); button\.setAttribute\('aria-pressed', String\(active\)\)/);
  assert.match(playerSource, /renderFilterButtons\(\); renderTransport\(\); renderEq\(\); renderQueue\(\)/);
  assert.match(playerSource, /function renderLibraryCount\(\) \{ \$\('mvCount'\)\.textContent = model\.libraryCountLabel\(state\.total, state\.count\); \}/);
});

test('music settings drawer stays inside the app viewport and can scroll internally', async () => {
  const playerCss = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.css'), 'utf8');
  assert.match(playerCss, /\.music-v2 \.mv-drawer \{[^}]*top: 60px; right: 12px; bottom: 12px;[^}]*overflow: auto;[^}]*border: 1px solid[^}]*border-radius: 11px;/);
  assert.match(playerCss, /@media \(max-height: 620px\) \{ \.music-v2 \.mv-drawer \{ top: 54px; right: 8px; bottom: 8px; padding: 14px; \} \}/);
});

test('player artwork is larger, utility actions are separate, and sort control has stable width', async () => {
  const playerSource = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.js'), 'utf8');
  const playerCss = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.css'), 'utf8');
  assert.match(playerSource, /<div class="mv-player-column"><section class="mv-now"[\s\S]*?<\/section><section class="mv-tools"[\s\S]*?id="mvInfo"[\s\S]*?id="mvLyricsButton"[\s\S]*?id="mvMini"/);
  assert.match(playerCss, /\.music-v2 \.mv-art \{[^}]*width: min\(100%, 280px\)/);
  assert.match(playerCss, /@media \(max-width: 1020px\)[^\n]*grid-template-columns: 170px minmax\(0,1fr\)[^\n]*width: 170px/);
  assert.match(playerCss, /@media \(max-width: 650px\)[^\n]*width: 185px/);
  assert.match(playerCss, /\.music-v2 #mvSort \{ width: 150px; min-width: 150px; max-width: 150px; flex: 0 0 150px;[^}]*text-align: center; text-align-last: center;/);
  assert.match(playerCss, /\.music-v2 \.mv-now-actions button \{[^}]*min-height: 38px;[^}]*font-size: 12px; font-weight: 500;/);
});

test('selection in queue or playlist stays singular across library views without changing the current track', () => {
  const initial = { selectedTrackId: 41, currentTrackId: 41, playing: false, selectedQueueKey: null, selectedPlaylistItemId: null };
  const queue = model.selectTrackInView({ ...initial, selectedQueueKey: 'old-key', selectedPlaylistItemId: 8 }, 52, 'queue');
  assert.equal(queue.selectedTrackId, 52); assert.equal(queue.selectedQueueKey, 'old-key'); assert.equal(queue.selectedPlaylistItemId, null);
  assert.equal(queue.currentTrackId, 41);
  const playlist = model.selectTrackInView({ ...queue, selectedPlaylistItemId: 9 }, 63, 'playlist');
  assert.equal(playlist.selectedTrackId, 63); assert.equal(playlist.selectedQueueKey, null); assert.equal(playlist.selectedPlaylistItemId, 9);
  assert.equal(playlist.currentTrackId, 41); assert.equal(playlist.playing, false);
});

test('restoring a paused track applies saved volume and mute before audio resumes', async () => {
  const playerSource = await fs.readFile(path.join(__dirname, '..', 'src', 'music-player-v2.js'), 'utf8');
  assert.match(playerSource, /state\.volume = Math\.max\(0, Math\.min\(1, Number\(saved\.volume \?\? \.8\)\)\); state\.muted = Boolean\(saved\.muted\)/);
  assert.match(playerSource, /await ensureAudioGraph\(\); applyVolumes\(\); await currentAudio\(\)\.play\(\); state\.playing = true/);
  assert.match(playerSource, /renderTransport\(\); renderTime\(\); applyVolumes\(\); renderPlaybackRows\(\); persistSoon\(\);[\s\S]*await audio\[nextDeck\]\.play\(\)/);
});

test('online metadata cache is LRU, expires, and enforces its memory budget', () => {
  const cache = new MusicSearchCache({ maxEntries: 2, maxBytes: 80, ttlMs: 100 });
  assert.equal(cache.set('a', { title: 'A' }, 0), true);
  assert.equal(cache.set('b', { title: 'B' }, 0), true);
  assert.deepEqual(cache.get('a', 10), { title: 'A' });
  assert.equal(cache.set('c', { title: 'C' }, 20), true);
  assert.equal(cache.get('b', 21), null);
  assert.deepEqual(cache.get('a', 21), { title: 'A' });
  assert.equal(cache.get('c', 120), null);
  assert.equal(cache.set('too-large', 'x'.repeat(100), 121), false);
  assert.ok(cache.bytes <= 80);
});

test('mini player reflects playback/artwork and sends transport commands without owning the audio', async () => {
  const elements = Object.fromEntries(['art','title','artist','play','mute','time','duration','seek','volume','previous','next','onTop','open'].map(id => [id, { textContent: '', innerHTML: '', value: '', checked: false, children: [], attributes: {}, style: {}, replaceChildren() { this.children = []; }, append(item) { this.children.push(item); }, setAttribute(key, value) { this.attributes[key] = value; }, matches() { return false; } }]));
  const commands = []; let notify;
  const api = { onMiniState: callback => { notify = callback; }, sendControl: command => { commands.push(command); }, setMiniOnTop: value => { commands.push({ onTop: value }); }, showMain: () => { commands.push('open'); } };
  const script = await fs.readFile(path.join(__dirname, '..', 'src', 'music-mini.js'), 'utf8');
  vm.runInNewContext(script, { window: { ntc: { music2: api } }, document: { getElementById: id => elements[id], createElement: tag => ({ tag, style: {} }) } });
  notify({ title: 'Song', artist: 'Artist', album: 'Album', playing: true, time: 21, duration: 90, volume: .4, muted: false, alwaysOnTop: true, cover: 'data:image/jpeg;base64,abc' });
  assert.equal(elements.title.textContent, 'Song'); assert.equal(elements.artist.textContent, 'Artist · Album');
  assert.equal(elements.art.children[0].src, 'data:image/jpeg;base64,abc'); assert.equal(elements.time.textContent, '0:21');
  assert.equal(elements.play.attributes['aria-label'], 'Pausar');
  assert.equal(elements.onTop.checked, true);
  elements.play.onclick(); elements.next.onclick(); elements.seek.onchange({ target: { value: '500' } }); elements.mute.onclick();
  assert.equal(commands[0], 'toggle'); assert.equal(commands[1], 'next'); assert.equal(commands[2].name, 'seek'); assert.equal(commands[2].value, .5); assert.equal(commands[3], 'mute');
});

test('synthetic large library query is paged and does not materialize the result set', () => fixture(async ({ root, store }) => {
  const source = store.addSources([root], 'folder')[0];
  store.transaction(() => {
    const insert = store.db.prepare('INSERT INTO tracks(path,path_key,base_name,extension,folder,title,artist,available,added_at) VALUES(?,?,?,?,?,?,?,?,?)');
    const link = store.db.prepare('INSERT INTO track_sources(track_id,source_id) VALUES(?,?)');
    for (let i = 0; i < 100000; i++) { const file = path.join(root, `${i}.mp3`); const id = Number(insert.run(file, file.toLowerCase(), String(i), 'MP3', root, `Track ${i}`, `Artist ${i % 100}`, 1, 1).lastInsertRowid); link.run(id, source.id); }
  });
  const start = performance.now(); const page = store.list({ offset: 50000, limit: 80, sort: 'title' });
  const elapsed = performance.now() - start;
  assert.equal(page.total, 100000); assert.equal(page.items.length, 80); assert.ok(elapsed < 5000, `Paged query took ${elapsed.toFixed(0)} ms`);
  assert.ok(model.visibleRange(50000 * 58, 580, page.total).last - model.visibleRange(50000 * 58, 580, page.total).first <= 30);
  const millionStart = model.virtualLayout(0, 580, 1_000_000);
  const millionEnd = model.virtualLayout(8_000_000 - 580, 580, 1_000_000);
  assert.equal(millionStart.height, 8_000_000);
  assert.equal(millionStart.first, 0);
  assert.equal(millionEnd.last, 1_000_000);
  assert.ok(millionEnd.last - millionEnd.first <= 30);
  console.log(`music synthetic scale: 100,000 rows, 80-row page in ${elapsed.toFixed(1)} ms, RSS ${(process.memoryUsage().rss / 1048576).toFixed(1)} MiB`);
}));

test('bundled FFmpeg probes real tags and converts an unsupported container without touching the source', { skip: !require('node:fs').existsSync(path.join(__dirname, '..', 'resources', 'bin', 'ffmpeg.exe')) }, () => fixture(async ({ root }) => {
  const ffmpeg = path.join(__dirname, '..', 'resources', 'bin', 'ffmpeg.exe');
  const ffprobe = path.join(__dirname, '..', 'resources', 'bin', 'ffprobe.exe');
  const source = path.join(root, 'source.wav'); const converted = path.join(root, 'playback.mp3');
  const generated = spawnSync(ffmpeg, ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.3','-metadata','title=Test Tune','-metadata','artist=NTC','-y',source], { windowsHide: true });
  assert.equal(generated.status, 0);
  const before = await fs.readFile(source);
  const metadata = await probeAudio(ffprobe, source); assert.equal(metadata.metadata.title, 'Test Tune'); assert.equal(metadata.metadata.artist, 'NTC'); assert.ok(metadata.duration > 0);
  await convertForPlayback(ffmpeg, source, converted); assert.ok((await fs.stat(converted)).size > 100);
  assert.deepEqual(await fs.readFile(source), before);
}));
