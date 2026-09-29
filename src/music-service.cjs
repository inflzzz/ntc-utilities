'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { MusicStore, EXTENSIONS } = require('./music-store.cjs');

function probeAudio(executable, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { windowsHide: true });
    const chunks = []; let length = 0; let errorText = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Tempo limite ao ler metadados.')); }, 20000);
    child.stdout.on('data', chunk => { length += chunk.length; if (length <= 2_000_000) chunks.push(chunk); else child.kill(); });
    child.stderr.on('data', chunk => { errorText += chunk.toString().slice(0, 200); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || length > 2_000_000) return reject(new Error(errorText || 'Arquivo de áudio inválido.'));
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const audio = data.streams?.find(stream => stream.codec_type === 'audio');
        if (!audio) throw new Error('Arquivo sem faixa de áudio.');
        const tags = { ...(data.format?.tags || {}), ...(audio.tags || {}) };
        const tag = (...names) => { const entry = Object.entries(tags).find(([key]) => names.includes(key.toLowerCase())); return entry ? String(entry[1]) : ''; };
        resolve({
          metadata: { title: tag('title'), artist: tag('artist'), album: tag('album'), album_artist: tag('album_artist', 'albumartist'), year: tag('date', 'year').slice(0, 10), genre: tag('genre'), track_no: tag('track'), disc_no: tag('disc'), composer: tag('composer'), lyrics: tag('lyrics', 'unsyncedlyrics', 'lyrics-eng') },
          duration: Number(data.format?.duration || audio.duration) || 0,
          format: data.format?.format_name || '', codec: audio.codec_name || '', bitrate: Number(audio.bit_rate || data.format?.bit_rate) || 0,
          sample_rate: Number(audio.sample_rate) || 0, bit_depth: Number(audio.bits_per_raw_sample || audio.bits_per_sample) || 0, channels: Number(audio.channels) || 0
        });
      } catch (error) { reject(error); }
    });
  });
}

function convertForPlayback(executable, source, target) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-v', 'error', '-y', '-i', source, '-vn', '-c:a', 'libmp3lame', '-q:a', '3', target], { windowsHide: true });
    let error = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Tempo limite na preparação do áudio.')); }, 10 * 60 * 1000);
    child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-500); });
    child.on('error', reason => { clearTimeout(timer); reject(reason); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(target) : reject(new Error(error || 'Não foi possível preparar este formato.')); });
  });
}

class MusicService {
  constructor({ store, ffprobe, onProgress = () => {}, probe = probeAudio }) {
    this.store = store;
    this.ffprobe = ffprobe;
    this.probe = probe;
    this.onProgress = onProgress;
    this.activeScan = null;
    this.pendingSources = new Set();
  }
  cancelScan() { if (this.activeScan) this.activeScan.cancelled = true; return Boolean(this.activeScan); }
  async scan(sourceIds = null) {
    if (this.activeScan) { for (const id of sourceIds || this.store.sources().map(source => source.id)) this.pendingSources.add(id); return { running: true }; }
    const task = { cancelled: false, scanned: 0, added: 0, metadata: 0, errors: 0, total: 0 };
    this.activeScan = task;
    const sources = this.store.sources().filter(source => !sourceIds || sourceIds.includes(source.id));
    const notify = (phase, source = '') => this.onProgress({ ...task, phase, source, running: phase !== 'done' });
    try {
      for (const source of sources) {
        if (task.cancelled) break;
        let valid = false;
        try { const stat = await fs.promises.stat(source.path); valid = source.kind === 'folder' ? stat.isDirectory() : stat.isFile(); } catch { /* Source unavailable. */ }
        this.store.db.prepare('UPDATE sources SET available=? WHERE id=?').run(valid ? 1 : 0, source.id);
        if (!valid) { const owned = this.store.db.prepare('SELECT t.id,t.path FROM tracks t JOIN track_sources ts ON ts.track_id=t.id WHERE ts.source_id=?').all(source.id); for (const row of owned) if (!fs.existsSync(row.path)) this.store.markMissing(row.id); notify('unavailable', source.path); continue; }
        this.store.db.prepare('UPDATE track_sources SET seen=0 WHERE source_id=?').run(source.id);
        const ignored = new Set(source.ignored || []);
        const changed = [];
        const batch = [];
        const flush = () => {
          if (!batch.length) return;
          this.store.transaction(() => { for (const [file, stat] of batch) { const result = this.store.upsertFile(file, stat, source.id, source.kind === 'file'); if (result.changed) { changed.push(result.id); task.added++; } task.scanned++; } });
          batch.length = 0; notify('indexing', source.path);
        };
        const files = source.kind === 'file' ? (async function* () { yield source.path; })() : walkAudio(source.path, ignored, task);
        for await (const file of files) {
          if (task.cancelled) break;
          try { batch.push([file, await fs.promises.stat(file)]); task.total++; }
          catch { task.errors++; continue; }
          if (batch.length >= 100) { flush(); await new Promise(resolve => setImmediate(resolve)); }
        }
        if (task.cancelled) break;
        flush();
        this.store.db.prepare('UPDATE sources SET scanned_at=? WHERE id=?').run(Date.now(), source.id);
        // Absence is determined only after a complete scan, never after cancellation.
        // A source can be shared; do not mark a track unavailable while another source still owns it.
        const owned = this.store.db.prepare('SELECT t.id,t.path,ts.seen FROM tracks t JOIN track_sources ts ON ts.track_id=t.id WHERE ts.source_id=?').all(source.id);
        let checked = 0;
        for (const row of owned) {
          if (task.cancelled) break;
          if (!row.seen) {
            if (fs.existsSync(row.path)) this.store.db.prepare('DELETE FROM track_sources WHERE track_id=? AND source_id=?').run(row.id, source.id);
            else this.store.markMissing(row.id);
          }
          if (++checked % 200 === 0) await new Promise(resolve => setImmediate(resolve));
        }
        for (const id of changed) {
          if (task.cancelled) break;
          const track = this.store.getTrack(id);
          if (!track) continue;
          try { this.store.updateMetadata(id, await this.probe(this.ffprobe, track.path)); }
          catch { this.store.metadataFailed(id); task.errors++; }
          task.metadata++;
          if (task.metadata % 25 === 0) { notify('metadata', source.path); await new Promise(resolve => setImmediate(resolve)); }
        }
        notify('indexed', source.path);
      }
      return { ...task, running: false };
    } finally {
      this.activeScan = null;
      if (!task.cancelled) {
        try { this.store.importLegacy(this.store.setting('legacy-import', {})); }
        catch { task.errors++; }
      }
      notify('done');
      if (!task.cancelled && this.pendingSources.size) { const pending = [...this.pendingSources]; this.pendingSources.clear(); setImmediate(() => { void this.scan(pending).catch(() => {}); }); }
      else this.pendingSources.clear();
    }
  }
}

async function* walkAudio(root, ignored, task) {
  const pending = [root];
  while (pending.length && !task.cancelled) {
    const directory = pending.pop();
    let handle;
    try { handle = await fs.promises.opendir(directory); } catch { continue; }
    try {
      for await (const entry of handle) {
        if (task.cancelled) break;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          const relative = path.relative(root, absolute);
          if (![...ignored].some(item => relative === item || relative.startsWith(`${item}${path.sep}`))) pending.push(absolute);
        } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield absolute;
      }
    } catch { /* A disconnected drive must not abort the library. */ }
  }
}

async function embeddedCover(ffmpeg, file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=256:256:force_original_aspect_ratio=decrease', '-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2pipe', 'pipe:1'], { windowsHide: true });
    const parts = []; let size = 0;
    child.stdout.on('data', chunk => { size += chunk.length; if (size <= 2_000_000) parts.push(chunk); else child.kill(); });
    child.on('error', reject);
    child.on('close', code => code === 0 && size > 0 && size <= 2_000_000 ? resolve(Buffer.concat(parts)) : reject(new Error('Sem capa embutida.')));
  });
}

function registerMusicService({ app, ipcMain, dialog, shell, mainWindow, ffprobe, ffmpeg, sharp, onlineLookup, legacyFolders, legacyFiles, legacyRemoved }) {
  const store = new MusicStore(path.join(app.getPath('userData'), 'ntc-music-library.sqlite'));
  const service = new MusicService({ store, ffprobe, onProgress: payload => { const window = mainWindow(); if (window && !window.isDestroyed()) window.webContents.send('music2-progress', payload); } });
  if (!store.setting('legacy-sources-imported', false)) {
    store.addSources(legacyFolders(), 'folder'); store.addSources(legacyFiles(), 'file'); store.setSetting('legacy-sources-imported', true);
  }
  if (!store.setting('legacy-removed-imported', false)) {
    store.excludePaths(legacyRemoved()); store.setSetting('legacy-removed-imported', true);
  }
  const check = event => { if (event.sender !== mainWindow()?.webContents) throw new Error('Janela inválida.'); };
  const handle = (name, callback) => ipcMain.handle(`music2-${name}`, (event, ...args) => { check(event); return callback(...args); });
  handle('state', () => ({ sources: store.sources(), count: store.count(), session: store.setting('session', {}), position: store.setting('position', {}), scan: service.activeScan ? { ...service.activeScan, running: true } : null }));
  handle('migrate-legacy', payload => { if (!store.setting('legacy-import')) store.setSetting('legacy-import', { liked: payload?.liked, playlists: payload?.playlists }); store.importLegacy(store.setting('legacy-import')); return true; });
  handle('list', options => store.list(options));
  handle('groups', (kind, query, limit, offset) => store.groups(kind, query, limit, offset));
  handle('folder-children', (sourceId, parent, offset) => store.folderChildren(sourceId, parent, offset));
  handle('sources', () => store.sources());
  handle('add-sources', async kind => {
    if (!['folder', 'file'].includes(kind)) throw new Error('Tipo de importação inválido.');
    const result = await dialog.showOpenDialog({ title: kind === 'folder' ? 'Adicionar pastas de música' : 'Adicionar músicas', properties: [kind === 'folder' ? 'openDirectory' : 'openFile', 'multiSelections'], filters: kind === 'file' ? [{ name: 'Áudio', extensions: [...EXTENSIONS].map(ext => ext.slice(1)) }] : undefined });
    if (result.canceled) return [];
    const sources = store.addSources(result.filePaths, kind);
    void service.scan(sources.map(source => source.id)).catch(() => {});
    return sources;
  });
  handle('drop-paths', async paths => {
    const files = []; const folders = [];
    for (const value of (Array.isArray(paths) ? paths : []).slice(0, 1000)) {
      if (typeof value !== 'string') continue;
      try { const stat = await fs.promises.stat(value); if (stat.isDirectory()) folders.push(value); else if (stat.isFile()) files.push(value); } catch { /* Ignore disappeared paths. */ }
    }
    const sources = [...store.addSources(folders, 'folder'), ...store.addSources(files, 'file')];
    void service.scan(sources.map(source => source.id)).catch(() => {});
    return sources;
  });
  handle('scan', ids => service.scan(Array.isArray(ids) ? ids.map(Number) : null));
  handle('cancel-scan', () => service.cancelScan());
  handle('remove-source', id => { store.removeSource(Number(id)); return store.sources(); });
  handle('ignore-folder', (id, relative) => { store.ignoreSubfolder(Number(id), relative); return store.sources(); });
  handle('relocate-source', async id => {
    const source = store.sources().find(item => item.id === Number(id)); if (!source) throw new Error('Fonte não encontrada.');
    const result = await dialog.showOpenDialog({ properties: [source.kind === 'folder' ? 'openDirectory' : 'openFile'] });
    if (!result.canceled && result.filePaths[0]) {
      const destination = result.filePaths[0];
      const previous = store.relocateSource(source.id, destination);
      const owned = store.db.prepare('SELECT t.id,t.path FROM tracks t JOIN track_sources ts ON ts.track_id=t.id WHERE ts.source_id=?').all(source.id);
      let count = 0;
      for (const track of owned) {
        const relative = previous.kind === 'file' ? '' : path.relative(previous.path, track.path);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
        const moved = previous.kind === 'file' ? destination : path.join(destination, relative);
        try { store.relocateTrack(track.id, moved); } catch { /* Keep unmatched discoveries and paths as missing. */ }
        if (++count % 100 === 0) await new Promise(resolve => setImmediate(resolve));
      }
      void service.scan([source.id]).catch(() => {});
    }
    return store.sources();
  });
  handle('track', id => store.getTrack(Number(id)));
  let playbackTempDir = null;
  const temporaryAudio = new Map();
  async function playbackSource(track, force = false) {
    if (!force && !['WMA', 'AIF', 'AIFF', 'AC3'].includes(track.extension)) return track.path;
    const key = `${track.id}-${track.mtime_ms}`;
    const previous = temporaryAudio.get(key); if (previous && fs.existsSync(previous)) return previous;
    if (!playbackTempDir) playbackTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ntc-music-playback-'));
    const output = path.join(playbackTempDir, `${key}.mp3`);
    try { await convertForPlayback(ffmpeg, track.path, output); }
    catch (error) { await fs.promises.unlink(output).catch(() => {}); throw error; }
    temporaryAudio.set(key, output);
    while (temporaryAudio.size > 3) { const oldest = temporaryAudio.keys().next().value; const oldFile = temporaryAudio.get(oldest); temporaryAudio.delete(oldest); void fs.promises.unlink(oldFile).catch(() => {}); }
    return output;
  }
  handle('play-source', async (id, force) => {
    const track = store.getTrack(Number(id)); if (!track) throw new Error('Faixa não encontrada.');
    if (track.excluded || !store.hasActivePath(track.path)) throw new Error('Esta faixa não está mais na biblioteca. Adicione-a novamente para reproduzir.');
    if (!fs.existsSync(track.path)) { store.markMissing(track.id); throw new Error('Arquivo ausente. Localize-o novamente na biblioteca.'); }
    return pathToFileURL(await playbackSource(track, Boolean(force))).href;
  });
  handle('relocate-track', async id => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Áudio', extensions: [...EXTENSIONS].map(ext => ext.slice(1)) }] });
    if (!result.canceled && result.filePaths[0]) store.relocateTrack(Number(id), result.filePaths[0]);
    return store.getTrack(Number(id));
  });
  handle('remove-track', id => { store.removeTrack(Number(id)); return true; });
  handle('show-track', id => { const track = store.getTrack(Number(id)); if (track) shell.showItemInFolder(track.path); });
  const coverDir = path.join(app.getPath('userData'), 'ntc-music-cover-cache');
  let coverWrites = 0;
  const invalidateCover = track => fs.promises.unlink(path.join(coverDir, `${track.id}-${track.mtime_ms}.jpg`)).catch(() => {});
  handle('cover', async id => {
    const track = store.getTrack(Number(id)); if (!track || !track.available) return null;
    const cache = path.join(coverDir, `${track.id}-${track.mtime_ms}.jpg`);
    try { return `data:image/jpeg;base64,${(await fs.promises.readFile(cache)).toString('base64')}`; } catch { /* Cache miss. */ }
    let image = null;
    try { image = await embeddedCover(ffmpeg, track.path); } catch { /* Try folder image. */ }
    if (!image) {
      for (const candidate of [...['cover.jpg', 'folder.jpg', 'front.jpg', 'cover.png', 'folder.png'].map(name => path.join(track.folder, name)), track.custom_cover]) {
        if (!candidate) continue;
        try { image = await fs.promises.readFile(candidate); break; } catch { /* Next candidate. */ }
      }
    }
    if (!image) return null;
    try {
      const thumb = await sharp(image).rotate().resize(256, 256, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 76 }).toBuffer();
      await fs.promises.mkdir(coverDir, { recursive: true }); await fs.promises.writeFile(cache, thumb);
      if (++coverWrites % 100 === 0) {
        void fs.promises.readdir(coverDir).then(async files => {
          if (files.length <= 2500) return;
          const entries = await Promise.all(files.map(async name => { try { const stat = await fs.promises.stat(path.join(coverDir, name)); return { name, time: stat.mtimeMs }; } catch { return null; } }));
          entries.filter(Boolean).sort((a, b) => a.time - b.time).slice(0, Math.max(0, files.length - 2000)).forEach(entry => { void fs.promises.unlink(path.join(coverDir, entry.name)).catch(() => {}); });
        }).catch(() => {});
      }
      return `data:image/jpeg;base64,${thumb.toString('base64')}`;
    } catch { return null; }
  });
  handle('cover-choose', async id => {
    const track = store.getTrack(Number(id)); if (!track) throw new Error('Faixa não encontrada.');
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg','jpeg','png','webp'] }] });
    if (!result.canceled && result.filePaths[0]) { await sharp(result.filePaths[0]).metadata(); store.setCover(track.id, result.filePaths[0]); await invalidateCover(track); }
    return true;
  });
  handle('cover-choose-batch', async ids => {
    const tracks = [...new Set((Array.isArray(ids) ? ids : []).slice(0, 10000).map(Number))].map(id => store.getTrack(id)).filter(Boolean);
    if (!tracks.length) return false;
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg','jpeg','png','webp'] }] });
    if (result.canceled || !result.filePaths[0]) return false;
    const file = result.filePaths[0]; await sharp(file).metadata();
    store.transaction(() => { for (const track of tracks) store.setCover(track.id, file); });
    for (const track of tracks) await invalidateCover(track);
    return true;
  });
  handle('cover-clear', async id => { const track = store.getTrack(Number(id)); if (track) { store.setCover(track.id, ''); await invalidateCover(track); } return true; });
  handle('cover-fit', (id, fit) => { const track = store.getTrack(Number(id)); if (!track) throw new Error('Faixa não encontrada.'); store.setCoverFit(track.id, fit); return store.getTrack(track.id).cover_fit; });
  handle('online-search', async (id, artist) => {
    const track = store.getTrack(Number(id)); if (!track || !track.available) throw new Error('Faixa indisponível.');
    return onlineLookup(track.path, String(artist || '').slice(0, 120));
  });
  handle('online-apply', async (id, candidate) => {
    const track = store.applyOnline(Number(id), candidate || {});
    const dataUrl = candidate?.coverDataUrl;
    if (typeof dataUrl === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(dataUrl) && dataUrl.length < 3_000_000) {
      const raw = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      const image = await sharp(raw).resize(512, 512, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
      await fs.promises.mkdir(coverDir, { recursive: true });
      const filename = path.join(coverDir, `online-${track.id}.jpg`);
      await fs.promises.writeFile(filename, image); store.setCover(track.id, filename); await invalidateCover(track);
    }
    return store.getTrack(track.id);
  });
  handle('lyrics', async id => {
    const track = store.getTrack(Number(id)); if (!track) return { content: '' };
    if (track.lyrics) return { content: track.lyrics, source: 'ntc' };
    const sidecar = path.join(track.folder, `${track.base_name}.lrc`);
    try { const content = await fs.promises.readFile(sidecar, 'utf8'); return { content: content.slice(0, 200000), source: 'lrc' }; } catch { return { content: '' }; }
  });
  handle('lyrics-save', (id, content) => { store.setLyrics(Number(id), content); return true; });
  handle('like', id => store.toggleLike(Number(id)));
  handle('rate', (id, rating) => { store.setRating(Number(id), rating); return store.getTrack(Number(id))?.rating; });
  handle('metadata-override', (ids, patch) => { store.overrideMetadata((Array.isArray(ids) ? ids : []).map(Number), patch); return true; });
  handle('play-record', id => { store.recordPlay(Number(id)); return true; });
  handle('history', limit => store.history(limit));
  handle('session', value => { if (!value || typeof value !== 'object') throw new Error('Sessão inválida.'); store.setSetting('session', value); return true; });
  handle('position', value => { if (!value || typeof value !== 'object') throw new Error('Posição inválida.'); store.setSetting('position', { id: Number(value.id) || 0, seconds: Math.max(0, Number(value.seconds) || 0) }); return true; });
  handle('playlists', () => store.playlists());
  handle('playlist-create', name => Number(store.createPlaylist(name)));
  handle('playlist-rename', (id, name) => { store.renamePlaylist(Number(id), name); return true; });
  handle('playlist-update', (id, patch) => { store.updatePlaylist(Number(id), patch); return true; });
  handle('playlist-delete', id => { store.deletePlaylist(Number(id)); return true; });
  handle('playlist-items', id => store.playlistItems(Number(id)));
  handle('playlist-add', (id, trackIds) => { store.addPlaylistItems(Number(id), (Array.isArray(trackIds) ? trackIds : []).map(Number)); return true; });
  handle('playlist-remove', itemId => { store.removePlaylistItem(Number(itemId)); return true; });
  handle('playlist-reorder', (itemId, beforeItemId) => { store.reorderPlaylistItem(Number(itemId), Number(beforeItemId)); return true; });
  service.cleanup = () => {
    service.cancelScan(); store.close();
    if (playbackTempDir && path.basename(playbackTempDir).startsWith('ntc-music-playback-')) {
      try { for (const name of fs.readdirSync(playbackTempDir)) fs.unlinkSync(path.join(playbackTempDir, name)); fs.rmdirSync(playbackTempDir); }
      catch { /* A playing media handle can keep a temporary file locked on Windows. */ }
    }
  };
  return service;
}

module.exports = { MusicService, probeAudio, convertForPlayback, walkAudio, registerMusicService };
