(() => {
  const root = document.getElementById('screenLightView');
  if (!root || !window.ntc?.screenLight) return;
  const api = window.ntc.screenLight;
  const builtins = [
    ['day', 'Dia'], ['night', 'Noite'], ['dawn', 'Madrugada'], ['reading', 'Leitura'],
    ['film', 'Filme'], ['games', 'Jogos'], ['work', 'Trabalho'], ['darkroom', 'Darkroom']
  ];
  const shortcutActions = [
    ['toggle', 'Ligar/desligar'], ['warmer', 'Mais quente'], ['cooler', 'Mais neutro'],
    ['intensityUp', 'Aumentar intensidade'], ['intensityDown', 'Diminuir intensidade'],
    ['night', 'Perfil Noite'], ['pauseHour', 'Pausar 1 hora']
  ];
  let state = null;
  let open = false;
  let lastStructure = '';
  let busy = false;
  let message = '';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const fromTime = value => { const [h, m] = String(value).split(':').map(Number); return Number.isInteger(h) && Number.isInteger(m) ? Math.min(1435, Math.max(0, Math.round((h * 60 + m) / 5) * 5)) : 0; };
  const statusText = value => {
    if (!value) return 'Carregando estado…';
    if (value.status === 'active') return `Ajuste aplicado · ${value.applied?.kelvin || value.target?.kelvin} K${value.limitation ? ` · ${value.limitation}` : ''}`;
    if (value.status === 'hdr-blocked') return value.error || 'HDR/cor avançada ativa — ajuste seguro indisponível neste monitor.';
    if (value.status === 'unsupported') return 'Nenhum monitor compatível com a rampa de cor do Windows.';
    if (value.status === 'disabled') return 'Desativada · aparência original preservada.';
    if (value.status === 'paused') return 'Pausada · aparência original restaurada.';
    if (value.status === 'exception') return 'Pausada por regra do aplicativo em primeiro plano.';
    if (value.status === 'fullscreen') return 'Pausada em tela cheia.';
    return value.error || 'Não foi possível aplicar o ajuste.';
  };
  const warmth = kelvin => kelvin >= 6000 ? 'Neutro / luz do dia' : kelvin >= 4100 ? 'Levemente quente' : kelvin >= 2700 ? 'Quente' : 'Muito quente';
  const monitorStatus = item => item.hdr === 1 ? 'HDR ativo — bloqueado' : item.hdr === 2 ? 'SDR com gerenciamento de cor/gama ampla — bloqueado' : item.hdr === 3 ? 'Cor avançada ativa — bloqueado' : item.hdr === -1 ? 'Estado da cor desconhecido — bloqueado' : item.gamma ? 'SDR · ajuste disponível' : 'Gamma indisponível';
  function structureKey(value) { return JSON.stringify({ settings: value?.settings, monitors: value?.monitors }); }
  function updateLive() {
    const status = root.querySelector('[data-live-status]');
    if (status) status.textContent = statusText(state);
    const current = root.querySelector('[data-current-kelvin]');
    if (current) current.textContent = state?.applied?.kelvin ? `${state.applied.kelvin} K` : 'Sem ajuste';
    const next = root.querySelector('[data-next-point]');
    if (next) next.textContent = state?.settings?.mode === 'automatic' ? `Próximo ponto: ${state.nextPoint?.kelvin} K às ${time(state.nextPoint?.minute || 0)}` : 'Controle manual ou perfil ativo';
    const now = root.querySelector('[data-now-marker]');
    if (now) { const date = new Date(); now.style.left = `${(date.getHours() * 60 + date.getMinutes()) / 1440 * 100}%`; }
  }
  function render() {
    if (!state) return;
    const expanded = root.querySelector('.sl-advanced')?.open || false;
    const s = state.settings;
    const profiles = [...builtins, ...s.customProfiles.map(item => [item.id, item.name])];
    const profileOptions = profiles.map(([id, name]) => `<option value="${escape(id)}" ${s.profileId === id ? 'selected' : ''}>${escape(name)}</option>`).join('');
    const bars = s.timeline.map((point, index) => `<button class="sl-point" type="button" style="left:${point.minute / 1440 * 100}%;--point-color:${point.kelvin >= 5500 ? '#eee5de' : point.kelvin >= 3500 ? '#efbd83' : '#ec886a'}" data-drag-point="${index}" aria-label="Arrastar ponto ${index + 1}, ${time(point.minute)}, ${point.kelvin} K" title="${time(point.minute)} · ${point.kelvin} K"></button>`).join('');
    root.innerHTML = `
      <div class="hero compact"><div class="eyebrow">SISTEMA / TELA</div><h1>Luz da Tela</h1><p>Ajuste local de temperatura de cor no Windows, sem sobrepor janelas à tela.</p></div>
      <section class="sl-card sl-hero"><div class="sl-hero-top"><div><span class="sl-kicker">TEMPERATURA ATUAL</span><strong data-current-kelvin>— K</strong><span class="sl-muted" data-live-status role="status">Carregando…</span></div><label class="sl-toggle"><input type="checkbox" data-setting="enabled" ${s.enabled ? 'checked' : ''}><span>${s.enabled ? 'Ligada' : 'Desligada'}</span></label></div>${state.error ? `<p class="sl-warning">${escape(state.error)}</p>` : ''}
        <div class="sl-mode" role="group" aria-label="Modo"><button type="button" data-mode="automatic" class="${s.mode === 'automatic' ? 'active' : ''}">Automático</button><button type="button" data-mode="manual" class="${s.mode === 'manual' ? 'active' : ''}">Manual</button><button type="button" data-mode="profile" class="${s.mode === 'profile' ? 'active' : ''}">Perfil</button></div>
        <div class="sl-controls"><label>Temperatura <strong data-temperature-value>${s.manualKelvin} K</strong><input type="range" min="1200" max="6500" step="100" value="${s.manualKelvin}" data-range="manualKelvin"><small>${warmth(s.manualKelvin)} · 6500 K é o ajuste neutro.</small></label><label>Intensidade <strong data-intensity-value>${s.intensity}%</strong><input type="range" min="0" max="100" step="5" value="${s.intensity}" data-range="intensity"><small>Mistura o efeito com a aparência original.</small></label><label>Redução por software <strong data-dim-value>${s.dim}%</strong><input type="range" min="0" max="50" step="5" value="${s.dim}" data-range="dim"><small>Não altera o brilho físico do monitor. Limitada a 50% por segurança.</small></label></div>
      </section>
      <section class="sl-card"><div class="sl-section-head"><div><span class="sl-kicker">HOJE</span><h2>Timeline de 24 horas</h2></div><span class="sl-muted" data-next-point></span></div><div class="sl-ruler"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><div class="sl-timeline" data-timeline>${bars}<span class="sl-now" data-now-marker aria-label="Horário atual"></span></div><div class="sl-points">${s.timeline.map((point, index) => `<div class="sl-point-row"><span>Ponto ${index + 1}</span><input type="time" step="300" value="${time(point.minute)}" data-point-time="${index}" aria-label="Horário do ponto ${index + 1}"><input type="number" min="1200" max="6500" step="100" value="${point.kelvin}" data-point-kelvin="${index}" aria-label="Temperatura do ponto ${index + 1}"><span>K</span><button type="button" class="outline-button" data-remove-point="${index}" ${s.timeline.length <= 2 ? 'disabled' : ''} aria-label="Remover ponto ${index + 1}">×</button></div>`).join('')}</div><div class="sl-action-row"><button type="button" class="outline-button" data-action="add-point">+ Adicionar ponto</button><span class="sl-muted">Arraste os pontos para mudar o horário. A transição entre eles é gradual.</span></div>${s.solar.enabled ? '<p class="sl-note">O horário solar está ativo; a timeline personalizada fica guardada para quando ele for desligado.</p>' : ''}</section>
      <section class="sl-card"><div class="sl-section-head"><div><span class="sl-kicker">AJUSTES RÁPIDOS</span><h2>Perfis e transição</h2></div></div><div class="sl-grid"><label>Perfil<select data-setting="profileId">${profileOptions}</select></label><label>Transição<select data-setting="transitionMs">${[[0,'Instantânea'],[10000,'10 segundos'],[60000,'1 minuto'],[600000,'10 minutos'],[1800000,'30 minutos'],[3600000,'1 hora']].map(([ms,label]) => `<option value="${ms}" ${s.transitionMs === ms ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Pausar temporariamente<select data-pause><option value="">Escolha um período…</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="120">2 horas</option><option value="tomorrow">Até amanhã</option><option value="-1">Até reativar</option></select></label></div>${s.pauseUntil ? `<div class="sl-action-row"><span class="sl-muted">${s.pauseUntil === -1 ? 'Pausada até você reativar' : `Pausada até ${new Date(s.pauseUntil).toLocaleString('pt-BR')}`}</span><button type="button" class="outline-button" data-action="resume">Retomar agora</button></div>` : ''}<div class="sl-profile-actions"><input type="text" data-profile-name maxlength="40" placeholder="Nome do novo perfil" aria-label="Nome do perfil"><button type="button" class="outline-button" data-action="save-profile">Salvar como novo</button><button type="button" class="outline-button" data-action="duplicate-profile">Duplicar</button>${s.profileId.startsWith('custom-') ? '<button type="button" class="outline-button" data-action="rename-profile">Renomear</button><button type="button" class="outline-button" data-action="delete-profile">Excluir</button>' : ''}</div></section>
      <details class="sl-card sl-advanced"><summary>Configurações avançadas</summary><div class="sl-advanced-content"><section><h3>Monitores e HDR</h3><p>Somente monitores SDR com gamma confirmado são ajustados. HDR/cor avançada é bloqueado para evitar cores incorretas.</p><button type="button" class="outline-button" data-action="probe">Verificar monitores</button><div class="sl-monitors">${state.monitors.length ? state.monitors.map(item => `<div class="sl-monitor"><div><strong>${escape(item.name || item.id)}</strong><small>${escape(item.id)} · ${item.hdr === 1 ? 'HDR/cor avançada ativa — bloqueado' : item.hdr === -1 ? 'Estado HDR desconhecido — bloqueado' : item.gamma ? 'SDR · ajuste disponível' : 'Gamma indisponível'}</small></div>${item.hdr === 0 && item.gamma ? `<label><input type="checkbox" data-monitor-enabled="${escape(item.id)}" ${s.monitorOverrides[item.id]?.enabled === false ? '' : 'checked'}> Aplicar</label><label>Kelvin <input type="number" min="1200" max="6500" step="100" value="${s.monitorOverrides[item.id]?.kelvin || state.target.kelvin}" data-monitor-kelvin="${escape(item.id)}"></label>` : ''}</div>`).join('') : '<p class="sl-muted">Clique em Verificar monitores para consultar a capacidade real.</p>'}</div></section>
      <section><h3>Horário solar local</h3><p>Informe sua localização manualmente. O cálculo diário ocorre offline. Em regiões sem nascer/pôr do sol, vale a timeline personalizada.</p><div class="sl-grid"><label>Cidade (referência)<input type="text" data-solar="city" value="${escape(s.solar.city)}" placeholder="Ex.: São Paulo"></label><label>Latitude<input type="number" data-solar="latitude" min="-90" max="90" step="0.0001" value="${s.solar.latitude}"></label><label>Longitude<input type="number" data-solar="longitude" min="-180" max="180" step="0.0001" value="${s.solar.longitude}"></label></div><div class="sl-action-row"><button type="button" class="outline-button" data-action="save-solar">Salvar localização</button><label><input type="checkbox" data-solar-enabled ${s.solar.enabled ? 'checked' : ''} ${s.solar.configured ? '' : 'disabled'}> Usar nascer e pôr do sol</label></div>${state.solar ? `<p class="sl-muted">Nascer ${time(state.solar.sunrise)} · pôr do sol ${time(state.solar.sunset)} (aproximado)</p>` : ''}</section>
      <section><h3>Exceções por aplicativo</h3><p>Uma regra específica tem prioridade sobre a pausa em tela cheia. A detecção usa apenas o aplicativo em primeiro plano.</p><label class="sl-check"><input type="checkbox" data-setting="pauseFullscreen" ${s.pauseFullscreen ? 'checked' : ''}> Pausar em tela cheia (experimental)</label><div class="sl-grid"><label>Executável<input type="text" data-executable placeholder="Programa.exe ou C:\\Caminho\\Programa.exe"></label><label>Ação<select data-exception-profile><option value="off">Desativar Luz da Tela</option>${profiles.map(([id,name]) => `<option value="${escape(id)}">Usar ${escape(name)}</option>`).join('')}</select></label></div><div class="sl-action-row"><button type="button" class="outline-button" data-action="choose-executable">Selecionar .exe</button><button type="button" class="outline-button" data-action="add-exception">Adicionar regra</button></div><div class="sl-exceptions">${s.exceptions.map((rule, index) => `<div><label><input type="checkbox" data-exception-enabled="${index}" ${rule.enabled ? 'checked' : ''}> ${escape(rule.executable)}</label><span>${rule.profileId === 'off' ? 'Desativar' : escape(profiles.find(([id]) => id === rule.profileId)?.[1] || rule.profileId)}</span><button type="button" class="outline-button" data-remove-exception="${index}">Remover</button></div>`).join('')}</div></section>
      <section><h3>Atalhos globais opcionais</h3><p>Use combinações como Ctrl+Alt+L. Se um atalho estiver ocupado, ele não será registrado.</p><div class="sl-shortcuts">${shortcutActions.map(([id,name]) => `<label>${name}<input type="text" data-shortcut="${id}" value="${escape(s.shortcuts[id] || '')}" placeholder="Desativado"></label>`).join('')}</div><button type="button" class="outline-button" data-action="save-shortcuts">Salvar atalhos</button></section>
      <section><h3>Brilho físico e tema do Windows</h3><p>Esta versão não controla o brilho físico do notebook nem DDC/CI e não altera o tema do Windows. A redução disponível acima é feita somente pela rampa de cor, quando suportada.</p></section></div></details>
      ${message ? `<p class="sl-message" role="status">${escape(message)}</p>` : ''}`;
    lastStructure = structureKey(state);
    const advanced = root.querySelector('.sl-advanced');
    if (advanced) advanced.open = expanded;
    [...root.querySelectorAll('.sl-monitor')].forEach((element, index) => { const label = element.querySelector('small'); if (label) label.textContent = `${state.monitors[index].id} · ${monitorStatus(state.monitors[index])}`; });
    const choose = root.querySelector('[data-action="choose-executable"]');
    if (choose) {
      const running = document.createElement('button');
      running.type = 'button';
      running.className = 'outline-button';
      running.dataset.action = 'running-processes';
      running.textContent = 'Escolher em execução';
      choose.after(running);
    }
    if (s.profileId.startsWith('custom-')) {
      const rename = root.querySelector('[data-action="rename-profile"]');
      if (rename) {
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'outline-button';
        save.dataset.action = 'update-profile';
        save.textContent = 'Atualizar perfil';
        rename.before(save);
      }
    }
    if (state.shortcutErrors?.length) {
      const warning = document.createElement('p');
      warning.className = 'sl-warning';
      warning.textContent = state.shortcutErrors.join(' ');
      root.querySelector('[data-action="save-shortcuts"]')?.after(warning);
    }
    const transition = root.querySelector('[data-setting="transitionMs"]');
    if (transition?.parentElement.firstChild) transition.parentElement.firstChild.textContent = 'Transição no automático';
    updateLive();
  }
  async function mutate(patch) {
    if (busy) return;
    busy = true;
    try { state = await api.update(patch); message = ''; render(); }
    catch (error) { message = error.message || String(error); render(); }
    finally { busy = false; }
  }
  async function invoke(action) {
    if (busy) return;
    busy = true;
    try { state = await action(); message = ''; render(); }
    catch (error) { message = error.message || String(error); render(); }
    finally { busy = false; }
  }
  function pointUpdate(index, patch) {
    const timeline = state.settings.timeline.map(point => ({ ...point }));
    timeline[index] = { ...timeline[index], ...patch };
    void mutate({ timeline });
  }
  root.addEventListener('input', event => {
    const input = event.target;
    if (input.matches('[data-range]')) {
      const value = root.querySelector(`[data-${input.dataset.range === 'manualKelvin' ? 'temperature' : input.dataset.range}-value]`);
      if (value) value.textContent = `${input.value}${input.dataset.range === 'manualKelvin' ? ' K' : '%'}`;
    }
  });
  root.addEventListener('change', event => {
    const input = event.target;
    if (input.dataset.range) { const key = input.dataset.range; void mutate({ [key]: Number(input.value), mode: 'manual' }); }
    else if (input.dataset.setting) void mutate({ [input.dataset.setting]: input.type === 'checkbox' ? input.checked : input.dataset.setting === 'transitionMs' ? Number(input.value) : input.value, ...(input.dataset.setting === 'profileId' ? { mode: 'profile' } : {}) });
    else if (input.dataset.pointTime !== undefined) pointUpdate(Number(input.dataset.pointTime), { minute: fromTime(input.value) });
    else if (input.dataset.pointKelvin !== undefined) pointUpdate(Number(input.dataset.pointKelvin), { kelvin: Number(input.value) });
    else if (input.dataset.monitorEnabled) void mutate({ monitorOverrides: { ...state.settings.monitorOverrides, [input.dataset.monitorEnabled]: { ...(state.settings.monitorOverrides[input.dataset.monitorEnabled] || {}), enabled: input.checked } } });
    else if (input.dataset.monitorKelvin) void mutate({ monitorOverrides: { ...state.settings.monitorOverrides, [input.dataset.monitorKelvin]: { enabled: true, kelvin: Number(input.value) } } });
    else if (input.dataset.exceptionEnabled !== undefined) { const exceptions = state.settings.exceptions.map(rule => ({ ...rule })); exceptions[Number(input.dataset.exceptionEnabled)].enabled = input.checked; void mutate({ exceptions }); }
    else if (input.matches('[data-process-select]') && input.value) root.querySelector('[data-executable]').value = input.value;
    else if (input.matches('[data-solar-enabled]')) void mutate({ solar: { ...state.settings.solar, enabled: input.checked } });
    else if (input.matches('[data-pause]') && input.value) {
      const minutes = input.value === 'tomorrow' ? Math.ceil((new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1, 7) - Date.now()) / 60000) : Number(input.value);
      void invoke(() => api.pause(minutes));
    }
  });
  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.mode) return void mutate({ mode: button.dataset.mode });
    if (button.dataset.removePoint !== undefined) return void mutate({ timeline: state.settings.timeline.filter((_, index) => index !== Number(button.dataset.removePoint)) });
    if (button.dataset.removeException !== undefined) return void mutate({ exceptions: state.settings.exceptions.filter((_, index) => index !== Number(button.dataset.removeException)) });
    const action = button.dataset.action;
    if (action === 'add-point') {
      const minute = Math.round((new Date().getHours() * 60 + new Date().getMinutes()) / 5) * 5;
      return void mutate({ timeline: [...state.settings.timeline, { minute: Math.min(1435, minute), kelvin: state.target.kelvin }] });
    }
    if (action === 'resume') return void invoke(() => api.pause(0));
    if (action === 'probe') return void invoke(() => api.probe());
    if (action === 'save-solar') {
      const latitude = Number(root.querySelector('[data-solar="latitude"]').value);
      const longitude = Number(root.querySelector('[data-solar="longitude"]').value);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { message = 'Informe latitude e longitude válidas.'; render(); return; }
      return void mutate({ solar: { enabled: state.settings.solar.enabled, configured: true, latitude, longitude, city: root.querySelector('[data-solar="city"]').value } });
    }
    if (action === 'choose-executable') { const file = await api.chooseExecutable(); if (file) root.querySelector('[data-executable]').value = file; return; }
    if (action === 'running-processes') {
      try {
        const files = await api.runningProcesses();
        const select = document.createElement('select');
        select.dataset.processSelect = '1';
        select.setAttribute('aria-label', 'Programas em execução');
        for (const file of files) { const option = document.createElement('option'); option.value = file; option.textContent = file; select.append(option); }
        button.after(select);
        if (files.length) root.querySelector('[data-executable]').value = files[0];
        else { message = 'Nenhum processo acessível encontrado.'; render(); }
      } catch (error) { message = error.message || String(error); render(); }
      return;
    }
    if (action === 'add-exception') {
      const executable = root.querySelector('[data-executable]').value.trim();
      if (!/\.exe$/i.test(executable)) { message = 'Selecione um programa .exe válido.'; render(); return; }
      return void mutate({ exceptions: [...state.settings.exceptions, { executable, enabled: true, profileId: root.querySelector('[data-exception-profile]').value }] });
    }
    if (action === 'save-shortcuts') return void mutate({ shortcuts: Object.fromEntries([...root.querySelectorAll('[data-shortcut]')].map(input => [input.dataset.shortcut, input.value.trim()])) });
    const custom = state.settings.customProfiles.map(profile => ({ ...profile }));
    const current = custom.find(item => item.id === state.settings.profileId);
    const name = root.querySelector('[data-profile-name]')?.value.trim();
    if (action === 'save-profile' || action === 'duplicate-profile') {
      const id = `custom-${Date.now().toString(36)}`;
      const profile = { id, name: action === 'duplicate-profile' ? `${current?.name || builtins.find(([key]) => key === state.settings.profileId)?.[1] || 'Perfil'} (cópia)` : name,
        kelvin: state.target.kelvin, intensity: state.target.intensity, dim: state.target.dim };
      if (!profile.name) { message = 'Digite um nome para o perfil.'; render(); return; }
      return void mutate({ customProfiles: [...custom, profile], profileId: id, mode: 'profile' });
    }
    if (action === 'rename-profile' && current) { if (!name) { message = 'Digite o novo nome.'; render(); return; } current.name = name; return void mutate({ customProfiles: custom }); }
    if (action === 'update-profile' && current) { current.kelvin = state.settings.manualKelvin; current.intensity = state.settings.intensity; current.dim = state.settings.dim; return void mutate({ customProfiles: custom, mode: 'profile' }); }
    if (action === 'delete-profile' && current && confirm(`Excluir o perfil ${current.name}?`)) return void mutate({ customProfiles: custom.filter(item => item.id !== current.id), profileId: 'night', mode: 'profile' });
  });
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-drag-point]');
    if (!handle || !state) return;
    const index = Number(handle.dataset.dragPoint);
    const track = root.querySelector('[data-timeline]');
    if (!track) return;
    handle.setPointerCapture(event.pointerId);
    const move = pointer => {
      const rect = track.getBoundingClientRect();
      const minute = Math.min(1435, Math.max(0, Math.round(((pointer.clientX - rect.left) / rect.width) * 1440 / 5) * 5));
      handle.style.left = `${minute / 1440 * 100}%`;
      handle.title = `${time(minute)} · ${state.settings.timeline[index].kelvin} K`;
      handle.dataset.minute = String(minute);
    };
    const finish = pointer => {
      move(pointer);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      pointUpdate(index, { minute: Number(handle.dataset.minute) });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });
  api.onChanged(value => {
    state = value;
    if (!open) return;
    if (structureKey(value) !== lastStructure) render();
    else updateLive();
  });
  window.NTCScreenLight = { async open() { open = true; try { state = await api.state(); render(); if (!state.monitors.length) { state = await api.probe(); render(); } } catch (error) { root.textContent = `Luz da Tela indisponível: ${error.message}`; } }, close() { open = false; } };
})();
