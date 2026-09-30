const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { UninstallerHost, UninstallerService } = require('../src/uninstaller-main.cjs');

function fakeService() {
  const calls = [], handlers = new Map(), frame = {}, webContents = { mainFrame: frame, send() {} };
  const host = { async send(action, payload) { calls.push([action, payload]); return action === 'list' ? { items: [] } : { records: [], bytes: 0 }; }, async elevate() {}, dispose() {} };
  const service = new UninstallerService({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: { showMessageBox: async () => ({ response: 0 }) }, shell: {}, app: {}, getWindow: () => ({ webContents, isDestroyed: () => false }), host }).register();
  return { service, calls, handlers, webContents, frame };
}
test('uninstaller IPC rejects foreign renderer and child frame; commands are not exposed', async () => {
  const x = fakeService();
  assert.throws(() => x.handlers.get('uninstaller-clean')({ sender: {}, senderFrame: x.frame }, 'x', []), /autorizada/);
  assert.throws(() => x.handlers.get('uninstaller-list')({ sender: x.webContents, senderFrame: {} }), /autorizada/);
  assert.ok(!x.handlers.has('uninstaller-exec'));
  await assert.rejects(x.service.queue(['C:\\Windows'], false), /fora da lista/);
  assert.equal(x.calls.length, 0);
});
test('uninstaller confirmations use product branding, clear copy and safe cancellation', async () => {
  const x = fakeService(); let options;
  x.service.dialog.showMessageBox = async (_window, config) => { options = config; return { response: 0 }; };
  for (const id of ['one', 'two']) x.service.programs.set(id, { id, name: id === 'one' ? 'Aniimo' : 'Studio', hive: 'HKCU' });
  assert.deepEqual(await x.service.queue(['one'], false, false), { canceled: true });
  assert.equal(options.title, 'NTC Utilities');
  assert.equal(options.message, 'Desinstalar “Aniimo”?');
  assert.ok(!options.detail.includes('Aniimo'), 'Program name must not be duplicated');
  assert.match(options.detail, /sem remoção automática/);
  assert.match(options.detail, /não reiniciará/);
  assert.deepEqual(options.buttons, ['Cancelar', 'Desinstalar programa']);
  assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); assert.equal(options.noLink, true);
  assert.deepEqual(await x.service.queue(['one', 'two'], false, false), { canceled: true });
  assert.equal(options.message, 'Desinstalar 2 programas?');
  assert.match(options.detail, /• Aniimo\n• Studio/); assert.match(options.detail, /um por vez/);
  assert.equal(x.calls.length, 0, 'Cancel must never start an uninstall');
  await x.service.confirm('Outro aviso', 'Detalhes'); assert.equal(options.title, 'NTC Utilities');
});

test('automatic size API only accepts IDs from native inventory and leaves removal metadata untouched', async () => {
  const x = fakeService(), p = { id: 'own', location: 'D:\\OwnApp', fingerprint: 'immutable', size: null };
  x.service.programs.set(p.id, p); let measured;
  x.service.sizes.measure = async (program, force) => { measured = program; assert.equal(force, true); return { bytes: 123, status: 'complete' }; };
  assert.throws(() => x.handlers.get('uninstaller-size')({ sender: x.webContents, senderFrame: x.frame }, 'D:\\OtherApp'), /fora da lista/);
  assert.throws(() => x.handlers.get('uninstaller-size')({ sender: {}, senderFrame: x.frame }, 'own'), /autorizada/);
  const result = await x.handlers.get('uninstaller-size')({ sender: x.webContents, senderFrame: x.frame }, 'own', true);
  assert.equal(result.bytes, 123); assert.strictEqual(measured, p); assert.equal(p.size, null); assert.equal(p.fingerprint, 'immutable'); assert.equal(x.calls.length, 0);
  x.service.sizes.measure = async () => { const error = new Error('Medição cancelada.'); error.name = 'AbortError'; throw error; };
  assert.deepEqual(await x.handlers.get('uninstaller-size')({ sender: x.webContents, senderFrame: x.frame }, 'own'), { canceled: true });
});

test('real icon API uses native inventory IDs, coalesces requests and rejects shell-generic output', async () => {
  const x = fakeService(); x.service.programs.set('own', { id: 'own', icon: 'D:\\own.ico', location: 'D:\\Own App', fingerprint: 'fixed' });
  x.service.host.send = async (action, payload) => { x.calls.push([action, payload]); return 'data:image/png;base64,own-pixels'; };
  const event = { sender: x.webContents, senderFrame: x.frame }, getIcon = x.handlers.get('uninstaller-icon');
  assert.throws(() => getIcon({ sender: {}, senderFrame: x.frame }, 'own'), /autorizada/);
  await assert.rejects(getIcon(event, 'C:\\other.ico'), /fora da lista/);
  const images = await Promise.all([getIcon(event, 'own'), getIcon(event, 'own')]); assert.equal(images[0], images[1]); assert.deepEqual(x.calls, [['icon', { id: 'own' }]]);
  x.service.iconCache.clear(); x.service.host.send = async () => 'file:///generic-document.ico'; assert.equal(await getIcon(event, 'own'), '');
});

test('cleanup validates immutable scan IDs and requires native confirmation including personal data', async () => {
  const x = fakeService(); x.service.scans.set('scan', { program: { name: 'ABC' }, items: [{ id: 'safe', confidence: 'high', eligible: true, personal: true, size: 12 }, { id: 'low', confidence: 'low', eligible: true }] });
  await assert.rejects(x.service.clean('missing', ['safe']), /sessão/);
  await assert.rejects(x.service.clean('scan', ['outside']), /protegido/);
  await assert.rejects(x.service.clean('scan', ['low']), /protegido/);
  await assert.rejects(x.service.clean('scan', ['safe', 'safe']), /inválida/);
  assert.deepEqual(await x.service.clean('scan', ['safe']), { canceled: true });
  assert.equal(x.calls.length, 0);
  let detail;
  x.service.dialog.showMessageBox = async (_window, options) => { detail = options.detail; return { response: 1 }; };
  await x.service.clean('scan', ['safe']); assert.match(detail, /dados pessoais/); assert.equal(x.calls[0][0], 'clean');
});

test('clear history cancels safely, preserves backups by default and revalidates records', async () => {
  const x = fakeService();
  let histories = [{ id: 'empty', name: 'Sem backup', records: [], backupAvailable: false }, { id: 'backup', name: 'Com backup', records: [{ status: 'removed' }], backupAvailable: true }, { id: 'changed', name: 'Backup criado durante confirmação', records: [], backupAvailable: false }];
  x.service.host.send = async (action, payload) => {
    x.calls.push([action, payload]);
    if (action === 'history') return structuredClone(histories);
    if (action === 'purge') { histories = histories.filter(row => row.id !== payload.id); return { deleted: true }; }
  };
  assert.deepEqual(await x.service.clearHistory(), { canceled: true });
  assert.ok(!x.calls.some(([action]) => action === 'purge'));
  x.service.dialog.showMessageBox = async (_window, options) => {
    assert.equal(options.title, 'NTC Utilities'); assert.equal(options.checkboxChecked, false);
    assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
    histories.find(row => row.id === 'changed').backupAvailable = true;
    histories.push({ id: 'new', name: 'Depois da confirmação', records: [], backupAvailable: false });
    return { response: 1, checkboxChecked: false };
  };
  const result = await x.service.clearHistory();
  assert.deepEqual(result, { deleted: 1, retained: 2, errors: [] });
  assert.deepEqual(histories.map(row => row.id), ['backup', 'changed', 'new']);
  x.service.job = { busy: true }; await assert.rejects(x.service.clearHistory(), /Aguarde/);
});

test('clear history only purges backups with explicit consent and retains failures', async () => {
  const x = fakeService(); const rows = [{ id: 'backup', name: 'Backup', records: [{ status: 'removed' }], backupAvailable: true }, { id: 'locked', name: 'Bloqueado', records: [], backupAvailable: false }];
  x.service.dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true });
  x.service.host.send = async (action, payload) => {
    if (action === 'history') return rows;
    if (action === 'purge') { if (payload.id === 'locked') throw new Error('Arquivo em uso'); x.calls.push([action, payload]); return { deleted: true }; }
  };
  const result = await x.service.clearHistory();
  assert.equal(result.deleted, 1); assert.equal(result.retained, 1); assert.deepEqual(result.errors, ['Bloqueado: Arquivo em uso']);
  assert.deepEqual(x.calls, [['purge', { id: 'backup' }]]);
  assert.throws(() => x.handlers.get('uninstaller-clear-history')({ sender: {}, senderFrame: x.frame }), /autorizada/);
});

test('real Windows disposable registry/file fixture: evidence, false positives, backup, restore and conflicts', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const helper = path.resolve('resources/bin/uninstaller-host.exe'); if (!fs.existsSync(helper)) throw new Error('Build uninstaller helper before tests.');
  const root = path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests', randomUUID()), appRoot = path.join(root, 'ABC'), otherRoot = path.join(root, 'ABC Studio');
  fs.mkdirSync(appRoot, { recursive: true }); fs.mkdirSync(otherRoot);
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const exe = path.join(appRoot, 'fixture.exe'); const built = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${exe}`, path.join(__dirname, 'uninstaller-disposable.cs')], { encoding: 'utf8', windowsHide: true }); assert.equal(built.status, 0, built.stdout + built.stderr);
  const key = `NTC-Disposable-${randomUUID()}`, otherKey = `NTC-Disposable-${randomUUID()}`;
  const ps = (action, input) => { const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'uninstaller-registry-fixture.ps1'), '-Action', action], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() ? JSON.parse(r.stdout) : null; };
  const command = `"${exe}" uninstall ${key} "${appRoot}"`;
  ps('create', { key, values: { DisplayName: 'ABC', Publisher: 'Same publisher', InstallLocation: appRoot, UninstallString: command } });
  ps('create', { key: otherKey, values: { DisplayName: 'ABC Studio', Publisher: 'Same publisher', InstallLocation: otherRoot, UninstallString: '"C:\\missing-fixture.exe"' } });
  ps('setRun', { key, command: `"${exe}"` });
  fs.writeFileSync(path.join(appRoot, 'payload.bin'), Buffer.from([5, 6, 7, 8])); fs.mkdirSync(path.join(appRoot, 'saves')); fs.writeFileSync(path.join(appRoot, 'saves', 'game.sav'), 'personal'); fs.writeFileSync(path.join(otherRoot, 'payload.bin'), 'other app');
  const h = new UninstallerHost({ helper, root: path.join(root, 'uninstaller') });
  try {
    const listing = await h.send('list'); const p = listing.items.find(p => p.key.endsWith(`\\${key}`) && p.view === 64); assert.ok(p); assert.equal(p.size, null); assert.ok(listing.items.find(p => p.key.endsWith(`\\${otherKey}`)).broken);
    const scan = await h.send('analyze', { id: p.id, deep: true }); assert.ok(scan.items.every(i => !i.path.includes(otherRoot)));
    const payload = scan.items.find(i => i.path === path.join(appRoot, 'payload.bin')); assert.ok(payload.selected);
    assert.equal(scan.items.find(i => i.path === path.join(appRoot, 'saves')).selected, false);
    await assert.rejects(h.send('clean', { scanId: scan.id, ids: [payload.id] }), /ainda.*registrado/);
    const forced = await h.send('analyze', { id: p.id, forced: true }); const bin = forced.items.find(i => i.path === path.join(appRoot, 'payload.bin'));
    const cleaned = await h.send('clean', { scanId: forced.id, ids: [bin.id] }); assert.equal(cleaned.records[0].status, 'removed', JSON.stringify(cleaned)); assert.equal(cleaned.bytes, 4); assert.equal(fs.existsSync(path.join(appRoot, 'payload.bin')), false);
    fs.writeFileSync(path.join(appRoot, 'payload.bin'), 'conflict'); const conflict = await h.send('restore', { id: cleaned.id }); assert.equal(conflict.records[0].status, 'removed'); assert.match(conflict.records[0].error, /Conflito/); assert.equal(fs.readFileSync(path.join(appRoot, 'payload.bin'), 'utf8'), 'conflict'); fs.unlinkSync(path.join(appRoot, 'payload.bin'));
    const restored = await h.send('restore', { id: cleaned.id }); assert.equal(restored.records[0].status, 'restored'); assert.deepEqual(fs.readFileSync(path.join(appRoot, 'payload.bin')), Buffer.from([5, 6, 7, 8]));
    assert.equal(restored.backupAvailable, false);
    const unicode = path.join(appRoot, 'ação-测试.bin'); fs.writeFileSync(unicode, 'unicode'); const originalTime = fs.statSync(unicode).mtimeMs;
    const unicodeScan = await h.send('analyze', { id: p.id, forced: true }); const unicodeItem = unicodeScan.items.find(i => i.path === unicode); const unicodeClean = await h.send('clean', { scanId: unicodeScan.id, ids: [unicodeItem.id] }); await h.send('restore', { id: unicodeClean.id }); assert.equal(fs.readFileSync(unicode, 'utf8'), 'unicode'); assert.ok(Math.abs(fs.statSync(unicode).mtimeMs - originalTime) < 1);
    fs.linkSync(path.join(otherRoot, 'payload.bin'), path.join(appRoot, 'hardlink.bin')); const hardScan = await h.send('analyze', { id: p.id, forced: true }); const hard = hardScan.items.find(i => i.path.endsWith('hardlink.bin')); const hardClean = await h.send('clean', { scanId: hardScan.id, ids: [hard.id] }); assert.equal(hardClean.records[0].status, 'preserved'); assert.equal(fs.readFileSync(path.join(otherRoot, 'payload.bin'), 'utf8'), 'other app');
    fs.writeFileSync(path.join(appRoot, 'locked.bin'), 'locked'); const lockedScan = await h.send('analyze', { id: p.id, forced: true }); const lockedItem = lockedScan.items.find(i => i.path.endsWith('locked.bin')); const lock = spawn(exe, ['lock', key, appRoot], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); await new Promise((resolve, reject) => { lock.stdout.once('data', resolve); lock.once('error', reject); }); try { const lockedClean = await h.send('clean', { scanId: lockedScan.id, ids: [lockedItem.id] }); assert.equal(lockedClean.records[0].status, 'preserved'); } finally { lock.stdin.end('\n'); await new Promise(resolve => lock.once('exit', resolve)); }
    const regScan = await h.send('analyze', { id: p.id, forced: true }); const run = regScan.items.find(i => i.category === 'Inicialização' && i.path.includes(key)); assert.ok(run);
    const regClean = await h.send('clean', { scanId: regScan.id, ids: [run.id] }); assert.equal(regClean.records[0].status, 'removed'); assert.equal(ps('getRun', { key }).value, null); await h.send('restore', { id: regClean.id }); assert.equal(ps('getRun', { key }).value, `"${exe}"`);
    // Changed files must be preserved rather than silently consuming stale evidence.
    const changedScan = await h.send('analyze', { id: p.id, forced: true }); const changed = changedScan.items.find(i => i.path === path.join(appRoot, 'payload.bin')); fs.appendFileSync(path.join(appRoot, 'payload.bin'), 'new'); const stale = await h.send('clean', { scanId: changedScan.id, ids: [changed.id] }); assert.equal(stale.records[0].status, 'preserved');
    // A junction cannot drag files from another application into the cleanup scope.
    fs.symlinkSync(otherRoot, path.join(appRoot, 'outside'), 'junction'); const linkScan = await h.send('analyze', { id: p.id, forced: true }); const junction = linkScan.items.find(i => i.path.endsWith('\\outside')); assert.equal(junction.eligible, false); await assert.rejects(h.send('clean', { scanId: linkScan.id, ids: [junction.id] }), /ambíguo/);
    // A registered shared folder cannot be owned exclusively by either app.
    ps('create', { key: otherKey, values: { DisplayName: 'ABC Studio', InstallLocation: appRoot, UninstallString: '"C:\\missing-fixture.exe"' } }); await h.send('list'); const shared = await h.send('analyze', { id: p.id, forced: true }); assert.equal(shared.items.filter(i => ['Arquivos', 'Pastas'].includes(i.category)).length, 0);
    ps('create', { key: otherKey, values: { DisplayName: 'ABC Studio', InstallLocation: otherRoot, UninstallString: '"C:\\missing-fixture.exe"' } }); await h.send('list');
    const result = await h.send('uninstall', { id: p.id, fingerprint: p.fingerprint, quiet: true }); assert.equal(result.exitCode, 0); assert.equal(result.stillRegistered, false); assert.ok(result.scan); assert.equal(fs.readFileSync(path.join(otherRoot, 'payload.bin'), 'utf8'), 'other app'); assert.equal(fs.readFileSync(path.join(appRoot, 'saves', 'game.sav'), 'utf8'), 'personal');
    const runRecord = result.scan.items.find(i => i.category === 'Inicialização' && i.path.includes(key)); const finalClean = await h.send('clean', { scanId: result.scan.id, ids: [runRecord.id] }); assert.equal(finalClean.records[0].status, 'removed');
    await assert.rejects(h.send('clean', { scanId: result.scan.id, ids: [runRecord.id] }), /expirada/);
    console.log('Disposable uninstaller fixture: shared folders, personal data, junction, stale evidence, official EXE, registry value backup and quarantine/restore passed.');
  } finally {
    h.dispose(); ps('deleteRun', { key }); ps('delete', { key }); ps('delete', { key: otherKey });
    // This exact directory was created by this test, never a user installation.
    if (path.dirname(root) === path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests')) fs.rmSync(root, { recursive: true, force: true });
  }
});

test('batch is sequential, cancellation stops remaining work, and HKCU does not use privileged cleanup', async () => {
  const x = fakeService(); x.service.dialog.showMessageBox = async () => ({ response: 1 });
  let finish; const first = new Promise(resolve => { finish = resolve; }); const started = [];
  x.service.host.send = async (action, payload) => { if (action === 'uninstall') { started.push(payload.id); await first; return { exitCode: 3010, rebootRequired: true }; } return { items: [] }; };
  x.service.adminHost = { send: async () => { throw new Error('HKCU must not use admin'); } };
  for (const id of ['one', 'two']) x.service.programs.set(id, { id, name: id, hive: 'HKCU', fingerprint: id });
  const job = await x.service.queue(['one', 'two'], true, false); assert.deepEqual(started, ['one']); assert.equal(job.busy, true); job.canceled = true; finish(); await x.service.jobTask; assert.deepEqual(started, ['one']); assert.equal(job.results[0].rebootRequired, true); assert.equal(job.busy, false);
});

test('real per-user disposable MSI is discovered and uninstalled by registered ProductCode', { skip: process.platform !== 'win32', timeout: 60000 }, async () => {
  const root = path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests', randomUUID()); fs.mkdirSync(root, { recursive: true });
  const key = `NTC-Disposable-${randomUUID()}`, product = `{${randomUUID()}}`, source = path.join(process.env.WINDIR, 'Temp', key); const h = new UninstallerHost({ helper: path.resolve('resources/bin/uninstaller-host.exe'), root: path.join(root, 'uninstaller') });
  try {
    const build = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'uninstaller-msi-fixture.ps1'), '-Root', root, '-Product', product, '-Key', key], { encoding: 'utf8', windowsHide: true }); assert.equal(build.status, 0, build.stderr + build.stdout);
    assert.ok(fs.statSync(path.join(root, 'fixture.msi')).size > 0, 'MSI database missing');
    // MSI's SYSTEM worker cannot use this runner's restricted AppData source. Supply a separate disposable source.
    fs.mkdirSync(source); fs.copyFileSync(path.join(root, 'fixture.msi'), path.join(source, 'fixture.msi'));
    const installed = spawnSync(path.join(process.env.WINDIR, 'System32', 'msiexec.exe'), ['/i', path.join(source, 'fixture.msi'), '/qn', '/norestart', '/l*v', path.join(source, 'install.log')], { windowsHide: true }); assert.equal(installed.status, 0, fs.readFileSync(path.join(source, 'install.log'), 'utf16le').slice(-4500));
    const p = (await h.send('list')).items.find(p => p.name === key); assert.ok(p); assert.equal(p.type, 'MSI'); assert.equal(p.productCode.toLowerCase(), product.toLowerCase());
    const result = await h.send('uninstall', { id: p.id, fingerprint: p.fingerprint, quiet: true }); assert.equal(result.exitCode, 0); assert.equal(result.stillRegistered, false);
  } finally { await h.dispose(); spawnSync(path.join(process.env.WINDIR, 'System32', 'msiexec.exe'), ['/x', product, '/qn', '/norestart'], { windowsHide: true }); spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath 'HKCU:\\Software\\${key}' -Recurse -Force -ErrorAction SilentlyContinue`], { windowsHide: true }); if (process.env.NTC_KEEP_MSI_FIXTURE === '1') console.log('Disposable MSI diagnostics: '+root+'; '+source); else { if (path.dirname(root) === path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests')) fs.rmSync(root, { recursive: true, force: true }); if (path.dirname(source) === path.join(process.env.WINDIR, 'Temp') && path.basename(source) === key) fs.rmSync(source, { recursive: true, force: true }); } }
});

test('installation snapshots correlate exclusive paths but do not attribute parallel noise', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const root = path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests', randomUUID()), installedRoot = path.join(root, 'Monitored'), noiseRoot = path.join(root, 'Noise'); fs.mkdirSync(noiseRoot, { recursive: true });
  const key = `NTC-Disposable-${randomUUID()}`, noiseKey = `NTC-Disposable-${randomUUID()}`, installer = path.join(root, 'installer.exe');
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'); const built = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${installer}`, path.join(__dirname, 'uninstaller-disposable.cs')], { encoding: 'utf8', windowsHide: true }); assert.equal(built.status, 0, built.stdout + built.stderr);
  fs.writeFileSync(installer + '.fixture', ['install', key, installedRoot].join('\n')); const noiseFile = path.join(noiseRoot, 'background.bin'); fs.writeFileSync(noiseFile, 'before');
  const ps = (action, input) => { const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'uninstaller-registry-fixture.ps1'), '-Action', action], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); };
  const h = new UninstallerHost({ helper: path.resolve('resources/bin/uninstaller-host.exe'), root: path.join(root, 'uninstaller') });
  try {
    ps('create', { key: noiseKey, values: { DisplayName: 'Disposable noise', InstallLocation: noiseRoot, UninstallString: '"C:\\missing-fixture.exe"' } });
    const pick = await h.send('pick', { path: installer }); const monitor = await h.send('monitorStart', { id: pick.id });
    fs.appendFileSync(noiseFile, 'parallel unrelated change'); await new Promise(resolve => setTimeout(resolve, 500));
    const log = await h.send('monitorFinish', { id: monitor.id }); assert.ok(log.programs.some(p => p.location === installedRoot)); assert.ok(log.changes.some(c => c.path.endsWith('Monitored\\payload.bin') && c.confidence === 'medium'), JSON.stringify(log.changes.slice(-10)));
    const noise = log.changes.find(c => c.path === noiseFile); assert.ok(noise, 'Noise root should be represented'); assert.equal(noise.confidence, 'low'); assert.ok(log.resourceChanges.some(c => c.path.includes(key)));
    const tracked = await h.send('tracked'); assert.equal(tracked.length, 1); assert.ok(log.warnings.join().includes('ETW'));
  } finally { await h.dispose(); ps('deleteRun', { key }); ps('delete', { key }); ps('delete', { key: noiseKey }); if (path.dirname(root) === path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests')) fs.rmSync(root, { recursive: true, force: true }); }
});

test('disposable services, tasks, firewall, shortcuts and protocol backup/restore', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const root = path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests', randomUUID()), appRoot = path.join(root, 'System fixture'); fs.mkdirSync(appRoot, { recursive: true });
  const exe = path.join(appRoot, 'fixture.exe'), key = `NTC-Disposable-${randomUUID()}`; fs.copyFileSync(path.join(process.env.WINDIR, 'System32', 'notepad.exe'), exe);
  const ps = (script, action, input) => { const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, script), '-Action', action], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() ? JSON.parse(r.stdout) : null; };
  const h = new UninstallerHost({ helper: path.resolve('resources/bin/uninstaller-host.exe'), root: path.join(root, 'uninstaller') });
  const data = { key, exe };
  try {
    ps('uninstaller-registry-fixture.ps1', 'create', { key, values: { DisplayName: 'Disposable system fixture', InstallLocation: appRoot, UninstallString: `"${exe}"` } });
    ps('uninstaller-system-fixture.ps1', 'create', data);
    const p = (await h.send('list')).items.find(p => p.key.endsWith(`\\${key}`)); assert.ok(p);
    const scan = await h.send('analyze', { id: p.id, forced: true, deep: true });
    const selected = scan.items.filter(i => ['Serviços', 'Tarefas agendadas', 'Firewall', 'Atalhos', 'Associações / protocolos'].includes(i.category) && i.path.includes(key));
    assert.equal(new Set(selected.map(i => i.category)).size, 5, JSON.stringify(selected)); assert.ok(selected.every(i => i.eligible), JSON.stringify(selected));
    const cleaned = await h.send('clean', { scanId: scan.id, ids: selected.map(i => i.id) }); assert.ok(cleaned.records.every(r => r.status === 'removed'), JSON.stringify(cleaned));
    const absent = ps('uninstaller-system-fixture.ps1', 'get', data); assert.equal(absent.service, false); assert.equal(absent.task, false); assert.equal(absent.firewall, false); assert.equal(absent.shortcut, false); assert.equal(absent.command, null);
    const restored = await h.send('restore', { id: cleaned.id }); assert.ok(restored.records.every(r => r.status === 'restored'), JSON.stringify(restored));
    const present = ps('uninstaller-system-fixture.ps1', 'get', data); assert.equal(present.service, true); assert.equal(present.description, 'NTC disposable description'); assert.equal(present.task, true); assert.equal(present.taskEnabled, true); assert.equal(present.firewall, true); assert.equal(present.ports, '48931'); assert.equal(present.shortcut, true, JSON.stringify({ present, records: restored.records, desktop: fs.readdirSync(path.join(process.env.USERPROFILE, 'Desktop')).filter(name=>name.includes(key)) })); assert.equal(present.command, `"${exe}" "%1"`);
  } finally { await h.dispose(); ps('uninstaller-system-fixture.ps1', 'delete', data); ps('uninstaller-registry-fixture.ps1', 'delete', { key }); if (path.dirname(root) === path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests')) fs.rmSync(root, { recursive: true, force: true }); }
});
