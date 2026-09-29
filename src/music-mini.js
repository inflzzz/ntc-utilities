(() => {
  const $ = id => document.getElementById(id);
  const api = window.ntc?.music2;
  if (!api) return;
  const format = seconds => { const value = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; };
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM15 5h3v14h-3z"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4zM17 9l4 6m0-6-4 6"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4zM17 9a5 5 0 0 1 0 6"/></svg>'
  };
  let currentCover = null;
  api.onMiniState(state => {
    if ((state.cover || '') !== currentCover) {
      currentCover = state.cover || ''; const art = $('art'); art.replaceChildren();
      if (currentCover) { const image = document.createElement('img'); image.src = currentCover; image.alt = ''; image.style.objectFit = state.coverFit === 'cover' ? 'cover' : 'contain'; art.append(image); }
      else art.textContent = '♫';
    } else if (currentCover) {
      const image = $('art').querySelector?.('img'); if (image) image.style.objectFit = state.coverFit === 'cover' ? 'cover' : 'contain';
    }
    $('title').textContent = state.title || 'Nenhuma música';
    $('artist').textContent = state.artist ? `${state.artist}${state.album ? ` · ${state.album}` : ''}` : 'Artista desconhecido';
    $('play').innerHTML = state.playing ? icons.pause : icons.play;
    $('play').setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproduzir');
    $('play').title = state.playing ? 'Pausar' : 'Reproduzir';
    $('mute').innerHTML = state.muted ? icons.mute : icons.volume;
    $('mute').setAttribute('aria-label', state.muted ? 'Ativar som' : 'Silenciar');
    $('mute').title = state.muted ? 'Ativar som' : 'Silenciar';
    $('time').textContent = format(state.time); $('duration').textContent = format(state.duration);
    if (!$('seek').matches(':active')) $('seek').value = state.duration ? String(Math.round(state.time / state.duration * 1000)) : '0';
    if (!$('volume').matches(':active')) $('volume').value = String(Math.round((state.volume ?? .8) * 100));
    $('onTop').checked = Boolean(state.alwaysOnTop);
  });
  $('previous').onclick = () => void api.sendControl('previous');
  $('play').onclick = () => void api.sendControl('toggle');
  $('next').onclick = () => void api.sendControl('next');
  $('mute').onclick = () => void api.sendControl('mute');
  $('seek').onchange = event => void api.sendControl({ name: 'seek', value: Number(event.target.value) / 1000 });
  $('volume').oninput = event => void api.sendControl({ name: 'volume', value: Number(event.target.value) / 100 });
  $('onTop').onchange = event => void api.setMiniOnTop(event.target.checked);
  $('open').onclick = () => void api.showMain();
})();
