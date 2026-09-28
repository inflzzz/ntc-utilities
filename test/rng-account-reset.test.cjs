'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createInitialRngAccount, persistInitialRngAccount } = require('../src/rng-account-reset.cjs');
const { getAccountProgress, grantAccountXp } = require('../src/rng-account-level.cjs');
const { currentWeights, normalizeState, POOL, rollBatch } = require('../src/rng.cjs');
const { profileToRow } = require('../src/rng-online.cjs');

const projectRoot = path.resolve(__dirname, '..');

function progressedFixture(initial) {
  const state = structuredClone(initial.rngGame);
  state.profile = { displayName: 'Jogador de teste', equippedTitleId: 'basic-01' };
  state.collectedIds = ['basic-01', 'epic-01'];
  state.totalRolls = 987_654;
  state.manualRolls = 123_456;
  state.totalAppSeconds = 987_600;
  state.totalAutoRollSeconds = 456_000;
  state.lastAutoRollSessionSeconds = 9_000;
  state.lastTitleId = 'epic-01';
  state.recentDiscoveries = [{ titleId: 'epic-01', roll: 900_000 }];
  state.titleHistory = [{ titleId: 'basic-01', roll: 1 }, { titleId: 'epic-01', roll: 900_000 }];
  state.trackedRolls = 987_654;
  state.tierRolls.basic = 800_000;
  state.tierRolls.epic = 187_654;
  state.duplicateRolls = 987_652;
  state.luckMetrics.measuredRolls = 987_654;
  state.luckMetrics.singularPlusObserved = 12;
  state.bonusRollCounter = 7;
  state.maxMultiplier = 5;
  state.sinceSingular = 50_000;
  state.longestSingularDrought = 75_000;
  state.sameTitleStreak = 5_000;
  state.longestSameTitleStreak = 5_000;
  state.singularStreak = 3;
  state.rarestOdds = '999999999999';
  state.rarestTitleId = 'epic-01';
  state.luckiestOdds = '999999999999';
  state.luckiestRoll = 900_000;
  state.sessionBest = { rolls: 3_000, newTitles: 2, bestOdds: '999999999999' };
  state.unlockedSecrets = ['first-secret'];
  state.limitedTitles = ['event-title'];
  state.fragmentBalance = '123456789';
  state.fragmentRewardRemainderBps = 123;
  state.permanentUpgradeLevels = 12;
  state.nextPermanentUpgradeCost = '999999';
  state.consumableInventory = { rolls: 8, time: 9 };
  state.activeBoost = { type: 'rolls', remaining: 400 };
  state.parallelBoost = { type: 'time', remaining: 500 };
  state.boostQueue = [{ type: 'rolls', remaining: 600 }];
  state.ownedRelicIds = ['ember'];
  state.equippedRelicIds = ['ember'];
  state.achievementRelicRewardedIds = ['rolls-100'];
  state.randomRelicProgress = 999;
  state.randomRelicTarget = 1_000;
  state.eventRelicRewardedWindows = ['event-window'];
  state.eventsParticipated = 4;
  state.participation = 'event-1';
  state.eventRollProgress = { windowId: 'event-window', rolls: 42 };
  return { ...state, accountProgress: { schemaVersion: 1, ...grantAccountXp(initial.accountProgress, 987_654n), enhancedRecyclingLevel: 5, enhancedRecyclingRemainderBps: 9876 } };
}

test('reset usa os mesmos defaults canônicos e volta Account Level/XP ao início', () => {
  const initial = createInitialRngAccount();
  const reset = createInitialRngAccount();
  assert.deepEqual(reset.rngGame, normalizeState());
  assert.deepEqual(reset.accountProgress, { accountLevel: '1', accountXp: '0', lifetimeAccountXp: '0', enhancedRecyclingLevel: 0, enhancedRecyclingRemainderBps: 0 });
  assert.equal(reset.rngGame.fragmentBalance, '0');
  assert.deepEqual(getAccountProgress(reset.accountProgress), {
    level: '1', xp: '0', xpToNextLevel: '10', lifetimeXp: '0', progressBasisPoints: 0
  });
});

test('save primário e backup de uma conta bastante progredida são substituídos pela conta inicial', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-rng-reset-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'ntc-rng-state.json');
  const backupPath = path.join(dir, 'ntc-rng-state.backup.json');
  const initial = createInitialRngAccount();
  const progressed = progressedFixture(initial);
  fs.writeFileSync(statePath, JSON.stringify(progressed));
  fs.writeFileSync(backupPath, JSON.stringify(progressed));

  persistInitialRngAccount({ statePath, backupPath, ...initial });

  const expected = JSON.parse(JSON.stringify({ ...initial.rngGame, fragmentRecyclingVersion: 1, accountProgress: { schemaVersion: 1, ...initial.accountProgress } }));
  for (const file of [statePath, backupPath]) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(saved, expected, `${path.basename(file)} is the canonical initial save`);
    assert.deepEqual(normalizeState(saved), initial.rngGame);
    assert.deepEqual(saved.accountProgress, { schemaVersion: 1, accountLevel: '1', accountXp: '0', lifetimeAccountXp: '0', enhancedRecyclingLevel: 0, enhancedRecyclingRemainderBps: 0 });
  }

  const resetSave = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  for (const key of [
    'totalRolls', 'manualRolls', 'collectedIds', 'titleHistory', 'recentDiscoveries', 'tierRolls',
    'trackedRolls', 'duplicateRolls', 'rarestTitleId', 'unlockedSecrets', 'limitedTitles',
    'fragmentBalance', 'permanentUpgradeLevels', 'consumableInventory', 'activeBoost',
    'parallelBoost', 'boostQueue', 'ownedRelicIds', 'equippedRelicIds', 'eventsParticipated',
    'eventRollProgress', 'luckMetrics'
  ]) assert.deepEqual(resetSave[key], initial.rngGame[key], `${key} does not survive reset`);
  assert.equal(resetSave.accountProgress.lifetimeAccountXp, '0');
  assert.equal(resetSave.accountProgress.enhancedRecyclingLevel, 0);
  assert.equal(resetSave.accountProgress.enhancedRecyclingRemainderBps, 0);
});

test('reset preserva arquivos/configurações fora do RNG e a sessão local Online', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-rng-reset-scope-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'ntc-rng-state.json');
  const backupPath = path.join(dir, 'ntc-rng-state.backup.json');
  const untouched = new Map([
    ['ntc-music-files.json', Buffer.from('{"files":["local-track"]}')],
    ['ntc-world-clock-settings.json', Buffer.from('{"cities":["São Paulo"]}')],
    ['ntc-online-session.enc', Buffer.from([0, 1, 2, 3, 255])]
  ]);
  for (const [name, bytes] of untouched) fs.writeFileSync(path.join(dir, name), bytes);
  const initial = createInitialRngAccount();
  fs.writeFileSync(statePath, JSON.stringify(progressedFixture(initial)));
  fs.writeFileSync(backupPath, JSON.stringify(progressedFixture(initial)));

  persistInitialRngAccount({ statePath, backupPath, ...initial });

  for (const [name, bytes] of untouched) assert.deepEqual(fs.readFileSync(path.join(dir, name)), bytes, `${name} remains byte-for-byte intact`);
  assert.equal(profileToRow({ identity: { displayName: '' } }), null, 'a blank new local identity is not published to the retained remote identity');
});

test('save imediatamente após reset equivale ao estado inicial e não muda o RNG', () => {
  const initial = createInitialRngAccount();
  const saved = JSON.parse(JSON.stringify({ ...initial.rngGame, accountProgress: { schemaVersion: 1, ...initial.accountProgress } }));
  const reloaded = normalizeState(saved);
  const deterministicRollOptions = { rolledAt: 1_800_000_000_000, localHour: 12, randomRelicTargetValue: 8_000, randomRelicChoiceValue: 0, limitedRewardValue: 0, eventRelicChoiceValue: 0 };
  assert.deepEqual(reloaded, initial.rngGame);
  assert.deepEqual([...currentWeights(reloaded)], [...currentWeights(normalizeState())]);
  assert.equal([...currentWeights(reloaded)].reduce((sum, [, weight]) => sum + weight, 0n), POOL);
  assert.deepEqual(rollBatch(reloaded, [0n], deterministicRollOptions), rollBatch(normalizeState(), [0n], deterministicRollOptions));
});

test('reset é uma ação exclusiva do Ateliê com confirmação tipada e sem operação remota', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'src/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(projectRoot, 'src/app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(projectRoot, 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(projectRoot, 'main.cjs'), 'utf8');
  assert.match(html, /id="rngDebugResetStart"/);
  assert.match(html, /class="rng-debug-reset-confirm hidden" id="rngDebugResetConfirm"/);
  assert.match(html, /id="rngDebugResetPhrase"/);
  assert.match(app, /value\.trim\(\) !== 'RESETAR CONTA'/);
  assert.match(app, /rngDebugResetConfirmButton'\)\.onclick = debugResetRngAccount/);
  assert.match(preload, /debugResetRngAccount: \(\) => ipcRenderer\.invoke\('debug-rng-reset-account'\)/);
  assert.match(main, /if \(!app\.isPackaged\)\s*\{\s*ipcMain\.handle\('debug-rng-reset-account'/);
  const resetHandler = main.slice(main.indexOf("ipcMain.handle('debug-rng-reset-account'"), main.indexOf("ipcMain.handle('debug-rng-add-title'"));
  assert.match(resetHandler, /rngOnlineService\.resetOwnProfile\(\)/);
  assert.doesNotMatch(resetHandler, /signOut|deleteUser|\.from\(/i);
  assert.match(resetHandler, /resetRngAccountState\(\)/);

  const migration = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/202609270002_ntc_reset_own_online_profile.sql'), 'utf8');
  assert.match(migration, /create or replace function public\.ntc_reset_my_rng_profile\(\)/i);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /v_user_id := auth\.uid\(\)/i);
  assert.match(migration, /where p\.owner_user_id = v_user_id and p\.profile_kind = 'real'/i);
  assert.match(migration, /delete from public\.profile_discoveries as d where d\.profile_id = v_profile_id/i);
  assert.match(migration, /delete from public\.profiles as p\s+where p\.id = v_profile_id and p\.owner_user_id = v_user_id and p\.profile_kind = 'real'/i);
  assert.match(migration, /grant execute on function public\.ntc_reset_my_rng_profile\(\) to authenticated/i);
  assert.doesNotMatch(migration, /delete\s+from\s+auth\.users|service_role/i);
});
