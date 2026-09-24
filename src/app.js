const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const splash = $('#splash'); const appShell = $('#appShell'); const loadingProgress = $('#loadingProgress'); const loadingTrack = $('.loading-line');
const previouslySeenAppVersion = localStorage.getItem('ntc-last-seen-changelog-version');
const hadExistingAppData = ['ntc-folder', 'ntc-history', 'ntc-download-queue', 'ntc-theme', 'ntc-screenshot-folder', 'ntc-qr-history'].some(key => localStorage.getItem(key) !== null);
const history = JSON.parse(localStorage.getItem('ntc-history') || '[]');
const qrHistory = (() => { try { return JSON.parse(localStorage.getItem('ntc-qr-history') || '[]').slice(0, 50); } catch { return []; } })();
let folder = localStorage.getItem('ntc-folder') || '';
let queue = (() => { try { return JSON.parse(localStorage.getItem('ntc-download-queue') || '[]').map(item => ({ ...item, status: item.status === 'baixando' ? 'pausado' : item.status, percent: 0 })); } catch { return []; } })(); let current = null; let preview = null; let playlist = null; let previewTimer; const abortedDownloads = new Set(); const pausedDownloads = new Set();
let conversionQueue = []; let currentConversion = null; let editingConversionId = null; const abortedConversions = new Set();
let waveformData = []; let waveformFor = null; let waveformHandle = null; let waveformZoom = 1; let waveformFocus = null; let previewAudio = null; let playbackTime = null; let playbackFrame = null; let previewAudioContext = null; let previewAudioSource = null; let previewEffectNodes = null;
let downloadedAudioToEdit = null; let editSuggestionTimer = null;
let editorUndoStack = []; let editorRedoStack = []; let editorDraft = null;
let audioMarkers = []; let spectrumVisible = false; let videoQueue = []; let currentVideo = null; let imageQueue = []; let currentImage = null; let lastFailedImage = null;
let screenRecorder = { recorder: null, stream: null, id: null, startedAt: 0, timer: null, chunkChain: Promise.resolve(), withAudio: false };
let screenRecorderStarting = false;
let screenshotCaptureBusy = false;
let compressionQueue = []; let compressionRunning = false;
let qrQueue = []; let qrRunning = false; let qrPreparing = false; let qrCancelRequested = false; let qrSelectedId = null; let qrPreviewTimer = null; let qrPreviewRequestId = 0;
let videoEdit = { source: null, meta: null, cuts: [], audioTracks: [], selectionStart: 0, selectionEnd: 0, outputName: '', exporting: false }; let videoEditDrag = null; let videoEditWaveform = [];
let rngState = null; let rngSelectedTier = 'basic'; let rngHistoryQuery = ''; let rngHistoryTier = 'recent'; let rngRequestRunning = false; let rngTimer = null; let rngUnlockTimer = null; let rngAchievementTimer = null; let rngAchievementNextTimer = null; let rngAchievementUnlocks = null; let rngAchievementNoticeQueue = []; let rngAchievementNoticeActive = false; let rngAchievementNoticeCurrentId = null; let rngDebugEnabled = false; let rngDebugPopulated = false;
let rngStateReceivedAt = 0; let rngActiveSection = 'history'; let activeAppVersion = null; let rngPatchNotesOpenPending = false;

let splashValue = 0;
const advanceSplash = () => { splashValue = Math.min(92, splashValue + (splashValue < 70 ? 4 : 1.5)); loadingProgress.style.width = `${splashValue}%`; loadingTrack.setAttribute('aria-valuenow', String(Math.round(splashValue))); };
const splashTimer = setInterval(advanceSplash, 110);
setTimeout(() => { clearInterval(splashTimer); splashValue = 100; loadingProgress.style.width = '100%'; loadingTrack.setAttribute('aria-valuenow', '100'); setTimeout(() => { splash.classList.add('exit'); appShell.classList.add('ready'); appShell.setAttribute('aria-hidden', 'false'); void window.ntc.appEntered().catch(() => {}); }, 260); }, 2100);
function formatBytes(bytes) { if (!bytes) return '—'; const units = ['B', 'KB', 'MB', 'GB']; let n = bytes; let i = 0; while (n > 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; }
function safeText(value) { return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function cleanError(value) { const message = String(value?.message || value || 'Não foi possível concluir a operação.').replace(/^Error invoking remote method ['"]?[^'"]+['"]?: Error:\s*/i, '').replace(/^Error:\s*/i, ''); if (/no space|espaço|disk full/i.test(message)) return 'Sem espaço suficiente na pasta escolhida. Escolha outra pasta ou libere espaço.'; if (/network|connection|timed out|conex/i.test(message)) return 'Falha de conexão. Verifique a internet e tente novamente.'; if (/permission|access is denied|acesso negado|notallowed|denied/i.test(message)) return 'A permissão foi recusada. Verifique o microfone ou escolha gravar somente a tela.'; if (/too large|maximum dimension|jpeg format/i.test(message)) return 'A imagem ficou grande demais para este formato. Diminua largura, altura ou escala e tente novamente.'; if (/invalid|corrupt|corromp/i.test(message)) return 'O arquivo não pôde ser lido. Verifique se ele está completo e em um formato suportado.'; return message; }
let toastTimer = null; let confirmResolver = null;
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800); }
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
  if (consumableMultiplier > 1) labels.push(`Fortuna acumulada ×${consumableMultiplier}`);
  if (result.eventMultiplier > 1) labels.push(`${safeText(result.eventName || 'Evento')} ×${result.eventMultiplier}`);
  const focusMultiplier = Math.max(1, Number(result.eventFocusMultiplier) || 1);
  if (result.eventFocusTierLabel) labels.push(`${safeText(result.eventName || 'Evento')} · ${safeText(result.eventFocusTierLabel)} em foco${focusMultiplier > 1 ? ` ×${focusMultiplier}` : ''}`);
  const combinedMultiplier = sequenceMultiplier * equalHourMultiplier * thousandRollMultiplier * tenThousandRollMultiplier * consumableMultiplier * (result.eventMultiplier || 1) * focusMultiplier;
  if (includeCombined && combinedMultiplier > 1 && labels.length > 1) labels.push(`Bônus acumulados ×${combinedMultiplier}`);
  return labels;
}
function showRngUnlock(result) {
  if (!result?.title) return;
  const notice = $('#rngUnlockNotice');
  notice.dataset.tier = result.title.tier || '';
  $('#rngUnlockTitle').textContent = result.title.name || 'Título novo';
  const details = result.simulation
    ? `${result.title.tierLabel || ''} · ${result.currentOdds || ''} · Simulação visual, sem rolagem`
    : `${result.title.tierLabel || ''} · ${result.currentOdds || ''} · Rolagem #${new Intl.NumberFormat('pt-BR').format(result.roll || 0)}`;
  $('#rngUnlockDetails').textContent = `${details}${result.luckBonusBps ? ` · +${formatRngPercent(result.luckBonusBps)} de sorte permanente` : ''}`;
  notice.setAttribute('aria-hidden', 'false');
  notice.classList.add('show');
  clearTimeout(rngUnlockTimer);
  rngUnlockTimer = setTimeout(() => { notice.classList.remove('show'); notice.setAttribute('aria-hidden', 'true'); }, 4200);
}
function showNextRngAchievementNotice() {
  if (rngAchievementNoticeActive || !rngAchievementNoticeQueue.length) return;
  const achievement = rngAchievementNoticeQueue.shift();
  const notice = $('#rngAchievementNotice');
  rngAchievementNoticeActive = true;
  rngAchievementNoticeCurrentId = achievement.id;
  $('#rngAchievementTitle').textContent = achievement.name;
  $('#rngAchievementDetails').textContent = `${achievement.description}${achievement.luckBonusBps ? ` · +${formatRngPercent(achievement.luckBonusBps)} de sorte permanente` : ''}`;
  notice.setAttribute('aria-hidden', 'false');
  notice.classList.add('show');
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
  $('#rngDebugSelectionState').textContent = title ? `${title.tierLabel} · ${collected ? 'Na coleção' : 'Ainda não coletado'} · ${title.currentOdds}` : '';
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
async function initializeRngDebug() {
  try {
    rngDebugEnabled = await window.ntc.isDevelopmentBuild();
    if (!rngDebugEnabled) return;
    $('#rngDebugTrigger').classList.remove('hidden');
    updateRngDebugControls();
  } catch { rngDebugEnabled = false; }
}
function openRngDebug() {
  if (!rngDebugEnabled) return;
  const dialog = $('#rngDebugDialog');
  dialog.classList.remove('hidden'); dialog.setAttribute('aria-hidden', 'false');
  updateRngDebugControls(); $('#rngDebugTitleSelect').focus();
}
function closeRngDebug() {
  const dialog = $('#rngDebugDialog');
  if (dialog.classList.contains('hidden')) return;
  dialog.classList.add('hidden'); dialog.setAttribute('aria-hidden', 'true'); $('#rngDebugTrigger').focus();
}
function simulateRngUnlock() {
  const title = rngState?.catalog.find(item => item.id === $('#rngDebugTitleSelect').value);
  if (!rngDebugEnabled || !title) return;
  showRngUnlock({ title: { ...title, name: rngState.debugCatalog?.find(item => item.id === title.id)?.name || title.name }, currentOdds: title.currentOdds, simulation: true });
  $('#rngDebugStatus').textContent = 'Animação exibida; coleção e rolagens não foram alteradas.';
}
async function debugAddSelectedRngTitle() {
  if (!rngDebugEnabled) return;
  try {
    const result = await window.ntc.debugAddRngTitle($('#rngDebugTitleSelect').value);
    renderRngState(result.state);
    if (result.added) {
      showRngUnlock({ title: result.title, currentOdds: result.currentOdds, simulation: true });
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
      ? `<div class="rng-discovery-detail"><span><small>Rolagem</small><strong>#${new Intl.NumberFormat('pt-BR').format(record.roll)}</strong></span><span><small>Chance na rolagem</small><strong>${safeText(record.currentOdds || title.baseOdds)}</strong></span></div>`
      : '';
    const meta = rolledAt || bonusBadges ? `<div class="rng-discovery-meta">${rolledAt ? `<span class="rng-discovery-date"><small>Obtido</small><time>${safeText(rolledAt)}</time></span>` : ''}${bonusBadges ? `<div class="rng-discovery-badges">${bonusBadges}</div>` : ''}</div>` : '';
    return `<article class="rng-discovery-card rng-title-history-card${record ? ' has-record' : ''}" data-tier="${safeText(title.tier)}"><span class="rng-discovery-mark" aria-hidden="true">✦</span><div class="rng-discovery-copy"><div class="rng-discovery-name-line"><strong>${safeText(title.name)}</strong><span>${safeText(title.tierLabel)}</span></div>${meta}</div>${detail}</article>`;
  }).join('') || `<div class="rng-discovery-empty">${historyEmptyMessage}</div>`;
}
function rngBigOdds(value) { try { return BigInt(value || 0) > 0n ? `1 em ${new Intl.NumberFormat('pt-BR').format(BigInt(value))}` : '—'; } catch { return '—'; } }
function renderRngExpansion(state) {
  const patchNotes = window.NTC_RNG_CHANGELOG || [];
  $('#rngPatchNotes').innerHTML = patchNotes.map(note => `<article class="rng-patch-note"><header><h3>${safeText(note.title)}</h3><time>${safeText(note.date)}</time></header><ul>${(note.changes || []).map(change => `<li>${safeText(change)}</li>`).join('')}</ul></article>`).join('');
  const number = value => new Intl.NumberFormat('pt-BR').format(value || 0);
  const achievementGroups = new Map();
  for (const item of state.achievements || []) achievementGroups.set(item.category, [...(achievementGroups.get(item.category) || []), item]);
  $('#rngAchievements').innerHTML = [...achievementGroups].map(([category, achievements]) => `<section class="rng-achievement-group"><h3>${safeText(category)}</h3><div class="rng-extra-grid">${achievements.map(item => `<article class="rng-info-card${item.unlocked ? ' unlocked' : ''}"><span class="rng-info-icon">${item.unlocked ? '✦' : '◇'}</span><div><strong>${safeText(item.name)}</strong><p>${safeText(item.description)}</p>${item.rewardText ? `<small class="rng-achievement-reward">Recompensa · ${safeText(item.rewardText)}</small>` : ''}${item.luckBonusBps ? `<small class="rng-achievement-reward">Bônus permanente de sorte · +${formatRngPercent(item.luckBonusBps)}</small>` : ''}<small>${item.unlocked ? 'Concluída' : `${number(item.progress)} / ${number(item.goal)}`}</small></div></article>`).join('')}</div></section>`).join('');
  $('#rngSecrets').innerHTML = (state.secrets || []).map(item => `<article class="rng-info-card unlocked"><span class="rng-info-icon">✧</span><div><strong>${safeText(item.name)}</strong><p>${safeText(item.hint)}</p>${item.luckBonusBps ? `<small class="rng-achievement-reward">Bônus permanente de sorte · +${formatRngPercent(item.luckBonusBps)}</small>` : ''}</div></article>`).join('') || '<p class="rng-section-empty">Nenhum segredo descoberto. Os segredos ocultos não aparecem na coleção.</p>';
  const stats = state.statistics || {};
  const rows = [
    ['Rolagens medidas', number(stats.measuredRolls)], ['Títulos únicos', number(stats.uniqueTitles)], ['Repetidos medidos', number(stats.duplicates)],
    ['Sorte permanente das conquistas', `+${formatRngPercent(state.achievementLuckBps)}`], ['Sorte permanente dos segredos', `+${formatRngPercent(state.secretLuckBps)}`],
    ['Sorte média nas rolagens medidas', stats.averageLuck === null ? 'Ainda não medida' : `×${Number(stats.averageLuck || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`],
    ['Maior multiplicador', `×${number(stats.maxMultiplier || 1)}`], ['Título mais raro', stats.rarestTitle ? `${stats.rarestTitle} · ${rngBigOdds(stats.rarestOdds)}` : 'Ainda não medido'],
    ['Roll mais sortudo', stats.luckiestRoll ? `#${number(stats.luckiestRoll)} · ${rngBigOdds(stats.luckiestOdds)}` : 'Ainda não medido'],
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
    return `<article class="rng-event-card${window.open ? ' is-open' : ''}"><div class="rng-event-main"><span class="rng-event-kicker">${safeText(window.description)} · ${safeText(boostLabel)} · ${window.durationMinutes || Math.round((window.endUtc - window.startUtc) / 60_000)} min</span><strong>${safeText(window.name)}</strong><span class="rng-event-time"><small>${momentLabel}</small><b>${localTime(window.startUtc)}</b></span>${rewardDetails}</div>${window.open ? `<button type="button" class="outline-button" data-join-rng-event="${safeText(window.id)}" ${joined ? 'disabled' : ''}>${joined ? 'Participando' : 'Participar'}</button>` : ''}</article>`;
  }).join('') || '<p class="rng-section-empty">A agenda aparece após verificar a conexão.</p>';
  $('#rngLimitedTitles').innerHTML = (state.limitedTitles || []).map(reward => `<article class="rng-info-card unlocked"><span class="rng-info-icon">✦</span><div><strong>${safeText(reward.name)}</strong><p>Edição ${safeText(reward.edition)}</p></div></article>`).join('') || '<p class="rng-section-empty">Nenhum título limitado obtido.</p>';
}
function formatRngFragments(value) {
  try { return new Intl.NumberFormat('pt-BR').format(BigInt(value || 0)); } catch { return '0'; }
}
function renderRngShop(state) {
  const fragments = BigInt(state.fragments || 0);
  const price = BigInt(state.nextPermanentUpgradeCost || 50_000);
  $('#rngFragmentsBalance').textContent = `${formatRngFragments(fragments)} Fragmentos`;
  $('#rngPermanentLevel').textContent = new Intl.NumberFormat('pt-BR').format(state.permanentUpgradeLevels || 0);
  $('#rngPermanentBonus').textContent = `+${formatRngPercent(state.permanentLuckBps || 0)}`;
  $('#rngBuyUpgrade').textContent = `Comprar por ${formatRngFragments(price)}`;
  $('#rngBuyUpgrade').disabled = fragments < price || rngRequestRunning;
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
  $('#rngBoostQueueLabel').textContent = queue.length ? `Próximos: ${queue.map(boost => boost.type === 'rolls' ? 'Fortuna por rolagens' : 'Fortuna por tempo').join(' → ')}` : 'Nenhuma ativação na fila';
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
  const sourceLabel = relic => relic.source === 'drought'
    ? `Conquista de azar · ${new Intl.NumberFormat('pt-BR').format(relic.droughtGoal || 0)} rolls sem Singular+ na etapa`
    : relic.source === 'random-drop' ? relic.rare ? 'Drop aleatório raríssimo' : 'Drop aleatório'
      : relic.source === 'event' ? `Exclusiva de evento · ${relic.eventId === 'eclipse' ? 'Eclipse' : 'Chuva de Fragmentos'}`
        : relic.source === 'achievement' ? `Conquista · descubra ${new Intl.NumberFormat('pt-BR').format(relic.achievementGoal || 0)} títulos`
          : 'Exclusiva da loja';
  const categoryLabel = relic => relic.setId === 'celestial' ? 'RELÓGIOS CELESTES'
    : relic.setId === 'echoes' ? 'ECOS'
      : relic.setId === 'misfortune' ? 'TRÍADE DO AZAR'
        : relic.source === 'random-drop' ? 'DROP ALEATÓRIO'
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
    return `<article class="rng-relic-card${relic.owned ? ' is-owned' : ' is-locked'}${relic.equipped ? ' is-equipped' : ''}"><span class="rng-relic-icon" aria-hidden="true">${safeText(relic.icon)}</span><div class="rng-relic-copy"><span class="rng-shop-kicker">${safeText(categoryLabel(relic))}</span><h3>${safeText(relic.name)}</h3><p>${safeText(relic.effect)}</p><small>${safeText(sourceLabel(relic))}</small></div>${button}</article>`;
  };
  $('#rngRelicShop').innerHTML = relicState.catalog.filter(relic => relic.purchasable).map(relic => card(relic, 'shop')).join('');
  $('#rngRelicInventory').innerHTML = relicState.catalog.map(relic => card(relic, 'inventory')).join('');
  $('#rngRelicCount').textContent = `${relicState.ownedCount || 0} / ${relicState.catalog.length || 9}`;
  const byId = new Map(relicState.catalog.map(relic => [relic.id, relic]));
  $('#rngRelicSlots').innerHTML = Array.from({ length: 6 }, (_, index) => {
    const relic = byId.get(relicState.slots?.[index]);
    return relic
      ? `<button type="button" class="rng-relic-slot is-filled" data-unequip-rng-relic="${safeText(relic.id)}"><span>${safeText(relic.icon)}</span><strong>${safeText(relic.name)}</strong><small>Retirar</small></button>`
      : `<div class="rng-relic-slot"><span>◇</span><strong>Espaço ${index + 1}</strong><small>Livre</small></div>`;
  }).join('');
  const effectLabels = [...(relicState.activeEffects || [])];
  if ((relicState.fragmentMultiplierBps || 10_000) > 10_000) effectLabels.push(`Fragmentos ×${((relicState.fragmentMultiplierBps || 10_000) / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`);
  $('.rng-relic-effects').style.display = effectLabels.length ? 'grid' : 'none';
  $('#rngRelicEffects').innerHTML = effectLabels.map(label => `<span>${safeText(label)}</span>`).join('');
  $('#rngRelicSets').innerHTML = (relicState.sets || []).map(set => `<article class="rng-set-card${set.complete ? ' is-complete' : ''}"><div><span class="rng-shop-kicker">SET ${set.equippedCount} / ${set.pieceIds.length}</span><strong>${safeText(set.name)}</strong></div><p>${safeText(set.effect)}</p><small>${set.complete ? 'Bônus do set ativo' : 'Equipe as três peças para ativar'}</small></article>`).join('');
}
async function performRngShopAction(action, argument, successMessage) {
  if (rngRequestRunning) return;
  rngRequestRunning = true;
  if (rngState) renderRngState(rngState);
  try {
    const result = await window.ntc[action](...(argument === undefined ? [] : [argument]));
    if (result?.state) renderRngState(result.state);
    if (!result?.ok) {
      const messages = { 'insufficient-fragments': 'Você ainda não tem Fragmentos suficientes.', 'already-owned': 'Essa relíquia já faz parte da sua coleção.', 'already-equipped': 'Essa relíquia já está equipada.', 'no-free-slot': 'Os seis espaços estão ocupados. Retire uma relíquia primeiro.', 'not-owned': 'Essa relíquia ainda não foi encontrada.', 'not-equipped': 'Essa relíquia não está equipada.' };
      showToast(messages[result?.reason] || 'Não foi possível concluir essa ação.');
    }
    else showToast(successMessage(result));
  } catch (error) { showToast(cleanError(error)); }
  finally { rngRequestRunning = false; if (rngState) renderRngState(rngState); }
}
function renderRngState(state) {
  if (!state?.catalog?.length) return;
  const previousRoll = rngState?.totalRolls ?? null;
  const unlockedAchievements = (state.achievements || []).filter(item => item.unlocked);
  const newlyUnlockedAchievements = rngAchievementUnlocks === null
    ? []
    : unlockedAchievements.filter(item => !rngAchievementUnlocks.has(item.id));
  rngAchievementUnlocks = new Set(unlockedAchievements.map(item => item.id));
  if (state !== rngState) rngStateReceivedAt = performance.now();
  rngState = state;
  const totalCollected = state.collectedIds.length;
  $('#rngCollectionCount').textContent = `${totalCollected} / ${state.totalTitles}`;
  $('#rngRollCount').textContent = new Intl.NumberFormat('pt-BR').format(state.totalRolls);
  $('#rngSessionRolls').textContent = new Intl.NumberFormat('pt-BR').format(state.session?.rolls || 0);
  $('#rngSessionBest').textContent = state.session?.bestOdds && state.session.bestOdds !== '0' ? `1 em ${new Intl.NumberFormat('pt-BR').format(BigInt(state.session.bestOdds))}` : '—';
  $('#rngSessionDrought').textContent = state.statistics?.sinceSingular === null ? 'Ainda não medido' : new Intl.NumberFormat('pt-BR').format(state.statistics?.sinceSingular || 0);
  $('#rngProgressBar').style.width = `${Math.min(100, totalCollected / state.totalTitles * 100)}%`;
  $('#rngProgressBar').parentElement.setAttribute('aria-valuenow', String(totalCollected));
  $('#rngProgressBar').parentElement.setAttribute('aria-valuemax', String(state.totalTitles));
  const exactLuckBonus = (() => { try { return (BigInt(state.totalLuckBpsExact || state.totalLuckBps || 10_000) - 10_000n).toString(); } catch { return '0'; } })();
  $('#rngLuckValue').textContent = `+${formatRngExactPercent(exactLuckBonus)}`;
  $('#rngCollectionLuck').textContent = `+${formatRngPercent(state.passiveLuckBps)} coleção`;
  $('#rngAchievementLuck').textContent = `+${formatRngPercent(state.achievementLuckBps)} conquistas`;
  $('#rngSecretLuck').textContent = `+${formatRngPercent(state.secretLuckBps)} segredos`;
  $('#rngUpgradeLuck').textContent = `+${formatRngPercent(state.permanentLuckBps)} loja`;
  $('#rngRelicLuck').textContent = formatRngRelicLuck(state.relicLuckMultiplierBps);
  $('#rngAutoButton').textContent = state.autoRollActive ? 'Pausar Auto-roll' : 'Iniciar Auto-roll';
  $('#rngAutoButton').classList.toggle('is-active', state.autoRollActive);
  $('#rngRollButton').disabled = Boolean(state.autoRollActive || rngRequestRunning);
  $('#rngRollButton').textContent = state.rollsPerCycle > 1 ? `Rolar (${state.rollsPerCycle}×)` : 'Rolar';
  $('#rngAutoButton').disabled = rngRequestRunning;
  $('#rngRollBatchInfo').textContent = `${state.rollsPerCycle} ${state.rollsPerCycle === 1 ? 'rolagem' : 'rolagens'} por ciclo`;
  const rollsUntilBonus = state.bonusRollEvery - state.bonusRollCounter;
  $('#rngBonusRollInfo').textContent = `Rolagem bônus ×${state.bonusMultiplier} em ${rollsUntilBonus} ${rollsUntilBonus === 1 ? 'rolagem' : 'rolagens'}`;
  const rollsUntilThousandBonus = 1000 - (state.totalRolls % 1000);
  $('#rngThousandBonusInfo').textContent = `Mega bônus ×4 em ${new Intl.NumberFormat('pt-BR').format(rollsUntilThousandBonus)} ${rollsUntilThousandBonus === 1 ? 'rolagem' : 'rolagens'}`;
  const rollsUntilTenThousandBonus = 10_000 - (state.totalRolls % 10_000);
  $('#rngTenThousandBonusInfo').textContent = `Bônus supremo ×10 em ${new Intl.NumberFormat('pt-BR').format(rollsUntilTenThousandBonus)} ${rollsUntilTenThousandBonus === 1 ? 'rolagem' : 'rolagens'}`;

  const latest = state.latestResult;
  const resultCard = $('#rngLastResult');
  resultCard.classList.toggle('is-new', Boolean(latest?.isNew));
  resultCard.dataset.tier = latest?.title?.tier || '';
  $('#rngResultCaption').textContent = latest ? `${latest.isNew ? 'NOVO TÍTULO' : 'REPETIDO'} · ${safeText(latest.title.tierLabel || '')}` : 'ÚLTIMO RESULTADO';
  $('#rngResultTitle').textContent = latest?.title?.name || 'Ainda sem rolagens';
  const latestBoosts = latest ? rngRollBoostLabels(latest).join(' · ') : '';
  $('#rngResultOdds').textContent = latest ? `Chance na rolagem · ${latest.currentOdds}${latestBoosts ? ` · ${latestBoosts}` : ''} · +${formatRngFragments(latest.fragmentReward)} Fragmentos · #${new Intl.NumberFormat('pt-BR').format(latest.roll)}` : 'O título e a chance aparecem aqui.';
  const results = Array.isArray(state.latestResults) ? state.latestResults : [];
  const unlockResults = Array.isArray(state.latestUnlocks) ? state.latestUnlocks : results;
  const newUnlocks = unlockResults.filter(result => result.roll > (previousRoll ?? 0) && result.isNew);
  const newlyUnlocked = newUnlocks.at(-1);
  if (previousRoll !== null && newlyUnlocked) {
    showRngUnlock(newlyUnlocked);
    const audibleUnlock = newUnlocks.filter(shouldPlayRngTitleSound).at(-1);
    if (audibleUnlock) void playRngTitleSound(audibleUnlock);
  }
  const specialUnlock = unlockResults.filter(result => result.roll > (previousRoll ?? 0)).flatMap(result => result.specialUnlocks || []).at(-1);
  if (previousRoll !== null && specialUnlock) showRngUnlock({ title: { name: specialUnlock.name, tierLabel: specialUnlock.tierLabel, tier: 'ntc' }, roll: state.totalRolls, currentOdds: specialUnlock.tierLabel, luckBonusBps: specialUnlock.luckBonusBps });
  if (newlyUnlockedAchievements.length) queueRngAchievementNotices(newlyUnlockedAchievements);
  const batchResults = $('#rngBatchResults');
  batchResults.classList.toggle('hidden', results.length < 2);
  batchResults.innerHTML = results.length < 2 ? '' : `${state.latestBatchSize > results.length ? `<div class="rng-batch-summary">Mostrando os ${results.length} resultados mais recentes de ${new Intl.NumberFormat('pt-BR').format(state.latestBatchSize)}.</div>` : ''}${results.map(result => { const boosts = rngRollBoostLabels(result); return `<article class="rng-batch-result${result.isNew ? ' is-new' : ''}" data-tier="${safeText(result.title?.tier || '')}"><span>${result.isNew ? 'NOVO TÍTULO' : 'REPETIDO'} · #${new Intl.NumberFormat('pt-BR').format(result.roll)}${boosts.length ? ` · ${safeText(boosts.join(' · '))}` : ''}</span><strong>${safeText(result.title?.name || '')}</strong><span>${safeText(result.title?.tierLabel || '')} · ${safeText(result.currentOdds || '')} · +${formatRngFragments(result.fragmentReward)} Fragmentos</span></article>`; }).join('')}`;

  renderRngTitleHistory(state);

  const tiers = state.tiers;
  if (!tiers.some(tier => tier.id === rngSelectedTier)) rngSelectedTier = tiers[0]?.id || 'basic';
  $('#rngTierFilters').innerHTML = tiers.map(tier => {
    const inTier = state.catalog.filter(title => title.tier === tier.id);
    const found = inTier.filter(title => title.collected).length;
    return `<button class="rng-tier-tab${tier.id === rngSelectedTier ? ' active' : ''}" type="button" role="tab" aria-selected="${tier.id === rngSelectedTier}" data-rng-tier="${tier.id}"><span>${safeText(tier.label)}</span><small>${found}/${inTier.length}</small></button>`;
  }).join('');
  const visible = state.catalog.filter(title => title.tier === rngSelectedTier);
  const selectedTier = tiers.find(tier => tier.id === rngSelectedTier);
  $('#rngTierCount').textContent = `${visible.filter(title => title.collected).length} / ${visible.length} · ${safeText(selectedTier?.label || '')}`;
  $('#rngCatalog').innerHTML = visible.map(title => `<article class="rng-title-row${title.collected ? ' collected' : ' locked'}"><span class="rng-title-mark">${title.collected ? '✧' : '·'}</span><div class="rng-title-info"><strong>${safeText(title.name)}</strong><span>${title.collected ? 'Obtido' : 'Não encontrado'}</span></div><div class="rng-title-odds"><strong>${safeText(title.currentOdds)}</strong><small>Chance atual</small>${title.currentOdds !== title.baseOdds ? `<small>Base ${safeText(title.baseOdds)}</small>` : ''}</div></article>`).join('');
  renderRngExpansion(state);
  renderRngShop(state);
  renderRngInventory(state);
  renderRngRelics(state);
  updateRngDebugControls(state);
  updateRngTimers();
}
async function loadRngState() { try { renderRngState(await window.ntc.getRngState()); } catch (error) { showToast(`NTC RNG indisponível: ${cleanError(error)}`); } }
async function performManualRngRoll() {
  if (rngRequestRunning || rngState?.autoRollActive) return;
  rngRequestRunning = true; if (rngState) renderRngState(rngState);
  try { await window.ntc.rollRng(); } catch (error) { showToast(cleanError(error)); }
  finally { rngRequestRunning = false; if (rngState) renderRngState(rngState); }
}
async function toggleRngAutoRoll() {
  if (rngRequestRunning) return;
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
function syncSettings() { $('#folderPath').textContent = folder || 'Downloads'; $('#settingsFolder').textContent = folder || 'Downloads'; if (!editingConversionId) $('#converterFolderPath').textContent = folder || 'Downloads'; $('#videoFolderPath').textContent = folder || 'Downloads'; $('#videoEditorFolderPath').textContent = folder || 'Downloads'; $('#imageFolderPath').textContent = folder || 'Downloads'; $('#recorderFolderPath').textContent = localStorage.getItem('ntc-recorder-folder') || folder || 'Downloads'; $('#screenshotFolderPath').textContent = localStorage.getItem('ntc-screenshot-folder') || folder || 'Downloads'; $('#qrFolderPath').textContent = folder || 'Downloads'; $('#openFolderAfter').checked = localStorage.getItem('ntc-open-folder') === 'true'; $('#duplicatePolicy').value = localStorage.getItem('ntc-duplicate') || 'rename'; $('#filenameTemplate').value = localStorage.getItem('ntc-filename-template') || 'title'; document.documentElement.style.colorScheme = 'dark'; }
async function refreshSpaceHint(estimatedSize = 0) { if (!folder) return; try { const free = await window.ntc.freeSpace(folder); if (!Number.isFinite(free)) { $('#spaceHint').textContent = 'Espaço disponível não informado.'; return; } $('#spaceHint').textContent = estimatedSize ? `Espaço livre: ${formatBytes(free)} · estimativa: ~${formatBytes(estimatedSize)}` : `Espaço livre: ${formatBytes(free)}`; } catch { $('#spaceHint').textContent = 'Espaço disponível não informado.'; } }
function addHistory(item) { history.unshift(item); history.splice(50); localStorage.setItem('ntc-history', JSON.stringify(history)); renderHistory(); }
function compressionIsImage(file) { return /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file || ''); }
async function updateCompressionPreview() { const item = compressionQueue[0]; const card = $('#compressionPreviewCard'); if (!item) { card.classList.add('hidden'); return; } card.classList.remove('hidden'); $('#compressionPreviewTitle').textContent = item.name; if (!compressionIsImage(item.source)) { $('#compressionPreviewOriginal').removeAttribute('src'); $('#compressionPreviewResult').removeAttribute('src'); $('#compressionPreviewMeta').textContent = /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(item.source) ? `Resultado previsto: ${$('#compressionResolution').value === 'original' ? 'resolução original' : `${$('#compressionResolution').value}p`} · ${$('#compressionFps').value} FPS · CRF ${$('#compressionCrf').value} · áudio ${$('#compressionBitrate').value} kbps.` : `Resultado previsto: MP3 · ${$('#compressionBitrate').value} kbps.`; return; } $('#compressionPreviewOriginal').src = sourceUrl(item.source); $('#compressionPreviewMeta').textContent = 'Gerando resultado com estes ajustes…'; try { const preview = await window.ntc.previewImage({ source: item.source, format: 'jpg', quality: $('#compressionImageQuality').value, scale: $('#compressionImageScale').value, keepRatio: true }); $('#compressionPreviewResult').src = preview.dataUrl; $('#compressionPreviewMeta').textContent = `Resultado: ${preview.width} × ${preview.height} · qualidade ${$('#compressionImageQuality').value}%.`; } catch (error) { $('#compressionPreviewMeta').textContent = cleanError(error); } }
function renderCompressionQueue() { $('#compressionCount').textContent = `${compressionQueue.length} ${compressionQueue.length === 1 ? 'item' : 'itens'}`; $('#compressionList').innerHTML = compressionQueue.length ? compressionQueue.map((item, index) => `<article class="queue-item conversion-item"><span class="queue-index">${index + 1}</span><div class="history-copy"><strong>${safeText(item.name)}</strong><span>${safeText(item.status || 'Pronto')}</span></div>${item.status !== 'Comprimindo' ? `<button class="ghost-button" data-compression-remove="${item.id}">Remover</button>` : ''}</article>`).join('') : '<div class="empty-state"><p>Adicione arquivos para comprimir.</p></div>'; $$('[data-compression-remove]').forEach(button => button.onclick = () => { compressionQueue = compressionQueue.filter(item => item.id !== button.dataset.compressionRemove); renderCompressionQueue(); }); updateCompressionControls(); }
function updateCompressionControls() { const source = compressionQueue[0]?.source || ''; const options = $('#compressionPreset').closest('.tool-options'); options.classList.toggle('hidden', !source); const video = /\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(source); $$('.compression-video-option').forEach(element => element.classList.toggle('hidden', !video)); $$('.compression-audio-option').forEach(element => element.classList.toggle('hidden', video)); }
async function addCompressionFiles(files) { files.filter(file => /\.(mp4|mkv|mov|avi|webm|m4v|mp3|m4a|aac|wav|flac|ogg|opus|wma)$/i.test(file || '')).forEach(file => { if (!compressionQueue.some(item => item.source === file)) compressionQueue.push({ id: toolId(), source: file, name: file.split(/[\\/]/).pop(), status: 'Pronto' }); }); renderCompressionQueue(); updateCompressionControls(); }
function applyCompressionPreset() { const preset = $('#compressionPreset').value; if (preset === 'equilibrado') Object.assign({ }, { }); const values = preset === 'muito' ? { resolution: '144', fps: 8, crf: 45, bitrate: 16, quality: 5, scale: 20 } : { resolution: '720', fps: 24, crf: 30, bitrate: 64, quality: 60, scale: 60 }; if (preset !== 'manual') { $('#compressionResolution').value = values.resolution; $('#compressionFps').value = values.fps; $('#compressionCrf').value = values.crf; $('#compressionBitrate').value = values.bitrate; $('#compressionImageQuality').value = values.quality; $('#compressionImageScale').value = values.scale; } }
async function startCompressionQueue() { if (compressionRunning) return; compressionRunning = true; let completed = 0; const compressionFolder = localStorage.getItem('ntc-compression-folder') || folder; for (const item of compressionQueue.filter(entry => entry.status === 'Pronto' || entry.status === 'Falhou')) { item.status = 'Comprimindo'; renderCompressionQueue(); try { const result = await window.ntc.startCompression({ ...item, folder: compressionFolder, duplicate: 'rename', resolution: $('#compressionResolution').value, fps: $('#compressionFps').value, crf: $('#compressionCrf').value, audioBitrate: $('#compressionBitrate').value, audioFormat: $('#compressionAudioFormat').value, sampleRate: $('#compressionSampleRate').value, mono: $('#compressionMono').checked }); item.status = 'Concluído'; completed++; addHistory({ title: result.file.split(/[\\/]/).pop(), type: result.kind, format: result.kind === 'video' ? 'MP4' : $('#compressionAudioFormat').value.toUpperCase(), quality: 'comprimido', size: formatBytes(result.size), file: result.file, time: 'Agora', operation: 'compression' }); } catch (error) { item.status = `Falhou: ${cleanError(error)}`; } renderCompressionQueue(); } compressionRunning = false; if (completed) showToast(`${completed === 1 ? 'Arquivo comprimido' : `${completed} arquivos comprimidos`}. Acesse em Histórico.`); }
function normalizeVideoEditCuts() { const duration = Number(videoEdit.meta?.duration || 0); videoEdit.cuts = videoEdit.cuts.map(cut => ({ start: Math.max(0, Math.min(duration, Number(cut.start) || 0)), end: Math.max(0, Math.min(duration, Number(cut.end) || 0)) })).filter(cut => cut.end - cut.start > .05).sort((a, b) => a.start - b.start).reduce((cuts, cut) => { const last = cuts.at(-1); if (last && cut.start <= last.end + .05) last.end = Math.max(last.end, cut.end); else cuts.push(cut); return cuts; }, []); }
function videoEditSegments() { const duration = Number(videoEdit.meta?.duration || 0); normalizeVideoEditCuts(); const segments = []; let cursor = 0; videoEdit.cuts.forEach(cut => { if (cut.start > cursor + .05) segments.push({ start: cursor, end: cut.start }); cursor = Math.max(cursor, cut.end); }); if (duration > cursor + .05) segments.push({ start: cursor, end: duration }); return segments; }
function videoEditDuration() { return videoEditSegments().reduce((total, segment) => total + segment.end - segment.start, 0); }
function videoEditSourceTime(projectTime) { const target = Math.max(0, Math.min(videoEditDuration(), Number(projectTime) || 0)); let passed = 0; for (const segment of videoEditSegments()) { const length = segment.end - segment.start; if (target <= passed + length) return segment.start + target - passed; passed += length; } return videoEditSegments().at(-1)?.end || 0; }
function videoEditProjectTime(sourceTime) { let passed = 0; for (const segment of videoEditSegments()) { if (sourceTime >= segment.start && sourceTime <= segment.end) return passed + sourceTime - segment.start; passed += segment.end - segment.start; } return passed; }
function videoEditSelectionBounds() { const a = Math.min(videoEdit.selectionStart, videoEdit.selectionEnd); const b = Math.max(videoEdit.selectionStart, videoEdit.selectionEnd); const sourceDuration = Number(videoEdit.meta?.duration || 0); return [Math.max(0, a), Math.min(sourceDuration, b)]; }
function paintVideoEditorWaveform() { const canvas = $('#videoTimelineWaveform'); if (!canvas || !videoEdit.source) return; const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1; canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio)); const context = canvas.getContext('2d'); context.scale(ratio, ratio); context.clearRect(0, 0, rect.width, rect.height); const middle = rect.height / 2; context.strokeStyle = '#bcbcbc'; context.lineWidth = 1; const values = videoEditWaveform.length ? videoEditWaveform : new Array(120).fill(.08); for (let x = 0; x < Math.ceil(rect.width); x++) { const index = Math.min(values.length - 1, Math.floor(x / Math.max(1, rect.width) * values.length)); const amplitude = Math.max(.04, Number(values[index]) || .04) * (rect.height * .42); context.beginPath(); context.moveTo(x + .5, middle - amplitude); context.lineTo(x + .5, middle + amplitude); context.stroke(); } }
function renderVideoEditorTimeline() { if (!videoEdit.source) return; const sourceDuration = Math.max(.01, Number(videoEdit.meta?.duration || 0)); const outputDuration = Math.max(.01, videoEditDuration()); const [start, end] = videoEditSelectionBounds(); const selection = $('#videoTimelineSelection'); selection.style.left = `${start / sourceDuration * 100}%`; selection.style.width = `${Math.max(.25, (end - start) / sourceDuration * 100)}%`; $('#videoTimelineCuts').innerHTML = videoEdit.cuts.map(cut => `<span class="timeline-cut" style="left:${cut.start / sourceDuration * 100}%;width:${Math.max(.2, (cut.end - cut.start) / sourceDuration * 100)}%"></span>`).join(''); const player = $('#videoEditorPlayer'); const current = Number.isFinite(player.currentTime) ? player.currentTime : 0; $('#videoTimelinePlayhead').style.left = `${Math.max(0, Math.min(100, current / sourceDuration * 100))}%`; $('#videoEditorTime').textContent = `${formatEditorTime(videoEditProjectTime(current))} / ${formatEditorTime(outputDuration)}`; $('#videoEditorDuration').textContent = `final ${formatEditorTime(outputDuration)}`; const removed = videoEdit.cuts.reduce((total, cut) => total + cut.end - cut.start, 0); $('#videoCutSummary').textContent = videoEdit.cuts.length ? `${videoEdit.cuts.length} ${videoEdit.cuts.length === 1 ? 'trecho removido' : 'trechos removidos'} · ${formatEditorTime(removed)}` : 'Arraste na waveform para selecionar um trecho'; $('#removeVideoCut').disabled = end - start < .1; $('#undoVideoCut').disabled = !videoEdit.cuts.length; paintVideoEditorWaveform(); renderVideoEditorAudioTracks(); }
function paintVideoEditorAudioWaveforms() { $$('[data-audio-waveform]').forEach(canvas => { const track = videoEdit.audioTracks.find(entry => entry.id === canvas.dataset.audioWaveform); if (!track) return; const rect = canvas.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1; canvas.width = Math.max(1, Math.round(rect.width * ratio)); canvas.height = Math.max(1, Math.round(rect.height * ratio)); const context = canvas.getContext('2d'); context.scale(ratio, ratio); context.clearRect(0, 0, rect.width, rect.height); const values = track.waveform?.length ? track.waveform : new Array(90).fill(.16); const middle = rect.height / 2; context.strokeStyle = '#eeeeee'; context.globalAlpha = .76; context.lineWidth = 1; for (let x = 0; x < Math.ceil(rect.width); x++) { const index = Math.min(values.length - 1, Math.floor(x / Math.max(1, rect.width) * values.length)); const amplitude = Math.max(.05, Number(values[index]) || .05) * rect.height * .39; context.beginPath(); context.moveTo(x + .5, middle - amplitude); context.lineTo(x + .5, middle + amplitude); context.stroke(); } }); }
function renderVideoEditorAudioTracks() { const list = $('#videoEditorAudioTracks'); const duration = Math.max(.01, videoEditDuration()); if (!videoEdit.audioTracks.length) { list.innerHTML = '<div class="empty-state"><p>Adicione músicas ou áudios para misturar.</p></div>'; return; } list.innerHTML = videoEdit.audioTracks.map(track => { const position = Math.max(0, Math.min(duration, Number(track.position) || 0)); const visibleDuration = track.loop ? Math.max(.05, duration - position) : Math.max(.05, Math.min(Number(track.duration) || .05, duration - position)); return `<article class="video-audio-track"><strong title="${safeText(track.name)}">${safeText(track.name)}</strong><div class="audio-timeline-track"><div class="audio-track-clip" data-audio-track="${track.id}" style="left:${position / duration * 100}%;width:${Math.max(1, visibleDuration / duration * 100)}%"><canvas class="audio-track-waveform" data-audio-waveform="${track.id}" aria-hidden="true"></canvas><button type="button" data-audio-drag="start" aria-label="Ajustar início"></button><span>${safeText(track.loop ? `${track.name} · loop` : track.name)}</span><button type="button" data-audio-drag="end" aria-label="Ajustar fim"></button></div></div><div class="audio-track-settings"><label>vol.<input class="text-input" data-audio-volume="${track.id}" type="number" min="0" max="300" value="${Math.round(Number(track.volume) || 100)}" /></label><label>loop<input data-audio-loop="${track.id}" type="checkbox" ${track.loop ? 'checked' : ''} /></label><button class="ghost-button" data-audio-remove="${track.id}" type="button">×</button></div></article>`; }).join(''); paintVideoEditorAudioWaveforms(); $$('[data-audio-remove]').forEach(button => button.onclick = () => { videoEdit.audioTracks = videoEdit.audioTracks.filter(track => track.id !== button.dataset.audioRemove); renderVideoEditorTimeline(); }); $$('[data-audio-volume]').forEach(input => input.oninput = () => { const track = videoEdit.audioTracks.find(entry => entry.id === input.dataset.audioVolume); if (track) track.volume = Math.max(0, Math.min(300, Number(input.value) || 0)); }); $$('[data-audio-loop]').forEach(input => input.onchange = () => { const track = videoEdit.audioTracks.find(entry => entry.id === input.dataset.audioLoop); if (track) { track.loop = input.checked; renderVideoEditorTimeline(); } }); $$('[data-audio-track]').forEach(clip => clip.onpointerdown = event => { if (event.button !== 0) return; const track = videoEdit.audioTracks.find(entry => entry.id === clip.dataset.audioTrack); if (!track) return; const mode = event.target.dataset.audioDrag || 'move'; videoEditDrag = { id: track.id, mode, startX: event.clientX, position: Number(track.position) || 0, trimStart: Number(track.trimStart) || 0, duration: Number(track.duration) || .1, timeline: clip.parentElement.getBoundingClientRect() }; event.preventDefault(); }); }
function updateVideoEditorAudioDrag(event) { if (!videoEditDrag) return; const track = videoEdit.audioTracks.find(entry => entry.id === videoEditDrag.id); if (!track) return; const total = Math.max(.01, videoEditDuration()); const delta = (event.clientX - videoEditDrag.startX) / Math.max(1, videoEditDrag.timeline.width) * total; const maxDuration = Math.max(.05, Number(track.mediaDuration) - videoEditDrag.trimStart); if (videoEditDrag.mode === 'move') track.position = Math.max(0, Math.min(total - .05, videoEditDrag.position + delta)); if (videoEditDrag.mode === 'start') { const trimStart = Math.max(0, Math.min(Number(track.mediaDuration) - .05, videoEditDrag.trimStart + delta)); const changed = trimStart - videoEditDrag.trimStart; track.trimStart = trimStart; track.duration = Math.max(.05, Math.min(maxDuration - changed, videoEditDrag.duration - changed)); track.position = Math.max(0, videoEditDrag.position + changed); } if (videoEditDrag.mode === 'end' && !track.loop) track.duration = Math.max(.05, Math.min(maxDuration, videoEditDrag.duration + delta)); renderVideoEditorTimeline(); }
async function loadVideoEditor(file) { try { const meta = await window.ntc.inspectVideo(file); videoEdit = { source: meta.path, meta, cuts: [], audioTracks: [], selectionStart: 0, selectionEnd: Math.min(1, meta.duration), outputName: safeBase(`${meta.baseName || meta.name.replace(/\.[^.]+$/, '')} editado`), exporting: false }; videoEditWaveform = []; $('#videoEditorWorkspace').classList.remove('hidden'); $('#videoEditorName').textContent = meta.name; $('#videoEditorOutputName').value = videoEdit.outputName; $('#videoEditorFolderPath').textContent = folder || 'Downloads'; $('#videoOriginalVolume').value = '100'; $('#videoMuteOriginal').checked = false; const player = $('#videoEditorPlayer'); player.src = sourceUrl(meta.path); player.load(); renderVideoEditorTimeline(); try { videoEditWaveform = await window.ntc.getWaveform(meta.path); } catch { videoEditWaveform = []; } renderVideoEditorTimeline(); } catch (error) { showToast(cleanError(error)); } }
async function addVideoEditorAudio() { const files = await window.ntc.chooseVideoEditorAudio(); const results = await Promise.allSettled(files.map(file => window.ntc.inspectMedia(file))); let invalid = 0; const added = []; results.forEach(result => { if (result.status !== 'fulfilled') { invalid++; return; } const info = result.value; const track = { id: toolId(), source: info.path, name: info.name, mediaDuration: Number(info.duration) || .1, trimStart: 0, duration: Number(info.duration) || .1, position: 0, volume: 100, loop: false, waveform: [] }; videoEdit.audioTracks.push(track); added.push(track); }); renderVideoEditorTimeline(); await Promise.all(added.map(async track => { try { track.waveform = await window.ntc.getWaveform(track.source); } catch { track.waveform = []; } })); renderVideoEditorTimeline(); if (invalid) showToast('Alguns arquivos não possuem uma faixa de áudio válida.'); }
async function exportVideoEdit() { if (!videoEdit.source || videoEdit.exporting) return; const duration = videoEditDuration(); if (duration <= .05) return showToast('Mantenha ao menos um trecho do vídeo para exportar.'); videoEdit.exporting = true; const id = toolId(); const progress = $('#videoEditorProgress'); progress.classList.remove('hidden'); $('#videoEditorStatus').textContent = 'EXPORTANDO'; $('#videoEditorPercent').textContent = '0%'; $('#videoEditorProgressBar').style.width = '0%'; $('#videoEditorProgressTitle').textContent = videoEdit.meta.name; $('#exportVideoEdit').disabled = true; $('#cancelVideoEdit').onclick = () => window.ntc.cancelVideoEdit(id); try { const result = await window.ntc.startVideoEdit({ id, source: videoEdit.source, duration: videoEdit.meta.duration, cuts: videoEdit.cuts, audioTracks: videoEdit.audioTracks, originalVolume: $('#videoOriginalVolume').value, muteOriginal: $('#videoMuteOriginal').checked, hasAudio: videoEdit.meta.hasAudio, folder: folder || await window.ntc.defaultDownloadFolder(), outputName: $('#videoEditorOutputName').value.trim() || videoEdit.outputName, duplicate: localStorage.getItem('ntc-duplicate') || 'rename' }); addHistory({ title: result.filename, type: 'video', format: 'MP4', quality: 'H.264 editado', size: formatBytes(result.size), file: result.file, time: 'Agora', operation: 'conversion' }); $('#videoEditorStatus').textContent = 'CONCLUÍDO'; $('#videoEditorPercent').textContent = '100%'; $('#videoEditorProgressBar').style.width = '100%'; $('#videoEditorProgressMeta').textContent = 'Arquivo criado. Acesse em Histórico.'; showToast('Vídeo editado. Acesse em Histórico.'); } catch (error) { $('#videoEditorStatus').textContent = 'ERRO'; $('#videoEditorPercent').textContent = 'ERRO'; $('#videoEditorProgressMeta').textContent = cleanError(error); } finally { videoEdit.exporting = false; $('#exportVideoEdit').disabled = false; } }
function showEditAfterDownload(file, title) { downloadedAudioToEdit = { file, title }; $('#downloadedAudioName').textContent = title || 'Download concluído.'; $('#editAfterDownloadModal').classList.remove('hidden'); clearTimeout(editSuggestionTimer); editSuggestionTimer = setTimeout(hideEditAfterDownload, 8000); }
function hideEditAfterDownload() { clearTimeout(editSuggestionTimer); editSuggestionTimer = null; downloadedAudioToEdit = null; $('#editAfterDownloadModal').classList.add('hidden'); }

function renderHistory() {
  renderQrHistory();
  const list = $('#historyList'); const empty = $('#emptyHistory'); const all = $('#allHistory');
  if (!history.length) { list.classList.add('hidden'); empty.classList.remove('hidden'); all.innerHTML = '<div class="empty-state"><div class="empty-icon">◷</div><p>Nenhum arquivo concluído ainda.</p></div>'; return; }
  const filter = $('#historyFilter')?.value || 'all'; const visible = history.map((item, index) => ({ item, index })).filter(({ item }) => filter === 'all' || (filter === 'failed' ? item.state === 'erro' : item.operation === filter));
  const markup = visible.length ? visible.map(({ item, index }) => `<article class="history-item"><div class="history-icon">${item.state === 'erro' ? '!' : (item.type === 'video' ? '▸' : (item.type === 'image' ? '▧' : '♫'))}</div><div class="history-copy"><strong>${safeText(item.title)}</strong><span>${safeText(item.format?.toUpperCase() || '—')} · ${safeText(item.quality || 'original')} · ${safeText(item.size || '—')} · ${safeText(item.state === 'erro' ? 'falhou' : item.time)}</span></div>${item.file ? `<button class="ghost-button" data-open="${index}">Abrir</button><button class="ghost-button" data-folder="${index}">Pasta</button>` : ''}${item.type === 'audio' && (item.file || item.source) ? `<button class="ghost-button" data-edit-audio="${index}">Abrir no Editor</button>` : ''}</article>`).join('') : '<div class="empty-state"><p>Nenhum item neste filtro.</p></div>';
  list.innerHTML = markup; list.classList.remove('hidden'); empty.classList.add('hidden'); all.innerHTML = markup;
  $$('[data-open]').forEach(button => button.onclick = async () => { const result = await window.ntc.openFile(history[button.dataset.open].file); if (result) showToast('Não foi possível abrir o arquivo.'); });
  $$('[data-folder]').forEach(button => button.onclick = async () => { const result = await window.ntc.openFileFolder(history[button.dataset.folder].file); if (result) showToast('Não foi possível abrir a pasta.'); });
  $$('[data-edit-audio]').forEach(button => button.onclick = async () => { const item = history[button.dataset.editAudio]; const source = item?.file || item?.source; if (!source) return; await addMediaFiles([source]); $$('.nav-item').forEach(nav => nav.classList.toggle('active', nav.dataset.view === 'converter')); $$('.view').forEach(view => view.classList.toggle('active', view.id === 'converterView')); });
}

function setHistoryTab(tab) {
  const qr = tab === 'qr';
  $('#filesHistoryTab').classList.toggle('active', !qr); $('#filesHistoryTab').setAttribute('aria-selected', String(!qr));
  $('#qrHistoryTab').classList.toggle('active', qr); $('#qrHistoryTab').setAttribute('aria-selected', String(qr));
  $('#filesHistoryPanel').classList.toggle('hidden', qr); $('#qrHistoryPanel').classList.toggle('hidden', !qr);
  $('#filesHistoryActions').classList.toggle('hidden', qr); $('#qrHistoryActions').classList.toggle('hidden', !qr);
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

function conversionQualityOptions(format, selected = '192') {
  const lossless = ['wav', 'flac', 'aiff'].includes(format); const select = $('#converterQuality');
  select.disabled = lossless; select.innerHTML = lossless ? '<option value="lossless">Sem perdas</option>' : '<option value="128">128 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option>';
  select.value = lossless ? 'lossless' : (['128', '192', '256', '320'].includes(String(selected)) ? String(selected) : '192');
}
function updateConverterExtension(format = $('#converterFormat').value) { $('#converterExtension').textContent = `.${format}`; }
function newConversion(info) {
  return { conversionId: `${Date.now()}-${Math.random().toString(16).slice(2)}`, source: info.path, sourceName: info.name, sourceType: info.type, duration: info.duration, durationLabel: info.durationLabel, coverStreamIndex: info.coverStreamIndex, outputName: safeBase(info.baseName), format: 'mp3', quality: '192', folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', trimStart: '', trimEnd: '', normalize: false, gain: 0, eqBass: 0, eqMid: 0, eqTreble: 0, removeSilence: false, metadata: info.metadata || {}, cover: null, status: 'pronto' };
}
function currentEditingConversion() { return conversionQueue.find(item => item.conversionId === editingConversionId); }
function readEditorDraft() { return { format: $('#converterFormat').value, quality: $('#converterQuality').value, outputName: $('#converterOutputName').value, trimStart: $('#trimStart').value, trimEnd: $('#trimEnd').value, normalize: $('#normalizeAudio').checked, gain: $('#audioGain').value, eqBass: $('#eqBass').value, eqMid: $('#eqMid').value, eqTreble: $('#eqTreble').value, removeSilence: $('#removeSilence').checked, title: $('#metadataTitle').value, artist: $('#metadataArtist').value, album: $('#metadataAlbum').value, year: $('#metadataYear').value, genre: $('#metadataGenre').value }; }
function applyEditorDraft(draft) { $('#converterFormat').value = draft.format; conversionQualityOptions(draft.format, draft.quality); updateConverterExtension(draft.format); $('#converterQuality').value = draft.quality; $('#converterOutputName').value = draft.outputName; $('#trimStart').value = draft.trimStart; $('#trimEnd').value = draft.trimEnd; $('#normalizeAudio').checked = draft.normalize; $('#audioGain').value = draft.gain || 0; $('#eqBass').value = draft.eqBass || 0; $('#eqMid').value = draft.eqMid || 0; $('#eqTreble').value = draft.eqTreble || 0; $('#removeSilence').checked = Boolean(draft.removeSilence); $('#metadataTitle').value = draft.title; $('#metadataArtist').value = draft.artist; $('#metadataAlbum').value = draft.album; $('#metadataYear').value = draft.year; $('#metadataGenre').value = draft.genre; paintWaveform(); }
function updateEditorHistoryButtons() { $('#undoEdit').disabled = !editorUndoStack.length || currentEditingConversion()?.status === 'convertendo'; $('#redoEdit').disabled = !editorRedoStack.length || currentEditingConversion()?.status === 'convertendo'; }
function rememberEditorChange() { if (!editingConversionId) return; const next = readEditorDraft(); if (!editorDraft || JSON.stringify(next) === JSON.stringify(editorDraft)) return; editorUndoStack.push(editorDraft); editorUndoStack.splice(0, 80); editorRedoStack = []; editorDraft = next; updateEditorHistoryButtons(); }
function undoEditorChange() { const item = currentEditingConversion(); if (!item || item.status === 'convertendo' || !editorUndoStack.length) return; const currentDraft = readEditorDraft(); const previous = editorUndoStack.pop(); editorRedoStack.push(currentDraft); applyEditorDraft(previous); editorDraft = previous; updateEditorHistoryButtons(); }
function redoEditorChange() { const item = currentEditingConversion(); if (!item || item.status === 'convertendo' || !editorRedoStack.length) return; const currentDraft = readEditorDraft(); const next = editorRedoStack.pop(); editorUndoStack.push(currentDraft); applyEditorDraft(next); editorDraft = next; updateEditorHistoryButtons(); }
function readEditorTime(value, fallback) {
  const text = String(value || '').trim(); if (!text) return fallback;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(':').map(Number); if (!parts.length || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return fallback;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
function formatEditorTime(seconds) { const total = Math.max(0, Math.round(seconds)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const secs = total % 60; return [hours, minutes, secs].map(value => String(value).padStart(2, '0')).join(':'); }
function waveformBounds(item = currentEditingConversion()) {
  const duration = Number(item?.duration || 0); let start = readEditorTime($('#trimStart').value, 0); let end = readEditorTime($('#trimEnd').value, duration);
  start = Math.max(0, Math.min(start, duration)); end = Math.max(start, Math.min(end, duration)); return [start, end, duration];
}
function waveformViewport(duration, start, end) {
  if (!duration || waveformZoom <= 1) return [0, 1];
  const visible = 1 / waveformZoom; const selectionFocus = Math.max(0, Math.min(1, ((start + end) / 2) / duration)); const focus = waveformFocus === null ? selectionFocus : waveformFocus; const from = Math.max(0, Math.min(1 - visible, focus - visible / 2));
  return [from, from + visible];
}
function paintWaveform() {
  const item = currentEditingConversion(); const canvas = $('#waveformCanvas'); if (!item || !canvas) return;
  const rect = canvas.getBoundingClientRect(); const scale = window.devicePixelRatio || 1; const width = Math.max(1, Math.round(rect.width * scale)); const height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d'); const [start, end, duration] = waveformBounds(item); const [viewStart, viewEnd] = waveformViewport(duration, start, end); const toX = value => duration ? Math.max(0, Math.min(width, ((value / duration) - viewStart) / (viewEnd - viewStart) * width)) : 0; const startX = toX(start); const endX = duration ? toX(end) : width;
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#161616'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#242424'; ctx.fillRect(startX, 0, Math.max(0, endX - startX), height);
  const values = waveformData.length ? waveformData : Array.from({ length: 110 }, () => .025); const first = Math.max(0, Math.floor(viewStart * values.length)); const last = Math.max(first + 1, Math.min(values.length, Math.ceil(viewEnd * values.length))); const visibleValues = values.slice(first, last); const middle = height / 2; const barWidth = width / visibleValues.length;
  ctx.fillStyle = '#a8a8a8'; visibleValues.forEach((value, index) => { const x = index * barWidth; const amplitude = Math.max(2 * scale, value * height * .42); ctx.fillRect(x, middle - amplitude, Math.max(scale, barWidth - scale), amplitude * 2); });
  if (spectrumVisible) { ctx.fillStyle = 'rgba(230,230,230,.18)'; visibleValues.forEach((value, index) => { const x = index * barWidth; const bands = Math.max(1, Math.round(value * 6)); for (let band = 0; band < bands; band++) ctx.fillRect(x, 10 * scale + band * 12 * scale, Math.max(scale, barWidth - scale), 3 * scale); }); }
  ctx.fillStyle = '#f0f0f0'; [startX, endX].forEach(x => { ctx.fillRect(Math.round(x - scale), 0, scale * 2, height); ctx.beginPath(); ctx.moveTo(x - 6 * scale, 0); ctx.lineTo(x + 6 * scale, 0); ctx.lineTo(x, 8 * scale); ctx.closePath(); ctx.fill(); });
  if (playbackTime !== null && duration) { const playX = toX(playbackTime); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(playX - scale), 0, scale * 2, height); ctx.beginPath(); ctx.moveTo(playX - 6 * scale, height); ctx.lineTo(playX + 6 * scale, height); ctx.lineTo(playX, height - 8 * scale); ctx.closePath(); ctx.fill(); }
  $('#waveformDuration').textContent = duration ? formatEditorTime(duration) : '—'; $('#waveformSelection').textContent = duration && (start > 0 || end < duration) ? `${formatEditorTime(start)} — ${formatEditorTime(end)}` : 'Arquivo completo';
}
async function loadWaveform(item) {
  waveformFor = item.conversionId; waveformData = []; paintWaveform();
  try { const values = await window.ntc.getWaveform(item.source); if (waveformFor === item.conversionId) { waveformData = values; paintWaveform(); } }
  catch { if (waveformFor === item.conversionId) { waveformData = []; paintWaveform(); } }
}
function moveWaveformHandle(event) {
  const item = currentEditingConversion(); const canvas = $('#waveformCanvas'); if (!item || !canvas || !item.duration) return;
  const rect = canvas.getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); const [start, end, duration] = waveformBounds(item); const [viewStart, viewEnd] = waveformViewport(duration, start, end); const point = (viewStart + ratio * (viewEnd - viewStart)) * duration; const topHandleArea = event.clientY - rect.top < 20;
  if (!waveformHandle) {
    const nearPlayback = playbackTime !== null && Math.abs(point - playbackTime) < duration * .035; waveformHandle = nearPlayback && !topHandleArea ? 'playback' : (Math.abs(point - start) <= Math.abs(point - end) ? 'start' : 'end');
  }
  if (waveformHandle === 'playback') { playbackTime = Math.max(start, Math.min(point, end)); if (previewAudio) previewAudio.currentTime = playbackTime; }
  if (waveformHandle === 'start') $('#trimStart').value = formatEditorTime(Math.min(point, Math.max(0, end - .1)));
  else if (waveformHandle === 'end') $('#trimEnd').value = formatEditorTime(Math.max(point, Math.min(duration, start + .1)));
  paintWaveform();
}
function sourceUrl(file) { return `file:///${file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')}`; }
function setupPreviewEffects() { if (!previewAudio) return; if (!previewAudioContext) previewAudioContext = new AudioContext(); if (!previewAudioSource) { previewAudioSource = previewAudioContext.createMediaElementSource(previewAudio); const bass = previewAudioContext.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 100; const mid = previewAudioContext.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 1; const treble = previewAudioContext.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 6000; const gain = previewAudioContext.createGain(); previewAudioSource.connect(bass).connect(mid).connect(treble).connect(gain).connect(previewAudioContext.destination); previewEffectNodes = { bass, mid, treble, gain }; } updatePreviewEffects(); }
function updatePreviewEffects() { if (!previewEffectNodes) return; const value = id => Number($(`#${id}`).value) || 0; previewEffectNodes.bass.gain.setTargetAtTime(value('eqBass'), previewAudioContext.currentTime, .025); previewEffectNodes.mid.gain.setTargetAtTime(value('eqMid'), previewAudioContext.currentTime, .025); previewEffectNodes.treble.gain.setTargetAtTime(value('eqTreble'), previewAudioContext.currentTime, .025); previewEffectNodes.gain.gain.setTargetAtTime(Math.pow(10, value('audioGain') / 20), previewAudioContext.currentTime, .025); }
function releasePreviewEffects() { if (previewAudioSource) { try { previewAudioSource.disconnect(); } catch {} } previewAudioSource = null; previewEffectNodes = null; }
function updatePreviewButton() { $('#playSelection').textContent = previewAudio && !previewAudio.paused ? 'Ⅱ Pausar' : '▶ Ouvir seleção'; }
function stopPreview(keepCursor = false) { if (playbackFrame) cancelAnimationFrame(playbackFrame); playbackFrame = null; if (previewAudio) previewAudio.pause(); releasePreviewEffects(); previewAudio = null; if (!keepCursor) playbackTime = null; updatePreviewButton(); paintWaveform(); }
function animatePlayback(item) {
  if (!previewAudio || previewAudio.paused) return; const [, end] = waveformBounds(item); playbackTime = previewAudio.currentTime;
  if (playbackTime >= end) { previewAudio.pause(); playbackTime = end; updatePreviewButton(); paintWaveform(); return; }
  paintWaveform(); playbackFrame = requestAnimationFrame(() => animatePlayback(item));
}
function playSelectedRange() {
  const item = currentEditingConversion(); if (!item) return; const [start, end] = waveformBounds(item);
  if (previewAudio && !previewAudio.paused) { if (playbackFrame) cancelAnimationFrame(playbackFrame); previewAudio.pause(); previewAudio.currentTime = start; playbackTime = start; updatePreviewButton(); paintWaveform(); return; }
  const sameFile = previewAudio?.dataset.ntcSource === item.source;
  if (!sameFile) { if (previewAudio) previewAudio.pause(); releasePreviewEffects(); previewAudio = new Audio(sourceUrl(item.source)); previewAudio.dataset.ntcSource = item.source; setupPreviewEffects(); }
  if (!previewAudio || !Number.isFinite(end) || end <= start) return;
  const begin = () => { if (previewAudioContext?.state === 'suspended') previewAudioContext.resume(); updatePreviewEffects(); if (previewAudio.currentTime < start || previewAudio.currentTime >= end || !sameFile) previewAudio.currentTime = start; playbackTime = previewAudio.currentTime; previewAudio.play().then(() => { updatePreviewButton(); if (playbackFrame) cancelAnimationFrame(playbackFrame); animatePlayback(item); }).catch(() => { $('#waveformSelection').textContent = 'Não foi possível reproduzir este arquivo.'; updatePreviewButton(); }); };
  if (previewAudio.readyState >= 1) begin(); else previewAudio.addEventListener('loadedmetadata', begin, { once: true });
}
function seekPreview(offset) {
  const item = currentEditingConversion(); if (!item) return;
  if (!previewAudio) { playSelectedRange(); return; }
  const [start, end] = waveformBounds(item); const target = Math.max(start, Math.min(end, (Number.isFinite(previewAudio.currentTime) ? previewAudio.currentTime : start) + offset)); previewAudio.currentTime = target; playbackTime = target;
  if (target >= end && !previewAudio.paused) { previewAudio.pause(); updatePreviewButton(); }
  paintWaveform();
}
function renderConversionQueue() {
  const readyItems = conversionQueue.length; $('#conversionQueueCount').textContent = `${readyItems} ${readyItems === 1 ? 'item' : 'itens'}`; $('#abortConversions').disabled = !currentConversion; $('#abortConversions').classList.toggle('hidden', !currentConversion); $('#startConversions').disabled = !conversionQueue.some(item => ['pronto', 'erro'].includes(item.status));
  if (!readyItems) { $('#conversionQueueList').innerHTML = '<div class="empty-state"><p>Selecione arquivos para preparar conversões.</p></div>'; return; }
  $('#conversionQueueList').innerHTML = conversionQueue.map((item, index) => `<article class="queue-item conversion-item ${item.conversionId === editingConversionId ? 'selected' : ''}" data-conversion-edit="${item.conversionId}"><span class="queue-index">${index + 1}</span><div class="history-copy"><strong>${safeText(item.sourceName)}</strong><span>${safeText(item.sourceType)} · ${item.format.toUpperCase()} · ${safeText(item.quality === 'lossless' ? 'sem perdas' : `${item.quality} kbps`)} · ${safeText(item.status)}</span></div>${item.status === 'erro' ? `<button class="ghost-button" data-conversion-retry="${item.conversionId}">Tentar</button>` : ''}${item.status !== 'convertendo' ? `<button class="ghost-button" data-conversion-remove="${item.conversionId}">×</button>` : ''}</article>`).join('');
  $$('[data-conversion-edit]').forEach(element => element.onclick = event => { if (event.target.closest('button')) return; selectConversion(element.dataset.conversionEdit); });
  $$('[data-conversion-remove]').forEach(button => button.onclick = () => { conversionQueue = conversionQueue.filter(item => item.conversionId !== button.dataset.conversionRemove); if (editingConversionId === button.dataset.conversionRemove) { editingConversionId = null; $('#converterEditor').classList.add('hidden'); } renderConversionQueue(); });
  $$('[data-conversion-retry]').forEach(button => button.onclick = () => { const item = conversionQueue.find(entry => entry.conversionId === button.dataset.conversionRetry); if (item) { item.status = 'pronto'; renderConversionQueue(); } });
}
function loadConversionEditor(item) {
  if (!item) return; stopPreview(); waveformZoom = 1; waveformFocus = null; editingConversionId = item.conversionId; $('#converterEditor').classList.remove('hidden'); $('#editingMediaName').textContent = item.sourceName; $('#converterFormat').value = item.format; conversionQualityOptions(item.format, item.quality); updateConverterExtension(item.format); $('#converterOutputName').value = item.outputName; $('#trimStart').value = item.trimStart; $('#trimEnd').value = item.trimEnd; $('#normalizeAudio').checked = item.normalize; $('#audioGain').value = item.gain || 0; $('#eqBass').value = item.eqBass || 0; $('#eqMid').value = item.eqMid || 0; $('#eqTreble').value = item.eqTreble || 0; $('#removeSilence').checked = Boolean(item.removeSilence); $('#metadataTitle').value = item.metadata?.title || ''; $('#metadataArtist').value = item.metadata?.artist || ''; $('#metadataAlbum').value = item.metadata?.album || ''; $('#metadataYear').value = item.metadata?.year || ''; $('#metadataGenre').value = item.metadata?.genre || ''; $('#coverName').textContent = item.cover ? item.cover.split(/[\\/]/).pop() : 'Sem alteração'; $('#converterFolderPath').textContent = item.folder || 'Downloads'; editorUndoStack = []; editorRedoStack = []; editorDraft = readEditorDraft(); updateEditorHistoryButtons(); renderConversionQueue(); requestAnimationFrame(() => loadWaveform(item));
}
function selectConversion(id) { const item = conversionQueue.find(entry => entry.conversionId === id); if (item && item.status !== 'convertendo') loadConversionEditor(item); }
function renderMarkers() { const list = $('#markerList'); if (!audioMarkers.length) { list.innerHTML = '<span>Nenhum marcador criado.</span>'; return; } list.innerHTML = audioMarkers.map(marker => `<span class="marker-chip"><input data-marker-name="${marker.id}" value="${safeText(marker.name)}" aria-label="Nome do marcador" /><small>${formatEditorTime(marker.start)} — ${formatEditorTime(marker.end)}</small><button class="ghost-button" data-marker-remove="${marker.id}" type="button" aria-label="Remover marcador">×</button></span>`).join(''); $$('[data-marker-name]').forEach(input => input.oninput = () => { const marker = audioMarkers.find(entry => entry.id === input.dataset.markerName); if (marker) marker.name = input.value.trim() || 'Trecho'; }); $$('[data-marker-remove]').forEach(button => button.onclick = () => { audioMarkers = audioMarkers.filter(marker => marker.id !== button.dataset.markerRemove); renderMarkers(); }); }
function currentAudioSettings() { return { gain: $('#audioGain').value, eqBass: $('#eqBass').value, eqMid: $('#eqMid').value, eqTreble: $('#eqTreble').value, removeSilence: $('#removeSilence').checked, normalize: $('#normalizeAudio').checked }; }
function applyAudioSettings(settings) { $('#audioGain').value = settings.gain || 0; $('#eqBass').value = settings.eqBass || 0; $('#eqMid').value = settings.eqMid || 0; $('#eqTreble').value = settings.eqTreble || 0; $('#removeSilence').checked = Boolean(settings.removeSilence); $('#normalizeAudio').checked = Boolean(settings.normalize); rememberEditorChange(); }
function refreshAudioPresets() { const select = $('#audioPreset'); const selected = select.value; const saved = JSON.parse(localStorage.getItem('ntc-audio-presets') || '{}'); select.innerHTML = '<option value="">Preset de áudio</option><option value="voz">Voz</option><option value="musica">Música</option><option value="podcast">Podcast</option>' + Object.keys(saved).map(name => `<option value="saved:${safeText(name)}">${safeText(name)}</option>`).join(''); select.value = selected; }
const loadConversionEditorBase = loadConversionEditor; loadConversionEditor = function(item) { loadConversionEditorBase(item); spectrumVisible = false; $('#toggleSpectrum').textContent = 'Ver espectro'; audioMarkers = Array.isArray(item?.markers) ? structuredClone(item.markers) : []; renderMarkers(); };
const saveConversionEditsBase = saveConversionEdits; saveConversionEdits = function() { saveConversionEditsBase(); const item = currentEditingConversion(); if (item) item.markers = structuredClone(audioMarkers); };
function saveConversionEdits() {
  const item = currentEditingConversion(); if (!item || item.status === 'convertendo') return;
  item.format = $('#converterFormat').value; item.quality = $('#converterQuality').value; item.outputName = $('#converterOutputName').value.trim() || safeBase(item.sourceName.replace(/\.[^.]+$/, '')); item.trimStart = $('#trimStart').value.trim(); item.trimEnd = $('#trimEnd').value.trim(); item.normalize = $('#normalizeAudio').checked; item.gain = $('#audioGain').value; item.eqBass = $('#eqBass').value; item.eqMid = $('#eqMid').value; item.eqTreble = $('#eqTreble').value; item.removeSilence = $('#removeSilence').checked; item.metadata = { title: $('#metadataTitle').value.trim(), artist: $('#metadataArtist').value.trim(), album: $('#metadataAlbum').value.trim(), year: $('#metadataYear').value.trim(), genre: $('#metadataGenre').value.trim() }; item.duplicate = localStorage.getItem('ntc-duplicate') || 'rename'; renderConversionQueue();
}
async function addMediaFiles(files) {
  const results = await Promise.allSettled(files.map(file => window.ntc.inspectMedia(file))); let first = null; let failures = 0;
  results.forEach(result => { if (result.status === 'fulfilled' && !conversionQueue.some(item => item.source === result.value.path)) { const item = newConversion(result.value); conversionQueue.push(item); first ||= item; } else if (result.status === 'rejected') failures++; });
  if (first) loadConversionEditor(first); renderConversionQueue(); if (failures && !first) $('#conversionQueueList').innerHTML = '<div class="empty-state"><p>Não foi possível ler os arquivos selecionados.</p></div>';
}
async function chooseConverterFolder() { const chosen = await window.ntc.chooseDownloadFolder(); const item = currentEditingConversion(); if (chosen && item) { folder = chosen; localStorage.setItem('ntc-folder', folder); item.folder = chosen; syncSettings(); $('#converterFolderPath').textContent = chosen; } }
async function chooseCover() { const item = currentEditingConversion(); if (!item) return; const cover = await window.ntc.chooseCoverFile(); if (cover) { item.cover = cover; $('#coverName').textContent = cover.split(/[\\/]/).pop(); } }
async function startNextConversion() {
  if (currentConversion) return; const item = conversionQueue.find(entry => entry.status === 'pronto'); if (!item) return;
  currentConversion = item; item.status = 'convertendo'; $('#conversionProgress').classList.remove('hidden'); $('#conversionStatus').textContent = 'CONVERTENDO'; $('#conversionTitle').textContent = item.sourceName; $('#conversionMeta').textContent = `${item.sourceType} → ${item.format.toUpperCase()} · ${item.quality === 'lossless' ? 'sem perdas' : `${item.quality} kbps`}`; $('#conversionPercent').textContent = '0%'; $('#conversionProgressBar').style.width = '0%'; $('#conversionEta').textContent = '—'; $('#cancelConversion').textContent = 'Cancelar'; $('#cancelConversion').onclick = () => window.ntc.cancelConversion(item.conversionId); renderConversionQueue();
  try { await window.ntc.startConversion(item); } catch (error) { const message = cleanError(error); item.status = message.includes('cancelada') ? 'cancelado' : 'erro'; const wasAborted = abortedConversions.delete(item.conversionId); if (item.status === 'erro') addHistory({ title: item.outputName, type: 'audio', format: item.format, quality: item.quality === 'lossless' ? 'sem perdas' : `${item.quality} kbps`, size: '—', time: 'Agora', source: item.source, operation: 'conversion', state: 'erro' }); currentConversion = null; $('#conversionStatus').textContent = wasAborted ? 'INTERROMPIDO' : item.status.toUpperCase(); $('#conversionMeta').textContent = wasAborted ? 'Conversões interrompidas pelo usuário.' : message; renderConversionQueue(); setTimeout(startNextConversion, 0); }
}
window.ntc.onConversionEvent(update => {
  if (!currentConversion || update.conversionId !== currentConversion.conversionId || abortedConversions.has(update.conversionId)) return;
  if (update.status === 'converting') { $('#conversionPercent').textContent = `${Math.round(update.percent || 0)}%`; $('#conversionProgressBar').style.width = `${update.percent || 0}%`; $('#conversionEta').textContent = update.eta || '—'; }
  if (update.status === 'complete') { const completed = currentConversion; addHistory({ title: completed.outputName, type: 'audio', format: completed.format, quality: completed.quality === 'lossless' ? 'sem perdas' : `${completed.quality} kbps`, size: formatBytes(update.size), file: update.file, time: 'Agora', source: completed.source, operation: 'conversion' }); conversionQueue = conversionQueue.filter(item => item.conversionId !== completed.conversionId); currentConversion = null; if (editingConversionId === completed.conversionId) { editingConversionId = null; $('#converterEditor').classList.add('hidden'); } $('#conversionStatus').textContent = 'CONCLUÍDO'; $('#conversionPercent').textContent = '100%'; $('#conversionProgressBar').style.width = '100%'; $('#conversionEta').textContent = '0s'; $('#conversionTitle').textContent = 'Conversão concluída'; $('#conversionMeta').textContent = `Salvo como ${update.filename}`; $('#cancelConversion').textContent = 'Abrir arquivo'; $('#cancelConversion').onclick = () => window.ntc.openFile(update.file); renderConversionQueue(); if ($('#openFolderAfter').checked) window.ntc.openFolder(completed.folder); setTimeout(startNextConversion, 0); }
});

function openPlaylistSelection() { if (!playlist) return; $('#playlistTitle').textContent = playlist.title; $('#playlistSummary').textContent = `${playlist.entries.length} músicas disponíveis`; $('#playlistList').innerHTML = playlist.entries.map((item, index) => `<label class="playlist-item"><input type="checkbox" data-playlist-entry="${index}" checked><span class="playlist-number">${index + 1}</span><img src="${item.thumbnail || ''}" alt=""><span><strong>${safeText(item.title)}</strong><small>${safeText(item.channel || 'YouTube')} · ${safeText(item.duration)}</small></span></label>`).join(''); $$('.nav-item').forEach(item => item.classList.remove('active')); $$('.view').forEach(view => view.classList.remove('active')); $('#playlistView').classList.add('active'); }
function toolId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function renderMediaQueue(kind) { const video = kind === 'video'; const items = video ? videoQueue : imageQueue; const list = $(`#${kind}QueueList`); $(`#${kind}QueueCount`).textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`; $(`#start${video ? 'Videos' : 'Images'}`).disabled = !items.some(item => ['pronto', 'erro'].includes(item.status)); if (!items.length) { list.innerHTML = `<div class="empty-state"><p>Adicione ${video ? 'vídeos' : 'imagens'} para converter.</p></div>`; return; } list.innerHTML = items.map((item, index) => `<article class="queue-item conversion-item ${item.status === 'erro' ? 'has-error' : ''}"><span class="queue-index">${index + 1}</span><div class="history-copy"><strong>${safeText(item.name)}</strong><span>${safeText(item.status === 'erro' && item.error ? item.error : `${item.meta} · ${item.status}`)}</span></div>${item.status === 'erro' ? `<button class="ghost-button" data-${kind}-retry="${item.id}">Tentar novamente</button>` : ''}${item.status !== 'convertendo' ? `<button class="ghost-button" data-${kind}-remove="${item.id}" aria-label="Remover">Remover</button>` : ''}</article>`).join(''); $$(`[data-${kind}-remove]`).forEach(button => button.onclick = () => { if (video) videoQueue = videoQueue.filter(item => item.id !== button.dataset[`${kind}Remove`]); else imageQueue = imageQueue.filter(item => item.id !== button.dataset[`${kind}Remove`]); renderMediaQueue(kind); if (!video) scheduleImagePreview(); }); $$(`[data-${kind}-retry]`).forEach(button => button.onclick = async () => { const item = items.find(entry => entry.id === button.dataset[`${kind}Retry`]); if (!item) return; item.status = 'pronto'; item.error = ''; if (video) { renderMediaQueue('video'); startNextVideo(); } else { renderMediaQueue('image'); await startImagesWithWarning(); } }); }
async function addVideos(files) { const results = await Promise.allSettled(files.map(file => window.ntc.inspectVideo(file))); let invalid = 0; results.forEach(result => { if (result.status !== 'fulfilled') { invalid++; return; } const info = result.value; if (!videoQueue.some(item => item.source === info.path)) videoQueue.push({ id: toolId(), source: info.path, name: info.name || info.path.split(/[\\/]/).pop(), meta: `${info.width || '—'}×${info.height || '—'} · ${formatEditorTime(info.duration || 0)}`, duration: info.duration || 0, outputName: safeBase((info.name || 'video').replace(/\.[^.]+$/, '')), folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'pronto' }); }); renderMediaQueue('video'); if (invalid) showToast('Alguns arquivos não são vídeos compatíveis.'); }
async function addImages(files) { const results = await Promise.allSettled(files.map(file => window.ntc.inspectImage(file))); let invalid = 0; results.forEach(result => { if (result.status !== 'fulfilled') { invalid++; return; } const info = result.value; if (!imageQueue.some(item => item.source === info.path)) imageQueue.push({ id: toolId(), source: info.path, name: info.name || info.path.split(/[\\/]/).pop(), sourceWidth: info.width, sourceHeight: info.height, meta: `${info.width || '—'}×${info.height || '—'}`, outputName: safeBase((info.name || 'imagem').replace(/\.[^.]+$/, '')), folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'pronto' }); }); renderMediaQueue('image'); if (invalid) showToast('Alguns arquivos não são imagens compatíveis.'); }
function startNextVideo() { if (currentVideo) return; const item = videoQueue.find(entry => entry.status === 'pronto'); if (!item) return; currentVideo = item; Object.assign(item, { format: $('#videoFormat').value, codec: $('#videoCodec').value, resolution: $('#videoResolution').value, quality: $('#videoQuality').value, audioMode: $('#videoAudio').value, folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'convertendo', error: '' }); $('#videoProgress').classList.remove('hidden'); $('#videoStatus').textContent = 'CONVERTENDO'; $('#videoTitle').textContent = item.name; $('#videoPercent').textContent = '0%'; $('#videoProgressBar').style.width = '0%'; $('#cancelVideo').onclick = () => window.ntc.cancelVideoConversion(item.id); renderMediaQueue('video'); window.ntc.startVideoConversion(item).catch(error => { item.status = 'erro'; item.error = cleanError(error); currentVideo = null; $('#videoStatus').textContent = 'ERRO'; $('#videoPercent').textContent = 'ERRO'; $('#videoMeta').textContent = item.error; renderMediaQueue('video'); setTimeout(startNextVideo, 0); }); }
function startNextImage() { if (currentImage) return; const item = imageQueue.find(entry => entry.status === 'pronto'); if (!item) return; currentImage = item; Object.assign(item, { format: $('#imageFormat').value, quality: $('#imageQuality').value, scale: $('#imageScale').value, width: $('#imageWidth').value, height: $('#imageHeight').value, keepRatio: $('#imageKeepRatio').checked, folder, duplicate: localStorage.getItem('ntc-duplicate') || 'rename', status: 'convertendo', error: '' }); $('#imageProgress').classList.remove('hidden'); $('#imageStatus').textContent = 'CONVERTENDO'; $('#imageTitle').textContent = item.name; $('#imagePercent').textContent = '0%'; $('#imageProgressBar').style.width = '0%'; $('#cancelImage').textContent = 'Cancelar'; $('#cancelImage').onclick = () => window.ntc.cancelImageConversion(item.id); renderMediaQueue('image'); window.ntc.startImageConversion(item).catch(error => { const reason = cleanError(error); item.status = 'erro'; item.error = reason; lastFailedImage = item; currentImage = null; $('#imageStatus').textContent = 'FALHOU'; $('#imagePercent').textContent = 'ERRO'; $('#imageProgressBar').style.width = '100%'; $('#imageMeta').textContent = `${reason} Ajuste tamanho, escala ou formato e tente novamente.`; $('#cancelImage').textContent = 'Tentar com ajustes atuais'; $('#cancelImage').onclick = async () => { item.status = 'pronto'; item.error = ''; lastFailedImage = null; $('#imageStatus').textContent = 'TENTANDO NOVAMENTE'; $('#imagePercent').textContent = '0%'; $('#imageProgressBar').style.width = '0%'; renderMediaQueue('image'); await startImagesWithWarning(); }; renderMediaQueue('image'); showToast('A conversão falhou. O motivo e a ação para tentar novamente estão na fila.'); }); }
window.ntc.onVideoEvent(update => { if (!currentVideo || update.id !== currentVideo.id) return; if (update.status === 'converting') { $('#videoPercent').textContent = `${Math.round(update.percent || 0)}%`; $('#videoProgressBar').style.width = `${update.percent || 0}%`; } if (update.status === 'complete') { const item = currentVideo; addHistory({ title: item.outputName, type: 'video', format: item.format, quality: item.quality, size: formatBytes(update.size), file: update.file, source: item.source, operation: 'conversion', time: 'Agora' }); videoQueue = videoQueue.filter(entry => entry.id !== item.id); currentVideo = null; $('#videoStatus').textContent = 'CONCLUÍDO'; $('#videoPercent').textContent = '100%'; $('#videoProgressBar').style.width = '100%'; $('#videoMeta').textContent = `Salvo como ${update.filename}`; if ($('#openFolderAfter').checked) window.ntc.openFolder(item.folder); renderMediaQueue('video'); setTimeout(startNextVideo, 0); } });
window.ntc.onImageEvent(update => { if (!currentImage || update.id !== currentImage.id) return; if (update.status === 'converting') { $('#imagePercent').textContent = `${Math.round(update.percent || 0)}%`; $('#imageProgressBar').style.width = `${update.percent || 0}%`; } if (update.status === 'complete') { const item = currentImage; addHistory({ title: item.outputName, type: 'image', format: item.format, quality: `${item.quality}%`, size: formatBytes(update.size), file: update.file, source: item.source, operation: 'conversion', time: 'Agora' }); imageQueue = imageQueue.filter(entry => entry.id !== item.id); currentImage = null; $('#imageStatus').textContent = 'CONCLUÍDO'; $('#imagePercent').textContent = '100%'; $('#imageProgressBar').style.width = '100%'; $('#imageMeta').textContent = `Salvo em ${item.folder} · ${update.filename}`; $('#cancelImage').textContent = 'Abrir pasta'; $('#cancelImage').onclick = () => window.ntc.openFolder(item.folder); if ($('#openFolderAfter').checked) window.ntc.openFolder(item.folder); renderMediaQueue('image'); scheduleImagePreview(); setTimeout(startNextImage, 0); } });
window.ntc.onVideoEditorEvent(update => { if (!videoEdit.exporting || update.status !== 'converting') return; $('#videoEditorPercent').textContent = `${Math.round(update.percent || 0)}%`; $('#videoEditorProgressBar').style.width = `${update.percent || 0}%`; });
function bindDropzone(id, choose, add) { const element = $(`#${id}`); element.onclick = async () => add(await choose()); element.onkeydown = async event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); add(await choose()); } }; ['dragenter', 'dragover'].forEach(name => element.addEventListener(name, event => { event.preventDefault(); event.stopPropagation(); element.classList.add('dragging'); })); ['dragleave', 'drop'].forEach(name => element.addEventListener(name, event => { event.preventDefault(); event.stopPropagation(); element.classList.remove('dragging'); })); element.addEventListener('drop', event => { const files = [...event.dataTransfer.files].map(file => file.path || window.ntc.pathForFile(file)).filter(Boolean); if (files.length) add(files); else showToast('Não foi possível acessar o arquivo arrastado. Use Selecionar imagens.'); }); }
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
async function clearHistoryWithConfirm() { if (!history.length) { showToast('O histórico já está vazio.'); return; } if (!await confirmAction('Limpar histórico?', 'Os registros locais serão removidos. Os arquivos baixados não serão apagados.', 'Limpar')) return; history.length = 0; localStorage.removeItem('ntc-history'); renderHistory(); showToast('Histórico limpo.'); }
async function resetPreferences() { if (!await confirmAction('Restaurar preferências?', 'A pasta, os atalhos de captura, a abertura automática, a regra de duplicatas e o modelo de nome voltarão ao padrão.', 'Restaurar')) return; localStorage.removeItem('ntc-folder'); localStorage.removeItem('ntc-open-folder'); localStorage.removeItem('ntc-duplicate'); localStorage.removeItem('ntc-filename-template'); localStorage.removeItem('ntc-screenshot-folder'); await configureScreenshotShortcut(''); await configureQuickScreenshotShortcut(''); $('#screenshotShortcut').value = ''; $('#quickScreenshotShortcut').value = ''; folder = await window.ntc.defaultDownloadFolder(); localStorage.setItem('ntc-folder', folder); syncSettings(); showToast('Preferências restauradas.'); }
async function checkTools() { const button = $('#checkTools'); button.disabled = true; $('#toolVersions').textContent = 'Verificando yt-dlp, FFmpeg e FFprobe…'; try { const version = await window.ntc.toolVersions(); if (version.error) { $('#toolVersions').textContent = `Erro: ${cleanError(version.error)}`; showToast('Não foi possível verificar as ferramentas.'); } else { $('#toolVersions').textContent = `yt-dlp ${version.ytdlp} · FFmpeg ${version.ffmpeg.match(/ffmpeg version\s+([^\s]+)/i)?.[1] || 'instalado'} · FFprobe ${version.ffprobe.match(/ffprobe version\s+([^\s]+)/i)?.[1] || 'instalado'}`; showToast('Ferramentas verificadas.'); } } catch (error) { $('#toolVersions').textContent = `Erro: ${cleanError(error)}`; showToast('Não foi possível verificar as ferramentas.'); } finally { button.disabled = false; } }
async function checkUpdates() { const button = $('#checkUpdates'); button.disabled = true; $('#updateStatus').textContent = 'Verificando atualizações…'; try { showUpdateNotice(await window.ntc.checkForUpdates()); } catch { showUpdateNotice({ status: 'error', message: 'Não foi possível verificar atualizações agora.' }); } finally { button.disabled = false; } }
let imagePreviewTimer = null;
async function updateImagePreview() { const item = imageQueue[0]; if (!item) { $('#imagePreviewCard').classList.add('hidden'); return; } $('#imagePreviewCard').classList.remove('hidden'); $('#imagePreviewTitle').textContent = item.name; $('#imagePreviewOriginal').src = sourceUrl(item.source); $('#imagePreviewMeta').textContent = 'Gerando o resultado com estes ajustes…'; try { const preview = await window.ntc.previewImage({ source: item.source, format: $('#imageFormat').value, quality: $('#imageQuality').value, scale: $('#imageScale').value, width: $('#imageWidth').value, height: $('#imageHeight').value, keepRatio: $('#imageKeepRatio').checked }); $('#imagePreview').src = preview.dataUrl; $('#imagePreviewMeta').textContent = `Resultado: ${preview.width || 'original'} × ${preview.height || 'original'} · qualidade ${Math.max(1, Math.min(100, Number($('#imageQuality').value) || 85))}%`; } catch (error) { $('#imagePreviewMeta').textContent = cleanError(error); } }
function scheduleImagePreview() { clearTimeout(imagePreviewTimer); imagePreviewTimer = setTimeout(updateImagePreview, 260); }
$('#addMarker').onclick = () => { const [start, end] = waveformBounds(); if (end <= start) return; audioMarkers.push({ id: toolId(), name: `Trecho ${audioMarkers.length + 1}`, start, end }); renderMarkers(); showToast('Marcador criado para a seleção atual.'); };
$('#exportMarkers').onclick = () => { const item = currentEditingConversion(); if (!item || !audioMarkers.length) { showToast('Crie ao menos um marcador primeiro.'); return; } saveConversionEdits(); audioMarkers.forEach(marker => { const outputName = safeBase(`${item.outputName} - ${marker.name}`); conversionQueue.push({ ...structuredClone(item), conversionId: toolId(), outputName, trimStart: formatEditorTime(marker.start), trimEnd: formatEditorTime(marker.end), markers: [], status: 'pronto' }); }); renderConversionQueue(); startNextConversion(); showToast(`${audioMarkers.length} trechos adicionados à fila.`); };
$('#applyToAudioQueue').onclick = () => { const item = currentEditingConversion(); if (!item) return; saveConversionEdits(); const settings = currentAudioSettings(); conversionQueue.filter(entry => entry.conversionId !== item.conversionId && entry.status === 'pronto').forEach(entry => Object.assign(entry, settings)); renderConversionQueue(); showToast('Ajustes aplicados aos itens prontos da fila.'); };
$('#toggleSpectrum').onclick = () => { spectrumVisible = !spectrumVisible; $('#toggleSpectrum').textContent = spectrumVisible ? 'Ocultar espectro' : 'Ver espectro'; paintWaveform(); };
$('#audioPreset').onchange = event => { const basic = { voz: { gain: 1, eqBass: -2, eqMid: 3, eqTreble: 2, removeSilence: false }, musica: { gain: 0, eqBass: 2, eqMid: 0, eqTreble: 2, removeSilence: false }, podcast: { gain: 2, eqBass: -1, eqMid: 3, eqTreble: 1, removeSilence: true } }; const saved = JSON.parse(localStorage.getItem('ntc-audio-presets') || '{}'); const value = event.target.value; if (value) { applyAudioSettings(value.startsWith('saved:') ? saved[value.slice(6)] : basic[value]); showToast('Preset aplicado.'); } };
$('#saveAudioPreset').onclick = () => { const name = window.prompt('Nome do preset'); if (!name?.trim()) return; const presets = JSON.parse(localStorage.getItem('ntc-audio-presets') || '{}'); presets[name.trim().slice(0, 40)] = currentAudioSettings(); localStorage.setItem('ntc-audio-presets', JSON.stringify(presets)); refreshAudioPresets(); window.refreshMusicEqualizerPresets?.(); $('#audioPreset').value = `saved:${name.trim().slice(0, 40)}`; showToast('Preset salvo neste computador.'); };
async function chooseToolFolder() { const chosen = await window.ntc.chooseDownloadFolder(); if (!chosen) return; folder = chosen; localStorage.setItem('ntc-folder', folder); syncSettings(); refreshSpaceHint(); showToast('Pasta de destino atualizada.'); }
function wouldCreateLargeImage() { const scale = Math.max(1, Number($('#imageScale').value) || 100) / 100; const typedWidth = Number($('#imageWidth').value); const typedHeight = Number($('#imageHeight').value); return imageQueue.some(item => Math.max(typedWidth || Math.round((item.sourceWidth || 0) * scale), typedHeight || Math.round((item.sourceHeight || 0) * scale)) > 16384); }
async function startImagesWithWarning() { if (!imageQueue.some(item => item.status === 'pronto') && lastFailedImage) { if (!imageQueue.some(item => item.id === lastFailedImage.id)) imageQueue.push(lastFailedImage); lastFailedImage.status = 'pronto'; lastFailedImage = null; renderMediaQueue('image'); } if (wouldCreateLargeImage()) { const accepted = await confirmAction('Imagem muito grande', 'Este tamanho pode consumir muita memória, travar o computador ou falhar por limite do formato. Deseja tentar mesmo assim?', 'Tentar mesmo assim'); if (!accepted) return; } startNextImage(); }
$('#chooseVideo').onclick = async () => addVideos(await window.ntc.chooseVideoFiles()); $('#chooseImages').onclick = async () => { await addImages(await window.ntc.chooseImageFiles()); scheduleImagePreview(); }; $('#chooseVideoFolder').onclick = chooseToolFolder; $('#chooseImageFolder').onclick = chooseToolFolder; bindDropzone('videoDropzone', () => window.ntc.chooseVideoFiles(), addVideos); bindDropzone('imageDropzone', () => window.ntc.chooseImageFiles(), async files => { await addImages(files); scheduleImagePreview(); }); ['imageFormat', 'imageQuality', 'imageScale', 'imageWidth', 'imageHeight', 'imageKeepRatio'].forEach(id => $(`#${id}`).addEventListener(id === 'imageKeepRatio' ? 'change' : 'input', scheduleImagePreview)); $('#startVideos').onclick = startNextVideo; $('#startImages').onclick = startImagesWithWarning;
$('#chooseVideoEditor').onclick = async () => { const file = await window.ntc.chooseVideoEditorFile(); if (file) loadVideoEditor(file); }; bindDropzone('videoEditorDropzone', () => window.ntc.chooseVideoEditorFile().then(file => file ? [file] : []), files => { if (files[0]) loadVideoEditor(files[0]); }); $('#addVideoEditorAudio').onclick = addVideoEditorAudio; $('#chooseVideoEditorFolder').onclick = chooseToolFolder; $('#exportVideoEdit').onclick = exportVideoEdit;
$('#videoTimeline').addEventListener('pointerdown', event => { if (!videoEdit.source) return; const rect = event.currentTarget.getBoundingClientRect(); const point = Math.max(0, Math.min(videoEdit.meta.duration, (event.clientX - rect.left) / rect.width * videoEdit.meta.duration)); videoEdit.selectionStart = point; videoEdit.selectionEnd = point; event.currentTarget.setPointerCapture(event.pointerId); renderVideoEditorTimeline(); });
$('#videoTimeline').addEventListener('pointermove', event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = event.currentTarget.getBoundingClientRect(); videoEdit.selectionEnd = Math.max(0, Math.min(videoEdit.meta.duration, (event.clientX - rect.left) / rect.width * videoEdit.meta.duration)); renderVideoEditorTimeline(); });
$('#videoTimeline').addEventListener('pointerup', event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.currentTarget.releasePointerCapture(event.pointerId); });
$('#videoTimeline').addEventListener('keydown', event => { if (!videoEdit.source || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const next = Math.max(0, Math.min(videoEdit.meta.duration, videoEdit.selectionEnd + (event.key === 'ArrowRight' ? 1 : -1))); videoEdit.selectionStart = next; videoEdit.selectionEnd = next; $('#videoEditorPlayer').currentTime = next; renderVideoEditorTimeline(); });
$('#removeVideoCut').onclick = () => { const [start, end] = videoEditSelectionBounds(); if (end - start < .1) { showToast('Arraste na waveform para selecionar o trecho que deseja remover.'); return; } videoEdit.cuts.push({ start, end }); normalizeVideoEditCuts(); videoEdit.selectionStart = end; videoEdit.selectionEnd = Math.min(videoEdit.meta.duration, end + .1); $('#videoEditorPlayer').currentTime = Math.min(videoEdit.meta.duration, end); renderVideoEditorTimeline(); showToast('Trecho removido. O vídeo será unido ao exportar.'); };
$('#undoVideoCut').onclick = () => { videoEdit.cuts.pop(); videoEdit.selectionStart = 0; videoEdit.selectionEnd = Math.min(1, videoEditDuration()); renderVideoEditorTimeline(); };
$('#videoOriginalVolume').oninput = () => { $('#videoOriginalVolume').value = Math.max(0, Math.min(300, Number($('#videoOriginalVolume').value) || 0)); }; $('#videoMuteOriginal').onchange = () => { $('#videoOriginalTrack').classList.toggle('hidden', $('#videoMuteOriginal').checked); };
$('#videoEditorPlayer').addEventListener('timeupdate', event => { const player = event.currentTarget; const cut = videoEdit.cuts.find(item => player.currentTime >= item.start && player.currentTime < item.end); if (cut) player.currentTime = cut.end; renderVideoEditorTimeline(); });
document.addEventListener('pointermove', updateVideoEditorAudioDrag); document.addEventListener('pointerup', () => { videoEditDrag = null; });
$('#clearHistory').onclick = clearHistoryWithConfirm; $('#clearHistorySettings').onclick = clearHistoryWithConfirm; $('#clearHistoryPage').onclick = clearHistoryWithConfirm; $('#resetPreferences').onclick = resetPreferences; $('#checkTools').onclick = checkTools; $('#checkUpdates').onclick = checkUpdates;
$('#filesHistoryTab').onclick = () => setHistoryTab('files'); $('#qrHistoryTab').onclick = () => setHistoryTab('qr'); $('#clearQrHistory').onclick = clearQrHistoryWithConfirm;
$('#addQrLinks').onclick = addQrLinks; $('#qrLinks').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); addQrLinks(); } });
$('#generateQrCodes').onclick = () => { qrQueue.filter(item => item.status === 'cancelado').forEach(item => { item.status = 'aguardando'; }); processQrQueue(); };
$('#cancelQrQueue').onclick = () => { qrCancelRequested = true; $('#cancelQrQueue').disabled = true; $('#cancelQrQueue').textContent = 'Parando…'; };
$('#chooseQrFolder').onclick = async () => { const chosen = await window.ntc.chooseDownloadFolder(); if (!chosen) return; folder = chosen; localStorage.setItem('ntc-folder', folder); syncSettings(); showToast('Pasta de QR Codes atualizada.'); };
['qrForeground', 'qrBackground', 'qrSize', 'qrFormat'].forEach(id => { $(`#${id}`).addEventListener('input', onQrSettingsChange); $(`#${id}`).addEventListener('change', onQrSettingsChange); });
window.ntc.onQrEvent(update => { const item = qrQueue.find(entry => entry.id === update.id); if (!item) return; if (update.status === 'generating') item.status = 'gerando'; if (update.status === 'complete') item.status = 'concluido'; if (update.status === 'failed') { item.status = 'erro'; item.error = qrFailureMessage(update.error); } renderQrQueue(); });
window.ntc.onRngState(renderRngState);
$('#rngRollButton').onclick = performManualRngRoll;
$('#rngAutoButton').onclick = toggleRngAutoRoll;
function setRngSection(section) {
  rngActiveSection = section;
  $$('[data-rng-section]').forEach(tab => tab.classList.toggle('active', tab.dataset.rngSection === section));
  $$('[data-rng-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.rngPanel !== section));
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
$('#rngBuyUpgrade').onclick = () => performRngShopAction('purchaseRngUpgrade', undefined, result => `Sorte permanente aumentada para o nível ${new Intl.NumberFormat('pt-BR').format(result.levels)}.`);
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
$('#rngDebugTitleSelect').onchange = () => { $('#rngDebugStatus').textContent = ''; updateRngDebugControls(); };
$('#rngDebugSimulate').onclick = simulateRngUnlock;
$('#rngDebugSoundTest').onclick = previewRngTitleSound;
$('#rngDebugAdd').onclick = debugAddSelectedRngTitle;
$('#rngDebugRemove').onclick = debugRemoveSelectedRngTitle;
$('#rngDebugClearAll').onclick = debugClearRngCollection;
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
function navigateToView(target) {
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === target));
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${target}View`));
  if (target === 'rng') showNewRngPatchNotes();
}
$$('.nav-item[data-view]').forEach(button => button.onclick = () => navigateToView(button.dataset.view));
$$('[data-open-tool]').forEach(button => button.onclick = () => navigateToView(button.dataset.openTool));
function updateMaximizedLayout(maximized) { document.body.classList.toggle('window-maximized', Boolean(maximized)); $('#maximizeWindow').textContent = maximized ? '❐' : '□'; $('#maximizeWindow').setAttribute('aria-label', maximized ? 'Restaurar' : 'Maximizar'); }
$('#minimizeWindow').onclick = () => window.ntc.minimizeWindow(); $('#maximizeWindow').onclick = async () => updateMaximizedLayout(await window.ntc.toggleMaximize()); $('#closeWindow').onclick = () => window.ntc.closeWindow();
window.ntc.isMaximized().then(updateMaximizedLayout); window.ntc.onWindowMaximized(updateMaximizedLayout);
$('#chooseMedia').onclick = async () => addMediaFiles(await window.ntc.chooseMediaFiles());
$('#mediaDropzone').onclick = async () => addMediaFiles(await window.ntc.chooseMediaFiles());
$('#mediaDropzone').onkeydown = async event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); addMediaFiles(await window.ntc.chooseMediaFiles()); } };
['dragenter', 'dragover'].forEach(name => $('#mediaDropzone').addEventListener(name, event => { event.preventDefault(); $('#mediaDropzone').classList.add('dragging'); }));
['dragleave', 'drop'].forEach(name => $('#mediaDropzone').addEventListener(name, event => { event.preventDefault(); $('#mediaDropzone').classList.remove('dragging'); }));
$('#mediaDropzone').addEventListener('drop', event => { const files = [...event.dataTransfer.files].map(file => file.path || window.ntc.pathForFile(file)).filter(Boolean); if (files.length) addMediaFiles(files); else showToast('Não foi possível acessar o arquivo arrastado. Use Selecionar arquivos.'); });
$('#converterFormat').onchange = event => { conversionQualityOptions(event.target.value); updateConverterExtension(event.target.value); rememberEditorChange(); };
['trimStart', 'trimEnd'].forEach(id => $(`#${id}`).addEventListener('input', () => { paintWaveform(); rememberEditorChange(); }));
['converterQuality', 'converterOutputName', 'audioGain', 'eqBass', 'eqMid', 'eqTreble', 'metadataTitle', 'metadataArtist', 'metadataAlbum', 'metadataYear', 'metadataGenre'].forEach(id => $(`#${id}`).addEventListener('input', rememberEditorChange));
['audioGain', 'eqBass', 'eqMid', 'eqTreble'].forEach(id => $(`#${id}`).addEventListener('input', updatePreviewEffects));
$('#removeSilence').addEventListener('change', rememberEditorChange);
$('#normalizeAudio').addEventListener('change', rememberEditorChange);
$('#waveformCanvas').addEventListener('pointerdown', event => { waveformHandle = null; $('#waveformCanvas').setPointerCapture(event.pointerId); moveWaveformHandle(event); });
$('#waveformCanvas').addEventListener('pointermove', event => { if (event.buttons) moveWaveformHandle(event); });
['pointerup', 'pointercancel'].forEach(name => $('#waveformCanvas').addEventListener(name, () => { waveformHandle = null; }));
$('#waveformCanvas').addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); const item = currentEditingConversion(); if (!item?.duration) return; const rect = $('#waveformCanvas').getBoundingClientRect(); const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); const [start, end, duration] = waveformBounds(item); const [from, to] = waveformViewport(duration, start, end); waveformFocus = from + ratio * (to - from); waveformZoom = Math.max(1, Math.min(8, waveformZoom + (event.deltaY < 0 ? .5 : -.5))); paintWaveform(); }, { passive: false, capture: true });
$('#rewindPreview').onclick = () => seekPreview(-5); $('#forwardPreview').onclick = () => seekPreview(5);
$('#playSelection').onclick = playSelectedRange;
$('#undoEdit').onclick = undoEditorChange; $('#redoEdit').onclick = redoEditorChange;
$('#saveConversionEdits').onclick = () => { saveConversionEdits(); startNextConversion(); }; $('#chooseConverterFolder').onclick = chooseConverterFolder; $('#chooseCover').onclick = chooseCover;
$('#removeCover').onclick = () => { const item = currentEditingConversion(); if (item) { item.cover = null; $('#coverName').textContent = 'Sem alteração'; } };
$('#startConversions').onclick = () => { saveConversionEdits(); startNextConversion(); };
$('#abortConversions').onclick = () => { if (currentConversion) { abortedConversions.add(currentConversion.conversionId); window.ntc.cancelConversion(currentConversion.conversionId); } conversionQueue = []; editingConversionId = null; $('#converterEditor').classList.add('hidden'); $('#conversionProgress').classList.add('hidden'); renderConversionQueue(); };
$('#dismissEditAfterDownload').onclick = hideEditAfterDownload;
$('#openDownloadedInEditor').onclick = async () => { const item = downloadedAudioToEdit; hideEditAfterDownload(); if (!item) return; await addMediaFiles([item.file]); $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === 'converter')); $$('.view').forEach(view => view.classList.toggle('active', view.id === 'converterView')); };
document.addEventListener('keydown', event => {
  const tag = event.target?.tagName; const editorActive = $('#converterView').classList.contains('active'); if (!editorActive) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undoEditorChange(); return; }
  if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) { event.preventDefault(); redoEditorChange(); return; }
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return;
  if (event.code === 'Space') { event.preventDefault(); playSelectedRange(); return; }
  if (event.key === 'ArrowLeft') { event.preventDefault(); seekPreview(-5); }
  if (event.key === 'ArrowRight') { event.preventDefault(); seekPreview(5); }
});
document.addEventListener('keydown', async event => {
  const downloaderActive = $('#downloaderView').classList.contains('active'); const tag = event.target?.tagName;
  if (downloaderActive && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && !['INPUT', 'TEXTAREA'].includes(tag)) { try { const text = await navigator.clipboard.readText(); if (text) { event.preventDefault(); $('#videoUrl').value = text.trim(); $('#videoUrl').focus(); loadPreview(); } } catch { showToast('Cole o link diretamente no campo.'); } }
  if (event.key === 'Escape' && !$('#confirmDialog').classList.contains('hidden')) return;
  if (event.key === 'Escape' && current) { event.preventDefault(); window.ntc.cancelDownload(current.downloadId); }
  if (event.key === 'Escape' && currentConversion) { event.preventDefault(); window.ntc.cancelConversion(currentConversion.conversionId); }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!$('#confirmDialog').classList.contains('hidden')) { closeConfirm(false); return; }
  if (!$('#rngPatchNotesDialog').classList.contains('hidden')) { closeRngPatchNotesDialog(); return; }
  if (!$('#changelogDialog').classList.contains('hidden')) { $('#changelogDialog').classList.add('hidden'); return; }
  if (!$('#rngDebugDialog').classList.contains('hidden')) closeRngDebug();
});
initializeQrSettings(); syncSettings(); loadMicrophones(); $('#compressionFolderPath').textContent = localStorage.getItem('ntc-compression-folder') || folder || 'Downloads'; setFormatOptions(); conversionQualityOptions('mp3'); updateConverterExtension('mp3'); renderHistory(); renderQrQueue(); renderQueue(); renderConversionQueue(); renderCompressionQueue();
window.ntc.appVersion().then(version => {
  activeAppVersion = String(version);
  $('#appVersion').textContent = `v${activeAppVersion}`;
  showChangelogAfterUpgrade(activeAppVersion);
  const rngSeenVersion = localStorage.getItem('ntc-rng-patch-notes-app-version');
  if (previouslySeenAppVersion !== activeAppVersion && rngSeenVersion !== activeAppVersion) localStorage.setItem('ntc-rng-patch-notes-pending-version', activeAppVersion);
  if (rngPatchNotesOpenPending) { rngPatchNotesOpenPending = false; showNewRngPatchNotes(); }
}).catch(() => { $('#appVersion').textContent = 'Indisponível'; });
window.ntc.defaultDownloadFolder().then(value => { if (!folder) { folder = value; localStorage.setItem('ntc-folder', folder); syncSettings(); } refreshSpaceHint(); });
