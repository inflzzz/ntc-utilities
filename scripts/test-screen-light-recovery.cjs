const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ScreenLightHost } = require('../src/screen-light-main.cjs');

const permitted = process.platform === 'win32' && process.argv.includes('--allow-display-mutation');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-screen-light-recovery-'));
  const backup = path.join(directory, 'recovery.bin');
  const executable = path.join(__dirname, '..', 'resources', 'bin', 'screen-light-host.exe');
  const first = new ScreenLightHost(executable, backup);
  let second = null;
  try {
    await first.start();
    const rows = await first.send('LIST', { multiline: true });
    const usable = rows.find(row => row.startsWith('D\t') && row.split('\t')[4] === '0' && row.split('\t')[5] === '1');
    if (!usable) { console.log('Nenhum monitor SDR compatível; teste de crash não executado.'); return; }
    const index = Number(usable.split('\t')[1]);
    const before = await first.send('STATUS', { multiline: true });
    const original = before.find(row => row.startsWith(`S\t${index}\t`)).split('\t')[3];
    const applied = await first.send(`APPLY\t${index}\t4500\t100\t0`);
    assert.match(applied, /^OK\t/);
    const changed = await first.send('STATUS', { multiline: true });
    const status = changed.find(row => row.startsWith(`S\t${index}\t`)).split('\t');
    const warm = status[3];
    const native = status[4] === 'native';
    assert.notEqual(warm, original, 'A leitura da rampa aplicada não mudou de fato.');
    assert.equal(fs.existsSync(backup), true, 'O backup de recuperação não foi gravado.');
    const exited = new Promise(resolve => first.process.once('exit', resolve));
    first.process.kill();
    await exited;
    second = new ScreenLightHost(executable, backup);
    await second.start();
    const restored = await second.send('STATUS', { multiline: true });
    const recovered = restored.find(row => row.startsWith(`S\t${index}\t`)).split('\t')[3];
    assert.equal(recovered, original, 'O próximo helper não restaurou a rampa original.');
    assert.equal(fs.existsSync(backup), false, 'O backup não foi removido após recuperação.');
    console.log(JSON.stringify({ display: index, original, warm, recovered, backend: native ? 'Windows color management' : 'GDI', crashRecovery: true, independentOutputReadback: true }));
  } finally {
    if (!first.dead) await first.stop();
    if (!second && fs.existsSync(backup)) {
      second = new ScreenLightHost(executable, backup);
      try { await second.start(); } catch (error) { console.error('Falha na recuperação final:', error); }
    }
    if (second && !second.dead) await second.stop();
    if (!fs.existsSync(backup)) fs.rmSync(directory, { recursive: true, force: true });
    else console.error(`Backup mantido para recuperação: ${backup}`);
  }
}
if (permitted) run().catch(error => { console.error(error); process.exitCode = 1; });
else console.log('Teste de alteração real da tela ignorado; requer Windows e --allow-display-mutation.');
