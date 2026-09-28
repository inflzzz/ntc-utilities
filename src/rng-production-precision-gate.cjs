'use strict';

// This gate intentionally exposes interval calculations only. It does not
// expose a sampler or a roll API, so Luck 2.0 still cannot grant outcomes.
const precision = require('./rng-luck2-precision.cjs');

function assertProductionProbabilityInterval(value) {
  return precision.assertProductionProbabilityInterval(value);
}

const createProductionIntervalBackend = precision.createProductionIntervalBackend;

module.exports = {
  assertProductionProbabilityInterval,
  createProductionIntervalBackend
};
