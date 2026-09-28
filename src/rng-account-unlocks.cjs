'use strict';

const RECYCLING_UNLOCK_LEVEL = 2n;
const AUTO_ROLL_UNLOCK_LEVEL = 3n;
const IMPROVEMENTS_UNLOCK_LEVEL = 4n;
const ACCOUNT_SYSTEM_UNLOCKS = Object.freeze([
  Object.freeze({ id: 'fragment-recycling', level: RECYCLING_UNLOCK_LEVEL }),
  Object.freeze({ id: 'auto-roll', level: AUTO_ROLL_UNLOCK_LEVEL }),
  Object.freeze({ id: 'improvements', level: IMPROVEMENTS_UNLOCK_LEVEL })
]);

function accountLevel(value) {
  try { return typeof value === 'bigint' ? value : BigInt(String(value ?? '1')); }
  catch { return 0n; }
}

function isFragmentRecyclingUnlocked(level) {
  return accountLevel(level) >= RECYCLING_UNLOCK_LEVEL;
}

function isAutoRollUnlocked(level) {
  return accountLevel(level) >= AUTO_ROLL_UNLOCK_LEVEL;
}

function normalizeAcknowledgedSystemUnlocks(value) {
  const allowed = new Set(ACCOUNT_SYSTEM_UNLOCKS.map(unlock => unlock.id));
  return [...new Set((Array.isArray(value) ? value : []).filter(id => allowed.has(id)))];
}

function pendingAccountSystemUnlock(level, acknowledged = []) {
  const currentLevel = accountLevel(level);
  const acknowledgedIds = new Set(normalizeAcknowledgedSystemUnlocks(acknowledged));
  return ACCOUNT_SYSTEM_UNLOCKS.find(unlock => currentLevel >= unlock.level && !acknowledgedIds.has(unlock.id)) || null;
}

function canAcknowledgeAccountSystemUnlock(id, level) {
  const unlock = ACCOUNT_SYSTEM_UNLOCKS.find(item => item.id === id);
  return Boolean(unlock && accountLevel(level) >= unlock.level);
}

module.exports = {
  RECYCLING_UNLOCK_LEVEL,
  AUTO_ROLL_UNLOCK_LEVEL,
  IMPROVEMENTS_UNLOCK_LEVEL,
  ACCOUNT_SYSTEM_UNLOCKS,
  isFragmentRecyclingUnlocked,
  isAutoRollUnlocked,
  normalizeAcknowledgedSystemUnlocks,
  pendingAccountSystemUnlock,
  canAcknowledgeAccountSystemUnlock
};
