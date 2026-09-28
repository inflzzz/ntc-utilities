(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  const PAGE_SIZE = 40;
  const ui = { filter: 'all', query: '', items: [], total: 0, hasMore: false, requestId: 0, searchTimer: null, status: null, quotaBytes: 250 * MB, quotaUnit: 'MB', initialized: false, showToast: () => {}, confirmAction: async () => false };
  const thumbnails = new Map();
  let thumbnailObserver;
  let thumbnailActive = 0;
  const thumbnailQueue = [];

  function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let amount = value / 1024;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: amount >= 100 ? 0 : 1 }).format(amount)} ${units[index]}`;
  }

  function friendlyDate(timestamp) {
    const date = new Date(Number(timestamp));
    return Number.isNaN(date.getTime()) ? 'Data desconhecida' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function updateStorageSummary(status = ui.status) {
    if (!status) return;
    const used = formatBytes(status.usedBytes);
    const quota = formatBytes(status.settings?.quotaBytes);
    const count = Number(status.count) || 0;
    const summary = `${count} ${count === 1 ? 'item' : 'itens'} · ${used} de ${quota}`;
    $('#clipboardStorageSummary').textContent = summary;
    $('#clipboardSettingsSummary').textContent = summary;
  }

  function updateStatus(status) {
    if (!status || typeof status !== 'object') return;
    ui.status = status;
    const element = $('#clipboardStatus');
    const warning = String(status.warning || '').trim();
    let label;
    let state;
    if (!status.supported) {
      label = warning || 'A captura da área de transferência está disponível no Windows.';
      state = 'warning';
    } else if (warning) {
      label = warning;
      state = 'warning';
    } else if (!status.listenerReady) {
      label = 'Iniciando o observador da área de transferência…';
      state = 'warning';
    } else {
      label = 'Captura ativa enquanto o NTC Utilities estiver aberto, inclusive na bandeja. Os dados ficam somente neste computador.';
      state = 'active';
    }
    element.textContent = label;
    element.dataset.state = state;
    updateStorageSummary(status);
    syncSettingsForm(status);
  }

  function syncSettingsForm(status) {
    if (!status.settings) return;
    const quotaInput = $('#clipboardQuotaValue');
    const quotaUnit = $('#clipboardQuotaUnit');
    const retentionMode = $('#clipboardRetentionMode');
    const retentionInput = $('#clipboardRetentionDays');
    const quotaFocused = document.activeElement === quotaInput || document.activeElement === quotaUnit;
    const retentionFocused = document.activeElement === retentionInput || document.activeElement === retentionMode;
    ui.quotaBytes = Number(status.settings.quotaBytes) || 250 * MB;
    if (!quotaFocused) {
      ui.quotaUnit = ui.quotaBytes >= GB ? 'GB' : 'MB';
      quotaUnit.value = ui.quotaUnit;
      const factor = ui.quotaUnit === 'GB' ? GB : MB;
      quotaInput.value = String(Number((ui.quotaBytes / factor).toPrecision(6)));
    }
    if (!retentionFocused) {
      const never = status.settings.retentionDays === null;
      retentionMode.value = never ? 'never' : 'days';
      retentionInput.disabled = never;
      retentionInput.value = String(never ? 30 : status.settings.retentionDays);
    }
  }

  function renderList() {
    const list = $('#clipboardHistoryList');
    thumbnailObserver?.disconnect();
    thumbnailQueue.length = 0;
    if (!ui.items.length) {
      const isFiltered = Boolean(ui.query) || ui.filter !== 'all';
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">▤</div><p>${isFiltered ? 'Nenhum item corresponde a essa busca ou filtro.' : 'Copie um texto ou uma imagem em qualquer aplicativo enquanto o NTC estiver aberto. O histórico aparecerá aqui.'}</p></div>`;
      $('#clipboardLoadMore').classList.add('hidden');
      return;
    }
    list.innerHTML = ui.items.map(item => {
      const isLink = item.kind === 'text' && /^https?:\/\/\S+$/i.test(item.textPreview || '');
      const title = item.kind === 'image' ? 'Imagem copiada' : item.kind === 'mixed' ? 'Texto e imagem copiados' : isLink ? 'Link copiado' : 'Texto copiado';
      const preview = item.textPreview ? `<p title="${safeText(item.textPreview)}">${safeText(item.textPreview)}</p>` : item.kind !== 'text' ? '<p>Imagem salva neste computador.</p>' : '<p>Texto sem prévia disponível.</p>';
      const type = item.kind === 'image' ? 'IMG' : item.kind === 'mixed' ? '▧' : isLink ? '↗' : 'TXT';
      const thumbnail = item.hasImage ? `<div class="clipboard-thumbnail" data-clipboard-thumbnail="${safeText(item.id)}" role="img" aria-label="Miniatura da imagem copiada"><span aria-hidden="true">Imagem</span></div>` : `<span class="clipboard-kind-icon" aria-hidden="true">${type}</span>`;
      return `<article class="clipboard-item" data-clipboard-item="${safeText(item.id)}">
        ${thumbnail}
        <div class="clipboard-item-copy"><strong>${title}</strong>${preview}<small>${friendlyDate(item.createdAt)} · ${formatBytes(item.sizeBytes)}${item.pinned ? ' · Fixado' : ''}</small></div>
        <div class="clipboard-item-actions"><button class="outline-button" type="button" data-clipboard-action="copy" data-id="${safeText(item.id)}">Copiar</button><button class="ghost-button" type="button" data-clipboard-action="preview" data-id="${safeText(item.id)}">Ampliar</button><details class="clipboard-item-menu"><summary aria-label="Mais ações para ${title}" title="Mais ações">⋯</summary><div><button class="ghost-button" type="button" data-clipboard-action="pin" data-pinned="${item.pinned ? 'true' : 'false'}" data-id="${safeText(item.id)}">${item.pinned ? 'Desafixar' : 'Fixar'}</button><button class="ghost-button clipboard-delete" type="button" data-clipboard-action="delete" data-id="${safeText(item.id)}" aria-label="Excluir item de ${friendlyDate(item.createdAt)}">Excluir</button></div></details></div>
      </article>`;
    }).join('');
    $('#clipboardLoadMore').classList.toggle('hidden', !ui.hasMore);
    observeThumbnails();
  }

  function observeThumbnails() {
    const targets = $$('#clipboardHistoryList [data-clipboard-thumbnail]');
    if (!targets.length) return;
    if ('IntersectionObserver' in window) {
      thumbnailObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          thumbnailObserver.unobserve(entry.target);
          thumbnailQueue.push(entry.target);
        }
        drainThumbnails();
      }, { rootMargin: '180px' });
      targets.forEach(target => thumbnailObserver.observe(target));
    } else {
      thumbnailQueue.push(...targets);
      drainThumbnails();
    }
  }

  function drainThumbnails() {
    while (thumbnailActive < 3 && thumbnailQueue.length) {
      const target = thumbnailQueue.shift();
      if (!target.isConnected) continue;
      thumbnailActive++;
      const id = target.dataset.clipboardThumbnail;
      const cached = thumbnails.get(id);
      const request = cached === undefined ? window.ntc.thumbnailClipboardHistoryItem(id).then(value => value?.imageDataUrl || '') : Promise.resolve(cached);
      request.then(dataUrl => {
        if (cached === undefined && dataUrl) {
          thumbnails.set(id, dataUrl);
          if (thumbnails.size > 80) thumbnails.delete(thumbnails.keys().next().value);
        }
        if (!target.isConnected) return;
        if (!dataUrl) { target.classList.add('is-unavailable'); target.querySelector('span').textContent = 'Prévia indisponível'; return; }
        const image = document.createElement('img');
        image.src = dataUrl;
        image.alt = '';
        // IntersectionObserver already defers the request until the tile approaches
        // the viewport. Native lazy loading can defer it again in hidden windows.
        target.replaceChildren(image);
        target.classList.add('is-loaded');
      }).catch(() => {
        if (target.isConnected) { target.classList.add('is-unavailable'); target.querySelector('span').textContent = 'Prévia indisponível'; }
      }).finally(() => { thumbnailActive--; drainThumbnails(); });
    }
  }

  async function loadList({ append = false } = {}) {
    const requestId = ++ui.requestId;
    const offset = append ? ui.items.length : 0;
    if (!append) {
      ui.items = [];
      thumbnailObserver?.disconnect();
      $('#clipboardHistoryList').innerHTML = '<div class="empty-state"><p>Carregando o histórico…</p></div>';
    }
    try {
      const page = await window.ntc.listClipboardHistory({ filter: ui.filter, query: ui.query, offset, limit: PAGE_SIZE });
      if (requestId !== ui.requestId) return;
      ui.items = append ? [...ui.items, ...page.items] : page.items;
      ui.total = page.total;
      ui.hasMore = page.hasMore;
      renderList();
    } catch (error) {
      if (requestId !== ui.requestId) return;
      $('#clipboardHistoryList').innerHTML = `<div class="empty-state"><p>Não foi possível carregar o histórico: ${safeText(error.message || error)}</p></div>`;
    }
  }

  async function refreshState() {
    try { updateStatus(await window.ntc.getClipboardHistoryState()); }
    catch (error) { updateStatus({ supported: true, listenerReady: false, warning: error.message || 'Não foi possível carregar o histórico local.' }); }
  }

  async function openPreview(id) {
    const item = ui.items.find(entry => entry.id === id);
    try {
      const preview = await window.ntc.previewClipboardHistoryItem(id);
      if (!preview) { ui.showToast('Esse item não está mais no histórico.'); await loadList(); return; }
      const image = $('#clipboardPreviewImage');
      const text = $('#clipboardPreviewText');
      image.classList.toggle('hidden', !preview.imageDataUrl);
      if (preview.imageDataUrl) image.src = preview.imageDataUrl;
      else image.removeAttribute('src');
      text.classList.toggle('hidden', !preview.text);
      text.textContent = preview.text || '';
      $('#clipboardPreviewMoreText').classList.toggle('hidden', !preview.hasMoreText);
      $('#clipboardPreviewTitle').textContent = item?.kind === 'image' ? 'Prévia da imagem' : item?.kind === 'mixed' ? 'Prévia do conteúdo' : 'Prévia do texto';
      $('#clipboardPreviewDialog').classList.remove('hidden');
      $('#closeClipboardPreview').focus();
    } catch (error) { ui.showToast(error.message || 'Não foi possível abrir a prévia.'); }
  }

  async function runItemAction(action, id, button) {
    button.disabled = true;
    try {
      if (action === 'copy') {
        const result = await window.ntc.copyClipboardHistoryItem(id);
        if (!result?.ok) throw new Error(result?.message || 'Não foi possível copiar o item.');
        ui.showToast('Conteúdo copiado. Cole no outro app quando quiser.');
      } else if (action === 'pin') {
        const result = await window.ntc.pinClipboardHistoryItem(id, button.dataset.pinned !== 'true');
        if (!result?.ok) throw new Error(result?.message || 'Não foi possível atualizar o item.');
        ui.showToast(button.dataset.pinned === 'true' ? 'Item desafixado.' : 'Item fixado.');
      } else if (action === 'delete') {
        const result = await window.ntc.deleteClipboardHistoryItem(id);
        if (!result?.ok) throw new Error(result?.message || 'Não foi possível excluir o item.');
        ui.showToast('Item excluído.');
        thumbnails.delete(id);
      } else if (action === 'preview') {
        await openPreview(id);
        return;
      }
      await Promise.all([refreshState(), loadList()]);
    } catch (error) {
      ui.showToast(error.message || 'Não foi possível concluir a ação.');
      button.disabled = false;
    }
  }

  async function saveSettings() {
    const amount = Number($('#clipboardQuotaValue').value);
    const factor = $('#clipboardQuotaUnit').value === 'GB' ? GB : MB;
    const quotaBytes = Math.round(amount * factor);
    const mode = $('#clipboardRetentionMode').value;
    const retentionDays = mode === 'never' ? null : Number($('#clipboardRetentionDays').value);
    if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1) {
      ui.showToast('Informe uma cota de armazenamento maior que zero.');
      return;
    }
    if (retentionDays !== null && (!Number.isSafeInteger(retentionDays) || retentionDays < 1)) {
      ui.showToast('Informe um prazo de retenção válido em dias.');
      return;
    }
    try {
      const result = await window.ntc.saveClipboardHistorySettings({ quotaBytes, retentionDays });
      if (!result?.ok) throw new Error(result?.message || 'Não foi possível salvar as configurações.');
      ui.quotaBytes = quotaBytes;
      updateStatus({ ...ui.status, ...result, settings: result.settings || { quotaBytes, retentionDays } });
      await loadList();
      ui.showToast('Configurações do histórico salvas.');
    } catch (error) { ui.showToast(error.message || 'Não foi possível salvar as configurações.'); }
  }

  function bind() {
    $('#clipboardSearch').addEventListener('input', event => {
      ui.query = event.target.value;
      clearTimeout(ui.searchTimer);
      ui.searchTimer = setTimeout(() => loadList(), 180);
    });
    $$('.clipboard-filter').forEach(button => button.addEventListener('click', () => {
      ui.filter = button.dataset.clipboardFilter;
      $$('.clipboard-filter').forEach(filter => {
        const selected = filter === button;
        filter.classList.toggle('active', selected);
        filter.setAttribute('aria-pressed', String(selected));
      });
      void loadList();
    }));
    $('#clipboardHistoryList').addEventListener('click', event => {
      const button = event.target.closest('[data-clipboard-action]');
      if (button) void runItemAction(button.dataset.clipboardAction, button.dataset.id, button);
    });
    $('#clipboardLoadMore').addEventListener('click', () => loadList({ append: true }));
    $('#clipboardClearAll').addEventListener('click', async () => {
      const confirmed = await ui.confirmAction('Limpar o histórico da área de transferência?', 'Todos os itens serão removidos, inclusive os fixados. Essa ação não pode ser desfeita.', 'Limpar tudo');
      if (!confirmed) return;
      try {
        const result = await window.ntc.clearClipboardHistory();
        if (!result?.ok) throw new Error(result?.message || 'Não foi possível limpar o histórico.');
        thumbnails.clear();
        await Promise.all([refreshState(), loadList()]);
        ui.showToast('Histórico da área de transferência limpo.');
      } catch (error) { ui.showToast(error.message || 'Não foi possível limpar o histórico.'); }
    });
    $('#clipboardQuotaValue').addEventListener('input', () => {
      const amount = Number($('#clipboardQuotaValue').value);
      const factor = $('#clipboardQuotaUnit').value === 'GB' ? GB : MB;
      const bytes = Math.round(amount * factor);
      if (Number.isSafeInteger(bytes) && bytes > 0) ui.quotaBytes = bytes;
    });
    $('#clipboardQuotaValue').addEventListener('change', () => void saveSettings());
    $('#clipboardQuotaUnit').addEventListener('change', () => {
      const factor = $('#clipboardQuotaUnit').value === 'GB' ? GB : MB;
      $('#clipboardQuotaValue').value = String(Number((ui.quotaBytes / factor).toPrecision(6)));
      ui.quotaUnit = $('#clipboardQuotaUnit').value;
      void saveSettings();
    });
    $('#clipboardRetentionMode').addEventListener('change', () => {
      $('#clipboardRetentionDays').disabled = $('#clipboardRetentionMode').value === 'never';
      void saveSettings();
    });
    $('#clipboardRetentionDays').addEventListener('change', () => void saveSettings());
    $('#closeClipboardPreview').addEventListener('click', closePreview);
    $('#clipboardPreviewCloseFooter').addEventListener('click', closePreview);
    $('#clipboardPreviewDialog').addEventListener('click', event => { if (event.target === $('#clipboardPreviewDialog')) closePreview(); });
    window.ntc.onClipboardHistoryStatus(updateStatus);
    window.ntc.onClipboardHistoryChanged(() => {
      void refreshState();
      if ($('#clipboardHistoryView').classList.contains('active')) void loadList();
    });
  }

  function closePreview() {
    $('#clipboardPreviewDialog').classList.add('hidden');
    $('#clipboardPreviewImage').removeAttribute('src');
    $('#clipboardPreviewText').textContent = '';
  }

  window.ntcClipboardHistoryUi = {
    initialize(options = {}) {
      if (ui.initialized) return;
      ui.initialized = true;
      ui.showToast = options.showToast || ui.showToast;
      ui.confirmAction = options.confirmAction || ui.confirmAction;
      bind();
      void refreshState();
      void loadList();
    },
    open() { void Promise.all([refreshState(), loadList()]); },
    closePreview
  };
})();
