const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ScreenLightHost, ScreenLightService } = require('../src/screen-light-main.cjs');
const { normalizeSettings } = require('../src/screen-light-model.cjs');

function service() {
  return new ScreenLightService({ file: path.join(os.tmpdir(), 'ntc-screen-light-test-unused.json'), helperFile: '' });
}
const monitor = (index, hdr = 0, gamma = true) => ({ index, id: `\\\\.\\DISPLAY${index + 1}`, name: `Monitor ${index + 1}`, hdr, gamma });

test('per-monitor application skips HDR and honors separate Kelvin overrides', async () => {
  const item = service();
  item.settings = normalizeSettings({ enabled: true, mode: 'manual', manualKelvin: 4500, transitionMs: 0,
    monitorOverrides: { [monitor(1).id]: { enabled: true, kelvin: 3200 } } });
  item.monitors = [monitor(0), monitor(1), monitor(2, 1)];
  const commands = [];
  await item.applyTarget({ send: async command => { commands.push(command); return 'OK\tapplied'; } });
  assert.deepEqual(commands, ['APPLY\t0\t4500\t100\t0', 'APPLY\t1\t3200\t100\t0']);
  assert.equal(item.status, 'active');
});

test('disabling a monitor restores it and does not apply a new ramp', async () => {
  const item = service();
  item.settings = normalizeSettings({ enabled: true, mode: 'manual', manualKelvin: 4000,
    monitorOverrides: { [monitor(1).id]: { enabled: false, kelvin: 2200 } } });
  item.monitors = [monitor(0), monitor(1)];
  const commands = [];
  await item.applyTarget({ send: async command => { commands.push(command); return 'OK\tapplied'; } });
  assert.deepEqual(commands, ['RESTORE_INDEX\t1', 'APPLY\t0\t4000\t100\t0']);
});

test('no supported SDR monitor fails closed without touching gamma', async () => {
  const item = service();
  item.settings = normalizeSettings({ enabled: true });
  item.monitors = [monitor(0, 1), monitor(1, -1)];
  await item.applyTarget({ send: async () => { throw new Error('Gamma must not be called'); } });
  assert.equal(item.status, 'hdr-blocked');
  assert.equal(item.applied, null);
});

test('API failure is not reported as successful application', async () => {
  const item = service();
  item.settings = normalizeSettings({ enabled: true, mode: 'manual', transitionMs: 0 });
  item.monitors = [monitor(0)];
  await item.applyTarget({ send: async () => 'ERROR\tgamma-not-confirmed' });
  assert.equal(item.status, 'partial');
  assert.match(item.error, /gamma-not-confirmed/);
  assert.equal(item.applied, null);
});

test('driver rejection finds a verified lower intensity and reports it', async () => {
  const item = service();
  item.settings = normalizeSettings({ enabled: true, mode: 'manual', manualKelvin: 2200, intensity: 100, transitionMs: 0 });
  item.monitors = [monitor(0)];
  const commands = [];
  await item.applyTarget({ send: async command => {
    commands.push(command);
    return command.endsWith('\t45\t0') ? 'OK\tapplied' : 'ERROR\tgamma-not-confirmed';
  } });
  assert.deepEqual(commands, ['APPLY\t0\t2200\t100\t0', 'APPLY\t0\t2200\t75\t0', 'APPLY\t0\t2200\t60\t0', 'APPLY\t0\t2200\t45\t0']);
  assert.equal(item.applied.intensity, 45);
  assert.match(item.limitation, /45%/);
});

test('pause restores original ramp and never applies a new one', async () => {
  const item = service();
  item.settings = normalizeSettings({ enabled: true, pauseUntil: -1 });
  item.monitors = [monitor(0)];
  const commands = [];
  await item.applyTarget({ send: async command => { commands.push(command); return 'OK\trestored'; } });
  assert.deepEqual(commands, ['RESTORE']);
  assert.equal(item.status, 'paused');
});

test('failed restoration is surfaced instead of claiming the screen is neutral', async () => {
  const item = service();
  item.host = { dead: false, stop: async () => { throw new Error('restore-failed'); } };
  item.status = 'active';
  item.applied = { kelvin: 3000, intensity: 100, dim: 0 };
  await item.refresh();
  assert.equal(item.status, 'error');
  assert.match(item.error, /restore-failed/);
  assert.notEqual(item.status, 'disabled');
});

test('disabled settings persist locally with schema version and do not spawn helper', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-screen-light-'));
  const item = new ScreenLightService({ file: path.join(directory, 'settings.json'), helperFile: 'does-not-exist.exe' });
  try {
    await item.initialize();
    await item.update({ enabled: false, manualKelvin: 3200, intensity: 75 });
    const saved = JSON.parse(fs.readFileSync(item.file, 'utf8'));
    assert.equal(saved.schemaVersion, 1);
    assert.equal(saved.manualKelvin, 3200);
    assert.equal(saved.intensity, 75);
    assert.equal(item.host, null);
  } finally {
    await item.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('native helper can enumerate without changing the display', { skip: process.platform !== 'win32' }, async () => {
  const executable = path.join(__dirname, '..', 'resources', 'bin', 'screen-light-host.exe');
  if (!fs.existsSync(executable)) return;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-screen-light-host-'));
  const helper = new ScreenLightHost(executable, path.join(directory, 'recovery.bin'));
  try {
    await helper.start();
    const rows = await helper.send('LIST', { multiline: true });
    assert.ok(rows.every(row => row.startsWith('D\t')));
    const foreground = await helper.send('FOREGROUND');
    assert.match(foreground, /^F\t/);
  } finally {
    await helper.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
