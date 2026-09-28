const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  POOL,
  TEN_THOUSAND_ROLL_BONUS_EVERY,
  TEN_THOUSAND_ROLL_BONUS_MULTIPLIER,
  THOUSAND_ROLL_BONUS_EVERY,
  THOUSAND_ROLL_BONUS_MULTIPLIER,
  TIERS,
  TITLES,
  CATALOG_VERSION,
  basePoolWeight,
  equalHourBonusAt,
  normalizeState,
  migrateRemovedMisfortuneRelics,
  RNG_RELIC_REMOVAL_VERSION,
  RNG_NTC_ODDS_CEILING_DENOMINATOR,
  achievementLuckRewardBps,
  luckForState,
  currentWeights,
  rollTitle,
  rollBatch,
  publicCatalog,
  publicProgress,
  debugGrantTierTitles,
  debugGrantTotalTitles,
  debugReadyBonusRoll,
  debugGrantTitle,
  debugRemoveTitle,
  debugClearTitles,
  RNG_FRAGMENT_REWARDS,
  LIMITED_TITLE_FRAGMENT_REWARD,
  purchasePermanentUpgrade,
  purchaseConsumable,
  activateConsumable,
  advanceTimedBoost,
  RELICS,
  RELIC_SETS,
  RNG_RELIC_COST,
  RNG_DUPLICATE_RELIC_REWARD,
  purchaseRelic,
  equipRelic,
  unequipRelic,
  relicEffects,
  rollsPerAction,
  publicRelicState
} = require('../src/rng.cjs');

function randomValueForTitle(state, titleId, options = {}) {
  const weights = currentWeights(state, options);
  let cursor = 0n;
  for (const title of TITLES) {
    if (title.id === titleId) return cursor;
    cursor += weights.get(title.id);
  }
  throw new Error(`Unknown test title: ${titleId}`);
}

function ntcWeight(weights) {
  return TITLES.filter(title => title.tier === 'ntc').reduce((total, title) => total + weights.get(title.id), 0n);
}

function assertRarityOrder(weights) {
  const ordered = [...TITLES].sort((left, right) => left.baseWeight > right.baseWeight ? -1 : left.baseWeight < right.baseWeight ? 1 : 0);
  for (let index = 0; index < ordered.length - 1; index++) {
    assert.ok(weights.get(ordered[index].id) > weights.get(ordered[index + 1].id), `${ordered[index].id} remains more likely than ${ordered[index + 1].id}`);
  }
}

test('the catalog starts with 200 distinct titles, 20 in each tier', () => {
  assert.equal(TITLES.length, 200);
  assert.equal(new Set(TITLES.map(title => title.id)).size, 200);
  assert.equal(new Set(TITLES.map(title => title.name)).size, 200);
  for (const tier of TIERS) assert.equal(TITLES.filter(title => title.tier === tier.id).length, 20);
  assert.ok(TITLES.every(title => title.name && title.baseWeight > 0n));
});

test('base odds are distinct and the complete weighted pool sums to exactly 100%', () => {
  assert.equal(basePoolWeight, POOL);
  assert.equal(new Set(TITLES.map(title => title.baseWeight.toString())).size, TITLES.length);
  const displayedOdds = publicCatalog({}).map(title => title.baseOdds);
  assert.equal(new Set(displayedOdds).size, TITLES.length);
  assert.ok(displayedOdds.every(odds => !odds.includes(',')));
  const denominators = TITLES.filter(title => title.denominator).map(title => title.denominator);
  assert.ok(denominators.some(value => value === 750_000_000n));
  assert.ok(denominators.at(-1) > 1_000_000_000_000_000_000_000_000_000n);
  const catalog = publicCatalog({ collectedIds: ['unique-08', 'unique-20'] });
  const luckyLad = catalog.find(title => title.id === 'unique-08');
  const luckiestLad = catalog.find(title => title.id === 'unique-20');
  assert.equal(luckyLad.name, 'O Favorito do Acaso');
  assert.equal(luckyLad.tierLabel, 'Lendário');
  assert.equal(luckyLad.baseOdds, '1 em 278.000.000');
  assert.equal(luckiestLad.name, 'O Acaso Encarnado');
  assert.equal(publicCatalog({ collectedIds: ['unique-08', 'unique-20'] }).find(title => title.id === 'unique-20').name, 'O Acaso Encarnado');
  assert.equal(luckiestLad.tierLabel, 'Lendário');
  assert.equal(luckiestLad.baseOdds, '1 em 777.777.777');
  assert.equal(catalog.find(title => title.id === 'legendary-08').tierLabel, 'Singular');
});

test('Basic chances have visible variety and every result keeps a nonzero chance at maximum luck', () => {
  const basic = TITLES.filter(title => title.tier === 'basic');
  const ordinaryBasic = basic.slice(1);
  const maxOrdinary = ordinaryBasic.reduce((max, title) => title.baseWeight > max ? title.baseWeight : max, 0n);
  const minOrdinary = ordinaryBasic.reduce((min, title) => title.baseWeight < min ? title.baseWeight : min, POOL);
  assert.ok(maxOrdinary * 100n / minOrdinary >= 400n);

  const maxLuck = normalizeState({ collectedIds: TITLES.map(title => title.id) });
  const weights = currentWeights(maxLuck);
  const weakestBasic = basic.reduce((min, title) => weights.get(title.id) < min ? weights.get(title.id) : min, POOL);
  assert.ok(weakestBasic > 0n);
});

test('rare odds show the exact base denominator and collection luck raises rare weights', () => {
  const target = TITLES.find(title => title.id === 'legendary-12');
  assert.equal(publicCatalog({}).find(title => title.id === target.id).currentOdds, '1 em 750.000.000');
  const state = normalizeState({ collectedIds: ['basic-01', 'basic-02'] });
  assert.equal(luckForState(state).passiveBps, 100);
  assert.equal(luckForState(state).totalBps, 10_100);
  assert.ok(currentWeights(state).get(target.id) > currentWeights({}).get(target.id));
});

test('first-title rarity achievements scale from 1% to 500% permanent luck', () => {
  const nonBasicTiers = TIERS.filter(tier => tier.id !== 'basic');
  const expectedBonuses = [100, 200, 500, 1_000, 2_000, 4_000, 7_500, 15_000, 50_000];
  const rarityState = normalizeState({ collectedIds: nonBasicTiers.map(tier => `${tier.id}-01`) });
  const rarityLuck = luckForState(rarityState);

  for (const [index, tier] of nonBasicTiers.entries()) {
    const oneRarity = normalizeState({ collectedIds: [`${tier.id}-01`] });
    const oneBasic = normalizeState({ collectedIds: ['basic-01'] });
    assert.equal(achievementLuckRewardBps(`tier-${tier.id}`), expectedBonuses[index], `${tier.id} has the configured tier reward`);
    assert.equal(luckForState(oneRarity).totalBps - luckForState(oneBasic).totalBps, expectedBonuses[index], `${tier.id} stacks its bonus over the same collection luck`);
  }
  assert.equal(achievementLuckRewardBps('tier-basic'), 0);
  const totalRarityBonus = expectedBonuses.reduce((sum, bonus) => sum + bonus, 0);
  assert.equal(rarityLuck.achievementBonusBps, totalRarityBonus);
  assert.equal(rarityLuck.totalBps, 10_000 + rarityLuck.passiveBps + totalRarityBonus);
  assert.equal(achievementLuckRewardBps('tier-ntc'), 50_000, 'the first Além do NTC title grants a massive +500% permanent luck');
  assert.ok(ntcWeight(currentWeights({ collectedIds: ['epic-01'] })) > ntcWeight(currentWeights({ collectedIds: ['basic-01'] })));
  assert.equal(luckForState({}).achievementBonusBps, 0, 'unearned rarity achievements do not grant luck');
  const extremeWeights = currentWeights({ collectedIds: TITLES.map(title => title.id) });
  assert.equal([...extremeWeights.values()].reduce((sum, weight) => sum + weight, 0n), POOL);
  assert.ok([...extremeWeights.values()].every(weight => weight > 0n), 'every title remains possible even with the 500% NTC achievement bonus');
});

test('difficult achievement luck rewards stack and old save evidence grants only proven milestones', () => {
  const allTitles = TITLES.map(title => title.id);
  const earned = luckForState({
    collectedIds: allTitles,
    totalRolls: 100_000,
    manualRolls: 1_000_000,
    longestSameTitleStreak: 7,
    longestSingularDrought: 10_000,
    maxMultiplier: 100,
    eventsParticipated: 10,
    limitedTitles: ['limited-first-rain']
  });
  assert.equal(earned.achievementBonusBps, 80_850);
  assert.equal(earned.passiveBps, 10_000);
  assert.equal(earned.totalBps, 100_850, 'large rarity achievement bonuses add to collection luck without replacing it');
  assert.equal(luckForState({ totalRolls: 99_999, manualRolls: 999_999 }).achievementBonusBps, 0);
});

test('total-roll achievement bonuses unlock cumulatively at 100K, 1M, 5M, and 10M', () => {
  assert.equal(achievementLuckRewardBps('rolls-100000'), 100);
  assert.equal(achievementLuckRewardBps('rolls-1000000'), 100);
  assert.equal(achievementLuckRewardBps('rolls-5000000'), 150);
  assert.equal(achievementLuckRewardBps('rolls-10000000'), 200);
  assert.equal(luckForState({ totalRolls: 99_999 }).achievementBonusBps, 0);
  assert.equal(luckForState({ totalRolls: 100_000 }).achievementBonusBps, 100);
  assert.equal(luckForState({ totalRolls: 1_000_000 }).achievementBonusBps, 200);
  assert.equal(luckForState({ totalRolls: 5_000_000 }).achievementBonusBps, 350);
  assert.equal(luckForState({ totalRolls: 10_000_000 }).achievementBonusBps, 550);
});

test('secret hour achievements reward only app-open time outside Auto-roll and cumulative Auto-roll time', () => {
  const hundredHours = 100 * 60 * 60;
  const thousandAutoHours = 1_000 * 60 * 60;
  assert.equal(achievementLuckRewardBps('time-manual-100h'), 500);
  assert.equal(achievementLuckRewardBps('time-auto-1000h'), 2_500);
  assert.equal(luckForState({ totalAppSeconds: hundredHours - 1 }).achievementBonusBps, 0);
  assert.equal(luckForState({ totalAppSeconds: hundredHours }).achievementBonusBps, 500);
  assert.equal(luckForState({ totalAppSeconds: hundredHours, totalAutoRollSeconds: 3_600 }).achievementBonusBps, 0, 'Auto-roll hours are subtracted from the no-Auto-roll requirement');
  assert.equal(luckForState({ totalAppSeconds: thousandAutoHours, totalAutoRollSeconds: thousandAutoHours }).achievementBonusBps, 2_500);
  assert.equal(luckForState({ totalAppSeconds: thousandAutoHours + hundredHours, totalAutoRollSeconds: thousandAutoHours }).achievementBonusBps, 3_000, 'the two permanent rewards stack');
});

test('the Singular+ drought tracker advances from legacy unknown state and rewards 10,000 rolls', () => {
  const first = rollTitle({ sinceSingular: null }, 0n);
  const second = rollTitle(first.state, 0n);
  assert.equal(first.state.sinceSingular, 1);
  assert.equal(second.state.sinceSingular, 2);
  assert.equal(second.state.longestSingularDrought, 2);

  const before = { totalRolls: 9_999, sinceSingular: 9_999, longestSingularDrought: 9_999 };
  assert.equal(luckForState(before).achievementBonusBps, 0);
  const milestone = rollTitle(before, 0n);
  assert.equal(milestone.state.sinceSingular, 10_000);
  assert.equal(milestone.state.longestSingularDrought, 10_000);
  assert.equal(luckForState(milestone.state).achievementBonusBps, 0);
  assert.equal(achievementLuckRewardBps('drought-10000'), 0);
});

test('Eco de Sete grants +1% permanent luck when its secret is discovered', () => {
  let state = {};
  let finalRoll;
  for (let index = 0; index < 7; index++) {
    finalRoll = rollTitle(state, 0n);
    state = finalRoll.state;
  }
  assert.ok(state.unlockedSecrets.includes('secret-seven'));
  assert.equal(finalRoll.specialUnlocks.find(item => item.id === 'secret-seven')?.luckBonusBps, 100);
  assert.equal(luckForState(state).secretBonusBps, 100);
  assert.equal(luckForState(state).achievementBonusBps, 50, 'the separate seven-repeat achievement also stacks');
});

test('equal-hour clock bonus is active for the whole local matching minute and stacks with the tenth-roll bonus', () => {
  for (let hour = 0; hour < 24; hour++) {
    const matchingMinute = new Date(2026, 8, 23, hour, hour, 37).getTime();
    assert.deepEqual(equalHourBonusAt(matchingMinute), {
      active: true,
      multiplier: 2,
      time: `${String(hour).padStart(2, '0')}:${String(hour).padStart(2, '0')}`
    });
    const neighboringMinute = new Date(2026, 8, 23, hour, (hour + 1) % 24, 37).getTime();
    assert.equal(equalHourBonusAt(neighboringMinute).active, false);
  }

  const equalHourAt = new Date(2026, 8, 23, 20, 20, 37).getTime();
  const normalState = normalizeState({});
  const normalWeights = currentWeights(normalState);
  const equalHourWeights = currentWeights(normalState, { equalHourBonus: true });
  assert.ok(ntcWeight(equalHourWeights) > ntcWeight(normalWeights));
  assert.ok(equalHourWeights.get(TITLES[0].id) < normalWeights.get(TITLES[0].id));

  const bonusState = { totalRolls: 9, bonusRollCounter: 9 };
  const result = rollTitle(bonusState, 0n, { rolledAt: equalHourAt });
  assert.equal(result.isBonusRoll, true);
  assert.equal(result.rollBonusMultiplier, 2);
  assert.equal(result.isEqualHourBonus, true);
  assert.equal(result.equalHourMultiplier, 2);
  assert.equal(result.equalHourTime, '20:20');
  assert.equal(result.state.recentDiscoveries[0].rolledAt, equalHourAt);
  assert.equal(result.state.recentDiscoveries[0].isBonusRoll, true);
  assert.equal(result.state.recentDiscoveries[0].isEqualHourBonus, true);
  const bonusOnlyWeight = ntcWeight(currentWeights(bonusState, { bonusRoll: true }));
  const stackedWeight = ntcWeight(currentWeights(bonusState, { bonusRoll: true, equalHourBonus: true }));
  assert.ok(stackedWeight > bonusOnlyWeight, 'the two active bonuses increase the curve input together');
});

test('every thousandth roll gets ×4 and combines multiplicatively with the other active bonuses', () => {
  assert.equal(THOUSAND_ROLL_BONUS_EVERY, 1000);
  assert.equal(THOUSAND_ROLL_BONUS_MULTIPLIER, 4);
  const equalHourAt = new Date(2026, 8, 23, 20, 20, 37).getTime();
  const beforeMilestone = { totalRolls: 999, bonusRollCounter: 9 };
  const result = rollTitle(beforeMilestone, 0n, { rolledAt: equalHourAt });
  assert.equal(result.state.totalRolls, 1000);
  assert.equal(result.isBonusRoll, true, 'the 1000th roll also lands on the normal 10-roll bonus');
  assert.equal(result.isEqualHourBonus, true);
  assert.equal(result.isThousandRollBonus, true);
  assert.equal(result.thousandRollMultiplier, 4);
  assert.equal(result.state.recentDiscoveries[0].isThousandRollBonus, true);
  assert.equal(result.state.recentDiscoveries[0].thousandRollMultiplier, 4);
  assert.equal(result.state.recentDiscoveries[0].rolledAt, equalHourAt);
  const baseWeight = ntcWeight(currentWeights(beforeMilestone));
  const stackedWeight = ntcWeight(currentWeights(beforeMilestone, { bonusRoll: true, equalHourBonus: true, thousandRollBonus: true }));
  assert.ok(stackedWeight > baseWeight);
});

test('every ten-thousandth roll gets ×10 and stacks with roll, clock, and thousand-roll bonuses', () => {
  assert.equal(TEN_THOUSAND_ROLL_BONUS_EVERY, 10_000);
  assert.equal(TEN_THOUSAND_ROLL_BONUS_MULTIPLIER, 10);
  const equalHourAt = new Date(2026, 8, 23, 20, 20, 37).getTime();
  const beforeMilestone = { totalRolls: 9_999, bonusRollCounter: 9 };
  const result = rollTitle(beforeMilestone, 0n, { rolledAt: equalHourAt });
  assert.equal(result.state.totalRolls, 10_000);
  assert.equal(result.isBonusRoll, true);
  assert.equal(result.isEqualHourBonus, true);
  assert.equal(result.isThousandRollBonus, true);
  assert.equal(result.isTenThousandRollBonus, true);
  assert.equal(result.tenThousandRollMultiplier, 10);
  assert.equal(result.state.recentDiscoveries[0].isTenThousandRollBonus, true);
  assert.equal(result.state.recentDiscoveries[0].tenThousandRollMultiplier, 10);
  const baseWeight = ntcWeight(currentWeights(beforeMilestone));
  const stackedWeight = ntcWeight(currentWeights(beforeMilestone, { bonusRoll: true, equalHourBonus: true, thousandRollBonus: true, tenThousandRollBonus: true }));
  assert.ok(stackedWeight > baseWeight, 'all simultaneously active multipliers advance the curve');
});

test('collection luck advances once per pair of new titles, and caps at +100%', () => {
  const firstPair = normalizeState({ collectedIds: ['basic-01', 'basic-02'] });
  const three = normalizeState({ collectedIds: ['basic-01', 'basic-02', 'basic-03'] });
  assert.equal(luckForState(firstPair).passiveBps, 100);
  assert.equal(luckForState(three).passiveBps, 100);
  assert.equal(luckForState({ collectedIds: Array(300).fill('basic-01') }).passiveBps, 0);
  assert.equal(luckForState({ collectedIds: TITLES.map(title => title.id) }).passiveBps, 10_000);
});

test('rarity collection milestones improve that rarity while basic collection improves global luck', () => {
  const base = currentWeights({});
  const milestone = debugGrantTierTitles({}, 'epic', 5);
  assert.equal(milestone.granted, 5);
  assert.equal(publicProgress(milestone.state).tierProgress.find(tier => tier.id === 'epic').bonusBps, 250);
  assert.ok(ntcWeight(currentWeights(milestone.state)) > ntcWeight(base));
  const partial = normalizeState({ collectedIds: ['epic-06', 'epic-10'] });
  const completed = debugGrantTierTitles(partial, 'epic', 5);
  assert.equal(completed.granted, 3);
  assert.equal(publicProgress(completed.state).tierProgress.find(tier => tier.id === 'epic').count, 5);
  assert.equal(debugGrantTierTitles(completed.state, 'epic', 5).granted, 0);

  const basicMilestone = debugGrantTierTitles({}, 'basic', 5);
  assert.equal(luckForState(basicMilestone.state).passiveBps, 450);
  assert.ok(ntcWeight(currentWeights(basicMilestone.state)) > ntcWeight(base));
});

test('automatic collection milestones unlock 2x/3x cycles and stronger bonus rolls', () => {
  assert.equal(luckForState({ collectedIds: TITLES.slice(0, 49).map(title => title.id) }).rollsPerCycle, 1);
  const at50 = debugGrantTotalTitles({ collectedIds: TITLES.slice(0, 49).map(title => title.id) }, 50).state;
  assert.equal(luckForState(at50).rollsPerCycle, 2);
  assert.equal(luckForState(at50).bonusMultiplier, 3);
  const at99 = debugGrantTotalTitles(at50, 99).state;
  assert.equal(luckForState(at99).rollsPerCycle, 2);
  const at100 = debugGrantTotalTitles(at99, 100).state;
  assert.equal(luckForState(at100).rollsPerCycle, 3);
  assert.equal(luckForState(at100).bonusMultiplier, 5);
  assert.equal(luckForState(debugGrantTotalTitles(at100, 175).state).bonusMultiplier, 10);
  const batch = rollBatch(at100, [0n, 0n, 0n]);
  assert.equal(batch.results.length, 3);
  assert.equal(batch.state.totalRolls, at100.totalRolls + 3);

  const state = normalizeState({ collectedIds: at100.collectedIds, bonusRollCounter: 8 });
  const ninth = rollTitle(state, 0n);
  assert.equal(ninth.isBonusRoll, false);
  assert.equal(ninth.state.bonusRollCounter, 9);
  const tenth = rollTitle(ninth.state, 0n);
  assert.equal(tenth.isBonusRoll, true);
  assert.equal(tenth.state.bonusRollCounter, 0);
  assert.ok(ntcWeight(currentWeights(state, { bonusRoll: true })) > ntcWeight(currentWeights(state)));
});

test('debug progression can set rarity/total milestones and prepare the next bonus roll', () => {
  const first = rollTitle({}, 0n);
  const duplicate = rollTitle(first.state, 0n);
  const tierGrant = debugGrantTierTitles({}, 'unique', 10);
  assert.equal(tierGrant.granted, 10);
  assert.equal(publicProgress(tierGrant.state).tierProgress.find(tier => tier.id === 'unique').bonusBps, 500);
  const totalGrant = debugGrantTotalTitles({}, 75);
  assert.equal(totalGrant.granted, 75);
  assert.equal(luckForState(totalGrant.state).rollsPerCycle, 2);
  assert.equal(debugGrantTotalTitles(totalGrant.state, 50).granted, 0);
  assert.equal(debugReadyBonusRoll({}).bonusRollCounter, 9);
  assert.equal(first.state.totalRolls + 1, duplicate.state.totalRolls);
});

test('boosted probabilities remain ordered and the NTC tail receives more mass', () => {
  const state = normalizeState({ collectedIds: TITLES.slice(0, 100).map(title => title.id) });
  const weights = currentWeights(state);
  assert.equal([...weights.values()].reduce((sum, weight) => sum + weight, 0n), POOL);
  assert.ok(ntcWeight(weights) > ntcWeight(currentWeights({})));
  assert.ok(weights.get('basic-01') < currentWeights({}).get('basic-01'));
  assertRarityOrder(weights);
});

test('asymptotic luck compression preserves all rarity orderings and stays under the 1-in-10-million ceiling', () => {
  const preNtcTitles = TITLES.filter(title => title.tier !== 'ntc').map(title => title.id);
  const developedSave = { collectedIds: preNtcTitles, permanentUpgradeLevels: 80, longestSingularDrought: 1_000_000 };
  const neutral = currentWeights({});
  const developed = currentWeights(developedSave);
  const ceiling = POOL / RNG_NTC_ODDS_CEILING_DENOMINATOR;
  assert.ok(ntcWeight(developed) > ntcWeight(neutral), 'non-NTC progression raises the NTC tail without owning an NTC title');
  assert.ok(ntcWeight(developed) < ceiling);
  assert.equal([...developed.values()].reduce((sum, weight) => sum + weight, 0n), POOL);
  assert.ok([...developed.values()].every(weight => weight > 0n));
  assertRarityOrder(developed);

  const fullyBoosted = currentWeights({
    ...developedSave,
    permanentUpgradeLevels: Number.MAX_SAFE_INTEGER,
    equippedRelicIds: ['solar-clock', 'lunar-clock', 'astrolabe', 'lucky-feather', 'eclipse-prism', 'atlas-of-possibilities']
  }, {
    bonusRoll: true,
    equalHourBonus: true,
    thousandRollBonus: true,
    tenThousandRollBonus: true,
    eventMultiplier: 5,
    focusTierId: 'ntc',
    focusMultiplier: 3,
    consumableMultiplier: 4,
    localHour: 12
  });
  assert.ok(ntcWeight(fullyBoosted) <= ceiling, 'stacked bonuses cannot push the aggregate NTC chance above its hard ceiling');
  assert.ok(ntcWeight(fullyBoosted) < ceiling, 'finite luck approaches but does not reach the asymptote');
  assertRarityOrder(fullyBoosted);

  const unboundedUpgradeState = { ...developedSave, permanentUpgradeLevels: 1e308 };
  const beyondSafeNumber = currentWeights(unboundedUpgradeState, { consumableMultiplier: 4, eventMultiplier: 5 });
  assert.ok(ntcWeight(beyondSafeNumber) < ceiling, 'even an extreme finite upgrade count remains below the asymptote');
  assert.equal([...beyondSafeNumber.values()].reduce((sum, weight) => sum + weight, 0n), POOL);
  assertRarityOrder(beyondSafeNumber);
  assert.doesNotThrow(() => luckForState(unboundedUpgradeState), 'luck summaries avoid Number overflow for the unbounded store');

  const allNtcTitles = TITLES.filter(title => title.tier === 'ntc').map(title => title.id);
  const withNtc = currentWeights({
    ...developedSave,
    collectedIds: [...preNtcTitles, ...allNtcTitles],
    ownedRelicIds: ['atlas-of-possibilities'],
    equippedRelicIds: ['atlas-of-possibilities']
  });
  assert.deepEqual(withNtc, developed, 'NTC achievements and the 200-title relic do not create a circular route to the curve cap');
});

test('the 100% distribution remains exact, ordered, and renderable as luck grows', () => {
  for (const count of [0, 2, 40, 100, 200]) {
    const state = normalizeState({ collectedIds: TITLES.slice(0, count).map(title => title.id) });
    const weights = currentWeights(state);
    assert.equal([...weights.values()].reduce((sum, weight) => sum + weight, 0n), POOL);
    assertRarityOrder(weights);
    const catalog = publicCatalog(state);
    assert.equal(new Set(catalog.map(title => title.baseOdds)).size, TITLES.length, 'catalog reference odds stay distinct');
    assert.ok(catalog.every(title => !title.currentOdds.includes(',')));
  }
});

test('saved game data is JSON-safe, old saves start with zero Fragmentos, and unrelated workshop data is ignored', () => {
  const original = normalizeState({ collectedIds: ['basic-01', 'epic-01'], bonusRollCounter: 8, totalRolls: 42, totalAppSeconds: 1234, totalAutoRollSeconds: 987, lastAutoRollSessionSeconds: 65, lastTitleId: 'epic-01' });
  const restored = normalizeState(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored, original);
  const legacy = normalizeState({ fragments: 999, equippedRelicId: 'anything', focusTier: 'epic' });
  assert.equal(legacy.fragmentBalance, '0', 'obsolete workshop currency does not become new store balance');
  assert.equal(Object.hasOwn(legacy, 'fragments'), false);
  assert.equal(Object.hasOwn(legacy, 'equippedRelicId'), false);
  assert.equal(Object.hasOwn(legacy, 'focusTier'), false);
});

test('each roll grants exactly one title and duplicates do not grant collection luck', () => {
  const first = rollTitle({}, 0n);
  assert.equal(first.title.id, 'basic-01');
  assert.equal(first.isNew, true);
  assert.equal(first.state.collectedIds.length, 1);
  assert.equal(first.state.totalRolls, 1);

  const repeat = rollTitle(first.state, 0n);
  assert.equal(repeat.title.id, 'basic-01');
  assert.equal(repeat.isNew, false);
  assert.equal(repeat.state.collectedIds.length, 1);
  assert.equal(repeat.state.totalRolls, 2);
  assert.equal(luckForState(repeat.state).passiveBps, 0);
  assert.equal(repeat.state.recentDiscoveries.length, 1);
  assert.equal(repeat.state.recentDiscoveries[0].roll, 1);
});

test('title history records exact rolls and bonus details while recent discoveries remains an eight-item compatibility view', () => {
  const ordinaryTime = new Date(2026, 8, 23, 12, 34, 0).getTime();
  const rollSpecificTitle = (state, titleId) => {
    const weights = currentWeights(state, { bonusRoll: state.bonusRollCounter === 9 });
    let roll = 0n;
    for (const title of TITLES) {
      if (title.id === titleId) return rollTitle(state, roll, { rolledAt: ordinaryTime });
      roll += weights.get(title.id);
    }
    throw new Error(`Unknown title: ${titleId}`);
  };

  let state = rollTitle({}, 0n, { rolledAt: ordinaryTime }).state;
  assert.deepEqual(state.recentDiscoveries, [{ titleId: 'basic-01', titleNameAtDiscovery: 'Primeira Faísca', tierAtDiscovery: 'basic', tierLabelAtDiscovery: 'Básico', tierRankAtDiscovery: 0, catalogVersionAtDiscovery: CATALOG_VERSION, roll: 1, currentOdds: '1 em 2', isBonusRoll: false, rollBonusMultiplier: 1, isEqualHourBonus: false, equalHourMultiplier: 1, equalHourTime: '', isThousandRollBonus: false, thousandRollMultiplier: 1, isTenThousandRollBonus: false, tenThousandRollMultiplier: 1, consumableMultiplier: 1, consumableBoostTypes: [], rolledAt: ordinaryTime, eventName: '', eventMultiplier: 1, eventFocusTierLabel: '', eventFocusMultiplier: 1 }]);
  state = rollTitle(state, 0n, { rolledAt: ordinaryTime }).state;
  assert.equal(state.recentDiscoveries.length, 1, 'a duplicate must not create a discovery record');
  state = rollSpecificTitle(state, 'basic-02').state;
  assert.deepEqual(state.recentDiscoveries.slice(0, 2).map(({ titleId, roll }) => ({ titleId, roll })), [
    { titleId: 'basic-02', roll: 3 },
    { titleId: 'basic-01', roll: 1 }
  ]);

  for (let index = 2; index < 11; index++) state = rollSpecificTitle(state, `basic-${String(index + 1).padStart(2, '0')}`).state;
  assert.equal(state.recentDiscoveries.length, 8);
  assert.equal(state.recentDiscoveries[0].titleId, 'basic-11');
  assert.equal(state.recentDiscoveries.at(-1).titleId, 'basic-04');
  assert.equal(state.titleHistory.length, 11);
  assert.equal(state.titleHistory[0].titleId, 'basic-11');
  assert.equal(state.titleHistory.at(-1).titleId, 'basic-01');
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))), state);
  const legacy = normalizeState({ totalRolls: 3, collectedIds: ['basic-01', 'basic-02'], recentDiscoveries: [{ titleId: 'basic-01', roll: 1, currentOdds: '1 em 2' }] });
  assert.equal(legacy.titleHistory.length, 1, 'old recent discoveries migrate into the full-history data model');
  assert.deepEqual(normalizeState({ totalRolls: 2, collectedIds: ['basic-01'], recentDiscoveries: [{ titleId: 'basic-01', roll: 3, currentOdds: 'bad' }] }).titleHistory, []);
});

test('development debug tools add, remove, and clear titles without consuming rolls or time', () => {
  const debugTitle = TITLES.find(title => title.id === 'ntc-20');
  const original = normalizeState({
    collectedIds: ['basic-01'],
    totalRolls: 41,
    totalAppSeconds: 900,
    totalAutoRollSeconds: 300,
    lastAutoRollSessionSeconds: 60,
    recentDiscoveries: [{ titleId: 'basic-01', roll: 1, currentOdds: '1 em 2' }]
  });
  const added = debugGrantTitle(original, 'ntc-20');
  assert.equal(added.added, true);
  assert.equal(added.state.totalRolls, 41);
  assert.ok(added.state.collectedIds.includes('ntc-20'));
  assert.equal(debugGrantTitle(added.state, 'ntc-20').added, false);

  const removed = debugRemoveTitle(added.state, debugTitle.id);
  assert.equal(removed.removed, true);
  assert.equal(removed.state.totalRolls, 41);

  const cleared = debugClearTitles(removed.state);
  assert.equal(cleared.removedCount, 1);
  assert.deepEqual(cleared.state.collectedIds, []);
  assert.deepEqual(cleared.state.recentDiscoveries, []);
  assert.deepEqual(cleared.state.titleHistory, []);
  assert.equal(cleared.state.totalRolls, 41);
  assert.equal(cleared.state.totalAppSeconds, 900);
  assert.equal(cleared.state.totalAutoRollSeconds, 300);
  assert.equal(cleared.state.lastAutoRollSessionSeconds, 60);
});

test('roll boundaries move to the next title without overlaps or missing outcomes', () => {
  const weights = currentWeights({});
  const ordinaryTime = new Date(2026, 8, 23, 12, 34, 0).getTime();
  const first = TITLES[0];
  const second = TITLES[1];
  assert.equal(rollTitle({}, weights.get(first.id) - 1n, { rolledAt: ordinaryTime }).title.id, first.id);
  assert.equal(rollTitle({}, weights.get(first.id), { rolledAt: ordinaryTime }).title.id, second.id);
  assert.equal(rollTitle({}, POOL - 1n, { rolledAt: ordinaryTime }).title.id, TITLES.at(-1).id);
});

test('Fragmentos reward new and repeated titles by rarity and first-time event titles', () => {
  for (const tier of TIERS) {
    const title = TITLES.find(item => item.tier === tier.id);
    const first = rollTitle({}, randomValueForTitle({}, title.id));
    const base = BigInt(RNG_FRAGMENT_REWARDS[tier.id]);
    assert.equal(first.title.id, title.id);
    assert.equal(first.fragmentReward, (base * 2n).toString(), `${tier.id} first discovery doubles its reward`);
    assert.equal(first.state.fragmentBalance, first.fragmentReward);

    const duplicateState = normalizeState({ collectedIds: [title.id] });
    const repeated = rollTitle(duplicateState, randomValueForTitle(duplicateState, title.id));
    assert.equal(repeated.isNew, false);
    assert.equal(repeated.fragmentReward, base.toString(), `${tier.id} duplicate still pays its base reward`);
  }

  const event = { eventId: 'rain', id: 'rain:2026-10-01', reward: { titleId: 'limited-first-rain', odds: 1 } };
  const firstLimited = rollTitle({}, 0n, { event, limitedRewardValue: 0n });
  assert.ok(firstLimited.state.limitedTitles.includes('limited-first-rain'));
  assert.equal(firstLimited.fragmentReward, '1002', 'a new Basic plus its first limited event title pays 2 + 1,000');
  const repeatedLimited = rollTitle(firstLimited.state, 0n, { event, limitedRewardValue: 0n });
  assert.equal(repeatedLimited.fragmentReward, '1', 'an already-owned event title does not pay the one-time bonus again');
});

test('equipped Fragmentos relics carry fractional bonuses and boost every fragment reward source', () => {
  let state = normalizeState({
    collectedIds: ['basic-01'],
    ownedRelicIds: ['torn-pouch'],
    equippedRelicIds: ['torn-pouch']
  });
  let total = 0n;
  for (let index = 0; index < 10; index++) {
    const outcome = rollTitle(state, 0n);
    total += BigInt(outcome.fragmentReward);
    state = outcome.state;
  }
  assert.equal(total, 11n, 'ten 1-Fragmento rewards at ×1.10 produce 11 Fragmentos instead of losing every fraction');
  assert.equal(state.fragmentBalance, '11');
  assert.equal(state.fragmentRewardRemainderBps, 0);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))), state, 'the fractional carry survives a save/load round trip');

  const duplicateRelicState = normalizeState({
    collectedIds: ['basic-01'],
    ownedRelicIds: ['torn-pouch', 'lucky-feather'],
    equippedRelicIds: ['torn-pouch'],
    randomRelicTarget: 8_000,
    randomRelicProgress: 7_999
  });
  const duplicateRelic = rollTitle(duplicateRelicState, 0n, { randomRelicTargetValue: 0n, randomRelicChoiceValue: 0n });
  assert.equal(duplicateRelic.specialUnlocks.at(-1).duplicate, true);
  assert.equal(duplicateRelic.fragmentReward, '27501', '×1.10 applies to the 1 base Fragmento and 25,000 from the duplicate relic');
  assert.equal(duplicateRelic.state.fragmentRewardRemainderBps, 1_000);
});

test('Fragmentos store purchases use exact balances, doubling upgrade costs, and permanent luck', () => {
  const broke = purchasePermanentUpgrade({});
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, 'insufficient-fragments');
  assert.equal(broke.state.fragmentBalance, '0');

  let state = normalizeState({ fragmentBalance: '900719925474099312345' });
  const initialLuck = luckForState(state).totalBps;
  const first = purchasePermanentUpgrade(state);
  assert.equal(first.ok, true);
  assert.equal(first.cost, '50000');
  assert.equal(first.state.fragmentBalance, '900719925474099262345');
  assert.equal(first.state.nextPermanentUpgradeCost, '100000');
  assert.equal(luckForState(first.state).totalBps, initialLuck + 500);
  const second = purchasePermanentUpgrade(first.state);
  assert.equal(second.cost, '100000');
  assert.equal(second.state.nextPermanentUpgradeCost, '200000');
  assert.equal(luckForState(second.state).totalBps, initialLuck + 1_000);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(second.state))), second.state, 'the wallet, level, and next exact price survive an app restart');
  assert.equal([...currentWeights(second.state).values()].reduce((sum, weight) => sum + weight, 0n), POOL);
});

test('different Fortune consumables overlap as ×4 while repeats of one type queue', () => {
  const rollPurchase = purchaseConsumable({ fragmentBalance: '10000' }, 'rolls');
  assert.equal(rollPurchase.ok, true);
  assert.equal(rollPurchase.state.fragmentBalance, '5000');
  assert.equal(rollPurchase.state.consumableInventory.rolls, 1);
  const timePurchase = purchaseConsumable(rollPurchase.state, 'time');
  assert.equal(timePurchase.ok, true);
  assert.equal(timePurchase.state.fragmentBalance, '0');
  assert.equal(timePurchase.state.consumableInventory.time, 1);
  assert.equal(purchaseConsumable(timePurchase.state, 'rolls').ok, false);
  assert.equal(purchaseConsumable({ fragmentBalance: '99999' }, 'invalid').reason, 'invalid-consumable');

  const active = activateConsumable(timePurchase.state, 'rolls');
  const queued = activateConsumable(active.state, 'time');
  assert.equal(active.queued, false);
  assert.equal(queued.queued, false, 'the other consumable type starts immediately');
  assert.deepEqual(queued.state.activeBoost, { type: 'rolls', remaining: 600 });
  assert.deepEqual(queued.state.parallelBoost, { type: 'time', remaining: 600 });
  assert.deepEqual(queued.state.boostQueue, []);
  const twiceBoostedOdds = ntcWeight(currentWeights(queued.state, { consumableMultiplier: 2 }));
  const boostedOdds = ntcWeight(currentWeights(queued.state, { consumableMultiplier: 4 }));
  const ordinaryOdds = ntcWeight(currentWeights(queued.state));
  assert.ok(twiceBoostedOdds > ordinaryOdds && boostedOdds > twiceBoostedOdds, 'each active Fortune advances the curve before its ceiling');
  const outcome = rollTitle(queued.state, 0n);
  assert.equal(outcome.consumableBoostType, 'rolls+time');
  assert.deepEqual(outcome.consumableBoostTypes, ['rolls', 'time']);
  assert.equal(outcome.consumableMultiplier, 4);
  assert.deepEqual(outcome.state.activeBoost, { type: 'rolls', remaining: 599 });
  assert.deepEqual(outcome.state.parallelBoost, { type: 'time', remaining: 600 }, 'the roll counter does not burn the timed consumable');
  assert.equal([...currentWeights(outcome.state).values()].reduce((sum, weight) => sum + weight, 0n), POOL);

  const repeatedRoll = activateConsumable(activateConsumable({ consumableInventory: { rolls: 2 } }, 'rolls').state, 'rolls');
  assert.equal(repeatedRoll.queued, true, 'a repeat of the same consumable waits for its current duration');
  const withBothTypes = activateConsumable({ ...repeatedRoll.state, consumableInventory: { rolls: 0, time: 1 } }, 'time');
  assert.equal(withBothTypes.queued, false, 'a different type can still start alongside it');
  assert.deepEqual(withBothTypes.state.boostQueue, [{ type: 'rolls', remaining: 600 }]);
  const finalRollOfFirstBoost = rollTitle({ ...withBothTypes.state, activeBoost: { type: 'rolls', remaining: 1 } }, 0n);
  assert.deepEqual(finalRollOfFirstBoost.state.activeBoost, { type: 'rolls', remaining: 600 }, 'the queued repeat activates after the first roll-count effect ends');
  assert.deepEqual(finalRollOfFirstBoost.state.parallelBoost, { type: 'time', remaining: 600 }, 'the time-based effect is measured by app runtime, not rolls');
});

test('timed consumables pause while closed and only reduce active time-based effects', () => {
  const saved = normalizeState({ activeBoost: { type: 'time', remaining: 400 }, boostQueue: [{ type: 'time', remaining: 600 }] });
  const afterClosedTime = normalizeState(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(afterClosedTime.activeBoost, { type: 'time', remaining: 400 }, 'loading a save does not subtract time while the app was closed');
  const afterAppTime = advanceTimedBoost(afterClosedTime, 450);
  assert.deepEqual(afterAppTime.activeBoost, { type: 'time', remaining: 550 }, 'only 400 seconds end the current item; the remaining 50 seconds reduce the queued repeat');
  const queuedRoll = normalizeState({ activeBoost: { type: 'time', remaining: 3 }, boostQueue: [{ type: 'rolls', remaining: 600 }, { type: 'time', remaining: 600 }] });
  const afterCrossingRoll = advanceTimedBoost(queuedRoll, 30);
  assert.deepEqual(afterCrossingRoll.activeBoost, { type: 'time', remaining: 573 }, 'a queued different type is migrated to active and the next time boost continues for the remaining runtime');
  assert.deepEqual(afterCrossingRoll.parallelBoost, { type: 'rolls', remaining: 600 }, 'wall-clock time does not burn a roll-count boost');
  assert.deepEqual(afterCrossingRoll.boostQueue, []);
});

test('relic catalog no longer contains the misfortune triad and keeps six equipment slots', () => {
  assert.equal(RELICS.length, 14);
  assert.equal(RELIC_SETS.length, 2);
  assert.equal(new Set(RELICS.map(relic => relic.id)).size, 14);
  for (const set of RELIC_SETS) assert.equal(RELICS.filter(relic => relic.setId === set.id).length, 3);
  const publicState = publicRelicState({});
  assert.equal(publicState.slots.length, 6);
  assert.equal(publicState.catalog.length, 14);
  assert.equal(Object.hasOwn(publicState, 'randomRelicTarget'), false);
  assert.equal(Object.hasOwn(publicState, 'randomRelicProgress'), false);
  assert.equal(publicState.catalog.find(relic => relic.id === 'twin-core').purchasable, false);
  assert.equal(publicState.catalog.find(relic => relic.id === 'echo-spring').price, '100000');
  assert.equal(RELICS.find(relic => relic.id === 'twin-core').source, 'random-drop');
  assert.equal(RELICS.filter(relic => relic.source === 'event').length, 3);
  assert.equal(RELICS.filter(relic => relic.source === 'achievement').length, 2);
});

test('relic purchases, six unique equipment slots, and unequipping are validated', () => {
  assert.equal(purchaseRelic({}, 'solar-clock').reason, 'insufficient-fragments');
  assert.equal(purchaseRelic({ fragmentBalance: RNG_RELIC_COST.toString() }, 'misfortune-mark').reason, 'invalid-relic');
  assert.equal(purchaseRelic({ fragmentBalance: '999999999' }, 'twin-core').reason, 'invalid-relic');
  let state = normalizeState({ fragmentBalance: '300000', ownedRelicIds: ['twin-core'] });
  state = equipRelic(state, 'twin-core').state;
  for (const relic of RELICS.filter(item => item.source === 'shop')) {
    const purchase = purchaseRelic(state, relic.id);
    assert.equal(purchase.ok, true);
    state = purchase.state;
    const equipped = equipRelic(state, relic.id);
    assert.equal(equipped.ok, true);
    state = equipped.state;
  }
  assert.equal(state.equippedRelicIds.length, 6);
  assert.equal(equipRelic(state, 'misfortune-mark').reason, 'not-owned');
  assert.equal(purchaseRelic(state, 'solar-clock').reason, 'already-owned');
  const removed = unequipRelic(state, 'solar-clock');
  assert.equal(removed.ok, true);
  assert.equal(removed.state.equippedRelicIds.length, 5);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(removed.state))), removed.state);
});

test('Solar and Lunar follow local PC hours while the complete celestial set keeps both active', () => {
  const solar = { ownedRelicIds: ['solar-clock'], equippedRelicIds: ['solar-clock'] };
  assert.equal(relicEffects(solar, { localHour: 12 }).luckMultiplierBps, 11_200n);
  assert.equal(relicEffects(solar, { localHour: 23 }).luckMultiplierBps, 10_000n);
  const lunar = { ownedRelicIds: ['lunar-clock'], equippedRelicIds: ['lunar-clock'] };
  assert.equal(relicEffects(lunar, { localHour: 23 }).luckMultiplierBps, 11_200n);
  assert.equal(relicEffects(lunar, { localHour: 12 }).luckMultiplierBps, 10_000n);
  const complete = { ownedRelicIds: ['solar-clock', 'lunar-clock', 'astrolabe'], equippedRelicIds: ['solar-clock', 'lunar-clock', 'astrolabe'] };
  assert.equal(relicEffects(complete, { localHour: 12 }).luckMultiplierBps, 13_798n);
  assert.equal(relicEffects(complete, { localHour: 23 }).luckMultiplierBps, 13_798n);
  assert.deepEqual(relicEffects(complete, { localHour: 12 }).completeSetIds, ['celestial']);
});

test('echo relic effects remain independent of drought statistics', () => {
  const allEchoes = ['twin-core', 'echo-spring', 'fragment-pouch'];
  const echoState = normalizeState({ ownedRelicIds: allEchoes, equippedRelicIds: allEchoes, totalRolls: 99 });
  assert.equal(rollsPerAction(echoState), 5, 'twin core and set double 1 into 4, then the spring crosses roll 100');
  assert.equal(relicEffects(echoState).fragmentMultiplierBps, 12_500);

  const dryState = { sinceSingular: 40_000, longestSingularDrought: 40_000 };
  assert.equal(relicEffects(dryState).luckMultiplierBps, 10_000n);
  assert.equal(relicEffects(dryState).fragmentMultiplierBps, 10_000);
  assert.equal(rollsPerAction(dryState), 1);
  assert.deepEqual(currentWeights(dryState), currentWeights({ sinceSingular: 0, longestSingularDrought: 0 }), 'dry-roll counters do not alter title chances');
});

test('legacy misfortune relics convert once to Fragmentos and preserve independent drought stats', () => {
  const priorSave = {
    totalRolls: 73_105,
    sinceSingular: 27_047,
    longestSingularDrought: 27_047,
    fragmentBalance: '123456',
    ownedRelicIds: ['cracked-die', 'solar-clock'],
    equippedRelicIds: ['misfortune-mark', 'cracked-die', 'solar-clock'],
    droughtRelicStage: 1,
    droughtRelicProgress: 14_999,
    droughtRelicProgressVersion: RNG_RELIC_REMOVAL_VERSION - 1
  };
  const migratedSave = migrateRemovedMisfortuneRelics(priorSave);
  assert.deepEqual(migratedSave.ownedRelicIds, ['solar-clock']);
  assert.deepEqual(migratedSave.equippedRelicIds, ['solar-clock']);
  assert.equal(migratedSave.fragmentBalance, '173456');
  assert.equal(migratedSave.relicRemovalVersion, RNG_RELIC_REMOVAL_VERSION);
  assert.equal(Object.hasOwn(migratedSave, 'droughtRelicProgress'), false);
  assert.equal(migratedSave.totalRolls, priorSave.totalRolls);
  assert.equal(migratedSave.sinceSingular, priorSave.sinceSingular);
  assert.equal(migrateRemovedMisfortuneRelics(migratedSave), migratedSave, 'migration does not pay out again');

  const primaryAlreadyStripped = { relicRemovalVersion: 2, droughtRelicProgressVersion: 2, fragmentBalance: '400', sinceSingular: 27_047, ownedRelicIds: ['solar-clock'] };
  const recoverableBackup = { droughtRelicProgressVersion: 1, ownedRelicIds: ['misfortune-mark'], equippedRelicIds: ['drought-heart'] };
  const recovered = migrateRemovedMisfortuneRelics(primaryAlreadyStripped, recoverableBackup);
  assert.equal(recovered.fragmentBalance, '50400', 'backup-only ownership is compensated once');
  assert.deepEqual(recovered.ownedRelicIds, ['solar-clock']);
  assert.equal(recovered.sinceSingular, 27_047);
});

test('hidden random drops use 8k-12k targets, reset only themselves, and convert duplicates', () => {
  const before = normalizeState({ collectedIds: ['basic-01'], randomRelicTarget: 8_000, randomRelicProgress: 7_999, fragmentBalance: '0' });
  const drop = rollTitle(before, 0n, { randomRelicTargetValue: 4_000n, randomRelicChoiceValue: 0n });
  assert.ok(drop.state.ownedRelicIds.includes('lucky-feather'));
  assert.equal(drop.state.randomRelicProgress, 0);
  assert.equal(drop.state.randomRelicTarget, 12_000);
  assert.equal(drop.specialUnlocks.at(-1).source, 'random-drop');

  const duplicateStart = normalizeState({ ...drop.state, randomRelicTarget: 8_000, randomRelicProgress: 7_999, fragmentBalance: '0' });
  const duplicate = rollTitle(duplicateStart, 0n, { randomRelicTargetValue: 0n, randomRelicChoiceValue: 0n });
  assert.equal(duplicate.specialUnlocks.at(-1).duplicate, true);
  assert.equal(duplicate.fragmentReward, (RNG_DUPLICATE_RELIC_REWARD + 1n).toString());
  assert.equal(duplicate.state.randomRelicTarget, 8_000);
  assert.equal(normalizeState(JSON.parse(JSON.stringify(drop.state))).randomRelicTarget, 12_000, 'the hidden target survives restart');

  const rareStart = normalizeState({ randomRelicTarget: 8_000, randomRelicProgress: 7_999 });
  const rareDrop = rollTitle(rareStart, 0n, { randomRelicTargetValue: 0n, randomRelicChoiceValue: 999n });
  assert.ok(rareDrop.state.ownedRelicIds.includes('twin-core'), 'the special draw selects the shop and event exclusive relic only from the rare random-drop path');
});

test('events grant their own exclusive relics without resetting random-drop progress', () => {
  const event = { id: 'fragments:2026-09-27', eventId: 'fragments', reward: { titleId: 'limited-fragment-2026-09', rollGoal: 1_000 } };
  const state = normalizeState({ eventRollProgress: { windowId: event.id, rolls: 999 }, randomRelicTarget: 9_000, randomRelicProgress: 123 });
  const reward = rollTitle(state, 0n, { event, eventRelicChoiceValue: 1n });
  assert.ok(reward.state.ownedRelicIds.includes('new-moon-seal'));
  assert.equal(reward.state.randomRelicProgress, 124);
  assert.ok(reward.state.eventRelicRewardedWindows.includes(event.id));
  const repeated = rollTitle(reward.state, 0n, { event, eventRelicChoiceValue: 2n });
  assert.equal(repeated.specialUnlocks.some(item => item.source === 'event'), false, 'the same event window cannot pay a second relic');

  const eclipse = { id: 'eclipse:2026-10-03', eventId: 'eclipse' };
  const eclipseReward = rollTitle(normalizeState({}), 0n, { event: eclipse });
  assert.ok(eclipseReward.state.ownedRelicIds.includes('eclipse-prism'));

  const duplicateEvent = { ...event, id: 'fragments:2026-10-04', reward: { titleId: 'limited-fragment-2026-10', rollGoal: 1_000 } };
  const duplicateState = normalizeState({ ...reward.state, collectedIds: ['basic-01'], fragmentBalance: '0', eventRollProgress: { windowId: duplicateEvent.id, rolls: 999 } });
  const duplicate = rollTitle(duplicateState, 0n, { event: duplicateEvent, eventRelicChoiceValue: 1n });
  assert.equal(duplicate.specialUnlocks.at(-1).duplicate, true);
  assert.equal(duplicate.fragmentReward, (RNG_DUPLICATE_RELIC_REWARD + LIMITED_TITLE_FRAGMENT_REWARD + 1n).toString());
});

test('collection achievements grant their exclusive relics once', () => {
  const at49 = TITLES.slice(0, 49).map(title => title.id);
  const title50 = TITLES.find(title => !at49.includes(title.id));
  const medal = rollTitle({ collectedIds: at49 }, randomValueForTitle({ collectedIds: at49 }, title50.id));
  assert.ok(medal.state.ownedRelicIds.includes('cartographers-medal'));
  assert.ok(medal.specialUnlocks.some(item => item.relicId === 'cartographers-medal'));

  const at199 = TITLES.slice(0, 199).map(title => title.id);
  const title200 = TITLES.find(title => !at199.includes(title.id));
  const atlas = rollTitle({ collectedIds: at199 }, randomValueForTitle({ collectedIds: at199 }, title200.id));
  assert.ok(atlas.state.ownedRelicIds.includes('atlas-of-possibilities'));
  assert.ok(atlas.specialUnlocks.some(item => item.relicId === 'atlas-of-possibilities'));
});

test('the game is reachable from Home, exposes the Fragmentos shop, and uses isolated main-process transactions', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const theme = fs.readFileSync(path.join(root, 'src', 'theme.css'), 'utf8');
  const rng = fs.readFileSync(path.join(root, 'src', 'rng.cjs'), 'utf8');
  const canonicalCatalog = fs.readFileSync(path.join(root, 'content', 'rng-title-catalog.json'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  assert.match(html, /data-view="rng"/);
  assert.match(html, /href="\.\/theme\.css"/);
  assert.match(html, /data-open-tool="rng"/);
  assert.match(html, /id="rngView"/);
  assert.match(html, /id="rngCatalog"/);
  assert.match(html, /id="rngTitleHistoryList"/);
  assert.match(html, /id="rngTitleHistorySearch"/);
  assert.match(html, /id="rngTitleHistoryTier"/);
  assert.match(html, /<option value="recent">Recentes<\/option>/);
  assert.doesNotMatch(html, /Descobertas recentes|rngDiscoveryLog/);
  assert.match(html, /id="rngUnlockNotice"/);
  assert.match(html, /id="rngTitleUnlockSound" src="\.\/assets\/rng-title-deep\.mp3"/);
  assert.match(html, /data-rng-section="shop"/);
  assert.match(html, /data-rng-section="shop"[\s\S]*data-rng-section="inventory"/);
  assert.match(html, /data-rng-section="patch-notes"><span class="rng-section-tab-icon"[^>]*><\/span>Atualizações/);
  assert.match(html, /data-rng-panel="patch-notes"[\s\S]*id="rngPatchNotes"/);
  assert.match(html, /rng-changelog\.js/);
  const rngChangelog = fs.readFileSync(path.join(root, 'src', 'rng-changelog.js'), 'utf8');
  const utilitiesChangelog = fs.readFileSync(path.join(root, 'src', 'changelog.js'), 'utf8');
  assert.match(rngChangelog, /window\.NTC_RNG_CHANGELOG/);
  assert.match(rngChangelog, /bônus permanentes por primeira descoberta de raridade escalam de \+1% em Épico a \+500% em Além do NTC/);
  assert.doesNotMatch(utilitiesChangelog, /NTC RNG|Fragmentos|relíquias/i, 'the general app changelog stays separate from game patch notes');
  assert.match(html, /data-rng-panel="inventory"/);
  assert.match(html, /id="rngFragmentsBalance"/);
  assert.match(html, /id="rngBuyUpgrade"/);
  assert.match(html, /id="rngActivateRollBoost"/);
  assert.match(html, /id="rngActivateTimeBoost"/);
  assert.match(app, /function renderRngInventory\(state\)/);
  assert.doesNotMatch(html, /rngNextLuck|rngWorkshop|rngCatalyst|rngFocus|rngCategoryProgress|Oficina/);
  assert.doesNotMatch(app, /rngNextLuck|rngWorkshop|rngCatalyst|rngFocus|rngCategoryProgress|catalysts|craftRngItem/);
  assert.match(html, /id="rngRelicShop"/);
  assert.match(html, /id="rngRelicSlots"/);
  assert.match(html, /id="rngRelicInventory"/);
  assert.doesNotMatch(app, /resultCount.*resultados por ação/);
  assert.match(preload, /purchaseRngRelic/);
  assert.match(preload, /equipRngRelic/);
  assert.match(main, /purchase-rng-relic/);
  assert.match(main, /equip-rng-relic/);
  assert.match(html, /id="rngDebugClearAll"/);
  assert.match(html, /id="rngDebugSoundTest"/);
  assert.match(styles, /\.rng-profile-panel\s*\{\s*align-self:\s*start;/);
  assert.match(styles, /\.rng-shop-card\s*\{[^}]*flex-direction:\s*column/);
  assert.match(styles, /\.rng-shop-card > button, \.rng-shop-actions\s*\{\s*margin-top:\s*auto;/);
  assert.match(app, /window\.ntc\.onRngState\(renderRngState\)/);
  assert.match(app, /rng-discovery-detail/);
  assert.match(app, /state.titleHistory/);
  assert.match(app, /rngHistoryTier = 'recent'/);
  assert.match(app, /rngHistoryTier === 'recent'/);
  assert.doesNotMatch(app, /Detalhes da obtenção não foram registrados nesta versão|com registro/);
  assert.match(app, /normalizeRngSearch/);
  assert.match(app, /Horas iguais ×2/);
  assert.match(app, /Bônus acumulados ×/);
  assert.match(app, /Marco de 1\.000 rolagens ×4/);
  assert.match(app, /Marco de 10\.000 rolagens ×10/);
  assert.match(html, /id="rngThousandBonusInfo"/);
  assert.match(html, /id="rngTenThousandBonusInfo"/);
  assert.match(html, /id="rngClockStatus"/);
  assert.match(app, /getEqualHourClockStatus/);
  assert.match(app, /<small>Rolagem<\/small>/);
  assert.match(app, /Chance na rolagem/);
  assert.match(html, /class="rng-main-title-line"[\s\S]*<h1>Além do Acaso<\/h1>[\s\S]*id="rngOddsHelpButton"[^>]*aria-haspopup="dialog"[\s\S]*?<svg viewBox="0 0 20 20"/);
  assert.match(html, /class="section-heading rng-collection-heading"><h2>Coleção<\/h2>/);
  assert.doesNotMatch(html, /rng-collection-title/);
  assert.match(html, /id="rngOddsHelpDialog"[^>]*aria-labelledby="rngOddsHelpTitle"/);
  assert.match(html, /conjunto total <code>POOL = 10⁸⁰<\/code>/);
  assert.match(html, /Σ wᵢ = POOL/);
  assert.match(html, /Amostragem sem viés de módulo/);
  assert.match(html, /f\(b\) = b \/ \(b \+ 25\.000\)/);
  assert.match(html, /permanece abaixo de <code>1 \/ 10\.000\.000<\/code> por rolagem/);
  assert.match(html, /Sem garantia por sequência|Teto e ausência de “pity”/);
  assert.match(app, /\$\('#rngOddsHelpButton'\)\.onclick = \(\) => rngOddsHelpDialog\.showModal\(\)/);
  assert.match(app, /class="rng-title-odds"><strong>\$\{formatRngOdds\(title\.baseOdds\)\}/);
  assert.match(app, /class="rng-title-mark" aria-hidden="true"[\s\S]*rng-title-locked-mark/);
  assert.match(app, /formatRngOdds\(record\.currentOdds \|\| title\.baseOdds\)/);
  assert.match(app, /class="rng-result-oddsline"[\s\S]*formatRngOdds\(latest\.currentOdds\)/);
  assert.match(app, /function formatRngOdds[\s\S]*return `\$\{safeText\(match\[1\]\)\}<sup>/);
  assert.doesNotMatch(app, /<small>Odds de catálogo<\/small>/);
  assert.doesNotMatch(html, /rng-catalog-note|Odds de catálogo/);
  assert.match(theme, /\.rng-info-card\.unlocked/);
  assert.match(theme, /\.rng-title-reveal\[data-tier="transcendent"\][^}]*--rng-reveal-accent:\s*#[0-9a-f]{6}/);
  assert.doesNotMatch(theme, /rng-title-odds/);
  assert.match(styles, /\.rng-title-odds\s*\{[^}]*justify-items:\s*center/);
  assert.match(styles, /\.rng-title-odds\s*\{[^}]*min-width:\s*70px[^}]*font-variant-numeric:\s*lining-nums tabular-nums/);
  assert.match(styles, /\.rng-title-odds strong\s*\{[^}]*font:\s*700 13px\/1\.15/);
  assert.match(styles, /\.rng-title-odds sup\s*\{[^}]*font-size:\s*\.88em/);
  assert.match(styles, /\.rng-info-button:hover[^}]*color:\s*var\(--text\)/);
  assert.match(styles, /\.rng-info-button\.rng-main-info-button svg\s*\{\s*width:\s*18px;\s*height:\s*18px;/);
  assert.match(styles, /\.rng-title-row\.collected\s*\{[^}]*box-shadow:\s*inset 3px 0 0 var\(--accent-violet\)/);
  assert.match(styles, /\.rng-title-row\.locked \.rng-title-info strong\s*\{[^}]*color:\s*#626168/);
  assert.match(styles, /\.rng-discovery-detail strong\s*\{[^}]*font:\s*700 13px\/1\.15 "Segoe UI Variable"/);
  assert.match(styles, /\.rng-result-oddsline > strong\s*\{[^}]*font:\s*700 13px\/1\.15 "Segoe UI Variable"/);
  assert.match(styles, /\.rng-title-history-list\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(app, /class="rng-discovery-meta"/);
  assert.match(styles, /\.rng-title-history-card\s*\{[^}]*min-height:\s*72px/);
  assert.match(styles, /\.rng-title-history-card \.rng-discovery-detail\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(styles, /\.rng-title-history-card:not\(\.has-record\)\s*\{[^}]*min-height:\s*62px/);
  assert.doesNotMatch(styles, /\.rng-title-history-list\s*\{[^}]*grid-auto-flow:\s*column/);
  assert.match(app, /collectCandidates\(unlockResults, previousRoll \?\? 0\)/);
  assert.match(app, /showRngUnlockBatch\(revealCandidates, \{ defer: true \}\)/);
  assert.match(app, /function enqueueRngUnlock\(item\)/);
  assert.match(main, /rngLatestUnlocks = publicResults\.filter\(result => result\.isNew \|\| result\.specialUnlocks\?\.length\)\.map\(result => \(\{ \.\.\.result, specialUnlocks: result\.specialUnlocks \|\| \[\] \}\)\);/);
  assert.match(app, /isDevelopmentBuild\(\)/);
  assert.match(app, /rngDebugEnabled = await window\.ntc\.isDevelopmentBuild\(\);\s*if \(!rngDebugEnabled\) return;\s*\$\('#rngDebugTrigger'\)\.classList\.remove\('hidden'\)/);
  assert.match(preload, /getRngState:.*get-rng-state/);
  assert.match(preload, /purchaseRngUpgrade:.*purchase-rng-upgrade/);
  assert.match(preload, /purchaseRngConsumable:.*purchase-rng-consumable/);
  assert.match(preload, /activateRngConsumable:.*activate-rng-consumable/);
  assert.match(main, /purchasePermanentUpgrade\(rngGame\)/);
  assert.match(main, /purchaseConsumable\(rngGame, type\)/);
  assert.match(main, /activateConsumable\(rngGame, type\)/);
  assert.match(main, /advanceTimedBoost\(rngGame, elapsed\)/);
  assert.match(main, /activeBoost\?\.type === 'time'/);
  assert.match(preload, /setRngAutoRoll:.*set-rng-auto-roll/);
  assert.match(main, /ipcMain\.handle\('set-rng-auto-roll'/);
  assert.match(main, /ipcMain\.handle\('is-development-build', \(\) => !app\.isPackaged\)/);
  assert.match(main, /setInterval\(\(\) => \{[\s\S]*performRngRoll\(\)/);
  assert.match(main, /recentDiscoveries:\s*rngGame\.recentDiscoveries/);
  assert.match(main, /makeRngAchievement\('rolls-10000000'[\s\S]*?10_000_000\)/);
  assert.match(main, /makeRngAchievement\('time-manual-100h'[\s\S]*?100\)/);
  assert.match(main, /makeRngAchievement\('time-auto-1000h'[\s\S]*?1_000\)/);
  assert.match(main, /\.filter\(achievement => achievement\.unlocked\)/);
  assert.match(main, /achievement-count-40/);
  assert.match(main, /unique-50'[\s\S]*?Desbloqueia 2 rolagens por clique/);
  assert.match(main, /unique-100'[\s\S]*?Desbloqueia 3 rolagens por clique/);
  assert.match(app, /item\.rewardText/);
  assert.match(app, /rngSecretLuck/);
  assert.match(main, /titleHistory:\s*rngGame\.titleHistory/);
  assert.match(main, /isEqualHourBonus:\s*result\.isEqualHourBonus/);
  assert.match(main, /isThousandRollBonus:\s*result\.isThousandRollBonus/);
  assert.match(main, /isTenThousandRollBonus:\s*result\.isTenThousandRollBonus/);
  assert.doesNotMatch(preload, /isWindowMinimizedOrHidden/);
  assert.doesNotMatch(main, /window-is-minimized-or-hidden/);
  assert.match(app, /audio\.volume = 0\.65[\s\S]*audio\.play\(\)/);
  assert.match(app, /\$\('#rngDebugSoundTest'\)\.onclick = previewRngTitleSound/);
  assert.match(app, /async function previewRngTitleSound\(\)[\s\S]*if \(!rngDebugEnabled\) return;[\s\S]*playRngTitleSound\(null, \{ preview: true \}\)/);
  assert.ok(fs.statSync(path.join(root, 'src', 'assets', 'rng-title-deep.mp3')).size > 0, 'the provided title sound is packaged with the app');
  assert.match(html, /class="[^"]*rng-debug-trigger[^\"]*hidden"[^>]*id="rngDebugTrigger"/);
  assert.match(main, /if\s*\(!app\.isPackaged\)\s*\{[\s\S]*debug-rng-add-title[\s\S]*debug-rng-clear-titles/);
  assert.match(preload, /debugClearRngTitles:.*debug-rng-clear-titles/);
  assert.match(html, /id="rngDebugGrantTier"/);
  assert.match(html, /id="rngDebugTotalMilestone"/);
  assert.match(html, /id="rngDebugGrantTotalTitles"/);
  assert.match(html, /id="rngDebugBonus"/);
  assert.match(preload, /debugGrantRngTier:.*debug-rng-grant-tier/);
  assert.match(main, /ipcMain\.handle\('debug-rng-grant-tier'/);
  assert.match(preload, /debugGrantRngTotal:.*debug-rng-grant-total/);
  assert.match(main, /ipcMain\.handle\('debug-rng-grant-total'/);
  assert.match(canonicalCatalog, /O Favorito do Acaso/);
  assert.match(main, /ntc-rng-state\.json/);
});

test('deep title sound plays for new Singular+ titles in either window state', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const functionSource = app.match(/function shouldPlayRngTitleSound\(result\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource, 'the sound gate should be testable independently of the UI');
  const shouldPlay = vm.runInNewContext(`(${functionSource})`);
  const result = tier => ({ isNew: true, title: { tier } });
  assert.equal(shouldPlay(result('basic')), false);
  assert.equal(shouldPlay(result('epic')), false);
  for (const tier of ['unique', 'legendary', 'mythic', 'exalted', 'glorious', 'transcendent', 'dimensional', 'ntc']) assert.equal(shouldPlay(result(tier)), true, `${tier} should play the sound`);
  assert.equal(shouldPlay({ ...result('unique'), isNew: false }), false, 'duplicates stay silent');
  assert.equal(shouldPlay({ ...result('unique'), simulation: true }), false, 'debug previews stay silent');
  assert.match(app, /audio\.pause\(\); audio\.currentTime = 0; await audio\.play\(\)/);
  assert.match(app, /catch \(error\) \{ console\.warn\('Não foi possível reproduzir o som de título do RNG:'/);
  assert.match(main, /appendSwitch\('autoplay-policy', 'no-user-gesture-required'\)/);
  assert.doesNotMatch(app, /isWindowMinimizedOrHidden/);
  assert.doesNotMatch(main, /window-is-minimized-or-hidden/);
});

test('neutral relic luck is shown as zero contribution instead of implying an equipped relic', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const multiplierSource = app.match(/function formatRngRelicMultiplier\(value\)\s*\{[\s\S]*?\n\}/)?.[0];
  const luckSource = app.match(/function formatRngRelicLuck\(value\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(multiplierSource && luckSource, 'relic luck formatting should be independently testable');
  const formatRngRelicMultiplier = vm.runInNewContext(`(${multiplierSource})`);
  const formatLuck = vm.runInNewContext(`(${luckSource})`, { formatRngRelicMultiplier });
  assert.equal(formatLuck('10000'), '+0% relíquias', 'no relic luck bonus is active by default');
  assert.equal(formatLuck(undefined), '+0% relíquias', 'missing legacy state is treated as neutral');
  assert.equal(formatLuck('11200'), '×1,12 relíquias', 'an active luck relic still shows its multiplier');
  assert.match(app, /\$\('#rngRelicLuck'\)\.textContent = formatRngRelicLuck\(state\.relicLuckMultiplierBps\)/);
});

test('rarity reveal motion has user controls, tier styling, and a debug preview', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const iconStyles = fs.readFileSync(path.join(root, 'src', 'rng-icons.css'), 'utf8');
  const rngTheme = fs.readFileSync(path.join(root, 'src', 'rng-theme.css'), 'utf8');
  const eventScenes = fs.readFileSync(path.join(root, 'src', 'rng-event-scenes.css'), 'utf8');
  const iconModule = fs.readFileSync(path.join(root, 'src', 'rng-icons.js'), 'utf8');
  const iconWindow = { matchMedia: () => ({ matches: false }) };
  const iconDocument = { documentElement: { dataset: { rngRevealMotion: 'full' } } };
  vm.runInNewContext(iconModule, { window: iconWindow, document: iconDocument });
  const tierIds = ['basic', 'epic', 'unique', 'legendary', 'mythic', 'exalted', 'glorious', 'transcendent', 'dimensional', 'ntc'];
  const tierArtwork = tierIds.map(tier => iconWindow.NTCRngIcons.render(`tier-${tier}`, { size: 20 }));
  const tierDefinitions = tierIds.map(tier => iconWindow.NTCRngIcons.definition(`tier-${tier}`));
  assert.equal(new Set(tierDefinitions.map(item => item.src)).size, tierIds.length, 'every rarity has its own generated illustration');
  assert.equal(iconWindow.NTCRngIcons.definition('tier-transcendent').src, './assets/rng/ruins/tiers/dimensional.webp', 'the Abissal tier uses the supplied dimensional relic art');
  assert.equal(iconWindow.NTCRngIcons.definition('tier-dimensional').src, './assets/rng/ruins/tiers/transcendent.webp', 'the Inominável tier uses the supplied transcendent relic art');
  assert.ok(tierArtwork.every(markup => /<img[^>]+assets\/rng\/ruins\/tiers\/[a-z]+\.webp/.test(markup)));
  assert.ok(tierDefinitions.every(item => item.kind === 'raster'));
  assert.ok(tierDefinitions.every(item => Array.isArray(item.opticalOffset) && item.opticalOffset.length === 2), 'each rarity has a subtle optical-centering correction');
  assert.ok(tierDefinitions.find(item => item.id === 'tier-ntc').opticalOffset[0] < -3, 'the NTC art is optically shifted left to compensate for its right-heavy silhouette');
  assert.ok(tierDefinitions.every(item => fs.existsSync(path.join(root, 'src', item.src.replace('./', '')))));
  const gameArtIds = ['event-rain', 'event-eclipse', 'event-alignment', 'event-fragments', 'set-celestial', 'set-echoes', 'shop-fortune-rolls', 'shop-fortune-time', 'shop-enhanced-luck'];
  for (const id of gameArtIds) {
    const definition = iconWindow.NTCRngIcons.definition(id);
    assert.equal(definition?.kind, 'raster', `${id} is registered as a reusable raster asset`);
    assert.ok(fs.existsSync(path.join(root, 'src', definition.src.replace('./', ''))), `${id} asset exists`);
  }
  for (const id of ['ui-profile', 'ui-online', 'ui-history', 'ui-collection', 'ui-achievements', 'ui-statistics', 'ui-events', 'ui-shop', 'ui-inventory', 'ui-updates']) {
    assert.equal(iconWindow.NTCRngIcons.definition(id)?.kind, 'vector', `${id} is registered for the remaining navigation tabs`);
  }
  const rasterDefinitions = iconWindow.NTCRngIcons.list().filter(item => item.kind === 'raster');
  assert.equal(rasterDefinitions.length, 34, 'all 34 illustrated RNG assets have a registered identity');
  for (const definition of rasterDefinitions) {
    assert.ok(fs.existsSync(path.join(root, 'src', iconWindow.NTCRngIcons.definition(definition.id).src.replace('./', ''))), `${definition.id} artwork exists`);
  }
  const animationOptions = [];
  iconWindow.NTCRngIcons.play({ animate: (_frames, options) => { animationOptions.push(options); return { cancel() {} }; } }, 'legendary', { force: true, delay: 360 });
  assert.equal(animationOptions[0].delay, 360);
  assert.match(html, /id="rngRevealMotion"[\s\S]*value="reduced"[\s\S]*value="off"[\s\S]*value="full"/);
  assert.match(html, /id="rngDebugSimulate"[^>]*>Prévia da revelação/);
  assert.match(app, /const RNG_REVEAL_MOTION_KEY = 'ntc-rng-reveal-motion'/);
  assert.match(app, /applyRngRevealPreference\(\)/);
  assert.match(app, /showRngUnlock\(result, \{ forceFullMotion = false \} = \{\}\)/);
  assert.match(app, /simulation: true \}, \{ forceFullMotion: true \}\)/);
  assert.match(app, /function rngCatalogOddsForTitle\(titleId\)[\s\S]*\?\.baseOdds/);
  assert.match(app, /const titleOdds = eventKind === 'special'[\s\S]*rngCatalogOddsForTitle\(result\.title\.id\) \|\| result\.baseOdds/);
  assert.match(app, /const resolvedIconId = iconDefinition \? iconId : `tier-\$\{tier\}`/);
  assert.match(app, /function rngTitleIcon\(title, options = \{\}\)[\s\S]*title\?\.assetId[\s\S]*window\.NTCRngIcons\?\.definition\(candidate\)/);
  assert.match(app, /rngTitleIcon\(title, \{ size: 19 \}\)/);
  assert.match(app, /baseOdds: title\.baseOdds, simulation: true/);
  assert.match(app, /Chance base \$\{title\.baseOdds\}/);
  assert.match(html, /<dialog class="rng-title-reveal" id="rngUnlockNotice"[^>]*aria-labelledby="rngUnlockTitle"/);
  assert.match(html, /class="rng-reveal-art-host"[\s\S]*class="rng-reveal-icon-shimmer"/);
  assert.doesNotMatch(html, /class="rng-reveal-ritual"/, 'the old wireframe is removed from the reveal DOM');
  assert.match(html, /class="rng-reveal-particles rng-reveal-particles-back"/);
  assert.match(html, /class="rng-reveal-particles rng-reveal-particles-mid"/);
  assert.match(html, /class="rng-reveal-particles rng-reveal-particles-front"/);
  assert.match(app, /render\(resolvedIconId,[\s\S]*className: 'rng-reveal-art'/);
  assert.match(app, /const rngRevealBands = Object\.freeze\(\{ basic: 1, epic: 2, unique: 3, legendary: 3, mythic: 4, exalted: 4, glorious: 4, transcendent: 5, dimensional: 5, ntc: 5 \}\)/);
  assert.match(app, /rngRevealSettleMs = Object\.freeze\(\{ 1: 900, 2: 1650, 3: 2350, 4: 4150, 5: 6000 \}\)/);
  assert.match(app, /function cancelRngRevealMotion\(/);
  assert.match(app, /function hideRngDebugForReveal\(\)/);
  assert.match(app, /function restoreRngDebugAfterReveal\(\)/);
  assert.match(app, /rngRevealSettleMs\[revealBand\]/);
  assert.match(app, /notice\.dataset\.revealBand = String\(revealBand\)/);
  assert.match(app, /cancelRngRevealMotion\(notice\)/);
  assert.match(app, /rngTitleIcon\(title, \{ size: 19, animation: 'none' \}\)/);
  assert.match(html, /class="rng-reveal-odds" id="rngUnlockDetails"/);
  assert.match(html, /NTC <span>RNG<\/span>/);
  assert.match(app, /\$\('#rngUnlockDetails'\)\.textContent = titleOdds/);
  assert.doesNotMatch(app, /Simulação visual, sem rolagem|Rolagem #\$\{new Intl\.NumberFormat\('pt-BR'\)/);
  assert.doesNotMatch(html, /rng-reveal-orbit/);
  assert.match(styles, /\.rng-title-reveal #rngUnlockDetails\s*\{[^}]*border-radius:\s*999px/);
  assert.match(styles, /\.rng-reveal-continue\s*\{[^}]*margin:\s*0/);
  assert.match(iconStyles, /\.rng-result-icon > \.ntc-rng-icon \{ width: 30px; height: 30px; \}/);
  assert.match(iconStyles, /\.rng-title-mark > \.ntc-rng-icon \{ width: 25px; height: 25px; \}/);
  assert.match(iconStyles, /\.rng-discovery-mark > \.ntc-rng-icon \{ width: 28px; height: 28px; \}/);
  assert.match(iconStyles, /\.rng-title-history-card \.rng-discovery-mark > \.ntc-rng-icon \{ width: 30px; height: 30px; \}/);
  assert.match(iconStyles, /\.rng-relic-slot > span > \.ntc-rng-icon \{ width: 42px; height: 42px; \}/);
  assert.match(html, /id="rngDebugIconSelect"/);
  assert.match(html, /href="\.\/rng-theme\.css"/);
  assert.match(rngTheme, /\.rng-view\s*\{[\s\S]*--rng-wine:/);
  assert.doesNotMatch(rngTheme, /^(?!\s*\/\*)[^\n]*\b(?:body|\.sidebar|\.view)\s*\{/m);
  assert.match(app, /\['event-', 'Eventos'\][\s\S]*\['ui-', 'Coleção e histórico'\][\s\S]*\['set-', 'Conjuntos'\][\s\S]*\['shop-', 'Loja e consumíveis'\]/);
  assert.match(html, /option value="hover">Destaque ao passar o mouse/);
  assert.match(html, /data-rng-section="achievements"><span class="rng-section-tab-icon"/);
  assert.match(html, /data-rng-section="statistics"><span class="rng-section-tab-icon"/);
  assert.match(html, /data-rng-section="events"><span class="rng-section-tab-icon"/);
  assert.match(html, /data-rng-section="shop"><span class="rng-section-tab-icon"/);
  assert.match(html, /data-rng-section="inventory"><span class="rng-section-tab-icon"/);
  assert.match(html, /data-rng-section="patch-notes"><span class="rng-section-tab-icon"/);
  assert.match(app, /'patch-notes': 'ui-updates'/);
  assert.match(eventScenes, /data-reveal-mode="result"\]\[data-tier="basic"\] \.rng-reveal-card\s*\{[^}]*min-height: 278px/);
  assert.match(eventScenes, /data-reveal-mode="result"\]\[data-tier="epic"\] #rngUnlockDetails\s*\{[^}]*font-size: 13px/);
  assert.match(eventScenes, /data-reveal-mode="discovery"\]\[data-tier="legendary"\] \.rng-reveal-visual\s*\{[^}]*clamp\(300px/);
  assert.match(eventScenes, /data-reveal-mode="result"\]\[data-event-kind="special"\] \.rng-reveal-card\s*\{\s*grid-template-columns: 112px/);
  assert.match(eventScenes, /\.rng-section-tab-icon > \.ntc-rng-icon \{ width: 25px; height: 25px; \}/);
  assert.match(iconModule, /window\.NTCRngIcons = Object\.freeze\(\{ render, play, cancel, list,/);
  assert.match(iconModule, /const tierAssetNames = \{ transcendent: 'dimensional', dimensional: 'transcendent' \}/);
  assert.match(iconModule, /kind: 'raster', src: `\.\/assets\/rng\/ruins\/tiers\/\$\{tierAssetNames\[id\] \|\| id\}\.webp`/);
  assert.match(iconModule, /shop-fortune-rolls/);
  assert.match(iconModule, /event-alignment/);
  assert.match(iconModule, /ui-history/);
  assert.match(iconModule, /ui-collection/);
  assert.match(app, /set-celestial/);
  assert.match(app, /rngShopEnhancedLuckIcon/);
  assert.match(html, /rngShopFortuneRollsIcon/);
  assert.match(iconModule, /'achievement-luck-milestones'/);
  assert.doesNotMatch(iconStyles, /rng-crystal-light-sweep|rng-reveal-shard-flight|rng-reveal-crystal-frame::after/);
  assert.doesNotMatch(iconStyles, /data-reveal-phase="(?:reveal|idle)"\]\[data-reveal-band="5"\] \.rng-reveal-crystal-frame \.ntc-rng-icon > img/, 'the rarest image has one continuous animation owner');
  assert.match(iconStyles, /@keyframes rng-icon-surface-shimmer/);
  assert.doesNotMatch(iconStyles, /@keyframes rng-reveal-ntc-seal/);
  assert.doesNotMatch(iconStyles, /@keyframes rng-reveal-ash-idle/);
  assert.match(iconStyles, /@supports \(mask: url\(""\) center \/ contain no-repeat\)/);
  assert.match(iconStyles, /prefers-reduced-motion/);
  assert.equal(fs.existsSync(path.join(root, 'src', 'assets', 'rng', 'reveal', 'crystal.webp')), true);
  assert.match(html, /id="rngUnlockContinue"[^>]*>Continuar/);
  assert.match(app, /appendToQueue\(rngUnlockQueue, item\)/);
  assert.match(app, /notice\.showModal\(\)/);
  assert.match(app, /function dismissRngUnlock\(\)/);
  assert.match(app, /addEventListener\('cancel', event => \{ event\.preventDefault\(\); dismissRngUnlock\(\); \}\)/);
  assert.match(styles, /\.rng-title-reveal\.show \.rng-reveal-card/);
  assert.match(styles, /\.rng-title-reveal\.show \.rng-reveal-visual::before/);
  assert.match(rngTheme, /\.rng-title-reveal\[data-reveal-mode="event"\] \{ --rng-copy-delay: 880ms; \}/);
  assert.match(eventScenes, /\.rng-title-reveal\.show\[data-reveal-mode="event"\]::before\s*\{\s*opacity: 1;\s*animation: none;/, 'the full-screen event background remains fixed');
  assert.doesNotMatch(eventScenes, /rng-event-air-idle|rng-abyssal-object-arrive|rng-unnamable-object-arrive|rng-beyond-object-arrive|rng-beyond-beam-idle|rng-relic-drift/, 'no crystal or fullscreen background drift keyframes remain');
  assert.doesNotMatch(rngTheme, /rng-abyssal-inhale/, 'Abyssal uses only the shared simple-particle motion during stability testing');
  assert.doesNotMatch(rngTheme, /rng-scene-lantern|rng-event-corelight/, 'obsolete aura-transform animations are removed rather than left competing in the stylesheets');
  assert.doesNotMatch(eventScenes, /@keyframes rng-upper-object-arrive\s*\{[^}]*transform:/, 'scene reveal does not translate or scale the crystal');
  assert.match(eventScenes, /\.rng-title-reveal\.show\[data-reveal-mode="event"\] \.rng-reveal-art-host\s*\{\s*animation: rng-art-materialize/, 'event tiers reveal the fixed artwork through opacity only');
  assert.match(eventScenes, /\.rng-title-reveal\.show\[data-reveal-mode="event"\]\[data-reveal-identity="beyond"\] \.rng-reveal-ntc-fracture\s*\{\s*animation: rng-beyond-rupture/);
  assert.match(eventScenes, /@keyframes rng-beyond-rupture\s*\{[^}]*opacity:[^}]*\}/, 'Beyond keeps its exclusive rupture without translating the crystal or scene');
  assert.match(eventScenes, /\.rng-title-reveal\.show\[data-reveal-mode="event"\] \.rng-reveal-crystal-frame \.ntc-rng-icon > img\s*\{\s*animation: rng-relic-light-idle 8\.4s/);
  assert.match(eventScenes, /\.rng-title-reveal\.show\[data-reveal-mode="scene"\] \.rng-reveal-crystal-frame \.ntc-rng-icon > img\s*\{\s*animation: rng-relic-light-idle 7\.2s/);
  assert.match(eventScenes, /@keyframes rng-relic-light-idle\s*\{\s*0%, 100% \{ filter:/, 'the idle keeps image opacity fixed while breathing through light');
  assert.doesNotMatch(eventScenes, /rng-relic-surface-idle|rng-surface-mask/, 'surface light must not paint over the square raster canvas');
  assert.match(eventScenes, /\[data-reveal-mode="event"\]\[data-reveal-identity="unnamable"\] \.rng-reveal-visual \{ left: 50%; \}/, 'Unnamable relic is centered on the same axis as the copy');
  assert.match(eventScenes, /\[data-reveal-mode="event"\]\[data-reveal-identity="unnamable"\] \.rng-reveal-copy \{ left: 50%; \}/, 'Unnamable title remains on the centered axis');
  assert.doesNotMatch(eventScenes, /data-reveal-identity="unnamable"\] #rngUnlockDetails\s*\{\s*transform:/, 'Unnamable odds retain one fixed position in both phases');
  assert.match(app, /function startRngRevealParticles\(notice, tier, identity, enabled\)/);
  assert.match(app, /particle\.animate\(frames, \{ duration: rngRevealRandom\(\.\.\.plane\.duration\), easing: 'linear', fill: 'forwards' \}\)/);
  assert.match(app, /animation\.onfinish = \(\) => \{[\s\S]*schedule\(particle, planeIndex, rngRevealRandom\(\.\.\.plane\.gap\)\)/);
  assert.match(app, /function cancelRngRevealParticles\(\)/);
  assert.doesNotMatch(app.slice(app.indexOf('function cancelRngRevealParticles('), app.indexOf('function rngRevealParticlePath(')), /replaceChildren\(/, 'closing a reveal must retain the particle pool for the next discovery');
  assert.doesNotMatch(iconStyles, /rng-reveal-ash-idle|animation: rng-reveal-ash/);
  assert.doesNotMatch(eventScenes, /rng-reveal-particles.*infinite|rng-reveal-particles.*alternate/);
  assert.match(eventScenes, /rng-art-materialize \.46s/);
  assert.match(eventScenes, /rng-art-materialize \.78s/);
  assert.match(eventScenes, /rng-art-materialize 1\.25s/);
  assert.doesNotMatch(iconStyles, /data-reveal-phase="reveal"\]\[data-reveal-band="(?:1|2|3|4|5)"\].*rng-reveal-ash-rise/, 'particles do not switch from a reveal timeline to a different idle timeline');
  assert.doesNotMatch(eventScenes, /rng-reveal-ritual/, 'wireframe styling is removed rather than only dimmed');
  assert.doesNotMatch(eventScenes, /data-reveal-phase="(?:reveal|idle)"[^}]*\.ntc-rng-icon > img/, 'phase handoff must not restart the crystal filter');
  assert.doesNotMatch(app.slice(app.indexOf('function showRngUnlock('), app.indexOf('function dismissRngUnlock(')), /NTCRngIcons\?\.play/, 'title reveals use a single CSS wrapper owner rather than a competing WAAPI transform');
  assert.doesNotMatch(rngTheme, /@keyframes rng-(?:ntc-fracture|unnameable-mark|event-atmosphere)/, 'obsolete event animations must not compete with phase-owned scenes');
  assert.doesNotMatch(eventScenes, /0 8px 30px rgba\(0,0,0,\.25\)/, 'Continue has no large outer halo');
  assert.match(rngTheme, /\.rng-title-reveal\[data-reveal-mode="scene"\]/);
  assert.match(rngTheme, /\.rng-title-reveal\[data-reveal-mode="event"\]/);
  assert.match(rngTheme, /\.rng-title-reveal\[data-reveal-mode="result"\]\[data-tier="basic"\] \.rng-reveal-crystal-frame \{ translate: clamp\(12px, 3\.5vw, 24px\) 0; \}/, 'the Basic reveal gets a responsive rightward optical correction without changing other icon placements');
  assert.match(styles, /\.rng-reveal-continue \{[^}]*opacity: 1; transform: none/);
  assert.match(styles, /\.rng-title-reveal\.debug-force-motion \.rng-reveal-card\s*\{[^}]*transition-duration:\s*230ms, var\(--rng-reveal-duration\) !important/);
  assert.match(styles, /@keyframes rng-reveal-aura/);
  assert.match(styles, /\.rng-title-reveal:not\(\[open\]\)\s*\{\s*display:\s*none/);
  for (const tier of ['basic', 'epic', 'unique', 'legendary', 'mythic', 'exalted', 'glorious', 'transcendent', 'dimensional', 'ntc']) assert.match(styles, new RegExp(`rng-title-reveal\\[data-tier="${tier}"\\]`));
  assert.match(styles, /data-rng-reveal-motion="reduced"/);
  assert.match(styles, /data-rng-reveal-motion="off"/);
  assert.match(styles, /prefers-reduced-motion/);
});
