const test = require('node:test');
const assert = require('node:assert/strict');
const { TrustedClock } = require('../src/rng-time.cjs');
const { eventSchedule, joinEvent, activeEvent, LIMITED_REWARDS } = require('../src/rng-events.cjs');
const { POOL, TITLES, SECRETS, normalizeState, publicCatalog, currentWeights, rollTitle, equalHourBonusAt } = require('../src/rng.cjs');

function valueFor(state, titleId, options = {}) {
  const weights = currentWeights(state, options);
  let offset = 0n;
  for (const title of TITLES) {
    if (title.id === titleId) return offset;
    offset += weights.get(title.id);
  }
  throw new Error(`Missing ${titleId}`);
}

test('verified UTC ignores PC date, time, and timezone changes; fallback and expiry work', async () => {
  let mono = 5_000_000_000n;
  const clock = new TrustedClock({ monotonic: () => mono, request: async url => {
    if (url.includes('utctime.app')) throw new Error('primary offline');
    return { year: 2026, month: 9, day: 24, hour: 22, minute: 0, seconds: 0, milliSeconds: 0 };
  } });
  await clock.sync();
  assert.equal(clock.now(), Date.UTC(2026, 8, 24, 22));
  const originalTimezone = process.env.TZ;
  const originalDateNow = Date.now;
  process.env.TZ = 'Pacific/Honolulu';
  Date.now = () => Date.UTC(2099, 0, 1);
  try {
    mono += 90_000_000_000n;
    assert.equal(clock.now(), Date.UTC(2026, 8, 24, 22, 1, 30));
    assert.equal(equalHourBonusAt(Date.UTC(2026, 8, 24, 23, 20)).time, '20:20');
  } finally { Date.now = originalDateNow; if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; }
  mono += 220_000_000_000n;
  assert.equal(clock.now(), null, 'stale anchors never authorize calendar bonuses');
  await clock.sync();
  clock.invalidate();
  assert.equal(clock.now(), null, 'suspend/resume invalidates the anchor');
  assert.equal(new TrustedClock({ monotonic: () => mono }).now(), null, 'restart requires a new online verification');
  const offline = new TrustedClock({ request: async () => { throw new Error('offline'); } });
  assert.equal((await offline.sync()).verified, false);
});

test('event participation respects exact UTC boundaries and a fixed edition', () => {
  const start = Date.UTC(2026, 8, 24, 22);
  const rain = eventSchedule(start)[0];
  assert.equal(rain.eventId, 'rain');
  assert.equal(rain.startUtc, start);
  assert.throws(() => joinEvent(start - 1, rain.id));
  assert.equal(joinEvent(start, rain.id), rain.id);
  assert.equal(activeEvent(start + 599_999, rain.id)?.multiplier, 2);
  assert.equal(activeEvent(start + 600_000, rain.id), null);
  assert.throws(() => joinEvent(null, rain.id));
  const eclipse = eventSchedule(Date.UTC(2026, 8, 26, 23))[0];
  assert.equal(eclipse.eventId, 'eclipse');
  assert.equal(eclipse.multiplier, 5);
  assert.equal(LIMITED_REWARDS.filter(reward => reward.eventId === 'rain').length, 1);
  assert.equal(LIMITED_REWARDS.filter(reward => reward.eventId === 'eclipse').length, 1);
  const focus = eventSchedule(Date.UTC(2026, 8, 23, 23)).find(window => window.eventId === 'focus');
  assert.equal(focus.focusTierId, 'epic');
  assert.equal(focus.focusMultiplier, 3);
  const fragments = eventSchedule(Date.UTC(2026, 8, 27, 20)).find(window => window.eventId === 'fragments');
  assert.equal(fragments.durationMinutes, 25);
  assert.equal(fragments.reward.rollGoal, 1_000);
  assert.ok(LIMITED_REWARDS.filter(reward => reward.eventId === 'fragments').every(reward => reward.rollGoal === 1_000));
});

test('fragment event guarantees its edition title at exactly 1,000 participating rolls', () => {
  const fragments = eventSchedule(Date.UTC(2026, 8, 27, 20)).find(window => window.eventId === 'fragments');
  let state = {};
  for (let count = 0; count < 999; count++) {
    state = rollTitle(state, 0n, { rolledAt: fragments.startUtc, event: fragments }).state;
  }
  assert.equal(state.eventRollProgress.rolls, 999);
  assert.equal(state.limitedTitles.includes(fragments.reward.titleId), false);
  const finalRoll = rollTitle(state, 0n, { rolledAt: fragments.startUtc, event: fragments });
  assert.equal(finalRoll.state.eventRollProgress.rolls, 1_000);
  assert.equal(finalRoll.state.limitedTitles.includes(fragments.reward.titleId), true);
  assert.ok(finalRoll.specialUnlocks.some(item => item.id === fragments.reward.titleId));
});

test('event boost stacks but cannot push non-Basic above 50% unless already there', () => {
  const rare = weights => TITLES.filter(title => title.tier !== 'basic').reduce((sum, title) => sum + weights.get(title.id), 0n);
  const base = rare(currentWeights({}));
  const event = rare(currentWeights({}, { eventMultiplier: 5 }));
  assert.ok(event >= base);
  assert.ok(event <= POOL / 2n);
  const huge = { collectedIds: TITLES.filter(title => title.tier === 'basic').map(title => title.id) };
  const existing = rare(currentWeights(huge, { bonusRoll: true, thousandRollBonus: true, tenThousandRollBonus: true }));
  const boosted = rare(currentWeights(huge, { bonusRoll: true, thousandRollBonus: true, tenThousandRollBonus: true, eventMultiplier: 5 }));
  assert.ok(boosted >= existing);
  assert.equal([...currentWeights({}, { eventMultiplier: 5 }).values()].reduce((a, b) => a + b, 0n), POOL);
});

test('legacy saves migrate without inventing historical counts or timestamps', () => {
  const legacy = normalizeState({ totalRolls: 10_000, collectedIds: ['basic-01', 'mythic-01'], recentDiscoveries: [{ titleId: 'mythic-01', roll: 9999 }] });
  assert.equal(legacy.totalRolls, 10_000);
  assert.equal(legacy.trackedRolls, 0);
  assert.equal(legacy.sinceSingular, null);
  assert.equal(legacy.titleHistory[0].rolledAt, 0);
  assert.equal(legacy.unlockedSecrets.length, 0);
  assert.equal(publicCatalog(legacy).find(title => title.id === 'mythic-01').name, TITLES.find(title => title.id === 'mythic-01').name);
  assert.equal(publicCatalog(legacy).find(title => title.id === 'mythic-02').name, '???');
  assert.equal(normalizeState(JSON.parse(JSON.stringify(legacy))).trackedRolls, 0);
});

test('tracked rolls count rarities, duplicates, streaks, and secrets without adding to /200', () => {
  let state = normalizeState({ totalRolls: 77_776 });
  let result = rollTitle(state, 0n);
  state = result.state;
  assert.ok(state.unlockedSecrets.includes('secret-77777'));
  for (let i = 0; i < 6; i++) state = rollTitle(state, 0n).state;
  assert.ok(state.unlockedSecrets.includes('secret-seven'));
  assert.equal(state.duplicateRolls, 6);
  assert.equal(state.tierRolls.basic, 7);
  assert.equal(state.trackedRolls, 7);
  assert.equal(state.collectedIds.length, 1);
  assert.equal(SECRETS.length, 6);
});

test('one-in-a-million at x1, consecutive Singular+, and one-hour Auto-roll unlock independently', () => {
  let state = normalizeState();
  const rare = TITLES.find(title => title.denominator >= 1_000_000n && title.tier === 'unique');
  let outcome = rollTitle(state, valueFor(state, rare.id));
  state = outcome.state;
  assert.ok(state.unlockedSecrets.includes('secret-million'));
  outcome = rollTitle(state, valueFor(state, rare.id));
  state = outcome.state;
  assert.ok(state.unlockedSecrets.includes('secret-pair'));
  state = rollTitle(state, 0n, { autoRollSeconds: 3599 }).state;
  assert.ok(!state.unlockedSecrets.includes('secret-autohour'));
  state = rollTitle(state, 0n, { autoRollSeconds: 3600 }).state;
  assert.ok(state.unlockedSecrets.includes('secret-autohour'));
});

test('Basic at x100 unlocks the secret and discovery history records stacked event boosts', () => {
  const state = normalizeState({ totalRolls: 9_999, bonusRollCounter: 9, collectedIds: TITLES.slice(1, 51).map(title => title.id) });
  const event = { id: 'rain:test', name: 'Chuva de Sorte', multiplier: 2 };
  const outcome = rollTitle(state, 0n, { event, rolledAt: Date.UTC(2026, 8, 24, 22) });
  assert.ok(outcome.state.unlockedSecrets.includes('secret-hundred'));
  assert.equal(outcome.eventMultiplier, 2);
  assert.equal(outcome.isTenThousandRollBonus, true);
  assert.equal(outcome.isThousandRollBonus, true);
  assert.equal(outcome.state.trackedRolls, 1);
  assert.equal(outcome.state.titleHistory[0].eventName, 'Chuva de Sorte');
  assert.equal(outcome.state.titleHistory[0].eventMultiplier, 2);
});

test('limited reward only drops inside its one-off edition and remains outside the catalog', () => {
  const edition = eventSchedule(Date.UTC(2026, 9, 1, 22))[0];
  assert.equal(edition.reward?.titleId, 'limited-first-rain');
  const outcome = rollTitle({}, 0n, { rolledAt: edition.startUtc, event: edition, limitedRewardValue: 0n });
  assert.ok(outcome.state.limitedTitles.includes('limited-first-rain'));
  assert.equal(outcome.state.collectedIds.length, 1);
  assert.equal(publicCatalog(outcome.state).length, 200);
  assert.equal(eventSchedule(Date.UTC(2026, 9, 2, 22))[0].reward, null);
});
