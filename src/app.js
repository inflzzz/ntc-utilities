const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const splash = $('#splash'); const appShell = $('#appShell'); const loadingProgress = $('#loadingProgress'); const loadingTrack = $('.loading-line');
const previouslySeenAppVersion = localStorage.getItem('ntc-last-seen-changelog-version');
const hadExistingAppData = ['ntc-folder', 'ntc-history', 'ntc-download-queue', 'ntc-theme', 'ntc-screenshot-folder', 'ntc-qr-history', 'ntc-security-history'].some(key => localStorage.getItem(key) !== null);
const history = JSON.parse(localStorage.getItem('ntc-history') || '[]');
const qrHistory = (() => { try { return JSON.parse(localStorage.getItem('ntc-qr-history') || '[]').slice(0, 50); } catch { return []; } })();
const securityHistory = (() => { try { const entries = JSON.parse(localStorage.getItem('ntc-security-history') || '[]'); return Array.isArray(entries) ? entries.filter(item => item && typeof item === 'object' && typeof item.file === 'string').slice(0, 100) : []; } catch { return []; } })();
let folder = localStorage.getItem('ntc-folder') || '';
let queue = (() => { try { return JSON.parse(localStorage.getItem('ntc-download-queue') || '[]').map(item => ({ ...item, status: item.status === 'baixando' ? 'pausado' : item.status, percent: 0 })); } catch { return []; } })(); let current = null; let preview = null; let playlist = null; let previewTimer; const abortedDownloads = new Set(); const pausedDownloads = new Set();
let downloadedAudioToEdit = null; let editSuggestionTimer = null;
let videoQueue = []; let currentVideo = null; let imageQueue = []; let currentImage = null; let lastFailedImage = null;
let screenRecorder = { recorder: null, stream: null, id: null, startedAt: 0, timer: null, chunkChain: Promise.resolve(), withAudio: false };
let screenRecorderStarting = false;
let screenshotCaptureBusy = false;
let compressionQueue = []; let compressionRunning = false;
let qrQueue = []; let qrRunning = false; let qrPreparing = false; let qrCancelRequested = false; let qrSelectedId = null; let qrPreviewTimer = null; let qrPreviewRequestId = 0;
let rngState = null; let rngSelectedTier = 'basic'; let rngHistoryQuery = ''; let rngHistoryTier = 'recent'; let rngRequestRunning = false; let rngTimer = null; let rngUnlockQueue = []; let rngUnlockSeenEventKeys = new Set(); let rngUnlockActive = false; let rngUnlockClosing = false; let rngUnlockPhaseTimer = null; let rngUnlockParticleRun = null; let rngUnlockDismissTimer = null; let rngAchievementTimer = null; let rngAchievementNextTimer = null; let rngAchievementUnlocks = null; let rngAchievementNoticeQueue = []; let rngAchievementNoticeActive = false; let rngAchievementNoticeCurrentId = null; let rngDebugEnabled = false; let rngDebugPopulated = false; let rngDebugReturnAfterReveal = false;
let rngStateReceivedAt = 0; let rngActiveSection = 'history'; let activeAppVersion = null; let rngPatchNotesOpenPending = false;
let rngAccountXpFeedbackTimer = null;
let rngSystemUnlockAckPending = false;
let rngManualRollCycleActive = false; let rngManualRollCycleId = null; let rngManualRollPresentationDone = false; let rngManualRollCompleting = false;
let rngOnlineState = null;
let rngProfileCardBytes = null; let rngProfileCardUrl = ''; let rngProfileCardFormat = 'landscape'; let rngProfileCardBusy = false; let rngProfileCardRenderRequestId = 0;
let rngTitlePickerQuery = ''; let rngTitlePickerTier = 'all'; let rngTitlePickerBusy = false;
let rngRollExperience = null;

function renderRngRollExperience(state, reveal = false) {
  if (!rngRollExperience) rngRollExperience = window.NTCRollExperience.create({
    root: $('#rngRollExperience'),
    onResult: renderRngRollOutcome,
    onRevealReady: showNextRngUnlock,
    onCycleComplete: markManualRollPresentationComplete
  });
  rngRollExperience.update(state, {
    reveal,
    discoveryResult: reveal ? rngUnlockQueue[0]?.result : null,
    motion: document.documentElement.dataset.rngRollMotion || 'full',
    visible: $('#rngView').classList.contains('active') && !document.hidden
  });
}
function clearManualRollCycleState() {
  rngManualRollCycleActive = false;
  rngManualRollCycleId = null;
  rngManualRollPresentationDone = false;
  rngManualRollCompleting = false;
}
function markManualRollPresentationComplete() {
  if (!rngManualRollCycleActive) return;
  rngManualRollPresentationDone = true;
  void tryCompleteManualRollCycle();
}
async function tryCompleteManualRollCycle() {
  if (!rngManualRollCycleActive || !rngManualRollPresentationDone || rngManualRollCycleId === null || rngManualRollCompleting) return;
  if (rngUnlockActive || rngUnlockClosing || rngUnlockQueue.length) return;
  const cycleId = rngManualRollCycleId;
  rngManualRollCompleting = true;
  try {
    await window.ntc.completeManualRngRoll(cycleId);
    if (rngManualRollCycleId !== cycleId) return;
    clearManualRollCycleState();
    if (rngState) renderRngState(rngState);
  } catch (error) {
    rngManualRollCompleting = false;
    showToast(`Não foi possível liberar a rolagem manual: ${cleanError(error)}`);
  }
}

function renderRngRollOutcome(latest) {
  const resultCard = $('#rngLastResult');
  resultCard.classList.toggle('is-new', Boolean(latest?.isNew));
  resultCard.dataset.tier = latest?.title?.tier || '';
  $('.rng-result-icon').innerHTML = latest?.title?.tier
    ? rngTitleIcon(latest.title, { size: 42, animation: 'none' }) || '✧'
    : window.NTCRngIcons?.render('achievement-rolls', { size: 42, animation: 'none' }) || '✧';
  $('#rngResultCaption').textContent = latest
    ? BigInt(latest.fragmentReward || 0) > 0n
      ? `DUPLICATA · +${formatRngFragments(latest.fragmentReward)} FRAGMENTOS`
      : `${latest.isNew ? 'NOVA DESCOBERTA' : 'RESULTADO'} · ${latest.title.tierLabel || ''}`
    : 'O SELO AGUARDA';
  $('#rngResultTitle').textContent = latest?.title?.name || 'Encontre o improvável';
  $('#rngResultOdds').innerHTML = latest
    ? `<span class="rng-result-oddsline"><strong>${formatRngOdds(latest.currentOdds)}</strong></span>`
    : 'Cada rolagem deixa uma marca.';
}

let splashValue = 0;
const advanceSplash = () => { splashValue = Math.min(92, splashValue + (splashValue < 70 ? 4 : 1.5)); loadingProgress.style.width = `${splashValue}%`; loadingTrack.setAttribute('aria-valuenow', String(Math.round(splashValue))); };
const splashTimer = setInterval(advanceSplash, 110);
setTimeout(() => { clearInterval(splashTimer); splashValue = 100; loadingProgress.style.width = '100%'; loadingTrack.setAttribute('aria-valuenow', '100'); setTimeout(() => { splash.classList.add('exit'); appShell.classList.add('ready'); appShell.setAttribute('aria-hidden', 'false'); void window.ntc.appEntered().catch(() => {}); }, 260); }, 2100);
function formatBytes(bytes) { if (!bytes) return '—'; const units = ['B', 'KB', 'MB', 'GB']; let n = bytes; let i = 0; while (n > 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; }
function safeText(value) { return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function rngTitleIcon(title, options = {}) {
  const tier = title?.tierId || title?.tier || 'basic';
  const asset = title?.assetId && (title.collected !== false || options.allowUncollected) ? title.assetId : '';
  const candidate = asset && window.NTCRngIcons?.definition(asset) ? asset : `tier-${tier}`;
  const iconId = window.NTCRngIcons?.definition(candidate) ? candidate : 'tier-basic';
  return window.NTCRngIcons?.render(iconId, options) || '';
}
function formatRngOdds(value) {
  const odds = String(value ?? '');
  const match = odds.match(/^(.* × 10)([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)$/);
  if (!match) return safeText(odds);
  const exponent = [...match[2]].map(digit => ({ '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '−' })[digit] || digit).join('');
  return `${safeText(match[1])}<sup>${safeText(exponent)}</sup>`;
}
function cleanError(value) { const message = String(value?.message || value || 'Não foi possível concluir a operação.').replace(/^Error invoking remote method ['"]?[^'"]+['"]?: Error:\s*/i, '').replace(/^Error:\s*/i, ''); if (/no space|espaço|disk full/i.test(message)) return 'Sem espaço suficiente na pasta escolhida. Escolha outra pasta ou libere espaço.'; if (/network|connection|timed out|conex/i.test(message)) return 'Falha de conexão. Verifique a internet e tente novamente.'; if (/permission|access is denied|acesso negado|notallowed|denied/i.test(message)) return 'A permissão foi recusada. Verifique o microfone ou escolha gravar somente a tela.'; if (/too large|maximum dimension|jpeg format/i.test(message)) return 'A imagem ficou grande demais para este formato. Diminua largura, altura ou escala e tente novamente.'; if (/invalid|corrupt|corromp/i.test(message)) return 'O arquivo não pôde ser lido. Verifique se ele está completo e em um formato suportado.'; return message; }
let toastTimer = null; let confirmResolver = null;
function showToast(message) { const toast = $('#toast'); const readable = String(message ?? ''); toast.textContent = readable; toast.classList.add('show'); clearTimeout(toastTimer); const unchangedView = $('#rngView').classList.contains('active') || $('#videoEditorView').classList.contains('active'); const duration = unchangedView ? 2800 : Math.min(6500, Math.max(3500, 2200 + readable.length * 45)); toastTimer = setTimeout(() => toast.classList.remove('show'), duration); }
function qrFailureMessage(error) { const message = String(error?.message || error || 'Não foi possível gerar o QR Code.'); if (/ENOSPC|no space|disk full/i.test(message)) return 'Sem espaço livre para salvar. Libere espaço ou escolha outra pasta.'; if (/EACCES|EPERM|access is denied|acesso negado/i.test(message)) return 'O app não tem permissão para salvar nessa pasta. Escolha outra pasta.'; if (/ENOENT|pasta de destino não existe/i.test(message)) return 'A pasta de destino não existe. Escolha outra pasta.'; if (/too long to fit|link é longo demais|amount of data/i.test(message)) return 'Este link é longo demais para caber em um QR Code. Use um link menor.'; return cleanError(message); }
function formatRecordingTime(milliseconds) { const seconds = Math.floor(Math.max(0, milliseconds) / 1000); const hours = String(Math.floor(seconds / 3600)).padStart(2, '0'); const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0'); return `${hours}:${minutes}:${String(seconds % 60).padStart(2, '0')}`; }
function formatRngDuration(seconds) { const total = Math.max(0, Math.floor(Number(seconds) || 0)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function formatRngPercent(basisPoints) { return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format((Number(basisPoints) || 0) / 100)}%`; }
function formatRngExactPercent(basisPoints) {
  try {
    const value = BigInt(basisPoints || 0);
    const whole = value / 100n;
    const decimal = String(value % 100n).padStart(2, '0').replace(/0+$/, '');
    return `${new Intl.NumberFormat('pt-BR').format(whole)}${decimal ? `,${decimal}` : ''}%`;
  } catch { return '0%'; }
}
const rngBrazilClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function trustedRngUtc() {
  if (!rngState?.timeVerification?.verified || !Number.isFinite(rngState.timeVerification.utcMs)) return null;
  return rngState.timeVerification.utcMs + Math.max(0, performance.now() - rngStateReceivedAt);
}
function getEqualHourClockStatus(utcMs) {
  if (!Number.isFinite(utcMs)) return null;
  for (let offset = 0; offset < 24 * 60; offset++) {
    const sample = utcMs + offset * 60_000;
    const parts = Object.fromEntries(rngBrazilClock.formatToParts(new Date(sample)).filter(part => ['hour', 'minute'].includes(part.type)).map(part => [part.type, Number(part.value)]));
    if (parts.hour === parts.minute) return { active: offset === 0, time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`, seconds: offset === 0 ? Math.ceil((60_000 - utcMs % 60_000) / 1000) : Math.ceil((offset * 60_000 - utcMs % 60_000) / 1000) };
  }
  return null;
}
function updateRngClockStatus() {
  const status = $('#rngClockStatus');
  if (!status) return;
  const clock = getEqualHourClockStatus(trustedRngUtc());
  status.dataset.active = String(Boolean(clock?.active));
  $('#rngClockTitle').textContent = !clock ? 'Horário aguardando verificação' : clock.active ? 'Horas iguais ativas' : 'Próximas horas iguais';
  $('#rngClockDetail').textContent = !clock ? 'Sem bônus de horário até validar o UTC online.' : clock.active
    ? `${clock.time} · chances raras ×2 em todas as rolagens · termina em ${formatRngDuration(clock.seconds)}`
    : `${clock.time} · chances raras ×2 começam em ${formatRngDuration(clock.seconds)}`;
}
function rngRollBoostLabels(result, includeCombined = true) {
  const labels = [];
  const sequenceMultiplier = result.isBonusRoll ? Math.max(1, Number(result.rollBonusMultiplier) || 1) : 1;
  const equalHourMultiplier = result.isEqualHourBonus ? 2 : 1;
  const thousandRollMultiplier = result.isThousandRollBonus ? Math.max(1, Number(result.thousandRollMultiplier) || 4) : 1;
  const tenThousandRollMultiplier = result.isTenThousandRollBonus ? Math.max(1, Number(result.tenThousandRollMultiplier) || 10) : 1;
  const requestedConsumableMultiplier = Number(result.consumableMultiplier || result.consumableBoostMultiplier || 1);
  const consumableMultiplier = [2, 4].includes(requestedConsumableMultiplier) ? requestedConsumableMultiplier : 1;
  if (result.isBonusRoll) labels.push(`Rolagem bônus ×${sequenceMultiplier}`);
  if (result.isEqualHourBonus) labels.push(`Horas iguais ×2${result.equalHourTime ? ` · ${safeText(result.equalHourTime)}` : ''}`);
  if (result.isThousandRollBonus) labels.push('Marco de 1.000 rolagens ×4');
  if (result.isTenThousandRollBonus) labels.push('Marco de 10.000 rolagens ×10');
  if (consumableMultiplier > 1) labels.push(`Tônicos acumulados ×${consumableMultiplier}`);
  if (result.eventMultiplier > 1) labels.push(`${safeText(result.eventName || 'Evento')} ×${result.eventMultiplier}`);
  const focusMultiplier = Math.max(1, Number(result.eventFocusMultiplier) || 1);
  if (result.eventFocusTierLabel) labels.push(`${safeText(result.eventName || 'Evento')} · ${safeText(result.eventFocusTierLabel)} em foco${focusMultiplier > 1 ? ` ×${focusMultiplier}` : ''}`);
  const combinedMultiplier = sequenceMultiplier * equalHourMultiplier * thousandRollMultiplier * tenThousandRollMultiplier * consumableMultiplier * (result.eventMultiplier || 1) * focusMultiplier;
  if (includeCombined && combinedMultiplier > 1 && labels.length > 1) labels.push(`Bônus acumulados ×${combinedMultiplier}`);
  return labels;
}
function showRngUnlock(result, { forceFullMotion = false } = {}) {
  if (!result?.title) return;
  enqueueRngUnlock({ result, forceFullMotion, eventKind: result.eventKind || 'title' });
  showNextRngUnlock();
}
function rngRevealQueueWeight(item) { return Math.max(1, Number(item.repeatCount) || 1); }
function updateRngRevealQueueCount() {
  const count = rngUnlockQueue.reduce((sum, item) => sum + rngRevealQueueWeight(item), 0);
  const badge = $('#rngUnlockQueueCount');
  if (!badge) return;
  badge.hidden = count === 0;
  badge.textContent = count === 1 ? '1 descoberta aguardando' : `${new Intl.NumberFormat('pt-BR').format(count)} descobertas aguardando`;
}
function enqueueRngUnlock(item) {
  window.NTCRngRevealQueue?.appendToQueue(rngUnlockQueue, item);
  updateRngRevealQueueCount();
}
function showRngUnlockBatch(candidates, { defer = false } = {}) {
  for (const candidate of candidates) {
    if (rngUnlockSeenEventKeys.has(candidate.eventKey)) continue;
    rngUnlockSeenEventKeys.add(candidate.eventKey);
    if (rngUnlockSeenEventKeys.size > 512) rngUnlockSeenEventKeys.delete(rngUnlockSeenEventKeys.values().next().value);
    enqueueRngUnlock({ result: { ...candidate.result, specialUnlock: candidate.specialUnlock }, eventKind: candidate.eventKind, eventKey: candidate.eventKey, forceFullMotion: false });
  }
  if (!defer) showNextRngUnlock();
}
function rngCatalogOddsForTitle(titleId) {
  return rngState?.catalog?.find(title => title.id === titleId)?.baseOdds || '';
}
const rngRevealBands = Object.freeze({ basic: 1, epic: 2, unique: 3, legendary: 3, mythic: 4, exalted: 4, glorious: 4, transcendent: 5, dimensional: 5, ntc: 5 });
const rngRevealSettleMs = Object.freeze({ 1: 900, 2: 1650, 3: 2350, 4: 4150, 5: 6000 });
// The phase marks the reveal's settling point; the object and atmospheric paths continue across it.
const rngEventSettleMs = Object.freeze({ abyssal: 4450, unnamable: 5250, beyond: 6050 });
const rngRevealParticleProfiles = Object.freeze({
  basic: { counts: [1, 1, 0], behavior: 'drift', opacity: .42 },
  epic: { counts: [1, 1, 1], behavior: 'drift', opacity: .48 },
  unique: { counts: [2, 1, 1], behavior: 'drift', opacity: .54 },
  legendary: { counts: [2, 2, 1], behavior: 'drift', opacity: .57 },
  mythic: { counts: [2, 3, 1], behavior: 'drift', opacity: .64 },
  abyssal: { counts: [2, 3, 2], behavior: 'absorb', opacity: .7 },
  unnamable: { counts: [2, 3, 2], behavior: 'unresolved', opacity: .7 },
  beyond: { counts: [2, 3, 2], behavior: 'anomaly', opacity: .72 },
  reward: { counts: [1, 1, 0], behavior: 'drift', opacity: .42 }
});
const rngRevealParticleTierProfile = Object.freeze({ exalted: 'mythic', glorious: 'mythic', transcendent: 'abyssal', dimensional: 'unnamable', ntc: 'beyond' });
function rngRevealRandom(min, max) { return min + Math.random() * (max - min); }
function cancelRngRevealParticles() {
  const run = rngUnlockParticleRun;
  if (!run) return;
  run.stopped = true;
  for (const timer of run.timers) clearTimeout(timer);
  for (const animation of run.animations) {
    animation.onfinish = null;
    animation.oncancel = null;
    animation.cancel();
  }
  // Keep the fixed particle pool: the next queued reveal reuses these nodes.
  for (const layer of run.layers) for (const particle of layer.querySelectorAll('i')) {
    particle.hidden = true;
    particle.removeAttribute('style');
  }
  rngUnlockParticleRun = null;
}
function rngRevealParticlePath(behavior, left, top, distance, width, height) {
  const randomOffset = limit => rngRevealRandom(-limit, limit);
  let dx = randomOffset(distance);
  let dy = randomOffset(distance);
  if (behavior === 'absorb' || behavior === 'anomaly') {
    const targetX = 50 + randomOffset(behavior === 'anomaly' ? 6 : 11);
    const targetY = 49 + randomOffset(behavior === 'anomaly' ? 7 : 12);
    const fraction = behavior === 'anomaly' ? rngRevealRandom(.3, 1) : rngRevealRandom(.34, .8);
    dx = ((targetX - left) / 100) * width * fraction;
    dy = ((targetY - top) / 100) * height * fraction;
  }
  const curveX = randomOffset(behavior === 'unresolved' ? distance * .72 : distance * .34);
  const curveY = randomOffset(behavior === 'unresolved' ? distance * .72 : distance * .34);
  const point = (x, y, scale, curve = 0) => ({ x: x * scale + curveX * curve, y: y * scale + curveY * curve });
  const midA = point(dx, dy, .27, behavior === 'unresolved' ? 1 : .55);
  const midB = point(dx, dy, .68, behavior === 'unresolved' ? -.48 : -.14);
  const midC = point(dx, dy, .88, behavior === 'unresolved' ? .22 : .08);
  return [
    { offset: 0, dx: 0, dy: 0 },
    { offset: .27, dx: midA.x, dy: midA.y },
    { offset: .68, dx: midB.x, dy: midB.y },
    { offset: .88, dx: midC.x, dy: midC.y },
    { offset: 1, dx, dy }
  ];
}
function startRngRevealParticles(notice, tier, identity, enabled) {
  cancelRngRevealParticles();
  if (!enabled) return;
  const layers = ['back', 'mid', 'front'].map(plane => notice.querySelector(`.rng-reveal-particles-${plane}`)).filter(Boolean);
  if (layers.length !== 3) return;
  const profileId = identity === 'reward' ? 'reward' : rngRevealParticleProfiles[identity] ? identity : rngRevealParticleTierProfile[tier] || tier;
  const profile = rngRevealParticleProfiles[profileId] || rngRevealParticleProfiles.basic;
  const run = { layers, timers: new Set(), animations: new Set(), stopped: false };
  rngUnlockParticleRun = run;
  const planeProfile = [
    { size: [1.7, 2.7], opacity: .72, duration: [7800, 12500], gap: [750, 2300], distance: [12, 28], blur: .24 },
    { size: [2.1, 3.3], opacity: .92, duration: [5800, 9800], gap: [600, 1900], distance: [20, 42], blur: .05 },
    { size: [2.5, 3.9], opacity: 1, duration: [4300, 7600], gap: [1400, 3400], distance: [30, 58], blur: 0 }
  ];
  const schedule = (particle, planeIndex, delay) => {
    const timer = setTimeout(() => {
      run.timers.delete(timer);
      if (run.stopped) return;
      const plane = planeProfile[planeIndex];
      const left = rngRevealRandom(12, 88);
      const top = rngRevealRandom(14, 86);
      const distance = rngRevealRandom(...plane.distance);
      const bounds = layers[planeIndex].getBoundingClientRect();
      const path = rngRevealParticlePath(profile.behavior, left, top, distance, bounds.width, bounds.height);
      const size = rngRevealRandom(...plane.size);
      const peak = Math.min(.72, profile.opacity * plane.opacity * rngRevealRandom(.84, 1));
      const scaleEnd = rngRevealRandom(.82, 1.08);
      particle.style.left = `${left}%`;
      particle.style.top = `${top}%`;
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      particle.style.filter = plane.blur ? `blur(${rngRevealRandom(0, plane.blur).toFixed(2)}px)` : 'none';
      if (typeof particle.animate !== 'function') return;
      particle.hidden = false;
      const frame = (point, opacity, scale) => ({ offset: point.offset, opacity, transform: `translate(-50%, -50%) translate(${point.dx.toFixed(1)}px, ${point.dy.toFixed(1)}px) scale(${scale.toFixed(2)})` });
      const frames = [
        frame(path[0], 0, .62), frame(path[1], peak, rngRevealRandom(.82, 1.02)),
        frame(path[2], peak * rngRevealRandom(.68, .88), rngRevealRandom(.9, 1.12)),
        frame(path[3], peak * rngRevealRandom(.38, .58), rngRevealRandom(.84, 1.08)), frame(path[4], 0, scaleEnd)
      ];
      const animation = particle.animate(frames, { duration: rngRevealRandom(...plane.duration), easing: 'linear', fill: 'forwards' });
      run.animations.add(animation);
      animation.onfinish = () => {
        run.animations.delete(animation);
        animation.onfinish = null;
        animation.oncancel = null;
        particle.hidden = true;
        animation.cancel();
        if (!run.stopped) schedule(particle, planeIndex, rngRevealRandom(...plane.gap));
      };
    }, delay);
    run.timers.add(timer);
  };
  profile.counts.forEach((count, planeIndex) => {
    const nodes = Array.from(layers[planeIndex].querySelectorAll('i')).slice(0, count);
    nodes.forEach((particle, index) => {
      particle.hidden = true;
      schedule(particle, planeIndex, index === 0 && planeIndex === 0 ? 90 : rngRevealRandom(180, 850));
    });
  });
}
function cancelRngRevealMotion(notice = $('#rngUnlockNotice')) {
  if (rngUnlockPhaseTimer !== null) clearTimeout(rngUnlockPhaseTimer);
  rngUnlockPhaseTimer = null;
  cancelRngRevealParticles();
  window.NTCRngIcons?.cancel(notice.querySelector('.rng-reveal-art-host .ntc-rng-icon'));
}
function showNextRngUnlock() {
  if (rngUnlockActive || rngUnlockClosing || !rngUnlockQueue.length) return;
  rngRollExperience?.setOccluded(true);
  cancelRngRevealMotion();
  const { result, forceFullMotion, eventKind, repeatCount = 1, fragmentTotal, lastRoll } = rngUnlockQueue.shift();
  const notice = $('#rngUnlockNotice');
  if (!notice.open) {
    notice.showModal();
    notice.setAttribute('aria-hidden', 'false');
  }
  rngUnlockActive = true;
  updateRngRevealQueueCount();
  notice.classList.toggle('debug-force-motion', forceFullMotion);
  const requestedTier = result.title.tier || 'basic';
  const tier = window.NTCRngIcons?.definition(`tier-${requestedTier}`) ? requestedTier : 'basic';
  const revealBand = eventKind === 'special' ? 1 : rngRevealBands[tier] || 1;
  const revealMode = revealBand <= 2 ? 'result' : revealBand === 3 ? 'discovery' : revealBand === 4 ? 'scene' : 'event';
  const revealIdentity = eventKind === 'special' ? 'reward' : ({ mythic: 'mythic', exalted: 'exalted', glorious: 'glorious', transcendent: 'abyssal', dimensional: 'unnamable', ntc: 'beyond' }[tier] || 'title');
  notice.dataset.tier = tier;
  notice.dataset.eventKind = eventKind || 'title';
  notice.dataset.revealMode = revealMode;
  notice.dataset.revealIdentity = revealIdentity;
  notice.dataset.revealBand = String(revealBand);
  notice.dataset.revealPhase = 'reveal';
  $('#rngUnlockTier').textContent = eventKind === 'special' ? `${result.title.tierLabel || 'Recompensa'} · REGISTRADA` : result.title.tierLabel || 'Título';
  $('#rngUnlockTitle').textContent = result.title.name || 'Título novo';
  $('#rngUnlockCaption').textContent = repeatCount > 1
    ? `${new Intl.NumberFormat('pt-BR').format(repeatCount)} recompensas repetidas reunidas · rolagens #${new Intl.NumberFormat('pt-BR').format(result.roll)}–#${new Intl.NumberFormat('pt-BR').format(lastRoll || result.roll)}.`
    : eventKind === 'special'
      ? (result.specialUnlock?.duplicate && BigInt(result.specialUnlock?.fragmentReward || 0) > 0n ? 'Recompensa convertida em Fragmentos.' : result.specialUnlock?.duplicate ? 'Recompensa repetida registrada.' : 'Uma recompensa especial foi registrada.')
      : result.simulation
    ? 'Prévia visual · a rolagem real não foi alterada.'
    : 'Um novo título agora faz parte da sua coleção.';
  const specialFragmentTotal = BigInt(fragmentTotal || result.specialUnlock?.fragmentReward || 0);
  const titleOdds = eventKind === 'special'
    ? specialFragmentTotal > 0n
      ? repeatCount > 1 ? `+${formatRngFragments(specialFragmentTotal)} Fragmentos no total` : `+${formatRngFragments(specialFragmentTotal)} Fragmentos`
      : result.specialUnlock?.duplicate && repeatCount > 1 ? `${new Intl.NumberFormat('pt-BR').format(repeatCount)} recompensas repetidas`
        : result.specialUnlock?.duplicate ? 'Recompensa repetida'
          : result.title.tierLabel || 'Recompensa especial'
    : rngCatalogOddsForTitle(result.title.id) || result.baseOdds || '';
  $('#rngUnlockDetails').textContent = titleOdds;
  $('#rngUnlockDetails').hidden = !titleOdds;
  $('#rngUnlockFootnoteText').textContent = result.simulation ? 'Prévia do desbloqueio' : eventKind === 'special' ? 'Recompensa registrada' : 'Conquista registrada';
  const crystal = notice.querySelector('.rng-reveal-crystal-frame');
  const artHost = crystal.querySelector('.rng-reveal-art-host');
  const iconId = eventKind === 'special'
    ? result.specialUnlock?.relicId ? `relic-${result.specialUnlock.relicId}` : result.specialUnlock?.tierLabel === 'Segredo' ? 'achievement-secrets' : `tier-${tier}`
    : (result.title.assetId && window.NTCRngIcons?.definition(result.title.assetId) ? result.title.assetId : `tier-${tier}`);
  const iconDefinition = window.NTCRngIcons?.definition(iconId);
  const resolvedIconId = iconDefinition ? iconId : `tier-${tier}`;
  artHost.innerHTML = window.NTCRngIcons?.render(resolvedIconId, { size: 220, className: 'rng-reveal-art', animation: 'none', eager: true }) || '';
  const artDefinition = window.NTCRngIcons?.definition(resolvedIconId);
  const sheen = crystal.querySelector('.rng-reveal-icon-shimmer');
  if (artDefinition?.src) {
    sheen.style.setProperty('--rng-reveal-mask', `url("${artDefinition.src}")`);
    sheen.style.setProperty('--rng-reveal-offset-x', `${artDefinition.opticalOffset?.[0] || 0}%`);
    sheen.style.setProperty('--rng-reveal-offset-y', `${artDefinition.opticalOffset?.[1] || 0}%`);
  }
  else sheen.style.removeProperty('--rng-reveal-mask');
  const motion = document.documentElement.dataset.rngRevealMotion || 'full';
  notice.classList.remove('show');
  void notice.offsetWidth;
  notice.classList.add('show');
  startRngRevealParticles(notice, tier, revealIdentity, motion === 'full' || forceFullMotion);
  // Reveal motion belongs to CSS wrappers. Do not run WAAPI transforms on
  // the icon at the same time as a scene-level entrance or an idle effect.
  if (motion === 'full' || forceFullMotion) {
    rngUnlockPhaseTimer = setTimeout(() => {
      if (rngUnlockActive && notice.open && notice.dataset.revealPhase === 'reveal') notice.dataset.revealPhase = 'idle';
      rngUnlockPhaseTimer = null;
    }, rngEventSettleMs[revealIdentity] || rngRevealSettleMs[revealBand]);
  } else {
    notice.dataset.revealPhase = 'static';
  }
  $('#rngUnlockContinue').focus({ preventScroll: true });
}
function dismissRngUnlock() {
  if (!rngUnlockActive || rngUnlockClosing) return;
  const notice = $('#rngUnlockNotice');
  rngUnlockActive = false;
  rngUnlockClosing = true;
  cancelRngRevealMotion(notice);
  if (rngUnlockDismissTimer !== null) clearTimeout(rngUnlockDismissTimer);
  notice.classList.remove('show');
  rngUnlockDismissTimer = setTimeout(() => {
    rngUnlockDismissTimer = null;
    rngUnlockClosing = false;
    if (rngUnlockQueue.length) {
      showNextRngUnlock();
      return;
    }
    notice.close();
    notice.classList.remove('debug-force-motion');
    delete notice.dataset.revealBand;
    delete notice.dataset.revealPhase;
    delete notice.dataset.revealMode;
    delete notice.dataset.revealIdentity;
    delete notice.dataset.eventKind;
    notice.setAttribute('aria-hidden', 'true');
    rngRollExperience?.setOccluded(false);
    restoreRngDebugAfterReveal();
    markManualRollPresentationComplete();
  }, 300);
}
function showNextRngAchievementNotice() {
  if (rngAchievementNoticeActive || !rngAchievementNoticeQueue.length) return;
  const achievement = rngAchievementNoticeQueue.shift();
  const notice = $('#rngAchievementNotice');
  rngAchievementNoticeActive = true;
  rngAchievementNoticeCurrentId = achievement.id;
  const categoryIcon = rngAchievementIconId(achievement.category);
  const iconRarity = Number(achievement.luckBonusBps || 0) >= 5_000 ? 'legendary' : 'rare';
  notice.querySelector('.rng-unlock-icon').innerHTML = window.NTCRngIcons?.render(categoryIcon, { size: 30, animation: 'reveal', eager: true }) || '';
  $('#rngAchievementTitle').textContent = achievement.name;
  $('#rngAchievementDetails').textContent = `${achievement.description}${achievement.luckBonusBps ? ` · +${formatRngPercent(achievement.luckBonusBps)} de sorte permanente` : ''}`;
  notice.setAttribute('aria-hidden', 'false');
  notice.classList.add('show');
  const achievementIcon = notice.querySelector('.rng-unlock-icon .ntc-rng-icon');
  window.NTCRngIcons?.play(achievementIcon, iconRarity === 'legendary' ? 'legendary' : 'reveal');
  clearTimeout(rngAchievementTimer);
  rngAchievementTimer = setTimeout(() => {
    notice.classList.remove('show');
    notice.setAttribute('aria-hidden', 'true');
    rngAchievementNoticeActive = false;
    rngAchievementNoticeCurrentId = null;
    if (rngAchievementNoticeQueue.length) {
      clearTimeout(rngAchievementNextTimer);
      rngAchievementNextTimer = setTimeout(showNextRngAchievementNotice, 280);
    }
  }, 4200);
}
function queueRngAchievementNotices(achievements) {
  for (const achievement of achievements) {
    if (achievement.id !== rngAchievementNoticeCurrentId && !rngAchievementNoticeQueue.some(item => item.id === achievement.id)) rngAchievementNoticeQueue.push(achievement);
  }
  showNextRngAchievementNotice();
}
function shouldPlayRngTitleSound(result) {
  const soundTiers = ['unique', 'legendary', 'mythic', 'exalted', 'glorious', 'transcendent', 'dimensional', 'ntc'];
  return Boolean(result?.isNew === true && !result?.simulation && soundTiers.includes(result.title?.tier));
}
async function playRngTitleSound(result, { preview = false } = {}) {
  if (!preview && !shouldPlayRngTitleSound(result)) return false;
  const audio = $('#rngTitleUnlockSound');
  if (!audio) return false;
  audio.volume = 0.65;
  try { audio.pause(); audio.currentTime = 0; await audio.play(); return true; }
  catch (error) { console.warn('Não foi possível reproduzir o som de título do RNG:', error); return false; }
}
async function previewRngTitleSound() {
  if (!rngDebugEnabled) return;
  const played = await playRngTitleSound(null, { preview: true });
  $('#rngDebugStatus').textContent = played ? 'Prévia do som tocada.' : 'Não foi possível tocar o som de título.';
}
function updateRngDebugControls(state = rngState) {
  if (!rngDebugEnabled || !state?.catalog?.length) return;
  const select = $('#rngDebugTitleSelect');
  if (!rngDebugPopulated) {
    select.innerHTML = state.tiers.map(tier => `<optgroup label="${safeText(tier.label)}">${(state.debugCatalog || state.catalog).filter(title => title.tier === tier.id).map(title => `<option value="${safeText(title.id)}">${safeText(title.name)}</option>`).join('')}</optgroup>`).join('');
    select.value = state.catalog.at(-1)?.id || '';
    rngDebugPopulated = true;
  }
  const title = state.catalog.find(item => item.id === select.value);
  const collected = Boolean(title?.collected);
  $('#rngDebugSelectionState').textContent = title ? `${title.tierLabel} · ${collected ? 'Na coleção' : 'Ainda não coletado'} · Chance base ${title.baseOdds}` : '';
  $('#rngDebugAdd').disabled = !title || collected;
  $('#rngDebugRemove').disabled = !title || !collected;
  $('#rngDebugSimulate').disabled = !title;
  $('#rngDebugClearAll').disabled = state.collectedIds.length === 0;
  const previousTier = $('#rngDebugTierSelect').value;
  $('#rngDebugTierSelect').innerHTML = state.tiers.map(tier => `<option value="${safeText(tier.id)}">${safeText(tier.label)}</option>`).join('');
  if (state.tiers.some(tier => tier.id === previousTier)) $('#rngDebugTierSelect').value = previousTier;
  $('#rngDebugGrantTier').disabled = !state.tiers.some(tier => tier.id === $('#rngDebugTierSelect').value);
  const previousTotal = $('#rngDebugTotalMilestone').value;
  $('#rngDebugTotalMilestone').innerHTML = [50, 100, 175, 200].map(count => `<option value="${count}">${count} títulos encontrados</option>`).join('');
  if ([...$('#rngDebugTotalMilestone').options].some(option => option.value === previousTotal)) $('#rngDebugTotalMilestone').value = previousTotal;
  $('#rngDebugGrantTotalTitles').disabled = state.collectedIds.length >= Number($('#rngDebugTotalMilestone').value || 50);
}
let rngDebugIconsPopulated = false;
function renderRngDebugIconPreview() {
  const id = $('#rngDebugIconSelect').value || 'reveal-crystal';
  const animation = $('#rngDebugIconMotion').value || 'none';
  window.NTCRngIcons?.cancel($('#rngDebugIconPreview .ntc-rng-icon'));
  $('#rngDebugIconPreview').innerHTML = window.NTCRngIcons?.render(id, { size: 58, animation, eager: true }) || '';
  $('#rngDebugIconStatus').textContent = `${window.NTCRngIcons?.definition(id)?.label || id} · ${animation === 'none' ? 'estático' : animation}`;
}
function initializeRngIconDebug() {
  if (rngDebugIconsPopulated || !window.NTCRngIcons) return;
  const select = $('#rngDebugIconSelect');
  const entries = window.NTCRngIcons.list();
  const groups = [
    ['reveal-', 'Revelação'], ['tier-', 'Raridades'], ['achievement-', 'Conquistas'], ['event-', 'Eventos'],
    ['ui-', 'Coleção e histórico'], ['set-', 'Conjuntos'], ['shop-', 'Loja e consumíveis'], ['relic-', 'Relíquias']
  ];
  select.innerHTML = groups.map(([prefix, label]) => `<optgroup label="${label}">${entries.filter(item => item.id.startsWith(prefix)).map(item => `<option value="${safeText(item.id)}">${safeText(item.label)}</option>`).join('')}</optgroup>`).join('');
  select.value = 'reveal-crystal';
  rngDebugIconsPopulated = true;
  renderRngDebugIconPreview();
}
function playRngDebugIcon() {
  if (!rngDebugEnabled) return;
  const id = $('#rngDebugIconSelect').value;
  const effect = $('#rngDebugIconMotion').value;
  const element = $('#rngDebugIconPreview .ntc-rng-icon');
  if (effect === 'none') {
    window.NTCRngIcons?.cancel(element);
    $('#rngDebugIconStatus').textContent = 'Prévia estática · nenhum efeito reproduzido.';
    return;
  }
  const playback = window.NTCRngIcons?.play(element, effect, { force: true, loop: $('#rngDebugIconLoop').checked });
  $('#rngDebugIconStatus').textContent = playback
    ? `${window.NTCRngIcons.definition(id)?.label || id} · ${effect}${$('#rngDebugIconLoop').checked ? ' · repetindo até nova seleção' : ''}.`
    : 'Este efeito não pôde ser reproduzido neste ambiente.';
}
async function initializeRngDebug() {
  try {
    rngDebugEnabled = await window.ntc.isDevelopmentBuild();
    if (!rngDebugEnabled) return;
    $('#rngDebugTrigger').classList.remove('hidden');
    initializeRngIconDebug();
    updateRngDebugControls();
  } catch { rngDebugEnabled = false; }
}
function openRngDebug() {
  if (!rngDebugEnabled) return;
  const dialog = $('#rngDebugDialog');
  dialog.classList.remove('hidden'); dialog.setAttribute('aria-hidden', 'false');
  initializeRngIconDebug();
  updateRngDebugControls(); $('#rngDebugTitleSelect').focus();
}
function closeRngDebug() {
  const dialog = $('#rngDebugDialog');
  if (dialog.classList.contains('hidden')) return;
  closeRngAccountResetConfirmation();
  window.NTCRngIcons?.cancel($('#rngDebugIconPreview .ntc-rng-icon'));
  dialog.classList.add('hidden'); dialog.setAttribute('aria-hidden', 'true'); $('#rngDebugTrigger').focus();
}
function hideRngDebugForReveal() {
  const dialog = $('#rngDebugDialog');
  if (dialog.classList.contains('hidden')) return;
  rngDebugReturnAfterReveal = true;
  dialog.classList.add('hidden');
  dialog.setAttribute('aria-hidden', 'true');
}
function restoreRngDebugAfterReveal() {
  if (!rngDebugReturnAfterReveal) return;
  rngDebugReturnAfterReveal = false;
  openRngDebug();
}
function simulateRngUnlock() {
  const title = rngState?.catalog.find(item => item.id === $('#rngDebugTitleSelect').value);
  if (!rngDebugEnabled || !title) return;
  hideRngDebugForReveal();
  showRngUnlock({ title: { ...title, name: rngState.debugCatalog?.find(item => item.id === title.id)?.name || title.name }, baseOdds: title.baseOdds, simulation: true }, { forceFullMotion: true });
  const revealMode = document.documentElement.dataset.rngRevealMotion || 'full';
  $('#rngDebugStatus').textContent = `Prévia com movimento completo${revealMode === 'off' || revealMode === 'reduced' ? ` (independente da preferência ${revealMode === 'off' ? 'estática' : 'reduzida'})` : ''}; coleção e rolagens não foram alteradas.`;
}
async function debugAddSelectedRngTitle() {
  if (!rngDebugEnabled) return;
  const selected = rngState?.catalog?.find(title => title.id === $('#rngDebugTitleSelect').value);
  try {
    const result = await window.ntc.debugAddRngTitle($('#rngDebugTitleSelect').value);
    renderRngState(result.state);
    if (result.added) {
      hideRngDebugForReveal();
      showRngUnlock({ title: result.title, baseOdds: rngCatalogOddsForTitle(result.title.id) || selected?.baseOdds || '', simulation: true }, { forceFullMotion: true });
      $('#rngDebugStatus').textContent = `${result.title.name} adicionado ao perfil de desenvolvimento.`;
    } else $('#rngDebugStatus').textContent = 'Esse título já está na coleção.';
  } catch (error) { $('#rngDebugStatus').textContent = cleanError(error); }
}
async function debugRemoveSelectedRngTitle() {
  if (!rngDebugEnabled) return;
  const selected = rngState?.catalog.find(item => item.id === $('#rngDebugTitleSelect').value);
  try {
    const result = await window.ntc.debugRemoveRngTitle($('#rngDebugTitleSelect').value);
    renderRngState(result.state);
    $('#rngDebugStatus').textContent = result.removed ? `${rngState?.debugCatalog?.find(item => item.id === selected?.id)?.name || selected?.name || 'Título'} removido do perfil de desenvolvimento.` : 'Esse título não está na coleção.';
  } catch (error) { $('#rngDebugStatus').textContent = cleanError(error); }
}
async function debugClearRngCollection() {
  if (!rngDebugEnabled || !rngState?.collectedIds.length) return;
  const accepted = await confirmAction('Remover todos os títulos?', 'A coleção e as descobertas registradas serão limpas. Rolagens e tempos serão mantidos.', 'Remover todos');
  if (!accepted) return;
  try {
    const result = await window.ntc.debugClearRngTitles();
    renderRngState(result.state);
    $('#rngDebugStatus').textContent = `${result.removedCount} ${result.removedCount === 1 ? 'título removido' : 'títulos removidos'}; rolagens e tempos mantidos.`;
  } catch (error) { $('#rngDebugStatus').textContent = cleanError(error); }
}
function openRngAccountResetConfirmation() {
  if (!rngDebugEnabled) return;
  $('#rngDebugResetPhrase').value = '';
  $('#rngDebugResetConfirmButton').disabled = true;
  $('#rngDebugResetConfirm').classList.remove('hidden');
  $('#rngDebugStatus').textContent = '';
  $('#rngDebugResetPhrase').focus();
}
function closeRngAccountResetConfirmation() {
  $('#rngDebugResetConfirm').classList.add('hidden');
  $('#rngDebugResetPhrase').value = '';
  $('#rngDebugResetConfirmButton').disabled = true;
  $('#rngDebugResetStart').focus();
}
function clearRngAccountPresentation(state) {
  clearManualRollCycleState();
  for (const timer of [rngUnlockPhaseTimer, rngUnlockDismissTimer, rngAchievementTimer, rngAchievementNextTimer, rngAccountXpFeedbackTimer]) {
    if (timer !== null) clearTimeout(timer);
  }
  rngUnlockPhaseTimer = rngUnlockDismissTimer = rngAchievementTimer = rngAchievementNextTimer = rngAccountXpFeedbackTimer = null;
  rngUnlockQueue = [];
  rngUnlockSeenEventKeys.clear();
  rngUnlockActive = false; rngUnlockClosing = false; rngDebugReturnAfterReveal = false;
  rngAchievementNoticeQueue = []; rngAchievementNoticeActive = false; rngAchievementNoticeCurrentId = null; rngAchievementUnlocks = null;

  const reveal = $('#rngUnlockNotice');
  cancelRngRevealMotion(reveal);
  reveal.classList.remove('show', 'debug-force-motion');
  if (reveal.open) reveal.close();
  for (const key of ['tier', 'eventKind', 'revealMode', 'revealIdentity', 'revealBand', 'revealPhase']) delete reveal.dataset[key];
  reveal.setAttribute('aria-hidden', 'true');
  reveal.querySelector('.rng-reveal-art-host').replaceChildren();
  const achievement = $('#rngAchievementNotice');
  window.NTCRngIcons?.cancel(achievement.querySelector('.ntc-rng-icon'));
  achievement.classList.remove('show'); achievement.setAttribute('aria-hidden', 'true');
  achievement.querySelector('.rng-unlock-icon').replaceChildren();
  const systemUnlock = $('#rngSystemUnlockNotice');
  systemUnlock.classList.remove('is-visible');
  if (systemUnlock.open) systemUnlock.close();
  systemUnlock.hidden = true;
  delete systemUnlock.dataset.unlockId;
  rngSystemUnlockAckPending = false;

  rngRollExperience?.dispose(); rngRollExperience = null;
  $('#rngAccountXpFeedback').classList.remove('is-visible', 'is-auto-unlock', 'is-recycling-unlock');
  $('#rngAccountLevel').classList.remove('is-level-up');
  rngState = null;
  renderRngState(state);
}
async function debugResetRngAccount() {
  if (!rngDebugEnabled || $('#rngDebugResetPhrase').value.trim() !== 'RESETAR CONTA') return;
  const button = $('#rngDebugResetConfirmButton');
  const cancelButton = $('#rngDebugResetCancel');
  button.disabled = true;
  cancelButton.disabled = true;
  try {
    const result = await window.ntc.debugResetRngAccount();
    if (!result?.ok || !result.state) throw new Error(result?.message || 'O reset não foi concluído.');
    clearRngAccountPresentation(result.state);
    $('#rngDebugResetConfirm').classList.add('hidden');
    $('#rngDebugResetPhrase').value = '';
    updateRngDebugControls();
    $('#rngDebugStatus').textContent = result.online?.leaderboardRefreshed
      ? 'Conta local zerada; perfil Online e histórico de descobertas desta sessão removidos; Ranking Global atualizado. A autenticação foi preservada.'
      : 'Conta local zerada e perfil Online desta sessão removido. O ranking será atualizado na próxima sincronização; autenticação preservada.';
  } catch (error) {
    $('#rngDebugStatus').textContent = cleanError(error);
    button.disabled = $('#rngDebugResetPhrase').value.trim() !== 'RESETAR CONTA';
  } finally { cancelButton.disabled = false; }
}
async function debugRngAction(action) {
  if (!rngDebugEnabled) return;
  const status = $('#rngDebugStatus');
  try {
    if (action === 'bonus') {
      renderRngState(await window.ntc.debugReadyRngBonusRoll());
      status.textContent = 'A próxima rolagem será uma rolagem bônus.';
    } else if (action === 'tier') {
      const tierId = $('#rngDebugTierSelect').value;
      const count = Number($('#rngDebugMilestone').value || 5);
      const result = await window.ntc.debugGrantRngTier(tierId, count);
      renderRngState(result.state);
      const tier = rngState.tiers.find(item => item.id === tierId);
      status.textContent = `${result.granted} título${result.granted === 1 ? '' : 's'} novo${result.granted === 1 ? '' : 's'} de ${tier?.label || tierId}; marco de ${count} testado.`;
    } else if (action === 'total') {
      const target = Number($('#rngDebugTotalMilestone').value || 50);
      const result = await window.ntc.debugGrantRngTotal(target);
      renderRngState(result.state);
      status.textContent = result.granted ? `${result.granted} título${result.granted === 1 ? '' : 's'} adicionado${result.granted === 1 ? '' : 's'}; marco de ${target} títulos testado.` : `A coleção já tem ${target} títulos ou mais.`;
    }
  } catch (error) { status.textContent = cleanError(error); }
}
function updateRngTimers() {
  updateRngClockStatus();
  if (!rngState) return;
  const elapsed = Math.max(0, Math.floor((performance.now() - rngStateReceivedAt) / 1000));
  $('#rngAppSessionTime').textContent = formatRngDuration(rngState.appSessionSeconds + elapsed);
  $('#rngAppTotalTime').textContent = formatRngDuration(rngState.totalAppSeconds + elapsed);
  $('#rngAutoSessionTime').textContent = formatRngDuration(rngState.autoRollActive ? rngState.autoRollSessionSeconds + elapsed : rngState.autoRollSessionSeconds);
  $('#rngAutoTotalTime').textContent = formatRngDuration(rngState.totalAutoRollSeconds + (rngState.autoRollActive ? elapsed : 0));
}
function normalizeRngSearch(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim(); }
function rngAchievementIconId(category) {
  const normalized = normalizeRngSearch(category);
  const categories = { 'rolagens manuais': 'manual-rolls', rolagens: 'rolls', colecao: 'collection', raridades: 'rarities', 'marcos de sorte': 'luck-milestones', eventos: 'events', segredos: 'secrets', conquistas: 'achievements' };
  return `achievement-${categories[normalized] || 'achievements'}`;
}
function renderRngTitleHistory(state) {
  const filter = $('#rngTitleHistoryTier');
  if (!filter.dataset.ready) {
    filter.innerHTML = '<option value="recent">Recentes</option><option value="all">Todas as raridades</option>' + state.tiers.map(tier => `<option value="${safeText(tier.id)}">${safeText(tier.label)}</option>`).join('');
    filter.value = rngHistoryTier;
    filter.dataset.ready = 'true';
  }
  const collected = state.catalog.filter(title => title.collected);
  const history = new Map((Array.isArray(state.titleHistory) ? state.titleHistory : []).map(record => [record.titleId, record]));
  const entries = collected.map((title, index) => ({ title, record: history.get(title.id) || null, index }))
    .sort((a, b) => {
      if (a.record && b.record) return b.record.roll - a.record.roll;
      if (a.record) return -1;
      if (b.record) return 1;
      return a.index - b.index;
    });
  const query = normalizeRngSearch(rngHistoryQuery);
  const recentEntries = entries.filter(entry => entry.record).slice(0, 8);
  const sourceEntries = rngHistoryTier === 'recent' ? recentEntries : entries;
  const visible = sourceEntries.filter(({ title, record }) => {
    if (rngHistoryTier !== 'recent' && rngHistoryTier !== 'all' && title.tier !== rngHistoryTier) return false;
    if (!query) return true;
    const boosts = record ? rngRollBoostLabels(record).join(' ') : '';
    const timestamp = record?.rolledAt ? new Date(record.rolledAt).toLocaleString('pt-BR') : '';
    return normalizeRngSearch([title.name, title.tierLabel, record?.roll, record?.currentOdds, boosts, timestamp].join(' ')).includes(query);
  });
  $('#rngTitleHistoryCount').textContent = rngHistoryTier === 'recent' ? `${visible.length} recentes` : `${visible.length} de ${collected.length} títulos`;
  const historyEmptyMessage = !collected.length
    ? 'Os títulos que você obtiver aparecerão aqui com os detalhes da rolagem.'
    : rngHistoryTier === 'recent' && recentEntries.length === 0
      ? 'Ainda não há títulos recentes registrados.'
      : 'Nenhum título corresponde à busca e ao filtro.';
  $('#rngTitleHistoryList').innerHTML = visible.map(({ title, record }) => {
    const boosts = record ? rngRollBoostLabels(record) : [];
    const bonusBadges = boosts.map(label => `<small class="rng-discovery-badge${label.startsWith('Bônus acumulados') ? ' is-combined' : ''}">${safeText(label)}</small>`).join('');
    const rolledAt = record?.rolledAt ? new Date(record.rolledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const detail = record
      ? `<div class="rng-discovery-detail"><span><small>Rolagem</small><strong>#${new Intl.NumberFormat('pt-BR').format(record.roll)}</strong></span><span><small>Chance na rolagem</small><strong>${formatRngOdds(record.currentOdds || title.baseOdds)}</strong></span></div>`
      : '';
    const meta = rolledAt || bonusBadges ? `<div class="rng-discovery-meta">${rolledAt ? `<span class="rng-discovery-date"><small>Obtido</small><time>${safeText(rolledAt)}</time></span>` : ''}${bonusBadges ? `<div class="rng-discovery-badges">${bonusBadges}</div>` : ''}</div>` : '';
    return `<article class="rng-discovery-card rng-title-history-card${record ? ' has-record' : ''}" data-tier="${safeText(title.tier)}"><span class="rng-discovery-mark" aria-hidden="true">${rngTitleIcon(title, { size: 19 }) || '✦'}</span><div class="rng-discovery-copy"><div class="rng-discovery-name-line"><strong>${safeText(title.name)}</strong><span>${safeText(title.tierLabel)}</span></div>${meta}</div>${detail}</article>`;
  }).join('') || `<div class="rng-discovery-empty">${historyEmptyMessage}</div>`;
}
function rngBigOdds(value) { try { return BigInt(value || 0) > 0n ? `1 em ${new Intl.NumberFormat('pt-BR').format(BigInt(value))}` : '—'; } catch { return '—'; } }
function formatRngProfileTime(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  if (totalMinutes < 60) return `${totalMinutes}min`;
  const hours = Math.floor(totalMinutes / 60);
  return hours < 100 ? `${hours}h ${totalMinutes % 60}min` : `${new Intl.NumberFormat('pt-BR').format(hours)}h`;
}
function renderRngPlayerProfile(state) {
  const profile = state.playerProfile;
  if (!profile) return;
  const name = profile.identity?.displayName || '';
  const equipped = profile.identity?.equippedTitle;
  const number = value => new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
  const formatExpected = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value) || 0);
  const hero = $('#rngPlayerProfileHero');
  hero.dataset.tier = equipped?.tierId || 'basic';
  $('#rngPlayerProfileHeading').textContent = name || 'Viajante';
  $('#rngPlayerEquippedTitle').textContent = equipped?.name || 'Nenhum título equipado';
  $('#rngPlayerEquippedTier').textContent = (equipped?.tierLabel || 'Sem título').toLocaleUpperCase('pt-BR');
  $('#rngPlayerProfileArt').innerHTML = equipped ? rngTitleIcon(equipped, { size: 260, className: 'rng-profile-main-crystal', animation: 'none', eager: true }) : window.NTCRngIcons?.render('ui-collection', { size: 260, animation: 'none', eager: true }) || '';
  const record = profile.record;
  const recordCard = $('#rngPlayerRecord');
  recordCard.dataset.tier = record?.tierId || 'basic';
  $('#rngPlayerRecordTitle').textContent = record?.name || 'Nenhum título descoberto ainda';
  $('#rngPlayerRecordTier').textContent = record ? `${record.tierLabel} · ${record.roll ? `obtido na rolagem #${number(record.roll)}` : 'descoberta registrada'}` : 'Sua descoberta mais rara aparecerá aqui.';
  $('#rngPlayerRecordOdds').textContent = record ? (record.acquisitionOdds || record.baseOdds || 'Odds não registradas') : '—';
  $('#rngPlayerRecordArt').innerHTML = record ? rngTitleIcon(record, { size: 116, animation: 'none', eager: true }) : '';
  $('#rngProfileRolls').textContent = number(profile.progress?.totalRolls);
  $('#rngProfileCollection').textContent = `${number(profile.collection?.collected)} / ${number(profile.collection?.total)}`;
  $('#rngProfileCompletion').textContent = `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format((profile.collection?.completion || 0) * 100)}%`;
  $('#rngProfileAchievements').textContent = `${number(profile.progress?.achievementsUnlocked)} / ${number(profile.progress?.achievementsTotal)}`;
  const index = profile.luck?.index;
  const measuredRolls = Number(index?.measuredRolls) || 0;
  const expectedHits = Number(index?.expected) || 0;
  const calibrationProgress = Math.min(1, measuredRolls / 100, expectedHits / 5);
  const rollsForCount = Math.max(0, 100 - measuredRolls);
  const observedRate = measuredRolls > 0 ? expectedHits / measuredRolls : 0;
  const rollsForExpectation = observedRate > 0 ? Math.ceil(Math.max(0, 5 - expectedHits) / observedRate) : null;
  const estimatedRemaining = rollsForExpectation === null ? rollsForCount : Math.max(rollsForCount, rollsForExpectation);
  $('#rngProfileLuckIndex').textContent = index?.ready ? `${number(index.score)} / 100` : 'Calibrando';
  $('#rngProfileLuckRolls').textContent = `${number(measuredRolls)} rolls analisados`;
  $('#rngProfileLuckRemaining').textContent = index?.ready
    ? 'Índice local consolidado para a amostra atual'
    : estimatedRemaining > 0 ? `Próxima análise em aproximadamente ${number(estimatedRemaining)} rolls` : 'Aguardando cobertura estatística suficiente';
  const luckMeterValue = index?.ready ? Number(index.score) || 0 : Math.round(calibrationProgress * 100);
  $('#rngProfileLuckProgress').style.width = `${luckMeterValue}%`;
  $('#rngProfileLuckMeter').setAttribute('aria-valuenow', String(luckMeterValue));
  $('#rngProfileLuckMeter').setAttribute('aria-label', index?.ready ? 'Índice de Sorte' : 'Calibração do Índice de Sorte');
  $('#rngProfileLuckTooltip').textContent = index?.ready
    ? `${number(index.observed)} resultados Singular+ observados e ${formatExpected(index.expected)} esperados em ${number(measuredRolls)} rolls. O índice é local, não um percentil entre jogadores.`
    : `${number(index?.observed)} resultados Singular+ observados; ${formatExpected(expectedHits)} de 5 esperados para liberar a análise. Também são exigidos 100 rolls. O histórico anterior à atualização não entra no cálculo.`;
  const milestones = profile.progress || {};
  $('#rngMilestoneRelics').textContent = number(milestones.relicsOwned);
  $('#rngMilestoneSecrets').textContent = number(milestones.secretsUnlocked);
  $('#rngMilestoneDrought').textContent = number(milestones.longestSingularDrought);
  $('#rngMilestoneAppTime').textContent = formatRngProfileTime(milestones.appOpenSeconds);
  $('#rngMilestoneEvents').textContent = number(milestones.eventsParticipated);
  $('#rngMilestoneEvents').parentElement.classList.toggle('is-muted', !Number(milestones.eventsParticipated));
  const outlier = profile.luck?.bestOutlier;
  $('#rngProfileOutlier').textContent = outlier?.name || 'Ainda não medido';
  $('#rngProfileOutlierTier').textContent = (outlier?.tierLabel || 'Sem registro').toLocaleUpperCase('pt-BR');
  $('#rngProfileOutlierTier').dataset.tier = outlier?.tierId || 'basic';
  $('#rngProfileOutlierOdds').textContent = outlier?.odds || '—';
  $('#rngProfileOutlierDetail').textContent = outlier ? `Resultado registrado na rolagem #${number(outlier.roll)}. É a menor chance individual observada nesta versão, não uma comparação entre jogadores.` : 'A raridade individual efetiva de cada resultado começa a ser registrada nesta versão.';
  $('#rngProfileTierRows').innerHTML = (state.tiers || []).map(tier => {
    const observed = profile.luck?.rarityByTier?.[tier.id] || { observed: 0, expected: 0 };
    const collected = Number(profile.collection?.countsByTier?.[tier.id]) || 0;
    const total = state.catalog.filter(title => title.tier === tier.id).length;
    const completion = total ? Math.min(100, collected / total * 100) : 0;
    const tooltipId = `rngProfileTierTip-${tier.id}`;
    return `<article class="rng-profile-tier-row" data-tier="${safeText(tier.id)}"><header><span>${safeText(tier.label)}</span><span class="rng-context-tip"><button type="button" aria-label="Detalhes de ${safeText(tier.label)}" aria-describedby="${tooltipId}">i</button><span id="${tooltipId}" role="tooltip">${number(observed.observed)} resultados observados e ${formatExpected(observed.expected)} esperados nas rolagens medidas. ${number(collected)} de ${number(total)} títulos únicos descobertos.</span></span></header><strong>${number(observed.observed)}</strong><small>resultados medidos</small><div class="rng-tier-progress" role="progressbar" aria-label="Coleção ${safeText(tier.label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${collected}"><span style="width:${completion}%"></span></div><b>${number(collected)} / ${number(total)} títulos</b></article>`;
  }).join('');
  if (rngActiveSection === 'profile' && !name && !$('#rngProfileNameDialog').open) openRngProfileNameSetup();
}

function renderRngExpansion(state) {
  const patchNotes = window.NTC_RNG_CHANGELOG || [];
  $('#rngPatchNotes').innerHTML = patchNotes.map(note => `<article class="rng-patch-note"><header><h3>${safeText(note.title)}</h3><time>${safeText(note.date)}</time></header><ul>${(note.changes || []).map(change => `<li>${safeText(change)}</li>`).join('')}</ul></article>`).join('');
  const number = value => new Intl.NumberFormat('pt-BR').format(value || 0);
  const achievementGroups = new Map();
  for (const item of state.achievements || []) achievementGroups.set(item.category, [...(achievementGroups.get(item.category) || []), item]);
  $('#rngAchievements').innerHTML = [...achievementGroups].map(([category, achievements]) => {
    const iconId = rngAchievementIconId(category);
    return `<section class="rng-achievement-group"><header class="rng-achievement-heading">${window.NTCRngIcons?.render(iconId, { size: 17 }) || ''}<h3>${safeText(category)}</h3></header><div class="rng-extra-grid">${achievements.map(item => `<article class="rng-info-card${item.unlocked ? ' unlocked' : ' locked'}"><span class="rng-info-icon${item.unlocked ? ' is-unlocked' : ''}">${window.NTCRngIcons?.render(iconId, { size: 25, animation: item.unlocked ? 'hover' : 'none' }) || '◇'}</span><div><strong>${safeText(item.name)}</strong><p>${safeText(item.description)}</p>${item.rewardText ? `<small class="rng-achievement-reward">Recompensa · ${safeText(item.rewardText)}</small>` : ''}${item.luckBonusBps ? `<small class="rng-achievement-reward">Bônus permanente de sorte · +${formatRngPercent(item.luckBonusBps)}</small>` : ''}<small>${item.unlocked ? 'Concluída' : `${number(item.progress)} / ${number(item.goal)}`}</small></div></article>`).join('')}</div></section>`;
  }).join('');
  $('#rngSecrets').innerHTML = (state.secrets || []).map(item => `<article class="rng-info-card unlocked"><span class="rng-info-icon is-unlocked">${window.NTCRngIcons?.render('achievement-secrets', { size: 25, animation: 'hover' }) || '✧'}</span><div><strong>${safeText(item.name)}</strong><p>${safeText(item.hint)}</p>${item.luckBonusBps ? `<small class="rng-achievement-reward">Bônus permanente de sorte · +${formatRngPercent(item.luckBonusBps)}</small>` : ''}</div></article>`).join('') || '<p class="rng-section-empty">Nenhum segredo descoberto. Os segredos ocultos não aparecem na coleção.</p>';
  const stats = state.statistics || {};
  const rows = [
    ['Rolagens medidas', number(stats.measuredRolls)], ['Títulos únicos', number(stats.uniqueTitles)], ['Repetidos medidos', number(stats.duplicates)],
    ['Sorte permanente das conquistas', `+${formatRngPercent(state.achievementLuckBps)}`], ['Sorte permanente dos segredos', `+${formatRngPercent(state.secretLuckBps)}`],
    ['Sorte média nas rolagens medidas', stats.averageLuck === null ? 'Ainda não medida' : `×${Number(stats.averageLuck || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`],
    ['Maior multiplicador', `×${number(stats.maxMultiplier || 1)}`], ['Título mais raro', stats.rarestTitle ? `${stats.rarestTitle} · ${rngBigOdds(stats.rarestOdds)}` : 'Ainda não medido'],
    ['Rolagem mais sortuda', stats.luckiestRoll ? `#${number(stats.luckiestRoll)} · ${rngBigOdds(stats.luckiestOdds)}` : 'Ainda não medido'],
    ['Maior seca de Singular+', number(stats.longestSingularDrought)], ['Mesmo título seguido', number(stats.longestSameTitleStreak)],
    ['Melhor sessão', `${number(stats.bestSession?.rolls)} rolagens · ${number(stats.bestSession?.newTitles)} novos`]
  ];
  $('#rngStatistics').innerHTML = rows.map(([label, value]) => `<article class="rng-stat-card"><span>${safeText(label)}</span><strong>${safeText(value)}</strong></article>`).join('') + `<article class="rng-stat-card rng-tier-stats"><span>Resultados por raridade · medidos nesta atualização</span><div>${(state.tiers || []).map(tier => `<span>${safeText(tier.label)} <strong>${number(stats.tierRolls?.[tier.id])}</strong></span>`).join('')}</div></article>`;
  const verified = state.timeVerification?.verified;
  const active = state.activeEvent;
  $('#rngEventStatus').textContent = verified ? active ? `${active.name}${active.focusTierLabel ? ` · ${active.focusTierLabel} em foco ×${active.focusMultiplier}` : ` ×${active.multiplier}`} · participando` : 'Entre durante a janela para participar.' : 'Eventos pausados até verificar a conexão.';
  const localDate = utcMs => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' }).format(new Date(utcMs));
  const localTime = utcMs => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(utcMs));
  const now = verified ? trustedRngUtc() : null;
  const eventIconIds = { rain: 'event-rain', eclipse: 'event-eclipse', focus: 'event-alignment', fragments: 'event-fragments' };
  const nextByEvent = new Map();
  for (const window of state.eventSchedule || []) {
    const open = now !== null && window.startUtc <= now && now < window.endUtc;
    const previous = nextByEvent.get(window.eventId);
    if (!previous || (open && !previous.open)) nextByEvent.set(window.eventId, { ...window, open });
  }
  $('#rngEventSchedule').innerHTML = [...nextByEvent.values()].map(window => {
    const joined = active?.id === window.id;
    const momentLabel = window.open ? 'Ativo agora' : `Próximo · ${localDate(window.startUtc)}`;
    const boostLabel = window.focusTierLabel ? `${window.focusTierLabel} em foco ×${window.focusMultiplier}` : `×${window.multiplier}`;
    const goal = window.reward?.rollGoal || 0;
    const progress = state.eventRollProgress?.windowId === window.id ? state.eventRollProgress.rolls || 0 : 0;
    const rewardDetails = goal ? `<small class="rng-event-reward">${number(goal)} rolagens na participação · título garantido: ${safeText(window.reward.name)} · relíquia exclusiva aleatória</small>${joined ? `<small class="rng-event-progress">Progresso desta edição · ${number(progress)} / ${number(goal)}</small>` : ''}` : window.reward ? '<small class="rng-event-reward">Edição com título limitado</small>' : '';
    const icon = globalThis.NTCRngIcons?.render(eventIconIds[window.eventId] || 'event-rain', { size: 48, className: 'rng-event-art', animation: 'hover' }) || '';
    return `<article class="rng-event-card${window.open ? ' is-open' : ''}"><span class="rng-event-icon" aria-hidden="true">${icon}</span><div class="rng-event-main"><span class="rng-event-kicker">${safeText(window.description)} · ${safeText(boostLabel)} · ${window.durationMinutes || Math.round((window.endUtc - window.startUtc) / 60_000)} min</span><strong>${safeText(window.name)}</strong><span class="rng-event-time"><small>${momentLabel}</small><b>${localTime(window.startUtc)}</b></span>${rewardDetails}</div>${window.open ? `<button type="button" class="outline-button" data-join-rng-event="${safeText(window.id)}" ${joined ? 'disabled' : ''}>${joined ? 'Participando' : 'Participar'}</button>` : ''}</article>`;
  }).join('') || '<p class="rng-section-empty">A agenda aparece após verificar a conexão.</p>';
  $('#rngLimitedTitles').innerHTML = (state.limitedTitles || []).map(reward => `<article class="rng-info-card unlocked"><span class="rng-info-icon">✦</span><div><strong>${safeText(reward.name)}</strong><p>Edição ${safeText(reward.edition)}</p></div></article>`).join('') || '<p class="rng-section-empty">Nenhum título limitado obtido.</p>';
}
function formatRngFragments(value) {
  try { return new Intl.NumberFormat('pt-BR').format(BigInt(value || 0)); } catch { return '0'; }
}
function formatRngAccountValue(value) {
  try {
    const integer = BigInt(value || 0).toString();
    if (integer.length <= 15) return new Intl.NumberFormat('pt-BR').format(BigInt(integer));
    return `${integer[0]}.${integer.slice(1, 3)}e${integer.length - 1}`;
  } catch { return '0'; }
}
const rngSystemUnlockCopy = Object.freeze({
  'fragment-recycling': { icon: 'fragment-pouch', level: 'NÍVEL 2', title: 'Fragmentos', detail: 'Títulos repetidos agora são convertidos em Fragmentos.' },
  'auto-roll': { icon: 'ui-history', level: 'NÍVEL 3', title: 'Rolagem Automática', detail: 'Agora você pode deixar as rolagens acontecerem automaticamente.' },
  improvements: { icon: 'ui-shop', level: 'NÍVEL 4', title: 'Melhorias', detail: 'Use seus Fragmentos para melhorar permanentemente sua progressão.' }
});
function pendingRngSystemUnlockId(state) {
  return ['fragment-recycling', 'auto-roll', 'improvements'].includes(state?.pendingAccountSystemUnlock) ? state.pendingAccountSystemUnlock : null;
}
function showRngSystemUnlock(unlockId) {
  const notice = $('#rngSystemUnlockNotice');
  if (!window.NTCRngAvailability?.gameUiEnabled) {
    notice.classList.remove('is-visible');
    if (notice.open) notice.close();
    notice.hidden = true;
    delete notice.dataset.unlockId;
    return;
  }
  if (notice.dataset.unlockId === unlockId && notice.open) return;
  const copy = rngSystemUnlockCopy[unlockId];
  if (!copy) return;
  notice.dataset.unlockId = unlockId;
  notice.querySelector('[data-system-unlock-level]').textContent = copy.level;
  notice.querySelector('[data-system-unlock-title]').textContent = copy.title;
  notice.querySelector('[data-system-unlock-detail]').textContent = copy.detail;
  const iconHost = notice.querySelector('[data-system-unlock-icon]');
  window.NTCRngIcons?.cancel(iconHost.querySelector('.ntc-rng-icon'));
  iconHost.innerHTML = window.NTCRngIcons?.render(copy.icon, { size: 30, animation: 'none' }) || '';
  notice.hidden = false;
  notice.classList.remove('is-visible');
  if (!notice.open) notice.showModal();
  requestAnimationFrame(() => {
    if (!notice.open) return;
    notice.classList.add('is-visible');
    $('#rngSystemUnlockContinue').focus({ preventScroll: true });
  });
}
function syncRngSystemUnlock(state) {
  const pendingId = pendingRngSystemUnlockId(state);
  const notice = $('#rngSystemUnlockNotice');
  if (pendingId) { showRngSystemUnlock(pendingId); return true; }
  notice.classList.remove('is-visible');
  if (notice.open) notice.close();
  notice.hidden = true;
  delete notice.dataset.unlockId;
  return false;
}
async function continueRngSystemUnlock() {
  const notice = $('#rngSystemUnlockNotice');
  const unlockId = notice.dataset.unlockId;
  if (!unlockId || rngSystemUnlockAckPending) return;
  const button = $('#rngSystemUnlockContinue');
  rngSystemUnlockAckPending = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const result = await window.ntc.acknowledgeRngSystemUnlock(unlockId);
    if (!result?.ok || !result.state) throw new Error('Não foi possível registrar este desbloqueio. Tente novamente.');
    renderRngState(result.state);
  } catch (error) {
    showToast(cleanError(error));
  } finally {
    button.removeAttribute('aria-busy');
    rngSystemUnlockAckPending = false;
    if (rngState) renderRngState(rngState);
  }
}
function renderRngAccountProgress(state, previousState = null) {
  const progress = state.accountProgress || { level: '1', xp: '0', xpToNextLevel: '10', lifetimeXp: '0', progressBasisPoints: 0 };
  const percent = Math.max(0, Math.min(100, (Number(progress.progressBasisPoints) || 0) / 100));
  const currentXp = formatRngAccountValue(progress.xp);
  const nextXp = formatRngAccountValue(progress.xpToNextLevel);
  const levelLabel = $('#rngAccountLevel');
  levelLabel.textContent = formatRngAccountValue(progress.level);
  $('#rngAccountXp').textContent = `${currentXp} / ${nextXp} XP`;
  $('#rngAccountProgressFill').style.transform = `scaleX(${percent / 100})`;
  $('#rngAccountProgressBar').setAttribute('aria-valuenow', percent.toFixed(2));
  $('#rngAccountProgressBar').setAttribute('aria-valuetext', `${currentXp} de ${nextXp} XP`);
  syncRngSystemUnlock(state);

  const feedback = $('#rngAccountXpFeedback');
  if (!previousState?.accountProgress) return;
  const previousLifetimeXp = BigInt(previousState.accountProgress.lifetimeXp || 0);
  const currentLifetimeXp = BigInt(progress.lifetimeXp || 0);
  if (currentLifetimeXp <= previousLifetimeXp) {
    if (currentLifetimeXp < previousLifetimeXp) {
      if (rngAccountXpFeedbackTimer) clearTimeout(rngAccountXpFeedbackTimer);
      rngAccountXpFeedbackTimer = null;
      feedback.classList.remove('is-visible', 'is-auto-unlock', 'is-recycling-unlock');
      $('#rngAccountUnlockDetail').hidden = true;
      $('#rngAccountLevel').classList.remove('is-level-up');
    }
    return;
  }
  const gained = currentLifetimeXp - previousLifetimeXp;
  const newLevel = BigInt(progress.level || 1);
  const unlockDetail = $('#rngAccountUnlockDetail');
  const oldLevel = BigInt(previousState.accountProgress.level || 1);
  feedback.textContent = newLevel > oldLevel
      ? `LEVEL UP · NÍVEL ${formatRngAccountValue(newLevel)}`
      : `+${formatRngAccountValue(gained)} XP`;
  unlockDetail.textContent = '';
  unlockDetail.hidden = true;
  const leveledUp = newLevel > oldLevel;
  levelLabel.classList.remove('is-level-up');
  feedback.classList.remove('is-visible', 'is-auto-unlock', 'is-recycling-unlock');
  void feedback.offsetWidth;
  feedback.classList.add('is-visible');
  if (leveledUp) levelLabel.classList.add('is-level-up');
  if (rngAccountXpFeedbackTimer) clearTimeout(rngAccountXpFeedbackTimer);
  rngAccountXpFeedbackTimer = setTimeout(() => {
    feedback.classList.remove('is-visible');
    feedback.classList.remove('is-auto-unlock', 'is-recycling-unlock');
    unlockDetail.hidden = true;
    levelLabel.classList.remove('is-level-up');
    rngAccountXpFeedbackTimer = null;
  }, newLevel > oldLevel ? 1100 : 850);
}
function renderRngShop(state) {
  const fragments = BigInt(state.fragments || 0);
  const price = BigInt(state.nextPermanentUpgradeCost || 50_000);
  $('#rngFragmentsBalance').textContent = `${formatRngFragments(fragments)} Fragmentos`;
  $('#rngFragmentsBalance').hidden = state.fragmentRecyclingUnlocked !== true;
  $('#rngPermanentLevel').textContent = new Intl.NumberFormat('pt-BR').format(state.permanentUpgradeLevels || 0);
  $('#rngPermanentBonus').textContent = `+${formatRngPercent(state.permanentLuckBps || 0)}`;
  $('#rngEnhancedRecyclingIcon').innerHTML = window.NTCRngIcons?.render('fragment-pouch', { size: 46, className: 'rng-shop-product-art', animation: 'none' }) || '';
  $('#rngShopEnhancedLuckIcon').innerHTML = window.NTCRngIcons?.render('shop-enhanced-luck', { size: 48, className: 'rng-shop-product-art', animation: 'sparkle' }) || '';
  $('#rngShopFortuneRollsIcon').innerHTML = window.NTCRngIcons?.render('shop-fortune-rolls', { size: 48, className: 'rng-shop-product-art', animation: 'glow' }) || '';
  $('#rngShopFortuneTimeIcon').innerHTML = window.NTCRngIcons?.render('shop-fortune-time', { size: 48, className: 'rng-shop-product-art', animation: 'glow' }) || '';
  $('#rngInventoryFortuneRollsIcon').innerHTML = window.NTCRngIcons?.render('shop-fortune-rolls', { size: 48, className: 'rng-shop-product-art', animation: 'glow' }) || '';
  $('#rngInventoryFortuneTimeIcon').innerHTML = window.NTCRngIcons?.render('shop-fortune-time', { size: 48, className: 'rng-shop-product-art', animation: 'glow' }) || '';
  $('#rngBuyUpgrade').textContent = `Comprar por ${formatRngFragments(price)}`;
  $('#rngBuyUpgrade').disabled = fragments < price || rngRequestRunning;
  const recycling = state.enhancedRecycling || { unlocked: false, level: 0, maxLevel: 5, nextBonusPercent: 10, nextCost: '25' };
  const recyclingMaxed = recycling.level >= recycling.maxLevel;
  const recyclingCost = recycling.nextCost === null ? null : BigInt(recycling.nextCost);
  $('#rngEnhancedRecyclingLevel').textContent = `${recycling.level} / ${recycling.maxLevel}`;
  $('#rngEnhancedRecyclingBonus').textContent = recyclingMaxed
    ? `Duplicatas concedem +${recycling.bonusPercent}% Fragmentos.`
    : `Duplicatas: +${recycling.nextBonusPercent}% Fragmentos no próximo nível.`;
  $('#rngEnhancedRecyclingCost').textContent = recyclingCost === null ? 'Nível máximo' : `${formatRngFragments(recyclingCost)} Fragmentos`;
  $('#rngEnhancedRecyclingLocked').hidden = recycling.unlocked === true;
  $('#rngBuyEnhancedRecycling').disabled = recycling.unlocked !== true || recyclingMaxed || fragments < (recyclingCost ?? 0n) || rngRequestRunning;
  for (const id of ['rngBuyRollBoost', 'rngBuyTimeBoost']) {
    $(`#${id}`).disabled = fragments < 5_000n || rngRequestRunning;
  }
}
function renderRngInventory(state) {
  const inventory = state.consumableInventory || { rolls: 0, time: 0 };
  $('#rngRollBoostCount').textContent = new Intl.NumberFormat('pt-BR').format(inventory.rolls || 0);
  $('#rngTimeBoostCount').textContent = new Intl.NumberFormat('pt-BR').format(inventory.time || 0);
  $('#rngActivateRollBoost').disabled = !(inventory.rolls > 0) || rngRequestRunning;
  $('#rngActivateTimeBoost').disabled = !(inventory.time > 0) || rngRequestRunning;
  const active = [state.activeBoost, state.parallelBoost].filter(Boolean);
  const activeLabel = !active.length ? 'Nenhum bônus ativo' : `Sorte ×${2 ** active.length} · ${active.map(boost => boost.type === 'rolls'
    ? `${new Intl.NumberFormat('pt-BR').format(boost.remaining)} rolagens`
    : formatRngDuration(boost.remaining)).join(' + ')}`;
  $('#rngActiveBoostLabel').textContent = activeLabel;
  const queue = state.boostQueue || [];
  $('#rngBoostQueueLabel').textContent = queue.length ? `Próximos: ${queue.map(boost => boost.type === 'rolls' ? 'Tônico por rolagens' : 'Ampulheta por tempo').join(' → ')}` : 'Nenhuma ativação na fila';
}
function formatRngRelicMultiplier(value) {
  try {
    const bps = BigInt(value || 10_000);
    const whole = bps / 10_000n;
    const decimals = String(bps % 10_000n).padStart(4, '0').replace(/0+$/, '').slice(0, 2);
    return `×${new Intl.NumberFormat('pt-BR').format(whole)}${decimals ? `,${decimals}` : ''}`;
  } catch { return '×1'; }
}
function formatRngRelicLuck(value) {
  try {
    const bps = BigInt(value ?? 10_000);
    return bps > 10_000n ? `${formatRngRelicMultiplier(bps)} relíquias` : '+0% relíquias';
  } catch { return '+0% relíquias'; }
}
function renderRngRelics(state) {
  const relicState = state.relics || { catalog: [], slots: [], sets: [], activeEffects: [] };
  const fragments = BigInt(state.fragments || 0);
  const sourceLabel = relic => relic.source === 'random-drop' ? relic.rare ? 'Achado raríssimo' : 'Achado aleatório'
      : relic.source === 'event' ? `Exclusiva de evento · ${relic.eventId === 'eclipse' ? 'Noite sem Alvorecer' : 'Queda de Cinzas'}`
      : relic.source === 'achievement' ? `Conquista · descubra ${new Intl.NumberFormat('pt-BR').format(relic.achievementGoal || 0)} títulos`
          : 'Exclusiva da loja';
  const categoryLabel = relic => relic.setId === 'celestial' ? 'RELÓGIOS DA PENITÊNCIA'
    : relic.setId === 'echoes' ? 'ECOS'
      : relic.source === 'random-drop' ? 'ACHADO ALEATÓRIO'
          : relic.source === 'event' ? 'RELÍQUIA DE EVENTO'
            : relic.source === 'achievement' ? 'RELÍQUIA DE CONQUISTA'
              : 'RELÍQUIA AVULSA';
  const card = (relic, mode) => {
    const disabled = rngRequestRunning || (mode === 'shop' ? relic.owned || fragments < BigInt(relic.price || 0) : !relic.owned);
    const equipmentFull = (relicState.slots || []).filter(Boolean).length >= 6;
    const button = mode === 'shop'
      ? `<button class="outline-button" type="button" data-buy-rng-relic="${safeText(relic.id)}" ${disabled ? 'disabled' : ''}>${relic.owned ? 'Adquirida' : `Comprar por ${formatRngFragments(relic.price)}`}</button>`
      : relic.owned
        ? `<button class="outline-button" type="button" data-${relic.equipped ? 'unequip' : 'equip'}-rng-relic="${safeText(relic.id)}" ${rngRequestRunning || (!relic.equipped && equipmentFull) ? 'disabled' : ''}>${relic.equipped ? 'Desequipar' : equipmentFull ? 'Sem espaço livre' : 'Equipar'}</button>`
        : '<button class="outline-button" type="button" disabled>Não encontrada</button>';
    const icon = window.NTCRngIcons?.render(`relic-${relic.id}`, { size: 38, className: 'rng-relic-art', eager: false }) || '';
    return `<article class="rng-relic-card${relic.owned ? ' is-owned' : ' is-locked'}${relic.equipped ? ' is-equipped' : ''}"><span class="rng-relic-icon" aria-hidden="true">${icon}</span><div class="rng-relic-copy"><span class="rng-shop-kicker">${safeText(categoryLabel(relic))}</span><h3>${safeText(relic.name)}</h3><p>${safeText(relic.effect)}</p><small>${safeText(sourceLabel(relic))}</small></div>${button}</article>`;
  };
  $('#rngRelicShop').innerHTML = relicState.catalog.filter(relic => relic.purchasable).map(relic => card(relic, 'shop')).join('');
  $('#rngRelicInventory').innerHTML = relicState.catalog.map(relic => card(relic, 'inventory')).join('');
  $('#rngRelicCount').textContent = `${relicState.ownedCount || 0} / ${relicState.catalog.length || 9}`;
  const byId = new Map(relicState.catalog.map(relic => [relic.id, relic]));
  $('#rngRelicSlots').innerHTML = Array.from({ length: 6 }, (_, index) => {
    const relic = byId.get(relicState.slots?.[index]);
    return relic
      ? `<button type="button" class="rng-relic-slot is-filled" data-unequip-rng-relic="${safeText(relic.id)}"><span>${window.NTCRngIcons?.render(`relic-${relic.id}`, { size: 28, animation: 'none' }) || '◇'}</span><strong>${safeText(relic.name)}</strong><small>Retirar</small></button>`
      : `<div class="rng-relic-slot"><span>◇</span><strong>Espaço ${index + 1}</strong><small>Livre</small></div>`;
  }).join('');
  const effectLabels = [...(relicState.activeEffects || [])];
  if ((relicState.fragmentMultiplierBps || 10_000) > 10_000) effectLabels.push(`Fragmentos ×${((relicState.fragmentMultiplierBps || 10_000) / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`);
  $('.rng-relic-effects').style.display = effectLabels.length ? 'grid' : 'none';
  $('#rngRelicEffects').innerHTML = effectLabels.map(label => `<span>${safeText(label)}</span>`).join('');
  const setIconIds = { celestial: 'set-celestial', echoes: 'set-echoes' };
  $('#rngRelicSets').innerHTML = (relicState.sets || []).map(set => `<article class="rng-set-card${set.complete ? ' is-complete' : ''}"><span class="rng-set-icon" aria-hidden="true">${window.NTCRngIcons?.render(setIconIds[set.id] || 'set-celestial', { size: 46, animation: set.complete ? 'glow' : 'none' }) || ''}</span><div class="rng-set-main"><div><span class="rng-shop-kicker">CONJUNTO ${set.equippedCount} / ${set.pieceIds.length}</span><strong>${safeText(set.name)}</strong></div><p>${safeText(set.effect)}</p><small>${set.complete ? 'Bônus do conjunto ativo' : 'Equipe as três peças para ativar'}</small></div></article>`).join('');
}
async function performRngShopAction(action, argument, successMessage) {
  if (rngRequestRunning) return;
  rngRequestRunning = true;
  if (rngState) renderRngState(rngState);
  try {
    const result = await window.ntc[action](...(argument === undefined ? [] : [argument]));
    if (result?.state) renderRngState(result.state);
    if (!result?.ok) {
      const messages = { 'insufficient-fragments': 'Você ainda não tem Fragmentos suficientes.', 'upgrade-locked': 'Melhorias ficam disponíveis no Nível 4.', 'max-level': 'Esta melhoria já está no nível máximo.', 'already-owned': 'Essa relíquia já faz parte da sua coleção.', 'already-equipped': 'Essa relíquia já está equipada.', 'no-free-slot': 'Os seis espaços estão ocupados. Retire uma relíquia primeiro.', 'not-owned': 'Essa relíquia ainda não foi encontrada.', 'not-equipped': 'Essa relíquia ainda não está equipada.' };
      showToast(messages[result?.reason] || 'Não foi possível concluir essa ação.');
    }
    else showToast(successMessage(result));
  } catch (error) { showToast(cleanError(error)); }
  finally { rngRequestRunning = false; if (rngState) renderRngState(rngState); }
}
function renderRngOnlineNamePrompt() {
  const prompt = $('#rngOnlineNamePrompt');
  if (!prompt) return;
  const hasName = Boolean(rngState?.playerProfile?.identity?.displayName);
  prompt.classList.toggle('hidden', hasName);
}

function formatRngOnlineRolls(value) {
  try { return new Intl.NumberFormat('pt-BR').format(BigInt(String(value ?? '0'))); } catch { return '—'; }
}

function renderRngOnlineState(state) {
  if (!state || typeof state !== 'object') return;
  rngOnlineState = state;
  const connection = $('#rngOnlineConnection');
  const statusText = $('#rngOnlineStatusText');
  const retry = $('#rngOnlineRetry');
  const updated = $('#rngOnlineRankingUpdated');
  const list = $('#rngOnlineLeaderboard');
  const feedback = $('#rngOnlineFeedback');
  if (!connection || !statusText || !list) return;
  const labels = {
    connecting: 'Conectando…', online: 'Online', offline: 'Offline',
    error: 'Erro de sincronização', unconfigured: 'Não configurado'
  };
  const status = Object.hasOwn(labels, state.status) ? state.status : 'error';
  connection.dataset.status = status;
  statusText.textContent = labels[status];
  connection.title = String(state.message || labels[status]);
  retry.classList.toggle('hidden', !['offline', 'error'].includes(status));
  feedback.textContent = ['offline', 'error', 'unconfigured'].includes(status) ? String(state.message || '') : '';
  feedback.classList.toggle('hidden', !feedback.textContent);
  const rows = Array.isArray(state.leaderboard) ? state.leaderboard : [];
  if (!rows.length) {
    const empty = status === 'online' ? 'Ainda não há perfis publicados. Seja o primeiro no ranking.' : 'O ranking será exibido quando a conexão estiver disponível.';
    list.innerHTML = `<li class="rng-online-empty">${safeText(empty)}</li>`;
  } else {
    list.innerHTML = rows.map((entry, index) => `<li class="rng-online-player${index === 0 ? ' is-first' : ''}"><span class="rng-online-rank">#${index + 1}</span><span class="rng-online-player-copy"><span class="rng-online-player-name"><i class="rng-online-presence" data-status="${entry.activityStatus === 'online' ? 'online' : 'offline'}" aria-label="${entry.activityStatus === 'online' ? 'Ativo agora' : 'Offline'}"></i><strong>${safeText(entry.displayName || 'Viajante')}</strong>${entry.showBotBadge ? '<em class="rng-online-bot-badge">BOT</em>' : ''}</span></span><strong class="rng-online-roll-count">${formatRngOnlineRolls(entry.totalRolls)} <small>rolls</small></strong></li>`).join('');
  }
  updated.textContent = state.updatedAt
    ? `Atualizado às ${new Date(state.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : status === 'online' ? 'Sincronizado agora' : 'Aguardando conexão';
}

function renderRngState(state) {
  if (!state?.catalog?.length) return;
  const previousState = rngState;
  const previousRoll = rngState?.totalRolls ?? null;
  const unlockedAchievements = (state.achievements || []).filter(item => item.unlocked);
  const newlyUnlockedAchievements = rngAchievementUnlocks === null
    ? []
    : unlockedAchievements.filter(item => !rngAchievementUnlocks.has(item.id));
  rngAchievementUnlocks = new Set(unlockedAchievements.map(item => item.id));
  if (state !== rngState) rngStateReceivedAt = performance.now();
  rngState = state;
  renderRngAccountProgress(state, previousState);
  renderRngOnlineNamePrompt();
  for (const [section, icon] of Object.entries({ profile: 'ui-profile', online: 'ui-online', history: 'ui-history', collection: 'ui-collection', achievements: 'ui-achievements', statistics: 'ui-statistics', events: 'ui-events', shop: 'ui-shop', inventory: 'ui-inventory', 'patch-notes': 'ui-updates' })) {
    const host = document.querySelector(`[data-rng-section="${section}"] .rng-section-tab-icon`);
    if (host && !host.firstElementChild) host.innerHTML = window.NTCRngIcons?.render(icon, { size: 25, animation: 'none' }) || '';
  }
  const totalCollected = state.collectedIds.length;
  const fragmentsUnlocked = state.fragmentRecyclingUnlocked === true;
  $('#rngFragmentWallet').hidden = !fragmentsUnlocked;
  $('#rngFragmentBalance').textContent = formatRngFragments(fragmentsUnlocked ? state.fragments : '0');
  $('#rngRollCount').textContent = new Intl.NumberFormat('pt-BR').format(state.totalRolls);
  $('#rngSessionRolls').textContent = new Intl.NumberFormat('pt-BR').format(state.session?.rolls || 0);
  $('#rngSessionBest').textContent = state.session?.bestOdds && state.session.bestOdds !== '0' ? `1 em ${new Intl.NumberFormat('pt-BR').format(BigInt(state.session.bestOdds))}` : '—';
  $('#rngSessionDrought').textContent = state.statistics?.sinceSingular === null ? 'Ainda não medido' : new Intl.NumberFormat('pt-BR').format(state.statistics?.sinceSingular || 0);
  const exactLuckBonus = (() => { try { return (BigInt(state.totalLuckBpsExact || state.totalLuckBps || 10_000) - 10_000n).toString(); } catch { return '0'; } })();
  $('#rngLuckValue').textContent = `+${formatRngExactPercent(exactLuckBonus)}`;
  $('#rngCollectionLuck').textContent = `+${formatRngPercent(state.passiveLuckBps)}`;
  $('#rngAchievementLuck').textContent = `+${formatRngPercent(state.achievementLuckBps)}`;
  $('#rngSecretLuck').textContent = `+${formatRngPercent(state.secretLuckBps)}`;
  $('#rngUpgradeLuck').textContent = `+${formatRngPercent(state.permanentLuckBps)}`;
  $('#rngRelicLuck').textContent = formatRngRelicLuck(state.relicLuckMultiplierBps);
  const autoRollUnlocked = state.autoRollUnlocked === true;
  $('#rngAutoButton').textContent = state.autoRollActive
    ? 'Pausar rolagem automática'
    : autoRollUnlocked ? 'Iniciar rolagem automática' : 'Rolagem automática · Nível 3';
  $('#rngAutoButton').classList.toggle('is-active', state.autoRollActive);
  $('#rngAutoButton').classList.toggle('is-locked', !autoRollUnlocked && !state.autoRollActive);
  $('#rngAutoButton').title = autoRollUnlocked ? '' : 'Desbloqueia ao atingir o Nível 3';
  $('#rngAutoButton').setAttribute('aria-label', autoRollUnlocked || state.autoRollActive
    ? (state.autoRollActive ? 'Pausar rolagem automática' : 'Iniciar rolagem automática')
    : 'Rolagem automática bloqueada até o Nível 3');
  const systemUnlockBlocksRolls = Boolean(pendingRngSystemUnlockId(state) || rngSystemUnlockAckPending);
  $('#rngRollButton').disabled = Boolean(systemUnlockBlocksRolls || state.autoRollActive || rngRequestRunning || rngManualRollCycleActive);
  $('#rngRollButton').textContent = state.rollsPerCycle > 1 ? `Rolar (${state.rollsPerCycle}×)` : 'Rolar';
  $('#rngAutoButton').disabled = systemUnlockBlocksRolls || rngRequestRunning || (!autoRollUnlocked && !state.autoRollActive);
  $('#rngRollBatchInfo').textContent = `${state.rollsPerCycle} ${state.rollsPerCycle === 1 ? 'rolagem' : 'rolagens'} por ciclo`;
  const rollsUntilBonus = state.bonusRollEvery - state.bonusRollCounter;
  $('#rngBonusRollInfo').textContent = `Rolagem bônus ×${state.bonusMultiplier} em ${rollsUntilBonus} ${rollsUntilBonus === 1 ? 'rolagem' : 'rolagens'}`;
  const rollsUntilThousandBonus = 1000 - (state.totalRolls % 1000);
  $('#rngThousandBonusInfo').textContent = `Mega bônus ×4 em ${new Intl.NumberFormat('pt-BR').format(rollsUntilThousandBonus)} ${rollsUntilThousandBonus === 1 ? 'rolagem' : 'rolagens'}`;
  const rollsUntilTenThousandBonus = 10_000 - (state.totalRolls % 10_000);
  $('#rngTenThousandBonusInfo').textContent = `Bônus supremo ×10 em ${new Intl.NumberFormat('pt-BR').format(rollsUntilTenThousandBonus)} ${rollsUntilTenThousandBonus === 1 ? 'rolagem' : 'rolagens'}`;

  const results = Array.isArray(state.latestResults) ? state.latestResults : [];
  const unlockResults = Array.isArray(state.latestUnlocks) ? state.latestUnlocks : results;
  const revealCandidates = window.NTCRngRevealQueue?.collectCandidates(unlockResults, previousRoll ?? 0) || [];
  const newUnlocks = revealCandidates.filter(candidate => candidate.eventKind === 'title').map(candidate => candidate.result);
  if (previousRoll !== null && revealCandidates.length) {
    showRngUnlockBatch(revealCandidates, { defer: true });
    const audibleUnlock = newUnlocks.filter(shouldPlayRngTitleSound).at(-1);
    if (audibleUnlock) void playRngTitleSound(audibleUnlock);
  }
  renderRngRollExperience(state, rngUnlockQueue.length > 0 && !rngUnlockActive && !rngUnlockClosing);
  if (newlyUnlockedAchievements.length) queueRngAchievementNotices(newlyUnlockedAchievements);
  const batchResults = $('#rngBatchResults');
  batchResults.classList.toggle('hidden', results.length < 2);
  batchResults.innerHTML = results.length < 2 ? '' : `${state.latestBatchSize > results.length ? `<div class="rng-batch-summary">Mostrando os ${results.length} resultados mais recentes de ${new Intl.NumberFormat('pt-BR').format(state.latestBatchSize)}.</div>` : ''}${results.map(result => { const boosts = rngRollBoostLabels(result); const fragmentReward = BigInt(result.fragmentReward || 0); const duplicateCopy = fragmentReward > 0n ? ` · Duplicata · +${formatRngFragments(fragmentReward)} Fragmentos` : ''; return `<article class="rng-batch-result${result.isNew ? ' is-new' : ''}" data-tier="${safeText(result.title?.tier || '')}"><span>${result.isNew ? 'NOVO TÍTULO' : 'REPETIDO'} · #${new Intl.NumberFormat('pt-BR').format(result.roll)}${boosts.length ? ` · ${safeText(boosts.join(' · '))}` : ''}</span><strong>${safeText(result.title?.name || '')}</strong><span>${safeText(result.title?.tierLabel || '')} · ${safeText(result.currentOdds || '')}${duplicateCopy}</span></article>`; }).join('')}`;

  renderRngTitleHistory(state);

  const tiers = state.tiers;
  if (!tiers.some(tier => tier.id === rngSelectedTier)) rngSelectedTier = tiers[0]?.id || 'basic';
  $('#rngTierFilters').innerHTML = tiers.map(tier => {
    const inTier = state.catalog.filter(title => title.tier === tier.id);
    const found = inTier.filter(title => title.collected).length;
    return `<button class="rng-tier-tab${tier.id === rngSelectedTier ? ' active' : ''}" type="button" role="tab" aria-selected="${tier.id === rngSelectedTier}" data-rng-tier="${tier.id}"><span class="rng-tier-tab-label">${window.NTCRngIcons?.render(`tier-${tier.id}`, { size: 16 }) || ''}<span>${safeText(tier.label)}</span></span><small>${found}/${inTier.length}</small></button>`;
  }).join('');
  const visible = state.catalog.filter(title => title.tier === rngSelectedTier);
  const selectedTier = tiers.find(tier => tier.id === rngSelectedTier);
  $('#rngTierCount').textContent = `${visible.filter(title => title.collected).length} / ${visible.length} · ${safeText(selectedTier?.label || '')}`;
  $('#rngCatalog').innerHTML = visible.map(title => `<article class="rng-title-row${title.collected ? ' collected' : ' locked'}" data-tier="${safeText(title.tier)}"><span class="rng-title-mark" aria-hidden="true">${rngTitleIcon(title, { size: 19, animation: 'none' }) || '<span class="rng-title-locked-mark">?</span>'}</span><div class="rng-title-info"><strong>${safeText(title.name)}</strong><span>${title.collected ? 'Obtido' : 'Não encontrado'}</span></div><div class="rng-title-odds"><strong>${formatRngOdds(title.baseOdds)}</strong></div></article>`).join('');
  renderRngPlayerProfile(state);
  renderRngExpansion(state);
  renderRngShop(state);
  renderRngInventory(state);
  renderRngRelics(state);
  updateRngDebugControls(state);
  updateRngTimers();
}
async function loadRngState() { try { renderRngState(await window.ntc.getRngState()); } catch (error) { showToast(`NTC RNG indisponível: ${cleanError(error)}`); } }
async function performManualRngRoll() {
  if (rngRequestRunning || rngManualRollCycleActive || rngState?.autoRollActive || pendingRngSystemUnlockId(rngState) || rngSystemUnlockAckPending) return;
  rngManualRollCycleActive = true;
  rngManualRollCycleId = null;
  rngManualRollPresentationDone = false;
  rngManualRollCompleting = false;
  rngRollExperience?.beginRequest();
  rngRequestRunning = true; if (rngState) renderRngState(rngState);
  try {
    const outcome = await window.ntc.rollRng();
    if (outcome?.accepted !== true) {
      clearManualRollCycleState();
      return;
    }
    rngManualRollCycleId = outcome.cycleId;
    if (rngManualRollPresentationDone) void tryCompleteManualRollCycle();
  } catch (error) {
    rngRollExperience?.requestFailed();
    clearManualRollCycleState();
    showToast(cleanError(error));
  }
  finally { rngRequestRunning = false; if (rngState) renderRngState(rngState); }
}
async function toggleRngAutoRoll() {
  if (rngRequestRunning || pendingRngSystemUnlockId(rngState) || rngSystemUnlockAckPending) return;
  if (!rngState?.autoRollActive && rngState?.autoRollUnlocked !== true) {
    showToast('A Rolagem Automática é desbloqueada no Nível 2.');
    return;
  }
  rngRequestRunning = true; if (rngState) renderRngState(rngState);
  try { await window.ntc.setRngAutoRoll(!rngState?.autoRollActive); }
  catch (error) { showToast(cleanError(error)); }
  finally { rngRequestRunning = false; if (rngState) renderRngState(rngState); }
}
function updateRecorderStatus(recording = Boolean(screenRecorder.recorder)) { const status = $('#recorderStatus'); if (!status) return; status.classList.toggle('is-recording', recording); $('#recorderState').textContent = recording ? 'Gravando tela' : 'Pronto para gravar'; $('#toggleRecording').textContent = recording ? 'Parar gravação' : 'Iniciar gravação'; if (!recording) $('#recorderTimer').textContent = '00:00:00'; }
async function loadMicrophones() { try { const devices = await navigator.mediaDevices.enumerateDevices(); const select = $('#recordMicrophone'); const selected = localStorage.getItem('ntc-record-microphone') || ''; select.innerHTML = '<option value="">Microfone padrão</option>' + devices.filter(device => device.kind === 'audioinput').map((device, index) => `<option value="${safeText(device.deviceId)}">${safeText(device.label || `Microfone ${index + 1}`)}</option>`).join(''); select.value = selected; } catch { } }
async function getScreenStream(withSystemAudio, withMicrophone, microphoneId = '') {
  const sources = await window.ntc.screenSources(); if (!sources?.length) throw new Error('Nenhuma tela disponível para capturar.');
  const sourceId = sources[0].id; const screen = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: withSystemAudio ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } : false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, minFrameRate: 15, maxFrameRate: 30 } } }), new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo esgotado ao iniciar a captura da tela.')), 8000))]);
  const systemAudioAvailable = screen.getAudioTracks().length > 0;
  if (!withMicrophone) return { stream: screen, withMicrophone: false, systemAudioAvailable };
  try { const microphone = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true, video: false }), new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo esgotado ao solicitar o microfone.')), 8000))]); microphone.getAudioTracks().forEach(track => screen.addTrack(track)); return { stream: screen, withMicrophone: microphone.getAudioTracks().length > 0, systemAudioAvailable }; }
  catch (microphoneError) { return { stream: screen, withMicrophone: false, systemAudioAvailable, microphoneError }; }
}
async function startScreenRecording() {
  if (screenRecorder.recorder) return stopScreenRecording(); if (screenRecorderStarting) return; screenRecorderStarting = true;
  const chosenFolder = localStorage.getItem('ntc-recorder-folder') || folder || await window.ntc.defaultDownloadFolder(); if (!chosenFolder) { screenRecorderStarting = false; return; }
  let stream; let audioWarning = ''; const microphoneId = $('#recordMicrophone').value; let capture;
  try { capture = await getScreenStream(true, true, microphoneId); stream = capture.stream; if (capture.microphoneError) audioWarning = `Microfone indisponível; a gravação seguirá com o áudio do computador. ${cleanError(capture.microphoneError)}`; }
  catch (systemAudioError) {
    try { capture = await getScreenStream(false, true, microphoneId); stream = capture.stream; audioWarning = `Não foi possível capturar o áudio do computador. ${cleanError(systemAudioError)}${capture.microphoneError ? ` Microfone indisponível: ${cleanError(capture.microphoneError)}` : ''}`; }
    catch (screenError) { showToast(`Não foi possível iniciar a captura: ${cleanError(screenError)}`); screenRecorderStarting = false; return; }
  }
  const withMicrophone = capture.withMicrophone;
  const resolution = $('#recordResolution').value || localStorage.getItem('ntc-record-resolution') || 'original'; localStorage.setItem('ntc-record-resolution', resolution); const quality = resolution === 'original' ? 'equilibrada' : 'alta'; const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm'; const recorder = new MediaRecorder(stream, { mimeType }); let session; try { session = await window.ntc.startScreenRecording({ folder: chosenFolder, resolution, quality, withAudio: stream.getAudioTracks().length > 0 }); } catch (error) { stream.getTracks().forEach(track => track.stop()); screenRecorderStarting = false; showToast(`Não foi possível preparar a gravação: ${cleanError(error)}`); return; }
  screenRecorder = { recorder, stream, id: session.id, startedAt: Date.now(), timer: null, chunkChain: Promise.resolve(), withAudio: stream.getAudioTracks().length > 0 }; screenRecorderStarting = false; recorder.ondataavailable = event => { if (event.data.size) screenRecorder.chunkChain = screenRecorder.chunkChain.then(() => event.data.arrayBuffer()).then(buffer => window.ntc.sendScreenRecordingChunk(session.id, buffer)); }; recorder.onerror = () => showToast('A captura encontrou um erro. Tente novamente.'); recorder.onstop = async () => { clearInterval(screenRecorder.timer); try { const result = await Promise.race([screenRecorder.chunkChain.then(() => window.ntc.stopScreenRecording(session.id)), new Promise((_, reject) => setTimeout(() => reject(new Error('A finalização demorou demais.')), 30000))]); addHistory({ title: result.filename, type: 'video', format: 'mp4', quality: 'H.264', size: formatBytes(result.size), file: result.file, time: 'Agora', operation: 'recording' }); showToast('Gravação salva no histórico.'); } catch (error) { await window.ntc.cancelScreenRecording(session.id).catch(() => {}); showToast(cleanError(error)); } finally { stream.getTracks().forEach(track => track.stop()); screenRecorder = { recorder: null, stream: null, id: null, startedAt: 0, timer: null, chunkChain: Promise.resolve(), withAudio: false }; updateRecorderStatus(false); } }; recorder.start(1000); screenRecorder.timer = setInterval(() => { $('#recorderTimer').textContent = formatRecordingTime(Date.now() - screenRecorder.startedAt); }, 250); updateRecorderStatus(true); showToast(audioWarning || (capture.systemAudioAvailable ? (withMicrophone ? 'Áudio do computador e microfone ativados.' : 'Microfone indisponível; gravação com áudio do computador.') : (withMicrophone ? 'Microfone ativado; o áudio do computador não está disponível.' : 'Gravação iniciada sem áudio.'))); }
async function stopScreenRecording() { if (!screenRecorder.recorder) return; $('#recorderState').textContent = 'Finalizando gravação…'; $('#toggleRecording').disabled = true; const recorder = screenRecorder.recorder; recorder.stop(); await new Promise(resolve => { const wait = setInterval(() => { if (!screenRecorder.recorder) { clearInterval(wait); resolve(); } }, 50); }); $('#toggleRecording').disabled = false; }
async function configureRecordingShortcut(value) { const shortcut = String(value || '').trim(); if (!shortcut) { await window.ntc.unregisterScreenShortcut(); localStorage.removeItem('ntc-record-shortcut'); return true; } const result = await window.ntc.registerScreenShortcut(shortcut); if (!result.ok) { showToast(result.message || 'Não foi possível registrar esse atalho.'); return false; } localStorage.setItem('ntc-record-shortcut', shortcut); return true; }
async function configureScreenshotShortcut(value) { const shortcut = String(value || '').trim(); if (!shortcut) { await window.ntc.unregisterScreenshotShortcut(); localStorage.removeItem('ntc-screenshot-shortcut'); return true; } const result = await window.ntc.registerScreenshotShortcut(shortcut); if (!result.ok) { showToast(result.message || 'Não foi possível registrar esse atalho.'); return false; } localStorage.setItem('ntc-screenshot-shortcut', shortcut); return true; }
async function configureQuickScreenshotShortcut(value) { const shortcut = String(value || '').trim(); if (!shortcut) { await window.ntc.unregisterQuickScreenshotShortcut(); localStorage.removeItem('ntc-quick-screenshot-shortcut'); return true; } const destination = localStorage.getItem('ntc-screenshot-folder') || folder || await window.ntc.defaultDownloadFolder(); const result = await window.ntc.registerQuickScreenshotShortcut(shortcut, destination); if (!result.ok) { showToast(result.message || 'Não foi possível registrar o atalho de captura rápida.'); return false; } localStorage.setItem('ntc-quick-screenshot-shortcut', shortcut); return true; }
function shortcutFromEvent(event) { const eventKey = String(event.key || ''); const eventCode = String(event.code || ''); const ignored = ['Control', 'Shift', 'Alt', 'Meta']; if (ignored.includes(eventKey)) return ''; const printScreenKeys = ['PrintScreen', 'Print', 'Snapshot', 'PrtSc', 'PrtScn', 'SysReq']; const hasControl = Boolean(event.ctrlKey || event.control || event.metaKey || event.meta); const isPrintScreen = ['PrintScreen', 'Snapshot'].includes(eventCode) || printScreenKeys.includes(eventKey) || (eventKey === 'Cancel' && hasControl); const keyNames = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', '+': 'Plus' }; const key = isPrintScreen ? 'PrintScreen' : keyNames[eventKey] || (eventKey.length === 1 ? eventKey.toUpperCase() : eventKey); const parts = []; if (hasControl) parts.push('CommandOrControl'); if (event.altKey || event.alt) parts.push('Alt'); if (event.shiftKey || event.shift) parts.push('Shift'); parts.push(key); return parts.join('+'); }
function formatShortcutInput(shortcut) { return shortcut.replace('CommandOrControl', 'Ctrl').replaceAll('PrintScreen', 'Print Screen').replaceAll('+', ' + '); }
function bindShortcutRecorder(selector, storageKey, configure) { const input = $(selector); input.value = formatShortcutInput(localStorage.getItem(storageKey) || ''); input.addEventListener('focus', () => window.ntc.setShortcutRecorderFocused(true)); input.addEventListener('blur', () => window.ntc.setShortcutRecorderFocused(false)); input.addEventListener('keydown', async event => { event.preventDefault(); if (event.key === 'Backspace' || event.key === 'Delete') { input.value = ''; await configure(''); return; } const shortcut = shortcutFromEvent(event); if (!shortcut) return; input.value = formatShortcutInput(shortcut); const saved = await configure(shortcut); if (!saved) input.value = formatShortcutInput(localStorage.getItem(storageKey) || ''); }); }
window.ntc.onShortcutRecorderInput(input => { const target = document.activeElement; if (!target?.classList.contains('shortcut-input')) return; target.dispatchEvent(new KeyboardEvent('keydown', { key: input.key, code: input.code, ctrlKey: input.ctrlKey, metaKey: input.metaKey, altKey: input.altKey, shiftKey: input.shiftKey, bubbles: true, cancelable: true })); });
async function captureAndEditScreenshot(capture) {
  if (screenshotCaptureBusy || !$('#screenshotEditorDialog').classList.contains('hidden')) return;
  screenshotCaptureBusy = true;
  try {
    if (!capture?.dataUrl) throw new Error('A captura não contém uma imagem válida.');
    const destination = localStorage.getItem('ntc-screenshot-folder') || folder || await window.ntc.defaultDownloadFolder();
    await window.ntc.showWindowFromScreenshot();
    let savedOrCopied = false;
    window.NTC_ScreenshotEditor.open({
      dataUrl: capture.dataUrl,
      initialTool: 'crop',
      onSave: async blob => {
        const result = await window.ntc.saveScreenshot(destination, new Uint8Array(await blob.arrayBuffer()));
        addHistory({ title: result.filename, type: 'image', format: 'PNG', quality: 'captura anotada', size: formatBytes(result.size), file: result.file, time: 'Agora', operation: 'screenshot' });
        savedOrCopied = true; showToast('Captura anotada salva no Histórico.');
      },
      onCopy: async blob => { await window.ntc.copyScreenshot(new Uint8Array(await blob.arrayBuffer())); savedOrCopied = true; showToast('Imagem copiada para a área de transferência.'); },
      onClose: () => { if (!savedOrCopied) showToast('Captura descartada sem salvar.'); }
    });
  } catch (error) {
    await window.ntc.showWindowFromScreenshot().catch(() => {});
    showToast(`Não foi possível capturar a tela: ${cleanError(error)}`);
  } finally { screenshotCaptureBusy = false; }
}
function openChangelog() {
  const list = $('#changelogList'); list.replaceChildren(...(window.NTC_CHANGELOG || []).map(entry => {
    const article = document.createElement('article'); article.className = 'changelog-entry';
    const heading = document.createElement('div'); heading.className = 'changelog-entry-heading'; const title = document.createElement('h3'); title.textContent = `v${entry.version}`; const date = document.createElement('time'); date.textContent = entry.date; heading.append(title, date);
    const changes = document.createElement('ul'); entry.changes.forEach(change => { const line = document.createElement('li'); line.textContent = change; changes.append(line); }); article.append(heading, changes); return article;
  }));
  $('#changelogDialog').classList.remove('hidden'); $('#closeChangelog').focus();
}
function openRngPatchNotesDialog() {
  const list = $('#rngPatchNotesDialogList');
  list.replaceChildren(...(window.NTC_RNG_CHANGELOG || []).map(entry => {
    const article = document.createElement('article'); article.className = 'changelog-entry';
    const heading = document.createElement('div'); heading.className = 'changelog-entry-heading'; const title = document.createElement('h3'); title.textContent = entry.title || 'Atualização'; const date = document.createElement('time'); date.textContent = entry.date || ''; heading.append(title, date);
    const changes = document.createElement('ul'); (entry.changes || []).forEach(change => { const line = document.createElement('li'); line.textContent = change; changes.append(line); }); article.append(heading, changes); return article;
  }));
  $('#rngPatchNotesDialog').classList.remove('hidden'); $('#closeRngPatchNotesDialog').focus();
}
function closeRngPatchNotesDialog() { $('#rngPatchNotesDialog').classList.add('hidden'); $('.rng-nav-item.active')?.focus(); }
function showChangelogAfterUpgrade(version) {
  const key = 'ntc-last-seen-changelog-version'; const previousVersion = localStorage.getItem(key);
  const shouldShow = previousVersion ? previousVersion !== version : hadExistingAppData;
  if (shouldShow) window.setTimeout(() => { localStorage.setItem(key, version); openChangelog(); }, 2500);
  else localStorage.setItem(key, version);
}
function changelogLines(notes) { return String(notes || '').split(/\r?\n/).map(line => line.replace(/^\s*[-*•#]+\s*/, '').trim()).filter(Boolean).slice(0, 6); }
function showUpdateNotice(update) {
  const notice = $('#updateNotice'); const status = update?.status || 'idle'; const statusText = $('#updateStatus');
  if (status === 'checking') { statusText.textContent = 'Verificando atualizações…'; return; }
  if (status === 'unavailable') { statusText.textContent = update.message || 'A verificação funciona na versão instalada.'; return; }
  if (status === 'current') { statusText.textContent = `Você já está usando a versão mais recente (v${update.version}).`; showToast('O NTC Utilities está atualizado.'); return; }
  if (status === 'error') { statusText.textContent = update.message || 'Não foi possível verificar atualizações.'; showToast(statusText.textContent); return; }
  if (status === 'available' || status === 'downloading' || status === 'downloaded') {
    const version = update.version ? `v${update.version}` : 'a nova versão'; const downloading = status === 'downloading'; const downloaded = status === 'downloaded';
    statusText.textContent = downloaded ? `${version} está pronta para instalar.` : downloading ? `Baixando ${version}… ${update.percent || 0}%` : `${version} está disponível.`;
    $('#updateTitle').textContent = downloaded ? `${version} pronta para instalar` : `${version} está disponível`;
    $('#updateSummary').textContent = downloaded ? 'A instalação será iniciada ao confirmar.' : downloading ? `Baixando a atualização: ${update.percent || 0}%.` : 'Veja as novidades antes de atualizar.';
    const notes = changelogLines(update.notes); const list = $('#updateNotes'); list.replaceChildren(...notes.map(note => { const li = document.createElement('li'); li.textContent = note; return li; })); list.classList.toggle('hidden', !notes.length);
    const action = $('#updateAction'); action.disabled = downloading; action.textContent = downloaded ? 'Instalar e reiniciar' : downloading ? `Baixando ${update.percent || 0}%` : 'Baixar atualização'; action.dataset.updateStatus = status;
    notice.classList.remove('hidden');
  }
}
function closeConfirm(result) { $('#confirmDialog').classList.add('hidden'); const resolver = confirmResolver; confirmResolver = null; resolver?.(result); }
function confirmAction(title, message, acceptLabel = 'Confirmar') { $('#confirmTitle').textContent = title; $('#confirmMessage').textContent = message; $('#confirmAccept').textContent = acceptLabel; $('#confirmDialog').classList.remove('hidden'); $('#confirmCancel').focus(); return new Promise(resolve => { confirmResolver = resolve; }); }
const RNG_REVEAL_MOTION_KEY = 'ntc-rng-reveal-motion';
const RNG_ROLL_MOTION_KEY = 'ntc-rng-roll-motion';
function applyRngRollPreference() {
  const saved = localStorage.getItem(RNG_ROLL_MOTION_KEY) || 'full';
  const preference = ['full', 'reduced', 'off', 'auto'].includes(saved) ? saved : 'full';
  const systemReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  document.documentElement.dataset.rngRollMotion = preference === 'auto' ? systemReduced ? 'reduced' : 'full' : preference;
  rngRollExperience?.setMotion(document.documentElement.dataset.rngRollMotion);
  const control = $('#rngRollMotion');
  if (control) control.value = preference;
}
function applyRngRevealPreference() {
  const saved = localStorage.getItem(RNG_REVEAL_MOTION_KEY) || 'auto';
  const preference = ['auto', 'reduced', 'off', 'full'].includes(saved) ? saved : 'auto';
  const systemReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  document.documentElement.dataset.rngRevealMotion = preference === 'auto' ? systemReduced ? 'reduced' : 'full' : preference;
  const activeReveal = $('#rngUnlockNotice');
  if (document.documentElement.dataset.rngRevealMotion !== 'full' && !activeReveal?.classList.contains('debug-force-motion')) cancelRngRevealParticles();
  const control = $('#rngRevealMotion');
  if (control) control.value = preference;
}
const rngRevealMotionMedia = window.matchMedia?.('(prefers-reduced-motion: reduce)');
rngRevealMotionMedia?.addEventListener?.('change', () => {
  if ((localStorage.getItem(RNG_REVEAL_MOTION_KEY) || 'auto') === 'auto') applyRngRevealPreference();
  if ((localStorage.getItem(RNG_ROLL_MOTION_KEY) || 'full') === 'auto') applyRngRollPreference();
});
function syncSettings() { $('#folderPath').textContent = folder || 'Downloads'; $('#settingsFolder').textContent = folder || 'Downloads'; $('#videoFolderPath').textContent = folder || 'Downloads'; $('#imageFolderPath').textContent = folder || 'Downloads'; $('#recorderFolderPath').textContent = localStorage.getItem('ntc-recorder-folder') || folder || 'Downloads'; $('#screenshotFolderPath').textContent = localStorage.getItem('ntc-screenshot-folder') || folder || 'Downloads'; $('#qrFolderPath').textContent = folder || 'Downloads'; $('#openFolderAfter').checked = localStorage.getItem('ntc-open-folder') === 'true'; $('#duplicatePolicy').value = localStorage.getItem('ntc-duplicate') || 'rename'; $('#filenameTemplate').value = localStorage.getItem('ntc-filename-template') || 'title'; applyRngRevealPreference(); applyRngRollPreference(); document.documentElement.style.colorScheme = 'dark'; }
async function refreshSpaceHint(estimatedSize = 0) { if (!folder) return; try { const free = await window.ntc.freeSpace(folder); if (!Number.isFinite(free)) { $('#spaceHint').textContent = 'Espaço disponível não informado.'; return; } $('#spaceHint').textContent = estimatedSize ? `Espaço livre: ${formatBytes(free)} · estimativa: ~${formatBytes(estimatedSize)}` : `Espaço livre: ${formatBytes(free)}`; } catch { $('#spaceHint').textContent = 'Espaço disponível não informado.'; } }
function addHistory(item) { history.unshift(item); history.splice(50); localStorage.setItem('ntc-history', JSON.stringify(history)); renderHistory(); }
function compressionIsImage(file) { return /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file || ''); }
async function updateCompressionPreview() { const item = compressionQueue[0]; const card = $('#compressionPreviewCard'); if (!item) { card.classList.add('hidden'); return; } card.classList.remove('hidden'); $('#compressionPreviewTitle').textContent = item.name; if (!compressionIsImage(item.source)) { $('#compressionPreviewOriginal').removeAttribute('src'); $('#compressionPreviewResult').removeAttribute('src'); $('#compressionPreviewMeta').textContent = /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(item.source) ? `Resultado previsto: ${$('#compressionResolution').value === 'original' ? 'resolução original' : `${$('#compressionResolution').value}p`} · ${$('#compressionFps').value} FPS · CRF ${$('#compressionCrf').value} · áudio ${$('#compressionBitrate').value} kbps.` : `Resultado previsto: MP3 · ${$('#compressionBitrate').value} kbps.`; return; } $('#compressionPreviewOriginal').src = sourceUrl(item.source); $('#compressionPreviewMeta').textContent = 'Gerando resultado com estes ajustes…'; try { const preview = await window.ntc.previewImage({ source: item.source, format: 'jpg', quality: $('#compressionImageQuality').value, scale: $('#compressionImageScale').value, keepRatio: true }); $('#compressionPreviewResult').src = preview.dataUrl; $('#compressionPreviewMeta').textContent = `Resultado: ${preview.width} × ${preview.height} · qualidade ${$('#compressionImageQuality').value}%.`; } catch (error) { $('#compressionPreviewMeta').textContent = cleanError(error); } }
function renderCompressionQueue() { $('#compressionCount').textContent = `${compressionQueue.length} ${compressionQueue.length === 1 ? 'item' : 'itens'}`; $('#compressionList').innerHTML = compressionQueue.length ? compressionQueue.map((item, index) => `<article class="queue-item conversion-item"><span class="queue-index">${index + 1}</span><div class="history-copy"><strong>${safeText(item.name)}</strong><span>${safeText(item.status || 'Pronto')}</span></div>${item.status !== 'Comprimindo' ? `<button class="ghost-button" data-compression-remove="${item.id}">Remover</button>` : ''}</article>`).join('') : '<div class="empty-state"><p>Adicione arquivos para comprimir.</p></div>'; $$('[data-compression-remove]').forEach(button => button.onclick = () => { compressionQueue = compressionQueue.filter(item => item.id !== button.dataset.compressionRemove); renderCompressionQueue(); }); updateCompressionControls(); }
function updateCompressionControls() { const source = compressionQueue[0]?.source || ''; const options = $('#compressionPreset').closest('.tool-options'); options.classList.toggle('hidden', !source); const video = /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(source); $$('.compression-video-option').forEach(element => element.classList.toggle('hidden', !video)); $$('.compression-audio-option').forEach(element => element.classList.toggle('hidden', video)); }
async function addCompressionFiles(files) { files.filter(file => /\.(mp4|mkv|mov|avi|webm|m4v|mp3|m4a|aac|wav|flac|ogg|opus|wma)$/i.test(file || '')).forEach(file => { if (!compressionQueue.some(item => item.source === file)) compressionQueue.push({ id: toolId(), source: file, name: file.split(/[\\/]/).pop(), status: 'Pronto' }); }); renderCompressionQueue(); updateCompressionControls(); }
function applyCompressionPreset() { const preset = $('#compressionPreset').value; if (preset === 'equilibrado') Object.assign({ }, { }); const values = preset === 'muito' ? { resolution: '144', fps: 8, crf: 45, bitrate: 16, quality: 5, scale: 20 } : { resolution: '720', fps: 24, crf: 30, bitrate: 64, quality: 60, scale: 60 }; if (preset !== 'manual') { $('#compressionResolution').value = values.resolution; $('#compressionFps').value = values.fps; $('#compressionCrf').value = values.crf; $('#compressionBitrate').value = values.bitrate; $('#compressionImageQuality').value = values.quality; $('#compressionImageScale').value = values.scale; } }
async function startCompressionQueue() { if (compressionRunning) return; compressionRunning = true; let completed = 0; const compressionFolder = localStorage.getItem('ntc-compression-folder') || folder; for (const item of compressionQueue.filter(entry => entry.status === 'Pronto' || entry.status === 'Falhou')) { item.status = 'Comprimindo'; renderCompressionQueue(); try { const result = await window.ntc.startCompression({ ...item, folder: compressionFolder, duplicate: 'rename', resolution: $('#compressionResolution').value, fps: $('#compressionFps').value, crf: $('#compressionCrf').value, audioBitrate: $('#compressionBitrate').value, audioFormat: $('#compressionAudioFormat').value, sampleRate: $('#compressionSampleRate').value, mono: $('#compressionMono').checked }); item.status = 'Concluído'; completed++; addHistory({ title: result.file.split(/[\\/]/).pop(), type: result.kind, format: result.kind === 'video' ? 'MP4' : $('#compressionAudioFormat').value.toUpperCase(), quality: 'comprimido', size: formatBytes(result.size), file: result.file, time: 'Agora', operation: 'compression' }); } catch (error) { item.status = `Falhou: ${cleanError(error)}`; } renderCompressionQueue(); } compressionRunning = false; if (completed) showToast(`${completed === 1 ? 'Arquivo comprimido' : `${completed} arquivos comprimidos`}. Acesse em Histórico.`); }
function showEditAfterDownload(file, title) { downloadedAudioToEdit = { file, title }; $('#downloadedAudioName').textContent = title || 'Download concluído.'; $('#editAfterDownloadModal').classList.remove('hidden'); clearTimeout(editSuggestionTimer); editSuggestionTimer = setTimeout(hideEditAfterDownload, 8000); }
function hideEditAfterDownload() { clearTimeout(editSuggestionTimer); editSuggestionTimer = null; downloadedAudioToEdit = null; $('#editAfterDownloadModal').classList.add('hidden'); }

function renderHistory() {
  renderQrHistory();
  renderSecurityHistory();
  const list = $('#historyList'); const empty = $('#emptyHistory'); const all = $('#allHistory');
  if (!history.length) { list.classList.add('hidden'); empty.classList.remove('hidden'); all.innerHTML = '<div class="empty-state"><div class="empty-icon">◷</div><p>Nenhum arquivo concluído ainda.</p></div>'; return; }
  const filter = $('#historyFilter')?.value || 'all'; const visible = history.map((item, index) => ({ item, index })).filter(({ item }) => filter === 'all' || (filter === 'failed' ? item.state === 'erro' : item.operation === filter));
  const markup = visible.length ? visible.map(({ item, index }) => `<article class="history-item"><div class="history-icon">${item.state === 'erro' ? '!' : (item.type === 'video' ? '▸' : (item.type === 'image' ? '▧' : '♫'))}</div><div class="history-copy"><strong>${safeText(item.title)}</strong><span>${safeText(item.format?.toUpperCase() || '—')} · ${safeText(item.quality || 'original')} · ${safeText(item.size || '—')} · ${safeText(item.state === 'erro' ? 'falhou' : item.time)}</span></div>${item.file ? `<button class="ghost-button" data-open="${index}">Abrir</button><button class="ghost-button" data-folder="${index}">Pasta</button>` : ''}${item.type === 'audio' && (item.file || item.source) ? `<button class="ghost-button" data-edit-audio="${index}">Abrir no Editor</button>` : ''}</article>`).join('') : '<div class="empty-state"><p>Nenhum item neste filtro.</p></div>';
  list.innerHTML = markup; list.classList.remove('hidden'); empty.classList.add('hidden'); all.innerHTML = markup;
  $$('[data-open]').forEach(button => button.onclick = async () => { const result = await window.ntc.openFile(history[button.dataset.open].file); if (result) showToast('Não foi possível abrir o arquivo.'); });
  $$('[data-folder]').forEach(button => button.onclick = async () => { const result = await window.ntc.openFileFolder(history[button.dataset.folder].file); if (result) showToast('Não foi possível abrir a pasta.'); });
  $$('[data-edit-audio]').forEach(button => button.onclick = async () => { const item = history[button.dataset.editAudio]; const source = item?.file || item?.source; if (!source) return; await window.NTCMediaProjectUi?.importAudioPaths([source]); $$('.nav-item').forEach(nav => nav.classList.toggle('active', nav.dataset.view === 'converter')); $$('.view').forEach(view => view.classList.toggle('active', view.id === 'converterView')); });
}

function setHistoryTab(tab) {
  const tabs = { files: 'files', qr: 'qr', security: 'security' };
  for (const [key, name] of Object.entries(tabs)) {
    const active = key === tab;
    $(`#${name}HistoryTab`).classList.toggle('active', active);
    $(`#${name}HistoryTab`).setAttribute('aria-selected', String(active));
    $(`#${name}HistoryPanel`).classList.toggle('hidden', !active);
    $(`#${name}HistoryActions`).classList.toggle('hidden', !active);
  }
}

function renderQrHistory() {
  const list = $('#qrHistoryList');
  if (!list) return;
  if (!qrHistory.length) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">▦</div><p>Nenhum QR Code gerado ainda.</p></div>'; return; }
  list.innerHTML = qrHistory.map((item, index) => `<article class="history-item qr-history-item"><div class="history-icon">▦</div><div class="history-copy"><strong>${safeText(item.title)}</strong><span>${safeText(item.url)} · ${safeText(item.format?.toUpperCase() || 'PNG')} · ${safeText(formatBytes(item.size))} · ${safeText(item.time || '')}</span></div><button class="ghost-button" data-qr-history-open="${index}" type="button">Abrir</button><button class="ghost-button" data-qr-history-folder="${index}" type="button">Pasta</button><button class="ghost-button" data-qr-history-copy="${index}" type="button">Copiar link</button></article>`).join('');
  $$('[data-qr-history-open]').forEach(button => button.onclick = async () => { const result = await window.ntc.openFile(qrHistory[Number(button.dataset.qrHistoryOpen)].file); if (result) showToast('Não foi possível abrir o QR Code.'); });
  $$('[data-qr-history-folder]').forEach(button => button.onclick = async () => { const result = await window.ntc.openFileFolder(qrHistory[Number(button.dataset.qrHistoryFolder)].file); if (result) showToast('Não foi possível abrir a pasta.'); });
  $$('[data-qr-history-copy]').forEach(button => button.onclick = async () => { await window.ntc.copyText(qrHistory[Number(button.dataset.qrHistoryCopy)].url); showToast('Link copiado.'); });
}

function renderSecurityHistory() {
  const list = $('#securityHistoryList');
  if (!list) return;
  if (!securityHistory.length) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">◇</div><p>Arquivos protegidos e restaurados aparecerão aqui.</p></div>'; return; }
  list.innerHTML = securityHistory.map((item, index) => {
    const encrypted = item.action === 'encrypt';
    const action = encrypted ? 'Criptografado' : 'Descriptografado';
    const date = item.time ? new Date(item.time) : null;
    const formattedDate = date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date) : 'Data indisponível';
    const details = [action, formatBytes(Number(item.size) || 0), formattedDate].join(' · ');
    return `<article class="history-item security-history-item"><div class="history-icon">${encrypted ? '◇' : '↩'}</div><div class="history-copy"><strong>${safeText(item.title || 'Arquivo')}</strong><span>${safeText(details)}</span></div>${item.file ? `<button class="ghost-button" data-security-history-open="${index}" type="button">Abrir</button><button class="ghost-button" data-security-history-folder="${index}" type="button">Pasta</button>` : ''}</article>`;
  }).join('');
  $$('[data-security-history-open]').forEach(button => button.onclick = async () => { const result = await window.ntc.openFile(securityHistory[Number(button.dataset.securityHistoryOpen)].file); if (result) showToast('Não foi possível abrir o arquivo.'); });
  $$('[data-security-history-folder]').forEach(button => button.onclick = async () => { const result = await window.ntc.openFileFolder(securityHistory[Number(button.dataset.securityHistoryFolder)].file); if (result) showToast('Não foi possível abrir a pasta.'); });
}

window.addEventListener('ntc-security-history-updated', () => {
  try {
    const entries = JSON.parse(localStorage.getItem('ntc-security-history') || '[]');
    securityHistory.splice(0, securityHistory.length, ...(Array.isArray(entries) ? entries.filter(item => item && typeof item === 'object' && typeof item.file === 'string').slice(0, 100) : []));
    renderSecurityHistory();
  } catch { showToast('Não foi possível atualizar o Histórico de segurança.'); }
});

function normalizeQrInput(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Link vazio.');
  const webProtocol = /^https?:\/\//i.test(raw);
  const hostWithPort = /^[^/:\s]+:\d+(?:[/?#]|$)/.test(raw);
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !webProtocol && !hostWithPort) throw new Error('Use um link que comece com http:// ou https://.');
  const candidate = webProtocol ? raw : `https://${raw}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('Link inválido. Confira o endereço.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('Use um link que comece com http:// ou https://.');
  return url.href;
}

function qrSettings() { return { format: $('#qrFormat').value, size: Number($('#qrSize').value), foreground: $('#qrForeground').value, background: $('#qrBackground').value }; }
function initializeQrSettings() {
  const savedFormat = localStorage.getItem('ntc-qr-format'); if (['png', 'svg'].includes(savedFormat)) $('#qrFormat').value = savedFormat;
  const savedSize = Number(localStorage.getItem('ntc-qr-size')); if (Number.isInteger(savedSize) && savedSize >= 128 && savedSize <= 4096) $('#qrSize').value = String(savedSize);
  for (const [id, key] of [['qrForeground', 'ntc-qr-foreground'], ['qrBackground', 'ntc-qr-background']]) { const saved = localStorage.getItem(key); if (/^#[\da-f]{6}$/i.test(saved || '')) $(`#${id}`).value = saved; }
  $('#qrForegroundValue').textContent = $('#qrForeground').value.toUpperCase(); $('#qrBackgroundValue').textContent = $('#qrBackground').value.toUpperCase(); updateQrContrastWarning();
}
function colorLuminance(hex) { const channels = hex.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]; }
function updateQrContrastWarning() { const first = colorLuminance($('#qrForeground').value); const second = colorLuminance($('#qrBackground').value); const contrast = (Math.max(first, second) + .05) / (Math.min(first, second) + .05); $('#qrContrastWarning').classList.toggle('hidden', contrast >= 4); }
function onQrSettingsChange() {
  if (qrRunning) return;
  $('#qrForegroundValue').textContent = $('#qrForeground').value.toUpperCase(); $('#qrBackgroundValue').textContent = $('#qrBackground').value.toUpperCase();
  updateQrContrastWarning();
  persistQrSettings(); queueQrPreview();
}
function persistQrSettings() { const settings = qrSettings(); for (const [key, value] of Object.entries(settings)) localStorage.setItem(`ntc-qr-${key}`, String(value)); }
function queueQrPreview(itemId = qrSelectedId) {
  qrSelectedId = itemId;
  clearTimeout(qrPreviewTimer);
  qrPreviewTimer = setTimeout(() => renderQrPreview(), 120);
}
async function renderQrPreview() {
  const requestId = ++qrPreviewRequestId;
  const item = qrQueue.find(entry => entry.id === qrSelectedId && entry.url);
  if (!item) { $('#qrPreviewImage').classList.add('hidden'); $('#qrPreviewEmpty').classList.remove('hidden'); $('#qrPreviewStatus').textContent = 'Adicione ou selecione um link válido'; $('#qrPreviewLink').textContent = 'A prévia será exibida aqui.'; return; }
  $('#qrPreviewStatus').textContent = 'Atualizando prévia…'; $('#qrPreviewLink').textContent = item.url;
  try {
    const result = await window.ntc.previewQr({ url: item.url, ...qrSettings() });
    if (requestId !== qrPreviewRequestId) return;
    $('#qrPreviewImage').src = result.dataUrl; $('#qrPreviewImage').classList.remove('hidden'); $('#qrPreviewEmpty').classList.add('hidden'); $('#qrPreviewStatus').textContent = `${result.size} × ${result.size} · ${result.format.toUpperCase()}`;
  } catch (error) {
    if (requestId !== qrPreviewRequestId) return;
    $('#qrPreviewImage').classList.add('hidden'); $('#qrPreviewEmpty').classList.remove('hidden'); $('#qrPreviewStatus').textContent = qrFailureMessage(error);
  }
}

function qrStatusText(item) { return item.status === 'gerando' ? 'Gerando…' : item.status === 'concluido' ? 'Concluído' : item.status === 'erro' ? 'Falhou' : item.status === 'cancelado' ? 'Cancelado' : 'Aguardando'; }
function renderQrQueue() {
  const list = $('#qrQueueList');
  $('#qrQueueCount').textContent = `${qrQueue.length} ${qrQueue.length === 1 ? 'link' : 'links'}`;
  if (!qrQueue.length) list.innerHTML = '<div class="empty-state"><p>Adicione links para começar.</p></div>';
  else list.innerHTML = qrQueue.map((item, index) => `<article class="queue-item qr-queue-item${item.status === 'erro' ? ' has-error' : ''}${item.id === qrSelectedId ? ' selected' : ''}" data-qr-row="${item.id}"><button class="qr-queue-preview" data-qr-preview="${item.id}" type="button" aria-label="Ver prévia do link ${index + 1}">▦</button><div class="queue-item-main"><strong>${safeText(item.url || item.input)}</strong><span>${safeText(item.error || qrStatusText(item))}</span></div>${item.status === 'erro' && item.url ? `<button class="ghost-button" data-qr-retry="${item.id}" type="button"${qrRunning || qrPreparing ? ' disabled' : ''}>Tentar novamente</button>` : ''}<button class="ghost-button" data-qr-remove="${item.id}" type="button"${qrRunning || qrPreparing ? ' disabled' : ''}>Remover</button></article>`).join('');
  $$('[data-qr-preview]').forEach(button => button.onclick = () => { queueQrPreview(button.dataset.qrPreview); renderQrQueue(); });
  $$('[data-qr-retry]').forEach(button => button.onclick = () => { const item = qrQueue.find(entry => entry.id === button.dataset.qrRetry); if (!item?.url || qrRunning || qrPreparing) return; item.status = 'aguardando'; item.error = ''; renderQrQueue(); processQrQueue([item.id]); });
  $$('[data-qr-remove]').forEach(button => button.onclick = () => { if (qrRunning || qrPreparing) return; qrQueue = qrQueue.filter(item => item.id !== button.dataset.qrRemove); if (qrSelectedId === button.dataset.qrRemove) qrSelectedId = qrQueue.find(item => item.url)?.id || null; renderQrQueue(); queueQrPreview(); });
  $('#generateQrCodes').disabled = qrRunning || qrPreparing || !qrQueue.some(item => ['aguardando', 'cancelado'].includes(item.status));
  $('#generateQrCodes').textContent = qrPreparing ? 'Preparando…' : qrRunning ? 'Gerando…' : 'Gerar QR Codes';
  $('#cancelQrQueue').classList.toggle('hidden', !qrRunning);
  $('#cancelQrQueue').disabled = qrCancelRequested; $('#cancelQrQueue').textContent = qrCancelRequested ? 'Parando…' : 'Cancelar fila';
  $('#chooseQrFolder').disabled = qrRunning || qrPreparing;
  [$('#qrLinks'), $('#addQrLinks'), $('#qrForeground'), $('#qrBackground'), $('#qrSize'), $('#qrFormat')].forEach(control => { control.disabled = qrRunning || qrPreparing; });
}

function addQrLinks() {
  const values = $('#qrLinks').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  if (!values.length) { showToast('Cole ao menos um link para continuar.'); return; }
  const added = values.map(input => {
    const item = { id: toolId(), input, url: '', status: 'aguardando', error: '' };
    try { item.url = normalizeQrInput(input); } catch (error) { item.status = 'erro'; item.error = error.message; }
    qrQueue.push(item);
    return item;
  });
  const first = added.find(item => item.url);
  if (first) qrSelectedId = first.id;
  $('#qrLinks').value = '';
  renderQrQueue(); queueQrPreview();
  showToast(`${added.length} ${added.length === 1 ? 'link adicionado' : 'links adicionados'} à fila.`);
}

function qrOutputName(item, index) {
  const host = item.url ? new URL(item.url).hostname.replace(/^www\./i, '') : 'link-invalido';
  return `QR-${String(index + 1).padStart(2, '0')}-${host}`;
}

async function processQrQueue(targetIds = null) {
  if (qrRunning || qrPreparing) return;
  const ids = targetIds || qrQueue.filter(item => ['aguardando', 'cancelado'].includes(item.status)).map(item => item.id);
  const items = ids.map(id => qrQueue.find(item => item.id === id)).filter(item => item?.url);
  if (!items.length) { showToast('Não há links válidos aguardando geração.'); return; }
  qrPreparing = true; renderQrQueue();
  let outputFolder = folder || localStorage.getItem('ntc-folder') || '';
  if (!outputFolder) { try { outputFolder = await window.ntc.defaultDownloadFolder(); } catch { qrPreparing = false; renderQrQueue(); showToast('Não foi possível escolher a pasta de destino.'); return; } }
  if (!folder) { folder = outputFolder; localStorage.setItem('ntc-folder', folder); syncSettings(); }
  qrPreparing = false; qrRunning = true; qrCancelRequested = false;
  const options = qrSettings();
  [$('#qrLinks'), $('#addQrLinks'), $('#qrForeground'), $('#qrBackground'), $('#qrSize'), $('#qrFormat')].forEach(control => { control.disabled = true; });
  renderQrQueue();
  let completed = 0; let failed = 0;
  try {
    for (const item of items) {
      if (qrCancelRequested) { for (const remaining of items.slice(items.indexOf(item))) if (remaining.status === 'aguardando') remaining.status = 'cancelado'; break; }
      item.status = 'gerando'; item.error = ''; renderQrQueue();
      try {
        const result = await window.ntc.generateQr({ id: item.id, url: item.url, name: qrOutputName(item, qrQueue.indexOf(item)), folder: outputFolder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', ...options });
        item.status = 'concluido'; item.error = ''; item.result = result; completed++;
        qrHistory.unshift({ title: result.filename, url: result.url, file: result.file, format: result.format, size: result.size, time: 'Agora' });
        qrHistory.splice(50); localStorage.setItem('ntc-qr-history', JSON.stringify(qrHistory)); renderQrHistory();
      } catch (error) { item.status = 'erro'; item.error = qrFailureMessage(error); failed++; }
      renderQrQueue();
    }
  } finally {
    qrRunning = false;
    [$('#qrLinks'), $('#addQrLinks'), $('#qrForeground'), $('#qrBackground'), $('#qrSize'), $('#qrFormat')].forEach(control => { control.disabled = false; });
    renderQrQueue();
  }
  if (completed || failed) { const summary = []; if (completed) summary.push(`${completed} ${completed === 1 ? 'QR Code salvo' : 'QR Codes salvos'} em ${outputFolder}`); if (failed) summary.push(`${failed} ${failed === 1 ? 'link falhou' : 'links falharam'}; veja os motivos na fila`); showToast(`${summary.join(' · ')}.`); }
  if (completed && $('#openFolderAfter').checked) await window.ntc.openFolder(outputFolder);
}

function clearQrHistoryWithConfirm() {
  if (!qrHistory.length) { showToast('O histórico de QR Codes já está vazio.'); return; }
  confirmAction('Limpar histórico de QR Codes?', 'Serão removidos apenas os registros locais. Os arquivos gerados não serão apagados.', 'Limpar QR Codes').then(accepted => {
    if (!accepted) return;
    qrHistory.length = 0; localStorage.removeItem('ntc-qr-history'); renderQrHistory(); showToast('Histórico de QR Codes limpo.');
  });
}

async function clearSecurityHistoryWithConfirm() {
  if (!securityHistory.length) { showToast('O histórico de segurança já está vazio.'); return; }
  if (!await confirmAction('Limpar histórico de segurança?', 'Serão removidos apenas os registros. Os arquivos não serão apagados.', 'Limpar histórico')) return;
  securityHistory.length = 0;
  localStorage.removeItem('ntc-security-history');
  renderSecurityHistory();
  showToast('Histórico de segurança limpo.');
}

function persistQueue() { localStorage.setItem('ntc-download-queue', JSON.stringify(queue.map(item => ({ ...item, status: item.status === 'baixando' ? 'pausado' : item.status, percent: 0 })))); }
function queueStatusLabel(status) { return ({ aguardando: 'Aguardando', baixando: 'Baixando', pausado: 'Pausado', erro: 'Erro', cancelado: 'Cancelado' }[status] || status); }
function queuePercent(item) { return Math.max(0, Math.min(100, Number(item.percent) || 0)); }
function updateQueueProgress(item) {
  const row = document.querySelector(`[data-queue-progress="${item.downloadId}"]`); if (!row) return;
  const bar = row.querySelector('.queue-progress-fill'); const label = row.querySelector('.queue-progress-percent'); const percent = queuePercent(item);
  if (bar) bar.style.width = `${percent}%`; if (label) label.textContent = `${Math.round(percent)}%`;
}
function renderQueue() {
  const resumable = queue.some(item => ['aguardando', 'pausado', 'erro'].includes(item.status)); $('#queueCount').textContent = `${queue.length} ${queue.length === 1 ? 'item' : 'itens'}`; $('#abortQueue').disabled = !current; $('#abortQueue').classList.toggle('hidden', !current); $('#resumeQueue').classList.toggle('hidden', Boolean(current) || !resumable);
  if (!queue.length) { $('#queueList').innerHTML = '<div class="empty-state"><p>Adicione links à fila para baixá-los em sequência.</p></div>'; return; }
  $('#queueList').innerHTML = queue.map((item, index) => {
    const active = item.status === 'baixando'; const percent = queuePercent(item); const canMove = !active; const actionLabel = item.status === 'erro' ? 'Tentar novamente' : 'Remover da fila';
    const thumbnail = item.thumbnail ? `<img class="queue-thumbnail" src="${safeText(item.thumbnail)}" alt="" />` : '<span class="queue-thumbnail-fallback">♫</span>';
    return `<article class="queue-item download-queue-item ${active ? 'is-active' : ''}" data-queue-item="${item.downloadId}"><span class="queue-index">${index + 1}</span>${thumbnail}<div class="queue-item-main"><div class="queue-item-topline"><strong>${safeText(item.title || item.url)}</strong><span class="queue-item-status" data-status="${safeText(item.status)}">${safeText(queueStatusLabel(item.status))}</span></div><span class="queue-item-meta">${item.type === 'thumbnail' ? 'Thumbnail' : (item.type === 'audio' ? 'Áudio' : 'Vídeo')} · ${item.format.toUpperCase()} · ${safeText(item.quality)}${item.estimatedSize ? ` · ~${formatBytes(item.estimatedSize)}` : ''}</span><div class="queue-progress" data-queue-progress="${item.downloadId}" aria-label="Progresso de ${safeText(item.title || item.url)}"><span class="queue-progress-fill" style="width:${percent}%"></span><small class="queue-progress-percent">${active ? `${Math.round(percent)}%` : ''}</small></div></div>${canMove && index ? `<button class="ghost-button" data-up="${item.downloadId}" aria-label="Mover ${safeText(item.title || item.url)} para cima">↑</button>` : ''}${canMove && index < queue.length - 1 ? `<button class="ghost-button" data-down="${item.downloadId}" aria-label="Mover ${safeText(item.title || item.url)} para baixo">↓</button>` : ''}${item.status === 'erro' || item.status === 'pausado' ? `<button class="ghost-button" data-retry="${item.downloadId}">${item.status === 'pausado' ? 'Retomar' : actionLabel}</button>` : ''}${!active ? `<button class="ghost-button" data-queue-remove="${item.downloadId}" aria-label="Remover ${safeText(item.title || item.url)} da fila">×</button>` : ''}</article>`;
  }).join('');
  $$('[data-queue-remove]').forEach(button => button.onclick = () => { queue = queue.filter(item => item.downloadId !== button.dataset.queueRemove); persistQueue(); renderQueue(); });
  $$('[data-up],[data-down]').forEach(button => button.onclick = () => { const index = queue.findIndex(item => item.downloadId === (button.dataset.up || button.dataset.down)); const next = button.dataset.up ? index - 1 : index + 1; if (next >= 0 && next < queue.length && queue[index].status !== 'baixando' && queue[next].status !== 'baixando') [queue[index], queue[next]] = [queue[next], queue[index]]; persistQueue(); renderQueue(); });
  $$('[data-retry]').forEach(button => button.onclick = () => { const item = queue.find(entry => entry.downloadId === button.dataset.retry); if (item) { item.status = 'aguardando'; item.percent = 0; persistQueue(); startNext(); renderQueue(); } });
}
function setFormatOptions() { const type = $('input[name="downloadType"]:checked').value; const video = type === 'video'; const thumbnail = type === 'thumbnail'; $('#format').innerHTML = thumbnail ? '<option value="jpg">JPG</option><option value="png">PNG</option>' : (video ? '<option value="mp4">MP4</option><option value="webm">WEBM</option>' : '<option value="mp3">MP3</option><option value="m4a">M4A</option><option value="opus">Opus</option>'); $('#quality').disabled = thumbnail; $('#quality').innerHTML = thumbnail ? '<option value="original">Maior disponível</option>' : (video ? '<option value="best">Melhor disponível</option><option value="2160">2160p</option><option value="1440">1440p</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option><option value="360">360p</option><option value="240">240p</option><option value="144">144p</option>' : '<option value="original">Original</option><option value="128">128 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option>'); }
async function chooseFolder() { const chosen = await window.ntc.chooseDownloadFolder(); if (chosen) { folder = chosen; localStorage.setItem('ntc-folder', folder); syncSettings(); refreshSpaceHint(); showToast('Pasta padrão atualizada.'); } }
async function loadPreview() {
  const url = $('#videoUrl').value.trim();
  if (!url) { preview = null; playlist = null; $('#previewCard').classList.add('hidden'); $('#selectPlaylist').classList.add('hidden'); return; }
  $('#previewCard').classList.remove('hidden'); $('#previewTitle').textContent = 'Carregando prévia…'; $('#previewMeta').textContent = 'Consultando informações';
  try { preview = await window.ntc.previewUrl(url); playlist = await window.ntc.playlistPreview(url); if (!playlist.isPlaylist) playlist = null; $('#previewImage').src = playlist?.thumbnail || preview.thumbnail; $('#previewTitle').textContent = playlist?.title || preview.title; $('#previewMeta').textContent = playlist ? `${playlist.entries.length} músicas na playlist` : `${preview.channel} · ${preview.duration}${preview.estimatedSize ? ` · ~${formatBytes(preview.estimatedSize)}` : ''}`; refreshSpaceHint(preview.estimatedSize); $('#selectPlaylist').classList.toggle('hidden', !playlist); $('.url-input-wrap').classList.add('valid'); }
  catch (error) { preview = null; playlist = null; $('#selectPlaylist').classList.add('hidden'); $('#previewTitle').textContent = 'Link indisponível'; $('#previewMeta').textContent = error.message; $('.url-input-wrap').classList.remove('valid'); }
}
function safeBase(value) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').slice(0, 150) || 'download'; }
function downloadBaseName(source) { const title = safeBase(source.title); const channel = safeBase(source.channel || 'Canal'); const template = localStorage.getItem('ntc-filename-template') || 'title'; if (template === 'channel-title') return safeBase(`${channel} - ${title}`); if (template === 'date-title') return safeBase(`${new Date().toISOString().slice(0, 10)} - ${title}`); return title; }
function newJob(source = preview) { if (!source) return null; const format = $('#format').value; return { downloadId: `${Date.now()}-${Math.random().toString(16).slice(2)}`, url: source.webpageUrl || $('#videoUrl').value.trim(), title: source.title, thumbnail: source.thumbnail || '', estimatedSize: Number(source.estimatedSize || 0), filename: `${downloadBaseName(source)}.${format}`, type: $('input[name="downloadType"]:checked').value, format, quality: $('#quality').value, speedLimit: $('#speedLimit').value, folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'aguardando' }; }
function enqueueSources(sources) { let added = 0; sources.forEach(source => { const item = newJob(source); if (item && !queue.some(existing => existing.url === item.url)) { queue.push(item); added++; } }); if (added) { persistQueue(); renderQueue(); startNext(); } return added; }
async function addToQueue() { if (!preview) await loadPreview(); if (!preview) return; const sources = playlist ? playlist.entries : [preview]; const added = enqueueSources(sources); if (!added) { $('#previewMeta').textContent = 'Estes links já estão na fila.'; return; } $('#videoUrl').value = ''; preview = null; playlist = null; $('#previewCard').classList.add('hidden'); $('#selectPlaylist').classList.add('hidden'); }
function setProgress(update) { $('#progressBar').style.width = `${update.percent || 0}%`; $('#progressPercent').textContent = `${Math.round(update.percent || 0)}%`; $('#downloadSpeed').textContent = update.speed || '—'; $('#timeRemaining').textContent = update.eta || '—'; }
async function startNext() {
  if (current) return; const item = queue.find(entry => entry.status === 'aguardando'); if (!item) return;
  current = item; item.status = 'baixando'; item.percent = 0; $('#progressCard').classList.remove('hidden'); $('#statusPill').textContent = 'BAIXANDO'; $('#pauseButton').classList.remove('hidden'); $('#pauseButton').textContent = 'Pausar'; $('#cancelButton').textContent = 'Cancelar'; $('#mediaTitle').textContent = item.title; $('#mediaMeta').textContent = `${item.type === 'audio' ? 'Áudio' : (item.type === 'thumbnail' ? 'Thumbnail' : 'Vídeo')} · ${item.format.toUpperCase()} · ${item.quality}${item.speedLimit ? ` · limite ${item.speedLimit}/s` : ''}`; $('#cancelButton').onclick = () => window.ntc.cancelDownload(item.downloadId); $('#pauseButton').onclick = () => { pausedDownloads.add(item.downloadId); window.ntc.cancelDownload(item.downloadId); }; $('#downloadButton').disabled = true; persistQueue(); renderQueue();
  try { await window.ntc.startDownload(item); } catch (error) { const message = cleanError(error); const wasPaused = pausedDownloads.delete(item.downloadId); item.status = wasPaused ? 'pausado' : (message.includes('cancelado') ? 'cancelado' : 'erro'); const wasAborted = abortedDownloads.delete(item.downloadId); if (item.status === 'erro') addHistory({ title: item.title, type: item.type, format: item.format, quality: item.quality, size: '—', time: 'Agora', operation: 'download', state: 'erro' }); current = null; $('#downloadButton').disabled = false; $('#statusPill').textContent = wasPaused ? 'PAUSADO' : (wasAborted ? 'INTERROMPIDO' : item.status.toUpperCase()); $('#mediaMeta').textContent = wasPaused ? 'Download pausado. Você pode retomá-lo pela fila.' : (wasAborted ? 'Downloads interrompidos pelo usuário.' : message); persistQueue(); renderQueue(); if (!wasPaused) setTimeout(startNext, 0); }
}
window.ntc.onDownloadEvent(update => {
  if (!current || current.downloadId !== update.downloadId || abortedDownloads.has(update.downloadId)) return;
  if (update.status === 'downloading') { current.title = update.title || current.title; current.percent = update.percent || 0; $('#mediaTitle').textContent = current.title; setProgress(update); updateQueueProgress(current); }
  if (update.status === 'complete') { const completed = current; completed.status = 'concluído'; completed.file = update.file; completed.size = formatBytes(update.size); addHistory({ title: completed.title, type: completed.type, format: completed.format, quality: completed.quality, size: completed.size, file: completed.file, time: 'Agora', operation: 'download' }); queue = queue.filter(item => item.downloadId !== completed.downloadId); current = null; $('#statusPill').textContent = 'CONCLUÍDO'; $('#progressPercent').textContent = '100%'; $('#progressBar').style.width = '100%'; $('#mediaTitle').textContent = 'Download concluído'; $('#mediaMeta').textContent = `Salvo em ${completed.folder}`; $('#downloadSpeed').textContent = '—'; $('#timeRemaining').textContent = '0s'; $('#pauseButton').classList.add('hidden'); $('#cancelButton').textContent = 'Abrir pasta'; $('#cancelButton').onclick = () => window.ntc.openFolder(completed.folder); $('#downloadButton').disabled = false; persistQueue(); renderQueue(); if (completed.type === 'audio') showEditAfterDownload(completed.file, completed.title); if ($('#openFolderAfter').checked) window.ntc.openFolder(completed.folder); setTimeout(startNext, 0); }
});

function openPlaylistSelection() { if (!playlist) return; $('#playlistTitle').textContent = playlist.title; $('#playlistSummary').textContent = `${playlist.entries.length} músicas disponíveis`; $('#playlistList').innerHTML = playlist.entries.map((item, index) => `<label class="playlist-item"><input type="checkbox" data-playlist-entry="${index}" checked><span class="playlist-number">${index + 1}</span><img src="${item.thumbnail || ''}" alt=""><span><strong>${safeText(item.title)}</strong><small>${safeText(item.channel || 'YouTube')} · ${safeText(item.duration)}</small></span></label>`).join(''); $$('.nav-item').forEach(item => item.classList.remove('active')); $$('.view').forEach(view => view.classList.remove('active')); $('#playlistView').classList.add('active'); }
function toolId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function renderMediaQueue(kind) { const video = kind === 'video'; const items = video ? videoQueue : imageQueue; const list = $(`#${kind}QueueList`); $(`#${kind}QueueCount`).textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`; const start = $(`#start${video ? 'Videos' : 'Images'}`); start.disabled = !items.some(item => item.status === 'pronto'); start.title = start.disabled ? `Adicione ${video ? 'um vídeo' : 'uma imagem'} à fila para iniciar.` : `Converter ${video ? 'vídeos' : 'imagens'} prontos na fila.`; if (!items.length) { list.innerHTML = `<div class="empty-state"><p>Adicione ${video ? 'vídeos' : 'imagens'} para converter.</p></div>`; return; } list.innerHTML = items.map((item, index) => `<article class="queue-item conversion-item ${item.status === 'erro' ? 'has-error' : ''}"><span class="queue-index">${index + 1}</span><div class="history-copy"><strong>${safeText(item.name)}</strong><span>${safeText(item.status === 'erro' && item.error ? item.error : `${item.meta} · ${item.status}`)}</span></div>${item.status === 'erro' ? `<button class="ghost-button" data-${kind}-retry="${item.id}">Tentar novamente</button>` : ''}${item.status !== 'convertendo' ? `<button class="ghost-button" data-${kind}-remove="${item.id}" aria-label="Remover">Remover</button>` : ''}</article>`).join(''); $$(`[data-${kind}-remove]`).forEach(button => button.onclick = () => { if (video) videoQueue = videoQueue.filter(item => item.id !== button.dataset[`${kind}Remove`]); else imageQueue = imageQueue.filter(item => item.id !== button.dataset[`${kind}Remove`]); renderMediaQueue(kind); if (!video) scheduleImagePreview(); }); $$(`[data-${kind}-retry]`).forEach(button => button.onclick = async () => { const item = items.find(entry => entry.id === button.dataset[`${kind}Retry`]); if (!item) return; item.status = 'pronto'; item.error = ''; if (video) { renderMediaQueue('video'); startNextVideo(); } else { renderMediaQueue('image'); await startImagesWithWarning(); } }); }
async function addVideos(files) { const results = await Promise.allSettled(files.map(file => window.ntc.inspectVideo(file))); let invalid = 0; results.forEach(result => { if (result.status !== 'fulfilled') { invalid++; return; } const info = result.value; if (!videoQueue.some(item => item.source === info.path)) videoQueue.push({ id: toolId(), source: info.path, name: info.name || info.path.split(/[\\/]/).pop(), meta: `${info.width || '—'}×${info.height || '—'} · ${formatEditorTime(info.duration || 0)}`, duration: info.duration || 0, outputName: safeBase((info.name || 'video').replace(/\.[^.]+$/, '')), folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'pronto' }); }); renderMediaQueue('video'); if (invalid) showToast('Alguns arquivos não são vídeos compatíveis.'); }
async function addImages(files) { const results = await Promise.allSettled(files.map(file => window.ntc.inspectImage(file))); let invalid = 0; results.forEach(result => { if (result.status !== 'fulfilled') { invalid++; return; } const info = result.value; if (!imageQueue.some(item => item.source === info.path)) imageQueue.push({ id: toolId(), source: info.path, name: info.name || info.path.split(/[\\/]/).pop(), sourceWidth: info.width, sourceHeight: info.height, meta: `${info.width || '—'}×${info.height || '—'}`, outputName: safeBase((info.name || 'imagem').replace(/\.[^.]+$/, '')), folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'pronto' }); }); renderMediaQueue('image'); if (invalid) showToast('Alguns arquivos não são imagens compatíveis.'); }
function startNextVideo() { if (currentVideo) return; const item = videoQueue.find(entry => entry.status === 'pronto'); if (!item) return; currentVideo = item; Object.assign(item, { format: $('#videoFormat').value, codec: $('#videoCodec').value, resolution: $('#videoResolution').value, quality: $('#videoQuality').value, audioMode: $('#videoAudio').value, folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'convertendo', error: '' }); $('#videoProgress').classList.remove('hidden'); $('#videoStatus').textContent = 'CONVERTENDO'; $('#videoTitle').textContent = item.name; $('#videoPercent').textContent = '0%'; $('#videoProgressBar').style.width = '0%'; $('#videoMeta').textContent = 'Preparando conversão…'; $('#cancelVideo').hidden = false; $('#openVideoOutputFolder').hidden = true; $('#cancelVideo').onclick = () => window.ntc.cancelVideoConversion(item.id); renderMediaQueue('video'); window.ntc.startVideoConversion(item).catch(error => { item.status = 'erro'; item.error = cleanError(error); currentVideo = null; $('#videoStatus').textContent = 'ERRO'; $('#videoPercent').textContent = 'ERRO'; $('#videoMeta').textContent = `${item.error} Use “Tentar novamente” na fila após conferir as opções.`; $('#cancelVideo').hidden = true; renderMediaQueue('video'); setTimeout(startNextVideo, 0); }); }
function startNextImage() { if (currentImage) return; const item = imageQueue.find(entry => entry.status === 'pronto'); if (!item) return; currentImage = item; Object.assign(item, { format: $('#imageFormat').value, quality: $('#imageQuality').value, scale: $('#imageScale').value, width: $('#imageWidth').value, height: $('#imageHeight').value, keepRatio: $('#imageKeepRatio').checked, folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'convertendo', error: '' }); $('#imageProgress').classList.remove('hidden'); $('#imageStatus').textContent = 'CONVERTENDO'; $('#imageTitle').textContent = item.name; $('#imagePercent').textContent = '0%'; $('#imageProgressBar').style.width = '0%'; $('#cancelImage').textContent = 'Cancelar'; $('#cancelImage').onclick = () => window.ntc.cancelImageConversion(item.id); renderMediaQueue('image'); window.ntc.startImageConversion(item).catch(error => { const reason = cleanError(error); item.status = 'erro'; item.error = reason; lastFailedImage = item; currentImage = null; $('#imageStatus').textContent = 'FALHOU'; $('#imagePercent').textContent = 'ERRO'; $('#imageProgressBar').style.width = '100%'; $('#imageMeta').textContent = `${reason} Ajuste tamanho, escala ou formato e tente novamente.`; $('#cancelImage').textContent = 'Tentar com ajustes atuais'; $('#cancelImage').onclick = async () => { item.status = 'pronto'; item.error = ''; lastFailedImage = null; $('#imageStatus').textContent = 'TENTANDO NOVAMENTE'; $('#imagePercent').textContent = '0%'; $('#imageProgressBar').style.width = '0%'; renderMediaQueue('image'); await startImagesWithWarning(); }; renderMediaQueue('image'); showToast('A conversão falhou. O motivo e a ação para tentar novamente estão na fila.'); }); }
window.ntc.onVideoEvent(update => { if (!currentVideo || update.id !== currentVideo.id) return; if (update.status === 'converting') { $('#videoPercent').textContent = `${Math.round(update.percent || 0)}%`; $('#videoProgressBar').style.width = `${update.percent || 0}%`; } if (update.status === 'complete') { const item = currentVideo; addHistory({ title: item.outputName, type: 'video', format: item.format, quality: item.quality, size: formatBytes(update.size), file: update.file, source: item.source, operation: 'conversion', time: 'Agora' }); videoQueue = videoQueue.filter(entry => entry.id !== item.id); currentVideo = null; $('#videoStatus').textContent = 'CONCLUÍDO'; $('#videoPercent').textContent = '100%'; $('#videoProgressBar').style.width = '100%'; $('#videoMeta').textContent = `Salvo como ${update.filename}`; $('#cancelVideo').hidden = true; $('#openVideoOutputFolder').hidden = false; $('#openVideoOutputFolder').onclick = async () => { try { const error = await window.ntc.openFileFolder(update.file); if (error) showToast('Não foi possível abrir a pasta do vídeo.'); } catch { showToast('Não foi possível abrir a pasta do vídeo.'); } }; if ($('#openFolderAfter').checked) window.ntc.openFolder(item.folder); renderMediaQueue('video'); setTimeout(startNextVideo, 0); } });
window.ntc.onImageEvent(update => { if (!currentImage || update.id !== currentImage.id) return; if (update.status === 'converting') { $('#imagePercent').textContent = `${Math.round(update.percent || 0)}%`; $('#imageProgressBar').style.width = `${update.percent || 0}%`; } if (update.status === 'complete') { const item = currentImage; addHistory({ title: item.outputName, type: 'image', format: item.format, quality: `${item.quality}%`, size: formatBytes(update.size), file: update.file, source: item.source, operation: 'conversion', time: 'Agora' }); imageQueue = imageQueue.filter(entry => entry.id !== item.id); currentImage = null; $('#imageStatus').textContent = 'CONCLUÍDO'; $('#imagePercent').textContent = '100%'; $('#imageProgressBar').style.width = '100%'; $('#imageMeta').textContent = `Salvo em ${item.folder} · ${update.filename}`; $('#cancelImage').textContent = 'Abrir pasta'; $('#cancelImage').onclick = () => window.ntc.openFolder(item.folder); if ($('#openFolderAfter').checked) window.ntc.openFolder(item.folder); renderMediaQueue('image'); scheduleImagePreview(); setTimeout(startNextImage, 0); } });
function bindDropzone(id, choose, add) { const element = $(`#${id}`); element.onclick = async () => add(await choose()); element.onkeydown = async event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); add(await choose()); } }; ['dragenter', 'dragover'].forEach(name => element.addEventListener(name, event => { event.preventDefault(); event.stopPropagation(); element.classList.add('dragging'); })); ['dragleave', 'drop'].forEach(name => element.addEventListener(name, event => { event.preventDefault(); event.stopPropagation(); element.classList.remove('dragging'); })); element.addEventListener('drop', event => { const files = [...event.dataTransfer.files].map(file => file.path || window.ntc.pathForFile(file)).filter(Boolean); if (files.length) add(files); else showToast('Não foi possível acessar o arquivo arrastado. Use o botão de seleção acima.'); }); }
$('#selectPlaylist').onclick = openPlaylistSelection;
$('#resumeQueue').onclick = () => { queue.forEach(item => { if (['pausado', 'erro', 'cancelado'].includes(item.status)) { item.status = 'aguardando'; item.percent = 0; } }); persistQueue(); renderQueue(); startNext(); };
$('#abortQueue').onclick = () => { if (current) { abortedDownloads.add(current.downloadId); window.ntc.cancelDownload(current.downloadId); } queue = []; localStorage.removeItem('ntc-download-queue'); renderQueue(); $('#progressCard').classList.add('hidden'); };
$('#selectAllPlaylist').onclick = () => $$('[data-playlist-entry]').forEach(item => { item.checked = true; });
$('#clearPlaylistSelection').onclick = () => $$('[data-playlist-entry]').forEach(item => { item.checked = false; });
$('#addSelectedPlaylist').onclick = () => { if (!playlist) return; const chosen = $$('[data-playlist-entry]:checked').map(item => playlist.entries[Number(item.dataset.playlistEntry)]); enqueueSources(chosen); $('#videoUrl').value = ''; preview = null; playlist = null; $('#previewCard').classList.add('hidden'); $('#selectPlaylist').classList.add('hidden'); $$('.view').forEach(view => view.classList.remove('active')); $('#downloaderView').classList.add('active'); $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === 'downloader')); };
$('#videoUrl').addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(loadPreview, 650); });
$('#downloadForm').addEventListener('submit', event => { event.preventDefault(); addToQueue(); });
$$('input[name="downloadType"]').forEach(input => input.addEventListener('change', setFormatOptions));
$('#chooseFolder').onclick = chooseFolder; $('#chooseFolderSettings').onclick = chooseFolder;
$('#openFolderAfter').onchange = event => localStorage.setItem('ntc-open-folder', event.target.checked); $('#duplicatePolicy').onchange = event => localStorage.setItem('ntc-duplicate', event.target.value); $('#filenameTemplate').onchange = event => { localStorage.setItem('ntc-filename-template', event.target.value); showToast('Modelo de nome atualizado.'); };
$('#rngRevealMotion').onchange = event => { localStorage.setItem(RNG_REVEAL_MOTION_KEY, event.target.value); applyRngRevealPreference(); showToast('Efeitos de raridade atualizados.'); };
$('#rngRollMotion').onchange = event => { localStorage.setItem(RNG_ROLL_MOTION_KEY, event.target.value); applyRngRollPreference(); showToast('Animação da rolagem atualizada.'); };
async function clearHistoryWithConfirm() { if (!history.length) { showToast('O histórico já está vazio.'); return; } if (!await confirmAction('Limpar histórico?', 'Os registros locais serão removidos. Os arquivos baixados não serão apagados.', 'Limpar')) return; history.length = 0; localStorage.removeItem('ntc-history'); renderHistory(); showToast('Histórico limpo.'); }
async function resetPreferences() { if (!await confirmAction('Restaurar preferências?', 'A pasta, os atalhos de captura, a abertura automática, a regra de duplicatas, o modelo de nome e as animações do NTC RNG voltarão ao padrão.', 'Restaurar')) return; localStorage.removeItem('ntc-folder'); localStorage.removeItem('ntc-open-folder'); localStorage.removeItem('ntc-duplicate'); localStorage.removeItem('ntc-filename-template'); localStorage.removeItem('ntc-screenshot-folder'); localStorage.removeItem(RNG_REVEAL_MOTION_KEY); localStorage.removeItem(RNG_ROLL_MOTION_KEY); await configureScreenshotShortcut(''); await configureQuickScreenshotShortcut(''); $('#screenshotShortcut').value = ''; $('#quickScreenshotShortcut').value = ''; folder = await window.ntc.defaultDownloadFolder(); localStorage.setItem('ntc-folder', folder); syncSettings(); showToast('Preferências restauradas.'); }
async function checkTools() { const button = $('#checkTools'); button.disabled = true; $('#toolVersions').textContent = 'Verificando yt-dlp, FFmpeg e FFprobe…'; try { const version = await window.ntc.toolVersions(); if (version.error) { $('#toolVersions').textContent = `Erro: ${cleanError(version.error)}`; showToast('Não foi possível verificar as ferramentas.'); } else { $('#toolVersions').textContent = `yt-dlp ${version.ytdlp} · FFmpeg ${version.ffmpeg.match(/ffmpeg version\s+([^\s]+)/i)?.[1] || 'instalado'} · FFprobe ${version.ffprobe.match(/ffprobe version\s+([^\s]+)/i)?.[1] || 'instalado'}`; showToast('Ferramentas verificadas.'); } } catch (error) { $('#toolVersions').textContent = `Erro: ${cleanError(error)}`; showToast('Não foi possível verificar as ferramentas.'); } finally { button.disabled = false; } }
async function checkUpdates() { const button = $('#checkUpdates'); button.disabled = true; $('#updateStatus').textContent = 'Verificando atualizações…'; try { showUpdateNotice(await window.ntc.checkForUpdates()); } catch { showUpdateNotice({ status: 'error', message: 'Não foi possível verificar atualizações agora.' }); } finally { button.disabled = false; } }
let imagePreviewTimer = null;
async function updateImagePreview() { const item = imageQueue[0]; if (!item) { $('#imagePreviewCard').classList.add('hidden'); return; } $('#imagePreviewCard').classList.remove('hidden'); $('#imagePreviewTitle').textContent = item.name; $('#imagePreviewOriginal').src = sourceUrl(item.source); $('#imagePreviewMeta').textContent = 'Gerando o resultado com estes ajustes…'; try { const preview = await window.ntc.previewImage({ source: item.source, format: $('#imageFormat').value, quality: $('#imageQuality').value, scale: $('#imageScale').value, width: $('#imageWidth').value, height: $('#imageHeight').value, keepRatio: $('#imageKeepRatio').checked }); $('#imagePreview').src = preview.dataUrl; $('#imagePreviewMeta').textContent = `Resultado: ${preview.width || 'original'} × ${preview.height || 'original'} · qualidade ${Math.max(1, Math.min(100, Number($('#imageQuality').value) || 85))}%`; } catch (error) { $('#imagePreviewMeta').textContent = cleanError(error); } }
function scheduleImagePreview() { clearTimeout(imagePreviewTimer); imagePreviewTimer = setTimeout(updateImagePreview, 260); }
async function chooseToolFolder() { const chosen = await window.ntc.chooseDownloadFolder(); if (!chosen) return; folder = chosen; localStorage.setItem('ntc-folder', folder); syncSettings(); refreshSpaceHint(); showToast('Pasta de destino atualizada.'); }
function wouldCreateLargeImage() { const scale = Math.max(1, Number($('#imageScale').value) || 100) / 100; const typedWidth = Number($('#imageWidth').value); const typedHeight = Number($('#imageHeight').value); return imageQueue.some(item => Math.max(typedWidth || Math.round((item.sourceWidth || 0) * scale), typedHeight || Math.round((item.sourceHeight || 0) * scale)) > 16384); }
async function startImagesWithWarning() { if (!imageQueue.some(item => item.status === 'pronto') && lastFailedImage) { if (!imageQueue.some(item => item.id === lastFailedImage.id)) imageQueue.push(lastFailedImage); lastFailedImage.status = 'pronto'; lastFailedImage = null; renderMediaQueue('image'); } if (wouldCreateLargeImage()) { const accepted = await confirmAction('Imagem muito grande', 'Este tamanho pode consumir muita memória, travar o computador ou falhar por limite do formato. Deseja tentar mesmo assim?', 'Tentar mesmo assim'); if (!accepted) return; } startNextImage(); }
$('#chooseVideo').onclick = async () => addVideos(await window.ntc.chooseVideoFiles()); $('#chooseImages').onclick = async () => { await addImages(await window.ntc.chooseImageFiles()); scheduleImagePreview(); }; $('#chooseVideoFolder').onclick = chooseToolFolder; $('#chooseImageFolder').onclick = chooseToolFolder; bindDropzone('videoDropzone', () => window.ntc.chooseVideoFiles(), addVideos); bindDropzone('imageDropzone', () => window.ntc.chooseImageFiles(), async files => { await addImages(files); scheduleImagePreview(); }); ['imageFormat', 'imageQuality', 'imageScale', 'imageWidth', 'imageHeight', 'imageKeepRatio'].forEach(id => $(`#${id}`).addEventListener(id === 'imageKeepRatio' ? 'change' : 'input', scheduleImagePreview)); $('#startVideos').onclick = startNextVideo; $('#startImages').onclick = startImagesWithWarning;
$('#clearHistory').onclick = clearHistoryWithConfirm; $('#clearHistorySettings').onclick = clearHistoryWithConfirm; $('#clearHistoryPage').onclick = clearHistoryWithConfirm; $('#resetPreferences').onclick = resetPreferences; $('#checkTools').onclick = checkTools; $('#checkUpdates').onclick = checkUpdates;
$('#filesHistoryTab').onclick = () => setHistoryTab('files'); $('#qrHistoryTab').onclick = () => setHistoryTab('qr'); $('#securityHistoryTab').onclick = () => setHistoryTab('security'); $('#clearQrHistory').onclick = clearQrHistoryWithConfirm; $('#clearSecurityHistory').onclick = clearSecurityHistoryWithConfirm;
$('#addQrLinks').onclick = addQrLinks; $('#qrLinks').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); addQrLinks(); } });
$('#generateQrCodes').onclick = () => { qrQueue.filter(item => item.status === 'cancelado').forEach(item => { item.status = 'aguardando'; }); processQrQueue(); };
$('#cancelQrQueue').onclick = () => { qrCancelRequested = true; $('#cancelQrQueue').disabled = true; $('#cancelQrQueue').textContent = 'Parando…'; };
$('#chooseQrFolder').onclick = async () => { const chosen = await window.ntc.chooseDownloadFolder(); if (!chosen) return; folder = chosen; localStorage.setItem('ntc-folder', folder); syncSettings(); showToast('Pasta de QR Codes atualizada.'); };
['qrForeground', 'qrBackground', 'qrSize', 'qrFormat'].forEach(id => { $(`#${id}`).addEventListener('input', onQrSettingsChange); $(`#${id}`).addEventListener('change', onQrSettingsChange); });
window.ntc.onQrEvent(update => { const item = qrQueue.find(entry => entry.id === update.id); if (!item) return; if (update.status === 'generating') item.status = 'gerando'; if (update.status === 'complete') item.status = 'concluido'; if (update.status === 'failed') { item.status = 'erro'; item.error = qrFailureMessage(update.error); } renderQrQueue(); });
window.ntc.onRngState(renderRngState);
window.ntc.onRngOnlineState(renderRngOnlineState);
window.ntc.getRngOnlineState().then(renderRngOnlineState).catch(() => renderRngOnlineState({ status: 'offline', message: 'Não foi possível consultar o NTC Online.', leaderboard: [] }));
$('#rngOnlineRetry').addEventListener('click', async () => {
  $('#rngOnlineRetry').disabled = true;
  $('#rngOnlineRetry').textContent = 'Conectando…';
  try { renderRngOnlineState(await window.ntc.retryRngOnline()); }
  catch { renderRngOnlineState({ status: 'offline', message: 'Sem conexão. O jogo continua funcionando localmente.', leaderboard: rngOnlineState?.leaderboard || [] }); }
  finally { $('#rngOnlineRetry').disabled = false; $('#rngOnlineRetry').textContent = 'Tentar novamente'; }
});
$('#rngOnlineSetName').addEventListener('click', () => setRngSection('profile'));
$('#rngRollButton').onclick = performManualRngRoll;
$('#rngAutoButton').onclick = toggleRngAutoRoll;
$('#rngSystemUnlockContinue').onclick = continueRngSystemUnlock;
$('#rngSystemUnlockNotice').addEventListener('cancel', event => event.preventDefault());
function setRngSection(section) {
  rngActiveSection = section;
  $$('[data-rng-section]').forEach(tab => tab.classList.toggle('active', tab.dataset.rngSection === section));
  $$('[data-rng-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.rngPanel !== section));
  if (section === 'profile' && rngState && !rngState.playerProfile?.identity?.displayName) openRngProfileNameSetup();
}
function showNewRngPatchNotes() {
  if (!activeAppVersion) { rngPatchNotesOpenPending = true; return; }
  const seenVersionKey = 'ntc-rng-patch-notes-app-version';
  const pendingVersionKey = 'ntc-rng-patch-notes-pending-version';
  if (localStorage.getItem(pendingVersionKey) !== activeAppVersion) return;
  if (localStorage.getItem(seenVersionKey) === activeAppVersion) { localStorage.removeItem(pendingVersionKey); return; }
  openRngPatchNotesDialog();
  localStorage.setItem(seenVersionKey, activeAppVersion);
  localStorage.removeItem(pendingVersionKey);
}
$('.rng-section-tabs').addEventListener('click', event => { const button = event.target.closest('[data-rng-section]'); if (button) setRngSection(button.dataset.rngSection); });
function openRngProfileNameSetup() {
  const dialog = $('#rngProfileNameDialog');
  if (dialog.open || rngState?.playerProfile?.identity?.displayName) return;
  $('#rngProfileNameSetupInput').value = '';
  $('#rngProfileNameCount').textContent = '0 / 32';
  $('#rngProfileNameError').textContent = '';
  dialog.showModal();
  requestAnimationFrame(() => $('#rngProfileNameSetupInput').focus());
}
function renderRngTitlePicker() {
  if (!rngState) return;
  const query = rngTitlePickerQuery.trim().toLocaleLowerCase('pt-BR');
  const titles = rngState.catalog.filter(title => title.collected && (rngTitlePickerTier === 'all' || title.tier === rngTitlePickerTier) && (!query || title.name.toLocaleLowerCase('pt-BR').includes(query)));
  const equippedId = rngState.playerProfile?.identity?.equippedTitleId;
  $('#rngTitlePickerResults').innerHTML = titles.map(title => `<button type="button" class="rng-title-picker-item${title.id === equippedId ? ' is-equipped' : ''}" data-equip-rng-title="${safeText(title.id)}" data-tier="${safeText(title.tier)}"><span class="rng-title-picker-item-art" aria-hidden="true">${rngTitleIcon(title, { size: 60, animation: 'none', eager: true })}</span><span class="rng-title-picker-item-copy"><strong>${safeText(title.name)}</strong><span>${safeText(title.tierLabel)}${title.id === equippedId ? ' · EQUIPADO' : ''}</span><small>${safeText(title.baseOdds || title.currentOdds || '')}</small></span></button>`).join('') || '<div class="rng-discovery-empty">Nenhum título possuído corresponde à busca.</div>';
  $('#rngTitlePickerCount').textContent = `${new Intl.NumberFormat('pt-BR').format(titles.length)} ${titles.length === 1 ? 'título disponível' : 'títulos disponíveis'}`;
  $('#rngTitlePickerClear').disabled = !equippedId || rngTitlePickerBusy;
}
function openRngTitlePicker() {
  if (!rngState?.playerProfile?.identity?.displayName) { openRngProfileNameSetup(); return; }
  rngTitlePickerQuery = '';
  rngTitlePickerTier = 'all';
  $('#rngTitlePickerSearch').value = '';
  const tiersWithTitles = new Set(rngState.catalog.filter(title => title.collected).map(title => title.tier));
  $('#rngTitlePickerTier').innerHTML = '<option value="all">Todas as raridades</option>' + (rngState.tiers || []).filter(tier => tiersWithTitles.has(tier.id)).map(tier => `<option value="${safeText(tier.id)}">${safeText(tier.label)}</option>`).join('');
  $('#rngTitlePickerTier').value = 'all';
  renderRngTitlePicker();
  $('#rngTitlePickerDialog').showModal();
  requestAnimationFrame(() => $('#rngTitlePickerSearch').focus());
}
async function equipRngProfileTitle(equippedTitleId) {
  if (rngTitlePickerBusy) return;
  rngTitlePickerBusy = true;
  renderRngTitlePicker();
  try {
    const result = await window.ntc.setRngProfile({ equippedTitleId });
    if (!result?.ok) throw new Error(result?.reason === 'title-not-owned' ? 'Você só pode equipar títulos que já descobriu.' : 'Não foi possível trocar o título.');
    if (result.state) renderRngState(result.state);
    $('#rngTitlePickerDialog').close();
    showToast(equippedTitleId ? 'Título equipado.' : 'Título removido do perfil.');
  } catch (error) { showToast(cleanError(error)); }
  finally { rngTitlePickerBusy = false; }
}
$('#rngProfileNameSetupInput').addEventListener('input', event => {
  $('#rngProfileNameCount').textContent = `${[...event.target.value].length} / 32`;
  $('#rngProfileNameError').textContent = '';
});
$('#rngProfileNameForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#rngProfileNameConfirm');
  const displayName = $('#rngProfileNameSetupInput').value;
  button.disabled = true;
  try {
    const result = await window.ntc.setRngProfile({ displayName });
    const messages = { 'name-empty': 'Digite um nome para confirmar sua identidade.', 'name-too-long': 'Use no máximo 32 caracteres.', 'name-locked': 'Este nome já foi confirmado.' };
    if (!result?.ok) throw new Error(messages[result?.reason] || 'Não foi possível criar sua identidade.');
    if (result.state) renderRngState(result.state);
    $('#rngProfileNameDialog').close();
    showToast('Identidade criada.');
  } catch (error) { $('#rngProfileNameError').textContent = cleanError(error); }
  finally { button.disabled = false; }
});
$('#rngProfileNameDialog').addEventListener('cancel', event => { if (!rngState?.playerProfile?.identity?.displayName) event.preventDefault(); });
$('#rngChangeTitle').addEventListener('click', openRngTitlePicker);
$('#rngTitlePickerClose').addEventListener('click', () => $('#rngTitlePickerDialog').close());
$('#rngTitlePickerSearch').addEventListener('input', event => { rngTitlePickerQuery = event.target.value; renderRngTitlePicker(); });
$('#rngTitlePickerTier').addEventListener('change', event => { rngTitlePickerTier = event.target.value; renderRngTitlePicker(); });
$('#rngTitlePickerResults').addEventListener('click', event => { const button = event.target.closest('[data-equip-rng-title]'); if (button) void equipRngProfileTitle(button.dataset.equipRngTitle); });
$('#rngTitlePickerClear').addEventListener('click', () => void equipRngProfileTitle(null));
function clearRngProfileCardPreview() {
  if (rngProfileCardUrl) URL.revokeObjectURL(rngProfileCardUrl);
  rngProfileCardUrl = '';
  rngProfileCardBytes = null;
  $('#rngProfileShareImage').removeAttribute('src');
  $('#rngProfileShareLoading').textContent = 'Preparando a ficha…';
  $('#rngProfileShareStatus').textContent = '';
  $('#rngProfileCopyImage').disabled = true;
  $('#rngProfileSaveImage').disabled = true;
}
async function renderRngProfileCardPreview(format) {
  const requestId = ++rngProfileCardRenderRequestId;
  rngProfileCardFormat = format === 'portrait' ? 'portrait' : 'landscape';
  $$('#rngProfileShareDialog [data-profile-format]').forEach(button => button.classList.toggle('active', button.dataset.profileFormat === rngProfileCardFormat));
  rngProfileCardBusy = true;
  clearRngProfileCardPreview();
  $('#rngProfileShareLoading').textContent = 'Renderizando em alta resolução…';
  try {
    const result = await window.ntc.renderRngProfileCard(rngProfileCardFormat);
    if (requestId !== rngProfileCardRenderRequestId || !$('#rngProfileShareDialog').open) return;
    rngProfileCardBytes = new Uint8Array(result.png);
    rngProfileCardUrl = URL.createObjectURL(new Blob([rngProfileCardBytes], { type: 'image/png' }));
    $('#rngProfileShareImage').src = rngProfileCardUrl;
    $('#rngProfileShareLoading').textContent = '';
    $('#rngProfileShareStatus').textContent = `${new Intl.NumberFormat('pt-BR').format(result.width)} × ${new Intl.NumberFormat('pt-BR').format(result.height)} · PNG · render dedicado`;
    $('#rngProfileCopyImage').disabled = false;
    $('#rngProfileSaveImage').disabled = false;
  } catch (error) {
    if (requestId !== rngProfileCardRenderRequestId || !$('#rngProfileShareDialog').open) return;
    $('#rngProfileShareLoading').textContent = 'Não foi possível gerar a ficha.';
    $('#rngProfileShareStatus').textContent = cleanError(error);
  } finally { if (requestId === rngProfileCardRenderRequestId) rngProfileCardBusy = false; }
}
$('#rngShareProfile').addEventListener('click', () => {
  clearRngProfileCardPreview();
  rngProfileCardFormat = 'landscape';
  $$('#rngProfileShareDialog [data-profile-format]').forEach(button => button.classList.toggle('active', button.dataset.profileFormat === rngProfileCardFormat));
  $('#rngProfileShareDialog').showModal();
  void renderRngProfileCardPreview('landscape');
});
$('#rngProfileShareDialog').addEventListener('click', event => {
  const formatButton = event.target.closest('[data-profile-format]');
  if (formatButton && formatButton.dataset.profileFormat !== rngProfileCardFormat) void renderRngProfileCardPreview(formatButton.dataset.profileFormat);
});
$('#rngProfileShareClose').addEventListener('click', () => $('#rngProfileShareDialog').close());
$('#rngProfileShareDialog').addEventListener('close', () => { rngProfileCardRenderRequestId++; rngProfileCardBusy = false; clearRngProfileCardPreview(); });
$('#rngProfileCopyImage').addEventListener('click', async () => {
  if (!rngProfileCardBytes) return;
  try { await window.ntc.copyRngProfileCard(rngProfileCardBytes); showToast('Ficha copiada para a área de transferência.'); }
  catch (error) { $('#rngProfileShareStatus').textContent = cleanError(error); }
});
$('#rngProfileSaveImage').addEventListener('click', async () => {
  if (!rngProfileCardBytes) return;
  try {
    const result = await window.ntc.saveRngProfileCard(rngProfileCardBytes);
    if (!result?.canceled) showToast('Ficha PNG salva.');
  } catch (error) { $('#rngProfileShareStatus').textContent = cleanError(error); }
});
$('#rngBuyUpgrade').onclick = () => performRngShopAction('purchaseRngUpgrade', undefined, result => `Sorte permanente aumentada para o nível ${new Intl.NumberFormat('pt-BR').format(result.levels)}.`);
$('#rngBuyEnhancedRecycling').onclick = () => performRngShopAction('purchaseRngEnhancedRecycling', undefined, result => `Reciclagem Aprimorada · nível ${result.level}.`);
$('#rngBuyRollBoost').onclick = () => performRngShopAction('purchaseRngConsumable', 'rolls', () => 'Consumível de 600 rolagens adicionado ao inventário.');
$('#rngBuyTimeBoost').onclick = () => performRngShopAction('purchaseRngConsumable', 'time', () => 'Consumível de 10 minutos adicionado ao inventário.');
$('#rngActivateRollBoost').onclick = () => performRngShopAction('activateRngConsumable', 'rolls', result => result.queued ? 'Bônus de 600 rolagens adicionado à fila.' : 'Bônus ×2 de 600 rolagens ativado.');
$('#rngActivateTimeBoost').onclick = () => performRngShopAction('activateRngConsumable', 'time', result => result.queued ? 'Bônus de 10 minutos adicionado à fila.' : 'Bônus ×2 de 10 minutos ativado.');
$('#rngRelicShop').addEventListener('click', event => {
  const button = event.target.closest('[data-buy-rng-relic]');
  if (button) void performRngShopAction('purchaseRngRelic', button.dataset.buyRngRelic, () => 'Relíquia adicionada ao inventário.');
});
$('#rngRelicInventory').addEventListener('click', event => {
  const equip = event.target.closest('[data-equip-rng-relic]');
  const unequip = event.target.closest('[data-unequip-rng-relic]');
  if (equip) void performRngShopAction('equipRngRelic', equip.dataset.equipRngRelic, () => 'Relíquia equipada.');
  else if (unequip) void performRngShopAction('unequipRngRelic', unequip.dataset.unequipRngRelic, () => 'Relíquia retirada.');
});
$('#rngRelicSlots').addEventListener('click', event => {
  const button = event.target.closest('[data-unequip-rng-relic]');
  if (button) void performRngShopAction('unequipRngRelic', button.dataset.unequipRngRelic, () => 'Relíquia retirada.');
});
$('#rngEventSchedule').addEventListener('click', async event => { const button = event.target.closest('[data-join-rng-event]'); if (!button) return; button.disabled = true; try { renderRngState(await window.ntc.joinRngEvent(button.dataset.joinRngEvent)); } catch (error) { showToast(cleanError(error)); button.disabled = false; } });
$('#rngDebugTrigger').onclick = openRngDebug;
$('#closeRngDebug').onclick = closeRngDebug;
$('#rngDebugDialog').addEventListener('click', event => { if (event.target === $('#rngDebugDialog')) closeRngDebug(); });
const rngOddsHelpDialog = $('#rngOddsHelpDialog');
const closeRngOddsHelp = () => { if (rngOddsHelpDialog.open) rngOddsHelpDialog.close(); };
$('#rngOddsHelpButton').onclick = () => rngOddsHelpDialog.showModal();
$('#closeRngOddsHelp').onclick = closeRngOddsHelp;
$('#acknowledgeRngOddsHelp').onclick = closeRngOddsHelp;
rngOddsHelpDialog.addEventListener('click', event => { if (event.target === rngOddsHelpDialog) closeRngOddsHelp(); });
$('#rngUnlockContinue').onclick = dismissRngUnlock;
$('#rngUnlockNotice').addEventListener('cancel', event => { event.preventDefault(); dismissRngUnlock(); });
$('#rngDebugTitleSelect').onchange = () => { $('#rngDebugStatus').textContent = ''; updateRngDebugControls(); };
$('#rngDebugSimulate').onclick = simulateRngUnlock;
$('#rngDebugSoundTest').onclick = previewRngTitleSound;
$('#rngDebugIconSelect').onchange = renderRngDebugIconPreview;
$('#rngDebugIconMotion').onchange = renderRngDebugIconPreview;
$('#rngDebugIconPlay').onclick = playRngDebugIcon;
$('#rngDebugAdd').onclick = debugAddSelectedRngTitle;
$('#rngDebugRemove').onclick = debugRemoveSelectedRngTitle;
$('#rngDebugClearAll').onclick = debugClearRngCollection;
$('#rngDebugResetStart').onclick = openRngAccountResetConfirmation;
$('#rngDebugResetCancel').onclick = closeRngAccountResetConfirmation;
$('#rngDebugResetPhrase').addEventListener('input', event => { $('#rngDebugResetConfirmButton').disabled = event.currentTarget.value.trim() !== 'RESETAR CONTA'; });
$('#rngDebugResetConfirmButton').onclick = debugResetRngAccount;
$('#rngDebugTierSelect').onchange = () => { $('#rngDebugStatus').textContent = ''; updateRngDebugControls(); };
$('#rngDebugGrantTier').onclick = () => debugRngAction('tier');
$('#rngDebugTotalMilestone').onchange = () => { $('#rngDebugStatus').textContent = ''; updateRngDebugControls(); };
$('#rngDebugGrantTotalTitles').onclick = () => debugRngAction('total');
$('#rngDebugBonus').onclick = () => debugRngAction('bonus');
initializeRngDebug();
$('#rngTierFilters').addEventListener('click', event => { const tab = event.target.closest('[data-rng-tier]'); if (!tab) return; rngSelectedTier = tab.dataset.rngTier; if (rngState) renderRngState(rngState); });
$('#rngTitleHistorySearch').addEventListener('input', event => { rngHistoryQuery = event.currentTarget.value; if (rngState) renderRngTitleHistory(rngState); });
$('#rngTitleHistoryTier').addEventListener('change', event => { rngHistoryTier = event.currentTarget.value; if (rngState) renderRngTitleHistory(rngState); });
window.addEventListener('focus', () => { if ($('#rngView').classList.contains('active')) loadRngState(); });
document.addEventListener('visibilitychange', () => rngRollExperience?.setVisible(!document.hidden && $('#rngView').classList.contains('active')));
window.addEventListener('pagehide', () => rngRollExperience?.dispose(), { once: true });
loadRngState(); rngTimer = setInterval(updateRngTimers, 1000);
$('#chooseRecorderFolder').onclick = async () => { const chosen = await window.ntc.chooseDownloadFolder(); if (!chosen) return; localStorage.setItem('ntc-recorder-folder', chosen); syncSettings(); showToast('Pasta de gravações atualizada.'); };
$('#chooseScreenshotFolder').onclick = async () => { const chosen = await window.ntc.chooseDownloadFolder(); if (!chosen) return; localStorage.setItem('ntc-screenshot-folder', chosen); const shortcut = localStorage.getItem('ntc-quick-screenshot-shortcut'); if (shortcut) await configureQuickScreenshotShortcut(shortcut); syncSettings(); showToast('Pasta de capturas atualizada.'); };
$('#chooseCompression').onclick = async () => addCompressionFiles(await window.ntc.chooseCompressorFiles()); $('#compressionDropzone').onclick = async () => addCompressionFiles(await window.ntc.chooseCompressorFiles()); bindDropzone('compressionDropzone', () => window.ntc.chooseCompressorFiles(), addCompressionFiles); $('#compressionPreset').onchange = () => { applyCompressionPreset(); updateCompressionPreview(); }; ['compressionResolution', 'compressionFps', 'compressionCrf', 'compressionBitrate', 'compressionImageQuality', 'compressionImageScale'].forEach(id => $(`#${id}`).addEventListener('input', updateCompressionPreview)); $('#startCompression').onclick = startCompressionQueue; $('#chooseCompressionFolder').onclick = async () => { const chosen = await window.ntc.chooseDownloadFolder(); if (chosen) { localStorage.setItem('ntc-compression-folder', chosen); $('#compressionFolderPath').textContent = chosen; } };
$('#recordResolution').value = localStorage.getItem('ntc-record-resolution') || 'original'; $('#recordResolution').addEventListener('change', event => localStorage.setItem('ntc-record-resolution', event.target.value)); $('#toggleRecording').onclick = startScreenRecording;
$('#recordMicrophone').addEventListener('change', event => localStorage.setItem('ntc-record-microphone', event.target.value));
const legacyRecordShortcut = localStorage.getItem('ntc-record-shortcut'); if (legacyRecordShortcut === 'Ctrl+Shift+R') localStorage.removeItem('ntc-record-shortcut');
for (const shortcutKey of ['ntc-record-shortcut', 'ntc-screenshot-shortcut', 'ntc-quick-screenshot-shortcut']) if (localStorage.getItem(shortcutKey) === 'CommandOrControl+Cancel') localStorage.setItem(shortcutKey, 'CommandOrControl+PrintScreen');
bindShortcutRecorder('#recordShortcut', 'ntc-record-shortcut', configureRecordingShortcut);
bindShortcutRecorder('#screenshotShortcut', 'ntc-screenshot-shortcut', configureScreenshotShortcut);
bindShortcutRecorder('#quickScreenshotShortcut', 'ntc-quick-screenshot-shortcut', configureQuickScreenshotShortcut);
if (localStorage.getItem('ntc-record-shortcut')) void configureRecordingShortcut(localStorage.getItem('ntc-record-shortcut'));
if (localStorage.getItem('ntc-screenshot-shortcut')) void configureScreenshotShortcut(localStorage.getItem('ntc-screenshot-shortcut'));
if (localStorage.getItem('ntc-quick-screenshot-shortcut')) void configureQuickScreenshotShortcut(localStorage.getItem('ntc-quick-screenshot-shortcut'));
window.ntc.onScreenHotkey(() => startScreenRecording());
window.ntc.onScreenshotHotkeyCapture(captureAndEditScreenshot);
window.ntc.onScreenshotHotkeyError(async message => { await window.ntc.showWindowFromScreenshot(); showToast(`Falha ao capturar a tela: ${cleanError(message)}`); });
window.ntc.onQuickScreenshotSaved(result => { addHistory({ title: result.filename, type: 'image', format: 'PNG', quality: 'captura rápida', size: formatBytes(result.size), file: result.file, time: 'Agora', operation: 'quick-screenshot' }); showToast(`Captura rápida salva: ${result.filename}`); });
window.ntc.onQuickScreenshotError(message => showToast(`Falha na captura rápida: ${cleanError(message)}`));
window.ntc.getLaunchAtLogin().then(setting => { $('#launchAtLogin').checked = Boolean(setting.enabled); $('#launchAtLogin').disabled = !setting.supported; }).catch(() => { $('#launchAtLogin').disabled = true; });
$('#launchAtLogin').addEventListener('change', async event => { const input = event.currentTarget; input.disabled = true; try { const result = await window.ntc.setLaunchAtLogin(input.checked); if (!result.ok) { input.checked = !input.checked; showToast(result.message || 'Não foi possível alterar a inicialização automática.'); } else showToast(result.enabled ? 'O NTC abrirá ao entrar no Windows.' : 'A inicialização automática foi desativada.'); } catch (error) { input.checked = !input.checked; showToast(cleanError(error)); } finally { input.disabled = false; } });
window.ntc.onScreenCloseRequest(async () => { if (!screenRecorder.recorder) { window.ntc.forceCloseWindow(); return; } const close = await confirmAction('Gravação em andamento', 'Deseja finalizar e salvar a gravação antes de fechar o aplicativo?', 'Salvar e fechar'); if (close) { await stopScreenRecording(); window.ntc.forceCloseWindow(); } });
$('#openChangelog').onclick = openChangelog;
$('#closeChangelog').onclick = () => $('#changelogDialog').classList.add('hidden');
$('#closeRngPatchNotesDialog').onclick = closeRngPatchNotesDialog;
$('#rngPatchNotesDialog').addEventListener('click', event => { if (event.target === $('#rngPatchNotesDialog')) closeRngPatchNotesDialog(); });
$('#dismissUpdate').onclick = () => $('#updateNotice').classList.add('hidden');
$('#updateAction').onclick = async () => { const status = $('#updateAction').dataset.updateStatus; if (status === 'downloaded') { window.ntc.installUpdate(); return; } if (status === 'available') showUpdateNotice(await window.ntc.downloadUpdate()); };
window.ntc.onUpdateEvent(showUpdateNotice);
$('#historyFilter').onchange = renderHistory;
$('#confirmCancel').onclick = () => closeConfirm(false); $('#confirmAccept').onclick = () => closeConfirm(true);
function navigateToView(target, options = {}) {
  const viewTarget = window.NTCRngAvailability?.resolveView(target) || (target === 'rng' ? 'rngMaintenance' : target);
  if (target !== 'microphoneTest') window.NTCMicrophoneTest?.close();
  if (target !== 'webcamTest') window.NTCWebcamTest?.close();
  window.NTCVideoProjectUi?.setWorkspaceActive(viewTarget === 'videoEditor' && !$('#videoProjectPanel')?.classList.contains('hidden'));
  if (target !== 'security' && $('#securityView').classList.contains('active')) window.ntcSecurityUi?.close();
  if (target !== 'studyTools') window.ntcStudyUi?.close();
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === target));
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${viewTarget}View`));
  rngRollExperience?.setVisible(viewTarget === 'rng' && !document.hidden);
  if (viewTarget === 'rng') {
    showNewRngPatchNotes();
    if (rngState) renderRngRollExperience(rngState);
  }
  if (target === 'clipboardHistory') window.ntcClipboardHistoryUi?.open();
  if (target === 'documents') window.ntcDocumentsUi?.open();
  if (target === 'pdf') window.ntcPdfUi?.open();
  if (target === 'studyTools') window.ntcStudyUi?.open();
  if (target === 'medicineReminders') window.NTCMedicineReminders?.open(options.reminderKey);
  if (target === 'storageAnalyzer') window.NTCStorageAnalyzer?.open();
  if (target === 'timeTools') window.ntcWorldClock?.open();
  if (target === 'randomTools') window.NTCRandomTools?.open();
  if (target === 'microphoneTest') window.NTCMicrophoneTest?.open();
  if (target === 'webcamTest') window.NTCWebcamTest?.open();
}
$$('.nav-item[data-view]').forEach(button => button.onclick = () => navigateToView(button.dataset.view));
$$('[data-open-tool]').forEach(button => button.onclick = () => navigateToView(button.dataset.openTool));
$('#closeVideoEditor').onclick = () => navigateToView('home');
function updateMaximizedLayout(maximized) { document.body.classList.toggle('window-maximized', Boolean(maximized)); $('#maximizeWindow').textContent = maximized ? '❐' : '□'; $('#maximizeWindow').setAttribute('aria-label', maximized ? 'Restaurar' : 'Maximizar'); }
$('#minimizeWindow').onclick = () => window.ntc.minimizeWindow(); $('#maximizeWindow').onclick = async () => updateMaximizedLayout(await window.ntc.toggleMaximize()); $('#closeWindow').onclick = () => window.ntc.closeWindow();
window.ntc.isMaximized().then(updateMaximizedLayout); window.ntc.onWindowMaximized(updateMaximizedLayout);
$('#dismissEditAfterDownload').onclick = hideEditAfterDownload;
$('#openDownloadedInEditor').onclick = async () => { const item = downloadedAudioToEdit; hideEditAfterDownload(); if (!item) return; await window.NTCMediaProjectUi?.importAudioPaths([item.file]); $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === 'converter')); $$('.view').forEach(view => view.classList.toggle('active', view.id === 'converterView')); };
document.addEventListener('keydown', async event => {
  const downloaderActive = $('#downloaderView').classList.contains('active'); const tag = event.target?.tagName;
  if (downloaderActive && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !['INPUT', 'TEXTAREA'].includes(tag)) { try { const text = await navigator.clipboard.readText(); if (text) { event.preventDefault(); $('#videoUrl').value = text.trim(); $('#videoUrl').focus(); loadPreview(); } } catch { showToast('Cole o link diretamente no campo.'); } }
  if (event.key === 'Escape' && !$('#confirmDialog').classList.contains('hidden')) return;
  if (event.key === 'Escape' && current) { event.preventDefault(); window.ntc.cancelDownload(current.downloadId); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!$('#confirmDialog').classList.contains('hidden')) { closeConfirm(false); return; }
  if (!$('#clipboardPreviewDialog').classList.contains('hidden')) { window.ntcClipboardHistoryUi?.closePreview(); return; }
  if (!$('#rngPatchNotesDialog').classList.contains('hidden')) { closeRngPatchNotesDialog(); return; }
  if (!$('#changelogDialog').classList.contains('hidden')) { $('#changelogDialog').classList.add('hidden'); return; }
  if (!$('#rngDebugDialog').classList.contains('hidden')) closeRngDebug();
});
initializeQrSettings(); syncSettings(); window.ntcClipboardHistoryUi?.initialize({ showToast, confirmAction }); loadMicrophones(); $('#compressionFolderPath').textContent = localStorage.getItem('ntc-compression-folder') || folder || 'Downloads'; setFormatOptions(); renderHistory(); renderQrQueue(); renderQueue(); renderCompressionQueue(); renderMediaQueue('video'); renderMediaQueue('image');
window.ntc.appVersion().then(version => {
  activeAppVersion = String(version);
  $('#appVersion').textContent = `v${activeAppVersion}`;
  showChangelogAfterUpgrade(activeAppVersion);
  const rngSeenVersion = localStorage.getItem('ntc-rng-patch-notes-app-version');
  if (previouslySeenAppVersion !== activeAppVersion && rngSeenVersion !== activeAppVersion) localStorage.setItem('ntc-rng-patch-notes-pending-version', activeAppVersion);
  if (rngPatchNotesOpenPending) { rngPatchNotesOpenPending = false; showNewRngPatchNotes(); }
}).catch(() => { $('#appVersion').textContent = 'Indisponível'; });
window.ntc.defaultDownloadFolder().then(value => { if (!folder) { folder = value; localStorage.setItem('ntc-folder', folder); syncSettings(); } refreshSpaceHint(); });
window.NTCMediaAppBridge = Object.freeze({ toolId, safeText, formatBytes, cleanError, showToast, addHistory, getFolder: () => folder, setFolder: value => { if (!value) return; folder = value; localStorage.setItem('ntc-folder', value); syncSettings(); refreshSpaceHint(); } });
