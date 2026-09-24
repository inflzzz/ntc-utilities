(function () {
  const $ = selector => document.querySelector(selector);
  const MAX_ITEMS = window.NTC_Renamer?.MAX_ITEMS || 1000;
  let selectedFiles = [];
  let latestPreview = null;
  let previewTimer = null;
  let previewRequest = 0;
  let working = false;
  let hasCompletedResults = false;

  function fileKey(file) { return String(file).replaceAll('/', '\\').replace(/\\+/g, '\\').toLowerCase(); }
  function options() {
    return {
      prefix: $('#renamePrefix').value,
      suffix: $('#renameSuffix').value,
      find: $('#renameFind').value,
      replacement: $('#renameReplacement').value,
      numbering: $('#renameNumbering').checked,
      numberStart: $('#renameNumberStart').value,
      numberDigits: $('#renameNumberDigits').value,
      numberPosition: $('#renameNumberPosition').value,
      numberSeparator: $('#renameNumberSeparator').value
    };
  }

  function errorMessage(error, fallback) {
    return String(error?.message || error || fallback)
      .replace(/^Error invoking remote method ['"]?[^'"]+['"]?: Error:\s*/i, '')
      .replace(/^Error:\s*/i, '');
  }

  function statusLabel(status) {
    return ({ ready: 'Pronto', 'no-change': 'Sem alteração', invalid: 'Nome inválido', duplicate: 'Nome repetido', exists: 'Já existe', complete: 'Renomeado' })[status] || status;
  }

  function renderRows(items, emptyMessage = 'Selecione ou arraste arquivos para ver os novos nomes.') {
    const list = $('#renamePreviewList');
    if (!items.length) {
      list.innerHTML = `<div class="renamer-empty">${emptyMessage}</div>`;
      return;
    }
    list.innerHTML = items.map(item => `<article class="renamer-file-row" data-status="${item.status}"><div class="renamer-file-name"><small>Atual</small><span title="${escapeHtml(item.originalName)}">${escapeHtml(item.originalName)}</span></div><span class="renamer-file-arrow" aria-hidden="true">→</span><div class="renamer-file-name"><small>Novo</small><span title="${escapeHtml(item.newName)}">${escapeHtml(item.newName)}</span></div><span class="renamer-file-status" title="${escapeHtml(item.message || statusLabel(item.status))}">${escapeHtml(statusLabel(item.status))}</span></article>`).join('');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function updateControls() {
    $('#clearRenameFiles').disabled = (!selectedFiles.length && !hasCompletedResults) || working;
    $('#applyFileRenames').disabled = !latestPreview?.valid || working;
    $('#applyFileRenames').textContent = working ? 'Renomeando…' : 'Renomear arquivos';
    $('#chooseRenameFiles').disabled = working;
    $('#renameNumberStart').disabled = !$('#renameNumbering').checked || working;
    $('#renameNumberDigits').disabled = !$('#renameNumbering').checked || working;
    $('#renameNumberPosition').disabled = !$('#renameNumbering').checked || working;
    $('#renameNumberSeparator').disabled = !$('#renameNumbering').checked || working;
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    latestPreview = null;
    hasCompletedResults = false;
    previewRequest += 1;
    updateControls();
    if (!selectedFiles.length) {
      $('#renamePreviewCount').textContent = '0 arquivos';
      $('#renameStatus').textContent = 'Nenhuma alteração aplicada.';
      renderRows([]);
      return;
    }
    $('#renameStatus').textContent = 'Atualizando prévia…';
    previewTimer = setTimeout(() => void refreshPreview(previewRequest), 130);
  }

  async function refreshPreview(requestId) {
    try {
      const result = await window.ntc.previewFileRenames({ files: [...selectedFiles], options: options() });
      if (requestId !== previewRequest) return;
      latestPreview = result;
      $('#renamePreviewCount').textContent = `${result.items.length} ${result.items.length === 1 ? 'arquivo' : 'arquivos'} · ${result.changedCount} ${result.changedCount === 1 ? 'alteração' : 'alterações'}`;
      const skippedNote = result.ignoredSymbolicLinks ? ` ${result.ignoredSymbolicLinks} atalho(s) de pasta foram ignorados por segurança.` : '';
      $('#renameStatus').textContent = result.errorCount
        ? `${result.errorCount} item(ns) precisam de ajuste.${skippedNote}`
        : result.valid
          ? `Confira os nomes e aplique quando estiver pronto.${skippedNote}`
          : result.items.length
            ? `Nenhuma alteração nos nomes selecionados.${skippedNote}`
            : `Nenhum arquivo encontrado nessa seleção.${skippedNote}`;
      renderRows(result.items, 'A pasta não contém arquivos compatíveis para renomear.');
      updateControls();
    } catch (error) {
      if (requestId !== previewRequest) return;
      latestPreview = null;
      $('#renamePreviewCount').textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? 'arquivo' : 'arquivos'}`;
      $('#renameStatus').textContent = errorMessage(error, 'Não foi possível criar a prévia.');
      renderRows([], 'Revise os arquivos selecionados e tente novamente.');
      updateControls();
    }
  }

  function addFiles(files) {
    if (working) return;
    const known = new Set(selectedFiles.map(fileKey));
    const additions = [];
    for (const file of files || []) {
      if (typeof file !== 'string' || !file) continue;
      const key = fileKey(file);
      if (known.has(key)) continue;
      known.add(key);
      additions.push(file);
    }
    if (selectedFiles.length + additions.length > MAX_ITEMS) {
      $('#renameStatus').textContent = `O limite é ${MAX_ITEMS} arquivos por operação. Remova alguns antes de adicionar mais.`;
      return;
    }
    selectedFiles.push(...additions);
    if (additions.length) schedulePreview();
  }

  async function chooseFiles() {
    if (working) return;
    try { addFiles(await window.ntc.chooseRenameFiles()); }
    catch (error) { $('#renameStatus').textContent = errorMessage(error, 'Não foi possível abrir os arquivos.'); }
  }

  async function applyRenames() {
    if (!latestPreview?.valid || working) return;
    working = true;
    updateControls();
    $('#renameStatus').textContent = 'Renomeando arquivos com segurança…';
    try {
      const result = await window.ntc.renameFiles({ files: [...selectedFiles], options: options() });
      selectedFiles = [];
      latestPreview = null;
      hasCompletedResults = true;
      previewRequest += 1;
      $('#renamePreviewCount').textContent = `${result.renamedCount} ${result.renamedCount === 1 ? 'arquivo renomeado' : 'arquivos renomeados'}`;
      $('#renameStatus').textContent = `Concluído. Os arquivos continuam nas pastas originais.${result.ignoredSymbolicLinks ? ` ${result.ignoredSymbolicLinks} atalho(s) foram ignorados.` : ''}`;
      renderRows(result.items.map(item => ({ ...item, status: 'complete', message: 'Renomeado' })));
    } catch (error) {
      $('#renameStatus').textContent = errorMessage(error, 'Não foi possível renomear os arquivos.');
      schedulePreview();
    } finally {
      working = false;
      updateControls();
    }
  }

  $('#chooseRenameFiles').addEventListener('click', chooseFiles);
  $('#renameDropzone').addEventListener('click', chooseFiles);
  $('#renameDropzone').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseFiles(); }
  });
  ['dragenter', 'dragover'].forEach(name => $('#renameDropzone').addEventListener(name, event => {
    event.preventDefault(); event.stopPropagation(); $('#renameDropzone').classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(name => $('#renameDropzone').addEventListener(name, event => {
    event.preventDefault(); event.stopPropagation(); $('#renameDropzone').classList.remove('dragging');
  }));
  $('#renameDropzone').addEventListener('drop', event => {
    const files = [...event.dataTransfer.files].map(file => file.path || window.ntc.pathForFile(file)).filter(Boolean);
    if (files.length) addFiles(files);
    else $('#renameStatus').textContent = 'Não foi possível acessar os arquivos arrastados.';
  });
  $('#clearRenameFiles').addEventListener('click', () => {
    selectedFiles = [];
    latestPreview = null;
    hasCompletedResults = false;
    previewRequest += 1;
    schedulePreview();
  });
  $('#applyFileRenames').addEventListener('click', applyRenames);
  ['renamePrefix', 'renameFind', 'renameReplacement', 'renameSuffix', 'renameNumberStart', 'renameNumberDigits'].forEach(id => $(`#${id}`).addEventListener('input', schedulePreview));
  ['renameNumbering', 'renameNumberPosition', 'renameNumberSeparator'].forEach(id => $(`#${id}`).addEventListener('change', schedulePreview));
  $('#renameNumbering').addEventListener('change', updateControls);
  updateControls();
})();
