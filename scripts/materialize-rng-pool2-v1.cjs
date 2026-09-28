'use strict';

// Deterministically materializes the current legacy catalog into the isolated
// Pool 2.0 model and emits an exact, title-by-title equivalence audit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  TITLES, TIERS, POOL, CATALOG_VERSION, BOOTSTRAP_EXPECTED_COUNT, currentWeights
} = require('../src/rng.cjs');
const {
  rational, addRational, subtractRational, multiplyRational, compareRational,
  equalRational, createSnapshot, publishSnapshot, hashSnapshot
} = require('../src/rng-pool-model.cjs');
const { createRollPlan, publishRollPlan } = require('../src/rng-roll-plan.cjs');
const {
  BACKEND_ID, BACKEND_VERSION, FORMULA_VERSION, MANUAL_POWER_VERSION,
  MAX_PRECISION_BITS, createProductionIntervalBackend
} = require('../src/rng-luck2-precision.cjs');
const { SAMPLER_VERSION } = require('../src/rng-pool-sampler.cjs');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'content', 'rng-title-catalog.json');
const BASELINE_PATH = path.join(ROOT, 'docs', 'rng-phase0-baseline-2026-09-27.tsv');
const ARTIFACT_PATH = path.join(ROOT, 'content', 'rng-pool2-catalog-v1.json');
const AUDIT_PATH = path.join(ROOT, 'docs', 'rng-phase4-equivalence-v1.json');
const RESERVE = rational('1', '20');
const FLOOR = rational('23', '25');
const NORMAL_POOL_ID = 'normal-v1';
const BASIC_FALLBACK_ID = 'normal-basic-fallback-v1';
const SNAPSHOT_ID = 'pool2-catalog-v1';
const PLAN_ID = 'normal-roll-v1';

function sha256(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex'); }
function stableJson(value) { return JSON.stringify(value); }
function q(n, d = '1') { return rational(String(n), String(d)); }
function sum(values) { return values.reduce((total, value) => addRational(total, value), q(0)); }
function rationalText(value) { return `${value.numerator}/${value.denominator}`; }
function assert(condition, message) { if (!condition) throw new Error(message); }

function readBaseline() {
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  const lines = raw.trimEnd().split(/\r?\n/);
  const headers = Object.fromEntries(lines.filter(line => line.trim().startsWith('#'))
    .map(line => line.trim().slice(1).trim().split('=')));
  const columns = lines.find(line => line.trim() && !line.trim().startsWith('#'))?.trim().split('\t');
  assert(headers.catalogVersion === String(CATALOG_VERSION), 'Legacy baseline catalog version mismatch.');
  assert(headers.titleCount === String(BOOTSTRAP_EXPECTED_COUNT), 'Legacy baseline title count mismatch.');
  assert(headers.sumMatchesPool === 'true', 'Legacy baseline did not record an exact pool sum.');
  assert(headers.canonicalSha256 === '3fd426bc078d66b699100b51e2f4a47be731e6a92256b77cf378a6e9b05e1248', 'Legacy baseline canonical SHA-256 changed.');
  assert(columns?.join('\t') === 'id\ttier\tbaseWeight\tactive\tacquisition', 'Unexpected legacy baseline columns.');
  const rows = new Map(lines.filter(line => !line.trim().startsWith('#') && line.trim())
    .slice(1).map(line => {
      const [id, tier, baseWeight, active, acquisition] = line.split('\t');
      return [id, { id, tier, baseWeight, active, acquisition }];
    }));
  assert(rows.size === BOOTSTRAP_EXPECTED_COUNT, 'Legacy baseline row count mismatch.');
  return { headers, rows };
}

function canonicalTitleInputs() {
  const source = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  assert(source.version === CATALOG_VERSION, 'Source JSON catalog version mismatch.');
  assert(source.bootstrapExpectedCount === BOOTSTRAP_EXPECTED_COUNT, 'Source JSON expected count mismatch.');
  const baseline = readBaseline();
  const runtime = new Map(TITLES.map(title => [title.id, title]));
  const current = currentWeights({});
  assert(source.titles.length === BOOTSTRAP_EXPECTED_COUNT, 'Current source catalog has an unexpected title count.');
  assert(runtime.size === source.titles.length && current.size === source.titles.length, 'Runtime title IDs/weights are incomplete.');
  const seen = new Set();
  const titles = source.titles.map((entry, index) => {
    const legacy = runtime.get(entry.id);
    const baselineRow = baseline.rows.get(entry.id);
    assert(legacy && baselineRow, `Title ${entry.id} is absent from the runtime or Phase 0 baseline.`);
    assert(!seen.has(entry.id), `Duplicate title ID ${entry.id}.`);
    seen.add(entry.id);
    const weight = BigInt(legacy.baseWeight);
    assert(entry.baseWeight === weight.toString(), `Source catalog weight differs from runtime for ${entry.id}.`);
    assert(current.has(entry.id) && current.get(entry.id) === weight, `Neutral legacy currentWeights differs for ${entry.id}.`);
    assert(baselineRow.baseWeight === weight.toString() && baselineRow.tier === entry.tier
      && baselineRow.active === String(Boolean(entry.active)) && baselineRow.acquisition === entry.acquisition,
    `Phase 0 baseline mismatch for ${entry.id}.`);
    assert(entry.tier === legacy.tier && entry.acquisition === legacy.acquisition,
      `Source metadata differs from runtime for ${entry.id}.`);
    assert(entry.acquisition === 'normal' && entry.active === true,
      `The v1 normal-roll bootstrap unexpectedly includes non-normal/inactive title ${entry.id}.`);
    return {
      titleId: entry.id,
      displayName: entry.name,
      description: entry.description || '',
      tierId: entry.tier,
      acquisition: entry.acquisition,
      availability: entry.active ? 'obtainable' : 'inactive',
      active: Boolean(entry.active),
      baseWeight: weight.toString(),
      baseProbability: rational(weight.toString(), POOL.toString()),
      legacyOrdinal: Number.isSafeInteger(entry.sortOrder) ? entry.sortOrder : index,
      assetId: entry.assetId,
      presentationId: entry.presentationId || entry.tier
    };
  });
  assert(seen.size === baseline.rows.size, 'Runtime and baseline title ID sets differ.');
  assert(BigInt(POOL) === BigInt(baseline.headers.pool), 'Legacy pool denominator changed from Phase 0 baseline.');
  assert(sum(titles.map(title => title.baseProbability)).numerator === '1'
    && sum(titles.map(title => title.baseProbability)).denominator === '1', 'Exact legacy probabilities do not sum to one.');
  return { source, baseline, titles };
}

function makeSnapshot(titles) {
  const basicTitles = titles.filter(title => title.tierId === 'basic');
  const basicMass = sum(basicTitles.map(title => title.baseProbability));
  assert(compareRational(subtractRational(basicMass, RESERVE), FLOOR) >= 0,
    'Removing the full 5% reserve would violate the 92% Common Floor at neutral luck.');

  const exactFunding = basicTitles.map(title => ({
    titleId: title.titleId,
    probability: rational(
      BigInt(title.baseProbability.numerator) * BigInt(RESERVE.numerator) * BigInt(basicMass.denominator),
      BigInt(title.baseProbability.denominator) * BigInt(RESERVE.denominator) * BigInt(basicMass.numerator)
    )
  }));
  assert(equalRational(sum(exactFunding.map(item => item.probability)), RESERVE), 'Basic funding does not sum exactly to 5%.');

  const cohortByTier = TIERS.map(tier => {
    const roster = titles.filter(title => title.tierId === tier.id);
    const slots = roster.map(title => {
      const original = title.baseProbability;
      const reserveContribution = exactFunding.find(item => item.titleId === title.titleId)?.probability ?? q(0);
      return {
        titleId: title.titleId,
        probability: subtractRational(original, reserveContribution),
        acquisition: title.acquisition,
        state: 'obtainable'
      };
    });
    return {
      id: `catalog-v1-${tier.id}`,
      version: 1,
      poolId: NORMAL_POOL_ID,
      budget: sum(slots.map(slot => slot.probability)),
      budgetOrigin: 'legacy-catalog-v1',
      common: tier.id === 'basic',
      publication: 'published',
      rosterFrozen: true,
      slots
    };
  });
  const shares = exactFunding.map(item => ({
    titleId: item.titleId,
    share: rational(
      BigInt(item.probability.numerator) * BigInt(RESERVE.denominator),
      BigInt(item.probability.denominator) * BigInt(RESERVE.numerator)
    )
  }));
  assert(equalRational(sum(shares.map(item => item.share)), q(1)), 'Basic fallback shares do not sum exactly to one.');

  const snapshot = publishSnapshot(createSnapshot({
    schemaVersion: 1,
    snapshotId: SNAPSHOT_ID,
    version: 1,
    publication: 'draft',
    pools: [{ id: NORMAL_POOL_ID, kind: 'normal', version: 1, budget: q(1), budgetOrigin: 'legacy-catalog-v1', fallbackId: BASIC_FALLBACK_ID }],
    cohorts: cohortByTier,
    fallbacks: [{ id: BASIC_FALLBACK_ID, poolId: NORMAL_POOL_ID, basis: 'fixed-basic-proportions', shares }],
    expansionBudget: {
      total: RESERVE,
      free: RESERVE,
      allocated: q(0),
      poolId: NORMAL_POOL_ID,
      fallbackId: BASIC_FALLBACK_ID,
      allocations: [],
      basicFunding: exactFunding
    },
    commonFloor: { atNeutral: FLOOR, commonMassAtNeutral: basicMass, allocatedToNonCommon: q(0) },
    escrow: []
  }));
  return { snapshot, basicMass, exactFunding };
}

function makePlan(snapshot) {
  return publishRollPlan(createRollPlan({
    planId: PLAN_ID,
    version: 1,
    snapshot,
    publication: 'draft',
    components: [{ componentId: 'normal-v1', poolId: NORMAL_POOL_ID, mass: q(1), origin: 'normal-roll-space-v1' }]
  }), snapshot);
}

function resolveNeutralExactly({ titles, snapshot }) {
  const rows = [];
  const metadata = new Map(titles.map(item => [item.titleId, item]));
  const slotLocation = new Map();
  for (const cohort of snapshot.cohorts) for (const slot of cohort.slots) slotLocation.set(slot.titleId, { cohortId: cohort.id, slot });
  const reserveByTitle = new Map(snapshot.expansionBudget.basicFunding.map(item => [item.titleId, item.probability]));
  const basicShares = new Map(snapshot.fallbacks.find(item => item.id === BASIC_FALLBACK_ID).shares.map(item => [item.titleId, item.share]));

  for (const title of titles) {
    const location = slotLocation.get(title.titleId);
    assert(location, `No canonical Pool 2.0 slot for ${title.titleId}.`);
    const beforeFallback = location.slot.probability;
    const fallbackMass = multiplyRational(snapshot.expansionBudget.free, basicShares.get(title.titleId) ?? q(0));
    const observable = addRational(beforeFallback, fallbackMass);
    const difference = subtractRational(observable, title.baseProbability);
    rows.push({
      titleId: title.titleId,
      tierId: title.tierId,
      legacyWeight: title.baseWeight,
      legacyProbability: title.baseProbability,
      poolId: NORMAL_POOL_ID,
      cohortId: location.cohortId,
      slotId: title.titleId,
      poolBeforeFallback: beforeFallback,
      fallbackContribution: fallbackMass,
      observableProbability: observable,
      exactDifference: difference,
      status: equalRational(observable, title.baseProbability) ? 'PASS' : 'FAIL',
      reserveFundingFromThisBasic: reserveByTitle.get(title.titleId) ?? q(0)
    });
  }
  return rows;
}

function compareDyadicRational(dyadic, fraction) {
  const significand = BigInt(dyadic.significand);
  const exponent = BigInt(dyadic.binaryExponent);
  const numerator = BigInt(fraction.numerator);
  const denominator = BigInt(fraction.denominator);
  if (exponent >= 0n) {
    const left = (significand << exponent) * denominator;
    return left < numerator ? -1 : left > numerator ? 1 : 0;
  }
  const left = significand * denominator;
  const right = numerator << -exponent;
  return left < right ? -1 : left > right ? 1 : 0;
}

async function validateMpfrIntervals(snapshot, rows) {
  const backend = await createProductionIntervalBackend({ allowUncertified: false });
  try {
    assert(backend.metadata.certified && backend.metadata.manifestRuntimeHashMatches,
      'Production interval backend is not certified; canonical validation cannot proceed.');
    const transformed = await backend.transformSnapshot({
      snapshot,
      channels: { coreLuck: '1', buildLuck: '1', temporaryLuck: '1' },
      mode: 'auto',
      precisionBits: 128,
      poolIds: [NORMAL_POOL_ID]
    });
    const pool = transformed.pools.find(item => item.poolId === NORMAL_POOL_ID);
    assert(pool && pool.entries.length === rows.length, 'MPFR transformed pool does not contain exactly the catalog title set.');
    const entries = new Map(pool.entries.map(item => [item.titleId, item.probability]));
    for (const row of rows) {
      const interval = entries.get(row.titleId);
      assert(interval, `MPFR output omitted ${row.titleId}.`);
      assert(compareDyadicRational(interval.lower, row.observableProbability) <= 0
        && compareDyadicRational(interval.upper, row.observableProbability) >= 0,
      `Certified MPFR interval does not enclose exact neutral probability for ${row.titleId}.`);
    }
    return {
      backendId: backend.metadata.backendId,
      backendVersion: backend.metadata.backendVersion,
      runtimeSha256: backend.metadata.runtimeSha256,
      precisionBits: transformed.precisionBits,
      certified: backend.metadata.certified,
      intervalsEncloseAll200ExactProbabilities: true
    };
  } finally {
    backend.clearCache();
  }
}

function makeArtifact({ source, titles, snapshot, plan, basicMass, auditRows, backendInfo }) {
  const tiers = TIERS.map(tier => {
    const rows = auditRows.filter(row => row.tierId === tier.id);
    const legacyMass = sum(rows.map(row => row.legacyProbability));
    const observableMass = sum(rows.map(row => row.observableProbability));
    return {
      tierId: tier.id,
      label: tier.label,
      titleCount: rows.length,
      legacyMass,
      pool2ObservableMass: observableMass,
      exactDifference: subtractRational(observableMass, legacyMass),
      status: equalRational(legacyMass, observableMass) && rows.every(row => row.status === 'PASS') ? 'PASS' : 'FAIL'
    };
  });
  const snapshotHash = hashSnapshot(snapshot);
  const rollPlanHash = sha256(stableJson(plan));
  const mathCatalog = titles.map(title => {
    const row = auditRows.find(item => item.titleId === title.titleId);
    return {
      titleId: title.titleId,
      tierId: title.tierId,
      acquisition: title.acquisition,
      availability: title.availability,
      active: title.active,
      legacyOrdinal: title.legacyOrdinal,
      baseWeight: title.baseWeight,
      baseProbability: title.baseProbability,
      poolId: row.poolId,
      cohortId: row.cohortId,
      slotId: row.slotId
    };
  });
  const mathCatalogHash = sha256(stableJson(mathCatalog));
  const mathIdentity = {
    catalogVersion: CATALOG_VERSION,
    mathCatalogHash,
    snapshotId: snapshot.snapshotId,
    snapshotVersion: snapshot.version,
    snapshotHash,
    rollPlanId: plan.planId,
    rollPlanVersion: plan.version,
    rollPlanHash,
    formulaVersion: FORMULA_VERSION,
    manualPowerVersion: MANUAL_POWER_VERSION,
    samplerVersion: SAMPLER_VERSION,
    backendId: backendInfo.backendId,
    backendVersion: backendInfo.backendVersion,
    backendRuntimeSha256: backendInfo.runtimeSha256
  };
  const mathIdentityHash = sha256(stableJson(mathIdentity));
  const presentation = titles.map(title => ({
    titleId: title.titleId,
    displayName: title.displayName,
    description: title.description,
    tierLabel: TIERS.find(tier => tier.id === title.tierId).label,
    assetId: title.assetId,
    presentationId: title.presentationId
  }));
  const presentationHash = sha256(stableJson(presentation));
  const artifact = {
    artifactType: 'ntc-pool2-canonical-catalog',
    schemaVersion: 1,
    catalogVersion: CATALOG_VERSION,
    source: {
      legacyBaselineDate: source.baseline.headers.baselineDate,
      legacyBaselineCanonicalSha256: source.baseline.headers.canonicalSha256,
      legacyPoolDenominator: String(POOL),
      expectedCurrentTitleCount: BOOTSTRAP_EXPECTED_COUNT
    },
    mathIdentity,
    mathIdentityHash,
    presentationHash,
    titles: titles.map(title => {
      const row = auditRows.find(item => item.titleId === title.titleId);
      return {
        titleId: title.titleId,
        displayName: title.displayName,
        description: title.description,
        tierId: title.tierId,
        acquisition: title.acquisition,
        availability: title.availability,
        active: title.active,
        legacyOrdinal: title.legacyOrdinal,
        baseWeight: title.baseWeight,
        baseProbability: title.baseProbability,
        poolId: row.poolId,
        cohortId: row.cohortId,
        slotId: row.slotId,
        assetId: title.assetId,
        presentationId: title.presentationId
      };
    }),
    snapshot,
    rollPlan: plan,
    expansionReserve: {
      total: RESERVE,
      free: snapshot.expansionBudget.free,
      allocated: snapshot.expansionBudget.allocated,
      sourceCommonMassAtNeutral: basicMass,
      basicMassInFrozenCohortAfterCarve: subtractRational(basicMass, RESERVE),
      basicMassObservableAfterFallback: basicMass,
      commonFloorAtNeutral: FLOOR,
      fallbackId: BASIC_FALLBACK_ID,
      createsNoResultProbability: false,
      behavior: 'free reserve is resolved to Basic titles by their frozen base proportions; no empty/no-result region exists'
    }
  };
  const body = stableJson(artifact);
  artifact.artifactSha256 = sha256(body);
  const audit = {
    reportType: 'ntc-pool2-neutral-equivalence-audit',
    schemaVersion: 1,
    mode: 'auto',
    luck: { coreLuck: '1', buildLuck: '1', temporaryLuck: '1' },
    eventPoolsIncluded: false,
    modifiersIncluded: false,
    artifactSha256: artifact.artifactSha256,
    mathIdentityHash,
    reserveAccounting: {
      reserveTotal: RESERVE,
      reserveFree: snapshot.expansionBudget.free,
      reserveAllocated: snapshot.expansionBudget.allocated,
      reserveResolvingToBasicFallback: snapshot.expansionBudget.free,
      basicMassBeforeCarve: basicMass,
      basicMassInFrozenCohortAfterCarve: subtractRational(basicMass, RESERVE),
      basicMassObservableAfterFallback: basicMass,
      fallbackId: BASIC_FALLBACK_ID,
      fallbackSharesPreserveFundingProportions: true,
      createsNoResultProbability: false
    },
    titleCount: auditRows.length,
    equivalentTitleCount: auditRows.filter(row => row.status === 'PASS').length,
    failedTitleCount: auditRows.filter(row => row.status !== 'PASS').length,
    exactPerTitleEquivalence: auditRows.every(row => row.status === 'PASS'),
    tiers,
    mpfrIntervalValidation: backendInfo,
    titles: auditRows.map(row => ({
      titleId: row.titleId,
      tierId: row.tierId,
      legacyWeight: row.legacyWeight,
      legacyProbability: row.legacyProbability,
      poolId: row.poolId,
      cohortId: row.cohortId,
      slotId: row.slotId,
      pool2ProbabilityBeforeFallback: row.poolBeforeFallback,
      fallbackContribution: row.fallbackContribution,
      pool2ObservableProbability: row.observableProbability,
      exactDifference: row.exactDifference,
      status: row.status
    }))
  };
  return { artifact, audit };
}

async function main() {
  const { baseline, titles } = canonicalTitleInputs();
  const { snapshot, basicMass } = makeSnapshot(titles);
  const plan = makePlan(snapshot);
  const rows = resolveNeutralExactly({ titles, snapshot });
  assert(rows.length === BOOTSTRAP_EXPECTED_COUNT, 'Equivalence audit must cover all 200 titles.');
  assert(rows.every(row => row.status === 'PASS'), `Exact neutral equivalence failed for ${rows.filter(row => row.status !== 'PASS').map(row => row.titleId).join(', ')}.`);
  const tierTotals = TIERS.map(tier => {
    const tierRows = rows.filter(row => row.tierId === tier.id);
    assert(equalRational(sum(tierRows.map(row => row.legacyProbability)), sum(tierRows.map(row => row.observableProbability))), `Tier ${tier.id} differs at neutral luck.`);
    return { tierId: tier.id, titles: tierRows.length };
  });
  const backendInfo = await validateMpfrIntervals(snapshot, rows);
  const { artifact, audit } = makeArtifact({ source: { baseline }, titles, snapshot, plan, basicMass, auditRows: rows, backendInfo });
  const artifactBytes = `${JSON.stringify(artifact, null, 2)}\n`;
  const auditBytes = `${JSON.stringify(audit, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    assert(fs.existsSync(ARTIFACT_PATH) && fs.readFileSync(ARTIFACT_PATH, 'utf8') === artifactBytes, 'Canonical Pool 2.0 catalog artifact is stale.');
    assert(fs.existsSync(AUDIT_PATH) && fs.readFileSync(AUDIT_PATH, 'utf8') === auditBytes, 'Phase 4 equivalence audit artifact is stale.');
    process.stdout.write(`PASS deterministic Pool 2.0 artifacts · ${rows.length}/200 equivalent · tiers ${tierTotals.length}/10 · ${artifact.artifactSha256}\n`);
    return;
  }
  fs.writeFileSync(ARTIFACT_PATH, artifactBytes, 'utf8');
  fs.writeFileSync(AUDIT_PATH, auditBytes, 'utf8');
  process.stdout.write(`Materialized canonical Pool 2.0 catalog v1 and audit: ${rows.length}/200 titles equivalent; ${tierTotals.length}/10 tiers equivalent.\n`);
  process.stdout.write(`snapshot=${hashSnapshot(snapshot)}\nrollPlan=${artifact.mathIdentity.rollPlanHash}\nmathIdentity=${artifact.mathIdentityHash}\nartifact=${artifact.artifactSha256}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
