(() => {
  const view = document.getElementById('uninstallerView');
  if (!view || !window.ntc?.uninstaller) return;
  const api = window.ntc.uninstaller;
  const state = { programs: [], selected: new Set(), current: null, scan: null, busy: false, tab: 'programs', monitor: null, snapshots: [], pending: false, job: null };
  const $ = selector => view.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytes = value => value == null ? 'Não informado' : value < 1048576 ? `${(value / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB` : value < 1073741824 ? `${(value / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${(value / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB`;
  const date = value => /^\d{8}$/.test(String(value)) ? `${String(value).slice(6, 8)}/${String(value).slice(4, 6)}/${String(value).slice(0, 4)}` : value ? new Date(value).toLocaleString('pt-BR') : 'Não informada';
  const confidence = value => ({ high: 'Alta', medium: 'Média', low: 'Baixa' }[value] || value);
  const status = value => ({ removed: 'Em backup', preserved: 'Preservado', restored: 'Restaurado', planned: 'Operação não confirmada', created: 'Criado', modified: 'Modificado' }[value] || value);
  const iconCache = new Map(); let iconObserver;
  let preferences = {}; try { preferences = JSON.parse(localStorage.getItem('ntc-uninstaller-preferences-v1') || '{}'); } catch {}
  view.innerHTML = `<div class="hero compact"><div class="eyebrow">SISTEMA</div><h1>Desinstalador</h1><p>Remova programas e suas sobras com segurança.</p></div>
    <div class="un-toolbar"><div class="un-tabs" role="tablist"><button data-tab="programs" class="active" type="button">Programas</button><button data-tab="history" type="button">Histórico e quarentena</button><button data-tab="tracked" type="button">Instalações monitoradas</button></div><button class="outline-button" data-action="refresh" type="button">Atualizar lista</button></div>
    <div class="un-status" role="status" aria-live="polite">Carregando programas…</div><section class="un-job hidden"></section>
    <section class="un-programs"><div class="un-controls"><input data-query type="search" placeholder="Buscar programa, fabricante ou versão…" aria-label="Buscar programas"/><select data-filter aria-label="Filtro"><option value="all">Todos os aplicativos</option><option value="desktop">Programas tradicionais</option><option value="store">Microsoft Store / MSIX</option><option value="games">Jogos identificados</option><option value="large">Grandes · 1 GB ou mais</option><option value="recent">Data registrada · últimos 30 dias</option><option value="broken">Instalações quebradas</option></select><select data-sort aria-label="Ordenação"><option value="name">Nome</option><option value="size">Tamanho</option><option value="date">Data registrada</option><option value="publisher">Fabricante</option><option value="version">Versão</option></select></div>
      <div class="un-selection"><span data-selection>0 selecionados</span><div class="un-actions"><label class="un-check"><input type="checkbox" data-quiet/> Usar modo silencioso registrado</label><button class="primary-button" data-action="uninstall" type="button" disabled>Desinstalar selecionados</button></div></div><div class="un-workspace"><div class="un-list" aria-label="Programas instalados"></div><aside class="un-details"><p>Selecione um programa para ver os detalhes e analisar a instalação.</p></aside></div>
    </section><section class="un-other hidden"></section><section class="un-review hidden"></section>
    <details class="un-advanced"><summary>Recursos avançados</summary><div class="un-advanced-grid"><article><h3>Identificar um programa</h3><p>Arraste um executável, atalho ou pasta aqui, ou selecione um arquivo. A associação usa o caminho registrado.</p><div class="un-actions"><button class="outline-button" data-action="identify" type="button">Selecionar arquivo</button><button class="outline-button" data-action="hunter" type="button">Selecionar janela na tela</button></div><div class="un-identify" role="status"></div></article><article><h3>Instalação quebrada ou alvo manual</h3><p>A análise forçada pede revisão individual antes de qualquer remoção.</p><button class="outline-button" data-action="forced-folder" type="button">Selecionar pasta para analisar</button></article><article><h3>Monitorar instalação</h3><p>Snapshots locais registram diferenças; alterações de outros programas ficam sem atribuição.</p><div class="un-actions"><button class="outline-button" data-action="monitor-start" type="button">Selecionar instalador</button><button class="outline-button" data-action="monitor-finish" type="button" disabled>Concluir monitoramento</button></div><div class="un-monitor-status"></div></article><article><h3>Snapshots manuais</h3><div class="un-actions"><button class="outline-button" data-action="snapshot" type="button">Criar snapshot</button><button class="outline-button" data-action="snapshots" type="button">Comparar snapshots</button></div><div class="un-snapshots"></div></article><article><h3>Proteção e privilégios</h3><div class="un-actions"><button class="outline-button" data-action="restore-point" type="button">Criar ponto de restauração</button><button class="outline-button" data-action="elevate" type="button">Autorizar operações de sistema</button></div><label class="un-check"><input type="checkbox" data-system/> Mostrar componentes protegidos</label><label class="un-check"><input type="checkbox" data-restorepoint/> Criar ponto antes de desinstalar</label><p>Arquivos vão para quarentena; valores do registro recebem backup. Nenhum backup é apagado automaticamente.</p></article></div></details>
    <dialog class="un-process-dialog"><h2>O programa está em execução</h2><p class="un-process-names"></p><div class="un-actions"><button class="outline-button" data-process="cancel" type="button">Cancelar</button><button class="outline-button" data-process="continue" type="button">Continuar sem fechar</button><button class="primary-button" data-process="close" type="button">Fechar e continuar</button></div></dialog>`;
  $('.un-advanced-grid').insertAdjacentHTML('beforeend', '<article><h3>Preferências de segurança</h3><label>Modo padrão de análise<select data-scan-mode><option value="normal">Normal</option><option value="deep">Profunda</option></select></label><label class="un-check"><input type="checkbox" data-auto-select checked/> Selecionar sobras de alta confiança, exceto dados pessoais</label><p>Toda remoção exige confirmação. Quarentena e backup do registro são obrigatórios. Retenção: até exclusão manual.</p></article>');
  for (const key of ['quiet', 'system', 'restorepoint', 'auto-select']) if (typeof preferences[key] === 'boolean') $(`[data-${key}]`).checked = preferences[key];
  $('[data-scan-mode]').value = preferences.mode === 'deep' ? 'deep' : 'normal';
  function savePreferences() { const settings = { mode: $('[data-scan-mode]').value }; for (const key of ['quiet', 'system', 'restorepoint', 'auto-select']) settings[key] = $(`[data-${key}]`).checked; try { localStorage.setItem('ntc-uninstaller-preferences-v1', JSON.stringify(settings)); } catch {} }
  for (const key of ['quiet', 'system', 'restorepoint', 'auto-select', 'scan-mode']) $(`[data-${key}]`).addEventListener('change', savePreferences);

  const sizeSort = $('[data-sort]');
  sizeSort.querySelector('[value="size"]').textContent = 'Tamanho · maior primeiro';
  sizeSort.querySelector('[value="size"]').insertAdjacentHTML('afterend', '<option value="size-asc">Tamanho · menor primeiro</option>');
  $('[data-selection]').insertAdjacentHTML('afterend', '<div class="un-size-order" role="group" aria-label="Ordenar programas por tamanho"><button class="outline-button" data-size-order="size" type="button" aria-pressed="false">Mais pesados</button><button class="outline-button" data-size-order="size-asc" type="button" aria-pressed="false">Mais leves</button></div>');
  view.querySelectorAll('[data-size-order]').forEach(button => button.onclick = () => { sizeSort.value = button.dataset.sizeOrder; renderList(); });
  $('.un-size-order').insertAdjacentHTML('beforeend', '<span class="un-size-status" role="status" aria-live="polite"></span>');
  const programSize = p => Number.isFinite(p.size) ? `${p.sizePartial ? '≥ ' : p.sizeStatus === 'registered' ? '≈ ' : ''}${bytes(p.size)}` : p.sizeStatus === 'unavailable' ? (p.sizeReason?.includes('negou acesso') ? 'Acesso bloqueado' : 'Pasta não localizada') : 'Calculando…';
  const sizeExplanation = p => [p.sizeSource, p.sizeRoot, p.sizeReason].filter(Boolean).join(' · ');
  let sizeGeneration = 0, sizePaintTimer;
  function repaintSizes() {
    clearTimeout(sizePaintTimer);
    sizePaintTimer = setTimeout(() => {
      const scroll = $('.un-list').scrollTop, expanded = !!$('.un-details details')?.open;
      renderList(); $('.un-list').scrollTop = scroll; renderDetails();
      if (expanded && $('.un-details details')) $('.un-details details').open = true;
    }, 100);
  }
  async function calculateSizes() {
    const generation = ++sizeGeneration;
    const programs = state.programs.filter(p => !p.protected || $('[data-system]').checked);
    if (!api.size || !programs.length) return;
    let next = 0, completed = 0, failed = 0;
    const worker = async () => {
      while (next < programs.length && generation === sizeGeneration && !state.busy) {
        const p = programs[next++];
        try {
          const result = await api.size(p.id, false);
          if (generation !== sizeGeneration || result.canceled) return;
          Object.assign(p, { size: result.bytes, sizePartial: !!result.partial, sizeSource: result.source, sizeRoot: result.root, sizeReason: result.reason, sizeStatus: result.status });
          if (result.bytes == null) failed++;
        } catch (error) {
          if (generation !== sizeGeneration) return;
          p.sizeStatus = 'unavailable'; p.sizeReason = error.message; failed++;
        }
        completed++;
        $('.un-size-status').textContent = completed < programs.length ? `Calculando tamanhos · ${completed}/${programs.length}` : `Tamanhos verificados${failed ? ` · ${failed} instalações sem pasta acessível` : ''}`;
        repaintSizes();
      }
    };
    $('.un-size-status').textContent = `Calculando tamanhos · 0/${programs.length}`;
    await Promise.all([worker(), worker()]);
  }

  function compareSize(a, b, ascending = false) {
    const knownA = Number.isFinite(a.size) && a.size >= 0, knownB = Number.isFinite(b.size) && b.size >= 0;
    if (knownA !== knownB) return knownA ? -1 : 1;
    const difference = knownA ? (ascending ? a.size - b.size : b.size - a.size) : 0;
    return difference || String(a.name || a.path || '').localeCompare(String(b.name || b.path || ''), 'pt-BR', { numeric: true });
  }

  function message(text, error = false) { $('.un-status').textContent = text; $('.un-status').classList.toggle('un-error', error); }
  async function task(fn) { if (state.pending || state.busy) return; state.pending = true; view.classList.add('un-pending'); try { return await fn(); } catch (error) { message(error.message, true); } finally { state.pending = false; view.classList.remove('un-pending'); } }
  async function refresh(automatic = false) {
    sizeGeneration++; clearTimeout(sizePaintTimer);
    if (!automatic) iconCache.clear();
    if (!automatic) message('Lendo os registros de instalação…');
    const result = await api.list(false, !automatic); let storeError = '';
    let items = [...result.items];
    try { const store = await api.list(true); items.push(...store.items); }
    catch (error) {
      storeError = ` · pacotes MSIX: ${error.message}`;
      if (automatic) items.push(...state.programs.filter(p => p.type === 'MSIX/AppX'));
    }
    const currentId = automatic ? state.current?.id : null;
    state.programs = items;
    state.current = items.find(p => p.id === currentId) || null;
    state.selected = automatic ? new Set([...state.selected].filter(id => items.some(p => p.id === id))) : new Set();
    renderList(); renderDetails();
    message(`${items.length} registros de instalação · informações locais do Windows${automatic ? ' · lista atualizada automaticamente' : ''}${result.warnings?.length ? ' · algumas fontes não puderam ser lidas' : ''}${storeError}`);
    void calculateSizes();
  }
  let automaticTimer, automaticGeneration = 0, followUpIds = [];
  function scheduleAutomaticRefresh(delay = 0, attempt = 0, generation = automaticGeneration) {
    clearTimeout(automaticTimer);
    automaticTimer = setTimeout(async () => {
      if (generation !== automaticGeneration || state.busy) return;
      if (state.pending) { scheduleAutomaticRefresh(250, attempt, generation); return; }
      await task(async () => { await refresh(true); if (state.tab === 'history') await switchTab('history'); });
      if (generation !== automaticGeneration) return;
      followUpIds = followUpIds.filter(id => state.programs.some(p => p.id === id));
      // Some official uninstallers detach a child process. Recheck briefly; never assume removal.
      if (followUpIds.length && attempt < 24) scheduleAutomaticRefresh(5000, attempt + 1, generation);
    }, delay);
  }
  window.addEventListener('focus', () => { if (followUpIds.length && !state.busy) scheduleAutomaticRefresh(); });
  function filtered() {
    const query = $('[data-query]').value.toLocaleLowerCase(), filter = $('[data-filter]').value, sort = $('[data-sort]').value;
    const rows = state.programs.filter(p => ($('[data-system]').checked || !p.protected) && `${p.name} ${p.publisher} ${p.version}`.toLocaleLowerCase().includes(query) && (filter === 'all' || filter === 'desktop' && p.type !== 'MSIX/AppX' || filter === 'store' && p.type === 'MSIX/AppX' || filter === 'broken' && p.broken || filter === 'games' && (p.source?.includes('Steam App ') || /\\steamapps\\common\\/i.test(p.location)) || filter === 'large' && p.size >= 1073741824 || filter === 'recent' && /^\d{8}$/.test(p.date) && Date.now() - Date.parse(`${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}`) <= 30 * 86400000));
    return rows.sort((a, b) => sort === 'size' || sort === 'size-asc' ? compareSize(a, b, sort === 'size-asc') : sort === 'date' ? String(b.date || '').localeCompare(String(a.date || '')) : String(a[sort] || '').localeCompare(String(b[sort] || ''), 'pt-BR', { numeric: true }));
  }
  function renderList() {
    view.querySelectorAll('[data-size-order]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sizeOrder === sizeSort.value)));
    const rows = filtered(); $('.un-list').innerHTML = rows.map(p => `<article class="un-row ${state.current?.id === p.id ? 'active' : ''}" data-id="${esc(p.id)}"><label class="un-select"><input type="checkbox" aria-label="Selecionar ${esc(p.name)}" ${state.selected.has(p.id) ? 'checked' : ''} ${p.protected ? 'disabled' : ''}/></label><button class="un-row-info" type="button"><span class="un-app-icon" aria-hidden="true">${esc(p.name.slice(0, 1))}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.publisher || 'Fabricante não informado')} ${p.version ? '· ' + esc(p.version) : ''}</small>${p.broken ? `<small class="un-warning">${esc(p.issue)}</small>` : ''}${p.protected ? '<small class="un-warning">Componente protegido</small>' : ''}</span></button><span class="un-row-meta"><span>${bytes(p.size)}</span><small>${date(p.date)}</small></span></article>`).join('') || '<p class="un-empty">Nenhum programa corresponde aos filtros.</p>';
    $('.un-list').querySelectorAll('.un-row').forEach(row => { const p = state.programs.find(p => p.id === row.dataset.id); const size = row.querySelector('.un-row-meta > span'); size.textContent = programSize(p); size.title = sizeExplanation(p); row.querySelector('input').onchange = event => { event.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id); selection(); }; row.querySelector('button').onclick = () => { state.current = p; renderList(); renderDetails(); }; }); selection();
    iconObserver?.disconnect(); iconObserver = new IntersectionObserver(entries => entries.forEach(entry => { if (!entry.isIntersecting) return; iconObserver.unobserve(entry.target); const row = entry.target, id = row.dataset.id; if (!iconCache.has(id)) iconCache.set(id, api.icon(id).catch(() => '')); iconCache.get(id).then(url => { if (url.startsWith('data:image/') && row.isConnected) { const image = document.createElement('img'); image.src = url; image.alt = ''; row.querySelector('.un-app-icon').replaceChildren(image); } }); }), { root: $('.un-list'), rootMargin: '60px' }); $('.un-list').querySelectorAll('.un-row').forEach(row => iconObserver.observe(row));
  }
  function selection() { $('[data-selection]').textContent = `${state.selected.size} selecionados`; $('[data-action="uninstall"]').disabled = !state.selected.size || state.busy; }
  function renderDetails() {
    const p = state.current, host = $('.un-details'); if (!p) { host.innerHTML = '<p>Selecione um programa para ver os detalhes e analisar a instalação.</p>'; return; }
    host.innerHTML = `<div class="un-heading"><h2>${esc(p.name)}</h2><span class="un-badge">${esc(p.type)}</span></div><dl>${[['Fabricante', p.publisher], ['Versão', p.version], ['Pasta', p.location], ['Arquitetura', p.architecture], ['Data registrada', date(p.date)], ['Tamanho informado', bytes(p.size)]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || 'Não informado')}</dd>`).join('')}</dl>${p.issue ? `<p class="un-warning">${esc(p.issue)}</p>` : ''}<div class="un-actions"><button class="primary-button" data-detail="uninstall" type="button" ${p.protected ? 'disabled' : ''}>Desinstalar</button><button class="outline-button" data-detail="analyze" type="button">Analisar instalação</button>${p.location ? '<button class="outline-button" data-detail="reveal" type="button">Abrir localização</button>' : ''}</div><details><summary>Dados técnicos e opções avançadas</summary><dl><dt>Origem</dt><dd>${esc(p.source)}</dd><dt>Comando registrado</dt><dd>${esc(p.command || p.package || 'Não registrado')}</dd><dt>ProductCode</dt><dd>${esc(p.productCode || 'Não aplicável')}</dd><dt>Website registrado</dt><dd>${esc(p.website || 'Não informado')}</dd></dl><p>A data registrada pelo Windows pode refletir instalação ou manutenção. Tamanho desconhecido permanece sem estimativa.</p><div class="un-actions"><button class="outline-button" data-detail="deep" type="button">Análise profunda</button><button class="outline-button" data-detail="forced" type="button" ${p.protected ? 'disabled' : ''}>Análise forçada…</button><button class="outline-button" data-detail="processes" type="button">Ver processos</button></div></details>`;
    const advanced = host.querySelector('details .un-actions'); advanced.insertAdjacentHTML('beforeend', `<button class="outline-button" data-detail="estimate" type="button">Estimar tamanho</button><button class="outline-button" data-detail="metadata" type="button" ${p.type === 'MSIX/AppX' ? 'disabled' : ''}>Ver assinatura do desinstalador</button>`); advanced.insertAdjacentHTML('afterend', '<div class="un-extra" role="status"></div>');
    host.querySelectorAll('[data-detail]').forEach(button => button.onclick = () => task(async () => { const action = button.dataset.detail; if (action === 'uninstall') return startQueue([p.id]); if (action === 'reveal') return api.reveal(p.id); if (action === 'estimate') { const result = await api.estimate(p.id); host.querySelector('.un-extra').textContent = result.bytes == null ? 'Sem pasta exclusiva para estimar o tamanho com segurança.' : `${bytes(result.bytes)} · estimativa da pasta exclusiva${result.partial ? ' · medição parcial' : ''}. Não substitui o tamanho informado pelo instalador.`; return; } if (action === 'metadata') { const result = await api.metadata(p.id); host.querySelector('.un-extra').textContent = `${result.role}: ${result.path} · assinatura: ${result.signature.status} · assinante: ${result.signature.signer || 'não informado'} · fabricante do arquivo: ${result.company || 'não informado'}. A validação não consulta serviços online e não prova propriedade das sobras.`; return; } if (action === 'processes') { const processes = await api.processes(p.id); message(processes.length ? processes.map(p => `${p.name} (${p.pid}) · ${p.path}`).join(' | ') : 'Nenhum processo identificado pelo caminho exclusivo.'); return; } const scan = await api.analyze(p.id, action !== 'analyze' || $('[data-scan-mode]').value === 'deep', action === 'forced'); if (!scan.canceled) showScan(scan); }));
    host.querySelector('dl dt:last-of-type').textContent = 'Tamanho da instalação';
    const sizeValue = host.querySelector('dl dd:last-of-type'); sizeValue.textContent = programSize(p); sizeValue.title = sizeExplanation(p);
    host.querySelector('details > p').textContent = 'O tamanho é verificado automaticamente pela pasta da instalação. O tooltip identifica a origem e eventuais limitações da leitura. A data registrada pelo Windows pode refletir instalação ou manutenção.';
    const recalculate = host.querySelector('[data-detail="estimate"]'); recalculate.textContent = 'Recalcular tamanho';
    recalculate.onclick = () => task(async () => {
      const result = api.size ? await api.size(p.id, true) : await api.estimate(p.id);
      if (result.canceled) return;
      Object.assign(p, { size: result.bytes, sizePartial: !!result.partial, sizeSource: result.source || 'Medição da pasta de instalação', sizeRoot: result.root, sizeReason: result.reason, sizeStatus: result.status || (result.bytes == null ? 'unavailable' : 'complete') });
      renderList(); sizeValue.textContent = programSize(p); sizeValue.title = sizeExplanation(p);
      host.querySelector('.un-extra').textContent = `${programSize(p)} · ${sizeExplanation(p)}`;
    });
  }
  function showScan(scan) {
    if (!$('[data-auto-select]').checked) scan = { ...scan, items: scan.items.map(item => ({ ...item, selected: false })) };
    state.scan = scan; const host = $('.un-review'); host.classList.remove('hidden');
    const groups = new Map(); for (const item of scan.items) { const name = item.personal ? 'Dados pessoais · revisão explícita' : item.category; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(item); }
    host.innerHTML = `<div class="un-heading"><div><span class="eyebrow">REVISÃO DE SOBRAS</span><h2>${esc(scan.program.name)}</h2><p>${scan.items.length} candidatos · ${scan.mode === 'deep' ? 'análise profunda' : 'análise normal'}</p></div><button class="outline-button" data-review-close type="button">Fechar revisão</button></div>${scan.warnings.map(w => `<p class="un-warning">${esc(w)}</p>`).join('')}<p>Confira os motivos de cada item. Dados pessoais exigem seleção individual. Itens protegidos ou de baixa confiança são preservados.</p>${Array.from(groups, ([category, items]) => `<details class="un-group" open><summary>${esc(category)} <small>${items.length} itens · ${bytes(items.reduce((s, c) => s + (c.size || 0), 0))}</small></summary>${items.map(item => `<div class="un-candidate"><label class="un-check"><input type="checkbox" data-candidate="${item.id}" ${item.selected ? 'checked' : ''} ${item.eligible ? '' : 'disabled'}/><span><strong>${esc(item.path)}</strong><small>${item.size == null ? esc(item.category) : bytes(item.size)} ${!item.eligible ? '· Preservado' : ''}</small></span></label><span class="un-confidence ${item.confidence}">${confidence(item.confidence)}</span><details><summary>Por que foi encontrado?</summary><p>${item.reasons.map(esc).join('<br/>')}</p>${item.personal ? '<p class="un-warning">Pode conter configurações, saves, projetos ou outros dados pessoais.</p>' : ''}</details></div>`).join('')}</details>`).join('')}<div class="un-review-footer"><span data-review-count></span><div class="un-actions"><button class="outline-button" data-clear-review type="button">Desmarcar todos</button><button class="primary-button" data-clean type="button">Remover selecionados…</button></div></div>`;
    host.querySelector('.un-heading').insertAdjacentHTML('afterend', '<div class="un-review-order"><label for="un-review-sort">Ordenar itens em cada categoria</label><select id="un-review-sort" data-review-sort><option value="original">Ordem da análise</option><option value="size">Mais pesados primeiro</option><option value="size-asc">Mais leves primeiro</option></select></div>');
    const originalOrder = new Map(scan.items.map((item, index) => [item.id, index]));
    const candidates = new Map(scan.items.map(item => [String(item.id), item]));
    host.querySelector('[data-review-sort]').onchange = event => {
      const order = event.target.value;
      host.querySelectorAll('.un-group').forEach(group => {
        const rows = Array.from(group.children).filter(row => row.classList.contains('un-candidate'));
        rows.sort((a, b) => {
          const left = a.querySelector('[data-candidate]').dataset.candidate, right = b.querySelector('[data-candidate]').dataset.candidate;
          return order === 'original' ? originalOrder.get(left) - originalOrder.get(right) : compareSize(candidates.get(left), candidates.get(right), order === 'size-asc');
        });
        rows.forEach(row => group.append(row));
      });
    };
    const updateCount = () => { const selected = Array.from(host.querySelectorAll('[data-candidate]:checked')); const selectedBytes = selected.reduce((s, check) => s + (scan.items.find(i => i.id === check.dataset.candidate)?.size || 0), 0); $('[data-review-count]').textContent = `${selected.length} selecionados · ${bytes(selectedBytes)} conhecidos`; $('[data-clean]').disabled = !selected.length || state.busy; };
    host.querySelectorAll('[data-candidate]').forEach(check => check.onchange = updateCount); host.querySelector('[data-review-close]').onclick = () => host.classList.add('hidden'); host.querySelector('[data-clear-review]').onclick = () => { host.querySelectorAll('[data-candidate]').forEach(check => check.checked = false); updateCount(); };
    host.querySelectorAll('[data-candidate]').forEach(check => { const item = scan.items.find(item => item.id === check.dataset.candidate); if (Object.keys(item.metadata || {}).length) check.closest('.un-candidate').querySelector('details').insertAdjacentHTML('beforeend', `<pre class="un-resource-metadata">${esc(JSON.stringify(item.metadata, null, 2))}</pre>`); });
    host.querySelector('[data-clean]').onclick = () => task(async () => { const ids = Array.from(host.querySelectorAll('[data-candidate]:checked')).map(check => check.dataset.candidate); const result = await api.clean(scan.id, ids); if (result.canceled) return; const removed = result.records.filter(r => r.status === 'removed').length; message(`${removed} itens removidos · ${bytes(result.bytes)} em quarentena${result.records.some(r => r.status === 'preserved') ? ' · houve itens preservados; consulte o histórico' : ''}`); host.classList.add('hidden'); await switchTab('history'); });
    updateCount(); host.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  function processChoice(processes) { const dialog = $('.un-process-dialog'); $('.un-process-names').textContent = processes.map(p => `${p.name} · PID ${p.pid}`).join('\n'); dialog.showModal(); return new Promise(resolve => { const close = () => resolve('cancel'); dialog.addEventListener('cancel', close, { once: true }); dialog.querySelectorAll('[data-process]').forEach(button => button.onclick = () => { dialog.removeEventListener('cancel', close); dialog.close(); resolve(button.dataset.process); }); }); }
  async function startQueue(ids) {
    for (const id of ids) { const processes = await api.processes(id); if (processes.length) { const answer = await processChoice(processes); if (answer === 'cancel') return; if (answer === 'close') { const result = await api.closeProcesses(id, false); if (result.canceled) return; if (Array.isArray(result) && result.some(p => !p.closed)) { message('Alguns processos continuam abertos; o desinstalador oficial cuidará deles.'); } } } }
    const job = await api.queue(ids, $('[data-quiet]').checked, $('[data-restorepoint]').checked); if (!job.canceled) renderJob(job);
  }
  function renderJob(job) { if (!job) return; const wasBusy = state.busy; state.job = job; state.busy = job.busy; const host = $('.un-job'); host.classList.remove('hidden'); host.innerHTML = `<div class="un-heading"><strong>${esc(job.stage)} ${job.name ? '· ' + esc(job.name) : ''}</strong><span>${job.index}/${job.total}</span></div>${job.results.map((r, i) => `<div class="un-result"><span>${esc(r.name)} · ${esc(r.error || r.message || (r.removed ? 'Pacote removido' : 'Concluído'))}${r.rebootRequired ? ' · Reinicialização necessária' : ''}</span>${r.scan ? `<button class="outline-button" data-job-scan="${i}" type="button">Revisar sobras</button>` : ''}</div>`).join('')}${job.busy ? '<button class="outline-button" data-cancel-job type="button">Interromper fila após o programa atual</button>' : ''}`; host.querySelector('[data-cancel-job]')?.addEventListener('click', () => api.cancel()); host.querySelectorAll('[data-job-scan]').forEach(button => button.onclick = () => showScan(job.results[Number(button.dataset.jobScan)].scan)); selection();
    if (job.busy) { clearTimeout(automaticTimer); automaticGeneration++; sizeGeneration++; clearTimeout(sizePaintTimer); $('.un-size-status').textContent = 'Medição pausada durante a desinstalação'; }
    if (wasBusy && !job.busy) { followUpIds = job.results.filter(r => r.stillRegistered).map(r => r.id); scheduleAutomaticRefresh(); }
  }
  async function switchTab(tab) {
    state.tab = tab; view.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab)); $('.un-programs').classList.toggle('hidden', tab !== 'programs'); $('.un-other').classList.toggle('hidden', tab === 'programs'); const host = $('.un-other');
    if (tab === 'history') { const items = await api.history(); const total = items.reduce((sum, h) => sum + (h.restored ? 0 : h.bytes || 0), 0); host.innerHTML = `<div class="un-heading"><h2>Histórico e quarentena</h2><span>${bytes(total)} registrados em backups</span></div><p>Restaurar sobras recupera os itens disponíveis. O programa original precisa ser reinstalado separadamente. Backups ficam preservados até você excluí-los.</p>${items.map(h => `<article class="un-history"><header><strong>${esc(h.name)}</strong><small>${date(h.date)}</small></header><p>${bytes(h.bytes)} movidos · ${h.records.filter(r => r.status === 'removed').length} itens ainda em backup</p><details><summary>Ver resultado e itens preservados</summary>${h.result ? `<p>${esc(h.result.message || JSON.stringify(h.result))}</p>` : ''}${h.records.map(r => `<p>${esc(r.path)} · ${esc(r.status)}${r.error ? ' · ' + esc(r.error) : ''}</p>`).join('')}</details><div class="un-actions">${h.backupAvailable ? `<button class="outline-button" data-history="restore" data-id="${h.id}" type="button">Restaurar sobras</button>` : ''}<button class="outline-button" data-history="analyze" data-id="${h.id}" type="button">Procurar sobras deste programa</button><button class="outline-button" data-history="purge" data-id="${h.id}" type="button">Excluir ${h.backupAvailable ? 'backup' : 'registro'}</button></div></article>`).join('') || '<p class="un-empty">Nenhuma operação registrada.</p>'}`; host.querySelectorAll('[data-history]').forEach(button => button.onclick = () => task(async () => { if (button.dataset.history === 'analyze') { showScan(await api.historyAnalyze(button.dataset.id)); return; } await api[button.dataset.history](button.dataset.id); await switchTab('history'); })); }
    if (tab === 'history') { host.querySelectorAll('.un-history').forEach((row, index) => { const buttons = row.querySelector('.un-actions'); const id = buttons.querySelector('[data-id]').dataset.id; const button = document.createElement('button'); button.type = 'button'; button.className = 'outline-button'; button.textContent = 'Exportar relatório'; button.onclick = () => task(async () => { const result = await api.export(id); if (!result.canceled) message('Relatório salvo no local escolhido.'); }); buttons.append(button); }); host.querySelectorAll('details p').forEach(p => { p.textContent = p.textContent.replace(/ · (removed|preserved|restored|planned)(?= ·|$)/g, (_all, value) => ` · ${status(value)}`); }); }
    if (tab === 'history') {
      const empty = !host.querySelector('.un-history');
      host.querySelector('.un-heading').insertAdjacentHTML('afterend', `<div class="un-history-tools"><button class="outline-button" data-clear-history type="button" ${empty || state.busy ? 'disabled' : ''}>Limpar histórico…</button><span>Backups são preservados por padrão.</span></div>`);
      host.querySelector('[data-clear-history]').onclick = () => task(async () => {
        const result = await api.clearHistory(); if (result.canceled) return;
        await switchTab('history');
        message(`${result.deleted} registros apagados · ${result.retained} preservados${result.errors.length ? ' · ' + result.errors.join(' | ') : ''}`, !!result.errors.length);
      });
    }
    if (tab === 'tracked') { const items = await api.tracked(); host.innerHTML = `<h2>Instalações monitoradas</h2><p>O registro compara snapshots. Diferenças não recebem alta confiança apenas por ocorrerem durante a instalação. O monitoramento não identifica a autoria por processo.</p>${items.map(item => `<article class="un-history"><strong>${esc(item.installer)}</strong><p>${date(item.date)} · ${item.programs.length} novos registros · ${item.changes.length} diferenças de arquivos · ${(item.resourceChanges || []).length} diferenças de recursos</p><details><summary>Ver diferenças</summary>${[...item.changes, ...(item.resourceChanges || [])].slice(0, 300).map(c => `<p>${esc(c.path)} · ${status(c.change)} · confiança ${confidence(c.confidence)}<br/>${esc(c.reason)}</p>`).join('')}${item.changes.length + (item.resourceChanges || []).length > 300 ? '<p>Prévia limitada a 300 itens; o log completo permanece armazenado localmente.</p>' : ''}</details></article>`).join('') || '<p class="un-empty">Nenhuma instalação monitorada. Inicie uma em Recursos avançados.</p>'}`; }
  }
  function identified(result) { $('.un-identify').innerHTML = `<p>${esc(result.path || '')}</p>${result.matches.length ? result.matches.map(id => `<button class="outline-button" data-match="${esc(id)}" type="button">${esc(state.programs.find(p => p.id === id)?.name || id)}</button>`).join('') : '<p>Nenhuma instalação registrada corresponde ao caminho. Se necessário, escolha a pasta como alvo manual.</p>'}`; $('.un-identify').querySelectorAll('[data-match]').forEach(button => button.onclick = () => { state.current = state.programs.find(p => p.id === button.dataset.match); switchTab('programs'); renderList(); renderDetails(); $('.un-details').scrollIntoView({ block: 'start' }); }); }
  view.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => task(() => switchTab(button.dataset.tab)));
  $('[data-query]').oninput = renderList; $('[data-filter]').onchange = renderList; $('[data-sort]').onchange = renderList; $('[data-system]').onchange = () => { renderList(); void calculateSizes(); };
  view.querySelectorAll('[data-action]').forEach(button => button.onclick = () => task(async () => {
    switch (button.dataset.action) {
      case 'refresh': await refresh(); break;
      case 'uninstall': await startQueue([...state.selected]); break;
      case 'identify': { const result = await api.choose('file'); if (!result.canceled) identified(result); break; }
      case 'hunter': { message('Posicione o mouse sobre uma janela do programa. O alvo será identificado em 5 segundos.'); identified(await api.hunter()); break; }
      case 'forced-folder': { const choice = await api.choose('folder'); if (choice.canceled) break; const scan = await api.forcedPath(choice.path, true); if (!scan.canceled) showScan(scan); break; }
      case 'monitor-start': { const choice = await api.choose('installer'); if (choice.canceled) break; state.monitor = await api.monitorStart(choice.id); if (!state.monitor.canceled) { $('[data-action="monitor-finish"]').disabled = false; $('.un-monitor-status').textContent = `Monitorando ${choice.path}. Termine a instalação e então conclua o monitoramento.`; } break; }
      case 'monitor-finish': { const result = await api.monitorFinish(state.monitor.id); $('.un-monitor-status').textContent = `${result.programs.length} novos registros · ${result.changes.length} diferenças · log local salvo`; state.monitor = null; $('[data-action="monitor-finish"]').disabled = true; await switchTab('tracked'); break; }
      case 'snapshot': { const result = await api.snapshot(); message(`Snapshot criado: ${date(result.created)}. ${result.warnings.join(' ')}`); break; }
      case 'snapshots': { state.snapshots = await api.snapshots(); $('.un-snapshots').innerHTML = `<label>Antes<select data-before>${state.snapshots.map(s => `<option value="${s.id}">${date(s.created)}</option>`).join('')}</select></label><label>Depois<select data-after>${state.snapshots.map(s => `<option value="${s.id}">${date(s.created)}</option>`).join('')}</select></label><button class="outline-button" data-compare type="button">Comparar</button><div class="un-diff"></div>`; $('[data-compare]').onclick = () => task(async () => { const result = await api.compare($('[data-before]').value, $('[data-after]').value); $('.un-diff').textContent = `${result.programs.length} novos registros · ${result.changes.length} diferenças. ${result.warnings.join(' ')}`; }); break; }
      case 'restore-point': { const result = await api.restorePoint(); if (!result.canceled) message(`Ponto de restauração criado · sequência ${result.sequence}`); break; }
      case 'elevate': { const result = await api.elevate(); state.scan = null; $('.un-review').classList.add('hidden'); state.programs = result.items; state.current = null; state.selected.clear(); renderList(); renderDetails(); void calculateSizes(); message('Operações de sistema autorizadas. Os backups dessas operações ficam em uma pasta protegida do Windows.'); break; }
    }
  }));
  view.addEventListener('dragover', event => { event.preventDefault(); view.classList.add('un-drop-active'); }); view.addEventListener('dragleave', event => { if (!view.contains(event.relatedTarget)) view.classList.remove('un-drop-active'); }); view.addEventListener('drop', event => { event.preventDefault(); view.classList.remove('un-drop-active'); const file = event.dataTransfer.files[0]; if (file) task(async () => identified(await api.identify(window.ntc.pathForFile(file)))); });
  api.onEvent(renderJob);
  window.NTCUninstaller = { open: async () => { const job = await api.status(); if (job) renderJob(job); if (!state.programs.length && !state.busy) await task(refresh); }, close: () => {} };
})();
