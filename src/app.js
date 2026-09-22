const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const splash = $('#splash'); const appShell = $('#appShell'); const loadingProgress = $('#loadingProgress'); const loadingTrack = $('.loading-line');
const history = JSON.parse(localStorage.getItem('ntc-history') || '[]');
let folder = localStorage.getItem('ntc-folder') || '';
let queue = []; let current = null; let preview = null; let playlist = null; let previewTimer; const abortedDownloads = new Set();
let conversionQueue = []; let currentConversion = null; let editingConversionId = null; const abortedConversions = new Set();
let waveformData = []; let waveformFor = null; let waveformHandle = null; let previewAudio = null; let playbackTime = null; let playbackFrame = null;
let downloadedAudioToEdit = null; let editSuggestionTimer = null;

let splashValue = 0;
const advanceSplash = () => { splashValue = Math.min(92, splashValue + (splashValue < 70 ? 4 : 1.5)); loadingProgress.style.width = `${splashValue}%`; loadingTrack.setAttribute('aria-valuenow', String(Math.round(splashValue))); };
const splashTimer = setInterval(advanceSplash, 110);
setTimeout(() => { clearInterval(splashTimer); splashValue = 100; loadingProgress.style.width = '100%'; loadingTrack.setAttribute('aria-valuenow', '100'); setTimeout(() => { splash.classList.add('exit'); appShell.classList.add('ready'); appShell.setAttribute('aria-hidden', 'false'); }, 260); }, 2100);
function formatBytes(bytes) { if (!bytes) return '—'; const units = ['B', 'KB', 'MB', 'GB']; let n = bytes; let i = 0; while (n > 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; }
function safeText(value) { return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function cleanError(value) { return String(value?.message || value || 'Não foi possível concluir a operação.').replace(/^Error invoking remote method ['"]?[^'"]+['"]?: Error:\s*/i, '').replace(/^Error:\s*/i, ''); }
function syncSettings() { $('#folderPath').textContent = folder || 'Downloads'; $('#settingsFolder').textContent = folder || 'Downloads'; if (!editingConversionId) $('#converterFolderPath').textContent = folder || 'Downloads'; $('#openFolderAfter').checked = localStorage.getItem('ntc-open-folder') === 'true'; $('#duplicatePolicy').value = localStorage.getItem('ntc-duplicate') || 'rename'; }
function addHistory(item) { history.unshift(item); history.splice(50); localStorage.setItem('ntc-history', JSON.stringify(history)); renderHistory(); }
function showEditAfterDownload(file, title) { downloadedAudioToEdit = { file, title }; $('#downloadedAudioName').textContent = title || 'Download concluído.'; $('#editAfterDownloadModal').classList.remove('hidden'); clearTimeout(editSuggestionTimer); editSuggestionTimer = setTimeout(hideEditAfterDownload, 8000); }
function hideEditAfterDownload() { clearTimeout(editSuggestionTimer); editSuggestionTimer = null; downloadedAudioToEdit = null; $('#editAfterDownloadModal').classList.add('hidden'); }

function renderHistory() {
  const list = $('#historyList'); const empty = $('#emptyHistory'); const all = $('#allHistory');
  if (!history.length) { list.classList.add('hidden'); empty.classList.remove('hidden'); all.innerHTML = '<div class="empty-state"><div class="empty-icon">◷</div><p>Nenhum arquivo concluído ainda.</p></div>'; return; }
  const markup = history.map((item, index) => `<article class="history-item"><div class="history-icon">${item.type === 'video' ? '▸' : '♫'}</div><div class="history-copy"><strong>${safeText(item.title)}</strong><span>${safeText(item.format.toUpperCase())} · ${safeText(item.quality || 'original')} · ${safeText(item.size)} · ${safeText(item.time)}</span></div><button class="ghost-button" data-open="${index}">Abrir</button><button class="ghost-button" data-copy="${index}">Copiar</button><button class="ghost-button" data-remove="${index}">×</button></article>`).join('');
  list.innerHTML = markup; list.classList.remove('hidden'); empty.classList.add('hidden'); all.innerHTML = markup;
  $$('[data-open]').forEach(button => button.onclick = () => window.ntc.openFile(history[button.dataset.open].file));
  $$('[data-copy]').forEach(button => button.onclick = () => window.ntc.copyPath(history[button.dataset.copy].file));
  $$('[data-remove]').forEach(button => button.onclick = () => { history.splice(Number(button.dataset.remove), 1); localStorage.setItem('ntc-history', JSON.stringify(history)); renderHistory(); });
}

function renderQueue() {
  $('#queueCount').textContent = `${queue.length} ${queue.length === 1 ? 'item' : 'itens'}`; $('#abortQueue').disabled = !queue.length && !current;
  if (!queue.length) { $('#queueList').innerHTML = '<div class="empty-state"><p>Adicione links à fila para baixá-los em sequência.</p></div>'; return; }
  $('#queueList').innerHTML = queue.map((item, index) => `<article class="queue-item"><span class="queue-index">${index + 1}</span><div class="history-copy"><strong>${safeText(item.title || item.url)}</strong><span>${item.type === 'audio' ? 'Áudio' : 'Vídeo'} · ${item.format.toUpperCase()} · ${safeText(item.quality)} · ${safeText(item.status)}</span></div>${index ? `<button class="ghost-button" data-up="${item.downloadId}">↑</button>` : ''}${index < queue.length - 1 ? `<button class="ghost-button" data-down="${item.downloadId}">↓</button>` : ''}${item.status === 'erro' ? `<button class="ghost-button" data-retry="${item.downloadId}">Tentar</button>` : ''}<button class="ghost-button" data-queue-remove="${item.downloadId}">×</button></article>`).join('');
  $$('[data-queue-remove]').forEach(button => button.onclick = () => { if (current?.downloadId === button.dataset.queueRemove) return; queue = queue.filter(item => item.downloadId !== button.dataset.queueRemove); renderQueue(); });
  $$('[data-up],[data-down]').forEach(button => button.onclick = () => { const index = queue.findIndex(item => item.downloadId === (button.dataset.up || button.dataset.down)); const next = button.dataset.up ? index - 1 : index + 1; if (next >= 0 && next < queue.length) [queue[index], queue[next]] = [queue[next], queue[index]]; renderQueue(); });
  $$('[data-retry]').forEach(button => button.onclick = () => { const item = queue.find(entry => entry.downloadId === button.dataset.retry); if (item) { item.status = 'aguardando'; startNext(); renderQueue(); } });
}
function setFormatOptions() {
  const video = $('input[name="downloadType"]:checked').value === 'video';
  $('#format').innerHTML = video ? '<option value="mp4">MP4</option><option value="webm">WEBM</option>' : '<option value="mp3">MP3</option><option value="m4a">M4A</option><option value="opus">Opus</option>';
  $('#quality').innerHTML = video ? '<option value="best">Melhor disponível</option><option value="2160">2160p</option><option value="1440">1440p</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option><option value="360">360p</option><option value="240">240p</option><option value="144">144p</option>' : '<option value="original">Original</option><option value="128">128 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option>';
}
async function chooseFolder() { const chosen = await window.ntc.chooseDownloadFolder(); if (chosen) { folder = chosen; localStorage.setItem('ntc-folder', folder); syncSettings(); } }
async function loadPreview() {
  const url = $('#videoUrl').value.trim();
  if (!url) { preview = null; playlist = null; $('#previewCard').classList.add('hidden'); $('#selectPlaylist').classList.add('hidden'); return; }
  $('#previewCard').classList.remove('hidden'); $('#previewTitle').textContent = 'Carregando prévia…'; $('#previewMeta').textContent = 'Consultando informações';
  try { preview = await window.ntc.previewUrl(url); playlist = await window.ntc.playlistPreview(url); if (!playlist.isPlaylist) playlist = null; $('#previewImage').src = playlist?.thumbnail || preview.thumbnail; $('#previewTitle').textContent = playlist?.title || preview.title; $('#previewMeta').textContent = playlist ? `${playlist.entries.length} músicas na playlist` : `${preview.channel} · ${preview.duration}`; $('#selectPlaylist').classList.toggle('hidden', !playlist); $('.url-input-wrap').classList.add('valid'); }
  catch (error) { preview = null; playlist = null; $('#selectPlaylist').classList.add('hidden'); $('#previewTitle').textContent = 'Link indisponível'; $('#previewMeta').textContent = error.message; $('.url-input-wrap').classList.remove('valid'); }
}
function safeBase(value) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').slice(0, 150) || 'download'; }
function newJob(source = preview) { if (!source) return null; const format = $('#format').value; return { downloadId: `${Date.now()}-${Math.random().toString(16).slice(2)}`, url: source.webpageUrl || $('#videoUrl').value.trim(), title: source.title, filename: `${safeBase(source.title)}.${format}`, type: $('input[name="downloadType"]:checked').value, format, quality: $('#quality').value, folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'aguardando' }; }
function enqueueSources(sources) { let added = 0; sources.forEach(source => { const item = newJob(source); if (item && !queue.some(existing => existing.url === item.url)) { queue.push(item); added++; } }); if (added) { renderQueue(); startNext(); } return added; }
async function addToQueue() { if (!preview) await loadPreview(); if (!preview) return; const sources = playlist ? playlist.entries : [preview]; const added = enqueueSources(sources); if (!added) { $('#previewMeta').textContent = 'Estes links já estão na fila.'; return; } $('#videoUrl').value = ''; preview = null; playlist = null; $('#previewCard').classList.add('hidden'); $('#selectPlaylist').classList.add('hidden'); }
function setProgress(update) { $('#progressBar').style.width = `${update.percent || 0}%`; $('#progressPercent').textContent = `${Math.round(update.percent || 0)}%`; $('#downloadSpeed').textContent = update.speed || '—'; $('#timeRemaining').textContent = update.eta || '—'; }
async function startNext() {
  if (current) return; const item = queue.find(entry => entry.status === 'aguardando'); if (!item) return;
  current = item; item.status = 'baixando'; $('#progressCard').classList.remove('hidden'); $('#statusPill').textContent = 'BAIXANDO'; $('#mediaTitle').textContent = item.title; $('#mediaMeta').textContent = `${item.type === 'audio' ? 'Áudio' : 'Vídeo'} · ${item.format.toUpperCase()} · ${item.quality}`; $('#cancelButton').onclick = () => window.ntc.cancelDownload(item.downloadId); $('#downloadButton').disabled = true; renderQueue();
  try { await window.ntc.startDownload(item); } catch (error) { const message = cleanError(error); item.status = message.includes('cancelado') ? 'cancelado' : 'erro'; const wasAborted = abortedDownloads.delete(item.downloadId); current = null; $('#downloadButton').disabled = false; $('#statusPill').textContent = wasAborted ? 'INTERROMPIDO' : item.status.toUpperCase(); $('#mediaMeta').textContent = wasAborted ? 'Downloads interrompidos pelo usuário.' : message; renderQueue(); setTimeout(startNext, 0); }
}
window.ntc.onDownloadEvent(update => {
  if (!current || current.downloadId !== update.downloadId || abortedDownloads.has(update.downloadId)) return;
  if (update.status === 'downloading') { current.title = update.title || current.title; $('#mediaTitle').textContent = current.title; setProgress(update); }
  if (update.status === 'complete') { const completed = current; completed.status = 'concluído'; completed.file = update.file; completed.size = formatBytes(update.size); addHistory({ title: completed.title, type: completed.type, format: completed.format, quality: completed.quality, size: completed.size, file: completed.file, time: 'Agora' }); queue = queue.filter(item => item.downloadId !== completed.downloadId); current = null; $('#statusPill').textContent = 'CONCLUÍDO'; $('#mediaTitle').textContent = 'Download concluído'; $('#mediaMeta').textContent = `Salvo em ${folder}`; $('#downloadButton').disabled = false; renderQueue(); if (completed.type === 'audio') showEditAfterDownload(completed.file, completed.title); if ($('#openFolderAfter').checked) window.ntc.openFolder(folder); setTimeout(startNext, 0); }
});

function conversionQualityOptions(format, selected = '192') {
  const lossless = ['wav', 'flac'].includes(format); const select = $('#converterQuality');
  select.disabled = lossless; select.innerHTML = lossless ? '<option value="lossless">Sem perdas</option>' : '<option value="128">128 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option>';
  select.value = lossless ? 'lossless' : (['128', '192', '256', '320'].includes(String(selected)) ? String(selected) : '192');
}
function updateConverterExtension(format = $('#converterFormat').value) { $('#converterExtension').textContent = `.${format}`; }
function newConversion(info) {
  return { conversionId: `${Date.now()}-${Math.random().toString(16).slice(2)}`, source: info.path, sourceName: info.name, sourceType: info.type, duration: info.duration, durationLabel: info.durationLabel, coverStreamIndex: info.coverStreamIndex, outputName: safeBase(info.baseName), format: 'mp3', quality: '192', folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', trimStart: '', trimEnd: '', normalize: false, metadata: info.metadata || {}, cover: null, status: 'pronto' };
}
function currentEditingConversion() { return conversionQueue.find(item => item.conversionId === editingConversionId); }
function readEditorTime(value, fallback) {
  const text = String(value || '').trim(); if (!text) return fallback;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':').map(Number); if (!parts.length || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return fallback;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
function formatEditorTime(seconds) { const total = Math.max(0, Math.round(seconds)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const secs = total % 60; return [hours, minutes, secs].map(value => String(value).padStart(2, '0')).join(':'); }
function waveformBounds(item = currentEditingConversion()) {
  const duration = Number(item?.duration || 0); let start = readEditorTime($('#trimStart').value, 0); let end = readEditorTime($('#trimEnd').value, duration);
  start = Math.max(0, Math.min(start, duration)); end = Math.max(start, Math.min(end, duration)); return [start, end, duration];
}
function paintWaveform() {
  const item = currentEditingConversion(); const canvas = $('#waveformCanvas'); if (!item || !canvas) return;
  const rect = canvas.getBoundingClientRect(); const scale = window.devicePixelRatio || 1; const width = Math.max(1, Math.round(rect.width * scale)); const height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d'); const [start, end, duration] = waveformBounds(item); const startX = duration ? start / duration * width : 0; const endX = duration ? end / duration * width : width;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#242424'; ctx.fillRect(startX, 0, Math.max(0, endX - startX), height);
  const values = waveformData.length ? waveformData : Array.from({ length: 110 }, () => .025); const middle = height / 2; const barWidth = width / values.length;
  ctx.fillStyle = '#a8a8a8'; values.forEach((value, index) => { const x = index * barWidth; const amplitude = Math.max(2 * scale, value * height * .42); ctx.fillRect(x, middle - amplitude, Math.max(scale, barWidth - scale), amplitude * 2); });
  ctx.fillStyle = '#f0f0f0'; [startX, endX].forEach(x => { ctx.fillRect(Math.round(x - scale), 0, scale * 2, height); ctx.beginPath(); ctx.moveTo(x - 6 * scale, 0); ctx.lineTo(x + 6 * scale, 0); ctx.lineTo(x, 8 * scale); ctx.closePath(); ctx.fill(); });
  if (playbackTime !== null && duration) { const playX = Math.max(0, Math.min(width, playbackTime / duration * width)); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(playX - scale), 0, scale * 2, height); ctx.beginPath(); ctx.moveTo(playX - 6 * scale, height); ctx.lineTo(playX + 6 * scale, height); ctx.lineTo(playX, height - 8 * scale); ctx.closePath(); ctx.fill(); }
  $('#waveformDuration').textContent = duration ? formatEditorTime(duration) : '—'; $('#waveformSelection').textContent = duration && (start > 0 || end < duration) ? `${formatEditorTime(start)} — ${formatEditorTime(end)}` : 'Arquivo completo';
}
async function loadWaveform(item) {
  waveformFor = item.conversionId; waveformData = []; paintWaveform();
  try { const values = await window.ntc.getWaveform(item.source); if (waveformFor === item.conversionId) { waveformData = values; paintWaveform(); } }
  catch { if (waveformFor === item.conversionId) { waveformData = []; paintWaveform(); } }
}
function moveWaveformHandle(event) {
  const item = currentEditingConversion(); const canvas = $('#waveformCanvas'); if (!item || !canvas || !item.duration) return;
  const rect = canvas.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); const [start, end, duration] = waveformBounds(item); const point = ratio * duration; const topHandleArea = event.clientY - rect.top < 20;
  if (!waveformHandle) {
    const nearPlayback = playbackTime !== null && Math.abs(point - playbackTime) < duration * .035;
    waveformHandle = nearPlayback && !topHandleArea ? 'playback' : (Math.abs(point - start) <= Math.abs(point - end) ? 'start' : 'end');
  }
  if (waveformHandle === 'playback') { playbackTime = Math.max(start, Math.min(point, end)); if (previewAudio) previewAudio.currentTime = playbackTime; }
  if (waveformHandle === 'start') $('#trimStart').value = formatEditorTime(Math.min(point, Math.max(0, end - .1)));
  else if (waveformHandle === 'end') $('#trimEnd').value = formatEditorTime(Math.max(point, Math.min(duration, start + .1)));
  paintWaveform();
}
function sourceUrl(file) { return `file:///${file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`; }
function updatePreviewButton() { $('#playSelection').textContent = previewAudio && !previewAudio.paused ? 'Ⅱ Pausar' : '▶ Ouvir seleção'; }
function stopPreview(keepCursor = false) { if (playbackFrame) cancelAnimationFrame(playbackFrame); playbackFrame = null; if (previewAudio) previewAudio.pause(); previewAudio = null; if (!keepCursor) playbackTime = null; updatePreviewButton(); paintWaveform(); }
function animatePlayback(item) {
  if (!previewAudio || previewAudio.paused) return; const [, end] = waveformBounds(item); playbackTime = previewAudio.currentTime;
  if (playbackTime >= end) { previewAudio.pause(); playbackTime = end; updatePreviewButton(); paintWaveform(); return; }
  paintWaveform(); playbackFrame = requestAnimationFrame(() => animatePlayback(item));
}
function playSelectedRange() {
  const item = currentEditingConversion(); if (!item) return; const [start, end] = waveformBounds(item);
  if (previewAudio && !previewAudio.paused) { if (playbackFrame) cancelAnimationFrame(playbackFrame); previewAudio.pause(); previewAudio.currentTime = start; playbackTime = start; updatePreviewButton(); paintWaveform(); return; }
  const sameFile = previewAudio?.dataset.ntcSource === item.source;
  if (!sameFile) { if (previewAudio) previewAudio.pause(); previewAudio = new Audio(sourceUrl(item.source)); previewAudio.dataset.ntcSource = item.source; }
  if (!previewAudio || !Number.isFinite(end) || end <= start) return;
  const begin = () => { if (previewAudio.currentTime < start || previewAudio.currentTime >= end || !sameFile) previewAudio.currentTime = start; playbackTime = previewAudio.currentTime; previewAudio.play().then(() => { updatePreviewButton(); if (playbackFrame) cancelAnimationFrame(playbackFrame); animatePlayback(item); }).catch(() => { $('#waveformSelection').textContent = 'Não foi possível reproduzir este arquivo.'; updatePreviewButton(); }); };
  if (previewAudio.readyState >= 1) begin(); else previewAudio.addEventListener('loadedmetadata', begin, { once: true });
}
function renderConversionQueue() {
  const readyItems = conversionQueue.length; $('#conversionQueueCount').textContent = `${readyItems} ${readyItems === 1 ? 'item' : 'itens'}`; $('#abortConversions').disabled = !currentConversion; $('#abortConversions').classList.toggle('hidden', !currentConversion); $('#startConversions').disabled = !conversionQueue.some(item => ['pronto', 'erro'].includes(item.status));
  if (!readyItems) { $('#conversionQueueList').innerHTML = '<div class="empty-state"><p>Selecione arquivos para preparar conversões.</p></div>'; return; }
  $('#conversionQueueList').innerHTML = conversionQueue.map((item, index) => `<article class="queue-item conversion-item ${item.conversionId === editingConversionId ? 'selected' : ''}" data-conversion-edit="${item.conversionId}"><span class="queue-index">${index + 1}</span><div class="history-copy"><strong>${safeText(item.sourceName)}</strong><span>${safeText(item.sourceType)} · ${item.format.toUpperCase()} · ${safeText(item.quality === 'lossless' ? 'sem perdas' : `${item.quality} kbps`)} · ${safeText(item.status)}</span></div>${item.status === 'erro' ? `<button class="ghost-button" data-conversion-retry="${item.conversionId}">Tentar</button>` : ''}${item.status !== 'convertendo' ? `<button class="ghost-button" data-conversion-remove="${item.conversionId}">×</button>` : ''}</article>`).join('');
  $$('[data-conversion-edit]').forEach(element => element.onclick = event => { if (event.target.closest('button')) return; selectConversion(element.dataset.conversionEdit); });
  $$('[data-conversion-remove]').forEach(button => button.onclick = () => { conversionQueue = conversionQueue.filter(item => item.conversionId !== button.dataset.conversionRemove); if (editingConversionId === button.dataset.conversionRemove) { editingConversionId = null; $('#converterEditor').classList.add('hidden'); } renderConversionQueue(); });
  $$('[data-conversion-retry]').forEach(button => button.onclick = () => { const item = conversionQueue.find(entry => entry.conversionId === button.dataset.conversionRetry); if (item) { item.status = 'pronto'; renderConversionQueue(); } });
}
function loadConversionEditor(item) {
  if (!item) return; stopPreview(); editingConversionId = item.conversionId; $('#converterEditor').classList.remove('hidden'); $('#editingMediaName').textContent = item.sourceName; $('#converterFormat').value = item.format; conversionQualityOptions(item.format, item.quality); updateConverterExtension(item.format); $('#converterOutputName').value = item.outputName; $('#trimStart').value = item.trimStart; $('#trimEnd').value = item.trimEnd; $('#normalizeAudio').checked = item.normalize; $('#metadataTitle').value = item.metadata?.title || ''; $('#metadataArtist').value = item.metadata?.artist || ''; $('#metadataAlbum').value = item.metadata?.album || ''; $('#metadataYear').value = item.metadata?.year || ''; $('#metadataGenre').value = item.metadata?.genre || ''; $('#coverName').textContent = item.cover ? item.cover.split(/[\\/]/).pop() : 'Sem alteração'; $('#converterFolderPath').textContent = item.folder || 'Downloads'; renderConversionQueue(); requestAnimationFrame(() => loadWaveform(item));
}
function selectConversion(id) { const item = conversionQueue.find(entry => entry.conversionId === id); if (item && item.status !== 'convertendo') loadConversionEditor(item); }
function saveConversionEdits() {
  const item = currentEditingConversion(); if (!item || item.status === 'convertendo') return;
  item.format = $('#converterFormat').value; item.quality = $('#converterQuality').value; item.outputName = $('#converterOutputName').value.trim() || safeBase(item.sourceName.replace(/\.[^.]+$/, '')); item.trimStart = $('#trimStart').value.trim(); item.trimEnd = $('#trimEnd').value.trim(); item.normalize = $('#normalizeAudio').checked; item.metadata = { title: $('#metadataTitle').value.trim(), artist: $('#metadataArtist').value.trim(), album: $('#metadataAlbum').value.trim(), year: $('#metadataYear').value.trim(), genre: $('#metadataGenre').value.trim() }; item.duplicate = localStorage.getItem('ntc-duplicate') || 'rename'; renderConversionQueue();
}
async function addMediaFiles(files) {
  const results = await Promise.allSettled(files.map(file => window.ntc.inspectMedia(file))); let first = null; let failures = 0;
  results.forEach(result => { if (result.status === 'fulfilled' && !conversionQueue.some(item => item.source === result.value.path)) { const item = newConversion(result.value); conversionQueue.push(item); first ||= item; } else if (result.status === 'rejected') failures++; });
  if (first) loadConversionEditor(first); renderConversionQueue(); if (failures && !first) $('#conversionQueueList').innerHTML = '<div class="empty-state"><p>Não foi possível ler os arquivos selecionados.</p></div>';
}
async function chooseConverterFolder() { const chosen = await window.ntc.chooseDownloadFolder(); const item = currentEditingConversion(); if (chosen && item) { folder = chosen; localStorage.setItem('ntc-folder', folder); item.folder = chosen; syncSettings(); $('#converterFolderPath').textContent = chosen; } }
async function chooseCover() { const item = currentEditingConversion(); if (!item) return; const cover = await window.ntc.chooseCoverFile(); if (cover) { item.cover = cover; $('#coverName').textContent = cover.split(/[\\/]/).pop(); } }
async function startNextConversion() {
  if (currentConversion) return; const item = conversionQueue.find(entry => entry.status === 'pronto'); if (!item) return;
  currentConversion = item; item.status = 'convertendo'; $('#conversionProgress').classList.remove('hidden'); $('#conversionStatus').textContent = 'CONVERTENDO'; $('#conversionTitle').textContent = item.sourceName; $('#conversionMeta').textContent = `${item.sourceType} → ${item.format.toUpperCase()} · ${item.quality === 'lossless' ? 'sem perdas' : `${item.quality} kbps`}`; $('#conversionPercent').textContent = '0%'; $('#conversionProgressBar').style.width = '0%'; $('#conversionEta').textContent = '—'; $('#cancelConversion').textContent = 'Cancelar'; $('#cancelConversion').onclick = () => window.ntc.cancelConversion(item.conversionId); renderConversionQueue();
  try { await window.ntc.startConversion(item); } catch (error) { const message = cleanError(error); item.status = message.includes('cancelada') ? 'cancelado' : 'erro'; const wasAborted = abortedConversions.delete(item.conversionId); currentConversion = null; $('#conversionStatus').textContent = wasAborted ? 'INTERROMPIDO' : item.status.toUpperCase(); $('#conversionMeta').textContent = wasAborted ? 'Conversões interrompidas pelo usuário.' : message; renderConversionQueue(); setTimeout(startNextConversion, 0); }
}
window.ntc.onConversionEvent(update => {
  if (!currentConversion || update.conversionId !== currentConversion.conversionId || abortedConversions.has(update.conversionId)) return;
  if (update.status === 'converting') { $('#conversionPercent').textContent = `${Math.round(update.percent || 0)}%`; $('#conversionProgressBar').style.width = `${update.percent || 0}%`; $('#conversionEta').textContent = update.eta || '—'; }
  if (update.status === 'complete') { const completed = currentConversion; addHistory({ title: completed.outputName, type: 'audio', format: completed.format, quality: completed.quality === 'lossless' ? 'sem perdas' : `${completed.quality} kbps`, size: formatBytes(update.size), file: update.file, time: 'Agora' }); conversionQueue = conversionQueue.filter(item => item.conversionId !== completed.conversionId); currentConversion = null; if (editingConversionId === completed.conversionId) { editingConversionId = null; $('#converterEditor').classList.add('hidden'); } $('#conversionStatus').textContent = 'CONCLUÍDO'; $('#conversionPercent').textContent = '100%'; $('#conversionProgressBar').style.width = '100%'; $('#conversionEta').textContent = '0s'; $('#conversionTitle').textContent = 'Conversão concluída'; $('#conversionMeta').textContent = `Salvo como ${update.filename}`; $('#cancelConversion').textContent = 'Abrir arquivo'; $('#cancelConversion').onclick = () => window.ntc.openFile(update.file); renderConversionQueue(); if ($('#openFolderAfter').checked) window.ntc.openFolder(completed.folder); setTimeout(startNextConversion, 0); }
});

function openPlaylistSelection() { if (!playlist) return; $('#playlistTitle').textContent = playlist.title; $('#playlistSummary').textContent = `${playlist.entries.length} músicas disponíveis`; $('#playlistList').innerHTML = playlist.entries.map((item, index) => `<label class="playlist-item"><input type="checkbox" data-playlist-entry="${index}" checked><span class="playlist-number">${index + 1}</span><img src="${item.thumbnail || ''}" alt=""><span><strong>${safeText(item.title)}</strong><small>${safeText(item.channel || 'YouTube')} · ${safeText(item.duration)}</small></span></label>`).join(''); $$('.nav-item').forEach(item => item.classList.remove('active')); $$('.view').forEach(view => view.classList.remove('active')); $('#playlistView').classList.add('active'); }
$('#selectPlaylist').onclick = openPlaylistSelection;
$('#abortQueue').onclick = () => { if (current) { abortedDownloads.add(current.downloadId); window.ntc.cancelDownload(current.downloadId); } queue = []; renderQueue(); $('#progressCard').classList.add('hidden'); };
$('#selectAllPlaylist').onclick = () => $$('[data-playlist-entry]').forEach(item => { item.checked = true; });
$('#clearPlaylistSelection').onclick = () => $$('[data-playlist-entry]').forEach(item => { item.checked = false; });
$('#addSelectedPlaylist').onclick = () => { if (!playlist) return; const chosen = $$('[data-playlist-entry]:checked').map(item => playlist.entries[Number(item.dataset.playlistEntry)]); enqueueSources(chosen); $('#videoUrl').value = ''; preview = null; playlist = null; $('#previewCard').classList.add('hidden'); $('#selectPlaylist').classList.add('hidden'); $$('.view').forEach(view => view.classList.remove('active')); $('#downloaderView').classList.add('active'); $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'downloader')); };
$('#videoUrl').addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(loadPreview, 650); });
$('#downloadForm').addEventListener('submit', event => { event.preventDefault(); addToQueue(); });
$$('input[name="downloadType"]').forEach(input => input.addEventListener('change', setFormatOptions));
$('#chooseFolder').onclick = chooseFolder; $('#chooseFolderSettings').onclick = chooseFolder;
$('#openFolderAfter').onchange = event => localStorage.setItem('ntc-open-folder', event.target.checked); $('#duplicatePolicy').onchange = event => localStorage.setItem('ntc-duplicate', event.target.value);
$('#clearHistory').onclick = () => { history.length = 0; localStorage.removeItem('ntc-history'); renderHistory(); };
$('#checkTools').onclick = async () => { const version = await window.ntc.toolVersions(); $('#toolVersions').textContent = version.error || `yt-dlp ${version.ytdlp} · FFmpeg instalado`; };
$$('.nav-item[data-view]').forEach(button => button.onclick = () => { $$('.nav-item').forEach(item => item.classList.remove('active')); button.classList.add('active'); $$('.view').forEach(view => view.classList.remove('active')); $(`#${button.dataset.view}View`).classList.add('active'); });
$$('[data-open-tool]').forEach(button => button.onclick = () => { const target = button.dataset.openTool; $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === target)); $$('.view').forEach(view => view.classList.toggle('active', view.id === `${target}View`)); });
$('#minimizeWindow').onclick = () => window.ntc.minimizeWindow(); $('#maximizeWindow').onclick = async () => { const maximized = await window.ntc.toggleMaximize(); $('#maximizeWindow').textContent = maximized ? '❐' : '□'; $('#maximizeWindow').setAttribute('aria-label', maximized ? 'Restaurar' : 'Maximizar'); }; $('#closeWindow').onclick = () => window.ntc.closeWindow();
$('#chooseMedia').onclick = async () => addMediaFiles(await window.ntc.chooseMediaFiles());
$('#mediaDropzone').onclick = async () => addMediaFiles(await window.ntc.chooseMediaFiles());
$('#mediaDropzone').onkeydown = async event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); addMediaFiles(await window.ntc.chooseMediaFiles()); } };
['dragenter', 'dragover'].forEach(name => $('#mediaDropzone').addEventListener(name, event => { event.preventDefault(); $('#mediaDropzone').classList.add('dragging'); }));
['dragleave', 'drop'].forEach(name => $('#mediaDropzone').addEventListener(name, event => { event.preventDefault(); $('#mediaDropzone').classList.remove('dragging'); }));
$('#mediaDropzone').addEventListener('drop', event => { const files = [...event.dataTransfer.files].map(file => file.path).filter(Boolean); if (files.length) addMediaFiles(files); });
$('#converterFormat').onchange = event => { conversionQualityOptions(event.target.value); updateConverterExtension(event.target.value); };
['trimStart', 'trimEnd'].forEach(id => $(`#${id}`).addEventListener('input', paintWaveform));
$('#waveformCanvas').addEventListener('pointerdown', event => { waveformHandle = null; $('#waveformCanvas').setPointerCapture(event.pointerId); moveWaveformHandle(event); });
$('#waveformCanvas').addEventListener('pointermove', event => { if (event.buttons) moveWaveformHandle(event); });
['pointerup', 'pointercancel'].forEach(name => $('#waveformCanvas').addEventListener(name, () => { waveformHandle = null; }));
$('#playSelection').onclick = playSelectedRange;
$('#saveConversionEdits').onclick = () => { saveConversionEdits(); startNextConversion(); }; $('#chooseConverterFolder').onclick = chooseConverterFolder; $('#chooseCover').onclick = chooseCover;
$('#removeCover').onclick = () => { const item = currentEditingConversion(); if (item) { item.cover = null; $('#coverName').textContent = 'Sem alteração'; } };
$('#startConversions').onclick = () => { saveConversionEdits(); startNextConversion(); };
$('#abortConversions').onclick = () => { if (currentConversion) { abortedConversions.add(currentConversion.conversionId); window.ntc.cancelConversion(currentConversion.conversionId); } conversionQueue = []; editingConversionId = null; $('#converterEditor').classList.add('hidden'); $('#conversionProgress').classList.add('hidden'); renderConversionQueue(); };
$('#dismissEditAfterDownload').onclick = hideEditAfterDownload;
$('#openDownloadedInEditor').onclick = async () => { const item = downloadedAudioToEdit; hideEditAfterDownload(); if (!item) return; await addMediaFiles([item.file]); $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === 'converter')); $$('.view').forEach(view => view.classList.toggle('active', view.id === 'converterView')); };
document.addEventListener('keydown', event => { const tag = event.target?.tagName; if (event.code !== 'Space' || !$('#converterView').classList.contains('active') || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return; event.preventDefault(); playSelectedRange(); });
syncSettings(); setFormatOptions(); conversionQualityOptions('mp3'); updateConverterExtension('mp3'); renderHistory(); renderQueue(); renderConversionQueue(); window.ntc.defaultDownloadFolder().then(value => { if (!folder) { folder = value; localStorage.setItem('ntc-folder', folder); syncSettings(); } });
