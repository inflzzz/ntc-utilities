'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { POOL, TIERS, TITLES, normalizeState, normalizeProfileDisplayName, validateProfileDisplayName, currentWeights, rollTitle } = require('../src/rng.cjs');
const { buildLuckIndex, buildPlayerProfileData } = require('../src/rng-profile.cjs');

test('profile save fields normalize safely and legacy data receives bounded empty metric aggregates', () => {
  const state = normalizeState({ totalRolls: 1_000_000_000, collectedIds: ['basic-01'], profile: { displayName: '  Éon   do   Norte  ', equippedTitleId: 'epic-01' } });
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(state.profile, { displayName: 'Éon do Norte', equippedTitleId: null });
  assert.equal(state.luckMetrics.version, 1);
  assert.equal(state.luckMetrics.measuredRolls, 0, 'historic rolls are not assigned guessed odds');
  assert.equal(state.luckMetrics.oddsBands.length, 81);
  assert.equal(Object.keys(state.luckMetrics.byTier).length, TIERS.length);
  assert.equal(normalizeProfileDisplayName('x'.repeat(40)).length, 32);
  assert.deepEqual(validateProfileDisplayName('   '), { ok: false, reason: 'name-empty', value: '' });
  assert.equal(validateProfileDisplayName('  Éon   do Norte  ').value, 'Éon do Norte');
  assert.equal(validateProfileDisplayName('x'.repeat(33)).reason, 'name-too-long');
  assert.equal(normalizeState(JSON.parse(JSON.stringify(state))).luckMetrics.oddsBands.length, 81);
});

test('profile identity locks an existing display name while title selection remains a separate partial update', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  assert.match(main, /currentProfile\.displayName && validation\.value !== currentProfile\.displayName/);
  assert.match(main, /reason: 'name-locked'/);
  assert.match(app, /setRngProfile\(\{ displayName \}\)/);
  assert.match(app, /setRngProfile\(\{ equippedTitleId \}\)/);
  assert.match(html, /rngProfileNameDialog/);
  assert.match(html, /rngTitlePickerDialog/);
  assert.doesNotMatch(html, /rngPlayerNameInput|rngPlayerTitleSelect|Salvar identidade/);
});

test('one roll aggregates exact effective probability by tier and bounded individual-odds magnitude', () => {
  const event = { multiplier: 2, focusTierId: 'ntc', focusTierLabel: 'Além do NTC', focusMultiplier: 3 };
  const options = { eventMultiplier: event.multiplier, focusTierId: event.focusTierId, focusMultiplier: event.focusMultiplier, localHour: 12 };
  const weights = currentWeights({}, options);
  const expectedByTier = Object.fromEntries(TIERS.map(tier => [tier.id, 0n]));
  const expectedByOddsBand = Array(81).fill(0n);
  const bandFor = weight => {
    const text = weight.toString();
    return Math.max(0, Math.min(80, 80 - text.length + (/^10*$/.test(text) ? 1 : 0)));
  };
  for (const title of TITLES) {
    const weight = weights.get(title.id);
    expectedByTier[title.tier] += weight;
    expectedByOddsBand[bandFor(weight)] += weight;
  }
  const outcome = rollTitle({}, 0n, { event, localHour: 12 });
  assert.equal(outcome.title.id, 'basic-01');
  assert.equal(outcome.state.luckMetrics.measuredRolls, 1);
  assert.equal(outcome.state.luckMetrics.byTier.basic.observed, 1);
  assert.equal(outcome.state.luckMetrics.byTier.basic.expectedWeight, expectedByTier.basic.toString());
  assert.equal(outcome.state.luckMetrics.singularPlusObserved, 0);
  assert.equal(outcome.state.luckMetrics.singularPlusExpectedWeight, [...TIERS.slice(2)].reduce((sum, tier) => sum + expectedByTier[tier.id], 0n).toString());
  assert.equal(outcome.state.luckMetrics.oddsBands.reduce((sum, band) => sum + BigInt(band.expectedWeight), 0n), POOL);
  assert.deepEqual(outcome.state.luckMetrics.oddsBands.map(band => BigInt(band.expectedWeight)), expectedByOddsBand);
  assert.deepEqual(outcome.state.luckMetrics.bestOutlier, { titleId: outcome.title.id, roll: 1, weight: String(weights.get(outcome.title.id)) });
});

test('rarity aggregates retain actual outcomes, expectations and the best exact result without a roll log', () => {
  let state = normalizeState();
  const first = rollTitle(state, 0n);
  state = first.state;
  const second = rollTitle(state, 0n);
  state = second.state;
  const metrics = state.luckMetrics;
  assert.equal(metrics.measuredRolls, 2);
  assert.equal(metrics.byTier.basic.observed, 2);
  assert.equal(metrics.oddsBands.reduce((sum, band) => sum + band.observed, 0), 2);
  assert.equal(metrics.bestOutlier.roll, 1);
  assert.ok(metrics.bestOutlier.weight);
  assert.equal(Object.hasOwn(metrics, 'rolls'), false);
  assert.equal(metrics.oddsBands.length, 81, 'aggregate storage has a fixed upper bound');
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))).luckMetrics, metrics);
});

test('Luck Index waits for minimum coverage, is centered on expectation and clamps extreme samples', () => {
  const metrics = { version: 1, measuredRolls: 99, singularPlusObserved: 100, singularPlusExpectedWeight: String(5n * POOL), singularPlusVarianceWeight: String(4n * POOL) };
  assert.equal(buildLuckIndex(metrics).ready, false);
  metrics.measuredRolls = 100;
  assert.equal(buildLuckIndex(metrics).score, 100);
  metrics.singularPlusObserved = 5;
  assert.equal(buildLuckIndex(metrics).score, 50);
  metrics.singularPlusExpectedWeight = String(4n * POOL);
  assert.equal(buildLuckIndex(metrics).ready, false, 'expected-hit minimum also gates the display');
});

test('Luck Index remains finite at billion-roll scale and profile rendering does not invent a population percentile', () => {
  const metrics = { version: 1, measuredRolls: 1_000_000_000, singularPlusObserved: 1_050_000, singularPlusExpectedWeight: String(1_000_000n * POOL), singularPlusVarianceWeight: String(999_000n * POOL) };
  const index = buildLuckIndex(metrics);
  assert.equal(index.ready, true);
  assert.ok(Number.isFinite(index.score));
  assert.ok(index.score >= 0 && index.score <= 100);
  assert.equal(index.threshold, 'Singular+');
});

test('PlayerProfileData derives owned record, equipped identity and truthful local-only statistics', () => {
  const source = normalizeState({
    profile: { displayName: 'Nox', equippedTitleId: 'epic-01' },
    collectedIds: ['basic-01', 'epic-01'],
    totalRolls: 2,
    totalAppSeconds: 5400,
    luckMetrics: { version: 1, measuredRolls: 100, singularPlusObserved: 5, singularPlusExpectedWeight: String(5n * POOL), singularPlusVarianceWeight: String(4n * POOL), byTier: { epic: { observed: 5, expectedWeight: String(5n * POOL), varianceWeight: String(4n * POOL) } } }
  });
  const snapshot = {
    catalog: require('../src/rng.cjs').publicCatalog(source),
    tiers: TIERS,
    collectedIds: source.collectedIds,
    titleHistory: [{ titleId: 'epic-01', titleNameAtDiscovery: 'Nome antigo', tierAtDiscovery: 'unique', tierLabelAtDiscovery: 'Singular', tierRankAtDiscovery: 2, catalogVersionAtDiscovery: 1, roll: 2, currentOdds: '1 em 2.307' }],
    profile: source.profile,
    statistics: { rarestTitleId: 'epic-01', longestSingularDrought: 10, longestSameTitleStreak: 2 },
    totalTitles: TITLES.length,
    totalRolls: 2,
    totalAppSeconds: 5400,
    totalAutoRollSeconds: 1800,
    achievements: [{ unlocked: true }, { unlocked: false }],
    achievementsTotal: 2,
    secrets: [{ id: 'secret-one' }],
    relics: { ownedCount: 3, catalog: [{}, {}, {}] },
    eventsParticipated: 4,
    luckMetrics: source.luckMetrics
  };
  const profile = buildPlayerProfileData(snapshot);
  assert.equal(profile.source, 'local');
  assert.equal(profile.identity.displayName, 'Nox');
  assert.equal(profile.identity.equippedTitle.id, 'epic-01');
  assert.equal(profile.record.acquisitionOdds, '1 em 2.307');
  assert.equal(profile.record.name, 'Nome antigo');
  assert.equal(profile.record.tierId, 'unique');
  assert.equal(profile.discoveries[0].tierRank, 2);
  assert.equal(profile.collection.collected, 2);
  assert.equal(profile.progress.appOpenSeconds, 5400);
  assert.equal(profile.progress.achievementsUnlocked, 1);
  assert.equal(profile.progress.eventsParticipated, 4);
  assert.equal(profile.luck.index.ready, true);
});

test('profile export uses a dedicated offline renderer and guarded PNG IPC rather than the app viewport', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'rng-profile-card.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'rng-profile-card.js'), 'utf8');
  assert.match(main, /render-rng-profile-card/);
  assert.match(main, /capturePage\(undefined, \{ stayHidden: true \}\)/);
  assert.match(main, /validateRngProfileCard/);
  assert.match(preload, /renderRngProfileCard/);
  assert.match(preload, /copyRngProfileCard/);
  assert.match(preload, /saveRngProfileCard/);
  assert.match(html, /rng-profile-card\.css/);
  assert.match(renderer, /width: 1920, height: 1080/);
  assert.match(renderer, /width: 1080, height: 1350/);
  assert.doesNotMatch(renderer, /https?:\/\//, 'profile artwork and fonts stay offline');
});
