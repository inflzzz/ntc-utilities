const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/voice-model.js');

test('presets have distinct, valid and serializable chains', () => {
  assert.equal(model.presets.length, 16);
  const signatures = new Set();
  for (const preset of model.presets) {
    const normalized = model.normalizeChain(JSON.parse(JSON.stringify(preset.chain)));
    assert.deepEqual(normalized.map(row => [row.type, row.params]), preset.chain.map(row => [row.type, row.params]));
    signatures.add(JSON.stringify(preset.chain.map(row => [row.type, row.params])));
  }
  assert.equal(signatures.size, model.presets.length);
});

test('chain order, bypass and versioned persistence', () => {
  const a = model.effect('gate'), b = model.effect('pitch');
  a.enabled = false;
  const moved = model.move([a, b], 0, 1);
  assert.deepEqual(moved.map(row => row.type), ['pitch', 'gate']);
  assert.equal(moved[1].enabled, false);
  const restored = model.normalizeState({ version: 0, chain: moved, customPresets: [{ id: 'old', name: 'Antigo', chain: [b] }] });
  assert.equal(restored.version, model.VERSION);
  assert.equal(restored.customPresets[0].chain[0].type, 'pitch');
});

test('invalid/future effects and hostile parameter values cannot reach DSP', () => {
  const result = model.normalizeChain([
    { type: 'unknown', enabled: true },
    { id: 'x', type: 'compressor', params: { threshold: -999, ratio: Infinity, attack: NaN, release: -1, makeup: 999 } },
    { id: 'x', type: 'gate', params: {} }
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].type, 'unknown');
  assert.equal(result[1].params.threshold, -60);
  assert.equal(result[1].params.ratio, 3);
  assert.equal(result[1].params.makeup, 12);
  assert.notEqual(result[1].id, result[2].id);
  assert.equal(model.normalizeChain('not an array').length, 0);
});
