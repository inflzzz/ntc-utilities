'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma']);

function normalizeMusicFolders(folders, pathImpl = path) {
  if (!Array.isArray(folders)) return [];
  const result = [];
  const seen = new Set();
  for (const value of folders) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const folder = pathImpl.resolve(value.trim());
    const key = process.platform === 'win32' ? folder.toLocaleLowerCase('en-US') : folder;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(folder);
  }
  return result;
}

function normalizeMusicFiles(files, pathImpl = path) {
  if (!Array.isArray(files)) return [];
  const result = [];
  const seen = new Set();
  for (const value of files) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const file = pathImpl.resolve(value.trim());
    if (!AUDIO_EXTENSIONS.has(pathImpl.extname(file).toLowerCase())) continue;
    const key = process.platform === 'win32' ? file.toLocaleLowerCase('en-US') : file;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  return result;
}

async function scanMusicFiles(files, options = {}) {
  const fsPromises = options.fsPromises || fs.promises;
  const pathImpl = options.pathImpl || path;
  const tracks = [];
  for (const file of normalizeMusicFiles(files, pathImpl)) {
    try {
      if (!(await fsPromises.stat(file)).isFile()) continue;
    } catch { continue; }
    const extension = pathImpl.extname(file);
    tracks.push({
      id: file,
      path: file,
      name: pathImpl.basename(file, extension),
      extension: extension.slice(1).toUpperCase(),
      folder: pathImpl.basename(pathImpl.dirname(file))
    });
  }
  return tracks;
}

function deriveMusicSearchTerms(metadata = {}, baseName = '', artistOverride = '') {
  const tags = metadata && typeof metadata === 'object' ? metadata : {};
  const base = String(baseName || '').trim();
  const parts = base.split(/\s+[-–—]\s+/).map(part => part.trim()).filter(Boolean);
  const inferredArtist = parts.length > 1 ? parts.at(-1) : '';
  const inferredTitle = parts.length > 1 ? parts.slice(0, -1).join(' - ').replace(/^\d+\s*[-.)]\s*/, '').trim() : '';
  const normalize = value => String(value || '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const taggedTitle = String(tags.title || '').trim();
  const title = taggedTitle || inferredTitle || base;
  const taggedArtist = String(tags.artist || '').trim();
  const requestedArtist = typeof artistOverride === 'string' ? artistOverride.trim().slice(0, 120) : '';
  const mayInferArtist = !taggedTitle || normalize(taggedTitle) === normalize(inferredTitle);
  const artist = requestedArtist || taggedArtist || (mayInferArtist ? inferredArtist : '');
  return { title, artist };
}

function findMusicReleaseCandidates(recordings, requestedTitle, fallbackArtist = '') {
  const normalize = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const targetTitle = normalize(requestedTitle);
  const candidates = new Map();
  const artistFromCredits = credits => Array.isArray(credits) ? credits.map(part => typeof part === 'string' ? part : `${part.name || part.artist?.name || ''}${part.joinphrase || ''}`).join('').trim() : '';

  for (const recording of Array.isArray(recordings) ? recordings : []) {
    const trackTitle = String(recording.title || '').trim();
    if (!trackTitle || normalize(trackTitle) !== targetTitle) continue;
    const artist = artistFromCredits(recording['artist-credit']) || fallbackArtist;
    const firstReleaseDate = String(recording['first-release-date'] || '');
    let addedRelease = false;
    for (const release of Array.isArray(recording.releases) ? recording.releases : []) {
      if (!/^[0-9a-f-]{36}$/i.test(release.id || '')) continue;
      const album = String(release.title || '').trim();
      const year = String(release.date || firstReleaseDate).slice(0, 4);
      const groupId = release['release-group']?.id;
      const key = groupId || `${normalize(album)}:${year || release.id}`;
      const dateMatchesOriginal = Boolean(release.date && firstReleaseDate && release.date.slice(0, 4) === firstReleaseDate.slice(0, 4));
      const preference = !release.date ? 2 : dateMatchesOriginal ? 0 : 1;
      const candidate = { releaseId: release.id, title: album || trackTitle, album, trackTitle, artist, year, preference };
      const previous = candidates.get(key);
      if (!previous || preference < previous.preference) candidates.set(key, candidate);
      addedRelease = true;
    }
    if (!addedRelease) {
      const key = `recording:${recording.id || normalize(trackTitle)}:${normalize(artist)}`;
      if (!candidates.has(key)) candidates.set(key, { releaseId: null, title: trackTitle, album: '', trackTitle, artist, year: firstReleaseDate.slice(0, 4), preference: 3 });
    }
  }
  return [...candidates.values()].sort((a, b) => a.preference - b.preference).slice(0, 5);
}

async function scanMusicFolders(folders, options = {}) {
  const fsPromises = options.fsPromises || fs.promises;
  const pathImpl = options.pathImpl || path;
  const extensions = options.extensions || AUDIO_EXTENSIONS;
  const roots = normalizeMusicFolders(folders, pathImpl);
  const tracks = [];
  const seen = new Set();

  async function visit(directory) {
    let entries;
    try { entries = await fsPromises.readdir(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    for (const entry of entries) {
      const absolutePath = pathImpl.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && extensions.has(pathImpl.extname(entry.name).toLowerCase())) {
        const key = process.platform === 'win32' ? absolutePath.toLocaleLowerCase('en-US') : absolutePath;
        if (seen.has(key)) continue;
        seen.add(key);
        const extension = pathImpl.extname(entry.name);
        tracks.push({
          id: absolutePath,
          path: absolutePath,
          name: pathImpl.basename(entry.name, extension),
          extension: extension.slice(1).toUpperCase(),
          folder: pathImpl.basename(pathImpl.dirname(absolutePath))
        });
      }
    }
  }

  for (const root of roots) {
    try { if ((await fsPromises.stat(root)).isDirectory()) await visit(root); } catch { /* Removed folders are skipped without blocking the library. */ }
  }
  tracks.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) || a.path.localeCompare(b.path, 'pt-BR', { sensitivity: 'base' }));
  return tracks;
}

module.exports = { AUDIO_EXTENSIONS, normalizeMusicFolders, normalizeMusicFiles, scanMusicFolders, scanMusicFiles, deriveMusicSearchTerms, findMusicReleaseCandidates };
