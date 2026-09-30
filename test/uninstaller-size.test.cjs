const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { InstallationSizes, steamSize, measureDirectory } = require('../src/uninstaller-size.cjs');
async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ntc-size-test-'));
  t.after(async () => { if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('ntc-size-test-')) await fs.promises.rm(root, { recursive: true, force: true }); });
  return root;
}
test('installation sizes measure all nested files, including empty directories, instead of registry estimates', async t => {
  const root = await fixture(t), nested = path.join(root, 'nested'); await fs.promises.mkdir(nested);
  await fs.promises.writeFile(path.join(root, 'a.bin'), Buffer.alloc(100)); await fs.promises.writeFile(path.join(nested, 'ação.bin'), Buffer.alloc(23));
  const sizes = new InstallationSizes(); t.after(() => sizes.dispose());
  const p = { id: 'own', location: root, size: 999999, fingerprint: 'fixed' };
  const measured = await sizes.measure(p); assert.equal(measured.bytes, 123); assert.equal(measured.files, 2); assert.equal(measured.partial, false); assert.equal(measured.status, 'complete');
  assert.equal(p.location, root); assert.equal(p.size, 999999); assert.equal(p.fingerprint, 'fixed', 'Read-only sizing must not change removal identity');
  const empty = path.join(root, 'empty'); await fs.promises.mkdir(empty); assert.equal((await measureDirectory(empty)).bytes, 0);
});
test('size cache is coalesced and forced/manual refresh measures changed contents', async t => {
  const root = await fixture(t); const file = path.join(root, 'data'); await fs.promises.writeFile(file, 'abc');
  const sizes = new InstallationSizes(); t.after(() => sizes.dispose()); const p = { id: 'own', location: root };
  const first = await sizes.measure(p); await fs.promises.writeFile(file, 'abcdef');
  assert.strictEqual(await sizes.measure(p), first); assert.equal((await sizes.measure(p, true)).bytes, 6);
  await fs.promises.writeFile(file, 'abcdefghi'); sizes.invalidate(); assert.equal((await sizes.measure(p)).bytes, 9);
});
test('root junctions resolve once while internal links are excluded and labelled partial', async t => {
  const root = await fixture(t), app = path.join(root, 'app'), other = path.join(root, 'other');
  await fs.promises.mkdir(app); await fs.promises.mkdir(other); await fs.promises.writeFile(path.join(app, 'own.bin'), Buffer.alloc(5)); await fs.promises.writeFile(path.join(other, 'other.bin'), Buffer.alloc(1000));
  await fs.promises.symlink(other, path.join(app, 'link'), 'junction'); await fs.promises.symlink(app, path.join(root, 'root-link'), 'junction');
  const sizes = new InstallationSizes(); t.after(() => sizes.dispose());
  const result = await sizes.measure({ id: 'own', location: path.join(root, 'root-link') });
  assert.equal(result.bytes, 5); assert.equal(result.partial, true); assert.equal(result.skipped, 1); assert.match(result.reason, /junctions/);
});
test('Steam manifest is validated against app ID and installation path then actual files are measured', async t => {
  const root = await fixture(t), steamapps = path.join(root, 'steamapps'), app = path.join(steamapps, 'common', 'Own Game');
  await fs.promises.mkdir(app, { recursive: true }); await fs.promises.writeFile(path.join(app, 'game.bin'), Buffer.alloc(42));
  const manifest = path.join(steamapps, 'appmanifest_123.acf'), p = { id: 'steam', key: 'Software\\Uninstall\\Steam App 123', location: app };
  const write = (appId, dir, size) => fs.promises.writeFile(manifest, `"AppState"\n{\n "appid" "${appId}"\n "installdir" "${dir}"\n "SizeOnDisk" "${size}"\n}\n`);
  await write('123', 'Own Game', '999'); assert.equal((await steamSize(p)).bytes, 999);
  const sizes = new InstallationSizes(); t.after(() => sizes.dispose()); assert.equal((await sizes.initial(p)).size, 999); assert.equal((await sizes.measure(p)).bytes, 42);
  await write('124', 'Own Game', '999'); assert.equal(await steamSize(p), null);
  await write('123', '../other', '999'); assert.equal(await steamSize(p), null);
  await write('123', 'Own Game', 'not a size'); assert.equal(await steamSize(p), null);
  await write('123', 'Own Game', '9007199254740993'); assert.equal(await steamSize(p), null);
});
test('missing folders and broad roots are not displayed as zero or silently measured as the whole disk', async t => {
  const root = await fixture(t), sizes = new InstallationSizes(); t.after(() => sizes.dispose());
  const missing = await sizes.measure({ id: 'missing', location: path.join(root, 'missing') }); assert.equal(missing.bytes, null); assert.equal(missing.status, 'unavailable'); assert.ok(missing.reason);
  const broad = await sizes.measure({ id: 'broad', location: path.parse(root).root }); assert.equal(broad.bytes, null);
  const registered = await sizes.measure({ id: 'registered', location: path.join(root, 'missing'), size: 2048 }); assert.equal(registered.bytes, 2048); assert.equal(registered.status, 'registered'); assert.match(registered.reason, /verificar/);
});
test('inferred executable folder is sizing-only and aborted scans do not return fake totals', async t => {
  const root = await fixture(t), sizes = new InstallationSizes(); t.after(() => sizes.dispose()); await fs.promises.writeFile(path.join(root, 'own.exe'), 'own');
  const p = { id: 'exe', command: `"${path.join(root, 'own.exe')}" /uninstall`, location: '' };
  const result = await sizes.measure(p); assert.equal(result.bytes, 3); assert.equal(result.inferred, true); assert.equal(p.location, '');
  const controller = new AbortController(); controller.abort(); await assert.rejects(measureDirectory(root, controller.signal), { name: 'AbortError' });
});
