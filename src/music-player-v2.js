(() => {
  const host = document.querySelector('#musicPlayerView');
  const api = window.ntc?.music2;
  const model = window.ntcMusicModel;
  if (!host || !api || !model) return;
  host.classList.add('music-v2');
  const playerIcons = {
    shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5M4 7h2.5c4 0 6.5 10 10.5 10H21m-5-5 5 5-5 5M4 17h2.5c1.6 0 3-1.8 4.1-3.7M16 3h5v5l-2.2-2.2"/></svg>',
    previous: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M19 6 9 12l10 6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M5 6l10 6-10 6z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4zM17 9a5 5 0 0 1 0 6"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4zM17 9l4 6m0-6-4 6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 2.9-.2-.1a1.7 1.7 0 0 0-1.9.2l-.2.1h-3.4l-.1-.2a1.7 1.7 0 0 0-1.6-1l-.2.1-2.9-1.7.1-.2a1.7 1.7 0 0 0-.2-1.9l-.1-.2v-3.4l.2-.1a1.7 1.7 0 0 0 1-1.6l-.1-.2L10.2 7l.2.1a1.7 1.7 0 0 0 1.9-.2l.2-.1h3.4l.1.2a1.7 1.7 0 0 0 1.6 1l.2-.1 2.9 1.7-.1.2a1.7 1.7 0 0 0 .2 1.9l.1.2v3.4z"/></svg>'
  };
  host.innerHTML = `
    <header class="mv-heading"><div><span class="eyebrow">MÚSICA LOCAL · OFFLINE</span><h1>Player de música</h1><p>Seus arquivos, do jeito que você organiza.</p></div><button class="mv-button" id="mvSettings" type="button" aria-label="Abrir configurações" title="Configurações">${playerIcons.settings}<span>Configurações</span></button></header>
    <div class="mv-layout"><div class="mv-player-column"><section class="mv-now" aria-label="Tocando agora">
      <div class="mv-art" id="mvArt" aria-hidden="true"><span>♫</span></div>
      <div class="mv-nowtext"><span class="eyebrow">TOCANDO AGORA</span><h2 id="mvTitle">Escolha uma música</h2><p id="mvArtist">Sua biblioteca permanece neste computador.</p></div>
      <input type="range" id="mvSeek" min="0" max="1000" value="0" aria-label="Posição da faixa"><div class="mv-times"><span id="mvTime">0:00</span><span id="mvDuration">0:00</span></div>
      <div class="mv-controls"><button id="mvShuffle" type="button" title="Aleatório" aria-label="Aleatório" aria-pressed="false">${playerIcons.shuffle}</button><button id="mvPrev" type="button" title="Anterior" aria-label="Anterior">${playerIcons.previous}</button><button class="mv-play" id="mvPlay" type="button" title="Reproduzir" aria-label="Reproduzir">${playerIcons.play}</button><button id="mvNext" type="button" title="Próxima" aria-label="Próxima">${playerIcons.next}</button><button id="mvRepeat" type="button" title="Repetição desligada" aria-label="Repetição desligada" data-mode="off">${playerIcons.repeat}</button></div>
      <div class="mv-volume"><button id="mvMute" type="button" aria-label="Silenciar" title="Silenciar">${playerIcons.volume}</button><input id="mvVolume" type="range" min="0" max="100" value="80" aria-label="Volume"><span id="mvVolumeText">80%</span></div>
    </section><section class="mv-tools" aria-label="Mais opções do player"><span class="eyebrow">AÇÕES DO PLAYER</span><div class="mv-now-actions"><button id="mvInfo" type="button">Informações</button><button id="mvLyricsButton" type="button">Letras</button><button id="mvMini" type="button">Mini player</button></div></section></div><section class="mv-library" aria-label="Biblioteca de música">
      <div class="mv-library-head"><div><span class="eyebrow">SUA COLEÇÃO</span><h2 id="mvLibraryTitle">Músicas</h2></div><span id="mvCount">0 faixas</span></div>
      <nav class="mv-tabs" id="mvTabs" aria-label="Seções da biblioteca"><button data-view="songs" class="active">Músicas</button><button data-view="albums">Álbuns</button><button data-view="artists">Artistas</button><button data-view="genres">Gêneros</button><button data-view="folders">Pastas</button><button data-view="playlists">Playlists</button><button data-view="queue">Fila <span id="mvQueueCount">0</span></button></nav>
      <div class="mv-toolbar"><label class="mv-search"><span aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.7"/><path d="m16 16 4.5 4.5"/></svg></span><input id="mvSearch" type="search" placeholder="Buscar título, artista, álbum, ano, pasta…" aria-label="Buscar na biblioteca"></label><select id="mvSort" aria-label="Ordenação"><option value="title">Título</option><option value="artist">Artista</option><option value="album">Álbum</option><option value="year">Ano</option><option value="duration">Duração</option><option value="added">Adicionadas</option><option value="played">Última reprodução</option><option value="plays">Mais tocadas</option></select></div>
      <div class="mv-subtabs" id="mvSubtabs"><button data-filter="songs" class="active">Todas</button><button data-filter="liked">Favoritas</button><button data-filter="recent">Recentes</button><button data-filter="unplayed">Nunca tocadas</button><button data-filter="missing">Ausentes</button></div>
      <div class="mv-import" id="mvImport"><span>Arraste músicas ou pastas do Explorer</span><button id="mvAddFiles" type="button">Adicionar arquivos</button><button id="mvAddFolders" type="button">Adicionar pastas</button></div>
      <div class="mv-progress hidden" id="mvProgress"><span id="mvProgressText"></span><button id="mvCancelScan" type="button">Cancelar indexação</button></div>
      <div class="mv-breadcrumb hidden" id="mvBreadcrumb"><button id="mvBack" type="button">← Voltar</button><strong id="mvGroupTitle"></strong></div><div class="mv-folder-children hidden" id="mvFolderChildren"></div>
      <div class="mv-empty hidden" id="mvEmpty"><span>♫</span><h3>Sua biblioteca está vazia</h3><p>Escolha uma pasta ou alguns arquivos. Nada é copiado ou movido.</p><div><button id="mvEmptyFolder" type="button">Adicionar pasta</button><button id="mvEmptyFiles" type="button">Selecionar músicas</button></div></div>
      <div class="mv-viewport" id="mvViewport" tabindex="0" aria-label="Lista de músicas"><div class="mv-spacer" id="mvSpacer"><div class="mv-rows" id="mvRows"></div></div></div>
      <div class="mv-groups hidden" id="mvGroups"></div><div class="mv-queue hidden" id="mvQueue"></div><div class="mv-playlists hidden" id="mvPlaylists"></div><div class="mv-folders hidden" id="mvFolders"></div>
      <div class="mv-status" id="mvStatus" role="status"></div>
    </section></div>
    <aside class="mv-drawer hidden" id="mvDrawer" aria-label="Configurações do player"><div class="mv-drawer-head"><h2>Configurações</h2><button id="mvCloseSettings" type="button" aria-label="Fechar configurações">×</button></div>
      <section><h3>Reprodução</h3><label>Transição entre músicas <input id="mvCrossfade" type="range" min="0" max="12" step="1"><output id="mvCrossfadeText"></output></label><p>0 s desliga o crossfade.</p><label>Sleep timer <select id="mvSleep"><option value="off">Desligado</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="45">45 minutos</option><option value="60">1 hora</option><option value="track">Fim da música</option><option value="queue">Fim da fila</option></select></label></section>
      <section><h3>Equalizador · 10 bandas</h3><label>Preset <select id="mvEqPreset"><option value="flat">Flat</option><option value="bass">Bass Boost</option><option value="bass-low">Bass Reducer</option><option value="treble">Treble Boost</option><option value="vocal">Vocal</option><option value="rock">Rock</option><option value="pop">Pop</option><option value="electronic">Electronic</option><option value="classical">Classical</option><option value="custom">Custom</option></select></label><div id="mvEqBands" class="mv-eq-bands"></div><button id="mvEqReset" type="button">Resetar equalizador</button><button id="mvEqSave" type="button">Salvar preset</button></section>
      <section><h3>Biblioteca</h3><p>Pastas são referências; remover não apaga arquivos.</p><button id="mvRescan" type="button">Atualizar biblioteca</button><div id="mvSourceList"></div></section>
    </aside>
    <dialog class="mv-dialog" id="mvDialog"><form method="dialog"><button class="mv-dialog-close" aria-label="Fechar" value="cancel">×</button></form><div id="mvDialogBody"></div></dialog>
    <div class="mv-menu hidden" id="mvMenu" role="menu"></div>
    <audio id="mvAudioA" preload="metadata"></audio><audio id="mvAudioB" preload="metadata"></audio>`;
  const $ = id => host.querySelector(`#${id}`);
  const audio = [$('mvAudioA'), $('mvAudioB')];
  const ROW = 58;
  const libraryFilters = new Set(['songs', 'liked', 'recent', 'unplayed', 'missing']);
  const presets = {
    flat: [0,0,0,0,0,0,0,0,0,0], bass: [6,5,4,2,0,0,0,0,0,0], 'bass-low': [-5,-4,-3,-1,0,0,0,0,0,0], treble: [0,0,0,0,0,0,1,3,5,6],
    vocal: [-2,-2,-1,1,3,4,3,1,-1,-2], rock: [4,3,1,-1,-2,0,2,3,3,3], pop: [-1,1,2,3,2,0,1,2,2,1], electronic: [5,4,2,0,-2,-1,1,3,4,5], classical: [2,1,0,0,0,0,0,1,2,2]
  };
  const frequencies = [32,64,125,250,500,1000,2000,4000,8000,16000];
  const state = { view: 'songs', filter: 'songs', group: '', sourceId: null, folderRoot: '', query: '', sort: 'title', total: 0, count: 0, pages: new Map(), generation: 0, queueRevision: 0, selection: new Set(), selectedTrackId: null, selectedQueueKey: null, selectedPlaylistItemId: null, anchor: -1, queue: [], queueIndex: -1, queuePage: 0, browseOffset: -1, recentShuffled: [], current: null, cover: '', currentDeck: 0, playing: false, shuffle: false, repeat: 'off', volume: .8, muted: false, crossfade: 0, fade: null, preloaded: null, prefetching: null, playbackToken: 0, conversionRetried: false, recorded: false, playedFrom: 0, lastObservedTime: 0, sleep: 'off', sleepAt: 0, lyrics: '', lrc: [], eq: [...presets.flat], eqPreset: 'flat', context: null, chains: [], scan: null, sources: [], playlistId: null, playlists: [], playlistEditor: null };
  const notify = message => { $('mvStatus').textContent = message; };
  const format = seconds => { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
  const details = track => track ? [track.artist || 'Artista desconhecido', track.album].filter(Boolean).join(' · ') : '';
  function applyTrackIdentity(action) {
    const identity = model.transitionTrackIdentity({ selectedTrackId: state.selectedTrackId, currentTrackId: state.current?.id || null }, action);
    state.selectedTrackId = identity.selectedTrackId;
  }
  function selectTrack(id, view = 'library') {
    const next = model.selectTrackInView({ selectedTrackId: state.selectedTrackId, currentTrackId: state.current?.id || null, selectedQueueKey: state.selectedQueueKey, selectedPlaylistItemId: state.selectedPlaylistItemId }, id, view);
    state.selectedTrackId = next.selectedTrackId; state.selectedQueueKey = next.selectedQueueKey; state.selectedPlaylistItemId = next.selectedPlaylistItemId;
    syncLibraryRowStates(); syncQueueRowStates(); syncPlaylistRowStates();
  }
  const currentAudio = () => audio[state.currentDeck];
  const isWriting = target => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  const settings = () => ({ queue: state.queue, queueIndex: state.queueIndex, browseOffset: state.browseOffset, currentId: state.current?.id || 0, volume: state.volume, muted: state.muted, shuffle: state.shuffle, repeat: state.repeat, crossfade: state.crossfade, view: state.view, filter: state.filter, sort: state.sort, eq: state.eq, eqPreset: state.eqPreset, playlistId: state.playlistId });
  let sessionTimer = 0; let searchTimer = 0; let progressTimer = 0; let positionTimer = 0;
  let sleepTimeout = 0;
  let controlUpdateAt = 0;
  function persistSoon() { clearTimeout(sessionTimer); sessionTimer = setTimeout(() => void api.saveSession(settings()).catch(() => {}), 250); }
  function persistPosition() { if (!state.current) return; const now = Date.now(); if (now - positionTimer < 5000) return; positionTimer = now; void api.savePosition({ id: state.current.id, seconds: currentAudio().currentTime || 0 }).catch(() => {}); }
  function renderTransport() {
    $('mvPlay').innerHTML = state.playing ? playerIcons.pause : playerIcons.play; $('mvPlay').setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproduzir'); $('mvPlay').title = state.playing ? 'Pausar' : 'Reproduzir';
    $('mvShuffle').setAttribute('aria-pressed', String(state.shuffle)); $('mvRepeat').dataset.mode = state.repeat; $('mvRepeat').innerHTML = `${playerIcons.repeat}${state.repeat === 'one' ? '<span class="mv-repeat-one" aria-hidden="true">1</span>' : ''}`; $('mvRepeat').title = `Repetição: ${state.repeat === 'off' ? 'desligada' : state.repeat === 'one' ? 'faixa' : 'fila'}`;
    $('mvRepeat').setAttribute('aria-label', $('mvRepeat').title); $('mvMute').innerHTML = state.muted || state.volume === 0 ? playerIcons.mute : playerIcons.volume; $('mvMute').setAttribute('aria-label', state.muted || state.volume === 0 ? 'Ativar som' : 'Silenciar'); $('mvMute').title = state.muted || state.volume === 0 ? 'Ativar som' : 'Silenciar';
    $('mvVolume').value = String(Math.round(state.volume * 100)); $('mvVolumeText').textContent = `${Math.round(state.volume * 100)}%`;
    $('mvQueueCount').textContent = String(state.queue.length);
    $('mvTitle').textContent = state.current?.title || state.current?.base_name || 'Escolha uma música'; $('mvArtist').textContent = state.current ? details(state.current) : 'Sua biblioteca permanece neste computador.';
  }
  function renderPlaybackRows() { if (state.total) renderVisible(); renderQueue(); syncPlaylistRowStates(); }
  function renderFilterButtons() {
    host.querySelectorAll('[data-filter]').forEach(button => {
      const active = button.dataset.filter === state.filter;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }
  function renderLibraryCount() { $('mvCount').textContent = model.libraryCountLabel(state.total, state.count); }
  function renderTime() {
    const deck = currentAudio(); $('mvTime').textContent = format(deck.currentTime); $('mvDuration').textContent = format(deck.duration || state.current?.duration);
    if (!$('mvSeek').matches(':active')) $('mvSeek').value = Number.isFinite(deck.duration) && deck.duration > 0 ? String(Math.round(deck.currentTime / deck.duration * 1000)) : '0';
    if (state.lrc.length) { const current = [...state.lrc].reverse().findIndex(line => line.time <= deck.currentTime); const index = current < 0 ? -1 : state.lrc.length - 1 - current; host.querySelectorAll('.mv-lyric-line').forEach((line, row) => line.classList.toggle('active', row === index)); }
  }
  function applyVolumes() {
    const value = state.muted ? 0 : state.volume;
    if (state.fade) { const levels = model.crossfadeVolumes((performance.now() - state.fade.started) / 1000, state.fade.seconds, value); audio[state.fade.from].volume = levels.from; audio[state.fade.to].volume = levels.to; }
    else audio.forEach((deck, index) => { deck.volume = index === state.currentDeck ? value : 0; });
  }
  function stopFade() { if (!state.fade) return null; const target = state.fade.target; clearInterval(state.fade.timer); audio[state.fade.from].pause(); state.currentDeck = state.fade.to; state.fade = null; applyVolumes(); return target; }
  async function ensureAudioGraph() {
    if (state.context) { if (state.context.state === 'suspended') await state.context.resume(); return; }
    const Context = window.AudioContext || window.webkitAudioContext; if (!Context) return;
    try {
      state.context = new Context();
      for (const deck of audio) {
        const source = state.context.createMediaElementSource(deck); const bands = frequencies.map((frequency, index) => { const filter = state.context.createBiquadFilter(); filter.type = index === 0 ? 'lowshelf' : index === 9 ? 'highshelf' : 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1.2; return filter; });
        source.connect(bands[0]); bands.slice(1).forEach((filter, index) => bands[index].connect(filter)); bands.at(-1).connect(state.context.destination); state.chains.push(bands);
      }
      applyEq();
    } catch { notify('Equalizador indisponível neste dispositivo; reprodução normal mantida.'); }
  }
  function applyEq() { for (const chain of state.chains) chain.forEach((filter, index) => { filter.gain.value = state.eq[index] || 0; }); }
  function renderEq() {
    $('mvEqPreset').value = presets[state.eqPreset] || state.eqPreset === 'custom' ? state.eqPreset : 'flat';
    $('mvEqBands').replaceChildren(); frequencies.forEach((frequency, index) => {
      const label = document.createElement('label'); label.textContent = frequency < 1000 ? `${frequency} Hz` : `${frequency / 1000} kHz`;
      const input = document.createElement('input'); input.type = 'range'; input.min = '-12'; input.max = '12'; input.step = '1'; input.value = String(state.eq[index]); input.setAttribute('aria-label', `${frequency} Hz`);
      const output = document.createElement('output'); output.textContent = `${state.eq[index]} dB`;
      input.addEventListener('input', () => { state.eq[index] = Number(input.value); state.eqPreset = 'custom'; $('mvEqPreset').value = 'custom'; output.textContent = `${input.value} dB`; applyEq(); persistSoon(); });
      label.append(input, output); $('mvEqBands').append(label);
    });
  }
  async function getTrack(id) { return api.track(Number(id)); }
  async function playTrack(id, queueIndex = -1, resumeAt = 0, prepared = null, selectOnPlay = false) {
    const token = ++state.playbackToken;
    let track, source;
    try { [track, source] = prepared?.track && prepared?.src ? [prepared.track, prepared.src] : await Promise.all([getTrack(id), api.playSource(id)]); }
    catch (error) { notify(error.message || 'Não foi possível encontrar este arquivo.'); await refreshList(); return; }
    if (!track || token !== state.playbackToken) return;
    if (state.fade) stopFade();
    const outgoing = state.currentDeck; audio[outgoing].pause();
    const nextDeck = 1 - outgoing; audio[nextDeck].pause(); if (!(prepared && audio[nextDeck].src === source && audio[nextDeck].readyState >= 1)) { audio[nextDeck].src = source; audio[nextDeck].load(); }
    state.currentDeck = nextDeck; state.current = track; state.playing = false; applyTrackIdentity({ type: 'play', id: track.id, select: selectOnPlay }); state.queueIndex = queueIndex; state.recorded = false; state.playedFrom = 0; state.lastObservedTime = resumeAt; state.preloaded = null; state.conversionRetried = false;
    void showCover(track.id, token);
    if (resumeAt > 0) audio[nextDeck].addEventListener('loadedmetadata', () => { if (token === state.playbackToken) audio[nextDeck].currentTime = Math.min(resumeAt, Math.max(0, audio[nextDeck].duration - .2)); }, { once: true });
    renderTransport(); renderTime(); applyVolumes(); renderPlaybackRows(); persistSoon();
    try { await ensureAudioGraph(); await audio[nextDeck].play(); if (token !== state.playbackToken) { audio[nextDeck].pause(); return; } state.playing = true; renderTransport(); renderPlaybackRows(); syncMediaSession(); if (!state.crossfade) void prefetchNext(); }
    catch (error) { state.playing = false; renderTransport(); renderPlaybackRows(); notify(`Não foi possível reproduzir “${track.title || track.base_name}”: ${error.message || 'formato indisponível'}`); }
  }
  async function showCover(id, token = state.playbackToken) {
    const art = $('mvArt'); art.replaceChildren(); const placeholder = document.createElement('span'); placeholder.textContent = '♫'; art.append(placeholder); state.cover = ''; publishControlState(true);
    try { const data = await api.cover(id); if (!data || token !== state.playbackToken || state.current?.id !== id) return; const image = document.createElement('img'); image.src = data; image.alt = ''; image.style.objectFit = state.current?.cover_fit === 'cover' ? 'cover' : 'contain'; art.replaceChildren(image); state.cover = data; syncMediaSession(); }
    catch { /* Artwork is optional; playback remains available. */ }
  }
  async function togglePlay() {
    if (!state.current) { const first = state.queue[0]?.id || (await api.list({ ...listOptions(), offset: 0, limit: 1 })).items[0]?.id; if (first) { if (!state.queue.length) state.browseOffset = 0; await playTrack(first, state.queue.length ? 0 : -1); } return; }
    if (state.playing) { const fadeTarget = state.fade ? stopFade() : null; audio.forEach(deck => deck.pause()); state.playing = false; if (fadeTarget) void playCrossfadedTarget(fadeTarget, false); persistPosition(); }
    else { try { await ensureAudioGraph(); applyVolumes(); await currentAudio().play(); state.playing = true; } catch (error) { notify(error.message || 'Reprodução indisponível.'); } }
    renderTransport(); renderPlaybackRows(); syncMediaSession();
  }
  function nextQueuePosition(manual = false) { return model.nextQueueIndex({ length: state.queue.length, index: state.queueIndex, repeat: manual && state.repeat === 'one' ? 'off' : state.repeat, shuffle: state.shuffle }); }
  async function nextId(manual = false) {
    if (!manual && state.repeat === 'one' && state.current) return { id: state.current.id, index: state.queueIndex, offset: state.browseOffset };
    const next = nextQueuePosition(manual);
    if (next >= 0) return { id: state.queue[next].id, index: next };
    if (state.queue.length) return null;
    const nextOffset = state.browseOffset + 1;
    let offset = nextOffset >= state.total && state.repeat === 'all' ? 0 : nextOffset;
    if (state.shuffle && state.total > 1) {
      let candidate = offset;
      for (let attempt = 0; attempt < 12; attempt++) { candidate = Math.floor(Math.random() * state.total); if (candidate !== state.browseOffset && !state.recentShuffled.includes(candidate)) break; }
      offset = candidate; state.recentShuffled.push(offset); if (state.recentShuffled.length > 100) state.recentShuffled.shift();
    }
    if (offset < 0 || offset >= state.total) return null;
    const result = await api.list({ ...listOptions(), offset, limit: 1 });
    return result.items[0] ? { id: result.items[0].id, index: -1, offset } : null;
  }
  async function next(manual = false) {
    if (state.sleep === 'track' && !manual) return stopPlayback();
    const prepared = state.preloaded?.fromToken === state.playbackToken && state.preloaded?.revision === state.queueRevision && (!manual || state.repeat !== 'one') ? state.preloaded : null;
    const target = prepared || await nextId(manual);
    if (!target || (state.sleep === 'queue' && !manual && state.queue.length && target.index === 0)) return stopPlayback();
    if (target.offset !== undefined) state.browseOffset = target.offset;
    await playTrack(target.id, target.index, 0, prepared);
  }
  async function previous() {
    if (currentAudio().currentTime > 3) { currentAudio().currentTime = 0; return; }
    if (state.queue.length) { const previousIndex = state.queueIndex > 0 ? state.queueIndex - 1 : state.repeat === 'all' ? state.queue.length - 1 : 0; await playTrack(state.queue[previousIndex].id, previousIndex); }
    else if (state.browseOffset > 0) { const result = await api.list({ ...listOptions(), offset: --state.browseOffset, limit: 1 }); if (result.items[0]) await playTrack(result.items[0].id); }
  }
  function stopPlayback() { clearTimeout(sleepTimeout); const fadeTarget = state.fade ? stopFade() : null; audio.forEach(deck => { deck.pause(); deck.currentTime = 0; }); state.playing = false; state.sleep = 'off'; state.sleepAt = 0; $('mvSleep').value = 'off'; if (fadeTarget) void playCrossfadedTarget(fadeTarget, false); renderTransport(); renderPlaybackRows(); persistPosition(); syncMediaSession(); }
  function scheduleSleep() {
    clearTimeout(sleepTimeout);
    if (!state.sleepAt) return;
    sleepTimeout = setTimeout(() => { if (Date.now() >= state.sleepAt) stopPlayback(); else scheduleSleep(); }, Math.min(60000, Math.max(100, state.sleepAt - Date.now())));
  }
  async function prefetchNext() {
    if (state.preloaded || state.fade) return;
    const fromToken = state.playbackToken, revision = state.queueRevision;
    if (state.prefetching === fromToken) return;
    state.prefetching = fromToken;
    try {
      const target = await nextId(); if (!target || !state.playing || fromToken !== state.playbackToken || revision !== state.queueRevision) return;
      const [src, track] = await Promise.all([api.playSource(target.id), getTrack(target.id)]);
      if (!state.playing || state.fade || fromToken !== state.playbackToken || revision !== state.queueRevision) return;
      const deck = audio[1 - state.currentDeck]; deck.src = src; deck.load(); state.preloaded = { ...target, src, track, fromToken, revision };
    } catch { /* Next will surface the failure when played. */ }
    finally { if (state.prefetching === fromToken) state.prefetching = null; }
  }
  async function maybeCrossfade() {
    const deck = currentAudio(); if (!state.playing || state.fade || !Number.isFinite(deck.duration)) return;
    const remaining = deck.duration - deck.currentTime;
    if (remaining < 12 && remaining > 0) void prefetchNext();
    if (!state.crossfade || remaining > state.crossfade || remaining <= .05 || !state.preloaded) return;
    const target = state.preloaded; state.preloaded = null;
    const to = 1 - state.currentDeck; const from = state.currentDeck;
    audio[to].volume = 0;
    try { await audio[to].play(); } catch { return; }
    state.fade = { from, to, started: performance.now(), seconds: Math.min(state.crossfade, remaining), target };
    state.fade.timer = setInterval(() => {
      if (!state.fade) return; applyVolumes();
      if (performance.now() - state.fade.started >= state.fade.seconds * 1000) {
        stopFade(); state.current = null; void playCrossfadedTarget(target, true);
      }
    }, 50);
  }
  async function playCrossfadedTarget(target, playing = true) {
    const token = state.playbackToken;
    const track = await getTrack(target.id); if (!track || token !== state.playbackToken) return;
    state.current = track; applyTrackIdentity({ type: 'play', id: track.id, select: false }); state.queueIndex = target.index; if (target.offset !== undefined) state.browseOffset = target.offset;
    void showCover(track.id);
    state.recorded = false; state.playedFrom = 0; state.lastObservedTime = currentAudio().currentTime || 0; state.playing = playing; renderTransport(); renderPlaybackRows(); persistSoon(); syncMediaSession();
  }
  function syncMediaSession() {
    publishControlState(true);
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = state.current ? new MediaMetadata({ title: state.current.title || state.current.base_name, artist: state.current.artist || '', album: state.current.album || '', artwork: state.cover ? [{ src: state.cover, sizes: '256x256', type: 'image/jpeg' }] : [] }) : null;
      navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
    } catch { /* Windows media controls are optional. */ }
  }
  function publishControlState(force = false) {
    if (!force && Date.now() - controlUpdateAt < 950) return;
    controlUpdateAt = Date.now();
    void api.sendControlState({ title: state.current?.title || state.current?.base_name || '', artist: state.current?.artist || '', album: state.current?.album || '', cover: state.cover, coverFit: state.current?.cover_fit, playing: state.playing, time: currentAudio().currentTime || 0, duration: currentAudio().duration || state.current?.duration || 0, volume: state.volume, muted: state.muted }).catch(() => {});
  }
  if ('mediaSession' in navigator) {
    for (const [action, callback] of Object.entries({ play: () => { if (!state.playing) void togglePlay(); }, pause: () => { if (state.playing) void togglePlay(); }, previoustrack: () => void previous(), nexttrack: () => void next(true), seekto: details => { if (Number.isFinite(details.seekTime)) currentAudio().currentTime = details.seekTime; } })) {
      try { navigator.mediaSession.setActionHandler(action, callback); } catch { /* Unsupported action. */ }
    }
  }
  function addQueue(ids, mode = 'end') {
    state.queueRevision++;
    const entries = ids.map(id => ({ id: Number(id), key: crypto.randomUUID() })).filter(item => item.id > 0);
    if (mode === 'next') state.queue.splice(Math.max(0, state.queueIndex + 1), 0, ...entries);
    else state.queue.push(...entries);
    renderQueue(); renderTransport(); persistSoon();
  }
  function renderQueue() {
    const box = $('mvQueue'); box.replaceChildren();
    if (!state.queue.length) { box.textContent = 'A fila está vazia. Use o menu de uma música para adicionar faixas.'; return; }
    state.queuePage = Math.min(state.queuePage, Math.floor((state.queue.length - 1) / 500));
    const first = state.queuePage * 500;
    const list = document.createElement('div'); list.className = 'mv-queue-items';
    state.queue.slice(first, first + 500).forEach((entry, localIndex) => {
      const index = first + localIndex;
      const isCurrent = index === state.queueIndex && state.current?.id === entry.id;
      const isSelected = entry.key === state.selectedQueueKey;
      const row = document.createElement('div'); row.className = `mv-queue-row${isCurrent ? ' current' : ''}${isCurrent && state.playing ? ' playing' : ''}${isSelected ? ' selected' : ''}`; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(isSelected)); row.draggable = true; row.dataset.index = index; row.dataset.trackId = entry.id; row.dataset.queueKey = entry.key;
      const label = document.createElement('button'); label.type = 'button'; label.textContent = `${index + 1}. ${entry.title || entry.id}`; label.title = `${label.textContent}${isCurrent ? state.playing ? ' · Faixa atual, reproduzindo' : ' · Faixa atual, pausada' : ''}`; label.onclick = () => { state.selectedQueueKey = entry.key; selectTrack(entry.id, 'queue'); };
      label.ondblclick = () => { state.selectedQueueKey = entry.key; selectTrack(entry.id, 'queue'); void playTrack(entry.id, index, 0, null, true); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remover da fila'; remove.onclick = () => { state.queueRevision++; state.queue.splice(index, 1); if (index < state.queueIndex) state.queueIndex--; renderQueue(); renderTransport(); persistSoon(); };
      row.ondragstart = event => event.dataTransfer.setData('text/x-ntc-queue-index', String(index));
      row.ondragover = event => { event.preventDefault(); row.classList.add('dragging'); };
      row.ondragleave = () => row.classList.remove('dragging');
      row.ondrop = event => { event.preventDefault(); row.classList.remove('dragging'); const from = Number(event.dataTransfer.getData('text/x-ntc-queue-index')); if (Number.isInteger(from)) { state.queueRevision++; const currentKey = state.queue[state.queueIndex]?.key; state.queue = model.moveQueueItem(state.queue, from, index); state.queueIndex = state.queue.findIndex(item => item.key === currentKey); renderQueue(); persistSoon(); } };
      row.append(label, remove); list.append(row);
      if (!entry.title) void getTrack(entry.id).then(track => { if (track && row.isConnected) { entry.title = track.title || track.base_name; label.textContent = `${index + 1}. ${entry.title}`; } });
    });
    box.append(list);
    if (state.queue.length > 500) {
      const pager = document.createElement('div'); pager.className = 'mv-queue-pager';
      const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '← Anteriores'; previous.disabled = state.queuePage === 0; previous.onclick = () => { state.queuePage--; renderQueue(); };
      const note = document.createElement('span'); note.textContent = `${first + 1}–${Math.min(first + 500, state.queue.length)} de ${state.queue.length}`;
      const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Próximas →'; more.disabled = first + 500 >= state.queue.length; more.onclick = () => { state.queuePage++; renderQueue(); };
      pager.append(previous, note, more); box.append(pager);
    }
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Limpar fila'; clear.onclick = () => { state.queueRevision++; state.queue = []; state.queueIndex = -1; state.selectedQueueKey = null; renderQueue(); renderTransport(); persistSoon(); }; box.prepend(clear);
  }
  function listOptions() { return { query: state.query, view: state.view === 'songs' ? state.filter : state.view === 'albums' ? 'album' : state.view === 'artists' ? 'artist' : state.view === 'genres' ? 'genre' : state.view === 'folders' ? 'folder' : 'songs', group: state.group, sourceId: state.sourceId, sort: state.sort }; }
  async function refreshList() {
    const generation = ++state.generation; state.queueRevision++; state.pages.clear(); state.selection.clear(); $('mvViewport').scrollTop = 0;
    try { const result = await api.list({ ...listOptions(), offset: 0, limit: 80 }); if (generation !== state.generation) return; state.total = result.total; state.pages.set(0, result.items); $('mvSpacer').style.height = `${model.virtualLayout(0, 500, state.total, ROW).height}px`; renderLibraryCount(); renderVisible(); updateEmpty(); }
    catch (error) { notify(`Busca indisponível: ${error.message}`); }
  }
  async function ensurePage(page) {
    if (state.pages.has(page)) return;
    const generation = state.generation;
    state.pages.set(page, null);
    try { const result = await api.list({ ...listOptions(), offset: page * 80, limit: 80 }); if (generation !== state.generation) return; state.pages.set(page, result.items); while (state.pages.size > 12) state.pages.delete(state.pages.keys().next().value); renderVisible(); }
    catch { state.pages.delete(page); }
  }
  function selectedIds(clickedId = null) { return state.selection.size ? [...state.selection] : clickedId ? [clickedId] : []; }
  function selectRow(event, index, id) {
    selectTrack(id, 'library');
    if (event.shiftKey && state.anchor >= 0) {
      const from = Math.min(state.anchor, index), to = Math.min(state.total - 1, Math.max(state.anchor, index), from + 9999);
      if (Math.abs(state.anchor - index) > 9999) notify('Seleção limitada a 10.000 faixas por operação.');
      if (!event.ctrlKey) state.selection.clear();
      void (async () => { for (let offset = from; offset <= to; offset += 80) { const result = await api.list({ ...listOptions(), offset, limit: Math.min(80, to - offset + 1) }); result.items.forEach(track => state.selection.add(track.id)); } syncLibraryRowStates(); })();
    } else if (event.ctrlKey) { state.selection.has(id) ? state.selection.delete(id) : state.selection.add(id); state.anchor = index; syncLibraryRowStates(); }
    else { state.selection.clear(); state.selection.add(id); state.anchor = index; syncLibraryRowStates(); }
  }
  function syncLibraryRowStates() {
    $('mvRows').querySelectorAll('.mv-row').forEach(row => {
      const id = Number(row.dataset.id); const rowState = model.trackRowState({ selectedTrackId: state.selectedTrackId, currentTrackId: state.current?.id || null, playing: state.playing }, id);
      row.classList.toggle('selected', rowState.selected); row.classList.toggle('current', rowState.current); row.classList.toggle('playing', rowState.playing); row.classList.toggle('batch-selected', state.selection.has(id) && !rowState.selected);
      row.setAttribute('aria-selected', String(rowState.selected));
      if (state.selection.has(id) && !rowState.selected) row.setAttribute('aria-label', `${row.querySelector('strong')?.textContent || 'Faixa'}, marcado para ação em lote${rowState.current ? ', faixa atual' : ''}`); else row.removeAttribute('aria-label');
    });
  }
  function syncQueueRowStates() {
    $('mvQueue').querySelectorAll('.mv-queue-row').forEach(row => {
      const index = Number(row.dataset.index), entry = state.queue[index];
      const current = Boolean(entry && index === state.queueIndex), selected = Boolean(entry && entry.key === state.selectedQueueKey);
      row.classList.toggle('current', current); row.classList.toggle('playing', current && state.playing); row.classList.toggle('selected', selected); row.setAttribute('aria-selected', String(selected));
      const label = row.querySelector('button:first-child'); if (label) label.title = `${label.textContent}${current ? state.playing ? ' · Faixa atual, reproduzindo' : ' · Faixa atual, pausada' : ''}`;
    });
  }
  function syncPlaylistRowStates() {
    $('mvPlaylists').querySelectorAll('.mv-playlist-row').forEach(row => {
      const id = Number(row.dataset.trackId), selected = Number(row.dataset.itemId) === Number(state.selectedPlaylistItemId);
      const rowState = model.trackRowState({ selectedTrackId: state.selectedTrackId, currentTrackId: state.current?.id || null, playing: state.playing }, id);
      row.classList.toggle('selected', selected); row.classList.toggle('current', rowState.current); row.classList.toggle('playing', rowState.playing); row.setAttribute('aria-selected', String(selected));
      const label = row.querySelector('button:first-child'); if (label) label.title = `${label.textContent}${rowState.current ? rowState.playing ? ' · Faixa atual, reproduzindo' : ' · Faixa atual, pausada' : ''}`;
    });
  }
  function renderVisible() {
    const viewport = $('mvViewport'); const range = model.virtualLayout(viewport.scrollTop, viewport.clientHeight || 500, state.total, ROW);
    const rows = $('mvRows'); rows.replaceChildren(); rows.style.transform = `translateY(${range.top}px)`;
    for (let index = range.first; index < range.last; index++) {
      const page = Math.floor(index / 80); const track = state.pages.get(page)?.[index % 80]; if (!track) { void ensurePage(page); continue; }
      const rowState = model.trackRowState({ selectedTrackId: state.selectedTrackId, currentTrackId: state.current?.id || null, playing: state.playing }, track.id);
      const row = document.createElement('div');
      row.className = `mv-row${rowState.selected ? ' selected' : ''}${rowState.current ? ' current' : ''}${rowState.playing ? ' playing' : ''}${state.selection.has(track.id) && !rowState.selected ? ' batch-selected' : ''}${!track.available ? ' missing' : ''}`;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(rowState.selected)); if (state.selection.has(track.id) && !rowState.selected) row.setAttribute('aria-label', `${track.title || track.base_name}, marcado para ação em lote${rowState.current ? ', faixa atual' : ''}`); row.dataset.id = track.id; row.style.height = `${ROW}px`; row.draggable = true;
      const title = document.createElement('strong'); title.textContent = track.title || track.base_name; title.title = title.textContent;
      const titleLine = document.createElement('div'); titleLine.className = 'mv-row-title';
      if (rowState.current) { const marker = document.createElement('span'); marker.className = 'mv-current-indicator'; marker.setAttribute('aria-label', rowState.playing ? 'Faixa atual, reproduzindo' : 'Faixa atual, pausada'); marker.title = rowState.playing ? 'Faixa atual · reproduzindo' : 'Faixa atual · pausada'; titleLine.append(marker); }
      titleLine.append(title);
      const subtitle = document.createElement('span'); subtitle.textContent = details(track); subtitle.title = subtitle.textContent;
      const copy = document.createElement('div'); copy.className = 'mv-row-copy'; copy.append(titleLine, subtitle);
      const year = document.createElement('small'); year.textContent = track.year?.slice(0, 4) || '';
      const duration = document.createElement('small'); duration.textContent = track.duration ? format(track.duration) : '—';
      const like = document.createElement('button'); like.type = 'button'; like.textContent = track.liked ? '♥' : '♡'; like.title = track.liked ? 'Desfavoritar' : 'Favoritar'; like.setAttribute('aria-label', like.title); like.onclick = async event => { event.stopPropagation(); track.liked = await api.like(track.id); like.textContent = track.liked ? '♥' : '♡'; };
      const menu = document.createElement('button'); menu.type = 'button'; menu.textContent = '⋯'; menu.title = 'Mais ações'; menu.setAttribute('aria-label', `Ações de ${title.textContent}`); menu.onclick = event => { event.stopPropagation(); openMenu(event, track); };
      row.onclick = event => selectRow(event, index, track.id); row.ondblclick = () => { state.browseOffset = index; state.selection.clear(); state.selection.add(track.id); state.anchor = index; selectTrack(track.id, 'library'); renderVisible(); void playTrack(track.id, -1, 0, null, true); };
      row.oncontextmenu = event => { event.preventDefault(); selectRow(event, index, track.id); openMenu(event, track); };
      row.ondragstart = event => event.dataTransfer.setData('text/x-ntc-track-ids', JSON.stringify(selectedIds(track.id)));
      row.append(copy, year, duration, like, menu); rows.append(row);
    }
  }
  function updateEmpty() {
    const empty = state.count === 0 && state.view === 'songs' && !state.query;
    $('mvEmpty').classList.toggle('hidden', !empty);
    $('mvViewport').classList.toggle('hidden', empty || ['albums','artists','genres','queue','playlists','folders'].includes(state.view) && !state.group);
  }
  function closeMenu() { $('mvMenu').classList.add('hidden'); $('mvMenu').replaceChildren(); }
  function openMenu(event, track) {
    closeMenu(); const menu = $('mvMenu'); const add = (label, action) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('role', 'menuitem'); button.onclick = () => { closeMenu(); void action(); }; menu.append(button); };
    const ids = selectedIds(track.id);
    add('Reproduzir agora', async () => { state.queueRevision++; state.queue = ids.map(id => ({ id, key: crypto.randomUUID() })); state.queueIndex = 0; await playTrack(ids[0], 0); });
    add('Reproduzir em seguida', () => addQueue(ids, 'next'));
    add('Adicionar à fila', () => addQueue(ids));
    if (state.playlists.length) add('Adicionar à playlist…', async () => { const name = window.prompt('Nome da playlist', state.playlists[0].name); const playlist = state.playlists.find(item => item.name === name); if (playlist) { await api.addPlaylistItems(playlist.id, ids); notify(`${ids.length} faixa(s) adicionada(s) à playlist.`); } });
    add(track.liked ? 'Desfavoritar' : 'Favoritar', async () => { await Promise.all(ids.map(id => api.like(id))); void refreshList(); });
    add('Informações', () => showInfo(track.id));
    add(ids.length > 1 ? 'Editar dados locais em lote' : 'Editar dados locais', () => showMetadataEditor(ids));
    add('Mostrar no Explorer', () => api.showTrack(track.id));
    if (!track.available) add('Localizar arquivo…', async () => { await api.relocateTrack(track.id); void refreshList(); });
    add('Remover da biblioteca', async () => { if (!window.confirm(`Remover ${ids.length} faixa(s) da biblioteca? Os arquivos no disco não serão apagados.`)) return; await Promise.all(ids.map(id => api.removeTrack(id))); state.count = Math.max(0, state.count - ids.length); void refreshList(); });
    menu.classList.remove('hidden'); const rect = menu.getBoundingClientRect(); menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - rect.width - 8))}px`; menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - rect.height - 8))}px`;
  }
  async function showInfo(id) {
    const track = await getTrack(id); if (!track) return;
    const sections = [
      ['METADATA', [['Título', track.title || track.base_name], ['Artista', track.artist], ['Álbum', track.album], ['Artista do álbum', track.album_artist], ['Ano', track.year], ['Gênero', track.genre], ['Faixa', track.track_no], ['Disco', track.disc_no], ['Compositor', track.composer]]],
      ['ÁUDIO', [['Formato', track.format || track.extension], ['Codec', track.codec], ['Bitrate', track.bitrate ? `${Math.round(track.bitrate / 1000)} kb/s` : ''], ['Sample rate', track.sample_rate ? `${track.sample_rate} Hz` : ''], ['Bit depth', track.bit_depth ? `${track.bit_depth} bit` : ''], ['Canais', track.channels], ['Duração', format(track.duration)]]],
      ['ARQUIVO', [['Tamanho', `${(track.size / 1048576).toFixed(1)} MB`], ['Localização', track.path], ['Disponível', track.available ? 'Sim' : 'Não']]],
      ['BIBLIOTECA', [['Reproduções', track.play_count], ['Avaliação', track.rating ? `${track.rating} / 5` : 'Sem avaliação']]]
    ];
    const body = $('mvDialogBody'); body.replaceChildren(); const heading = document.createElement('h2'); heading.textContent = 'Informações da faixa'; body.append(heading);
    for (const [label, fields] of sections) {
      const section = document.createElement('section'); section.className = 'mv-info-section'; const sectionTitle = document.createElement('h3'); sectionTitle.textContent = label; section.append(sectionTitle);
      const dl = document.createElement('dl'); for (const [name, value] of fields) { if (value === '' || value == null) continue; const dt = document.createElement('dt'); dt.textContent = name; const dd = document.createElement('dd'); dd.textContent = String(value); dd.title = dd.textContent; if (name === 'Localização') dd.classList.add('mv-path-value'); dl.append(dt, dd); } section.append(dl); body.append(section);
    }
    const rating = document.createElement('div'); rating.className = 'mv-rating'; rating.textContent = 'Avaliação  '; for (let star = 1; star <= 5; star++) { const button = document.createElement('button'); button.type = 'button'; button.textContent = star <= track.rating ? '★' : '☆'; button.title = `${star} estrelas`; button.onclick = async () => { await api.rate(id, star); [...rating.querySelectorAll('button')].forEach((item, index) => { item.textContent = index < star ? '★' : '☆'; }); }; rating.append(button); } body.append(rating); $('mvDialog').showModal();
    const editMetadata = document.createElement('button'); editMetadata.type = 'button'; editMetadata.textContent = 'Editar dados locais'; editMetadata.onclick = () => { $('mvDialog').close(); void showMetadataEditor([id]); }; body.append(editMetadata);
    const pathActions = document.createElement('div'); pathActions.className = 'mv-cover-actions';
    const copyPath = document.createElement('button'); copyPath.type = 'button'; copyPath.textContent = 'Copiar caminho'; copyPath.onclick = async () => { await window.ntc.copyText(track.path); notify('Caminho copiado.'); };
    const reveal = document.createElement('button'); reveal.type = 'button'; reveal.textContent = 'Mostrar no Explorer'; reveal.disabled = !track.available; reveal.onclick = () => void api.showTrack(id);
    pathActions.append(copyPath, reveal); body.append(pathActions);
    const coverActions = document.createElement('div'); coverActions.className = 'mv-cover-actions';
    const fitLabel = document.createElement('label'); fitLabel.className = 'mv-cover-fit'; fitLabel.textContent = 'Exibição da capa';
    const fitMode = document.createElement('select'); fitMode.setAttribute('aria-label', 'Exibição da capa'); fitMode.innerHTML = '<option value="contain">Ajustar imagem inteira</option><option value="cover">Preencher com corte</option>'; fitMode.value = track.cover_fit === 'cover' ? 'cover' : 'contain';
    fitMode.onchange = async () => { const mode = await api.setCoverFit(id, fitMode.value); if (state.current?.id === id) { state.current.cover_fit = mode; void showCover(id); } };
    fitLabel.append(fitMode);
    const choose = document.createElement('button'); choose.type = 'button'; choose.textContent = 'Escolher capa'; choose.onclick = async () => { await api.chooseCover(id); if (state.current?.id === id) void showCover(id); };
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Remover capa associada'; clear.onclick = async () => { await api.clearCover(id); if (state.current?.id === id) void showCover(id); };
    const online = document.createElement('button'); online.type = 'button'; online.textContent = 'Buscar dados online';
    const onlineFeedback = document.createElement('p'); onlineFeedback.className = 'mv-online-feedback hidden'; onlineFeedback.setAttribute('role', 'status'); onlineFeedback.setAttribute('aria-live', 'polite');
    const options = document.createElement('div'); options.className = 'mv-online-results'; options.setAttribute('aria-label', 'Resultados de metadados');
    online.onclick = async () => {
      if (online.disabled) return;
      online.disabled = true; online.textContent = 'Buscando…'; onlineFeedback.classList.remove('hidden'); onlineFeedback.textContent = 'Consultando o catálogo de músicas…'; options.replaceChildren();
      try {
        const results = await api.searchOnline(id, '');
        if (!Array.isArray(results) || !results.length) { onlineFeedback.textContent = 'Nenhum resultado confiável encontrado. Confira o título e tente novamente.'; return; }
        onlineFeedback.textContent = results.length === 1 ? '1 resultado. Confira antes de aplicar os dados.' : `${results.length} resultados. Escolha manualmente a edição correta; nada será aplicado automaticamente.`;
        for (const result of results) {
          const item = document.createElement('button'); item.type = 'button';
          item.textContent = [result.trackTitle || result.title, result.artist, result.album, result.year].filter(Boolean).join(' · '); item.title = item.textContent;
          item.onclick = async () => {
            item.disabled = true;
            try { await api.applyOnline(id, result); if (state.current?.id === id) { state.current = await getTrack(id); renderTransport(); void showCover(id); syncMediaSession(); } $('mvDialog').close(); void refreshList(); }
            catch (error) { item.disabled = false; onlineFeedback.textContent = `Não foi possível aplicar os dados: ${error.message || 'tente novamente.'}`; }
          };
          options.append(item);
        }
      } catch (error) { onlineFeedback.textContent = `Busca online indisponível: ${error.message || 'verifique a conexão e tente novamente.'}`; }
      finally { online.disabled = false; online.textContent = 'Buscar dados online'; }
    };
    coverActions.append(choose, clear, online); body.append(fitLabel, coverActions, onlineFeedback, options);
  }
  async function showMetadataEditor(ids) {
    const first = ids.length === 1 ? await getTrack(ids[0]) : null;
    const body = $('mvDialogBody'); body.replaceChildren(); const title = document.createElement('h2'); title.textContent = ids.length > 1 ? `Editar ${ids.length} faixas` : 'Editar dados locais'; body.append(title);
    const hint = document.createElement('p'); hint.textContent = 'Estas alterações ficam apenas no NTC. Os arquivos e tags originais não são modificados. Campos vazios são ignorados.'; body.append(hint);
    const form = document.createElement('form'); form.className = 'mv-metadata-form';
    const fields = [['title', 'Título'], ['artist', 'Artista'], ['album_artist', 'Artista do álbum'], ['album', 'Álbum'], ['year', 'Ano'], ['genre', 'Gênero'], ['track_no', 'Faixa'], ['disc_no', 'Disco'], ['composer', 'Compositor']];
    for (const [key, label] of fields) { if (ids.length > 1 && ['title', 'track_no', 'disc_no'].includes(key)) continue; const field = document.createElement('label'); field.textContent = label; const input = document.createElement('input'); input.type = 'text'; input.name = key; input.maxLength = 250; input.value = first?.[key] || ''; field.append(input); form.append(field); }
    const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Salvar no NTC'; form.append(submit);
    form.onsubmit = async event => { event.preventDefault(); const patch = {}; for (const input of form.querySelectorAll('input')) if (input.value.trim()) patch[input.name] = input.value.trim(); if (!Object.keys(patch).length) return; await api.overrideMetadata(ids, patch); if (state.current && ids.includes(state.current.id)) { state.current = await getTrack(state.current.id); renderTransport(); syncMediaSession(); } $('mvDialog').close(); void refreshList(); notify(`${ids.length} faixa(s) atualizada(s) no NTC.`); };
    body.append(form);
    if (ids.length > 1) {
      const cover = document.createElement('button'); cover.type = 'button'; cover.textContent = `Aplicar capa às ${ids.length} faixas`;
      cover.onclick = async () => { try { if (await api.chooseCoverBatch(ids)) { if (state.current && ids.includes(state.current.id)) void showCover(state.current.id); notify('Capa associada às faixas selecionadas.'); } } catch (error) { notify(`Não foi possível associar a capa: ${error.message}`); } };
      body.append(cover);
    }
    $('mvDialog').showModal();
  }
  let groupObserver = null;
  async function renderGroups(offset = 0) {
    const kind = state.view, query = state.query; const groups = await api.groups(kind, query, 100, offset); if (state.view !== kind || state.group || state.query !== query) return;
    const container = $('mvGroups');
    if (!offset) {
      groupObserver?.disconnect(); container.replaceChildren();
      groupObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          groupObserver?.unobserve(entry.target);
          const target = entry.target, id = Number(target.dataset.coverId);
          void api.cover(id).then(data => { if (data && target.isConnected) { const image = document.createElement('img'); image.src = data; image.alt = ''; target.replaceChildren(image); } }).catch(() => {});
        }
      }, { root: container, rootMargin: '100px' }) : null;
    }
    if (!groups.length && !offset) container.textContent = 'Nenhum grupo encontrado.';
    for (const item of groups) {
      const button = document.createElement('button'); button.type = 'button';
      if (kind === 'albums') {
        button.classList.add('mv-album-card');
        const art = document.createElement('span'); art.className = 'mv-group-art'; art.textContent = '♫'; art.dataset.coverId = item.sample_id; button.append(art);
        if (groupObserver) groupObserver.observe(art);
      }
      const copy = document.createElement('span'); copy.className = 'mv-group-copy';
      const name = document.createElement('strong'); name.textContent = item.name; name.title = item.name;
      const secondary = document.createElement('small'); secondary.textContent = kind === 'albums' ? [item.artist, item.year?.slice(0, 4)].filter(Boolean).join(' · ') : `${item.count} faixas`;
      const count = document.createElement('small'); count.textContent = `${item.count} faixas · ${format(item.duration)}`;
      copy.append(name, secondary, count); button.append(copy);
      button.onclick = () => { state.group = item.name; $('mvGroupTitle').textContent = item.name; $('mvBreadcrumb').classList.remove('hidden'); container.classList.add('hidden'); $('mvViewport').classList.remove('hidden'); void refreshList(); };
      container.append(button);
    }
    if (groups.length === 100) { const more = document.createElement('button'); more.type = 'button'; more.className = 'mv-more-groups'; more.textContent = 'Carregar mais…'; more.onclick = () => { more.remove(); void renderGroups(offset + 100); }; container.append(more); }
  }
  async function renderFolders() {
    state.sources = await api.sources(); const container = $('mvFolders'); container.replaceChildren();
    for (const source of state.sources) { const button = document.createElement('button'); button.type = 'button'; button.textContent = `${source.available ? '▰' : '⚠'} ${source.path}`; button.title = source.available ? 'Abrir pasta da biblioteca' : 'Fonte indisponível'; button.onclick = () => { state.sourceId = source.id; state.group = source.path; state.folderRoot = source.path; $('mvGroupTitle').textContent = source.path; $('mvBreadcrumb').classList.remove('hidden'); container.classList.add('hidden'); $('mvViewport').classList.remove('hidden'); void renderFolderChildren(); void refreshList(); }; container.append(button); }
    if (!state.sources.length) container.textContent = 'Nenhuma pasta adicionada.';
    const list = $('mvSourceList'); list.replaceChildren();
    for (const source of state.sources) { const row = document.createElement('div'); row.className = 'mv-source'; const label = document.createElement('span'); label.textContent = `${source.available ? '●' : '○'} ${source.path}`; label.title = source.path;
      const rescan = document.createElement('button'); rescan.type = 'button'; rescan.textContent = 'Atualizar'; rescan.onclick = () => void api.scan([source.id]);
      const relocate = document.createElement('button'); relocate.type = 'button'; relocate.textContent = 'Relocalizar'; relocate.onclick = async () => { await api.relocateSource(source.id); void renderFolders(); };
      const ignore = document.createElement('button'); ignore.type = 'button'; ignore.textContent = 'Ignorar subpasta'; ignore.title = 'Informe o caminho relativo dentro desta fonte'; ignore.disabled = source.kind !== 'folder'; ignore.onclick = async () => { const relative = window.prompt('Subpasta relativa a ignorar (ex.: Downloads\\Rascunhos)'); if (!relative?.trim()) return; try { await api.ignoreFolder(source.id, relative.trim()); await api.scan([source.id]); void renderFolders(); void refreshList(); } catch (error) { notify(error.message); } };
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover'; remove.onclick = async () => { if (!window.confirm('Remover esta fonte da biblioteca? Os arquivos no disco não serão apagados.')) return; await api.removeSource(source.id); void renderFolders(); void refreshList(); };
      row.append(label, rescan, relocate, ignore, remove); list.append(row);
    }
  }
  async function renderFolderChildren(offset = 0) {
    const container = $('mvFolderChildren'); container.replaceChildren(); container.classList.toggle('hidden', !state.sourceId);
    if (!state.sourceId) return;
    const sourceId = state.sourceId, parent = state.group;
    const children = await api.folderChildren(sourceId, parent, offset); if (state.sourceId !== sourceId || state.group !== parent) return;
    if (offset > 0) { const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '← Pastas anteriores'; previous.onclick = () => void renderFolderChildren(Math.max(0, offset - 200)); container.append(previous); }
    for (const child of children) { const button = document.createElement('button'); button.type = 'button'; button.textContent = `▰ ${child.child} · ${child.count}`; button.onclick = () => { state.group = `${parent}${/[\\/]$/.test(parent) ? '' : '\\'}${child.child}`; $('mvGroupTitle').textContent = state.group; void renderFolderChildren(); void refreshList(); }; container.append(button); }
    if (children.length === 200) { const more = document.createElement('button'); more.type = 'button'; more.textContent = 'Mais pastas…'; more.onclick = () => void renderFolderChildren(offset + 200); container.append(more); }
  }
  async function renderPlaylists() {
    state.playlists = await api.playlists(); const container = $('mvPlaylists'); container.replaceChildren();
    const create = document.createElement('button'); create.type = 'button'; create.textContent = '+ Nova playlist'; create.onclick = async () => { const name = window.prompt('Nome da playlist'); if (name?.trim()) { await api.createPlaylist(name); void renderPlaylists(); } }; container.append(create);
    for (const playlist of state.playlists) { const button = document.createElement('button'); button.type = 'button'; button.className = 'mv-playlist-card'; if (playlist.cover) { const image = document.createElement('img'); image.src = playlist.cover; image.alt = ''; button.append(image); } const label = document.createElement('span'); label.textContent = `${playlist.name} · ${playlist.count} músicas`; button.append(label); button.onclick = () => void openPlaylist(playlist); button.ondragover = event => { if (event.dataTransfer.types.includes('text/x-ntc-track-ids')) { event.preventDefault(); button.classList.add('dragging'); } }; button.ondragleave = () => button.classList.remove('dragging'); button.ondrop = async event => { event.preventDefault(); button.classList.remove('dragging'); try { const ids = JSON.parse(event.dataTransfer.getData('text/x-ntc-track-ids') || '[]'); if (ids.length) { await api.addPlaylistItems(playlist.id, ids); void renderPlaylists(); } } catch { /* Invalid drag. */ } }; container.append(button); }
  }
  async function refreshPlaylistDetails(playlistId) {
    state.playlists = await api.playlists();
    const updated = state.playlists.find(item => Number(item.id) === Number(playlistId));
    if (updated) await openPlaylist(updated); else await renderPlaylists();
  }
  async function openPlaylist(playlist) {
    state.playlistId = playlist.id; const items = await api.playlistItems(playlist.id); const container = $('mvPlaylists'); container.replaceChildren();
    const back = document.createElement('button'); back.type = 'button'; back.textContent = '← Playlists'; back.onclick = () => void renderPlaylists();
    const heading = document.createElement('h3'); heading.textContent = playlist.name;
    const description = document.createElement('p'); description.textContent = playlist.description || '';
    const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = 'Renomear'; rename.onclick = () => { state.playlistEditor = 'name'; void openPlaylist(playlist); };
    const editDescription = document.createElement('button'); editDescription.type = 'button'; editDescription.textContent = 'Descrição'; editDescription.onclick = () => { state.playlistEditor = 'description'; void openPlaylist(playlist); };
    const coverButton = document.createElement('button'); coverButton.type = 'button'; coverButton.textContent = 'Trocar capa'; coverButton.onclick = async () => { const cover = await window.ntc.chooseMusicPlaylistCover(); if (cover) { await api.updatePlaylist(playlist.id, { cover }); void renderPlaylists(); } };
    const clearCover = document.createElement('button'); clearCover.type = 'button'; clearCover.textContent = 'Remover capa'; clearCover.disabled = !playlist.cover; clearCover.onclick = async () => { await api.updatePlaylist(playlist.id, { cover: null }); void renderPlaylists(); };
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Excluir playlist'; remove.onclick = async () => { if (window.confirm(`Excluir a playlist “${playlist.name}”? Os arquivos permanecerão no disco.`)) { await api.deletePlaylist(playlist.id); void renderPlaylists(); } };
    container.append(back, heading, description, rename, editDescription, coverButton, clearCover, remove);
    if (state.playlistEditor === 'name' || state.playlistEditor === 'description') {
      const editingName = state.playlistEditor === 'name';
      const form = document.createElement('form'); form.className = 'mv-playlist-editor';
      const field = document.createElement('label'); field.className = 'mv-playlist-editor-field';
      const fieldTitle = document.createElement('span'); fieldTitle.textContent = editingName ? 'Nome da playlist' : 'Descrição da playlist'; field.append(fieldTitle);
      const editor = document.createElement(editingName ? 'input' : 'textarea');
      if (editingName) { editor.type = 'text'; editor.value = playlist.name; editor.required = true; editor.maxLength = 80; }
      else { editor.value = playlist.description || ''; editor.maxLength = 300; editor.rows = 4; }
      editor.setAttribute('aria-label', fieldTitle.textContent); field.append(editor);
      const actions = document.createElement('div'); actions.className = 'mv-playlist-editor-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar'; cancel.onclick = () => { state.playlistEditor = null; void openPlaylist(playlist); };
      const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Salvar';
      const error = document.createElement('span'); error.className = 'mv-playlist-editor-error'; error.setAttribute('role', 'alert');
      actions.append(error, cancel, save); form.append(field, actions);
      form.onsubmit = async event => {
        event.preventDefault(); error.textContent = '';
        const value = editor.value.trim();
        if (editingName && !value) { error.textContent = 'Informe um nome para a playlist.'; editor.focus(); return; }
        save.disabled = true;
        try {
          if (editingName) await api.renamePlaylist(playlist.id, value);
          else await api.updatePlaylist(playlist.id, { description: value });
          state.playlistEditor = null;
          await refreshPlaylistDetails(playlist.id);
          notify(editingName ? 'Playlist renomeada.' : 'Descrição da playlist atualizada.');
        } catch (reason) {
          save.disabled = false;
          error.textContent = reason?.message || (editingName ? 'Não foi possível renomear a playlist.' : 'Não foi possível atualizar a descrição.');
        }
      };
      container.append(form);
      queueMicrotask(() => editor.focus());
    }
    for (const [index, item] of items.entries()) {
      const row = document.createElement('div');
      row.className = `mv-playlist-row${state.selectedPlaylistItemId === item.item_id ? ' selected' : ''}${state.current?.id === item.id ? ' current' : ''}${state.current?.id === item.id && state.playing ? ' playing' : ''}`; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(state.selectedPlaylistItemId === item.item_id)); row.dataset.trackId = item.id; row.dataset.itemId = item.item_id;
      row.draggable = true;
      const play = document.createElement('button'); play.type = 'button'; play.textContent = `${index + 1}. ${item.title || item.base_name}`;
      play.title = `${item.title || item.base_name}${state.current?.id === item.id ? state.playing ? ' · Faixa atual, reproduzindo' : ' · Faixa atual, pausada' : ''}`;
      play.onclick = () => {
        state.selectedPlaylistItemId = item.item_id; selectTrack(item.id, 'playlist');
      };
      play.ondblclick = () => {
        state.selectedPlaylistItemId = item.item_id; selectTrack(item.id, 'playlist');
        state.queueRevision++; state.queue = items.map(track => ({ id: track.id, key: crypto.randomUUID() }));
        void playTrack(item.id, index, 0, null, true);
      };
      const drop = document.createElement('button'); drop.type = 'button'; drop.textContent = '×'; drop.title = 'Remover da playlist'; drop.setAttribute('aria-label', `Remover ${item.title || item.base_name} da playlist`); drop.onclick = async () => { await api.removePlaylistItem(item.item_id); void openPlaylist(playlist); };
      row.ondragstart = event => event.dataTransfer.setData('text/x-ntc-playlist-item', String(item.item_id)); row.ondragover = event => event.preventDefault(); row.ondrop = async event => { event.preventDefault(); const source = Number(event.dataTransfer.getData('text/x-ntc-playlist-item')); if (source) { await api.reorderPlaylistItem(source, item.item_id); void openPlaylist(playlist); } };
      row.append(play, drop); container.append(row);
    }
    container.ondragover = event => { if (event.dataTransfer.types.includes('text/x-ntc-track-ids')) event.preventDefault(); };
    container.ondrop = async event => { const ids = JSON.parse(event.dataTransfer.getData('text/x-ntc-track-ids') || '[]'); if (ids.length) { event.preventDefault(); await api.addPlaylistItems(playlist.id, ids); void openPlaylist(playlist); } };
  }
  async function switchView(view) {
    state.view = view; state.group = ''; state.sourceId = null; state.folderRoot = ''; state.selection.clear(); $('mvBreadcrumb').classList.add('hidden'); $('mvFolderChildren').classList.add('hidden');
    host.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('mvLibraryTitle').textContent = ({ songs: 'Músicas', albums: 'Álbuns', artists: 'Artistas', genres: 'Gêneros', folders: 'Pastas', playlists: 'Playlists', queue: 'Fila' })[view];
    for (const id of ['mvGroups','mvQueue','mvPlaylists','mvFolders']) $(id).classList.toggle('hidden', !(id === ({ albums: 'mvGroups', artists: 'mvGroups', genres: 'mvGroups', queue: 'mvQueue', playlists: 'mvPlaylists', folders: 'mvFolders' })[view]));
    $('mvSubtabs').classList.toggle('hidden', view !== 'songs'); $('mvSort').classList.toggle('hidden', !['songs','albums','artists','genres','folders'].includes(view));
    $('mvViewport').classList.toggle('hidden', ['albums','artists','genres','queue','playlists','folders'].includes(view));
    if (['albums','artists','genres'].includes(view)) await renderGroups();
    if (view === 'folders') await renderFolders(); if (view === 'playlists') await renderPlaylists(); if (view === 'queue') renderQueue();
    if (view === 'songs') await refreshList(); updateEmpty(); persistSoon();
  }
  function syncSelectionAll() { void (async () => { state.selection.clear(); for (let offset = 0; offset < state.total; offset += 200) { const page = await api.list({ ...listOptions(), offset, limit: Math.min(200, state.total - offset) }); page.items.forEach(item => state.selection.add(item.id)); if (state.selection.size >= 10000) { notify('Seleção limitada a 10.000 faixas por operação.'); break; } } renderVisible(); })(); }
  function onPlaybackTick(index) {
    if (index !== state.currentDeck) return;
    renderTime(); persistPosition(); publishControlState();
    const deck = audio[index]; const delta = deck.currentTime - state.lastObservedTime;
    // timeupdate can be throttled while minimized; a long genuine playback interval still counts.
    // Seeking resets lastObservedTime separately so jumping ahead does not count as listening.
    if (state.playing && !deck.seeking && delta > 0) state.playedFrom += delta;
    state.lastObservedTime = deck.currentTime;
    if (!state.recorded && state.current && model.shouldRecordPlay(state.playedFrom, deck.duration || state.current.duration, state.recorded)) { state.recorded = true; void api.playRecord(state.current.id); }
    if (state.sleepAt && Date.now() >= state.sleepAt) stopPlayback();
    void maybeCrossfade();
  }
  audio.forEach((deck, index) => {
    deck.addEventListener('timeupdate', () => onPlaybackTick(index));
    deck.addEventListener('seeking', () => { if (index === state.currentDeck) state.lastObservedTime = deck.currentTime; });
    deck.addEventListener('loadedmetadata', () => { if (index === state.currentDeck) renderTime(); });
    deck.addEventListener('ended', () => { if (state.fade) return; if (index === state.currentDeck) void next(); });
    deck.addEventListener('error', () => {
      if (index !== state.currentDeck || !state.current) return;
      if (!state.conversionRetried) {
        state.conversionRetried = true; const id = state.current.id; const token = state.playbackToken;
        notify('Preparando formato alternativo para reprodução…');
        void api.playSource(id, true).then(async src => { if (token !== state.playbackToken) return; deck.src = src; deck.load(); await deck.play(); state.playing = true; renderTransport(); notify(''); }).catch(() => { state.playing = false; renderTransport(); notify('Falha na faixa. Verifique o formato ou localize o arquivo novamente.'); });
      } else { state.playing = false; renderTransport(); notify('Falha na faixa. Verifique o formato ou localize o arquivo novamente.'); }
    });
  });
  $('mvPlay').onclick = () => void togglePlay(); $('mvNext').onclick = () => void next(true); $('mvPrev').onclick = () => void previous();
  $('mvShuffle').onclick = () => { state.queueRevision++; state.shuffle = !state.shuffle; renderTransport(); persistSoon(); };
  $('mvRepeat').onclick = () => { state.queueRevision++; state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'; renderTransport(); persistSoon(); };
  $('mvMute').onclick = () => { state.muted = !state.muted; applyVolumes(); renderTransport(); persistSoon(); };
  $('mvVolume').oninput = event => { state.volume = Number(event.target.value) / 100; applyVolumes(); renderTransport(); persistSoon(); };
  $('mvSeek').oninput = event => { const deck = currentAudio(); if (Number.isFinite(deck.duration)) deck.currentTime = Number(event.target.value) / 1000 * deck.duration; };
  $('mvSettings').onclick = () => $('mvDrawer').classList.remove('hidden'); $('mvCloseSettings').onclick = () => $('mvDrawer').classList.add('hidden');
  $('mvCrossfade').oninput = event => { state.crossfade = Number(event.target.value); $('mvCrossfadeText').textContent = `${state.crossfade} s`; persistSoon(); };
  $('mvSleep').onchange = event => { state.sleep = event.target.value; state.sleepAt = /^\d+$/.test(state.sleep) ? Date.now() + Number(state.sleep) * 60000 : 0; scheduleSleep(); notify(state.sleep === 'off' ? 'Sleep timer desligado.' : 'Sleep timer ativado.'); };
  $('mvEqPreset').onchange = event => { state.eqPreset = event.target.value; if (presets[state.eqPreset]) state.eq = [...presets[state.eqPreset]]; renderEq(); applyEq(); persistSoon(); };
  $('mvEqReset').onclick = () => { state.eqPreset = 'flat'; state.eq = [...presets.flat]; renderEq(); applyEq(); persistSoon(); };
  $('mvEqSave').onclick = () => { const name = window.prompt('Nome do preset'); if (!name?.trim()) return; const custom = JSON.parse(localStorage.getItem('ntc-music-v2-eq-presets') || '{}'); custom[name.trim().slice(0, 40)] = state.eq; localStorage.setItem('ntc-music-v2-eq-presets', JSON.stringify(custom)); const option = new Option(name.trim(), `saved:${name.trim()}`); $('mvEqPreset').add(option); $('mvEqPreset').value = option.value; state.eqPreset = option.value; persistSoon(); };
  $('mvSearch').oninput = event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = event.target.value.trim(); if (['albums','artists','genres'].includes(state.view) && !state.group) void renderGroups(); else void refreshList(); }, 180); };
  $('mvSort').onchange = event => { state.sort = event.target.value; void refreshList(); persistSoon(); };
  $('mvViewport').onscroll = () => renderVisible();
  $('mvTabs').onclick = event => { const button = event.target.closest('[data-view]'); if (button) void switchView(button.dataset.view); };
  $('mvTabs').ondragover = event => { const button = event.target.closest('[data-view]'); if (button && ['queue','playlists'].includes(button.dataset.view) && event.dataTransfer.types.includes('text/x-ntc-track-ids')) { event.preventDefault(); button.classList.add('drop-target'); } };
  $('mvTabs').ondragleave = event => { const button = event.target.closest('[data-view]'); button?.classList.remove('drop-target'); };
  $('mvTabs').ondrop = event => { const button = event.target.closest('[data-view]'); button?.classList.remove('drop-target'); if (!button) return; try { const ids = JSON.parse(event.dataTransfer.getData('text/x-ntc-track-ids') || '[]'); if (!ids.length) return; event.preventDefault(); if (button.dataset.view === 'queue') addQueue(ids); if (button.dataset.view === 'playlists') { void (async () => { const lists = await api.playlists(); const name = window.prompt('Adicionar à playlist', lists[0]?.name || ''); const target = lists.find(item => item.name === name); if (target) { await api.addPlaylistItems(target.id, ids); notify(`${ids.length} faixa(s) adicionada(s) à playlist.`); } })(); } } catch { /* Invalid drag. */ } };
  $('mvSubtabs').onclick = event => { const button = event.target.closest('[data-filter]'); if (!button || !libraryFilters.has(button.dataset.filter)) return; state.filter = button.dataset.filter; if (state.filter === 'recent') { state.sort = 'played'; $('mvSort').value = 'played'; } renderFilterButtons(); void refreshList(); persistSoon(); };
  $('mvBack').onclick = () => { if (state.view === 'folders' && state.group && state.group !== state.folderRoot) { state.group = state.group.replace(/[\\/][^\\/]+$/, ''); $('mvGroupTitle').textContent = state.group; void renderFolderChildren(); void refreshList(); return; } state.group = ''; state.sourceId = null; $('mvBreadcrumb').classList.add('hidden'); $('mvFolderChildren').classList.add('hidden'); $('mvViewport').classList.add('hidden'); if (state.view === 'folders') void renderFolders(); else void renderGroups(); };
  async function addSources(kind) { try { await api.addSources(kind); state.sources = await api.sources(); notify('Indexação iniciada. Você pode continuar ouvindo música.'); void renderFolders(); } catch (error) { notify(error.message); } }
  $('mvAddFiles').onclick = () => void addSources('file'); $('mvAddFolders').onclick = () => void addSources('folder'); $('mvEmptyFiles').onclick = () => void addSources('file'); $('mvEmptyFolder').onclick = () => void addSources('folder');
  $('mvRescan').onclick = () => void api.scan(); $('mvCancelScan').onclick = () => void api.cancelScan();
  $('mvImport').ondragenter = event => { event.preventDefault(); $('mvImport').classList.add('dragging'); };
  $('mvImport').ondragover = event => event.preventDefault(); $('mvImport').ondragleave = () => $('mvImport').classList.remove('dragging');
  $('mvImport').ondrop = event => { event.preventDefault(); $('mvImport').classList.remove('dragging'); const paths = [...event.dataTransfer.files].map(file => window.ntc.pathForFile(file)).filter(Boolean); if (paths.length) void api.dropPaths(paths).then(() => notify('Arquivos/pastas adicionados.')); };
  $('mvQueue').ondragover = event => { if (event.dataTransfer.types.includes('text/x-ntc-track-ids')) event.preventDefault(); };
  $('mvQueue').ondrop = event => { try { const ids = JSON.parse(event.dataTransfer.getData('text/x-ntc-track-ids')); if (ids.length) addQueue(ids); } catch { /* Invalid drag. */ } };
  $('mvInfo').onclick = () => { if (state.current) void showInfo(state.current.id); };
  $('mvLyricsButton').onclick = async () => {
    if (!state.current) return; const result = await api.lyrics(state.current.id); state.lyrics = result.content || ''; state.lrc = model.parseLrc(state.lyrics);
    const body = $('mvDialogBody'); body.replaceChildren(); const title = document.createElement('h2'); title.textContent = 'Letras'; body.append(title);
    const lyrics = document.createElement('div'); lyrics.className = 'mv-lyrics';
    if (state.lyrics) { if (state.lrc.length) state.lrc.forEach(line => { const item = document.createElement('p'); item.className = 'mv-lyric-line'; item.textContent = line.text; lyrics.append(item); }); else lyrics.textContent = state.lyrics; }
    else lyrics.textContent = 'Nenhuma letra disponível.';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Editar letra local'; edit.onclick = async () => { const value = window.prompt('Cole a letra ou conteúdo LRC', state.lyrics); if (value !== null) { await api.saveLyrics(state.current.id, value); state.lyrics = value; state.lrc = model.parseLrc(value); $('mvDialog').close(); } };
    body.append(lyrics, edit); $('mvDialog').showModal();
  };
  $('mvMini').onclick = () => void api.openMini();
  api.onControl(command => {
    const name = typeof command === 'string' ? command : command?.name;
    if (name === 'toggle') void togglePlay(); if (name === 'previous') void previous(); if (name === 'next') void next(true);
    if (name === 'seek' && Number.isFinite(Number(command.value)) && Number.isFinite(currentAudio().duration)) currentAudio().currentTime = Math.max(0, Math.min(1, Number(command.value))) * currentAudio().duration;
    if (name === 'volume' && Number.isFinite(Number(command.value))) { state.volume = Math.max(0, Math.min(1, Number(command.value))); state.muted = false; applyVolumes(); renderTransport(); persistSoon(); publishControlState(true); }
    if (name === 'mute') { state.muted = !state.muted; applyVolumes(); renderTransport(); persistSoon(); publishControlState(true); }
  });
  document.addEventListener('pointerdown', event => { if (!$('mvMenu').contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', event => {
    if (!host.classList.contains('active') || $('mvDialog').open || isWriting(event.target) || event.altKey || event.metaKey) return;
    if (event.ctrlKey && event.key.toLowerCase() === 'f') { event.preventDefault(); $('mvSearch').focus(); return; }
    if (event.ctrlKey && event.key.toLowerCase() === 'a' && host.contains(document.activeElement)) { event.preventDefault(); syncSelectionAll(); return; }
    if (event.ctrlKey && event.key === 'ArrowRight') { event.preventDefault(); void next(true); return; }
    if (event.ctrlKey && event.key === 'ArrowLeft') { event.preventDefault(); void previous(); return; }
    if (event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); state.volume = Math.max(0, Math.min(1, state.volume + (event.key === 'ArrowUp' ? .05 : -.05))); state.muted = false; applyVolumes(); renderTransport(); persistSoon(); publishControlState(true); return; }
    if (event.code === 'Space' && !event.target.closest('button')) { event.preventDefault(); void togglePlay(); }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const deck = currentAudio(); if (Number.isFinite(deck.duration)) deck.currentTime = Math.max(0, Math.min(deck.duration, deck.currentTime + (event.key === 'ArrowRight' ? 5 : -5))); }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); state.volume = Math.max(0, Math.min(1, state.volume + (event.key === 'ArrowUp' ? .05 : -.05))); applyVolumes(); renderTransport(); persistSoon(); }
    if (event.key.toLowerCase() === 'm' && !event.ctrlKey) { state.muted = !state.muted; applyVolumes(); renderTransport(); persistSoon(); }
    if (event.key === 'Enter' && state.selection.size === 1) { event.preventDefault(); state.browseOffset = state.anchor; void playTrack([...state.selection][0]); }
    if (event.key === 'Delete' && state.selection.size && state.view === 'songs') { event.preventDefault(); if (window.confirm(`Remover ${state.selection.size} faixa(s) da biblioteca? Os arquivos no disco permanecem.`)) void Promise.all([...state.selection].map(id => api.removeTrack(id))).then(() => refreshList()); }
  });
  api.onProgress(progress => { state.scan = progress; $('mvProgress').classList.toggle('hidden', !progress.running); $('mvProgressText').textContent = progress.running ? `Analisando biblioteca… ${progress.scanned} arquivos · ${progress.metadata} metadados` : ''; if (!progress.running) { if (progress.errors) notify(`Indexação concluída com ${progress.errors} arquivo(s) que não puderam ser analisados.`); void (async () => { const fresh = await api.state(); state.count = fresh.count; $('mvCount').textContent = `${state.count.toLocaleString('pt-BR')} faixas`; void refreshList(); })(); } else { clearTimeout(progressTimer); progressTimer = setTimeout(() => { void refreshList(); }, 800); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderTime(); renderTransport(); } else persistPosition(); });
  window.addEventListener('beforeunload', () => { void api.saveSession(settings()); if (state.current) void api.savePosition({ id: state.current.id, seconds: currentAudio().currentTime || 0 }); });
  async function init() {
    try {
      if (localStorage.getItem('ntc-music-v2-legacy-sent') !== 'true') {
        const oldArray = key => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
        let playback = null; try { playback = JSON.parse(localStorage.getItem('ntc-music-playback-state') || 'null'); } catch { /* Old session may be malformed. */ }
        await api.migrateLegacy({ liked: oldArray('ntc-music-liked'), playlists: oldArray('ntc-music-playlists'), playback, volume: localStorage.getItem('ntc-music-volume'), crossfade: localStorage.getItem('ntc-music-crossfade') });
        localStorage.setItem('ntc-music-v2-legacy-sent', 'true');
      }
      const initial = await api.state(); state.count = initial.count; state.sources = initial.sources; const saved = initial.session || {};
      state.queue = model.normalizeQueue(saved.queue); state.queueIndex = Number.isInteger(saved.queueIndex) ? saved.queueIndex : -1;
      state.browseOffset = Number.isSafeInteger(saved.browseOffset) ? saved.browseOffset : -1;
      state.volume = Math.max(0, Math.min(1, Number(saved.volume ?? .8))); state.muted = Boolean(saved.muted); state.shuffle = Boolean(saved.shuffle); state.repeat = ['off','all','one'].includes(saved.repeat) ? saved.repeat : 'off'; state.crossfade = Math.max(0, Math.min(12, Number(saved.crossfade) || 0)); state.sort = saved.sort || 'title'; state.filter = libraryFilters.has(saved.filter) ? saved.filter : 'songs'; state.eq = Array.isArray(saved.eq) && saved.eq.length === 10 ? saved.eq.map(value => Math.max(-12, Math.min(12, Number(value) || 0))) : [...presets.flat]; state.eqPreset = saved.eqPreset || 'flat'; state.playlistId = saved.playlistId || null;
      for (const [name, bands] of Object.entries(JSON.parse(localStorage.getItem('ntc-music-v2-eq-presets') || '{}'))) { presets[`saved:${name}`] = bands; $('mvEqPreset').add(new Option(name, `saved:${name}`)); }
      $('mvSort').value = state.sort; $('mvCrossfade').value = String(state.crossfade); $('mvCrossfadeText').textContent = `${state.crossfade} s`; $('mvCount').textContent = model.libraryCountLabel(state.count, state.count); renderFilterButtons(); renderTransport(); renderEq(); renderQueue();
      await switchView(saved.view || 'songs');
      if (saved.currentId) {
        const track = await getTrack(saved.currentId); if (track) { state.current = track; void showCover(track.id); const source = await api.playSource(track.id).catch(() => null); if (source) { audio[0].src = source; audio[0].load(); const position = initial.position?.id === track.id ? initial.position.seconds : 0; if (position) audio[0].addEventListener('loadedmetadata', () => { audio[0].currentTime = Math.min(position, Math.max(0, audio[0].duration - .2)); renderTime(); }, { once: true }); } renderTransport(); syncMediaSession(); }
      }
      if (state.sources.some(source => source.scanned_at == null && source.available)) { notify('Preparando índice da biblioteca existente…'); void api.scan(); }
    } catch (error) { notify(`Não foi possível abrir a biblioteca: ${error.message}`); }
  }
  void init();
})();
