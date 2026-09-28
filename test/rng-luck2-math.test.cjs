'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MANUAL_BETA_FACTOR,
  parseRating,
  combineChannelRatings,
  calculateLuckBeta,
  transformCohort
} = require('../src/rng-luck2-math.cjs');
const {
  assertProductionProbabilityInterval,
  createProductionIntervalBackend
} = require('../src/rng-production-precision-gate.cjs');

const q = (numerator, denominator = '1') => ({ numerator: String(numerator), denominator: String(denominator) });
const beta = (rating, mode = 'auto', channels = {}) => calculateLuckBeta({
  channels: { coreLuck: rating, buildLuck: '1', temporaryLuck: '1', ...channels },
  mode
});

test('ratings use canonical decimal/scientific strings and never coerce giant R to Number', () => {
  assert.deepEqual(parseRating('1'), { coefficient: '1', exponent: '0' });
  assert.deepEqual(parseRating('10'), { coefficient: '1', exponent: '1' });
  assert.deepEqual(parseRating('1.250e20'), { coefficient: '125', exponent: '18' });
  assert.equal(parseRating('1e1000').exponent, '1000');
  assert.equal(parseRating(`1e${'9'.repeat(400)}`).exponent, '9'.repeat(400));
  assert.throws(() => parseRating(1e20), /Number is not accepted/);
  assert.throws(() => parseRating('0.99'), /at least 1/);
  assert.throws(() => parseRating('1e-1000'), /at least 1/);
  assert.ok(Number(beta('1.00000000000000000001').beta) < 1, 'every supported R>1 must produce beta<1');
});

test('neutral channels combine to R=1 and Auto beta is exactly 1', () => {
  const combined = combineChannelRatings({ coreLuck: '1', buildLuck: '1', temporaryLuck: '1' });
  assert.deepEqual(combined.log10R, { whole: '0', fraction: '0.0000000000000000' });
  const result = calculateLuckBeta({ channels: { coreLuck: '1', buildLuck: '1', temporaryLuck: '1' }, mode: 'auto' });
  assert.equal(result.beta, '1.0000000000000000');
  assert.equal(result.neutralR, true);
  assert.equal(result.numericAuthority, 'diagnostic-only');
  assert.equal(result.samplerEligible, false);
});

test('diagnostic transforms cannot pass the production sampling authority gate', async () => {
  const result = transformCohort({
    slots: [{ titleId: 'x', probability: q(1) }],
    channels: { coreLuck: '1' },
    mode: 'auto'
  });
  assert.equal(result.numericAuthority, 'diagnostic-only');
  assert.equal(result.samplerEligible, false);
  assert.throws(() => assertProductionProbabilityInterval(result), /production-authoritative probability interval/);
  const backend = await createProductionIntervalBackend();
  assert.equal(backend.metadata.mpfrVersion, '4.2.1');
  assert.equal(backend.metadata.supportStatus, 'certified-supported');
});

test('approved B∞ curve is positive, finite and monotonically decreasing across required scales', () => {
  const ratings = ['1', '3', '20', '100', '1e5', '1e8', '1e20', '1e100', '1e500', '1e1000', '1e1000000', `1e${'9'.repeat(400)}`];
  let previous = 1;
  for (const rating of ratings) {
    const current = Number(beta(rating).beta);
    assert.ok(current > 0 && current <= previous, `beta should decrease for R=${rating}`);
    assert.ok(Number.isFinite(current));
    previous = current;
  }
});

test('Luck channels combine commutatively and splitting the same product does not change beta', () => {
  const unsplit = calculateLuckBeta({ channels: { coreLuck: '1000000', buildLuck: '1', temporaryLuck: '1' }, mode: 'auto' });
  const split = calculateLuckBeta({ channels: { coreLuck: '1000', buildLuck: '1000', temporaryLuck: '1' }, mode: 'auto' });
  const permuted = calculateLuckBeta({ channels: { coreLuck: '1', buildLuck: '1000000', temporaryLuck: '1' }, mode: 'auto' });
  const splitDecimal = calculateLuckBeta({ channels: { coreLuck: '1.5', buildLuck: '2', temporaryLuck: '1' }, mode: 'auto' });
  const unsplitDecimal = calculateLuckBeta({ channels: { coreLuck: '3', buildLuck: '1', temporaryLuck: '1' }, mode: 'auto' });
  assert.equal(unsplit.beta, split.beta);
  assert.equal(unsplit.beta, permuted.beta);
  assert.equal(splitDecimal.beta, unsplitDecimal.beta);
});

test('B∞ beta matches the approved formula at an independently checked point', () => {
  const log10R = Math.log10(3);
  const expected = 1 / (1 + 0.13 * Math.log10(1 + log10R));
  assert.ok(Math.abs(Number(beta('3').beta) - expected) < 2e-16);
});

test('increasing any channel cannot increase beta and Drop Luck is rejected as a separate attribute', () => {
  const baseline = calculateLuckBeta({ channels: { coreLuck: '20', buildLuck: '10', temporaryLuck: '1' }, mode: 'auto' });
  for (const channel of ['coreLuck', 'buildLuck', 'temporaryLuck']) {
    const channels = { coreLuck: '20', buildLuck: '10', temporaryLuck: '1' };
    channels[channel] = channel === 'coreLuck' ? '200' : channel === 'buildLuck' ? '100' : '10';
    assert.ok(Number(calculateLuckBeta({ channels, mode: 'auto' }).beta) < Number(baseline.beta));
  }
  assert.throws(() => calculateLuckBeta({ channels: { coreLuck: '1', dropLuck: '500' }, mode: 'auto' }), /Drop Luck is independent/);
});

test('mode is mandatory and unsupported modes fail closed', () => {
  assert.throws(() => calculateLuckBeta({ channels: { coreLuck: '1' } }), /mode must be explicitly/);
  assert.throws(() => calculateLuckBeta({ channels: { coreLuck: '1' }, mode: 'drop' }), /mode must be explicitly/);
});

test('Manual beta applies the versioned exact 199/200 factor once at every tested Luck scale', () => {
  assert.deepEqual(MANUAL_BETA_FACTOR, { numerator: '199', denominator: '200' });
  for (const rating of ['1', '3', '20', '100', '1e5', '1e8', '1e20', '1e100', '1e500', '1e1000', '1e1000000']) {
    const auto = Number(beta(rating, 'auto').beta);
    const manual = Number(beta(rating, 'manual').beta);
    assert.ok(manual > 0 && manual < auto, `Manual beta must remain lower for R=${rating}`);
    assert.ok(Math.abs(manual / auto - 0.995) < 2e-15, `Manual factor changed for R=${rating}`);
  }
  assert.equal(beta('1', 'manual').beta, '0.99500000000000000');
});

test('independent synthetic cohort returns exact base distribution at neutral Auto', () => {
  const slots = [
    { titleId: 'common', probability: q(7, 10) },
    { titleId: 'middle', probability: q(1, 4) },
    { titleId: 'rare', probability: q(1, 20) }
  ];
  const result = transformCohort({ slots, budget: q(1, 3), channels: { coreLuck: '1' }, mode: 'auto' });
  assert.deepEqual(result.entries.map(entry => entry.exactConditionalProbability), slots.map(slot => slot.probability));
  assert.deepEqual(result.entries.map(entry => entry.exactAbsoluteProbability), [q(7, 30), q(1, 12), q(1, 60)]);
  assert.equal(Number(result.precision.conditionalMassApprox), 1);
  assert.ok(Math.abs(Number(result.precision.absoluteMassRelativeError)) < 1e-15);
});

test('Manual transformation matches an independently calculated three-slot power normalization', () => {
  const probabilities = [0.8, 0.15, 0.05];
  const factor = 0.995;
  const powered = probabilities.map(value => Math.pow(value, factor));
  const total = powered.reduce((sum, value) => sum + value, 0);
  const expected = powered.map(value => value / total);
  const result = transformCohort({
    slots: [
      { titleId: 'common', probability: q(4, 5) },
      { titleId: 'mid', probability: q(3, 20) },
      { titleId: 'rare', probability: q(1, 20) }
    ],
    channels: { coreLuck: '1' },
    mode: 'manual'
  });
  const actual = result.entries.map(entry => Number(entry.conditionalProbability.significand) * 10 ** Number(entry.conditionalProbability.exponent));
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 2e-14));
});

test('diagnostic transform preserves order, normalizes mass and keeps 1e-1000 nonzero', () => {
  const slots = [
    { titleId: 'common', probability: q(9, 10) },
    { titleId: 'middle', probability: q(99, 1000) },
    { titleId: 'rare', probability: q(1, `1${'0'.repeat(1000)}`) }
  ];
  // The common weight is the exact complement of the two rare weights.
  const rareTotal = { numerator: '1', denominator: `1${'0'.repeat(1000)}` };
  const middle = q(1, 10);
  const common = {
    numerator: (BigInt(middle.denominator) * BigInt(rareTotal.denominator) - BigInt(middle.numerator) * BigInt(rareTotal.denominator) - BigInt(rareTotal.numerator) * BigInt(middle.denominator)).toString(),
    denominator: (BigInt(middle.denominator) * BigInt(rareTotal.denominator)).toString()
  };
  slots[0].probability = common;
  slots[1].probability = q(1, 10);
  const result = transformCohort({ slots, budget: q(1, 5), channels: { coreLuck: '1e1000', buildLuck: '1' }, mode: 'auto' });
  const rare = result.entries.find(entry => entry.titleId === 'rare');
  assert.notEqual(rare.conditionalProbability.significand, '0');
  assert.notEqual(rare.absoluteProbability.significand, '0');
  assert.ok(BigInt(rare.conditionalProbability.exponent) < -600n);
  assert.ok(Number(result.precision.conditionalTermsBelowBinary64Validation) >= 1);
  assert.equal(rare.conditionalProbability.format, 'significand × 10^exponent');
  assert.ok(Math.abs(Number(result.precision.conditionalMassApprox) - 1) < 1e-12);
  assert.ok(Math.abs(Number(result.precision.absoluteMassRelativeError)) < 1e-12);
  assert.ok(Number(result.precision.log10ProbabilityErrorEstimate) < 1e-8);
});

test('higher Luck increases rare-to-common relative weight without reversing the roster order', () => {
  const slots = [
    { titleId: 'common', probability: q(99, 100) },
    { titleId: 'rare', probability: q(1, 100) }
  ];
  const neutral = transformCohort({ slots, channels: { coreLuck: '1' }, mode: 'auto' });
  const lucked = transformCohort({ slots, channels: { coreLuck: '1e100' }, mode: 'auto' });
  const qCommonNeutral = Number(neutral.entries[0].conditionalProbability.significand) * 10 ** Number(neutral.entries[0].conditionalProbability.exponent);
  const qRareNeutral = Number(neutral.entries[1].conditionalProbability.significand) * 10 ** Number(neutral.entries[1].conditionalProbability.exponent);
  const qCommonLucked = Number(lucked.entries[0].conditionalProbability.significand) * 10 ** Number(lucked.entries[0].conditionalProbability.exponent);
  const qRareLucked = Number(lucked.entries[1].conditionalProbability.significand) * 10 ** Number(lucked.entries[1].conditionalProbability.exponent);
  assert.ok(qRareLucked / qCommonLucked > qRareNeutral / qCommonNeutral);
  assert.ok(qCommonLucked > qRareLucked);
});

test('manual mode also returns every rare slot as nonzero scientific notation', () => {
  const result = transformCohort({
    slots: [{ titleId: 'common', probability: q(1, 2) }, { titleId: 'rare', probability: q(1, 2) }],
    channels: { coreLuck: '1e500' },
    mode: 'manual'
  });
  assert.equal(result.mode, 'manual');
  assert.ok(result.entries.every(entry => Number(entry.conditionalProbability.significand) > 0));
  assert.ok(result.entries.every(entry => Number(entry.absoluteProbability.significand) > 0));
});
