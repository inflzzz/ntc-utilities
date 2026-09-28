'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createManualRollCycleGate } = require('../src/rng-manual-roll-gate.cjs');
const { countProcessedRolls, grantAccountXp } = require('../src/rng-account-level.cjs');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
const experienceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'rng-roll-experience.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

test('spam de Manual durante a apresentação só aceita um ciclo e não deixa cliques enfileirados', () => {
  const gate = createManualRollCycleGate();
  let totalRolls = 0;
  let progress = {};
  const invokeManual = () => {
    const cycleId = gate.begin();
    if (cycleId === null) return { accepted: false };
    const previous = totalRolls;
    totalRolls += 10;
    const extraResults = Array.from({ length: 13 }, () => ({}));
    progress = grantAccountXp(progress, countProcessedRolls(previous, totalRolls));
    return { accepted: true, cycleId, extraResults };
  };

  const accepted = invokeManual();
  assert.equal(accepted.accepted, true);
  for (let click = 0; click < 1000; click++) assert.deepEqual(invokeManual(), { accepted: false });
  assert.equal(totalRolls, 10);
  assert.equal(progress.lifetimeAccountXp, '10');
  assert.equal(accepted.extraResults.length, 13);

  assert.equal(gate.complete(accepted.cycleId), true);
  assert.equal(gate.isBusy(), false);
  assert.equal(totalRolls, 10, 'nenhum clique bloqueado é drenado após a conclusão');
  assert.equal(progress.lifetimeAccountXp, '10', 'chamadas bloqueadas não concedem XP');

  const next = invokeManual();
  assert.equal(next.accepted, true, 'um novo ciclo funciona depois de a apresentação concluir');
  assert.equal(totalRolls, 20);
  assert.equal(progress.lifetimeAccountXp, '20');
});

test('o IPC do processo principal é a autoridade de exclusão e usa um token de conclusão', () => {
  const rollHandler = mainSource.match(/ipcMain\.handle\('roll-rng'[\s\S]*?\n  \}\);/)?.[0] || '';
  assert.match(rollHandler, /const cycleId = rngManualRollGate\.begin\(\)/);
  assert.match(rollHandler, /if \(cycleId === null\) return \{ accepted: false, reason: 'manual-roll-in-progress' \}/);
  assert.ok(rollHandler.indexOf('cycleId === null') < rollHandler.indexOf('performRngRoll({ manual: true })'));
  assert.match(rollHandler, /rngManualRollGate\.complete\(cycleId\)/);
  assert.match(mainSource, /ipcMain\.handle\('complete-manual-rng-roll',[\s\S]*event\.sender !== mainWindow\.webContents[\s\S]*rngManualRollGate\.complete\(cycleId\)/);
  assert.match(preloadSource, /completeManualRngRoll: cycleId => ipcRenderer\.invoke\('complete-manual-rng-roll', cycleId\)/);
});

test('renderer bloqueia repetição até a apresentação finalizar, mas Auto Roll não usa o gate manual', () => {
  assert.match(appSource, /rngManualRollCycleActive \|\| rngState\?\.autoRollActive/);
  assert.match(appSource, /rngManualRollCycleActive\);/);
  assert.match(appSource, /onCycleComplete: markManualRollPresentationComplete/);
  assert.match(htmlSource, /id="rngRollButton"[^>]*disabled/);
  assert.match(appSource, /if \(rngUnlockActive \|\| rngUnlockClosing \|\| rngUnlockQueue\.length\) return/);
  const autoClock = mainSource.match(/rngClock = setInterval\(\(\) => \{[\s\S]*?\n  \}, 200\);/)?.[0] || '';
  assert.match(autoClock, /performRngRoll\(\)/);
  assert.doesNotMatch(autoClock, /rngManualRollGate/);
  assert.match(experienceSource, /if \(plan\.reveal\) this\.handoff\(\)[\s\S]*this\.finishCycleAfterPulse\(\)/);
});
