// Explicit read-only checks using the real GitHub provider; no download or installer launch.
if (process.versions.electron && process.argv.includes('--public')) {
  const { app } = require('electron'), path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
  const { NsisUpdater } = require('electron-updater'); const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
  const { createUpdateService } = require('../src/update-service.cjs');
  const parent = path.resolve(__dirname, '..', 'tmp'); fs.mkdirSync(parent, { recursive: true }); const own = fs.mkdtempSync(path.join(parent, 'provider-validation-')); app.setPath('userData', own);
  app.whenReady().then(async () => {
    for (const version of ['1.0.0', '1.3.0']) {
      const adapter = { version, name: 'NTC Update Validation', isPackaged: true, userDataPath: own, baseCachePath: own, whenReady: () => app.whenReady(), onQuit() {}, quit() { throw Error('Installation forbidden in validation'); } };
      const updater = new NsisUpdater(null, adapter); updater.httpExecutor = new ElectronHttpExecutor(); updater.setFeedURL({ provider: 'github', owner: 'inflzzz', repo: 'ntc-utilities' }); updater.logger = null;
      const service = createUpdateService({ updater, version, emit() {} }); const result = await service.check({ manual: true });
      assert.equal(result.status, 'available'); assert.equal(result.version, require('../package.json').version); assert.ok(result.releases.length > 0);
      if (version === '1.0.0') { assert.equal(result.releases.length, 6); assert.ok(result.releases.some(entry => entry.version === '1.1.0')); }
      else assert.deepEqual(result.releases.map(entry => entry.version), ['1.4.0']);
      console.log(JSON.stringify({ provider: 'GitHub', installed: version, available: result.version, skipped: result.releases.map(entry => entry.version), autoDownload: updater.autoDownload })); service.stop();
    }
    app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
