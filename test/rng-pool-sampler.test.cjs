'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const {
  rational, addRational, subtractRational, multiplyRational, compareRational, createSnapshot, publishSnapshot, hashSnapshot
} = require('../src/rng-pool-model.cjs');
const { POOL, TITLES, currentWeights } = require('../src/rng.cjs');
const { createRollPlan, publishRollPlan } = require('../src/rng-roll-plan.cjs');
const {
  createProductionIntervalBackend, assertProductionProbabilityInterval
} = require('../src/rng-luck2-precision.cjs');
const {
  createPoolSampler, SamplerDecisionError, addDyadic, compareDyadicToRational,
  compareScaledPrefixToRational, compareScaledPrefixToDyadic, intervalPartitionCandidate
} = require('../src/rng-pool-sampler.cjs');

const q = (n, d = '1') => rational(String(n), String(d));
const backendPromise = createProductionIntervalBackend();

function snapshotFixture({ snapshotId = 'sampler-v1', version = 1, shares = [['basic', q(1)]],
  fallbackShares = null, zeroTitle = false, retiredTitle = null, extraEventPool = false, splitCohorts = false } = {}) {
  const reserve = q(1, 20);
  const activeBudget = q(19, 20);
  const pools = [{ id: 'normal', kind: 'normal', version: 1, budget: q(1), budgetOrigin: 'normal-v1', fallbackId: 'basic-fallback', state: 'active' }];
  const resolvedFallbackShares = fallbackShares || shares;
  const fallbacks = [{ id: 'basic-fallback', poolId: 'normal', basis: 'fixed-basic-proportions', shares: resolvedFallbackShares.map(([titleId, share]) => ({ titleId, share })) }];
  const cohorts = [];
  const escrow = [];
  if (splitCohorts) {
    cohorts.push({ id: 'normal-common', version: 1, poolId: 'normal', budget: q(9, 10), budgetOrigin: 'normal-v1', common: true, publication: 'published', rosterFrozen: true,
      slots: [{ titleId: 'normal-common-title', probability: q(9, 10) }] });
    cohorts.push({ id: 'normal-rare', version: 1, poolId: 'normal', budget: q(1, 20), budgetOrigin: 'normal-v1', common: false, publication: 'published', rosterFrozen: true,
      slots: [{ titleId: 'normal-rare-title', probability: q(1, 20) }] });
    fallbacks[0].shares = [{ titleId: 'normal-common-title', share: q(1) }];
  } else {
    const slots = shares.map(([titleId, share]) => ({ titleId, probability: multiplyRational(activeBudget, share), state: titleId === retiredTitle ? 'unobtainable' : 'obtainable' }));
    if (zeroTitle) slots.push({ titleId: 'zero-slot', probability: q(0), state: 'obtainable' });
    cohorts.push({ id: 'normal-v1', version: 1, poolId: 'normal', budget: activeBudget, budgetOrigin: 'normal-v1', common: true, publication: 'published', rosterFrozen: true, slots });
    for (const [titleId, share] of shares) {
      if (titleId === retiredTitle) escrow.push({ titleId, poolId: 'normal', cohortId: 'normal-v1', amount: multiplyRational(activeBudget, share), fallbackId: 'basic-fallback' });
    }
    if (zeroTitle) {
      shares.push(['zero-slot', q(0)]);
      fallbacks[0].shares = shares.map(([titleId, share]) => ({ titleId, share }));
    }
  }
  const expansionShares = splitCohorts ? [['normal-common-title', q(1)]] : resolvedFallbackShares;
  const basicFunding = expansionShares.map(([titleId, share]) => ({ titleId, probability: multiplyRational(reserve, share) }));

  if (extraEventPool) {
    pools.push({ id: 'event-synthetic', kind: 'event', version: 4, budget: q(1), budgetOrigin: 'event-test-v4', fallbackId: 'event-fallback', state: 'active' });
    cohorts.push({ id: 'event-v4', version: 4, poolId: 'event-synthetic', budget: q(1), budgetOrigin: 'event-test-v4', common: false, publication: 'published', rosterFrozen: true,
      slots: [{ titleId: 'event-title-a', probability: q(7, 10), acquisition: 'event' }, { titleId: 'event-title-b', probability: q(3, 10), acquisition: 'event' }] });
    fallbacks.push({ id: 'event-fallback', poolId: 'event-synthetic', basis: 'pool-local-proportions', shares: [
      { titleId: 'event-title-a', share: q(7, 10) }, { titleId: 'event-title-b', share: q(3, 10) }
    ] });
  }

  return publishSnapshot(createSnapshot({
    snapshotId, version, publication: 'draft', pools, cohorts, fallbacks,
    expansionBudget: { total: reserve, free: reserve, allocated: q(0), poolId: 'normal', fallbackId: 'basic-fallback', allocations: [], basicFunding },
    commonFloor: { atNeutral: q(92, 100), commonMassAtNeutral: splitCohorts ? q(95, 100) : activeBudget, allocatedToNonCommon: q(0) },
    escrow
  }));
}

function catalogV1Snapshot() {
  const weights = currentWeights({});
  const basics = TITLES.filter(title => title.tier === 'basic');
  const basicWeight = basics.reduce((sum, title) => sum + weights.get(title.id), 0n);
  const reserve = q(1, 20);
  const slots = TITLES.map(title => {
    const original = q(weights.get(title.id), POOL);
    if (title.tier !== 'basic') return { titleId: title.id, probability: original };
    const funding = q(weights.get(title.id), 20n * basicWeight);
    return { titleId: title.id, probability: subtractRational(original, funding) };
  });
  const basicFunding = basics.map(title => ({ titleId: title.id, probability: q(weights.get(title.id), 20n * basicWeight) }));
  const basicShares = basics.map(title => ({ titleId: title.id, share: q(weights.get(title.id), basicWeight) }));
  return publishSnapshot(createSnapshot({
    snapshotId: 'catalog-v1-sampler-test', version: 1, publication: 'draft',
    pools: [{ id: 'normal', kind: 'normal', version: 1, budget: q(1), budgetOrigin: 'catalog-v1', fallbackId: 'basic-fallback', state: 'active' }],
    cohorts: [{ id: 'catalog-v1', version: 1, poolId: 'normal', budget: q(95, 100), budgetOrigin: 'catalog-v1', common: true, publication: 'published', rosterFrozen: true, slots }],
    fallbacks: [{ id: 'basic-fallback', poolId: 'normal', basis: 'fixed-basic-proportions', shares: basicShares }],
    expansionBudget: { total: reserve, free: reserve, allocated: q(0), poolId: 'normal', fallbackId: 'basic-fallback', allocations: [], basicFunding },
    commonFloor: { atNeutral: q(92, 100), commonMassAtNeutral: q(basicWeight, POOL), allocatedToNonCommon: q(0) },
    escrow: []
  }));
}

function makePlan(snapshot, components = [{ componentId: 'normal-component', poolId: 'normal', mass: q(1), origin: 'roll-v1-normal' }], version = 1) {
  return publishRollPlan(createRollPlan({ planId: 'test-roll-plan', version, snapshot, components }), snapshot);
}

function deterministicFactory(bytes, id = 'deterministic-test-stream-v1') {
  const data = Buffer.from(bytes);
  return () => {
    let offset = 0;
    return {
      id,
      nextBytes(count) {
        if (offset + count > data.length) throw new Error(`Test entropy exhausted at byte ${offset}.`);
        const value = data.subarray(offset, offset + count);
        offset += count;
        return value;
      }
    };
  };
}

function repeatedByte(byte, count = 16) { return Buffer.alloc(count, byte); }
function streamForStages({ plan = repeatedByte(0), group = repeatedByte(0), slot = repeatedByte(0) } = {}) {
  return Buffer.concat([plan, group, slot]);
}

function targetPrefixBytes(probabilityNumerator, probabilityDenominator, bits) {
  const denominator = BigInt(probabilityDenominator);
  const numerator = BigInt(probabilityNumerator);
  const randomNumerator = (2n * denominator - numerator) << BigInt(bits);
  const randomDenominator = 2n * denominator;
  const prefix = randomNumerator / randomDenominator;
  const result = Buffer.alloc(bits / 8);
  let value = prefix;
  for (let index = result.length - 1; index >= 0; index--) {
    result[index] = Number(value & 255n); // Test fixture encoding only; never used for probability math.
    value >>= 8n;
  }
  return result;
}

function rationalPrefixBytes(numerator, denominator, bits) {
  const prefix = (BigInt(numerator) << BigInt(bits)) / BigInt(denominator);
  const result = Buffer.alloc(bits / 8);
  let value = prefix;
  for (let index = result.length - 1; index >= 0; index--) {
    result[index] = Number(value & 255n); // Test fixture encoding only.
    value >>= 8n;
  }
  return result;
}

function samplerFor(backend, options = {}) {
  return createPoolSampler({ backend, ...options });
}

test('Roll Plan accepts only exact total mass 1 and binds immutable pool/snapshot versions', () => {
  const snapshot = snapshotFixture({ extraEventPool: true });
  const valid = makePlan(snapshot);
  assert.equal(valid.publication, 'published');
  assert.equal(valid.snapshotHash, hashSnapshot(snapshot));
  assert.throws(() => createRollPlan({ planId: 'under', version: 1, snapshot, components: [
    { componentId: 'normal', poolId: 'normal', mass: q(9, 10), origin: 'bad-under' }
  ] }), /sum exactly to 1/);
  assert.throws(() => createRollPlan({ planId: 'over', version: 1, snapshot, components: [
    { componentId: 'normal-a', poolId: 'normal', mass: q(1), origin: 'bad-over' },
    { componentId: 'event', poolId: 'event-synthetic', mass: q(1, 10), origin: 'bad-over' }
  ] }), /sum exactly to 1/);
  assert.throws(() => createRollPlan({ planId: 'two-full-pools', version: 1, snapshot, components: [
    { componentId: 'normal', poolId: 'normal', mass: q(1), origin: 'normal' },
    { componentId: 'event', poolId: 'event-synthetic', mass: q(1), origin: 'event' }
  ] }), /sum exactly to 1/);
  assert.throws(() => { valid.components[0].mass = q(0); }, TypeError);
});

test('exact dyadic/rational endpoint convention selects the interval beginning at an exact boundary', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ shares: [['left', q(1, 2)], ['right', q(1, 2)]] });
  const plan = makePlan(snapshot);
  const bytes = streamForStages({ slot: Buffer.concat([Buffer.from([0x80]), Buffer.alloc(15)]) });
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes) });
  const roll = await sampler.prepareRoll({ snapshot, rollPlan: plan, channels: { coreLuck: '1' }, mode: 'auto' });
  const result = await roll.sample();
  assert.equal(result.outcome, 'right');
  assert.equal(result.audit.precisionBits, 128);
  assert.equal(result.audit.mode, 'auto');
  assert.ok(compareDyadicToRational({ significand: '1', binaryExponent: '-1' }, q(1, 2)) === 0);
  assert.ok(compareScaledPrefixToRational({ significand: '1', binaryExponent: '-1' }, q(1), q(1, 2)) === 0);
  assert.ok(compareScaledPrefixToDyadic({ significand: '1', binaryExponent: '-1' }, q(1), { significand: '1', binaryExponent: '-1' }) === 0);
  assert.deepEqual(addDyadic({ significand: '1', binaryExponent: '-1' }, { significand: '1', binaryExponent: '-1' }), { significand: '2', binaryExponent: '-1' });

  const immediatelyBefore = streamForStages({ slot: Buffer.concat([Buffer.from([0x7f]), Buffer.alloc(15, 0xff)]) });
  const beforeSampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(immediatelyBefore) });
  const before = await (await beforeSampler.prepareRoll({ snapshot, rollPlan: plan, channels: { coreLuck: '1' }, mode: 'auto' })).sample();
  assert.equal(before.outcome, 'left');
});

test('a near-boundary dyadic prefix refines and agrees at different safe precision ceilings', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ shares: [['left', q(1, 3)], ['right', q(2, 3)]] });
  const plan = makePlan(snapshot);
  const denominator = 3n << 150n;
  const numerator = (1n << 150n) - 3n; // 1/3 - 2^-150
  const bytes = streamForStages({ slot: rationalPrefixBytes(numerator, denominator, 256) });
  const outcomes = [];
  for (const maxPrecisionBits of [256, 512]) {
    const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes), maxPrecisionBits });
    const result = await (await sampler.prepareRoll({ snapshot, rollPlan: plan, channels: { coreLuck: '1' }, mode: 'auto' })).sample();
    outcomes.push(result.outcome);
    assert.equal(result.audit.refinementCount, 1);
  }
  assert.deepEqual(outcomes, ['left', 'left']);
});

test('zero-probability title is omitted and can never be sampled', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ shares: [['only', q(1)]], zeroTitle: true });
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(streamForStages()) });
  const roll = await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'auto' });
  const result = await roll.sample();
  assert.equal(result.outcome, 'only');
  assert.notEqual(result.outcome, 'zero-slot');
});

test('unobtainable mass is represented by its fallback and never returned as the retired title', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ shares: [['basic', q(9, 10)], ['retired', q(1, 10)]], fallbackShares: [['basic', q(1)]], retiredTitle: 'retired' });
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(streamForStages({ group: repeatedByte(255) })) });
  const roll = await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'auto' });
  const result = await roll.sample();
  assert.equal(result.outcome, 'basic');
  assert.equal(result.audit.fallbackId, 'basic-fallback');
  assert.ok(result.audit.fallbackCauses.some(cause => cause.type === 'unobtainable-escrow' && cause.titleId === 'retired'));
  assert.notEqual(result.outcome, 'retired');
});

test('reactivation in a new snapshot releases escrow and restores the stable title ID', async () => {
  const backend = await backendPromise;
  const retired = snapshotFixture({ snapshotId: 'retired-v1', version: 1,
    shares: [['basic', q(9, 10)], ['legacy-title', q(1, 10)]], fallbackShares: [['basic', q(1)]], retiredTitle: 'legacy-title' });
  const active = snapshotFixture({ snapshotId: 'reactivated-v2', version: 2,
    shares: [['basic', q(9, 10)], ['legacy-title', q(1, 10)]] });
  const bytes = streamForStages({ group: repeatedByte(255), slot: Buffer.concat([Buffer.from([0xf0]), Buffer.alloc(15)]) });
  const retiredSampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes) });
  const activeSampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes) });
  const retiredResult = await (await retiredSampler.prepareRoll({ snapshot: retired, rollPlan: makePlan(retired), channels: { coreLuck: '1' }, mode: 'auto' })).sample();
  const activeResult = await (await activeSampler.prepareRoll({ snapshot: active, rollPlan: makePlan(active, undefined, 2), channels: { coreLuck: '1' }, mode: 'auto' })).sample();
  assert.equal(retiredResult.outcome, 'basic');
  assert.equal(activeResult.outcome, 'legacy-title');
  assert.equal(activeResult.audit.snapshotVersion, 2);
});

test('event pool is sampled only when explicitly assigned Roll Plan mass', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ extraEventPool: true });
  const eventPlan = makePlan(snapshot, [
    { componentId: 'normal-part', poolId: 'normal', mass: q(9, 10), origin: 'normal-budget-v1' },
    { componentId: 'event-part', poolId: 'event-synthetic', mass: q(1, 10), origin: 'synthetic-event-budget-v1' }
  ]);
  const bytes = streamForStages({ plan: repeatedByte(255), group: repeatedByte(0), slot: repeatedByte(0) });
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes) });
  const roll = await sampler.prepareRoll({ snapshot, rollPlan: eventPlan, channels: { coreLuck: '1' }, mode: 'auto' });
  const result = await roll.sample();
  assert.equal(result.outcome, 'event-title-a');
  assert.equal(result.audit.componentId, 'event-part');
  assert.equal(result.audit.poolId, 'event-synthetic');
  assert.equal(result.audit.poolKind, 'event');
});

test('same Roll Plan, snapshot, parameters, sampler/backend versions and test entropy replay identically', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ shares: [['a', q(2, 3)], ['b', q(1, 3)]] });
  const plan = makePlan(snapshot);
  const bytes = streamForStages({ slot: Buffer.alloc(16, 0x55) });
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes, 'replay-v1') });
  const prepared = await sampler.prepareRoll({ snapshot, rollPlan: plan, channels: { coreLuck: '1e20', buildLuck: '1' }, mode: 'manual' });
  const first = await prepared.sample();
  const second = await prepared.sample();
  assert.deepEqual(second, first);
});

test('production entropy default is Node crypto.randomBytes and returns only a snapshot result', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ shares: [['a', q(1, 2)], ['b', q(1, 2)]] });
  const sampler = samplerFor(backend);
  const prepared = await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'auto' });
  const result = await prepared.sample();
  assert.ok(['a', 'b'].includes(result.outcome));
  assert.equal(result.audit.entropySourceId, 'node-crypto.randomBytes-v1');
  assert.equal(result.audit.outcome, 'selected');
});

test('adding an unreferenced pool does not alter the normal component result; new participation requires a new plan version', async () => {
  const backend = await backendPromise;
  const oldSnapshot = snapshotFixture({ snapshotId: 'system-v1', version: 1, shares: [['only-normal', q(1)] ] });
  const expandedSnapshot = snapshotFixture({ snapshotId: 'system-v2', version: 2, shares: [['only-normal', q(1)] ], extraEventPool: true });
  const oldPlan = makePlan(oldSnapshot);
  const sameParticipationPlan = makePlan(expandedSnapshot, [{ componentId: 'normal-component', poolId: 'normal', mass: q(1), origin: 'same-normal-only-v1' }], 2);
  const bytes = streamForStages();
  const oldSampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes) });
  const newSampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes) });
  const oldRoll = await oldSampler.prepareRoll({ snapshot: oldSnapshot, rollPlan: oldPlan, channels: { coreLuck: '1' }, mode: 'auto' });
  const newRoll = await newSampler.prepareRoll({ snapshot: expandedSnapshot, rollPlan: sameParticipationPlan, channels: { coreLuck: '1' }, mode: 'auto' });
  const [before, after] = await Promise.all([oldRoll.sample(), newRoll.sample()]);
  assert.equal(before.outcome, after.outcome);
  assert.equal(before.audit.componentId, after.audit.componentId);
  assert.equal(before.audit.poolId, after.audit.poolId);
  assert.notEqual(after.audit.snapshotHash, before.audit.snapshotHash);
  assert.equal(after.audit.snapshotVersion, 2);
  const changedPlan = makePlan(expandedSnapshot, [
    { componentId: 'normal-part', poolId: 'normal', mass: q(9, 10), origin: 'v2-normal' },
    { componentId: 'event-part', poolId: 'event-synthetic', mass: q(1, 10), origin: 'v2-event' }
  ], 3);
  assert.notEqual(changedPlan.version, sameParticipationPlan.version);
  assert.deepEqual(changedPlan.components.map(item => item.mass), [q(9, 10), q(1, 10)]);
});

test('multiple cohorts are selected by exact frozen mass, then titles by certified conditional intervals', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ splitCohorts: true });
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(streamForStages({ group: repeatedByte(0) })) });
  const roll = await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'auto' });
  const result = await roll.sample();
  assert.equal(result.outcome, 'normal-common-title');
  assert.equal(result.audit.cohortId, 'normal-common');
  assert.equal(result.audit.cohortVersion, 1);
});

test('the 200-title v1 neutral Auto snapshot samples a real stable catalog ID without changing legacy order', async () => {
  const backend = await backendPromise;
  const snapshot = catalogV1Snapshot();
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(streamForStages()) });
  const prepared = await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'auto' });
  const result = await prepared.sample();
  assert.equal(snapshot.cohorts[0].slots.length, 200);
  assert.equal(result.outcome, TITLES[0].id);
  assert.equal(result.audit.precisionBits, 128);
  assert.equal(result.audit.formulaVersion, backend.metadata.formulaVersion);
});

test('Manual and Auto use the same sampler with only the certified Manual beta difference', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ shares: [['common', q(9, 10)], ['rare', q(1, 10)]] });
  // 0.8995 lies between the Auto-neutral 0.9 common boundary and the
  // certified Manual boundary after beta is multiplied by 199/200.
  const bytes = streamForStages({ slot: rationalPrefixBytes(1799, 2000, 128) });
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes) });
  const auto = await (await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'auto' })).sample();
  const manual = await (await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'manual' })).sample();
  assert.equal(auto.audit.mode, 'auto');
  assert.equal(manual.audit.mode, 'manual');
  assert.equal(auto.audit.manualPowerVersion, manual.audit.manualPowerVersion);
  assert.equal(auto.outcome, 'common');
  assert.equal(manual.outcome, 'rare');
});

test('diagnostic-only backend output is rejected before any outcome can be returned', async () => {
  const production = await backendPromise;
  const backend = {
    metadata: production.metadata,
    async transformSnapshot() { return { numericAuthority: 'diagnostic-only', samplerEligible: false, pools: [] }; }
  };
  const snapshot = snapshotFixture();
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(streamForStages()) });
  const roll = await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'auto' });
  await assert.rejects(roll.sample(), error => error instanceof SamplerDecisionError && error.reasonCode === 'uncertified-math-result' && error.audit.outcome === null);
  assert.throws(() => assertProductionProbabilityInterval({ numericAuthority: 'diagnostic-only' }), /production-authoritative/);
});

test('probabilities 1e-20, 1e-100, 1e-500 and 1e-1000 remain selectable without Number conversion', async t => {
  const backend = await backendPromise;
  for (const exponent of [20, 100, 500, 1000]) {
    const denominator = `1${'0'.repeat(exponent)}`;
    const rareShare = q(1, denominator);
    const snapshot = snapshotFixture({ shares: [['common', q(BigInt(denominator) - 1n, denominator)], ['rare', rareShare]] });
    const slotBits = 4096;
    const bytes = streamForStages({ slot: targetPrefixBytes(1, denominator, slotBits) });
    const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(bytes) });
    const roll = await sampler.prepareRoll({ snapshot, rollPlan: makePlan(snapshot), channels: { coreLuck: '1' }, mode: 'auto' });
    const started = performance.now();
    const result = await roll.sample();
    if (exponent === 1000) t.diagnostic(`1e-1000 entropy/math refinement sample: ${(performance.now() - started).toFixed(2)}ms`);
    assert.equal(result.outcome, 'rare', `1e-${exponent} target must resolve to rare`);
    assert.ok(result.audit.precisionBits >= 128);
    if (exponent === 1000) {
      assert.ok(result.audit.entropyBits.slot >= 4096);
      assert.ok(result.audit.refinements.slot > 0);
    }
  }
});

test('mathematical uncertainty at the configured precision ceiling fails closed with no title', async () => {
  const backend = await backendPromise;
  const snapshot = snapshotFixture({ shares: [['left', q(1, 3)], ['right', q(2, 3)]] });
  const plan = makePlan(snapshot);
  const aroundOneThird = rationalPrefixBytes(1, 3, 128);
  // A prefix immediately below the 1/3 boundary has an interval that still
  // straddles it at 128 bits; a deliberately lowered test ceiling must error.
  const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(streamForStages({ slot: aroundOneThird })), maxPrecisionBits: 128 });
  const roll = await sampler.prepareRoll({ snapshot, rollPlan: plan, channels: { coreLuck: '1' }, mode: 'auto' });
  await assert.rejects(roll.sample(), error => error instanceof SamplerDecisionError && error.reasonCode === 'certification-limit' && error.audit.outcome === null);
});

test('stale Roll Plan/snapshot pairing and inactive pool references are rejected', () => {
  const snapshot = snapshotFixture({ extraEventPool: true });
  const plan = makePlan(snapshot);
  const changed = snapshotFixture({ snapshotId: 'sampler-v2', version: 2, extraEventPool: true });
  assert.throws(() => require('../src/rng-roll-plan.cjs').validateRollPlan(plan, changed), /does not pin/);
  const inactiveSpec = JSON.parse(JSON.stringify(snapshot));
  inactiveSpec.pools.find(pool => pool.id === 'event-synthetic').state = 'inactive';
  const inactive = createSnapshot(inactiveSpec);
  assert.throws(() => createRollPlan({ planId: 'inactive', version: 1, snapshot: inactive, components: [
    { componentId: 'event', poolId: 'event-synthetic', mass: q(1), origin: 'inactive' }
  ] }), /not active/);
});

function pseudoRandomSourceFactory(seedText) {
  let counter = 0n;
  const seed = Buffer.from(seedText);
  return () => ({
    id: 'deterministic-sha256-statistical-test-only',
    nextBytes(count) {
      const chunks = [];
      let size = 0;
      while (size < count) {
        const digest = crypto.createHash('sha256').update(seed).update(counter.toString()).digest();
        counter++;
        chunks.push(digest);
        size += digest.length;
      }
      return Buffer.concat(chunks, size).subarray(0, count);
    }
  });
}

async function sampleCounts(backend, snapshot, plan, count, seed) {
  const sampler = samplerFor(backend, { entropySourceFactory: pseudoRandomSourceFactory(seed) });
  const prepared = await sampler.prepareRoll({ snapshot, rollPlan: plan, channels: { coreLuck: '1' }, mode: 'auto' });
  const counts = new Map();
  for (let index = 0; index < count; index++) {
    const result = await prepared.sample();
    counts.set(result.outcome, (counts.get(result.outcome) || 0) + 1);
  }
  return counts;
}

test('supplementary statistical checks cover 50/50, 90/9/1, fallback and multiple cohorts', { timeout: 120000 }, async () => {
  const backend = await backendPromise;
  const count = 6000;
  const half = snapshotFixture({ shares: [['a', q(1, 2)], ['b', q(1, 2)]] });
  const halfCounts = await sampleCounts(backend, half, makePlan(half), count, 'half');
  assert.ok(Math.abs((halfCounts.get('a') || 0) / count - 0.5) < 0.035);

  const skewed = snapshotFixture({ shares: [['a', q(9, 10)], ['b', q(9, 100)], ['c', q(1, 100)]] });
  const skewedCounts = await sampleCounts(backend, skewed, makePlan(skewed), count, 'skewed');
  assert.ok(Math.abs((skewedCounts.get('a') || 0) / count - 0.9) < 0.025);
  assert.ok(Math.abs((skewedCounts.get('b') || 0) / count - 0.09) < 0.02);
  assert.ok(Math.abs((skewedCounts.get('c') || 0) / count - 0.01) < 0.012);

  const retired = snapshotFixture({ shares: [['basic-a', q(6, 10)], ['basic-b', q(3, 10)], ['retired', q(1, 10)]],
    fallbackShares: [['basic-a', q(3, 4)], ['basic-b', q(1, 4)]], retiredTitle: 'retired' });
  const retiredCounts = await sampleCounts(backend, retired, makePlan(retired), count, 'fallback');
  assert.equal(retiredCounts.get('retired') || 0, 0);
  assert.ok(Math.abs((retiredCounts.get('basic-a') || 0) / count - 0.67875) < 0.025);
  assert.ok(Math.abs((retiredCounts.get('basic-b') || 0) / count - 0.32125) < 0.025);

  const split = snapshotFixture({ splitCohorts: true });
  const splitCounts = await sampleCounts(backend, split, makePlan(split), count, 'cohorts');
  assert.ok(Math.abs((splitCounts.get('normal-common-title') || 0) / count - 0.95) < 0.025);
  assert.ok(Math.abs((splitCounts.get('normal-rare-title') || 0) / count - 0.05) < 0.02);
});

test('sampler timing smoke measurements: cold backend, first cached roll, warm rolls and 200/1000/10000 slots', { timeout: 120000 }, async t => {
  const coldStarted = performance.now();
  const backend = await createProductionIntervalBackend();
  const coldMs = performance.now() - coldStarted;
  const measurements = { coldBackendMs: Number(coldMs.toFixed(2)), sizes: {} };

  for (const size of [200, 1000, 10000]) {
    const titleIds = Array.from({ length: size }, (_, index) => `slot-${index}`);
    const common = q(1, 2);
    const remaining = q(9, 20);
    const perOther = rational(remaining.numerator, BigInt(remaining.denominator) * BigInt(size - 1));
    const slots = [{ titleId: titleIds[0], probability: common }];
    for (let index = 1; index < size; index++) slots.push({ titleId: titleIds[index], probability: perOther });
    const snapshot = publishSnapshot(createSnapshot({
      snapshotId: `perf-${size}`, version: 1, publication: 'draft',
      pools: [{ id: 'normal', kind: 'normal', version: 1, budget: q(1), budgetOrigin: 'perf', fallbackId: 'fallback', state: 'active' }],
      cohorts: [{ id: 'cohort', version: 1, poolId: 'normal', budget: q(19, 20), budgetOrigin: 'perf', common: true, publication: 'published', rosterFrozen: true, slots }],
      fallbacks: [{ id: 'fallback', poolId: 'normal', basis: 'fixed-basic-proportions', shares: [{ titleId: titleIds[0], share: q(1) }] }],
      expansionBudget: { total: q(1, 20), free: q(1, 20), allocated: q(0), poolId: 'normal', fallbackId: 'fallback', allocations: [], basicFunding: [{ titleId: titleIds[0], probability: q(1, 20) }] },
      commonFloor: { atNeutral: q(92, 100), commonMassAtNeutral: q(19, 20), allocatedToNonCommon: q(0) }, escrow: []
    }));
    const plan = makePlan(snapshot);
    const sampler = samplerFor(backend, { entropySourceFactory: deterministicFactory(streamForStages()) });
    const prepared = await sampler.prepareRoll({ snapshot, rollPlan: plan, channels: { coreLuck: '1' }, mode: 'auto' });
    const firstStarted = performance.now();
    await prepared.sample();
    const firstMs = performance.now() - firstStarted;
    const warmStarted = performance.now();
    for (let index = 0; index < 20; index++) await prepared.sample();
    const warmMs = (performance.now() - warmStarted) / 20;
    measurements.sizes[size] = { firstRollMs: Number(firstMs.toFixed(2)), warmMeanMs: Number(warmMs.toFixed(2)) };
  }
  t.diagnostic(JSON.stringify(measurements));
});
