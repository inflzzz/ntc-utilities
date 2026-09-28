'use strict';

const {
  rational,
  addRational,
  multiplyRational,
  compareRational,
  equalRational
} = require('./rng-pool-model.cjs');

const LUCK_ENGINE_VERSION = 'luck2-b-infinity-balanced-v1';
const BETA_CURVE_VERSION = 'b-infinity-balanced-v1';
const MANUAL_POWER_VERSION = 'manual-power-v1';
const MANUAL_BETA_FACTOR = rational('199', '200');
const LOG10_COEFFICIENT = 0.13;
const OUTPUT_SIGNIFICANT_DIGITS = 15;
const NORMALIZATION_CUTOFF_LOG10 = -300;
const MAX_INPUT_DIGITS = 10_000_000;

function parseRating(input, label = 'Luck rating') {
  if (typeof input !== 'string') throw new TypeError(`${label} must be a decimal/scientific string; Number is not accepted.`);
  const source = input.trim().replace(/×$/u, '').trim();
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) throw new TypeError(`${label} must be a positive decimal/scientific string.`);
  let digits = `${match[1]}${match[2] ?? ''}`.replace(/^0+/, '');
  if (!digits) throw new RangeError(`${label} must be at least 1×.`);
  if (digits.length > MAX_INPUT_DIGITS) throw new RangeError(`${label} exceeds the supported ${MAX_INPUT_DIGITS}-digit input limit.`);
  let exponent = BigInt(match[3] ?? '0') - BigInt((match[2] ?? '').length);
  while (digits.length > 1 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exponent += 1n;
  }
  const wholeLog = exponent + BigInt(digits.length - 1);
  if (wholeLog < 0n) throw new RangeError(`${label} must be at least 1×.`);
  return Object.freeze({ coefficient: digits, exponent: exponent.toString() });
}

function log10BigInt(value) {
  const integer = value < 0n ? -value : value;
  if (integer === 0n) throw new RangeError('log10 is undefined for zero.');
  const digits = integer.toString();
  if (digits.length > MAX_INPUT_DIGITS) throw new RangeError('Integer exceeds the supported logarithm input limit.');
  const prefix = digits.slice(0, Math.min(16, digits.length));
  const significand = Number(prefix) / (10 ** (prefix.length - 1));
  return digits.length - 1 + Math.log10(significand);
}

function ratingLog10(rating) {
  const digits = rating.coefficient;
  const exponent = BigInt(rating.exponent);
  const prefix = digits.slice(0, Math.min(16, digits.length));
  const significand = Number(prefix) / (10 ** (prefix.length - 1));
  return { whole: exponent + BigInt(digits.length - 1), fraction: Math.log10(significand) };
}

function combineChannelRatings(channels) {
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw new TypeError('Luck channels are required.');
  for (const key of Object.keys(channels)) {
    if (!['coreLuck', 'buildLuck', 'temporaryLuck'].includes(key)) throw new TypeError(`Unsupported Luck channel "${key}"; Drop Luck is independent.`);
  }
  const normalized = {
    coreLuck: parseRating(channels.coreLuck ?? '1', 'Core Luck'),
    buildLuck: parseRating(channels.buildLuck ?? '1', 'Build Luck'),
    temporaryLuck: parseRating(channels.temporaryLuck ?? '1', 'Temporary Luck')
  };
  let coefficient = Object.values(normalized).reduce((product, rating) => product * BigInt(rating.coefficient), 1n);
  let exponent = Object.values(normalized).reduce((sum, rating) => sum + BigInt(rating.exponent), 0n);
  while (coefficient > 1n && coefficient % 10n === 0n) { coefficient /= 10n; exponent += 1n; }
  const combinedCoefficient = coefficient.toString();
  if (combinedCoefficient.length > MAX_INPUT_DIGITS * 3) throw new RangeError('Combined Luck coefficient exceeds the supported limit.');
  const combinedRating = Object.freeze({ coefficient: combinedCoefficient, exponent: exponent.toString() });
  const { whole, fraction } = ratingLog10(combinedRating);
  const isNeutral = combinedCoefficient === '1' && exponent === 0n;
  return Object.freeze({
    channels: Object.freeze(normalized),
    combinedRating,
    log10R: Object.freeze({ whole: whole.toString(), fraction: fraction.toPrecision(17) }),
    isNeutral
  });
}

function log10OnePlusLogR(log10R) {
  const whole = BigInt(log10R.whole);
  const fraction = Number(log10R.fraction);
  if (whole < 0n) throw new RangeError('Combined Luck must be at least 1×.');
  if (whole === 0n) return Math.log10(1 + fraction);
  if (whole <= 1_000_000_000_000_000n) return Math.log10(1 + Number(whole) + fraction);
  // log10(R) is itself kept as a BigInt integer part. Only its bounded outer
  // logarithm is converted to Number; R and its potentially enormous exponent are not.
  return log10BigInt(whole);
}

function calculateLuckBeta({ channels, mode } = {}) {
  if (!['auto', 'manual'].includes(mode)) throw new TypeError('mode must be explicitly "auto" or "manual".');
  const combined = combineChannelRatings(channels);
  let autoBeta = combined.isNeutral
    ? 1
    : 1 / (1 + LOG10_COEFFICIENT * log10OnePlusLogR(combined.log10R));
  if (!combined.isNeutral && autoBeta === 1) autoBeta = 1 - Number.EPSILON / 2;
  if (!(autoBeta > 0 && autoBeta <= 1) || !Number.isFinite(autoBeta)) throw new RangeError('Luck beta is outside its supported finite range.');
  const beta = mode === 'manual' ? autoBeta * (199 / 200) : autoBeta;
  if (!(beta > 0 && beta < (mode === 'manual' ? 1 : 1 + Number.EPSILON))) throw new RangeError('Mode-adjusted beta is not positive and finite.');
  return Object.freeze({
    numericAuthority: 'diagnostic-only',
    samplerEligible: false,
    engineVersion: LUCK_ENGINE_VERSION,
    curveVersion: BETA_CURVE_VERSION,
    manualPowerVersion: MANUAL_POWER_VERSION,
    mode,
    channels: combined.channels,
    log10R: combined.log10R,
    beta: beta.toPrecision(17),
    autoBeta: autoBeta.toPrecision(17),
    manualFactor: '0.995',
    neutralR: combined.isNeutral
  });
}

function parseProbability(value, label) {
  if (!value || typeof value !== 'object' || typeof value.numerator !== 'string' || typeof value.denominator !== 'string') {
    throw new TypeError(`${label} must use exact rational numerator/denominator strings.`);
  }
  const normalized = rational(value.numerator, value.denominator);
  if (BigInt(normalized.numerator) <= 0n) throw new RangeError(`${label} must be greater than zero.`);
  return normalized;
}

function log10Rational(value) {
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  return log10BigInt(numerator) - log10BigInt(denominator);
}

function asScientific(log10Value) {
  if (!Number.isFinite(log10Value)) throw new RangeError('Probability logarithm is not finite.');
  let exponentNumber = Math.floor(log10Value);
  let significand = 10 ** (log10Value - exponentNumber);
  if (significand >= 10) { significand /= 10; exponentNumber += 1; }
  if (significand < 1) { significand *= 10; exponentNumber -= 1; }
  let rounded = Number(significand.toPrecision(OUTPUT_SIGNIFICANT_DIGITS));
  if (rounded >= 10) { rounded /= 10; exponentNumber += 1; }
  const text = rounded.toPrecision(OUTPUT_SIGNIFICANT_DIGITS).replace(/(?:\.0+|(?:(\.\d*?)0+))$/u, '$1');
  return Object.freeze({ significand: text, exponent: BigInt(exponentNumber).toString(), format: 'significand × 10^exponent' });
}

function sumScientificForValidation(values) {
  let sum = 0;
  let belowBinary64Resolution = 0;
  for (const value of values) {
    const exponent = BigInt(value.exponent);
    if (exponent < BigInt(NORMALIZATION_CUTOFF_LOG10)) {
      // Keep the probability in its scientific-string result. Do not coerce a
      // tiny probability to Number(0); omit it only from this bounded validator
      // and report an explicit conservative upper bound below.
      belowBinary64Resolution++;
      continue;
    }
    if (exponent > 300n) throw new RangeError('Probability unexpectedly exceeds binary64 validation range.');
    sum += Number(value.significand) * (10 ** Number(exponent));
  }
  return {
    sum,
    belowBinary64Resolution,
    omittedMassUpperBound: (belowBinary64Resolution * (10 ** NORMALIZATION_CUTOFF_LOG10)).toExponential(3)
  };
}

function transformCohort({ slots, budget, channels, mode, cohortId = 'diagnostic', normalizationTolerance = 1e-12 } = {}) {
  if (!Array.isArray(slots) || slots.length === 0) throw new TypeError('A non-empty frozen diagnostic roster is required.');
  if (!Number.isFinite(normalizationTolerance) || normalizationTolerance <= 0) throw new TypeError('normalizationTolerance must be a positive finite tolerance.');
  const seen = new Set();
  const normalizedSlots = slots.map(slot => {
    if (!slot || typeof slot.titleId !== 'string' || !slot.titleId.trim()) throw new TypeError('Each slot needs a stable titleId.');
    if (seen.has(slot.titleId)) throw new RangeError(`Duplicate title ID ${slot.titleId} in diagnostic cohort.`);
    seen.add(slot.titleId);
    return { titleId: slot.titleId, probability: parseProbability(slot.probability, `base probability for ${slot.titleId}`) };
  });
  const baseTotal = normalizedSlots.reduce((sum, slot) => addRational(sum, slot.probability), rational('0'));
  if (!equalRational(baseTotal, rational('1'))) throw new RangeError('Conditional cohorst base probabilities must sum exactly to 1.');
  const exactBudget = budget == null ? rational('1') : parseProbability(budget, 'cohort budget');
  if (compareRational(exactBudget, rational('1')) > 0) throw new RangeError('A pool cohort budget cannot exceed 1.');
  const betaInfo = calculateLuckBeta({ channels, mode });
  const beta = Number(betaInfo.beta);
  const baseLogs = normalizedSlots.map(slot => log10Rational(slot.probability));
  const maxBaseMagnitude = baseLogs.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const weightedLogs = baseLogs.map(value => value * beta);
  const maxWeighted = Math.max(...weightedLogs);
  const relativeTerms = weightedLogs.map(value => {
    const delta = value - maxWeighted;
    return delta < NORMALIZATION_CUTOFF_LOG10 ? 0 : 10 ** delta;
  });
  const scaledSum = relativeTerms.reduce((sum, value) => sum + value, 0);
  if (!(scaledSum > 0 && Number.isFinite(scaledSum))) throw new RangeError('Diagnostic normalization failed.');
  const log10Z = maxWeighted + Math.log10(scaledSum);
  const logBudget = log10Rational(exactBudget);
  const entries = normalizedSlots.map((slot, index) => {
    const log10Conditional = weightedLogs[index] - log10Z;
    const q = asScientific(log10Conditional);
    const p = asScientific(logBudget + log10Conditional);
    const exactConditional = betaInfo.mode === 'auto' && betaInfo.neutralR ? slot.probability : null;
    const exactAbsolute = exactConditional ? multiplyRational(exactBudget, exactConditional) : null;
    return Object.freeze({
      titleId: slot.titleId,
      baseProbability: slot.probability,
      conditionalProbability: q,
      absoluteProbability: p,
      exactConditionalProbability: exactConditional,
      exactAbsoluteProbability: exactAbsolute,
      log10ConditionalProbability: log10Conditional.toPrecision(17)
    });
  });
  const conditionalMass = sumScientificForValidation(entries.map(entry => entry.conditionalProbability));
  const absoluteMass = sumScientificForValidation(entries.map(entry => entry.absoluteProbability));
  const budgetScientific = asScientific(logBudget);
  const budgetExponent = BigInt(budgetScientific.exponent);
  const budgetApprox = budgetExponent >= BigInt(NORMALIZATION_CUTOFF_LOG10)
    ? Number(budgetScientific.significand) * (10 ** Number(budgetExponent))
    : null;
  const conditionalMassApprox = conditionalMass.sum;
  const absoluteMassApprox = absoluteMass.sum;
  const massError = Math.abs(conditionalMassApprox - 1);
  const absoluteMassErrorRelative = budgetApprox != null && budgetApprox > 0 && Number.isFinite(budgetApprox)
    ? Math.abs(absoluteMassApprox - budgetApprox) / budgetApprox
    : null;
  if (massError > normalizationTolerance) throw new RangeError(`Conditional probabilities do not normalize within tolerance (${massError}).`);
  if (absoluteMassErrorRelative != null && absoluteMassErrorRelative > normalizationTolerance) {
    throw new RangeError(`Absolute probabilities do not sum to the cohort budget within tolerance (${absoluteMassErrorRelative}).`);
  }

  const rarityOrdered = normalizedSlots.map((slot, index) => ({ slot, result: entries[index] }))
    .sort((left, right) => compareRational(left.slot.probability, right.slot.probability));
  for (let index = 1; index < rarityOrdered.length; index++) {
    const rarer = Number(rarityOrdered[index - 1].result.log10ConditionalProbability);
    const commoner = Number(rarityOrdered[index].result.log10ConditionalProbability);
    if (commoner + normalizationTolerance < rarer) throw new RangeError('Numerical precision inverted the ordering of two cohort slots.');
  }

  return Object.freeze({
    numericAuthority: 'diagnostic-only',
    samplerEligible: false,
    engineVersion: LUCK_ENGINE_VERSION,
    curveVersion: BETA_CURVE_VERSION,
    manualPowerVersion: MANUAL_POWER_VERSION,
    cohortId,
    mode,
    beta: betaInfo.beta,
    autoBeta: betaInfo.autoBeta,
    manualFactor: betaInfo.manualFactor,
    log10R: betaInfo.log10R,
    budget: exactBudget,
    entries: Object.freeze(entries),
    precision: Object.freeze({
      method: 'binary64 log10/log-sum-exp for bounded mantissas; probabilities retained as decimal scientific significand/exponent strings',
      outputSignificantDigits: OUTPUT_SIGNIFICANT_DIGITS,
      normalizationTolerance,
      log10ProbabilityErrorEstimate: (1e-12 * (1 + maxBaseMagnitude)).toExponential(3),
      normalizationCutoffLog10: NORMALIZATION_CUTOFF_LOG10,
      droppedNormalizerTerms: relativeTerms.filter(value => value === 0).length,
      droppedNormalizerMassUpperBound: (relativeTerms.filter(value => value === 0).length * (10 ** NORMALIZATION_CUTOFF_LOG10)).toExponential(3),
      conditionalTermsBelowBinary64Validation: conditionalMass.belowBinary64Resolution,
      conditionalOmittedMassUpperBound: conditionalMass.omittedMassUpperBound,
      absoluteTermsBelowBinary64Validation: absoluteMass.belowBinary64Resolution,
      absoluteOmittedMassUpperBound: absoluteMass.omittedMassUpperBound,
      conditionalMassApprox: conditionalMassApprox.toPrecision(17),
      absoluteMassApprox: Number.isFinite(absoluteMassApprox) ? absoluteMassApprox.toPrecision(17) : 'outside-binary64-range',
      absoluteMassRelativeError: absoluteMassErrorRelative == null ? 'not-computed-below-binary64-resolution; outputs remain scientific strings' : absoluteMassErrorRelative.toExponential(3)
    })
  });
}

module.exports = {
  LUCK_ENGINE_VERSION,
  BETA_CURVE_VERSION,
  MANUAL_POWER_VERSION,
  MANUAL_BETA_FACTOR,
  parseRating,
  combineChannelRatings,
  calculateLuckBeta,
  transformCohort
};
