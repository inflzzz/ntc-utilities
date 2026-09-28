(() => {
  'use strict';

  const api = window.NTCMediaProject;
  const playbackClock = window.NTCMediaProjectPlaybackClock;
  const bridge = window.NTCMediaAppBridge;
  const audioFeatures = window.NTCAudioEditorFeatures;
  if (!api || !playbackClock || !bridge || !audioFeatures) return;
  const $ = selector => document.querySelector(selector);
  const byId = id => document.getElementById(id);
  const audioWaveforms = new Map();
  const videoWaveforms = new Map();
  const audioPlayers = new Map();
  const videoPlayers = new Map();
  const playerGainNodes = new WeakMap();
  let projectAudioContext = null;
  const playbacks = {
    audio: { positionMs: 0, playing: false, frame: 0, anchorPositionMs: 0, startedAtMs: null },
    video: { positionMs: 0, playing: false, frame: 0, anchorPositionMs: 0, startedAtMs: null },
  };
  let audioProject = api.createProject('audio', 'Novo projeto de áudio');
  let videoProject = api.createProject('video', 'Novo projeto de vídeo');
  let projectDrag = null;
  let activeRender = null;
  let selectedVisualClipId = null;
  let audioTimelineZoom = 1;
  let audioHeartbeat = null;
  let audioPreviewUntilMs = null;
  let selectedAudioClipId = null;
  const audioUndo = [];
  const audioRedo = [];
  let audioExportQueue = [];
  let audioExportCancelled = false;

  function audioSnapshot() { return structuredClone(audioProject); }
  function rememberAudioChange() {
    audioUndo.push(audioSnapshot());
    if (audioUndo.length > 80) audioUndo.shift();
    audioRedo.length = 0;
    updateAudioHistoryButtons();
  }
  function updateAudioHistoryButtons() {
    byId('audioProjectUndo').disabled = !audioUndo.length || Boolean(activeRender);
    byId('audioProjectRedo').disabled = !audioRedo.length || Boolean(activeRender);
  }
  function navigateAudioHistory(source, target) {
    if (!source.length || activeRender) return;
    target.push(audioSnapshot());
    stopProject('audio', false);
    setProject('audio', source.pop());
    renderAudioProject();
    updateAudioHistoryButtons();
  }

  function id() { return bridge.toolId(); }
  function text(value) { return bridge.safeText(value); }
  function sourceUrl(file) { return `file:///${String(file).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`; }
  function secondsLabel(ms) { const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
  function folderLabel() { return bridge.getFolder() || 'Downloads'; }
  function setProject(kind, value) {
    if (kind === 'audio') audioProject = api.normalizeProject(value);
    else videoProject = api.normalizeProject(value);
  }
  function model(kind) { return kind === 'audio' ? audioProject : videoProject; }
  function playback(kind) { return playbacks[kind]; }
  function currentPositionMs(kind, nowMs = performance.now()) {
    const state = playback(kind);
    return playbackClock.positionAt(state, nowMs, api.durationMs(model(kind)));
  }
  function players(kind) { return kind === 'audio' ? audioPlayers : videoPlayers; }
  function waveforms(kind) { return kind === 'audio' ? audioWaveforms : videoWaveforms; }
  function audioTracks(project) { return project.tracks.filter(track => track.kind === 'audio'); }
  function visualTrack(project) { return project.tracks.find(track => track.kind === 'visual') || null; }
  function getAsset(project, assetId) { return project.assets.find(asset => asset.id === assetId); }
  function getClip(project, trackId, clipId) { const track = project.tracks.find(item => item.id === trackId); return { track, clip: track?.clips.find(item => item.id === clipId) }; }
  function updateFolderLabels() { ['audioProjectFolderPath', 'videoProjectFolderPath'].forEach(id => { const node = byId(id); if (node) node.textContent = folderLabel(); }); }

  async function inspectAudioFiles(kind, paths) {
    const project = api.normalizeProject(model(kind));
    const remaining = Math.max(0, Math.min(api.MAX_ASSETS - project.assets.length, api.MAX_TRACKS - project.tracks.length));
    const eligible = paths.filter(path => typeof path === 'string' && /\.(mp3|m4a|aac|wav|flac|ogg|opus|wma|mp4|mkv|mov|avi|webm|wmv|m4v)$/i.test(path));
    const available = eligible.slice(0, remaining);
    const inspected = await Promise.allSettled(available.map(path => window.ntc.inspectMedia(path)));
    const added = [];
    inspected.forEach(result => {
      if (result.status !== 'fulfilled') return;
      const info = result.value;
      const durationMs = Math.round(Number(info.duration) * 1000);
      if (!Number.isSafeInteger(durationMs) || durationMs < 100) return;
      const mediaDuration = Math.min(api.MAX_PROJECT_MS, durationMs);
      if (kind === 'audio' && !project.assets.length && info.metadata) project.output.metadata = { ...project.output.metadata, ...info.metadata };
      const asset = { id: id(), path: info.path, name: info.name, kind: 'audio', durationMs: mediaDuration, width: 0, height: 0, coverStreamIndex: info.coverStreamIndex };
      const track = { id: id(), kind: 'audio', name: info.name, muted: false, volume: 100, clips: [{ id: id(), assetId: asset.id, positionMs: 0, sourceStartMs: 0, durationMs: mediaDuration, volume: 100, muted: false }] };
      project.assets.push(asset);
      project.tracks.push(track);
      added.push(asset);
    });
    if (kind === 'audio' && added.length) rememberAudioChange();
    setProject(kind, project);
    await Promise.all(added.map(async asset => { try { waveforms(kind).set(asset.id, await window.ntc.getWaveform(asset.path)); } catch { waveforms(kind).set(asset.id, []); } }));
    return { count: added.length, failed: paths.length - added.length };
  }

  function renderWaveforms(container, project, kind) {
    container.querySelectorAll('[data-project-waveform]').forEach(canvas => {
      const { clip } = getClip(project, canvas.dataset.trackId, canvas.dataset.projectWaveform);
      if (!clip) return;
      const asset = getAsset(project, clip.assetId);
      const values = waveforms(kind).get(asset?.id) || [];
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const drawWidth = kind === 'audio' ? Math.min(rect.width, 2000) : rect.width;
      canvas.width = Math.max(1, Math.round(drawWidth * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (!values.length) return;
      const middle = rect.height / 2;
      context.strokeStyle = '#ead6dc';
      context.globalAlpha = .72;
      context.lineWidth = 1;
      for (let x = 0; x < Math.ceil(drawWidth); x++) {
        const index = Math.min(values.length - 1, Math.floor(x / Math.max(1, drawWidth) * values.length));
        const amplitude = Math.max(.03, Number(values[index]) || 0) * rect.height * .4;
        context.beginPath(); context.moveTo(x + .5, middle - amplitude); context.lineTo(x + .5, middle + amplitude); context.stroke();
      }
      context.globalAlpha = 1;
    });
  }

  function renderAudioTracks(project, target, kind, duration) {
    const tracks = audioTracks(project);
    if (!tracks.length) {
      target.innerHTML = '<div class="empty-state"><p>Adicione músicas ou stems. As faixas poderão tocar juntas e ser exportadas em um único arquivo.</p></div>';
      return;
    }
    const rows = tracks.map(track => {
      const clip = track.clips[0];
      if (kind === 'video' && !clip) return '';
      const asset = clip && getAsset(project, clip.assetId);
      const left = clip && duration ? clip.positionMs / duration * 100 : 0;
      const width = clip && duration ? Math.max(1.2, clip.durationMs / duration * 100) : 100;
      if (kind === 'video') return `<article class="media-project-track-row${track.muted ? ' is-muted' : ''}" data-project-track-row="${track.id}"><div class="media-project-track-meta"><strong title="${text(track.name)}">${text(track.name)}</strong><div class="media-project-track-controls"><span title="Duração da faixa">${secondsLabel(clip.durationMs)}</span><label aria-label="Volume da faixa">Vol. <input type="range" min="0" max="300" value="${Math.round(track.volume)}" data-project-volume="${track.id}" title="Volume da faixa"></label><button type="button" data-project-mute="${track.id}" aria-pressed="${track.muted}" title="${track.muted ? 'Ativar faixa' : 'Silenciar faixa'}">${track.muted ? 'Silenciado' : 'Silenciar'}</button><button type="button" data-project-remove-track="${track.id}" aria-label="Remover ${text(track.name)}" title="Remover faixa">×</button></div></div><div class="media-project-lane" data-project-lane="${kind}" data-track-id="${track.id}" role="slider" tabindex="0" aria-label="Faixa ${text(track.name)}"><div class="media-project-clip" data-project-clip="${clip.id}" data-track-id="${track.id}" style="left:${left}%;width:${width}%"><canvas data-project-waveform="${clip.id}" data-track-id="${track.id}" aria-hidden="true"></canvas><button class="media-project-clip-handle start" type="button" data-project-edge="start" aria-label="Cortar início do clipe" title="Cortar início do clipe"></button><span title="${text(asset?.name || track.name)}">${text(asset?.name || track.name)}</span><button class="media-project-clip-handle end" type="button" data-project-edge="end" aria-label="Cortar fim do clipe" title="Cortar fim do clipe"></button></div><span class="media-project-playhead" aria-hidden="true"></span></div></article>`;
      const clips = track.clips.map(item => {
        const clipAsset = getAsset(project, item.assetId);
        const itemLeft = duration ? item.positionMs / duration * 100 : 0;
        const itemWidth = duration ? Math.max(1.2, item.durationMs / duration * 100) : 100;
        const name = text(clipAsset?.name || track.name);
        return `<div class="media-project-clip${selectedAudioClipId === item.id ? ' is-selected' : ''}" data-project-clip="${item.id}" data-track-id="${track.id}" style="left:${itemLeft}%;width:${itemWidth}%"><canvas data-project-waveform="${item.id}" data-track-id="${track.id}" aria-hidden="true"></canvas><button class="media-project-clip-handle start" type="button" data-project-edge="start" aria-label="Cortar início do clipe" title="Cortar início do clipe"></button><span title="${name}">${name}</span><button class="media-project-clip-handle end" type="button" data-project-edge="end" aria-label="Cortar fim do clipe" title="Cortar fim do clipe"></button></div>`;
      }).join('');
      const trackDuration = Math.max(0, ...track.clips.map(item => item.positionMs + item.durationMs));
      return `<article class="media-project-track-row${track.muted ? ' is-muted' : ''}" data-project-track-row="${track.id}"><div class="media-project-track-meta"><strong title="${text(track.name)}">${text(track.name)}</strong><div class="media-project-track-controls"><span title="Duração da faixa">${secondsLabel(trackDuration)}</span><label aria-label="Volume da faixa">Vol. <input type="range" min="0" max="300" value="${Math.round(track.volume)}" data-project-volume="${track.id}" title="Volume da faixa"></label><button type="button" data-project-mute="${track.id}" aria-pressed="${track.muted}" title="${track.muted ? 'Ativar faixa' : 'Silenciar faixa'}">${track.muted ? 'Silenciado' : 'Silenciar'}</button><button type="button" data-project-remove-track="${track.id}" aria-label="Remover ${text(track.name)}" title="Remover faixa">×</button></div></div><div class="media-project-lane" data-project-lane="${kind}" data-track-id="${track.id}" aria-label="Faixa ${text(track.name)}">${clips}<span class="media-project-playhead" data-audio-playhead aria-hidden="true"></span></div></article>`;
    }).join('');
    if (kind === 'audio') {
      const ruler = Array.from({ length: 11 }, (_, index) => `<span style="left:${index * 10}%">${secondsLabel(duration * index / 10)}</span>`).join('');
      const markers = project.markers.map(marker => `<span class="audio-project-ruler-range" style="left:${duration ? marker.startMs / duration * 100 : 0}%;width:${duration ? (marker.endMs - marker.startMs) / duration * 100 : 0}%" title="${text(marker.name)} · ${secondsLabel(marker.startMs)}–${secondsLabel(marker.endMs)}"></span>`).join('');
      target.innerHTML = `<div class="audio-project-timeline-content" style="width:max(100%, ${Math.min(8000, Math.max(600, Math.ceil(duration / 1000 * 24 * audioTimelineZoom)))}px)"><div class="audio-project-ruler"><div class="audio-project-ruler-spacer"></div><div class="audio-project-ruler-marks">${ruler}${markers}<span class="media-project-playhead" data-audio-playhead aria-hidden="true"></span></div></div>${rows}</div>`;
      updateAudioPlayheads(currentPositionMs('audio'), duration);
    } else target.innerHTML = rows;

    renderWaveforms(target, project, kind);
    if (kind === 'audio') target.querySelectorAll('[data-project-volume]').forEach(input => input.onpointerdown = () => rememberAudioChange());
    target.querySelectorAll('[data-project-volume]').forEach(input => input.oninput = () => {
      const track = project.tracks.find(item => item.id === input.dataset.projectVolume);
      if (track) { track.volume = Math.max(0, Math.min(300, Number(input.value) || 0)); syncProjectAudio(project, players(kind), currentPositionMs(kind), playback(kind).playing); }
    });
    target.querySelectorAll('[data-project-mute]').forEach(button => button.onclick = () => {
      const track = project.tracks.find(item => item.id === button.dataset.projectMute);
      if (track) { if (kind === 'audio') rememberAudioChange(); track.muted = !track.muted; syncProjectAudio(project, players(kind), currentPositionMs(kind), playback(kind).playing); renderProject(kind); }
    });
    target.querySelectorAll('[data-project-remove-track]').forEach(button => button.onclick = () => {
      const trackId = button.dataset.projectRemoveTrack;
      const track = project.tracks.find(item => item.id === trackId);
      if (kind === 'audio') rememberAudioChange();
      project.tracks = project.tracks.filter(item => item.id !== trackId);
      if (track) {
        const removedClips = kind === 'audio' ? track.clips : track.clips.slice(0, 1);
        const orphanedIds = new Set(removedClips.map(clip => clip.assetId).filter(assetId => !project.tracks.some(item => item.clips.some(clip => clip.assetId === assetId))));
        if (orphanedIds.size) {
          project.assets = project.assets.filter(asset => !orphanedIds.has(asset.id));
          orphanedIds.forEach(assetId => waveforms(kind).delete(assetId));
        }
      }
      stopProject(kind, false); setProject(kind, project); renderProject(kind);
    });
    target.querySelectorAll('[data-project-clip]').forEach(clipElement => clipElement.onpointerdown = event => {
      if (event.button !== 0) return;
      const trackId = clipElement.dataset.trackId;
      const clipId = clipElement.dataset.projectClip;
      const { clip } = getClip(project, trackId, clipId);
      const lane = clipElement.parentElement;
      if (!clip || !lane) return;
      if (kind === 'audio') { selectedAudioClipId = clipId; renderAudioClipInspector(); }
      const asset = getAsset(project, clip.assetId);
      projectDrag = { kind, trackId, clipId, mode: event.target.dataset.projectEdge || 'move', startX: event.clientX, laneWidth: lane.getBoundingClientRect().width, timelineMs: Math.max(1000, duration), positionMs: clip.positionMs, sourceStartMs: clip.sourceStartMs, durationMs: clip.durationMs, assetDurationMs: asset?.durationMs || clip.durationMs };
      event.preventDefault();
    });
    target.querySelectorAll('[data-project-lane]').forEach(lane => lane.onpointerdown = event => {
      if (event.target.closest('[data-project-clip]')) return;
      const rect = lane.getBoundingClientRect();
      seekProject(kind, Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration));
    });
  }

  function updateAudioPlayheads(positionMs, durationMs) {
    const left = `${durationMs ? Math.max(0, Math.min(100, positionMs / durationMs * 100)) : 0}%`;
    $('#audioProjectTimeline').querySelectorAll('[data-audio-playhead]').forEach(marker => { marker.style.left = left; });
  }

  function refreshAudioTransport(positionMs = currentPositionMs('audio')) {
    const duration = api.durationMs(audioProject);
    $('#audioProjectSeek').value = String(Math.min(duration, positionMs));
    $('#audioProjectTime').textContent = `${secondsLabel(positionMs)} / ${secondsLabel(duration)}`;
    updateAudioPlayheads(positionMs, duration);
  }

  function renderAudioProject() {
    const project = audioProject;
    const duration = api.durationMs(project);
    $('#audioProjectName').value = project.name;
    $('#audioProjectFormat').value = project.output.format;
    $('#audioProjectQuality').value = project.output.quality === 'lossless' ? '192' : project.output.quality;
    $('#audioProjectQualityWrap').hidden = !audioFeatures.FORMATS[project.output.format].bitrate;
    $('#audioProjectOutputName').value = project.output.outputName;
    for (const field of audioFeatures.METADATA_FIELDS) byId(`audioProjectMetadata${field[0].toUpperCase()}${field.slice(1)}`).value = project.output.metadata[field];
    const supportsCover = audioFeatures.FORMATS[project.output.format].cover;
    $('#audioProjectChooseCover').disabled = !supportsCover;
    $('#audioProjectRemoveCover').disabled = !supportsCover;
    $('#audioProjectCoverName').textContent = supportsCover ? (project.output.coverPath ? project.output.coverPath.split(/[\\/]/).pop() : (project.output.preserveSourceCover ? 'Preservar capa da origem, se houver' : 'Sem capa')) : 'Capa disponível apenas em MP3, M4A e FLAC.';
    $('#audioProjectAssetSummary').textContent = project.assets.length ? `${project.assets.length} ${project.assets.length === 1 ? 'faixa' : 'faixas'} · ${secondsLabel(duration)}` : 'Nenhuma faixa adicionada';
    $('#audioProjectExport').disabled = !project.tracks.some(track => track.kind === 'audio' && track.clips.length) || Boolean(activeRender);
    $('#audioProjectExport').title = $('#audioProjectExport').disabled ? 'Adicione ao menos uma faixa de áudio para exportar.' : 'Exportar todas as faixas em um único arquivo.';
    $('#audioProjectPlay').disabled = duration <= 0;
    $('#audioProjectPlay').title = duration <= 0 ? 'Adicione ao menos uma faixa de áudio para reproduzir.' : 'Reproduzir ou pausar o projeto.';
    $('#audioProjectStop').disabled = duration <= 0 || (!playbacks.audio.playing && playbacks.audio.positionMs <= 0);
    $('#audioProjectSeek').max = String(Math.max(1, duration));
    const position = currentPositionMs('audio');
    refreshAudioTransport(position);
    renderAudioTracks(project, $('#audioProjectTimeline'), 'audio', duration);
    renderAudioClipInspector();
    renderAudioMarkers();
    updateAudioHistoryButtons();
    syncProjectAudio(project, audioPlayers, position, playback('audio').playing);
  }

  function selectedAudioClip() {
    for (const track of audioTracks(audioProject)) {
      const clip = track.clips.find(item => item.id === selectedAudioClipId);
      if (clip) return clip;
    }
    return null;
  }
  function renderAudioClipInspector() {
    const clip = selectedAudioClip();
    const panel = byId('audioProjectClipEffects');
    panel.hidden = !clip;
    byId('audioProjectClipHint').hidden = Boolean(clip);
    if (!clip) return;
    const effects = audioFeatures.normalizeEffects(clip.effects);
    for (const [field, control] of Object.entries({ gain: 'Gain', eqBass: 'Bass', eqMid: 'Mid', eqTreble: 'Treble', normalize: 'Normalize', removeSilence: 'RemoveSilence' })) {
      const input = byId(`audioProject${control}`);
      if (input.type === 'checkbox') input.checked = effects[field];
      else input.value = String(effects[field]);
    }
  }
  function renderAudioMarkers() {
    const list = byId('audioProjectMarkerList');
    list.innerHTML = audioProject.markers.length ? audioProject.markers.map(marker => `<div class="audio-project-marker-row" data-marker-id="${marker.id}"><input class="text-input" data-marker-field="name" value="${text(marker.name)}" aria-label="Nome do trecho" maxlength="80"><input class="text-input" data-marker-field="startMs" type="number" min="0" step="0.001" value="${(marker.startMs / 1000).toFixed(3)}" aria-label="Início em segundos"><input class="text-input" data-marker-field="endMs" type="number" min="0" step="0.001" value="${(marker.endMs / 1000).toFixed(3)}" aria-label="Fim em segundos"><button class="ghost-button" type="button" data-remove-marker="${marker.id}" aria-label="Remover trecho">×</button></div>`).join('') : '<p>Nenhum trecho marcado.</p>';
    list.querySelectorAll('[data-marker-field]').forEach(input => input.onchange = () => {
      const marker = audioProject.markers.find(item => item.id === input.closest('[data-marker-id]').dataset.markerId);
      if (!marker) return;
      const field = input.dataset.markerField;
      const value = field === 'name' ? input.value.trim().slice(0, 80) || 'Trecho' : Math.round(Number(input.value) * 1000);
      const candidate = { ...marker, [field]: value };
      if (candidate.startMs < 0 || candidate.endMs > api.durationMs(audioProject) || candidate.endMs <= candidate.startMs) { renderAudioMarkers(); bridge.showToast('Trecho inválido. Confira início e fim.'); return; }
      rememberAudioChange(); Object.assign(marker, candidate); renderAudioProject();
    });
    list.querySelectorAll('[data-remove-marker]').forEach(button => button.onclick = () => { rememberAudioChange(); audioProject.markers = audioProject.markers.filter(marker => marker.id !== button.dataset.removeMarker); renderAudioProject(); });
    byId('audioProjectExportMarkers').disabled = !audioProject.markers.length || Boolean(activeRender);
  }

  function visualClips(project) { return visualTrack(project)?.clips || []; }
  function visualDuration(project) { return visualClips(project).reduce((end, clip) => Math.max(end, clip.positionMs + clip.durationMs), 0); }
  function audioDuration(project) { return Math.max(0, ...audioTracks(project).flatMap(track => track.clips.map(clip => clip.positionMs + clip.durationMs))); }
  function extendLastImageToAudio() {
    const track = visualTrack(videoProject);
    const last = track?.clips.slice().sort((a, b) => a.positionMs - b.positionMs).at(-1);
    if (!last) return;
    const requiredEnd = audioDuration(videoProject);
    if (requiredEnd > last.positionMs + last.durationMs) last.durationMs = Math.min(api.MAX_PROJECT_MS - last.positionMs, requiredEnd - last.positionMs);
  }

  function renderVideoVisualTimeline() {
    const target = $('#videoProjectVisualTimeline');
    const project = videoProject;
    const duration = Math.max(1000, api.durationMs(project));
    const track = visualTrack(project);
    if (!track?.clips.length) {
      selectedVisualClipId = null;
      target.innerHTML = '<div class="empty-state"><p>Adicione uma ou mais imagens. Cada clipe pode ter duração própria; as imagens seguem uma após a outra.</p></div>';
      return;
    }
    if (!track.clips.some(clip => clip.id === selectedVisualClipId)) selectedVisualClipId = null;
    const clips = [...track.clips].sort((a, b) => a.positionMs - b.positionMs);
    const visualRows = clips.map((clip, index) => {
      const asset = getAsset(project, clip.assetId);
      const left = clip.positionMs / duration * 100;
      const width = Math.max(2.2, clip.durationMs / duration * 100);
      return `<div class="media-project-clip media-project-image-clip${selectedVisualClipId === clip.id ? ' is-selected' : ''}" title="${text(asset?.name || 'Imagem')} · ${secondsLabel(clip.durationMs)}" style="left:${left}%;width:${width}%"><span title="${text(asset?.name || 'Imagem')}">${text(asset?.name || 'Imagem')}</span></div>`;
    }).join('');
    const imageRows = clips.map((clip, index) => {
      const asset = getAsset(project, clip.assetId);
      const name = asset?.name || 'Imagem';
      return `<article class="media-project-image-item${selectedVisualClipId === clip.id ? ' is-selected' : ''}" data-image-clip="${clip.id}"><button class="media-project-image-select" data-image-select="${clip.id}" type="button" aria-pressed="${selectedVisualClipId === clip.id}" title="${text(name)}"><img src="${asset ? sourceUrl(asset.path) : ''}" alt=""><span>${text(name)}</span></button><div class="media-project-image-actions"><button class="ghost-button" data-image-up="${clip.id}" type="button" aria-label="Mover imagem para cima" title="Mover imagem para cima" ${index === 0 ? 'disabled' : ''}>↑</button><button class="ghost-button" data-image-down="${clip.id}" type="button" aria-label="Mover imagem para baixo" title="Mover imagem para baixo" ${index === clips.length - 1 ? 'disabled' : ''}>↓</button></div></article>`;
    }).join('');
    const playheadPosition = duration ? Math.max(0, Math.min(100, currentPositionMs('video') / duration * 100)) : 0;
    target.innerHTML = `<div><div class="media-project-lane media-project-visual-lane">${visualRows}<span class="media-project-playhead" style="left:${playheadPosition}%" aria-hidden="true"></span></div></div><div class="media-project-image-list">${imageRows}</div>`;
    target.querySelectorAll('.media-project-image-select img').forEach(image => { image.onerror = () => { image.hidden = true; }; });
    target.querySelectorAll('[data-image-select]').forEach(button => button.onclick = () => { selectedVisualClipId = button.dataset.imageSelect; renderProject('video'); });
    target.querySelectorAll('[data-image-up], [data-image-down]').forEach(button => button.onclick = () => {
      const clipId = button.dataset.imageUp || button.dataset.imageDown;
      const index = track.clips.findIndex(clip => clip.id === clipId);
      const nextIndex = index + (button.dataset.imageUp ? -1 : 1);
      if (index < 0 || nextIndex < 0 || nextIndex >= track.clips.length) return;
      [track.clips[index], track.clips[nextIndex]] = [track.clips[nextIndex], track.clips[index]];
      reflowVisualClips(track); renderProject('video');
    });
  }

  function setVisualClipDuration(clipId, seconds) {
    const track = visualTrack(videoProject);
    const clip = track?.clips.find(item => item.id === clipId);
    if (!clip) return;
    clip.durationMs = Math.max(100, Math.min(api.MAX_PROJECT_MS - clip.positionMs, Math.round((Number(seconds) || .1) * 1000)));
    reflowVisualClips(track);
    renderProject('video');
  }

  function removeVisualClip(clipId) {
    const track = visualTrack(videoProject);
    if (!track) return;
    const removed = track.clips.find(clip => clip.id === clipId);
    track.clips = track.clips.filter(clip => clip.id !== clipId);
    if (removed && !track.clips.some(clip => clip.assetId === removed.assetId)) videoProject.assets = videoProject.assets.filter(asset => asset.id !== removed.assetId);
    selectedVisualClipId = track.clips.some(clip => clip.id === selectedVisualClipId) ? selectedVisualClipId : null;
    reflowVisualClips(track); stopProject('video', false); renderProject('video');
  }

  function renderVideoInspector() {
    const project = videoProject;
    const selected = visualTrack(project)?.clips.find(clip => clip.id === selectedVisualClipId);
    const summary = byId('videoProjectInspectorSummary');
    const details = byId('videoProjectInspectorSelection');
    summary.hidden = Boolean(selected);
    details.hidden = !selected;
    if (!selected) return;
    const asset = getAsset(project, selected.assetId);
    const name = asset?.name || 'Imagem';
    const dimensions = asset?.width && asset?.height ? `${asset.width} × ${asset.height}` : 'Dimensões indisponíveis';
    details.innerHTML = `<span class="eyebrow">IMAGEM SELECIONADA</span><strong class="video-project-inspector-title" title="${text(name)}">${text(name)}</strong><span class="video-project-inspector-detail">${dimensions}</span><label><span class="field-label">Duração</span><span class="video-project-duration-input"><input class="text-input" data-selected-image-duration type="number" min="0.1" step="0.1" value="${(selected.durationMs / 1000).toFixed(1)}"><span>s</span></span></label><button class="ghost-button" data-selected-image-remove type="button" title="Remover imagem selecionada">Remover imagem</button>`;
    details.querySelector('[data-selected-image-duration]').onchange = event => setVisualClipDuration(selected.id, event.currentTarget.value);
    details.querySelector('[data-selected-image-remove]').onclick = () => removeVisualClip(selected.id);
  }

  function reflowVisualClips(track = visualTrack(videoProject)) {
    if (!track) return;
    let cursor = 0;
    track.clips.forEach(clip => { clip.positionMs = cursor; cursor += clip.durationMs; });
  }

  function updateVideoPreview() {
    const project = videoProject;
    const position = currentPositionMs('video');
    playback('video').positionMs = position;
    const clip = visualClips(project).find(item => position >= item.positionMs && position < item.positionMs + item.durationMs) || visualClips(project).at(-1);
    const asset = clip && getAsset(project, clip.assetId);
    const image = $('#videoProjectPreviewImage');
    const nextUrl = asset ? sourceUrl(asset.path) : '';
    const empty = $('#videoProjectPreviewEmpty');
    if (nextUrl && image.dataset.sourcePath !== asset.path) { image.hidden = true; image.dataset.sourcePath = asset.path; image.src = nextUrl; }
    if (!nextUrl) { image.removeAttribute('src'); delete image.dataset.sourcePath; image.hidden = true; $('#videoProjectPreviewMessage').textContent = 'Nenhuma mídia no projeto'; }
    empty.hidden = visualClips(project).length > 0;
    $('#videoProjectTime').textContent = `${secondsLabel(position)} / ${secondsLabel(api.durationMs(project))}`;
    $('#videoProjectDuration').textContent = secondsLabel(api.durationMs(project));
    $('#videoProjectStop').disabled = !api.durationMs(project) || (position <= 0 && !playback('video').playing);
    $('#videoProjectSeek').max = String(Math.max(1, api.durationMs(project)));
    $('#videoProjectSeek').value = String(Math.min(api.durationMs(project), position));
    const playheadPosition = api.durationMs(project) ? Math.max(0, Math.min(100, position / api.durationMs(project) * 100)) : 0;
    document.querySelectorAll('#videoProjectVisualTimeline .media-project-playhead, #videoProjectAudioTimeline .media-project-playhead').forEach(playhead => { playhead.style.left = `${playheadPosition}%`; });
  }

  function renderVideoProject() {
    const project = videoProject;
    const duration = api.durationMs(project);
    playback('video').positionMs = currentPositionMs('video');
    $('#videoProjectName').value = project.name;
    const imageCount = visualClips(project).length;
    const musicCount = audioTracks(project).reduce((total, track) => total + track.clips.length, 0);
    $('#videoProjectAssetSummary').textContent = `${imageCount} ${imageCount === 1 ? 'imagem' : 'imagens'} · ${musicCount} ${musicCount === 1 ? 'faixa de áudio' : 'faixas de áudio'} · ${secondsLabel(duration)}`;
    $('#videoProjectInspectorName').textContent = project.name;
    $('#videoProjectInspectorDuration').textContent = secondsLabel(duration);
    $('#videoProjectInspectorResolution').textContent = `${$('#videoProjectResolution').value}p · H.264 / AAC`;
    $('#videoProjectExport').disabled = !imageCount || !musicCount || Boolean(activeRender);
    $('#videoProjectOutputName').value = $('#videoProjectOutputName').value || project.name;
    $('#videoProjectPlay').disabled = duration <= 0;
    $('#videoProjectStop').disabled = duration <= 0 || (playbacks.video.positionMs <= 0 && !playbacks.video.playing);
    $('#videoProjectSeek').disabled = duration <= 0;
    renderVideoVisualTimeline();
    renderVideoInspector();
    renderAudioTracks(project, $('#videoProjectAudioTimeline'), 'video', duration);
    updateVideoPreview();
  }

  function renderProject(kind) { if (kind === 'audio') renderAudioProject(); else renderVideoProject(); }

  function ensurePlayers(project, playerMap) {
    const sources = project.kind === 'audio'
      ? audioTracks(project).flatMap(track => track.clips.map(clip => ({ key: clip.id, asset: getAsset(project, clip.assetId) })))
      : project.assets.filter(asset => asset.kind === 'audio').map(asset => ({ key: asset.id, asset }));
    const wanted = new Set(sources.map(source => source.key));
    for (const [key, player] of playerMap) if (!wanted.has(key)) { player.pause(); player.removeAttribute('src'); player.load(); playerMap.delete(key); }
    sources.forEach(({ key, asset }) => {
      if (!asset) return;
      const player = playerMap.get(key) || new Audio();
      if (!playerMap.has(key)) { player.preload = 'auto'; playerMap.set(key, player); }
      if (player.dataset?.projectSource !== asset.path) { player.src = sourceUrl(asset.path); player.dataset.projectSource = asset.path; player.load(); }
    });
  }

  function syncProjectAudio(project, playerMap, positionMs, shouldPlay) {
    ensurePlayers(project, playerMap);
    const active = new Set();
    for (const track of audioTracks(project)) for (const clip of track.clips) {
      const key = project.kind === 'audio' ? clip.id : clip.assetId;
      const player = playerMap.get(key);
      if (!player) continue;
      const inClip = positionMs >= clip.positionMs && positionMs < clip.positionMs + clip.durationMs;
      if (inClip) {
        active.add(key);
        const desired = (clip.sourceStartMs + positionMs - clip.positionMs) / 1000;
        if (!Number.isFinite(player.currentTime) || Math.abs(player.currentTime - desired) > .35) { try { player.currentTime = Math.max(0, desired); } catch {} }
        const gain = clip.volume * track.volume / 10000;
        applyProjectGain(player, gain, project.kind === 'audio' ? clip.effects : null);
        player.muted = clip.muted || track.muted;
        if (shouldPlay && player.paused) player.play().catch(() => {});
        else if (!shouldPlay && !player.paused) player.pause();
      } else if (!player.paused) player.pause();
    }
    for (const [key, player] of playerMap) if (!active.has(key) && !player.paused) player.pause();
  }

  function applyProjectGain(player, gain, effectsInput = null) {
    const effects = audioFeatures.normalizeEffects(effectsInput || {});
    const value = Math.max(0, Math.min(30, (Number(gain) || 0) * Math.pow(10, effects.gain / 20)));
    try {
      let node = playerGainNodes.get(player);
      if (!node && window.AudioContext) {
        projectAudioContext ||= new AudioContext();
        const source = projectAudioContext.createMediaElementSource(player);
        const bass = projectAudioContext.createBiquadFilter(); bass.type = 'peaking'; bass.frequency.value = 100; bass.Q.value = 1;
        const mid = projectAudioContext.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1;
        const treble = projectAudioContext.createBiquadFilter(); treble.type = 'peaking'; treble.frequency.value = 6000; treble.Q.value = 1;
        const gainNode = projectAudioContext.createGain();
        source.connect(bass).connect(mid).connect(treble).connect(gainNode).connect(projectAudioContext.destination);
        node = { source, bass, mid, treble, gainNode };
        playerGainNodes.set(player, node);
      }
      if (node) {
        player.volume = 1;
        node.gainNode.gain.value = value;
        node.bass.gain.value = effects.eqBass;
        node.mid.gain.value = effects.eqMid;
        node.treble.gain.value = effects.eqTreble;
      } else player.volume = Math.min(1, value);
    } catch { player.volume = Math.min(1, value); }
  }

  function tickProject(kind, timestamp) {
    const state = playback(kind);
    if (!state.playing) return;
    const project = model(kind);
    const duration = api.durationMs(project);
    state.positionMs = playbackClock.positionAt(state, performance.now(), duration);
    if (state.positionMs >= duration || (kind === 'audio' && audioPreviewUntilMs !== null && state.positionMs >= audioPreviewUntilMs)) { state.positionMs = Math.min(duration, audioPreviewUntilMs ?? duration); stopProject(kind, false); if (kind === 'video') updateVideoPreview(); return; }
    syncProjectAudio(project, players(kind), state.positionMs, state.playing);
    if (kind === 'video') updateVideoPreview();
    else {
      refreshAudioTransport(state.positionMs);
    }
    state.frame = requestAnimationFrame(time => tickProject(kind, time));
  }

  function playProject(kind, options = {}) {
    const project = model(kind);
    const duration = api.durationMs(project);
    if (!duration) return bridge.showToast('Adicione faixas ao projeto antes de reproduzir.');
    const state = playback(kind);
    if (kind === 'audio') audioPreviewUntilMs = options.untilMs ?? null;
    playbackClock.start(state, performance.now(), duration);
    if (projectAudioContext?.state === 'suspended') projectAudioContext.resume().catch(() => {});
    state.positionMs = currentPositionMs(kind);
    syncProjectAudio(project, players(kind), state.positionMs, true);
    if (kind === 'audio') {
      if (audioHeartbeat) clearInterval(audioHeartbeat);
      audioHeartbeat = setInterval(() => {
        if (!playbacks.audio.playing) return;
        const position = currentPositionMs('audio');
        if (position >= api.durationMs(audioProject) || (audioPreviewUntilMs !== null && position >= audioPreviewUntilMs)) { stopProject('audio', false); return; }
        syncProjectAudio(audioProject, audioPlayers, position, true);
      }, 250);
    }
    state.frame = requestAnimationFrame(time => tickProject(kind, time));
    const button = byId(kind === 'audio' ? 'audioProjectPlay' : 'videoProjectPlay');
    button.textContent = 'Ⅱ Pausar'; button.onclick = () => stopProject(kind, false);
    if (kind === 'audio') $('#audioProjectStop').disabled = false;
  }

  function stopProject(kind, rewind) {
    const state = playback(kind);
    if (kind === 'audio') audioPreviewUntilMs = null;
    playbackClock.pause(state, performance.now(), api.durationMs(model(kind)));
    if (kind === 'audio' && audioHeartbeat) { clearInterval(audioHeartbeat); audioHeartbeat = null; }
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    for (const player of players(kind).values()) player.pause();
    if (rewind) {
      playbackClock.seek(state, 0, performance.now(), api.durationMs(model(kind)));
    }
    syncProjectAudio(model(kind), players(kind), state.positionMs, false);
    const button = byId(kind === 'audio' ? 'audioProjectPlay' : 'videoProjectPlay');
    if (button) { button.textContent = kind === 'audio' ? '▶ Reproduzir mix' : '▶ Reproduzir prévia'; button.onclick = () => playProject(kind); }
    if (kind === 'video') updateVideoPreview();
    else { refreshAudioTransport(state.positionMs); $('#audioProjectStop').disabled = state.positionMs <= 0; }
  }

  function seekProject(kind, positionMs) {
    const state = playback(kind);
    playbackClock.seek(state, positionMs, performance.now(), api.durationMs(model(kind)));
    syncProjectAudio(model(kind), players(kind), state.positionMs, state.playing);
    if (kind === 'video') updateVideoPreview();
    else refreshAudioTransport(state.positionMs);
  }

  function refreshVideoPlaybackUi() {
    const state = playback('video');
    const duration = api.durationMs(videoProject);
    state.positionMs = currentPositionMs('video');
    if (state.playing && duration > 0 && state.positionMs >= duration) {
      stopProject('video', false);
      return;
    }
    updateVideoPreview();
  }

  function bindAudioRange(kind, inputId) { byId(inputId).oninput = event => seekProject(kind, Number(event.target.value)); }

  async function chooseProjectFolder(kind) {
    const chosen = await window.ntc.chooseDownloadFolder();
    if (!chosen) return;
    bridge.setFolder(chosen); updateFolderLabels();
  }

  async function addProjectAudio(kind) {
    const paths = await window.ntc.chooseMediaProjectAudio();
    if (!paths?.length) return;
    const result = await inspectAudioFiles(kind, paths);
    renderProject(kind);
    if (kind === 'video') { extendLastImageToAudio(); renderVideoProject(); }
    if (!result.count) bridge.showToast('Nenhuma faixa adicionada. Verifique o formato, a duração e o limite de 32 faixas.');
    else if (result.failed) bridge.showToast(`${result.count} faixa(s) adicionada(s); ${result.failed} arquivo(s) ignorado(s) por não serem áudio compatível.`);
    else bridge.showToast(`${result.count} faixa(s) adicionada(s) ao projeto.`);
  }

  async function importAudioPaths(paths) {
    const result = await inspectAudioFiles('audio', paths);
    renderAudioProject();
    if (result.failed) bridge.showToast(`${result.count} faixa(s) adicionada(s); ${result.failed} arquivo(s) ignorado(s).`);
    return result;
  }

  async function addProjectImages() {
    const paths = await window.ntc.chooseImageFiles();
    if (!paths?.length) return;
    await addImagePaths(paths);
  }

  async function addImagePaths(paths) {
    const current = videoProject;
    const visual = visualTrack(current) || { id: id(), kind: 'visual', name: 'Imagens', muted: false, volume: 100, clips: [] };
    if (!current.tracks.some(track => track.id === visual.id)) current.tracks.push(visual);
    const existing = new Set(current.assets.map(asset => asset.path.toLowerCase()));
    const available = paths.filter(path => !existing.has(path.toLowerCase())).slice(0, Math.max(0, api.MAX_ASSETS - current.assets.length));
    const results = await Promise.allSettled(available.map(path => window.ntc.inspectImage(path)));
    let cursor = visual.clips.reduce((end, clip) => Math.max(end, clip.positionMs + clip.durationMs), 0);
    let added = 0;
    results.forEach(result => {
      if (result.status !== 'fulfilled') return;
      const info = result.value;
      const asset = { id: id(), path: info.path, name: info.name, kind: 'image', durationMs: 0, width: Number(info.width) || 0, height: Number(info.height) || 0 };
      const audioEnd = audioDuration(current);
      const duration = Math.max(5000, audioEnd > cursor ? audioEnd - cursor : 5000);
      visual.clips.push({ id: id(), assetId: asset.id, positionMs: cursor, sourceStartMs: 0, durationMs: duration, volume: 100, muted: false });
      selectedVisualClipId = visual.clips.at(-1).id;
      cursor += duration; current.assets.push(asset); added++;
    });
    reflowVisualClips(visual);
    extendLastImageToAudio();
    setProject('video', current); renderVideoProject();
    if (results.length > added) bridge.showToast(`${added} imagem(ns) adicionada(s); alguns arquivos não puderam ser lidos.`);
    else bridge.showToast(`${added} imagem(ns) adicionada(s) à sequência.`);
  }

  async function hydrateProject(project) {
    const maps = new Map();
    await Promise.all(project.assets.filter(asset => asset.kind === 'audio').map(async asset => {
      try { maps.set(asset.id, await window.ntc.getWaveform(asset.path)); } catch { maps.set(asset.id, []); }
    }));
    return maps;
  }

  async function openProject(kind) {
    try {
      const project = await window.ntc.openMediaProject();
      if (!project) return;
      if (project.kind !== kind) throw new Error(`Este é um projeto de ${project.kind === 'audio' ? 'áudio' : 'vídeo'}; abra-o no editor correspondente.`);
      stopProject(kind, false);
      setProject(kind, project);
      if (kind === 'audio') { selectedAudioClipId = null; audioUndo.length = 0; audioRedo.length = 0; }
      if (kind === 'video') selectedVisualClipId = visualTrack(project)?.clips[0]?.id || null;
      waveforms(kind).clear();
      const waves = await hydrateProject(project);
      waves.forEach((values, assetId) => waveforms(kind).set(assetId, values));
      if (kind === 'audio') $('#audioProjectName').value = project.name;
      else { $('#videoProjectName').value = project.name; extendLastImageToAudio(); }
      renderProject(kind); bridge.showToast('Projeto aberto.');
    } catch (error) { bridge.showToast(bridge.cleanError(error)); }
  }

  async function saveProject(kind) {
    try {
      const project = model(kind);
      project.name = byId(kind === 'audio' ? 'audioProjectName' : 'videoProjectName').value.trim().slice(0, 100) || 'Projeto NTC';
      if (kind === 'audio') readAudioOutputUi();
      const result = await window.ntc.saveMediaProject(api.normalizeProject(project));
      if (result) bridge.showToast(`Projeto salvo: ${result.name}`);
    } catch (error) { bridge.showToast(bridge.cleanError(error)); }
  }

  function readAudioOutputUi() {
    const output = audioProject.output;
    output.format = byId('audioProjectFormat').value;
    output.quality = audioFeatures.FORMATS[output.format].bitrate ? byId('audioProjectQuality').value : 'lossless';
    output.outputName = byId('audioProjectOutputName').value.trim().slice(0, 150) || audioProject.name;
    for (const field of audioFeatures.METADATA_FIELDS) output.metadata[field] = byId(`audioProjectMetadata${field[0].toUpperCase()}${field.slice(1)}`).value.trim();
    audioProject.output = audioFeatures.normalizeOutput(output);
  }

  async function renderProjectFile(kind, options = {}) {
    if (activeRender) return;
    const project = model(kind);
    project.name = byId(kind === 'audio' ? 'audioProjectName' : 'videoProjectName').value.trim().slice(0, 100) || project.name;
    if (kind === 'audio') readAudioOutputUi();
    const outputName = options.outputName || (kind === 'audio' ? project.output.outputName : byId('videoProjectOutputName').value.trim()) || project.name;
    const format = kind === 'audio' ? byId('audioProjectFormat').value : 'mp4';
    const destination = bridge.getFolder() || await window.ntc.defaultDownloadFolder();
    if (!destination) return bridge.showToast('Escolha uma pasta para salvar o arquivo.');
    const jobId = id();
    activeRender = { id: jobId, kind };
    setRenderUi(kind, { status: 'RENDERIZANDO', percent: 0, meta: kind === 'audio' ? format.toUpperCase() : `${byId('videoProjectResolution').value}p · H.264` });
    renderProject(kind);
    try {
      const result = await window.ntc.startMediaProjectRender({ id: jobId, project: api.normalizeProject(project), folder: destination, outputName, format, ...(kind === 'video' ? { resolution: byId('videoProjectResolution').value } : { range: options.range, trackId: options.trackId }) });
      const actualKind = kind === 'audio' ? 'audio' : 'video';
      bridge.addHistory({ title: result.filename, type: actualKind, format: kind === 'audio' ? format.toUpperCase() : 'MP4', quality: kind === 'audio' ? (audioFeatures.FORMATS[format].bitrate ? `${project.output.quality} kbps` : 'sem perdas') : `${byId('videoProjectResolution').value}p · H.264/AAC`, size: bridge.formatBytes(result.size), file: result.file, time: 'Agora', operation: 'conversion' });
      setRenderUi(kind, { status: 'CONCLUÍDO', percent: 100, meta: `Arquivo criado: ${result.filename}`, file: result.file });
      bridge.showToast(kind === 'audio' ? 'Mixdown exportado.' : 'Vídeo exportado.');
      return true;
    } catch (error) {
      const message = bridge.cleanError(error);
      setRenderUi(kind, /cancelad/i.test(message) ? { status: 'CANCELADO', percent: 0, meta: 'Exportação cancelada.' } : { status: 'ERRO', percent: 0, meta: message });
      return false;
    } finally {
      activeRender = null;
      renderProject(kind);
    }
  }

  async function renderAudioBatch(jobs) {
    if (activeRender || !jobs.length) return;
    audioExportQueue = jobs.slice();
    audioExportCancelled = false;
    while (audioExportQueue.length && !audioExportCancelled) {
      const next = audioExportQueue.shift();
      if (!await renderProjectFile('audio', next)) break;
    }
    audioExportQueue = [];
  }

  function setRenderUi(kind, state) {
    const prefix = kind === 'audio' ? 'audioProject' : 'videoProject';
    const progress = byId(`${prefix}Progress`);
    progress.classList.remove('hidden');
    progress.dataset.state = state.status.toLowerCase();
    byId(`${prefix}Status`).textContent = state.status;
    byId(`${prefix}Percent`).textContent = `${Math.round(state.percent)}%`;
    byId(`${prefix}ProgressBar`).style.width = `${Math.max(0, Math.min(100, state.percent))}%`;
    byId(`${prefix}ProgressMeta`).textContent = state.meta;
    if (kind === 'video') byId(`${prefix}ProgressMeta`).title = state.meta;
    byId(`${prefix}ProgressTitle`).textContent = kind === 'audio' ? $('#audioProjectOutputName').value : $('#videoProjectOutputName').value;
    if (kind === 'video' || kind === 'audio') {
      const cancel = byId(`${prefix}Cancel`);
      const openFolder = byId(`${prefix}OpenFolder`);
      const retry = byId(`${prefix}Retry`);
      const isRendering = state.status === 'RENDERIZANDO';
      const isComplete = state.status === 'CONCLUÍDO' && Boolean(state.file || openFolder.dataset.file);
      const isRetryable = state.status === 'ERRO' || state.status === 'CANCELADO';
      cancel.hidden = !isRendering;
      cancel.disabled = !isRendering;
      if (state.file) openFolder.dataset.file = state.file;
      else if (!isComplete) delete openFolder.dataset.file;
      openFolder.hidden = !isComplete;
      openFolder.disabled = !isComplete;
      retry.hidden = !isRetryable;
      retry.disabled = !isRetryable;
    }
  }

  async function openProjectRenderFolder(kind) {
    const prefix = kind === 'audio' ? 'audioProject' : 'videoProject';
    const file = byId(`${prefix}OpenFolder`).dataset.file;
    if (!file) return;
    try {
      const error = await window.ntc.openFileFolder(file);
      if (error) bridge.showToast('Não foi possível abrir a pasta do arquivo.');
    } catch { bridge.showToast('Não foi possível abrir a pasta do arquivo.'); }
  }

  function handleRenderEvent(update) {
    if (!activeRender || update.id !== activeRender.id) return;
    if (update.status === 'converting') setRenderUi(activeRender.kind, { status: 'RENDERIZANDO', percent: update.percent || 0, meta: update.eta ? `Estimativa: ${update.eta}` : 'FFmpeg · composição em andamento' });
  }

  function cancelProjectRender(kind) { if (kind === 'audio') { audioExportCancelled = true; audioExportQueue = []; } if (activeRender?.kind === kind) window.ntc.cancelMediaProjectRender(activeRender.id); }

  function updateProjectDrag(event) {
    if (!projectDrag) return;
    const drag = projectDrag;
    const { track, clip } = getClip(model(drag.kind), drag.trackId, drag.clipId);
    if (!track || !clip) return;
    const deltaMs = Math.round((event.clientX - drag.startX) / Math.max(1, drag.laneWidth) * drag.timelineMs);
    const minDuration = 100;
    if (drag.kind === 'audio' && deltaMs && !drag.recorded) { rememberAudioChange(); drag.recorded = true; }
    if (drag.mode === 'move') clip.positionMs = Math.max(0, Math.min(api.MAX_PROJECT_MS - clip.durationMs, drag.positionMs + deltaMs));
    else if (drag.mode === 'start') {
      const sourceStart = Math.max(0, Math.min(drag.assetDurationMs - minDuration, drag.sourceStartMs + deltaMs));
      const change = sourceStart - drag.sourceStartMs;
      clip.sourceStartMs = sourceStart;
      clip.durationMs = Math.max(minDuration, Math.min(drag.assetDurationMs - sourceStart, drag.durationMs - change));
      clip.positionMs = Math.max(0, drag.positionMs + change);
    } else if (drag.mode === 'end') clip.durationMs = Math.max(minDuration, Math.min(drag.assetDurationMs - clip.sourceStartMs, drag.durationMs + deltaMs));
    try { setProject(drag.kind, model(drag.kind)); } catch { return; }
    renderProject(drag.kind);
  }

  function finishProjectDrag() { projectDrag = null; }

  function bindProjectDrop(targetId, kind, mediaKind) {
    const target = byId(targetId);
    target.addEventListener('dragover', event => { event.preventDefault(); target.classList.add('dragging'); });
    target.addEventListener('dragleave', event => { if (!target.contains(event.relatedTarget)) target.classList.remove('dragging'); });
    target.addEventListener('drop', async event => {
      event.preventDefault(); target.classList.remove('dragging');
      const paths = [...event.dataTransfer.files].map(file => file.path || window.ntc.pathForFile(file)).filter(Boolean);
      if (!paths.length) return bridge.showToast('Não foi possível acessar os arquivos arrastados.');
      if (mediaKind === 'image') {
        const images = paths.filter(file => /\.(jpe?g|png|webp|bmp|tiff?|avif|hei[cf])$/i.test(file));
        if (!images.length) return bridge.showToast('Solte arquivos de imagem nesta faixa.');
        return addImagePaths(images);
      }
      const result = await inspectAudioFiles(kind, paths);
      if (kind === 'video') extendLastImageToAudio();
      renderProject(kind);
      if (result.failed) bridge.showToast(`${result.count} faixa(s) adicionada(s); ${result.failed} arquivo(s) ignorado(s).`);
    });
  }

  function bind() {
    updateFolderLabels();
    window.ntc.defaultDownloadFolder().then(value => { if (!bridge.getFolder()) bridge.setFolder(value); updateFolderLabels(); }).catch(() => {});
    $('#audioProjectUndo').onclick = () => navigateAudioHistory(audioUndo, audioRedo);
    $('#audioProjectRedo').onclick = () => navigateAudioHistory(audioRedo, audioUndo);
    $('#audioProjectAddTracks').onclick = () => addProjectAudio('audio');
    $('#audioProjectOpen').onclick = () => openProject('audio');
    $('#audioProjectSave').onclick = () => saveProject('audio');
    $('#audioProjectName').onchange = () => { audioProject.name = $('#audioProjectName').value.trim().slice(0, 100); };
    $('#audioProjectFormat').onchange = () => { rememberAudioChange(); readAudioOutputUi(); renderAudioProject(); };
    $('#audioProjectQuality').onchange = () => { rememberAudioChange(); readAudioOutputUi(); };
    $('#audioProjectOutputName').onchange = () => { rememberAudioChange(); readAudioOutputUi(); };
    for (const field of audioFeatures.METADATA_FIELDS) byId(`audioProjectMetadata${field[0].toUpperCase()}${field.slice(1)}`).onchange = () => { rememberAudioChange(); readAudioOutputUi(); };
    for (const [field, control] of Object.entries({ gain: 'Gain', eqBass: 'Bass', eqMid: 'Mid', eqTreble: 'Treble', normalize: 'Normalize', removeSilence: 'RemoveSilence' })) {
      byId(`audioProject${control}`).onchange = event => {
        const clip = selectedAudioClip(); if (!clip) return;
        rememberAudioChange();
        clip.effects = audioFeatures.normalizeEffects({ ...clip.effects, [field]: event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value) });
        renderAudioClipInspector();
        syncProjectAudio(audioProject, audioPlayers, currentPositionMs('audio'), playbacks.audio.playing);
      };
    }
    function savedPresets() { try { const value = JSON.parse(localStorage.getItem('ntc-audio-presets') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
    function refreshPresets() {
      const select = byId('audioProjectPreset');
      select.innerHTML = '<option value="">Preset de áudio</option><option value="voz">Voz</option><option value="musica">Música</option><option value="podcast">Podcast</option>' + Object.keys(savedPresets()).map(name => `<option value="saved:${text(name)}">${text(name)}</option>`).join('');
    }
    refreshPresets();
    $('#audioProjectPreset').onchange = event => {
      const clip = selectedAudioClip(); if (!clip || !event.target.value) return;
      const value = event.target.value;
      const preset = value.startsWith('saved:') ? savedPresets()[value.slice(6)] : audioFeatures.PRESETS[value];
      if (!preset) return;
      rememberAudioChange(); clip.effects = audioFeatures.normalizeEffects(preset); renderAudioClipInspector();
      syncProjectAudio(audioProject, audioPlayers, currentPositionMs('audio'), playbacks.audio.playing);
    };
    $('#audioProjectSavePreset').onclick = () => {
      const clip = selectedAudioClip(); if (!clip) return bridge.showToast('Selecione um clipe para salvar os efeitos.');
      const name = window.prompt('Nome do preset')?.trim().slice(0, 40); if (!name) return;
      const presets = savedPresets(); presets[name] = audioFeatures.normalizeEffects(clip.effects);
      localStorage.setItem('ntc-audio-presets', JSON.stringify(presets)); refreshPresets();
      window.refreshMusicEqualizerPresets?.(); $('#audioProjectPreset').value = `saved:${name}`;
      bridge.showToast('Preset salvo neste computador.');
    };
    $('#audioProjectApplyEffectsAll').onclick = () => {
      const source = selectedAudioClip(); if (!source) return bridge.showToast('Selecione um clipe primeiro.');
      rememberAudioChange();
      for (const track of audioTracks(audioProject)) for (const clip of track.clips) clip.effects = structuredClone(source.effects);
      syncProjectAudio(audioProject, audioPlayers, currentPositionMs('audio'), playbacks.audio.playing);
      bridge.showToast('Efeitos aplicados a todos os clipes.');
    };
    $('#audioProjectPreviewClip').onclick = () => {
      const clip = selectedAudioClip(); if (!clip) return;
      if (playbacks.audio.playing) stopProject('audio', false);
      seekProject('audio', clip.positionMs);
      playProject('audio', { untilMs: clip.positionMs + clip.durationMs });
    };
    $('#audioProjectAddMarker').onclick = () => {
      const startMs = Math.round(Number($('#audioProjectMarkerStart').value) * 1000);
      const typedEnd = Math.round(Number($('#audioProjectMarkerEnd').value) * 1000);
      const endMs = typedEnd || api.durationMs(audioProject);
      if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 || endMs <= startMs || endMs > api.durationMs(audioProject)) return bridge.showToast('Defina um trecho válido dentro da timeline.');
      rememberAudioChange(); audioProject.markers.push({ id: id(), name: `Trecho ${audioProject.markers.length + 1}`, startMs, endMs }); renderAudioProject();
    };
    $('#audioProjectExportMarkers').onclick = () => renderAudioBatch(audioProject.markers.map(marker => ({ outputName: `${audioProject.output.outputName} - ${marker.name}`, range: { startMs: marker.startMs, endMs: marker.endMs } })));
    $('#audioProjectExportTracks').onclick = () => renderAudioBatch(audioTracks(audioProject).filter(track => track.clips.length).map(track => ({ outputName: `${audioProject.output.outputName} - ${track.name}`, trackId: track.id })));
    $('#audioProjectChooseCover').onclick = async () => {
      const file = await window.ntc.chooseCoverFile(); if (!file) return;
      rememberAudioChange(); audioProject.output.coverPath = file; renderAudioProject();
    };
    $('#audioProjectRemoveCover').onclick = () => { rememberAudioChange(); audioProject.output.coverPath = ''; audioProject.output.preserveSourceCover = false; renderAudioProject(); };
    $('#audioProjectPlay').onclick = () => playbacks.audio.playing ? stopProject('audio', true) : playProject('audio');
    $('#audioProjectStop').onclick = () => stopProject('audio', true);
    bindAudioRange('audio', 'audioProjectSeek');
    $('#audioProjectZoom').oninput = event => { audioTimelineZoom = Number(event.target.value) || 1; renderAudioProject(); };
    document.addEventListener('keydown', event => {
      if (!$('#converterView').classList.contains('active')) return;
      if (event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); navigateAudioHistory(event.shiftKey ? audioRedo : audioUndo, event.shiftKey ? audioUndo : audioRedo); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); navigateAudioHistory(audioRedo, audioUndo); return; }
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seekProject('audio', currentPositionMs('audio') + (event.key === 'ArrowRight' ? 5000 : -5000)); return; }
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (playbacks.audio.playing) stopProject('audio', false);
      else playProject('audio');
    });
    const refreshAudioAfterVisibility = () => {
      if (!playbacks.audio.playing) return;
      const position = currentPositionMs('audio');
      if (position >= api.durationMs(audioProject)) { stopProject('audio', false); return; }
      refreshAudioTransport(position);
      syncProjectAudio(audioProject, audioPlayers, position, true);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAudioAfterVisibility(); });
    window.addEventListener('focus', refreshAudioAfterVisibility);
    $('#audioProjectChooseFolder').onclick = () => chooseProjectFolder('audio');
    $('#audioProjectExport').onclick = () => renderProjectFile('audio');
    $('#audioProjectCancel').onclick = () => cancelProjectRender('audio');
    $('#audioProjectOpenFolder').onclick = () => openProjectRenderFolder('audio');
    $('#audioProjectRetry').onclick = () => renderProjectFile('audio');
    bindProjectDrop('audioProjectTimeline', 'audio', 'audio');
    document.addEventListener('pointermove', updateProjectDrag);
    document.addEventListener('pointerup', finishProjectDrag);
    window.ntc.onMediaProjectEvent(handleRenderEvent);
    renderProject('audio');
  }

  bind();
  window.NTCMediaProjectUi = Object.freeze({ renderAudioProject, importAudioPaths });
})();
