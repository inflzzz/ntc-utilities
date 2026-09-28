'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { currentWeights, normalizeState, POOL, TITLES, rollBatch } = require('../src/rng.cjs');
const { countProcessedRolls, grantAccountXp } = require('../src/rng-account-level.cjs');
const { isFragmentRecyclingUnlocked } = require('../src/rng-account-unlocks.cjs');
const {
  FRAGMENT_RECYCLING_VERSION,
  applyFragmentRecycling,
  fragmentValueForBaseDenominator,
  migrateLegacyFragmentSave
} = require('../src/rng-fragments.cjs');
const { serializeRngAccountSave, createInitialRngAccount } = require('../src/rng-account-reset.cjs');

const projectRoot = path.resolve(__dirname, '..');

function titleResult(title, { isNew = false, roll = 1, currentOdds = '1 em 999999' } = {}) {
  return { title, isNew, roll, currentOdds, fragmentReward: '999999', specialUnlocks: [{ id: 'legacy', fragmentReward: '500' }] };
}

function outcomeWith(results, oldBalance = '99999') {
  return { state: { totalRolls: results.at(-1)?.roll || 0, fragmentBalance: oldBalance, fragmentRewardRemainderBps: 9999 }, results };
}

function canonicalDenominator(title) { return title.denominator ?? title.baseDenominator ?? ((2n * POOL + title.baseWeight) / (2n * title.baseWeight)); }

test('Fragment value matches the approved anchors and rounds from the base denominator', () => {
  const anchors = [
    ['43', 1n], ['4020', 26n], ['1790000', 232n], ['424000000', 841n],
    ['280000000000', 2607n], ['13800000000000000000', 20372n],
    ['13800000000000000000000000', 60637n], ['57700000000000000000000000000', 103875n]
  ];
  for (const [denominator, expected] of anchors) assert.equal(fragmentValueForBaseDenominator(denominator), expected, denominator);
});

test('same-tier titles can have different values; 1e100 and 1e1000 stay exact BigInt rewards', () => {
  const basicTitles = TITLES.filter(title => title.tier === 'basic');
  assert.notEqual(fragmentValueForBaseDenominator(canonicalDenominator(basicTitles[0])), fragmentValueForBaseDenominator(canonicalDenominator(basicTitles.at(-1))));
  const oneE100 = fragmentValueForBaseDenominator(`1${'0'.repeat(100)}`);
  const oneE1000 = fragmentValueForBaseDenominator(`1${'0'.repeat(1000)}`);
  assert.equal(oneE100, 15_180_459n);
  assert.equal(oneE1000, 151_804_589_159n);
  assert.equal(typeof oneE1000, 'bigint');
});

test('all 200 current titles have a cacheable positive Fragment value from canonical base odds', () => {
  assert.equal(TITLES.length, 200);
  for (const title of TITLES) {
    const denominator = canonicalDenominator(title);
    assert.ok(denominator > 0n, title.id);
    assert.ok(fragmentValueForBaseDenominator(denominator) >= 1n, title.id);
  }
});

test('Level 1 earns nothing, including duplicates from rolls before the Recycling unlock', () => {
  const basic = TITLES.find(title => title.tier === 'basic');
  const startingState = { totalRolls: 9, fragmentBalance: '0' };
  const outcome = outcomeWith([titleResult(basic, { isNew: false, roll: 10 })]);
  const result = applyFragmentRecycling({ startingState, outcome, lifetimeXp: 9n, pool: POOL });
  assert.equal(isFragmentRecyclingUnlocked('1'), false);
  assert.equal(result.state.fragmentBalance, '0');
  assert.equal(result.results[0].fragmentReward, '0');
  assert.equal(result.results[0].fragmentDuplicate, false);
  assert.equal(result.fragmentTotal, '0');
});

test('Level 2 begins at zero and only later duplicate titles generate Fragmentos', () => {
  const basic = TITLES.find(title => title.tier === 'basic');
  const startingState = { totalRolls: 10, fragmentBalance: '0' };
  const outcome = outcomeWith([
    titleResult(basic, { isNew: true, roll: 11 }),
    titleResult(basic, { isNew: false, roll: 12 })
  ]);
  const result = applyFragmentRecycling({ startingState, outcome, lifetimeXp: 10n, pool: POOL });
  assert.equal(isFragmentRecyclingUnlocked('2'), true);
  assert.equal(result.results[0].fragmentReward, '0', 'first discoveries never award currency');
  assert.equal(result.results[1].fragmentReward, fragmentValueForBaseDenominator(canonicalDenominator(basic)).toString());
  assert.equal(result.state.fragmentBalance, result.results[1].fragmentReward);
  assert.equal(result.results[1].fragmentDuplicate, true);
});

test('each duplicate result in one roll is valued separately without changing roll-based XP', () => {
  const basic = TITLES.find(title => title.tier === 'basic');
  const startingState = { totalRolls: 10, fragmentBalance: '0' };
  const outcome = outcomeWith([
    titleResult(basic, { isNew: false, roll: 11 }),
    titleResult(basic, { isNew: false, roll: 11 })
  ]);
  const result = applyFragmentRecycling({ startingState, outcome, lifetimeXp: 10n, pool: POOL });
  assert.equal(result.results.length, 2);
  assert.equal(result.fragmentTotal, (2n * fragmentValueForBaseDenominator(canonicalDenominator(basic))).toString());
  const processedRolls = countProcessedRolls(10, 11);
  assert.equal(grantAccountXp({}, processedRolls).lifetimeAccountXp, '1');
});

test('fragment amount uses canonical base odds, never the effective odds altered by Luck', () => {
  const basic = TITLES.find(title => title.tier === 'basic');
  const startingState = { totalRolls: 10, fragmentBalance: '0' };
  const result = applyFragmentRecycling({
    startingState,
    lifetimeXp: 10n,
    pool: POOL,
    outcome: outcomeWith([titleResult(basic, { isNew: false, roll: 11, currentOdds: '1 em 2' })])
  });
  assert.equal(result.results[0].fragmentReward, fragmentValueForBaseDenominator(canonicalDenominator(basic)).toString());
});

test('legacy tier, first-discovery, relic and event payouts are replaced by title-duplicate recycling only', () => {
  const basic = TITLES.find(title => title.tier === 'basic');
  const startingState = { totalRolls: 10, fragmentBalance: '7' };
  const outcome = outcomeWith([titleResult(basic, { isNew: true, roll: 11 })]);
  outcome.results[0].specialUnlocks.push({ id: 'limited', fragmentReward: '1000' });
  const result = applyFragmentRecycling({ startingState, outcome, lifetimeXp: 10n, pool: POOL });
  assert.equal(result.state.fragmentBalance, '7');
  assert.ok(result.results[0].specialUnlocks.every(item => item.fragmentReward === '0'));
});

test('manual and auto paths share the same post-roll recycling operation, without RNG changes', () => {
  const initial = normalizeState();
  const options = { rolledAt: 1_800_000_000_000, localHour: 12, randomRelicTargetValue: 8_000, randomRelicChoiceValue: 0, limitedRewardValue: 1, eventRelicChoiceValue: 0 };
  const beforeWeights = [...currentWeights(initial)];
  const raw = rollBatch(initial, [0n], options);
  const processed = applyFragmentRecycling({ startingState: initial, outcome: raw, lifetimeXp: 0n, pool: POOL });
  assert.equal(processed.results[0].title.id, raw.results[0].title.id);
  assert.equal(processed.results[0].currentOdds, raw.results[0].currentOdds);
  assert.deepEqual([...currentWeights(initial)], beforeWeights);
  assert.deepEqual([...currentWeights(raw.state)], [...currentWeights(processed.state)]);
  assert.match(fs.readFileSync(path.join(projectRoot, 'main.cjs'), 'utf8'), /const outcome = applyFragmentRecycling\(\{[\s\S]*?lifetimeXp: rngAccountProgress\.lifetimeAccountXp,[\s\S]*?pool: rngPool,[\s\S]*?enhancedRecyclingLevel: rngAccountProgress\.enhancedRecyclingLevel/);
  assert.doesNotMatch(fs.readFileSync(path.join(projectRoot, 'main.cjs'), 'utf8').match(/function performRngRoll\([\s\S]*?\n}\nfunction startRngClock\(\)/)?.[0] || '', /applyFragmentRecycling[^;]*manual/);
});

test('migration clears incompatible legacy currency once, then preserves the new balance and reset is zero', () => {
  const old = migrateLegacyFragmentSave({ totalRolls: 50_000, fragmentBalance: '987654321', fragmentRewardRemainderBps: 1234 });
  assert.equal(old.migrated, true);
  assert.equal(old.state.fragmentBalance, '0');
  assert.equal(old.state.fragmentRewardRemainderBps, 0);
  assert.equal(old.state.fragmentRecyclingVersion, FRAGMENT_RECYCLING_VERSION);
  const current = migrateLegacyFragmentSave({ ...old.state, fragmentBalance: '123456789012345678901234567890' });
  assert.equal(current.migrated, false);
  assert.equal(current.state.fragmentBalance, '123456789012345678901234567890');
  const initial = createInitialRngAccount();
  const saved = JSON.parse(serializeRngAccountSave(initial.rngGame, initial.accountProgress));
  assert.equal(saved.fragmentBalance, '0');
  assert.equal(saved.fragmentRecyclingVersion, FRAGMENT_RECYCLING_VERSION);
  assert.equal(saved.accountProgress.accountLevel, '1');
});

test('persistent Fragment balance adds rewards exactly beyond Number-safe ranges', () => {
  const basic = TITLES.find(title => title.tier === 'basic');
  const hugeBalance = `1${'0'.repeat(500)}`;
  const reward = fragmentValueForBaseDenominator(canonicalDenominator(basic));
  const result = applyFragmentRecycling({
    startingState: { totalRolls: 10, fragmentBalance: hugeBalance },
    outcome: outcomeWith([titleResult(basic, { isNew: false, roll: 11 })]),
    lifetimeXp: 10n,
    pool: POOL
  });
  assert.equal(result.state.fragmentBalance, (BigInt(hugeBalance) + reward).toString());
});

test('UI exposes Fragmentos only after Level 2 and result text is bounded rather than queued', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'src/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(projectRoot, 'src/app.js'), 'utf8');
  const main = fs.readFileSync(path.join(projectRoot, 'main.cjs'), 'utf8');
  assert.match(html, /id="rngFragmentWallet" hidden/);
  assert.match(app, /\$\('#rngFragmentWallet'\)\.hidden = !fragmentsUnlocked/);
  assert.match(app, /DUPLICATA · \+\$\{formatRngFragments\(latest\.fragmentReward\)\} FRAGMENTOS/);
  assert.match(main, /fragmentRecyclingUnlocked: isFragmentRecyclingUnlocked\(rngAccountProgress\.accountLevel\)/);
  assert.match(main, /fragmentRecyclingVersion: FRAGMENT_RECYCLING_VERSION/);
});
