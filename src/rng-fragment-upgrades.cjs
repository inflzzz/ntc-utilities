'use strict';

const { normalizeAccountProgress } = require('./rng-account-level.cjs');

const ENHANCED_RECYCLING_UNLOCK_LEVEL = 4n;
const ENHANCED_RECYCLING_MAX_LEVEL = 5;
const ENHANCED_RECYCLING_BONUS_BPS_PER_LEVEL = 1_000n;
const ENHANCED_RECYCLING_COSTS = Object.freeze(['25', '75', '200', '500', '1250']);
const FRAGMENT_BONUS_DENOMINATOR_BPS = 10_000n;

function exactNonNegativeInteger(value, fallback = 0n) {
  try {
    if (typeof value === 'bigint') return value >= 0n ? value : fallback;
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : fallback;
    if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  } catch { /* Fall through to the safe default. */ }
  return fallback;
}

function normalizeEnhancedRecyclingProgress(value = {}) {
  const level = exactNonNegativeInteger(value.enhancedRecyclingLevel);
  const remainder = exactNonNegativeInteger(value.enhancedRecyclingRemainderBps);
  return {
    enhancedRecyclingLevel: Number(level > BigInt(ENHANCED_RECYCLING_MAX_LEVEL) ? BigInt(ENHANCED_RECYCLING_MAX_LEVEL) : level),
    enhancedRecyclingRemainderBps: Number(remainder % FRAGMENT_BONUS_DENOMINATOR_BPS)
  };
}

function normalizeRngAccountProgress(value = {}) {
  return { ...normalizeAccountProgress(value), ...normalizeEnhancedRecyclingProgress(value) };
}

function enhancedRecyclingSummary(levelValue, accountLevelValue) {
  const { enhancedRecyclingLevel: level } = normalizeEnhancedRecyclingProgress({ enhancedRecyclingLevel: levelValue });
  const accountLevel = exactNonNegativeInteger(accountLevelValue, 1n);
  const unlocked = accountLevel >= ENHANCED_RECYCLING_UNLOCK_LEVEL;
  const maxed = level >= ENHANCED_RECYCLING_MAX_LEVEL;
  return {
    unlocked,
    level,
    maxLevel: ENHANCED_RECYCLING_MAX_LEVEL,
    bonusPercent: level * 10,
    nextBonusPercent: maxed ? level * 10 : (level + 1) * 10,
    nextCost: maxed ? null : ENHANCED_RECYCLING_COSTS[level]
  };
}

function purchaseEnhancedRecycling({ accountLevel, level, fragmentBalance }) {
  const account = exactNonNegativeInteger(accountLevel, 1n);
  const currentLevel = normalizeEnhancedRecyclingProgress({ enhancedRecyclingLevel: level }).enhancedRecyclingLevel;
  let balance;
  try { balance = BigInt(String(fragmentBalance ?? '0')); }
  catch { return { ok: false, reason: 'invalid-balance' }; }
  if (balance < 0n) return { ok: false, reason: 'invalid-balance' };
  if (account < ENHANCED_RECYCLING_UNLOCK_LEVEL) return { ok: false, reason: 'upgrade-locked' };
  if (currentLevel >= ENHANCED_RECYCLING_MAX_LEVEL) return { ok: false, reason: 'max-level' };

  const cost = BigInt(ENHANCED_RECYCLING_COSTS[currentLevel]);
  if (balance < cost) return { ok: false, reason: 'insufficient-fragments', cost: cost.toString() };
  return { ok: true, level: currentLevel + 1, fragmentBalance: (balance - cost).toString(), cost: cost.toString() };
}

module.exports = {
  ENHANCED_RECYCLING_UNLOCK_LEVEL,
  ENHANCED_RECYCLING_MAX_LEVEL,
  ENHANCED_RECYCLING_BONUS_BPS_PER_LEVEL,
  ENHANCED_RECYCLING_COSTS,
  FRAGMENT_BONUS_DENOMINATOR_BPS,
  normalizeEnhancedRecyclingProgress,
  normalizeRngAccountProgress,
  enhancedRecyclingSummary,
  purchaseEnhancedRecycling
};
