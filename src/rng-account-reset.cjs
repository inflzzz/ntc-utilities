'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeState } = require('./rng.cjs');
const { normalizeRngAccountProgress } = require('./rng-fragment-upgrades.cjs');
const { FRAGMENT_RECYCLING_VERSION } = require('./rng-fragments.cjs');

function createInitialRngAccount() {
  return {
    rngGame: normalizeState(),
    accountProgress: normalizeRngAccountProgress()
  };
}

function serializeRngAccountSave(rngGame, accountProgress) {
  return JSON.stringify({ ...rngGame, fragmentRecyclingVersion: FRAGMENT_RECYCLING_VERSION, accountProgress: { schemaVersion: 1, ...accountProgress } });
}

function persistInitialRngAccount({ statePath, backupPath, rngGame, accountProgress }) {
  if (!statePath || !backupPath) throw new TypeError('Separate RNG save and backup paths are required.');
  const primary = path.resolve(statePath);
  const backup = path.resolve(backupPath);
  if (primary === backup) throw new TypeError('Separate RNG save and backup paths are required.');

  const primaryTemp = `${primary}.reset.tmp`;
  const backupTemp = `${backup}.reset.tmp`;
  const serialized = serializeRngAccountSave(rngGame, accountProgress);
  fs.mkdirSync(path.dirname(primary), { recursive: true });
  try {
    fs.writeFileSync(primaryTemp, serialized);
    fs.writeFileSync(backupTemp, serialized);
    // Replace the recovery copy first. If the following primary rename fails,
    // the old primary remains valid and the caller can report/retry the reset.
    fs.renameSync(backupTemp, backup);
    fs.renameSync(primaryTemp, primary);
  } catch (error) {
    for (const temporary of [primaryTemp, backupTemp]) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* Preserve the original persistence error. */ }
    }
    throw error;
  }
}

module.exports = { createInitialRngAccount, serializeRngAccountSave, persistInitialRngAccount };
