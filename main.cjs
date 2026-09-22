const { app, BrowserWindow, dialog, ipcMain, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

app.setPath('userData', path.join(__dirname, '.ntc-data'));
const downloadJobs = new Map();
const conversionJobs = new Map();
const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
const audioExtensions = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma'];
const videoExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v'];

function isSupportedUrl(value) { try { return hosts.includes(new URL(value).hostname); } catch { return false; } }
function send(sender, channel, payload) { if (!sender.isDestroyed()) sender.send(channel, payload); }
function binaryDirectory() { return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'resources', 'bin'); }
function binary(name) { const bundled = path.join(binaryDirectory(), `${name}.exe`); return fs.existsSync(bundled) ? bundled : name; }
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(command), args, { windowsHide: true }); let out = ''; let err = '';
    child.stdout.on('data', data => { out += data.toString(); }); child.stderr.on('data', data => { err += data.toString(); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || `Processo terminou com código ${code}`)));
  });
}
function runBuffer(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(command), args, { windowsHide: true }); const chunks = []; let error = '';
    child.stdout.on('data', data => chunks.push(data)); child.stderr.on('data', data => { error += data.toString(); });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error || `Processo terminou com código ${code}`)));
  });
}
function buildArgs(item) {
  const quality = item.quality || (item.type === 'audio' ? 'original' : 'best');
  const outputName = item.filename ? path.basename(item.filename, path.extname(item.filename)) : '%(title).180B';
  const output = path.join(item.folder, `${outputName}.%(ext)s`);
  const args = ['--no-playlist', '--newline', '--no-warnings', '--ffmpeg-location', binaryDirectory(), '--progress-template', 'download:PROGRESS|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s', '--print', 'before_dl:TITLE|%(title)s', '--print', 'after_move:FILE|%(filepath)s', '--output', output];
  if (item.duplicate === 'overwrite') args.push('--force-overwrites'); else args.push('--no-overwrites');
  if (item.type === 'audio') { if (item.format === 'original') args.push('--format', 'bestaudio/best'); else args.push('--extract-audio', '--audio-format', item.format, '--audio-quality', quality === 'original' ? '0' : `${quality}K`); }
  else { const height = quality === 'best' ? '' : `[height<=${quality}]`; const format = item.format === 'webm' ? 'webm' : 'mp4'; args.push('--format', `bv*${height}+ba/b${height}`, '--merge-output-format', format); }
  args.push(item.url); return args;
}
function availableFilename(folder, filename, duplicate) {
  if (duplicate === 'overwrite' || !filename) return filename;
  const ext = path.extname(filename); const stem = path.basename(filename, ext); let candidate = filename; let n = 1;
  while (fs.existsSync(path.join(folder, candidate))) candidate = `${stem} (${n++})${ext}`;
  return candidate;
}
function findDownloadedFile(item, reportedFile) {
  if (reportedFile && fs.existsSync(reportedFile)) return reportedFile;
  const base = path.basename(item.filename || '', path.extname(item.filename || '')); const extension = item.type === 'audio' ? item.format : item.format;
  const expected = base && extension ? path.join(item.folder, `${base}.${extension}`) : '';
  if (expected && fs.existsSync(expected)) return expected;
  try {
    return fs.readdirSync(item.folder, { withFileTypes: true }).filter(entry => entry.isFile() && (!base || entry.name.startsWith(base)) && (!extension || path.extname(entry.name).toLowerCase() === `.${extension}`)).map(entry => path.join(item.folder, entry.name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || '';
  } catch { return ''; }
}
function downloadErrorMessage(log) {
  const useful = String(log || '').split(/\r?\n/).map(line => line.trim()).filter(line => /(?:ERROR|WARNING):/i.test(line)).pop();
  if (!useful) return 'O arquivo não foi criado. Verifique o link, a qualidade, a pasta ou a conexão.';
  if (/sign in|confirm.*age|bot/i.test(useful)) return 'O YouTube pediu confirmação de acesso para este conteúdo. Tente novamente mais tarde ou use outro vídeo.';
  return useful.replace(/^.*?(?:ERROR|WARNING):\s*/i, '') || 'Não foi possível concluir o download.';
}
function safeName(value) { return String(value || 'conversão').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').slice(0, 150) || 'conversão'; }
function parseTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (/^\d+(?:\.\d+)?$/.test(String(value))) return Number(value);
  const parts = String(value).trim().split(':').map(Number);
  if (!parts.length || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
function outputExtension(format) { return format === 'm4a' ? 'm4a' : format; }
function codecArgs(format, quality) {
  const bitrate = ['128', '192', '256', '320'].includes(String(quality)) ? `${quality}k` : '192k';
  if (format === 'mp3') return ['-c:a', 'libmp3lame', '-b:a', bitrate];
  if (format === 'm4a') return ['-c:a', 'aac', '-b:a', bitrate];
  if (format === 'opus') return ['-c:a', 'libopus', '-b:a', bitrate];
  if (format === 'wav') return ['-c:a', 'pcm_s16le'];
  if (format === 'flac') return ['-c:a', 'flac'];
  throw new Error('Formato de saída inválido.');
}
function estimateEta(seconds, percent) {
  if (!percent || percent <= 0 || !seconds) return '—';
  const remaining = Math.max(0, Math.round(seconds * (100 - percent) / percent));
  return remaining < 60 ? `${remaining}s` : `${Math.floor(remaining / 60)}m ${remaining % 60}s`;
}
async function inspectMedia(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Arquivo não encontrado.');
  const data = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const audio = (data.streams || []).find(stream => stream.codec_type === 'audio');
  const cover = (data.streams || []).find(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic);
  if (!audio) throw new Error('Este arquivo não possui uma faixa de áudio.');
  const tags = data.format?.tags || {};
  const duration = Number(data.format?.duration || audio.duration || 0);
  return {
    path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), duration: Number.isFinite(duration) ? duration : 0,
    durationLabel: Number.isFinite(duration) && duration > 0 ? new Date(duration * 1000).toISOString().slice(11, 19) : '—',
    type: videoExtensions.includes(path.extname(file).toLowerCase()) ? 'Vídeo' : 'Áudio', format: data.format?.format_name || path.extname(file).slice(1),
    coverStreamIndex: Number.isInteger(cover?.index) ? cover.index : null,
    metadata: { title: tags.title || '', artist: tags.artist || tags.album_artist || '', album: tags.album || '', year: tags.date || tags.year || '', genre: tags.genre || '' }
  };
}
async function createWaveform(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Arquivo não encontrado.');
  const pcm = await runBuffer('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '200', '-f', 'f32le', 'pipe:1']);
  const sampleCount = Math.floor(pcm.length / 4); const points = 720; const values = new Array(points).fill(0);
  if (!sampleCount) return values;
  for (let index = 0; index < sampleCount; index++) { const point = Math.min(points - 1, Math.floor(index * points / sampleCount)); const amplitude = Math.abs(pcm.readFloatLE(index * 4)); if (Number.isFinite(amplitude) && amplitude > values[point]) values[point] = amplitude; }
  const peak = Math.max(...values, 0.0001); return values.map(value => Math.min(1, value / peak));
}
function createWindow() {
  const window = new BrowserWindow({ width: 1160, height: 760, minWidth: 930, minHeight: 640, backgroundColor: '#090909', frame: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  window.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('get-default-download-folder', () => app.getPath('downloads'));
  ipcMain.handle('window-minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window-toggle-maximize', event => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return false; if (window.isMaximized()) window.unmaximize(); else window.maximize(); return window.isMaximized(); });
  ipcMain.handle('window-close', event => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('window-is-maximized', event => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false);
  ipcMain.handle('choose-download-folder', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha a pasta de destino', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('choose-media-files', async () => {
    const result = await dialog.showOpenDialog({ title: 'Escolha arquivos de áudio ou vídeo', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mídia', extensions: [...audioExtensions, ...videoExtensions].map(extension => extension.slice(1)) }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('choose-cover-file', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha uma capa', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png'] }] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('inspect-media', (_event, file) => inspectMedia(file));
  ipcMain.handle('get-waveform', (_event, file) => createWaveform(file));
  ipcMain.handle('open-folder', (_event, folder) => folder ? shell.openPath(folder) : '');
  ipcMain.handle('open-file', (_event, file) => file ? shell.openPath(file) : '');
  ipcMain.handle('copy-path', (_event, file) => { if (file) clipboard.writeText(file); return file || ''; });
  ipcMain.handle('tool-versions', async () => { try { const ytdlp = (await run('yt-dlp', ['--version'])).trim(); const ffmpeg = (await run('ffmpeg', ['-version'])).split(/\r?\n/)[0]; return { ytdlp, ffmpeg }; } catch (error) { return { error: error.message }; } });
  ipcMain.handle('preview-url', async (_event, url) => { if (!isSupportedUrl(url)) throw new Error('Cole um link válido do YouTube.'); const data = JSON.parse(await run('yt-dlp', ['--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', url])); return { id: data.id, title: data.title || 'Sem título', channel: data.channel || data.uploader || 'Canal desconhecido', duration: data.duration_string || '—', thumbnail: data.thumbnail || '', webpageUrl: data.webpage_url || url }; });
  ipcMain.handle('playlist-preview', async (_event, url) => { if (!isSupportedUrl(url)) throw new Error('Link inválido.'); const data = JSON.parse(await run('yt-dlp', ['--flat-playlist', '--dump-single-json', '--skip-download', '--no-warnings', url])); const entries = (data.entries || []).filter(Boolean).map(entry => ({ id: entry.id, title: entry.title || 'Sem título', channel: entry.channel || entry.uploader || '', duration: entry.duration_string || '—', thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`, webpageUrl: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}` })); return { isPlaylist: data._type === 'playlist' || entries.length > 1, title: data.title || 'Playlist', thumbnail: data.thumbnail || '', entries }; });
  ipcMain.handle('start-download', async (event, item) => {
    if (!item?.downloadId || !isSupportedUrl(item.url)) throw new Error('Link inválido.'); if (!item.folder || !['audio', 'video'].includes(item.type)) throw new Error('Dados de download inválidos.');
    return new Promise((resolve, reject) => {
      item = { ...item, filename: availableFilename(item.folder, item.filename, item.duplicate) }; const child = spawn(binary('yt-dlp'), buildArgs(item), { windowsHide: true }); let title = item.title || 'Arquivo de mídia'; let file = ''; let cancelled = false; let buffer = ''; let errorLog = '';
      downloadJobs.set(item.downloadId, { cancel: () => { cancelled = true; child.kill(); } }); send(event.sender, 'download-event', { downloadId: item.downloadId, status: 'starting' });
      const line = value => { const s = value.trim(); if (s.startsWith('TITLE|')) title = s.slice(6) || title; if (s.startsWith('FILE|')) file = s.slice(5); if (s.startsWith('PROGRESS|')) { const [, p, speed, eta] = s.split('|'); const percent = Number.parseFloat((p || '').replace('%', '')); send(event.sender, 'download-event', { downloadId: item.downloadId, status: 'downloading', title, percent: Number.isFinite(percent) ? percent : 0, speed: (speed || '—').trim(), eta: (eta || '—').trim() }); } };
      const data = chunk => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; lines.forEach(line); };
      child.stdout.on('data', data); child.stderr.on('data', chunk => { errorLog += chunk.toString(); data(chunk); }); child.on('error', error => { downloadJobs.delete(item.downloadId); reject(error); }); child.on('close', code => { downloadJobs.delete(item.downloadId); if (cancelled) return reject(new Error('Download cancelado.')); const finalFile = findDownloadedFile(item, file); if (code !== 0) return reject(new Error(downloadErrorMessage(errorLog))); if (!finalFile) return reject(new Error('O download terminou, mas o arquivo final não foi encontrado na pasta escolhida.')); const stat = fs.statSync(finalFile); send(event.sender, 'download-event', { downloadId: item.downloadId, status: 'complete', title, file: finalFile, size: stat.size }); resolve({ title, file: finalFile, size: stat.size }); });
    });
  });
  ipcMain.handle('cancel-download', (_event, downloadId) => downloadJobs.get(downloadId)?.cancel?.());
  ipcMain.handle('start-conversion', async (event, item) => {
    if (!item?.conversionId || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Dados da conversão inválidos.');
    const start = parseTime(item.trimStart); const end = parseTime(item.trimEnd); const duration = Number(item.duration || 0);
    if (Number.isNaN(start) || Number.isNaN(end) || (start !== null && end !== null && end <= start) || (duration && ((start !== null && start >= duration) || (end !== null && end > duration)))) throw new Error('O corte informado é inválido.');
    const supportsCover = ['mp3', 'm4a', 'flac'].includes(item.format); const preservedCover = !item.cover && Number.isInteger(item.coverStreamIndex) && supportsCover;
    if (item.cover && !supportsCover) throw new Error('Capa é compatível com MP3, M4A e FLAC.');
    const baseName = safeName(item.outputName || path.basename(item.source, path.extname(item.source))); const extension = outputExtension(item.format); let filename = availableFilename(item.folder, `${baseName}.${extension}`, item.duplicate);
    if (path.resolve(item.folder, filename).toLowerCase() === path.resolve(item.source).toLowerCase()) filename = availableFilename(item.folder, `${baseName} (editado).${extension}`, 'rename');
    const output = path.join(item.folder, filename); const args = ['-hide_banner', '-y']; const trimDuration = end !== null ? end - (start || 0) : null;
    if (start !== null) args.push('-ss', String(start)); args.push('-i', item.source); if (item.cover) args.push('-i', item.cover); if (trimDuration !== null) args.push('-t', String(trimDuration));
    args.push('-map', '0:a:0', '-map_metadata', '0');
    if (item.cover) args.push('-map', '1:v:0', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    else if (preservedCover) args.push('-map', `0:${item.coverStreamIndex}`, '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
    if (item.normalize) args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    ['title', 'artist', 'album', 'year', 'genre'].forEach(key => { if (item.metadata?.[key]) args.push('-metadata', `${key === 'year' ? 'date' : key}=${item.metadata[key]}`); });
    args.push(...codecArgs(item.format, item.quality), '-progress', 'pipe:1', '-nostats', output);
    return new Promise((resolve, reject) => {
      const child = spawn(binary('ffmpeg'), args, { windowsHide: true }); let cancelled = false; let buffer = ''; let lastSeconds = 0; const started = Date.now();
      conversionJobs.set(item.conversionId, { cancel: () => { cancelled = true; child.kill(); } }); send(event.sender, 'conversion-event', { conversionId: item.conversionId, status: 'starting' });
      const line = raw => { const [key, ...rest] = raw.trim().split('='); const value = rest.join('='); if (key === 'out_time_ms') { lastSeconds = Number(value) / 1000000; const usableDuration = end !== null ? end - (start || 0) : duration; const percent = usableDuration ? Math.min(99, (lastSeconds / usableDuration) * 100) : 0; const elapsed = (Date.now() - started) / 1000; send(event.sender, 'conversion-event', { conversionId: item.conversionId, status: 'converting', percent, eta: estimateEta(elapsed, percent) }); } };
      const data = chunk => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; lines.forEach(line); };
      child.stdout.on('data', data); child.stderr.on('data', data); child.on('error', error => { conversionJobs.delete(item.conversionId); reject(error); }); child.on('close', code => { conversionJobs.delete(item.conversionId); if (cancelled) { if (fs.existsSync(output)) fs.unlinkSync(output); return reject(new Error('Conversão cancelada.')); } if (code !== 0 || !fs.existsSync(output)) return reject(new Error('A conversão falhou. Verifique o arquivo, o corte ou o espaço disponível.')); const stat = fs.statSync(output); send(event.sender, 'conversion-event', { conversionId: item.conversionId, status: 'complete', file: output, size: stat.size, filename }); resolve({ file: output, size: stat.size, filename }); });
    });
  });
  ipcMain.handle('cancel-conversion', (_event, conversionId) => conversionJobs.get(conversionId)?.cancel?.());
  createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
