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
  basePoolWeight,
  equalHourBonusAt,
  normalizeState,
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
  debugClearTitles
} = require('../src/rng.cjs');

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
  const catalog = publicCatalog({});
  const luckyLad = catalog.find(title => title.id === 'unique-08');
  const luckiestLad = catalog.find(title => title.id === 'unique-20');
  assert.equal(luckyLad.name, '???');
  assert.equal(luckyLad.tierLabel, 'Lendário');
  assert.equal(luckyLad.baseOdds, '1 em 278.000.000');
  assert.equal(luckiestLad.name, '???');
  assert.equal(publicCatalog({ collectedIds: ['unique-08', 'unique-20'] }).find(title => title.id === 'unique-20').name, 'Luckiest Lad');
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
  const rareId = TITLES.find(title => title.tier === 'epic').id;
  const normalWeights = currentWeights(normalState);
  const equalHourWeights = currentWeights(normalState, { equalHourBonus: true });
  assert.ok(equalHourWeights.get(rareId) > normalWeights.get(rareId));
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
  const bonusOnlyWeight = currentWeights(bonusState, { bonusRoll: true }).get(rareId);
  const stackedWeight = currentWeights(bonusState, { bonusRoll: true, equalHourBonus: true }).get(rareId);
  assert.ok(stackedWeight > bonusOnlyWeight, 'the two active bonuses multiply together');
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
  const baseWeight = currentWeights(beforeMilestone).get(TITLES.find(title => title.tier === 'epic').id);
  const stackedWeight = currentWeights(beforeMilestone, { bonusRoll: true, equalHourBonus: true, thousandRollBonus: true }).get(TITLES.find(title => title.tier === 'epic').id);
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
  const titleId = TITLES.find(title => title.tier === 'epic').id;
  const baseWeight = currentWeights(beforeMilestone).get(titleId);
  const stackedWeight = currentWeights(beforeMilestone, { bonusRoll: true, equalHourBonus: true, thousandRollBonus: true, tenThousandRollBonus: true }).get(titleId);
  assert.ok(stackedWeight > baseWeight, 'all simultaneously active multipliers raise rare-title weight');
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
  const epicTitle = TITLES.find(title => title.id === 'epic-01');
  const mythicTitle = TITLES.find(title => title.id === 'mythic-01');
  const milestone = debugGrantTierTitles({}, 'epic', 5);
  assert.equal(milestone.granted, 5);
  assert.equal(publicProgress(milestone.state).tierProgress.find(tier => tier.id === 'epic').bonusBps, 250);
  assert.ok(currentWeights(milestone.state).get(epicTitle.id) > base.get(epicTitle.id));
  const partial = normalizeState({ collectedIds: ['epic-06', 'epic-10'] });
  const completed = debugGrantTierTitles(partial, 'epic', 5);
  assert.equal(completed.granted, 3);
  assert.equal(publicProgress(completed.state).tierProgress.find(tier => tier.id === 'epic').count, 5);
  assert.equal(debugGrantTierTitles(completed.state, 'epic', 5).granted, 0);

  const basicMilestone = debugGrantTierTitles({}, 'basic', 5);
  assert.equal(luckForState(basicMilestone.state).passiveBps, 450);
  assert.ok(currentWeights(basicMilestone.state).get(mythicTitle.id) > base.get(mythicTitle.id));
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
  const epicTitle = TITLES.find(title => title.id === 'epic-01');
  assert.ok(currentWeights(state, { bonusRoll: true }).get(epicTitle.id) > currentWeights(state).get(epicTitle.id));
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

test('boosted probabilities remain a valid distribution and Basic absorbs the remainder', () => {
  const state = normalizeState({ collectedIds: TITLES.slice(0, 100).map(title => title.id) });
  const weights = currentWeights(state);
  assert.equal([...weights.values()].reduce((sum, weight) => sum + weight, 0n), POOL);
  const rare = TITLES.find(title => title.tier === 'epic');
  const basic = TITLES.find(title => title.tier === 'basic');
  assert.ok(weights.get(rare.id) > rare.baseWeight);
  assert.ok(weights.get(basic.id) < basic.baseWeight);
});

test('the 100% distribution remains exact and individual odds remain distinct as luck grows', () => {
  for (const count of [0, 2, 40, 100, 200]) {
    const state = normalizeState({ collectedIds: TITLES.slice(0, count).map(title => title.id) });
    const weights = currentWeights(state);
    assert.equal([...weights.values()].reduce((sum, weight) => sum + weight, 0n), POOL);
    const odds = publicCatalog(state).map(title => title.currentOdds);
    assert.equal(new Set(odds).size, TITLES.length);
    assert.ok(odds.every(value => !value.includes(',')));
  }
});

test('saved game data is JSON-safe and obsolete workshop data is ignored', () => {
  const original = normalizeState({ collectedIds: ['basic-01', 'epic-01'], bonusRollCounter: 8, totalRolls: 42, totalAppSeconds: 1234, totalAutoRollSeconds: 987, lastAutoRollSessionSeconds: 65, lastTitleId: 'epic-01' });
  const restored = normalizeState(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored, original);
  assert.equal(Object.hasOwn(normalizeState({ fragments: 999, equippedRelicId: 'anything', focusTier: 'epic' }), 'fragments'), false);
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
  assert.deepEqual(state.recentDiscoveries, [{ titleId: 'basic-01', roll: 1, currentOdds: '1 em 2', isBonusRoll: false, rollBonusMultiplier: 1, isEqualHourBonus: false, equalHourMultiplier: 1, equalHourTime: '', isThousandRollBonus: false, thousandRollMultiplier: 1, isTenThousandRollBonus: false, tenThousandRollMultiplier: 1, rolledAt: ordinaryTime, eventName: '', eventMultiplier: 1, eventFocusTierLabel: '', eventFocusMultiplier: 1 }]);
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

test('the game is reachable from Home and its controls use the isolated main-process API', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const rng = fs.readFileSync(path.join(root, 'src', 'rng.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  assert.match(html, /data-view="rng"/);
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
  assert.doesNotMatch(html, /rngNextLuck|rngWorkshop|rngRelic|rngCatalyst|rngFocus|rngCategoryProgress|Fragmentos|Oficina/);
  assert.doesNotMatch(app, /rngNextLuck|rngWorkshop|rngRelic|rngCatalyst|rngFocus|rngCategoryProgress|fragments|relics|catalysts|craftRngItem/);
  assert.match(html, /id="rngDebugClearAll"/);
  assert.match(html, /id="rngDebugSoundTest"/);
  assert.match(styles, /\.rng-profile-panel\s*\{\s*align-self:\s*start;/);
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
  assert.match(app, /Chance atual/);
  assert.match(styles, /\.rng-title-history-list\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(app, /class="rng-discovery-meta"/);
  assert.match(styles, /\.rng-title-history-card\s*\{[^}]*min-height:\s*72px/);
  assert.match(styles, /\.rng-title-history-card \.rng-discovery-detail\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(styles, /\.rng-title-history-card:not\(\.has-record\)\s*\{[^}]*min-height:\s*62px/);
  assert.doesNotMatch(styles, /\.rng-title-history-list\s*\{[^}]*grid-auto-flow:\s*column/);
  assert.match(app, /showRngUnlock\(newlyUnlocked\)/);
  assert.match(app, /isDevelopmentBuild\(\)/);
  assert.match(app, /rngDebugEnabled = await window\.ntc\.isDevelopmentBuild\(\);\s*if \(!rngDebugEnabled\) return;\s*\$\('#rngDebugTrigger'\)\.classList\.remove\('hidden'\)/);
  assert.match(preload, /getRngState:.*get-rng-state/);
  assert.match(preload, /setRngAutoRoll:.*set-rng-auto-roll/);
  assert.match(main, /ipcMain\.handle\('set-rng-auto-roll'/);
  assert.match(main, /ipcMain\.handle\('is-development-build', \(\) => !app\.isPackaged\)/);
  assert.match(main, /setInterval\(\(\) => \{[\s\S]*performRngRoll\(\)/);
  assert.match(main, /recentDiscoveries:\s*rngGame\.recentDiscoveries/);
  assert.match(main, /titleHistory:\s*rngGame\.titleHistory/);
  assert.match(main, /isEqualHourBonus:\s*result\.isEqualHourBonus/);
  assert.match(main, /isThousandRollBonus:\s*result\.isThousandRollBonus/);
  assert.match(main, /isTenThousandRollBonus:\s*result\.isTenThousandRollBonus/);
  assert.match(preload, /isWindowMinimizedOrHidden:.*window-is-minimized-or-hidden/);
  assert.match(main, /window-is-minimized-or-hidden[\s\S]*isMinimized\(\)[\s\S]*isVisible\(\)/);
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
  assert.match(rng, /Lucky Lad/);
  assert.match(rng, /Luckiest Lad/);
  assert.match(main, /ntc-rng-state\.json/);
});

test('deep title sound is silent below Singular and only plays for new titles while minimized or in tray', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const functionSource = app.match(/function shouldPlayRngTitleSound\(result, isHidden\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource, 'the sound gate should be testable independently of the UI');
  const shouldPlay = vm.runInNewContext(`(${functionSource})`);
  const result = tier => ({ isNew: true, title: { tier } });
  assert.equal(shouldPlay(result('basic'), true), false);
  assert.equal(shouldPlay(result('epic'), true), false);
  for (const tier of ['unique', 'legendary', 'mythic', 'exalted', 'glorious', 'transcendent', 'dimensional', 'ntc']) assert.equal(shouldPlay(result(tier), true), true, `${tier} should play the sound`);
  assert.equal(shouldPlay(result('unique'), false), false, 'keep the app quiet while visible');
  assert.equal(shouldPlay({ ...result('unique'), isNew: false }, true), false, 'duplicates stay silent');
  assert.equal(shouldPlay({ ...result('unique'), simulation: true }, true), false, 'debug previews stay silent');
});
