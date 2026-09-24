'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeMusicFolders, normalizeMusicFiles, scanMusicFolders, scanMusicFiles, deriveMusicSearchTerms, findMusicReleaseCandidates } = require('../src/music-library.cjs');
const { reorderMusicTracks, reorderVisibleMusicTrackIds } = require('../src/music-queue.js');
const { normalizeMusicPlaylists, toggleMusicPlaylistTrack, reorderMusicPlaylistTracks } = require('../src/music-playlists.js');

test('music folders are normalized and deduplicated', () => {
  const folders = normalizeMusicFolders(['music', '', 'music', 'other']);
  assert.deepEqual(folders, [path.resolve('music'), path.resolve('other')]);
});

test('individual music files are filtered, deduplicated, and scanned without requiring a folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-music-files-'));
  try {
    const song = path.join(root, 'single track.mp3');
    const image = path.join(root, 'cover.jpg');
    await fs.writeFile(song, 'audio');
    await fs.writeFile(image, 'image');
    assert.deepEqual(normalizeMusicFiles([song, song, image]), [song]);
    const tracks = await scanMusicFiles([song, path.join(root, 'missing.wav'), image]);
    assert.deepEqual(tracks.map(track => [track.id, track.name, track.extension]), [[song, 'single track', 'MP3']]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('music lookup infers title and artist from common file names and accepts an artist override', () => {
  assert.deepEqual(deriveMusicSearchTerms({}, 'dream away - frank sinatra'), { title: 'dream away', artist: 'frank sinatra' });
  assert.deepEqual(deriveMusicSearchTerms({ title: 'Dream Away' }, 'Dream Away - Frank Sinatra'), { title: 'Dream Away', artist: 'Frank Sinatra' });
  assert.deepEqual(deriveMusicSearchTerms({ title: 'Dream Away', artist: 'Other Singer' }, 'Dream Away - Other Singer', 'Frank Sinatra'), { title: 'Dream Away', artist: 'Frank Sinatra' });
  assert.deepEqual(deriveMusicSearchTerms({}, '03 - dream away - frank sinatra'), { title: 'dream away', artist: 'frank sinatra' });
});

test('music lookup shows exact track matches and collapses duplicate album editions', () => {
  const recordings = [{
    id: 'recording-1', title: 'Dream Away', 'first-release-date': '1973-10',
    'artist-credit': [{ artist: { name: 'Frank Sinatra' } }],
    releases: [
      { id: '00000000-0000-0000-0000-000000000001', title: 'Ol’ Blue Eyes Is Back', date: '2013-10-01', 'release-group': { id: 'group-old-blue-eyes' } },
      { id: '00000000-0000-0000-0000-000000000002', title: 'Ol’ Blue Eyes Is Back', date: '1973-10', 'release-group': { id: 'group-old-blue-eyes' } },
      { id: '00000000-0000-0000-0000-000000000003', title: 'The Complete Reprise Studio Recordings', date: '1998', 'release-group': { id: 'group-reprise' } }
    ]
  }, { id: 'recording-2', title: 'Dream Away Again', releases: [{ id: '00000000-0000-0000-0000-000000000004', title: 'Unrelated', 'release-group': { id: 'unrelated-group' } }] }];
  const matches = findMusicReleaseCandidates(recordings, 'dream away', 'Frank Sinatra');
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map(match => match.trackTitle), ['Dream Away', 'Dream Away']);
  assert.equal(matches[0].album, 'Ol’ Blue Eyes Is Back');
  assert.equal(matches[0].year, '1973');
  assert.equal(matches[1].album, 'The Complete Reprise Studio Recordings');
});

test('library scans supported audio recursively, skips other files and tolerates removed folders', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-music-'));
  try {
    await fs.mkdir(path.join(root, 'album', 'disc'), { recursive: true });
    await fs.writeFile(path.join(root, 'first.MP3'), 'audio');
    await fs.writeFile(path.join(root, 'album', 'disc', 'second.flac'), 'audio');
    await fs.writeFile(path.join(root, 'album', 'cover.jpg'), 'image');
    await fs.symlink(path.join(root, 'album'), path.join(root, 'shortcut'), 'junction');
    const tracks = await scanMusicFolders([root, path.join(root, 'missing')]);
    assert.deepEqual(tracks.map(track => track.name), ['first', 'second']);
    assert.deepEqual(tracks.map(track => track.extension), ['MP3', 'FLAC']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('queue tracks can move before or after another track without mutating the source list', () => {
  const tracks = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  assert.deepEqual(reorderMusicTracks(tracks, 'd', 'b').map(track => track.id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(reorderMusicTracks(tracks, 'a', 'c', 'after').map(track => track.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(tracks.map(track => track.id), ['a', 'b', 'c', 'd']);
});

test('dragging a sorted or filtered view keeps hidden tracks and commits the visible order', () => {
  const original = ['c', 'hidden', 'a', 'b'];
  assert.deepEqual(reorderVisibleMusicTrackIds(original, ['a', 'b', 'c'], 'a', 'c', 'after'), ['b', 'hidden', 'c', 'a']);
  assert.deepEqual(reorderVisibleMusicTrackIds(original, ['a', 'c'], 'c', 'a', 'after'), ['a', 'hidden', 'c', 'b']);
  assert.deepEqual(reorderVisibleMusicTrackIds(original, ['a', 'c'], 'b', 'a'), original);
  assert.deepEqual(original, ['c', 'hidden', 'a', 'b']);
});

test('saved music playlists are normalized, toggled and reorder independently of the library queue', () => {
  const playlists = normalizeMusicPlaylists([
    { id: 'favorites', name: 'Favoritas', trackIds: ['a', 'a', 'b'] },
    { id: 'favorites', name: 'Duplicada', trackIds: ['c'] },
    { id: '', name: 'Inválida', trackIds: [] }
  ]);
  assert.deepEqual(playlists, [{ id: 'favorites', name: 'Favoritas', description: '', coverDataUrl: '', trackIds: ['a', 'b'] }]);
  const added = toggleMusicPlaylistTrack(playlists[0], 'c');
  assert.deepEqual(added.trackIds, ['a', 'b', 'c']);
  assert.deepEqual(reorderMusicPlaylistTracks(added, 'c', 'a', 'before').trackIds, ['c', 'a', 'b']);
  assert.deepEqual(playlists[0].trackIds, ['a', 'b']);
  const decorated = normalizeMusicPlaylists([{ id: 'mix', name: 'Mix', description: 'Para dirigir', coverDataUrl: 'data:image/jpeg;base64,AAA=', trackIds: [] }]);
  assert.equal(decorated[0].description, 'Para dirigir');
  assert.equal(decorated[0].coverDataUrl, 'data:image/jpeg;base64,AAA=');
  assert.equal(normalizeMusicPlaylists([{ id: 'bad', name: 'Bad', coverDataUrl: 'file:///private/photo.jpg' }])[0].coverDataUrl, '');
});

test('offline player supports local artwork and user-triggered online metadata search', async () => {
  const root = path.resolve(__dirname, '..');
  const [html, preload, main, player] = await Promise.all([
    fs.readFile(path.join(root, 'src', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'preload.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'main.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'music-player.js'), 'utf8')
  ]);
  assert.match(html, /data-view="musicPlayer"/);
  assert.match(html, /id="musicPlayerView"/);
  assert.match(html, /data-open-tool="musicPlayer"/);
  assert.match(html, /src="\.\/music-player\.js"/);
  assert.match(html, /id="musicCoverImage"/);
  assert.match(html, /id="musicOnlineSearch"/);
  assert.match(html, /id="musicSettingsToggle"[^>]*aria-controls="musicSettingsPanel"/);
  assert.match(html, /id="musicSettingsPanel"[\s\S]*id="musicCrossfade"[\s\S]*id="musicOnlineSearch"[\s\S]*id="musicArtistToggle"[\s\S]*id="musicOnlineResults"/);
  assert.doesNotMatch(html, /musicLookupPanel|music-lookup-panel/);
  assert.match(player, /musicSettingsToggle'[\s\S]*musicSettingsPanel'[\s\S]*aria-expanded/);
  assert.match(player, /music-play-icon'[\s\S]*classList\.toggle\('hidden', playing\)/);
  assert.match(player, /music-repeat-one-icon'[\s\S]*repeatMode === 'one'/);
  for (const icon of ['musicShuffle', 'musicPrevious', 'musicPlayPause', 'musicNext', 'musicRepeat', 'musicSettingsToggle']) {
    assert.match(html, new RegExp(`id="${icon}"[\\s\\S]*?<svg`));
  }
  const nowPlayingCopy = html.match(/<div class="music-now-copy">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.doesNotMatch(nowPlayingCopy, /musicOnlineSearch|musicArtistToggle|musicOnlineResults/);
  assert.match(html, /id="musicArtistToggle"/);
  assert.match(html, /id="musicArtistName"/);
  assert.match(preload, /getMusicFolders/);
  assert.match(preload, /addMusicFolders/);
  assert.match(preload, /removeMusicFolder/);
  assert.match(preload, /scanMusicLibrary/);
  assert.match(preload, /addMusicFiles/);
  assert.match(preload, /chooseMusicFiles/);
  assert.match(preload, /chooseMusicPlaylistCover/);
  assert.match(preload, /getMusicTrackTags/);
  assert.match(preload, /getMusicTrackMetadata/);
  assert.match(preload, /searchOnlineMusicMetadata/);
  assert.match(main, /music-library-scan/);
  assert.match(main, /music-track-tags/);
  assert.match(main, /resolveAllowedMusicTrack\(filePath\)[\s\S]*?return \{ metadata: media\.metadata \}/);
  assert.match(main, /music-track-metadata/);
  assert.match(main, /music-search-online-metadata/);
  assert.match(main, /https:\/\/musicbrainz\.org\/ws\/2\/recording\//);
  assert.match(main, /https:\/\/coverartarchive\.org\/release\//);
  assert.match(main, /recording:\$\{lucenePhrase\(searchTitle\)\}/);
  assert.match(player, /showLibraryMessage\(libraryTrackIds\.size \? ''/);
  assert.doesNotMatch(player, /A reprodução acontece neste PC, sem enviar seus arquivos/);
  assert.match(main, /pathToFileURL\(track\.path\)/);
  assert.match(player, /startCrossfade/);
  assert.match(player, /O áudio e o caminho local não são enviados/);
  assert.match(player, /searchOnlineMusicMetadata\(track\.path, requestedArtist\)/);
  assert.match(player, /readObject\('ntc-music-online-artwork'\)/);
  assert.match(player, /localStorage\.setItem\('ntc-music-online-artwork'/);
  assert.match(preload, /music-search-online-metadata', filePath, artistOverride/);
  assert.match(player, /coverImage\.src = imageData/);
  assert.match(player, /localStorage\.setItem\('ntc-music-liked'/);
  assert.match(player, /readNumber\('ntc-music-volume', 80, 0, 100\)/);
  assert.match(player, /readNumber\('ntc-music-crossfade', 10, 0, 12\)/);
  assert.match(player, /localStorage\.setItem\('ntc-music-crossfade', String\(crossfadeSeconds\)\)/);
  assert.match(player, /localStorage\.setItem\('ntc-music-crossfade-user-set', 'true'\)/);
  assert.match(player, /migrateOldZeroDefault \? 10/);
  assert.match(player, /saved === null \|\| saved\.trim\(\) === ''/);
  assert.match(player, /trackContainer\.setPointerCapture\(pointerId\)/);
  assert.match(player, /localStorage\.setItem\('ntc-music-order'/);
  assert.match(player, /event\.key !== 'ArrowUp' && event\.key !== 'ArrowDown'/);
});

test('offline player adds persistent playlists, resume state, metadata organization, shortcuts and equalizer presets', async () => {
  const root = path.resolve(__dirname, '..');
  const [html, player, styles, preload] = await Promise.all([
    fs.readFile(path.join(root, 'src', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'music-player.js'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'styles.css'), 'utf8'),
    fs.readFile(path.join(root, 'preload.cjs'), 'utf8')
  ]);
  for (const id of ['musicPlaylistSelect', 'musicNewPlaylist', 'musicEditPlaylist', 'musicDeletePlaylist', 'musicOrganization', 'musicEqualizer']) assert.match(html, new RegExp(`id="${id}"`));
  for (const id of ['musicAudioDropzone', 'musicChooseAudioFiles', 'musicPlaylistSummary', 'musicEditPlaylistInfo', 'musicPlaylistInfoForm', 'musicPlaylistNameInput', 'musicPlaylistDescriptionInput', 'musicChoosePlaylistCover']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /Os arquivos ficam no local original; o NTC salva apenas a referência|A capa é reduzida e armazenada no computador/);
  assert.doesNotMatch(player, /Playlist criada\./);
  assert.match(html, /music-folder-heading-row[\s\S]*id="musicAddFolders"/);
  assert.match(html, /data-music-filter="playlist"/);
  assert.match(html, /id="musicSettingsPanel"[\s\S]*class="music-folder-list" id="musicFolders"/);
  assert.doesNotMatch(html, /music-shortcuts-hint|Espaço: tocar/);
  assert.match(player, /localStorage\.setItem\('ntc-music-playlists'/);
  assert.match(player, /localStorage\.setItem\('ntc-music-track-snapshots'/);
  assert.match(player, /trackFromPlaylistSnapshot/);
  assert.match(player, /playlistEditMode/);
  assert.match(player, /setPlaylistCoverPreview/);
  assert.match(player, /musicPlaylistNameInput/);
  assert.match(player, /playlist\.id !== selected\.id && playlist\.name\.localeCompare\(name/);
  assert.match(player, /bindTrackDrag\(row, reorderControl, track\.id\)/);
  assert.doesNotMatch(player, /Playlist atualizada neste computador|Escolha “Fila” em Organizar/);
  assert.doesNotMatch(html, /id="musicQueueHint"/);
  assert.match(preload, /music-library-add-files/);
  assert.match(preload, /music-playlist-choose-cover/);
  assert.match(player, /ntc-music-eq-settings/);
  assert.match(player, /musicEqTreble/);
  assert.match(player, /musicSaveEqualizerPreset/);
  assert.match(player, /localStorage\.setItem\('ntc-music-playback-state'/);
  assert.match(player, /restorePlaybackState\(\)/);
  assert.match(player, /pendingResumeSeek/);
  assert.match(player, /Lendo artista, álbum e gênero/);
  assert.match(player, /event\.code === 'Space'/);
  assert.match(player, /event\.key === 'ArrowRight' \|\| event\.key === 'ArrowLeft'/);
  assert.match(player, /createBiquadFilter/);
  assert.match(player, /GainNode|createGain/);
  assert.match(player, /lowshelf/);
  assert.match(player, /localStorage\.setItem\('ntc-music-eq-preset'/);
  assert.match(styles, /\.music-track-row\s*\{[^}]*27px 58px;/);
});

test('removing a song from NTC keeps the PC file, hides folder scans, and clears playlist state', async () => {
  const root = path.resolve(__dirname, '..');
  const [main, preload, player] = await Promise.all([
    fs.readFile(path.join(root, 'main.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'preload.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'music-player.js'), 'utf8')
  ]);
  assert.match(main, /ntc-music-removed-files\.json/);
  assert.match(main, /music-library-remove-track/);
  assert.match(main, /removed\.has\(musicPathKey\(track\.path\)\)/);
  assert.match(main, /saveRemovedMusicFiles\(readRemovedMusicFiles\(\)\.filter/);
  assert.match(preload, /removeMusicTrack: filePath/);
  assert.match(player, /Remover do NTC/);
  assert.match(player, /window\.ntc\.removeMusicTrack\(track\.path\)/);
  assert.match(player, /playlist\.trackIds\.filter\(id => id !== track\.id\)/);
  assert.doesNotMatch(main, /unlinkSync\(.*music|rmSync\(.*music/);
});

test('online music lookup retries temporary server failures and shows a readable message', async () => {
  const root = path.resolve(__dirname, '..');
  const [main, player] = await Promise.all([
    fs.readFile(path.join(root, 'main.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'music-player.js'), 'utf8')
  ]);
  assert.match(main, /\[429, 502, 503, 504\]\.includes\(response\.status\)/);
  assert.match(main, /attempt < 3/);
  assert.match(main, /temporariamente ocupado/);
  assert.match(player, /message\.includes\('Error invoking remote method'\)/);
  assert.doesNotMatch(main, /MusicBrainz respondeu/);
});

test('all main tool headings except RNG now have a short explanatory sentence', async () => {
  const html = await fs.readFile(path.join(path.resolve(__dirname, '..'), 'src', 'index.html'), 'utf8');
  const views = [...html.matchAll(/<section class="view[^>]*?id="([^"]+)"[\s\S]*?<div class="hero[^>]*>[\s\S]*?<h1>[\s\S]*?<\/h1>([\s\S]*?)<\/div>/g)];
  const missing = views.filter(([_, id, afterTitle]) => id !== 'rngView' && !/<p>[^<]+<\/p>/.test(afterTitle)).map(([_, id]) => id);
  assert.deepEqual(missing, []);
  const homeCards = html.match(/<div class="tools-grid">([\s\S]*?)<\/div>/)?.[1] || '';
  const cards = [...homeCards.matchAll(/<button class="tool-card available" data-open-tool="([^"]+)">([\s\S]*?)<\/button>/g)];
  assert.ok(cards.length > 0);
  assert.deepEqual(cards.filter(([_, tool, content]) => tool !== 'rng' && !/<small>[^<]+<\/small>/.test(content)).map(([_, tool]) => tool), []);
  assert.doesNotMatch(cards.find(([_, tool]) => tool === 'rng')?.[0] || '', /<small>/);
});

test('screenshot editor actions share alignment and ignore the global primary-button top margin', async () => {
  const styles = await fs.readFile(path.join(path.resolve(__dirname, '..'), 'src', 'styles.css'), 'utf8');
  assert.match(styles, /\.screenshot-editor-footer button\s*\{[^}]*height: 36px; margin: 0;/);
  assert.match(styles, /\.screenshot-editor-footer\s*\{[^}]*justify-content: space-between/);
});
