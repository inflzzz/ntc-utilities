'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma', '.aif', '.aiff', '.ac3']);
const SORT_COLUMNS = Object.freeze({ title: 'title', artist: 'artist', album: 'album', year: 'year', duration: 'duration', added: 'added_at', played: 'last_played', plays: 'play_count' });
const normalizePath = value => path.resolve(String(value || ''));
const pathKey = value => process.platform === 'win32' ? normalizePath(value).toLocaleLowerCase('en-US') : normalizePath(value);
const text = value => String(value ?? '').trim().slice(0, 1000);
const searchable = row => [row.title, row.artist, row.album, row.genre, row.year, row.base_name, row.folder, row.path].filter(Boolean).join(' ');
const searchQuery = value => (String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8).map(token => `"${token.replaceAll('"', '')}"*`).join(' AND ');

class MusicStore {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('folder','file')), available INTEGER NOT NULL DEFAULT 1, ignored_json TEXT NOT NULL DEFAULT '[]', scanned_at INTEGER);
      CREATE TABLE IF NOT EXISTS tracks (id INTEGER PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, base_name TEXT NOT NULL, extension TEXT NOT NULL, folder TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, mtime_ms INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1, metadata_status INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '', album TEXT NOT NULL DEFAULT '', album_artist TEXT NOT NULL DEFAULT '', year TEXT NOT NULL DEFAULT '', genre TEXT NOT NULL DEFAULT '', track_no TEXT NOT NULL DEFAULT '', disc_no TEXT NOT NULL DEFAULT '', composer TEXT NOT NULL DEFAULT '', duration REAL NOT NULL DEFAULT 0, format TEXT NOT NULL DEFAULT '', codec TEXT NOT NULL DEFAULT '', bitrate INTEGER NOT NULL DEFAULT 0, sample_rate INTEGER NOT NULL DEFAULT 0, bit_depth INTEGER NOT NULL DEFAULT 0, channels INTEGER NOT NULL DEFAULT 0, custom_cover TEXT NOT NULL DEFAULT '', lyrics TEXT NOT NULL DEFAULT '', metadata_override TEXT NOT NULL DEFAULT '{}', liked INTEGER NOT NULL DEFAULT 0, rating INTEGER NOT NULL DEFAULT 0, play_count INTEGER NOT NULL DEFAULT 0, last_played INTEGER, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS track_sources (track_id INTEGER NOT NULL REFERENCES tracks(id), source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE, seen INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(track_id,source_id));
      CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS playlist_items (id INTEGER PRIMARY KEY, playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, track_id INTEGER NOT NULL REFERENCES tracks(id), position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, track_id INTEGER NOT NULL REFERENCES tracks(id), played_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS track_search USING fts5(content, tokenize='unicode61 remove_diacritics 2');
      CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album COLLATE NOCASE, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_year ON tracks(year, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre COLLATE NOCASE, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_folder ON tracks(folder COLLATE NOCASE, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_duration ON tracks(duration, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_added ON tracks(added_at DESC, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_played ON tracks(last_played DESC, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_plays ON tracks(play_count DESC, id);
      CREATE INDEX IF NOT EXISTS idx_tracks_liked ON tracks(liked, id);
      CREATE INDEX IF NOT EXISTS idx_source_tracks ON track_sources(source_id, seen);
      CREATE INDEX IF NOT EXISTS idx_playlist_items ON playlist_items(playlist_id, position);
      CREATE INDEX IF NOT EXISTS idx_history ON history(played_at DESC);`);
    const trackColumns = this.db.prepare('PRAGMA table_info(tracks)').all();
    if (!trackColumns.some(column => column.name === 'metadata_override')) this.db.exec("ALTER TABLE tracks ADD COLUMN metadata_override TEXT NOT NULL DEFAULT '{}'");
    if (!trackColumns.some(column => column.name === 'excluded')) this.db.exec('ALTER TABLE tracks ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0');
    if (!trackColumns.some(column => column.name === 'cover_fit')) this.db.exec("ALTER TABLE tracks ADD COLUMN cover_fit TEXT NOT NULL DEFAULT 'contain'");
  }

  close() { this.db.close(); }
  transaction(work) { this.db.exec('BEGIN IMMEDIATE'); try { const result = work(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  setting(key, fallback = null) { const value = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value; if (value === undefined) return fallback; try { return JSON.parse(value); } catch { return fallback; } }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }

  addSources(paths, kind) {
    if (!['folder', 'file'].includes(kind)) throw new Error('Tipo de fonte inválido.');
    const result = [];
    this.transaction(() => {
      for (const raw of [...new Set((Array.isArray(paths) ? paths : []).filter(value => typeof value === 'string' && value.trim()).map(normalizePath))]) {
        if (kind === 'file' && !EXTENSIONS.has(path.extname(raw).toLowerCase())) continue;
        let stat = null;
        try { stat = fs.statSync(raw); } catch { /* Offline sources remain registered. */ }
        if (stat && (kind === 'folder' ? !stat.isDirectory() : !stat.isFile())) continue;
        this.db.prepare('INSERT INTO sources(path,path_key,kind,available) VALUES(?,?,?,?) ON CONFLICT(path_key) DO UPDATE SET available=excluded.available').run(raw, pathKey(raw), kind, stat ? 1 : 0);
        result.push(this.db.prepare('SELECT * FROM sources WHERE path_key=?').get(pathKey(raw)));
      }
    });
    return result;
  }
  sources() { return this.db.prepare('SELECT * FROM sources ORDER BY kind DESC, path COLLATE NOCASE').all().map(row => ({ ...row, ignored: JSON.parse(row.ignored_json) })); }
  removeSource(id) { this.transaction(() => { this.db.prepare('DELETE FROM sources WHERE id=?').run(id); this.db.prepare('UPDATE tracks SET available=0 WHERE id NOT IN (SELECT track_id FROM track_sources)').run(); }); }
  ignoreSubfolder(id, relative) {
    const source = this.db.prepare('SELECT * FROM sources WHERE id=?').get(id);
    if (!source || source.kind !== 'folder') throw new Error('Pasta não encontrada.');
    const candidate = path.normalize(String(relative || ''));
    if (!candidate || candidate === '.' || path.isAbsolute(candidate) || candidate === '..' || candidate.startsWith(`..${path.sep}`)) throw new Error('Subpasta inválida.');
    const ignored = new Set(JSON.parse(source.ignored_json)); ignored.add(candidate);
    this.db.prepare('UPDATE sources SET ignored_json=? WHERE id=?').run(JSON.stringify([...ignored]), id);
  }
  relocateSource(id, newPath) {
    const source = this.db.prepare('SELECT * FROM sources WHERE id=?').get(id);
    if (!source) throw new Error('Fonte não encontrada.');
    const destination = normalizePath(newPath);
    const stat = fs.statSync(destination);
    if (source.kind === 'folder' ? !stat.isDirectory() : !stat.isFile()) throw new Error('O novo caminho não corresponde à fonte.');
    this.db.prepare('UPDATE sources SET path=?,path_key=?,available=1 WHERE id=?').run(destination, pathKey(destination), id);
    return source;
  }

  upsertFile(file, stat, sourceId, reinclude = false) {
    const resolved = normalizePath(file); const key = pathKey(resolved);
    const previous = this.db.prepare('SELECT id,size,mtime_ms,metadata_status,excluded FROM tracks WHERE path_key=?').get(key);
    if (previous?.excluded && !reinclude) return { id: previous.id, changed: false, excluded: true };
    const changed = !previous || previous.size !== stat.size || previous.mtime_ms !== Math.round(stat.mtimeMs) || previous.metadata_status === 0;
    const extension = path.extname(resolved);
    this.db.prepare(`INSERT INTO tracks(path,path_key,base_name,extension,folder,size,mtime_ms,available,added_at,title) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(path_key) DO UPDATE SET path=excluded.path,size=excluded.size,mtime_ms=excluded.mtime_ms,available=1,excluded=0,metadata_status=CASE WHEN tracks.size!=excluded.size OR tracks.mtime_ms!=excluded.mtime_ms THEN 0 ELSE tracks.metadata_status END`).run(resolved, key, path.basename(resolved, extension), extension.slice(1).toUpperCase(), path.dirname(resolved), stat.size, Math.round(stat.mtimeMs), 1, Date.now(), path.basename(resolved, extension));
    const id = this.db.prepare('SELECT id FROM tracks WHERE path_key=?').get(key).id;
    this.db.prepare('INSERT INTO track_sources(track_id,source_id,seen) VALUES(?,?,1) ON CONFLICT(track_id,source_id) DO UPDATE SET seen=1').run(id, sourceId);
    if (changed) {
      const track = this.db.prepare('SELECT * FROM tracks WHERE id=?').get(id);
      this.db.prepare('INSERT OR REPLACE INTO track_search(rowid,content) VALUES(?,?)').run(id, searchable(track));
    }
    return { id, changed };
  }
  updateMetadata(id, media) {
    const tags = media?.metadata || {};
    const values = ['title', 'artist', 'album', 'album_artist', 'year', 'genre', 'track_no', 'disc_no', 'composer'].map(key => text(tags[key]).slice(0, 250));
    if (!values[0]) values[0] = this.getTrack(id)?.base_name || '';
    let overrides = {}; try { overrides = JSON.parse(this.getTrack(id)?.metadata_override || '{}'); } catch { /* Ignore invalid overrides. */ }
    ['title', 'artist', 'album', 'album_artist', 'year', 'genre', 'track_no', 'disc_no', 'composer'].forEach((key, index) => { if (Object.hasOwn(overrides, key)) values[index] = text(overrides[key]).slice(0, 250); });
    this.db.prepare(`UPDATE tracks SET title=?,artist=?,album=?,album_artist=?,year=?,genre=?,track_no=?,disc_no=?,composer=?,duration=?,format=?,codec=?,bitrate=?,sample_rate=?,bit_depth=?,channels=?,lyrics=CASE WHEN lyrics='' THEN ? ELSE lyrics END,metadata_status=1 WHERE id=?`).run(...values, Math.max(0, Number(media.duration) || 0), text(media.format).slice(0, 80), text(media.codec).slice(0, 80), Math.max(0, Number(media.bitrate) || 0), Math.max(0, Number(media.sample_rate) || 0), Math.max(0, Number(media.bit_depth) || 0), Math.max(0, Number(media.channels) || 0), text(tags.lyrics).slice(0, 200000), id);
    const track = this.db.prepare('SELECT * FROM tracks WHERE id=?').get(id);
    this.db.prepare('INSERT OR REPLACE INTO track_search(rowid,content) VALUES(?,?)').run(id, searchable(track));
  }
  metadataFailed(id) { this.db.prepare('UPDATE tracks SET metadata_status=2 WHERE id=?').run(id); }
  getTrack(id) { return this.db.prepare('SELECT * FROM tracks WHERE id=?').get(id) || null; }
  byPath(file) { return this.db.prepare('SELECT * FROM tracks WHERE path_key=?').get(pathKey(file)) || null; }
  containsPath(file) { return Boolean(this.byPath(file)); }
  hasActivePath(file) { return Boolean(this.db.prepare('SELECT 1 FROM tracks t JOIN track_sources ts ON ts.track_id=t.id WHERE t.path_key=? AND t.excluded=0 LIMIT 1').get(pathKey(file))); }
  markMissing(id) { this.db.prepare('UPDATE tracks SET available=0 WHERE id=?').run(id); }
  excludePaths(paths) {
    this.transaction(() => {
      for (const raw of (Array.isArray(paths) ? paths : []).slice(0, 100000)) {
        if (typeof raw !== 'string' || !EXTENSIONS.has(path.extname(raw).toLowerCase())) continue;
        const file = normalizePath(raw), extension = path.extname(file);
        this.db.prepare('INSERT OR IGNORE INTO tracks(path,path_key,base_name,extension,folder,title,available,excluded,added_at) VALUES(?,?,?,?,?,?,0,1,?)').run(file, pathKey(file), path.basename(file, extension), extension.slice(1).toUpperCase(), path.dirname(file), path.basename(file, extension), Date.now());
        const track = this.byPath(file); if (track && !this.db.prepare('SELECT 1 FROM track_sources WHERE track_id=?').get(track.id)) this.db.prepare('UPDATE tracks SET available=0,excluded=1 WHERE id=?').run(track.id);
      }
    });
  }
  removeTrack(id) { this.transaction(() => { const track = this.getTrack(id); if (!track) return; this.db.prepare('DELETE FROM sources WHERE kind=\'file\' AND path_key=?').run(track.path_key); this.db.prepare('DELETE FROM track_sources WHERE track_id=?').run(id); this.db.prepare('UPDATE tracks SET available=0,excluded=1 WHERE id=?').run(id); }); }
  relocateTrack(id, file) {
    const stat = fs.statSync(file); if (!stat.isFile() || !EXTENSIONS.has(path.extname(file).toLowerCase())) throw new Error('Escolha um arquivo de áudio válido.');
    const existing = this.byPath(file); if (existing && existing.id !== id) throw new Error('Este arquivo já está na biblioteca.');
    this.db.prepare('UPDATE tracks SET path=?,path_key=?,folder=?,base_name=?,extension=?,size=?,mtime_ms=?,available=1,metadata_status=0 WHERE id=?').run(normalizePath(file), pathKey(file), path.dirname(file), path.basename(file, path.extname(file)), path.extname(file).slice(1).toUpperCase(), stat.size, Math.round(stat.mtimeMs), id);
    const owners = this.db.prepare('SELECT s.* FROM sources s JOIN track_sources ts ON ts.source_id=s.id WHERE ts.track_id=?').all(id);
    const covered = owners.some(source => {
      if (source.kind === 'file') return source.path_key === pathKey(file);
      const relative = path.relative(source.path, file);
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (!covered) {
      const direct = this.addSources([file], 'file')[0];
      if (direct) this.db.prepare('INSERT OR IGNORE INTO track_sources(track_id,source_id) VALUES(?,?)').run(id, direct.id);
    }
    for (const source of owners) if (source.kind === 'file' && source.path_key !== pathKey(file)) this.db.prepare('DELETE FROM sources WHERE id=?').run(source.id);
    const track = this.getTrack(id);
    this.db.prepare('INSERT OR REPLACE INTO track_search(rowid,content) VALUES(?,?)').run(id, searchable(track));
  }

  list({ query = '', view = 'songs', sort = 'title', descending = false, offset = 0, limit = 80, group = '', sourceId = null } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 80));
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const where = ['EXISTS(SELECT 1 FROM track_sources ts WHERE ts.track_id=t.id)']; const args = [];
    if (view === 'liked') where.push('t.liked=1');
    if (view === 'recent') where.push('t.last_played IS NOT NULL');
    if (view === 'unplayed') where.push('t.play_count=0');
    if (view === 'missing') where.push('t.available=0');
    if (view === 'folder' && sourceId) { where.push('EXISTS(SELECT 1 FROM track_sources ts WHERE ts.track_id=t.id AND ts.source_id=?)'); args.push(Number(sourceId)); if (group) { where.push('t.folder=?'); args.push(group); } }
    if (view === 'album' && group) { where.push('t.album=?'); args.push(group); }
    if (view === 'artist' && group) { where.push('t.artist=?'); args.push(group); }
    if (view === 'genre' && group) { where.push('t.genre=?'); args.push(group); }
    const fts = searchQuery(query); if (fts) { where.push('t.id IN (SELECT rowid FROM track_search WHERE track_search MATCH ?)'); args.push(fts); }
    const condition = where.join(' AND ');
    const order = SORT_COLUMNS[sort] || 'title';
    const direction = descending || ['added', 'played', 'plays'].includes(sort) ? 'DESC' : 'ASC';
    const total = this.db.prepare(`SELECT COUNT(*) count FROM tracks t WHERE ${condition}`).get(...args).count;
    const items = this.db.prepare(`SELECT t.* FROM tracks t WHERE ${condition} ORDER BY t.${order} COLLATE NOCASE ${direction},t.id LIMIT ? OFFSET ?`).all(...args, safeLimit, safeOffset);
    return { total, items, offset: safeOffset };
  }
  groups(kind, query = '', limit = 100, offset = 0) {
    const column = { albums: 'album', artists: 'artist', genres: 'genre' }[kind]; if (!column) return [];
    const term = `%${String(query).replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return this.db.prepare(`SELECT ${column} name,COUNT(*) count,SUM(duration) duration,MIN(year) year,MIN(id) sample_id,MIN(CASE WHEN album_artist!='' THEN album_artist ELSE artist END) artist FROM tracks WHERE ${column}!='' AND ${column} LIKE ? ESCAPE '\\' AND EXISTS(SELECT 1 FROM track_sources ts WHERE ts.track_id=tracks.id) GROUP BY ${column} ORDER BY ${column} COLLATE NOCASE LIMIT ? OFFSET ?`).all(term, Math.min(200, limit), offset);
  }
  folderChildren(sourceId, parent, offset = 0) {
    const prefix = `${normalizePath(parent)}${path.sep}`;
    const escaped = prefix.replace(/[\\%_]/g, character => `\\${character}`);
    const separator = path.sep;
    return this.db.prepare(`SELECT child,COUNT(*) count FROM (
      SELECT CASE WHEN instr(rest,?)>0 THEN substr(rest,1,instr(rest,?)-1) ELSE rest END child
      FROM (SELECT substr(t.folder,length(?)+1) rest FROM tracks t JOIN track_sources ts ON ts.track_id=t.id WHERE ts.source_id=? AND t.folder LIKE ? ESCAPE '\\')
    ) WHERE child!='' GROUP BY child ORDER BY child COLLATE NOCASE LIMIT 200 OFFSET ?`).all(separator, separator, prefix, Number(sourceId), `${escaped}%`, Math.max(0, Number(offset) || 0));
  }
  count() { return this.db.prepare('SELECT COUNT(*) count FROM tracks t WHERE EXISTS(SELECT 1 FROM track_sources ts WHERE ts.track_id=t.id)').get().count; }
  toggleLike(id) { this.db.prepare('UPDATE tracks SET liked=1-liked WHERE id=?').run(id); return this.getTrack(id)?.liked || 0; }
  setRating(id, rating) { this.db.prepare('UPDATE tracks SET rating=? WHERE id=?').run(Math.max(0, Math.min(5, Math.floor(Number(rating) || 0))), id); }
  setLyrics(id, content) { this.db.prepare('UPDATE tracks SET lyrics=? WHERE id=?').run(String(content || '').slice(0, 200000), id); }
  setCover(id, file) { this.db.prepare('UPDATE tracks SET custom_cover=? WHERE id=?').run(String(file || ''), id); }
  setCoverFit(id, fit) { this.db.prepare('UPDATE tracks SET cover_fit=? WHERE id=?').run(fit === 'cover' ? 'cover' : 'contain', Number(id)); }
  overrideMetadata(ids, patch) {
    const fields = ['title', 'artist', 'album', 'album_artist', 'year', 'genre', 'track_no', 'disc_no', 'composer'];
    this.transaction(() => {
      for (const id of (Array.isArray(ids) ? ids : []).slice(0, 10000)) {
        const track = this.getTrack(Number(id)); if (!track) continue;
        let overrides = {}; try { overrides = JSON.parse(track.metadata_override); } catch { /* Start fresh. */ }
        for (const key of fields) if (typeof patch?.[key] === 'string') overrides[key] = patch[key].trim().slice(0, 250);
        this.db.prepare(`UPDATE tracks SET metadata_override=?,${fields.map(key => `${key}=?`).join(',')} WHERE id=?`).run(JSON.stringify(overrides), ...fields.map(key => Object.hasOwn(overrides, key) ? overrides[key] : track[key]), track.id);
        const updated = this.getTrack(track.id);
        this.db.prepare('INSERT OR REPLACE INTO track_search(rowid,content) VALUES(?,?)').run(track.id, searchable(updated));
      }
    });
  }
  applyOnline(id, data) {
    const current = this.getTrack(id); if (!current) throw new Error('Faixa não encontrada.');
    this.overrideMetadata([id], { title: text(data.trackTitle || current.title), artist: text(data.artist || current.artist), album: text(data.album || current.album), year: text(data.year || current.year) });
    return this.getTrack(id);
  }
  recordPlay(id, when = Date.now()) { this.transaction(() => { this.db.prepare('UPDATE tracks SET play_count=play_count+1,last_played=? WHERE id=?').run(when, id); this.db.prepare('INSERT INTO history(track_id,played_at) VALUES(?,?)').run(id, when); this.db.prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 50000)').run(); }); }
  history(limit = 100) { return this.db.prepare('SELECT h.played_at,t.* FROM history h JOIN tracks t ON t.id=h.track_id ORDER BY h.id DESC LIMIT ?').all(Math.max(1, Math.min(500, Number(limit) || 100))); }
  createPlaylist(name) { const label = text(name).slice(0, 80); if (!label) throw new Error('Informe um nome para a playlist.'); return this.db.prepare('INSERT INTO playlists(name,created_at) VALUES(?,?)').run(label, Date.now()).lastInsertRowid; }
  playlists() { return this.db.prepare('SELECT p.*,COUNT(i.id) count FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id=p.id GROUP BY p.id ORDER BY p.name COLLATE NOCASE').all(); }
  renamePlaylist(id, name) { const label = text(name).slice(0, 80); if (!label) throw new Error('Informe um nome.'); this.db.prepare('UPDATE playlists SET name=? WHERE id=?').run(label, id); }
  updatePlaylist(id, patch) {
    const playlist = this.db.prepare('SELECT * FROM playlists WHERE id=?').get(id); if (!playlist) throw new Error('Playlist não encontrada.');
    const description = typeof patch?.description === 'string' ? patch.description.trim().slice(0, 300) : playlist.description;
    const cover = patch?.cover === null ? '' : typeof patch?.cover === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(patch.cover) && patch.cover.length <= 600000 ? patch.cover : playlist.cover;
    this.db.prepare('UPDATE playlists SET description=?,cover=? WHERE id=?').run(description, cover, id);
  }
  deletePlaylist(id) { this.db.prepare('DELETE FROM playlists WHERE id=?').run(id); }
  playlistItems(id) { return this.db.prepare('SELECT i.id item_id,i.position,t.* FROM playlist_items i JOIN tracks t ON t.id=i.track_id WHERE i.playlist_id=? ORDER BY i.position,i.id').all(id); }
  addPlaylistItems(playlistId, trackIds) { this.transaction(() => { let position = this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 next FROM playlist_items WHERE playlist_id=?').get(playlistId).next; for (const id of trackIds.slice(0, 10000)) { if (this.getTrack(id)) this.db.prepare('INSERT INTO playlist_items(playlist_id,track_id,position) VALUES(?,?,?)').run(playlistId, id, position++); } }); }
  removePlaylistItem(itemId) { this.db.prepare('DELETE FROM playlist_items WHERE id=?').run(itemId); }
  reorderPlaylistItem(itemId, beforeItemId) { this.transaction(() => { const item = this.db.prepare('SELECT playlist_id FROM playlist_items WHERE id=?').get(itemId); if (!item) return; const ids = this.db.prepare('SELECT id FROM playlist_items WHERE playlist_id=? ORDER BY position,id').all(item.playlist_id).map(row => row.id).filter(id => id !== itemId); const target = ids.indexOf(beforeItemId); ids.splice(target < 0 ? ids.length : target, 0, itemId); const update = this.db.prepare('UPDATE playlist_items SET position=? WHERE id=?'); ids.forEach((id, position) => update.run(position, id)); }); }
  importLegacy(payload) {
    if (!payload || typeof payload !== 'object') return;
    const mapping = this.setting('legacy-playlist-map', {});
    const ensureMissing = oldPath => {
      if (typeof oldPath !== 'string' || !EXTENSIONS.has(path.extname(oldPath).toLowerCase())) return null;
      let track = this.byPath(oldPath); if (track || fs.existsSync(oldPath)) return track;
      const resolved = normalizePath(oldPath); const key = pathKey(resolved); const extension = path.extname(resolved);
      this.db.prepare('INSERT OR IGNORE INTO sources(path,path_key,kind,available) VALUES(?,?,?,0)').run(resolved, key, 'file');
      const source = this.db.prepare('SELECT id FROM sources WHERE path_key=?').get(key);
      this.db.prepare('INSERT OR IGNORE INTO tracks(path,path_key,base_name,extension,folder,title,available,added_at) VALUES(?,?,?,?,?,?,0,?)').run(resolved, key, path.basename(resolved, extension), extension.slice(1).toUpperCase(), path.dirname(resolved), path.basename(resolved, extension), Date.now());
      track = this.byPath(resolved);
      this.db.prepare('INSERT OR IGNORE INTO track_sources(track_id,source_id) VALUES(?,?)').run(track.id, source.id);
      this.db.prepare('INSERT OR REPLACE INTO track_search(rowid,content) VALUES(?,?)').run(track.id, searchable(track));
      return track;
    };
    this.transaction(() => {
      for (const oldPath of (Array.isArray(payload.liked) ? payload.liked : []).slice(0, 100000)) {
        if (typeof oldPath !== 'string') continue;
        const track = this.byPath(oldPath) || ensureMissing(oldPath); if (track) this.db.prepare('UPDATE tracks SET liked=1 WHERE id=?').run(track.id);
      }
      for (const old of (Array.isArray(payload.playlists) ? payload.playlists : []).slice(0, 2000)) {
        if (!old || typeof old.id !== 'string' || !old.name) continue;
        let id = mapping[old.id];
        if (!id) { id = Number(this.createPlaylist(old.name)); mapping[old.id] = id; this.db.prepare('UPDATE playlists SET description=?,cover=? WHERE id=?').run(text(old.description).slice(0, 300), typeof old.coverDataUrl === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(old.coverDataUrl) && old.coverDataUrl.length <= 600000 ? old.coverDataUrl : '', id); }
        for (const oldPath of (Array.isArray(old.trackIds) ? old.trackIds : []).slice(0, 100000)) {
          if (typeof oldPath !== 'string') continue;
          const track = this.byPath(oldPath) || ensureMissing(oldPath); if (!track) continue;
          if (this.db.prepare('SELECT 1 FROM playlist_items WHERE playlist_id=? AND track_id=?').get(id, track.id)) continue;
          const position = this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 value FROM playlist_items WHERE playlist_id=?').get(id).value;
          this.db.prepare('INSERT INTO playlist_items(playlist_id,track_id,position) VALUES(?,?,?)').run(id, track.id, position);
        }
      }
      this.setSetting('legacy-playlist-map', mapping);
    });
    if (!this.setting('session') && payload.playback && typeof payload.playback.trackId === 'string') {
      const current = this.byPath(payload.playback.trackId);
      if (current && !current.excluded) {
        const queue = (Array.isArray(payload.playback.queueIds) ? payload.playback.queueIds : []).slice(0, 100000)
          .map(oldPath => typeof oldPath === 'string' ? this.byPath(oldPath) : null).filter(track => track && !track.excluded)
          .map((track, index) => ({ id: track.id, key: `legacy-${index}` }));
        const oldVolume = Number(payload.volume ?? 80);
        const volume = Number.isFinite(oldVolume) ? Math.max(0, Math.min(1, oldVolume / 100)) : .8;
        const crossfade = Math.max(0, Math.min(12, Number(payload.crossfade) || 0));
        this.transaction(() => {
          this.setSetting('session', { currentId: current.id, queue, queueIndex: queue.findIndex(item => item.id === current.id), volume, crossfade, view: 'songs', filter: 'songs', sort: 'title' });
          this.setSetting('position', { id: current.id, seconds: Math.max(0, Number(payload.playback.time) || 0) });
        });
      }
    }
  }
}

module.exports = { MusicStore, EXTENSIONS, pathKey, searchQuery };
