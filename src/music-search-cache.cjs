'use strict';

class MusicSearchCache {
  constructor({ maxEntries = 32, maxBytes = 20 * 1024 * 1024, ttlMs = 30 * 60 * 1000 } = {}) {
    this.maxEntries = Math.max(1, Math.trunc(maxEntries));
    this.maxBytes = Math.max(1, Math.trunc(maxBytes));
    this.ttlMs = Math.max(1, Math.trunc(ttlMs));
    this.entries = new Map();
    this.bytes = 0;
  }
  sizeOf(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
    return true;
  }
  get(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) { this.delete(key); return null; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key, value, now = Date.now()) {
    const entryKey = String(key);
    const bytes = this.sizeOf(value);
    this.delete(entryKey);
    if (bytes > this.maxBytes) return false;
    this.entries.set(entryKey, { value, bytes, expiresAt: now + this.ttlMs });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value);
    return this.entries.has(entryKey);
  }
}

module.exports = { MusicSearchCache };
