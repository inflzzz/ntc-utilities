/* Bounded local persistence for Sorteios & Jogos; independent from NTC RNG saves. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCRandomToolsState = api;
})(globalThis, () => {
  const nonNegative = (value, fallback = 0) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  const cleanOptions = options => Array.isArray(options) ? options.slice(0, 1000).map(option => ({
    label: String(option?.label || '').trim().slice(0, 160),
    weight: Number.isSafeInteger(Number(option?.weight)) && Number(option.weight) > 0 && Number(option.weight) <= 1_000_000 ? Number(option.weight) : 1
  })).filter(option => option.label) : [];
  const freshData = () => ({
    version: 1, favorites: [], recent: [], skipMotion: false,
    coin: { heads: 0, tails: 0 }, rps: { wins: 0, draws: 0, losses: 0 },
    records: { reactionBest: null, reactionSamples: [], cpsBest: 0, higherBest: 0, guesses: {} },
    wheels: [], lists: []
  });
  function normalize(raw, validToolIds) {
    const fresh = freshData();
    if (!raw || raw.version !== 1) return fresh;
    const cleanIds = value => Array.isArray(value) ? [...new Set(value.filter(id => validToolIds.has(id)))].slice(0, validToolIds.size) : [];
    const guesses = {};
    for (const difficulty of ['easy', 'normal', 'hard', 'custom']) {
      const attempts = Number(raw.records?.guesses?.[difficulty]);
      if (Number.isSafeInteger(attempts) && attempts > 0 && attempts <= 1_000_000) guesses[difficulty] = attempts;
    }
    return {
      ...fresh, skipMotion: Boolean(raw.skipMotion), favorites: cleanIds(raw.favorites), recent: cleanIds(raw.recent),
      coin: { heads: nonNegative(raw.coin?.heads), tails: nonNegative(raw.coin?.tails) },
      rps: { wins: nonNegative(raw.rps?.wins), draws: nonNegative(raw.rps?.draws), losses: nonNegative(raw.rps?.losses) },
      records: {
        reactionBest: Number.isFinite(Number(raw.records?.reactionBest)) && Number(raw.records.reactionBest) > 0 ? Number(raw.records.reactionBest) : null,
        reactionSamples: Array.isArray(raw.records?.reactionSamples) ? raw.records.reactionSamples.filter(value => Number.isFinite(value) && value > 0 && value < 60_000).slice(-50) : [],
        cpsBest: nonNegative(raw.records?.cpsBest), higherBest: nonNegative(raw.records?.higherBest), guesses
      },
      wheels: Array.isArray(raw.wheels) ? raw.wheels.slice(0, 100).filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
        .map(item => ({ id: item.id.slice(0, 100), name: item.name.trim().slice(0, 60), options: cleanOptions(item.options), removeWinner: Boolean(item.removeWinner) })).filter(item => item.id && item.name) : [],
      lists: Array.isArray(raw.lists) ? raw.lists.slice(0, 100).filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
        .map(item => ({ id: item.id.slice(0, 100), name: item.name.trim().slice(0, 60), items: Array.isArray(item.items) ? item.items.slice(0, 10000).map(value => String(value).slice(0, 1000)) : [] })).filter(item => item.id && item.name) : []
    };
  }
  function createStore(storage, key, toolIds) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new TypeError('Armazenamento local inválido.');
    const validToolIds = new Set(toolIds || []);
    return Object.freeze({
      load() { try { return normalize(JSON.parse(storage.getItem(key) || 'null'), validToolIds); } catch { return freshData(); } },
      save(data) { try { storage.setItem(key, JSON.stringify(normalize(data, validToolIds))); return true; } catch { return false; } },
      fresh: freshData
    });
  }
  return Object.freeze({ createStore, freshData, normalize });
});
