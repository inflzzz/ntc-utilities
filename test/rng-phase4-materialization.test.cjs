'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { TITLES, TIERS, POOL, currentWeights } = require('../src/rng.cjs');
const {
  rational, addRational, multiplyRational, equalRational, hashSnapshot
} = require('../src/rng-pool-model.cjs');
const { createRollPlan, publishRollPlan, validateRollPlan } = require('../src/rng-roll-plan.cjs');
const { createProductionIntervalBackend } = require('../src/rng-luck2-precision.cjs');
const { createPoolSampler, createCryptoEntropySource } = require('../src/rng-pool-sampler.cjs');
const { createShadowComparison } = require('../src/rng-shadow-contract.cjs');

const ROOT = path.resolve(__dirname, '..');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'rng-pool2-catalog-v1.json'), 'utf8'));
const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'rng-phase4-equivalence-v1.json'), 'utf8'));
const q = (n, d = '1') => rational(String(n), String(d));
const sum = values => values.reduce((total, item) => addRational(total, item), q(0));

function fractionTo128Bytes(value) {
  const scaled = BigInt(value.numerator) * (1n << 128n) / BigInt(value.denominator);
  const bytes = Buffer.alloc(16);
  let remaining = scaled;
  for (let index = 15; index >= 0; index--) {
    bytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return bytes;
}

function midpoint(lower, span, total) {
  const middle = addRational(lower, rational(BigInt(span.numerator), BigInt(span.denominator) * 2n));
  return rational(BigInt(middle.numerator) * BigInt(total.denominator), BigInt(middle.denominator) * BigInt(total.numerator));
}

function entropyForTitle(snapshot, titleId) {
  const location = snapshot.cohorts.flatMap(cohort => cohort.slots.map(slot => ({ cohort, slot })))
    .find(item => item.slot.titleId === titleId);
  assert.ok(location, `Missing materialized slot ${titleId}`);
  const cohorts = snapshot.cohorts.filter(cohort => cohort.budget.numerator !== '0');
  const fallback = snapshot.fallbacks.find(item => item.id === snapshot.expansionBudget.fallbackId);
  const groups = [
    ...cohorts.map(cohort => ({ kind: 'cohort', id: cohort.id, mass: cohort.budget })),
    ...(snapshot.expansionBudget.free.numerator === '0' ? [] : [{ kind: 'fallback', id: fallback.id, mass: snapshot.expansionBudget.free }])
  ];
  const targetGroup = groups.find(group => group.id === location.cohort.id)
    || groups.find(group => group.kind === 'fallback' && fallback.shares.some(item => item.titleId === titleId));
  assert.ok(targetGroup, `No source group can resolve ${titleId}`);
  let groupBefore = q(0);
  for (const group of groups) {
    if (group === targetGroup) break;
    groupBefore = addRational(groupBefore, group.mass);
  }
  const groupValue = midpoint(groupBefore, targetGroup.mass, q(1));

  let slotBefore = q(0);
  let slotMass;
  if (targetGroup.kind === 'cohort') {
    for (const slot of location.cohort.slots) {
      if (slot.titleId === titleId) { slotMass = slot.probability; break; }
      if (slot.state === 'obtainable') slotBefore = addRational(slotBefore, slot.probability);
    }
    assert.ok(slotMass && slotMass.numerator !== '0', `${titleId} is not obtainable in its cohort.`);
  } else {
    const share = fallback.shares.find(item => item.titleId === titleId);
    assert.ok(share, `${titleId} is missing from the fallback roster.`);
    for (const entry of fallback.shares) {
      if (entry.titleId === titleId) { slotMass = entry.share; break; }
      slotBefore = addRational(slotBefore, entry.share);
    }
  }
  const slotValue = midpoint(slotBefore, slotMass, targetGroup.kind === 'cohort' ? location.cohort.budget : q(1));
  return [Buffer.alloc(16), fractionTo128Bytes(groupValue), fractionTo128Bytes(slotValue)];
}

function makeSequentialEntropyFactory(targets) {
  const pendingRolls = targets.map(segments => segments.map(segment => Buffer.from(segment)));
  return () => {
    const pending = pendingRolls.shift();
    if (!pending) throw new Error('No deterministic entropy vector remains.');
    return {
      id: 'phase4-exact-target-sequence-v1',
      nextBytes(count) {
        const next = pending.shift();
        if (!next || next.length !== count) throw new Error('Unexpected deterministic entropy request.');
        return next;
      }
    };
  };
}

function expectedPlan() {
  const plan = createRollPlan({
    planId: artifact.rollPlan.planId,
    version: artifact.rollPlan.version,
    snapshot: artifact.snapshot,
    publication: 'draft',
    components: artifact.rollPlan.components.map(component => ({
      componentId: component.componentId,
      poolId: component.poolId,
      mass: component.mass,
      origin: component.origin
    }))
  });
  return publishRollPlan(plan, artifact.snapshot);
}

test('canonical v1 pins the Phase 0 baseline and exact 5% Basic fallback accounting', () => {
  assert.equal(artifact.source.legacyBaselineCanonicalSha256, '3fd426bc078d66b699100b51e2f4a47be731e6a92256b77cf378a6e9b05e1248');
  assert.equal(artifact.source.expectedCurrentTitleCount, 200);
  assert.deepEqual(artifact.expansionReserve.total, q(1, 20));
  assert.deepEqual(artifact.expansionReserve.free, q(1, 20));
  assert.deepEqual(artifact.expansionReserve.allocated, q(0));
  assert.deepEqual(artifact.expansionReserve.basicMassInFrozenCohortAfterCarve,
    rational(BigInt(artifact.expansionReserve.sourceCommonMassAtNeutral.numerator) * 20n
      - BigInt(artifact.expansionReserve.sourceCommonMassAtNeutral.denominator),
    BigInt(artifact.expansionReserve.sourceCommonMassAtNeutral.denominator) * 20n));
  assert.equal(artifact.expansionReserve.createsNoResultProbability, false);
  const fallback = artifact.snapshot.fallbacks.find(item => item.id === artifact.expansionReserve.fallbackId);
  assert.equal(fallback.shares.length, 20);
  assert.deepEqual(sum(fallback.shares.map(item => item.share)), q(1));
});

test('exact proof covers every stable title ID and all ten tier aggregates', () => {
  assert.equal(audit.titleCount, 200);
  assert.equal(audit.equivalentTitleCount, 200);
  assert.equal(audit.failedTitleCount, 0);
  assert.equal(audit.exactPerTitleEquivalence, true);
  assert.ok(audit.titles.every(row => row.status === 'PASS' && row.exactDifference.numerator === '0'));
  assert.equal(audit.tiers.length, 10);
  assert.ok(audit.tiers.every(tier => tier.status === 'PASS' && tier.titleCount === 20
    && equalRational(tier.legacyMass, tier.pool2ObservableMass)));
  assert.equal(new Set(audit.titles.map(row => row.titleId)).size, 200);
  assert.equal(new Set(artifact.titles.map(title => title.titleId)).size, 200);
  assert.ok(artifact.titles.every(title => title.titleId === title.slotId && title.poolId === 'normal-v1'));
});

test('legacy currentWeights neutral map is exactly the materialized observable catalog', () => {
  const legacy = currentWeights({});
  assert.equal(legacy.size, 200);
  for (const title of TITLES) {
    const proof = audit.titles.find(row => row.titleId === title.id);
    assert.ok(proof);
    assert.equal(proof.legacyWeight, legacy.get(title.id).toString());
    assert.deepEqual(proof.pool2ObservableProbability,
      rational(legacy.get(title.id).toString(), String(POOL)));
  }
});

test('math identity is independent of mutable title presentation text', () => {
  const renamedPresentation = artifact.titles.map(title => ({ ...title, displayName: `${title.displayName} renamed` }));
  assert.equal(renamedPresentation.length, artifact.titles.length);
  assert.equal(artifact.mathIdentityHash, audit.mathIdentityHash);
  assert.ok(!Object.hasOwn(artifact.mathIdentity, 'displayName'));
  assert.equal(artifact.mathIdentity.mathCatalogHash.length, 64);
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(artifact.mathIdentity), 'utf8').digest('hex'), artifact.mathIdentityHash);
  assert.equal(hashSnapshot(artifact.snapshot), artifact.mathIdentity.snapshotHash);
  assert.notEqual(renamedPresentation[0].displayName, artifact.titles[0].displayName);
});

test('roll plan is a published exact global partition pinned to the canonical snapshot', () => {
  const plan = validateRollPlan(artifact.rollPlan, artifact.snapshot);
  assert.equal(plan.publication, 'published');
  assert.deepEqual(plan.components.map(item => item.poolId), ['normal-v1']);
  assert.deepEqual(sum(plan.components.map(item => item.mass)), q(1));
  assert.equal(plan.snapshotHash, hashSnapshot(artifact.snapshot));
  assert.equal(artifact.mathIdentity.rollPlanHash.length, 64);
});

test('sampler can deterministically resolve every real v1 title and never leaves the materialized ID set', async () => {
  const backend = await createProductionIntervalBackend({ allowUncertified: false });
  const expectedIds = artifact.titles.map(title => title.titleId);
  const expectedSet = new Set(expectedIds);
  try {
    const sampler = createPoolSampler({ backend, entropySourceFactory: makeSequentialEntropyFactory(expectedIds.map(id => entropyForTitle(artifact.snapshot, id))) });
    const prepared = await sampler.prepareRoll({ snapshot: artifact.snapshot, rollPlan: artifact.rollPlan,
      channels: { coreLuck: '1', buildLuck: '1', temporaryLuck: '1' }, mode: 'auto' });
    for (const titleId of expectedIds) {
      const result = await prepared.sample();
      assert.equal(result.outcome, titleId, `Exact interior target failed to select ${titleId}.`);
      assert.ok(expectedSet.has(result.outcome), 'Sampler produced an ID outside the catalog.');
      assert.equal(result.audit.snapshotHash, artifact.mathIdentity.snapshotHash);
    }
  } finally { backend.clearCache(); }
});

test('real catalog MPFR audit is certified, encloses every exact odds value, and keeps tiny odds positive', () => {
  assert.equal(audit.mpfrIntervalValidation.certified, true);
  assert.equal(audit.mpfrIntervalValidation.intervalsEncloseAll200ExactProbabilities, true);
  assert.ok(audit.titles.every(row => BigInt(row.pool2ObservableProbability.numerator) > 0n));
  assert.ok(audit.titles.some(row => row.titleId === 'ntc-20'
    && BigInt(row.pool2ObservableProbability.denominator) > 10n ** 30n));
});

test('manual remains an isolated Luck 2.0 mode; no legacy-equality claim is made', () => {
  assert.equal(artifact.mathIdentity.manualPowerVersion, 'manual-power-v1');
  assert.equal(artifact.mathIdentity.formulaVersion, 'luck2-b-infinity-balanced-v1');
  assert.equal(audit.mathIdentityHash, artifact.mathIdentityHash);
});

test('future shadow comparison is ephemeral, labels legacy as sole authority, and is not wired into app', () => {
  const comparison = createShadowComparison({ legacyOutcome: 'basic-01', discardedShadowOutcome: 'ntc-20', mathIdentity: artifact.mathIdentity });
  assert.equal(comparison.matched, false);
  assert.equal(comparison.authority, 'legacy-only');
  assert.equal(comparison.persistence, 'none');
  assert.ok(Object.isFrozen(comparison));
  assert.throws(() => { comparison.legacyOutcome = 'ntc-20'; }, TypeError);
  for (const relative of ['main.cjs', 'preload.cjs', 'src/app.js', 'src/rng-engine-router.cjs']) {
    const code = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.equal(code.includes('rng-shadow-contract'), false, `${relative} must not wire shadow comparison into the app.`);
  }
});

test('production CSPRNG remains the sampler default and diagnostic backend cannot be authorized', async () => {
  assert.equal(createCryptoEntropySource().id, 'node-crypto.randomBytes-v1');
  assert.throws(() => createPoolSampler({ backend: {
    metadata: { backendId: 'diagnostic-only', backendVersion: '1', certified: false, manifestRuntimeHashMatches: false, runtimeSha256: '0'.repeat(64) },
    transformSnapshot: async () => ({})
  } }), /pinned certified production backend/);
});
