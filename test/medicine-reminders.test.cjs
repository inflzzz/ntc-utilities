const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MedicineReminderService, localDateKey, normalizeMedicine, NOTICE_GRACE_MS } = require('../src/medicine-reminders.cjs');

function harness(initialDate = new Date(2026, 8, 28, 7, 30)) {
  let now = initialDate.getTime();
  const reminders = [], timers = new Map();
  let timerId = 0;
  const directory = path.join(os.tmpdir(), `ntc-medicine-test-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const service = new MedicineReminderService({
    file: path.join(directory, 'medicine-reminders.json'), now: () => now,
    notify: reminder => reminders.push(reminder),
    setTimeoutImpl: callback => { const id = ++timerId; const handle = { id, unref() {} }; timers.set(id, callback); return handle; },
    clearTimeoutImpl: handle => timers.delete(handle.id)
  });
  return { service, reminders, timers, directory, get now() { return now; }, set now(value) { now = value instanceof Date ? value.getTime() : value; }, cleanup: async () => { service.close(); await fs.rm(directory, { recursive: true, force: true }); } };
}

const medication = (overrides = {}) => ({ id: 'med-1', name: 'Vitamina D', dose: '1 cápsula', days: [1, 3, 5], times: ['09:00'], notes: '', enabled: true, ...overrides });

test('valida e normaliza criação, edição, dose, dias e vários horários', () => {
  const value = normalizeMedicine(medication({ days: [5, 1, 3, 1], times: ['20:00', '08:00', '20:00'] }));
  assert.deepEqual(value.days, [1, 3, 5]);
  assert.deepEqual(value.times, ['08:00', '20:00']);
  assert.throws(() => normalizeMedicine(medication({ name: '' })), /nome/i);
  assert.throws(() => normalizeMedicine(medication({ times: ['25:99'] })), /horário/i);
});

test('cria agenda semanal local, ordena horários e calcula a próxima dose', async t => {
  const h = harness(); t.after(h.cleanup);
  await h.service.initialize();
  let state = await h.service.saveMedications([medication({ times: ['20:00', '08:00'] })]);
  assert.deepEqual(state.today.map(item => item.time), ['08:00', '20:00']);
  assert.equal(state.nextDose.time, '08:00');
  assert.equal(state.today[0].medicine.name, 'Vitamina D');
  assert.equal(state.today[0].date, localDateKey(new Date(h.now)));
  state = await h.service.saveMedications([medication({ name: 'Vitamina D editada', dose: '2 cápsulas', days: [1], times: ['10:00'] })]);
  assert.equal(state.medications[0].name, 'Vitamina D editada');
  assert.deepEqual(state.today.map(item => item.time), ['10:00']);
});

test('suporta atalhos de dias úteis, fim de semana e todos os dias, além da virada do dia', async t => {
  const h = harness(new Date(2026, 8, 28, 23, 58)); t.after(h.cleanup);
  await h.service.initialize();
  let state = await h.service.saveMedications([medication({ days: [0, 1, 2, 3, 4, 5, 6], times: ['00:01', '23:59'] })]);
  assert.deepEqual(state.today.map(item => item.time), ['00:01', '23:59']);
  assert.equal(state.nextDose.time, '23:59');
  h.now = new Date(2026, 8, 29, 0, 0);
  await h.service.refreshAfterResume();
  state = h.service.getState();
  assert.equal(state.today[0].date, '2026-09-29');
  assert.deepEqual(state.today.map(item => item.time), ['00:01', '23:59']);
  assert.equal(state.medications[0].days.length, 7);
});

test('dias selecionados limitam a recorrência aos dias configurados', async t => {
  const h = harness(new Date(2026, 8, 29, 7, 0)); t.after(h.cleanup); // terça-feira
  await h.service.initialize();
  const state = await h.service.saveMedications([medication({ days: [1, 3, 5], times: ['09:00'] })]);
  assert.equal(state.today.length, 0);
  assert.equal(state.nextDose.date, '2026-09-30');
});

test('notifica no horário uma vez, permite snooze e não duplica após repetir o processamento', async t => {
  const h = harness(); t.after(h.cleanup);
  await h.service.initialize();
  await h.service.saveMedications([medication({ days: [1], times: ['08:00'] })]);
  h.now = new Date(2026, 8, 28, 8, 0);
  assert.equal(await h.service.processDue(), 1);
  assert.equal(await h.service.processDue(), 0);
  assert.equal(h.reminders.length, 1);
  const key = h.reminders[0].key;
  let state = await h.service.snooze(key, 5);
  assert.equal(state.nextDose.nextAt, h.now + 5 * 60_000);
  await assert.rejects(h.service.snooze(key, 7), /5, 10, 15 ou 30/);
  h.now += 5 * 60_000;
  assert.equal(await h.service.processDue(), 1);
  assert.equal(h.reminders.length, 2);
  assert.equal(h.reminders[1].snoozed, true);
  assert.equal(await h.service.processDue(), 0);
});

test('não dispara uma fila de notificações antigas depois de suspensão longa', async t => {
  const h = harness(); t.after(h.cleanup);
  await h.service.initialize();
  await h.service.saveMedications([medication({ days: [1], times: ['08:00', '08:30', '09:00'] })]);
  h.now = new Date(2026, 8, 28, 12, 0);
  assert.equal(await h.service.processDue(), 0);
  assert.equal(h.reminders.length, 0);
  assert.equal(h.service.getState().today.filter(item => item.overdue).length, 3);
  assert.equal(NOTICE_GRACE_MS, 120_000);
});

test('marca/desmarca dose, mantém histórico e preserva histórico após excluir medicamento', async t => {
  const h = harness(); t.after(h.cleanup);
  await h.service.initialize();
  let state = await h.service.saveMedications([medication({ days: [1], times: ['08:00'] })]);
  const key = state.today[0].key;
  h.now = new Date(2026, 8, 28, 8, 5);
  state = await h.service.setOccurrence(key, 'taken');
  assert.equal(state.today[0].status, 'taken');
  assert.equal(state.history[0].medicine.name, 'Vitamina D');
  state = await h.service.setOccurrence(key, 'pending');
  assert.equal(state.today[0].status, 'pending');
  await h.service.setOccurrence(key, 'taken');
  state = await h.service.saveMedications([]);
  assert.equal(state.medications.length, 0);
  assert.equal(state.history[0].medicine.name, 'Vitamina D');
});

test('ativar/desativar suspende lembretes futuros e mantém registros locais', async t => {
  const h = harness(); t.after(h.cleanup);
  await h.service.initialize();
  let state = await h.service.saveMedications([medication({ days: [1], times: ['08:00'] })]);
  state = await h.service.saveMedications([{ ...state.medications[0], enabled: false }]);
  assert.equal(state.nextDose, null);
  assert.equal(state.medications[0].enabled, false);
  state = await h.service.saveMedications([{ ...state.medications[0], enabled: true }]);
  assert.equal(state.medications[0].enabled, true);
  assert.equal(state.nextDose.time, '08:00');
});

test('persistência e reinício não repetem notificações já entregues', async t => {
  const h = harness(); t.after(h.cleanup);
  await h.service.initialize();
  let state = await h.service.saveMedications([medication({ days: [1], times: ['08:00'] })]);
  h.now = new Date(2026, 8, 28, 8, 0);
  await h.service.processDue();
  const key = state.today[0].key;
  h.service.close();
  const restart = new MedicineReminderService({ file: path.join(h.directory, 'medicine-reminders.json'), now: () => h.now, notify: reminder => h.reminders.push(reminder), setTimeoutImpl: callback => { const handle = { id: Math.random(), unref() {} }; h.timers.set(handle.id, callback); return handle; }, clearTimeoutImpl: handle => h.timers.delete(handle.id) });
  t.after(() => restart.close());
  state = await restart.initialize();
  assert.equal(state.medications[0].name, 'Vitamina D');
  assert.equal(state.today[0].key, key);
  assert.equal(h.reminders.length, 1);
  state = await restart.setOccurrence(key, 'taken');
  assert.equal(state.history.find(item => item.key === key).status, 'taken');
});

test('o intervalo de tolerância é curto o bastante para não tratar uma retomada distante como atual', () => {
  assert.equal(NOTICE_GRACE_MS, 2 * 60_000);
});
