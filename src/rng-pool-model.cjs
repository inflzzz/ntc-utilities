'use strict';

const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const RATIONAL_INTEGER = /^-?(?:0|[1-9]\d*)$/;

function parseInteger(value, label = 'integer') {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || !RATIONAL_INTEGER.test(value)) {
    throw new TypeError(`${label} must be a BigInt or canonical integer string.`);
  }
  return BigInt(value);
}

function gcd(a, b) {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function rational(numerator, denominator = '1') {
  let n = parseInteger(numerator, 'numerator');
  let d = parseInteger(denominator, 'denominator');
  if (d === 0n) throw new RangeError('Rational denominator cannot be zero.');
  if (d < 0n) { n = -n; d = -d; }
  const divisor = gcd(n, d);
  return Object.freeze({ numerator: (n / divisor).toString(), denominator: (d / divisor).toString() });
}

function assertRational(value, label = 'rational') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a rational object.`);
  const normalized = rational(value.numerator, value.denominator);
  if (normalized.numerator !== value.numerator || normalized.denominator !== value.denominator) {
    throw new TypeError(`${label} must use canonical reduced numerator/denominator strings.`);
  }
  return normalized;
}

function parts(value) {
  const checked = assertRational(value);
  return [BigInt(checked.numerator), BigInt(checked.denominator)];
}

function addRational(a, b) {
  const [an, ad] = parts(a); const [bn, bd] = parts(b);
  return rational(an * bd + bn * ad, ad * bd);
}

function subtractRational(a, b) {
  const [an, ad] = parts(a); const [bn, bd] = parts(b);
  return rational(an * bd - bn * ad, ad * bd);
}

function multiplyRational(a, b) {
  const [an, ad] = parts(a); const [bn, bd] = parts(b);
  return rational(an * bn, ad * bd);
}

function compareRational(a, b) {
  const [an, ad] = parts(a); const [bn, bd] = parts(b);
  const difference = an * bd - bn * ad;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function equalRational(a, b) { return compareRational(a, b) === 0; }
function isNegative(value) { return BigInt(assertRational(value).numerator) < 0n; }

function serializeRational(value) {
  const checked = assertRational(value);
  return JSON.stringify({ numerator: checked.numerator, denominator: checked.denominator });
}

function parseRational(serialized) {
  if (typeof serialized !== 'string') throw new TypeError('Serialized rational must be a string.');
  const parsed = JSON.parse(serialized);
  return assertRational(parsed, 'serialized rational');
}

function requireId(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty stable ID.`);
  return value;
}

function requireVersion(value, label = 'version') {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
  return value;
}

function nonNegativeRational(value, label) {
  const checked = assertRational(value, label);
  if (isNegative(checked)) throw new RangeError(`${label} cannot be negative.`);
  return checked;
}

function sumRationals(values) {
  return values.reduce((sum, value) => addRational(sum, value), rational('0'));
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = deepClone(item);
    return result;
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('Canonical snapshot data only permits safe integer numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') throw new TypeError('Snapshot contains a non-serializable value.');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`Snapshot contains undefined at ${key}.`);
    result[key] = canonicalValue(value[key]);
  }
  return result;
}

function canonicalizeSnapshot(snapshot) {
  return JSON.stringify(canonicalValue(snapshot));
}

function hashSnapshot(snapshot) {
  return crypto.createHash('sha256').update(canonicalizeSnapshot(snapshot), 'utf8').digest('hex');
}

function normalizeBudget(budget, label = 'budget') {
  if (!budget || typeof budget !== 'object') throw new TypeError(`${label} is required.`);
  const total = nonNegativeRational(budget.total, `${label}.total`);
  const free = nonNegativeRational(budget.free, `${label}.free`);
  const allocated = nonNegativeRational(budget.allocated, `${label}.allocated`);
  if (!equalRational(addRational(free, allocated), total)) throw new RangeError(`${label} must satisfy free + allocated = total exactly.`);
  return { total, free, allocated };
}

function normalizeSlot(slot, cohortId, poolId) {
  if (!slot || typeof slot !== 'object') throw new TypeError('Each cohort slot must be an object.');
  const titleId = requireId(slot.titleId, 'titleId');
  const state = slot.state ?? 'obtainable';
  const acquisition = slot.acquisition ?? 'normal';
  if (!['obtainable', 'unobtainable'].includes(state)) throw new TypeError(`Invalid acquisition state for ${titleId}.`);
  if (!['normal', 'exclusive', 'limited', 'event', 'legacy'].includes(acquisition)) throw new TypeError(`Invalid acquisition kind for ${titleId}.`);
  return {
    titleId,
    cohortId,
    poolId,
    probability: nonNegativeRational(slot.probability, `slot ${titleId} probability`),
    acquisition,
    state
  };
}

function normalizeCohort(cohort) {
  if (!cohort || typeof cohort !== 'object') throw new TypeError('Each cohort must be an object.');
  const id = requireId(cohort.id, 'cohort ID');
  const poolId = requireId(cohort.poolId, `pool ID for cohort ${id}`);
  const version = requireVersion(cohort.version, `cohort ${id} version`);
  const publication = cohort.publication ?? 'draft';
  if (!['draft', 'published'].includes(publication)) throw new TypeError(`Invalid publication state for cohort ${id}.`);
  const budget = nonNegativeRational(cohort.budget, `cohort ${id} budget`);
  const slots = (cohort.slots ?? []).map(slot => normalizeSlot(slot, id, poolId));
  if (!slots.length) throw new RangeError(`Cohort ${id} must have at least one slot.`);
  if (!equalRational(sumRationals(slots.map(slot => slot.probability)), budget)) {
    throw new RangeError(`Cohort ${id} slot probabilities must sum to its budget.`);
  }
  return {
    id,
    version,
    poolId,
    budget,
    budgetOrigin: requireId(cohort.budgetOrigin, `budget origin for cohort ${id}`),
    common: Boolean(cohort.common),
    publication,
    rosterFrozen: publication === 'published' || Boolean(cohort.rosterFrozen),
    slots
  };
}

function normalizeFallback(fallback) {
  if (!fallback || typeof fallback !== 'object') throw new TypeError('A fallback resolver is required.');
  const id = requireId(fallback.id, 'fallback ID');
  const poolId = requireId(fallback.poolId, `pool ID for fallback ${id}`);
  const basis = fallback.basis ?? 'fixed-basic-proportions';
  if (!['fixed-basic-proportions', 'pool-local-proportions'].includes(basis)) throw new TypeError(`Invalid fallback basis for ${id}.`);
  const shares = (fallback.shares ?? []).map(entry => ({
    titleId: requireId(entry.titleId, `fallback title ID in ${id}`),
    share: nonNegativeRational(entry.share, `fallback share in ${id}`)
  }));
  if (!shares.length || new Set(shares.map(entry => entry.titleId)).size !== shares.length) throw new RangeError(`Fallback ${id} needs a non-empty unique roster.`);
  if (!equalRational(sumRationals(shares.map(entry => entry.share)), rational('1'))) throw new RangeError(`Fallback ${id} shares must sum to exactly 1.`);
  return { id, poolId, basis, shares };
}

function normalizePool(pool) {
  if (!pool || typeof pool !== 'object') throw new TypeError('Each pool must be an object.');
  const id = requireId(pool.id, 'pool ID');
  const kind = pool.kind ?? 'normal';
  if (!['normal', 'event'].includes(kind)) throw new TypeError(`Invalid pool kind for ${id}.`);
  return {
    id,
    kind,
    version: requireVersion(pool.version, `pool ${id} version`),
    budget: nonNegativeRational(pool.budget, `pool ${id} budget`),
    budgetOrigin: requireId(pool.budgetOrigin, `budget origin for pool ${id}`),
    state: pool.state ?? 'active',
    fallbackId: requireId(pool.fallbackId, `fallback ID for pool ${id}`)
  };
}

function validateSnapshotShape(snapshot) {
  requireId(snapshot.snapshotId, 'snapshot ID');
  requireVersion(snapshot.version, 'snapshot version');
  if (!['draft', 'published'].includes(snapshot.publication)) throw new TypeError('Invalid snapshot publication state.');
  if (snapshot.schemaVersion !== SCHEMA_VERSION) throw new RangeError(`Unsupported pool snapshot schema ${snapshot.schemaVersion}.`);

  const pools = snapshot.pools;
  const cohorts = snapshot.cohorts;
  const fallbacks = snapshot.fallbacks;
  const poolById = new Map(pools.map(pool => [pool.id, pool]));
  const cohortById = new Map(cohorts.map(cohort => [cohort.id, cohort]));
  const fallbackById = new Map(fallbacks.map(fallback => [fallback.id, fallback]));
  if (poolById.size !== pools.length) throw new RangeError('Duplicate pool IDs are not allowed.');
  if (cohortById.size !== cohorts.length) throw new RangeError('Duplicate cohort IDs are not allowed.');
  if (fallbackById.size !== fallbacks.length) throw new RangeError('Duplicate fallback IDs are not allowed.');
  const titleIds = cohorts.flatMap(cohort => cohort.slots.map(slot => slot.titleId));
  if (new Set(titleIds).size !== titleIds.length) throw new RangeError('Duplicate title IDs across pools/cohorts are not allowed.');

  for (const pool of pools) {
    if (!fallbackById.has(pool.fallbackId)) throw new RangeError(`Pool ${pool.id} references missing fallback ${pool.fallbackId}.`);
    const poolCohorts = cohorts.filter(cohort => cohort.poolId === pool.id);
    const unallocatedFallback = pool.id === snapshot.expansionBudget.poolId ? snapshot.expansionBudget.free : rational('0');
    const poolBudget = addRational(sumRationals(poolCohorts.map(cohort => cohort.budget)), unallocatedFallback);
    if (!equalRational(poolBudget, pool.budget)) throw new RangeError(`Cohorts in pool ${pool.id} must sum to its budget.`);
    if (fallbackById.get(pool.fallbackId).poolId !== pool.id) throw new RangeError(`Fallback ${pool.fallbackId} belongs to a different pool.`);
  }
  for (const cohort of cohorts) {
    if (!poolById.has(cohort.poolId)) throw new RangeError(`Cohort ${cohort.id} references missing pool ${cohort.poolId}.`);
    if (cohort.publication === 'published' && !cohort.rosterFrozen) throw new RangeError(`Published cohort ${cohort.id} must freeze its roster.`);
  }

  const reserve = snapshot.expansionBudget;
  normalizeBudget(reserve, 'expansionBudget');
  if (!equalRational(sumRationals(reserve.basicFunding.map(entry => entry.probability)), reserve.total)) {
    throw new RangeError('Expansion reserve Basic funding must sum exactly to the total reserve.');
  }
  if (compareRational(reserve.total, rational('0')) <= 0) throw new RangeError('Expansion reserve total must be greater than zero.');
  if (new Set(reserve.basicFunding.map(entry => entry.titleId)).size !== reserve.basicFunding.length) throw new RangeError('Duplicate Basic reserve funding IDs are not allowed.');
  if (!fallbackById.has(reserve.fallbackId)) throw new RangeError(`Expansion reserve references missing fallback ${reserve.fallbackId}.`);
  if (fallbackById.get(reserve.fallbackId).poolId !== reserve.poolId) throw new RangeError('Expansion reserve fallback must belong to its source pool.');
  if (!poolById.has(reserve.poolId) || poolById.get(reserve.poolId).kind !== 'normal') throw new RangeError('Expansion reserve must be funded by a normal pool.');
  const allocationTotal = sumRationals(reserve.allocations.map(item => item.amount));
  if (!equalRational(allocationTotal, reserve.allocated)) throw new RangeError('Expansion allocation records must sum exactly to allocated budget.');
  const allocationCohorts = new Set();
  for (const allocation of reserve.allocations) {
    if (allocationCohorts.has(allocation.cohortId)) throw new RangeError(`Duplicate expansion allocation for cohort ${allocation.cohortId}.`);
    allocationCohorts.add(allocation.cohortId);
    const cohort = cohortById.get(allocation.cohortId);
    if (!cohort || cohort.poolId !== reserve.poolId || !equalRational(cohort.budget, allocation.amount)) throw new RangeError(`Expansion allocation does not match cohort ${allocation.cohortId}.`);
    if (allocation.destination !== (cohort.common ? 'common' : 'non-common')) throw new RangeError(`Expansion allocation destination mismatch for cohort ${allocation.cohortId}.`);
  }
  for (const cohort of cohorts) {
    if (cohort.budgetOrigin === 'expansion-reserve-v1' && !allocationCohorts.has(cohort.id)) throw new RangeError(`Expansion-funded cohort ${cohort.id} has no allocation record.`);
  }
  const sourceFallback = fallbackById.get(reserve.fallbackId);
  if (sourceFallback.shares.length !== reserve.basicFunding.length) throw new RangeError('Expansion reserve fallback roster must exactly match its frozen Basic funding roster.');
  for (const funding of reserve.basicFunding) {
    const share = sourceFallback.shares.find(entry => entry.titleId === funding.titleId);
    const sourceSlot = cohorts.flatMap(cohort => cohort.slots).find(slot => slot.titleId === funding.titleId);
    if (!sourceSlot || sourceSlot.poolId !== reserve.poolId || !cohortById.get(sourceSlot.cohortId)?.common) {
      throw new RangeError(`Expansion reserve source ${funding.titleId} must be a common slot in its source pool.`);
    }
    if (compareRational(funding.probability, sourceSlot.probability) > 0) throw new RangeError(`Expansion reserve exceeds the source mass of ${funding.titleId}.`);
    // Compare probability / total without any floating-point conversion.
    const [pn, pd] = parts(funding.probability);
    const [tn, td] = parts(reserve.total);
    const expectedShare = rational(pn * td, pd * tn);
    if (!share || !equalRational(share.share, expectedShare)) throw new RangeError(`Fallback share for ${funding.titleId} must preserve its frozen Basic funding proportion.`);
  }

  const floor = snapshot.commonFloor;
  nonNegativeRational(floor.atNeutral, 'commonFloor.atNeutral');
  nonNegativeRational(floor.commonMassAtNeutral, 'commonFloor.commonMassAtNeutral');
  nonNegativeRational(floor.allocatedToNonCommon, 'commonFloor.allocatedToNonCommon');
  if (compareRational(floor.atNeutral, rational('1')) > 0 || compareRational(floor.commonMassAtNeutral, rational('1')) > 0) throw new RangeError('Common Floor and common mass cannot exceed 1.');
  if (compareRational(floor.allocatedToNonCommon, floor.commonMassAtNeutral) > 0) throw new RangeError('Non-common allocation exceeds available common mass.');
  const remainingCommon = subtractRational(floor.commonMassAtNeutral, floor.allocatedToNonCommon);
  if (compareRational(remainingCommon, floor.atNeutral) < 0) throw new RangeError('Allocation violates the configured Common Floor at neutral luck.');

  const escrowByTitle = new Map();
  for (const item of snapshot.escrow) {
    requireId(item.titleId, 'escrow title ID');
    if (escrowByTitle.has(item.titleId)) throw new RangeError(`Duplicate escrow entry for ${item.titleId}.`);
    escrowByTitle.set(item.titleId, item);
    const cohort = cohortById.get(item.cohortId);
    if (!cohort || cohort.poolId !== item.poolId) throw new RangeError(`Escrow references missing cohort/pool for ${item.titleId}.`);
    const slot = cohort.slots.find(candidate => candidate.titleId === item.titleId);
    if (!slot || slot.state !== 'unobtainable' || !equalRational(slot.probability, item.amount)) throw new RangeError(`Escrow does not match the preserved slot for ${item.titleId}.`);
    if (!fallbackById.has(item.fallbackId) || fallbackById.get(item.fallbackId).poolId !== item.poolId) throw new RangeError(`Escrow fallback mismatch for ${item.titleId}.`);
  }
  for (const cohort of cohorts) for (const slot of cohort.slots) {
    if ((slot.state === 'unobtainable') !== escrowByTitle.has(slot.titleId)) throw new RangeError(`Slot/escrow lifecycle mismatch for ${slot.titleId}.`);
  }
  return snapshot;
}

function createSnapshot(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('Snapshot specification is required.');
  const pools = (spec.pools ?? []).map(normalizePool);
  const cohorts = (spec.cohorts ?? []).map(normalizeCohort);
  const fallbacks = (spec.fallbacks ?? []).map(normalizeFallback);
  const expansion = spec.expansionBudget;
  if (!expansion) throw new TypeError('Expansion/Common Budget is required.');
  const expansionBudget = {
    ...normalizeBudget(expansion, 'expansionBudget'),
    poolId: requireId(expansion.poolId, 'expansion budget source pool'),
    fallbackId: requireId(expansion.fallbackId, 'expansion budget fallback'),
    allocations: (expansion.allocations ?? []).map(item => ({
      cohortId: requireId(item.cohortId, 'allocated cohort ID'),
      amount: nonNegativeRational(item.amount, 'allocated amount'),
      destination: item.destination
    })),
    basicFunding: (expansion.basicFunding ?? []).map(entry => ({
      titleId: requireId(entry.titleId, 'Basic funding title ID'),
      probability: nonNegativeRational(entry.probability, `Basic funding probability for ${entry.titleId}`)
    }))
  };
  const floor = spec.commonFloor ?? {};
  const commonFloor = {
    atNeutral: nonNegativeRational(floor.atNeutral ?? rational('92', '100'), 'common floor'),
    commonMassAtNeutral: nonNegativeRational(floor.commonMassAtNeutral, 'common mass at neutral'),
    allocatedToNonCommon: nonNegativeRational(floor.allocatedToNonCommon ?? rational('0'), 'non-common allocation')
  };
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId: requireId(spec.snapshotId, 'snapshot ID'),
    version: requireVersion(spec.version, 'snapshot version'),
    publication: spec.publication ?? 'draft',
    pools,
    cohorts,
    fallbacks,
    expansionBudget,
    commonFloor,
    escrow: (spec.escrow ?? []).map(item => ({
      titleId: requireId(item.titleId, 'escrow title ID'),
      poolId: requireId(item.poolId, 'escrow pool ID'),
      cohortId: requireId(item.cohortId, 'escrow cohort ID'),
      amount: nonNegativeRational(item.amount, `escrow amount for ${item.titleId}`),
      fallbackId: requireId(item.fallbackId, `escrow fallback for ${item.titleId}`)
    }))
  };
  validateSnapshotShape(snapshot);
  return deepFreeze(snapshot);
}

function publishSnapshot(snapshot) {
  validateSnapshotShape(snapshot);
  if (snapshot.publication === 'published') return snapshot;
  return createSnapshot({ ...deepClone(snapshot), publication: 'published', cohorts: snapshot.cohorts.map(cohort => ({ ...deepClone(cohort), publication: 'published', rosterFrozen: true })) });
}

function forkSnapshot(snapshot, { snapshotId, version } = {}) {
  validateSnapshotShape(snapshot);
  if (snapshot.publication !== 'published') throw new Error('Only a published snapshot can be forked into a new version.');
  return createSnapshot({ ...deepClone(snapshot), snapshotId: requireId(snapshotId, 'new snapshot ID'), version: requireVersion(version, 'new snapshot version'), publication: 'draft' });
}

function assertDraft(snapshot) {
  validateSnapshotShape(snapshot);
  if (snapshot.publication !== 'draft') throw new Error('Published snapshots are immutable; fork a new snapshot version first.');
}

function appendCohort(snapshot, cohortSpec) {
  assertDraft(snapshot);
  if ((cohortSpec.publication ?? 'draft') === 'published') throw new Error('A new cohort must be drafted in a new snapshot before publication.');
  if (snapshot.cohorts.some(cohort => cohort.id === cohortSpec.id)) throw new RangeError(`Cohort ${cohortSpec.id} already exists; published rosters cannot be extended.`);
  const pool = snapshot.pools.find(item => item.id === cohortSpec.poolId);
  if (!pool) throw new RangeError(`Unknown pool ${cohortSpec.poolId}.`);
  if (pool.kind === 'normal') return allocateExpansionBudget(snapshot, cohortSpec);
  throw new Error('Event cohort publication requires a separately budgeted event-pool snapshot.');
}

function appendSlotToCohort(snapshot, cohortId) {
  assertDraft(snapshot);
  const cohort = snapshot.cohorts.find(item => item.id === cohortId);
  if (!cohort) throw new RangeError(`Unknown cohort ${cohortId}.`);
  if (cohort.rosterFrozen || cohort.publication === 'published') {
    throw new Error(`Published cohort ${cohortId} has a frozen roster; add content through a new cohort and snapshot.`);
  }
  throw new Error('Direct slot insertion is disabled; create a new cohort with an explicit budget.');
}

function allocateExpansionBudget(snapshot, cohortSpec) {
  assertDraft(snapshot);
  const cohort = normalizeCohort(cohortSpec);
  if (cohort.budgetOrigin !== 'expansion-reserve-v1') throw new TypeError('Expansion-funded cohorts must declare budgetOrigin "expansion-reserve-v1".');
  const amount = cohort.budget;
  if (compareRational(amount, snapshot.expansionBudget.free) > 0) throw new RangeError('Expansion allocation exceeds free budget.');
  const free = subtractRational(snapshot.expansionBudget.free, amount);
  const allocated = addRational(snapshot.expansionBudget.allocated, amount);
  const allocations = [...snapshot.expansionBudget.allocations.map(deepClone), {
    cohortId: cohort.id,
    amount,
    destination: cohort.common ? 'common' : 'non-common'
  }];
  const commonFloor = { ...deepClone(snapshot.commonFloor) };
  if (!cohort.common) commonFloor.allocatedToNonCommon = addRational(commonFloor.allocatedToNonCommon, amount);
  return createSnapshot({
    ...deepClone(snapshot),
    cohorts: [...snapshot.cohorts.map(deepClone), deepClone(cohortSpec)],
    expansionBudget: { ...deepClone(snapshot.expansionBudget), free, allocated, allocations },
    commonFloor
  });
}

function setTitleObtainability(snapshot, titleId, state) {
  assertDraft(snapshot);
  requireId(titleId, 'title ID');
  if (!['obtainable', 'unobtainable'].includes(state)) throw new TypeError('Invalid title lifecycle state.');
  const cohort = snapshot.cohorts.find(item => item.slots.some(slot => slot.titleId === titleId));
  if (!cohort) throw new RangeError(`Unknown title ID ${titleId}.`);
  if (!cohort.rosterFrozen) throw new Error(`Cohort ${cohort.id} must be published before lifecycle changes are recorded.`);
  const slot = cohort.slots.find(item => item.titleId === titleId);
  if (slot.state === state) return snapshot;
  const escrow = snapshot.escrow.filter(item => item.titleId !== titleId).map(deepClone);
  if (state === 'unobtainable') escrow.push({ titleId, poolId: cohort.poolId, cohortId: cohort.id, amount: slot.probability, fallbackId: snapshot.pools.find(pool => pool.id === cohort.poolId).fallbackId });
  const cohorts = snapshot.cohorts.map(item => item.id !== cohort.id ? deepClone(item) : {
    ...deepClone(item),
    version: item.version + 1,
    slots: item.slots.map(candidate => candidate.titleId === titleId ? { ...deepClone(candidate), state } : deepClone(candidate))
  });
  return createSnapshot({ ...deepClone(snapshot), cohorts, escrow });
}

function configuredSlotProbability(snapshot, titleId) {
  const slot = snapshot.cohorts.flatMap(cohort => cohort.slots).find(item => item.titleId === titleId);
  if (!slot) throw new RangeError(`Unknown title ID ${titleId}.`);
  return slot.probability;
}

function effectiveSlotProbability(snapshot, titleId) {
  const slot = snapshot.cohorts.flatMap(cohort => cohort.slots).find(item => item.titleId === titleId);
  if (!slot) throw new RangeError(`Unknown title ID ${titleId}.`);
  return slot.state === 'obtainable' ? slot.probability : rational('0');
}

function resolveFallback(snapshot, fallbackId, mass) {
  const fallback = snapshot.fallbacks.find(item => item.id === fallbackId);
  if (!fallback) throw new RangeError(`Unknown fallback ${fallbackId}.`);
  const amount = nonNegativeRational(mass, 'fallback mass');
  return fallback.shares.map(entry => ({ titleId: entry.titleId, probability: multiplyRational(amount, entry.share) }));
}

function resolveExpansionReserve(snapshot) {
  return resolveFallback(snapshot, snapshot.expansionBudget.fallbackId, snapshot.expansionBudget.free);
}

function resolveEscrow(snapshot, titleId) {
  const escrow = snapshot.escrow.find(item => item.titleId === titleId);
  if (!escrow) return [];
  return resolveFallback(snapshot, escrow.fallbackId, escrow.amount);
}

module.exports = {
  SCHEMA_VERSION,
  rational,
  addRational,
  subtractRational,
  multiplyRational,
  compareRational,
  equalRational,
  serializeRational,
  parseRational,
  createSnapshot,
  publishSnapshot,
  forkSnapshot,
  appendCohort,
  appendSlotToCohort,
  allocateExpansionBudget,
  setTitleObtainability,
  configuredSlotProbability,
  effectiveSlotProbability,
  resolveFallback,
  resolveExpansionReserve,
  resolveEscrow,
  canonicalizeSnapshot,
  hashSnapshot
};
