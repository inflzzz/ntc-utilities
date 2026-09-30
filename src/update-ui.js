(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createNTCUpdateUi = factory;
})(typeof window === 'object' ? window : globalThis, function ({ document, history, storage, releases, showToast, getVersion, timers = globalThis }) {
  const $ = id => document.getElementById(id), key = 'ntc-last-seen-changelog-version', gate = history.createNoticeGate();
  let latest = null, acknowledgeVersion = '', returnFocus = null;
  function open(options = {}) {
    returnFocus = document.activeElement; acknowledgeVersion = options.acknowledge || '';
    const entries = history.normalize(options.entries || releases);
    $('changelogTitle').textContent = options.title || 'Histórico de versões';
    $('changelogSummary').textContent = options.summary || 'Novidades e melhorias, organizadas por versão.';
    $('changelogList').replaceChildren(...entries.map(entry => {
      const article = document.createElement('article'); article.className = 'changelog-entry';
      const heading = document.createElement('div'); heading.className = 'changelog-entry-heading';
      const title = document.createElement('h3'); title.textContent = `v${entry.version}`;
      const date = document.createElement('time'); date.textContent = entry.date; heading.append(title, date);
      const list = document.createElement('ul'); entry.changes.forEach(change => { const line = document.createElement('li'); line.textContent = change; list.append(line); });
      article.append(heading, list); return article;
    }));
    $('changelogList').scrollTop = 0; $('changelogDialog').classList.remove('hidden'); $('closeChangelog').focus();
  }
  function close() {
    $('changelogDialog').classList.add('hidden');
    if (acknowledgeVersion) storage.setItem(key, acknowledgeVersion);
    acknowledgeVersion = ''; returnFocus?.focus?.();
  }
  function afterUpgrade(version, hadData) {
    const previous = storage.getItem(key);
    if ((!previous && !hadData) || previous === version || (history.valid(previous) && history.compare(previous, version) >= 0)) { storage.setItem(key, version); return; }
    const entries = history.between(releases, previous, version);
    timers.setTimeout(() => open({ entries, title: 'Seu NTC foi atualizado', summary: `${history.valid(previous) ? `v${previous} → ` : ''}v${version} · ${entries.length} ${entries.length === 1 ? 'versão com novidades' : 'versões com novidades'}.`, acknowledge: version }), 2500);
  }
  function show(update) {
    const status = update?.status || 'idle', statusText = $('updateStatus');
    if (status === 'checking') { statusText.textContent = 'Verificando atualizações…'; return; }
    if (status === 'unavailable') { statusText.textContent = update.message || 'A verificação funciona na versão instalada.'; return; }
    if (status === 'current') { statusText.textContent = `Você está usando a versão mais recente (v${update.version}).`; if (update.manual) showToast('O NTC Utilities está atualizado.'); return; }
    if (status === 'error') { statusText.textContent = update.message || 'Não foi possível verificar atualizações.'; if (update.manual) showToast(statusText.textContent); return; }
    if (!['available', 'downloading', 'downloaded'].includes(status)) return;
    latest = update;
    const current = update.currentVersion || getVersion(), entries = history.between(update.releases || history.fromNotes(update.notes, update.version), current, update.version);
    const downloaded = status === 'downloaded', downloading = status === 'downloading', version = `v${update.version}`;
    statusText.textContent = update.message || (downloaded ? `${version} está pronta para instalar.` : downloading ? `Baixando ${version}… ${update.percent || 0}%` : `${version} está disponível.`);
    $('updateTitle').textContent = downloaded ? 'Atualização pronta para instalar' : 'Uma nova versão está disponível';
    $('updateSummary').textContent = `v${current} → ${version}${entries.length ? ` · Novidades de ${entries.length} ${entries.length === 1 ? 'versão' : 'versões'}.` : '.'}${downloaded ? ' Reinicie quando for conveniente.' : ''}`;
    // A short preview is paired with the complete, grouped history; no notes are discarded.
    const preview = entries.flatMap(entry => entry.changes.map(change => `v${entry.version} · ${change}`)).slice(0, 2);
    $('updateNotes').replaceChildren(...preview.map(note => { const line = document.createElement('li'); line.textContent = note; return line; }));
    $('updateNotes').classList.toggle('hidden', !preview.length);
    $('viewUpdateChangelog').classList.toggle('hidden', !entries.length);
    const action = $('updateAction'); action.disabled = downloading; action.textContent = downloaded ? 'Instalar e reiniciar' : downloading ? `Baixando ${update.percent || 0}%` : 'Baixar atualização'; action.dataset.updateStatus = status;
    if (gate.shouldShow(update)) $('updateNotice').classList.remove('hidden');
  }
  $('viewUpdateChangelog').onclick = () => {
    if (!latest) return;
    const current = latest.currentVersion || getVersion();
    open({ title: 'Novidades desta atualização', summary: `v${current} → v${latest.version} · Todas as novidades desde sua versão.`, entries: history.between(latest.releases || history.fromNotes(latest.notes, latest.version), current, latest.version) });
  };
  $('changelogDialog').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...$('changelogDialog').querySelectorAll('button, [tabindex="0"]')];
    if (focusable.length === 1) { event.preventDefault(); focusable[0].focus(); }
  });
  return { show, open, close, afterUpgrade, dismiss() { if (latest) gate.dismiss(latest); $('updateNotice').classList.add('hidden'); } };
});
