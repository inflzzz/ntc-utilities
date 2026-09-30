const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const { UninstallerHost } = require('../src/uninstaller-main.cjs');

function redIco() {
  const pixels = 32 * 32 * 4, mask = 32 * 4, payload = 40 + pixels + mask;
  const ico = Buffer.alloc(22 + payload); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
  ico[6] = 32; ico[7] = 32; ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(payload, 14); ico.writeUInt32LE(22, 18);
  ico.writeUInt32LE(40, 22); ico.writeInt32LE(32, 26); ico.writeInt32LE(64, 30); ico.writeUInt16LE(1, 34); ico.writeUInt16LE(32, 36); ico.writeUInt32LE(pixels, 42);
  for (let offset = 62; offset < 62 + pixels; offset += 4) { ico[offset + 2] = 255; ico[offset + 3] = 255; }
  return ico;
}
test('native icons read actual ICO pixels, embedded EXE resources, indexed paths and package logos', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const parent = path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests'); fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'icons-')), app = path.join(root, 'Own App'); fs.mkdirSync(app);
  const key = `NTC-Disposable-${randomUUID()}`, ico = path.join(app, 'actual.ico'), exe = path.join(app, 'Own App.exe'); fs.writeFileSync(ico, redIco());
  const ps = (action, values) => { const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'uninstaller-registry-fixture.ps1'), '-Action', action], { input: JSON.stringify({ key, values }), encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); };
  const host = new UninstallerHost({ helper: path.resolve('resources/bin/uninstaller-host.exe'), root: path.join(root, 'uninstaller') });
  t.after(async () => { await host.dispose(); ps('delete'); if (path.dirname(root) === parent && path.basename(root).startsWith('icons-')) fs.rmSync(root, { recursive: true, force: true }); });
  const icon = async displayIcon => { ps('create', { DisplayName: 'Own App', DisplayIcon: displayIcon, InstallLocation: app, UninstallString: `"${exe}" /uninstall` }); const listing = await host.send('list'); const p = listing.items.find(p => p.key.endsWith(`\\${key}`)); assert.ok(p); const data = await host.send('icon', { id: p.id }); assert.match(data, /^data:image\/png;base64,/); return Buffer.from(data.split(',')[1], 'base64'); };
  const red = async data => { const { data: pixels, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); assert.equal(info.width, 32); assert.equal(info.height, 32); const center = (16 * 32 + 16) * 4; assert.ok(pixels[center] > 240 && pixels[center + 1] < 10 && pixels[center + 2] < 10, 'Generic document substituted for the ICO'); };
  await red(await icon(`"${ico}"`));
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const built = spawnSync(compiler, ['/nologo', '/target:exe', `/win32icon:${ico}`, `/out:${exe}`, path.join(__dirname, 'uninstaller-disposable.cs')], { encoding: 'utf8', windowsHide: true }); assert.equal(built.status, 0, built.stdout + built.stderr);
  await red(await icon(`"${exe}",0`));
  await red(await icon(path.join(app, 'missing.ico'))); // Fallback finds own executable, not the shell file type.
  const assets = path.join(app, 'Assets'); fs.mkdirSync(assets);
  await sharp({ create: { width: 44, height: 44, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toFile(path.join(assets, 'App.scale-100.png'));
  fs.writeFileSync(path.join(app, 'AppxManifest.xml'), '<Package><Applications><Application><VisualElements Square44x44Logo="Assets\\App.png"/></Application></Applications></Package>');
  const png = await icon(''); const pixels = await sharp(png).ensureAlpha().raw().toBuffer(); assert.ok(pixels[(16 * 32 + 16) * 4 + 2] > 240, 'Qualified package logo missing');
  await assert.rejects(host.send('icon', { id: 'C:\\Windows\\not-a-program' }), /Atualize/);
});
