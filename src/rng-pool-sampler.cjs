'use strict';

// Isolated Pool 2.0 sampler. This module intentionally has no dependency on
// main.cjs, the RNG router, game state, saves, rewards, UI, or Supabase.
const crypto = require('node:crypto');
const {
  rational,
  addRational,
  compareRational,
  equalRational,
  createSnapshot,
  hashSnapshot
} = require('./rng-pool-model.cjs');
const { validateRollPlan } = require('./rng-roll-plan.cjs');
const {
  BACKEND_ID,
  BACKEND_VERSION,
  FORMULA_VERSION,
  MANUAL_POWER_VERSION,
  MAX_PRECISION_BITS,
  compareDyadic,
  assertProductionProbabilityInterval
} = require('./rng-luck2-precision.cjs');

const SAMPLER_VERSION = 'pool2-interval-sampler-v1';
const PRECISION_SCHEDULE = Object.freeze([128, 256, 512, 1024, 2048, 4096, 8192, 16384]);
const ZERO_DYADIC = Object.freeze({ significand: '0', binaryExponent: '0' });
const ONE_RATIONAL = rational('1');

class SamplerDecisionError extends Error {
  constructor(reasonCode, message, audit = {}) {
    super(message);
    this.name = 'SamplerDecisionError';
    this.reasonCode = reasonCode;
    // Failure audit deliberately contains no selected title/result.
    this.audit = Object.freeze({ samplerVersion: SAMPLER_VERSION, outcome: null, reasonCode, ...audit });
  }
}

function compareInteger(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function compareDyadicToRational(value, target) {
  const significand = BigInt(value.significand);
  const exponent = BigInt(value.binaryExponent);
  const numerator = BigInt(target.numerator);
  const denominator = BigInt(target.denominator);
  if (exponent >= 0n) return compareInteger((significand << exponent) * denominator, numerator);
  return compareInteger(significand * denominator, numerator << -exponent);
}

function addDyadic(left, right) {
  const le = BigInt(left.binaryExponent);
  const re = BigInt(right.binaryExponent);
  const exponent = le < re ? le : re;
  const l = BigInt(left.significand) << (le - exponent);
  const r = BigInt(right.significand) << (re - exponent);
  return { significand: (l + r).toString(), binaryExponent: exponent.toString() };
}

function compareScaledPrefixToRational(prefixEndpoint, scale, boundary) {
  const left = {
    significand: (BigInt(prefixEndpoint.significand) * BigInt(scale.numerator) * BigInt(boundary.denominator)).toString(),
    binaryExponent: prefixEndpoint.binaryExponent
  };
  const right = rational(BigInt(boundary.numerator) * BigInt(scale.denominator), '1');
  return compareDyadicToRational(left, right);
}

function compareScaledPrefixToDyadic(prefixEndpoint, scale, boundary) {
  const left = {
    significand: (BigInt(prefixEndpoint.significand) * BigInt(scale.numerator)).toString(),
    binaryExponent: prefixEndpoint.binaryExponent
  };
  const right = {
    significand: (BigInt(boundary.significand) * BigInt(scale.denominator)).toString(),
    binaryExponent: boundary.binaryExponent
  };
  return compareDyadic(left, right);
}

function normalizeBytes(bytes, requested) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) || bytes.byteLength !== requested) {
    throw new TypeError(`Entropy source must return exactly ${requested} bytes.`);
  }
  return bytes;
}

function createCryptoEntropySource() {
  return Object.freeze({
    id: 'node-crypto.randomBytes-v1',
    nextBytes: count => crypto.randomBytes(count)
  });
}

class UniformBitPrefix {
  constructor(source) {
    this.source = source;
    this.prefix = 0n;
    this.bitCount = 0;
  }

  async ensure(bitCount) {
    if (!Number.isSafeInteger(bitCount) || bitCount < 1 || bitCount > MAX_PRECISION_BITS) {
      throw new RangeError('Entropy bit request is outside the sampler safety limit.');
    }
    while (this.bitCount < bitCount) {
      const neededBytes = Math.ceil((bitCount - this.bitCount) / 8);
      const raw = await this.source.nextBytes(neededBytes);
      const bytes = normalizeBytes(raw, neededBytes);
      for (const byte of bytes) this.prefix = (this.prefix << 8n) | BigInt(byte);
      this.bitCount += neededBytes * 8;
    }
    return this.interval();
  }

  interval() {
    if (this.bitCount === 0) throw new Error('Entropy prefix is empty.');
    return {
      lower: { significand: this.prefix.toString(), binaryExponent: String(-this.bitCount) },
      upper: { significand: (this.prefix + 1n).toString(), binaryExponent: String(-this.bitCount) },
      bits: this.bitCount
    };
  }
}

function exactPartitionCandidate(entries, massOf, totalMass, prefix) {
  let cumulative = rational('0');
  let previous = rational('0');
  const lower = prefix.lower;
  const upper = prefix.upper;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const mass = massOf(entry, index);
    if (compareRational(mass, rational('0')) <= 0) throw new RangeError('Sampler partition contains a non-positive component.');
    cumulative = addRational(cumulative, mass);
    const inLower = compareScaledPrefixToRational(lower, totalMass, previous) >= 0;
    const inUpper = compareScaledPrefixToRational(upper, totalMass, cumulative) <= 0;
    if (inLower && inUpper) return entry;
    previous = cumulative;
  }
  if (!equalRational(cumulative, totalMass)) throw new RangeError('Exact sampler partition does not cover its declared mass.');
  return null;
}

function validateInterval(interval, label) {
  if (!interval || !interval.lower || !interval.upper) throw new TypeError(`${label} is missing certified bounds.`);
  const lowerSignificand = BigInt(interval.lower.significand);
  const upperSignificand = BigInt(interval.upper.significand);
  if (lowerSignificand < 0n || upperSignificand < 0n || compareDyadic(interval.lower, interval.upper) > 0) {
    throw new RangeError(`${label} has invalid certified bounds.`);
  }
}

function intervalPartitionCandidate(entries, intervalOf, totalMass, prefix, exactProbabilityOf = null) {
  if (!entries.length) throw new RangeError('Certified interval partition is empty.');
  if (exactProbabilityOf) {
    const exact = entries.map(entry => exactProbabilityOf(entry));
    if (exact.every(value => value && typeof value.numerator === 'string' && typeof value.denominator === 'string')) {
      return exactPartitionCandidate(entries, (_entry, index) => exact[index], totalMass, prefix);
    }
  }
  let cumulativeLower = ZERO_DYADIC;
  let cumulativeUpper = ZERO_DYADIC;
  let previousUpper = ZERO_DYADIC;
  const seen = new Set();
  for (const entry of entries) {
    if (typeof entry.titleId !== 'string' || !entry.titleId || seen.has(entry.titleId)) throw new RangeError('Certified partition has a missing or duplicate result ID.');
    seen.add(entry.titleId);
    const interval = intervalOf(entry);
    validateInterval(interval, `probability for ${entry.titleId}`);
    cumulativeLower = addDyadic(cumulativeLower, interval.lower);
    cumulativeUpper = addDyadic(cumulativeUpper, interval.upper);
    const lowerTotalComparison = compareDyadicToRational(cumulativeLower, totalMass);
    if (lowerTotalComparison > 0) throw new RangeError('Certified lower-bound sum exceeds its exact budget.');
    if (compareDyadicToRational(cumulativeUpper, totalMass) < 0) {
      // Intermediate partial sums may be below the full partition budget.
    }
    const isLast = entry === entries[entries.length - 1];
    const currentLower = isLast ? null : cumulativeLower;
    const beforeSafe = compareScaledPrefixToDyadic(prefix.lower, totalMass, previousUpper) >= 0;
    const afterSafe = isLast
      ? compareScaledPrefixToRational(prefix.upper, totalMass, totalMass) <= 0
      : compareScaledPrefixToDyadic(prefix.upper, totalMass, currentLower) <= 0;
    if (beforeSafe && afterSafe) return entry;
    previousUpper = cumulativeUpper;
  }
  if (compareDyadicToRational(cumulativeLower, totalMass) > 0 || compareDyadicToRational(cumulativeUpper, totalMass) < 0) {
    throw new RangeError('Certified intervals do not enclose the exact partition budget.');
  }
  return null;
}

function planHash(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(plan), 'utf8').digest('hex');
}

function chooseSources(snapshot, transformed, poolId) {
  const pool = snapshot.pools.find(item => item.id === poolId);
  const resultPool = transformed.pools.find(item => item.poolId === poolId);
  if (!pool || !resultPool || resultPool.poolVersion !== pool.version || resultPool.state !== 'active') {
    throw new RangeError(`Selected pool ${poolId} has no matching active certified distribution.`);
  }
  const groups = [];
  for (const cohortResult of transformed.cohorts.filter(item => snapshot.cohorts.find(cohort => cohort.id === item.cohortId)?.poolId === poolId)) {
    const cohort = snapshot.cohorts.find(item => item.id === cohortResult.cohortId);
    if (!cohort || cohort.version < 1) throw new RangeError('Certified cohort result is missing its frozen snapshot source.');
    if (compareRational(cohortResult.activeBudget, rational('0')) > 0) {
      groups.push({
        type: 'cohort', id: cohort.id, version: cohort.version,
        mass: cohortResult.activeBudget, entries: cohortResult.entries,
        conditionalMass: cohortResult.activeBudget
      });
    }
  }
  for (const fallbackResult of transformed.fallbacks.filter(item => snapshot.fallbacks.find(fallback => fallback.id === item.fallbackId)?.poolId === poolId)) {
    if (compareRational(fallbackResult.mass, rational('0')) > 0) {
      groups.push({
        type: 'fallback', id: fallbackResult.fallbackId, version: null,
        mass: fallbackResult.mass, entries: fallbackResult.entries,
        conditionalMass: ONE_RATIONAL
      });
    }
  }
  const total = groups.reduce((sum, group) => addRational(sum, group.mass), rational('0'));
  if (!equalRational(total, pool.budget)) throw new RangeError(`Cohort/fallback sources do not exactly cover pool ${poolId}.`);
  return { pool, groups, total };
}

function assertResultBelongsToSource(snapshot, source, titleId) {
  if (source.type === 'cohort') {
    const cohort = snapshot.cohorts.find(item => item.id === source.id);
    const slot = cohort?.slots.find(item => item.titleId === titleId);
    if (!slot || slot.state !== 'obtainable' || compareRational(slot.probability, rational('0')) <= 0) {
      throw new RangeError('Sampler attempted to return a title outside the selected obtainable cohort.');
    }
  } else {
    const fallback = snapshot.fallbacks.find(item => item.id === source.id);
    const share = fallback?.shares.find(item => item.titleId === titleId);
    if (!share || compareRational(share.share, rational('0')) <= 0) {
      throw new RangeError('Sampler attempted to return a title outside the selected fallback.');
    }
  }
}

function fallbackCauses(snapshot, fallbackId) {
  const causes = [];
  if (snapshot.expansionBudget.fallbackId === fallbackId && compareRational(snapshot.expansionBudget.free, rational('0')) > 0) {
    causes.push(Object.freeze({ type: 'free-expansion-reserve', amount: snapshot.expansionBudget.free }));
  }
  for (const escrow of snapshot.escrow.filter(item => item.fallbackId === fallbackId)) {
    causes.push(Object.freeze({ type: 'unobtainable-escrow', titleId: escrow.titleId, amount: escrow.amount }));
  }
  return Object.freeze(causes);
}

function createPoolSampler({ backend, entropySourceFactory = createCryptoEntropySource, maxPrecisionBits = MAX_PRECISION_BITS, onSampleDiagnostics = () => {} } = {}) {
  if (!backend || typeof backend.transformSnapshot !== 'function' || !backend.metadata) throw new TypeError('A production MPFR interval backend is required.');
  if (backend.metadata.backendId !== BACKEND_ID || backend.metadata.backendVersion !== BACKEND_VERSION
    || backend.metadata.certified !== true || backend.metadata.manifestRuntimeHashMatches !== true
    || !/^[a-f0-9]{64}$/i.test(backend.metadata.runtimeSha256 || '')) {
    throw new TypeError('Sampler blocked: the MPFR backend is not the pinned certified production backend.');
  }
  if (typeof entropySourceFactory !== 'function') throw new TypeError('Entropy source factory must be a function.');
  if (typeof onSampleDiagnostics !== 'function') throw new TypeError('onSampleDiagnostics must be a function.');
  if (!Number.isSafeInteger(maxPrecisionBits) || !PRECISION_SCHEDULE.includes(maxPrecisionBits)) {
    throw new RangeError('maxPrecisionBits must be one of the versioned sampler precision ceilings.');
  }
  const schedule = PRECISION_SCHEDULE.filter(bits => bits <= maxPrecisionBits);

  async function prepareRoll({ snapshot: inputSnapshot, rollPlan: inputPlan, channels, mode } = {}) {
    let snapshot; let rollPlan; let normalizedChannels;
    try {
      snapshot = createSnapshot(inputSnapshot);
      rollPlan = validateRollPlan(inputPlan, snapshot);
      if (!['auto', 'manual'].includes(mode)) throw new TypeError('mode must be auto or manual.');
      if (!channels || typeof channels !== 'object') throw new TypeError('Luck channels are required.');
      for (const key of Object.keys(channels)) {
        if (!['coreLuck', 'buildLuck', 'temporaryLuck'].includes(key)) throw new TypeError(`Unsupported Luck channel ${key}.`);
        if (typeof channels[key] !== 'string') throw new TypeError(`Luck channel ${key} must be an exact decimal/scientific string.`);
      }
      normalizedChannels = Object.freeze({
        coreLuck: channels.coreLuck ?? '1',
        buildLuck: channels.buildLuck ?? '1',
        temporaryLuck: channels.temporaryLuck ?? '1'
      });
      if (snapshot.publication !== 'published') throw new Error('Only published Pool Snapshots can be sampled.');
    } catch (error) {
      throw new SamplerDecisionError('invalid-roll-input', 'Roll Plan or Pool Snapshot validation failed; no result was produced.', { detail: error.message });
    }

    const snapshotHash = hashSnapshot(snapshot);
    const hash = planHash(rollPlan);
    const selectedPoolIds = [...new Set(rollPlan.components.map(component => component.poolId))];
    const precisionResults = new Map();
    let transformReuseHits = 0;
    let backendCacheHits = 0;
    let backendCacheMisses = 0;
    const transformAt = async precisionBits => {
      if (precisionResults.has(precisionBits)) {
        transformReuseHits++;
        return precisionResults.get(precisionBits);
      }
      const transformed = await backend.transformSnapshot({ snapshot, channels: normalizedChannels, mode, precisionBits, poolIds: selectedPoolIds });
      if (transformed?.cache?.hit === true) backendCacheHits++;
      else backendCacheMisses++;
      try {
        assertProductionProbabilityInterval(transformed);
        if (transformed.numericAuthority !== 'mpfr-directed-interval' || transformed.samplerEligible !== false
          || transformed.snapshotHash !== snapshotHash || transformed.snapshotVersion !== snapshot.version || transformed.mode !== mode
          || transformed.precisionBits !== precisionBits || transformed.formulaVersion !== FORMULA_VERSION
          || transformed.manualPowerVersion !== MANUAL_POWER_VERSION
          || transformed.metadata?.backendId !== backend.metadata.backendId
          || transformed.metadata?.backendVersion !== backend.metadata.backendVersion
          || transformed.metadata?.runtimeSha256 !== backend.metadata.runtimeSha256
          || transformed.metadata?.certified !== true) {
          throw new TypeError('MPFR result identity/version metadata mismatch.');
        }
        const actualIds = transformed.pools.map(pool => pool.poolId).sort();
        const expectedIds = [...selectedPoolIds].sort();
        if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) throw new TypeError('MPFR result did not cover exactly the Roll Plan pools.');
      } catch (error) {
        throw new SamplerDecisionError('uncertified-math-result', 'The math backend did not provide the required certified intervals; no result was produced.', { detail: error.message });
      }
      precisionResults.set(precisionBits, transformed);
      return transformed;
    };

    const sample = async () => {
      const auditBase = {
        samplerVersion: SAMPLER_VERSION,
        rollPlanId: rollPlan.planId,
        rollPlanVersion: rollPlan.version,
        rollPlanHash: hash,
        snapshotId: snapshot.snapshotId,
        snapshotVersion: snapshot.version,
        snapshotHash,
        mode,
        formulaVersion: FORMULA_VERSION,
        manualPowerVersion: MANUAL_POWER_VERSION,
        luckChannels: normalizedChannels,
        backendId: backend.metadata.backendId,
        backendVersion: backend.metadata.backendVersion,
        backendRuntimeSha256: backend.metadata.runtimeSha256,
        backendManifestHashMatches: backend.metadata.manifestRuntimeHashMatches,
        backendCertified: backend.metadata.certified
      };
      let maxPrecisionUsed = 0;
      let entropySource;
      try {
        entropySource = entropySourceFactory();
        if (!entropySource || typeof entropySource.nextBytes !== 'function' || typeof entropySource.id !== 'string' || !entropySource.id) {
          throw new TypeError('Entropy source must expose a stable id and nextBytes(count).');
        }
      } catch (error) {
        throw new SamplerDecisionError('entropy-source-error', 'Secure entropy was unavailable; no result was produced.', { ...auditBase, detail: error.message });
      }

      try {
        const componentPrefix = new UniformBitPrefix(entropySource);
        let component = null;
        let componentEntropyBits = 0;
        let componentRefinements = 0;
        for (let index = 0; index < schedule.length; index++) {
          const bits = schedule[index];
          const prefix = await componentPrefix.ensure(bits);
          component = exactPartitionCandidate(rollPlan.components, item => item.mass, ONE_RATIONAL, prefix);
          if (component) { componentEntropyBits = prefix.bits; componentRefinements = index; break; }
        }
        if (!component) throw new SamplerDecisionError('entropy-refinement-limit', 'Roll Plan boundary remained unresolved at the configured entropy ceiling.', { ...auditBase, stage: 'roll-plan', entropyBits: componentPrefix.bitCount });

        const groupPrefix = new UniformBitPrefix(entropySource);
        let group = null;
        let groupEntropyBits = 0;
        let groupRefinements = 0;
        for (let index = 0; index < schedule.length; index++) {
          const bits = schedule[index];
          const prefix = await groupPrefix.ensure(bits);
          const transformed = await transformAt(Math.min(bits, maxPrecisionBits));
          maxPrecisionUsed = Math.max(maxPrecisionUsed, transformed.precisionBits);
          const sources = chooseSources(snapshot, transformed, component.poolId);
          group = exactPartitionCandidate(sources.groups, item => item.mass, sources.total, prefix);
          if (group) { groupEntropyBits = prefix.bits; groupRefinements = index; break; }
        }
        if (!group) throw new SamplerDecisionError('entropy-refinement-limit', 'Cohort/fallback boundary remained unresolved at the configured entropy ceiling.', { ...auditBase, stage: 'cohort-fallback', entropyBits: groupPrefix.bitCount });

        const resultPrefix = new UniformBitPrefix(entropySource);
        let selected = null;
        let finalPrecision = 0;
        let slotEntropyBits = 0;
        let slotRefinements = 0;
        for (let index = 0; index < schedule.length; index++) {
          const precisionBits = schedule[index];
          const prefix = await resultPrefix.ensure(precisionBits);
          const transformed = await transformAt(precisionBits);
          maxPrecisionUsed = Math.max(maxPrecisionUsed, transformed.precisionBits);
          const currentSources = chooseSources(snapshot, transformed, component.poolId);
          const currentGroup = currentSources.groups.find(candidate => candidate.type === group.type && candidate.id === group.id);
          if (!currentGroup) throw new SamplerDecisionError('source-disappeared', 'Selected cohort/fallback disappeared from a published snapshot; no result was produced.', { ...auditBase, stage: 'slot' });
          selected = intervalPartitionCandidate(currentGroup.entries, entry => entry.absoluteProbability, currentGroup.conditionalMass, prefix,
            entry => entry.exactAbsoluteProbability);
          if (selected) {
            finalPrecision = precisionBits;
            slotEntropyBits = prefix.bits;
            slotRefinements = index;
            break;
          }
        }
        if (!selected) throw new SamplerDecisionError('certification-limit', 'Certified bounds did not uniquely resolve the slot before the precision/entropy ceiling; no result was produced.', {
          ...auditBase, stage: 'slot', maxPrecisionBits, entropyBits: resultPrefix.bitCount, refinementCount: schedule.length - 1
        });
        assertResultBelongsToSource(snapshot, group, selected.titleId);

        // Operational cache telemetry is deliberately out-of-band: including
        // it in the deterministic sampler result would make replay audits vary
        // when a backend cache happens to be warm.
        try { onSampleDiagnostics(Object.freeze({ backendHits: backendCacheHits, backendMisses: backendCacheMisses, transformReuseHits })); } catch {}

        const chosenPool = snapshot.pools.find(item => item.id === component.poolId);
        const fallbackId = group.type === 'fallback' ? group.id : null;
        return Object.freeze({
          outcome: selected.titleId,
          audit: Object.freeze({
            ...auditBase,
            outcome: 'selected',
            entropySourceId: entropySource.id,
            entropyBits: Object.freeze({ rollPlan: componentEntropyBits, cohortFallback: groupEntropyBits, slot: slotEntropyBits,
              total: componentEntropyBits + groupEntropyBits + slotEntropyBits }),
            componentId: component.componentId,
            componentMass: component.mass,
            poolId: component.poolId,
            poolKind: chosenPool.kind,
            poolVersion: chosenPool.version,
            cohortId: group.type === 'cohort' ? group.id : null,
            cohortVersion: group.type === 'cohort' ? group.version : null,
            fallbackId,
            fallbackCauses: fallbackId ? fallbackCauses(snapshot, fallbackId) : Object.freeze([]),
            titleId: selected.titleId,
            precisionBits: finalPrecision,
            maxPrecisionBitsUsed: maxPrecisionUsed,
            refinementCount: componentRefinements + groupRefinements + slotRefinements,
            refinements: Object.freeze({ rollPlan: componentRefinements, cohortFallback: groupRefinements, slot: slotRefinements }),
            cacheEntries: precisionResults.size
          })
        });
      } catch (error) {
        if (error instanceof SamplerDecisionError) throw error;
        throw new SamplerDecisionError('sampling-error', 'Sampling failed closed; no title or reward was produced.', { ...auditBase, detail: error.message });
      }
    };

    return Object.freeze({ sample, metadata: Object.freeze({ samplerVersion: SAMPLER_VERSION, rollPlanId: rollPlan.planId,
      rollPlanVersion: rollPlan.version, rollPlanHash: hash, snapshotId: snapshot.snapshotId, snapshotVersion: snapshot.version,
      snapshotHash, mode, poolIds: Object.freeze(selectedPoolIds) }) });
  };

  return Object.freeze({ prepareRoll, metadata: Object.freeze({ samplerVersion: SAMPLER_VERSION, precisionSchedule: schedule, maxPrecisionBits }) });
}

module.exports = {
  SAMPLER_VERSION,
  PRECISION_SCHEDULE,
  SamplerDecisionError,
  createCryptoEntropySource,
  createPoolSampler,
  // Exported arithmetic helpers make the proof-oriented invariants directly testable.
  compareDyadicToRational,
  addDyadic,
  compareScaledPrefixToRational,
  compareScaledPrefixToDyadic,
  exactPartitionCandidate,
  intervalPartitionCandidate
};
