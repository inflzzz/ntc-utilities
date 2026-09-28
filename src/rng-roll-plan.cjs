'use strict';

// An immutable, exact partition of the global roll probability space.
// A plan pins the complete published pool snapshot; participation is never
// inferred from the mere presence or state of another pool.
const {
  rational,
  addRational,
  compareRational,
  equalRational,
  createSnapshot,
  hashSnapshot
} = require('./rng-pool-model.cjs');

const ROLL_PLAN_SCHEMA_VERSION = 1;
const INTEGER = /^(?:0|[1-9]\d*)$/;

function requireId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty stable ID.`);
  return value;
}

function requireVersion(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
  return value;
}

function normalizeRational(value, label) {
  if (!value || typeof value !== 'object' || !INTEGER.test(value.numerator) || !INTEGER.test(value.denominator)) {
    throw new TypeError(`${label} must use canonical non-negative rational integer strings.`);
  }
  const normalized = rational(value.numerator, value.denominator);
  if (normalized.numerator !== value.numerator || normalized.denominator !== value.denominator) {
    throw new TypeError(`${label} must be a reduced canonical rational.`);
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function makeRollPlan({ planId, version, snapshot, publication = 'draft', components } = {}) {
  if (!snapshot) throw new TypeError('A published pool snapshot is required.');
  const pinnedSnapshot = createSnapshot(snapshot);
  if (pinnedSnapshot.publication !== 'published' || pinnedSnapshot.cohorts.some(cohort => cohort.publication !== 'published' || !cohort.rosterFrozen)) {
    throw new Error('Roll Plans require a published snapshot with frozen cohort rosters.');
  }
  if (!['draft', 'published'].includes(publication)) throw new TypeError('Roll Plan publication must be draft or published.');
  if (!Array.isArray(components) || components.length === 0) throw new TypeError('A Roll Plan requires at least one component.');

  const seen = new Set();
  const normalizedComponents = components.map((component, index) => {
    if (!component || typeof component !== 'object') throw new TypeError(`Roll Plan component ${index} must be an object.`);
    const componentId = requireId(component.componentId, `component ${index} ID`);
    if (seen.has(componentId)) throw new RangeError(`Duplicate Roll Plan component ID ${componentId}.`);
    seen.add(componentId);
    const poolId = requireId(component.poolId, `pool ID for component ${componentId}`);
    const pool = pinnedSnapshot.pools.find(item => item.id === poolId);
    if (!pool) throw new RangeError(`Roll Plan component ${componentId} references unknown pool ${poolId}.`);
    if (pool.state !== 'active') throw new RangeError(`Roll Plan component ${componentId} references a pool that is not active.`);
    if (compareRational(pool.budget, rational('0')) <= 0) throw new RangeError(`Roll Plan component ${componentId} references a pool with no internal probability mass.`);
    const mass = normalizeRational(component.mass, `mass for component ${componentId}`);
    if (compareRational(mass, rational('0')) <= 0) throw new RangeError(`Roll Plan component ${componentId} must have positive mass.`);
    return {
      componentId,
      poolId,
      poolKind: pool.kind,
      poolVersion: pool.version,
      mass,
      origin: requireId(component.origin, `mass origin for component ${componentId}`)
    };
  });

  const totalMass = normalizedComponents.reduce((sum, component) => addRational(sum, component.mass), rational('0'));
  if (!equalRational(totalMass, rational('1'))) {
    throw new RangeError(`Roll Plan component masses must sum exactly to 1; received ${totalMass.numerator}/${totalMass.denominator}.`);
  }

  return deepFreeze({
    schemaVersion: ROLL_PLAN_SCHEMA_VERSION,
    planId: requireId(planId, 'Roll Plan ID'),
    version: requireVersion(version, 'Roll Plan version'),
    publication,
    snapshotId: pinnedSnapshot.snapshotId,
    snapshotVersion: pinnedSnapshot.version,
    snapshotHash: hashSnapshot(pinnedSnapshot),
    components: normalizedComponents
  });
}

function createRollPlan(spec) {
  return makeRollPlan(spec);
}

function publishRollPlan(plan, snapshot) {
  validateRollPlan(plan, snapshot, { requirePublished: false });
  return makeRollPlan({
    planId: plan.planId,
    version: plan.version,
    snapshot,
    publication: 'published',
    components: plan.components.map(component => ({
      componentId: component.componentId,
      poolId: component.poolId,
      mass: component.mass,
      origin: component.origin
    }))
  });
}

function validateRollPlan(plan, snapshot, { requirePublished = true } = {}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('Roll Plan is required.');
  const pinnedSnapshot = createSnapshot(snapshot);
  if (plan.schemaVersion !== ROLL_PLAN_SCHEMA_VERSION) throw new RangeError(`Unsupported Roll Plan schema ${plan.schemaVersion}.`);
  if (requirePublished && plan.publication !== 'published') throw new Error('Only published Roll Plans can be sampled.');
  if (!['draft', 'published'].includes(plan.publication)) throw new TypeError('Invalid Roll Plan publication state.');
  if (plan.snapshotId !== pinnedSnapshot.snapshotId || plan.snapshotVersion !== pinnedSnapshot.version
    || plan.snapshotHash !== hashSnapshot(pinnedSnapshot)) {
    throw new Error('Roll Plan does not pin this exact Pool Snapshot version/hash.');
  }
  const rebuilt = makeRollPlan({
    planId: plan.planId,
    version: plan.version,
    snapshot: pinnedSnapshot,
    publication: plan.publication,
    components: plan.components
  });
  if (JSON.stringify(rebuilt) !== JSON.stringify(plan)) throw new TypeError('Roll Plan is not canonical or has been modified.');
  return rebuilt;
}

module.exports = {
  ROLL_PLAN_SCHEMA_VERSION,
  createRollPlan,
  publishRollPlan,
  validateRollPlan
};
