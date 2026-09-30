const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTICE_GRACE_MS = 2 * 60 * 1000;
const SNOOZE_MINUTES = new Set([5, 10, 15, 30]);
const MAX_MEDICINES = 100;
const pad = value => String(value).padStart(2, '0');

function localDateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function occurrenceKey(medicineId, date, time) { return `${medicineId}|${date}|${time}`; }
function validTime(value) { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }

function normalizeMedicine(value) {
  if (!value || typeof value !== 'object') throw new Error('Medicamento inválido.');
  const id = typeof value.id === 'string' && /^[\w-]{1,80}$/.test(value.id) ? value.id : crypto.randomUUID();
  const name = String(value.name || '').trim().slice(0, 100);
  const dose = String(value.dose || '').trim().slice(0, 100);
  const days = [...new Set((Array.isArray(value.days) ? value.days : []).map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  const times = [...new Set((Array.isArray(value.times) ? value.times : []).filter(validTime))].sort();
  const notes = String(value.notes || '').trim().slice(0, 500);
  if (!name) throw new Error('Informe o nome do medicamento.');
  if (!dose) throw new Error('Informe a dose ou quantidade exatamente como deseja registrar.');
  if (!days.length) throw new Error('Selecione pelo menos um dia da semana.');
  if (!times.length) throw new Error('Adicione pelo menos um horário válido.');
  if (times.length > 24) throw new Error('Adicione no máximo 24 horários por medicamento.');
  if (Array.isArray(value.times) && value.times.some(time => !validTime(time))) throw new Error('Há um horário inválido.');
  return { id, name, dose, days, times, notes, enabled: value.enabled !== false };
}

function normalizeOccurrence(value) {
  if (!value || typeof value !== 'object' || typeof value.key !== 'string') return null;
  if (!['pending', 'taken'].includes(value.status)) return null;
  const dueAt = Number(value.dueAt);
  if (!Number.isFinite(dueAt)) return null;
  return {
    key: value.key.slice(0, 240), medicineId: String(value.medicineId || '').slice(0, 80),
    medicineName: String(value.medicineName || '').slice(0, 100), dose: String(value.dose || '').slice(0, 100),
    date: String(value.date || '').slice(0, 10), time: validTime(value.time) ? value.time : '00:00', dueAt,
    status: value.status,
    takenAt: Number.isFinite(Number(value.takenAt)) && value.takenAt !== null ? Number(value.takenAt) : null,
    notifiedAt: Number.isFinite(Number(value.notifiedAt)) && value.notifiedAt !== null ? Number(value.notifiedAt) : null,
    skippedAt: Number.isFinite(Number(value.skippedAt)) && value.skippedAt !== null ? Number(value.skippedAt) : null,
    snoozeUntil: Number.isFinite(Number(value.snoozeUntil)) && value.snoozeUntil !== null ? Number(value.snoozeUntil) : null
  };
}

function createOccurrence(medicine, date, time) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const due = new Date(year, month - 1, day, hour, minute, 0, 0);
  return { key: occurrenceKey(medicine.id, date, time), medicineId: medicine.id, medicineName: medicine.name, dose: medicine.dose, date, time, dueAt: due.getTime(), status: 'pending', takenAt: null, notifiedAt: null, skippedAt: null, snoozeUntil: null };
}

function normalizeStoredState(value) {
  const medications = [], ids = new Set();
  for (const item of Array.isArray(value?.medications) ? value.medications.slice(0, MAX_MEDICINES) : []) {
    try { const medicine = normalizeMedicine(item); if (!ids.has(medicine.id)) { ids.add(medicine.id); medications.push(medicine); } } catch {}
  }
  const occurrences = [], keys = new Set();
  for (const item of Array.isArray(value?.occurrences) ? value.occurrences : []) {
    const occurrence = normalizeOccurrence(item);
    if (occurrence && !keys.has(occurrence.key)) { keys.add(occurrence.key); occurrences.push(occurrence); }
  }
  return { version: 1, medications, occurrences };
}

class MedicineReminderService {
  constructor({ file, notify = () => {}, onChange = () => {}, now = () => Date.now(), setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
    if (!file) throw new Error('É necessário informar o arquivo local dos lembretes.');
    this.file = file; this.notify = notify; this.onChange = onChange; this.now = now;
    this.setTimeout = setTimeoutImpl; this.clearTimeout = clearTimeoutImpl;
    this.state = { version: 1, medications: [], occurrences: [] };
    this.timer = null; this.writeQueue = Promise.resolve(); this.closed = false;
  }

  enqueue(operation) { const result = this.writeQueue.then(operation); this.writeQueue = result.catch(() => {}); return result; }

  async persist() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', flag: 'wx' });
    try { await fs.rename(temporary, this.file); } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
  }

  async initialize() {
    return this.enqueue(async () => {
      try { this.state = normalizeStoredState(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') console.error('Não foi possível ler os lembretes locais:', error); }
      this.ensureOccurrences(new Date(this.now())); await this.persist(); await this.processDue(); this.arm();
      return this.getState();
    });
  }

  ensureOccurrences(nowDate) {
    const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    const keepAfter = today.getTime() - 180 * DAY_MS;
    const todayKey = localDateKey(today);
    const futureAndToday = this.state.occurrences.filter(item => item.date >= todayKey);
    const history = this.state.occurrences.filter(item => item.status === 'taken' && item.dueAt >= keepAfter).sort((a, b) => b.dueAt - a.dueAt).slice(0, 2000);
    const activeKeys = new Set(futureAndToday.map(item => item.key));
    this.state.occurrences = [...futureAndToday, ...history.filter(item => !activeKeys.has(item.key))];
    const existing = new Map(this.state.occurrences.map(item => [item.key, item]));
    for (let offset = 0; offset < 15; offset++) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset), dateKey = localDateKey(date), weekday = date.getDay();
      for (const medicine of this.state.medications) {
        if (!medicine.enabled || !medicine.days.includes(weekday)) continue;
        for (const time of medicine.times) {
          const generated = createOccurrence(medicine, dateKey, time);
          const current = existing.get(generated.key);
          if (!current) { existing.set(generated.key, generated); this.state.occurrences.push(generated); }
          else if (current.status === 'pending' && current.notifiedAt === null) {
            current.medicineName = medicine.name;
            current.dose = medicine.dose;
            if (current.snoozeUntil === null) current.dueAt = generated.dueAt;
          }
        }
      }
    }
  }

  getState() {
    const now = this.now(), today = localDateKey(new Date(now)), medicines = new Map(this.state.medications.map(item => [item.id, item]));
    const snapshotMedicine = item => ({ id: item.medicineId, name: item.medicineName || medicines.get(item.medicineId)?.name || 'Medicamento removido', dose: item.dose || medicines.get(item.medicineId)?.dose || '', enabled: medicines.get(item.medicineId)?.enabled ?? false });
    const items = this.state.occurrences.filter(item => item.date === today && (medicines.has(item.medicineId) || item.medicineName))
      .map(item => ({ ...item, medicine: item.dueAt <= now ? snapshotMedicine(item) : medicines.get(item.medicineId) || snapshotMedicine(item), overdue: item.status !== 'taken' && item.dueAt <= now }))
      .sort((a, b) => a.dueAt - b.dueAt || a.medicine.name.localeCompare(b.medicine.name, 'pt-BR'));
    const nextDose = this.state.occurrences.filter(item => item.status === 'pending' && (item.snoozeUntil ?? item.dueAt) > now && medicines.has(item.medicineId) && medicines.get(item.medicineId).enabled).sort((a, b) => (a.snoozeUntil ?? a.dueAt) - (b.snoozeUntil ?? b.dueAt))[0] || null;
    return {
      medications: this.state.medications.map(item => ({ ...item, days: [...item.days], times: [...item.times] })), today: items,
      nextDose: nextDose ? { ...nextDose, nextAt: nextDose.snoozeUntil ?? nextDose.dueAt, medicine: medicines.get(nextDose.medicineId) } : null,
      history: [...this.state.occurrences].filter(item => item.status === 'taken' || item.date <= today).sort((a, b) => b.dueAt - a.dueAt).slice(0, 100).map(item => ({ ...item, medicine: snapshotMedicine(item) }))
    };
  }

  async saveMedications(value) {
    return this.enqueue(async () => {
      if (!Array.isArray(value) || value.length > MAX_MEDICINES) throw new Error(`Cadastre até ${MAX_MEDICINES} medicamentos.`);
      const ids = new Set(), medications = value.map(normalizeMedicine);
      for (const medicine of medications) { if (ids.has(medicine.id)) throw new Error('Há medicamentos com identificadores repetidos.'); ids.add(medicine.id); }
      this.state.medications = medications;
      const allowed = new Set(medications.filter(medicine => medicine.enabled).flatMap(medicine => medicine.days.flatMap(day => medicine.times.map(time => `${medicine.id}|${day}|${time}`))));
      const now = this.now();
      this.state.occurrences = this.state.occurrences.filter(item => item.dueAt <= now || (ids.has(item.medicineId) && allowed.has(`${item.medicineId}|${new Date(`${item.date}T12:00:00`).getDay()}|${item.time}`)));
      this.ensureOccurrences(new Date(this.now())); await this.processDue(); await this.persist(); this.arm(); this.onChange(this.getState()); return this.getState();
    });
  }

  async setOccurrence(key, status) {
    return this.enqueue(async () => {
      if (!['pending', 'taken'].includes(status)) throw new Error('Status de lembrete inválido.');
      const occurrence = this.state.occurrences.find(item => item.key === key);
      if (!occurrence) throw new Error('Este lembrete não foi encontrado.');
      occurrence.status = status; occurrence.takenAt = status === 'taken' ? this.now() : null;
      if (status === 'taken') occurrence.snoozeUntil = null;
      await this.persist(); this.arm(); this.onChange(this.getState()); return this.getState();
    });
  }

  async snooze(key, minutes) {
    return this.enqueue(async () => {
      const value = Number(minutes);
      if (!SNOOZE_MINUTES.has(value)) throw new Error('Escolha um adiamento de 5, 10, 15 ou 30 minutos.');
      const occurrence = this.state.occurrences.find(item => item.key === key);
      if (!occurrence || occurrence.status !== 'pending') throw new Error('Este lembrete não está pendente.');
      occurrence.snoozeUntil = this.now() + value * 60_000; occurrence.notifiedAt ??= this.now();
      await this.persist(); this.arm(); this.onChange(this.getState()); return this.getState();
    });
  }

  async processDue() {
    const now = this.now(), notifications = [], medicines = new Map(this.state.medications.map(item => [item.id, item]));
    let changed = false;
    for (const occurrence of this.state.occurrences) {
      const medicine = medicines.get(occurrence.medicineId);
      if (!medicine?.enabled || occurrence.status !== 'pending') continue;
      if (occurrence.snoozeUntil !== null) {
        if (occurrence.snoozeUntil > now) continue;
        if (now - occurrence.snoozeUntil <= NOTICE_GRACE_MS) { occurrence.snoozeUntil = null; occurrence.notifiedAt = now; notifications.push({ ...occurrence, medicine, snoozed: true }); }
        else { occurrence.snoozeUntil = null; occurrence.skippedAt = now; }
        changed = true; continue;
      }
      if (occurrence.dueAt > now || occurrence.notifiedAt !== null || occurrence.skippedAt !== null) continue;
      if (now - occurrence.dueAt <= NOTICE_GRACE_MS) { occurrence.notifiedAt = now; notifications.push({ ...occurrence, medicine, snoozed: false }); }
      else occurrence.skippedAt = now;
      changed = true;
    }
    if (changed) await this.persist();
    for (const reminder of notifications) { try { this.notify(reminder); } catch (error) { console.error('Não foi possível exibir a notificação do medicamento:', error); } }
    if (changed) this.onChange(this.getState());
    return notifications.length;
  }

  arm() {
    if (this.timer) this.clearTimeout(this.timer);
    this.timer = null;
    if (this.closed) return;
    const now = this.now();
    const next = this.state.occurrences.filter(item => item.status === 'pending' && (item.snoozeUntil ?? item.dueAt) > now).reduce((soonest, item) => Math.min(soonest, item.snoozeUntil ?? item.dueAt), Infinity);
    const wait = Math.max(250, Math.min(60_000, Number.isFinite(next) ? next - now : 60_000));
    this.timer = this.setTimeout(() => {
      this.timer = null;
      void this.enqueue(async () => { this.ensureOccurrences(new Date(this.now())); await this.processDue(); this.arm(); }).catch(error => { console.error('Falha ao processar lembretes:', error); this.arm(); });
    }, wait);
    this.timer.unref?.();
  }

  async refreshAfterResume() {
    return this.enqueue(async () => { this.ensureOccurrences(new Date(this.now())); await this.processDue(); await this.persist(); this.arm(); this.onChange(this.getState()); return this.getState(); });
  }

  close() { this.closed = true; if (this.timer) this.clearTimeout(this.timer); this.timer = null; }
}

module.exports = { MedicineReminderService, localDateKey, occurrenceKey, normalizeMedicine, normalizeStoredState, createOccurrence, NOTICE_GRACE_MS };
