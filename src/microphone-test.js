(() => {
  if (typeof document === 'undefined') return;
  const $ = selector => document.querySelector(selector);
  const ui = {
    view: $('#microphoneTestView'), device: $('#microphoneDeviceSelect'), activate: $('#microphoneActivate'), deactivate: $('#microphoneDeactivate'),
    record: $('#microphoneRecordToggle'), clear: $('#microphoneRecordingClear'), meter: $('#microphoneLevelMeter'), fill: $('#microphoneLevelFill'),
    level: $('#microphoneLevelText'), peak: $('#microphonePeakText'), live: $('#microphoneLiveIndicator'), permission: $('#microphonePermissionStatus'),
    channels: $('#microphoneChannels'), sampleRate: $('#microphoneSampleRate'), deviceName: $('#microphoneDeviceName'),
    playback: $('#microphonePlayback'), recordingStatus: $('#microphoneRecordingStatus'), recordTime: $('#microphoneRecordTime')
  };
  if (!ui.view || !navigator.mediaDevices?.getUserMedia) return;

  let stream = null;
  let audioContext = null;
  let analyser = null;
  let animationFrame = 0;
  let recorder = null;
  let chunks = [];
  let playbackUrl = '';
  let recordStartedAt = 0;
  let recordTimer = 0;
  let maxRecordTimer = 0;
  let requestId = 0;
  let discardOnStop = false;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function setMeter(percent, db) {
    const level = Math.round(clamp(percent, 0, 100));
    ui.fill.style.width = `${level}%`;
    ui.meter.setAttribute('aria-valuenow', String(level));
    ui.peak.textContent = Number.isFinite(db) ? `${Math.round(db)} dB` : '−∞ dB';
  }
  function clearPlayback() {
    ui.playback.pause();
    ui.playback.removeAttribute('src');
    ui.playback.load();
    ui.playback.classList.add('hidden');
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = '';
    ui.clear.disabled = true;
  }
  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const microphones = devices.filter(device => device.kind === 'audioinput');
      const previous = ui.device.value;
      ui.device.replaceChildren(new Option('Microfone padrão', ''));
      microphones.forEach((device, index) => ui.device.add(new Option(device.label || `Microfone ${index + 1}`, device.deviceId)));
      if (microphones.some(device => device.deviceId === previous)) ui.device.value = previous;
      ui.device.disabled = microphones.length === 0;
      if (!microphones.length) ui.device.add(new Option('Nenhum microfone encontrado', ''));
      return microphones;
    } catch {
      ui.device.disabled = true;
      return [];
    }
  }
  function stopLevelMonitor() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    analyser = null;
    if (audioContext) void audioContext.close().catch(() => {});
    audioContext = null;
    setMeter(0, NaN);
  }
  function drawLevel() {
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const percent = Number.isFinite(db) ? ((db + 60) / 60) * 100 : 0;
    setMeter(percent, db);
    ui.level.textContent = percent > 1 ? 'Sinal de áudio detectado' : 'Aguardando sinal de áudio';
    animationFrame = requestAnimationFrame(drawLevel);
  }
  function updateDeviceDetails(track) {
    const settings = track.getSettings?.() || {};
    const channelCount = settings.channelCount || track.getConstraints?.().channelCount;
    const sampleRate = settings.sampleRate || audioContext?.sampleRate;
    ui.channels.textContent = channelCount ? `${channelCount} ${channelCount === 1 ? 'canal' : 'canais'}` : 'Indisponível';
    ui.sampleRate.textContent = sampleRate ? `${sampleRate.toLocaleString('pt-BR')} Hz` : 'Indisponível';
    ui.deviceName.textContent = track.label || 'Microfone padrão';
    ui.deviceName.title = ui.deviceName.textContent;
  }
  function updateRecordingTime() {
    const seconds = Math.min(30, Math.floor((performance.now() - recordStartedAt) / 1000));
    ui.recordTime.textContent = `00:${String(seconds).padStart(2, '0')}`;
  }
  function finishRecording() {
    clearInterval(recordTimer); clearTimeout(maxRecordTimer);
    recordTimer = 0; maxRecordTimer = 0;
    const completedRecorder = recorder;
    recorder = null;
    ui.record.disabled = !stream;
    ui.record.textContent = 'Gravar novamente';
    ui.record.classList.remove('is-recording');
    updateRecordingTime();
    if (discardOnStop || !chunks.length) {
      chunks = [];
      discardOnStop = false;
      ui.recordingStatus.textContent = stream ? 'Gravação descartada.' : 'Ative o microfone para habilitar a gravação.';
      return;
    }
    const type = completedRecorder?.mimeType || chunks[0]?.type || 'audio/webm';
    const blob = new Blob(chunks, { type });
    chunks = [];
    clearPlayback();
    playbackUrl = URL.createObjectURL(blob);
    ui.playback.src = playbackUrl;
    ui.playback.classList.remove('hidden');
    ui.clear.disabled = false;
    ui.recordingStatus.textContent = `Gravação pronta (${(blob.size / 1024).toFixed(0)} KB). Reproduza para conferir.`;
  }
  function stopRecording(discard = false) {
    clearInterval(recordTimer); clearTimeout(maxRecordTimer);
    recordTimer = 0; maxRecordTimer = 0;
    if (recorder && recorder.state !== 'inactive') {
      discardOnStop = discard;
      recorder.stop();
      return;
    }
    if (discard) chunks = [];
  }
  async function deactivate({ discard = true, invalidate = true } = {}) {
    if (invalidate) requestId++;
    stopRecording(discard);
    const oldStream = stream;
    stream = null;
    stopLevelMonitor();
    oldStream?.getTracks().forEach(track => track.stop());
    ui.activate.disabled = false;
    ui.activate.textContent = 'Ativar microfone';
    ui.deactivate.disabled = true;
    ui.record.disabled = true;
    ui.live.textContent = 'Desativado';
    ui.live.classList.remove('is-active');
    ui.level.textContent = 'Nível aguardando ativação';
    ui.channels.textContent = '—';
    ui.sampleRate.textContent = '—';
    ui.deviceName.textContent = 'Nenhum';
    if (ui.view.classList.contains('active')) ui.permission.textContent = 'Microfone desativado. O áudio não foi enviado para nenhum serviço.';
  }
  async function activate() {
    const currentRequest = ++requestId;
    ui.activate.disabled = true;
    ui.activate.textContent = 'Aguardando permissão…';
    ui.permission.textContent = 'Solicitando acesso ao microfone…';
    try {
      if (stream) await deactivate({ discard: true, invalidate: false });
      const selectedDeviceId = ui.device.value;
      const constraints = selectedDeviceId ? { audio: { deviceId: { exact: selectedDeviceId } } } : { audio: true };
      const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (currentRequest !== requestId || !ui.view.classList.contains('active')) {
        nextStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream = nextStream;
      const track = stream.getAudioTracks()[0];
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass || !track) throw new Error('Captura de áudio indisponível neste sistema.');
      audioContext = new AudioContextClass();
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      updateDeviceDetails(track);
      await refreshDevices();
      ui.device.disabled = false;
      if (track.getSettings?.().deviceId) ui.device.value = track.getSettings().deviceId;
      ui.activate.disabled = true;
      ui.activate.textContent = 'Microfone ativo';
      ui.deactivate.disabled = false;
      ui.record.disabled = typeof MediaRecorder === 'undefined';
      ui.live.textContent = 'Ao vivo';
      ui.live.classList.add('is-active');
      ui.permission.textContent = typeof MediaRecorder === 'undefined' ? 'Nível ao vivo ativo. A gravação não é compatível com este sistema.' : 'Entrada ativa. A captura permanece local e pode ser interrompida a qualquer momento.';
      ui.recordingStatus.textContent = typeof MediaRecorder === 'undefined' ? 'Gravação de teste indisponível neste sistema.' : 'Gravação disponível.';
      drawLevel();
    } catch (error) {
      if (currentRequest !== requestId) return;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      stopLevelMonitor();
      ui.deactivate.disabled = true;
      ui.activate.disabled = false;
      ui.activate.textContent = 'Tentar novamente';
      ui.permission.textContent = error?.name === 'NotAllowedError' ? 'Acesso ao microfone negado. Verifique a permissão do aplicativo e tente novamente.' : error?.name === 'NotFoundError' ? 'Nenhum microfone foi encontrado. Conecte um dispositivo e tente novamente.' : `Não foi possível ativar o microfone: ${error?.message || 'erro desconhecido'}`;
      ui.live.textContent = 'Indisponível';
      ui.live.classList.remove('is-active');
      ui.record.disabled = true;
      await refreshDevices();
    }
  }
  function beginRecording() {
    if (!stream || recorder) return;
    if (typeof MediaRecorder === 'undefined') {
      ui.recordingStatus.textContent = 'Gravação de teste não compatível neste sistema.';
      return;
    }
    clearPlayback();
    chunks = [];
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported?.(type));
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => { ui.recordingStatus.textContent = 'Ocorreu um erro durante a gravação. Tente novamente.'; stopRecording(true); };
      recorder.onstop = finishRecording;
      recorder.start(200);
      recordStartedAt = performance.now();
      ui.record.disabled = false;
      ui.record.textContent = 'Parar gravação';
      ui.record.classList.add('is-recording');
      ui.recordingStatus.textContent = 'Gravando…';
      recordTimer = setInterval(updateRecordingTime, 250);
      maxRecordTimer = setTimeout(() => stopRecording(), 30000);
    } catch (error) {
      recorder = null;
      ui.recordingStatus.textContent = `Não foi possível iniciar a gravação: ${error?.message || 'erro desconhecido'}`;
    }
  }
  async function open() {
    await refreshDevices();
  }
  function close() {
    if (stream || recorder || audioContext) void deactivate({ discard: true });
  }

  ui.activate.addEventListener('click', activate);
  ui.deactivate.addEventListener('click', () => void deactivate({ discard: true }));
  ui.device.addEventListener('change', () => { if (stream) void activate(); });
  ui.record.addEventListener('click', () => recorder ? stopRecording() : beginRecording());
  ui.clear.addEventListener('click', () => { clearPlayback(); ui.recordTime.textContent = '00:00'; ui.recordingStatus.textContent = stream ? 'Gravação apagada.' : 'Ative o microfone para habilitar a gravação.'; });
  navigator.mediaDevices.addEventListener?.('devicechange', () => { if (ui.view.classList.contains('active')) void refreshDevices(); });
  window.NTCMicrophoneTest = { open, close };
})();
