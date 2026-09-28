(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  let selectedSecureFile = null;
  let encryptionBusy = false;
  let filePickerBusy = false;

  function message(text) { window.showToast?.(text); }
  function setBusy(button, busy, text) {
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = text;
    } else button.textContent = button.dataset.originalLabel || button.textContent;
    button.setAttribute('aria-busy', String(busy));
    button.disabled = busy;
  }

  function renderSecretResults(container, values, details = '') {
    container.replaceChildren();
    if (details) {
      const summary = document.createElement('small');
      summary.className = 'security-results-summary';
      summary.textContent = details;
      container.append(summary);
    }
    values.forEach(value => {
      const row = document.createElement('div');
      row.className = 'security-secret-row';
      const text = document.createElement('code');
      text.textContent = value;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'outline-button';
      copy.textContent = 'Copiar';
      copy.setAttribute('aria-label', 'Copiar segredo gerado');
      copy.addEventListener('click', async () => {
        copy.disabled = true;
        try {
          const result = await window.ntc.copySecuritySecret(value);
          if (!result?.ok) throw new Error(result?.message || 'Não foi possível copiar.');
          message('Copiado. O histórico do NTC ignora este segredo.');
        } catch (error) { message(error.message || 'Não foi possível copiar.'); }
        finally { copy.disabled = false; }
      });
      row.append(text, copy);
      container.append(row);
    });
    container.classList.toggle('hidden', values.length === 0);
  }

  function renderOperationResults(container, files, summary = '') {
    container.replaceChildren();
    if (summary) {
      const heading = document.createElement('p');
      heading.className = 'security-operation-summary';
      heading.textContent = summary;
      container.append(heading);
    }
    for (const file of files || []) {
      const row = document.createElement('div');
      row.className = `security-file-result${file.ok ? '' : ' failed'}`;
      const copy = document.createElement('div');
      copy.className = 'security-file-result-copy';
      const name = document.createElement('strong');
      name.textContent = file.name || file.source || 'Arquivo';
      const detail = document.createElement('small');
      if (file.digest) detail.textContent = `${file.algorithm.toUpperCase()} · ${new Intl.NumberFormat('pt-BR').format(file.size)} bytes`;
      else if (file.ok && file.outputPath) detail.textContent = `${new Intl.NumberFormat('pt-BR').format(file.outputBytes ?? file.size ?? 0)} bytes · salvo em ${file.outputPath}`;
      else if (file.ok) detail.textContent = `${new Intl.NumberFormat('pt-BR').format(file.size)} bytes · Cópia criada`;
      else detail.textContent = file.message || 'Falha ao processar o arquivo.';
      copy.append(name, detail);
      row.append(copy);
      if (file.digest) {
        const digest = document.createElement('code');
        digest.className = 'security-digest';
        digest.textContent = file.digest;
        const copyHash = document.createElement('button');
        copyHash.type = 'button';
        copyHash.className = 'outline-button';
        copyHash.textContent = 'Copiar hash';
        copyHash.addEventListener('click', async () => {
          try { await window.ntc.copyText(file.digest); message('Hash copiado.'); }
          catch { message('Não foi possível copiar o hash.'); }
        });
        row.append(digest, copyHash);
      }
      container.append(row);
    }
    container.classList.toggle('hidden', !(files?.length));
  }

  function createOperationStatus(text, state = 'working') {
    const status = document.createElement('div');
    status.className = `security-operation-status is-${state}`;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const icon = document.createElement('span');
    icon.className = 'security-operation-status-icon';
    icon.setAttribute('aria-hidden', 'true');
    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const iconShapes = {
      working: [['circle', { cx: '12', cy: '12', r: '9', 'stroke-dasharray': '42 15' }]],
      success: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'm8 12.5 2.6 2.6L16.5 9' }]],
      error: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M12 7.5v5' }], ['circle', { cx: '12', cy: '16.2', r: '.65', fill: 'currentColor', stroke: 'none' }]],
      cancelled: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'm9 9 6 6m0-6-6 6' }]]
    };
    for (const [tagName, attributes] of iconShapes[state] || iconShapes.error) {
      const shape = document.createElementNS(svgNamespace, tagName);
      for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
      svg.append(shape);
    }
    icon.append(svg);
    const label = document.createElement('span');
    label.textContent = text;
    status.append(icon, label);
    return status;
  }

  function renderOperationStatus(container, text, state = 'working') {
    container.replaceChildren(createOperationStatus(text, state));
    container.classList.remove('hidden');
  }

  function updateEncryptionControls() {
    const hasFile = Boolean(selectedSecureFile?.id);
    const password = $('#securityEncryptionPassword').value;
    const busy = encryptionBusy || filePickerBusy;
    $('#securityChooseFile').disabled = busy;
    $('#securityChangeFile').disabled = busy || !hasFile;
    $('#securityEncryptionPassword').disabled = !hasFile || busy;
    $('#securityTogglePassword').disabled = !hasFile || busy;
    $('#securityEncryptFile').disabled = !hasFile || busy || [...password].length < 12;
    $('#securityDecryptFile').disabled = !hasFile || busy || !password;
    $('#securityEncryptionHint').textContent = !hasFile
      ? 'Selecione ou arraste um arquivo para habilitar a senha.'
      : !password ? 'Informe a senha para liberar a operação.'
        : [...password].length < 12 ? 'Use pelo menos 12 caracteres para criptografar; a descriptografia aceita a senha original.'
          : 'Pronto para criptografar ou descriptografar este arquivo.';
  }

  async function releaseSelectedSecureFile() {
    const previous = selectedSecureFile;
    selectedSecureFile = null;
    if (previous?.id) await window.ntc.releaseSecureFile(previous.id).catch(() => {});
    $('#securitySelectedFile').classList.add('hidden');
    $('#securitySelectedFileName').textContent = '';
    $('#securitySelectedFileMeta').textContent = '';
    updateEncryptionControls();
  }

  async function setSelectedSecureFile(file) {
    const previous = selectedSecureFile;
    selectedSecureFile = file;
    if (previous?.id !== file?.id) clearEncryptionPassword();
    if (previous?.id && previous.id !== file?.id) await window.ntc.releaseSecureFile(previous.id).catch(() => {});
    if (file) {
      $('#securitySelectedFileName').textContent = file.name;
      $('#securitySelectedFileMeta').textContent = `${file.extension} · ${new Intl.NumberFormat('pt-BR').format(file.size)} bytes`;
      $('#securitySelectedFile').classList.remove('hidden');
      $('#securityEncryptionPassword').placeholder = 'Use uma senha longa, com pelo menos 12 caracteres';
    } else {
      $('#securitySelectedFile').classList.add('hidden');
      $('#securitySelectedFileName').textContent = '';
      $('#securitySelectedFileMeta').textContent = '';
      $('#securityEncryptionPassword').placeholder = 'Selecione um arquivo primeiro';
    }
    updateEncryptionControls();
  }

  async function chooseSecureFile() {
    if (encryptionBusy || filePickerBusy) return;
    const button = $('#securityChooseFile');
    filePickerBusy = true;
    updateEncryptionControls();
    setBusy(button, true, 'Abrindo…');
    try {
      const result = await window.ntc.selectSecureFile();
      if (result?.canceled) return;
      if (!result?.ok || !result.file) throw new Error(result?.message || 'Não foi possível selecionar esse arquivo.');
      await setSelectedSecureFile(result.file);
      $('#securityEncryptionResults').classList.add('hidden');
    } catch (error) { message(error.message || 'Não foi possível selecionar o arquivo.'); }
    finally { filePickerBusy = false; setBusy(button, false); updateEncryptionControls(); if (selectedSecureFile) $('#securityEncryptionPassword').focus(); }
  }

  async function registerDroppedSecureFile(file) {
    if (encryptionBusy || filePickerBusy) return;
    filePickerBusy = true;
    updateEncryptionControls();
    const filePath = window.ntc.pathForFile(file);
    try {
      if (!filePath) throw new Error('Não foi possível acessar o arquivo arrastado.');
      const result = await window.ntc.registerDroppedSecureFile(filePath);
      if (!result?.ok || !result.file) throw new Error(result?.message || 'Não foi possível selecionar esse arquivo.');
      await setSelectedSecureFile(result.file);
      $('#securityEncryptionResults').classList.add('hidden');
    } finally { filePickerBusy = false; updateEncryptionControls(); if (selectedSecureFile) $('#securityEncryptionPassword').focus(); }
  }

  function saveSecurityHistory(record) {
    try {
      const current = JSON.parse(localStorage.getItem('ntc-security-history') || '[]');
      const entries = Array.isArray(current) ? current.filter(item => item && typeof item === 'object') : [];
      entries.unshift(record);
      localStorage.setItem('ntc-security-history', JSON.stringify(entries.slice(0, 100)));
      window.dispatchEvent(new Event('ntc-security-history-updated'));
    } catch { message('A operação foi concluída, mas não foi possível salvar no Histórico.'); }
  }

  async function generatePassword() {
    const button = $('#securityGeneratePassword');
    setBusy(button, true, 'Gerando…');
    try {
      const result = await window.ntc.generateSecurityValues({
        kind: 'password',
        length: Number($('#securityPasswordLength').value),
        count: Number($('#securityPasswordCount').value),
        lowercase: $('#securityIncludeLower').checked,
        uppercase: $('#securityIncludeUpper').checked,
        numbers: $('#securityIncludeNumbers').checked,
        symbols: $('#securityIncludeSymbols').checked,
        excludeAmbiguous: $('#securityExcludeAmbiguous').checked
      });
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível gerar as senhas.');
      renderSecretResults($('#securityPasswordResults'), result.values, `${result.values.length} ${result.values.length === 1 ? 'senha gerada' : 'senhas geradas'} · não são salvas pelo NTC`);
    } catch (error) { message(error.message || 'Não foi possível gerar as senhas.'); }
    finally { setBusy(button, false); }
  }

  async function generateCode() {
    const button = $('#securityGenerateCode');
    const format = $('#securityCodeFormat').value;
    const options = { kind: 'code', format };
    if (format === 'recovery') {
      options.count = Number($('#securityRecoveryCount').value);
      options.characters = Number($('#securityRecoveryLength').value);
    } else options.bytes = Number($('#securityCodeBytes').value);
    setBusy(button, true, 'Gerando…');
    try {
      const result = await window.ntc.generateSecurityValues(options);
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível gerar o código.');
      const entropy = Number(result.bits) ? ` · ${new Intl.NumberFormat('pt-BR').format(result.bits)} bits de aleatoriedade` : '';
      renderSecretResults($('#securityCodeResults'), result.values, `${result.values.length} ${result.values.length === 1 ? 'valor gerado' : 'valores gerados'}${entropy} · não são salvos pelo NTC`);
    } catch (error) { message(error.message || 'Não foi possível gerar o código.'); }
    finally { setBusy(button, false); }
  }

  async function cleanMetadata() {
    const button = $('#securityCleanMetadata');
    setBusy(button, true, 'Processando…');
    const output = $('#securityMetadataResults');
    try {
      const result = await window.ntc.cleanFileMetadata();
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível limpar os metadados.');
      const success = result.files.filter(file => file.ok).length;
      renderOperationResults(output, result.files, `${success} de ${result.files.length} arquivos limpos · salvo em ${result.folder}`);
      if (success) message(`${success} ${success === 1 ? 'cópia limpa foi criada' : 'cópias limpas foram criadas'}.`);
    } catch (error) { renderOperationResults(output, [{ ok: false, message: error.message || 'Falha ao limpar metadados.' }]); }
    finally { setBusy(button, false); }
  }

  async function calculateHashes() {
    const button = $('#securityHashFiles');
    setBusy(button, true, 'Calculando…');
    try {
      const result = await window.ntc.hashSecurityFiles($('#securityHashAlgorithm').value);
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível calcular os hashes.');
      renderOperationResults($('#securityHashResults'), result.files, `${result.files.filter(file => file.ok).length} de ${result.files.length} arquivos processados`);
    } catch (error) { renderOperationResults($('#securityHashResults'), [{ ok: false, message: error.message || 'Falha ao calcular hash.' }]); }
    finally { setBusy(button, false); }
  }

  async function transformFile(action) {
    if (encryptionBusy || filePickerBusy) return;
    if (!selectedSecureFile?.id) return message('Selecione ou arraste um arquivo primeiro.');
    const input = $('#securityEncryptionPassword');
    const password = input.value;
    const file = selectedSecureFile;
    const button = action === 'encrypt' ? $('#securityEncryptFile') : $('#securityDecryptFile');
    encryptionBusy = true;
    updateEncryptionControls();
    setBusy(button, true, action === 'encrypt' ? 'Criptografando…' : 'Descriptografando…');
    const output = $('#securityEncryptionResults');
    renderOperationStatus(output, action === 'encrypt' ? `Criptografando ${file.name}…` : `Descriptografando ${file.name}…`);
    try {
      const result = await window.ntc.transformSecureFile({ action, password, selectionId: file.id });
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível processar o arquivo.');
      renderOperationResults(output, [{ ...result, ok: true }], action === 'encrypt' ? 'Arquivo criptografado com sucesso.' : 'Arquivo descriptografado e autenticado com sucesso.');
      output.prepend(createOperationStatus(action === 'encrypt' ? 'Criptografia concluída.' : 'Arquivo recuperado e autenticado.', 'success'));
      saveSecurityHistory({ action, sourceName: file.name, title: result.name, file: result.outputPath, size: result.outputBytes, time: new Date().toISOString() });
      await setSelectedSecureFile(null);
      message(action === 'encrypt' ? `Arquivo protegido e salvo: ${result.outputPath || result.name}` : `Arquivo recuperado: ${result.outputPath || result.name}`);
    } catch (error) {
      const errorMessage = error.message || 'Falha na operação.';
      renderOperationStatus(output, errorMessage, 'error');
      message(errorMessage);
    } finally {
      input.value = '';
      encryptionBusy = false;
      setBusy(button, false);
      updateEncryptionControls();
    }
  }

  function updateCodeOptions() {
    const recovery = $('#securityCodeFormat').value === 'recovery';
    $('#securityCodeBytesWrap').classList.toggle('hidden', recovery);
    $('#securityRecoveryOptions').classList.toggle('hidden', !recovery);
    $('#securityGenerateCode').textContent = recovery ? 'Gerar códigos de recuperação' : 'Gerar código';
  }

  function clearGeneratedSecrets() {
    $('#securityPasswordResults').replaceChildren();
    $('#securityPasswordResults').classList.add('hidden');
    $('#securityCodeResults').replaceChildren();
    $('#securityCodeResults').classList.add('hidden');
  }

  function clearEncryptionPassword() {
    $('#securityEncryptionPassword').value = '';
    $('#securityEncryptionPassword').type = 'password';
    $('#securityTogglePassword').textContent = 'Mostrar';
    $('#securityTogglePassword').setAttribute('aria-pressed', 'false');
    updateEncryptionControls();
  }

  function setTab(selected) {
    const previous = $('.security-tab.active')?.dataset.securityTab;
    if (previous === 'secrets' && selected !== 'secrets') clearGeneratedSecrets();
    if (previous === 'encryption' && selected !== 'encryption') clearEncryptionPassword();
    $$('.security-tab').forEach(tab => {
      const active = tab.dataset.securityTab === selected;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('[data-security-panel]').forEach(panel => {
      const active = panel.dataset.securityPanel === selected;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  }

  function bind() {
    $$('.security-tab').forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.securityTab)));
    $('#securityGeneratePassword').addEventListener('click', generatePassword);
    $('#securityGenerateCode').addEventListener('click', generateCode);
    $('#securityCodeFormat').addEventListener('change', updateCodeOptions);
    $('#securityCleanMetadata').addEventListener('click', cleanMetadata);
    $('#securityHashFiles').addEventListener('click', calculateHashes);
    $('#securityEncryptFile').addEventListener('click', () => void transformFile('encrypt'));
    $('#securityDecryptFile').addEventListener('click', () => void transformFile('decrypt'));
    $('#securityChooseFile').addEventListener('click', () => void chooseSecureFile());
    $('#securityChangeFile').addEventListener('click', () => void chooseSecureFile());
    $('#securityEncryptionPassword').addEventListener('input', updateEncryptionControls);
    const dropzone = $('#securityFileDropzone');
    ['dragenter', 'dragover'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
    dropzone.addEventListener('drop', async event => {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      if (encryptionBusy || filePickerBusy) return;
      if (files.length > 1) message('Arraste um arquivo por vez.');
      const button = $('#securityChooseFile');
      setBusy(button, true, 'Lendo arquivo…');
      try { await registerDroppedSecureFile(files[0]); $('#securityEncryptionResults').classList.add('hidden'); }
      catch (error) { message(error.message || 'Não foi possível usar o arquivo arrastado.'); }
      finally { setBusy(button, false); }
    });
    $('#securityTogglePassword').addEventListener('click', event => {
      const input = $('#securityEncryptionPassword');
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      event.currentTarget.textContent = showing ? 'Ocultar' : 'Mostrar';
      event.currentTarget.setAttribute('aria-pressed', String(showing));
    });
    updateCodeOptions();
    updateEncryptionControls();
  }

  bind();
  window.ntcSecurityUi = {
    close() {
      clearGeneratedSecrets();
      clearEncryptionPassword();
      void releaseSelectedSecureFile();
    }
  };
})();
