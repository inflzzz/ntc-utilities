'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const test = require('node:test');
const { POOL, TITLES, currentWeights } = require('../src/rng.cjs');
const { rational, addRational, subtractRational, compareRational, createSnapshot } = require('../src/rng-pool-model.cjs');
const {
  BACKEND_VERSION,
  FORMULA_VERSION,
  DEFAULT_PRECISION_BITS,
  MAX_PRECISION_BITS,
  compareDyadic,
  intervalBoundsContain,
  assertProductionProbabilityInterval,
  createProductionIntervalBackend
} = require('../src/rng-luck2-precision.cjs');
const { calculateLuckBeta, transformCohort: diagnosticTransform } = require('../src/rng-luck2-math.cjs');

const backendPromise = createProductionIntervalBackend();
const q = (n, d = '1') => rational(String(n), String(d));

function cmpDyadicToRational(value, target) {
  const significand = BigInt(value.significand);
  const exponent = BigInt(value.binaryExponent);
  const numerator = BigInt(target.numerator);
  const denominator = BigInt(target.denominator);
  const left = exponent >= 0n ? (significand << exponent) * denominator : significand * denominator;
  const right = exponent >= 0n ? numerator : numerator << -exponent;
  return left < right ? -1 : left > right ? 1 : 0;
}

function intervalContainsRational(interval, target) {
  return cmpDyadicToRational(interval.lower, target) <= 0 && cmpDyadicToRational(interval.upper, target) >= 0;
}

function dyadicRational(value) {
  const significand = BigInt(value.significand);
  const exponent = BigInt(value.binaryExponent);
  return exponent >= 0n ? q(significand << exponent) : q(significand, 1n << -exponent);
}

function dyadicInside(outer, inner) {
  return compareDyadic(outer.lower, inner.lower) <= 0 && compareDyadic(outer.upper, inner.upper) >= 0;
}

function assertUnitInterval(interval, label) {
  assert.ok(compareDyadic(interval.lower, { significand: '0', binaryExponent: '0' }) >= 0, `${label} lower bound must be non-negative`);
  assert.ok(compareDyadic(interval.upper, { significand: '1', binaryExponent: '0' }) <= 0, `${label} upper bound must not exceed one`);
  assert.ok(compareDyadic(interval.lower, interval.upper) <= 0, `${label} interval must be ordered`);
}

function subtractQ(a, b) {
  return subtractRational(a, b);
}

function makeV1Snapshot() {
  const weights = currentWeights({});
  const basic = TITLES.filter(title => title.tier === 'basic');
  const basicWeight = basic.reduce((sum, title) => sum + weights.get(title.id), 0n);
  const reserve = q(5, 100);
  const slots = TITLES.map(title => {
    const original = q(weights.get(title.id), POOL);
    if (title.tier !== 'basic') return { titleId: title.id, probability: original, state: 'obtainable' };
    const funding = q(weights.get(title.id), 20n * basicWeight);
    return { titleId: title.id, probability: subtractQ(original, funding), state: 'obtainable' };
  });
  const shares = basic.map(title => ({ titleId: title.id, share: q(weights.get(title.id), basicWeight) }));
  const basicFunding = basic.map(title => ({ titleId: title.id, probability: q(weights.get(title.id), 20n * basicWeight) }));
  const cohortBudget = q(95, 100);
  return createSnapshot({
    schemaVersion: 1,
    snapshotId: 'phase2-6-shadow-v1',
    version: 1,
    publication: 'published',
    pools: [{ id: 'normal', kind: 'normal', version: 1, budget: q(1), budgetOrigin: 'catalog-v1', fallbackId: 'basic-fallback', state: 'active' }],
    cohorts: [{ id: 'catalog-v1', version: 1, poolId: 'normal', budget: cohortBudget, budgetOrigin: 'catalog-v1', common: true, publication: 'published', rosterFrozen: true, slots }],
    fallbacks: [{ id: 'basic-fallback', poolId: 'normal', basis: 'fixed-basic-proportions', shares }],
    expansionBudget: {
      total: reserve,
      free: reserve,
      allocated: q(0),
      poolId: 'normal',
      fallbackId: 'basic-fallback',
      allocations: [],
      basicFunding
    },
    commonFloor: { atNeutral: q(92, 100), commonMassAtNeutral: q(basicWeight, POOL), allocatedToNonCommon: q(0) },
    escrow: []
  });
}

test('MPFR backend identifies the pinned build, directed-rounding API and stays sampling-ineligible', async () => {
  const backend = await backendPromise;
  assert.equal(backend.metadata.backendVersion, BACKEND_VERSION);
  assert.equal(backend.metadata.gmpVersion, '6.3.0');
  assert.equal(backend.metadata.mpfrVersion, '4.2.1');
  assert.equal(backend.metadata.certified, true);
  assert.equal(backend.metadata.supportStatus, 'certified-supported');
  assert.equal(backend.metadata.precisionBits.default, DEFAULT_PRECISION_BITS);
  assert.equal(backend.metadata.precisionBits.max, MAX_PRECISION_BITS);
  assert.equal(backend.metadata.formulaVersion, FORMULA_VERSION);
  assert.throws(() => assertProductionProbabilityInterval(diagnosticTransform({
    slots: [{ titleId: 'a', probability: q(1, 2) }, { titleId: 'b', probability: q(1, 2) }],
    channels: { coreLuck: '1' }, mode: 'auto'
  })), /production-authoritative/);
});

test('B∞ beta bounds cover the formula at 1, 3 and enormous Luck ratings', async () => {
  const backend = await backendPromise;
  for (const rating of ['1', '3', '1e20', '1e100', '1e1000', '1e1000000', `1e${'9'.repeat(400)}`]) {
    for (const mode of ['auto', 'manual']) {
      const result = await backend.calculateBeta({ channels: { coreLuck: rating }, mode, precisionBits: 256 });
      assert.equal(result.numericAuthority, 'mpfr-directed-interval');
      assert.equal(result.samplerEligible, false);
      assert.ok(compareDyadic(result.beta.lower, result.beta.upper) <= 0);
      assert.ok(BigInt(result.beta.lower.significand) > 0n);
      if (rating === '1' && mode === 'auto') assert.deepEqual(result.beta.lower, result.beta.upper);
      if (mode === 'manual') {
        const diagnostic = calculateLuckBeta({ channels: { coreLuck: rating }, mode });
        const expected = Number(diagnostic.beta);
        const low = Number(result.beta.lower.significand) * 2 ** Number(result.beta.lower.binaryExponent);
        const high = Number(result.beta.upper.significand) * 2 ** Number(result.beta.upper.binaryExponent);
        assert.ok(Math.abs(((low + high) / 2) - expected) < 2e-15, `manual beta must agree with diagnostic sanity value for ${rating}`);
      }
    }
  }
});

test('beta intervals refine compatibly from 128 through 1024 bits', async () => {
  const backend = await backendPromise;
  const values = [];
  for (const precisionBits of [128, 256, 512, 1024]) {
    values.push(await backend.calculateBeta({ channels: { coreLuck: '1e1000' }, mode: 'manual', precisionBits }));
  }
  for (let index = 1; index < values.length; index++) {
    assert.ok(dyadicInside(values[index - 1].beta, values[index].beta), `precision ${values[index].precisionBits} must refine its predecessor`);
  }
});

test('ratings immediately above neutral remain enclosed when finite precision cannot resolve the gap tightly', async () => {
  const backend = await backendPromise;
  const nearOne = '1.0000000000000000000000000000000000000001';
  const coarse = await backend.calculateBeta({ channels: { coreLuck: nearOne }, mode: 'auto', precisionBits: 128 });
  const refined = await backend.calculateBeta({ channels: { coreLuck: nearOne }, mode: 'auto', precisionBits: 1024 });
  assert.ok(dyadicInside(coarse.beta, refined.beta));
  assert.ok(compareDyadic(refined.beta.upper, { significand: '1', binaryExponent: '0' }) <= 0);
  assert.ok(compareDyadic(refined.beta.lower, refined.beta.upper) <= 0);
});

test('MPFR power bounds retain probabilities 1e-20 through 1e-1000 without underflow', async () => {
  const backend = await backendPromise;
  for (const zeroes of [20, 100, 500, 1000]) {
    const denominator = `1${'0'.repeat(zeroes)}`;
    const result = await backend.transformCohort({
      cohortId: `tiny-${zeroes}`,
      slots: [
        { titleId: 'common', probability: q(BigInt(denominator) - 1n, denominator) },
        { titleId: 'rare', probability: q(1, denominator) }
      ],
      channels: { coreLuck: '1e1000' },
      mode: 'auto',
      precisionBits: 512
    });
    assertProductionProbabilityInterval(result);
    const rare = result.entries.find(item => item.titleId === 'rare');
    assertUnitInterval(rare.absoluteProbability, `1e-${zeroes}`);
    assert.ok(BigInt(rare.absoluteProbability.lower.significand) > 0n);
    assert.ok(BigInt(rare.absoluteProbability.lower.binaryExponent) < -100n);
  }
});

test('positive interval arithmetic encloses Manual/Auto cohort powers and normalizes within budget', async () => {
  const backend = await backendPromise;
  const slots = [
    { titleId: 'common', probability: q(48, 100) },
    { titleId: 'mid', probability: q(9, 100) },
    { titleId: 'rare', probability: q(3, 100) }
  ];
  for (const mode of ['auto', 'manual']) {
    const result = await backend.transformCohort({ slots, budget: q(3, 5), channels: { coreLuck: '1' }, mode, precisionBits: 512 });
    assertProductionProbabilityInterval(result);
    assert.ok(result.entries.every(entry => compareDyadic(entry.absoluteProbability.lower, entry.absoluteProbability.upper) <= 0));
    result.entries.forEach(entry => assertUnitInterval(entry.absoluteProbability, `${mode}/${entry.titleId}`));
    assert.ok(result.entries.every(entry => BigInt(entry.absoluteProbability.lower.significand) > 0n));
    const budget = q(3, 5);
    const diagnosticSlots = slots.map(slot => ({
      titleId: slot.titleId,
      probability: q(BigInt(slot.probability.numerator) * 5n, BigInt(slot.probability.denominator) * 3n)
    }));
    const diagnostic = diagnosticTransform({ slots: diagnosticSlots, budget, channels: { coreLuck: '1' }, mode });
    const diagnosticById = new Map(diagnostic.entries.map(entry => [entry.titleId, entry]));
    // Each exact base share is enclosed by MPFR despite the powered normalization.
    let totalConditional = q(0);
    for (const entry of result.entries) {
      assert.ok(entry.absoluteProbability.lower && entry.absoluteProbability.upper);
      if (mode === 'auto') assert.ok(intervalContainsRational(entry.absoluteProbability, q(BigInt(entry.baseProbability.numerator), BigInt(entry.baseProbability.denominator))));
      const midpoint = (Number(entry.absoluteProbability.lower.significand) * 2 ** Number(entry.absoluteProbability.lower.binaryExponent)
        + Number(entry.absoluteProbability.upper.significand) * 2 ** Number(entry.absoluteProbability.upper.binaryExponent)) / 2;
      const sanity = diagnosticById.get(entry.titleId).absoluteProbability;
      assert.ok(Math.abs(midpoint - Number(sanity.significand) * 10 ** Number(sanity.exponent)) < 2e-14, `${mode} MPFR/diagnostic coarse agreement for ${entry.titleId}`);
      totalConditional = addRational(totalConditional, entry.exactAbsoluteProbability || q(0));
    }
    if (mode === 'auto') assert.deepEqual(totalConditional, budget);
  }
});

test('unobtainable slots remain escrowed and are routed to their frozen fallback', async () => {
  const backend = await backendPromise;
  const normal = createSnapshot({
    schemaVersion: 1, snapshotId: 'escrow-test', version: 1, publication: 'published',
    pools: [{ id: 'normal', kind: 'normal', version: 1, budget: q(1), budgetOrigin: 'v1', fallbackId: 'fallback', state: 'active' }],
    cohorts: [{ id: 'v1', version: 1, poolId: 'normal', budget: q(19, 20), budgetOrigin: 'v1', common: true, publication: 'published', rosterFrozen: true,
      slots: [{ titleId: 'basic-a', probability: q(17, 20), state: 'obtainable' }, { titleId: 'legacy-x', probability: q(1, 10), state: 'unobtainable' }] }],
    fallbacks: [{ id: 'fallback', poolId: 'normal', basis: 'fixed-basic-proportions', shares: [{ titleId: 'basic-a', share: q(1) }] }],
    expansionBudget: { total: q(1, 20), free: q(1, 20), allocated: q(0), poolId: 'normal', fallbackId: 'fallback', allocations: [], basicFunding: [{ titleId: 'basic-a', probability: q(1, 20) }] },
    commonFloor: { atNeutral: q(1, 2), commonMassAtNeutral: q(9, 10), allocatedToNonCommon: q(0) },
    escrow: [{ titleId: 'legacy-x', poolId: 'normal', cohortId: 'v1', amount: q(1, 10), fallbackId: 'fallback' }]
  });
  const result = await backend.transformSnapshot({ snapshot: normal, channels: { coreLuck: '1' }, mode: 'auto', precisionBits: 256 });
  assertProductionProbabilityInterval(result);
  assert.equal(result.pools.length, 1);
  assert.equal(result.pools[0].entries.length, 1);
  assert.equal(result.pools[0].entries[0].titleId, 'basic-a');
  assert.ok(intervalContainsRational(result.pools[0].entries[0].probability, q(1)));
  assert.equal(result.cohorts[0].escrow[0].titleId, 'legacy-x');
  assert.deepEqual(result.fallbacks[0].mass, q(3, 20));
});

test('event pools remain independently normalized and do not enter the normal pool denominator', async () => {
  const backend = await backendPromise;
  const snapshot = createSnapshot({
    schemaVersion: 1, snapshotId: 'event-pool-test', version: 1, publication: 'published',
    pools: [
      { id: 'normal', kind: 'normal', version: 1, budget: q(1), budgetOrigin: 'v1', fallbackId: 'normal-fallback', state: 'active' },
      { id: 'event-x', kind: 'event', version: 1, budget: q(1, 10), budgetOrigin: 'event-x-v1', fallbackId: 'event-fallback', state: 'active' }
    ],
    cohorts: [
      { id: 'normal-v1', version: 1, poolId: 'normal', budget: q(19, 20), budgetOrigin: 'v1', common: true, publication: 'published', rosterFrozen: true,
        slots: [{ titleId: 'normal-basic', probability: q(19, 20) }] },
      { id: 'event-x-v1', version: 1, poolId: 'event-x', budget: q(1, 10), budgetOrigin: 'event-x-v1', common: false, publication: 'published', rosterFrozen: true,
        slots: [{ titleId: 'event-title', probability: q(1, 10) }] }
    ],
    fallbacks: [
      { id: 'normal-fallback', poolId: 'normal', basis: 'fixed-basic-proportions', shares: [{ titleId: 'normal-basic', share: q(1) }] },
      { id: 'event-fallback', poolId: 'event-x', basis: 'pool-local-proportions', shares: [{ titleId: 'event-title', share: q(1) }] }
    ],
    expansionBudget: { total: q(1, 20), free: q(1, 20), allocated: q(0), poolId: 'normal', fallbackId: 'normal-fallback', allocations: [], basicFunding: [{ titleId: 'normal-basic', probability: q(1, 20) }] },
    commonFloor: { atNeutral: q(9, 10), commonMassAtNeutral: q(19, 20), allocatedToNonCommon: q(0) },
    escrow: []
  });
  const result = await backend.transformSnapshot({ snapshot, channels: { coreLuck: '1e100' }, mode: 'auto', precisionBits: 256 });
  assert.equal(result.pools.length, 2);
  assert.equal(result.pools.find(pool => pool.poolId === 'normal').entries.length, 1);
  assert.equal(result.pools.find(pool => pool.poolId === 'event-x').entries.length, 1);
  assert.ok(intervalContainsRational(result.pools.find(pool => pool.poolId === 'normal').entries[0].probability, q(1)));
  assert.ok(intervalContainsRational(result.pools.find(pool => pool.poolId === 'event-x').entries[0].probability, q(1, 10)));
});

test('manual factor is applied once and remains isolated from Auto at neutral Luck', async () => {
  const backend = await backendPromise;
  const auto = await backend.calculateBeta({ channels: { coreLuck: '1' }, mode: 'auto', precisionBits: 512 });
  const manual = await backend.calculateBeta({ channels: { coreLuck: '1' }, mode: 'manual', precisionBits: 512 });
  assert.deepEqual(auto.beta.lower, auto.beta.upper);
  assert.ok(compareDyadic(manual.beta.lower, auto.beta.upper) < 0);
  const diagnostic = calculateLuckBeta({ channels: { coreLuck: '1' }, mode: 'manual' });
  const low = Number(manual.beta.lower.significand) * 2 ** Number(manual.beta.lower.binaryExponent);
  const high = Number(manual.beta.upper.significand) * 2 ** Number(manual.beta.upper.binaryExponent);
  assert.ok(low <= Number(diagnostic.beta) && Number(diagnostic.beta) <= high);
});

test('invalid inputs, precision, modes and missing/incompatible backend fail closed', async () => {
  const backend = await backendPromise;
  await assert.rejects(backend.calculateBeta({ channels: { coreLuck: '0.5' }, mode: 'auto' }), /at least 1/);
  await assert.rejects(backend.calculateBeta({ channels: { coreLuck: '1', dropLuck: '2' }, mode: 'auto' }), /Drop Luck is independent/);
  await assert.rejects(backend.calculateBeta({ channels: { coreLuck: '1' }, mode: 'unknown' }), /mode/);
  await assert.rejects(backend.calculateBeta({ channels: { coreLuck: '1' }, mode: 'auto', precisionBits: 20000 }), /precisionBits/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-mpfr-invalid-'));
  try {
    await assert.rejects(createProductionIntervalBackend({ bundlePath: path.join(dir, 'missing.js') }), /runtime is missing/);
    const incompatibleManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'ntc-math-backend', '1.3.2', 'manifest.json'), 'utf8'));
    incompatibleManifest.mpfrVersion = '9.9.9';
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(incompatibleManifest));
    await assert.rejects(createProductionIntervalBackend({ bundlePath: require.resolve('gmp-wasm'), expectedManifestPath: manifestPath }), /versions\/formula are incompatible/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('compatible replacement is loadable but marked uncertified and cache keys include all math inputs', async () => {
  const backend = await backendPromise;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-mpfr-replacement-'));
  try {
    const runtimePath = path.join(dir, 'index.umd.js');
    fs.copyFileSync(require.resolve('gmp-wasm'), runtimePath);
    fs.appendFileSync(runtimePath, '\n// compatible local replacement test\n');
    const replacementManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'ntc-math-backend', '1.3.2', 'manifest.json'), 'utf8'));
    replacementManifest.runtimeSha256 = crypto.createHash('sha256').update(fs.readFileSync(runtimePath)).digest('hex');
    const replacementManifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(replacementManifestPath, JSON.stringify(replacementManifest));
    const replacement = await createProductionIntervalBackend({ bundlePath: runtimePath, expectedManifestPath: replacementManifestPath });
    assert.equal(replacement.metadata.certified, false);
    assert.equal(replacement.metadata.supportStatus, 'compatible-uncertified');
    assert.equal(replacement.metadata.gmpVersion, null);
    assert.equal(replacement.metadata.declaredGmpVersion, '6.3.0');
    assert.equal(replacement.metadata.manifestRuntimeHashMatches, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  backend.clearCache();
  const inputs = { cohortId: 'cache', slots: [{ titleId: 'a', probability: q(1, 2) }, { titleId: 'b', probability: q(1, 2) }], channels: { coreLuck: '2' }, mode: 'auto', precisionBits: 128, snapshotVersion: { version: 1, snapshotHash: 'abc' } };
  assert.equal((await backend.transformCohort(inputs)).cache.hit, false);
  assert.equal((await backend.transformCohort(inputs)).cache.hit, true);
  assert.equal((await backend.transformCohort({ ...inputs, mode: 'manual' })).cache.hit, false);
  assert.equal((await backend.transformCohort({ ...inputs, precisionBits: 256 })).cache.hit, false);
  assert.equal((await backend.transformCohort({ ...inputs, snapshotVersion: { version: 2, snapshotHash: 'def' } })).cache.hit, false);
  assert.ok(backend.cacheInfo().size <= backend.cacheInfo().maxEntries);
});

test('200-title v1 shadow snapshot reproduces every Auto-neutral observable odds with intact reserve', async () => {
  const backend = await backendPromise;
  const snapshot = makeV1Snapshot();
  assert.equal(TITLES.length, 200);
  assert.equal(new Set(snapshot.cohorts[0].slots.map(slot => slot.titleId)).size, 200);
  assert.deepEqual(snapshot.expansionBudget.free, q(5, 100));
  assert.ok(BigInt(snapshot.commonFloor.commonMassAtNeutral.numerator) * 100n >= 92n * BigInt(snapshot.commonFloor.commonMassAtNeutral.denominator));
    const expected = new Map(TITLES.map(title => [title.id, q(currentWeights({}).get(title.id), POOL)]));
  for (const precisionBits of [128, 512]) {
    const start = performance.now();
    const result = await backend.transformSnapshot({ snapshot, channels: { coreLuck: '1' }, mode: 'auto', precisionBits });
    const elapsedMs = performance.now() - start;
    assertProductionProbabilityInterval(result);
    assert.equal(result.pools[0].entries.length, 200);
    for (const entry of result.pools[0].entries) {
      assertUnitInterval(entry.probability, `${entry.titleId}@${precisionBits}`);
      assert.ok(intervalContainsRational(entry.probability, expected.get(entry.titleId)), `R=1 legacy odds mismatch for ${entry.titleId} @ ${precisionBits}`);
    }
    const lowerMass = result.pools[0].entries.reduce((sum, entry) => addRational(sum, dyadicRational(entry.probability.lower)), q(0));
    const upperMass = result.pools[0].entries.reduce((sum, entry) => addRational(sum, dyadicRational(entry.probability.upper)), q(0));
    assert.ok(compareRational(lowerMass, q(1)) <= 0 && compareRational(upperMass, q(1)) >= 0, `mass bounds must enclose one @ ${precisionBits}`);
    assert.ok(elapsedMs >= 0);
    assert.equal((await backend.transformSnapshot({ snapshot, channels: { coreLuck: '1' }, mode: 'auto', precisionBits })).cache.hit, true);
  }
});

test('200-title roster remains ordered at high precision and Manual is a separate intentional distribution', async () => {
  const backend = await backendPromise;
  const snapshot = makeV1Snapshot();
  const slotsById = new Map(snapshot.cohorts[0].slots.map(slot => [slot.titleId, slot]));
  const sorted = [...snapshot.cohorts[0].slots].sort((a, b) => {
    const left = BigInt(a.probability.numerator) * BigInt(b.probability.denominator);
    const right = BigInt(b.probability.numerator) * BigInt(a.probability.denominator);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const start = performance.now();
  const auto = await backend.transformCohort({ cohortId: 'catalog-v1', slots: snapshot.cohorts[0].slots, budget: q(95, 100), channels: { coreLuck: '1e1000' }, mode: 'auto', precisionBits: 1024, snapshotVersion: { version: 1, snapshotHash: 'v1' } });
  const autoMs = performance.now() - start;
  const manualStart = performance.now();
  const manual = await backend.transformCohort({ cohortId: 'catalog-v1', slots: snapshot.cohorts[0].slots, budget: q(95, 100), channels: { coreLuck: '1e1000' }, mode: 'manual', precisionBits: 512, snapshotVersion: { version: 1, snapshotHash: 'v1' } });
  const manualMs = performance.now() - manualStart;
  const autoById = new Map(auto.entries.map(entry => [entry.titleId, entry]));
  const manualById = new Map(manual.entries.map(entry => [entry.titleId, entry]));
  for (let index = 1; index < sorted.length; index++) {
    const rarer = autoById.get(sorted[index - 1].titleId).absoluteProbability;
    const commoner = autoById.get(sorted[index].titleId).absoluteProbability;
    if (compareRational(sorted[index - 1].probability, sorted[index].probability) === 0) continue;
    assert.ok(compareDyadic(rarer.upper, commoner.lower) < 0, `catalog order not separated: ${sorted[index - 1].titleId}/${sorted[index].titleId}`);
  }
  assert.notDeepEqual(auto.beta, manual.beta);
  assert.equal(auto.entries.length, 200);
  assert.equal(manual.entries.length, 200);
  const autoMassLower = auto.entries.reduce((sum, entry) => addRational(sum, dyadicRational(entry.absoluteProbability.lower)), q(0));
  const autoMassUpper = auto.entries.reduce((sum, entry) => addRational(sum, dyadicRational(entry.absoluteProbability.upper)), q(0));
  assert.ok(compareRational(autoMassLower, q(95, 100)) <= 0 && compareRational(autoMassUpper, q(95, 100)) >= 0);
  assert.ok(autoMs >= 0 && manualMs >= 0);
  assert.equal(slotsById.size, 200);
});
