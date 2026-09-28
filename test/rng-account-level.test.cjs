'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  grantAccountXp,
  getAccountProgress,
  normalizeAccountProgress,
  integerSquareRoot,
  countProcessedRolls,
  xpRequiredForNextLevel,
  xpRequiredToReachLevel
} = require('../src/rng-account-level.cjs');
const { normalizeState, currentWeights, rollBatch, POOL, RNG_SAVE_SCHEMA_VERSION } = require('../src/rng.cjs');
const { isFragmentRecyclingUnlocked, isAutoRollUnlocked, normalizeAcknowledgedSystemUnlocks, pendingAccountSystemUnlock, canAcknowledgeAccountSystemUnlock } = require('../src/rng-account-unlocks.cjs');
const { createInitialRngAccount } = require('../src/rng-account-reset.cjs');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const shadowBridgeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'rng-shadow-bridge.cjs'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

test('curva monotônica documentada e primeiros níveis têm custos esperados', () => {
  assert.equal(xpRequiredForNextLevel(1n), 10n);
  assert.equal(xpRequiredForNextLevel(10n), 100n);
  assert.deepEqual([2n, 3n, 4n, 5n, 10n, 25n, 50n, 100n].map(xpRequiredToReachLevel), [10n, 30n, 60n, 100n, 450n, 3_000n, 12_250n, 49_500n]);
  for (let level = 1n; level < 500n; level++) assert.ok(xpRequiredToReachLevel(level + 1n) > xpRequiredToReachLevel(level));
});

test('+1 XP por roll real e XP excedente avança o progresso corretamente', () => {
  const oneRoll = grantAccountXp({}, 1n);
  assert.deepEqual(getAccountProgress(oneRoll), { level: '1', xp: '1', xpToNextLevel: '10', lifetimeXp: '1', progressBasisPoints: 1000 });
  const threshold = grantAccountXp(oneRoll, 9n);
  assert.equal(threshold.accountLevel, '2');
  assert.equal(threshold.accountXp, '0');
  const excess = grantAccountXp(threshold, 25n);
  assert.equal(excess.accountLevel, '3');
  assert.equal(excess.accountXp, '5');
  assert.equal(excess.lifetimeAccountXp, '35');
});

test('uma concessão grande sobe múltiplos níveis sem loop por nível', () => {
  const advanced = grantAccountXp({}, 1_000n);
  assert.equal(advanced.accountLevel, '14');
  assert.equal(advanced.accountXp, '90');
  assert.equal(getAccountProgress(advanced).xpToNextLevel, '140');
});

test('quantidade zero não concede XP, como ocorre com batch sem resultado concedido', () => {
  const initial = grantAccountXp({}, 0n);
  assert.equal(initial.accountLevel, '1');
  assert.equal(initial.accountXp, '0');
  assert.equal(initial.lifetimeAccountXp, '0');
});

test('XP conta rolls processados, nunca a quantidade de resultados extras do batch', () => {
  const oneRollWithTwoResults = { state: { totalRolls: 101 }, results: [{}, {}] };
  const oneRollCount = countProcessedRolls(100, oneRollWithTwoResults.state.totalRolls);
  assert.equal(oneRollWithTwoResults.results.length, 2);
  assert.equal(oneRollCount, 1n);
  assert.equal(grantAccountXp({}, oneRollCount).lifetimeAccountXp, '1');

  const tenRollsWithThirteenResults = { state: { totalRolls: 110 }, results: Array.from({ length: 13 }, () => ({})) };
  const tenRollCount = countProcessedRolls(100, tenRollsWithThirteenResults.state.totalRolls);
  assert.equal(tenRollsWithThirteenResults.results.length, 13);
  assert.equal(tenRollCount, 10n);
  assert.equal(grantAccountXp({}, tenRollCount).lifetimeAccountXp, '10');
  assert.equal(countProcessedRolls(100, 100), 0n);
});

test('serialização e normalização mantêm XP e níveis muito altos sem perda de precisão', () => {
  const hugeXp = BigInt(`1${'0'.repeat(1000)}`);
  const saved = grantAccountXp({}, hugeXp);
  const loaded = normalizeAccountProgress(JSON.parse(JSON.stringify(saved)));
  assert.equal(loaded.lifetimeAccountXp, hugeXp.toString());
  assert.equal(loaded.accountLevel, saved.accountLevel);
  assert.equal(loaded.accountXp, saved.accountXp);
  assert.ok(BigInt(loaded.accountLevel) > 10n ** 400n);
  assert.equal(integerSquareRoot(10n ** 1000n), 10n ** 500n);
});

test('save antigo ganha defaults aditivos e valores inconsistentes são recalculados pelo XP vitalício', () => {
  const oldSave = normalizeState({ totalRolls: 145_000, collectedIds: [] });
  const initial = normalizeAccountProgress({});
  assert.equal(RNG_SAVE_SCHEMA_VERSION, 1);
  assert.equal(initial.accountLevel, '1');
  assert.equal(initial.accountXp, '0');
  assert.equal(initial.lifetimeAccountXp, '0');
  assert.equal(Object.hasOwn(oldSave, 'xpToNextLevel'), false);
  const repaired = normalizeAccountProgress({ lifetimeAccountXp: '100', accountLevel: '999', accountXp: '999' });
  assert.equal(repaired.accountLevel, '5');
  assert.equal(repaired.accountXp, '0');
});

test('XP não altera odds nem o resultado determinístico do RNG legado', () => {
  const baseState = normalizeState({});
  const xpState = grantAccountXp(baseState, 987_654_321n);
  assert.deepEqual([...currentWeights(baseState)], [...currentWeights(xpState)]);
  let sum = 0n;
  for (const weight of currentWeights(xpState).values()) sum += weight;
  assert.equal(sum, POOL);
  const options = { randomRelicTargetValue: 0n, randomRelicChoiceValue: 0n, eventRelicChoiceValue: 0n };
  const before = rollBatch(baseState, [0n], options);
  const after = rollBatch(xpState, [0n], options);
  assert.equal(after.results[0].title.id, before.results[0].title.id);
  assert.equal(after.results[0].currentOdds, before.results[0].currentOdds);
  assert.equal(after.state.totalRolls, before.state.totalRolls);
});

test('Manual e Auto concedem XP no ponto pós-batch, contando rolls semânticos processados', () => {
  const performBody = mainSource.match(/function performRngRoll\([\s\S]*?\n}\nfunction startRngClock\(\)/)?.[0];
  assert.ok(performBody, 'performRngRoll deve existir');
  assert.match(performBody, /const rawOutcome = runLegacyRollWithShadow\(/);
  assert.match(performBody, /const outcome = applyFragmentRecycling\(\{/);
  assert.match(performBody, /const processedRollCount = countProcessedRolls\(rngGame\.totalRolls, outcome\.state\.totalRolls\)/);
  assert.match(performBody, /const processedRollCountForSession = Number\(processedRollCount\)/);
  assert.match(performBody, /rngSessionRolls \+= processedRollCountForSession/);
  assert.match(performBody, /rngAccountProgress = grantAccountXp\(rngAccountProgress, processedRollCount\)/);
  assert.doesNotMatch(performBody, /processedRollCount\s*=\s*outcome\.results\.length/);
  assert.match(mainSource, /ipcMain\.handle\('roll-rng',[\s\S]*?performRngRoll\(\{ manual: true \}\)/);
  assert.match(mainSource, /if \(rngAutoRollStartedAt && tick >= rngNextAutoRollAt\)[\s\S]*?performRngRoll\(\)/);
  assert.doesNotMatch(shadowBridgeSource, /grantAccountXp|accountXp|lifetimeAccountXp/);
  assert.match(shadowBridgeSource, /const legacyOutcome = legacyRoll\(\)/);
  assert.match(shadowBridgeSource, /return legacyOutcome/);
});

test('estado público e cabeçalho RNG expõem o progresso sem criar uma tela de Level', () => {
  assert.match(mainSource, /accountProgress: \{ \.\.\.getAccountProgress\(rngAccountProgress\), enhancedRecyclingLevel: rngAccountProgress\.enhancedRecyclingLevel \}/);
  assert.match(mainSource, /JSON\.stringify\(\{ \.\.\.rngGame, fragmentRecyclingVersion: FRAGMENT_RECYCLING_VERSION, accountProgress: \{ schemaVersion: 1, \.\.\.rngAccountProgress \}, accountSystemUnlocksAcknowledged: rngAccountSystemUnlocksAcknowledged \}\)/);
  const rngSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'rng.cjs'), 'utf8');
  assert.doesNotMatch(rngSource, /rng-account-level|accountLevel|lifetimeAccountXp/);
  for (const id of ['rngAccountLevel', 'rngAccountXp', 'rngAccountProgressBar', 'rngAccountProgressFill', 'rngAccountXpFeedback']) {
    assert.equal(htmlSource.split(`id="${id}"`).length - 1, 1, `elemento de interface ausente ou duplicado: ${id}`);
  }
  const accountLevelIndex = htmlSource.indexOf('id="rngAccountLevel"');
  const chamberIndex = htmlSource.indexOf('CÂMARA DO ACASO');
  assert.ok(accountLevelIndex >= 0 && accountLevelIndex < chamberIndex, 'Account Level pertence ao cabeçalho global, não à Câmara do Acaso');
  const chamberHeading = htmlSource.slice(chamberIndex, htmlSource.indexOf('rng-roll-experience', chamberIndex));
  assert.doesNotMatch(chamberHeading, /rngAccount(Level|Xp|Progress)/);
  assert.match(htmlSource, /class="rng-account-level-badge"[\s\S]{0,100}id="rngAccountLevel"/);
  assert.match(htmlSource, /NÍVEL DA CONTA/);
  assert.match(htmlSource, /class="rng-account-level-progress"[\s\S]{0,350}id="rngAccountXp"/);
  assert.match(appSource, /levelLabel\.textContent = formatRngAccountValue\(progress\.level\)/);
  assert.match(appSource, /style\.transform = `scaleX\(\$\{percent \/ 100\}\)`/);
  assert.match(appSource, /if \(rngAccountXpFeedbackTimer\) clearTimeout\(rngAccountXpFeedbackTimer\)/);
  assert.match(appSource, /if \(leveledUp\) levelLabel\.classList\.add\('is-level-up'\)/);
  assert.match(stylesSource, /#rngAccountXpFeedback\.is-visible \{ animation: rng-account-feedback 850ms/);
  assert.match(stylesSource, /#rngAccountXpFeedback \{[\s\S]*?pointer-events: none/);
  assert.match(stylesSource, /rng-account-level-track > span \{[\s\S]*?transform-origin: left center/);
  assert.match(stylesSource, /\.rng-account-level-badge \{[\s\S]*?clip-path: polygon/);
  assert.match(stylesSource, /\.rng-account-level-badge > strong\.is-level-up \{ animation: rng-account-level-up/);
});

test('Reciclagem desbloqueia no Level 2 e Auto Roll somente no Level 3, inclusive após reset', () => {
  assert.equal(isAutoRollUnlocked('1'), false);
  assert.equal(isAutoRollUnlocked('2'), false);
  assert.equal(isAutoRollUnlocked('3'), true);
  assert.equal(isAutoRollUnlocked('999999999999999999999999999999'), true);
  assert.equal(isAutoRollUnlocked('invalid'), false);
  assert.equal(isFragmentRecyclingUnlocked('1'), false);
  assert.equal(isFragmentRecyclingUnlocked('2'), true);
  const initial = createInitialRngAccount();
  assert.equal(isAutoRollUnlocked(initial.accountProgress.accountLevel), false);
  const levelTwo = grantAccountXp(initial.accountProgress, 10n);
  assert.equal(levelTwo.accountLevel, '2');
  assert.equal(isFragmentRecyclingUnlocked(levelTwo.accountLevel), true);
  assert.equal(isAutoRollUnlocked(levelTwo.accountLevel), false);
  const levelThree = grantAccountXp(levelTwo, 20n);
  assert.equal(levelThree.accountLevel, '3');
  assert.equal(isAutoRollUnlocked(levelThree.accountLevel), true);
  assert.match(mainSource, /autoRollUnlocked: isAutoRollUnlocked\(rngAccountProgress\.accountLevel\)/);
  assert.match(mainSource, /if \(active && !isAutoRollUnlocked\(rngAccountProgress\.accountLevel\)\) throw new Error\('A Rolagem Automática é desbloqueada no Account Level 3\.'\)/);
  assert.match(mainSource, /ipcMain\.handle\('app-entered',[\s\S]*?return false;/);
  assert.doesNotMatch(mainSource, /startRngAutoRoll/);
  assert.match(appSource, /state\.autoRollUnlocked === true/);
  assert.match(appSource, /Rolagem automática · Nível 3/);
  assert.match(appSource, /if \(!rngState\?\.autoRollActive && rngState\?\.autoRollUnlocked !== true\)/);
  assert.match(htmlSource, /id="rngAutoButton"[^>]*disabled[^>]*>Rolagem automática · Nível 3<\/button>/);
  assert.match(stylesSource, /\.rng-auto-button\.is-locked:disabled/);
});

test('desbloqueios ficam pendentes até reconhecimento e cada ID pode ser reconhecido uma vez', () => {
  assert.equal(pendingAccountSystemUnlock('1', []), null);
  assert.equal(pendingAccountSystemUnlock('2', []).id, 'fragment-recycling');
  assert.deepEqual(normalizeAcknowledgedSystemUnlocks(['fragment-recycling', 'unknown', 'fragment-recycling']), ['fragment-recycling']);
  assert.equal(pendingAccountSystemUnlock('2', ['fragment-recycling']), null);
  assert.equal(pendingAccountSystemUnlock('3', ['fragment-recycling']).id, 'auto-roll');
  assert.equal(pendingAccountSystemUnlock('3', ['fragment-recycling', 'auto-roll']), null);
  assert.equal(pendingAccountSystemUnlock('4', ['fragment-recycling', 'auto-roll']).id, 'improvements');
  assert.equal(pendingAccountSystemUnlock('4', ['fragment-recycling', 'auto-roll', 'improvements']), null);
  assert.deepEqual(normalizeAcknowledgedSystemUnlocks(['improvements', 'unknown']), ['improvements']);
  assert.equal(canAcknowledgeAccountSystemUnlock('auto-roll', '2'), false);
  assert.equal(canAcknowledgeAccountSystemUnlock('auto-roll', '3'), true);
  assert.equal(canAcknowledgeAccountSystemUnlock('improvements', '3'), false);
  assert.equal(canAcknowledgeAccountSystemUnlock('improvements', '4'), true);
});

test('card de desbloqueio persiste até Continuar e bloqueia Manual e Auto', () => {
  const showBody = appSource.match(/function showRngSystemUnlock\(unlockId\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(showBody);
  assert.doesNotMatch(showBody, /setTimeout|setInterval/);
  assert.match(appSource, /'fragment-recycling': \{ icon: 'fragment-pouch', level: 'NÍVEL 2', title: 'Fragmentos', detail: 'Títulos repetidos agora são convertidos em Fragmentos\.' \}/);
  assert.match(appSource, /'auto-roll': \{ icon: 'ui-history', level: 'NÍVEL 3', title: 'Rolagem Automática', detail: 'Agora você pode deixar as rolagens acontecerem automaticamente\.' \}/);
  assert.match(appSource, /improvements: \{ icon: 'ui-shop', level: 'NÍVEL 4', title: 'Melhorias', detail: 'Use seus Fragmentos para melhorar permanentemente sua progressão\.' \}/);
  assert.match(appSource, /window\.ntc\.acknowledgeRngSystemUnlock\(unlockId\)/);
  assert.match(appSource, /pendingRngSystemUnlockId\(state\) \|\| rngSystemUnlockAckPending/);
  assert.match(appSource, /Boolean\(systemUnlockBlocksRolls \|\| state\.autoRollActive/);
  assert.match(appSource, /rngRequestRunning \|\| rngManualRollCycleActive \|\| rngState\?\.autoRollActive \|\| pendingRngSystemUnlockId\(rngState\)/);
  assert.match(appSource, /rngRequestRunning \|\| pendingRngSystemUnlockId\(rngState\) \|\| rngSystemUnlockAckPending/);
  assert.match(htmlSource, /<dialog class="rng-system-unlock" id="rngSystemUnlockNotice"[\s\S]*?hidden>/);
  assert.match(appSource, /if \(!notice\.open\) notice\.showModal\(\)/);
  assert.match(appSource, /rngSystemUnlockNotice'\)\.addEventListener\('cancel', event => event\.preventDefault\(\)\)/);
  assert.match(appSource, /if \(notice\.open\) notice\.close\(\)/);
  assert.match(htmlSource, /id="rngSystemUnlockContinue" type="button">Continuar<\/button>/);
  assert.match(appSource, /rngSystemUnlockContinue'\)\.onclick = continueRngSystemUnlock/);
  const continueBody = appSource.match(/async function continueRngSystemUnlock\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(continueBody);
  assert.doesNotMatch(continueBody, /systemUnlockBlocksRolls|pendingRngSystemUnlockId|button\.disabled/,
    'a trava do jogo não pode desabilitar a ação Continuar');
  assert.match(continueBody, /rngSystemUnlockAckPending/);
  assert.match(stylesSource, /\.rng-system-unlock\[open\]\.is-visible::backdrop/);
  assert.match(stylesSource, /\.rng-system-unlock-continue \{[^}]*width: 100%/);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\) \{ \.rng-system-unlock/);
  assert.match(mainSource, /ipcMain\.handle\('acknowledge-rng-system-unlock'/);
  assert.match(mainSource, /pendingAccountSystemUnlock\(rngAccountProgress\.accountLevel, rngAccountSystemUnlocksAcknowledged\)\) return \{ accepted: false, reason: 'system-unlock-pending' \}/);
  assert.match(mainSource, /if \(active && pendingAccountSystemUnlock\(rngAccountProgress\.accountLevel, rngAccountSystemUnlocksAcknowledged\)\)/);
  assert.match(mainSource, /rngAutoRollStartedAt && pendingAccountSystemUnlock\(rngAccountProgress\.accountLevel, rngAccountSystemUnlocksAcknowledged\) && pauseRngAutoRoll\(\)/);
  assert.match(mainSource, /rngAccountSystemUnlocksAcknowledged = \[\]/, 'reset total limpa reconhecimentos para a conta de teste');
  assert.match(mainSource, /accountSystemUnlocksAcknowledged: rngAccountSystemUnlocksAcknowledged/);
  assert.match(mainSource, /pendingAccountSystemUnlock: pendingAccountSystemUnlock\(/);
  assert.match(mainSource, /canAcknowledgeAccountSystemUnlock\(unlockId, rngAccountProgress\.accountLevel\)/);
});

test('a trava de rolls não desabilita nem intercepta o Continuar do modal', () => {
  const continueBody = appSource.match(/async function continueRngSystemUnlock\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  const lockBody = appSource.match(/const systemUnlockBlocksRolls = Boolean\([\s\S]*?\n\s*\$\('#rngAutoButton'\)\.disabled = [^;]+;/)?.[0];
  assert.ok(continueBody);
  assert.ok(lockBody);
  assert.doesNotMatch(continueBody, /systemUnlockBlocksRolls|pendingRngSystemUnlockId|button\.disabled/);
  assert.doesNotMatch(lockBody, /rngSystemUnlockContinue/);
  assert.match(continueBody, /window\.ntc\.acknowledgeRngSystemUnlock\(unlockId\)/);
  assert.match(htmlSource, /<button class="primary-button rng-system-unlock-continue" id="rngSystemUnlockContinue" type="button">Continuar<\/button>/);
});
