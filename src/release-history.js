(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCReleaseHistory = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const valid = value => /^\d+\.\d+\.\d+$/.test(String(value || ''));
  function compare(a, b) {
    const left = String(a).split('.').map(Number), right = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    return 0;
  }
  function text(value) {
    return String(value || '').replace(/\\n/g, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|li|h[1-6]|ul|div)>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  }
  function normalize(entries) {
    const seen = new Set();
    return (Array.isArray(entries) ? entries : []).slice(0, 500).filter(entry => {
      if (!entry || !valid(entry.version) || seen.has(entry.version)) return false;
      seen.add(entry.version); return true;
    }).map(entry => ({ version: entry.version, date: text(entry.date).slice(0, 80), changes: (Array.isArray(entry.changes) ? entry.changes : text(entry.note).split(/\r?\n/))
      .slice(0, 200).map(change => text(change).replace(/^\s*[-*•#]+\s*/, '').trim().slice(0, 6000)).filter(Boolean) }))
      .sort((a, b) => compare(b.version, a.version));
  }
  function between(entries, from, to) {
    if (!valid(to)) return [];
    return normalize(entries).filter(entry => (!valid(from) || compare(entry.version, from) > 0) && compare(entry.version, to) <= 0);
  }
  function fromNotes(notes, version) { return normalize(Array.isArray(notes) ? notes : [{ version, note: notes }]); }
  function createNoticeGate() {
    const dismissed = new Set();
    return { dismiss: update => dismissed.add(`${update.version}:${update.status === 'downloaded' ? 'downloaded' : 'available'}`),
      shouldShow: update => !!update.manual || !dismissed.has(`${update.version}:${update.status === 'downloaded' ? 'downloaded' : 'available'}`) };
  }
  return Object.freeze({ valid, compare, text, normalize, between, fromNotes, createNoticeGate });
});
