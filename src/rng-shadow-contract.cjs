'use strict';

// Pure, ephemeral contract for a future comparison harness. It deliberately
// has no persistence, IPC, game-state, reward, or legacy-RNG dependencies.
const REQUIRED_IDENTITY = Object.freeze([
  'catalogVersion', 'snapshotId', 'snapshotVersion', 'snapshotHash',
  'rollPlanId', 'rollPlanVersion', 'rollPlanHash', 'formulaVersion',
  'manualPowerVersion', 'samplerVersion', 'backendId', 'backendVersion',
  'backendRuntimeSha256'
]);

function stableId(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty stable ID.`);
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function createShadowComparison({ legacyOutcome, discardedShadowOutcome, mathIdentity } = {}) {
  stableId(legacyOutcome, 'legacy outcome');
  stableId(discardedShadowOutcome, 'discarded shadow outcome');
  if (!mathIdentity || typeof mathIdentity !== 'object' || Array.isArray(mathIdentity)) {
    throw new TypeError('A versioned math identity is required for shadow comparison.');
  }
  for (const key of REQUIRED_IDENTITY) {
    if (mathIdentity[key] == null || mathIdentity[key] === '') throw new TypeError(`Shadow math identity is missing ${key}.`);
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: 'ephemeral-shadow-comparison',
    legacyOutcome,
    discardedShadowOutcome,
    matched: legacyOutcome === discardedShadowOutcome,
    mathIdentity: Object.fromEntries(REQUIRED_IDENTITY.map(key => [key, mathIdentity[key]])),
    persistence: 'none',
    authority: 'legacy-only'
  });
}

module.exports = { createShadowComparison };
