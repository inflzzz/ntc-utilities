(function () {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let settings = null;
  let availableProcesses = [];
  let processListLoading = false;
  let saveTimer = null;
  let activated = false;
  let runtime = { active: false, paused: false, runClicks: 0, totalClicks: 0 };

  function toast(message) {
    const element = $('#toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
  }
  function safe(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }
  function cleanError(error) {
    return String(error && error.message || error || 'Não foi possível concluir a operação.')
      .replace(/^Error invoking remote method ['"]?[^'"]+['"]?: Error:\s*/i, '').replace(/^Error:\s*/i, '');
  }
  function formatCount(value) { return new Intl.NumberFormat('pt-BR').format(Number(value) || 0); }
  function displayHotkey(value) {
    return String(value || 'F6').replace(/^Control\+/, 'Ctrl + ').replace(/^Alt\+/, 'Alt + ').replace(/^Shift\+/, 'Shift + ')
      .replaceAll('+', ' + ').replaceAll('PrintScreen', 'Print Screen');
  }
  function parseShortcut(event) {
    const ignored = ['Control', 'Shift', 'Alt', 'Meta'];
    if (ignored.includes(event.key)) return '';
    const printKeys = ['PrintScreen', 'Print', 'Snapshot', 'PrtSc', 'PrtScn', 'SysReq'];
    const print = ['PrintScreen', 'Snapshot'].includes(event.code) || printKeys.includes(event.key) || (event.key === 'Cancel' && (event.ctrlKey || event.metaKey));
    const keyNames = { ' ': 'SPACE', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', '+': 'PLUS' };
    const key = print ? 'PRINTSCREEN' : keyNames[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase());
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('CONTROL');
    if (event.altKey) parts.push('ALT');
    if (event.shiftKey) parts.push('SHIFT');
    parts.push(key);
    return parts.join('+');
  }
  function syncFields(value) {
    settings = { ...value };
    const text = (id, field) => { if (field !== undefined && field !== null) $(id).value = field; };
    const check = (id, field) => { $(id).checked = Boolean(field); };
    $('#autoclickerHotkey').dataset.value = settings.hotkey || 'F6';
    $('#autoclickerHotkey').value = displayHotkey(settings.hotkey);
    text('#autoclickerMode', settings.mode); text('#autoclickerInputType', settings.inputType);
    text('#autoclickerMouseButton', settings.mouseButton); text('#autoclickerKey', settings.keyboardKey);
    check('#autoclickerUppercase', settings.keyboardKeyCase === 'upper');
    text('#autoclickerSpeed', settings.clickSpeed); text('#autoclickerInterval', settings.clickInterval);
    check('#autoclickerAdvanced', settings.advancedOptions);
    check('#autoclickerRandomize', settings.speedRandomizationEnabled); text('#autoclickerVariation', settings.speedRandomization);
    check('#autoclickerDutyEnabled', settings.dutyCycleEnabled); text('#autoclickerDuty', settings.dutyCycle);
    check('#autoclickerDoubleClick', settings.doubleClickEnabled); text('#autoclickerDoubleGap', settings.doubleClickGapMs);
    check('#autoclickerClickLimitEnabled', settings.clickLimitEnabled); text('#autoclickerClickLimit', settings.clickLimit);
    check('#autoclickerTimeLimitEnabled', settings.timeLimitEnabled); text('#autoclickerTimeLimit', settings.timeLimit);
    text('#autoclickerTimeUnit', settings.timeLimitUnit); check('#autoclickerEdgeStop', settings.edgeStopEnabled);
    text('#autoclickerEdgeMargin', settings.edgeStopLeft); check('#autoclickerTaskSwitcherStop', settings.taskSwitcherStopEnabled);
    check('#autoclickerCornerStop', settings.cornerStopEnabled);
    text('#autoclickerCornerMargin', settings.cornerStopTL);
    text('#autoclickerOffset', settings.offset); text('#autoclickerOffsetChance', settings.offsetChance); text('#autoclickerSmoothing', settings.smoothing);
    check('#autoclickerPointsEnabled', settings.clickPointsEnabled); check('#autoclickerStopWhenComplete', settings.stopWhenComplete);
    check('#autoclickerZonesEnabled', settings.stopZonesEnabled); check('#autoclickerProcessEnabled', settings.processListEnabled);
    text('#autoclickerProcessMode', settings.processListMode);
    updateInputVisibility();
    renderLists();
  }
  function updateInputVisibility() {
    const keyboard = $('#autoclickerInputType').value === 'keyboard';
    $('#autoclickerMouseField').classList.toggle('hidden', keyboard);
    $('#autoclickerKeyField').classList.toggle('hidden', !keyboard);
    $('#autoclickerCaseField').classList.toggle('hidden', !keyboard);
    $('#autoclickerAdvancedOptions').classList.toggle('hidden', !$('#autoclickerAdvanced').checked);
  }
  function renderLists() {
    if (!settings) return;
    const points = settings.clickPoints || [];
    $('#autoclickerPointsList').innerHTML = points.length ? points.map((point, index) =>
      '<div class="autoclicker-item-row"><span><strong>Ponto ' + (index + 1) + ' · ' + point.x + ', ' + point.y +
      '</strong><small>Raio ' + point.radius + ' px</small></span><div class="autoclicker-item-actions"><label class="autoclicker-point-clicks"><span>Cliques</span><input type="number" min="1" max="100000" step="1" value="' +
      Math.max(1, Number(point.clicks) || 1) + '" data-point-clicks="' + safe(point.id) + '" aria-label="Quantidade de cliques no ponto ' + (index + 1) + '" /></label><button type="button" data-remove-click-point="' +
      safe(point.id) + '" aria-label="Remover ponto ' + (index + 1) + '">×</button></div></div>').join('') : '<div class="autoclicker-empty">Nenhum ponto adicionado.</div>';
    const actionNames = { stop: 'Parar', pause: 'Pausar', start: 'Retomar' };
    const zones = settings.stopZones || [];
    $('#autoclickerZonesList').innerHTML = zones.length ? zones.map((zone, index) =>
      '<div class="autoclicker-item-row"><span><strong>Zona ' + (index + 1) + ' · ' + (actionNames[zone.action] || 'Parar') +
      '</strong><small>' + zone.width + ' × ' + zone.height + 'px</small></span><button type="button" data-remove-click-zone="' +
      safe(zone.id) + '" aria-label="Remover zona ' + (index + 1) + '">×</button></div>').join('') : '<div class="autoclicker-empty">Nenhuma zona configurada.</div>';
    const entries = settings.processListEntries || [];
    const selectedCount = entries.filter(entry => entry.enabled !== false).length;
    $('#autoclickerProcessSummary').textContent = selectedCount + ' selecionados · ' + availableProcesses.length + ' abertos';
    const entryMap = new Map(entries.map(entry => [entry.name.toLocaleLowerCase(), entry]));
    const runningNames = new Set(availableProcesses.map(process => process.name.toLocaleLowerCase()));
    const search = $('#autoclickerProcessSearch').value.trim().toLocaleLowerCase();
    const visibleProcesses = availableProcesses.filter(process =>
      !search || process.displayName.toLocaleLowerCase().includes(search) || process.name.toLocaleLowerCase().includes(search)
    );
    const rows = visibleProcesses.map(process => ({ ...process, isOpen: true }));
    entries.filter(entry => !runningNames.has(entry.name.toLocaleLowerCase())).forEach(entry => rows.push({ name: entry.name, displayName: 'Não está aberto agora', isOpen: false }));
    $('#autoclickerProcessList').innerHTML = rows.length ? rows.map(process => {
      const entry = entryMap.get(process.name.toLocaleLowerCase());
      const checked = Boolean(entry && entry.enabled !== false);
      return '<label class="autoclicker-process-option"><input type="checkbox" data-process-toggle="' + safe(process.name) + '"' + (checked ? ' checked' : '') +
        '><span class="autoclicker-process-copy"><strong>' + safe(process.displayName) + '</strong><small>' + safe(process.name) + '.exe' + (process.isOpen ? '' : ' · salvo') +
        '</small></span>' + (checked ? '<span class="autoclicker-process-rule">' + (settings.processListMode === 'whitelist' ? 'Permitido' : 'Bloqueado') + '</span>' : '') + '</label>';
    }).join('') : '<div class="autoclicker-empty">' + (processListLoading ? 'Buscando aplicativos abertos…' : availableProcesses.length ? 'Nenhum aplicativo corresponde ao filtro.' : 'Nenhum aplicativo aberto detectado.') + '</div>';
  }
  function collectFields() {
    const next = { ...settings };
    next.hotkey = $('#autoclickerHotkey').dataset.value || settings.hotkey || 'F6';
    next.mode = $('#autoclickerMode').value; next.inputType = $('#autoclickerInputType').value;
    next.mouseButton = $('#autoclickerMouseButton').value; next.keyboardKey = $('#autoclickerKey').value || 'A';
    next.keyboardKeyCase = $('#autoclickerUppercase').checked ? 'upper' : 'lower';
    next.clickSpeed = Number($('#autoclickerSpeed').value) || 10; next.clickInterval = $('#autoclickerInterval').value;
    next.advancedOptions = $('#autoclickerAdvanced').checked;
    next.speedRandomizationEnabled = $('#autoclickerRandomize').checked; next.speedRandomization = Number($('#autoclickerVariation').value) || 0;
    next.dutyCycleEnabled = $('#autoclickerDutyEnabled').checked; next.dutyCycle = Number($('#autoclickerDuty').value) || 0;
    next.doubleClickEnabled = $('#autoclickerDoubleClick').checked; next.doubleClickGapMs = Number($('#autoclickerDoubleGap').value) || 45;
    next.clickLimitEnabled = $('#autoclickerClickLimitEnabled').checked; next.clickLimit = Number($('#autoclickerClickLimit').value) || 1000;
    next.timeLimitEnabled = $('#autoclickerTimeLimitEnabled').checked; next.timeLimit = Number($('#autoclickerTimeLimit').value) || 60;
    next.timeLimitUnit = $('#autoclickerTimeUnit').value;
    next.edgeStopEnabled = $('#autoclickerEdgeStop').checked;
    const margin = Number($('#autoclickerEdgeMargin').value) || 0;
    next.edgeStopTop = margin; next.edgeStopRight = margin; next.edgeStopBottom = margin; next.edgeStopLeft = margin;
    next.cornerStopEnabled = $('#autoclickerCornerStop').checked;
    const cornerMargin = Number($('#autoclickerCornerMargin').value) || 0;
    next.cornerStopTL = cornerMargin; next.cornerStopTR = cornerMargin; next.cornerStopBL = cornerMargin; next.cornerStopBR = cornerMargin;
    next.taskSwitcherStopEnabled = $('#autoclickerTaskSwitcherStop').checked;
    next.offset = Number($('#autoclickerOffset').value) || 0; next.offsetChance = Number($('#autoclickerOffsetChance').value) || 0;
    next.smoothing = Number($('#autoclickerSmoothing').value) || 0;
    next.clickPointsEnabled = $('#autoclickerPointsEnabled').checked; next.stopWhenComplete = $('#autoclickerStopWhenComplete').checked;
    next.stopZonesEnabled = $('#autoclickerZonesEnabled').checked;
    next.processListEnabled = $('#autoclickerProcessEnabled').checked; next.processListMode = $('#autoclickerProcessMode').value;
    return next;
  }
  async function saveNow() {
    if (!settings) return;
    try {
      const result = await window.ntc.saveAutoClickerSettings(collectFields());
      if (result.settings) settings = result.settings;
      renderState(result);
    } catch (error) { toast('Não foi possível salvar: ' + cleanError(error)); }
  }
  async function activate() {
    if (activated) return;
    try {
      const state = await window.ntc.activateAutoClicker();
      activated = Boolean(state.supported);
      renderState(state);
      if (activated) refreshProcesses();
    } catch (error) { renderState({ supported: false, status: 'Erro', message: cleanError(error) }); }
  }
  async function refreshProcesses() {
    if (!activated || processListLoading) return;
    processListLoading = true;
    renderLists();
    try { await window.ntc.listAutoClickerProcesses(); }
    catch (error) { processListLoading = false; toast('Não foi possível listar os aplicativos: ' + cleanError(error)); renderLists(); }
  }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
  function renderState(state) {
    runtime = { ...runtime, ...state };
    const active = Boolean(runtime.active);
    $('#autoclickerStatus').textContent = runtime.status || (active ? 'Ativo' : 'Parado');
    $('#autoclickerStatusDetail').textContent = runtime.message || ('Atalho ' + (settings && settings.hotkey || 'F6') + ' · pressione para iniciar ou parar');
    $('#autoclickerStatusDot').dataset.active = String(active);
    $('#autoclickerRunCount').textContent = formatCount(runtime.runClicks);
    $('#autoclickerTotalCount').textContent = formatCount(runtime.totalClicks || settings && settings.totalClicks);
    $('#autoclickerStart').disabled = active || state.supported === false;
    $('#autoclickerStop').disabled = !active;
    $('#autoclickerStart').textContent = active ? 'Cliques ativos' : 'Iniciar cliques';
    if (state.supported === false) {
      $('#autoclickerStatus').textContent = 'Indisponível';
      $('#autoclickerStatusDetail').textContent = 'O Auto-clicker requer Windows.';
    }
  }

  window.ntc.onAutoClickerEvent(event => {
    if (event.type === 'state') renderState(event);
    if (event.settings) { settings = event.settings; renderLists(); $('#autoclickerTotalCount').textContent = formatCount(settings.totalClicks); }
    if (event.type === 'picker') {
      $('#autoclickerFooter').textContent = event.message || 'Selecione a área na tela.';
      if (!event.active && event.cancelled) toast(event.message || 'Seleção cancelada.');
    }
    if (event.type === 'point') { $('#autoclickerFooter').textContent = event.message || 'Ponto adicionado à lista.'; renderLists(); toast('Ponto de clique adicionado.'); }
    if (event.type === 'delete-point') { $('#autoclickerFooter').textContent = event.deleted ? 'Ponto removido.' : 'Não há um ponto próximo para remover.'; if (event.deleted) toast('Ponto de clique removido.'); }
    if (event.type === 'zone') { $('#autoclickerFooter').textContent = 'Zona de segurança configurada.'; renderLists(); toast('Zona de segurança adicionada.'); }
    if (event.type === 'processes') { availableProcesses = Array.isArray(event.items) ? event.items : []; processListLoading = false; renderLists(); }
    if (event.type === 'error') toast(event.message || 'Falha no Auto-clicker.');
  });
  window.ntc.getAutoClickerState().then(state => {
    if (state.settings) syncFields(state.settings);
    renderState(state);
  }).catch(error => renderState({ supported: false, status: 'Erro', message: cleanError(error) }));
  document.querySelectorAll('.nav-item[data-view="autoclicker"], [data-open-tool="autoclicker"]').forEach(button => button.addEventListener('click', activate));

  $('#autoclickerHotkey').addEventListener('focus', () => window.ntc.setShortcutRecorderFocused(true));
  $('#autoclickerHotkey').addEventListener('blur', () => window.ntc.setShortcutRecorderFocused(false));
  $('#autoclickerHotkey').addEventListener('keydown', event => {
    event.preventDefault();
    if (event.key === 'Backspace' || event.key === 'Delete') {
      $('#autoclickerHotkey').dataset.value = 'F6'; $('#autoclickerHotkey').value = 'F6'; scheduleSave(); return;
    }
    const hotkey = parseShortcut(event);
    if (!hotkey) return;
    $('#autoclickerHotkey').dataset.value = hotkey;
    $('#autoclickerHotkey').value = displayHotkey(hotkey);
    scheduleSave();
  });
  const fieldIds = ['autoclickerMode', 'autoclickerInputType', 'autoclickerMouseButton', 'autoclickerKey', 'autoclickerUppercase', 'autoclickerSpeed', 'autoclickerInterval', 'autoclickerAdvanced', 'autoclickerRandomize', 'autoclickerVariation', 'autoclickerDutyEnabled', 'autoclickerDuty', 'autoclickerDoubleClick', 'autoclickerDoubleGap', 'autoclickerClickLimitEnabled', 'autoclickerClickLimit', 'autoclickerTimeLimitEnabled', 'autoclickerTimeLimit', 'autoclickerTimeUnit', 'autoclickerEdgeStop', 'autoclickerEdgeMargin', 'autoclickerCornerStop', 'autoclickerCornerMargin', 'autoclickerTaskSwitcherStop', 'autoclickerOffset', 'autoclickerOffsetChance', 'autoclickerSmoothing', 'autoclickerPointsEnabled', 'autoclickerStopWhenComplete', 'autoclickerZonesEnabled', 'autoclickerProcessEnabled', 'autoclickerProcessMode'];
  fieldIds.forEach(id => {
    const field = $('#' + id);
    field.addEventListener('input', () => { updateInputVisibility(); renderLists(); scheduleSave(); });
    field.addEventListener('change', () => { updateInputVisibility(); renderLists(); scheduleSave(); });
  });
  $('#autoclickerStart').addEventListener('click', async () => {
    try { renderState(await window.ntc.setAutoClickerActive(true)); } catch (error) { toast(cleanError(error)); }
  });
  $('#autoclickerStop').addEventListener('click', async () => {
    try { renderState(await window.ntc.setAutoClickerActive(false)); } catch (error) { toast(cleanError(error)); }
  });
  $('#autoclickerAddPoint').addEventListener('click', async () => {
    $('#autoclickerFooter').textContent = 'Botão direito marca; segure Shift + botão direito para adicionar outro ponto. Ctrl + botão direito apaga o mais próximo. Esc cancela.';
    try { await window.ntc.pickAutoClickerPoint(); } catch (error) { toast(cleanError(error)); }
  });
  $('#autoclickerAddZone').addEventListener('click', async () => {
    $('#autoclickerFooter').textContent = 'Arraste com o botão direito para desenhar a zona. Esc cancela.';
    try { await window.ntc.pickAutoClickerZone($('#autoclickerZoneAction').value); } catch (error) { toast(cleanError(error)); }
  });
  $('#autoclickerRefreshProcesses').addEventListener('click', refreshProcesses);
  $('#autoclickerProcessSearch').addEventListener('input', renderLists);
  $('#autoclickerPointsList').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-click-point]'); if (!button || !settings) return;
    settings.clickPoints = (settings.clickPoints || []).filter(point => point.id !== button.dataset.removeClickPoint);
    renderLists(); scheduleSave();
  });
  $('#autoclickerPointsList').addEventListener('change', event => {
    const input = event.target.closest('[data-point-clicks]'); if (!input || !settings) return;
    const point = (settings.clickPoints || []).find(item => item.id === input.dataset.pointClicks);
    if (!point) return;
    point.clicks = Math.max(1, Math.min(100000, Math.floor(Number(input.value) || 1)));
    renderLists(); scheduleSave();
  });
  $('#autoclickerZonesList').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-click-zone]'); if (!button || !settings) return;
    settings.stopZones = (settings.stopZones || []).filter(zone => zone.id !== button.dataset.removeClickZone);
    renderLists(); scheduleSave();
  });
  $('#autoclickerProcessList').addEventListener('change', event => {
    const checkbox = event.target.closest('[data-process-toggle]'); if (!checkbox || !settings) return;
    const name = checkbox.dataset.processToggle;
    settings.processListEntries = (settings.processListEntries || []).filter(entry => entry.name.toLocaleLowerCase() !== name.toLocaleLowerCase());
    if (checkbox.checked) settings.processListEntries.push({ name, enabled: true });
    renderLists(); scheduleSave();
  });
  setInterval(() => {
    const view = $('#autoclickerView');
    if (activated && view && view.classList.contains('active')) refreshProcesses();
  }, 5000);
})();
