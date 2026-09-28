const test = require('node:test');
const assert = require('node:assert/strict');
const { collectCandidates, appendToQueue } = require('../src/rng-reveal-queue.js');

test('queues every new title and special reward in roll order, title before same-roll rewards', () => {
  const candidates = collectCandidates([
    { roll: 12, isNew: false, title: { id: 'repeat' }, specialUnlocks: [{ id: 'relic-a', relicId: 'relic-a', name: 'Bolsa', tierLabel: 'Relíquia' }] },
    { roll: 10, isNew: true, title: { id: 'title-a', name: 'A', tier: 'basic' }, specialUnlocks: [{ id: 'secret-a', name: 'Segredo', tierLabel: 'Segredo' }] },
    { roll: 11, isNew: true, title: { id: 'title-b', name: 'B', tier: 'epic' }, specialUnlocks: [] }
  ], 9);

  assert.deepEqual(candidates.map(({ eventKey }) => eventKey), [
    'title:10:title-a',
    'special:10:secret-a:0',
    'title:11:title-b',
    'special:12:relic-a:0'
  ]);
  assert.equal(candidates[1].eventKind, 'special');
  assert.equal(candidates[1].result.title.tier, 'basic');
  assert.equal(candidates[1].specialUnlock.tierLabel, 'Segredo');
});

test('does not queue ordinary repeats or results already observed', () => {
  const candidates = collectCandidates([
    { roll: 20, isNew: false, title: { id: 'repeat' }, specialUnlocks: [] },
    { roll: 21, isNew: true, title: { id: 'already-seen' }, specialUnlocks: [] }
  ], 21);

  assert.deepEqual(candidates, []);
});

test('keeps repeated relic rewards individually identifiable for safe queue aggregation', () => {
  const candidates = collectCandidates([
    { roll: 4, isNew: false, title: { id: 'repeat' }, specialUnlocks: [{ id: 'relic-a', relicId: 'relic-a', name: 'Bolsa', tierLabel: 'Relíquia', duplicate: true, fragmentReward: '250' }] },
    { roll: 5, isNew: false, title: { id: 'repeat' }, specialUnlocks: [{ id: 'relic-a', relicId: 'relic-a', name: 'Bolsa', tierLabel: 'Relíquia', duplicate: true, fragmentReward: '250' }] }
  ], 3);

  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].eventKey, candidates[1].eventKey);
  assert.equal(candidates[0].specialUnlock.duplicate, true);
});

test('coalesces queued duplicate-relic rewards without losing intervening discoveries', () => {
  const queue = [];
  const duplicate = roll => ({
    eventKind: 'special',
    eventKey: `special:${roll}:relic-a:0`,
    result: { roll, specialUnlock: { relicId: 'relic-a', duplicate: true, fragmentReward: '250' } }
  });
  appendToQueue(queue, duplicate(1));
  appendToQueue(queue, { eventKind: 'title', eventKey: 'title:2:t', result: { roll: 2, title: { id: 't' } } });
  appendToQueue(queue, duplicate(3));

  assert.equal(queue.length, 2, 'the repeated reward occupies one presentation slot without removing the title');
  assert.equal(queue[0].repeatCount, 2);
  assert.equal(queue[0].fragmentTotal, '500');
  assert.equal(queue[0].lastRoll, 3);
  assert.equal(queue[1].eventKind, 'title');
});
