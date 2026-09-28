'use strict';

// Isolated MPFR-backed interval math for Luck 2.0. This module has no RNG,
// sampling, roll, save, or player-state integration by design.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  rational,
  addRational,
  multiplyRational,
  compareRational,
  equalRational,
  hashSnapshot,
  createSnapshot
} = require('./rng-pool-model.cjs');

const BACKEND_ID = 'ntc-mpfr-gmp-wasm';
const BACKEND_VERSION = '1.3.2';
const GMP_VERSION = '6.3.0';
const MPFR_VERSION = '4.2.1';
const FORMULA_VERSION = 'luck2-b-infinity-balanced-v1';
const MANUAL_POWER_VERSION = 'manual-power-v1';
const MANUAL_FACTOR = rational('199', '200');
const EXPECTED_RUNTIME_SHA256 = '76af404a6521699a9f2a0dd3fc34a48368b470cc5044e1fa8e5e480a3deae55a';
const DEFAULT_PRECISION_BITS = 128;
const MAX_PRECISION_BITS = 16384;
const MAX_RATING_DIGITS = 100000;
const MAX_CACHE_ENTRIES = 8;
const RNDU = 2;
const RNDD = 3;
const REQUIRED_BINDINGS = [
  'mpfr_add', 'mpfr_clear', 'mpfr_cmp', 'mpfr_div', 'mpfr_get_version',
  'mpfr_get_z_2exp', 'mpfr_init2', 'mpfr_log10', 'mpfr_mul', 'mpfr_pow',
  'mpfr_set', 'mpz_t', 'mpz_t_free', 'mpz_to_string'
];
const authorizedProbabilityIntervals = new WeakSet();

function parseRating(input, label) {
  if (typeof input !== 'string') throw new TypeError(`${label} must be a decimal/scientific string.`);
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(input.trim());
  if (!match) throw new TypeError(`${label} must be a positive decimal/scientific string.`);
  let coefficient = `${match[1]}${match[2] || ''}`.replace(/^0+/, '');
  if (!coefficient) throw new RangeError(`${label} must be at least 1.`);
  if (coefficient.length > MAX_RATING_DIGITS) throw new RangeError(`${label} exceeds the ${MAX_RATING_DIGITS}-digit limit.`);
  let exponent = BigInt(match[3] || '0') - BigInt((match[2] || '').length);
  while (coefficient.length > 1 && coefficient.endsWith('0')) {
    coefficient = coefficient.slice(0, -1);
    exponent += 1n;
  }
  if (exponent + BigInt(coefficient.length - 1) < 0n) throw new RangeError(`${label} must be at least 1×.`);
  return { coefficient, exponent };
}

function combineRatings(channels) {
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw new TypeError('Luck channels are required.');
  for (const key of Object.keys(channels)) {
    if (!['coreLuck', 'buildLuck', 'temporaryLuck'].includes(key)) throw new TypeError(`Unsupported Luck channel "${key}"; Drop Luck is independent.`);
  }
  const inputs = ['coreLuck', 'buildLuck', 'temporaryLuck'].map(key => parseRating(channels[key] ?? '1', key));
  let coefficient = inputs.reduce((product, item) => product * BigInt(item.coefficient), 1n);
  let exponent = inputs.reduce((sum, item) => sum + item.exponent, 0n);
  while (coefficient > 1n && coefficient % 10n === 0n) { coefficient /= 10n; exponent += 1n; }
  const digits = coefficient.toString();
  if (digits.length > MAX_RATING_DIGITS * 3) throw new RangeError('Combined Luck coefficient exceeds the supported limit.');
  return Object.freeze({ coefficient: digits, exponent, neutral: digits === '1' && exponent === 0n });
}

function readCString(binding, pointer) {
  let end = pointer;
  while (binding.mem[end] !== 0) end++;
  return Buffer.from(binding.mem.subarray(pointer, end)).toString('utf8');
}

function loadBackendModule({ bundlePath, expectedManifestPath, allowUncertified = true } = {}) {
  const root = path.resolve(__dirname, '..');
  const defaultResourceRoot = path.join(root, 'resources', 'ntc-math-backend', BACKEND_VERSION);
  let runtimePath = bundlePath;
  let manifestPath = expectedManifestPath;
  if (!runtimePath && process.versions.electron && process.resourcesPath) {
    const packagedRuntime = path.join(process.resourcesPath, 'ntc-math-backend', BACKEND_VERSION, 'dist', 'index.umd.js');
    if (fs.existsSync(packagedRuntime)) {
      runtimePath = packagedRuntime;
      manifestPath ||= path.join(process.resourcesPath, 'ntc-math-backend', BACKEND_VERSION, 'manifest.json');
    }
  }
  if (!runtimePath) runtimePath = require.resolve('gmp-wasm');
  if (!manifestPath) manifestPath = path.join(defaultResourceRoot, 'manifest.json');
  runtimePath = path.resolve(runtimePath);
  manifestPath = path.resolve(manifestPath);
  if (!fs.existsSync(runtimePath)) throw new Error('MPFR runtime is missing; Luck 2.0 precision backend unavailable.');
  if (!fs.existsSync(manifestPath)) throw new Error('MPFR manifest is missing; Luck 2.0 precision backend unavailable.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.backendId !== BACKEND_ID || manifest.backendVersion !== BACKEND_VERSION || manifest.gmpWasmVersion !== BACKEND_VERSION) {
    throw new Error('MPFR backend manifest identity is incompatible.');
  }
  if (manifest.gmpVersion !== GMP_VERSION || manifest.mpfrVersion !== MPFR_VERSION || manifest.formulaVersion !== FORMULA_VERSION) {
    throw new Error('MPFR backend manifest versions/formula are incompatible.');
  }
  if (manifest.manualPowerVersion !== MANUAL_POWER_VERSION
    || manifest.manualPowerFactor?.numerator !== MANUAL_FACTOR.numerator
    || manifest.manualPowerFactor?.denominator !== MANUAL_FACTOR.denominator) {
    throw new Error('MPFR backend Manual Power manifest is incompatible.');
  }
  if (!Array.isArray(manifest.capabilities) || REQUIRED_BINDINGS.some(name => !manifest.capabilities.includes(name))) {
    throw new Error('MPFR backend manifest omits required capabilities.');
  }
  const declaredPrecision = manifest.precisionPolicy;
  if (declaredPrecision?.minimumBits !== 32 || declaredPrecision?.maximumBits !== MAX_PRECISION_BITS
    || declaredPrecision?.defaultBits !== DEFAULT_PRECISION_BITS
    || !['RNDD', 'RNDU'].every(mode => declaredPrecision.directedRounding?.includes(mode))) {
    throw new Error('MPFR backend precision policy is incompatible.');
  }
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(runtimePath)).digest('hex');
  const manifestHash = String(manifest.runtimeSha256 || '').toLowerCase();
  const certified = actualHash === EXPECTED_RUNTIME_SHA256 && manifestHash === EXPECTED_RUNTIME_SHA256;
  if (!allowUncertified && !certified) throw new Error('MPFR backend is compatible but not certified by the pinned runtime hash.');
  let gmpWasm;
  try { gmpWasm = require(runtimePath); } catch (error) { throw new Error(`MPFR runtime could not be loaded: ${error.message}`); }
  if (typeof gmpWasm.init !== 'function' || typeof gmpWasm.FloatRoundingMode !== 'object') throw new Error('MPFR runtime entry has an incompatible API.');
  return { gmpWasm, manifest, runtimePath, actualHash, certified };
}

function validatePrecision(precisionBits) {
  const value = precisionBits ?? DEFAULT_PRECISION_BITS;
  if (!Number.isSafeInteger(value) || value < 32 || value > MAX_PRECISION_BITS) {
    throw new RangeError(`precisionBits must be an integer from 32 to ${MAX_PRECISION_BITS}.`);
  }
  return value;
}

function createSession(gmpWasm, binding, precisionBits) {
  const downContext = gmpWasm.context.getContext({ precisionBits, roundingMode: RNDD, radix: 10 });
  const upContext = gmpWasm.context.getContext({ precisionBits, roundingMode: RNDU, radix: 10 });
  let closed = false;
  const f = (context, value = '0') => {
    return context.Float(String(value));
  };
  const unary = (name, input, context, rounding) => {
    const result = f(context);
    binding[name](result.mpfr_t, input.mpfr_t, rounding);
    return result;
  };
  const binary = (name, left, right, context, rounding) => {
    const result = f(context);
    binding[name](result.mpfr_t, left.mpfr_t, right.mpfr_t, rounding);
    return result;
  };
  const makeInterval = (lower, upper) => {
    if (binding.mpfr_cmp(lower.mpfr_t, upper.mpfr_t) > 0) throw new RangeError('MPFR interval bounds inverted.');
    return { lower, upper };
  };
  const exact = value => makeInterval(f(downContext, value), f(upContext, value));
  const zero = exact('0');
  const one = exact('1');
  const add = (left, right) => makeInterval(
    binary('mpfr_add', left.lower, right.lower, downContext, RNDD),
    binary('mpfr_add', left.upper, right.upper, upContext, RNDU)
  );
  const multiplyPositive = (left, right) => {
    if (binding.mpfr_cmp(left.lower.mpfr_t, zero.upper.mpfr_t) <= 0 || binding.mpfr_cmp(right.lower.mpfr_t, zero.upper.mpfr_t) <= 0) {
      throw new RangeError('Positive interval multiplication requires strictly positive operands.');
    }
    return makeInterval(
      binary('mpfr_mul', left.lower, right.lower, downContext, RNDD),
      binary('mpfr_mul', left.upper, right.upper, upContext, RNDU)
    );
  };
  const multiplyNonNegative = (left, right) => {
    if (binding.mpfr_cmp(left.lower.mpfr_t, zero.upper.mpfr_t) < 0 || binding.mpfr_cmp(right.lower.mpfr_t, zero.upper.mpfr_t) < 0) {
      throw new RangeError('Non-negative interval multiplication received a negative bound.');
    }
    return makeInterval(
      binary('mpfr_mul', left.lower, right.lower, downContext, RNDD),
      binary('mpfr_mul', left.upper, right.upper, upContext, RNDU)
    );
  };
  const dividePositive = (numerator, denominator) => {
    if (binding.mpfr_cmp(denominator.lower.mpfr_t, zero.upper.mpfr_t) <= 0) throw new RangeError('Interval divisor must be strictly positive.');
    return makeInterval(
      binary('mpfr_div', numerator.lower, denominator.upper, downContext, RNDD),
      binary('mpfr_div', numerator.upper, denominator.lower, upContext, RNDU)
    );
  };
  const reciprocalPositive = value => dividePositive(one, value);
  const clampNonNegative = value => {
    if (binding.mpfr_cmp(value.upper.mpfr_t, zero.upper.mpfr_t) < 0) throw new RangeError('Expected a non-negative interval.');
    return binding.mpfr_cmp(value.lower.mpfr_t, zero.upper.mpfr_t) < 0 ? makeInterval(zero.lower, value.upper) : value;
  };
  const clampProbability = value => {
    if (binding.mpfr_cmp(value.lower.mpfr_t, zero.upper.mpfr_t) < 0 || binding.mpfr_cmp(value.lower.mpfr_t, one.lower.mpfr_t) > 0) {
      throw new RangeError('Calculated probability interval is outside [0, 1].');
    }
    return binding.mpfr_cmp(value.upper.mpfr_t, one.upper.mpfr_t) > 0 ? makeInterval(value.lower, one.upper) : value;
  };
  const log10Positive = value => {
    if (binding.mpfr_cmp(value.lower.mpfr_t, zero.upper.mpfr_t) <= 0) throw new RangeError('log10 interval must be strictly positive.');
    return makeInterval(
      unary('mpfr_log10', value.lower, downContext, RNDD),
      unary('mpfr_log10', value.upper, upContext, RNDU)
    );
  };
  const powProbability = (base, exponent) => {
    if (binding.mpfr_cmp(base.lower.mpfr_t, zero.upper.mpfr_t) <= 0 || binding.mpfr_cmp(base.upper.mpfr_t, one.lower.mpfr_t) > 0) {
      throw new RangeError('Power base must be a probability interval in (0, 1].');
    }
    if (binding.mpfr_cmp(exponent.lower.mpfr_t, zero.upper.mpfr_t) <= 0) throw new RangeError('Power exponent must be strictly positive.');
    // For 0 < a <= 1, a^b is increasing in a and decreasing in b.
    return makeInterval(
      binary('mpfr_pow', base.lower, exponent.upper, downContext, RNDD),
      binary('mpfr_pow', base.upper, exponent.lower, upContext, RNDU)
    );
  };
  const fromRational = value => {
    if (!value || typeof value !== 'object' || !/^(?:0|[1-9]\d*)$/.test(value.numerator) || !/^[1-9]\d*$/.test(value.denominator)) {
      throw new TypeError('Probability inputs must be canonical non-negative rational strings.');
    }
    const n = BigInt(value.numerator);
    const d = BigInt(value.denominator);
    if (d <= 0n) throw new RangeError('Rational denominator must be positive.');
    if (n < 0n) throw new RangeError('Probability cannot be negative.');
    if (n === 0n) return zero;
    const numerator = makeInterval(f(downContext, n.toString()), f(upContext, n.toString()));
    const denominator = makeInterval(f(downContext, d.toString()), f(upContext, d.toString()));
    return dividePositive(numerator, denominator);
  };
  const fromProbabilityRational = value => {
    const numerator = BigInt(value.numerator);
    const denominator = BigInt(value.denominator);
    if (numerator > denominator) throw new RangeError('A probability rational cannot exceed one.');
    const interval = fromRational(value);
    if (binding.mpfr_cmp(interval.upper.mpfr_t, one.upper.mpfr_t) > 0) return makeInterval(interval.lower, one.upper);
    return interval;
  };
  const assertEnclosesExact = (outer, exactValue, label) => {
    const target = fromRational(exactValue);
    if (binding.mpfr_cmp(outer.lower.mpfr_t, target.lower.mpfr_t) > 0
      || binding.mpfr_cmp(outer.upper.mpfr_t, target.upper.mpfr_t) < 0) {
      throw new RangeError(`${label} interval does not enclose its exact budget.`);
    }
  };
  const intervalFromDecimalInteger = text => makeInterval(f(downContext, text), f(upContext, text));
  const betaFor = (channels, mode) => {
    if (!['auto', 'manual'].includes(mode)) throw new TypeError('mode must be "auto" or "manual".');
    const combined = combineRatings(channels);
    let auto;
    if (combined.neutral) auto = one;
    else {
      const exponentValue = intervalFromDecimalInteger(combined.exponent.toString());
      const coefficient = intervalFromDecimalInteger(combined.coefficient);
      const logCoefficient = log10Positive(coefficient);
      const logR = clampNonNegative(add(exponentValue, logCoefficient));
      const inner = add(one, logR);
      const outer = log10Positive(inner);
      const coefficient013 = fromRational(rational('13', '100'));
      const scaled = multiplyNonNegative(coefficient013, outer);
      const denominator = add(one, scaled);
      auto = reciprocalPositive(denominator);
    }
    const beta = mode === 'manual' ? multiplyPositive(auto, fromRational(MANUAL_FACTOR)) : auto;
    if (binding.mpfr_cmp(beta.lower.mpfr_t, zero.upper.mpfr_t) <= 0 || binding.mpfr_cmp(beta.upper.mpfr_t, one.upper.mpfr_t) > 0) {
      throw new RangeError('Calculated beta is outside (0, 1].');
    }
    return { beta, autoBeta: auto, combined, neutral: combined.neutral };
  };
  const exactProduct = (a, b) => multiplyRational(a, b);
  const distribution = ({ slots, budget, channels, mode, cohortId = 'cohort' }) => {
    if (!Array.isArray(slots) || !slots.length) throw new TypeError(`${cohortId} needs a non-empty frozen roster.`);
    const seen = new Set();
    let slotTotal = rational('0');
    const normalized = slots.map(slot => {
      if (!slot || typeof slot.titleId !== 'string' || !slot.titleId.trim() || seen.has(slot.titleId)) throw new TypeError(`${cohortId} has a missing or duplicate title ID.`);
      seen.add(slot.titleId);
      const probability = rational(slot.probability.numerator, slot.probability.denominator);
      if (compareRational(probability, rational('0')) < 0) throw new RangeError(`Slot ${slot.titleId} probability cannot be negative.`);
      if (!['obtainable', 'unobtainable'].includes(slot.state ?? 'obtainable')) throw new TypeError(`Invalid state for ${slot.titleId}.`);
      slotTotal = addRational(slotTotal, probability);
      return { titleId: slot.titleId, probability, state: slot.state ?? 'obtainable' };
    });
    const exactBudget = budget ? rational(budget.numerator, budget.denominator) : slotTotal;
    if (compareRational(exactBudget, rational('1')) > 0) throw new RangeError(`${cohortId} budget cannot exceed one.`);
    if (!equalRational(slotTotal, exactBudget)) throw new RangeError(`${cohortId} slot probabilities must sum exactly to its budget.`);
    // Zero-probability slots are valid catalog records but are never candidates
    // for a draw. Keep them in exact budget validation while excluding them
    // from MPFR power/normalization operations.
    const activeSlots = normalized.filter(slot => slot.state === 'obtainable' && compareRational(slot.probability, rational('0')) > 0);
    const unavailableSlots = normalized.filter(slot => slot.state === 'unobtainable');
    const activeBudget = activeSlots.reduce((sum, slot) => addRational(sum, slot.probability), rational('0'));
    const betaInfo = betaFor(channels, mode);
    let weights = [];
    let weightSum = zero;
    if (activeSlots.length) {
      weights = activeSlots.map(slot => {
        const weight = powProbability(fromProbabilityRational(slot.probability), betaInfo.beta);
        weightSum = add(weightSum, weight);
        return { slot, weight };
      });
    }
    const output = [];
    for (const { slot, weight } of weights) {
      const conditional = clampProbability(dividePositive(weight, weightSum));
      const absolute = clampProbability(multiplyPositive(fromRational(activeBudget), conditional));
      const exactConditionalProbability = betaInfo.neutral && mode === 'auto'
        ? rational(BigInt(slot.probability.numerator) * BigInt(activeBudget.denominator), BigInt(slot.probability.denominator) * BigInt(activeBudget.numerator))
        : null;
      output.push({
        titleId: slot.titleId,
        state: slot.state,
        baseProbability: slot.probability,
        conditionalProbability: serializeInterval(conditional, binding),
        absoluteProbability: serializeInterval(absolute, binding),
        exactConditionalProbability,
        exactAbsoluteProbability: exactConditionalProbability ? exactProduct(activeBudget, exactConditionalProbability) : null,
        _conditional: conditional,
        _absolute: absolute
      });
    }
    const escrow = unavailableSlots.filter(slot => compareRational(slot.probability, rational('0')) > 0)
      .map(slot => ({ titleId: slot.titleId, amount: slot.probability }));
    let totalMass = zero;
    for (const entry of output) totalMass = add(totalMass, entry._absolute);
    for (const item of escrow) totalMass = add(totalMass, fromRational(item.amount));
    assertEnclosesExact(totalMass, exactBudget, `${cohortId} normalization`);
    const publicEntries = output.map(({ _conditional, _absolute, ...entry }) => Object.freeze(entry));
    const result = Object.freeze({
      numericAuthority: 'mpfr-directed-interval',
      samplerEligible: false,
      backendVersion: BACKEND_VERSION,
      formulaVersion: FORMULA_VERSION,
      manualPowerVersion: MANUAL_POWER_VERSION,
      precisionBits,
      cohortId,
      mode,
      beta: serializeInterval(betaInfo.beta, binding),
      autoBeta: serializeInterval(betaInfo.autoBeta, binding),
      budget: exactBudget,
      activeBudget,
      entries: Object.freeze(publicEntries),
      escrow: Object.freeze(escrow),
      normalizationVerified: true,
      precision: Object.freeze({ endpointFormat: 'dyadic-significand-times-2^binaryExponent', directedRounding: true, normalization: 'positive MPFR interval division' })
    });
    authorizedProbabilityIntervals.add(result);
    return { publicResult: result, output, betaInfo };
  };
  const close = () => {
    if (closed) return;
    closed = true;
    // gmp-wasm's Float context tracks every MPFR allocation and clears it on
    // destroy; clearing pointers here as well would double-free WASM memory.
    downContext.destroy();
    upContext.destroy();
  };
  return { binding, add, multiplyPositive, fromRational, betaFor, distribution, close, intervalFromDecimalInteger,
    clampProbability, assertEnclosesExact, serialize: interval => serializeInterval(interval, binding) };
}

function serializeInterval(interval, binding) {
  return Object.freeze({ lower: serializeDyadic(interval.lower, binding), upper: serializeDyadic(interval.upper, binding) });
}

function serializeDyadic(value, binding) {
  const integer = binding.mpz_t();
  try {
    const exponent = binding.mpfr_get_z_2exp(integer, value.mpfr_t);
    return Object.freeze({ significand: binding.mpz_to_string(integer, 10), binaryExponent: String(exponent) });
  } finally {
    binding.mpz_t_free(integer);
  }
}

function intervalBoundsContain(outer, inner) {
  return compareDyadic(outer.lower, inner.lower) <= 0 && compareDyadic(outer.upper, inner.upper) >= 0;
}

function compareDyadic(left, right) {
  const le = BigInt(left.binaryExponent);
  const re = BigInt(right.binaryExponent);
  const lm = BigInt(left.significand);
  const rm = BigInt(right.significand);
  const min = le < re ? le : re;
  const l = lm << (le - min);
  const r = rm << (re - min);
  return l < r ? -1 : l > r ? 1 : 0;
}

function createBoundedCache() {
  const map = new Map();
  return {
    get(key) { if (!map.has(key)) return null; const value = map.get(key); map.delete(key); map.set(key, value); return value; },
    set(key, value) { if (map.has(key)) map.delete(key); map.set(key, value); while (map.size > MAX_CACHE_ENTRIES) map.delete(map.keys().next().value); },
    clear() { map.clear(); },
    get size() { return map.size; }
  };
}

function assertProductionProbabilityInterval(value) {
  if (!value || typeof value !== 'object' || !authorizedProbabilityIntervals.has(value)) {
    throw new TypeError('Sampling blocked: a production-authoritative probability interval was not provided.');
  }
  return value;
}

async function createProductionIntervalBackend(options = {}) {
  const loaded = loadBackendModule(options);
  const initialized = await loaded.gmpWasm.init();
  const binding = initialized.binding;
  const missing = REQUIRED_BINDINGS.filter(name => typeof binding[name] !== 'function');
  if (missing.length) throw new Error(`MPFR backend is missing required bindings: ${missing.join(', ')}.`);
  const mpfrVersion = readCString(binding, binding.mpfr_get_version());
  if (mpfrVersion !== MPFR_VERSION) throw new Error(`MPFR version mismatch: expected ${MPFR_VERSION}, got ${mpfrVersion}.`);
  const metadata = Object.freeze({
    backendId: BACKEND_ID,
    backendVersion: BACKEND_VERSION,
    gmpWasmVersion: loaded.manifest.gmpWasmVersion,
    gmpVersion: loaded.certified ? GMP_VERSION : null,
    declaredGmpVersion: loaded.manifest.gmpVersion,
    mpfrVersion,
    formulaVersion: FORMULA_VERSION,
    manualPowerVersion: MANUAL_POWER_VERSION,
    runtimeSha256: loaded.actualHash,
    manifestRuntimeHashMatches: loaded.actualHash === String(loaded.manifest.runtimeSha256 || '').toLowerCase(),
    certified: loaded.certified,
    supportStatus: loaded.certified ? 'certified-supported' : 'compatible-uncertified',
    precisionBits: Object.freeze({ min: 32, max: MAX_PRECISION_BITS, default: DEFAULT_PRECISION_BITS }),
    capabilities: Object.freeze([...REQUIRED_BINDINGS])
  });
  const cache = createBoundedCache();

  const calculateBeta = async ({ channels, mode, precisionBits: requestedPrecision } = {}) => {
    const bits = validatePrecision(requestedPrecision);
    const session = createSession({ ...loaded.gmpWasm, context: initialized }, binding, bits);
    try {
      const calculation = session.betaFor(channels, mode);
      return Object.freeze({
        numericAuthority: 'mpfr-directed-interval', samplerEligible: false,
        metadata, precisionBits: bits, mode,
        beta: session.serialize(calculation.beta), autoBeta: session.serialize(calculation.autoBeta),
        neutralRating: calculation.neutral
      });
    } finally { session.close(); }
  };

  const transformCohort = async ({ slots, budget, channels, mode, cohortId = 'cohort', precisionBits: requestedPrecision, snapshotVersion = null, poolVersion = null } = {}) => {
    const bits = validatePrecision(requestedPrecision);
    const normalizedSlots = slots.map(slot => ({ titleId: slot.titleId, probability: rational(slot.probability.numerator, slot.probability.denominator), state: slot.state ?? 'obtainable' }));
    const normalizedBudget = budget ? rational(budget.numerator, budget.denominator) : null;
    const rating = combineRatings(channels);
    const key = JSON.stringify({
      snapshotHash: snapshotVersion?.snapshotHash || null,
      snapshotVersion: snapshotVersion?.version ?? snapshotVersion ?? null,
      poolVersion, cohortId, formulaVersion: FORMULA_VERSION,
      channels: { coreLuck: channels.coreLuck ?? '1', buildLuck: channels.buildLuck ?? '1', temporaryLuck: channels.temporaryLuck ?? '1' },
      canonicalRating: { coefficient: rating.coefficient, exponent: rating.exponent.toString() },
      mode, precisionBits: bits, backendVersion: BACKEND_VERSION, runtimeSha256: loaded.actualHash,
      slots: normalizedSlots, budget: normalizedBudget
    });
    const cached = cache.get(key);
    if (cached) {
      const hit = Object.freeze({ ...cached, cache: Object.freeze({ hit: true, maxEntries: MAX_CACHE_ENTRIES }) });
      authorizedProbabilityIntervals.add(hit);
      return hit;
    }
    const session = createSession({ ...loaded.gmpWasm, context: initialized }, binding, bits);
    try {
      const calculated = session.distribution({ slots: normalizedSlots, budget: normalizedBudget, channels, mode, cohortId });
      const result = Object.freeze({ ...calculated.publicResult, metadata, cache: Object.freeze({ hit: false, maxEntries: MAX_CACHE_ENTRIES }) });
      authorizedProbabilityIntervals.add(result);
      cache.set(key, result);
      return result;
    } finally { session.close(); }
  };

  const transformSnapshot = async ({ snapshot, channels, mode, precisionBits: requestedPrecision, poolIds: requestedPoolIds } = {}) => {
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.cohorts) || !Array.isArray(snapshot.fallbacks)) throw new TypeError('A validated Pool System snapshot is required.');
    snapshot = createSnapshot(snapshot);
    if (snapshot.publication !== 'published' || snapshot.cohorts.some(cohort => cohort.publication !== 'published' || !cohort.rosterFrozen)) {
      throw new Error('Production precision transforms require a published snapshot with frozen cohort rosters.');
    }
    if (snapshot.pools.some(pool => compareRational(pool.budget, rational('1')) > 0)) throw new RangeError('Each independently sampled pool must have a budget no greater than one.');
    if (requestedPoolIds != null && !Array.isArray(requestedPoolIds)) throw new TypeError('poolIds must be an array of stable pool IDs.');
    const selectedPoolIds = requestedPoolIds == null
      ? snapshot.pools.map(pool => pool.id)
      : [...new Set(requestedPoolIds)];
    if (!Array.isArray(selectedPoolIds) || selectedPoolIds.length === 0 || selectedPoolIds.some(id => typeof id !== 'string' || !id.trim())) {
      throw new TypeError('poolIds must be a non-empty array of stable pool IDs.');
    }
    const selectedPoolSet = new Set(selectedPoolIds);
    for (const poolId of selectedPoolSet) if (!snapshot.pools.some(pool => pool.id === poolId)) throw new RangeError(`Unknown selected pool ${poolId}.`);
    const selectedPools = snapshot.pools.filter(pool => selectedPoolSet.has(pool.id));
    const selectedCohorts = snapshot.cohorts.filter(cohort => selectedPoolSet.has(cohort.poolId));
    const selectedFallbacks = snapshot.fallbacks.filter(fallback => selectedPoolSet.has(fallback.poolId));
    const bits = validatePrecision(requestedPrecision);
    const snapshotHash = hashSnapshot(snapshot);
    const rating = combineRatings(channels);
    const cacheKey = JSON.stringify({ snapshotHash, snapshotVersion: snapshot.version, formulaVersion: FORMULA_VERSION,
      channels: { coreLuck: channels.coreLuck ?? '1', buildLuck: channels.buildLuck ?? '1', temporaryLuck: channels.temporaryLuck ?? '1' },
      combinedRating: { coefficient: rating.coefficient, exponent: rating.exponent.toString() }, mode, precisionBits: bits,
      backendVersion: BACKEND_VERSION, runtimeSha256: loaded.actualHash, poolIds: selectedPools.map(pool => pool.id) });
    const cached = cache.get(cacheKey);
    if (cached) {
      const hit = Object.freeze({ ...cached, cache: Object.freeze({ hit: true, maxEntries: MAX_CACHE_ENTRIES }) });
      authorizedProbabilityIntervals.add(hit);
      return hit;
    }
    const session = createSession({ ...loaded.gmpWasm, context: initialized }, binding, bits);
    try {
      const aggregate = new Map(selectedPools.map(pool => [pool.id, new Map()]));
      const addTitleInterval = (poolId, titleId, interval) => {
        const poolEntries = aggregate.get(poolId);
        if (!poolEntries) throw new RangeError(`Unknown pool ${poolId}.`);
        const previous = poolEntries.get(titleId);
        poolEntries.set(titleId, previous ? session.add(previous, interval) : interval);
      };
      const byFallback = new Map(selectedFallbacks.map(item => [item.id, { spec: item, mass: rational('0') }]));
      const cohortResults = [];
      for (const cohort of selectedCohorts) {
        if (compareRational(cohort.budget, rational('0')) === 0) continue;
        const calculated = session.distribution({ slots: cohort.slots, budget: cohort.budget, channels, mode, cohortId: cohort.id });
        for (const entry of calculated.output) addTitleInterval(cohort.poolId, entry.titleId, entry._absolute);
        cohortResults.push(calculated.publicResult);
        for (const item of calculated.publicResult.escrow) {
          const escrow = snapshot.escrow.find(candidate => candidate.titleId === item.titleId);
          const target = byFallback.get(escrow?.fallbackId);
          if (!target) throw new RangeError(`Escrow fallback missing for ${item.titleId}.`);
          target.mass = addRational(target.mass, item.amount);
        }
      }
      if (selectedPoolSet.has(snapshot.expansionBudget.poolId)) {
        const reserveTarget = byFallback.get(snapshot.expansionBudget.fallbackId);
        if (!reserveTarget) throw new RangeError('Expansion reserve fallback is missing.');
        reserveTarget.mass = addRational(reserveTarget.mass, snapshot.expansionBudget.free);
      }
      const fallbackResults = [];
      for (const { spec, mass } of byFallback.values()) {
        if (compareRational(mass, rational('0')) === 0) continue;
        const calculated = session.distribution({ slots: spec.shares.filter(item => compareRational(item.share, rational('0')) > 0)
          .map(item => ({ titleId: item.titleId, probability: item.share, state: 'obtainable' })), budget: rational('1'), channels, mode, cohortId: `fallback:${spec.id}` });
        const absoluteMass = session.fromRational(mass);
        for (const entry of calculated.output) addTitleInterval(spec.poolId, entry.titleId, session.multiplyPositive(entry._conditional, absoluteMass));
        fallbackResults.push(Object.freeze({ fallbackId: spec.id, mass, ...calculated.publicResult }));
      }
      for (const pool of selectedPools) {
        let poolMass = { lower: session.fromRational(rational('0')).lower, upper: session.fromRational(rational('0')).upper };
        for (const interval of aggregate.get(pool.id).values()) poolMass = session.add(poolMass, interval);
        session.assertEnclosesExact(poolMass, pool.budget, `Pool ${pool.id} normalization`);
      }
      const poolResults = selectedPools.map(pool => Object.freeze({
        poolId: pool.id,
        kind: pool.kind,
        state: pool.state,
        poolVersion: pool.version,
        budget: pool.budget,
        normalizationVerified: true,
        entries: Object.freeze([...aggregate.get(pool.id).entries()].map(([titleId, interval]) => Object.freeze({
          titleId,
          probability: session.serialize(session.clampProbability(interval))
        })))
      }));
      const betaInfo = session.betaFor(channels, mode);
      const result = Object.freeze({
        numericAuthority: 'mpfr-directed-interval', samplerEligible: false,
        metadata, snapshotId: snapshot.snapshotId, snapshotVersion: snapshot.version, snapshotHash,
        formulaVersion: FORMULA_VERSION, manualPowerVersion: MANUAL_POWER_VERSION,
        mode, precisionBits: bits, beta: session.serialize(betaInfo.beta), requestedPoolIds: Object.freeze(selectedPools.map(pool => pool.id)),
        commonFloor: snapshot.commonFloor,
        expansionBudget: snapshot.expansionBudget,
        pools: Object.freeze(poolResults), cohorts: Object.freeze(cohortResults), fallbacks: Object.freeze(fallbackResults),
        cache: Object.freeze({ hit: false, maxEntries: MAX_CACHE_ENTRIES })
      });
      authorizedProbabilityIntervals.add(result);
      cache.set(cacheKey, result);
      return result;
    } finally { session.close(); }
  };

  return Object.freeze({
    metadata,
    calculateBeta,
    transformCohort,
    transformSnapshot,
    clearCache: () => cache.clear(),
    cacheInfo: () => Object.freeze({ size: cache.size, maxEntries: MAX_CACHE_ENTRIES })
  });
}

module.exports = {
  BACKEND_ID,
  BACKEND_VERSION,
  GMP_VERSION,
  MPFR_VERSION,
  FORMULA_VERSION,
  MANUAL_POWER_VERSION,
  DEFAULT_PRECISION_BITS,
  MAX_PRECISION_BITS,
  compareDyadic,
  intervalBoundsContain,
  assertProductionProbabilityInterval,
  createProductionIntervalBackend
};
