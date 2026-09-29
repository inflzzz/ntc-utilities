const PACK_IDS = ['ambient-essentials', 'nature', 'water'];
const RELEASE = 'ambient-packs-v1';
const REMOTE_MANIFEST_URL = 'https://raw.githubusercontent.com/inflzzz/ntc-utilities/main/content/ambient-packs.json';
const RELEASE_BASE = `https://github.com/inflzzz/ntc-utilities/releases/download/${RELEASE}`;
const SOUND_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const FILE = /^audio\/[a-z0-9][a-z0-9.-]*\.opus$/;
function fail(message) { throw new Error(message); }
function validatePack(pack) {
  if (!pack || pack.schemaVersion !== 1 || !PACK_IDS.includes(pack.id) || !Number.isSafeInteger(pack.version) || pack.version < 1 || typeof pack.name !== 'string' || !pack.name.trim() || pack.license !== 'CC0' || !Array.isArray(pack.sounds) || !pack.sounds.length || pack.sounds.length > 100) fail('Manifest do pacote inválido.');
  const ids = new Set(), files = new Set();
  for (const sound of pack.sounds) {
    if (!sound || !SOUND_ID.test(sound.id) || typeof sound.name !== 'string' || !sound.name.trim() || typeof sound.category !== 'string' || !FILE.test(sound.file) || !Number.isFinite(sound.duration) || sound.duration < 2 || sound.duration > 600 || sound.loop !== true || !Number.isFinite(sound.defaultVolume) || sound.defaultVolume < 0 || sound.defaultVolume > 100 || !Array.isArray(sound.tags) || sound.tags.some(tag => typeof tag !== 'string' || tag.length > 40) || typeof sound.source !== 'string' || !sound.source || !/^[a-f0-9]{64}$/.test(sound.sha256) || !Number.isSafeInteger(sound.bytes) || sound.bytes < 1000 || sound.bytes > 30_000_000) fail('Som inválido no manifest.');
    if (ids.has(sound.id) || files.has(sound.file)) fail('IDs ou arquivos duplicados no pacote.');
    ids.add(sound.id); files.add(sound.file);
  }
  return pack;
}
function validateDistribution(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.packs) || value.packs.length !== PACK_IDS.length) fail('Catálogo de pacotes inválido.');
  const ids = new Set();
  for (const pack of value.packs) {
    if (!pack || !PACK_IDS.includes(pack.id) || ids.has(pack.id) || !Number.isSafeInteger(pack.version) || pack.version < 1 || typeof pack.name !== 'string' || typeof pack.description !== 'string' || !Number.isSafeInteger(pack.bytes) || pack.bytes < 1000 || pack.bytes > 300_000_000 || !Number.isSafeInteger(pack.installedBytes) || pack.installedBytes < 1000 || pack.installedBytes > 500_000_000 || !/^[a-f0-9]{64}$/.test(pack.sha256) || typeof pack.url !== 'string' || !new RegExp(`^https://github\\.com/inflzzz/ntc-utilities/releases/download/ambient-packs-v[1-9][0-9]*/ntc-${pack.id}-v${pack.version}\\.zip$`).test(pack.url)) fail('Pacote remoto inválido.');
    ids.add(pack.id);
  }
  return value;
}
module.exports = { PACK_IDS, RELEASE, REMOTE_MANIFEST_URL, RELEASE_BASE, validatePack, validateDistribution };
