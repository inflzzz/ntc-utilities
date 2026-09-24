(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE = {
    cities: 'ntc-time-cities-v1',
    alarms: 'ntc-time-alarms-v1',
    timer: 'ntc-time-timer-v1',
    stopwatch: 'ntc-time-stopwatch-v1',
    tab: 'ntc-time-active-tab-v1',
  };
  const durableStorageKeys = new Set(Object.values(STORAGE));
  const defaults = [
    { id: 'sao-paulo', name: 'São Paulo', country: 'Brasil', latitude: -23.5505, longitude: -46.6333, timezone: 'America/Sao_Paulo' },
    { id: 'lisbon', name: 'Lisboa', country: 'Portugal', latitude: 38.7223, longitude: -9.1393, timezone: 'Europe/Lisbon' },
    { id: 'tokyo', name: 'Tóquio', country: 'Japão', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  ];
  const weatherLabels = {
    0: 'Céu limpo', 1: 'Predomínio de sol', 2: 'Parcialmente nublado', 3: 'Nublado',
    45: 'Neblina', 48: 'Nevoeiro com geada', 51: 'Garoa leve', 53: 'Garoa moderada', 55: 'Garoa intensa',
    56: 'Garoa congelante leve', 57: 'Garoa congelante intensa', 61: 'Chuva leve', 63: 'Chuva moderada',
    65: 'Chuva intensa', 66: 'Chuva congelante leve', 67: 'Chuva congelante intensa', 71: 'Neve leve',
    73: 'Neve moderada', 75: 'Neve intensa', 77: 'Grãos de neve', 80: 'Pancadas leves',
    81: 'Pancadas moderadas', 82: 'Pancadas fortes', 85: 'Pancadas de neve leves', 86: 'Pancadas de neve fortes',
    95: 'Trovoada', 96: 'Trovoada e granizo leve', 99: 'Trovoada e granizo forte',
  };

  function read(key, fallback) {
    try { const parsed = JSON.parse(localStorage.getItem(key)); return parsed ?? fallback; }
    catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento pode estar indisponível */ }
    if (durableStorageKeys.has(key)) {
      worldSettingsRevision += 1;
      persistWorldSettings();
    }
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  const initialCities = read(STORAGE.cities, defaults);
  let cities = Array.isArray(initialCities) ? initialCities.filter(city => Number.isFinite(Number(city.latitude)) && Number.isFinite(Number(city.longitude))) : defaults;
  if (!cities.length) cities = defaults;
  let alarms = read(STORAGE.alarms, []);
  if (!Array.isArray(alarms)) alarms = [];
  let weatherTimer = null;
  let weatherStarted = false;
  let alertContext = null;
  let alertToneTimer = null;
  let timerState = read(STORAGE.timer, { remainingMs: 300000, endAt: 0, running: false, paused: false });
  if (!timerState || typeof timerState !== 'object') timerState = { remainingMs: 300000, endAt: 0, running: false, paused: false };
  let stopwatch = read(STORAGE.stopwatch, { elapsed: 0, startedAt: 0, running: false, laps: [] });
  if (!stopwatch || typeof stopwatch !== 'object') stopwatch = { elapsed: 0, startedAt: 0, running: false, laps: [] };
  if (!Array.isArray(stopwatch.laps)) stopwatch.laps = [];
  let activeTimeTab = read(STORAGE.tab, 'world');
  let worldSettingsHydrated = false;
  let worldSettingsRevision = 0;
  let worldSettingsSavePromise = Promise.resolve();

  function worldSettingsSnapshot() {
    return { version: 1, cities, alarms, timer: timerState, stopwatch, activeTab: activeTimeTab };
  }
  function persistWorldSettings() {
    if (!worldSettingsHydrated || typeof window.ntc?.saveWorldClockSettings !== 'function') return;
    const snapshot = worldSettingsSnapshot();
    worldSettingsSavePromise = worldSettingsSavePromise.catch(() => false).then(() => window.ntc.saveWorldClockSettings(snapshot));
  }
  function mirrorWorldSettingsToLocalStorage() {
    for (const [key, value] of [[STORAGE.cities, cities], [STORAGE.alarms, alarms], [STORAGE.timer, timerState], [STORAGE.stopwatch, stopwatch], [STORAGE.tab, activeTimeTab]]) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* a cópia durável do processo principal continua disponível */ }
    }
  }
  async function restoreWorldSettings() {
    const revisionAtRequest = worldSettingsRevision;
    let saved = null;
    try { saved = await window.ntc?.getWorldClockSettings?.(); } catch { /* usa o espelho local quando a leitura falhar */ }
    if (revisionAtRequest === worldSettingsRevision && saved?.version === 1) {
      cities = Array.isArray(saved.cities) ? saved.cities.filter(city => Number.isFinite(Number(city.latitude)) && Number.isFinite(Number(city.longitude))) : [];
      if (!cities.length) cities = defaults;
      alarms = Array.isArray(saved.alarms) ? saved.alarms : [];
      timerState = saved.timer && typeof saved.timer === 'object' ? saved.timer : { remainingMs: 300000, endAt: 0, running: false, paused: false };
      stopwatch = saved.stopwatch && typeof saved.stopwatch === 'object' ? saved.stopwatch : { elapsed: 0, startedAt: 0, running: false, laps: [] };
      if (!Array.isArray(stopwatch.laps)) stopwatch.laps = [];
      activeTimeTab = saved.activeTab || 'world';
    }
    worldSettingsHydrated = true;
    mirrorWorldSettingsToLocalStorage();
    renderClockCities(); renderAlarms(); renderTimer(); renderStopwatch(); setTimeTab(activeTimeTab, false);
    persistWorldSettings();
  }

  function saveCities() { write(STORAGE.cities, cities); }
  function renderClockCities() {
    const grid = $('#worldCityGrid');
    if (!grid) return;
    grid.innerHTML = cities.map(city => `
      <article class="world-city-card" data-city-id="${escapeHtml(city.id)}" draggable="true" title="Arraste para mudar a posição">
        <button class="world-city-remove" type="button" data-remove-city="${escapeHtml(city.id)}" aria-label="Remover ${escapeHtml(city.name)}" title="Remover cidade">×</button>
        <div class="world-city-name"><div><h3>${escapeHtml(city.name)}</h3><span>${escapeHtml(city.country || city.admin1 || '')}</span></div><span class="world-city-date" data-city-date>--</span></div>
        <div class="world-city-time" data-city-time>--:--:--</div>
        <div class="world-city-weather"><div class="world-weather-icon-wrap"><img class="world-weather-icon hidden" data-weather-icon alt=""><span class="world-weather-placeholder" data-weather-placeholder>☁</span></div><div class="world-weather-copy"><strong data-weather-condition>Buscando clima…</strong><span><b data-weather-temperature>--°</b><span> Sensação <span data-weather-feels-like>--°</span></span></span></div></div>
        <div class="world-city-details"><span>Umidade <b data-weather-humidity>--%</b></span><span>Vento <b data-weather-wind>-- km/h</b></span></div>
      </article>`).join('');
    $$('[data-remove-city]').forEach(button => button.addEventListener('click', () => {
      if (cities.length <= 1) { $('#worldCitySearchStatus').textContent = 'Mantenha pelo menos uma cidade na lista.'; return; }
      cities = cities.filter(city => String(city.id) !== button.dataset.removeCity);
      saveCities(); renderClockCities(); updateClocks(); refreshWeather();
    }));
    $$('.world-city-card').forEach(card => {
      card.addEventListener('dragstart', event => {
        if (event.target.closest('button, input, select')) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', card.dataset.cityId);
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
        $$('.world-city-card').forEach(item => item.classList.remove('drop-before', 'drop-after'));
      });
      card.addEventListener('dragover', event => {
        event.preventDefault();
        if (card.classList.contains('is-dragging')) return;
        event.dataTransfer.dropEffect = 'move';
        $$('.world-city-card').forEach(item => item.classList.remove('drop-before', 'drop-after'));
        const dragged = $('.world-city-card.is-dragging');
        if (!dragged) return;
        const targetRect = card.getBoundingClientRect();
        const draggedRect = dragged.getBoundingClientRect();
        const sameRow = Math.abs(draggedRect.top - targetRect.top) < targetRect.height / 2;
        const after = sameRow ? event.clientX > targetRect.left + targetRect.width / 2 : event.clientY > targetRect.top + targetRect.height / 2;
        card.classList.add(after ? 'drop-after' : 'drop-before');
      });
      card.addEventListener('drop', event => {
        event.preventDefault();
        const draggedId = event.dataTransfer.getData('text/plain');
        const from = cities.findIndex(item => String(item.id) === draggedId);
        const to = cities.findIndex(item => String(item.id) === card.dataset.cityId);
        if (from < 0 || to < 0 || from === to) return;
        const targetRect = card.getBoundingClientRect();
        const draggedRect = $('.world-city-card.is-dragging')?.getBoundingClientRect();
        const sameRow = draggedRect && Math.abs(draggedRect.top - targetRect.top) < targetRect.height / 2;
        const after = sameRow ? event.clientX > targetRect.left + targetRect.width / 2 : event.clientY > targetRect.top + targetRect.height / 2;
        const reordered = cities.slice();
        const [moved] = reordered.splice(from, 1);
        const adjustedTarget = from < to ? to - 1 : to;
        reordered.splice(adjustedTarget + (after ? 1 : 0), 0, moved);
        cities = reordered;
        saveCities(); renderClockCities(); refreshWeather();
      });
    });
    updateClocks();
  }

  function updateClocks() {
    const now = new Date();
    for (const city of cities) {
      const card = $(`[data-city-id="${CSS.escape(String(city.id))}"]`);
      if (!card) continue;
      try {
        const opts = { timeZone: city.timezone || 'UTC' };
        $('[data-city-time]', card).textContent = new Intl.DateTimeFormat('pt-BR', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
        $('[data-city-date]', card).textContent = new Intl.DateTimeFormat('pt-BR', { ...opts, weekday: 'short', day: '2-digit', month: 'short' }).format(now);
      } catch {
        $('[data-city-time]', card).textContent = '--:--:--';
        $('[data-city-date]', card).textContent = 'Fuso inválido';
      }
    }
  }

  function weatherIcon(code, isDay) {
    if (code === 0) return isDay ? 'clear-day' : 'clear-night';
    if (code === 1 || code === 2) return isDay ? 'partly-cloudy-day' : 'partly-cloudy-night';
    if (code === 3) return 'overcast';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'thunderstorms-rain';
    return 'cloudy';
  }

  async function refreshWeather() {
    await Promise.all(cities.map(async city => {
      const card = $(`[data-city-id="${CSS.escape(String(city.id))}"]`);
      if (!card) return;
      const cacheKey = `ntc-time-weather-${city.id}`;
      const cached = read(cacheKey, null);
      if (cached?.savedAt && Date.now() - cached.savedAt < 15 * 60 * 1000) { showWeather(card, cached.current); return; }
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude: city.latitude, longitude: city.longitude, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m', timezone: 'auto' }).toString();
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data.current) throw new Error('Dados de clima indisponíveis');
        write(cacheKey, { savedAt: Date.now(), current: data.current });
        showWeather(card, data.current);
      } catch {
        if (cached?.current) showWeather(card, cached.current, true);
        else $('[data-weather-condition]', card).textContent = 'Clima indisponível';
      }
    }));
  }

  function showWeather(card, current, stale = false) {
    const code = Number(current.weather_code);
    const icon = weatherIcon(code, Number(current.is_day) === 1);
    const image = $('[data-weather-icon]', card);
    image.src = new URL(`../node_modules/@meteocons/svg-static/fill/${icon}.svg`, document.baseURI).href;
    image.alt = weatherLabels[code] || 'Condição do tempo';
    image.classList.remove('hidden');
    $('[data-weather-placeholder]', card).classList.add('hidden');
    $('[data-weather-condition]', card).textContent = `${weatherLabels[code] || 'Condição do tempo'}${stale ? ' · último dado' : ''}`;
    $('[data-weather-temperature]', card).textContent = `${Math.round(Number(current.temperature_2m))}°`;
    $('[data-weather-feels-like]', card).textContent = `${Math.round(Number(current.apparent_temperature))}°`;
    $('[data-weather-humidity]', card).textContent = `${Math.round(Number(current.relative_humidity_2m))}%`;
    $('[data-weather-wind]', card).textContent = `${Math.round(Number(current.wind_speed_10m))} km/h`;
  }

  function addCity(city) {
    const key = city.id ?? `${city.latitude},${city.longitude}`;
    if (cities.some(item => String(item.id) === String(key) || (Math.abs(Number(item.latitude) - Number(city.latitude)) < 0.01 && Math.abs(Number(item.longitude) - Number(city.longitude)) < 0.01))) {
      $('#worldCitySearchStatus').textContent = 'Essa cidade já está na sua lista.';
      return;
    }
    if (cities.length >= 12) { $('#worldCitySearchStatus').textContent = 'A lista permite até 12 cidades.'; return; }
    cities.push({ id: String(key), name: city.name, country: city.country || city.country_code || '', latitude: Number(city.latitude), longitude: Number(city.longitude), timezone: city.timezone || 'UTC' });
    saveCities();
    $('#worldCityResults').classList.add('hidden');
    $('#worldCitySearch').value = '';
    $('#worldCitySearchStatus').textContent = `${city.name} adicionada.`;
    renderClockCities(); refreshWeather();
  }

  $('#worldCitySearchForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#worldCitySearch');
    const query = input.value.trim();
    if (query.length < 2) { $('#worldCitySearchStatus').textContent = 'Digite pelo menos duas letras.'; return; }
    const status = $('#worldCitySearchStatus');
    const results = $('#worldCityResults');
    status.textContent = 'Buscando…'; results.classList.add('hidden');
    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({ name: query, count: '8', language: 'pt', format: 'json' }).toString();
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const matches = (data.results || []).filter(item => item.timezone && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
      if (!matches.length) { status.textContent = 'Nenhuma cidade encontrada.'; return; }
      results.innerHTML = matches.map((city, index) => `<button class="world-city-result" type="button" data-city-result="${index}"><span><strong>${escapeHtml(city.name)}</strong><small>${escapeHtml([city.admin1, city.country].filter(Boolean).join(', '))}</small></span><span aria-hidden="true">＋</span></button>`).join('');
      results.classList.remove('hidden'); status.textContent = 'Escolha uma cidade para adicionar.';
      $$('[data-city-result]', results).forEach(button => button.addEventListener('click', () => addCity(matches[Number(button.dataset.cityResult)])));
    } catch {
      status.textContent = 'Não foi possível buscar cidades. Verifique sua conexão e tente novamente.';
    }
  });

  function renderAlarms() {
    const list = $('#alarmList');
    if (!list) return;
    const week = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    list.innerHTML = alarms.length ? alarms.map(alarm => {
      const repeat = Array.isArray(alarm.weekdays) && alarm.weekdays.length ? alarm.weekdays.slice().sort((a, b) => (a + 6) % 7 - (b + 6) % 7).map(day => week[day]).join(', ') : 'Uma vez';
      return `<article class="alarm-item ${alarm.enabled ? '' : 'is-disabled'}"><span class="alarm-item-icon" aria-hidden="true">◷</span><div class="alarm-item-copy"><strong>${escapeHtml(alarm.time)}</strong><span>${escapeHtml(alarm.label || 'Alarme')} · ${escapeHtml(repeat)}</span></div><label class="switch alarm-switch"><input type="checkbox" data-toggle-alarm="${escapeHtml(alarm.id)}" ${alarm.enabled ? 'checked' : ''} aria-label="Ativar ${escapeHtml(alarm.label || 'alarme')}"><span></span></label><button class="ghost-button" type="button" data-delete-alarm="${escapeHtml(alarm.id)}">Excluir</button></article>`;
    }).join('') : '<div class="time-empty-state"><span>◷</span><strong>Nenhum alarme configurado</strong><p>Crie um alarme e, se quiser, escolha os dias de repetição.</p></div>';
    $$('[data-toggle-alarm]', list).forEach(input => input.addEventListener('change', () => {
      const alarm = alarms.find(item => item.id === input.dataset.toggleAlarm);
      if (alarm) { alarm.enabled = input.checked; write(STORAGE.alarms, alarms); renderAlarms(); }
    }));
    $$('[data-delete-alarm]', list).forEach(button => button.addEventListener('click', () => {
      alarms = alarms.filter(item => item.id !== button.dataset.deleteAlarm); write(STORAGE.alarms, alarms); renderAlarms();
    }));
  }

  $('#alarmForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const selectedDays = $$('.alarm-weekdays input:checked').map(input => Number(input.value));
    alarms.push({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, time: $('#alarmTime').value, label: $('#alarmLabel').value.trim() || 'Alarme', weekdays: selectedDays, enabled: true, lastTriggered: '' });
    write(STORAGE.alarms, alarms); renderAlarms();
    $('#alarmTime').value = ''; $('#alarmLabel').value = ''; $$('.alarm-weekdays input').forEach(input => { input.checked = false; });
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* alerta dentro do app continua disponível */ }
    }
  });

  function ringAlert(title, message) {
    stopAlertTone();
    $('#timeAlertTitle').textContent = title;
    $('#timeAlertMessage').textContent = message;
    $('#timeAlert').classList.remove('hidden');
    try {
      alertContext ||= new AudioContext();
      void alertContext.resume().then(() => {
        const beep = () => {
          if ($('#timeAlert').classList.contains('hidden')) { stopAlertTone(); return; }
          const oscillator = alertContext.createOscillator();
          const gain = alertContext.createGain();
          oscillator.type = 'sine'; oscillator.frequency.value = 880;
          gain.gain.setValueAtTime(0.0001, alertContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.14, alertContext.currentTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, alertContext.currentTime + 0.38);
          oscillator.connect(gain); gain.connect(alertContext.destination);
          oscillator.start(); oscillator.stop(alertContext.currentTime + 0.4);
        };
        beep(); alertToneTimer = setInterval(beep, 1000);
      }).catch(() => {});
    } catch { /* sem áudio: o aviso visual continua */ }
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body: message }); } catch { /* notificação opcional */ }
    }
    $('#timeAlertDismiss').focus();
  }

  function stopAlertTone() {
    if (alertToneTimer) clearInterval(alertToneTimer);
    alertToneTimer = null;
  }
  $('#timeAlertDismiss')?.addEventListener('click', () => { $('#timeAlert').classList.add('hidden'); stopAlertTone(); });

  function checkAlarms() {
    if (!alarms.length) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const triggered = alarms.filter(alarm => alarm.enabled && alarm.time === hhmm && alarm.lastTriggered !== today && (!alarm.weekdays?.length || alarm.weekdays.includes(now.getDay())));
    if (!triggered.length) return;
    triggered.forEach(alarm => { alarm.lastTriggered = today; if (!alarm.weekdays?.length) alarm.enabled = false; });
    write(STORAGE.alarms, alarms); renderAlarms();
    const first = triggered[0];
    ringAlert(first.label || 'Alarme', triggered.length === 1 ? `São ${hhmm}.` : `${triggered.length} alarmes estão tocando às ${hhmm}.`);
  }

  function formatDuration(ms, hundredths = false) {
    const safe = Math.max(0, ms);
    const totalSeconds = Math.floor(safe / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    const base = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return hundredths ? `${base}.${String(Math.floor(safe % 1000 / 10)).padStart(2, '0')}` : base;
  }

  function timerRemaining() {
    return timerState.running ? Math.max(0, Number(timerState.endAt) - Date.now()) : Math.max(0, Number(timerState.remainingMs) || 0);
  }
  function saveTimer() { write(STORAGE.timer, timerState); }
  function renderTimer() {
    const display = $('#timerDisplay');
    if (!display) return;
    const remaining = timerRemaining();
    display.textContent = formatDuration(remaining);
    $('#timerStart').classList.toggle('hidden', timerState.running);
    $('#timerPause').classList.toggle('hidden', !timerState.running);
    $('#timerStart').disabled = timerState.running;
    $('#timerPause').disabled = !timerState.running;
    $('#timerStart').textContent = timerState.paused && remaining > 0 ? 'Continuar' : 'Iniciar';
    ['timerHours', 'timerMinutes', 'timerSeconds'].forEach(id => { $(`#${id}`).disabled = timerState.running; });
    if (timerState.running && remaining <= 0) {
      timerState.running = false; timerState.remainingMs = 0; timerState.endAt = 0; timerState.paused = false; saveTimer();
      ringAlert('Temporizador concluído', 'O tempo definido chegou ao fim.');
      renderTimer();
    }
  }
  $('#timerStart')?.addEventListener('click', () => {
    const requested = timerState.paused && timerState.remainingMs > 0
      ? timerState.remainingMs
      : (Number($('#timerHours').value) * 3600 + Number($('#timerMinutes').value) * 60 + Number($('#timerSeconds').value)) * 1000;
    if (requested <= 0) { $('#timerDisplay').textContent = 'Defina um tempo'; return; }
    timerState = { remainingMs: requested, endAt: Date.now() + requested, running: true, paused: false }; saveTimer(); renderTimer();
  });
  $('#timerPause')?.addEventListener('click', () => { timerState.remainingMs = timerRemaining(); timerState.running = false; timerState.endAt = 0; timerState.paused = true; saveTimer(); renderTimer(); });
  $('#timerReset')?.addEventListener('click', () => { timerState = { remainingMs: 0, endAt: 0, running: false, paused: false }; saveTimer(); ['timerHours', 'timerMinutes', 'timerSeconds'].forEach(id => { $(`#${id}`).value = '0'; }); renderTimer(); });

  function currentStopwatchElapsed() { return Math.max(0, Number(stopwatch.elapsed) || 0) + (stopwatch.running ? Math.max(0, Date.now() - Number(stopwatch.startedAt)) : 0); }
  function renderStopwatch() {
    if (!$('#stopwatchDisplay')) return;
    const elapsed = currentStopwatchElapsed();
    $('#stopwatchDisplay').textContent = formatDuration(elapsed, true);
    $('#stopwatchStart').textContent = stopwatch.running ? 'Pausar' : (elapsed > 0 ? 'Continuar' : 'Iniciar');
    $('#stopwatchLap').classList.toggle('hidden', !stopwatch.running);
    $('#stopwatchLaps').innerHTML = stopwatch.laps.map((lap, index) => `<li><span>Volta ${stopwatch.laps.length - index}</span><strong>${formatDuration(lap, true)}</strong></li>`).join('');
  }
  function saveStopwatch() { write(STORAGE.stopwatch, stopwatch); }
  $('#stopwatchStart')?.addEventListener('click', () => {
    if (stopwatch.running) { stopwatch.elapsed = currentStopwatchElapsed(); stopwatch.running = false; stopwatch.startedAt = 0; }
    else { stopwatch.running = true; stopwatch.startedAt = Date.now(); }
    saveStopwatch(); renderStopwatch();
  });
  $('#stopwatchLap')?.addEventListener('click', () => {
    if (!stopwatch.running) return;
    const elapsed = currentStopwatchElapsed();
    const previousElapsed = Number(stopwatch.laps[0]) || 0;
    stopwatch.laps.unshift(elapsed - previousElapsed);
    stopwatch.laps = stopwatch.laps.slice(0, 100);
    saveStopwatch(); renderStopwatch();
  });
  $('#stopwatchReset')?.addEventListener('click', () => { stopwatch = { elapsed: 0, startedAt: 0, running: false, laps: [] }; saveStopwatch(); renderStopwatch(); });

  function setTimeTab(name, persist = true) {
    const valid = ['world', 'alarms', 'timer', 'stopwatch'].includes(name) ? name : 'world';
    activeTimeTab = valid;
    $$('[data-time-tab]').forEach(button => {
      const active = button.dataset.timeTab === valid;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    });
    $$('[data-time-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.timePanel !== valid));
    if (persist) write(STORAGE.tab, valid);
  }
  $$('[data-time-tab]').forEach(button => button.addEventListener('click', () => setTimeTab(button.dataset.timeTab)));
  $$('[data-time-tab]').forEach((button, index, buttons) => button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  }));

  function startWeatherUpdates() {
    if (weatherStarted) return;
    weatherStarted = true;
    void refreshWeather();
    weatherTimer = setInterval(() => { if ($('#timeToolsView')?.classList.contains('active')) void refreshWeather(); }, 15 * 60 * 1000);
  }
  $$('[data-view="timeTools"], [data-open-tool="timeTools"]').forEach(button => button.addEventListener('click', startWeatherUpdates));

  renderClockCities();
  renderAlarms();
  renderTimer();
  renderStopwatch();
  setTimeTab(read(STORAGE.tab, 'world'), false);
  void restoreWorldSettings();
  setInterval(() => { updateClocks(); checkAlarms(); renderTimer(); }, 1000);
  setInterval(renderStopwatch, 50);
  window.addEventListener('focus', () => { updateClocks(); checkAlarms(); renderTimer(); renderStopwatch(); if ($('#timeToolsView')?.classList.contains('active')) void refreshWeather(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateClocks(); checkAlarms(); renderTimer(); renderStopwatch(); if ($('#timeToolsView')?.classList.contains('active')) void refreshWeather(); } });
})();
