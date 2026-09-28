(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cleanInteger = (value, min, max) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const defaultState = () => ({
    version: 1,
    pomodoro: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, phase: 'focus', remainingSeconds: 1500, running: false, endsAt: null, completedSessions: 0, focusSeconds: 0, completedCycles: 0 },
    activeDeckId: '',
    decks: []
  });

  let state = defaultState();
  let loadPromise = null;
  let saveQueue = Promise.resolve();
  let timerInterval = null;
  let dueTicker = null;
  let reviewCardId = null;
  let cardRevealed = false;
  let editingCardId = null;
  let skippedCardIds = new Set();
  let isOpen = false;

  function setStatus(message, error = false) {
    const status = $('#studyGlobalStatus');
    status.textContent = message;
    status.dataset.state = error ? 'error' : 'info';
  }

  function setPomodoroStatus(message, error = false) {
    const status = $('#studyPomodoroStatus');
    status.textContent = message;
    status.dataset.state = error ? 'error' : 'info';
  }

  function setReviewStatus(message, error = false) {
    const status = $('#studyReviewStatus');
    status.textContent = message;
    status.dataset.state = error ? 'error' : 'info';
  }

  function persist() {
    const snapshot = JSON.parse(JSON.stringify(state));
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const result = await window.ntc.saveStudyState(snapshot);
      if (!result?.ok) throw new Error('Não foi possível salvar os dados de estudo.');
    }).catch(error => {
      setStatus(error?.message || 'Falha ao salvar os dados de estudo.', true);
      return false;
    });
    return saveQueue;
  }

  async function ensureLoaded() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const saved = await window.ntc.getStudyState();
        if (saved && typeof saved === 'object') state = saved;
      } catch {
        setStatus('Não foi possível carregar os dados salvos.');
      }
      if (!Array.isArray(state.decks)) state.decks = [];
      if (!state.pomodoro || typeof state.pomodoro !== 'object') state = defaultState();
      if (!state.decks.length) {
        const deck = { id: makeId(), name: 'Meu baralho', cards: [] };
        state.decks.push(deck);
        state.activeDeckId = deck.id;
      }
      if (!state.decks.some(deck => deck.id === state.activeDeckId)) state.activeDeckId = state.decks[0]?.id || '';
      const p = state.pomodoro;
      if (p.running && Number.isFinite(p.endsAt)) {
        const remaining = Math.ceil((p.endsAt - Date.now()) / 1000);
        if (remaining <= 0) completeTimerPhase(true);
        else p.remainingSeconds = remaining;
      } else {
        p.running = false;
        p.endsAt = null;
        if (!Number.isFinite(p.remainingSeconds) || p.remainingSeconds < 0) p.remainingSeconds = getPhaseDuration(p);
      }
      renderSettings();
      renderTimer();
      renderDecks();
      renderCards();
      renderReview();
      if (state.pomodoro.running) startTimerTicker();
      return state;
    })();
    return loadPromise;
  }

  function phaseDuration(p = state.pomodoro, phase = p.phase) {
    const minutes = phase === 'shortBreak' ? p.shortBreakMinutes : phase === 'longBreak' ? p.longBreakMinutes : p.focusMinutes;
    return Math.max(1, Number(minutes) || 25) * 60;
  }

  function getPhaseDuration(p = state.pomodoro) { return phaseDuration(p, p.phase); }

  function currentRemaining() {
    const p = state.pomodoro;
    if (p.running && Number.isFinite(p.endsAt)) return Math.max(0, Math.ceil((p.endsAt - Date.now()) / 1000));
    return Math.max(0, Number(p.remainingSeconds) || 0);
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatFocus(seconds) {
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours) return `${hours} h ${minutes} min`;
    return `${totalMinutes} min`;
  }

  function phaseLabel(phase) {
    return phase === 'shortBreak' ? 'Pausa curta' : phase === 'longBreak' ? 'Pausa longa' : 'Foco';
  }

  function renderSettings() {
    const p = state.pomodoro;
    $('#studyFocusMinutes').value = String(p.focusMinutes);
    $('#studyShortBreakMinutes').value = String(p.shortBreakMinutes);
    $('#studyLongBreakMinutes').value = String(p.longBreakMinutes);
    $('#studyLongBreakEvery').value = String(p.longBreakEvery);
  }

  function renderTimer() {
    const p = state.pomodoro;
    const remaining = currentRemaining();
    const duration = phaseDuration(p);
    const progress = Math.max(0, Math.min(100, (1 - remaining / duration) * 100));
    $('#studyTimerDisplay').textContent = formatTime(remaining);
    $('#studyTimerPhase').textContent = phaseLabel(p.phase);
    $('#studyTimerState').textContent = p.running ? 'EM ANDAMENTO' : remaining === 0 ? 'CONCLUÍDO' : 'PRONTO';
    $('#studyTimerState').dataset.running = String(Boolean(p.running));
    $('#studyTimerRing').style.setProperty('--study-progress', `${progress}%`);
    $('#studyTimerCaption').textContent = p.running ? 'Uma etapa de cada vez' : remaining === 0 ? 'Etapa concluída' : 'Pronto para começar';
    $('#studyTimerToggle').textContent = p.running ? 'Pausar' : p.phase === 'focus' ? 'Iniciar foco' : `Iniciar ${phaseLabel(p.phase).toLocaleLowerCase('pt-BR')}`;
    $('#studySessionsToday').textContent = String(p.completedSessions || 0);
    $('#studyFocusToday').textContent = formatFocus(p.focusSeconds || 0);
    $('#studyCycleCount').textContent = String(p.completedCycles || 0);
  }

  function startTimerTicker() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (!state.pomodoro.running) { clearInterval(timerInterval); timerInterval = null; return; }
      if (currentRemaining() <= 0) completeTimerPhase(false);
      else renderTimer();
    }, 250);
  }

  function playTimerChime() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      [0, 0.28, 0.56].forEach((delay, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = index === 1 ? 740 : 590;
        gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + delay + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + 0.2);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(context.currentTime + delay);
        oscillator.stop(context.currentTime + delay + 0.22);
      });
      setTimeout(() => { void context.close().catch(() => {}); }, 1100);
    } catch {}
  }

  function nextPhaseAfterCurrent() {
    const p = state.pomodoro;
    if (p.phase === 'focus') return p.completedSessions > 0 && p.completedSessions % p.longBreakEvery === 0 ? 'longBreak' : 'shortBreak';
    return 'focus';
  }

  function completeTimerPhase(restored = false) {
    const p = state.pomodoro;
    if (!p.running) return;
    const finishedPhase = p.phase;
    p.running = false;
    p.endsAt = null;
    p.remainingSeconds = 0;
    if (finishedPhase === 'focus') {
      p.completedSessions = (p.completedSessions || 0) + 1;
      p.focusSeconds = (p.focusSeconds || 0) + p.focusMinutes * 60;
      if (p.completedSessions % p.longBreakEvery === 0) p.completedCycles = (p.completedCycles || 0) + 1;
    }
    p.phase = nextPhaseAfterCurrent();
    p.remainingSeconds = getPhaseDuration(p);
    clearInterval(timerInterval);
    timerInterval = null;
    renderTimer();
    if (restored) setPomodoroStatus(`O tempo de ${phaseLabel(finishedPhase).toLocaleLowerCase('pt-BR')} terminou enquanto o app estava fechado. Próxima etapa: ${phaseLabel(p.phase).toLocaleLowerCase('pt-BR')}.`);
    else {
      setPomodoroStatus(`${phaseLabel(finishedPhase)} concluído. Próxima etapa: ${phaseLabel(p.phase).toLocaleLowerCase('pt-BR')}.`);
      playTimerChime();
    }
    void persist();
  }

  function startOrPauseTimer() {
    const p = state.pomodoro;
    if (p.running) {
      p.remainingSeconds = currentRemaining();
      p.running = false;
      p.endsAt = null;
      clearInterval(timerInterval);
      timerInterval = null;
      setPomodoroStatus('Sessão pausada. Você pode continuar quando quiser.');
    } else {
      if (p.remainingSeconds <= 0) p.remainingSeconds = getPhaseDuration(p);
      p.running = true;
      p.endsAt = Date.now() + p.remainingSeconds * 1000;
      setPomodoroStatus(`${phaseLabel(p.phase)} iniciado.`);
      startTimerTicker();
    }
    renderTimer();
    void persist();
  }

  function resetTimer() {
    const p = state.pomodoro;
    p.running = false;
    p.endsAt = null;
    p.remainingSeconds = getPhaseDuration(p);
    clearInterval(timerInterval);
    timerInterval = null;
    setPomodoroStatus(`${phaseLabel(p.phase)} reiniciado.`);
    renderTimer();
    void persist();
  }

  function skipTimerPhase() {
    const p = state.pomodoro;
    const skipped = p.phase;
    p.running = false;
    p.endsAt = null;
    p.phase = skipped === 'focus' ? 'shortBreak' : 'focus';
    p.remainingSeconds = getPhaseDuration(p);
    clearInterval(timerInterval);
    timerInterval = null;
    setPomodoroStatus(`${phaseLabel(skipped)} pulado. Próxima etapa: ${phaseLabel(p.phase).toLocaleLowerCase('pt-BR')}.`);
    renderTimer();
    void persist();
  }

  function saveTimerSettings() {
    if (state.pomodoro.running) {
      setPomodoroStatus('Pause a sessão atual antes de alterar a duração dos blocos.', true);
      return;
    }
    const focus = cleanInteger($('#studyFocusMinutes').value, 1, 180);
    const shortBreak = cleanInteger($('#studyShortBreakMinutes').value, 1, 60);
    const longBreak = cleanInteger($('#studyLongBreakMinutes').value, 1, 90);
    const longEvery = cleanInteger($('#studyLongBreakEvery').value, 2, 12);
    if ([focus, shortBreak, longBreak, longEvery].some(value => value === null)) {
      setPomodoroStatus('Informe valores dentro dos limites mostrados em cada campo.', true);
      return;
    }
    const p = state.pomodoro;
    p.focusMinutes = focus;
    p.shortBreakMinutes = shortBreak;
    p.longBreakMinutes = longBreak;
    p.longBreakEvery = longEvery;
    if (!p.running) p.remainingSeconds = getPhaseDuration(p);
    renderTimer();
    setPomodoroStatus('Tempos das sessões salvos.');
    void persist();
  }

  function activeDeck() { return state.decks.find(deck => deck.id === state.activeDeckId) || null; }

  function renderDecks() {
    const select = $('#studyDeckSelect');
    const current = state.activeDeckId;
    select.replaceChildren();
    state.decks.forEach(deck => {
      const option = document.createElement('option');
      option.value = deck.id;
      option.textContent = deck.name;
      select.append(option);
    });
    if (current && state.decks.some(deck => deck.id === current)) select.value = current;
    state.activeDeckId = select.value || state.decks[0]?.id || '';
  }

  function cardsDue(deck = activeDeck()) {
    return (deck?.cards || []).filter(card => Number(card.dueAt) <= Date.now()).sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);
  }

  function formatDue(timestamp) {
    if (timestamp <= Date.now()) return 'Para revisar';
    const remaining = timestamp - Date.now();
    if (remaining < 60 * 60 * 1000) return `Em ${Math.max(1, Math.ceil(remaining / 60000))} min`;
    if (remaining < 24 * 60 * 60 * 1000) return `Em ${Math.max(1, Math.ceil(remaining / 3600000))} h`;
    return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  function updateDueSummary() {
    const deck = activeDeck();
    const due = cardsDue(deck).length;
    const total = deck?.cards?.length || 0;
    $('#studyDueCount').textContent = `${due} ${due === 1 ? 'cartão pendente' : 'cartões pendentes'}`;
    $('#studyReviewDuePill').textContent = `${due} ${due === 1 ? 'PENDENTE' : 'PENDENTES'}`;
    $('#studyCardTotal').textContent = `${total} ${total === 1 ? 'cartão' : 'cartões'}`;
  }

  function renderCards() {
    const deck = activeDeck();
    const list = $('#studyCardList');
    list.replaceChildren();
    updateDueSummary();
    if (!deck?.cards?.length) {
      const empty = document.createElement('div');
      empty.className = 'study-empty-state';
      empty.textContent = 'Adicione perguntas e respostas para montar seu baralho.';
      list.append(empty);
      return;
    }
    const query = $('#studyCardSearch').value.trim().toLocaleLowerCase('pt-BR');
    const ordered = [...deck.cards].sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt)
      .filter(card => !query || `${card.front}\n${card.back}`.toLocaleLowerCase('pt-BR').includes(query));
    if (!ordered.length) {
      const empty = document.createElement('div');
      empty.className = 'study-empty-state';
      empty.textContent = 'Nenhum cartão corresponde à busca.';
      list.append(empty);
      return;
    }
    ordered.slice(0, 300).forEach(card => {
      const row = document.createElement('article');
      row.className = 'study-card-row';
      const copy = document.createElement('div');
      copy.className = 'study-card-row-copy';
      const front = document.createElement('strong');
      front.textContent = card.front;
      const back = document.createElement('span');
      back.textContent = card.back;
      const due = document.createElement('small');
      due.textContent = `${formatDue(card.dueAt)} · ${card.repetitions || 0} ${card.repetitions === 1 ? 'revisão' : 'revisões'}`;
      copy.append(front, back, due);
      const actions = document.createElement('div');
      actions.className = 'study-card-row-actions';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ghost-button';
      edit.dataset.studyEdit = card.id;
      edit.textContent = 'Editar';
      edit.setAttribute('aria-label', `Editar cartão: ${card.front.slice(0, 80)}`);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost-button study-delete-card';
      remove.dataset.studyDelete = card.id;
      remove.textContent = 'Excluir';
      remove.setAttribute('aria-label', `Excluir cartão: ${card.front.slice(0, 80)}`);
      actions.append(edit, remove);
      row.append(copy, actions);
      list.append(row);
    });
    if (ordered.length > 300) {
      const limit = document.createElement('div');
      limit.className = 'study-card-list-limit';
      limit.textContent = `Mostrando 300 de ${ordered.length} cartões. Digite na busca para encontrar outros.`;
      list.append(limit);
    }
  }

  function getReviewCard() {
    const deck = activeDeck();
    if (!deck) return null;
    const due = cardsDue(deck).filter(card => !skippedCardIds.has(card.id));
    if (reviewCardId) {
      const current = due.find(card => card.id === reviewCardId);
      if (current) return current;
    }
    const next = due[0] || null;
    reviewCardId = next?.id || null;
    return next;
  }

  function intervalForGrade(card, grade) {
    const interval = Number(card.intervalDays) || 0;
    const repetitions = Number(card.repetitions) || 0;
    const ease = Number(card.ease) || 2.5;
    if (grade === 'again') return 1 / 1440;
    if (grade === 'hard') return Math.max(1, repetitions === 0 ? 1 : Math.round(interval * 1.2));
    if (grade === 'easy') return Math.max(4, repetitions === 0 ? 4 : Math.round(interval * ease * 1.3));
    return Math.max(1, repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(interval * ease));
  }

  function intervalLabel(days) {
    if (days < 1 / 24) return `${Math.max(1, Math.round(days * 1440))} min`;
    if (days < 1) return `${Math.max(1, Math.round(days * 24))} h`;
    return `${Math.round(days)} ${Math.round(days) === 1 ? 'dia' : 'dias'}`;
  }

  function renderReview() {
    const deck = activeDeck();
    const card = getReviewCard();
    const dueCount = cardsDue(deck).length;
    updateDueSummary();
    const reveal = $('#studyRevealCard');
    const actions = $('#studyReviewActions');
    const text = $('#studyCardText');
    const side = $('#studyCardSideLabel');
    const progress = $('#studyReviewProgress');
    const nextButton = $('#studyNextCard');
    if (!card) {
      const nextDue = deck?.cards?.filter(item => Number(item.dueAt) > Date.now()).sort((a, b) => a.dueAt - b.dueAt)[0];
      text.textContent = !deck?.cards?.length ? 'Adicione seu primeiro cartão no formulário abaixo.' : dueCount === 0 ? 'Tudo revisado por enquanto.' : 'Você viu todos os cartões pendentes desta fila.';
      side.textContent = 'REVISÃO';
      progress.textContent = !deck?.cards?.length ? 'Seu baralho começa com uma pergunta' : dueCount === 0 ? 'Nenhum cartão vencido' : 'Fila concluída';
      reveal.disabled = true;
      reveal.textContent = 'Mostrar resposta';
      actions.classList.add('hidden');
      nextButton.disabled = dueCount === 0;
      nextButton.textContent = dueCount === 0 ? 'Sem pendências' : 'Recomeçar fila';
      setReviewStatus(nextDue ? `Próxima revisão ${formatDue(nextDue.dueAt).toLocaleLowerCase('pt-BR')}.` : deck?.cards?.length ? 'Novos cartões ficam prontos para revisar imediatamente.' : 'Crie cartões com uma pergunta na frente e a resposta no verso.');
      cardRevealed = false;
      return;
    }
    const index = cardsDue(deck).findIndex(item => item.id === card.id) + 1;
    progress.textContent = `Cartão ${Math.max(1, index)} de ${dueCount}`;
    text.textContent = cardRevealed ? card.back : card.front;
    side.textContent = cardRevealed ? 'RESPOSTA' : 'PERGUNTA';
    reveal.disabled = false;
    reveal.textContent = cardRevealed ? 'Resposta revelada' : 'Mostrar resposta';
    reveal.classList.toggle('hidden', cardRevealed);
    actions.classList.toggle('hidden', !cardRevealed);
    actions.querySelectorAll('[data-study-grade]').forEach(button => {
      const grade = button.dataset.studyGrade;
      button.querySelector('small').textContent = intervalLabel(intervalForGrade(card, grade));
    });
    nextButton.disabled = false;
    nextButton.textContent = 'Pular';
    setReviewStatus(cardRevealed ? 'Escolha como foi lembrar da resposta.' : 'Tente responder antes de revelar o verso.');
  }

  function switchStudyTab(tab) {
    const selected = ['pomodoro', 'flashcards'].includes(tab) ? tab : 'pomodoro';
    $$('[data-study-tab]').forEach(button => {
      const active = button.dataset.studyTab === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-study-panel]').forEach(panel => {
      const active = panel.dataset.studyPanel === selected;
      panel.classList.toggle('active', active);
      panel.classList.toggle('hidden', !active);
    });
  }

  function createDeck() {
    const name = $('#studyNewDeckName').value.trim();
    if (!name) { setStatus('Dê um nome ao baralho antes de criar.'); $('#studyNewDeckName').focus(); return; }
    if (state.decks.some(deck => deck.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      setStatus('Já existe um baralho com esse nome.');
      return;
    }
    const deck = { id: makeId(), name, cards: [] };
    state.decks.push(deck);
    state.activeDeckId = deck.id;
    skippedCardIds.clear();
    reviewCardId = null;
    $('#studyCardSearch').value = '';
    $('#studyNewDeckName').value = '';
    renderDecks();
    renderCards();
    renderReview();
    setStatus(`Baralho “${name}” criado.`);
    void persist();
  }

  function deleteActiveDeck() {
    const deck = activeDeck();
    if (!deck || !window.confirm(`Excluir o baralho “${deck.name}” e todos os seus ${deck.cards.length} cartões?`)) return;
    state.decks = state.decks.filter(item => item.id !== deck.id);
    if (!state.decks.length) state.decks.push({ id: makeId(), name: 'Meu baralho', cards: [] });
    state.activeDeckId = state.decks[0].id;
    skippedCardIds.clear();
    reviewCardId = null;
    cardRevealed = false;
    clearCardEditor();
    renderDecks();
    renderCards();
    renderReview();
    setStatus(`Baralho “${deck.name}” excluído.`);
    void persist();
  }

  function submitCard(event) {
    event.preventDefault();
    const deck = activeDeck();
    if (!deck) { setStatus('Crie ou selecione um baralho primeiro.', true); return; }
    const front = $('#studyCardFront').value.trim();
    const back = $('#studyCardBack').value.trim();
    if (!front || !back) { setStatus('Preencha a frente e o verso do cartão.', true); return; }
    const card = editingCardId ? deck.cards.find(item => item.id === editingCardId) : null;
    if (card) {
      card.front = front;
      card.back = back;
      setStatus('Cartão atualizado e salvo.');
    } else {
      const newCard = { id: makeId(), front, back, createdAt: Date.now(), dueAt: Date.now(), intervalDays: 0, ease: 2.5, repetitions: 0, lapses: 0, lastReviewedAt: 0 };
      deck.cards.push(newCard);
      reviewCardId = newCard.id;
      cardRevealed = false;
      skippedCardIds.clear();
      setStatus('Cartão adicionado. Ele já está pronto para revisar.');
    }
    clearCardEditor();
    renderCards();
    renderReview();
    void persist();
  }

  function clearCardEditor() {
    editingCardId = null;
    $('#studyCardForm').reset();
    $('#studyEditorTitle').textContent = 'Novo cartão';
    $('#studyCardSubmit').textContent = 'Adicionar cartão';
    $('#studyCardCancelEdit').classList.add('hidden');
  }

  function editCard(cardId) {
    const card = activeDeck()?.cards.find(item => item.id === cardId);
    if (!card) return;
    editingCardId = card.id;
    $('#studyCardFront').value = card.front;
    $('#studyCardBack').value = card.back;
    $('#studyEditorTitle').textContent = 'Editar cartão';
    $('#studyCardSubmit').textContent = 'Salvar alterações';
    $('#studyCardCancelEdit').classList.remove('hidden');
    $('#studyCardFront').focus();
  }

  function deleteCard(cardId) {
    const deck = activeDeck();
    const card = deck?.cards.find(item => item.id === cardId);
    if (!deck || !card || !window.confirm(`Excluir este cartão?\n\n${card.front.slice(0, 180)}`)) return;
    deck.cards = deck.cards.filter(item => item.id !== cardId);
    skippedCardIds.delete(cardId);
    if (reviewCardId === cardId) { reviewCardId = null; cardRevealed = false; }
    if (editingCardId === cardId) clearCardEditor();
    renderCards();
    renderReview();
    setStatus('Cartão excluído.');
    void persist();
  }

  function gradeCard(grade) {
    const deck = activeDeck();
    const card = deck?.cards.find(item => item.id === reviewCardId);
    if (!card || !cardRevealed) return;
    const interval = intervalForGrade(card, grade);
    if (grade === 'again') {
      card.lapses = (card.lapses || 0) + 1;
      card.repetitions = 0;
      card.ease = Math.max(1.3, (card.ease || 2.5) - 0.2);
    } else {
      if (grade === 'hard') card.ease = Math.max(1.3, (card.ease || 2.5) - 0.15);
      if (grade === 'easy') card.ease = Math.min(3.2, (card.ease || 2.5) + 0.15);
      card.repetitions = (card.repetitions || 0) + 1;
    }
    card.intervalDays = interval;
    card.dueAt = Date.now() + interval * 86400000;
    card.lastReviewedAt = Date.now();
    reviewCardId = null;
    cardRevealed = false;
    renderCards();
    renderReview();
    setReviewStatus(`Resposta marcada como “${grade === 'again' ? 'errei' : grade === 'hard' ? 'difícil' : grade === 'good' ? 'bom' : 'fácil'}”. Próxima revisão ${formatDue(card.dueAt).toLocaleLowerCase('pt-BR')}.`);
    void persist();
  }

  function skipReviewCard() {
    const due = cardsDue().filter(card => !skippedCardIds.has(card.id));
    if (!due.length && skippedCardIds.size) {
      skippedCardIds.clear();
      reviewCardId = null;
      cardRevealed = false;
      renderReview();
      return;
    }
    if (reviewCardId) skippedCardIds.add(reviewCardId);
    reviewCardId = null;
    cardRevealed = false;
    renderReview();
  }

  $$('[data-study-tab]').forEach(button => button.addEventListener('click', () => switchStudyTab(button.dataset.studyTab)));
  $('#studyTimerToggle').addEventListener('click', startOrPauseTimer);
  $('#studyTimerReset').addEventListener('click', resetTimer);
  $('#studyTimerSkip').addEventListener('click', skipTimerPhase);
  $('#studySaveSettings').addEventListener('click', saveTimerSettings);
  $('#studyCreateDeck').addEventListener('click', createDeck);
  $('#studyDeleteDeck').addEventListener('click', deleteActiveDeck);
  $('#studyNewDeckName').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); createDeck(); } });
  $('#studyDeckSelect').addEventListener('change', () => {
    state.activeDeckId = $('#studyDeckSelect').value;
    $('#studyCardSearch').value = '';
    skippedCardIds.clear();
    reviewCardId = null;
    cardRevealed = false;
    clearCardEditor();
    renderCards();
    renderReview();
    void persist();
  });
  $('#studyCardForm').addEventListener('submit', submitCard);
  $('#studyCardSearch').addEventListener('input', renderCards);
  $('#studyCardCancelEdit').addEventListener('click', clearCardEditor);
  $('#studyRevealCard').addEventListener('click', () => { cardRevealed = true; renderReview(); });
  $('#studyNextCard').addEventListener('click', skipReviewCard);
  $('#studyReviewActions').addEventListener('click', event => {
    const button = event.target.closest('[data-study-grade]');
    if (button) gradeCard(button.dataset.studyGrade);
  });
  $('#studyCardList').addEventListener('click', event => {
    const edit = event.target.closest('[data-study-edit]');
    const remove = event.target.closest('[data-study-delete]');
    if (edit) editCard(edit.dataset.studyEdit);
    if (remove) deleteCard(remove.dataset.studyDelete);
  });

  window.ntcStudyUi = {
    async open() {
      isOpen = true;
      await ensureLoaded();
      renderTimer();
      renderCards();
      renderReview();
      clearInterval(dueTicker);
      dueTicker = setInterval(() => {
        if (isOpen && $('[data-study-panel="flashcards"]')?.classList.contains('active')) {
          renderCards();
          if (!reviewCardId || !cardsDue().some(card => card.id === reviewCardId)) renderReview();
        }
      }, 15000);
    },
    close() { isOpen = false; clearInterval(dueTicker); dueTicker = null; }
  };

  void ensureLoaded();
})();
