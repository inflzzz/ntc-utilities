const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Lembrete de Medicamentos está em Utilidades, com cadastro, agenda, histórico e inicialização opcional', () => {
  const html = read('src/index.html'), app = read('src/app.js'), ui = read('src/medicine-reminders-ui.js'), catalog = read('src/catalog.js'), styles = read('src/styles.css');
  assert.match(catalog, /\['health', 'Saúde e bem-estar', 'health'\]/);
  assert.match(catalog, /add\('health'.*\['medicineReminders', 'Lembrete de Medicamentos', 'medicineReminders'/);
  assert.doesNotMatch(html, /data-open-tool="medicineReminders"|data-view="medicineReminders"/);
  assert.match(styles, /#medicineRemindersView \{ display: none; \}/);
  assert.match(styles, /#medicineRemindersView\.active \{ display: grid; \}/);
  for (const id of ['medicineRemindersView', 'medicineTodayList', 'medicineList', 'medicineHistory', 'medicineEditorDialog', 'medicineLaunchAtLogin']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /Todos os dias/);
  assert.match(html, /Dias úteis/);
  assert.match(html, /Fim de semana/);
  assert.match(app, /target === 'medicineReminders'.*NTCMedicineReminders/);
  assert.match(ui, /Marcar como tomado/);
  assert.match(ui, /Lembrar novamente/);
});

test('notificações e timers são administrados no processo principal e persistidos localmente', () => {
  const main = read('main.cjs'), preload = read('preload.cjs'), service = read('src/medicine-reminders.cjs');
  assert.match(main, /new MedicineReminderService/);
  assert.match(main, /medicine-reminders\.json/);
  assert.match(main, /new Notification\(\{ title: 'Hora do medicamento'/);
  assert.match(main, /powerMonitor\.on\('resume'.*refreshAfterResume/s);
  assert.match(preload, /medicine-reminders-snooze/);
  assert.match(service, /this\.setTimeout\(/);
  assert.match(service, /await this\.persist\(\)/);
});
