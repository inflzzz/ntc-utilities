const { app, BrowserWindow, dialog, ipcMain, shell, clipboard, desktopCapturer, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { autoUpdater } = require('electron-updater');
const sharp = require('sharp');

// Evita artefatos visuais que alguns drivers de vídeo exibem apenas no monitor.
// A captura de tela continua normal nesses casos porque ela lê o frame antes da
// composição final da GPU.
app.disableHardwareAcceleration();

if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '.ntc-data'));
const downloadJobs = new Map();
const conversionJobs = new Map();
const videoJobs = new Map();
const imageJobs = new Map();
const recordingSessions = new Map();
let mainWindow = null;
let forceClose = false;
let screenShortcut = null;
let updateState = { status: 'idle' };
const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
const audioExtensions = ['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma'];
const videoExtensions = ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v'];
const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'];

function isSupportedUrl(value) { try { return hosts.includes(new URL(value).hostname); } catch { return false; } }
function send(sender, channel, payload) { if (!sender.isDestroyed()) sender.send(channel, payload); }
function sendUpdate(payload) {
  updateState = payload;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-event', payload);
}
function releaseNotes(value) {
  if (Array.isArray(value)) return value.map(note => note.note || note).join('\n');
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\\n/g, '\n').trim();
}
function configureUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking' }));
  autoUpdater.on('update-available', info => sendUpdate({ status: 'available', version: info.version, notes: releaseNotes(info.releaseNotes) }));
  autoUpdater.on('update-not-available', () => sendUpdate({ status: 'current', version: app.getVersion() }));
  autoUpdater.on('download-progress', progress => sendUpdate({ status: 'downloading', percent: Math.round(progress.percent || 0) }));
  autoUpdater.on('update-downloaded', info => sendUpdate({ status: 'downloaded', version: info.version, notes: releaseNotes(info.releaseNotes) }));
  autoUpdater.on('error', error => sendUpdate({ status: 'error', message: 'Não foi possível verificar ou baixar a atualização. Tente novamente mais tarde.' }));
}
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
  if (item.speedLimit) args.push('--limit-rate', item.speedLimit);
  if (item.type === 'audio') { if (item.format === 'original') args.push('--format', 'bestaudio/best'); else args.push('--extract-audio', '--audio-format', item.format, '--audio-quality', quality === 'original' ? '0' : `${quality}K`); }
  else if (item.type === 'thumbnail') args.push('--skip-download', '--write-thumbnail', '--convert-thumbnails', item.format === 'png' ? 'png' : 'jpg');
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
  if (format === 'aac') return ['-c:a', 'aac', '-b:a', bitrate];
  if (format === 'ogg') return ['-c:a', 'libvorbis', '-b:a', bitrate];
  if (format === 'opus') return ['-c:a', 'libopus', '-b:a', bitrate];
  if (format === 'wav') return ['-c:a', 'pcm_s16le'];
  if (format === 'flac') return ['-c:a', 'flac'];
  if (format === 'aiff') return ['-c:a', 'pcm_s16be'];
  if (format === 'wma') return ['-c:a', 'wmav2', '-b:a', bitrate];
  if (format === 'ac3') return ['-c:a', 'ac3', '-b:a', bitrate];
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
async function inspectVideo(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Vídeo não encontrado.');
  const data = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const video = (data.streams || []).find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Este arquivo não possui vídeo.');
  const duration = Number(data.format?.duration || video.duration || 0);
  return { path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), duration: Number.isFinite(duration) ? duration : 0, durationLabel: duration ? new Date(duration * 1000).toISOString().slice(11, 19) : '—', width: video.width || 0, height: video.height || 0, hasAudio: (data.streams || []).some(stream => stream.codec_type === 'audio'), format: path.extname(file).slice(1) };
}
async function inspectImage(file) {
  if (!file || !fs.existsSync(file)) throw new Error('Imagem não encontrada.');
  const data = await sharp(file).metadata();
  if (!data.width || !data.height) throw new Error('Não foi possível ler esta imagem.');
  return { path: file, name: path.basename(file), baseName: path.basename(file, path.extname(file)), width: data.width, height: data.height, format: data.format || path.extname(file).slice(1), hasAlpha: Boolean(data.hasAlpha), size: fs.statSync(file).size };
}
function imageDimensions(metadata, item) {
  const scale = Math.max(1, Math.min(10000, Number(item.scale) || 100)) / 100; const sourceWidth = Number(metadata.width || 0); const sourceHeight = Number(metadata.height || 0); let width = Number(item.width) || Math.round(sourceWidth * scale) || null; let height = Number(item.height) || Math.round(sourceHeight * scale) || null;
  if (item.keepRatio !== false && sourceWidth && sourceHeight) { if (Number(item.width) && !Number(item.height)) height = Math.round(width * sourceHeight / sourceWidth); if (Number(item.height) && !Number(item.width)) width = Math.round(height * sourceWidth / sourceHeight); }
  return { width, height };
}
function applyLowQualityPixelation(pipeline, width, height, quality) {
  if (quality > 15 || !width || !height) return pipeline; const factor = Math.max(.015, quality / 100); return pipeline.resize(Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor)), { fit: 'fill', kernel: 'nearest' }).resize(width, height, { fit: 'fill', kernel: 'nearest' });
}
function startFfmpegJob(event, map, id, args, output, duration, channel) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary('ffmpeg'), args, { windowsHide: true }); let cancelled = false; let buffer = ''; const started = Date.now();
    map.set(id, { cancel: () => { cancelled = true; child.kill(); } });
    const line = raw => { const [key, ...rest] = raw.trim().split('='); if (key !== 'out_time_ms') return; const seconds = Number(rest.join('=')) / 1000000; const percent = duration ? Math.min(99, seconds / duration * 100) : 0; send(event.sender, channel, { id, status: 'converting', percent, eta: estimateEta((Date.now() - started) / 1000, percent) }); };
    const data = chunk => { buffer += chunk.toString(); const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; lines.forEach(line); };
    child.stdout.on('data', data); child.stderr.on('data', data); child.on('error', error => { map.delete(id); reject(error); }); child.on('close', code => { map.delete(id); if (cancelled) { if (fs.existsSync(output)) fs.unlinkSync(output); return reject(new Error('Operação cancelada.')); } if (code !== 0 || !fs.existsSync(output)) return reject(new Error('A conversão falhou. Verifique o arquivo, as opções ou o espaço disponível.')); const stat = fs.statSync(output); send(event.sender, channel, { id, status: 'complete', file: output, size: stat.size, filename: path.basename(output) }); resolve({ file: output, size: stat.size, filename: path.basename(output) }); });
  });
}
function recordingOutputName(folder) { const stamp = new Date().toISOString().replace(/[T:]/g, '-').replace(/\..+/, ''); return availableFilename(folder, `Gravação ${stamp}.mp4`, 'rename'); }
async function finalizeScreenRecording(session) {
  await new Promise((resolve, reject) => { session.stream.end(error => error ? reject(error) : resolve()); });
  const crf = { alta: '18', equilibrada: '23', economica: '30' }[session.quality] || '23'; const args = ['-hide_banner', '-y', '-i', session.temp]; if (session.resolution && session.resolution !== 'original') args.push('-vf', `scale=-2:${Number(session.resolution)}`); args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p');
  if (session.withAudio) args.push('-c:a', 'aac', '-b:a', '128k'); else args.push('-an');
  args.push('-movflags', '+faststart', session.output);
  try { await run('ffmpeg', args); } finally { if (fs.existsSync(session.temp)) fs.unlinkSync(session.temp); }
  const stat = fs.statSync(session.output); return { file: session.output, size: stat.size, filename: path.basename(session.output) };
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
  mainWindow = new BrowserWindow({ width: 1160, height: 760, minWidth: 930, minHeight: 640, icon: path.join(__dirname, 'build', 'ntc-logo.png'), backgroundColor: '#090909', frame: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.on('close', event => { if (forceClose || !recordingSessions.size) return; event.preventDefault(); if (!mainWindow.isDestroyed()) mainWindow.webContents.send('screen-close-request'); });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.ntccorporation.utilities');
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-default-download-folder', () => app.getPath('downloads'));
  ipcMain.handle('get-free-space', (_event, folder) => { try { const stat = fs.statfsSync(folder || app.getPath('downloads')); return Number(stat.bavail) * Number(stat.bsize); } catch { return null; } });
  ipcMain.handle('window-minimize', event => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window-toggle-maximize', event => { const window = BrowserWindow.fromWebContents(event.sender); if (!window) return false; if (window.isMaximized()) window.unmaximize(); else window.maximize(); return window.isMaximized(); });
  ipcMain.handle('window-close', event => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('window-force-close', event => { forceClose = true; BrowserWindow.fromWebContents(event.sender)?.close(); });
  ipcMain.handle('window-is-maximized', event => BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false);
  ipcMain.handle('choose-download-folder', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha a pasta de destino', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('choose-media-files', async () => {
    const result = await dialog.showOpenDialog({ title: 'Escolha arquivos de áudio ou vídeo', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mídia', extensions: [...audioExtensions, ...videoExtensions].map(extension => extension.slice(1)) }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('choose-video-files', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha vídeos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Vídeos', extensions: videoExtensions.map(extension => extension.slice(1)) }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('choose-image-files', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha imagens', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Imagens', extensions: imageExtensions.map(extension => extension.slice(1)) }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('choose-compressor-files', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha arquivos para comprimir', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mídias e imagens', extensions: [...audioExtensions, ...videoExtensions, ...imageExtensions].map(extension => extension.slice(1)) }] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('choose-cover-file', async () => { const result = await dialog.showOpenDialog({ title: 'Escolha uma capa', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png'] }] }); return result.canceled ? null : result.filePaths[0]; });
  ipcMain.handle('inspect-media', (_event, file) => inspectMedia(file));
  ipcMain.handle('inspect-video', (_event, file) => inspectVideo(file));
  ipcMain.handle('inspect-image', (_event, file) => inspectImage(file));
  ipcMain.handle('preview-image', async (_event, item) => {
    if (!item?.source || !fs.existsSync(item.source)) throw new Error('Imagem não encontrada.');
    const metadata = await sharp(item.source).metadata(); const { width, height } = imageDimensions(metadata, item);
    const quality = Math.max(1, Math.min(100, Number(item.quality) || 85)); const format = ['jpg', 'png', 'webp'].includes(item.format) ? item.format : 'jpg'; let pipeline = sharp(item.source).rotate().resize(width, height, { fit: item.keepRatio === false ? 'fill' : 'inside', withoutEnlargement: false }); pipeline = applyLowQualityPixelation(pipeline, width, height, quality).resize({ width: 1100, height: 700, fit: 'inside', withoutEnlargement: true }); if (format === 'jpg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }); if (format === 'png') pipeline = pipeline.png({ palette: true, quality, compressionLevel: 9 }); if (format === 'webp') pipeline = pipeline.webp({ quality }); const output = await pipeline.toBuffer(); const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`; return { dataUrl: `data:${mime};base64,${output.toString('base64')}`, width, height };
  });
  ipcMain.handle('get-waveform', (_event, file) => createWaveform(file));
  ipcMain.handle('open-folder', (_event, folder) => folder ? shell.openPath(folder) : '');
  ipcMain.handle('open-file', (_event, file) => file ? shell.openPath(file) : '');
  ipcMain.handle('open-file-folder', (_event, file) => file ? shell.openPath(path.dirname(file)) : '');
  ipcMain.handle('copy-path', (_event, file) => { if (file) clipboard.writeText(file); return file || ''; });
  ipcMain.handle('tool-versions', async () => { try { const ytdlp = (await run('yt-dlp', ['--version'])).trim(); const ffmpeg = (await run('ffmpeg', ['-version'])).split(/\r?\n/)[0]; const ffprobe = (await run('ffprobe', ['-version'])).split(/\r?\n/)[0]; return { ytdlp, ffmpeg, ffprobe }; } catch (error) { return { error: error.message }; } });
  ipcMain.handle('check-for-updates', async () => {
    if (!app.isPackaged) return { status: 'unavailable', message: 'A verificação de atualização funciona na versão instalada.' };
    try { await autoUpdater.checkForUpdates(); return updateState; } catch { return { status: 'error', message: 'Não foi possível verificar atualizações agora.' }; }
  });
  ipcMain.handle('download-update', async () => {
    if (!app.isPackaged || updateState.status !== 'available') return { status: 'unavailable' };
    try { await autoUpdater.downloadUpdate(); return updateState; } catch { return { status: 'error', message: 'Não foi possível baixar a atualização.' }; }
  });
  ipcMain.handle('install-update', () => {
    if (app.isPackaged && updateState.status === 'downloaded') autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle('preview-url', async (_event, url) => { if (!isSupportedUrl(url)) throw new Error('Cole um link válido do YouTube.'); const data = JSON.parse(await run('yt-dlp', ['--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', url])); const sizes = [data.filesize, data.filesize_approx, ...(data.formats || []).map(format => format.filesize || format.filesize_approx || 0)]; const estimatedSize = Math.max(0, ...sizes.map(value => Number(value) || 0)); return { id: data.id, title: data.title || 'Sem título', channel: data.channel || data.uploader || 'Canal desconhecido', duration: data.duration_string || '—', thumbnail: data.thumbnail || '', estimatedSize, webpageUrl: data.webpage_url || url }; });
  ipcMain.handle('playlist-preview', async (_event, url) => { if (!isSupportedUrl(url)) throw new Error('Link inválido.'); const data = JSON.parse(await run('yt-dlp', ['--flat-playlist', '--dump-single-json', '--skip-download', '--no-warnings', url])); const entries = (data.entries || []).filter(Boolean).map(entry => ({ id: entry.id, title: entry.title || 'Sem título', channel: entry.channel || entry.uploader || '', duration: entry.duration_string || '—', thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`, webpageUrl: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}` })); return { isPlaylist: data._type === 'playlist' || entries.length > 1, title: data.title || 'Playlist', thumbnail: data.thumbnail || '', entries }; });
  ipcMain.handle('start-download', async (event, item) => {
    if (!item?.downloadId || !isSupportedUrl(item.url)) throw new Error('Link inválido.'); if (!item.folder || !['audio', 'video', 'thumbnail'].includes(item.type)) throw new Error('Dados de download inválidos.');
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
    const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0; const filters = []; if (item.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11'); if (finite(item.gain)) filters.push(`volume=${finite(item.gain)}dB`); if (finite(item.eqBass)) filters.push(`equalizer=f=100:t=q:w=1:g=${finite(item.eqBass)}`); if (finite(item.eqMid)) filters.push(`equalizer=f=1000:t=q:w=1:g=${finite(item.eqMid)}`); if (finite(item.eqTreble)) filters.push(`equalizer=f=6000:t=q:w=1:g=${finite(item.eqTreble)}`); if (item.removeSilence) filters.push('silenceremove=start_periods=1:start_duration=0.25:start_threshold=-45dB:stop_periods=-1:stop_duration=0.25:stop_threshold=-45dB'); if (filters.length) args.push('-af', filters.join(','));
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
  ipcMain.handle('start-video-conversion', async (event, item) => {
    if (!item?.id || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Dados do vídeo inválidos.');
    const extension = ['mp4', 'mkv', 'webm'].includes(item.format) ? item.format : 'mp4'; const filename = availableFilename(item.folder, `${safeName(item.outputName || path.basename(item.source, path.extname(item.source)))}.${extension}`, item.duplicate); const output = path.join(item.folder, filename); const args = ['-hide_banner', '-y', '-i', item.source];
    if (item.resolution && item.resolution !== 'original') args.push('-vf', `scale=-2:${Number(item.resolution)}`); if (item.audioMode === 'mute') args.push('-an'); else args.push('-map', '0:a?'); args.push('-map', '0:v:0');
    const crf = { alta: '20', equilibrada: '25', economica: '30' }[item.quality] || '25'; if (extension === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-c:a', 'libopus'); else args.push('-c:v', item.codec === 'h265' ? 'libx265' : 'libx264', '-crf', crf, '-preset', 'medium', '-c:a', 'aac'); args.push('-progress', 'pipe:1', '-nostats', output);
    return startFfmpegJob(event, videoJobs, item.id, args, output, Number(item.duration || 0), 'video-event');
  });
  ipcMain.handle('cancel-video-conversion', (_event, id) => videoJobs.get(id)?.cancel?.());
  ipcMain.handle('start-image-conversion', async (event, item) => {
    if (!item?.id || !item.source || !item.folder || !fs.existsSync(item.source)) throw new Error('Dados da imagem inválidos.'); const format = ['jpg', 'png', 'webp'].includes(item.format) ? item.format : 'jpg'; const filename = availableFilename(item.folder, `${safeName(item.outputName || path.basename(item.source, path.extname(item.source)))}.${format}`, item.duplicate); const output = path.join(item.folder, filename); let cancelled = false; imageJobs.set(item.id, { cancel: () => { cancelled = true; } }); send(event.sender, 'image-event', { id: item.id, status: 'converting', percent: 10 });
    try { let pipeline = sharp(item.source).rotate(); const metadata = await sharp(item.source).metadata(); const { width, height } = imageDimensions(metadata, item); const quality = Math.max(1, Math.min(100, Number(item.quality) || 85)); if (width || height) pipeline = pipeline.resize(width, height, { fit: item.keepRatio === false ? 'fill' : 'inside', withoutEnlargement: false }); pipeline = applyLowQualityPixelation(pipeline, width, height, quality); if (format === 'jpg') pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }); if (format === 'png') pipeline = pipeline.png({ palette: true, quality, compressionLevel: 9 }); if (format === 'webp') pipeline = pipeline.webp({ quality }); await pipeline.toFile(output); imageJobs.delete(item.id); if (cancelled) { if (fs.existsSync(output)) fs.unlinkSync(output); throw new Error('Operação cancelada.'); } const stat = fs.statSync(output); send(event.sender, 'image-event', { id: item.id, status: 'complete', file: output, size: stat.size, filename }); return { file: output, size: stat.size, filename }; } catch (error) { imageJobs.delete(item.id); throw error; }
  });
  ipcMain.handle('cancel-image-conversion', (_event, id) => imageJobs.get(id)?.cancel?.());
  ipcMain.handle('start-compression', async (_event, item) => {
    if (!item?.source || !item?.folder || !fs.existsSync(item.source)) throw new Error('Arquivo ou pasta de destino inválidos.'); const ext = path.extname(item.source).toLowerCase(); const base = safeName(path.basename(item.source, ext));
    if (imageExtensions.includes(ext)) { const output = path.join(item.folder, availableFilename(item.folder, `${base} comprimido.jpg`, item.duplicate)); const quality = Math.max(1, Math.min(100, Number(item.imageQuality) || 60)); const scale = Math.max(.01, Number(item.imageScale || 100) / 100); const meta = await sharp(item.source).metadata(); await sharp(item.source).rotate().resize(Math.max(1, Math.round((meta.width || 1) * scale)), Math.max(1, Math.round((meta.height || 1) * scale))).jpeg({ quality }).toFile(output); const stat = fs.statSync(output); return { file: output, size: stat.size, kind: 'image' }; }
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', item.source])); const isVideo = (probe.streams || []).some(stream => stream.codec_type === 'video'); const audioFormat = item.audioFormat === 'opus' ? 'opus' : 'mp3'; const output = path.join(item.folder, availableFilename(item.folder, `${base} comprimido.${isVideo ? 'mp4' : audioFormat}`, item.duplicate)); const args = ['-hide_banner', '-y', '-i', item.source];
    if (isVideo) { if (item.resolution && item.resolution !== 'original') args.push('-vf', `scale=-2:${Number(item.resolution)}`); if (item.fps) args.push('-r', String(Math.max(1, Number(item.fps)))); args.push('-c:v', 'libx264', '-crf', String(Math.max(0, Number(item.crf) || 30)), '-preset', 'veryfast', '-c:a', 'aac', '-b:a', `${Math.max(8, Number(item.audioBitrate) || 64)}k`); } else { args.push('-ac', item.mono ? '1' : '2', '-ar', String(Math.max(8000, Number(item.sampleRate) || 22050)), '-c:a', audioFormat === 'opus' ? 'libopus' : 'libmp3lame', '-b:a', `${Math.max(8, Number(item.audioBitrate) || 64)}k`); }
    args.push(output); await run('ffmpeg', args); const stat = fs.statSync(output); return { file: output, size: stat.size, kind: isVideo ? 'video' : 'audio' };
  });
  ipcMain.handle('screen-sources', async () => (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })).map(source => ({ id: source.id, name: source.name })));
  ipcMain.handle('screen-recording-start', async (_event, options) => {
    if (!options?.folder) throw new Error('Escolha uma pasta para salvar a gravação.');
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`; const temp = path.join(app.getPath('temp'), `ntc-recording-${id}.webm`); const output = path.join(options.folder, recordingOutputName(options.folder));
    const stream = fs.createWriteStream(temp); recordingSessions.set(id, { id, temp, output, folder: options.folder, withAudio: Boolean(options.withAudio), quality: options.quality || 'equilibrada', resolution: options.resolution || 'original', stream }); return { id };
  });
  ipcMain.handle('screen-recording-chunk', (_event, id, chunk) => { const session = recordingSessions.get(id); if (!session || !chunk) throw new Error('Gravação não encontrada.'); return session.stream.write(Buffer.from(chunk)); });
  ipcMain.handle('screen-recording-stop', async (_event, id) => { const session = recordingSessions.get(id); if (!session) throw new Error('Gravação não encontrada.'); recordingSessions.delete(id); try { return await finalizeScreenRecording(session); } catch (error) { if (fs.existsSync(session.temp)) fs.unlinkSync(session.temp); throw new Error(`Não foi possível finalizar a gravação: ${error.message}`); } });
  ipcMain.handle('screen-recording-cancel', (_event, id) => { const session = recordingSessions.get(id); if (!session) return false; recordingSessions.delete(id); session.stream.destroy(); if (fs.existsSync(session.temp)) fs.unlinkSync(session.temp); return true; });
  ipcMain.handle('register-screen-shortcut', (_event, accelerator) => { const value = String(accelerator || '').trim(); if (!value) return { ok: false, message: 'Escolha uma tecla para o atalho.' }; if (screenShortcut) globalShortcut.unregister(screenShortcut); try { const ok = globalShortcut.register(value, () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('screen-hotkey'); }); if (!ok) return { ok: false, message: 'Esta tecla já está sendo usada pelo sistema.' }; screenShortcut = value; return { ok: true, accelerator: value }; } catch { return { ok: false, message: 'Essa tecla não pode ser usada como atalho global.' }; } });
  ipcMain.handle('unregister-screen-shortcut', () => { if (screenShortcut) globalShortcut.unregister(screenShortcut); screenShortcut = null; return true; });
  configureUpdater(); createWindow(); if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 2500); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
