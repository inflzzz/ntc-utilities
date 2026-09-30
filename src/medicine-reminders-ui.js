(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const weekdays = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const api = window.ntc.medicineReminders;
  let state = { medications: [], today: [], history: [], nextDose: null }, editingId = null, launchAtLoginSupported = false;

  function dateLabel(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(year, month - 1, day));
  }

  function timeRows(values = ['08:00']) {
    $('#medicineTimeFields').innerHTML = values.map((time, index) => `<div class="medicine-time-row"><label><span class="sr-only">Horário ${index + 1}</span><input class="text-input" type="time" value="${esc(time)}" data-medicine-time required></label><button class="outline-button" type="button" data-medicine-remove-time aria-label="Remover horário ${index + 1}" ${values.length <= 1 ? 'disabled' : ''}>Remover</button></div>`).join('');
  }

  function displayDays(days) {
    if (days.length === 7) return 'Todos os dias';
    if (days.length === 5 && [1, 2, 3, 4, 5].every(day => days.includes(day))) return 'Dias úteis';
    if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Fim de semana';
    return days.map(day => weekdays[day]).join(', ');
  }

  function render() {
    const today = state.today || [], medications = state.medications || [], history = state.history || [];
    const taken = today.filter(item => item.status === 'taken').length;
    $('#medicineTodayCount').textContent = String(today.length);
    $('#medicineTodayProgress').textContent = `${taken} de ${today.length} tomadas`;
    if (state.nextDose) {
      const nextTime = state.nextDose.nextAt === state.nextDose.dueAt ? state.nextDose.time : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(state.nextDose.nextAt));
      $('#medicineNextDose').textContent = `${nextTime} · ${state.nextDose.medicine.name}`;
      $('#medicineNextDoseDetails').textContent = state.nextDose.medicine.dose;
    } else {
      $('#medicineNextDose').textContent = today.length ? 'Sem próximas doses pendentes' : 'Nenhuma dose próxima';
      $('#medicineNextDoseDetails').textContent = today.length ? 'As doses programadas de hoje já passaram ou foram registradas.' : 'Cadastre um medicamento para começar.';
    }
    if (!today.length) {
      $('#medicineTodayList').innerHTML = '<div class="medicine-inline-empty">Nenhuma dose programada para hoje.</div>';
    } else {
      const nextKey = state.nextDose?.key;
      $('#medicineTodayList').innerHTML = today.map(item => {
        const active = item.status !== 'taken' && !item.overdue && item.key === nextKey;
        const status = item.status === 'taken' ? '<span class="medicine-status taken">Tomado</span>' : item.overdue ? '<span class="medicine-status overdue">Atrasado</span>' : active ? '<span class="medicine-status next">Próximo</span>' : '<span class="medicine-status pending">Pendente</span>';
        const actions = item.status === 'taken'
          ? `<button class="outline-button" type="button" data-medicine-mark="${esc(item.key)}" data-medicine-status="pending">Desmarcar como tomado</button>`
          : `<button class="primary-button" type="button" data-medicine-mark="${esc(item.key)}" data-medicine-status="taken">Marcar como tomado</button><details class="medicine-snooze"><summary>Lembrar novamente</summary><div>${[5, 10, 15, 30].map(minutes => `<button type="button" data-medicine-snooze="${esc(item.key)}" data-medicine-minutes="${minutes}">${minutes} min</button>`).join('')}</div></details>`;
        return `<article class="medicine-dose-row${item.status === 'taken' ? ' is-taken' : item.overdue ? ' is-overdue' : ''}" id="medicine-dose-${esc(item.key)}" tabindex="-1"><time>${esc(item.time)}</time><div class="medicine-dose-copy"><strong>${esc(item.medicine.name)}</strong><span>${esc(item.medicine.dose)}</span>${item.medicine.notes ? `<small>${esc(item.medicine.notes)}</small>` : ''}</div><div class="medicine-dose-meta">${status}<div class="medicine-dose-actions">${actions}</div></div></article>`;
      }).join('');
    }

    $('#medicineList').innerHTML = medications.map(medicine => `<article class="medicine-item${medicine.enabled ? '' : ' disabled'}"><div class="medicine-item-copy"><strong>${esc(medicine.name)}</strong><span>${esc(medicine.dose)}</span><small>${esc(displayDays(medicine.days))} · ${medicine.times.map(esc).join(' · ')}</small>${medicine.notes ? `<p>${esc(medicine.notes)}</p>` : ''}</div><label class="medicine-toggle"><input type="checkbox" data-medicine-toggle="${esc(medicine.id)}" ${medicine.enabled ? 'checked' : ''}><span>${medicine.enabled ? 'Ativo' : 'Inativo'}</span></label><div class="medicine-item-actions"><button class="outline-button" type="button" data-medicine-edit="${esc(medicine.id)}">Editar</button><button class="outline-button" type="button" data-medicine-delete="${esc(medicine.id)}">Excluir</button></div></article>`).join('');
    $('#medicineEmpty').classList.toggle('hidden', medications.length > 0);
    $('#medicineList').classList.toggle('hidden', medications.length === 0);

    $('#medicineHistory').innerHTML = history.length ? history.slice(0, 30).map(item => {
      const label = item.status === 'taken' ? `Tomado${item.takenAt ? ` às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.takenAt))}` : ' ✓'}` : item.dueAt <= Date.now() ? 'Pendente' : 'Agendado';
      return `<div class="medicine-history-row"><time>${dateLabel(item.date)} · ${esc(item.time)}</time><span>${esc(item.medicine?.name || 'Medicamento removido')} · ${esc(item.medicine?.dose || '')}</span><strong class="${item.status === 'taken' ? 'taken' : ''}">${label}</strong></div>`;
    }).join('') : '<div class="medicine-inline-empty">Os registros de hoje aparecerão aqui.</div>';
    bindRenderedActions();
  }

  async function updateState(operation) {
    try { state = await operation(); render(); }
    catch (error) { $('#medicineFormError').textContent = error.message || 'Não foi possível salvar esta alteração.'; }
  }

  function bindRenderedActions() {
    document.querySelectorAll('[data-medicine-mark]').forEach(button => button.onclick = () => updateState(() => api.mark(button.dataset.medicineMark, button.dataset.medicineStatus)));
    document.querySelectorAll('[data-medicine-snooze]').forEach(button => button.onclick = () => updateState(() => api.snooze(button.dataset.medicineSnooze, Number(button.dataset.medicineMinutes))));
    document.querySelectorAll('[data-medicine-edit]').forEach(button => button.onclick = () => openEditor(button.dataset.medicineEdit));
    document.querySelectorAll('[data-medicine-delete]').forEach(button => button.onclick = async () => {
      const medicine = state.medications.find(item => item.id === button.dataset.medicineDelete);
      if (!medicine || !confirm(`Excluir “${medicine.name}”? O histórico já registrado será mantido.`)) return;
      await updateState(() => api.save(state.medications.filter(item => item.id !== medicine.id)));
    });
    document.querySelectorAll('[data-medicine-toggle]').forEach(input => input.onchange = () => {
      const medicines = state.medications.map(item => item.id === input.dataset.medicineToggle ? { ...item, enabled: input.checked } : item);
      void updateState(() => api.save(medicines));
    });
    document.querySelectorAll('[data-medicine-add]').forEach(button => button.onclick = () => openEditor());
  }

  function openEditor(id = '') {
    editingId = id;
    const medicine = state.medications.find(item => item.id === id);
    $('#medicineEditorTitle').textContent = medicine ? 'Editar medicamento' : 'Adicionar medicamento';
    $('#medicineName').value = medicine?.name || '';
    $('#medicineDose').value = medicine?.dose || '';
    $('#medicineNotes').value = medicine?.notes || '';
    document.querySelectorAll('[data-medicine-day]').forEach(input => { input.checked = medicine ? medicine.days.includes(Number(input.value)) : false; });
    timeRows(medicine?.times || ['08:00']);
    $('#medicineFormError').textContent = '';
    $('#medicineEditorDialog').showModal();
    $('#medicineName').focus();
  }

  function closeEditor() { $('#medicineEditorDialog').close(); }
  async function refresh() { state = await api.state(); render(); }

  $('#medicineAddButton').onclick = () => openEditor();
  $('#medicineEditorClose').onclick = closeEditor;
  $('#medicineEditorCancel').onclick = closeEditor;
  $('#medicineAddTime').onclick = () => {
    const times = [...document.querySelectorAll('[data-medicine-time]')].map(input => input.value || '08:00');
    if (times.length >= 24) { $('#medicineFormError').textContent = 'Adicione no máximo 24 horários.'; return; }
    times.push('08:00'); timeRows(times); document.querySelectorAll('[data-medicine-time]')[times.length - 1].focus();
  };
  $('#medicineTimeFields').addEventListener('click', event => {
    const button = event.target.closest('[data-medicine-remove-time]');
    if (!button) return;
    const times = [...document.querySelectorAll('[data-medicine-time]')].map(input => input.value);
    if (times.length > 1) times.splice([...document.querySelectorAll('[data-medicine-remove-time]')].indexOf(button), 1);
    timeRows(times);
  });
  document.querySelectorAll('[data-medicine-days]').forEach(button => button.onclick = () => {
    const value = button.dataset.medicineDays, selected = value === 'all' ? [0, 1, 2, 3, 4, 5, 6] : value === 'weekdays' ? [1, 2, 3, 4, 5] : [0, 6];
    document.querySelectorAll('[data-medicine-day]').forEach(input => { input.checked = selected.includes(Number(input.value)); });
  });
  $('#medicineEditorForm').onsubmit = async event => {
    event.preventDefault();
    const days = [...document.querySelectorAll('[data-medicine-day]:checked')].map(input => Number(input.value));
    const times = [...document.querySelectorAll('[data-medicine-time]')].map(input => input.value);
    const medicine = { id: editingId || crypto.randomUUID(), name: $('#medicineName').value, dose: $('#medicineDose').value, days, times, notes: $('#medicineNotes').value, enabled: state.medications.find(item => item.id === editingId)?.enabled ?? true };
    $('#medicineFormError').textContent = '';
    try {
      state = await api.save(editingId ? state.medications.map(item => item.id === editingId ? medicine : item) : [...state.medications, medicine]);
      closeEditor(); render();
    } catch (error) { $('#medicineFormError').textContent = error.message || 'Não foi possível salvar o medicamento.'; }
  };
  $('#medicineLaunchAtLogin').onchange = async event => {
    const input = event.currentTarget; input.disabled = true;
    try {
      const result = await window.ntc.setLaunchAtLogin(input.checked);
      if (!result.ok) { input.checked = !input.checked; $('#medicineAutostartStatus').textContent = result.message; }
      else $('#medicineAutostartStatus').textContent = result.enabled ? 'O NTC será iniciado com o Windows. Os lembretes dependem do NTC estar em execução e o PC ligado.' : 'Os lembretes funcionam enquanto o NTC estiver em execução e o computador estiver ligado.';
    } catch (error) { input.checked = !input.checked; $('#medicineAutostartStatus').textContent = error.message; }
    finally { input.disabled = !launchAtLoginSupported; }
  };

  window.NTCMedicineReminders = { open: key => {
    void refresh().then(() => {
      if (!key) return;
      const row = document.getElementById(`medicine-dose-${key}`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.focus();
    }).catch(error => { $('#medicineTodayList').textContent = error.message; });
  } };
  api.onChanged(value => { state = value; render(); });
  api.onOpenReminder(({ key }) => {
    if (typeof navigateToView === 'function') navigateToView('medicineReminders', { reminderKey: key });
    else window.NTCMedicineReminders.open(key);
  });
  window.ntc.getLaunchAtLogin().then(setting => {
    launchAtLoginSupported = Boolean(setting.supported);
    $('#medicineLaunchAtLogin').checked = Boolean(setting.enabled);
    $('#medicineLaunchAtLogin').disabled = !launchAtLoginSupported;
    if (!launchAtLoginSupported) $('#medicineAutostartStatus').textContent = 'A inicialização automática está disponível no Windows. Os lembretes funcionam enquanto o NTC estiver em execução.';
  }).catch(() => { $('#medicineLaunchAtLogin').disabled = true; });
  void refresh().catch(error => { $('#medicineTodayList').textContent = error.message; });
})();
