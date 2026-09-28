'use strict';

const FRAGMENT_RECYCLING_VERSION = 1;
const FRAGMENT_RECYCLING_UNLOCK_XP = 10n;
const MIN_PRECISION_BITS = 256;
const MAX_PRECISION_BITS = 8192;
const rewardCache = new Map();
const { ENHANCED_RECYCLING_BONUS_BPS_PER_LEVEL, FRAGMENT_BONUS_DENOMINATOR_BPS, normalizeEnhancedRecyclingProgress } = require('./rng-fragment-upgrades.cjs');

function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive.');
  return numerator <= 0n ? numerator / denominator : (numerator + denominator - 1n) / denominator;
}

// Rigorous fixed-point interval for ln(numerator / denominator), where x >= 1.
// ln(x) = 2 * (z + z^3/3 + z^5/5 + ...), z = (x - 1) / (x + 1).
function lnRationalInterval(numerator, denominator, scale) {
  if (numerator < denominator || denominator <= 0n) throw new RangeError('Expected a rational value >= 1.');
  if (numerator === denominator) return [0n, 0n];

  const delta = numerator - denominator;
  const sum = numerator + denominator;
  const zLow = delta * scale / sum;
  const zHigh = ceilDiv(delta * scale, sum);
  const zSquaredLow = zLow * zLow / scale;
  const zSquaredHigh = ceilDiv(zHigh * zHigh, scale);
  let powerLow = zLow;
  let powerHigh = zHigh;
  let lower = 0n;
  let upper = 0n;
  let odd = 1n;

  for (let terms = 0; terms < 100_000; terms++, odd += 2n) {
    lower += (2n * powerLow) / odd;
    upper += ceilDiv(2n * powerHigh, odd);

    const nextPowerLow = powerLow * zSquaredLow / scale;
    const nextPowerHigh = ceilDiv(powerHigh * zSquaredHigh, scale);
    const nextOdd = odd + 2n;
    const tail = ceilDiv(2n * nextPowerHigh * scale, nextOdd * (scale - zSquaredHigh));
    if (tail <= 1n) return [lower, upper + tail];

    powerLow = nextPowerLow;
    powerHigh = nextPowerHigh;
  }
  throw new Error('Could not bound logarithm at the requested precision.');
}

function precisionForExponent(exponent) {
  const exponentBits = BigInt(exponent).toString(2).length;
  return Math.max(MIN_PRECISION_BITS, exponentBits * 4 + 128);
}

function roundedFourthPowerInterval(lower, upper, scale) {
  const divisor = scale ** 4n;
  const lowPower = lower ** 4n;
  const highPower = upper ** 4n;
  return [
    (lowPower + divisor / 2n) / divisor,
    (highPower + divisor / 2n) / divisor
  ];
}

function fragmentValueForBaseDenominator(value) {
  let denominator;
  try { denominator = typeof value === 'bigint' ? value : BigInt(String(value)); }
  catch { throw new TypeError('Base odds denominator must be an exact positive integer.'); }
  if (denominator < 1n) throw new RangeError('Base odds denominator must be positive.');
  if (denominator === 1n) return 1n;

  const cacheKey = denominator.toString();
  if (rewardCache.has(cacheKey)) return rewardCache.get(cacheKey);

  const decimal = cacheKey;
  const exponent = BigInt(decimal.length - 1);
  const decade = 10n ** exponent;
  const log40 = 40n;
  let precisionBits = precisionForExponent(exponent);

  for (; precisionBits <= MAX_PRECISION_BITS; precisionBits *= 2) {
    const scale = 1n << BigInt(precisionBits);
    const log10Interval = lnRationalInterval(10n, 1n, scale);
    const logMantissaInterval = lnRationalInterval(denominator, decade, scale);
    const log40Interval = lnRationalInterval(log40, 1n, scale);
    const logDenominatorLow = exponent * log10Interval[0] + logMantissaInterval[0];
    const logDenominatorHigh = exponent * log10Interval[1] + logMantissaInterval[1];
    const ratioLow = logDenominatorLow * scale / log40Interval[1];
    const ratioHigh = ceilDiv(logDenominatorHigh * scale, log40Interval[0]);
    const [roundedLow, roundedHigh] = roundedFourthPowerInterval(ratioLow, ratioHigh, scale);

    if (roundedLow === roundedHigh) {
      const reward = roundedLow < 1n ? 1n : roundedLow;
      rewardCache.set(cacheKey, reward);
      return reward;
    }
  }

  throw new RangeError('Could not certify rounded Fragment value at the supported precision.');
}

function titleBaseDenominator(title, pool) {
  if (title?.denominator !== undefined && title?.denominator !== null) return BigInt(title.denominator);
  if (title?.baseDenominator !== undefined && title?.baseDenominator !== null) return BigInt(title.baseDenominator);
  if (title?.baseWeight !== undefined && pool !== undefined) {
    const weight = BigInt(title.baseWeight);
    if (weight > 0n) return (2n * BigInt(pool) + weight) / (2n * weight);
  }
  throw new TypeError('Title is missing its canonical base-odds denominator.');
}

function applyFragmentRecycling({ startingState, outcome, lifetimeXp, pool, enhancedRecyclingLevel = 0, enhancedRecyclingRemainderBps = 0 }) {
  if (!startingState || !outcome?.state || !Array.isArray(outcome.results)) throw new TypeError('A starting state and roll outcome are required.');
  let earned = 0n;
  const priorXp = BigInt(lifetimeXp ?? 0);
  const initialRolls = BigInt(startingState.totalRolls ?? 0);
  const upgrade = normalizeEnhancedRecyclingProgress({ enhancedRecyclingLevel, enhancedRecyclingRemainderBps });
  const upgradeLevel = BigInt(upgrade.enhancedRecyclingLevel);
  let upgradeRemainderBps = BigInt(upgrade.enhancedRecyclingRemainderBps);

  const results = outcome.results.map(result => {
    let reward = 0n;
    const resultRoll = BigInt(result.roll ?? initialRolls + 1n);
    const rollOffset = resultRoll > initialRolls ? resultRoll - initialRolls - 1n : 0n;
    const recyclingWasUnlocked = priorXp + rollOffset >= FRAGMENT_RECYCLING_UNLOCK_XP;
    if (recyclingWasUnlocked && !result.isNew) {
      const baseReward = fragmentValueForBaseDenominator(titleBaseDenominator(result.title, pool));
      // Exact fixed-point arithmetic: round the bonus down per duplicate and
      // carry its fractional remainder (1/10,000 Fragmento units) forward.
      // This preserves small 10% bonuses without floating point or lost fractions.
      const bonusNumerator = baseReward * upgradeLevel * ENHANCED_RECYCLING_BONUS_BPS_PER_LEVEL + upgradeRemainderBps;
      const bonus = bonusNumerator / FRAGMENT_BONUS_DENOMINATOR_BPS;
      upgradeRemainderBps = bonusNumerator % FRAGMENT_BONUS_DENOMINATOR_BPS;
      reward = baseReward + bonus;
      earned += reward;
    }
    const specialUnlocks = Array.isArray(result.specialUnlocks)
      ? result.specialUnlocks.map(unlock => unlock?.fragmentReward === undefined ? unlock : { ...unlock, fragmentReward: '0' })
      : result.specialUnlocks;
    return { ...result, specialUnlocks, fragmentReward: reward.toString(), fragmentDuplicate: reward > 0n };
  });

  const state = {
    ...outcome.state,
    fragmentBalance: (BigInt(startingState.fragmentBalance ?? 0) + earned).toString(),
    fragmentRewardRemainderBps: 0
  };
  return { ...outcome, state, results, fragmentTotal: earned.toString(), enhancedRecyclingRemainderBps: Number(upgradeRemainderBps) };
}

function migrateLegacyFragmentSave(value = {}) {
  const version = Number.isSafeInteger(value.fragmentRecyclingVersion) ? value.fragmentRecyclingVersion : 0;
  if (version >= FRAGMENT_RECYCLING_VERSION) return { state: value, migrated: false };
  return {
    state: {
      ...value,
      fragmentBalance: '0',
      fragmentRewardRemainderBps: 0,
      fragmentRecyclingVersion: FRAGMENT_RECYCLING_VERSION
    },
    migrated: true
  };
}

module.exports = {
  FRAGMENT_RECYCLING_VERSION,
  FRAGMENT_RECYCLING_UNLOCK_XP,
  fragmentValueForBaseDenominator,
  applyFragmentRecycling,
  migrateLegacyFragmentSave
};
