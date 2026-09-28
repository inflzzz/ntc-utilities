(() => {
  'use strict';

  const api = window.NTCMediaProject;
  const playbackClock = window.NTCMediaProjectPlaybackClock;
  const bridge = window.NTCMediaAppBridge;
  if (!api || !playbackClock || !bridge) return;
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

  function setMode(kind, mode) {
    if (kind !== 'audio') return;
    const projectMode = mode === 'project';
    const projectPanel = byId('audioProjectPanel');
    const projectButton = byId('audioProjectMode');
    const legacyButton = byId('audioLegacyMode');
    if (!projectMode && playbacks.audio.playing) stopProject('audio', false);
    projectButton.classList.toggle('active', projectMode);
    legacyButton.classList.toggle('active', !projectMode);
    projectPanel.classList.toggle('hidden', !projectMode);
    ['converterLegacyImport', 'conversionQueueSection'].forEach(id => byId(id).classList.toggle('hidden', projectMode));
  }

  async function inspectAudioFiles(kind, paths) {
    const project = api.normalizeProject(model(kind));
    const remaining = Math.max(0, Math.min(api.MAX_ASSETS - project.assets.length, api.MAX_TRACKS - project.tracks.length));
    const eligible = paths.filter(path => typeof path === 'string' && /\.(mp3|m4a|aac|wav|flac|ogg|opus|wma)$/i.test(path));
    const available = eligible.slice(0, remaining);
    const inspected = await Promise.allSettled(available.map(path => window.ntc.inspectMedia(path)));
    const added = [];
    inspected.forEach(result => {
      if (result.status !== 'fulfilled') return;
      const info = result.value;
      const durationMs = Math.round(Number(info.duration) * 1000);
      if (!Number.isSafeInteger(durationMs) || durationMs < 100) return;
      const mediaDuration = Math.min(api.MAX_PROJECT_MS, durationMs);
      const asset = { id: id(), path: info.path, name: info.name, kind: 'audio', durationMs: mediaDuration, width: 0, height: 0 };
      const track = { id: id(), kind: 'audio', name: info.name, muted: false, volume: 100, clips: [{ id: id(), assetId: asset.id, positionMs: 0, sourceStartMs: 0, durationMs: mediaDuration, volume: 100, muted: false }] };
      project.assets.push(asset);
      project.tracks.push(track);
      added.push(asset);
    });
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
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (!values.length) return;
      const middle = rect.height / 2;
      context.strokeStyle = '#ead6dc';
      context.globalAlpha = .72;
      context.lineWidth = 1;
      for (let x = 0; x < Math.ceil(rect.width); x++) {
        const index = Math.min(values.length - 1, Math.floor(x / Math.max(1, rect.width) * values.length));
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
      const asset = getAsset(project, clip.assetId);
      const left = duration ? clip.positionMs / duration * 100 : 0;
      const width = duration ? Math.max(1.2, clip.durationMs / duration * 100) : 100;
      if (kind === 'video') return `<article class="media-project-track-row${track.muted ? ' is-muted' : ''}" data-project-track-row="${track.id}"><div class="media-project-track-meta"><strong title="${text(track.name)}">${text(track.name)}</strong><div class="media-project-track-controls"><span title="Duração da faixa">${secondsLabel(clip.durationMs)}</span><label aria-label="Volume da faixa">Vol. <input type="range" min="0" max="300" value="${Math.round(track.volume)}" data-project-volume="${track.id}" title="Volume da faixa"></label><button type="button" data-project-mute="${track.id}" aria-pressed="${track.muted}" title="${track.muted ? 'Ativar faixa' : 'Silenciar faixa'}">${track.muted ? 'Silenciado' : 'Silenciar'}</button><button type="button" data-project-remove-track="${track.id}" aria-label="Remover ${text(track.name)}" title="Remover faixa">×</button></div></div><div class="media-project-lane" data-project-lane="${kind}" data-track-id="${track.id}" role="slider" tabindex="0" aria-label="Faixa ${text(track.name)}"><div class="media-project-clip" data-project-clip="${clip.id}" data-track-id="${track.id}" style="left:${left}%;width:${width}%"><canvas data-project-waveform="${clip.id}" data-track-id="${track.id}" aria-hidden="true"></canvas><button class="media-project-clip-handle start" type="button" data-project-edge="start" aria-label="Cortar início do clipe" title="Cortar início do clipe"></button><span title="${text(asset?.name || track.name)}">${text(asset?.name || track.name)}</span><button class="media-project-clip-handle end" type="button" data-project-edge="end" aria-label="Cortar fim do clipe" title="Cortar fim do clipe"></button></div><span class="media-project-playhead" aria-hidden="true"></span></div></article>`;
      return `<article class="media-project-track-row${track.muted ? ' is-muted' : ''}" data-project-track-row="${track.id}"><div class="media-project-track-meta"><strong title="${text(track.name)}">${text(track.name)}</strong><div class="media-project-track-controls"><span title="Duração da faixa">${secondsLabel(clip.durationMs)}</span><label aria-label="Volume da faixa">Vol. <input type="range" min="0" max="300" value="${Math.round(track.volume)}" data-project-volume="${track.id}" title="Volume da faixa"></label><button type="button" data-project-mute="${track.id}" aria-pressed="${track.muted}" title="${track.muted ? 'Ativar faixa' : 'Silenciar faixa'}">${track.muted ? 'Silenciado' : 'Silenciar'}</button><button type="button" data-project-remove-track="${track.id}" aria-label="Remover ${text(track.name)}" title="Remover faixa">×</button></div></div><div class="media-project-lane" data-project-lane="${kind}" data-track-id="${track.id}" aria-label="Faixa ${text(track.name)}"><div class="media-project-clip" data-project-clip="${clip.id}" data-track-id="${track.id}" style="left:${left}%;width:${width}%"><canvas data-project-waveform="${clip.id}" data-track-id="${track.id}" aria-hidden="true"></canvas><button class="media-project-clip-handle start" type="button" data-project-edge="start" aria-label="Cortar início do clipe" title="Cortar início do clipe"></button><span title="${text(asset?.name || track.name)}">${text(asset?.name || track.name)}</span><button class="media-project-clip-handle end" type="button" data-project-edge="end" aria-label="Cortar fim do clipe" title="Cortar fim do clipe"></button></div><span class="media-project-playhead" data-audio-playhead aria-hidden="true"></span></div></article>`;
    }).join('');
    if (kind === 'audio') {
      const ruler = Array.from({ length: 11 }, (_, index) => `<span style="left:${index * 10}%">${secondsLabel(duration * index / 10)}</span>`).join('');
      target.innerHTML = `<div class="audio-project-timeline-content" style="width:max(100%, ${Math.min(100000, Math.max(600, Math.ceil(duration / 1000 * 24 * audioTimelineZoom)))}px)"><div class="audio-project-ruler"><div class="audio-project-ruler-spacer"></div><div class="audio-project-ruler-marks">${ruler}<span class="media-project-playhead" data-audio-playhead aria-hidden="true"></span></div></div>${rows}</div>`;
      updateAudioPlayheads(currentPositionMs('audio'), duration);
    } else target.innerHTML = rows;

    renderWaveforms(target, project, kind);
    target.querySelectorAll('[data-project-volume]').forEach(input => input.oninput = () => {
      const track = project.tracks.find(item => item.id === input.dataset.projectVolume);
      if (track) { track.volume = Math.max(0, Math.min(300, Number(input.value) || 0)); syncProjectAudio(project, players(kind), currentPositionMs(kind), playback(kind).playing); }
    });
    target.querySelectorAll('[data-project-mute]').forEach(button => button.onclick = () => {
      const track = project.tracks.find(item => item.id === button.dataset.projectMute);
      if (track) { track.muted = !track.muted; syncProjectAudio(project, players(kind), currentPositionMs(kind), playback(kind).playing); renderProject(kind); }
    });
    target.querySelectorAll('[data-project-remove-track]').forEach(button => button.onclick = () => {
      const trackId = button.dataset.projectRemoveTrack;
      const track = project.tracks.find(item => item.id === trackId);
      project.tracks = project.tracks.filter(item => item.id !== trackId);
      if (track) {
        const stillUsed = project.tracks.some(item => item.clips.some(clip => clip.assetId === track.clips[0]?.assetId));
        if (!stillUsed) { project.assets = project.assets.filter(asset => asset.id !== track.clips[0]?.assetId); waveforms(kind).delete(track.clips[0]?.assetId); }
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
    $('#audioProjectAssetSummary').textContent = project.assets.length ? `${project.assets.length} ${project.assets.length === 1 ? 'faixa' : 'faixas'} · ${secondsLabel(duration)}` : 'Nenhuma faixa adicionada';
    $('#audioProjectExport').disabled = !project.tracks.some(track => track.kind === 'audio' && track.clips.length) || Boolean(activeRender);
    $('#audioProjectSeek').max = String(Math.max(1, duration));
    const position = currentPositionMs('audio');
    refreshAudioTransport(position);
    renderAudioTracks(project, $('#audioProjectTimeline'), 'audio', duration);
    syncProjectAudio(project, audioPlayers, position, playback('audio').playing);
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
    const audioAssets = project.assets.filter(asset => asset.kind === 'audio');
    const wanted = new Set(audioAssets.map(asset => asset.id));
    for (const [assetId, player] of playerMap) if (!wanted.has(assetId)) { player.pause(); player.removeAttribute('src'); player.load(); playerMap.delete(assetId); }
    audioAssets.forEach(asset => {
      const player = playerMap.get(asset.id) || new Audio();
      if (!playerMap.has(asset.id)) { player.preload = 'auto'; playerMap.set(asset.id, player); }
      if (player.dataset?.projectSource !== asset.path) { player.src = sourceUrl(asset.path); player.dataset.projectSource = asset.path; player.load(); }
    });
  }

  function syncProjectAudio(project, playerMap, positionMs, shouldPlay) {
    ensurePlayers(project, playerMap);
    const active = new Set();
    for (const track of audioTracks(project)) for (const clip of track.clips) {
      const player = playerMap.get(clip.assetId);
      if (!player) continue;
      const inClip = positionMs >= clip.positionMs && positionMs < clip.positionMs + clip.durationMs;
      if (inClip) {
        active.add(clip.assetId);
        const desired = (clip.sourceStartMs + positionMs - clip.positionMs) / 1000;
        if (!Number.isFinite(player.currentTime) || Math.abs(player.currentTime - desired) > .35) { try { player.currentTime = Math.max(0, desired); } catch {} }
        const gain = clip.volume * track.volume / 10000;
        applyProjectGain(player, gain);
        player.muted = clip.muted || track.muted;
        if (shouldPlay && player.paused) player.play().catch(() => {});
        else if (!shouldPlay && !player.paused) player.pause();
      } else if (!player.paused) player.pause();
    }
    for (const [assetId, player] of playerMap) if (!active.has(assetId) && !player.paused) player.pause();
  }

  function applyProjectGain(player, gain) {
    const value = Math.max(0, Math.min(9, Number(gain) || 0));
    try {
      let node = playerGainNodes.get(player);
      if (!node && window.AudioContext) {
        projectAudioContext ||= new AudioContext();
        const source = projectAudioContext.createMediaElementSource(player);
        const gainNode = projectAudioContext.createGain();
        source.connect(gainNode).connect(projectAudioContext.destination);
        node = { source, gainNode };
        playerGainNodes.set(player, node);
      }
      if (node) {
        player.volume = 1;
        node.gainNode.gain.value = value;
      } else player.volume = Math.min(1, value);
    } catch { player.volume = Math.min(1, value); }
  }

  function tickProject(kind, timestamp) {
    const state = playback(kind);
    if (!state.playing) return;
    const project = model(kind);
    const duration = api.durationMs(project);
    state.positionMs = playbackClock.positionAt(state, performance.now(), duration);
    if (state.positionMs >= duration) { state.positionMs = duration; stopProject(kind, false); if (kind === 'video') updateVideoPreview(); return; }
    syncProjectAudio(project, players(kind), state.positionMs, state.playing);
    if (kind === 'video') updateVideoPreview();
    else {
      refreshAudioTransport(state.positionMs);
    }
    state.frame = requestAnimationFrame(time => tickProject(kind, time));
  }

  function playProject(kind) {
    const project = model(kind);
    const duration = api.durationMs(project);
    if (!duration) return bridge.showToast('Adicione faixas ao projeto antes de reproduzir.');
    const state = playback(kind);
    playbackClock.start(state, performance.now(), duration);
    if (projectAudioContext?.state === 'suspended') projectAudioContext.resume().catch(() => {});
    state.positionMs = currentPositionMs(kind);
    syncProjectAudio(project, players(kind), state.positionMs, true);
    if (kind === 'audio') {
      if (audioHeartbeat) clearInterval(audioHeartbeat);
      audioHeartbeat = setInterval(() => {
        if (!playbacks.audio.playing) return;
        const position = currentPositionMs('audio');
        if (position >= api.durationMs(audioProject)) { stopProject('audio', false); return; }
        syncProjectAudio(audioProject, audioPlayers, position, true);
      }, 250);
    }
    state.frame = requestAnimationFrame(time => tickProject(kind, time));
    const button = byId(kind === 'audio' ? 'audioProjectPlay' : 'videoProjectPlay');
    button.textContent = 'Ⅱ Pausar'; button.onclick = () => stopProject(kind, false);
  }

  function stopProject(kind, rewind) {
    const state = playback(kind);
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
    else refreshAudioTransport(state.positionMs);
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
      const result = await window.ntc.saveMediaProject(api.normalizeProject(project));
      if (result) bridge.showToast(`Projeto salvo: ${result.name}`);
    } catch (error) { bridge.showToast(bridge.cleanError(error)); }
  }

  async function renderProjectFile(kind) {
    if (activeRender) return;
    const project = model(kind);
    project.name = byId(kind === 'audio' ? 'audioProjectName' : 'videoProjectName').value.trim().slice(0, 100) || project.name;
    const outputName = byId(kind === 'audio' ? 'audioProjectOutputName' : 'videoProjectOutputName').value.trim() || project.name;
    const format = kind === 'audio' ? byId('audioProjectFormat').value : 'mp4';
    const destination = bridge.getFolder() || await window.ntc.defaultDownloadFolder();
    if (!destination) return bridge.showToast('Escolha uma pasta para salvar o arquivo.');
    const jobId = id();
    activeRender = { id: jobId, kind };
    setRenderUi(kind, { status: 'RENDERIZANDO', percent: 0, meta: kind === 'audio' ? format.toUpperCase() : `${byId('videoProjectResolution').value}p · H.264` });
    renderProject('audio'); renderProject('video');
    try {
      const result = await window.ntc.startMediaProjectRender({ id: jobId, project: api.normalizeProject(project), folder: destination, outputName, format, resolution: byId('videoProjectResolution').value });
      const actualKind = kind === 'audio' ? 'audio' : 'video';
      bridge.addHistory({ title: result.filename, type: actualKind, format: kind === 'audio' ? format.toUpperCase() : 'MP4', quality: kind === 'audio' ? (format === 'wav' ? 'sem perdas' : '192 kbps') : `${byId('videoProjectResolution').value}p · H.264/AAC`, size: bridge.formatBytes(result.size), file: result.file, time: 'Agora', operation: 'conversion' });
      setRenderUi(kind, { status: 'CONCLUÍDO', percent: 100, meta: `Arquivo criado: ${result.filename}`, file: result.file });
      bridge.showToast(kind === 'audio' ? 'Mixdown exportado.' : 'Vídeo exportado.');
    } catch (error) {
      const message = bridge.cleanError(error);
      setRenderUi(kind, /cancelad/i.test(message) ? { status: 'CANCELADO', percent: 0, meta: 'Exportação cancelada.' } : { status: 'ERRO', percent: 0, meta: message });
    } finally {
      activeRender = null;
      renderProject('audio'); renderProject('video');
    }
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

  function cancelProjectRender(kind) { if (activeRender?.kind === kind) window.ntc.cancelMediaProjectRender(activeRender.id); }

  function updateProjectDrag(event) {
    if (!projectDrag) return;
    const drag = projectDrag;
    const { track, clip } = getClip(model(drag.kind), drag.trackId, drag.clipId);
    if (!track || !clip) return;
    const deltaMs = Math.round((event.clientX - drag.startX) / Math.max(1, drag.laneWidth) * drag.timelineMs);
    const minDuration = 100;
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
    setMode('audio', 'project');
    updateFolderLabels();
    window.ntc.defaultDownloadFolder().then(value => { if (!bridge.getFolder()) bridge.setFolder(value); updateFolderLabels(); }).catch(() => {});
    $('#audioProjectMode').onclick = () => setMode('audio', 'project');
    $('#audioLegacyMode').onclick = () => setMode('audio', 'legacy');
    $('#audioProjectAddTracks').onclick = () => addProjectAudio('audio');
    $('#audioProjectOpen').onclick = () => openProject('audio');
    $('#audioProjectSave').onclick = () => saveProject('audio');
    $('#audioProjectName').onchange = () => { audioProject.name = $('#audioProjectName').value.trim().slice(0, 100); };
    $('#audioProjectPlay').onclick = () => playbacks.audio.playing ? stopProject('audio', true) : playProject('audio');
    $('#audioProjectStop').onclick = () => stopProject('audio', true);
    bindAudioRange('audio', 'audioProjectSeek');
    $('#audioProjectZoom').oninput = event => { audioTimelineZoom = Number(event.target.value) || 1; renderAudioProject(); };
    document.addEventListener('keydown', event => {
      if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || !$('#converterView').classList.contains('active') || $('#audioProjectPanel').classList.contains('hidden')) return;
      if (event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
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
  window.NTCMediaProjectUi = Object.freeze({ setMode });
})();
