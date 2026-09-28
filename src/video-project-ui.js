(() => {
  'use strict';
  const model = window.NTCVideoProject;
  const historyModel = window.NTCVideoProjectHistory;
  const clock = window.NTCMediaProjectPlaybackClock;
  const layoutModel = window.NTCVideoProjectLayout;
  const timelineModel = window.NTCVideoProjectTimeline;
  const transformModel = window.NTCVideoProjectTransform;
  const ntc = window.ntc;
  const root = document.getElementById('ntcvEditor');
  if (!model || !historyModel || !clock || !layoutModel || !timelineModel || !transformModel || !ntc || !root) return;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const url = file => encodeURI(`file:///${String(file).replace(/\\/g, '/')}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
  const labelTime = timelineModel.formatTime;
  let project = model.createProject();
  let selected = null;
  let selectedAsset = null;
  let filter = 'all';
  let mediaQuery = '';
  let pxPerSecond = 80;
  let snapping = true;
  let saved = JSON.stringify(project);
  let migrationDirty = false;
  let currentFile = '';
  let recoveryChecked = false;
  let recoveryTimer = 0;
  const editHistory = historyModel.createHistory();
  let renderId = null;
  let renderOutput = '';
  let drag = null;
  let transformDrag = null;
  let selectionOverlaySignature = '';
  let draggedAssetId = null;
  let contextAsset = null;
  let contextTrack = null;
  let previewSignature = '';
  let previewPlayers = new Map();
  let audioPlayers = new Map();
  const previewLayers = new Map();
  const previewSources = new Map();
  const thumbnails = new Map();
  const filmstrips = new Map();
  const filmstripJobs = new Map();
  const waveforms = new Map();
  const missing = new Set();
  let layout = layoutModel.load(localStorage);
  const playback = { positionMs: 0, anchorPositionMs: 0, startedAtMs: null, playing: false };
  const duration = () => model.durationMs(project);
  const position = () => clock.positionAt(playback, performance.now(), duration());
  const isDirty = () => migrationDirty || saved !== JSON.stringify(project);
  const error = message => { $('ntcvStatus').textContent = message instanceof Error ? message.message : String(message); };
  const assetOf = clip => project.assets.find(asset => asset.id === clip.assetId);
  const selectedClip = () => selected ? model.findClip(project, selected) : null;
  function mutate(operation, propagate = false) {
    const before = JSON.stringify(project);
    try {
      operation();
      project = model.normalizeProject(project);
      if (editHistory.record(before, JSON.stringify(project))) refresh();
    } catch (failure) { project = JSON.parse(before); if (selected && !selectedClip()) selected = null; error(failure); refresh(); if (propagate) throw failure; }
  }
  function history(direction) {
    const snapshot = editHistory[direction](JSON.stringify(project));
    if (!snapshot) return;
    project = model.normalizeProject(JSON.parse(snapshot));
    if (selected && !selectedClip()) selected = null;
    refresh();
  }
  function stopPlayers(map, unload = false) { for (const player of map.values()) { player.pause(); if (unload) { player.removeAttribute('src'); player.load(); } } if (unload) map.clear(); }
  function disposePreview() {
    stopPlayers(previewPlayers, true); stopPlayers(audioPlayers, true);
    for (const { element } of previewLayers.values()) element.remove();
    previewLayers.clear(); previewSources.clear(); previewSignature = '';
  }
  function resetPlayback() { clock.pause(playback, performance.now(), duration()); stopPlayers(previewPlayers); stopPlayers(audioPlayers); refreshTransport(); }
  async function importPaths(paths, insert = false, atMs = null, trackId = null) {
    let count = 0;
    let visualCursor = atMs;
    const failures = [];
    for (const path of paths) {
      try {
        const data = await ntc.inspectVideoProjectMedia(path);
        let added = null;
        mutate(() => {
          added = model.importAsset(project, data);
          const chosenTrack = project.tracks.find(track => track.id === trackId);
          const compatibleTrack = chosenTrack?.kind === (added.kind === 'audio' ? 'audio' : 'visual') ? trackId : null;
          if (insert) {
            const clip = model.addClip(project, added.id, compatibleTrack, added.kind === 'audio' ? atMs : visualCursor);
            selected = clip.id;
            if (added.kind !== 'audio') visualCursor = clip.positionMs + clip.durationMs;
          }
        }, true);
        if (!thumbnails.has(added.id) && added.kind !== 'audio') ntc.videoProjectThumbnail(added.path).then(thumbnail => { thumbnails.set(added.id, thumbnail); renderBin(); renderTimeline(); }).catch(() => {});
        if (added.kind === 'audio') loadWaveform(added);
        count++;
      } catch (failure) { failures.push(`${String(path).split(/[\\/]/).pop()}: ${failure.message}`); }
    }
    error(failures.length ? `${count} importado(s). ${failures.join(' · ')}` : `${count} mídia(s) importada(s). Arraste para a timeline.`);
  }
  function fileList(event) { return Array.from(event.dataTransfer?.files || []).map(file => ntc.pathForFile(file)).filter(Boolean); }
  function renderBin() {
    const query = mediaQuery.trim().toLocaleLowerCase('pt-BR');
    const assets = project.assets.filter(asset => (filter === 'all' || asset.kind === filter) && (!query || asset.name.toLocaleLowerCase('pt-BR').includes(query)));
    const list = $('ntcvMediaList');
    list.classList.toggle('is-grid', layout.mediaView === 'grid');
    $('ntcvMediaView').textContent = layout.mediaView === 'grid' ? '☷' : '▦';
    $('ntcvMediaView').title = layout.mediaView === 'grid' ? 'Exibir como lista' : 'Exibir como grade';
    list.innerHTML = assets.length ? assets.map(asset => `<article class="ntcv-media-item${missing.has(asset.id) ? ' is-missing' : ''}${selectedAsset === asset.id ? ' is-selected' : ''}" draggable="true" tabindex="0" data-asset="${escape(asset.id)}" title="${escape(asset.name)}"><div class="ntcv-thumb">${thumbnails.get(asset.id) ? `<img src="${thumbnails.get(asset.id)}" alt="">` : asset.kind === 'audio' ? '♫' : asset.kind === 'video' ? '▶' : '▧'}</div><div class="ntcv-media-meta"><strong title="${escape(asset.name)}">${escape(asset.name)}</strong><span>${asset.kind === 'video' ? 'VÍDEO' : asset.kind === 'image' ? 'IMAGEM' : 'ÁUDIO'} ${asset.durationMs ? `· ${labelTime(asset.durationMs)}` : ''}</span>${missing.has(asset.id) ? '<em>Mídia não encontrada</em>' : ''}</div><div class="ntcv-media-actions"><button data-media-action="insert" data-asset="${escape(asset.id)}" title="Adicionar à timeline" aria-label="Adicionar ${escape(asset.name)} à timeline">＋</button><button data-media-action="locate" data-asset="${escape(asset.id)}" title="${missing.has(asset.id) ? 'Localizar mídia ausente' : 'Abrir pasta da mídia'}" aria-label="${missing.has(asset.id) ? 'Localizar mídia ausente' : 'Abrir pasta da mídia'}">⌕</button><button data-media-action="remove" data-asset="${escape(asset.id)}" title="Remover do projeto" aria-label="Remover ${escape(asset.name)} do projeto">×</button></div></article>`).join('') : `<div class="ntcv-panel-empty">${project.assets.length ? 'Nenhuma mídia corresponde à busca.' : 'Nenhuma mídia importada.<br>Use Importar mídia ou arraste arquivos.'}</div>`;
  }
  function timeWidth() { return Math.max(800, Math.ceil((Math.max(duration(), 10000) / 1000 + 3) * pxPerSecond)); }
  function laneTime(clientX, lane) { return Math.max(0, Math.round((clientX - lane.getBoundingClientRect().left) / pxPerSecond * 1000)); }
  function filmstripMarkup(clip, asset, width) {
    if (!asset || clip.type === 'text' || clip.type === 'audio') return '';
    if (clip.type === 'image') {
      const thumbnail = thumbnails.get(asset.id);
      return thumbnail ? `<span class="ntcv-filmstrip"><img src="${thumbnail}" alt=""></span>` : '';
    }
    const count = timelineModel.filmstripCount(width, pxPerSecond);
    const sourceDurationMs = Math.round(clip.durationMs * clip.speed);
    const key = `${asset.id}:${clip.sourceStartMs}:${sourceDurationMs}:${count}`;
    const frames = filmstrips.get(key) || [];
    return count ? `<span class="ntcv-filmstrip" data-filmstrip-asset="${escape(asset.id)}" data-filmstrip-start="${clip.sourceStartMs}" data-filmstrip-duration="${sourceDurationMs}" data-filmstrip-count="${count}">${frames.map(frame => `<img src="${frame}" alt="">`).join('')}</span>` : '';
  }
  function scheduleFilmstrips() {
    $('ntcvTracks').querySelectorAll('[data-filmstrip-asset]').forEach(container => {
      const key = `${container.dataset.filmstripAsset}:${container.dataset.filmstripStart}:${container.dataset.filmstripDuration}:${container.dataset.filmstripCount}`;
      const cached = filmstrips.get(key);
      if (cached?.length) {
        if (!container.childElementCount) container.innerHTML = cached.map(frame => `<img src="${frame}" alt="">`).join('');
        return;
      }
      if (filmstripJobs.has(key)) return;
      const asset = project.assets.find(item => item.id === container.dataset.filmstripAsset);
      if (!asset || asset.kind !== 'video' || missing.has(asset.id)) return;
      const job = ntc.videoProjectFilmstrip({ file: asset.path, count: Number(container.dataset.filmstripCount), startMs: Number(container.dataset.filmstripStart), durationMs: Number(container.dataset.filmstripDuration) })
        .then(frames => {
          filmstrips.set(key, Array.isArray(frames) ? frames : []);
          root.querySelectorAll(`[data-filmstrip-asset="${CSS.escape(asset.id)}"][data-filmstrip-start="${container.dataset.filmstripStart}"][data-filmstrip-duration="${container.dataset.filmstripDuration}"][data-filmstrip-count="${container.dataset.filmstripCount}"]`).forEach(node => { node.innerHTML = (filmstrips.get(key) || []).map(frame => `<img src="${frame}" alt="">`).join(''); });
        })
        .catch(() => {})
        .finally(() => filmstripJobs.delete(key));
      filmstripJobs.set(key, job);
    });
  }
  function renderTimeline() {
    const width = timeWidth();
    $('ntcvTimelineContent').style.width = `${width + 124}px`;
    const steps = timelineModel.rulerStepSeconds(pxPerSecond, duration());
    const markers = [];
    for (let sec = 0; sec <= width / pxPerSecond; sec += steps) markers.push(`<span style="left:${124 + sec * pxPerSecond}px">${labelTime(sec * 1000)}</span>`);
    $('ntcvRuler').innerHTML = markers.join('');
    $('ntcvTracks').innerHTML = project.tracks.map((track, index) => `<div class="ntcv-track-row" data-track="${escape(track.id)}"><div class="ntcv-track-label"><strong data-track-name="${escape(track.id)}" title="Duplo clique para renomear · ${escape(track.name)}">${track.kind === 'visual' ? `V${project.tracks.filter(t => t.kind === 'visual').length - project.tracks.slice(0, index).filter(t => t.kind === 'visual').length}` : `A${project.tracks.slice(0, index + 1).filter(t => t.kind === 'audio').length}`} · ${escape(track.name)}</strong><div>${track.kind === 'visual' ? `<button data-track-action="visible" title="${track.visible ? 'Ocultar' : 'Mostrar'} faixa" aria-label="${track.visible ? 'Ocultar' : 'Mostrar'} ${escape(track.name)}" aria-pressed="${!track.visible}">${track.visible ? '◉' : '○'}</button>` : `<button data-track-action="mute" title="Silenciar faixa" aria-label="Silenciar ${escape(track.name)}" aria-pressed="${track.muted}">M</button><button data-track-action="solo" title="Ouvir somente esta faixa" aria-label="Solo em ${escape(track.name)}" aria-pressed="${track.solo}">S</button>`}<button data-track-action="lock" title="${track.locked ? 'Desbloquear' : 'Bloquear'} faixa" aria-label="${track.locked ? 'Desbloquear' : 'Bloquear'} ${escape(track.name)}" aria-pressed="${track.locked}">${track.locked ? '▣' : '▢'}</button></div></div><div class="ntcv-lane" style="width:${width}px" data-track="${escape(track.id)}">${track.clips.map(clip => {
      const asset = assetOf(clip);
      const text = clip.type === 'text' ? clip.text.content : asset?.name || 'Mídia';
      const clipWidth = Math.max(8, clip.durationMs / 1000 * pxPerSecond);
      return `<div class="ntcv-clip ntcv-${clip.type}${clip.id === selected ? ' is-selected' : ''}${asset && missing.has(asset.id) ? ' is-missing' : ''}" data-clip="${escape(clip.id)}" title="${escape(text)}" style="left:${clip.positionMs / 1000 * pxPerSecond}px;width:${clipWidth}px"><span class="ntcv-trim" data-trim="start" title="Aparar início" aria-label="Aparar início"></span>${clip.type === 'audio' ? `<canvas class="ntcv-waveform" data-waveform="${escape(asset?.id || '')}" aria-hidden="true"></canvas>` : filmstripMarkup(clip, asset, clipWidth)}<span class="ntcv-clip-name">${clip.type === 'audio' ? '♫ ' : clip.type === 'video' ? '▶ ' : clip.type === 'text' ? 'T ' : '▧ '}${escape(text)}</span><span class="ntcv-trim" data-trim="end" title="Aparar fim" aria-label="Aparar fim"></span></div>`;
    }).join('')}</div></div>`).join('');
    root.dataset.trackDensity = layout.trackDensity;
    $('ntcvTrackDensity').textContent = `Altura: ${layout.trackDensity === 'compact' ? 'compacta' : layout.trackDensity === 'expanded' ? 'ampla' : 'normal'}`;
    $('ntcvTimelineEmpty').hidden = project.tracks.every(track => !track.clips.length);
    updatePlayhead();
    requestAnimationFrame(() => { drawWaveforms(); scheduleFilmstrips(); });
  }
  function drawWaveforms() {
    $('ntcvTracks').querySelectorAll('canvas[data-waveform]').forEach(canvas => {
      const values = waveforms.get(canvas.dataset.waveform);
      if (!values?.length) return;
      const width = Math.max(1, Math.round(canvas.clientWidth));
      const height = Math.max(1, Math.round(canvas.clientHeight));
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      context.strokeStyle = '#c0b0b7'; context.globalAlpha = .65;
      for (let x = 0; x < width; x += 2) {
        const magnitude = Math.max(.03, values[Math.min(values.length - 1, Math.floor(x / width * values.length))] || 0) * height * .42;
        context.beginPath(); context.moveTo(x + .5, height / 2 - magnitude); context.lineTo(x + .5, height / 2 + magnitude); context.stroke();
      }
    });
  }
  function loadWaveform(asset) {
    if (waveforms.has(asset.id) || missing.has(asset.id)) return;
    ntc.getWaveform(asset.path).then(values => { waveforms.set(asset.id, values); drawWaveforms(); }).catch(() => {});
  }
  function updatePlayhead() {
    const x = 124 + position() / 1000 * pxPerSecond;
    $('ntcvPlayhead').style.left = `${x}px`;
  }
  function changeZoom(next) {
    const scroll = $('ntcvTimelineScroll');
    const centerTime = Math.max(0, (scroll.scrollLeft + scroll.clientWidth / 2 - 124) / pxPerSecond);
    pxPerSecond = Math.max(.05, Math.min(240, Math.round(Number(next) * 100) / 100));
    $('ntcvZoom').value = String(pxPerSecond);
    renderTimeline();
    scroll.scrollLeft = Math.max(0, 124 + centerTime * pxPerSecond - scroll.clientWidth / 2);
  }
  function changeZoomAt(next, clientX) {
    const scroll = $('ntcvTimelineScroll'); const rect = scroll.getBoundingClientRect();
    const anchor = Math.max(0, clientX - rect.left);
    const time = Math.max(0, (scroll.scrollLeft + anchor - 124) / pxPerSecond);
    pxPerSecond = Math.max(.05, Math.min(240, Math.round(Number(next) * 100) / 100));
    $('ntcvZoom').value = String(pxPerSecond); renderTimeline();
    scroll.scrollLeft = Math.max(0, 124 + time * pxPerSecond - anchor);
  }
  function renderInspector() {
    const section = (title, content, open = true) => `<details class="ntcv-inspector-section" ${open ? 'open' : ''}><summary>${title}</summary><div class="ntcv-inspector-section-body">${content}</div></details>`;
    const field = (label, key, value, type = 'number', min = '', max = '', step = '1', unit = '') => `<label class="ntcv-field-row"><span>${label}</span><span class="ntcv-field-control"><input data-clip-field="${key}" type="${type}" value="${escape(value)}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} step="${step}">${unit ? `<span>${unit}</span>` : ''}</span></label>`;
    const select = (label, key, options) => `<label class="ntcv-field-row"><span>${label}</span><span class="ntcv-field-control"><select data-clip-field="${key}">${options}</select></span></label>`;
    const found = selectedClip();
    if (!found) {
      const s = project.settings;
      const projectFields = `<label class="ntcv-field-row"><span>Nome</span><span class="ntcv-field-control"><input data-project-field="name" maxlength="100" value="${escape(project.name)}"></span></label><label class="ntcv-field-row"><span>Resolução</span><span class="ntcv-field-control"><select data-project-field="resolution"><option value="1080" ${s.resolution === '1080' ? 'selected' : ''}>1080p</option><option value="720" ${s.resolution === '720' ? 'selected' : ''}>720p</option></select></span></label><label class="ntcv-field-row"><span>Proporção</span><span class="ntcv-field-control"><select data-project-field="aspectRatio">${Object.keys(model.ASPECTS).map(value => `<option ${s.aspectRatio === value ? 'selected' : ''}>${value}</option>`).join('')}</select></span></label><label class="ntcv-field-row"><span>FPS</span><span class="ntcv-field-control"><select data-project-field="fps">${model.FPS.map(value => `<option ${s.fps === value ? 'selected' : ''}>${value}</option>`).join('')}</select></span></label><label class="ntcv-field-row"><span>Fundo</span><span class="ntcv-field-control"><input data-project-field="background" type="color" value="${escape(s.background)}"></span></label>`;
      $('ntcvInspector').innerHTML = `<div class="ntcv-inspector-fields"><div class="ntcv-inspector-header"><strong>${escape(project.name)}</strong><small>${project.assets.length} mídia(s) · ${labelTime(duration())}</small></div>${section('PROJETO', projectFields)}</div>`;
      return;
    }
    const { clip, asset, track } = found;
    const timing = `${field('Início', 'Início (s)', (clip.positionMs / 1000).toFixed(2), 'number', '0', '86400', '.01', 's')}${field('Duração', 'Duração (s)', (clip.durationMs / 1000).toFixed(2), 'number', '.1', '86400', '.01', 's')}${clip.type === 'video' || clip.type === 'audio' ? select('Velocidade', 'Velocidade', model.SPEEDS.map(value => `<option value="${value}" ${clip.speed === value ? 'selected' : ''}>${value}×</option>`).join('')) : ''}`;
    const fades = `${field('Entrada', 'Fade in (s)', (clip.fadeInMs / 1000).toFixed(2), 'number', '0', clip.durationMs / 1000, '.01', 's')}${field('Saída', 'Fade out (s)', (clip.fadeOutMs / 1000).toFixed(2), 'number', '0', clip.durationMs / 1000, '.01', 's')}`;
    const t = clip.transform;
    const visual = t ? `${select('Encaixe', 'Encaixe', `<option value="fit" ${t.fit === 'fit' ? 'selected' : ''}>Ajustar</option><option value="fill" ${t.fit === 'fill' ? 'selected' : ''}>Preencher</option>`)}${field('Posição X', 'X (%)', t.x, 'number', '-200', '200', '1', '%')}${field('Posição Y', 'Y (%)', t.y, 'number', '-200', '200', '1', '%')}${field('Escala', 'Escala (%)', t.scale, 'number', '10', '400', '1', '%')}${field('Rotação', 'Rotação (°)', t.rotation, 'number', '-180', '180', '1', '°')}${field('Opacidade', 'Opacidade (%)', t.opacity, 'number', '0', '100', '1', '%')}<label class="ntcv-inline"><input data-clip-field="flipX" type="checkbox" ${t.flipX ? 'checked' : ''}>Espelhar horizontalmente</label><label class="ntcv-inline"><input data-clip-field="flipY" type="checkbox" ${t.flipY ? 'checked' : ''}>Espelhar verticalmente</label>` : '';
    const crop = t ? `${field('Esquerda', 'Crop left (%)', t.crop.left, 'number', '0', '90', '1', '%')}${field('Direita', 'Crop right (%)', t.crop.right, 'number', '0', '90', '1', '%')}${field('Superior', 'Crop top (%)', t.crop.top, 'number', '0', '90', '1', '%')}${field('Inferior', 'Crop bottom (%)', t.crop.bottom, 'number', '0', '90', '1', '%')}` : '';
    const audio = clip.type === 'video' || clip.type === 'audio' ? `${field('Clipe', 'Volume (%)', clip.volume, 'number', '0', '300', '1', '%')}${field('Faixa', 'Volume da faixa (%)', track.volume, 'number', '0', '300', '1', '%')}<label class="ntcv-inline"><input data-clip-field="Silenciar" type="checkbox" ${clip.muted ? 'checked' : ''}>Silenciar clipe</label>${fades}` : '';
    const textFields = clip.type === 'text' ? `<label><span>Texto</span><textarea data-clip-field="Texto" maxlength="500">${escape(clip.text.content)}</textarea></label>${select('Fonte', 'Fonte', model.FONTS.map(font => `<option ${clip.text.font === font ? 'selected' : ''}>${font}</option>`).join(''))}${field('Tamanho', 'Tamanho', clip.text.size, 'number', '12', '240', '1', 'px')}${select('Peso', 'Peso', `<option value="400" ${clip.text.weight === 400 ? 'selected' : ''}>Regular</option><option value="700" ${clip.text.weight === 700 ? 'selected' : ''}>Negrito</option>`)}${select('Alinhamento', 'Alinhamento', ['left', 'center', 'right'].map(value => `<option value="${value}" ${clip.text.align === value ? 'selected' : ''}>${value === 'left' ? 'Esquerda' : value === 'right' ? 'Direita' : 'Centro'}</option>`).join(''))}<label class="ntcv-field-row"><span>Cor</span><span class="ntcv-field-control"><input data-clip-field="Cor" type="color" value="${clip.text.color}"></span></label>` : '';
    $('ntcvInspector').innerHTML = `<div class="ntcv-inspector-fields"><div class="ntcv-inspector-header"><strong title="${escape(asset?.name || clip.text?.content || '')}">${escape(asset?.name || 'Texto')}</strong><small>${clip.type.toUpperCase()} · ${escape(track.name)}${asset?.width ? ` · ${asset.width}×${asset.height}` : ''}</small></div>${section('TEMPO', timing)}${clip.type === 'text' ? section('TEXTO', textFields) : ''}${t ? section('TRANSFORMAR', visual) + section('RECORTE', crop, false) : ''}${audio ? section('ÁUDIO', audio) : t ? section('VISUAL', fades, false) : ''}<div class="ntcv-inspector-actions">${t ? '<button data-ntcv="center-transform" title="Centralizar camada">Centralizar</button><button data-ntcv="fit-transform" title="Ajustar à tela">Ajustar</button><button data-ntcv="fill-transform" title="Preencher a tela">Preencher</button><button data-ntcv="reset-transform">Resetar</button><button data-ntcv="rotate-left" title="Girar 90° à esquerda">↶ 90°</button><button data-ntcv="rotate-right" title="Girar 90° à direita">↷ 90°</button>' : ''}<button data-ntcv="split">Dividir</button><button data-ntcv="duplicate">Duplicar</button><button data-ntcv="delete">Remover</button></div></div>`;
  }
  function refreshTransport() {
    const at = position();
    $('ntcvClock').textContent = `${labelTime(at)} / ${labelTime(duration())}`;
    $('ntcvSeek').value = duration() ? String(Math.round(at / duration() * 1000)) : '0';
    $('ntcvPlay').textContent = playback.playing ? 'Ⅱ' : '▶';
    updatePlayhead();
  }
  function refresh() {
    $('ntcvProjectTitle').textContent = `${project.name}${isDirty() ? ' *' : ''}`;
    $('ntcvPreviewFormat').textContent = `${project.settings.aspectRatio} · ${project.settings.resolution}p`;
    const dims = model.canvasDimensions(project.settings);
    $('ntcvCanvas').style.aspectRatio = `${dims.width} / ${dims.height}`;
    layoutCanvas();
    $('ntcvCanvas').style.background = project.settings.background;
    $('ntcvPreviewEmpty').hidden = model.hasPreviewContent(project);
    root.querySelector('[data-ntcv="undo"]').disabled = !editHistory.canUndo;
    root.querySelector('[data-ntcv="redo"]').disabled = !editHistory.canRedo;
    renderBin(); renderTimeline(); renderInspector(); refreshTransport(); updatePreview(true); updateSelectionOverlay();
    clearTimeout(recoveryTimer);
    if (recoveryChecked && isDirty()) recoveryTimer = setTimeout(() => ntc.saveVideoProjectRecovery(project).catch(error), 500);
  }
  function layoutCanvas() {
    const surround = root.querySelector('.ntcv-preview-surround');
    const availableWidth = Math.max(0, surround.clientWidth - 40);
    const availableHeight = Math.max(0, surround.clientHeight - 24);
    if (!availableWidth || !availableHeight) return;
    const dims = model.canvasDimensions(project.settings);
    const width = Math.min(availableWidth, availableHeight * dims.width / dims.height);
    $('ntcvCanvas').style.width = `${Math.round(width)}px`;
    $('ntcvCanvas').style.height = `${Math.round(width * dims.height / dims.width)}px`;
  }
  function projectPoint(event) {
    const rect = $('ntcvCanvas').getBoundingClientRect();
    const dims = model.canvasDimensions(project.settings);
    return { x: (event.clientX - rect.left) / Math.max(1, rect.width) * dims.width, y: (event.clientY - rect.top) / Math.max(1, rect.height) * dims.height };
  }
  function updateSelectionOverlay() {
    const overlay = $('ntcvTransformOverlay');
    if (!overlay) return;
    const found = selectedClip();
    const active = found && activeVisual(position()).some(item => item.clip.id === found.clip.id);
    if (!found || !found.clip.transform || !active) { overlay.hidden = true; selectionOverlaySignature = ''; return; }
    const dims = model.canvasDimensions(project.settings);
    const rect = $('ntcvCanvas').getBoundingClientRect();
    const signature = `${found.clip.id}:${JSON.stringify(found.clip.transform)}:${rect.width}x${rect.height}:${found.track.locked}`;
    if (!overlay.hidden && signature === selectionOverlaySignature) return;
    selectionOverlaySignature = signature;
    const sx = rect.width / dims.width; const sy = rect.height / dims.height;
    const g = transformModel.geometry(found.clip, found.asset, dims);
    const box = overlay.querySelector('.ntcv-selection-box');
    box.style.left = `${(g.visibleCenter.x - g.width / 2) * sx}px`;
    box.style.top = `${(g.visibleCenter.y - g.height / 2) * sy}px`;
    box.style.width = `${g.width * sx}px`; box.style.height = `${g.height * sy}px`;
    box.style.transform = `rotate(${g.rotation}deg)`;
    const locked = found.track.locked;
    overlay.hidden = false;
    overlay.classList.toggle('is-locked', locked);
    overlay.querySelectorAll('[data-transform-handle]').forEach(handle => { handle.disabled = locked; });
  }
  function startTransform(event, mode) {
    const found = selectedClip();
    if (!found || found.track.locked || !activeVisual(position()).some(item => item.clip.id === found.clip.id)) return;
    const point = projectPoint(event);
    const dims = model.canvasDimensions(project.settings);
    const geometry = transformModel.geometry(found.clip, found.asset, dims);
    const original = structuredClone(found.clip.transform);
    transformDrag = {
      clipId: found.clip.id, mode, before: JSON.stringify(project), original,
      start: point, center: geometry.center,
      startDistance: Math.hypot(point.x - geometry.center.x, point.y - geometry.center.y),
      startAngle: Math.atan2(point.y - geometry.center.y, point.x - geometry.center.x) * 180 / Math.PI,
      dims, pointerId: event.pointerId
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }
  function applyTransformDrag(event) {
    if (!transformDrag || transformDrag.pointerId !== event.pointerId) return;
    const dragState = transformDrag;
    const found = model.findClip(project, dragState.clipId);
    if (!found) return;
    const point = projectPoint(event); const t = found.clip.transform; const start = dragState.start;
    if (dragState.mode === 'move') {
      t.x = Math.max(-200, Math.min(200, Math.round(dragState.original.x + (point.x - start.x) / dragState.dims.width * 100)));
      t.y = Math.max(-200, Math.min(200, Math.round(dragState.original.y + (point.y - start.y) / dragState.dims.height * 100)));
    } else if (dragState.mode === 'rotate') {
      const angle = Math.atan2(point.y - dragState.center.y, point.x - dragState.center.x) * 180 / Math.PI;
      t.rotation = transformModel.snappedAngle(dragState.original.rotation + angle - dragState.startAngle);
    } else if (dragState.mode === 'scale') {
      const distance = Math.hypot(point.x - dragState.center.x, point.y - dragState.center.y);
      t.scale = transformModel.scaleFromDrag(dragState.original.scale, dragState.startDistance, distance);
    }
    const node = $('ntcvPreviewLayer').querySelector(`[data-preview-clip="${CSS.escape(dragState.clipId)}"]`);
    if (node) styleLayer(node, t, found.clip, found.asset);
    updateSelectionOverlay();
  }
  function finishTransform(event, canceled = false) {
    if (!transformDrag || (event?.pointerId !== undefined && transformDrag.pointerId !== event.pointerId)) return;
    const current = transformDrag; transformDrag = null;
    if (canceled) project = model.normalizeProject(JSON.parse(current.before));
    else editHistory.record(current.before, JSON.stringify(project));
    refresh();
  }
  function selectPreviewAt(event) {
    const point = projectPoint(event);
    const topmost = activeVisual(position()).slice().reverse().find(item => transformModel.contains(item.clip, item.asset, model.canvasDimensions(project.settings), point));
    const next = topmost?.clip.id || null;
    if (selected === next) return next;
    selected = next; renderTimeline(); renderInspector(); updateSelectionOverlay();
    return next;
  }
  $('ntcvCanvas').addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const handle = event.target.closest('[data-transform-handle]');
    if (handle) { startTransform(event, handle.dataset.transformHandle); return; }
    if (event.target.closest('button')) return;
    const selectedAtPoint = selectPreviewAt(event);
    if (selectedAtPoint) startTransform(event, 'move');
  });
  document.addEventListener('pointermove', applyTransformDrag);
  document.addEventListener('pointerup', event => finishTransform(event));
  document.addEventListener('pointercancel', event => finishTransform(event, true));
  function textSvgSource(input) {
    const escapeXml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const lines = input.content.split('\n').slice(0, 8);
    const x = input.align === 'left' ? 20 : input.align === 'right' ? 1580 : 800;
    const anchor = input.align === 'left' ? 'start' : input.align === 'right' ? 'end' : 'middle';
    const y = 200 - (lines.length - 1) * input.size * .6;
    const tspans = lines.map((line, index) => `<tspan x="${x}" dy="${index ? input.size * 1.2 : 0}">${escapeXml(line)}</tspan>`).join('');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" fill="${input.color}" font-family="${escapeXml(input.font)}" font-weight="${input.weight}" font-size="${input.size}">${tspans}</text></svg>`)}`;
  }
  function styleLayer(element, transform, clip, asset) {
    const t = transform || model.defaultTransform();
    const dims = model.canvasDimensions(project.settings);
    const size = transformModel.contentSize(clip, asset, dims);
    element.style.left = '50%'; element.style.top = '50%';
    element.style.width = `${size.width / dims.width * 100}%`; element.style.height = `${size.height / dims.height * 100}%`;
    element.style.transform = `translate(calc(-50% + ${t.x}cqw), calc(-50% + ${t.y}cqh)) rotate(${t.rotation}deg) scale(${t.scale / 100 * (t.flipX ? -1 : 1)}, ${t.scale / 100 * (t.flipY ? -1 : 1)})`;
    element.style.opacity = String(t.opacity / 100);
    const media = element.querySelector('.ntcv-layer-source');
    if (media) {
      const crop = t.crop;
      const fractionX = Math.max(.01, 1 - (crop.left + crop.right) / 100);
      const fractionY = Math.max(.01, 1 - (crop.top + crop.bottom) / 100);
      media.style.width = `${100 / fractionX}%`; media.style.height = `${100 / fractionY}%`;
      media.style.left = `${-crop.left / fractionX}%`; media.style.top = `${-crop.top / fractionY}%`;
    }
  }
  function ensureSource(asset) {
    const token = `${asset.id}:${asset.path}`;
    if (!previewSources.has(token)) {
      const pending = ntc.videoProjectPreviewSource(asset.path).catch(failure => { previewSources.delete(token); throw failure; });
      previewSources.set(token, pending);
    }
    return previewSources.get(token);
  }
  function ensurePreviewLayer(clip, asset, track) {
    let prepared = previewLayers.get(clip.id);
    if (prepared) {
      prepared.lastUsed = performance.now(); prepared.clip = clip; prepared.asset = asset; prepared.trackId = track.id;
      styleLayer(prepared.element, clip.transform, clip, asset);
      if (clip.type === 'text') {
        const source = textSvgSource(clip.text);
        if (prepared.textSource !== source) { prepared.textSource = source; prepared.media.src = source; }
      }
      else if (asset) loadPreviewSource(prepared, asset, track);
      return prepared;
    }
    const element = document.createElement('div'); element.className = 'ntcv-layer-frame';
    const media = document.createElement(clip.type === 'text' || clip.type === 'image' ? 'img' : 'video');
    media.className = 'ntcv-layer-source';
    if (clip.type === 'text') {
      media.alt = ''; media.decoding = 'async'; preparedTextSource(media, clip.text);
    } else if (clip.type === 'image') {
      media.alt = ''; media.decoding = 'async';
    } else {
      media.preload = 'auto'; media.playsInline = true; media.muted = true;
      previewPlayers.set(clip.id, media);
    }
    element.classList.add('ntcv-layer'); element.dataset.previewClip = clip.id; element.dataset.previewType = clip.type;
    element.appendChild(media);
    prepared = { element, media, clip, asset, trackId: track.id, lastUsed: performance.now(), ready: false, textSource: clip.type === 'text' ? textSvgSource(clip.text) : '' };
    previewLayers.set(clip.id, prepared);
    styleLayer(element, clip.transform, clip, asset);
    if (clip.type !== 'text' && asset) loadPreviewSource(prepared, asset, track);
    return prepared;
  }
  function preparedTextSource(media, text) { media.src = textSvgSource(text); }
  function loadPreviewSource(prepared, asset, track) {
    const { media, clip } = prepared;
    const token = `${asset.id}:${asset.path}`;
    if (prepared.sourceToken === token || prepared.requestedSourceToken === token) return;
    prepared.requestedSourceToken = token;
    ensureSource(asset).then(file => {
      if (previewLayers.get(clip.id) !== prepared || prepared.requestedSourceToken !== token) return;
      prepared.sourceToken = token;
      prepared.ready = false;
      if (media.dataset.sourceToken !== token) {
        if (media instanceof HTMLVideoElement) media.pause();
        media.removeAttribute('src');
        media.load?.();
        media.dataset.sourceToken = token;
        media.src = url(file);
      }
      if (clip.type === 'video') {
        let metadataHandled = false;
        const onMetadata = () => {
          if (metadataHandled || prepared.sourceToken !== token) return;
          metadataHandled = true;
          const currentClip = prepared.clip; const currentTrack = project.tracks.find(item => item.id === prepared.trackId) || track;
          const expected = currentClip.sourceStartMs / 1000;
          try { if (Math.abs(media.currentTime - expected) > .08) media.currentTime = expected; } catch { /* Mantém o preload sem seek se o decoder ainda não aceitar o ponto. */ }
          prepared.ready = true;
          const at = position();
          if (at >= currentClip.positionMs && at < currentClip.positionMs + currentClip.durationMs) syncPlayer(media, currentClip, at, currentClip.muted || currentTrack.muted ? 0 : currentClip.volume * currentTrack.volume / 10000);
        };
        media.addEventListener('loadedmetadata', onMetadata, { once: true });
        media.load();
        if (media.readyState >= 1) onMetadata();
      } else {
        const decoded = media.decode?.();
        Promise.resolve(decoded).catch(() => {}).finally(() => { if (prepared.sourceToken === token) prepared.ready = true; });
      }
    }).catch(() => { if (prepared.requestedSourceToken === token) missing.add(asset.id); });
  }
  function prepareAudio(clip, track, asset) {
    let player = audioPlayers.get(clip.id);
    if (player) return player;
    if (!asset || missing.has(asset.id)) return null;
    player = new Audio(url(asset.path)); player.preload = 'auto'; player.volume = 0;
    audioPlayers.set(clip.id, player);
    player.load();
    player.addEventListener('loadedmetadata', () => {
      if (activeAudio(position()).some(item => item.clip.id === clip.id)) syncPlayer(player, clip, position(), clip.volume * track.volume / 10000);
    }, { once: true });
    return player;
  }
  function prunePreviewCaches(activeIds, warmIds) {
    const retain = new Set([...activeIds, ...warmIds]);
    for (const [id, prepared] of previewLayers) {
      if (retain.has(id)) continue;
      if (prepared.media instanceof HTMLVideoElement) { prepared.media.pause(); prepared.media.removeAttribute('src'); prepared.media.load(); prepared.element.remove(); }
      else prepared.element.remove();
      previewLayers.delete(id); previewPlayers.delete(id);
    }
    for (const [id, player] of audioPlayers) {
      if (retain.has(id)) continue;
      player.pause(); player.removeAttribute('src'); player.load(); audioPlayers.delete(id);
    }
    const usedAssets = new Set([...project.tracks.flatMap(track => track.clips.filter(clip => retain.has(clip.id)).map(clip => clip.assetId)).filter(Boolean)]);
    for (const token of previewSources.keys()) if (![...usedAssets].some(id => token.startsWith(`${id}:`))) previewSources.delete(token);
  }
  function activeVisual(at) {
    return project.tracks.filter(track => track.kind === 'visual' && track.visible).reverse().flatMap(track => track.clips.filter(clip => at >= clip.positionMs && at < clip.positionMs + clip.durationMs).map(clip => ({ clip, track, asset: assetOf(clip) })));
  }
  function activeAudio(at) {
    const solo = project.tracks.some(track => track.kind === 'audio' && track.solo);
    return project.tracks.filter(track => track.kind === 'audio' && !track.muted && (!solo || track.solo)).flatMap(track => track.clips.filter(clip => !clip.muted && at >= clip.positionMs && at < clip.positionMs + clip.durationMs).map(clip => ({ clip, track, asset: assetOf(clip) })));
  }
  function syncPlayer(player, clip, at, volume) {
    const expected = (clip.sourceStartMs + (at - clip.positionMs) * clip.speed) / 1000;
    player.playbackRate = clip.speed;
    player.volume = Math.max(0, Math.min(1, volume));
    player.muted = volume <= 0;
    if (player.readyState && Math.abs(player.currentTime - expected) > (playback.playing ? .4 : .06)) {
      try { player.currentTime = Math.max(0, expected); } catch { /* Metadata may still be loading. */ }
    }
    if (playback.playing && player.paused) player.play().catch(() => {});
    if (!playback.playing && !player.paused) player.pause();
  }
  function updatePreview(force = false) {
    const at = position();
    const active = activeVisual(at);
    const signature = active.map(({ clip }) => clip.id).join('|') + `:${project.settings.aspectRatio}:${project.settings.resolution}`;
    const lookahead = Math.max(2000, clipBoundaryLookaheadMs());
    const upcoming = project.tracks.filter(track => track.kind === 'visual' && track.visible).flatMap(track => track.clips.filter(clip => clip.positionMs > at && clip.positionMs <= at + lookahead).map(clip => ({ clip, track, asset: assetOf(clip) })));
    const soloAudio = project.tracks.some(track => track.kind === 'audio' && track.solo);
    const upcomingAudio = project.tracks.filter(track => track.kind === 'audio' && !track.muted && (!soloAudio || track.solo)).flatMap(track => track.clips.filter(clip => !clip.muted && clip.positionMs > at && clip.positionMs <= at + lookahead).map(clip => ({ clip, track, asset: assetOf(clip) })));
    const stage = $('ntcvPreviewLayer');
    const warmVisual = upcoming.sort((a, b) => a.clip.positionMs - b.clip.positionMs).slice(0, 12);
    const warmAudio = upcomingAudio.sort((a, b) => a.clip.positionMs - b.clip.positionMs).slice(0, 8);
    for (const item of [...active, ...warmVisual]) {
      if (item.clip.type !== 'text' && (!item.asset || missing.has(item.asset.id))) continue;
      const prepared = ensurePreviewLayer(item.clip, item.asset, item.track);
    }
    if (force || previewSignature !== signature) {
      const activeIds = new Set(active.map(item => item.clip.id));
      for (const [id, prepared] of previewLayers) prepared.element.hidden = !activeIds.has(id);
      for (const { clip } of active) {
        const prepared = previewLayers.get(clip.id);
        if (!prepared) continue;
        prepared.element.hidden = false;
        stage.appendChild(prepared.element);
      }
      previewSignature = signature;
    }
    for (const item of warmAudio) prepareAudio(item.clip, item.track, item.asset);
    for (const [id, player] of previewPlayers) if (!active.some(item => item.clip.id === id)) player.pause();
    const warmIds = [...warmVisual, ...warmAudio].map(item => item.clip.id);
    const activeIds = active.map(item => item.clip.id);
    for (const { clip, track } of active) {
      const player = previewPlayers.get(clip.id);
      const elapsed = at - clip.positionMs;
      const fade = Math.max(0, Math.min(1, clip.fadeInMs ? elapsed / clip.fadeInMs : 1, clip.fadeOutMs ? (clip.durationMs - elapsed) / clip.fadeOutMs : 1));
      const layer = $('ntcvPreviewLayer').querySelector(`[data-preview-clip="${CSS.escape(clip.id)}"]`);
      if (layer) layer.style.opacity = String(clip.transform.opacity / 100 * fade);
      const solo = project.tracks.some(item => item.kind === 'audio' && item.solo);
      if (player?.src) syncPlayer(player, clip, at, clip.muted || track.muted || solo ? 0 : clip.volume * track.volume / 10000 * fade);
    }
    const audible = activeAudio(at);
    const audibleIds = new Set(audible.map(({ clip }) => clip.id));
    for (const [id, player] of audioPlayers) if (!audibleIds.has(id)) player.pause();
    for (const { clip, track, asset } of audible) {
      if (!asset || missing.has(asset.id)) continue;
      const player = prepareAudio(clip, track, asset);
      if (!player) continue;
      const elapsed = at - clip.positionMs;
      const fade = Math.min(1, clip.fadeInMs ? elapsed / clip.fadeInMs : 1, clip.fadeOutMs ? (clip.durationMs - elapsed) / clip.fadeOutMs : 1);
      syncPlayer(player, clip, at, clip.volume * track.volume / 10000 * Math.max(0, fade));
    }
    prunePreviewCaches(new Set([...activeIds, ...audibleIds]), new Set(warmIds));
    updateSelectionOverlay();
  }
  function clipBoundaryLookaheadMs() { return playback.playing ? 3500 : 2000; }
  let animationFrame = 0;
  function frame() {
    if (!playback.playing) return;
    if (position() >= duration()) { resetPlayback(); clock.seek(playback, duration(), performance.now(), duration()); refreshTransport(); updatePreview(); return; }
    refreshTransport(); updatePreview();
    animationFrame = requestAnimationFrame(frame);
  }
  function seek(at) { clock.seek(playback, at, performance.now(), duration()); refreshTransport(); updatePreview(); }
  function pause() { clock.pause(playback, performance.now(), duration()); cancelAnimationFrame(animationFrame); refreshTransport(); updatePreview(); }
  function play() {
    if (playback.playing) return pause();
    if (!duration()) return;
    clock.start(playback, performance.now(), duration()); refreshTransport(); updatePreview(); frame();
  }
  function stop() { pause(); seek(0); }
  function isTextTarget(target) { return Boolean(target.closest('input,textarea,select,button,[contenteditable="true"]')); }
  function changeInspector(target) {
    if (target.dataset.projectField) {
      mutate(() => {
        const field = target.dataset.projectField;
        if (field === 'name') project.name = target.value.trim() || 'Novo projeto';
        else project.settings[field] = field === 'fps' ? Number(target.value) : target.value;
      });
      return;
    }
    if (!target.dataset.clipField) return;
    mutate(() => {
      const found = selectedClip(); if (!found) return;
      const c = found.clip; const field = target.dataset.clipField;
      const numeric = Number(target.value);
      if (field === 'Início (s)') c.positionMs = Math.round(numeric * 1000);
      else if (field === 'Duração (s)') c.durationMs = Math.round(numeric * 1000);
      else if (field === 'Velocidade') { const previous = c.speed; c.speed = numeric; if (c.type === 'audio' || c.type === 'video') c.durationMs = Math.round(c.durationMs * previous / numeric); }
      else if (field === 'Volume (%)') c.volume = numeric;
      else if (field === 'Volume da faixa (%)') found.track.volume = numeric;
      else if (field === 'Silenciar') c.muted = target.checked;
      else if (field === 'Fade in (s)') c.fadeInMs = Math.round(numeric * 1000);
      else if (field === 'Fade out (s)') c.fadeOutMs = Math.round(numeric * 1000);
      else if (field === 'Encaixe') c.transform.fit = target.value;
      else if (field === 'X (%)') c.transform.x = numeric;
      else if (field === 'Y (%)') c.transform.y = numeric;
      else if (field === 'Escala (%)') c.transform.scale = numeric;
      else if (field === 'Rotação (°)') c.transform.rotation = numeric;
      else if (field === 'Opacidade (%)') c.transform.opacity = numeric;
      else if (field.startsWith('Crop ')) c.transform.crop[field.split(' ')[1]] = numeric;
      else if (field === 'flipX' || field === 'flipY') c.transform[field] = target.checked;
      else if (field === 'Texto') c.text.content = target.value;
      else if (field === 'Fonte') c.text.font = target.value;
      else if (field === 'Tamanho') c.text.size = numeric;
      else if (field === 'Peso') c.text.weight = numeric;
      else if (field === 'Alinhamento') c.text.align = target.value;
      else if (field === 'Cor') c.text.color = target.value;
    });
  }
  function chooseSelected(operation) { if (selectedClip()) mutate(() => operation(selected)); }
  function dirtyDecision() { return !isDirty() ? Promise.resolve('discard') : ntc.confirmVideoProjectChanges(); }
  async function newProject() {
    const decision = await dirtyDecision();
    if (decision === 'cancel') return;
    if (decision === 'save' && !await save(false)) return;
    resetPlayback(); disposePreview(); await ntc.newVideoProject();
    clearTimeout(recoveryTimer); await ntc.clearVideoProjectRecovery().catch(error);
    project = model.createProject(); selected = null; selectedAsset = null; saved = JSON.stringify(project); migrationDirty = false; currentFile = ''; editHistory.clear(); missing.clear(); thumbnails.clear(); filmstrips.clear(); waveforms.clear(); seek(0); refresh(); error('Novo projeto. Importe mídia para começar.');
  }
  async function openProject() {
    const decision = await dirtyDecision();
    if (decision === 'cancel') return;
    if (decision === 'save' && !await save(false)) return;
    const result = await ntc.openVideoProject();
    if (!result) return;
    clearTimeout(recoveryTimer); await ntc.clearVideoProjectRecovery().catch(error);
    resetPlayback(); disposePreview(); project = model.normalizeProject(result.project); currentFile = result.file; selected = null; selectedAsset = null; editHistory.clear(); saved = JSON.stringify(project); migrationDirty = result.migrated; missing.clear(); thumbnails.clear(); filmstrips.clear(); waveforms.clear();
    for (const asset of project.assets) try { await ntc.inspectVideoProjectMedia(asset.path); } catch { missing.add(asset.id); }
    seek(0); refresh();
    for (const asset of project.assets.filter(asset => !missing.has(asset.id))) {
      if (asset.kind === 'audio') loadWaveform(asset);
      else ntc.videoProjectThumbnail(asset.path).then(image => { thumbnails.set(asset.id, image); renderBin(); renderTimeline(); }).catch(() => {});
    }
    error(result.migrated ? 'Projeto v1 aberto e migrado em memória. Salve para criar a versão v2.' : `Projeto aberto: ${result.file}`);
  }
  async function save(saveAs) {
    const result = await ntc.saveVideoProject({ project, saveAs });
    if (!result) return false;
    clearTimeout(recoveryTimer); await ntc.clearVideoProjectRecovery().catch(error);
    currentFile = result.file; saved = JSON.stringify(project); migrationDirty = false; refresh(); error(`Salvo: ${result.name}`); return true;
  }
  async function relink(assetId) {
    const path = (await ntc.chooseVideoProjectMedia())[0]; if (!path) return;
    const inspected = await ntc.inspectVideoProjectMedia(path);
    const asset = project.assets.find(item => item.id === assetId);
    if (!asset || asset.kind !== inspected.kind) throw new Error('Escolha uma mídia do mesmo tipo.');
    const needed = project.tracks.flatMap(track => track.clips).filter(clip => clip.assetId === assetId).reduce((value, clip) => Math.max(value, clip.sourceStartMs + clip.durationMs * clip.speed), 0);
    if (inspected.kind !== 'image' && inspected.durationMs + 100 < needed) throw new Error('A mídia substituta é curta demais para os cortes existentes.');
    mutate(() => { Object.assign(asset, inspected); }, true);
    missing.delete(assetId);
    for (const [clipId, prepared] of previewLayers) {
      if (prepared.asset?.id !== assetId) continue;
      prepared.requestedSourceToken = '';
      prepared.sourceToken = '';
      prepared.media.removeAttribute('src');
      if (prepared.media instanceof HTMLVideoElement) prepared.media.pause();
      previewLayers.delete(clipId);
      previewPlayers.delete(clipId);
      prepared.element.remove();
    }
    for (const [clipId, player] of audioPlayers) {
      if (!project.tracks.some(track => track.clips.some(clip => clip.id === clipId && clip.assetId === assetId))) continue;
      player.pause(); player.removeAttribute('src'); player.load(); audioPlayers.delete(clipId);
    }
    for (const token of previewSources.keys()) if (token.startsWith(`${assetId}:`)) previewSources.delete(token);
    refresh();
    if (inspected.kind === 'audio') {
      waveforms.delete(assetId);
      loadWaveform(project.assets.find(item => item.id === assetId));
    } else {
      for (const key of filmstrips.keys()) if (key.startsWith(`${assetId}:`)) filmstrips.delete(key);
      ntc.videoProjectThumbnail(path).then(image => { thumbnails.set(assetId, image); renderBin(); renderTimeline(); }).catch(() => {});
    }
  }
  let exportFolder = window.NTCMediaAppBridge?.getFolder?.() || '';
  function showExport() {
    if (!duration()) { error('Adicione um clipe à timeline antes de exportar.'); return; }
    $('ntcvExportName').value = project.name;
    $('ntcvExportResolution').value = project.settings.resolution;
    $('ntcvExportFps').value = String(project.settings.fps);
    $('ntcvExportFolder').textContent = exportFolder || 'Downloads';
    $('ntcvExportProgress').hidden = true;
    $('ntcvCancelRender').hidden = true;
    $('ntcvOpenOutput').hidden = true;
    $('ntcvOpenOutputFolder').hidden = true;
    $('ntcvConfirmExport').hidden = false;
    $('ntcvConfirmExport').disabled = false;
    $('ntcvConfirmExport').textContent = 'Exportar MP4';
    $('ntcvExportDialog').showModal();
  }
  async function beginExport() {
    if (!exportFolder) exportFolder = window.NTCMediaAppBridge?.getFolder?.() || await ntc.chooseDownloadFolder();
    if (!exportFolder) throw new Error('Escolha uma pasta de destino.');
    renderId = window.NTCMediaAppBridge?.toolId?.() || `render-${Date.now()}`;
    $('ntcvExportProgress').hidden = false;
    $('ntcvExportState').textContent = 'EXPORTANDO';
    $('ntcvExportPercent').textContent = '0%';
    $('ntcvExportBar').style.width = '0%';
    $('ntcvExportMessage').textContent = 'Preparando FFmpeg…';
    $('ntcvCancelRender').hidden = false;
    $('ntcvConfirmExport').hidden = true;
    try {
      const result = await ntc.renderVideoProject({ id: renderId, project, folder: exportFolder, outputName: $('ntcvExportName').value, options: { resolution: $('ntcvExportResolution').value, fps: Number($('ntcvExportFps').value), quality: $('ntcvExportQuality').value } });
      renderOutput = result.file;
      $('ntcvExportState').textContent = 'CONCLUÍDO';
      $('ntcvExportPercent').textContent = '100%';
      $('ntcvExportBar').style.width = '100%';
      $('ntcvExportMessage').textContent = `Arquivo criado: ${result.filename}`;
      $('ntcvOpenOutput').hidden = false; $('ntcvOpenOutputFolder').hidden = false;
      error(`Exportação concluída: ${result.filename}`);
    } catch (failure) {
      $('ntcvExportState').textContent = /cancelad/i.test(failure.message) ? 'CANCELADO' : 'ERRO';
      $('ntcvExportMessage').textContent = failure.message;
      $('ntcvConfirmExport').hidden = false; $('ntcvConfirmExport').textContent = 'Tentar novamente';
      error(failure);
    } finally { renderId = null; $('ntcvCancelRender').hidden = true; }
  }
  ntc.onVideoProjectEvent(event => {
    if (event.id !== renderId || event.status !== 'converting') return;
    const percent = Math.max(0, Math.min(99, Math.round(event.percent || 0)));
    $('ntcvExportPercent').textContent = `${percent}%`;
    $('ntcvExportBar').style.width = `${percent}%`;
    $('ntcvExportMessage').textContent = event.eta ? `Tempo restante estimado: ${event.eta}` : 'Renderizando…';
  });
  $('ntcvExportForm').addEventListener('submit', event => {
    event.preventDefault();
    if (renderId) return;
    beginExport().catch(error);
  });
  $('ntcvExportDialog').addEventListener('cancel', event => { if (renderId) event.preventDefault(); });
  async function action(command) {
    try {
      if (command === 'import') return importPaths(await ntc.chooseVideoProjectMedia());
      if (command === 'new') return newProject();
      if (command === 'open') return openProject();
      if (command === 'save') return save(false);
      if (command === 'save-as') return save(true);
      if (command === 'undo' || command === 'redo') return history(command);
      if (command === 'export') return showExport();
      if (command === 'add-text') return mutate(() => { selected = model.addText(project, Math.round(position())).id; });
      if (command === 'add-visual-track') return mutate(() => model.addTrack(project, 'visual', `Vídeo ${project.tracks.filter(track => track.kind === 'visual').length + 1}`));
      if (command === 'add-audio-track') return mutate(() => model.addTrack(project, 'audio', `Áudio ${project.tracks.filter(track => track.kind === 'audio').length + 1}`));
      if (command === 'play') return play();
      if (command === 'stop') return stop();
      if (command === 'start') return seek(0);
      if (command === 'delete') return chooseSelected(id => { model.removeClip(project, id); selected = null; });
      if (command === 'duplicate') return chooseSelected(id => { selected = model.duplicateClip(project, id).id; });
      if (command === 'split') return chooseSelected(id => { selected = model.splitClip(project, id, position()).id; });
      if (command === 'reset-transform') return chooseSelected(id => { model.findClip(project, id).clip.transform = model.defaultTransform(); });
      if (command === 'center-transform') return chooseSelected(id => { const t = model.findClip(project, id).clip.transform; t.x = 0; t.y = 0; });
      if (command === 'fit-transform' || command === 'fill-transform') return chooseSelected(id => { const t = model.findClip(project, id).clip.transform; t.fit = command === 'fit-transform' ? 'fit' : 'fill'; });
      if (command === 'layer-up' || command === 'layer-down') return chooseSelected(id => model.moveClipLayer(project, id, command === 'layer-up' ? 'up' : 'down'));
      if (command === 'rotate-left' || command === 'rotate-right') return chooseSelected(id => { const t = model.findClip(project, id).clip.transform; const next = t.rotation + (command === 'rotate-left' ? -90 : 90); t.rotation = next > 180 ? next - 360 : next < -180 ? next + 360 : next; });
      if (command === 'snap') { snapping = !snapping; $('ntcvSnap').setAttribute('aria-pressed', String(snapping)); return; }
      if (command === 'zoom-in' || command === 'zoom-out') { const increment = timelineModel.zoomIncrement(pxPerSecond); changeZoom(pxPerSecond + (command === 'zoom-in' ? increment : -increment)); return; }
      if (command === 'fit') { const scroll = $('ntcvTimelineScroll'); pxPerSecond = Math.max(.05, Math.min(240, (scroll.clientWidth - 160) / Math.max(10, duration() / 1000 + 2))); $('ntcvZoom').value = String(pxPerSecond); renderTimeline(); scroll.scrollLeft = 0; return; }
      if (command === 'media-view') { layout.mediaView = layout.mediaView === 'grid' ? 'list' : 'grid'; persistLayout(); renderBin(); return; }
      if (command === 'toggle-media') { layout.mediaCollapsed = !layout.mediaCollapsed; persistLayout(); applyLayout(); return; }
      if (command === 'toggle-inspector') { layout.inspectorCollapsed = !layout.inspectorCollapsed; persistLayout(); applyLayout(); return; }
      if (command === 'toggle-sidebar') { layout.sidebarCompact = !layout.sidebarCompact; persistLayout(); applyLayout(); return; }
      if (command === 'reset-layout') { layout = layoutModel.normalize(); persistLayout(); applyLayout(); renderBin(); renderTimeline(); return; }
      if (command === 'track-density') { const densities = ['compact', 'normal', 'expanded']; layout.trackDensity = densities[(densities.indexOf(layout.trackDensity) + 1) % densities.length]; persistLayout(); renderTimeline(); return; }
      if (command === 'choose-folder') { const folder = await ntc.chooseDownloadFolder(); if (folder) { exportFolder = folder; $('ntcvExportFolder').textContent = folder; } return; }
      if (command === 'cancel-render') return renderId && ntc.cancelVideoProjectRender(renderId);
      if (command === 'close-export') { if (renderId) return; $('ntcvExportDialog').close(); return; }
      if (command === 'open-output') return renderOutput && ntc.openFile(renderOutput);
      if (command === 'open-output-folder') return renderOutput && ntc.openFileFolder(renderOutput);
    } catch (failure) { error(failure); }
  }
  const contextMenus = () => [$('ntcvClipMenu'), $('ntcvMediaMenu'), $('ntcvTrackMenu')];
  function closeContextMenus() { contextMenus().forEach(menu => { menu.hidden = true; }); }
  function openContextMenu(menu, x, y) {
    closeContextMenus();
    menu.hidden = false;
    menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
  }
  function beginTrackRename(trackId) {
    const track = project.tracks.find(item => item.id === trackId);
    const label = root.querySelector(`[data-track-name="${CSS.escape(trackId)}"]`);
    if (!track || !label) return;
    const input = document.createElement('input');
    input.value = track.name; input.maxLength = 80; input.setAttribute('aria-label', 'Nome da faixa');
    label.replaceWith(input); input.focus(); input.select();
    let finished = false;
    const finish = accept => {
      if (finished) return;
      finished = true;
      if (accept && input.value.trim() && input.value.trim() !== track.name) mutate(() => model.renameTrack(project, trackId, input.value));
      else renderTimeline();
    };
    input.addEventListener('blur', () => finish(true), { once: true });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
  }
  root.addEventListener('click', event => {
    const mediaContext = event.target.closest('[data-media-context]');
    if (mediaContext) {
      const asset = project.assets.find(item => item.id === contextAsset);
      closeContextMenus();
      if (!asset) return;
      try {
        if (mediaContext.dataset.mediaContext === 'insert') mutate(() => { selected = model.addClip(project, asset.id).id; });
        if (mediaContext.dataset.mediaContext === 'show') ntc.openFileFolder(asset.path).catch(error);
        if (mediaContext.dataset.mediaContext === 'info') error(`${asset.name} · ${asset.kind.toUpperCase()}${asset.durationMs ? ` · ${labelTime(asset.durationMs)}` : ''}${asset.width ? ` · ${asset.width}×${asset.height}` : ''}`);
        if (mediaContext.dataset.mediaContext === 'remove') mutate(() => model.removeAsset(project, asset.id));
      } catch (failure) { error(failure); }
      return;
    }
    const trackContext = event.target.closest('[data-track-context]');
    if (trackContext) {
      const command = trackContext.dataset.trackContext;
      const trackId = contextTrack;
      closeContextMenus();
      if (command === 'rename') beginTrackRename(trackId);
      else if (command === 'before' || command === 'after') mutate(() => model.addTrackRelative(project, trackId, command));
      else if (command === 'remove') mutate(() => model.removeTrack(project, trackId));
      return;
    }
    closeContextMenus();
    const button = event.target.closest('[data-ntcv]');
    if (button) { event.preventDefault(); action(button.dataset.ntcv); return; }
    const mediaButton = event.target.closest('[data-media-action]');
    if (mediaButton) {
      const assetId = mediaButton.dataset.asset;
      try {
        if (mediaButton.dataset.mediaAction === 'insert') mutate(() => { selected = model.addClip(project, assetId).id; });
        if (mediaButton.dataset.mediaAction === 'locate') {
          if (missing.has(assetId)) relink(assetId).catch(error);
          else ntc.openFileFolder(project.assets.find(item => item.id === assetId)?.path).catch(error);
        }
        if (mediaButton.dataset.mediaAction === 'remove') mutate(() => model.removeAsset(project, assetId));
      } catch (failure) { error(failure); }
      return;
    }
    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) { filter = filterButton.dataset.filter; root.querySelectorAll('[data-filter]').forEach(node => node.classList.toggle('is-active', node === filterButton)); renderBin(); return; }
    const mediaItem = event.target.closest('.ntcv-media-item');
    if (mediaItem) {
      selectedAsset = mediaItem.dataset.asset;
      $('ntcvMediaList').querySelectorAll('.ntcv-media-item').forEach(node => node.classList.toggle('is-selected', node.dataset.asset === selectedAsset));
      return;
    }
    const trackButton = event.target.closest('[data-track-action]');
    if (trackButton) {
      const row = trackButton.closest('[data-track]');
      mutate(() => { const track = project.tracks.find(item => item.id === row.dataset.track); const field = trackButton.dataset.trackAction; track[field] = !track[field]; });
      return;
    }
    const clipNode = event.target.closest('.ntcv-clip');
    if (clipNode) { selected = clipNode.dataset.clip; renderTimeline(); renderInspector(); return; }
    if (event.target.closest('.ntcv-lane')) { selected = null; renderTimeline(); renderInspector(); }
  });
  $('ntcvMediaSearch').addEventListener('input', event => { mediaQuery = event.target.value; renderBin(); });
  $('ntcvMediaList').addEventListener('dblclick', event => { const item = event.target.closest('.ntcv-media-item'); if (item && !event.target.closest('button')) mutate(() => { selected = model.addClip(project, item.dataset.asset).id; }); });
  $('ntcvTracks').addEventListener('dblclick', event => { const label = event.target.closest('[data-track-name]'); if (label) beginTrackRename(label.dataset.trackName); });
  $('ntcvMediaList').addEventListener('keydown', event => { const item = event.target.closest('.ntcv-media-item'); if (item && event.key === 'Enter') { event.preventDefault(); mutate(() => { selected = model.addClip(project, item.dataset.asset).id; }); } });
  root.addEventListener('contextmenu', event => {
    const clip = event.target.closest('.ntcv-clip');
    const asset = event.target.closest('.ntcv-media-item');
    const track = event.target.closest('.ntcv-track-label');
    if (clip) {
      event.preventDefault(); selected = clip.dataset.clip; renderTimeline(); renderInspector();
      openContextMenu($('ntcvClipMenu'), event.clientX, event.clientY);
    } else if (asset) {
      event.preventDefault(); contextAsset = asset.dataset.asset; selectedAsset = contextAsset; renderBin();
      openContextMenu($('ntcvMediaMenu'), event.clientX, event.clientY);
    } else if (track) {
      event.preventDefault(); contextTrack = track.closest('[data-track]')?.dataset.track;
      openContextMenu($('ntcvTrackMenu'), event.clientX, event.clientY);
    } else closeContextMenus();
  });
  root.addEventListener('change', event => { if (event.target.matches('[data-project-field],[data-clip-field]')) changeInspector(event.target); });
  $('ntcvSeek').addEventListener('input', event => seek(Math.round(Number(event.target.value) / 1000 * duration())));
  $('ntcvZoom').addEventListener('input', event => changeZoom(Number(event.target.value)));
  $('ntcvMediaList').addEventListener('dragstart', event => {
    const node = event.target.closest('[data-asset]'); if (!node) return;
    draggedAssetId = node.dataset.asset;
    event.dataTransfer.setData('application/x-ntc-video-asset', node.dataset.asset);
    event.dataTransfer.effectAllowed = 'copy';
  });
  $('ntcvMediaList').addEventListener('dragend', () => { draggedAssetId = null; $('ntcvTimelineDrop').classList.remove('is-invalid-target', 'is-drop-target'); $('ntcvDropGuide').hidden = true; });
  const acceptsAsset = (lane, asset) => !lane || !asset || (lane.closest('[data-track]') && project.tracks.find(track => track.id === lane.dataset.track)?.kind === (asset.kind === 'audio' ? 'audio' : 'visual'));
  for (const target of [$('ntcvMediaDrop'), $('ntcvTimelineDrop')]) {
    target.addEventListener('dragover', event => {
      event.preventDefault();
      const lane = event.target.closest('.ntcv-lane');
      const asset = project.assets.find(item => item.id === draggedAssetId);
      const valid = target.id !== 'ntcvTimelineDrop' || acceptsAsset(lane, asset);
      target.classList.toggle('is-drop-target', valid);
      target.classList.toggle('is-invalid-target', !valid);
      event.dataTransfer.dropEffect = valid ? 'copy' : 'none';
      if (target.id === 'ntcvTimelineDrop' && lane && valid) {
        $('ntcvDropGuide').style.left = `${124 + laneTime(event.clientX, lane) / 1000 * pxPerSecond}px`;
        $('ntcvDropGuide').hidden = false;
      } else $('ntcvDropGuide').hidden = true;
    });
    target.addEventListener('dragleave', event => { if (!target.contains(event.relatedTarget)) { target.classList.remove('is-drop-target', 'is-invalid-target'); $('ntcvDropGuide').hidden = true; } });
    target.addEventListener('drop', event => {
      event.preventDefault(); target.classList.remove('is-drop-target', 'is-invalid-target'); $('ntcvDropGuide').hidden = true;
      const lane = event.target.closest('.ntcv-lane');
      const at = lane ? laneTime(event.clientX, lane) : position();
      const id = event.dataTransfer.getData('application/x-ntc-video-asset');
      if (id && target.id === 'ntcvTimelineDrop') {
        const asset = project.assets.find(item => item.id === id);
        if (!acceptsAsset(lane, asset)) { error('Essa mídia não é compatível com a faixa escolhida.'); return; }
        mutate(() => { selected = model.addClip(project, id, lane?.dataset.track || null, at).id; }); return;
      }
      const paths = fileList(event);
      if (paths.length) importPaths(paths, target.id === 'ntcvTimelineDrop', at, lane?.dataset.track || null);
    });
  }
  $('ntcvTimelineContent').addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const clipNode = event.target.closest('.ntcv-clip');
    if (clipNode) {
      const found = model.findClip(project, clipNode.dataset.clip);
      if (!found || found.track.locked) return;
      selected = found.clip.id; renderInspector();
      drag = { kind: event.target.dataset.trim || 'move', clipId: found.clip.id, trackId: found.track.id, startX: event.clientX, startY: event.clientY, scrollStart: $('ntcvTimelineScroll').scrollLeft, initialStart: found.clip.positionMs, initialEnd: found.clip.positionMs + found.clip.durationMs, node: clipNode, sourceLane: clipNode.closest('.ntcv-lane') };
      clipNode.classList.add('is-dragging');
      clipNode.setPointerCapture(event.pointerId);
      return;
    }
    if (event.target.closest('.ntcv-ruler')) {
      drag = { kind: 'seek' };
      $('ntcvTimelineContent').setPointerCapture(event.pointerId);
      seek(Math.max(0, Math.round((event.clientX - $('ntcvRuler').getBoundingClientRect().left - 124) / pxPerSecond * 1000)));
    }
  });
  $('ntcvTimelineContent').addEventListener('pointermove', event => {
    if (!drag) return;
    if (drag.kind === 'seek') { seek(Math.max(0, Math.round((event.clientX - $('ntcvRuler').getBoundingClientRect().left - 124) / pxPerSecond * 1000))); return; }
    const scroll = $('ntcvTimelineScroll'); const bounds = scroll.getBoundingClientRect();
    if (drag.kind === 'move' && event.clientX < bounds.left + 28) scroll.scrollLeft = Math.max(0, scroll.scrollLeft - 14);
    else if (drag.kind === 'move' && event.clientX > bounds.right - 28) scroll.scrollLeft += 14;
    const delta = Math.round((event.clientX - drag.startX + scroll.scrollLeft - drag.scrollStart) / pxPerSecond * 1000);
    drag.delta = delta;
    drag.destination = null; drag.validTarget = true;
    if (drag.kind === 'move') {
      drag.node.style.pointerEvents = 'none';
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const row = hit?.closest('.ntcv-track-row');
      const lane = row?.querySelector('.ntcv-lane');
      drag.node.style.pointerEvents = '';
      const targetTrack = lane && project.tracks.find(track => track.id === lane.dataset.track);
      drag.destination = targetTrack?.id || drag.trackId;
      drag.validTarget = Boolean(targetTrack && targetTrack.kind === project.tracks.find(track => track.id === drag.trackId)?.kind && !targetTrack.locked);
      $('ntcvTracks').querySelectorAll('.ntcv-lane').forEach(node => node.classList.remove('is-track-drop-valid', 'is-track-drop-invalid'));
      if (lane) lane.classList.add(drag.validTarget ? 'is-track-drop-valid' : 'is-track-drop-invalid');
      const y = lane && drag.sourceLane ? lane.getBoundingClientRect().top - drag.sourceLane.getBoundingClientRect().top : 0;
      drag.deltaY = y;
    }
    const threshold = 8 / pxPerSecond * 1000;
    const edge = drag.kind === 'end' ? drag.initialEnd + delta : Math.max(0, drag.initialStart + delta);
    const snappedEdge = snapping ? model.snapTime(project, edge, drag.trackId, position(), threshold, drag.clipId) : edge;
    $('ntcvSnapGuide').hidden = !snapping || snappedEdge === edge;
    if (!$('ntcvSnapGuide').hidden) $('ntcvSnapGuide').style.left = `${124 + snappedEdge / 1000 * pxPerSecond}px`;
    const dx = event.clientX - drag.startX + scroll.scrollLeft - drag.scrollStart;
    if (drag.kind === 'move') drag.node.style.transform = `translate(${dx}px, ${drag.deltaY || 0}px)`;
    else if (drag.kind === 'start') { drag.node.style.transform = `translateX(${event.clientX - drag.startX}px)`; drag.node.style.width = `${Math.max(8, (drag.initialEnd - drag.initialStart - delta) / 1000 * pxPerSecond)}px`; }
    else drag.node.style.width = `${Math.max(8, (drag.initialEnd - drag.initialStart + delta) / 1000 * pxPerSecond)}px`;
  });
  $('ntcvTimelineContent').addEventListener('pointerup', event => {
    if (!drag) return;
    const current = drag; drag = null;
    $('ntcvSnapGuide').hidden = true;
    $('ntcvTracks').querySelectorAll('.ntcv-lane').forEach(node => node.classList.remove('is-track-drop-valid', 'is-track-drop-invalid'));
    current.node?.classList.remove('is-dragging');
    if (current.kind === 'seek') return;
    if (!current.delta && !current.deltaY) { renderTimeline(); return; }
    // Hit-test the destination beneath the captured/translated clip, not the clip itself.
    current.node.style.pointerEvents = 'none';
    const lane = document.elementFromPoint(event.clientX, event.clientY)?.closest('.ntcv-lane');
    current.node.style.pointerEvents = '';
    const destination = lane?.dataset.track || current.trackId;
    const destinationTrack = project.tracks.find(track => track.id === destination);
    if (!destinationTrack || destinationTrack.locked || destinationTrack.kind !== model.findClip(project, current.clipId)?.track.kind) { renderTimeline(); return; }
    const threshold = 8 / pxPerSecond * 1000;
    const snapped = value => snapping ? model.snapTime(project, value, destination, position(), threshold, current.clipId) : value;
    mutate(() => {
      if (current.kind === 'move') model.moveClip(project, current.clipId, destination, snapped(Math.max(0, current.initialStart + current.delta)));
      else model.trimClip(project, current.clipId, current.kind, snapped((current.kind === 'start' ? current.initialStart : current.initialEnd) + current.delta));
    });
  });
  $('ntcvTimelineContent').addEventListener('pointercancel', () => { drag?.node?.classList.remove('is-dragging'); drag = null; $('ntcvSnapGuide').hidden = true; renderTimeline(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && contextMenus().some(menu => !menu.hidden)) { closeContextMenus(); event.preventDefault(); return; }
    if (!document.getElementById('videoEditorView')?.classList.contains('active') || $('videoProjectPanel').classList.contains('hidden') || $('ntcvExportDialog').open || isTextTarget(event.target)) return;
    const control = event.ctrlKey || event.metaKey;
    let command = null;
    if (event.code === 'Space') command = 'play';
    else if (event.key === 'Home') command = 'start';
    else if (event.key === 'Delete' || event.key === 'Backspace') command = 'delete';
    else if (control && event.key.toLowerCase() === 'o') command = 'open';
    else if (control && event.key.toLowerCase() === 'z') command = event.shiftKey ? 'redo' : 'undo';
    else if (control && event.key.toLowerCase() === 'y') command = 'redo';
    else if (control && event.key.toLowerCase() === 's') command = event.shiftKey ? 'save-as' : 'save';
    else if (control && event.key.toLowerCase() === 'd') command = 'duplicate';
    else if (control && event.key.toLowerCase() === 'b') command = 'split';
    else if (control && event.key === '0') command = 'fit';
    else if (control && (event.key === '+' || event.key === '=')) command = 'zoom-in';
    else if (control && event.key === '-') command = 'zoom-out';
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const found = selectedClip();
      if (found?.clip.transform && !found.track.locked) {
        const step = event.shiftKey ? 10 : 1;
        const key = event.key === 'ArrowLeft' ? 'x' : event.key === 'ArrowRight' ? 'x' : 'y';
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -step : step;
        event.preventDefault();
        mutate(() => { found.clip.transform[key] = Math.max(-200, Math.min(200, found.clip.transform[key] + delta)); });
        return;
      }
    }
    if (command) { event.preventDefault(); action(command); }
  });
  $('ntcvTimelineScroll').addEventListener('wheel', event => {
    if (!event.ctrlKey || $('ntcvExportDialog').open) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * .002);
    changeZoomAt(pxPerSecond * factor, event.clientX);
  }, { passive: false });
  document.addEventListener('visibilitychange', () => { refreshTransport(); updatePreview(); if (playback.playing && !document.hidden) { cancelAnimationFrame(animationFrame); frame(); } });
  window.addEventListener('focus', () => { refreshTransport(); updatePreview(); });
  let navigationApproved = false;
  document.addEventListener('click', async event => {
    const navigation = event.target.closest('.nav-item[data-view]');
    if (!navigation || navigation.dataset.view === 'videoEditor' || navigationApproved || !document.getElementById('videoEditorView')?.classList.contains('active') || !isDirty()) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      const decision = await dirtyDecision();
      if (decision === 'cancel') return;
      if (decision === 'save' && !await save(false)) return;
      if (decision === 'discard') { clearTimeout(recoveryTimer); await ntc.clearVideoProjectRecovery().catch(error); pause(); project = model.normalizeProject(JSON.parse(saved)); migrationDirty = false; editHistory.clear(); selected = null; refresh(); }
      navigationApproved = true; navigation.click(); navigationApproved = false;
    } catch (failure) { navigationApproved = false; error(failure); }
  }, true);
  window.addEventListener('beforeunload', event => { if (isDirty()) { event.preventDefault(); event.returnValue = ''; } });
  async function checkRecovery() {
    if (recoveryChecked) return;
    recoveryChecked = true;
    try {
      const recovered = await ntc.loadVideoProjectRecovery();
      if (!recovered || isDirty()) return;
      project = model.normalizeProject(recovered); selected = null; currentFile = ''; editHistory.clear();
      saved = JSON.stringify(project); migrationDirty = true; missing.clear(); thumbnails.clear(); waveforms.clear();
      for (const asset of project.assets) try { await ntc.inspectVideoProjectMedia(asset.path); } catch { missing.add(asset.id); }
      seek(0); refresh(); error('Edição não salva recuperada. Salve o projeto para mantê-la.');
      for (const asset of project.assets.filter(asset => !missing.has(asset.id))) {
        if (asset.kind === 'audio') loadWaveform(asset);
        else ntc.videoProjectThumbnail(asset.path).then(image => { thumbnails.set(asset.id, image); renderBin(); renderTimeline(); }).catch(() => {});
      }
    } catch (failure) { error(failure); }
  }
  const videoView = $('videoEditorView');
  new MutationObserver(() => { if (videoView.classList.contains('active') && !$('videoProjectPanel').classList.contains('hidden')) checkRecovery(); }).observe(videoView, { attributes: true, attributeFilter: ['class'] });
  if (videoView.classList.contains('active')) checkRecovery();
  const stage = root.querySelector('.ntcv-stage');
  const mediaPanel = root.querySelector('.ntcv-media-panel');
  const inspectorPanel = root.querySelector('.ntcv-inspector');
  const appShell = document.querySelector('.app-shell');
  let workspaceActive = false;
  const syncResizeHandles = () => {
    $('ntcvResizeMedia').style.left = `${layout.media - 2}px`;
    $('ntcvResizeInspector').style.right = `${layout.inspector - 2}px`;
  };
  function persistLayout() { layout = layoutModel.save(localStorage, layout); }
  function applyLayout() {
    stage.style.setProperty('--ntcv-media-width', `${layout.media}px`);
    stage.style.setProperty('--ntcv-inspector-width', `${layout.inspector}px`);
    stage.classList.toggle('is-media-collapsed', layout.mediaCollapsed);
    stage.classList.toggle('is-inspector-collapsed', layout.inspectorCollapsed);
    root.dataset.trackDensity = layout.trackDensity;
    const maximumTimeline = Math.max(220, root.clientHeight * .72);
    $('ntcvTimelineDrop').style.height = `${Math.min(maximumTimeline, layout.timeline)}px`;
    appShell?.classList.toggle('sidebar-compact', workspaceActive && layout.sidebarCompact);
    document.querySelectorAll('.nav-item').forEach(button => {
      if (workspaceActive && layout.sidebarCompact) {
        const icon = button.querySelector('.nav-icon')?.textContent || '';
        button.dataset.videoEditorTitle ||= button.textContent.replace(icon, '').trim();
        button.title = button.dataset.videoEditorTitle;
      } else if (button.dataset.videoEditorTitle && button.title === button.dataset.videoEditorTitle) button.removeAttribute('title');
    });
    root.querySelectorAll('[data-ntcv="toggle-media"]').forEach(button => button.setAttribute('aria-pressed', String(layout.mediaCollapsed)));
    root.querySelectorAll('[data-ntcv="toggle-inspector"]').forEach(button => button.setAttribute('aria-pressed', String(layout.inspectorCollapsed)));
    root.querySelector('[data-ntcv="toggle-sidebar"]')?.setAttribute('aria-pressed', String(layout.sidebarCompact));
    syncResizeHandles();
    requestAnimationFrame(() => { layoutCanvas(); drawWaveforms(); });
  }
  function setPanelWidths(media, inspector) {
    const available = stage.clientWidth;
    const left = Math.max(150, Math.min(360, media));
    const right = Math.max(210, Math.min(390, inspector));
    if (available - left - right < 300) return;
    layout.media = left; layout.inspector = right;
    applyLayout();
  }
  for (const [id, side] of [['ntcvResizeMedia', 'media'], ['ntcvResizeInspector', 'inspector']]) {
    const handle = $(id);
    let start = null;
    handle.addEventListener('pointerdown', event => {
      start = { x: event.clientX, media: mediaPanel.getBoundingClientRect().width, inspector: inspectorPanel.getBoundingClientRect().width };
      handle.classList.add('is-dragging'); handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!start) return;
      setPanelWidths(side === 'media' ? start.media + event.clientX - start.x : start.media, side === 'inspector' ? start.inspector + start.x - event.clientX : start.inspector);
    });
    const finish = () => {
      if (!start) return;
      start = null; handle.classList.remove('is-dragging');
      persistLayout();
    };
    handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
  }
  {
    const handle = $('ntcvResizeTimeline');
    let start = null;
    handle.addEventListener('pointerdown', event => {
      start = { y: event.clientY, height: $('ntcvTimelineDrop').getBoundingClientRect().height };
      handle.classList.add('is-dragging'); handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!start) return;
      layout.timeline = Math.max(220, Math.min(root.clientHeight * .72, start.height + start.y - event.clientY));
      $('ntcvTimelineDrop').style.height = `${layout.timeline}px`;
    });
    const finish = () => {
      if (!start) return;
      start = null; handle.classList.remove('is-dragging');
      persistLayout();
    };
    handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
  }
  new ResizeObserver(() => { applyLayout(); }).observe(stage);
  new ResizeObserver(() => { layoutCanvas(); updateSelectionOverlay(); }).observe(root.querySelector('.ntcv-preview-surround'));
  async function setWorkspaceActive(active) {
    const next = Boolean(active);
    if (workspaceActive === next) return;
    workspaceActive = next;
    appShell?.classList.toggle('video-editor-shell', next);
    applyLayout();
    try {
      if (next) { setTimeout(checkRecovery, 0); await ntc.enterVideoEditorWindowMode(); }
      else await ntc.leaveVideoEditorWindowMode();
    } catch { /* A ergonomia da janela não bloqueia o editor. */ }
    requestAnimationFrame(() => { layoutCanvas(); renderTimeline(); refreshTransport(); });
  }
  window.NTCVideoProjectUi = Object.freeze({ setWorkspaceActive });
  applyLayout();
  refresh();
  if (videoView.classList.contains('active')) setWorkspaceActive(true);
})();
