'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { currentWeights, normalizeState, POOL, rollBatch, TITLES } = require('../src/rng.cjs');
const { createInitialRngAccount, serializeRngAccountSave } = require('../src/rng-account-reset.cjs');
const { normalizeRngAccountProgress } = require('../src/rng-fragment-upgrades.cjs');
const {
  ENHANCED_RECYCLING_COSTS,
  ENHANCED_RECYCLING_MAX_LEVEL,
  enhancedRecyclingSummary,
  normalizeEnhancedRecyclingProgress,
  purchaseEnhancedRecycling
} = require('../src/rng-fragment-upgrades.cjs');
const { applyFragmentRecycling, fragmentValueForBaseDenominator } = require('../src/rng-fragments.cjs');

function duplicateResult(title, roll, isNew = false) {
  return { title, roll, isNew, currentOdds: '1 em 999999', fragmentReward: '987654', specialUnlocks: [{ id: 'legacy', fragmentReward: '12345' }] };
}

function outcomeFor(results, balance = '0') {
  return { state: { totalRolls: results.at(-1)?.roll || 0, fragmentBalance: balance, fragmentRewardRemainderBps: 0 }, results };
}

function baseReward(title) {
  const denominator = title.denominator ?? title.baseDenominator ?? ((2n * POOL + title.baseWeight) / (2n * title.baseWeight));
  return fragmentValueForBaseDenominator(denominator);
}

test('Reciclagem Aprimorada tem cinco níveis, bônus e custos data-driven exatos', () => {
  assert.deepEqual(ENHANCED_RECYCLING_COSTS, ['25', '75', '200', '500', '1250']);
  assert.equal(ENHANCED_RECYCLING_MAX_LEVEL, 5);
  for (let level = 0; level <= 5; level++) {
    const summary = enhancedRecyclingSummary(level, 4);
    assert.equal(summary.bonusPercent, level * 10);
    assert.equal(summary.level, level);
    assert.equal(summary.maxLevel, 5);
    assert.equal(summary.nextCost, level === 5 ? null : ENHANCED_RECYCLING_COSTS[level]);
  }
  assert.equal(enhancedRecyclingSummary(0, 3).unlocked, false);
  assert.equal(enhancedRecyclingSummary(0, 4).unlocked, true);
});

test('compra exige Nível 4, saldo suficiente e respeita o nível máximo', () => {
  assert.deepEqual(purchaseEnhancedRecycling({ accountLevel: '3', level: 0, fragmentBalance: '999' }), { ok: false, reason: 'upgrade-locked' });
  assert.deepEqual(purchaseEnhancedRecycling({ accountLevel: '4', level: 0, fragmentBalance: '24' }), { ok: false, reason: 'insufficient-fragments', cost: '25' });
  let purchase = purchaseEnhancedRecycling({ accountLevel: '4', level: 0, fragmentBalance: '25' });
  assert.deepEqual(purchase, { ok: true, level: 1, fragmentBalance: '0', cost: '25' });
  purchase = purchaseEnhancedRecycling({ accountLevel: '4', level: 1, fragmentBalance: '900719925474099312345' });
  assert.deepEqual(purchase, { ok: true, level: 2, fragmentBalance: '900719925474099312270', cost: '75' });
  assert.deepEqual(purchaseEnhancedRecycling({ accountLevel: '4', level: 5, fragmentBalance: '999999' }), { ok: false, reason: 'max-level' });
});

test('novo progresso, saves antigos e Reset Total inicializam a melhoria sem resíduo', () => {
  assert.deepEqual(normalizeEnhancedRecyclingProgress({}), { enhancedRecyclingLevel: 0, enhancedRecyclingRemainderBps: 0 });
  assert.deepEqual(normalizeEnhancedRecyclingProgress({ enhancedRecyclingLevel: '999', enhancedRecyclingRemainderBps: '10007' }), { enhancedRecyclingLevel: 5, enhancedRecyclingRemainderBps: 7 });
  const initial = createInitialRngAccount();
  assert.equal(initial.accountProgress.enhancedRecyclingLevel, 0);
  assert.equal(initial.accountProgress.enhancedRecyclingRemainderBps, 0);
  const saved = JSON.parse(serializeRngAccountSave(initial.rngGame, initial.accountProgress));
  assert.equal(saved.accountProgress.enhancedRecyclingLevel, 0);
  assert.equal(saved.accountProgress.enhancedRecyclingRemainderBps, 0);
  assert.deepEqual(normalizeRngAccountProgress(saved.accountProgress), {
    accountLevel: '1', accountXp: '0', lifetimeAccountXp: '0',
    enhancedRecyclingLevel: 0, enhancedRecyclingRemainderBps: 0
  });
});

test('bônus só incide após o valor-base da duplicata e usa resto inteiro sem perder frações', () => {
  const title = TITLES.find(item => item.tier === 'basic');
  const base = baseReward(title);
  const results = Array.from({ length: 10 }, (_, index) => duplicateResult(title, 11 + index));
  const result = applyFragmentRecycling({
    startingState: { totalRolls: 10, fragmentBalance: '0' },
    outcome: outcomeFor(results), lifetimeXp: 10n, pool: POOL,
    enhancedRecyclingLevel: 1, enhancedRecyclingRemainderBps: 0
  });
  const expectedBonus = base * 10n * 1_000n / 10_000n;
  assert.equal(result.fragmentTotal, (base * 10n + expectedBonus).toString());
  assert.equal(result.state.fragmentBalance, result.fragmentTotal);
  assert.equal(result.enhancedRecyclingRemainderBps, Number((base * 10n * 1_000n) % 10_000n));
  assert.ok(result.results.every(item => item.specialUnlocks.every(unlock => unlock.fragmentReward === '0')));

  const firstDiscovery = applyFragmentRecycling({
    startingState: { totalRolls: 60, fragmentBalance: '0' },
    outcome: outcomeFor([duplicateResult(title, 61, true)]), lifetimeXp: 60n, pool: POOL,
    enhancedRecyclingLevel: 5, enhancedRecyclingRemainderBps: 0
  });
  assert.equal(firstDiscovery.fragmentTotal, '0');
  assert.equal(firstDiscovery.enhancedRecyclingRemainderBps, 0);
});

test('Rolls do RNG não são tocados e main aplica reciclagem pós-roll com o nível da conta', () => {
  const fs = require('node:fs');
  const main = fs.readFileSync(require.resolve('../main.cjs'), 'utf8');
  assert.match(main, /applyFragmentRecycling\(\{[\s\S]*?enhancedRecyclingLevel: rngAccountProgress\.enhancedRecyclingLevel/);
  assert.match(main, /ipcMain\.handle\('purchase-rng-enhanced-recycling'/);
  assert.match(main, /rngAccountProgress\.enhancedRecyclingLevel = result\.level/);

  const state = normalizeState({ totalRolls: 60, collectedIds: TITLES.map(title => title.id), fragmentBalance: '0' });
  const beforeWeights = [...currentWeights(state)];
  const raw = rollBatch(state, [0n], { rolledAt: 1_800_000_000_000, localHour: 12, randomRelicTargetValue: 8_000, randomRelicChoiceValue: 0, limitedRewardValue: 1, eventRelicChoiceValue: 0 });
  const enhanced = applyFragmentRecycling({
    startingState: state, outcome: raw, lifetimeXp: 60n, pool: POOL,
    enhancedRecyclingLevel: 5, enhancedRecyclingRemainderBps: 0
  });
  assert.equal(enhanced.results[0].title.id, raw.results[0].title.id);
  assert.equal(enhanced.results[0].currentOdds, raw.results[0].currentOdds);
  assert.deepEqual([...currentWeights(enhanced.state)], beforeWeights);
});
