const FOCUS_ROTATION = [
  { id: 'epic', label: 'Épico' }, { id: 'unique', label: 'Singular' }, { id: 'legendary', label: 'Lendário' },
  { id: 'mythic', label: 'Mítico' }, { id: 'exalted', label: 'Exaltado' }, { id: 'glorious', label: 'Glorioso' },
  { id: 'transcendent', label: 'Transcendente' }, { id: 'dimensional', label: 'Dimensional' }, { id: 'ntc', label: 'Além do NTC' }
];
const EVENTS = [
  { id: 'rain', name: 'Chuva de Sorte', weekday: null, hourUtc: 22, durationMinutes: 10, multiplier: 2, description: 'Todos os dias' },
  { id: 'eclipse', name: 'Eclipse', weekday: 6, hourUtc: 23, durationMinutes: 5, multiplier: 5, description: 'Sábados' },
  { id: 'focus', name: 'Alinhamento de Raridade', weekday: 3, hourUtc: 23, durationMinutes: 5, multiplier: 1, description: 'Semanalmente', focusMultiplier: 3 },
  { id: 'fragments', name: 'Chuva de Fragmentos', monthlyFirstWeekday: 0, hourUtc: 20, durationMinutes: 25, multiplier: 2, description: 'Todo mês', fragmentGoal: 1_000 }
];

// Edições únicas. Datas e recompensas são distribuídas com a versão do app.
const LIMITED_REWARDS = [
  { eventId: 'rain', edition: '2026-10-01', titleId: 'limited-first-rain', name: 'Primeira Chuva de Sorte', odds: 5_000 },
  { eventId: 'eclipse', edition: '2026-10-03', titleId: 'limited-first-eclipse', name: 'Testemunha do Eclipse', odds: 10_000 },
  { eventId: 'fragments', edition: '2026-09-27', titleId: 'limited-fragment-2026-09', name: 'Fragmento da Lua Nova', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2026-10-04', titleId: 'limited-fragment-2026-10', name: 'Fragmento da Primeira Chuva', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2026-11-01', titleId: 'limited-fragment-2026-11', name: 'Fragmento Carmesim', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2026-12-06', titleId: 'limited-fragment-2026-12', name: 'Fragmento do Solstício', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-01-03', titleId: 'limited-fragment-2027-01', name: 'Fragmento do Ano Novo', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-02-07', titleId: 'limited-fragment-2027-02', name: 'Fragmento de Aurora', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-03-07', titleId: 'limited-fragment-2027-03', name: 'Fragmento Equinocial', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-04-04', titleId: 'limited-fragment-2027-04', name: 'Fragmento de Outono', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-05-02', titleId: 'limited-fragment-2027-05', name: 'Fragmento Celeste', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-06-06', titleId: 'limited-fragment-2027-06', name: 'Fragmento de Geada', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-07-04', titleId: 'limited-fragment-2027-07', name: 'Fragmento Boreal', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-08-01', titleId: 'limited-fragment-2027-08', name: 'Fragmento de Safira', rollGoal: 1_000 },
  { eventId: 'fragments', edition: '2027-09-05', titleId: 'limited-fragment-2027-09', name: 'Fragmento da Primavera', rollGoal: 1_000 }
];

function eventWindow(event, dayUtc) {
  const date = new Date(dayUtc).toISOString().slice(0, 10);
  const startUtc = dayUtc + event.hourUtc * 3_600_000;
  const weekAnchor = Date.UTC(2026, 8, 21);
  const weekIndex = Math.floor((dayUtc - weekAnchor) / (7 * 86_400_000));
  const focus = event.focusMultiplier ? FOCUS_ROTATION[((weekIndex % FOCUS_ROTATION.length) + FOCUS_ROTATION.length) % FOCUS_ROTATION.length] : null;
  return { id: `${event.id}:${date}`, eventId: event.id, name: event.name, description: event.description, multiplier: event.multiplier, durationMinutes: event.durationMinutes, startUtc, endUtc: startUtc + event.durationMinutes * 60_000, focusTierId: focus?.id || null, focusTierLabel: focus?.label || null, focusMultiplier: focus ? event.focusMultiplier : 1, fragmentGoal: event.fragmentGoal || 0, reward: LIMITED_REWARDS.find(reward => reward.eventId === event.id && reward.edition === date) || null };
}

function eventSchedule(utcMs, days = 35) {
  if (!Number.isFinite(utcMs)) return [];
  const dayStart = Math.floor(utcMs / 86_400_000) * 86_400_000;
  const windows = [];
  for (let offset = 0; offset <= days; offset++) {
    const day = dayStart + offset * 86_400_000;
    const weekday = new Date(day).getUTCDay();
    for (const event of EVENTS) {
      if (event.monthlyFirstWeekday !== undefined) {
        const dayOfMonth = new Date(day).getUTCDate();
        if (weekday !== event.monthlyFirstWeekday || dayOfMonth > 7) continue;
      } else if (event.weekday !== null && event.weekday !== undefined && event.weekday !== weekday) continue;
      const window = eventWindow(event, day);
      if (window.endUtc > utcMs) windows.push(window);
    }
  }
  return windows.sort((a, b) => a.startUtc - b.startUtc);
}

function activeEvent(utcMs, participation) {
  if (!Number.isFinite(utcMs) || !participation) return null;
  return eventSchedule(utcMs, 0).find(window => window.id === participation && window.startUtc <= utcMs && utcMs < window.endUtc) || null;
}

function joinEvent(utcMs, eventId) {
  if (!Number.isFinite(utcMs)) throw new Error('A participação precisa de horário online verificado.');
  const event = eventSchedule(utcMs, 0).find(window => window.id === eventId && window.startUtc <= utcMs && utcMs < window.endUtc);
  if (!event) throw new Error('Este evento não está ativo.');
  return event.id;
}

module.exports = { EVENTS, LIMITED_REWARDS, eventSchedule, activeEvent, joinEvent };
