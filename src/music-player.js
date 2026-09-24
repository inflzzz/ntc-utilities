(() => {
  const $ = selector => document.querySelector(selector);
  const decks = [$('#musicDeckA'), $('#musicDeckB')];
  const folderContainer = $('#musicFolders');
  const trackContainer = $('#musicTracks');
  if (!decks.every(Boolean) || !trackContainer) return;

  const tracks = [];
  const libraryTrackIds = new Set();
  const trackSnapshots = new Map(Object.entries(readObject('ntc-music-track-snapshots')));
  const liked = new Set(readArray('ntc-music-liked'));
  const onlineArtwork = new Map(Object.entries(readObject('ntc-music-online-artwork')));
  const tagCache = new Map(Object.entries(readObject('ntc-music-tag-cache')));
  const metadataByTrack = new Map([...tagCache].map(([id, metadata]) => [id, { metadata }]));
  const artworkLoadedForTrack = new Set();
  const durations = new Map();
  let playlists = window.ntcMusicPlaylists.normalizeMusicPlaylists(readArray('ntc-music-playlists'));
  let activePlaylistId = localStorage.getItem('ntc-music-active-playlist') || '';
  let folders = [];
  let currentIndex = -1;
  let currentTrackId = null;
  let playbackQueueIds = [];
  let currentDeck = 0;
  let playing = false;
  let activeFilter = playlists.some(playlist => playlist.id === activePlaylistId) ? 'playlist' : 'all';
  let playlistEditMode = false;
  let playlistInfoEditing = false;
  let playlistCoverDraft = '';
  let sortMode = localStorage.getItem('ntc-music-organization') || 'queue';
  let shuffle = false;
  let repeatMode = 'off';
  let pendingResumeSeek = null;
  let lastPlaybackSaveAt = 0;
  let metadataLoadPromise = null;
  let equalizerContext = null;
  const equalizerChains = new Map();
  const equalizerPresets = {
    flat: { gain: 0, eqBass: 0, eqMid: 0, eqTreble: 0 },
    voz: { gain: 1, eqBass: -2, eqMid: 3, eqTreble: 2 },
    musica: { gain: 0, eqBass: 2, eqMid: 0, eqTreble: 2 },
    podcast: { gain: 2, eqBass: -1, eqMid: 3, eqTreble: 1 },
    bass: { gain: 0, eqBass: 5, eqMid: 0, eqTreble: 1 },
    vocal: { gain: 0, eqBass: -2, eqMid: 3, eqTreble: 2 },
    rock: { gain: 0, eqBass: 4, eqMid: 1, eqTreble: 4 }
  };
  let equalizerPreset = localStorage.getItem('ntc-music-eq-preset') || 'flat';
  function normalizeEqualizerSettings(value, fallback = equalizerPresets.flat) {
    const clamp = (candidate, defaultValue) => {
      const number = Number(candidate);
      return Number.isFinite(number) ? Math.round(Math.max(-12, Math.min(12, number)) * 2) / 2 : defaultValue;
    };
    return {
      gain: clamp(value?.gain, fallback.gain),
      eqBass: clamp(value?.eqBass, fallback.eqBass),
      eqMid: clamp(value?.eqMid, fallback.eqMid),
      eqTreble: clamp(value?.eqTreble, fallback.eqTreble)
    };
  }
  function savedAudioPresetSettings(name) { return readObject('ntc-audio-presets')[name] || null; }
  function equalizerPresetSettings(preset) {
    if (preset.startsWith('saved:')) return savedAudioPresetSettings(preset.slice(6)) || equalizerPresets.flat;
    return equalizerPresets[preset] || equalizerPresets.flat;
  }
  let equalizerSettings = normalizeEqualizerSettings(readObject('ntc-music-eq-settings'), equalizerPresetSettings(equalizerPreset));
  const savedCrossfade = localStorage.getItem('ntc-music-crossfade');
  const migrateOldZeroDefault = localStorage.getItem('ntc-music-crossfade-user-set') !== 'true' && savedCrossfade !== null && Number(savedCrossfade) === 0;
  let crossfadeSeconds = migrateOldZeroDefault ? 10 : readNumber('ntc-music-crossfade', 10, 0, 12);
  if (migrateOldZeroDefault || savedCrossfade === null) localStorage.setItem('ntc-music-crossfade', String(crossfadeSeconds));
  let volume = readNumber('ntc-music-volume', 80, 0, 100) / 100;
  let fadeTimer = 0;
  let fadeState = null;
  let scanInProgress = false;

  function readArray(key) { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  function readObject(key) { try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
  function readNumber(key, fallback, min, max) { const saved = localStorage.getItem(key); if (saved === null || saved.trim() === '') return fallback; const value = Number(saved); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function formatTime(seconds) { if (!Number.isFinite(seconds) || seconds < 0) return '0:00'; const value = Math.floor(seconds); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }
  function showLibraryMessage(message) { const hint = $('#musicLibraryHint'); hint.textContent = message; hint.classList.toggle('hidden', !message); }
  function setPlaybackMessage(message) { $('#musicNowSubtitle').textContent = message; }
  function escapeEndFade() { if (fadeTimer) clearInterval(fadeTimer); fadeTimer = 0; fadeState = null; applyVolumes(); }

  function savePlaybackState(force = false) {
    const now = Date.now();
    if (!currentTrackId || currentIndex < 0 || (!force && now - lastPlaybackSaveAt < 5000)) return;
    const audio = decks[currentDeck];
    try {
      localStorage.setItem('ntc-music-playback-state', JSON.stringify({ trackId: currentTrackId, time: Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0, queueIds: playbackQueueIds }));
      lastPlaybackSaveAt = now;
    } catch { /* Keep playback working even if the browser storage is full. */ }
  }

  function saveTagCache(trackId, result) {
    if (!result?.metadata || typeof result.metadata !== 'object') return;
    tagCache.delete(trackId);
    tagCache.set(trackId, result.metadata);
    while (tagCache.size > 2500) tagCache.delete(tagCache.keys().next().value);
    try { localStorage.setItem('ntc-music-tag-cache', JSON.stringify(Object.fromEntries(tagCache))); } catch { /* Tags remain available for this session. */ }
  }

  function rememberTrackOrder() { localStorage.setItem('ntc-music-order', JSON.stringify(tracks.filter(track => libraryTrackIds.has(track.id)).map(track => track.id))); }

  function persistTrackSnapshots() {
    try { localStorage.setItem('ntc-music-track-snapshots', JSON.stringify(Object.fromEntries(trackSnapshots))); }
    catch { /* Playlist paths still provide a fallback snapshot if storage is full. */ }
  }

  function rememberTrackSnapshot(track) {
    if (!track?.id) return;
    trackSnapshots.set(track.id, { id: track.id, path: track.path, src: track.src, name: track.name, folder: track.folder, extension: track.extension });
    persistTrackSnapshots();
  }

  function trackFromPlaylistSnapshot(id) {
    const saved = trackSnapshots.get(id);
    if (saved && typeof saved === 'object' && saved.path && saved.name) return { ...saved, id, src: saved.src || fileUrlFromPath(saved.path) };
    const filePath = String(id || '');
    if (!filePath || !/[\\/]/.test(filePath)) return null;
    const parts = filePath.split(/[\\/]/).filter(Boolean);
    const filename = parts.at(-1) || filePath;
    const dot = filename.lastIndexOf('.');
    const extension = dot > 0 ? filename.slice(dot + 1) : '';
    return { id, path: filePath, src: fileUrlFromPath(filePath), name: dot > 0 ? filename.slice(0, dot) : filename, extension: extension.toUpperCase(), folder: parts.at(-2) || '' };
  }

  function fileUrlFromPath(filePath) {
    try {
      const url = new URL('file:///');
      const normalized = String(filePath).replace(/\\/g, '/');
      url.pathname = normalized.startsWith('/') ? normalized : `/${normalized}`;
      return url.href;
    } catch { return ''; }
  }

  function applySavedTrackOrder(foundTracks) {
    const remaining = new Map(foundTracks.map(track => [track.id, track]));
    const ordered = [];
    for (const id of readArray('ntc-music-order')) {
      const track = remaining.get(id);
      if (track) { ordered.push(track); remaining.delete(id); }
    }
    for (const track of foundTracks) if (remaining.has(track.id)) { ordered.push(track); remaining.delete(track.id); }
    localStorage.setItem('ntc-music-order', JSON.stringify(ordered.map(track => track.id)));
    return ordered;
  }

  function getSelectedPlaylist() { return playlists.find(playlist => playlist.id === activePlaylistId) || null; }

  function savePlaylists() {
    playlists = window.ntcMusicPlaylists.normalizeMusicPlaylists(playlists);
    try { localStorage.setItem('ntc-music-playlists', JSON.stringify(playlists)); }
    catch { showLibraryMessage('Não foi possível salvar a playlist. O armazenamento local pode estar cheio.'); }
    renderPlaylistControls();
  }

  function setPlaylistCoverPreview(imageId, placeholderId, coverDataUrl) {
    const image = $(`#${imageId}`);
    const placeholder = $(`#${placeholderId}`);
    image.classList.toggle('hidden', !coverDataUrl);
    placeholder.classList.toggle('hidden', Boolean(coverDataUrl));
    if (coverDataUrl && image.src !== coverDataUrl) image.src = coverDataUrl;
    if (!coverDataUrl) image.removeAttribute('src');
  }

  function renderPlaylistDetails() {
    const selected = getSelectedPlaylist();
    const summary = $('#musicPlaylistSummary');
    const form = $('#musicPlaylistInfoForm');
    if (!selected) { playlistInfoEditing = false; playlistCoverDraft = ''; }
    summary.classList.toggle('hidden', !selected || playlistInfoEditing);
    form.classList.toggle('hidden', !selected || !playlistInfoEditing);
    $('#musicPlaylistTitle').textContent = selected?.name || '';
    $('#musicPlaylistDescription').textContent = selected?.description || 'Adicione uma descrição para esta playlist.';
    setPlaylistCoverPreview('musicPlaylistCoverImage', 'musicPlaylistCoverPlaceholder', selected?.coverDataUrl || '');
    if (!playlistInfoEditing) playlistCoverDraft = selected?.coverDataUrl || '';
    setPlaylistCoverPreview('musicPlaylistCoverDraftImage', 'musicPlaylistCoverDraftPlaceholder', playlistCoverDraft);
    $('#musicRemovePlaylistCover').classList.toggle('hidden', !playlistCoverDraft);
  }

  function renderPlaylistControls() {
    const select = $('#musicPlaylistSelect');
    const selectedId = getSelectedPlaylist()?.id || '';
    activePlaylistId = selectedId;
    select.replaceChildren(new Option('Nenhuma selecionada', ''));
    for (const playlist of playlists) select.add(new Option(`${playlist.name} (${playlist.trackIds.length})`, playlist.id));
    select.value = selectedId;
    $('#musicDeletePlaylist').classList.toggle('hidden', !selectedId);
    $('#musicEditPlaylist').classList.toggle('hidden', !selectedId);
    $('#musicEditPlaylist').textContent = playlistEditMode ? 'Concluir edição' : 'Editar faixas';
    $('#musicEditPlaylist').setAttribute('aria-pressed', String(playlistEditMode));
    $('#musicPlaylistFilter').classList.toggle('hidden', !selectedId);
    $('#musicPlaylistFilter').textContent = selectedId ? `Playlist (${getSelectedPlaylist().trackIds.length})` : 'Playlist';
    renderPlaylistDetails();
    if (!selectedId) {
      playlistEditMode = false;
      if (activeFilter === 'playlist') setMusicFilter('all');
    }
  }

  function getTrackTags(track) {
    return {
      ...(metadataByTrack.get(track.id)?.metadata || {}),
      ...(onlineArtwork.get(track.id)?.metadata || {})
    };
  }

  function reorderTrack(sourceId, targetId, position = 'before', focusId = null) {
    if (sourceId === targetId) return;
    const visibleIds = filteredTracks().map(({ track }) => track.id);
    if (!visibleIds.includes(sourceId) || !visibleIds.includes(targetId)) return;
    const selected = activeFilter === 'playlist' ? getSelectedPlaylist() : null;
    if (selected) {
      const trackIds = window.ntcMusicQueue.reorderVisibleMusicTrackIds(selected.trackIds, visibleIds, sourceId, targetId, position);
      playlists = playlists.map(item => item.id === selected.id ? { ...item, trackIds } : item);
      savePlaylists();
    } else {
      const ids = window.ntcMusicQueue.reorderVisibleMusicTrackIds(tracks.map(track => track.id), visibleIds, sourceId, targetId, position);
      const byId = new Map(tracks.map(track => [track.id, track]));
      tracks.splice(0, tracks.length, ...ids.map(id => byId.get(id)));
      rememberTrackOrder();
    }
    if (sortMode !== 'queue') {
      sortMode = 'queue';
      $('#musicOrganization').value = sortMode;
      localStorage.setItem('ntc-music-organization', sortMode);
    }
    if (playbackQueueIds.length === visibleIds.length && visibleIds.every(id => playbackQueueIds.includes(id))) {
      const updatedOrder = selected ? getSelectedPlaylist().trackIds : tracks.map(track => track.id);
      const queued = new Set(playbackQueueIds);
      playbackQueueIds = updatedOrder.filter(id => queued.has(id));
      savePlaybackState(true);
    }
    if (currentTrackId) currentIndex = tracks.findIndex(track => track.id === currentTrackId);
    if (fadeState) fadeState.targetIndex = tracks.findIndex(track => track.id === fadeState.targetTrackId);
    renderTracks();
    if (focusId) [...trackContainer.querySelectorAll('.music-track-row')].find(row => row.dataset.trackId === focusId)?.querySelector('.music-drag-handle')?.focus();
  }

  let activeTrackDrag = null;
  function bindTrackDrag(row, handle, trackId) {
    row.addEventListener('pointerdown', event => {
      if (event.button !== 0 || activeTrackDrag || !(event.target instanceof Element)) return;
      const fromHandle = Boolean(event.target.closest('.music-drag-handle'));
      if (event.pointerType !== 'mouse' && !fromHandle) return;
      if (!fromHandle && event.target.closest('button, input, select, textarea, a')) return;

      const pointerId = event.pointerId;
      const origin = { x: event.clientX, y: event.clientY };
      const initialRect = row.getBoundingClientRect();
      let point = origin;
      let dragging = false;
      let ghost = null;
      let dropRow = null;
      let dropPosition = 'before';
      let playlistDrop = null;
      let scrollFrame = 0;

      function clearTargets() {
        dropRow?.classList.remove('drop-before', 'drop-after');
        playlistDrop?.classList.remove('drop-target');
        dropRow = null;
        playlistDrop = null;
      }

      function updateTarget() {
        clearTargets();
        const hovered = document.elementFromPoint(point.x, point.y);
        const selected = getSelectedPlaylist();
        const playlistTarget = hovered?.closest('#musicPlaylistSummary, .music-playlist-select-wrap');
        if (selected && activeFilter !== 'playlist' && playlistTarget && !playlistTarget.classList.contains('hidden')) {
          playlistDrop = playlistTarget;
          playlistDrop.classList.add('drop-target');
          return;
        }
        const candidate = hovered?.closest('.music-track-row');
        if (!candidate || candidate.parentElement !== trackContainer || candidate.dataset.trackId === trackId) return;
        dropRow = candidate;
        const rect = candidate.getBoundingClientRect();
        dropPosition = point.y < rect.top + rect.height / 2 ? 'before' : 'after';
        candidate.classList.add(dropPosition === 'before' ? 'drop-before' : 'drop-after');
      }

      function scrollWhileDragging() {
        if (!dragging) return;
        const rect = trackContainer.getBoundingClientRect();
        if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top - 24 && point.y <= rect.bottom + 24) {
          const edge = 32;
          const speed = point.y < rect.top + edge ? -14 : point.y > rect.bottom - edge ? 14 : 0;
          if (speed) { trackContainer.scrollTop += speed; updateTarget(); }
        }
        scrollFrame = requestAnimationFrame(scrollWhileDragging);
      }

      function startDragging() {
        dragging = true;
        row.classList.add('is-dragging');
        ghost = row.cloneNode(true);
        ghost.classList.add('music-drag-ghost');
        ghost.setAttribute('aria-hidden', 'true');
        Object.assign(ghost.style, { left: `${initialRect.left}px`, top: `${initialRect.top}px`, width: `${initialRect.width}px`, height: `${initialRect.height}px` });
        document.body.append(ghost);
        scrollFrame = requestAnimationFrame(scrollWhileDragging);
      }

      function cleanup() {
        cancelAnimationFrame(scrollFrame);
        clearTargets();
        ghost?.remove();
        row.classList.remove('is-dragging');
        trackContainer.removeEventListener('pointermove', onMove);
        trackContainer.removeEventListener('pointerup', onUp);
        trackContainer.removeEventListener('pointercancel', onCancel);
        document.removeEventListener('keydown', onKeyDown, true);
        if (trackContainer.hasPointerCapture(pointerId)) trackContainer.releasePointerCapture(pointerId);
        activeTrackDrag = null;
      }

      function onMove(moveEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        point = { x: moveEvent.clientX, y: moveEvent.clientY };
        if (!dragging && Math.hypot(point.x - origin.x, point.y - origin.y) < 8) return;
        if (!dragging) startDragging();
        moveEvent.preventDefault();
        ghost.style.transform = `translate3d(${point.x - origin.x}px, ${point.y - origin.y}px, 0)`;
        updateTarget();
      }

      function onUp(upEvent) {
        if (upEvent.pointerId !== pointerId) return;
        if (dragging) {
          point = { x: upEvent.clientX, y: upEvent.clientY };
          updateTarget();
        }
        const targetId = dropRow?.dataset.trackId;
        const targetPosition = dropPosition;
        const addToPlaylist = Boolean(playlistDrop);
        const wasDragging = dragging;
        cleanup();
        if (!wasDragging) return;
        upEvent.preventDefault();
        upEvent.stopPropagation();
        if (addToPlaylist) {
          const selected = getSelectedPlaylist();
          if (selected && !selected.trackIds.includes(trackId)) toggleTrackInSelectedPlaylist(trackId);
        } else if (targetId) reorderTrack(trackId, targetId, targetPosition, trackId);
      }

      function onCancel(cancelEvent) { if (cancelEvent.pointerId === pointerId) cleanup(); }
      function onKeyDown(keyEvent) { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); cleanup(); } }

      trackContainer.setPointerCapture(pointerId);
      trackContainer.addEventListener('pointermove', onMove);
      trackContainer.addEventListener('pointerup', onUp);
      trackContainer.addEventListener('pointercancel', onCancel);
      document.addEventListener('keydown', onKeyDown, true);
      activeTrackDrag = { cancel: cleanup };
      if (fromHandle) handle.focus({ preventScroll: true });
    });
  }

  function settleFadeForPause() {
    if (!fadeState) return;
    const progress = Math.max(0, Math.min(1, (performance.now() - fadeState.startedAt) / fadeState.durationMs));
    const useIncoming = progress >= 0.5;
    const selectedDeck = useIncoming ? fadeState.toDeck : fadeState.fromDeck;
    const selectedIndex = useIncoming ? tracks.findIndex(track => track.id === fadeState.targetTrackId) : currentIndex;
    if (selectedIndex < 0) return;
    if (fadeTimer) clearInterval(fadeTimer);
    fadeTimer = 0; fadeState = null;
    decks[1 - selectedDeck].pause();
    currentDeck = selectedDeck; currentIndex = selectedIndex; currentTrackId = tracks[selectedIndex]?.id || null;
    applyVolumes();
  }

  function applyVolumes() {
    decks.forEach((audio, index) => {
      let envelope = index === currentDeck ? 1 : 0;
      if (fadeState) {
        const progress = Math.max(0, Math.min(1, (performance.now() - fadeState.startedAt) / fadeState.durationMs));
        envelope = index === fadeState.fromDeck ? 1 - progress : index === fadeState.toDeck ? progress : 0;
      }
      audio.volume = Math.max(0, Math.min(1, volume * envelope));
    });
  }

  function ensureEqualizer() {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) {
      $('#musicEqualizerHint').textContent = 'O equalizador não é compatível com este sistema.';
      $('#musicEqualizerHint').classList.remove('hidden');
      return false;
    }
    try {
      if (!equalizerContext) equalizerContext = new AudioContextConstructor();
      decks.forEach((audio, index) => {
        if (equalizerChains.has(index)) return;
        const source = equalizerContext.createMediaElementSource(audio);
        const bass = equalizerContext.createBiquadFilter();
        bass.type = 'lowshelf'; bass.frequency.value = 100;
        const mid = equalizerContext.createBiquadFilter();
        mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1;
        const treble = equalizerContext.createBiquadFilter();
        treble.type = 'highshelf'; treble.frequency.value = 6000;
        const gain = equalizerContext.createGain();
        source.connect(bass).connect(mid).connect(treble).connect(gain).connect(equalizerContext.destination);
        equalizerChains.set(index, { bass, mid, treble, gain });
      });
      applyEqualizerSettings();
      $('#musicEqualizerHint').classList.add('hidden');
      if (equalizerContext.state === 'suspended') void equalizerContext.resume().catch(() => {});
      return true;
    } catch {
      $('#musicEqualizerHint').textContent = 'Não foi possível ativar o equalizador neste dispositivo.';
      $('#musicEqualizerHint').classList.remove('hidden');
      return false;
    }
  }

  function applyEqualizerPreset(preset) {
    if (preset === 'custom') {
      equalizerPreset = 'custom';
      localStorage.setItem('ntc-music-eq-preset', equalizerPreset);
      return;
    }
    equalizerPreset = equalizerPresets[preset] || preset.startsWith('saved:') && savedAudioPresetSettings(preset.slice(6)) ? preset : 'flat';
    equalizerSettings = normalizeEqualizerSettings(equalizerPresetSettings(equalizerPreset), equalizerPresets.flat);
    localStorage.setItem('ntc-music-eq-preset', equalizerPreset);
    localStorage.setItem('ntc-music-eq-settings', JSON.stringify(equalizerSettings));
    updateEqualizerControls();
    ensureEqualizer();
  }

  function formatDecibels(value) { return `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(1)} dB`; }

  function updateEqualizerControls() {
    const fields = { gain: 'musicEqGain', eqBass: 'musicEqBass', eqMid: 'musicEqMid', eqTreble: 'musicEqTreble' };
    for (const [key, id] of Object.entries(fields)) {
      $(`#${id}`).value = String(equalizerSettings[key]);
      $(`#${id}Value`).textContent = formatDecibels(equalizerSettings[key]);
    }
    $('#musicEqualizer').value = equalizerPreset;
  }

  function applyEqualizerSettings() {
    if (!equalizerContext) return;
    const now = equalizerContext.currentTime;
    for (const chain of equalizerChains.values()) {
      chain.bass.gain.setTargetAtTime(equalizerSettings.eqBass, now, .025);
      chain.mid.gain.setTargetAtTime(equalizerSettings.eqMid, now, .025);
      chain.treble.gain.setTargetAtTime(equalizerSettings.eqTreble, now, .025);
      chain.gain.gain.setTargetAtTime(Math.pow(10, equalizerSettings.gain / 20), now, .025);
    }
  }

  function setEqualizerBand(key, value) {
    equalizerSettings = normalizeEqualizerSettings({ ...equalizerSettings, [key]: value });
    equalizerPreset = 'custom';
    localStorage.setItem('ntc-music-eq-preset', equalizerPreset);
    localStorage.setItem('ntc-music-eq-settings', JSON.stringify(equalizerSettings));
    updateEqualizerControls();
    ensureEqualizer();
  }

  function refreshMusicEqualizerPresets() {
    const select = $('#musicEqualizer');
    const builtins = [
      ['custom', 'Manual'], ['flat', 'Equilibrado'], ['voz', 'Voz'], ['musica', 'Música'],
      ['podcast', 'Podcast'], ['bass', 'Graves'], ['vocal', 'Vocal'], ['rock', 'Rock']
    ];
    select.replaceChildren(...builtins.map(([value, label]) => new Option(label, value)));
    for (const name of Object.keys(readObject('ntc-audio-presets'))) select.add(new Option(name, `saved:${name}`));
    if (equalizerPreset.startsWith('saved:') && !savedAudioPresetSettings(equalizerPreset.slice(6))) equalizerPreset = 'flat';
    if (!equalizerPresets[equalizerPreset] && equalizerPreset !== 'custom' && !equalizerPreset.startsWith('saved:')) equalizerPreset = 'flat';
    select.value = equalizerPreset;
  }
  window.refreshMusicEqualizerPresets = refreshMusicEqualizerPresets;

  function saveMusicEqualizerPreset() {
    const name = window.prompt('Nome do preset de equalizador');
    if (!name?.trim()) return;
    const presetName = name.trim().slice(0, 40);
    const saved = readObject('ntc-audio-presets');
    saved[presetName] = { ...equalizerSettings, removeSilence: false, normalize: false };
    try {
      localStorage.setItem('ntc-audio-presets', JSON.stringify(saved));
      equalizerPreset = `saved:${presetName}`;
      localStorage.setItem('ntc-music-eq-preset', equalizerPreset);
      refreshMusicEqualizerPresets();
      $('#musicEqualizer').value = equalizerPreset;
      if (typeof window.refreshAudioPresets === 'function') window.refreshAudioPresets();
      showLibraryMessage(`Preset “${presetName}” salvo neste computador.`);
    } catch { showLibraryMessage('Não foi possível salvar o preset. O armazenamento local pode estar cheio.'); }
  }

  function filteredTracks() {
    const query = $('#musicSearch').value.trim().toLocaleLowerCase('pt-BR');
    const selectedIds = new Set(getSelectedPlaylist()?.trackIds || []);
    let entries = tracks.map((track, index) => ({ track, index })).filter(({ track }) => libraryTrackIds.has(track.id) || ((playlistEditMode || activeFilter === 'playlist') && selectedIds.has(track.id)));
    if (activeFilter === 'playlist') {
      const order = getSelectedPlaylist()?.trackIds || [];
      const byId = new Map(entries.map(entry => [entry.track.id, entry]));
      entries = order.map(id => byId.get(id)).filter(Boolean);
    }
    entries = entries.filter(({ track }) => {
      if (activeFilter === 'liked' && !liked.has(track.id)) return false;
      if (activeFilter === 'playlist' && !getSelectedPlaylist()?.trackIds.includes(track.id)) return false;
      if (!query) return true;
      const tags = getTrackTags(track);
      return `${track.name} ${track.folder} ${track.extension} ${tags.title || ''} ${tags.artist || ''} ${tags.album || ''} ${tags.genre || ''}`.toLocaleLowerCase('pt-BR').includes(query);
    });
    if (sortMode !== 'queue') {
      entries.sort((left, right) => {
        const leftTags = getTrackTags(left.track);
        const rightTags = getTrackTags(right.track);
        const leftValue = String(sortMode === 'title' ? leftTags.title || left.track.name : leftTags[sortMode] || '').trim();
        const rightValue = String(sortMode === 'title' ? rightTags.title || right.track.name : rightTags[sortMode] || '').trim();
        return (leftValue || '\uffff').localeCompare(rightValue || '\uffff', 'pt-BR', { sensitivity: 'base', numeric: true }) || left.track.name.localeCompare(right.track.name, 'pt-BR', { sensitivity: 'base', numeric: true });
      });
    }
    return entries;
  }

  function setMusicFilter(filter) {
    if (filter === 'playlist' && playlistEditMode) playlistEditMode = false;
    activeFilter = filter;
    document.querySelectorAll('[data-music-filter]').forEach(item => item.classList.toggle('active', item.dataset.musicFilter === activeFilter));
    renderPlaylistControls();
    renderTracks();
  }

  function renderFolders() {
    folderContainer.replaceChildren();
    for (const folder of folders) {
      const chip = document.createElement('div');
      chip.className = 'music-folder-chip';
      chip.title = folder;
      const label = document.createElement('span');
      label.textContent = `▰ ${folder.split(/[\\/]/).filter(Boolean).at(-1) || folder}`;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remover pasta ${label.textContent.slice(2)}`);
      remove.addEventListener('click', () => void removeFolder(folder));
      chip.append(label, remove); folderContainer.append(chip);
    }
    folderContainer.classList.toggle('hidden', folders.length === 0);
    $('#musicFoldersEmpty').classList.toggle('hidden', folders.length > 0);
  }

  function saveOnlineArtwork(trackId, result) {
    onlineArtwork.delete(trackId);
    onlineArtwork.set(trackId, result);
    while (onlineArtwork.size > 12) onlineArtwork.delete(onlineArtwork.keys().next().value);
    try { localStorage.setItem('ntc-music-online-artwork', JSON.stringify(Object.fromEntries(onlineArtwork))); }
    catch {
      while (onlineArtwork.size > 1) onlineArtwork.delete(onlineArtwork.keys().next().value);
      try { localStorage.setItem('ntc-music-online-artwork', JSON.stringify(Object.fromEntries(onlineArtwork))); } catch { /* The selected cover still works for this session. */ }
    }
  }

  function renderOnlineResults(results, statusMessage = '') {
    const container = $('#musicOnlineResults');
    container.replaceChildren();
    container.classList.remove('hidden');
    if (statusMessage) {
      const status = document.createElement('p'); status.className = 'music-online-status'; status.textContent = statusMessage; container.append(status); return;
    }
    for (const result of results) {
      const option = document.createElement('button'); option.type = 'button'; option.className = 'music-online-result';
      option.title = 'Usar esta capa e estes metadados para a faixa';
      const copy = document.createElement('span'); copy.className = 'music-online-result-copy';
      const title = document.createElement('strong'); title.textContent = result.trackTitle || result.title;
      const artist = document.createElement('small'); artist.textContent = [result.album, [result.artist, result.year].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
      copy.append(title, artist);
      if (result.coverDataUrl) { const cover = document.createElement('img'); cover.alt = ''; cover.src = result.coverDataUrl; option.append(cover); }
      option.append(copy);
      option.addEventListener('click', () => {
        const track = tracks.find(item => item.id === currentTrackId);
        if (!track) return;
        const local = metadataByTrack.get(track.id)?.metadata || {};
        const selected = { ...result, metadata: { ...local, title: local.title || result.trackTitle, artist: result.artist || local.artist, album: result.album || local.album, year: result.year || local.year } };
        metadataByTrack.set(track.id, selected); saveOnlineArtwork(track.id, selected);
        container.classList.add('hidden'); updatePlayer();
      });
      container.append(option);
    }
    if (results.length) {
      const attribution = document.createElement('p'); attribution.className = 'music-online-attribution';
      attribution.textContent = 'Dados: MusicBrainz · Capas: Cover Art Archive.';
      container.append(attribution);
    }
  }

  async function loadTrackMetadata(track) {
    if (!libraryTrackIds.has(track.id)) return metadataByTrack.get(track.id) || null;
    if (artworkLoadedForTrack.has(track.id)) return metadataByTrack.get(track.id);
    try {
      const metadata = await window.ntc.getMusicTrackMetadata(track.path);
      const existing = metadataByTrack.get(track.id) || {};
      metadataByTrack.set(track.id, { ...existing, ...metadata, metadata: { ...(existing.metadata || {}), ...(metadata.metadata || {}) } });
      artworkLoadedForTrack.add(track.id);
      saveTagCache(track.id, metadataByTrack.get(track.id));
      if (currentTrackId === track.id) updatePlayer();
      return metadataByTrack.get(track.id);
    } catch { return null; }
  }

  async function loadTrackTags(track) {
    if (metadataByTrack.has(track.id)) return metadataByTrack.get(track.id);
    if (!libraryTrackIds.has(track.id)) return null;
    try {
      const result = await window.ntc.getMusicTrackTags(track.path);
      metadataByTrack.set(track.id, result);
      saveTagCache(track.id, result);
      if (currentTrackId === track.id) updatePlayer();
      return result;
    } catch { return null; }
  }

  async function ensureLibraryMetadata() {
    if (metadataLoadPromise || !tracks.length) return metadataLoadPromise;
    const pending = tracks.filter(track => libraryTrackIds.has(track.id) && !metadataByTrack.has(track.id));
    if (!pending.length) return;
    let cursor = 0;
    let completed = 0;
    showLibraryMessage(`Lendo artista, álbum e gênero… 0/${pending.length}`);
    metadataLoadPromise = Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (cursor < pending.length) {
        const track = pending[cursor++];
        await loadTrackTags(track);
        completed++;
        if (completed % 50 === 0 || completed === pending.length) {
          showLibraryMessage(`Lendo artista, álbum e gênero… ${completed}/${pending.length}`);
          if (completed % 250 === 0 || completed === pending.length) renderTracks();
        }
      }
    })).finally(() => {
      metadataLoadPromise = null;
      showLibraryMessage('');
      renderTracks();
    });
    return metadataLoadPromise;
  }

  function renderTracks() {
    trackContainer.replaceChildren();
    const visible = filteredTracks();
    const visibleIds = visible.map(entry => entry.track.id);
    const selectedPlaylist = getSelectedPlaylist();
    const playlistOrderView = activeFilter === 'playlist' && Boolean(selectedPlaylist);
    const canReorder = !playlistEditMode && (activeFilter !== 'playlist' || playlistOrderView);
    trackContainer.classList.toggle('is-playlist-editing', playlistEditMode);
    $('#musicTrackCount').textContent = `${libraryTrackIds.size} ${libraryTrackIds.size === 1 ? 'faixa' : 'faixas'}`;
    $('#musicLikedCount').textContent = String(liked.size);
    for (const { track, index } of visible) {
      const row = document.createElement('div');
      row.className = `music-track-row${index === currentIndex ? ' is-current' : ''}`;
      row.setAttribute('role', 'listitem');
      row.dataset.trackId = track.id;
      const reorderControl = canReorder ? document.createElement('button') : document.createElement('span');
      reorderControl.className = canReorder ? 'music-drag-handle' : 'music-drag-spacer';
      if (canReorder) {
        reorderControl.type = 'button';
        reorderControl.textContent = '⠿';
        reorderControl.title = `Arraste ${track.name} para mudar a posição`;
        reorderControl.setAttribute('aria-label', `Reordenar ${track.name}. Arraste ou use as setas para cima e para baixo.`);
        reorderControl.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
        reorderControl.addEventListener('keydown', event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const step = event.key === 'ArrowUp' ? -1 : 1;
          const neighborId = visibleIds[visibleIds.indexOf(track.id) + step];
          if (neighborId) reorderTrack(track.id, neighborId, step < 0 ? 'before' : 'after', track.id);
        });
        bindTrackDrag(row, reorderControl, track.id);
      }
      const play = document.createElement('button');
      play.type = 'button'; play.className = 'music-track-play';
      play.textContent = index === currentIndex && playing ? '♫' : '▶';
      const tags = getTrackTags(track);
      const displayTitle = tags.title || track.name;
      play.setAttribute('aria-label', `Tocar ${displayTitle}`);
      play.addEventListener('click', () => void playTrack(index, visibleIds));
      const copy = document.createElement('div'); copy.className = 'music-track-copy';
      const title = document.createElement('strong'); title.textContent = displayTitle;
      const subtitle = document.createElement('span'); subtitle.textContent = [tags.artist, tags.album].filter(Boolean).join(' · ') || `${track.folder} · ${track.extension}`;
      copy.append(title, subtitle);
      const duration = document.createElement('span'); duration.className = 'music-track-duration'; duration.textContent = durations.has(track.id) ? formatTime(durations.get(track.id)) : '—';
      const favorite = document.createElement('button'); favorite.type = 'button'; favorite.className = `music-like-button${liked.has(track.id) ? ' is-liked' : ''}`;
      favorite.textContent = liked.has(track.id) ? '♥' : '♡'; favorite.setAttribute('aria-label', liked.has(track.id) ? `Remover ${track.name} das curtidas` : `Curtir ${track.name}`);
      favorite.setAttribute('aria-pressed', String(liked.has(track.id)));
      favorite.addEventListener('click', () => toggleLiked(track.id));
      const playlistButton = document.createElement('button');
      const inSelectedPlaylist = Boolean(selectedPlaylist?.trackIds.includes(track.id));
      playlistButton.type = 'button'; playlistButton.className = `music-playlist-toggle${selectedPlaylist ? '' : ' hidden'}${inSelectedPlaylist ? ' is-in-playlist' : ''}`;
      playlistButton.textContent = activeFilter === 'playlist' ? '×' : playlistEditMode ? (inSelectedPlaylist ? 'Remover' : 'Adicionar') : (inSelectedPlaylist ? '✓' : '+');
      playlistButton.title = !selectedPlaylist ? 'Selecione uma playlist para adicionar esta faixa' : inSelectedPlaylist ? `Remover ${track.name} da playlist ${selectedPlaylist.name}` : `Adicionar ${track.name} à playlist ${selectedPlaylist.name}`;
      playlistButton.setAttribute('aria-label', playlistButton.title);
      playlistButton.setAttribute('aria-pressed', String(inSelectedPlaylist));
      playlistButton.addEventListener('click', () => toggleTrackInSelectedPlaylist(track.id));
      const actions = document.createElement('div'); actions.className = 'music-track-actions';
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'music-track-more'; more.textContent = '⋯';
      more.title = `Opções de ${displayTitle}`;
      more.setAttribute('aria-label', more.title);
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => openTrackMenu(track, more));
      actions.append(playlistButton, more);
      row.append(reorderControl, play, copy, duration, favorite, actions); trackContainer.append(row);
    }
    if (!visible.length) {
      const empty = document.createElement('div'); empty.className = 'music-empty-state';
      empty.textContent = activeFilter === 'playlist' ? 'Esta playlist está vazia. Clique em “Editar faixas” para escolher músicas da biblioteca.' : libraryTrackIds.size || (playlistEditMode && getSelectedPlaylist()?.trackIds.length) ? (activeFilter === 'liked' ? 'Nenhuma música curtida por enquanto.' : 'Nenhuma música corresponde à busca.') : 'Sua biblioteca ainda está vazia.';
      trackContainer.append(empty);
    }
    $('#musicCrossfadeValue').value = `${crossfadeSeconds} s`;
  }

  function toggleTrackInSelectedPlaylist(trackId) {
    const selected = getSelectedPlaylist();
    if (!selected) { $('#musicNewPlaylist').click(); return; }
    if (!selected.trackIds.includes(trackId)) {
      const track = tracks.find(item => item.id === trackId);
      if (track) rememberTrackSnapshot(track);
    }
    playlists = playlists.map(playlist => playlist.id === selected.id ? window.ntcMusicPlaylists.toggleMusicPlaylistTrack(playlist, trackId) : playlist);
    savePlaylists();
    renderTracks();
  }

  async function removeTrackFromApp(track) {
    if (!window.confirm(`Remover “${getTrackTags(track).title || track.name}” do NTC?\n\nA faixa sairá da biblioteca, das playlists e da fila. O arquivo original no PC não será apagado.`)) return;
    try {
      await window.ntc.removeMusicTrack(track.path);
      playlists = playlists.map(playlist => ({ ...playlist, trackIds: playlist.trackIds.filter(id => id !== track.id) }));
      savePlaylists();
      liked.delete(track.id);
      localStorage.setItem('ntc-music-liked', JSON.stringify([...liked]));
      trackSnapshots.delete(track.id);
      persistTrackSnapshots();
      playbackQueueIds = playbackQueueIds.filter(id => id !== track.id);
      if (currentTrackId === track.id) {
        escapeEndFade();
        decks.forEach(audio => { audio.pause(); audio.removeAttribute('src'); audio.load(); });
        currentIndex = -1; currentTrackId = null; playing = false;
        localStorage.removeItem('ntc-music-playback-state');
      } else if (currentTrackId) savePlaybackState(true);
      await scanLibrary();
      showLibraryMessage('Música removida do NTC. O arquivo original continua no PC.');
    } catch (error) { showLibraryMessage(`Não foi possível remover a música: ${error.message}`); }
  }

  let closeTrackMenu = null;
  function openTrackMenu(track, anchor) {
    closeTrackMenu?.();
    const menu = document.createElement('div');
    menu.className = 'music-track-menu';
    menu.setAttribute('role', 'menu');
    const remove = document.createElement('button');
    remove.type = 'button'; remove.setAttribute('role', 'menuitem');
    remove.textContent = 'Remover do NTC';
    remove.addEventListener('click', () => { closeTrackMenu?.(); void removeTrackFromApp(track); });
    menu.append(remove);
    document.body.append(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + menu.offsetHeight + 8 > innerHeight ? rect.top - menu.offsetHeight - 4 : rect.bottom + 4}px`;
    anchor.setAttribute('aria-expanded', 'true');
    const close = () => {
      menu.remove(); anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onEscape, true);
      if (closeTrackMenu === close) closeTrackMenu = null;
    };
    const onOutside = event => { if (!menu.contains(event.target) && event.target !== anchor) close(); };
    const onEscape = event => { if (event.key === 'Escape') { close(); anchor.focus(); } };
    closeTrackMenu = close;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onEscape, true);
    remove.focus();
  }

  function openPlaylistCreator() {
    const form = $('#musicPlaylistCreate');
    form.classList.remove('hidden');
    $('#musicPlaylistName').focus();
  }

  $('#musicNewPlaylist').addEventListener('click', openPlaylistCreator);
  $('#musicCancelPlaylist').addEventListener('click', () => {
    $('#musicPlaylistCreate').classList.add('hidden');
    $('#musicPlaylistName').value = '';
  });
  $('#musicPlaylistCreate').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('#musicPlaylistName').value.trim().slice(0, 48);
    if (!name) { $('#musicPlaylistName').focus(); return; }
    if (playlists.some(item => item.name.localeCompare(name, 'pt-BR', { sensitivity: 'base' }) === 0)) {
      showLibraryMessage('Já existe uma playlist com esse nome.');
      $('#musicPlaylistName').focus();
      return;
    }
    const id = `playlist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    playlists.push({ id, name, trackIds: [] });
    activePlaylistId = id;
    playlistEditMode = true;
    playlistInfoEditing = false;
    playlistCoverDraft = '';
    localStorage.setItem('ntc-music-active-playlist', id);
    savePlaylists();
    $('#musicPlaylistCreate').classList.add('hidden');
    $('#musicPlaylistName').value = '';
    setMusicFilter('all');
  });
  $('#musicPlaylistSelect').addEventListener('change', event => {
    activePlaylistId = event.currentTarget.value;
    playlistEditMode = false;
    playlistInfoEditing = false;
    localStorage.setItem('ntc-music-active-playlist', activePlaylistId);
    setMusicFilter(activePlaylistId ? 'playlist' : 'all');
  });
  $('#musicEditPlaylist').addEventListener('click', () => {
    if (!getSelectedPlaylist()) return;
    playlistEditMode = !playlistEditMode;
    setMusicFilter(playlistEditMode ? 'all' : 'playlist');
  });
  $('#musicEditPlaylistInfo').addEventListener('click', () => {
    const selected = getSelectedPlaylist();
    if (!selected) return;
    playlistCoverDraft = selected.coverDataUrl || '';
    $('#musicPlaylistNameInput').value = selected.name;
    $('#musicPlaylistDescriptionInput').value = selected.description || '';
    playlistInfoEditing = true;
    renderPlaylistControls();
  });
  $('#musicCancelPlaylistInfo').addEventListener('click', () => {
    playlistInfoEditing = false;
    renderPlaylistControls();
  });
  $('#musicChoosePlaylistCover').addEventListener('click', async () => {
    try {
      const cover = await window.ntc.chooseMusicPlaylistCover();
      if (!cover) return;
      playlistCoverDraft = cover;
      renderPlaylistDetails();
    } catch (error) { showLibraryMessage(`Não foi possível carregar a capa: ${error.message}`); }
  });
  $('#musicRemovePlaylistCover').addEventListener('click', () => {
    playlistCoverDraft = '';
    renderPlaylistDetails();
  });
  $('#musicPlaylistInfoForm').addEventListener('submit', event => {
    event.preventDefault();
    const selected = getSelectedPlaylist();
    if (!selected) return;
    const name = $('#musicPlaylistNameInput').value.trim().slice(0, 48);
    if (!name) { $('#musicPlaylistNameInput').focus(); return; }
    if (playlists.some(playlist => playlist.id !== selected.id && playlist.name.localeCompare(name, 'pt-BR', { sensitivity: 'base' }) === 0)) {
      showLibraryMessage('Já existe uma playlist com esse nome.');
      $('#musicPlaylistNameInput').focus();
      return;
    }
    const description = $('#musicPlaylistDescriptionInput').value.trim().slice(0, 300);
    playlists = playlists.map(playlist => playlist.id === selected.id ? { ...playlist, name, description, coverDataUrl: playlistCoverDraft } : playlist);
    playlistInfoEditing = false;
    savePlaylists();
  });
  $('#musicDeletePlaylist').addEventListener('click', () => {
    const selected = getSelectedPlaylist();
    if (!selected || !window.confirm(`Excluir a playlist “${selected.name}”? As músicas originais não serão apagadas.`)) return;
    playlists = playlists.filter(item => item.id !== selected.id);
    activePlaylistId = '';
    playlistInfoEditing = false;
    localStorage.removeItem('ntc-music-active-playlist');
    savePlaylists();
    setMusicFilter('all');
  });

  function toggleLiked(id) {
    if (liked.has(id)) liked.delete(id); else liked.add(id);
    localStorage.setItem('ntc-music-liked', JSON.stringify([...liked]));
    renderTracks();
  }

  function updatePlayer() {
    const track = tracks[currentIndex];
    const metadata = track ? metadataByTrack.get(track.id) : null;
    const online = track ? onlineArtwork.get(track.id) : null;
    const tags = track ? getTrackTags(track) : {};
    const imageData = online?.coverDataUrl || metadata?.coverDataUrl || '';
    $('#musicNowTitle').textContent = track ? (tags.title || track.name) : 'Escolha uma música';
    $('#musicNowSubtitle').textContent = track ? ([tags.artist, tags.album].filter(Boolean).join(' · ') || `${track.folder} · ${track.extension}`) : 'Sua coleção fica neste computador.';
    const coverImage = $('#musicCoverImage');
    coverImage.classList.toggle('hidden', !imageData);
    if (imageData && coverImage.src !== imageData) coverImage.src = imageData;
    if (!imageData) coverImage.removeAttribute('src');
    $('.music-cover').classList.toggle('has-image', Boolean(imageData));
    $('#musicOnlineSearch').classList.toggle('hidden', !track);
    $('#musicOnlineSearch').textContent = imageData ? 'Buscar outros dados online' : 'Buscar capa e dados online';
    $('#musicArtistToggle').classList.toggle('hidden', !track);
    $('#musicLookupHint').classList.toggle('hidden', Boolean(track));
    if (!track) { $('#musicOnlineResults').classList.add('hidden'); $('#musicArtistOverride').classList.add('hidden'); }
    $('#musicPlayPause').querySelector('.music-play-icon').classList.toggle('hidden', playing);
    $('#musicPlayPause').querySelector('.music-pause-icon').classList.toggle('hidden', !playing);
    $('#musicPlayPause').setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
    const audio = decks[currentDeck];
    const duration = Number.isFinite(audio.duration) ? audio.duration : (track ? durations.get(track.id) : 0) || 0;
    $('#musicDuration').textContent = formatTime(duration);
    if (!track) { $('#musicCurrentTime').textContent = '0:00'; $('#musicSeek').value = '0'; }
    renderTracks();
  }

  async function runOnlineSearch(track, button, artistOverride = '') {
    if (!track) return;
    const requestedArtist = artistOverride.trim();
    const trackId = track.id;
    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Buscando…';
    renderOnlineResults([], requestedArtist
      ? `Buscando “${track.name}” com o artista “${requestedArtist}”. O áudio e o caminho local não são enviados.`
      : 'Buscando a faixa pelo título e artista. O áudio e o caminho local não são enviados.');
    try {
      const results = await window.ntc.searchOnlineMusicMetadata(track.path, requestedArtist);
      if (currentTrackId !== trackId) return;
      if (results.length) renderOnlineResults(results);
      else {
        renderOnlineResults([], requestedArtist ? 'Não encontrei resultados com esse artista. Tente outro nome.' : 'Não encontrei essa versão. Você pode informar o artista e tentar novamente.');
        $('#musicArtistOverride').classList.remove('hidden');
        $('#musicArtistToggle').setAttribute('aria-expanded', 'true');
        $('#musicArtistName').focus();
      }
    } catch (error) {
      if (currentTrackId === trackId) {
        const message = String(error?.message || '');
        const detail = message.includes('Error invoking remote method') ? message.split('Error: ').at(-1) : message;
        renderOnlineResults([], detail || 'Não foi possível buscar os dados online. Tente novamente em alguns instantes.');
      }
    } finally {
      button.disabled = false;
      if (button.id === 'musicOnlineSearch') {
        const current = tracks.find(item => item.id === currentTrackId);
        if (current) button.textContent = (metadataByTrack.get(current.id)?.coverDataUrl || onlineArtwork.get(current.id)?.coverDataUrl) ? 'Buscar outros dados online' : 'Buscar capa e dados online';
      } else button.textContent = originalLabel;
    }
  }

  $('#musicOnlineSearch').addEventListener('click', event => {
    const track = tracks.find(item => item.id === currentTrackId);
    void runOnlineSearch(track, event.currentTarget);
  });
  $('#musicArtistToggle').addEventListener('click', event => {
    const form = $('#musicArtistOverride');
    const open = form.classList.toggle('hidden') === false;
    event.currentTarget.setAttribute('aria-expanded', String(open));
    if (open) $('#musicArtistName').focus();
  });
  $('#musicSearchWithArtist').addEventListener('click', event => {
    const artist = $('#musicArtistName').value.trim();
    if (!artist) { $('#musicArtistName').focus(); return; }
    const track = tracks.find(item => item.id === currentTrackId);
    void runOnlineSearch(track, event.currentTarget, artist);
  });
  $('#musicArtistName').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('#musicSearchWithArtist').click(); }
  });

  function updateProgress() {
    const audio = decks[currentDeck];
    if (!Number.isFinite(audio.duration) || !audio.duration) return;
    $('#musicCurrentTime').textContent = formatTime(audio.currentTime);
    $('#musicDuration').textContent = formatTime(audio.duration);
    if (!$('#musicSeek').matches(':active')) $('#musicSeek').value = String(Math.round(audio.currentTime / audio.duration * 1000));
  }

  async function playTrack(index, queueIds = null) {
    if (!tracks[index]) return;
    escapeEndFade();
    if (Array.isArray(queueIds)) playbackQueueIds = queueIds.filter(id => tracks.some(track => track.id === id));
    if (!playbackQueueIds.includes(tracks[index].id)) playbackQueueIds = filteredTracks().map(entry => entry.track.id);
    decks.forEach(audio => { audio.pause(); audio.volume = 0; });
    currentDeck = 1 - currentDeck;
    const audio = decks[currentDeck];
    currentIndex = index;
    currentTrackId = tracks[index].id;
    $('#musicOnlineResults').classList.add('hidden');
    $('#musicArtistOverride').classList.add('hidden');
    $('#musicArtistToggle').setAttribute('aria-expanded', 'false');
    $('#musicArtistName').value = '';
    void loadTrackMetadata(tracks[index]);
    playing = false;
    pendingResumeSeek = null;
    audio.src = tracks[index].src;
    audio.load();
    ensureEqualizer();
    applyVolumes();
    try {
      await audio.play();
      playing = true;
      setPlaybackMessage(`${tracks[index].folder} · ${tracks[index].extension}`);
      savePlaybackState(true);
    } catch {
      playing = false;
      setPlaybackMessage('Este arquivo não pôde ser reproduzido neste formato.');
      showLibraryMessage(`Não foi possível reproduzir “${tracks[index].name}”. Tente um arquivo MP3, WAV, FLAC ou OGG.`);
    }
    updatePlayer();
  }

  async function togglePlayback() {
    if (currentIndex < 0) {
      const entries = filteredTracks();
      if (entries.length) await playTrack(entries[0].index, entries.map(entry => entry.track.id));
      else showLibraryMessage('Adicione uma pasta ou arraste arquivos de áudio para começar.');
      return;
    }
    const audio = decks[currentDeck];
    if (playing) { settleFadeForPause(); decks[currentDeck].pause(); playing = false; savePlaybackState(true); }
    else {
      try { ensureEqualizer(); await audio.play(); playing = true; setPlaybackMessage(`${tracks[currentIndex].folder} · ${tracks[currentIndex].extension}`); savePlaybackState(true); }
      catch { setPlaybackMessage('Não foi possível continuar a reprodução.'); }
    }
    updatePlayer();
  }

  function nextIndex() {
    const queue = playbackQueueIds.length ? playbackQueueIds.filter(id => tracks.some(track => track.id === id)) : tracks.map(track => track.id);
    if (!queue.length) return -1;
    if (repeatMode === 'one') return currentIndex;
    const currentPosition = queue.indexOf(currentTrackId);
    if (shuffle && queue.length > 1) {
      let candidate = currentPosition;
      while (candidate === currentPosition) candidate = Math.floor(Math.random() * queue.length);
      return tracks.findIndex(track => track.id === queue[candidate]);
    }
    if (currentPosition >= 0 && currentPosition + 1 < queue.length) return tracks.findIndex(track => track.id === queue[currentPosition + 1]);
    return repeatMode === 'all' ? tracks.findIndex(track => track.id === queue[0]) : -1;
  }

  function previousIndex() {
    const queue = playbackQueueIds.length ? playbackQueueIds.filter(id => tracks.some(track => track.id === id)) : tracks.map(track => track.id);
    const currentPosition = queue.indexOf(currentTrackId);
    if (currentPosition > 0) return tracks.findIndex(track => track.id === queue[currentPosition - 1]);
    return repeatMode === 'all' && queue.length ? tracks.findIndex(track => track.id === queue.at(-1)) : currentIndex;
  }

  async function playNext() {
    const next = nextIndex();
    if (next < 0) {
      decks[currentDeck].pause(); decks[currentDeck].currentTime = 0; playing = false; savePlaybackState(true); updatePlayer(); return;
    }
    await playTrack(next, playbackQueueIds);
  }

  function startCrossfade(targetIndex, seconds) {
    if (!tracks[targetIndex] || fadeState || seconds <= 0) return;
    const fromDeck = currentDeck;
    const toDeck = 1 - currentDeck;
    const next = decks[toDeck];
    next.pause(); next.src = tracks[targetIndex].src; next.currentTime = 0; next.load(); next.volume = 0;
    const durationMs = Math.max(120, seconds * 1000);
    const oldTrack = tracks[currentIndex];
    fadeState = { fromDeck, toDeck, targetIndex, targetTrackId: tracks[targetIndex].id, startedAt: performance.now(), durationMs };
    void next.play().then(() => {
      if (!fadeState || fadeState.fromDeck !== fromDeck || fadeState.toDeck !== toDeck) { next.pause(); return; }
      const resolvedTargetIndex = tracks.findIndex(track => track.id === fadeState.targetTrackId);
      if (resolvedTargetIndex < 0) { fadeState = null; next.pause(); applyVolumes(); return; }
      if (decks[fromDeck].ended) {
        decks[fromDeck].pause(); currentDeck = toDeck; currentIndex = resolvedTargetIndex; currentTrackId = tracks[resolvedTargetIndex].id;
        void loadTrackMetadata(tracks[resolvedTargetIndex]);
        fadeState = null; playing = true; applyVolumes(); updatePlayer(); return;
      }
      fadeState.startedAt = performance.now();
      fadeTimer = setInterval(() => {
        if (!fadeState) return;
        const progress = Math.min(1, (performance.now() - fadeState.startedAt) / fadeState.durationMs);
        applyVolumes();
        if (progress >= 1) {
          clearInterval(fadeTimer); fadeTimer = 0;
          decks[fromDeck].pause(); decks[fromDeck].currentTime = 0;
          const finalTargetIndex = tracks.findIndex(track => track.id === fadeState.targetTrackId);
          if (finalTargetIndex < 0) { next.pause(); currentDeck = fromDeck; fadeState = null; applyVolumes(); return; }
          currentDeck = toDeck; currentIndex = finalTargetIndex; currentTrackId = tracks[finalTargetIndex].id; fadeState = null; playing = true;
          void loadTrackMetadata(tracks[finalTargetIndex]);
          applyVolumes(); updatePlayer();
        }
      }, 25);
      setPlaybackMessage(`${oldTrack?.folder || ''} · ${oldTrack?.extension || ''}`);
    }).catch(() => {
      if (fadeState?.fromDeck === fromDeck && fadeState?.toDeck === toDeck) fadeState = null;
      applyVolumes();
      if (decks[fromDeck].ended && fromDeck === currentDeck) void playNext();
    });
  }

  function maybeCrossfade() {
    const audio = decks[currentDeck];
    if (!playing || fadeState || crossfadeSeconds <= 0 || !Number.isFinite(audio.duration)) return;
    const target = nextIndex();
    if (target < 0) return;
    const window = Math.min(crossfadeSeconds, audio.duration / 2);
    const remaining = audio.duration - audio.currentTime;
    if (window > 0 && remaining <= window && remaining > 0.08) startCrossfade(target, Math.min(window, remaining));
  }

  async function removeFolder(folder) {
    try { folders = await window.ntc.removeMusicFolder(folder); renderFolders(); await scanLibrary(); }
    catch (error) { showLibraryMessage(`Não foi possível remover a pasta: ${error.message}`); }
  }

  function restorePlaybackState() {
    if (currentTrackId) return;
    const saved = readObject('ntc-music-playback-state');
    const index = tracks.findIndex(track => track.id === saved.trackId);
    if (index < 0) return;
    currentIndex = index;
    currentTrackId = tracks[index].id;
    playbackQueueIds = Array.isArray(saved.queueIds) ? saved.queueIds.filter(id => tracks.some(track => track.id === id)) : tracks.map(track => track.id);
    if (!playbackQueueIds.includes(currentTrackId)) playbackQueueIds.push(currentTrackId);
    currentDeck = 0;
    playing = false;
    pendingResumeSeek = { trackId: currentTrackId, time: Number.isFinite(Number(saved.time)) ? Math.max(0, Number(saved.time)) : 0 };
    const audio = decks[currentDeck];
    audio.pause(); audio.src = tracks[index].src; audio.load();
    void loadTrackMetadata(tracks[index]);
    setPlaybackMessage('Última faixa e posição restauradas. Pressione reproduzir para continuar.');
  }

  async function scanLibrary() {
    if (scanInProgress) return;
    scanInProgress = true;
    $('#musicRescan').disabled = true;
    $('#musicAddFolders').disabled = true;
    showLibraryMessage('Procurando músicas nas pastas selecionadas…');
    try {
      const list = await window.ntc.scanMusicLibrary();
      const activeId = currentTrackId;
      const orderedLibrary = applySavedTrackOrder(list);
      libraryTrackIds.clear();
      orderedLibrary.forEach(track => libraryTrackIds.add(track.id));
      const playlistTrackIds = new Set(playlists.flatMap(playlist => playlist.trackIds));
      let addedSnapshots = false;
      for (const track of orderedLibrary) {
        if (playlistTrackIds.has(track.id)) {
          trackSnapshots.set(track.id, { id: track.id, path: track.path, src: track.src, name: track.name, folder: track.folder, extension: track.extension });
          addedSnapshots = true;
        }
      }
      if (addedSnapshots) persistTrackSnapshots();
      const libraryIds = new Set(orderedLibrary.map(track => track.id));
      const detachedPlaylistTracks = [...playlistTrackIds].filter(id => !libraryIds.has(id)).map(trackFromPlaylistSnapshot).filter(Boolean);
      tracks.splice(0, tracks.length, ...orderedLibrary, ...detachedPlaylistTracks);
      renderFolders();
      const nextIndexAfterScan = activeId ? tracks.findIndex(track => track.id === activeId) : -1;
      if (fadeState && !tracks.some(track => track.id === fadeState.targetTrackId)) { decks[fadeState.toDeck].pause(); escapeEndFade(); }
      if (activeId && nextIndexAfterScan < 0) { escapeEndFade(); decks.forEach(audio => { audio.pause(); audio.removeAttribute('src'); audio.load(); }); currentIndex = -1; currentTrackId = null; playing = false; }
      else if (nextIndexAfterScan >= 0) currentIndex = nextIndexAfterScan;
      restorePlaybackState();
      showLibraryMessage(libraryTrackIds.size ? '' : (folders.length ? 'Não encontrei arquivos de áudio compatíveis nessas pastas.' : 'Adicione uma pasta ou arraste arquivos de áudio para começar.'));
      updatePlayer();
    } catch (error) {
      showLibraryMessage(`Não foi possível ler a biblioteca: ${error.message}`);
    } finally {
      scanInProgress = false; $('#musicRescan').disabled = false; $('#musicAddFolders').disabled = false;
    }
  }

  $('#musicAddFolders').addEventListener('click', async () => {
    try { folders = await window.ntc.addMusicFolders(); renderFolders(); await scanLibrary(); }
    catch (error) { showLibraryMessage(`Não foi possível adicionar as pastas: ${error.message}`); }
  });
  async function importMusicFiles(files) {
    if (!files.length) return;
    try {
      await window.ntc.addMusicFiles(files);
      await scanLibrary();
      showLibraryMessage(`${files.length} ${files.length === 1 ? 'áudio adicionado' : 'áudios adicionados'} à biblioteca.`);
    } catch (error) { showLibraryMessage(`Não foi possível adicionar os áudios: ${error.message}`); }
  }
  $('#musicChooseAudioFiles').addEventListener('click', async () => {
    try { const files = await window.ntc.chooseMusicFiles(); if (files.length) await scanLibrary(); }
    catch (error) { showLibraryMessage(`Não foi possível adicionar os áudios: ${error.message}`); }
  });
  const audioExtensions = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma']);
  const audioDropzone = $('#musicAudioDropzone');
  ['dragenter', 'dragover'].forEach(name => audioDropzone.addEventListener(name, event => {
    event.preventDefault(); event.stopPropagation(); audioDropzone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(name => audioDropzone.addEventListener(name, event => {
    event.preventDefault(); event.stopPropagation(); audioDropzone.classList.remove('dragging');
  }));
  audioDropzone.addEventListener('drop', event => {
    const files = [...event.dataTransfer.files].map(file => window.ntc.pathForFile(file)).filter(filePath => {
      const extension = String(filePath).split('.').at(-1).toLocaleLowerCase('en-US');
      return filePath && audioExtensions.has(extension);
    });
    if (files.length) void importMusicFiles(files);
    else showLibraryMessage('Solte arquivos de áudio compatíveis nesta área.');
  });
  $('#musicRescan').addEventListener('click', () => void scanLibrary());
  $('#musicPlayPause').addEventListener('click', () => void togglePlayback());
  $('#musicSettingsToggle').addEventListener('click', event => {
    const button = event.currentTarget;
    const open = $('#musicSettingsPanel').classList.toggle('hidden') === false;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', `${open ? 'Fechar' : 'Abrir'} configurações da música`);
    button.title = `${open ? 'Fechar' : 'Abrir'} configurações da música`;
  });
  $('#musicNext').addEventListener('click', () => void playNext());
  $('#musicPrevious').addEventListener('click', () => {
    if (currentIndex < 0 || !tracks.length) return;
    if (decks[currentDeck].currentTime > 3) { decks[currentDeck].currentTime = 0; return; }
    void playTrack(previousIndex(), playbackQueueIds);
  });
  $('#musicShuffle').addEventListener('click', event => {
    shuffle = !shuffle; event.currentTarget.setAttribute('aria-pressed', String(shuffle));
    event.currentTarget.setAttribute('aria-label', shuffle ? 'Desativar reprodução aleatória' : 'Ativar reprodução aleatória');
  });
  $('#musicRepeat').addEventListener('click', event => {
    repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    event.currentTarget.querySelector('.music-repeat-all-icon').classList.toggle('hidden', repeatMode === 'one');
    event.currentTarget.querySelector('.music-repeat-one-icon').classList.toggle('hidden', repeatMode !== 'one');
    event.currentTarget.dataset.mode = repeatMode;
    event.currentTarget.setAttribute('aria-pressed', String(repeatMode !== 'off'));
    event.currentTarget.setAttribute('aria-label', `Repetição ${repeatMode === 'off' ? 'desativada' : repeatMode === 'one' ? 'da faixa atual' : 'da biblioteca'}`);
  });
  $('#musicSearch').addEventListener('input', renderTracks);
  document.querySelectorAll('[data-music-filter]').forEach(button => button.addEventListener('click', () => {
    setMusicFilter(button.dataset.musicFilter);
  }));
  const validSortModes = ['queue', 'title', 'artist', 'album', 'genre'];
  if (!validSortModes.includes(sortMode)) sortMode = 'queue';
  $('#musicOrganization').value = sortMode;
  $('#musicOrganization').addEventListener('change', event => {
    sortMode = validSortModes.includes(event.currentTarget.value) ? event.currentTarget.value : 'queue';
    localStorage.setItem('ntc-music-organization', sortMode);
    renderTracks();
    if (['artist', 'album', 'genre'].includes(sortMode)) void ensureLibraryMetadata();
  });
  $('#musicSeek').addEventListener('input', event => {
    const audio = decks[currentDeck];
    if (Number.isFinite(audio.duration) && audio.duration) audio.currentTime = Number(event.currentTarget.value) / 1000 * audio.duration;
  });
  $('#musicVolume').value = String(Math.round(volume * 100));
  $('#musicVolumeValue').textContent = `${Math.round(volume * 100)}%`;
  $('#musicVolume').addEventListener('input', event => {
    volume = Number(event.currentTarget.value) / 100;
    localStorage.setItem('ntc-music-volume', String(Math.round(volume * 100)));
    $('#musicVolumeValue').textContent = `${Math.round(volume * 100)}%`; applyVolumes();
  });
  $('#musicCrossfade').value = String(crossfadeSeconds);
  $('#musicCrossfadeValue').textContent = `${crossfadeSeconds} s`;
  $('#musicCrossfade').addEventListener('input', event => {
    crossfadeSeconds = Number(event.currentTarget.value);
    localStorage.setItem('ntc-music-crossfade', String(crossfadeSeconds));
    localStorage.setItem('ntc-music-crossfade-user-set', 'true');
    $('#musicCrossfadeValue').textContent = `${crossfadeSeconds} s`;
  });

  refreshMusicEqualizerPresets();
  updateEqualizerControls();
  $('#musicEqualizer').addEventListener('change', event => applyEqualizerPreset(event.currentTarget.value));
  $('#musicSaveEqualizerPreset').addEventListener('click', saveMusicEqualizerPreset);
  [['musicEqGain', 'gain'], ['musicEqBass', 'eqBass'], ['musicEqMid', 'eqMid'], ['musicEqTreble', 'eqTreble']].forEach(([id, key]) => {
    $(`#${id}`).addEventListener('input', event => setEqualizerBand(key, Number(event.currentTarget.value)));
  });

  document.addEventListener('keydown', event => {
    if (!$('#musicPlayerView').classList.contains('active') || event.altKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.code === 'Space') {
      if (target instanceof Element && target.closest('button')) return;
      event.preventDefault(); void togglePlayback(); return;
    }
    if ((event.ctrlKey || event.getModifierState?.('Control')) && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      if (event.key === 'ArrowRight') void playNext();
      else void playTrack(previousIndex(), playbackQueueIds);
      return;
    }
    if (!event.ctrlKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      const audio = decks[currentDeck];
      if (!Number.isFinite(audio.duration)) return;
      event.preventDefault();
      audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)));
    }
  });

  window.addEventListener('beforeunload', () => savePlaybackState(true));
  window.addEventListener('pagehide', () => savePlaybackState(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) savePlaybackState(true); });

  decks.forEach((audio, index) => {
    audio.volume = 0;
    audio.addEventListener('loadedmetadata', () => {
      const track = index === currentDeck ? tracks[currentIndex] : null;
      if (track && Number.isFinite(audio.duration)) {
        durations.set(track.id, audio.duration);
        if (pendingResumeSeek?.trackId === track.id) {
          audio.currentTime = Math.max(0, Math.min(Math.max(0, audio.duration - 0.5), pendingResumeSeek.time));
          pendingResumeSeek = null;
        }
        renderTracks(); updateProgress();
      }
    });
    audio.addEventListener('timeupdate', () => { if (index === currentDeck) { updateProgress(); savePlaybackState(); maybeCrossfade(); } });
    audio.addEventListener('ended', () => {
      if (index !== currentDeck || fadeState) return;
      if (repeatMode === 'one') { audio.currentTime = 0; void audio.play(); }
      else void playNext();
    });
    audio.addEventListener('error', () => {
      if (index === currentDeck && currentIndex >= 0) { playing = false; updatePlayer(); setPlaybackMessage('Não foi possível abrir esta faixa. Verifique se o arquivo ainda existe no PC e se o formato é compatível.'); }
    });
    audio.addEventListener('play', () => { if (index === currentDeck) { playing = true; updatePlayer(); } });
    audio.addEventListener('pause', () => { if (index === currentDeck && audio.currentTime < audio.duration) { playing = false; savePlaybackState(true); updatePlayer(); } });
  });

  void (async () => {
    try { renderPlaylistControls(); folders = await window.ntc.getMusicFolders(); renderFolders(); await scanLibrary(); setMusicFilter(activeFilter); }
    catch (error) { showLibraryMessage(`Não foi possível carregar a biblioteca: ${error.message}`); }
  })();
})();
