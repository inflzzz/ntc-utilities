'use strict';

// Account progression is deliberately isolated from the RNG probability model.
// Level L requires 10 * L XP to reach L + 1, for a cumulative threshold of
// 5 * L * (L - 1) XP from the initial level 1.
const XP_PER_LEVEL_STEP = 10n;

function nonNegativeBigInt(value, fallback = 0n) {
  try {
    if (typeof value === 'bigint') return value >= 0n ? value : fallback;
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : fallback;
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  } catch { /* Use the safe default for malformed persisted data. */ }
  return fallback;
}

function integerSquareRoot(value) {
  if (value < 0n) throw new RangeError('integerSquareRoot requires a non-negative integer.');
  if (value < 2n) return value;
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (estimate + value / estimate) >> 1n;
    if (next >= estimate) return estimate;
    estimate = next;
  }
}

function xpRequiredToReachLevel(level) {
  const safeLevel = nonNegativeBigInt(level, 1n);
  const normalizedLevel = safeLevel < 1n ? 1n : safeLevel;
  return 5n * normalizedLevel * (normalizedLevel - 1n);
}

function xpRequiredForNextLevel(level) {
  const safeLevel = nonNegativeBigInt(level, 1n);
  return XP_PER_LEVEL_STEP * (safeLevel < 1n ? 1n : safeLevel);
}

function countProcessedRolls(previousTotalRolls, nextTotalRolls) {
  const toCount = value => {
    if (typeof value === 'bigint' && value >= 0n) return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
    throw new RangeError('Roll counters must be non-negative exact integers.');
  };
  const previous = toCount(previousTotalRolls);
  const next = toCount(nextTotalRolls);
  if (next < previous) throw new RangeError('Processed roll count cannot move backwards.');
  return next - previous;
}

function accountProgressFromLifetimeXp(lifetimeXp) {
  const total = nonNegativeBigInt(lifetimeXp);
  // Largest L satisfying 5*L*(L-1) <= total, calculated exactly in BigInt.
  const discriminant = 1n + (4n * total) / 5n;
  const level = (1n + integerSquareRoot(discriminant)) / 2n;
  const levelStartXp = xpRequiredToReachLevel(level);
  const xpToNextLevel = xpRequiredForNextLevel(level);
  const xpIntoLevel = total - levelStartXp;
  const progressBasisPoints = Number((xpIntoLevel * 10_000n) / xpToNextLevel);
  return {
    accountLevel: level.toString(),
    accountXp: xpIntoLevel.toString(),
    lifetimeAccountXp: total.toString(),
    xpToNextLevel: xpToNextLevel.toString(),
    progressBasisPoints
  };
}

function normalizeAccountProgress(value = {}) {
  const progress = accountProgressFromLifetimeXp(value?.lifetimeAccountXp);
  return {
    accountLevel: progress.accountLevel,
    accountXp: progress.accountXp,
    lifetimeAccountXp: progress.lifetimeAccountXp
  };
}

function grantAccountXp(state = {}, amount = 0n) {
  const normalized = normalizeAccountProgress(state);
  const grant = nonNegativeBigInt(amount);
  return { ...state, ...normalizeAccountProgress({ lifetimeAccountXp: BigInt(normalized.lifetimeAccountXp) + grant }) };
}

function getAccountProgress(state = {}) {
  const progress = accountProgressFromLifetimeXp(normalizeAccountProgress(state).lifetimeAccountXp);
  return {
    level: progress.accountLevel,
    xp: progress.accountXp,
    xpToNextLevel: progress.xpToNextLevel,
    lifetimeXp: progress.lifetimeAccountXp,
    progressBasisPoints: progress.progressBasisPoints
  };
}

module.exports = {
  XP_PER_LEVEL_STEP,
  integerSquareRoot,
  xpRequiredToReachLevel,
  xpRequiredForNextLevel,
  countProcessedRolls,
  accountProgressFromLifetimeXp,
  normalizeAccountProgress,
  grantAccountXp,
  getAccountProgress
};
