import {
  addPdfPageNumbers,
  addPdfSignature,
  addPdfText,
  addPdfWatermark,
  clearPdfMetadata,
  createPdfFromImages,
  createPdfFromText,
  deletePdfPages,
  extractPdfPages,
  insertBlankPdfPage,
  mergePdfFiles,
  parsePdfPageSelection,
  rebuildPdfPages,
  rotatePdfPages,
  updatePdfMetadata
} from './pdf-workbench.mjs';

(() => {
  const $ = selector => document.querySelector(selector);
  let pdf = null;
  let currentFile = null;
  let currentPdfBytes = null;
  let currentPage = 1;
  let zoom = 1;
  let dirty = false;
  let opening = false;
  let restored = false;
  let renderTask = null;
  let pdfjsLib = null;
  let pdfEditingBlocked = false;
  let drawingSignature = false;
  let signatureHasInk = false;
  let livePreviewDocument = null;
  let livePreviewLoadingTask = null;
  let livePreviewRenderTask = null;
  let livePreviewVersion = 0;
  let livePreviewDebounce = null;
  let activeLivePreviewOperation = null;
  let activeLivePreviewMessage = 'Prévia do documento atual.';
  let lastPdfSaveResult = null;

  const pdfOnlyControls = [
    'pdfSave', 'pdfPreviousPage', 'pdfNextPage', 'pdfZoomOut', 'pdfZoomIn',
    'pdfGoToPage', 'pdfGoToPageButton', 'pdfFindText', 'pdfFindButton',
    'pdfExportPageImage', 'pdfPageSelection', 'pdfRotateLeft', 'pdfRotateRight',
    'pdfExtractPages', 'pdfRemovePages', 'pdfPageOrder', 'pdfReorderPages',
    'pdfReversePages', 'pdfDuplicatePages', 'pdfInsertBlank', 'pdfApplyWatermark',
    'pdfWatermarkText', 'pdfWatermarkOpacity', 'pdfWatermarkAngle', 'pdfAddPageNumbers',
    'pdfNumberFormat', 'pdfNumberStart', 'pdfApplyStamp', 'pdfStampText', 'pdfStampSize',
    'pdfStampColor', 'pdfTextPages', 'pdfExtractText', 'pdfExportPageImageTool',
    'pdfMetadataTitle', 'pdfMetadataAuthor', 'pdfMetadataSubject', 'pdfMetadataKeywords',
    'pdfSaveMetadata', 'pdfClearMetadata', 'pdfLoadFormFields', 'pdfApplyFormFields',
    'pdfApplySignature'
  ];
  const pdfMutationControls = new Set([
    'pdfPageSelection', 'pdfRotateLeft', 'pdfRotateRight', 'pdfExtractPages', 'pdfRemovePages',
    'pdfPageOrder', 'pdfReorderPages', 'pdfReversePages', 'pdfDuplicatePages', 'pdfInsertBlank',
    'pdfApplyWatermark', 'pdfWatermarkText', 'pdfWatermarkOpacity', 'pdfWatermarkAngle',
    'pdfAddPageNumbers', 'pdfNumberFormat', 'pdfNumberStart', 'pdfApplyStamp', 'pdfStampText',
    'pdfStampSize', 'pdfStampColor', 'pdfMetadataTitle', 'pdfMetadataAuthor',
    'pdfMetadataSubject', 'pdfMetadataKeywords', 'pdfSaveMetadata', 'pdfClearMetadata',
    'pdfLoadFormFields', 'pdfApplyFormFields', 'pdfApplySignature'
  ]);

  async function loadPdfJs() {
    if (!pdfjsLib) {
      pdfjsLib = await import('../node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
    }
    return pdfjsLib;
  }

  function setStatus(message, error = false) {
    const element = $('#pdfReaderStatus');
    element.textContent = message;
    element.dataset.error = String(error);
  }

  function setToolFeedback(controlId, message, state = 'info') {
    const control = document.getElementById(controlId);
    const card = control?.closest('.pdf-tool-card, .pdf-reader-tools, .pdf-toolbar, .pdf-metadata-form');
    if (!card) return;
    let feedback = card.querySelector('.pdf-action-feedback');
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.className = 'pdf-action-feedback';
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
      card.append(feedback);
    }
    feedback.textContent = message;
    feedback.dataset.state = state;
    feedback.classList.toggle('visible', Boolean(message));
  }

  function refreshMetadataPreview() {
    const summary = $('#pdfInfoSummary');
    const values = {
      title: $('#pdfMetadataTitle').value.trim() || 'não informado',
      author: $('#pdfMetadataAuthor').value.trim() || 'não informado',
      subject: $('#pdfMetadataSubject').value.trim() || 'não informado',
      keywords: $('#pdfMetadataKeywords').value.trim() || 'não informadas'
    };
    Object.entries(values).forEach(([key, value]) => {
      let chip = summary.querySelector('[data-pdf-info-key="' + key + '"]');
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'pdf-info-chip';
        chip.dataset.pdfInfoKey = key;
        summary.append(chip);
      }
      const label = key === 'keywords' ? 'Palavras-chave: ' : key[0].toUpperCase() + key.slice(1) + ': ';
      chip.textContent = label + (key === 'keywords' ? value.slice(0, 90) : value);
      chip.title = label + value;
    });
  }

  function updateControls() {
    const hasPdf = Boolean(pdf && currentPdfBytes);
    for (const id of pdfOnlyControls) {
      const element = document.getElementById(id);
      if (element) element.disabled = !hasPdf || (pdfEditingBlocked && pdfMutationControls.has(id));
    }
    $('#pdfPageStatus').textContent = hasPdf ? currentPage + ' / ' + pdf.numPages : '— / —';
    $('#pdfZoomStatus').textContent = Math.round(zoom * 100) + '%';
    $('#pdfPreviousPage').disabled = !hasPdf || currentPage <= 1;
    $('#pdfNextPage').disabled = !hasPdf || currentPage >= pdf.numPages;
    $('#pdfZoomIn').disabled = !hasPdf || zoom >= 2.5;
    $('#pdfZoomOut').disabled = !hasPdf || zoom <= 0.5;
    $('#pdfSave').disabled = !hasPdf;
    $('#pdfFileName').textContent = currentFile
      ? currentFile.name + (dirty ? ' · Alterações não salvas' : '')
      : 'Nenhum arquivo aberto';
    $('#pdfFileName').title = currentFile?.path || currentFile?.name || '';
    $('#pdfGoToPage').value = hasPdf ? String(currentPage) : '1';
    $('#pdfWatermarkOpacityValue').textContent = $('#pdfWatermarkOpacity').value + '%';
    if (!hasPdf) $('#pdfInfoSummary').textContent = 'Abra um PDF para ver os detalhes.';
  }

  function switchPdfTab(tab) {
    const selected = ['read', 'pages', 'edit', 'convert', 'info'].includes(tab) ? tab : 'read';
    if (selected !== 'edit') setLivePreviewExpanded(false);
    document.querySelectorAll('[data-pdf-tab]').forEach(button => {
      const active = button.dataset.pdfTab === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-pdf-panel]').forEach(panel => {
      const active = panel.dataset.pdfPanel === selected;
      panel.classList.toggle('hidden', !active);
      panel.classList.toggle('active', active);
    });
    if (selected === 'edit' && pdf) refreshLivePreview();
  }

  async function clearRender() {
    if (renderTask) {
      try { renderTask.cancel(); await renderTask.promise; } catch { /* Another page render may cancel this one. */ }
      renderTask = null;
    }
    if (pdf) {
      try { await pdf.destroy(); } catch { /* Closing a viewer is best effort. */ }
      pdf = null;
    }
  }

  async function renderPage() {
    if (!pdf) return;
    const canvas = $('#pdfPageCanvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (renderTask) {
      try { renderTask.cancel(); await renderTask.promise; } catch { /* A newer render replaced the previous one. */ }
      renderTask = null;
    }
    const page = await pdf.getPage(currentPage);
    const viewport = page.getViewport({ scale: zoom });
    const outputScale = Math.min(1.75, window.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    renderTask = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
    });
    await renderTask.promise;
    renderTask = null;
    updateControls();
  }

  function setLivePreviewStatus(message, error = false) {
    const element = $('#pdfLivePreviewStatus');
    element.textContent = message;
    element.dataset.state = error ? 'error' : 'info';
  }

  function setLivePreviewExpanded(expanded) {
    const card = $('#pdfLivePreviewCard');
    const button = $('#pdfLivePreviewExpand');
    if (card.classList.contains('expanded') === expanded) return;
    card.classList.toggle('expanded', expanded);
    button.textContent = expanded ? 'Reduzir' : 'Ampliar';
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Reduzir prévia do PDF' : 'Ampliar prévia do PDF');
    requestAnimationFrame(() => { if (pdf) refreshLivePreview(); });
  }

  async function renderLivePreview(bytes, readyMessage = 'Prévia do documento atual.', existingDocument = null) {
    const version = ++livePreviewVersion;
    if (livePreviewRenderTask) {
      try { livePreviewRenderTask.cancel(); await livePreviewRenderTask.promise; } catch { /* New preview replaces the previous render. */ }
      livePreviewRenderTask = null;
    }
    if (livePreviewLoadingTask) {
      try { await livePreviewLoadingTask.destroy(); } catch { /* A superseded preview may already be destroyed. */ }
      livePreviewLoadingTask = null;
    }
    if (livePreviewDocument) {
      try { await livePreviewDocument.destroy(); } catch { /* Preview cleanup is best effort. */ }
      livePreviewDocument = null;
    }
    if (!bytes?.length && !existingDocument) {
      $('#pdfLivePreviewCanvas').style.display = 'none';
      $('#pdfLivePreviewEmpty').hidden = false;
      $('#pdfLivePreviewPage').textContent = '— / —';
      setLivePreviewStatus('Abra um PDF para visualizar as alterações.');
      return;
    }
    try {
      let previewDocument = existingDocument;
      if (!previewDocument) {
        const viewer = await loadPdfJs();
        const loadingTask = viewer.getDocument({ data: bytes.slice(), isEvalSupported: false, useWorkerFetch: false });
        livePreviewLoadingTask = loadingTask;
        previewDocument = await loadingTask.promise;
      }
      if (version !== livePreviewVersion) {
        if (previewDocument !== pdf) await previewDocument.destroy();
        return;
      }
      livePreviewLoadingTask = null;
      if (previewDocument !== pdf) livePreviewDocument = previewDocument;
      const pageNumber = Math.max(1, Math.min(currentPage, previewDocument.numPages));
      const page = await previewDocument.getPage(pageNumber);
      if (version !== livePreviewVersion) return;
      const canvas = $('#pdfLivePreviewCanvas');
      const frame = canvas.parentElement;
      const unitViewport = page.getViewport({ scale: 1 });
      const maxWidth = Math.max(160, frame.clientWidth - 28);
      const maxHeight = Math.max(220, frame.clientHeight - 28);
      const scale = Math.max(0.15, Math.min(2.5, maxWidth / unitViewport.width, maxHeight / unitViewport.height));
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      livePreviewRenderTask = page.render({
        canvas,
        canvasContext: canvas.getContext('2d', { alpha: false }),
        viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
      });
      await livePreviewRenderTask.promise;
      if (version !== livePreviewVersion) return;
      livePreviewRenderTask = null;
      canvas.style.display = 'block';
      $('#pdfLivePreviewEmpty').hidden = true;
      $('#pdfLivePreviewPage').textContent = pageNumber + ' / ' + previewDocument.numPages;
      setLivePreviewStatus(readyMessage);
    } catch (error) {
      if (version !== livePreviewVersion) return;
      setLivePreviewStatus(error?.message || 'Não foi possível atualizar a pré-visualização.', true);
    }
  }

  function scheduleLivePreview(operation = null, readyMessage = 'Prévia do documento atual.') {
    if (!currentPdfBytes) return;
    activeLivePreviewOperation = operation;
    activeLivePreviewMessage = readyMessage;
    clearTimeout(livePreviewDebounce);
    setLivePreviewStatus(operation ? 'Atualizando prévia das alterações…' : 'Atualizando prévia…');
    livePreviewDebounce = setTimeout(async () => {
      try {
        const previewBytes = operation ? await operation() : currentPdfBytes;
        if (pdfEditingBlocked && !operation) await renderLivePreview(null, 'PDF protegido: prévia somente para leitura.', pdf);
        else await renderLivePreview(previewBytes, readyMessage);
      } catch (error) {
        setLivePreviewStatus(error?.message || 'Não foi possível pré-visualizar essa alteração.', true);
      }
    }, 240);
  }

  function refreshLivePreview() {
    scheduleLivePreview(activeLivePreviewOperation, activeLivePreviewMessage);
  }

  function previewWatermark() {
    if (!pdf || pdfEditingBlocked) return;
    const text = $('#pdfWatermarkText').value.trim();
    if (!text) {
      scheduleLivePreview(null, 'Prévia da marca d’água: digite o texto para visualizar.');
      return;
    }
    try {
      const indices = selectedPageIndices();
      if (!indices.includes(currentPage - 1)) {
        scheduleLivePreview(null, 'Prévia da marca d’água: a página atual está fora da seleção. Navegue até uma página selecionada.');
        return;
      }
      scheduleLivePreview(() => addPdfWatermark(currentPdfBytes, selectedPageIndices(), {
        text,
        opacity: Number($('#pdfWatermarkOpacity').value) / 100,
        angle: Number($('#pdfWatermarkAngle').value)
      }), 'Prévia da marca d’água · ainda não aplicada ao documento.');
    } catch (error) {
      setLivePreviewStatus(error?.message || 'Confira a seleção de páginas.', true);
    }
  }

  function previewPageNumbers() {
    if (!pdf || pdfEditingBlocked) return;
    const format = $('#pdfNumberFormat').value.trim();
    if (!format || !format.includes('{n}')) {
      scheduleLivePreview(null, 'Inclua {n} no modelo para visualizar a numeração.');
      return;
    }
    const start = Math.max(1, Math.min(999999, Number($('#pdfNumberStart').value) || 1));
    scheduleLivePreview(() => addPdfPageNumbers(currentPdfBytes, { format, start }), 'Prévia da numeração · ainda não aplicada ao documento.');
  }

  function previewPageText() {
    if (!pdf || pdfEditingBlocked) return;
    const text = $('#pdfStampText').value.trim();
    if (!text) {
      scheduleLivePreview(null, 'Digite o texto para ver a prévia na página atual.');
      return;
    }
    const size = Math.max(8, Math.min(72, Number($('#pdfStampSize').value) || 16));
    scheduleLivePreview(() => addPdfText(currentPdfBytes, currentPage - 1, { text, size, color: $('#pdfStampColor').value }), 'Prévia do texto · ainda não aplicado ao documento.');
  }

  function previewSignature() {
    if (!pdf || pdfEditingBlocked) return;
    if (!signatureHasInk) {
      scheduleLivePreview(null, 'Desenhe sua assinatura para vê-la sobre a página.');
      return;
    }
    scheduleLivePreview(() => addPdfSignature(currentPdfBytes, currentPage - 1, $('#pdfSignatureCanvas').toDataURL('image/png')), 'Prévia da assinatura · ainda não aplicada ao documento.');
  }

  async function readPdfMetadata() {
    if (!currentPdfBytes) return;
    try {
      const { PDFDocument } = await import('../node_modules/pdf-lib/dist/pdf-lib.esm.js');
      const document = await PDFDocument.load(currentPdfBytes, { updateMetadata: false });
      $('#pdfMetadataTitle').value = document.getTitle() || '';
      $('#pdfMetadataAuthor').value = document.getAuthor() || '';
      $('#pdfMetadataSubject').value = document.getSubject() || '';
      $('#pdfMetadataKeywords').value = document.getKeywords() || '';
      const first = document.getPages()[0];
      const dimensions = first ? first.getSize() : [0, 0];
      const chips = [
        ['pages', document.getPageCount() + ' ' + (document.getPageCount() === 1 ? 'página' : 'páginas')],
        ['size', (currentPdfBytes.byteLength / 1024 / 1024).toFixed(2) + ' MB'],
        ['dimensions', Math.round(dimensions[0]) + ' × ' + Math.round(dimensions[1]) + ' pt']
      ];
      const summary = $('#pdfInfoSummary');
      summary.replaceChildren();
      chips.forEach(([key, text]) => {
        const chip = document.createElement('span');
        chip.className = 'pdf-info-chip';
        chip.dataset.pdfInfoKey = key;
        chip.textContent = text;
        summary.append(chip);
      });
      refreshMetadataPreview();
    } catch (error) {
      const message = String(error?.message || '');
      if (/encrypted/i.test(message)) {
        pdfEditingBlocked = true;
        $('#pdfInfoSummary').textContent = 'PDF protegido por senha. Leitura permitida; a edição deste arquivo não é compatível.';
        updateControls();
        setStatus('PDF protegido por senha. A leitura funciona, mas as ferramentas de edição não podem alterar este arquivo.', true);
      } else setStatus(message || 'Não foi possível ler os metadados deste PDF.', true);
    }
  }

  async function loadPdfFormFields() {
    if (!currentPdfBytes) return;
    setToolFeedback('pdfLoadFormFields', 'Lendo os campos do formulário…', 'working');
    const container = $('#pdfFormFields');
    container.replaceChildren();
    try {
      const { PDFDocument } = await import('../node_modules/pdf-lib/dist/pdf-lib.esm.js');
      const document = await PDFDocument.load(currentPdfBytes, { updateMetadata: false });
      const fields = document.getForm().getFields();
      if (!fields.length) {
        container.textContent = 'Este PDF não contém campos de formulário interativos.';
        setToolFeedback('pdfLoadFormFields', 'Nenhum campo de formulário interativo foi encontrado.', 'info');
        return;
      }
      for (const field of fields) {
        const name = field.getName();
        const label = document.createElement('label');
        label.className = 'pdf-form-field';
        const title = document.createElement('span');
        title.textContent = name;
        label.append(title);
        let control;
        if (typeof field.isChecked === 'function' && typeof field.check === 'function') {
          control = document.createElement('input');
          control.type = 'checkbox';
          control.checked = field.isChecked();
          control.dataset.pdfFieldKind = 'checkbox';
        } else if (typeof field.getOptions === 'function' && typeof field.select === 'function') {
          control = document.createElement('select');
          control.className = 'text-input';
          const empty = document.createElement('option');
          empty.value = '';
          empty.textContent = 'Selecione';
          control.append(empty);
          field.getOptions().forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            control.append(option);
          });
          const selected = field.getSelected?.();
          control.value = Array.isArray(selected) ? selected[0] || '' : selected || '';
          control.dataset.pdfFieldKind = 'select';
        } else if (typeof field.getText === 'function' && typeof field.setText === 'function') {
          control = field.isMultiline?.() ? document.createElement('textarea') : document.createElement('input');
          control.className = 'text-input';
          if (control.tagName === 'INPUT') control.type = 'text';
          else control.rows = 3;
          control.value = field.getText() || '';
          control.dataset.pdfFieldKind = 'text';
        } else {
          title.textContent += ' (tipo de campo não compatível)';
          container.append(label);
          continue;
        }
        control.dataset.pdfFieldName = name;
        label.append(control);
        container.append(label);
      }
      setStatus(fields.length + ' campo(s) de formulário carregado(s).');
      setToolFeedback('pdfLoadFormFields', fields.length + ' campo(s) carregado(s). Preencha e clique em “Aplicar respostas ao PDF”.', 'success');
    } catch (error) {
      container.textContent = 'Não foi possível carregar os campos deste PDF.';
      const message = error?.message || 'Este PDF não contém um formulário compatível.';
      setToolFeedback('pdfLoadFormFields', message, 'error');
      setStatus(message, true);
    }
  }

  async function applyPdfFormFields() {
    if (!currentPdfBytes) return;
    setToolFeedback('pdfApplyFormFields', 'Aplicando respostas…', 'working');
    try {
      const { PDFDocument, StandardFonts } = await import('../node_modules/pdf-lib/dist/pdf-lib.esm.js');
      const document = await PDFDocument.load(currentPdfBytes, { updateMetadata: false });
      const form = document.getForm();
      for (const control of $('#pdfFormFields').querySelectorAll('[data-pdf-field-name]')) {
        const field = form.getField(control.dataset.pdfFieldName);
        if (control.dataset.pdfFieldKind === 'checkbox') {
          if (control.checked) field.check();
          else field.uncheck();
        } else if (control.dataset.pdfFieldKind === 'select') {
          if (control.value) field.select(control.value);
        } else field.setText(control.value);
      }
      form.updateFieldAppearances(await document.embedFont(StandardFonts.Helvetica));
      await replaceWorkingPdf(new Uint8Array(await document.save()), 'Respostas do formulário aplicadas.');
      setToolFeedback('pdfApplyFormFields', 'Respostas aplicadas. Confira a prévia à direita.', 'success');
    } catch (error) {
      const message = error?.message || 'Não foi possível preencher o formulário.';
      setToolFeedback('pdfApplyFormFields', message, 'error');
      setStatus(message, true);
    }
  }

  function setupSignatureCanvas() {
    const canvas = $('#pdfSignatureCanvas');
    const context = canvas.getContext('2d');
    context.strokeStyle = '#202020';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const point = event => {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - bounds.left) * canvas.width / bounds.width,
        y: (event.clientY - bounds.top) * canvas.height / bounds.height
      };
    };
    canvas.addEventListener('pointerdown', event => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drawingSignature = true;
      const position = point(event);
      context.beginPath();
      context.moveTo(position.x, position.y);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drawingSignature) return;
      const position = point(event);
      context.lineTo(position.x, position.y);
      context.stroke();
      signatureHasInk = true;
    });
    const stopDrawing = () => {
      if (!drawingSignature) return;
      drawingSignature = false;
      previewSignature();
    };
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
    $('#pdfClearSignature').addEventListener('click', () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      signatureHasInk = false;
      scheduleLivePreview(null, 'Desenhe sua assinatura para vê-la sobre a página.');
    });
    $('#pdfApplySignature').addEventListener('click', () => {
      if (!signatureHasInk) {
        setToolFeedback('pdfApplySignature', 'Desenhe uma assinatura antes de aplicar.', 'error');
        setStatus('Desenhe uma assinatura antes de aplicar.', true);
        return;
      }
      void applyPageOperation(() => addPdfSignature(currentPdfBytes, currentPage - 1, canvas.toDataURL('image/png')), 'Assinatura visual aplicada à página ' + currentPage + '.', 'pdfApplySignature');
    });
  }

  async function openViewer(file, readingPosition = null, { savePath = true, isDirty = false } = {}) {
    if (!file?.data?.length) return;
    opening = true;
    setStatus('Carregando PDF…');
    $('#pdfEmptyState').classList.add('hidden');
    $('#pdfPageFrame').classList.remove('hidden');
    $('#pdfFormFields').replaceChildren();
    $('#pdfFindStatus').textContent = '';
    $('#pdfSignatureCanvas').getContext('2d').clearRect(0, 0, $('#pdfSignatureCanvas').width, $('#pdfSignatureCanvas').height);
    signatureHasInk = false;
    pdfEditingBlocked = false;
    let passwordCancelled = false;
    try {
      await clearRender();
      currentPdfBytes = new Uint8Array(file.data);
      currentFile = { name: file.name || 'Documento.pdf', path: file.path || '', size: file.size || currentPdfBytes.byteLength };
      const viewer = await loadPdfJs();
      const loadingTask = viewer.getDocument({ data: currentPdfBytes.slice(), isEvalSupported: false, useWorkerFetch: false });
      loadingTask.onPassword = (updatePassword, reason) => {
        const incorrect = reason === viewer.PasswordResponses.INCORRECT_PASSWORD;
        const password = window.prompt(incorrect ? 'Senha incorreta. Tente novamente:' : 'Este PDF está protegido. Digite a senha:');
        if (password === null) {
          passwordCancelled = true;
          void loadingTask.destroy();
          return;
        }
        updatePassword(password);
      };
      pdf = await loadingTask.promise;
      currentPage = readingPosition ? Math.min(pdf.numPages, Math.max(1, Number(readingPosition.lastPdfPage) || 1)) : 1;
      zoom = readingPosition ? Math.max(0.5, Math.min(2.5, Number(readingPosition.pdfZoom) || 1)) : 1;
      dirty = isDirty;
      if (savePath && currentFile.path) window.ntcDocumentsUi?.setLastPdfPath(currentFile.path);
      updateControls();
      await renderPage();
      await readPdfMetadata();
      if (savePath && currentFile.path) window.ntcDocumentsUi?.updatePdfProgress(currentPage, zoom);
      if (!pdfEditingBlocked) setStatus(dirty ? 'Alterações ainda não salvas. O arquivo original está preservado.' : pdf.numPages + ' ' + (pdf.numPages === 1 ? 'página' : 'páginas') + ' · Arquivo carregado neste computador');
      scheduleLivePreview(null, 'Prévia do PDF atual.');
    } catch (error) {
      await clearRender();
      currentPdfBytes = null;
      currentFile = null;
      dirty = false;
      $('#pdfPageFrame').classList.add('hidden');
      $('#pdfEmptyState').classList.remove('hidden');
      updateControls();
      void renderLivePreview(null);
      setStatus(passwordCancelled ? 'Abertura cancelada.' : error?.message ? 'Não foi possível ler este PDF: ' + error.message : 'Não foi possível abrir este PDF.', !passwordCancelled);
    } finally { opening = false; }
  }

  async function replaceWorkingPdf(bytes, message) {
    const nextPage = currentPage;
    await openViewer({ name: currentFile?.name || 'Documento.pdf', path: currentFile?.path || '', data: bytes }, null, { savePath: false, isDirty: true });
    currentPage = Math.min(nextPage, pdf?.numPages || 1);
    updateControls();
    if (pdf) await renderPage();
    if (pdf) scheduleLivePreview(null, 'Prévia do documento atualizado. As alterações ainda não foram salvas no disco.');
    if (pdf) setStatus(message + ' Use “Salvar PDF” para gravar uma cópia.');
  }

  async function openPdf() {
    if (opening) return;
    if (dirty && !window.confirm('Há alterações não salvas. Abrir outro arquivo descartará essas alterações. Continuar?')) return;
    setToolFeedback('pdfOpen', 'Selecione um arquivo PDF…', 'working');
    try {
      const file = await window.ntc.openPdfDocument();
      if (file) {
        await openViewer(file);
        setToolFeedback('pdfOpen', pdf ? 'PDF aberto: ' + (file.name || 'Documento.pdf') + '.' : 'O PDF foi selecionado, mas não pôde ser aberto. Confira a mensagem abaixo.', pdf ? 'success' : 'error');
      } else setToolFeedback('pdfOpen', 'Abertura cancelada; o documento atual foi mantido.', 'info');
    } catch (error) {
      const message = error?.message || 'Não foi possível abrir o PDF.';
      setToolFeedback('pdfOpen', message, 'error');
      setStatus(message, true);
    }
  }

  async function restoreLastPdf() {
    if (restored) return;
    restored = true;
    const state = await window.ntc.getDocumentsState();
    if (!state?.lastPdfPath) return;
    const file = await window.ntc.readPdfDocument(state.lastPdfPath);
    if (file) await openViewer(file, state);
    else setStatus('O PDF aberto anteriormente não está mais disponível. Selecione outro arquivo.', true);
  }

  function selectedPageIndices({ allowRepeated = false, allowEmpty = true } = {}) {
    if (!pdf) throw new Error('Abra um PDF primeiro.');
    return parsePdfPageSelection($('#pdfPageSelection').value, pdf.numPages, { allowRepeated, allowEmpty });
  }

  async function applyPageOperation(operation, successMessage, controlId = null) {
    if (!currentPdfBytes || opening) return;
    activeLivePreviewOperation = null;
    activeLivePreviewMessage = 'Prévia do documento atual.';
    try {
      if (controlId) setToolFeedback(controlId, 'Processando…', 'working');
      setStatus('Aplicando operação…');
      const result = await operation();
      await replaceWorkingPdf(result, successMessage);
      if (controlId) setToolFeedback(controlId, successMessage, 'success');
    } catch (error) {
      const message = error?.message || 'Não foi possível aplicar a operação.';
      if (controlId) setToolFeedback(controlId, message, 'error');
      setStatus(message, true);
      scheduleLivePreview(null, 'Prévia do PDF atual.');
    }
  }

  function outputName(suffix) {
    const source = String(currentFile?.name || 'Documento').replace(/\.pdf$/i, '');
    return source + suffix;
  }

  async function savePdfCopy(data, name, activate = false) {
    const result = await window.ntc.savePdfDocument({ data, name });
    lastPdfSaveResult = result;
    if (!result?.ok) {
      if (!result?.canceled) setStatus(result?.error || 'Não foi possível salvar o PDF.', true);
      return false;
    }
    setStatus('PDF salvo: ' + result.name);
    if (activate) await openViewer({ name: result.name, path: result.path, data, size: data.byteLength });
    return result;
  }

  async function saveCurrentPdf() {
    if (!currentPdfBytes) return;
    setToolFeedback('pdfSave', 'Preparando a cópia do PDF…', 'working');
    const suffix = dirty ? '-editado' : '-copia';
    const saved = await savePdfCopy(currentPdfBytes, outputName(suffix), true);
    if (!saved) {
      const canceled = lastPdfSaveResult?.canceled;
      setToolFeedback('pdfSave', canceled ? 'Salvamento cancelado; o PDF aberto continua inalterado.' : lastPdfSaveResult?.error || 'Não foi possível salvar o PDF.', canceled ? 'info' : 'error');
      return;
    }
    setToolFeedback('pdfSave', 'Cópia salva como ' + saved.name + '.', 'success');
    setStatus('PDF salvo como ' + saved.name + '. O arquivo de origem continua preservado.');
  }

  function parseTextPages(input) {
    return parsePdfPageSelection(input, pdf.numPages, { allowEmpty: true });
  }

  async function extractText() {
    if (!pdf) return;
    setToolFeedback('pdfExtractText', 'Lendo as páginas…', 'working');
    try {
      const query = $('#pdfFindText').value.trim().toLocaleLowerCase();
      const selected = parseTextPages($('#pdfTextPages').value);
      const parts = [];
      const matches = [];
      setStatus('Lendo o texto das páginas…');
      for (const index of selected) {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').trim();
        parts.push('Página ' + (index + 1) + '\n' + text);
        if (query && text.toLocaleLowerCase().includes(query)) matches.push(index + 1);
      }
      const resultText = parts.join('\n\n');
      if (!resultText.replace(/[\s\u200b]/g, '')) {
        setToolFeedback('pdfExtractText', 'Nenhum texto digital encontrado. Este PDF pode ser escaneado e precisar de OCR.', 'error');
        setStatus('Não encontrei texto digital nessas páginas. PDFs escaneados precisam de OCR.', true);
        return;
      }
      const result = await window.ntc.saveTextDocument({ format: 'txt', name: outputName('-texto'), content: resultText });
      if (result?.ok) {
        const message = 'Texto extraído e salvo como ' + result.name + (query ? ' · ' + matches.length + ' página(s) contêm o trecho buscado.' : '');
        setToolFeedback('pdfExtractText', message, 'success');
        setStatus(message);
      } else if (result?.canceled) {
        setToolFeedback('pdfExtractText', 'Salvamento cancelado; nenhum arquivo foi criado.', 'info');
      } else {
        const message = result?.error || 'Não foi possível salvar o texto.';
        setToolFeedback('pdfExtractText', message, 'error');
        setStatus(message, true);
      }
    } catch (error) {
      const message = error?.message || 'Não foi possível extrair o texto.';
      setToolFeedback('pdfExtractText', message, 'error');
      setStatus(message, true);
    }
  }

  async function findText() {
    if (!pdf) return;
    const query = $('#pdfFindText').value.trim().toLocaleLowerCase();
    if (!query) { $('#pdfFindStatus').textContent = 'Digite algo para buscar.'; return; }
    const pages = [];
    try {
      $('#pdfFindStatus').textContent = 'Buscando…';
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index);
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str).join(' ').toLocaleLowerCase();
        const count = text.split(query).length - 1;
        if (count > 0) pages.push({ page: index, count });
      }
      const total = pages.reduce((sum, item) => sum + item.count, 0);
      if (!total) {
        $('#pdfFindStatus').textContent = 'Nenhum resultado. PDFs escaneados precisam de OCR.';
        return;
      }
      $('#pdfFindStatus').textContent = total + ' resultado(s), páginas ' + pages.slice(0, 12).map(item => item.page).join(', ') + (pages.length > 12 ? '…' : '');
      currentPage = pages[0].page;
      await renderPage();
      refreshLivePreview();
      window.ntcDocumentsUi?.updatePdfProgress(currentPage, zoom);
    } catch (error) { $('#pdfFindStatus').textContent = error?.message || 'Não foi possível pesquisar.'; }
  }

  async function savePageAsPng(feedbackControlId = null) {
    if (!pdf) return;
    if (feedbackControlId) setToolFeedback(feedbackControlId, 'Renderizando a página…', 'working');
    let canvas = null;
    try {
      const page = await pdf.getPage(currentPage);
      const unitViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, Math.sqrt(30_000_000 / (unitViewport.width * unitViewport.height)));
      const viewport = page.getViewport({ scale });
      canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await window.ntc.savePdfImage({
        name: outputName('-pagina-' + currentPage),
        dataUrl: canvas.toDataURL('image/png')
      });
      if (result?.ok) {
        const message = 'Página ' + currentPage + ' salva como ' + result.name + '.';
        if (feedbackControlId) setToolFeedback(feedbackControlId, message, 'success');
        setStatus(message);
      } else if (result?.canceled) {
        if (feedbackControlId) setToolFeedback(feedbackControlId, 'Salvamento cancelado; nenhuma imagem foi criada.', 'info');
      } else {
        const message = result?.error || 'Não foi possível salvar a imagem.';
        if (feedbackControlId) setToolFeedback(feedbackControlId, message, 'error');
        setStatus(message, true);
      }
    } catch (error) {
      const message = error?.message || 'Não foi possível exportar a página.';
      if (feedbackControlId) setToolFeedback(feedbackControlId, message, 'error');
      setStatus(message, true);
    } finally {
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }

  async function mergeSelectedPdfs() {
    setToolFeedback('pdfMergeOpen', 'Selecione os arquivos PDF para combinar.', 'working');
    try {
      const files = await window.ntc.openPdfDocuments();
      if (!files?.length) {
        setToolFeedback('pdfMergeOpen', 'Combinação cancelada; nenhum arquivo foi alterado.', 'info');
        return;
      }
      if (files.length < 2) {
        $('#pdfMergeStatus').textContent = 'Escolha pelo menos dois arquivos.';
        setToolFeedback('pdfMergeOpen', 'Selecione pelo menos dois PDFs.', 'error');
        return;
      }
      $('#pdfMergeStatus').textContent = files.length + ' PDFs selecionados';
      setToolFeedback('pdfMergeOpen', 'Combinando ' + files.length + ' PDFs…', 'working');
      setStatus('Combinando arquivos…');
      const bytes = await mergePdfFiles(files);
      const result = await savePdfCopy(bytes, 'PDF-combinado', true);
      setToolFeedback('pdfMergeOpen', result?.ok ? 'PDF combinado e salvo como ' + result.name + '.' : result?.canceled ? 'Salvamento cancelado; nenhum arquivo foi criado.' : 'Não foi possível salvar o PDF combinado.', result?.ok ? 'success' : result?.canceled ? 'info' : 'error');
    } catch (error) {
      const message = error?.message || 'Não foi possível combinar os PDFs.';
      setToolFeedback('pdfMergeOpen', message, 'error');
      setStatus(message, true);
    }
  }

  async function createPdfFromSelectedImages() {
    setToolFeedback('pdfCreateFromImages', 'Selecione as imagens para montar o PDF.', 'working');
    try {
      const images = await window.ntc.openPdfImages();
      if (!images?.length) {
        setToolFeedback('pdfCreateFromImages', 'Criação cancelada; nenhum arquivo foi criado.', 'info');
        return;
      }
      setStatus('Criando PDF com ' + images.length + ' imagens…');
      const bytes = await createPdfFromImages(images, $('#pdfSourcePaper').value);
      const result = await savePdfCopy(bytes, 'Imagens-em-PDF', true);
      setToolFeedback('pdfCreateFromImages', result?.ok ? 'PDF criado com ' + images.length + ' imagem(ns): ' + result.name + '.' : result?.canceled ? 'Salvamento cancelado; nenhum arquivo foi criado.' : 'Não foi possível salvar o PDF.', result?.ok ? 'success' : result?.canceled ? 'info' : 'error');
    } catch (error) {
      const message = error?.message || 'Não foi possível criar o PDF a partir das imagens.';
      setToolFeedback('pdfCreateFromImages', message, 'error');
      setStatus(message, true);
    }
  }

  async function createTextPdf() {
    const text = $('#pdfSourceText').value.trim();
    if (!text) {
      const message = 'Digite ou cole o texto que deseja colocar no PDF.';
      setToolFeedback('pdfCreateFromText', message, 'error');
      setStatus(message, true);
      return;
    }
    try {
      setToolFeedback('pdfCreateFromText', 'Criando PDF…', 'working');
      setStatus('Criando PDF a partir do texto…');
      const size = Math.max(8, Math.min(36, Number($('#pdfSourceSize').value) || 12));
      const bytes = await createPdfFromText(text, $('#pdfSourcePaper').value, size);
      const result = await savePdfCopy(bytes, 'Texto-em-PDF', true);
      setToolFeedback('pdfCreateFromText', result?.ok ? 'PDF criado e salvo como ' + result.name + '.' : result?.canceled ? 'Salvamento cancelado; nenhum arquivo foi criado.' : 'Não foi possível salvar o PDF.', result?.ok ? 'success' : result?.canceled ? 'info' : 'error');
    } catch (error) {
      const message = error?.message || 'Não foi possível criar o PDF a partir do texto.';
      setToolFeedback('pdfCreateFromText', message, 'error');
      setStatus(message, true);
    }
  }

  document.querySelectorAll('[data-pdf-tab]').forEach(button => button.addEventListener('click', () => switchPdfTab(button.dataset.pdfTab)));
  $('#pdfOpen').addEventListener('click', openPdf);
  $('#pdfEmptyOpen').addEventListener('click', openPdf);
  $('#pdfSave').addEventListener('click', saveCurrentPdf);
  $('#pdfPreviousPage').addEventListener('click', async () => {
    if (!pdf || currentPage <= 1) return;
    currentPage--;
    await renderPage();
    refreshLivePreview();
    window.ntcDocumentsUi?.updatePdfProgress(currentPage, zoom);
  });
  $('#pdfNextPage').addEventListener('click', async () => {
    if (!pdf || currentPage >= pdf.numPages) return;
    currentPage++;
    await renderPage();
    refreshLivePreview();
    window.ntcDocumentsUi?.updatePdfProgress(currentPage, zoom);
  });
  $('#pdfZoomIn').addEventListener('click', async () => {
    if (!pdf || zoom >= 2.5) return;
    zoom = Math.min(2.5, Number((zoom + 0.2).toFixed(2)));
    await renderPage();
    window.ntcDocumentsUi?.updatePdfProgress(currentPage, zoom);
  });
  $('#pdfZoomOut').addEventListener('click', async () => {
    if (!pdf || zoom <= 0.5) return;
    zoom = Math.max(0.5, Number((zoom - 0.2).toFixed(2)));
    await renderPage();
    window.ntcDocumentsUi?.updatePdfProgress(currentPage, zoom);
  });
  $('#pdfGoToPageButton').addEventListener('click', async () => {
    if (!pdf) return;
    const destination = Number($('#pdfGoToPage').value);
    if (!Number.isInteger(destination) || destination < 1 || destination > pdf.numPages) {
      setStatus('Informe uma página entre 1 e ' + pdf.numPages + '.', true);
      return;
    }
    currentPage = destination;
    await renderPage();
    refreshLivePreview();
    window.ntcDocumentsUi?.updatePdfProgress(currentPage, zoom);
  });
  $('#pdfGoToPage').addEventListener('keydown', event => { if (event.key === 'Enter') $('#pdfGoToPageButton').click(); });
  $('#pdfFindButton').addEventListener('click', findText);
  $('#pdfFindText').addEventListener('keydown', event => { if (event.key === 'Enter') void findText(); });
  $('#pdfExportPageImage').addEventListener('click', () => savePageAsPng('pdfExportPageImage'));
  $('#pdfExportPageImageTool').addEventListener('click', () => savePageAsPng('pdfExportPageImageTool'));
  $('#pdfMergeOpen').addEventListener('click', mergeSelectedPdfs);
  $('#pdfCreateFromImages').addEventListener('click', createPdfFromSelectedImages);
  $('#pdfCreateFromText').addEventListener('click', createTextPdf);
  $('#pdfWatermarkText').addEventListener('input', previewWatermark);
  $('#pdfWatermarkOpacity').addEventListener('input', () => { updateControls(); previewWatermark(); });
  $('#pdfWatermarkAngle').addEventListener('change', previewWatermark);
  $('#pdfPageSelection').addEventListener('input', () => { if (activeLivePreviewMessage.includes('marca d’água')) previewWatermark(); });
  $('#pdfNumberFormat').addEventListener('input', previewPageNumbers);
  $('#pdfNumberStart').addEventListener('input', previewPageNumbers);
  $('#pdfStampText').addEventListener('input', previewPageText);
  $('#pdfStampSize').addEventListener('input', previewPageText);
  $('#pdfStampColor').addEventListener('input', previewPageText);
  $('#pdfLivePreviewExpand').addEventListener('click', () => {
    setLivePreviewExpanded(!$('#pdfLivePreviewCard').classList.contains('expanded'));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#pdfLivePreviewCard').classList.contains('expanded')) setLivePreviewExpanded(false);
  });
  ['pdfMetadataTitle', 'pdfMetadataAuthor', 'pdfMetadataSubject', 'pdfMetadataKeywords'].forEach(id => {
    $('#' + id).addEventListener('input', () => {
      refreshMetadataPreview();
      setToolFeedback('pdfSaveMetadata', 'Prévia dos metadados atualizada. Clique em “Salvar metadados” para aplicar ao PDF aberto.', 'info');
    });
  });
  window.addEventListener('resize', () => {
    if ($('#pdfView').classList.contains('active') && $('[data-pdf-panel="edit"]').classList.contains('active')) refreshLivePreview();
  });
  $('#pdfRotateLeft').addEventListener('click', () => {
    void applyPageOperation(async () => rotatePdfPages(currentPdfBytes, selectedPageIndices(), -90), 'Páginas giradas.', 'pdfRotateLeft');
  });
  $('#pdfRotateRight').addEventListener('click', () => {
    void applyPageOperation(async () => rotatePdfPages(currentPdfBytes, selectedPageIndices(), 90), 'Páginas giradas.', 'pdfRotateRight');
  });
  $('#pdfExtractPages').addEventListener('click', async () => {
    if (!currentPdfBytes) return;
    try {
      setToolFeedback('pdfExtractPages', 'Extraindo páginas…', 'working');
      setStatus('Extraindo páginas…');
      const bytes = await extractPdfPages(currentPdfBytes, selectedPageIndices());
      const result = await savePdfCopy(bytes, outputName('-paginas'));
      if (result?.ok) {
        setToolFeedback('pdfExtractPages', 'Páginas extraídas e salvas como ' + result.name + '.', 'success');
        setStatus('Páginas extraídas para ' + result.name + '.');
      } else if (result?.canceled) setToolFeedback('pdfExtractPages', 'Salvamento cancelado; nenhum arquivo foi criado.', 'info');
      else setToolFeedback('pdfExtractPages', 'Não foi possível salvar as páginas extraídas.', 'error');
    } catch (error) {
      const message = error?.message || 'Não foi possível extrair essas páginas.';
      setToolFeedback('pdfExtractPages', message, 'error');
      setStatus(message, true);
    }
  });
  $('#pdfRemovePages').addEventListener('click', () => {
    void applyPageOperation(async () => deletePdfPages(currentPdfBytes, selectedPageIndices()), 'Páginas excluídas.', 'pdfRemovePages');
  });
  $('#pdfReorderPages').addEventListener('click', () => {
    void applyPageOperation(async () => {
      const order = parsePdfPageSelection($('#pdfPageOrder').value, pdf.numPages, { allowRepeated: true, allowEmpty: false });
      return rebuildPdfPages(currentPdfBytes, order);
    }, 'Ordem das páginas atualizada.', 'pdfReorderPages');
  });
  $('#pdfReversePages').addEventListener('click', () => {
    void applyPageOperation(async () => rebuildPdfPages(currentPdfBytes, Array.from({ length: pdf.numPages }, (_value, index) => pdf.numPages - index - 1)), 'Ordem das páginas invertida.', 'pdfReversePages');
  });
  $('#pdfDuplicatePages').addEventListener('click', () => {
    void applyPageOperation(async () => {
      const selected = new Set(selectedPageIndices());
      const order = [];
      for (let index = 0; index < pdf.numPages; index++) {
        order.push(index);
        if (selected.has(index)) order.push(index);
      }
      return rebuildPdfPages(currentPdfBytes, order);
    }, 'Páginas duplicadas.', 'pdfDuplicatePages');
  });
  $('#pdfInsertBlank').addEventListener('click', () => {
    void applyPageOperation(() => insertBlankPdfPage(currentPdfBytes, currentPage - 1), 'Página em branco adicionada após a página ' + currentPage + '.', 'pdfInsertBlank');
  });
  $('#pdfApplyWatermark').addEventListener('click', () => {
    const text = $('#pdfWatermarkText').value.trim();
    if (!text) {
      setToolFeedback('pdfApplyWatermark', 'Digite o texto da marca d’água.', 'error');
      setStatus('Digite o texto da marca d’água.', true);
      return;
    }
    void applyPageOperation(() => addPdfWatermark(currentPdfBytes, selectedPageIndices(), {
      text,
      opacity: Number($('#pdfWatermarkOpacity').value) / 100,
      angle: Number($('#pdfWatermarkAngle').value)
    }), 'Marca d’água aplicada ao PDF aberto.', 'pdfApplyWatermark');
  });
  $('#pdfAddPageNumbers').addEventListener('click', () => {
    const format = $('#pdfNumberFormat').value.trim();
    if (!format || !format.includes('{n}')) {
      setToolFeedback('pdfAddPageNumbers', 'O modelo precisa incluir {n} para mostrar o número da página.', 'error');
      setStatus('O modelo precisa incluir {n} para mostrar o número da página.', true);
      return;
    }
    const start = Math.max(1, Math.min(999999, Number($('#pdfNumberStart').value) || 1));
    void applyPageOperation(() => addPdfPageNumbers(currentPdfBytes, { format, start }), 'Numeração adicionada ao PDF aberto.', 'pdfAddPageNumbers');
  });
  $('#pdfApplyStamp').addEventListener('click', () => {
    const text = $('#pdfStampText').value.trim();
    if (!text) {
      setToolFeedback('pdfApplyStamp', 'Digite o texto que deseja inserir.', 'error');
      setStatus('Digite o texto que deseja inserir.', true);
      return;
    }
    const size = Math.max(8, Math.min(72, Number($('#pdfStampSize').value) || 16));
    void applyPageOperation(() => addPdfText(currentPdfBytes, currentPage - 1, { text, size, color: $('#pdfStampColor').value }), 'Texto inserido na página ' + currentPage + '.', 'pdfApplyStamp');
  });
  $('#pdfSaveMetadata').addEventListener('click', () => {
    void applyPageOperation(() => updatePdfMetadata(currentPdfBytes, {
      title: $('#pdfMetadataTitle').value,
      author: $('#pdfMetadataAuthor').value,
      subject: $('#pdfMetadataSubject').value,
      keywords: $('#pdfMetadataKeywords').value
    }), 'Metadados atualizados no PDF aberto.', 'pdfSaveMetadata');
  });
  $('#pdfClearMetadata').addEventListener('click', () => {
    void applyPageOperation(() => clearPdfMetadata(currentPdfBytes), 'Metadados removidos do PDF aberto.', 'pdfClearMetadata');
  });
  $('#pdfLoadFormFields').addEventListener('click', loadPdfFormFields);
  $('#pdfApplyFormFields').addEventListener('click', applyPdfFormFields);
  setupSignatureCanvas();
  updateControls();
  window.ntcPdfUi = { open: restoreLastPdf, openFile: openPdf, refresh: restoreLastPdf };
})();
