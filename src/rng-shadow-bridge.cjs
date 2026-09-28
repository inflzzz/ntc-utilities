'use strict';

// This bridge deliberately executes the legacy function first and exactly
// once. It never accepts a state/outcome to forward to the shadow worker.
function runLegacyRollWithShadow({ legacyRoll, manual = false, shadowService = null } = {}) {
  if (typeof legacyRoll !== 'function') throw new TypeError('legacyRoll must be a function');
  const legacyOutcome = legacyRoll();
  if (!manual && shadowService && typeof shadowService.scheduleAutoRoll === 'function') {
    try { shadowService.scheduleAutoRoll(); } catch { /* shadow diagnostics are disposable */ }
  }
  return legacyOutcome;
}

module.exports = { runLegacyRollWithShadow };
