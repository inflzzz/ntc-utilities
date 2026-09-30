'use strict';
// Read-only public downloads; Ambient installation uses a new, isolated test directory.
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const assert = require('node:assert/strict');
const { AmbientPackService } = require('../src/ambient-packs.cjs'); const { validateDistribution, REMOTE_MANIFEST_URL } = require('../src/ambient-schema.cjs');
const { fetchHistory } = require('../src/update-service.cjs'); const history = require('../src/release-history.js'); const YAML = require('yaml');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
async function run() {
  const local = path.resolve(process.argv[2] || path.join(root, 'tmp', `release-${version}`));
  const metadata = YAML.parse(fs.readFileSync(path.join(local, 'latest.yml'), 'utf8'));
  assert.equal(metadata.version, version); assert.equal(metadata.path, `NTC.Utilities.Setup.${version}.exe`);
  const installer = fs.readFileSync(path.join(local, metadata.path)); assert.equal(installer.length, metadata.files[0].size);
  assert.equal(crypto.createHash('sha512').update(installer).digest('base64'), metadata.sha512);
  assert.ok(fs.statSync(path.join(local, metadata.path + '.blockmap')).size > 0);
  const complete = JSON.parse(fs.readFileSync(path.join(local, 'changelog.json'), 'utf8')); assert.equal(complete.version, version);
  console.log(JSON.stringify({ localVersion: version, installerBytes: installer.length, hashVerified: true, historyVersions: complete.releases.length }));
  if (process.argv.includes('--public')) {
    const base = `https://github.com/inflzzz/ntc-utilities/releases/download/v${version}/`;
    const manifest = await fetch(base + 'latest.yml', { signal: AbortSignal.timeout(30000) }); assert.equal(manifest.ok, true);
    const remote = YAML.parse(await manifest.text()); assert.deepEqual(remote, metadata);
    const response = await fetch(base + metadata.path, { signal: AbortSignal.timeout(180000) }); assert.equal(response.ok, true);
    let bytes = 0; const digest = crypto.createHash('sha512'); for await (const chunk of response.body) { bytes += chunk.length; digest.update(chunk); }
    assert.equal(bytes, installer.length); assert.equal(digest.digest('base64'), metadata.sha512);
    const map = await fetch(base + metadata.path + '.blockmap', { signal: AbortSignal.timeout(30000) }); assert.equal(map.ok, true);
    assert.deepEqual(Buffer.from(await map.arrayBuffer()), fs.readFileSync(path.join(local, metadata.path + '.blockmap')));
    const entries = await fetchHistory(version); assert.equal(entries.length, complete.releases.length);
    console.log(JSON.stringify({ publicInstallerBytes: bytes, publicHashVerified: true, skippedSince100: history.between(entries, '1.0.0', version).map(entry => entry.version) }));
  }
  const fetched = await fetch(REMOTE_MANIFEST_URL, { signal: AbortSignal.timeout(30000) }); assert.equal(fetched.ok, true);
  const catalog = validateDistribution(await fetched.json());
  assert.deepEqual(catalog, validateDistribution(JSON.parse(fs.readFileSync(path.join(root, 'content', 'ambient-packs.json'), 'utf8'))));
  const tempParent = path.join(root, 'tmp'); fs.mkdirSync(tempParent, { recursive: true }); const own = fs.mkdtempSync(path.join(tempParent, 'release-download-validation-'));
  const service = new AmbientPackService({ root: own, catalogFile: path.join(root, 'content', 'ambient-packs.json') }); await service.initialize(); service.remote = catalog;
  for (const pack of catalog.packs) { const state = await service.download(pack.id); assert.equal(state.installed[pack.id].version, pack.version); console.log(`Ambient download + archive/audio integrity passed: ${pack.id}`); }
  const state = await service.state(); const sounds = Object.values(state.installed).flatMap(pack => pack.manifest.sounds); assert.equal(sounds.length, 24);
  for (const sound of sounds) assert.ok((await service.audio(sound.id)).length > 1000);
  console.log(JSON.stringify({ ambientPacks: 3, playableSounds: sounds.length, isolatedDirectory: own }));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
