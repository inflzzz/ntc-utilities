// Isolated Electron smoke test for the audio editor. It does not run main.cjs.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(os.tmpdir(), 'ntc-ui-audio-audit');
app.setPath('userData', path.join(os.tmpdir(), `ntc-audio-audit-${process.pid}`));
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /\.m?js(?:\?|$)/i.test(details.url) }));
  await fs.mkdir(output, { recursive: true });
  const window = new BrowserWindow({ show: false, width: 1366, height: 768, webPreferences: { sandbox: true, contextIsolation: true } });
  window.webContents.on('console-message', (_, level, message) => console.log(`renderer(${level}): ${message}`));
  await window.loadFile(path.join(root, 'src', 'index.html'));
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('.app-shell').classList.add('ready');
    document.querySelector('.splash').classList.add('hidden');
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === 'converterView'));
    window.__audit = { rendered: null, renders: [], saved: null, toasts: [], players: [], audioNodes: [] };
    window.prompt = () => 'Preset de teste';
    window.AudioContext = class {
      constructor() { this.destination = {}; this.state = 'running'; }
      createMediaElementSource() { return { connect(target) { return target; } }; }
      createBiquadFilter() { const node = { frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect(target) { return target; } }; window.__audit.audioNodes.push(node); return node; }
      createGain() { const node = { gain: { value: 0 }, connect(target) { return target; } }; window.__audit.audioNodes.push(node); return node; }
      resume() { return Promise.resolve(); }
    };
    window.Audio = class {
      constructor() { this.dataset = {}; this.paused = true; this.currentTime = 0; window.__audit.players.push(this); }
      load() {}
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
      removeAttribute() {}
    };
    const names = ['Bateria longa com nome de arquivo que precisa ser reduzido.wav', 'Baixo.wav', 'Guitarra.wav', 'Teclado.wav', 'Vocal.wav', 'Backing vocal.wav'];
    window.ntc = {
      defaultDownloadFolder: async () => 'C:/Saida',
      chooseMediaProjectAudio: async () => names.map((name, index) => 'C:/Stems/' + index + '-' + name),
      inspectMedia: async input => ({ path: input, name: input.split('/').pop(), duration: 30 }),
      getWaveform: async () => Array.from({ length: 300 }, (_, index) => Math.abs(Math.sin(index * .1)) * .8),
      onMediaProjectEvent: () => {},
      chooseDownloadFolder: async () => null,
      saveMediaProject: async value => (window.__audit.saved = structuredClone(value), { name: value.name }),
      openMediaProject: async () => window.__audit.saved,
      chooseCoverFile: async () => null,
      startMediaProjectRender: async item => { window.__audit.rendered = structuredClone(item); window.__audit.renders.push(structuredClone(item)); return { filename: 'Mix NTC.wav', file: 'C:/Saida/Mix NTC.wav', size: 128 }; },
      cancelMediaProjectRender: async () => {},
      openFileFolder: async () => ''
    };
    let nextId = 0;
    window.NTCMediaAppBridge = {
      toolId: () => 'audit-' + ++nextId,
      safeText: value => String(value ?? '').replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' })[char]),
      getFolder: () => 'C:/Saida', setFolder: () => {},
      showToast: value => window.__audit.toasts.push(value),
      cleanError: error => String(error?.message || error),
      addHistory: () => {}, formatBytes: value => String(value)
    };
  })()`);
  for (const name of ['audio-editor-features.js', 'media-project.js', 'media-project-playback-clock.js', 'media-project-ui.js']) {
    console.log(`loading ${name}`);
    await window.webContents.executeJavaScript(await fs.readFile(path.join(root, 'src', name), 'utf8'));
  }
  const before = await window.webContents.executeJavaScript(`({ playDisabled: document.getElementById('audioProjectPlay').disabled, exportDisabled: document.getElementById('audioProjectExport').disabled })`);
  await window.webContents.executeJavaScript(`document.getElementById('audioProjectAddTracks').click()`);
  await new Promise(resolve => setTimeout(resolve, 600));
  const after = await window.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('#audioProjectTimeline .media-project-track-row')];
    document.querySelector('#audioProjectTimeline [data-project-mute]').click();
    return { rows: rows.length, clips: document.querySelectorAll('#audioProjectTimeline [data-project-clip]').length,
      longNameTooltip: rows[0]?.querySelector('strong')?.title,
      muted: document.querySelector('#audioProjectTimeline .media-project-track-row')?.classList.contains('is-muted'),
      playDisabled: document.getElementById('audioProjectPlay').disabled,
      exportDisabled: document.getElementById('audioProjectExport').disabled,
      scrollWidth: document.querySelector('.content-scroll').scrollWidth,
      clientWidth: document.querySelector('.content-scroll').clientWidth };
  })()`);
  const editing = await window.webContents.executeJavaScript(`(() => {
    const clip = document.querySelector('#audioProjectTimeline [data-project-clip]');
    const origin = clip.getBoundingClientRect();
    clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: origin.left + 40 }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: origin.left + 120 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return { clipLeft: document.querySelector('#audioProjectTimeline [data-project-clip]').style.left };
  })()`);
  const features = await window.webContents.executeJavaScript(`(() => {
    const seek = document.getElementById('audioProjectSeek'); seek.value = '4000'; seek.dispatchEvent(new Event('input', { bubbles: true }));
    const gain = document.getElementById('audioProjectGain'); gain.value = '4'; gain.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('audioProjectSavePreset').click();
    document.getElementById('audioProjectFormat').value = 'flac'; document.getElementById('audioProjectFormat').dispatchEvent(new Event('change', { bubbles: true }));
    const flacCoverEnabled = !document.getElementById('audioProjectChooseCover').disabled;
    document.getElementById('audioProjectFormat').value = 'wav'; document.getElementById('audioProjectFormat').dispatchEvent(new Event('change', { bubbles: true }));
    const wavCoverDisabled = document.getElementById('audioProjectChooseCover').disabled;
    document.getElementById('audioProjectFormat').value = 'flac'; document.getElementById('audioProjectFormat').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('audioProjectMetadataTitle').value = 'Mix de teste'; document.getElementById('audioProjectMetadataTitle').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('audioProjectMarkerStart').value = '1'; document.getElementById('audioProjectMarkerEnd').value = '5'; document.getElementById('audioProjectAddMarker').click();
    const markerCount = document.querySelectorAll('.audio-project-marker-row').length;
    document.getElementById('audioProjectUndo').click();
    const undoMarkerCount = document.querySelectorAll('.audio-project-marker-row').length;
    document.getElementById('audioProjectRedo').click();
    return { selectedClip: !document.getElementById('audioProjectClipEffects').hidden, preset: [...document.getElementById('audioProjectPreset').options].some(option => option.value === 'saved:Preset de teste'), qualityHidden: getComputedStyle(document.getElementById('audioProjectQualityWrap')).display === 'none', flacCoverEnabled, wavCoverDisabled, markerCount, undoMarkerCount, redoMarkerCount: document.querySelectorAll('.audio-project-marker-row').length, markerVisual: document.querySelectorAll('.audio-project-ruler-range').length, previewGain: window.__audit.audioNodes[3]?.gain.value };
  })()`);
  await window.webContents.executeJavaScript(`document.getElementById('audioProjectSave').click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const savedClipPositionMs = await window.webContents.executeJavaScript('window.__audit.saved?.tracks?.[0]?.clips?.[0]?.positionMs');
  const savedFeatures = await window.webContents.executeJavaScript(`({ format: window.__audit.saved?.output?.format, title: window.__audit.saved?.output?.metadata?.title, gain: window.__audit.saved?.tracks?.[0]?.clips?.[0]?.effects?.gain, markers: window.__audit.saved?.markers?.length })`);
  await window.webContents.executeJavaScript(`document.getElementById('audioProjectOpen').click()`);
  await new Promise(resolve => setTimeout(resolve, 150));
  const reopenedRows = await window.webContents.executeJavaScript(`document.querySelectorAll('#audioProjectTimeline .media-project-track-row').length`);
  await window.webContents.executeJavaScript(`document.getElementById('audioProjectExport').click()`);
  await new Promise(resolve => setTimeout(resolve, 250));
  const completion = await window.webContents.executeJavaScript(`({ renderTracks: window.__audit.rendered?.project?.tracks?.length,
    status: document.getElementById('audioProjectStatus').textContent,
    cancelHidden: document.getElementById('audioProjectCancel').hidden,
    openFolderVisible: !document.getElementById('audioProjectOpenFolder').hidden,
    savedTracks: window.__audit.saved?.tracks?.length,
    toasts: window.__audit.toasts })`);
  await window.webContents.executeJavaScript(`document.getElementById('audioProjectExportMarkers').click()`);
  await new Promise(resolve => setTimeout(resolve, 200));
  const markerRender = await window.webContents.executeJavaScript(`window.__audit.renders.at(-1)?.range`);
  await window.webContents.executeJavaScript(`document.getElementById('audioProjectExportTracks').click()`);
  await new Promise(resolve => setTimeout(resolve, 250));
  const trackRenders = await window.webContents.executeJavaScript(`window.__audit.renders.slice(-6).map(render => render.trackId)`);
  const scroll = await window.webContents.executeJavaScript(`(() => { const area = document.querySelector('.content-scroll'); area.scrollTop = area.scrollHeight; const button = document.getElementById('audioProjectExport').getBoundingClientRect(); const result = { scrollTop: area.scrollTop, maxScroll: area.scrollHeight - area.clientHeight, exportVisible: button.top >= 0 && button.bottom <= innerHeight }; area.scrollTop = 0; return result; })()`);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(output, 'audio-six-tracks.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`(() => {
    window.ntc.chooseMediaProjectAudio = async () => ['C:/Stems/0-Bateria longa com nome de arquivo que precisa ser reduzido.wav'];
    document.getElementById('audioProjectAddTracks').click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 150));
  await window.webContents.executeJavaScript(`document.getElementById('audioProjectPlay').click()`);
  const duplicateSourcePlayback = await window.webContents.executeJavaScript(`(() => { const players = window.__audit.players; const source = 'C:/Stems/0-Bateria longa com nome de arquivo que precisa ser reduzido.wav'; const result = { rows: document.querySelectorAll('#audioProjectTimeline .media-project-track-row').length, players: players.length, sameSourcePlayers: players.filter(player => player.dataset.projectSource === source).length }; document.getElementById('audioProjectStop').click(); return result; })()`);
  const report = { before, after, features, savedFeatures, markerRender, trackRenders, editing: { ...editing, savedClipPositionMs, reopenedRows }, completion, scroll, duplicateSourcePlayback };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.equal(before.playDisabled, true);
  assert.equal(before.exportDisabled, true);
  assert.equal(after.rows, 6);
  assert.equal(after.clips, 6);
  assert.match(after.longNameTooltip, /Bateria longa/);
  assert.equal(after.muted, true);
  assert.equal(after.playDisabled, false);
  assert.equal(after.exportDisabled, false);
  assert.equal(after.scrollWidth, after.clientWidth);
  assert.ok(savedClipPositionMs > 0);
  assert.equal(reopenedRows, 6);
  assert.equal(features.selectedClip, true);
  assert.equal(features.preset, true);
  assert.equal(features.qualityHidden, true);
  assert.equal(features.flacCoverEnabled, true);
  assert.equal(features.wavCoverDisabled, true);
  assert.equal(features.markerCount, 1);
  assert.equal(features.undoMarkerCount, 0);
  assert.equal(features.redoMarkerCount, 1);
  assert.equal(features.markerVisual, 1);
  assert.ok(features.previewGain > 1.5, 'gain reaches the WebAudio preview graph');
  assert.deepEqual(savedFeatures, { format: 'flac', title: 'Mix de teste', gain: 4, markers: 1 });
  assert.deepEqual(markerRender, { startMs: 1000, endMs: 5000 });
  assert.equal(trackRenders.length, 6);
  assert.equal(new Set(trackRenders).size, 6);
  assert.equal(completion.renderTracks, 6);
  assert.equal(completion.status, 'CONCLUÍDO');
  assert.equal(completion.cancelHidden, true);
  assert.equal(completion.openFolderVisible, true);
  assert.equal(scroll.scrollTop, scroll.maxScroll);
  assert.equal(scroll.exportVisible, true);
  assert.deepEqual(duplicateSourcePlayback, { rows: 7, players: 7, sameSourcePlayers: 2 });
  await window.webContents.executeJavaScript(`(() => {
    window.__audit.cancelAttempts = 0;
    window.ntc.startMediaProjectRender = async () => { window.__audit.cancelAttempts++; return new Promise((_, reject) => { window.__audit.rejectRender = reject; }); };
    window.ntc.cancelMediaProjectRender = async () => window.__audit.rejectRender?.(new Error('Exportação cancelada.'));
    document.getElementById('audioProjectExportTracks').click();
  })()`);
  await new Promise(resolve => setTimeout(resolve, 50));
  await window.webContents.executeJavaScript(`document.getElementById('audioProjectCancel').click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  const cancellation = await window.webContents.executeJavaScript(`({ attempts: window.__audit.cancelAttempts, status: document.getElementById('audioProjectStatus').textContent, cancelHidden: document.getElementById('audioProjectCancel').hidden })`);
  assert.deepEqual(cancellation, { attempts: 1, status: 'CANCELADO', cancelHidden: true });
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
