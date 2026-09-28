const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_QUOTA_BYTES = 250 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 60;
const MAX_SAFE_RETENTION_DAYS = Number.MAX_SAFE_INTEGER;
const ID_PATTERN = /^[a-f0-9]{32}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function normalizeSettings(value = {}) {
  const quota = Number(value.quotaBytes);
  const retention = value.retentionDays === null ? null : Number(value.retentionDays);
  return {
    quotaBytes: Number.isSafeInteger(quota) && quota > 0 ? quota : DEFAULT_QUOTA_BYTES,
    retentionDays: retention === null ? null : Number.isSafeInteger(retention) && retention >= 1 && retention <= MAX_SAFE_RETENTION_DAYS ? retention : DEFAULT_RETENTION_DAYS
  };
}

function validateSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, message: 'Configurações inválidas.' };
  const quotaBytes = Number(value.quotaBytes);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes < 1) return { ok: false, message: 'Informe um limite de armazenamento válido.' };
  let retentionDays = value.retentionDays;
  if (retentionDays !== null) {
    retentionDays = Number(retentionDays);
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_SAFE_RETENTION_DAYS) return { ok: false, message: 'Informe um prazo válido em dias ou escolha Nunca.' };
  }
  return { ok: true, settings: { quotaBytes, retentionDays } };
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || !ID_PATTERN.test(String(value.id || '')) || !HASH_PATTERN.test(String(value.hash || ''))) return null;
  const hasText = Boolean(value.hasText);
  const hasImage = Boolean(value.hasImage);
  if (!hasText && !hasImage) return null;
  const sizeBytes = Number(value.sizeBytes);
  const createdAt = Number(value.createdAt);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || !Number.isFinite(createdAt) || createdAt < 0) return null;
  return {
    id: value.id,
    hash: value.hash,
    kind: hasText && hasImage ? 'mixed' : hasImage ? 'image' : 'text',
    hasText,
    hasImage,
    sizeBytes,
    createdAt,
    pinned: Boolean(value.pinned),
    textPreview: hasText && typeof value.textPreview === 'string' ? value.textPreview.slice(0, 600) : ''
  };
}

function normalizeManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.entries)) return null;
  const seen = new Set();
  const entries = [];
  for (const item of value.entries) {
    const entry = normalizeEntry(item);
    if (!entry || seen.has(entry.id)) return null;
    seen.add(entry.id);
    entries.push(entry);
  }
  entries.sort((a, b) => b.createdAt - a.createdAt);
  return { version: 1, settings: normalizeSettings(value.settings), entries };
}

function isExpired(entry, settings, now) {
  return !entry.pinned && settings.retentionDays !== null && Math.max(0, now - entry.createdAt) / DAY_MS >= settings.retentionDays;
}

function totalBytes(entries) {
  return entries.reduce((sum, entry) => Math.min(Number.MAX_SAFE_INTEGER, sum + entry.sizeBytes), 0);
}

class ClipboardHistoryStore {
  constructor(userDataPath, options = {}) {
    if (typeof userDataPath !== 'string' || !userDataPath.trim()) throw new TypeError('A pasta de dados do usuário é obrigatória.');
    this.rootPath = path.join(userDataPath, 'ntc-clipboard');
    this.itemsPath = path.join(this.rootPath, 'items');
    this.manifestPath = path.join(this.rootPath, 'history.json');
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => crypto.randomBytes(16).toString('hex');
    this.manifest = { version: 1, settings: normalizeSettings(), entries: [] };
    this.warning = '';
    this.unavailable = false;
    this.queue = Promise.resolve();
    this.ready = this.initialize();
  }

  async initialize() {
    await fs.mkdir(this.itemsPath, { recursive: true });
    let loaded = null;
    let manifestExists = true;
    try { loaded = normalizeManifest(JSON.parse(await fs.readFile(this.manifestPath, 'utf8'))); }
    catch (error) {
      if (error.code === 'ENOENT') manifestExists = false;
      else this.warning = 'Não foi possível ler o histórico. Os dados existentes foram preservados.';
    }
    if (manifestExists && !loaded) {
      this.unavailable = true;
      this.warning = 'Não foi possível ler o histórico. Os dados existentes foram preservados.';
    }
    if (loaded) this.manifest = loaded;

    if (loaded) {
      const originalEntries = this.manifest.entries;
      const entries = this.pruneExpired(originalEntries, this.manifest.settings, this.now());
      const pruned = this.pruneQuota(entries, this.manifest.settings.quotaBytes);
      const retainedIds = new Set(pruned.entries.map(entry => entry.id));
      if (pruned.entries.length !== originalEntries.length) {
        await this.writeManifest({ ...this.manifest, entries: pruned.entries });
        this.manifest = { ...this.manifest, entries: pruned.entries };
        await this.removeEntryFiles(originalEntries.filter(entry => !retainedIds.has(entry.id)));
      }
      await this.removeOrphanFiles();
    } else if (!manifestExists) {
      await this.writeManifest(this.manifest);
    }
  }

  async runExclusive(action) {
    await this.ready;
    const result = this.queue.then(action, action);
    this.queue = result.catch(() => {});
    return result;
  }

  pruneExpired(entries, settings, now) {
    return entries.filter(entry => !isExpired(entry, settings, now));
  }

  pruneQuota(entries, quotaBytes) {
    const kept = [...entries].sort((a, b) => b.createdAt - a.createdAt);
    let usedBytes = totalBytes(kept);
    const removed = [];
    for (const entry of [...kept].sort((a, b) => a.createdAt - b.createdAt)) {
      if (usedBytes <= quotaBytes) break;
      if (entry.pinned) continue;
      const index = kept.findIndex(candidate => candidate.id === entry.id);
      if (index < 0) continue;
      kept.splice(index, 1);
      removed.push(entry);
      usedBytes -= entry.sizeBytes;
    }
    return { entries: kept.sort((a, b) => b.createdAt - a.createdAt), removed, usedBytes, overLimit: usedBytes > quotaBytes };
  }

  entryFiles(entry) {
    return [entry.hasText ? `${entry.id}.txt` : '', entry.hasImage ? `${entry.id}.png` : ''].filter(Boolean);
  }

  async removeEntryFiles(entries) {
    await Promise.all(entries.flatMap(entry => this.entryFiles(entry).map(file => fs.rm(path.join(this.itemsPath, file), { force: true }).catch(() => {}))));
  }

  async removeOrphanFiles() {
    let files;
    try { files = await fs.readdir(this.itemsPath); } catch { return; }
    const referenced = new Set(this.manifest.entries.flatMap(entry => this.entryFiles(entry)));
    await Promise.all(files.filter(file => /^[a-f0-9]{32}\.(?:txt|png)$/.test(file) && !referenced.has(file)).map(file => fs.rm(path.join(this.itemsPath, file), { force: true }).catch(() => {})));
  }

  async writeManifest(manifest) {
    const temporary = `${this.manifestPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(temporary, JSON.stringify(manifest), { encoding: 'utf8', flag: 'wx' });
    try { await fs.rename(temporary, this.manifestPath); }
    catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
  }

  async writePayload(id, extension, buffer) {
    const finalPath = path.join(this.itemsPath, `${id}.${extension}`);
    const temporary = `${finalPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(temporary, buffer, { flag: 'wx' });
    try { await fs.rename(temporary, finalPath); }
    catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
  }

  async commit(entries, settings = this.manifest.settings) {
    const manifest = { version: 1, settings: normalizeSettings(settings), entries: entries.sort((a, b) => b.createdAt - a.createdAt) };
    await this.writeManifest(manifest);
    this.manifest = manifest;
  }

  getStateData() {
    const usedBytes = totalBytes(this.manifest.entries);
    return {
      settings: { ...this.manifest.settings },
      count: this.manifest.entries.length,
      usedBytes,
      overLimit: usedBytes > this.manifest.settings.quotaBytes,
      unavailable: this.unavailable,
      warning: this.warning
    };
  }

  async getState() {
    await this.ready;
    await this.queue;
    return this.getStateData();
  }

  async saveSettings(value) {
    const validation = validateSettings(value);
    if (!validation.ok) return validation;
    return this.runExclusive(async () => {
      if (this.unavailable) return { ok: false, message: this.warning, ...this.getStateData() };
      const before = this.manifest.entries;
      const ageKept = this.pruneExpired(before, validation.settings, this.now());
      const result = this.pruneQuota(ageKept, validation.settings.quotaBytes);
      await this.commit(result.entries, validation.settings);
      const retained = new Set(result.entries.map(entry => entry.id));
      await this.removeEntryFiles(before.filter(entry => !retained.has(entry.id)));
      return { ok: true, removedCount: before.length - result.entries.length, ...this.getStateData() };
    });
  }

  async record({ text = '', image = null } = {}) {
    return this.runExclusive(async () => {
      if (this.unavailable) return { saved: false, reason: 'storage-unavailable', message: this.warning, ...this.getStateData() };
      const textValue = typeof text === 'string' ? text : '';
      const hasText = textValue.length > 0;
      const textSizeBytes = hasText ? Buffer.byteLength(textValue, 'utf8') : 0;
      const imageBuffer = Buffer.isBuffer(image) && image.length ? image : null;
      if (!textSizeBytes && !imageBuffer) return { saved: false, reason: 'empty', ...this.getStateData() };

      const now = this.now();
      const original = this.manifest.entries;
      let entries = this.pruneExpired(original, this.manifest.settings, now);
      const hashBuilder = crypto.createHash('sha256').update('ntc-clipboard-v1\0');
      if (hasText) hashBuilder.update('text\0').update(String(textSizeBytes)).update('\0').update(textValue, 'utf8');
      if (imageBuffer) hashBuilder.update('image\0').update(String(imageBuffer.length)).update('\0').update(imageBuffer);
      const hash = hashBuilder.digest('hex');
      const sizeBytes = textSizeBytes + (imageBuffer?.length || 0);
      const duplicate = entries.find(entry => entry.hash === hash);

      if (duplicate) {
        const update = { ...duplicate, createdAt: now, sizeBytes, textPreview: hasText ? textValue.slice(0, 600) : '' };
        const retained = this.pruneQuota(entries.filter(entry => entry.id !== duplicate.id), this.manifest.settings.quotaBytes).entries;
        await this.commit([update, ...retained], this.manifest.settings);
        const retainedIds = new Set(this.manifest.entries.map(entry => entry.id));
        await this.removeEntryFiles(original.filter(entry => !retainedIds.has(entry.id)));
        this.warning = '';
        return { saved: true, deduplicated: true, item: this.publicEntry(update), ...this.getStateData() };
      }

      if (sizeBytes > this.manifest.settings.quotaBytes) {
        const pruned = this.pruneQuota(entries, this.manifest.settings.quotaBytes);
        const retainedIds = new Set(pruned.entries.map(entry => entry.id));
        if (pruned.entries.length !== original.length) {
          await this.commit(pruned.entries, this.manifest.settings);
          await this.removeEntryFiles(original.filter(entry => !retainedIds.has(entry.id)));
        }
        this.warning = 'Este item é maior que o limite de armazenamento; aumente a cota para salvá-lo.';
        return { saved: false, reason: 'item-exceeds-limit', ...this.getStateData() };
      }

      const pruned = this.pruneQuota(entries, this.manifest.settings.quotaBytes);
      entries = pruned.entries;

      let space = totalBytes(entries) + sizeBytes;
      const victims = [];
      for (const entry of [...entries].sort((a, b) => a.createdAt - b.createdAt)) {
        if (space <= this.manifest.settings.quotaBytes) break;
        if (entry.pinned) continue;
        victims.push(entry);
        space -= entry.sizeBytes;
      }
      if (space > this.manifest.settings.quotaBytes) {
        if (entries.length !== original.length) {
          const retained = new Set(entries.map(entry => entry.id));
          await this.commit(entries, this.manifest.settings);
          await this.removeEntryFiles(original.filter(entry => !retained.has(entry.id)));
        }
        this.warning = 'O limite foi atingido e os itens restantes estão fixados. Aumente a cota ou remova algum item para continuar.';
        return { saved: false, reason: 'quota-pinned', ...this.getStateData() };
      }

      const id = this.idFactory();
      if (!ID_PATTERN.test(String(id)) || original.some(entry => entry.id === id)) throw new Error('Não foi possível gerar um identificador seguro para o item.');
      const entry = {
        id,
        hash,
        kind: hasText && imageBuffer ? 'mixed' : imageBuffer ? 'image' : 'text',
        hasText,
        hasImage: Boolean(imageBuffer),
        sizeBytes,
        createdAt: now,
        pinned: false,
        textPreview: hasText ? textValue.slice(0, 600) : ''
      };
      const victimIds = new Set(victims.map(item => item.id));
      const nextEntries = [entry, ...entries.filter(item => !victimIds.has(item.id))];
      const payloads = [];
      const textBuffer = hasText ? Buffer.from(textValue, 'utf8') : null;
      try {
        if (textBuffer) { await this.writePayload(id, 'txt', textBuffer); payloads.push(`${id}.txt`); }
        if (imageBuffer) { await this.writePayload(id, 'png', imageBuffer); payloads.push(`${id}.png`); }
        await this.commit(nextEntries, this.manifest.settings);
      } catch (error) {
        await Promise.all(payloads.map(file => fs.rm(path.join(this.itemsPath, file), { force: true }).catch(() => {})));
        throw error;
      }
      const retainedIds = new Set(nextEntries.map(item => item.id));
      await this.removeEntryFiles(original.filter(item => !retainedIds.has(item.id)));
      this.warning = '';
      return { saved: true, deduplicated: false, item: this.publicEntry(entry), ...this.getStateData() };
    });
  }

  publicEntry(entry) {
    return { id: entry.id, kind: entry.kind, hasText: entry.hasText, hasImage: entry.hasImage, sizeBytes: entry.sizeBytes, createdAt: entry.createdAt, pinned: entry.pinned, textPreview: entry.textPreview };
  }

  async list({ filter = 'all', query = '', offset = 0, limit = 40 } = {}) {
    return this.runExclusive(async () => {
      const safeFilter = ['all', 'text', 'image', 'pinned'].includes(filter) ? filter : 'all';
      const safeQuery = typeof query === 'string' ? query.trim().toLocaleLowerCase().slice(0, 250) : '';
      const safeOffset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
      const safeLimit = Number.isSafeInteger(Number(limit)) ? Math.max(1, Math.min(MAX_PAGE_SIZE, Number(limit))) : 40;
      const matches = [];
      for (const entry of this.manifest.entries) {
        if (safeFilter === 'pinned' && !entry.pinned) continue;
        if (safeFilter === 'text' && !entry.hasText) continue;
        if (safeFilter === 'image' && !entry.hasImage) continue;
        if (safeQuery) {
          if (!entry.hasText) continue;
          let text;
          try { text = await fs.readFile(path.join(this.itemsPath, `${entry.id}.txt`), 'utf8'); }
          catch { text = entry.textPreview; }
          if (!text.toLocaleLowerCase().includes(safeQuery)) continue;
        }
        matches.push(entry);
      }
      const page = matches.slice(safeOffset, safeOffset + safeLimit).map(entry => this.publicEntry(entry));
      return { items: page, total: matches.length, offset: safeOffset, limit: safeLimit, hasMore: safeOffset + page.length < matches.length };
    });
  }

  async readItem(id) {
    return this.runExclusive(async () => {
      if (!ID_PATTERN.test(String(id || ''))) return null;
      const entry = this.manifest.entries.find(item => item.id === id);
      if (!entry) return null;
      let text = '';
      let image = null;
      try { if (entry.hasText) text = await fs.readFile(path.join(this.itemsPath, `${entry.id}.txt`), 'utf8'); }
      catch { throw new Error('O texto salvo desse item não está disponível.'); }
      try { if (entry.hasImage) image = await fs.readFile(path.join(this.itemsPath, `${entry.id}.png`)); }
      catch { throw new Error('A imagem salva desse item não está disponível.'); }
      return { entry: this.publicEntry(entry), text, image };
    });
  }

  async setPinned(id, pinned) {
    if (!ID_PATTERN.test(String(id || '')) || typeof pinned !== 'boolean') return { ok: false, message: 'Item ou opção inválida.' };
    return this.runExclusive(async () => {
      if (this.unavailable) return { ok: false, message: this.warning, ...this.getStateData() };
      const original = this.manifest.entries;
      const found = original.find(entry => entry.id === id);
      if (!found) return { ok: false, message: 'Esse item não existe mais.' };
      const changed = original.map(entry => entry.id === id ? { ...entry, pinned } : entry);
      const ageKept = this.pruneExpired(changed, this.manifest.settings, this.now());
      const pruned = this.pruneQuota(ageKept, this.manifest.settings.quotaBytes);
      await this.commit(pruned.entries, this.manifest.settings);
      const retained = new Set(pruned.entries.map(entry => entry.id));
      await this.removeEntryFiles(original.filter(entry => !retained.has(entry.id)));
      this.warning = '';
      return { ok: true, removedCount: original.length - pruned.entries.length, ...this.getStateData() };
    });
  }

  async deleteItem(id) {
    if (!ID_PATTERN.test(String(id || ''))) return { ok: false, message: 'Item inválido.' };
    return this.runExclusive(async () => {
      if (this.unavailable) return { ok: false, message: this.warning, ...this.getStateData() };
      const original = this.manifest.entries;
      const removed = original.find(entry => entry.id === id);
      if (!removed) return { ok: false, message: 'Esse item não existe mais.' };
      const entries = original.filter(entry => entry.id !== id);
      await this.commit(entries, this.manifest.settings);
      await this.removeEntryFiles([removed]);
      this.warning = '';
      return { ok: true, ...this.getStateData() };
    });
  }

  async clear() {
    return this.runExclusive(async () => {
      if (this.unavailable) return { ok: false, message: this.warning, ...this.getStateData() };
      const removedCount = this.manifest.entries.length;
      const removed = this.manifest.entries;
      await this.commit([], this.manifest.settings);
      await this.removeEntryFiles(removed);
      this.warning = '';
      return { ok: true, removedCount, ...this.getStateData() };
    });
  }
}

module.exports = {
  ClipboardHistoryStore,
  DEFAULT_QUOTA_BYTES,
  DEFAULT_RETENTION_DAYS,
  DAY_MS,
  MAX_PAGE_SIZE,
  isExpired,
  normalizeEntry,
  normalizeManifest,
  normalizeSettings,
  totalBytes,
  validateSettings
};
