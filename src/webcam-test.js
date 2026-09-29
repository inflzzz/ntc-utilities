(() => {
  if (typeof document === 'undefined') return;
  const $ = selector => document.querySelector(selector);
  const ui = {
    view: $('#webcamTestView'), video: $('#webcamPreview'), frame: $('#webcamPreviewFrame'), placeholder: $('#webcamPreviewPlaceholder'),
    device: $('#webcamDeviceSelect'), resolution: $('#webcamResolutionSelect'), fps: $('#webcamFpsSelect'), activate: $('#webcamActivate'),
    deactivate: $('#webcamDeactivate'), capture: $('#webcamCapture'), live: $('#webcamLiveIndicator'), permission: $('#webcamPermissionStatus'),
    actual: $('#webcamActualSettings'), capabilityRange: $('#webcamCapabilityRange'), captureMode: $('#webcamCaptureMode'),
    settingsStatus: $('#webcamSettingsStatus'), photo: $('#webcamPhotoPreview'), photoPlaceholder: $('#webcamPhotoPlaceholder'),
    photoDownload: $('#webcamPhotoDownload'), photoClear: $('#webcamPhotoClear'), photoStatus: $('#webcamPhotoStatus'),
    photoDimensions: $('#webcamPhotoDimensions')
  };
  if (!ui.view || !navigator.mediaDevices?.getUserMedia) return;

  let stream = null;
  let requestId = 0;
  let photoBlob = null;
  let photoUrl = '';
  let appliedResolution = '';
  let appliedFps = '';
  const resolutionPresets = [[320, 240], [640, 480], [800, 600], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]];
  const fpsPresets = [15, 24, 30, 60];

  function readSettings() { return stream?.getVideoTracks()[0]?.getSettings?.() || {}; }
  function readCapabilities() { return stream?.getVideoTracks()[0]?.getCapabilities?.() || {}; }
  function rangeIncludes(range, value) {
    if (!range || typeof range !== 'object') return true;
    return (range.min == null || value >= range.min) && (range.max == null || value <= range.max);
  }
  function rangeLabel(range, unit = '') {
    if (!range || (range.min == null && range.max == null)) return 'não informada';
    if (range.min != null && range.max != null && range.min === range.max) return `${range.min}${unit}`;
    return `${range.min ?? '—'}–${range.max ?? '—'}${unit}`;
  }
  function actualModeText() {
    const settings = readSettings();
    return settings.width && settings.height ? `${settings.width} × ${settings.height}${settings.frameRate ? ` · ${Number(settings.frameRate).toLocaleString('pt-BR')} FPS` : ''}` : 'Modo capturado indisponível';
  }
  function renderActualSettings() {
    const settings = readSettings();
    ui.actual.textContent = settings.width && settings.height ? `${settings.width} × ${settings.height}${settings.frameRate ? ` · ${Number(settings.frameRate).toLocaleString('pt-BR')} FPS` : ''}` : 'Resolução e FPS indisponíveis';
    ui.captureMode.textContent = actualModeText();
  }
  function renderCapabilities() {
    const caps = readCapabilities();
    const widths = caps.width;
    const heights = caps.height;
    const frames = caps.frameRate;
    ui.capabilityRange.textContent = `Largura ${rangeLabel(widths, ' px')} · altura ${rangeLabel(heights, ' px')} · FPS ${rangeLabel(frames)}`;

    const settings = readSettings();
    const resolutions = resolutionPresets.filter(([width, height]) => rangeIncludes(widths, width) && rangeIncludes(heights, height));
    if (settings.width && settings.height && !resolutions.some(([width, height]) => width === settings.width && height === settings.height)) resolutions.push([settings.width, settings.height]);
    resolutions.sort((a, b) => a[0] * a[1] - b[0] * b[1]);
    ui.resolution.replaceChildren(new Option('Automática (câmera)', ''));
    for (const [width, height] of resolutions) ui.resolution.add(new Option(`${width} × ${height}`, `${width}x${height}`));
    ui.resolution.disabled = !widths || !heights;
    if (settings.width && settings.height) {
      const current = `${settings.width}x${settings.height}`;
      ui.resolution.value = Array.from(ui.resolution.options).some(option => option.value === current) ? current : '';
    }
    appliedResolution = ui.resolution.value;

    const rates = fpsPresets.filter(value => rangeIncludes(frames, value));
    if (settings.frameRate && !rates.some(value => Math.abs(value - settings.frameRate) < 0.5)) rates.push(Math.round(settings.frameRate));
    rates.sort((a, b) => a - b);
    ui.fps.replaceChildren(new Option('Automático (câmera)', ''));
    for (const rate of rates) ui.fps.add(new Option(`${rate} FPS`, String(rate)));
    ui.fps.disabled = !frames;
    if (settings.frameRate) {
      const current = String(Math.round(settings.frameRate));
      ui.fps.value = Array.from(ui.fps.options).some(option => option.value === current) ? current : '';
    }
    appliedFps = ui.fps.value;
    ui.settingsStatus.textContent = widths && heights && frames
      ? 'Escolha uma preferência compatível com a faixa reportada. A câmera pode ajustar o modo; o resultado real aparece em “Modo capturado”.'
      : 'O dispositivo não informa todos os modos. A resolução e o FPS reais continuam visíveis acima da prévia.';
  }
  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      const selected = ui.device.value;
      ui.device.replaceChildren(new Option('Câmera padrão', ''));
      cameras.forEach((device, index) => ui.device.add(new Option(device.label || `Câmera ${index + 1}`, device.deviceId)));
      if (cameras.some(device => device.deviceId === selected)) ui.device.value = selected;
      ui.device.disabled = cameras.length === 0 && !stream;
      if (!cameras.length && !stream) ui.device.add(new Option('Nenhuma câmera encontrada', ''));
      return cameras;
    } catch {
      ui.device.disabled = !stream;
      return [];
    }
  }
  function clearPhoto() {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = '';
    photoBlob = null;
    ui.photo.removeAttribute('src');
    ui.photo.classList.add('hidden');
    ui.photoPlaceholder.classList.remove('hidden');
    ui.photoDownload.disabled = true;
    ui.photoClear.disabled = true;
    ui.photoDimensions.textContent = '';
    ui.photoStatus.textContent = 'A captura não é enviada nem salva automaticamente.';
  }
  function applyLiveStream(nextStream) {
    stream = nextStream;
    ui.video.srcObject = stream;
    ui.video.onloadedmetadata = () => {
      void ui.video.play().catch(() => {});
      ui.frame.classList.add('is-active');
      renderActualSettings();
      renderCapabilities();
    };
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      if (stream?.getVideoTracks()[0] !== track) return;
      void deactivate();
      ui.permission.textContent = 'A câmera foi desconectada ou interrompida.';
    }, { once: true });
    renderActualSettings();
    renderCapabilities();
  }
  async function deactivate({ invalidate = true } = {}) {
    if (invalidate) requestId++;
    const previous = stream;
    stream = null;
    previous?.getTracks().forEach(track => track.stop());
    ui.video.pause();
    ui.video.srcObject = null;
    ui.video.onloadedmetadata = null;
    ui.frame.classList.remove('is-active');
    ui.activate.disabled = false;
    ui.activate.textContent = 'Ativar câmera';
    ui.deactivate.disabled = true;
    ui.capture.disabled = true;
    ui.live.textContent = 'Desativada';
    ui.live.classList.remove('is-active');
    ui.actual.textContent = 'Resolução e FPS —';
    ui.capabilityRange.textContent = 'Ative a câmera para consultar os recursos.';
    ui.captureMode.textContent = '—';
    ui.resolution.replaceChildren(new Option('Automática', ''));
    ui.fps.replaceChildren(new Option('Automática', ''));
    ui.resolution.disabled = true;
    ui.fps.disabled = true;
    if (ui.view.classList.contains('active')) ui.permission.textContent = 'Câmera desativada. Nenhuma imagem foi enviada para um serviço.';
  }
  async function activate() {
    const currentRequest = ++requestId;
    ui.activate.disabled = true;
    ui.activate.textContent = 'Aguardando permissão…';
    ui.permission.textContent = 'Solicitando acesso à câmera…';
    try {
      if (stream) await deactivate({ invalidate: false });
      const deviceId = ui.device.value;
      const video = deviceId ? { deviceId: { exact: deviceId } } : true;
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      if (currentRequest !== requestId || !ui.view.classList.contains('active')) {
        nextStream.getTracks().forEach(track => track.stop());
        return;
      }
      applyLiveStream(nextStream);
      const actualDeviceId = nextStream.getVideoTracks()[0]?.getSettings?.().deviceId;
      await refreshDevices();
      if (actualDeviceId) ui.device.value = actualDeviceId;
      ui.device.disabled = false;
      ui.activate.disabled = true;
      ui.activate.textContent = 'Câmera ativa';
      ui.deactivate.disabled = false;
      ui.capture.disabled = false;
      ui.live.textContent = 'Ao vivo';
      ui.live.classList.add('is-active');
      ui.permission.textContent = 'Prévia ativa localmente. Desative a câmera ao terminar.';
    } catch (error) {
      if (currentRequest !== requestId) return;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      ui.video.srcObject = null;
      ui.frame.classList.remove('is-active');
      ui.activate.disabled = false;
      ui.activate.textContent = 'Tentar novamente';
      ui.deactivate.disabled = true;
      ui.capture.disabled = true;
      ui.live.textContent = 'Indisponível';
      ui.live.classList.remove('is-active');
      ui.permission.textContent = error?.name === 'NotAllowedError' ? 'Acesso à câmera negado. Verifique a permissão do aplicativo e tente novamente.' : error?.name === 'NotFoundError' ? 'Nenhuma webcam foi encontrada. Conecte uma câmera e tente novamente.' : `Não foi possível ativar a webcam: ${error?.message || 'erro desconhecido'}`;
      await refreshDevices();
    }
  }
  async function applyVideoPreferences() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const [width, height] = ui.resolution.value ? ui.resolution.value.split('x').map(Number) : [null, null];
    const frameRate = ui.fps.value ? Number(ui.fps.value) : null;
    const constraints = {};
    if (width && height) { constraints.width = { ideal: width }; constraints.height = { ideal: height }; }
    if (frameRate) constraints.frameRate = { ideal: frameRate };
    try {
      await track.applyConstraints(constraints);
      await new Promise(resolve => requestAnimationFrame(resolve));
      renderActualSettings();
      ui.settingsStatus.textContent = 'Preferência aplicada. Confira o modo efetivamente capturado acima da prévia.';
      appliedResolution = ui.resolution.value;
      appliedFps = ui.fps.value;
    } catch {
      ui.resolution.value = appliedResolution;
      ui.fps.value = appliedFps;
      ui.settingsStatus.textContent = 'A câmera não aceitou esse modo. O modo anterior continua ativo.';
      renderActualSettings();
    }
  }
  async function capturePhoto() {
    if (!stream || ui.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !ui.video.videoWidth || !ui.video.videoHeight) {
      ui.photoStatus.textContent = 'Aguarde a prévia da câmera ficar pronta para capturar.';
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = ui.video.videoWidth;
    canvas.height = ui.video.videoHeight;
    canvas.getContext('2d').drawImage(ui.video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      ui.photoStatus.textContent = 'Não foi possível criar a foto. Tente novamente.';
      return;
    }
    clearPhoto();
    photoBlob = blob;
    photoUrl = URL.createObjectURL(blob);
    ui.photo.src = photoUrl;
    ui.photo.classList.remove('hidden');
    ui.photoPlaceholder.classList.add('hidden');
    ui.photoDownload.disabled = false;
    ui.photoClear.disabled = false;
    ui.photoDimensions.textContent = `${canvas.width} × ${canvas.height}`;
    ui.photoStatus.textContent = `Foto capturada (${(blob.size / 1024).toFixed(0)} KB). Ela está somente nesta sessão.`;
  }
  function downloadPhoto() {
    if (!photoBlob || !photoUrl) return;
    const link = document.createElement('a');
    link.href = photoUrl;
    link.download = `NTC-webcam-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
    link.click();
    ui.photoStatus.textContent = 'Download da foto iniciado.';
  }
  async function open() { await refreshDevices(); }
  function close() { void deactivate(); }

  ui.activate.addEventListener('click', activate);
  ui.deactivate.addEventListener('click', () => void deactivate());
  ui.capture.addEventListener('click', () => void capturePhoto());
  ui.device.addEventListener('change', () => { if (stream) void activate(); });
  ui.resolution.addEventListener('change', () => void applyVideoPreferences());
  ui.fps.addEventListener('change', () => void applyVideoPreferences());
  ui.photoDownload.addEventListener('click', downloadPhoto);
  ui.photoClear.addEventListener('click', clearPhoto);
  navigator.mediaDevices.addEventListener?.('devicechange', () => { if (ui.view.classList.contains('active')) void refreshDevices(); });
  window.NTCWebcamTest = { open, close };
})();
