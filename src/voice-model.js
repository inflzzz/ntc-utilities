/* Voice Modifier state: deliberately independent of the audio graph for migration/testing. */
(() => {
  const VERSION = 1;
  const EFFECTS = Object.freeze({
    gate: { label: 'Noise Gate', params: { threshold: [-70, -12, -42], attack: [1, 100, 8], release: [20, 600, 140] } },
    pitch: { label: 'Pitch', params: { semitones: [-12, 12, 0] } },
    formant: { label: 'Formant', params: { semitones: [-7, 7, 0] } },
    eq: { label: 'Equalizador', params: { bass: [-18, 18, 0], mid: [-18, 18, 0], treble: [-18, 18, 0] } },
    compressor: { label: 'Compressor', params: { threshold: [-60, 0, -24], ratio: [1, 12, 3], attack: [1, 100, 8], release: [30, 600, 180], makeup: [0, 12, 0] } },
    reverb: { label: 'Reverb', params: { mix: [0, 70, 20], decay: [0.3, 5, 1.8] } },
    delay: { label: 'Delay', params: { time: [50, 800, 240], feedback: [0, 70, 25], mix: [0, 60, 20] } },
    distortion: { label: 'Distorção', params: { drive: [0, 100, 24], mix: [0, 100, 35] } },
    chorus: { label: 'Chorus', params: { rate: [0.1, 5, 0.8], depth: [1, 25, 8], mix: [0, 70, 30] } },
    flanger: { label: 'Flanger', params: { rate: [0.1, 5, 0.35], depth: [1, 12, 4], feedback: [0, 75, 25], mix: [0, 70, 30] } },
    robot: { label: 'Robô', params: { frequency: [20, 120, 42], mix: [0, 100, 75] } },
    telephone: { label: 'Telefone / rádio', params: { low: [250, 900, 360], high: [1800, 6000, 3200], drive: [0, 65, 12] } }
  });
  let nextId = 0;
  const effect = (type, overrides = {}) => ({ id: `fx-${++nextId}`, type, enabled: true, params: Object.fromEntries(Object.entries(EFFECTS[type].params).map(([key, values]) => [key, values[2]])), ...overrides });
  const chain = (...items) => items.map(([type, params]) => effect(type, { params: { ...effect(type).params, ...params } }));
  const presetRows = [
    ['natural', 'Natural', []],
    ['grave', 'Voz grave', [['pitch', { semitones: -4 }], ['formant', { semitones: -2 }], ['compressor', {}]]],
    ['muito-grave', 'Voz muito grave', [['pitch', { semitones: -9 }], ['formant', { semitones: -4 }], ['eq', { bass: 5, treble: -3 }]]],
    ['aguda', 'Voz aguda', [['pitch', { semitones: 5 }], ['formant', { semitones: 2 }]]],
    ['gigante', 'Gigante', [['pitch', { semitones: -7 }], ['formant', { semitones: -5 }], ['reverb', { mix: 24, decay: 2.6 }]]],
    ['criatura', 'Criatura', [['pitch', { semitones: -3 }], ['formant', { semitones: -5 }], ['distortion', { drive: 36, mix: 44 }]]],
    ['demonio', 'Demônio', [['pitch', { semitones: -8 }], ['formant', { semitones: -3 }], ['distortion', { drive: 51, mix: 50 }], ['reverb', { mix: 22 }]]],
    ['robo', 'Robô', [['robot', { frequency: 45, mix: 85 }], ['compressor', {}]]],
    ['fantasma', 'Fantasma', [['pitch', { semitones: 2 }], ['reverb', { mix: 48, decay: 3.3 }], ['delay', { time: 360, feedback: 19, mix: 18 }]]],
    ['radio', 'Rádio antigo', [['telephone', { low: 380, high: 3800, drive: 26 }], ['distortion', { drive: 18, mix: 20 }]]],
    ['telefone', 'Telefone', [['telephone', {}], ['compressor', { threshold: -30, ratio: 4 }]]],
    ['megafone', 'Megafone', [['telephone', { low: 300, high: 4800, drive: 34 }], ['compressor', { ratio: 5 }]]],
    ['lofi', 'Lo-fi', [['telephone', { low: 270, high: 5700, drive: 10 }], ['chorus', { mix: 17 }]]],
    ['espacial', 'Espacial', [['chorus', { depth: 14, mix: 40 }], ['flanger', { mix: 20 }], ['reverb', { mix: 34 }]]],
    ['esquilo', 'Esquilo', [['pitch', { semitones: 10 }], ['formant', { semitones: 6 }]]],
    ['narrador', 'Narrador', [['gate', {}], ['eq', { bass: 3, mid: 2, treble: 2 }], ['compressor', { threshold: -24, ratio: 3.5, makeup: 2 }]]]
  ];
  const presets = Object.freeze(presetRows.map(([id, name, rows]) => ({ id, name, official: true, version: VERSION, chain: chain(...rows) })));
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  function normalizeChain(value) {
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    return value.slice(0, 30).filter(row => row && typeof row.type === 'string' && /^[a-z][a-z0-9-]{0,39}$/i.test(row.type)).map(row => {
      const id = typeof row.id === 'string' && row.id.length < 80 && !ids.has(row.id) ? row.id : `fx-${++nextId}`;
      ids.add(id);
      const definition = EFFECTS[row.type];
      const params = definition
        ? Object.fromEntries(Object.entries(definition.params).map(([key, [min, max, fallback]]) => [key, clamp(row.params?.[key], min, max, fallback)]))
        : Object.fromEntries(Object.entries(row.params && typeof row.params === 'object' ? row.params : {}).slice(0, 20).filter(([key, item]) => /^[a-z][a-z0-9-]{0,39}$/i.test(key) && Number.isFinite(item)).map(([key, item]) => [key, clamp(item, -100000, 100000, 0)]));
      return { id, type: row.type, enabled: row.enabled !== false, params };
    });
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  function normalizeState(raw) {
    const custom = Array.isArray(raw?.customPresets) ? raw.customPresets.filter(row => row && typeof row.name === 'string').slice(0, 100).map(row => ({ id: String(row.id || `custom-${++nextId}`), name: row.name.trim().slice(0, 60) || 'Sem nome', version: VERSION, chain: normalizeChain(row.chain) })) : [];
    return { version: VERSION, chain: normalizeChain(raw?.chain), customPresets: custom, selectedPreset: String(raw?.selectedPreset || 'natural'), inputDevice: String(raw?.inputDevice || ''), outputDevice: String(raw?.outputDevice || ''), inputGain: clamp(raw?.inputGain, 0, 2, 1), noiseSuppression: raw?.noiseSuppression === true, echoCancellation: raw?.echoCancellation === true, autoGainControl: raw?.autoGainControl === true };
  }
  function move(chainValue, from, to) {
    const result = normalizeChain(chainValue);
    if (from < 0 || to < 0 || from >= result.length || to >= result.length) return result;
    result.splice(to, 0, result.splice(from, 1)[0]);
    return result;
  }
  const api = { VERSION, EFFECTS, presets, effect, normalizeChain, normalizeState, move, copy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.NTCVoiceModel = api;
})();
