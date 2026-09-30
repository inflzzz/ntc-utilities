(() => {
  const view = document.getElementById('voiceModifierView');
  if (!view) return;
  const $ = id => document.getElementById(id);
  const model = window.NTCVoiceModel;
  const KEY = 'ntc-voice-modifier-v1';
  const paramNames = { semitones: 'Semitons', threshold: 'Limiar (dB)', attack: 'Ataque (ms)', release: 'Liberação (ms)', bass: 'Graves (dB)', mid: 'Médios (dB)', treble: 'Agudos (dB)', ratio: 'Proporção', makeup: 'Ganho (dB)', mix: 'Mistura (%)', decay: 'Duração (s)', time: 'Tempo (ms)', feedback: 'Realimentação (%)', drive: 'Intensidade (%)', rate: 'Velocidade (Hz)', depth: 'Profundidade (ms)', frequency: 'Frequência (Hz)', low: 'Corte grave (Hz)', high: 'Corte agudo (Hz)' };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  let state = model.normalizeState(saved);
  let mode = 'mic', audio = null, context = null, engine = null, stream = null, micSource = null, micDry = null;
  let fileBuffer = null, fileName = '', fileSourcePath = '', fileSource = null, fileDry = null, playing = false, playAt = 0, offset = 0;
  let modulePromise = null, preparing = null, lifecycle = 0, meterFrame = 0, lastMeter = 0, requestId = 0, rebuildTimer = 0, dialogMode = '';
  let compareOriginal = false, selectedFile = null, dragIndex = -1, fileRequest = 0;
  const meterBuffers = new WeakMap();
  const status = message => { $('vmMessage').textContent = message; };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { status('Não foi possível salvar as preferências neste dispositivo.'); } };
  const time = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  function updateLatencyNote() {
    if (!context) { $('vmLatency').textContent = 'Latência: —'; return; }
    const deviceMs = Math.round(((context.baseLatency || 0) + (context.outputLatency || 0)) * 1000);
    const extraMs = state.chain.filter(item => item.enabled).reduce((total, item) => total + (item.type === 'pitch' && item.params.semitones ? 50 : item.type === 'formant' && item.params.semitones ? 245 : 0), 0);
    $('vmLatency').textContent = `Latência estimada: ${deviceMs + extraMs} ms + dispositivo (efeitos medidos com sinal de teste a 48 kHz)`;
  }
  const cleanupMessage = error => {
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return 'Acesso ao microfone negado. Autorize o NTC nas configurações de privacidade do Windows.';
    if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return 'O microfone selecionado não está disponível. Escolha outro dispositivo.';
    if (error?.name === 'NotReadableError') return 'O microfone está ocupado ou não pôde ser iniciado.';
    return error?.message || 'Não foi possível processar o áudio.';
  };
  function selectMode(value) {
    if (value === mode) return;
    fileRequest++;
    stopMic(); stopPlayback();
    mode = value;
    $('vmMicTab').setAttribute('aria-selected', String(value === 'mic'));
    $('vmFileTab').setAttribute('aria-selected', String(value === 'file'));
    $('vmMicPanel').classList.toggle('hidden', value !== 'mic');
    $('vmFilePanel').classList.toggle('hidden', value !== 'file');
    if (engine) engine.setOutputGain(value === 'mic' ? 0 : compareOriginal ? 0 : 1);
  }
  async function loadEngine() {
    if (engine && context?.state !== 'closed') return;
    if (preparing) return preparing;
    const epoch = lifecycle;
    preparing = initializeEngine(epoch).finally(() => { preparing = null; });
    return preparing;
  }
  async function initializeEngine(epoch) {
    if (!modulePromise) modulePromise = import('./voice-engine.mjs').catch(error => { modulePromise = null; throw error; });
    audio = await modulePromise;
    if (epoch !== lifecycle) throw new Error('A ferramenta foi fechada durante a inicialização.');
    const createdContext = new AudioContext({ latencyHint: 'interactive' });
    context = createdContext;
    try {
      await audio.prepareVoiceContext(createdContext);
      if (epoch !== lifecycle) throw new Error('A ferramenta foi fechada durante a inicialização.');
      if (state.outputDevice && createdContext.setSinkId) await createdContext.setSinkId(state.outputDevice);
      engine = new audio.VoiceEngine(createdContext);
      engine.setInputGain(state.inputGain);
      engine.setChain(state.chain);
      engine.setOutputGain(mode === 'mic' || compareOriginal ? 0 : 1);
      updateLatencyNote();
      drawMeter();
    } catch (error) {
      await createdContext.close().catch(() => {}); if (context === createdContext) context = null; engine = null;
      throw new Error(`Falha ao iniciar o processador de áudio: ${cleanupMessage(error)}`);
    }
  }
  function closeAudio() {
    lifecycle++;
    fileRequest++;
    clearTimeout(rebuildTimer); rebuildTimer = 0;
    if (meterFrame) cancelAnimationFrame(meterFrame); meterFrame = 0;
    stopPlayback(); stopMic();
    engine?.close(); engine = null;
    if (context) void context.close().catch(() => {});
    context = null;
    updateLatencyNote();
    fileBuffer = null; selectedFile = null; fileName = ''; fileSourcePath = '';
    $('vmFileMeta').textContent = 'Nenhum arquivo';
    $('vmTime').textContent = '00:00 / 00:00'; $('vmSeek').value = '0'; drawWaveform(null);
    $('vmPlay').disabled = $('vmCompare').disabled = $('vmSeek').disabled = $('vmExport').disabled = true;
  }
  function meter(analyser, element) {
    if (!analyser) { element.style.width = '0%'; return 0; }
    let samples = meterBuffers.get(analyser);
    if (!samples) { samples = new Float32Array(analyser.fftSize); meterBuffers.set(analyser, samples); }
    analyser.getFloatTimeDomainData(samples);
    let peak = 0, sum = 0;
    for (const sample of samples) { peak = Math.max(peak, Math.abs(sample)); sum += sample * sample; }
    const rms = Math.sqrt(sum / samples.length);
    element.style.width = `${Math.min(100, Math.round(rms * 180))}%`;
    return peak;
  }
  function drawMeter(now = 0) {
    if (!context || context.state === 'closed') return;
    if (now - lastMeter > 85) {
      const inputPeak = meter(engine?.meterIn, $('vmInputMeter'));
      const outputPeak = meter(engine?.meterOut, $('vmOutputMeter'));
      const clipped = inputPeak > 0.98 || outputPeak > 0.98;
      $('vmClip').textContent = clipped ? 'Clipping detectado' : 'Sem clipping';
      $('vmClip').classList.toggle('is-clipping', clipped);
      if (playing && fileBuffer) {
        const position = Math.min(fileBuffer.duration, offset + context.currentTime - playAt);
        $('vmSeek').value = String(Math.round(position / fileBuffer.duration * 1000));
        $('vmTime').textContent = `${time(position)} / ${time(fileBuffer.duration)}`;
      }
      lastMeter = now;
    }
    meterFrame = requestAnimationFrame(drawMeter);
  }
  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const input = $('vmInputDevice'), output = $('vmOutputDevice');
      input.replaceChildren(new Option('Microfone padrão', ''));
      output.replaceChildren(new Option('Saída padrão', ''));
      for (const [kind, select, label] of [['audioinput', input, 'Microfone'], ['audiooutput', output, 'Saída']]) {
        devices.filter(device => device.kind === kind && device.deviceId).forEach((device, index) => select.add(new Option(device.label || `${label} ${index + 1}`, device.deviceId)));
      }
      if ([...input.options].some(option => option.value === state.inputDevice)) input.value = state.inputDevice;
      if ([...output.options].some(option => option.value === state.outputDevice)) output.value = state.outputDevice;
      output.disabled = typeof AudioContext.prototype.setSinkId !== 'function';
      output.title = output.disabled ? 'Seleção de saída indisponível nesta versão do Chromium.' : '';
    } catch (error) { status(cleanupMessage(error)); }
  }
  function updateMicRouting() {
    if (!engine) return;
    const active = !!stream && $('vmMonitor').checked;
    const processed = active && !$('vmMicBypass').checked;
    engine.setOutputGain(processed ? 1 : 0);
    if (micDry) {
      micDry.gain.cancelScheduledValues(context.currentTime);
      micDry.gain.setTargetAtTime(active && !processed ? 1 : 0, context.currentTime, 0.018);
    }
  }
  function stopMic() {
    requestId++;
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    try { micSource?.disconnect(); micDry?.disconnect(); } catch {}
    micSource = null; micDry = null;
    $('vmMicToggle').textContent = 'Iniciar microfone';
    $('vmMicStatus').textContent = 'Desativado';
    $('vmMonitor').checked = false;
    if (engine) engine.setOutputGain(0);
  }
  async function startMic() {
    if (stream) { stopMic(); status('Microfone desligado.'); return; }
    const token = ++requestId;
    $('vmMicToggle').disabled = true; $('vmMicStatus').textContent = 'Solicitando acesso…';
    let obtained = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('A captura de microfone não está disponível neste sistema.');
      obtained = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: state.inputDevice ? { exact: state.inputDevice } : undefined,
        echoCancellation: state.echoCancellation,
        noiseSuppression: state.noiseSuppression,
        autoGainControl: state.autoGainControl
      } });
      if (token !== requestId || mode !== 'mic') { obtained.getTracks().forEach(track => track.stop()); return; }
      await loadEngine(); await context.resume();
      if (token !== requestId || mode !== 'mic') { obtained.getTracks().forEach(track => track.stop()); return; }
      stream = obtained;
      micSource = context.createMediaStreamSource(stream);
      micDry = context.createGain(); micDry.gain.value = 0;
      micSource.connect(engine.input); micSource.connect(micDry).connect(context.destination);
      stream.getAudioTracks()[0].addEventListener('ended', () => { if (stream === obtained) { stopMic(); status('O microfone foi desconectado ou interrompido.'); } }, { once: true });
      $('vmMicToggle').textContent = 'Parar microfone'; $('vmMicStatus').textContent = 'Capturando';
      await refreshDevices(); updateMicRouting(); status('Microfone ativo. Ative o monitoramento para se ouvir pelos fones.');
    } catch (error) {
      obtained?.getTracks().forEach(track => track.stop());
      if (token === requestId) { $('vmMicStatus').textContent = 'Falha'; status(cleanupMessage(error)); }
    } finally { $('vmMicToggle').disabled = false; }
  }
  function stopPlayback() {
    if (playing && context) offset = Math.min(fileBuffer?.duration || 0, offset + context.currentTime - playAt);
    playing = false;
    const source = fileSource; fileSource = null;
    if (source) { source.onended = null; try { source.stop(); source.disconnect(); } catch {} }
    if (fileDry) { try { fileDry.disconnect(); } catch {} fileDry = null; }
    $('vmPlay').textContent = 'Reproduzir';
  }
  async function togglePlayback() {
    if (!fileBuffer) return;
    if (playing) { stopPlayback(); return; }
    try {
      await loadEngine(); await context.resume();
      if (offset >= fileBuffer.duration - 0.01) offset = 0;
      const source = context.createBufferSource(); source.buffer = fileBuffer;
      const dry = context.createGain(); dry.gain.value = compareOriginal ? 1 : 0;
      source.connect(engine.input); source.connect(dry).connect(context.destination);
      engine.setOutputGain(compareOriginal ? 0 : 1);
      fileSource = source; fileDry = dry; playAt = context.currentTime; playing = true;
      source.onended = () => { if (fileSource === source) { stopPlayback(); offset = 0; $('vmSeek').value = '0'; $('vmTime').textContent = `00:00 / ${time(fileBuffer.duration)}`; } };
      source.start(0, offset); $('vmPlay').textContent = 'Pausar';
    } catch (error) { stopPlayback(); status(cleanupMessage(error)); }
  }
  function drawWaveform(buffer) {
    const canvas = $('vmWaveform'), graphics = canvas.getContext('2d');
    graphics.clearRect(0, 0, canvas.width, canvas.height);
    if (!buffer) return;
    const samples = buffer.getChannelData(0), step = Math.max(1, Math.floor(samples.length / canvas.width));
    graphics.fillStyle = '#b98fc2';
    for (let x = 0; x < canvas.width; x++) {
      let max = 0;
      for (let i = x * step; i < Math.min(samples.length, (x + 1) * step); i += Math.max(1, Math.floor(step / 40))) max = Math.max(max, Math.abs(samples[i]));
      const h = Math.max(1, max * canvas.height * 0.82);
      graphics.fillRect(x, (canvas.height - h) / 2, 1, h);
    }
  }
  async function loadFile(file) {
    if (!file) return;
    const epoch = lifecycle;
    const request = ++fileRequest;
    if (file.size > 250_000_000) { status('Arquivo muito grande para processar de uma vez (limite 250 MB).'); return; }
    stopPlayback(); fileBuffer = null;
    $('vmFileMeta').textContent = 'Decodificando…';
    $('vmPlay').disabled = $('vmCompare').disabled = $('vmSeek').disabled = $('vmExport').disabled = true;
    try {
      await loadEngine();
      const bytes = await file.arrayBuffer();
      if (epoch !== lifecycle || request !== fileRequest || mode !== 'file') return;
      const decoded = await context.decodeAudioData(bytes);
      if (epoch !== lifecycle || request !== fileRequest || mode !== 'file') return;
      if (!decoded.duration || !Number.isFinite(decoded.duration)) throw new Error('Arquivo sem áudio válido.');
      selectedFile = file; fileBuffer = decoded; fileName = file.name.replace(/\.[^.]+$/, '') || 'voz-modificada';
      fileSourcePath = window.ntc?.pathForFile?.(file) || '';
      offset = 0; drawWaveform(decoded);
      $('vmFileMeta').textContent = `${file.name} · ${time(decoded.duration)} · ${decoded.sampleRate.toLocaleString('pt-BR')} Hz`;
      $('vmTime').textContent = `00:00 / ${time(decoded.duration)}`; $('vmSeek').value = '0';
      $('vmPlay').disabled = $('vmCompare').disabled = $('vmSeek').disabled = $('vmExport').disabled = false;
      status('Arquivo carregado localmente. Reproduza para comparar original e modificado.');
    } catch (error) { if (epoch === lifecycle && request === fileRequest) { $('vmFileMeta').textContent = 'Arquivo inválido ou formato não suportado'; drawWaveform(null); status(`Não foi possível abrir o áudio: ${cleanupMessage(error)}`); } }
  }
  async function exportFile() {
    if (!fileBuffer) return;
    const button = $('vmExport'); button.disabled = true; button.textContent = 'Processando…';
    try {
      const rendered = await audio.renderVoiceFile(fileBuffer, state.chain, status);
      const wav = audio.encodeWav(rendered);
      status('Escolha onde salvar o resultado.');
      const result = await window.ntc.voiceSaveAudio({ wav, format: $('vmFormat').value, name: `${fileName}-modificado`, sourcePath: fileSourcePath });
      status(result.canceled ? 'Exportação cancelada. O arquivo original não foi alterado.' : `Áudio exportado: ${result.file}`);
    } catch (error) { status(`Falha na exportação: ${cleanupMessage(error)}`); }
    finally { button.disabled = false; button.textContent = 'Exportar resultado'; }
  }
  function renderPresetOptions() {
    const select = $('vmPreset'); select.replaceChildren();
    const official = document.createElement('optgroup'); official.label = 'Oficiais';
    const custom = document.createElement('optgroup'); custom.label = 'Meus presets';
    for (const preset of model.presets) official.append(new Option(preset.name, preset.id));
    for (const preset of state.customPresets) custom.append(new Option(preset.name, preset.id));
    select.append(official, custom);
    if ([...select.options].some(option => option.value === state.selectedPreset)) select.value = state.selectedPreset;
    else select.value = 'natural';
    const mine = state.customPresets.some(preset => preset.id === select.value);
    $('vmPresetRename').disabled = $('vmPresetDelete').disabled = !mine;
  }
  function renderChain() {
    const container = $('vmChain'); container.replaceChildren();
    if (!state.chain.length) { const empty = document.createElement('p'); empty.className = 'vm-hint'; empty.textContent = 'Voz limpa. Adicione um efeito ou escolha um preset.'; container.append(empty); return; }
    state.chain.forEach((effect, index) => {
      const definition = model.EFFECTS[effect.type], card = document.createElement('div');
      card.className = `vm-effect${effect.enabled && definition ? '' : ' is-disabled'}`; card.draggable = true; card.dataset.index = String(index);
      const header = document.createElement('div'); header.className = 'vm-effect-header';
      const title = document.createElement('strong'); title.textContent = `${index + 1}. ${definition?.label || `Efeito indisponível (${effect.type})`}`;
      const actions = document.createElement('div'); actions.className = 'vm-actions';
      const handle = document.createElement('span'); handle.className = 'vm-effect-handle'; handle.title = 'Arraste para reordenar'; handle.textContent = '⠿';
      const toggle = document.createElement('label'); toggle.className = 'vm-inline';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = effect.enabled && !!definition;
      check.disabled = !definition;
      check.title = definition ? 'Ativar ou desativar este módulo' : 'Este módulo será preservado no preset, mas não é processado nesta versão.';
      check.addEventListener('change', () => { effect.enabled = check.checked; changed(); });
      toggle.append(check, ' Ativo');
      const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.title = 'Mover para cima'; up.disabled = index === 0;
      up.addEventListener('click', () => { state.chain = model.move(state.chain, index, index - 1); changed(); });
      const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓'; down.title = 'Mover para baixo'; down.disabled = index === state.chain.length - 1;
      down.addEventListener('click', () => { state.chain = model.move(state.chain, index, index + 1); changed(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover';
      remove.addEventListener('click', () => { state.chain.splice(index, 1); changed(); });
      actions.append(handle, toggle, up, down, remove); header.append(title, actions); card.append(header);
      const params = document.createElement('div'); params.className = 'vm-param-grid';
      for (const [key, [min, max]] of Object.entries(definition?.params || {})) {
        const label = document.createElement('label'), caption = document.createElement('span'), output = document.createElement('output'), slider = document.createElement('input');
        caption.textContent = paramNames[key] || key; output.textContent = String(effect.params[key]); caption.append(output);
        slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.step = Number.isInteger(min) && Number.isInteger(max) && key !== 'ratio' ? '1' : '0.1'; slider.value = String(effect.params[key]);
        slider.addEventListener('input', () => { effect.params[key] = Number(slider.value); output.textContent = slider.value; scheduleRebuild(); persist(); });
        label.append(caption, slider); params.append(label);
      }
      card.append(params);
      card.addEventListener('dragstart', event => { dragIndex = index; card.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
      card.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
      card.addEventListener('drop', event => { event.preventDefault(); if (dragIndex >= 0 && dragIndex !== index) { state.chain = model.move(state.chain, dragIndex, index); changed(); } dragIndex = -1; });
      container.append(card);
    });
  }
  function scheduleRebuild() {
    updateLatencyNote();
    if (!engine) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { try { engine?.setChain(state.chain); } catch (error) { status(`Falha ao aplicar efeitos: ${cleanupMessage(error)}`); } }, 85);
  }
  function changed() { state.chain = model.normalizeChain(state.chain); renderChain(); renderPresetOptions(); persist(); scheduleRebuild(); }
  function loadPreset(id) {
    const preset = [...model.presets, ...state.customPresets].find(item => item.id === id);
    if (!preset) return;
    state.chain = model.normalizeChain(model.copy(preset.chain)); state.selectedPreset = id;
    renderChain(); renderPresetOptions(); persist(); scheduleRebuild();
  }
  function openPresetDialog(action) {
    dialogMode = action;
    const current = state.customPresets.find(item => item.id === $('vmPreset').value) || model.presets.find(item => item.id === $('vmPreset').value);
    $('vmDialogTitle').textContent = action === 'rename' ? 'Renomear preset' : action === 'duplicate' ? 'Duplicar preset' : 'Salvar preset';
    $('vmDialogName').value = action === 'duplicate' ? `${current?.name || 'Voz'} — cópia` : action === 'rename' ? current?.name || '' : '';
    $('vmPresetDialog').showModal(); $('vmDialogName').focus();
  }
  function finishPresetDialog() {
    const name = $('vmDialogName').value.trim(); if (!name) return;
    const selected = state.customPresets.find(item => item.id === $('vmPreset').value) || model.presets.find(item => item.id === $('vmPreset').value);
    if (dialogMode === 'rename') { const mine = state.customPresets.find(item => item.id === selected?.id); if (mine) mine.name = name; }
    else {
      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const chain = dialogMode === 'duplicate' ? selected?.chain || [] : state.chain;
      state.customPresets.push({ id, name, version: model.VERSION, chain: model.normalizeChain(model.copy(chain)) });
      state.selectedPreset = id;
    }
    renderPresetOptions(); persist();
  }
  function bind() {
    $('vmMicTab').onclick = () => selectMode('mic'); $('vmFileTab').onclick = () => selectMode('file');
    $('vmMicToggle').onclick = startMic;
    $('vmMonitor').onchange = updateMicRouting; $('vmMicBypass').onchange = updateMicRouting;
    $('vmInputDevice').onchange = async event => { state.inputDevice = event.target.value; persist(); if (stream) { stopMic(); await startMic(); } };
    $('vmOutputDevice').onchange = async event => {
      state.outputDevice = event.target.value; persist();
      if (!context?.setSinkId) return;
      try { await context.setSinkId(state.outputDevice || ''); } catch (error) { status(`Não foi possível trocar a saída: ${cleanupMessage(error)}`); }
    };
    $('vmInputGain').value = String(Math.round(state.inputGain * 100)); $('vmInputGainValue').textContent = `${Math.round(state.inputGain * 100)}%`;
    $('vmInputGain').oninput = event => { state.inputGain = Number(event.target.value) / 100; $('vmInputGainValue').textContent = `${event.target.value}%`; engine?.setInputGain(state.inputGain); persist(); };
    for (const [id, key] of [['vmNoiseSuppression', 'noiseSuppression'], ['vmEchoCancellation', 'echoCancellation'], ['vmAutoGainControl', 'autoGainControl']]) {
      $(id).checked = state[key]; $(id).onchange = event => { state[key] = event.target.checked; persist(); if (stream) status('Para aplicar esta opção, pare e reinicie o microfone.'); };
    }
    $('vmChooseFile').onclick = () => $('vmFileInput').click();
    $('vmFileInput').onchange = event => { void loadFile(event.target.files?.[0]); event.target.value = ''; };
    const drop = $('vmFileDrop');
    drop.ondragover = event => { event.preventDefault(); drop.classList.add('is-dragging'); };
    drop.ondragleave = () => drop.classList.remove('is-dragging');
    drop.ondrop = event => { event.preventDefault(); drop.classList.remove('is-dragging'); void loadFile(event.dataTransfer?.files?.[0]); };
    drop.onkeydown = event => { if (event.key === 'Enter') $('vmFileInput').click(); };
    $('vmPlay').onclick = togglePlayback;
    $('vmSeek').oninput = event => { if (!fileBuffer) return; const wasPlaying = playing; stopPlayback(); offset = fileBuffer.duration * Number(event.target.value) / 1000; $('vmTime').textContent = `${time(offset)} / ${time(fileBuffer.duration)}`; if (wasPlaying) void togglePlayback(); };
    $('vmCompare').onclick = () => {
      compareOriginal = !compareOriginal;
      $('vmCompare').textContent = `Ouvindo: ${compareOriginal ? 'Original' : 'Modificado'}`;
      if (fileDry && context) { fileDry.gain.setTargetAtTime(compareOriginal ? 1 : 0, context.currentTime, 0.015); engine.setOutputGain(compareOriginal ? 0 : 1); }
    };
    $('vmExport').onclick = exportFile;
    $('vmReset').onclick = () => loadPreset('natural');
    $('vmPreset').onchange = event => loadPreset(event.target.value);
    $('vmPresetSave').onclick = () => {
      const mine = state.customPresets.find(item => item.id === state.selectedPreset);
      if (mine) { mine.chain = model.normalizeChain(model.copy(state.chain)); persist(); status(`Preset “${mine.name}” atualizado.`); }
      else openPresetDialog('save');
    };
    $('vmPresetDuplicate').onclick = () => openPresetDialog('duplicate');
    $('vmPresetRename').onclick = () => openPresetDialog('rename');
    $('vmPresetDelete').onclick = () => {
      const mine = state.customPresets.find(item => item.id === state.selectedPreset); if (!mine) return;
      if (!confirm(`Excluir o preset “${mine.name}”?`)) return;
      state.customPresets = state.customPresets.filter(item => item.id !== mine.id);
      state.selectedPreset = 'natural'; renderPresetOptions(); persist(); status('Preset excluído. A cadeia atual foi mantida.');
    };
    $('vmPresetDialog').addEventListener('close', () => { if ($('vmPresetDialog').returnValue === 'save') finishPresetDialog(); });
    const addSelect = $('vmAddType');
    for (const [type, definition] of Object.entries(model.EFFECTS)) addSelect.add(new Option(definition.label, type));
    $('vmAddEffect').onclick = () => { state.chain.push(model.effect(addSelect.value)); changed(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
      await refreshDevices();
      if (stream && state.inputDevice && ![...$('vmInputDevice').options].some(option => option.value === state.inputDevice)) { stopMic(); status('O microfone selecionado foi removido. Escolha outro dispositivo.'); }
    });
    window.addEventListener('pagehide', closeAudio);
  }
  renderPresetOptions(); renderChain(); bind();
  window.NTCVoiceModifier = { open() { void refreshDevices(); }, close: closeAudio };
})();
