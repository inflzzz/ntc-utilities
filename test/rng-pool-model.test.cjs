'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  rational,
  addRational,
  subtractRational,
  compareRational,
  equalRational,
  serializeRational,
  parseRational,
  createSnapshot,
  publishSnapshot,
  forkSnapshot,
  allocateExpansionBudget,
  appendSlotToCohort,
  setTitleObtainability,
  configuredSlotProbability,
  effectiveSlotProbability,
  resolveExpansionReserve,
  resolveEscrow,
  canonicalizeSnapshot,
  hashSnapshot
} = require('../src/rng-pool-model.cjs');

const q = (n, d = '1') => rational(String(n), String(d));

function snapshotSpec({ floor = q(92, 100), expansion = q(5, 100), event = false } = {}) {
  const basicA = q(552, 1000);
  const basicB = q(368, 1000);
  const rare = q(3, 100);
  const pools = [{ id: 'normal', kind: 'normal', version: 1, budget: q(1), budgetOrigin: 'catalog-v1', fallbackId: 'normal-basic-fallback' }];
  const cohorts = [
    { id: 'catalog-v1-basic', version: 1, poolId: 'normal', budget: q(92, 100), budgetOrigin: 'catalog-v1', common: true, publication: 'published', slots: [
      { titleId: 'basic-a', probability: basicA, acquisition: 'normal' },
      { titleId: 'basic-b', probability: basicB, acquisition: 'normal' }
    ] },
    { id: 'catalog-v1-rare', version: 1, poolId: 'normal', budget: rare, budgetOrigin: 'catalog-v1', common: false, publication: 'published', slots: [
      { titleId: 'rare-a', probability: rare, acquisition: 'normal' }
    ] }
  ];
  const fallbacks = [{ id: 'normal-basic-fallback', poolId: 'normal', basis: 'fixed-basic-proportions', shares: [
    { titleId: 'basic-a', share: q(3, 5) },
    { titleId: 'basic-b', share: q(2, 5) }
  ] }];
  if (event) {
    pools.push({ id: 'event-eclipse', kind: 'event', version: 3, budget: q(1), budgetOrigin: 'event:eclipse:v3', fallbackId: 'event-eclipse-fallback' });
    cohorts.push({ id: 'event-eclipse-v3', version: 3, poolId: 'event-eclipse', budget: q(1), budgetOrigin: 'event:eclipse:v3', common: false, publication: 'published', slots: [
      { titleId: 'event-title-a', probability: q(7, 10), acquisition: 'event' },
      { titleId: 'event-title-b', probability: q(3, 10), acquisition: 'event' }
    ] });
    fallbacks.push({ id: 'event-eclipse-fallback', poolId: 'event-eclipse', basis: 'pool-local-proportions', shares: [
      { titleId: 'event-title-a', share: q(7, 10) },
      { titleId: 'event-title-b', share: q(3, 10) }
    ] });
  }
  return {
    snapshotId: 'test-v1',
    version: 1,
    publication: 'draft',
    pools,
    cohorts,
    fallbacks,
    expansionBudget: {
      total: expansion,
      free: expansion,
      allocated: q(0),
      poolId: 'normal',
      fallbackId: 'normal-basic-fallback',
      basicFunding: [
        { titleId: 'basic-a', probability: q(BigInt(expansion.numerator) * 3n, BigInt(expansion.denominator) * 5n) },
        { titleId: 'basic-b', probability: q(BigInt(expansion.numerator) * 2n, BigInt(expansion.denominator) * 5n) }
      ]
    },
    commonFloor: {
      atNeutral: floor,
      commonMassAtNeutral: q(97, 100),
      allocatedToNonCommon: q(0)
    },
    escrow: []
  };
}

function makeSnapshot(options) { return createSnapshot(snapshotSpec(options)); }

function nonCommonCohort(id, amount) {
  return {
    id,
    version: 1,
    poolId: 'normal',
    budget: amount,
    budgetOrigin: 'expansion-reserve-v1',
    common: false,
    publication: 'draft',
    slots: [{ titleId: `${id}-title`, probability: amount, acquisition: 'exclusive' }]
  };
}

test('exact rationals support denominators 1e20, 1e100, 1e500 and 1e1000 without underflow', () => {
  for (const exponent of [20, 100, 500, 1000]) {
    const denominator = `1${'0'.repeat(exponent)}`;
    const value = rational('1', denominator);
    assert.notEqual(value.numerator, '0');
    assert.equal(compareRational(value, rational('0')), 1);
    assert.deepEqual(parseRational(serializeRational(value)), value);
  }
  assert.throws(() => rational(0.1), /BigInt or canonical integer string/);
});

test('rational addition and subtraction remain exact for huge denominators', () => {
  const oneE1000 = rational('1', `1${'0'.repeat(1000)}`);
  const sum = addRational(oneE1000, oneE1000);
  assert.deepEqual(sum, rational('2', `1${'0'.repeat(1000)}`));
  assert.deepEqual(subtractRational(sum, oneE1000), oneE1000);
});

test('5% reserve is represented exactly and free + allocated equals total', () => {
  const snapshot = makeSnapshot();
  assert.deepEqual(snapshot.expansionBudget.total, rational('1', '20'));
  assert.deepEqual(addRational(snapshot.expansionBudget.free, snapshot.expansionBudget.allocated), snapshot.expansionBudget.total);
  assert.deepEqual(resolveExpansionReserve(snapshot), [
    { titleId: 'basic-a', probability: q(3, 100) },
    { titleId: 'basic-b', probability: q(2, 100) }
  ]);
});

test('negative probabilities and budgets are rejected', () => {
  assert.throws(() => rational('-1', '5') && createSnapshot({ ...snapshotSpec(), commonFloor: { atNeutral: q(-1, 100), commonMassAtNeutral: q(97, 100) } }), /cannot be negative/);
  assert.throws(() => createSnapshot({ ...snapshotSpec(), expansionBudget: { ...snapshotSpec().expansionBudget, free: q(-1, 100) } }), /cannot be negative/);
});

test('over-allocation of the free Expansion/Common Budget is rejected', () => {
  const snapshot = makeSnapshot();
  assert.throws(() => allocateExpansionBudget(snapshot, nonCommonCohort('too-large', q(6, 100))), /exceeds free budget/);
});

test('Common Floor rejects a valid reserve allocation that would leave less than 92%', () => {
  const snapshot = makeSnapshot({ floor: q(93, 100) });
  assert.throws(() => allocateExpansionBudget(snapshot, nonCommonCohort('floor-breaker', q(5, 100))), /Common Floor/);
});

test('duplicate title IDs across cohorts are rejected', () => {
  const spec = snapshotSpec();
  spec.cohorts[1].slots[0].titleId = 'basic-a';
  assert.throws(() => createSnapshot(spec), /Duplicate title IDs/);
});

test('published snapshots are deeply frozen and cannot be changed by editing source fixtures', () => {
  const spec = snapshotSpec();
  const snapshot = publishSnapshot(createSnapshot(spec));
  const before = canonicalizeSnapshot(snapshot);
  spec.cohorts[0].slots[0].titleId = 'renamed-mutably';
  assert.equal(snapshot.cohorts[0].slots[0].titleId, 'basic-a');
  assert.throws(() => { snapshot.cohorts[0].slots[0].titleId = 'mutated'; }, TypeError);
  assert.equal(canonicalizeSnapshot(snapshot), before);
});

test('published cohort roster cannot be extended; later additions require a new cohort/version', () => {
  const published = publishSnapshot(makeSnapshot());
  const draft = forkSnapshot(published, { snapshotId: 'test-v2', version: 2 });
  assert.throws(() => appendSlotToCohort(draft, 'catalog-v1-basic'), /frozen roster/);
  assert.equal(published.cohorts[0].slots.length, 2);
  assert.equal(draft.cohorts[0].slots.length, 2);
});

test('new cohort allocation transfers exact mass from free reserve without changing old slot weights', () => {
  const start = makeSnapshot();
  const added = allocateExpansionBudget(start, nonCommonCohort('new-exclusive', q(1, 1000)));
  assert.deepEqual(added.expansionBudget.free, q(49, 1000));
  assert.deepEqual(added.expansionBudget.allocated, q(1, 1000));
  assert.deepEqual(addRational(added.expansionBudget.free, added.expansionBudget.allocated), added.expansionBudget.total);
  assert.deepEqual(configuredSlotProbability(added, 'rare-a'), q(3, 100));
  assert.equal(added.cohorts[0].slots[0].titleId, start.cohorts[0].slots[0].titleId);
});

test('unobtainable preserves configured slot probability in escrow and routes it through the same fallback', () => {
  const initial = publishSnapshot(makeSnapshot());
  const draft = forkSnapshot(initial, { snapshotId: 'test-v2', version: 2 });
  const retired = setTitleObtainability(draft, 'rare-a', 'unobtainable');
  assert.deepEqual(configuredSlotProbability(retired, 'rare-a'), q(3, 100));
  assert.deepEqual(effectiveSlotProbability(retired, 'rare-a'), q(0));
  assert.deepEqual(retired.escrow[0].amount, q(3, 100));
  assert.deepEqual(resolveEscrow(retired, 'rare-a'), [
    { titleId: 'basic-a', probability: q(18, 1000) },
    { titleId: 'basic-b', probability: q(12, 1000) }
  ]);
  assert.deepEqual(configuredSlotProbability(initial, 'rare-a'), q(3, 100));
});

test('reactivation restores the same slot and releases its escrow in a new snapshot version', () => {
  const published = publishSnapshot(makeSnapshot());
  const retired = setTitleObtainability(forkSnapshot(published, { snapshotId: 'test-v2', version: 2 }), 'rare-a', 'unobtainable');
  const reactivated = setTitleObtainability(forkSnapshot(publishSnapshot(retired), { snapshotId: 'test-v3', version: 3 }), 'rare-a', 'obtainable');
  assert.deepEqual(configuredSlotProbability(reactivated, 'rare-a'), q(3, 100));
  assert.deepEqual(effectiveSlotProbability(reactivated, 'rare-a'), q(3, 100));
  assert.equal(reactivated.escrow.length, 0);
  assert.ok(reactivated.cohorts.find(cohort => cohort.id === 'catalog-v1-rare').version > retired.cohorts.find(cohort => cohort.id === 'catalog-v1-rare').version);
});

test('event pool keeps its own version, budget and fallback isolated from normal reserve', () => {
  const snapshot = makeSnapshot({ event: true });
  const normal = snapshot.pools.find(pool => pool.id === 'normal');
  const event = snapshot.pools.find(pool => pool.id === 'event-eclipse');
  assert.equal(event.kind, 'event');
  assert.deepEqual(event.budget, q(1));
  assert.equal(event.budgetOrigin, 'event:eclipse:v3');
  assert.equal(event.fallbackId, 'event-eclipse-fallback');
  assert.deepEqual(snapshot.expansionBudget.free, q(5, 100));
  assert.notEqual(event.fallbackId, normal.fallbackId);
});

test('canonical serialization and snapshot hashes are deterministic', () => {
  const left = publishSnapshot(makeSnapshot());
  const spec = snapshotSpec();
  const reordered = { ...spec, expansionBudget: { ...spec.expansionBudget }, commonFloor: { ...spec.commonFloor } };
  const right = publishSnapshot(createSnapshot(reordered));
  assert.equal(canonicalizeSnapshot(left), canonicalizeSnapshot(right));
  assert.equal(hashSnapshot(left), hashSnapshot(right));
});
