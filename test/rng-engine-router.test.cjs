'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRngRollRouter, RNG_ENGINE_ENV } = require('../src/rng-engine-router.cjs');
const { POOL, TITLES, currentWeights, rollBatch } = require('../src/rng.cjs');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');

test('flag ausente seleciona a referência exata do batch legado e preserva o resultado determinístico', () => {
  const previous = process.env[RNG_ENGINE_ENV];
  delete process.env[RNG_ENGINE_ENV];
  try {
    const selected = createRngRollRouter({ legacyRollBatch: rollBatch });
    assert.strictEqual(selected, rollBatch);
    const fixedInputs = { randomRelicTargetValue: 0n, randomRelicChoiceValue: 0n, eventRelicChoiceValue: 0n };
    assert.deepEqual(selected({}, [0n], fixedInputs), rollBatch({}, [0n], fixedInputs));
  } finally {
    if (previous === undefined) delete process.env[RNG_ENGINE_ENV];
    else process.env[RNG_ENGINE_ENV] = previous;
  }
});

test('configuração explícita legacy seleciona a mesma função do RNG atual', () => {
  assert.strictEqual(createRngRollRouter({ mode: 'legacy', legacyRollBatch: rollBatch }), rollBatch);
});

test('Luck 2.0 indisponível falha fechada antes de chamar o RNG legado', () => {
  let legacyCalls = 0;
  const legacy = (...args) => { legacyCalls++; return rollBatch(...args); };
  assert.throws(() => createRngRollRouter({ mode: 'luck2', legacyRollBatch: legacy }), /não está disponível/);
  assert.equal(legacyCalls, 0);
});

test('Manual e Auto passam pelo mesmo batch selecionado em performRngRoll', () => {
  const performBody = mainSource.match(/function performRngRoll\([\s\S]*?\n}\nfunction startRngClock\(\)/)?.[0];
  assert.ok(performBody, 'performRngRoll deve existir');
  assert.equal((performBody.match(/selectedRngRollBatch\(/g) || []).length, 1);
  assert.match(performBody, /selectedRngRollBatch\(rngGame, undefined,/);
  assert.match(mainSource, /ipcMain\.handle\('roll-rng',[\s\S]*?performRngRoll\(\{ manual: true \}\)/);
  assert.match(mainSource, /if \(rngAutoRollStartedAt && tick >= rngNextAutoRollAt\)[\s\S]*?performRngRoll\(\)/);
  assert.match(mainSource, /const selectedRngRollBatch = createRngRollRouter\(\{ legacyRollBatch: rollRngBatch \}\)/);
});

test('baseline TSV preserva os 200 IDs/pesos/tiers e currentWeights neutro é idêntico', () => {
  const baselinePath = path.join(__dirname, '..', 'docs', 'rng-phase0-baseline-2026-09-27.tsv');
  const lines = fs.readFileSync(baselinePath, 'utf8').trimEnd().split(/\r?\n/);
  const dataLines = lines.filter(line => line && !line.startsWith('#') && !line.startsWith('id\t'));
  assert.equal(dataLines.length, 200);
  assert.equal(TITLES.length, 200);
  assert.equal(new Set(dataLines.map(line => line.split('\t')[0])).size, 200);
  assert.equal(crypto.createHash('sha256').update(dataLines.join('\n')).digest('hex'), '3fd426bc078d66b699100b51e2f4a47be731e6a92256b77cf378a6e9b05e1248');

  const baselineById = new Map(dataLines.map(line => {
    const [id, tier, baseWeight, active, acquisition] = line.split('\t');
    return [id, { tier, baseWeight: BigInt(baseWeight), active, acquisition }];
  }));
  const weights = currentWeights({});
  let weightSum = 0n;
  for (const title of TITLES) {
    const baseline = baselineById.get(title.id);
    assert.ok(baseline, `ID ausente no baseline: ${title.id}`);
    assert.equal(baseline.tier, title.tier, `tier divergente: ${title.id}`);
    assert.equal(baseline.baseWeight, title.baseWeight, `peso divergente: ${title.id}`);
    assert.equal(baseline.active, String(Boolean(title.active)), `active divergente: ${title.id}`);
    assert.equal(baseline.acquisition, title.acquisition, `aquisição divergente: ${title.id}`);
    assert.equal(weights.get(title.id), title.baseWeight, `currentWeights neutro divergiu: ${title.id}`);
    weightSum += weights.get(title.id);
  }
  assert.equal(weightSum, POOL);
});
