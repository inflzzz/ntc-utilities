// Read-only real packaged assets and preload/IPC smoke test; no application main or desktop automation.
if (process.versions.electron) {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const path = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
  const root = path.resolve(process.env.NTC_VALIDATION_PACKAGE_ROOT || 'tmp/uninstaller-build/win-unpacked');
  const resource = path.join(root, 'resources'), helper = path.join(resource, 'bin', 'uninstaller-host.exe');
  app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'ntc-uninstaller-tests', 'packaged-validation'));
  async function run() {
    assert.ok(fs.existsSync(helper)); assert.ok(fs.existsSync(path.join(resource, 'bin', 'uninstaller-windows.ps1')));
    const { UninstallerService } = require(path.join(resource, 'app.asar', 'src', 'uninstaller-main.cjs'));
    await app.whenReady(); const window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(resource, 'app.asar', 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
    const service = new UninstallerService({ ipcMain, dialog: { showMessageBox: async()=>({response:0}) }, shell: {}, app, getWindow:()=>window, helper }).register();
    const health = await service.host.send('health'); assert.equal(health.bridge, true);
    const desktop = await service.list(false), store = await service.list(true); assert.ok(desktop.items.length); assert.ok(store.items.length);
    // Render the real packaged tool (without starting other NTC tools/background services).
    await window.loadFile(path.join(__dirname, 'uninstaller-packaged-fixture.html'));
    await window.webContents.executeJavaScript(`(()=>{const script=document.createElement('script');script.src=${JSON.stringify('file:///' + path.join(resource, 'app.asar', 'src', 'uninstaller-ui.js').replaceAll('\\', '/'))};document.body.append(script)})()`);
    await new Promise(resolve=>setTimeout(resolve,150));
    const rendered=await window.webContents.executeJavaScript(`(async()=>{await NTCUninstaller.open();return {rows:document.querySelectorAll('.un-row').length,title:document.querySelector('h1').textContent,bridge:!!window.ntc.uninstaller}})()`);
    assert.equal(rendered.title, 'Desinstalador'); assert.equal(rendered.bridge, true); assert.ok(rendered.rows>0);
    const gameSizes = [], gameIcons = [];
    if (typeof service.sizes?.measure === 'function') for (const p of desktop.items.filter(p => /Cyberpunk|Clair Obscur/i.test(p.name))) {
      const measured = await window.webContents.executeJavaScript(`ntc.uninstaller.size(${JSON.stringify(p.id)}, false)`);
      assert.ok(measured.bytes > 0); assert.equal(measured.partial, false);
      gameSizes.push({ name: p.name, bytes: measured.bytes, source: measured.source });
      const icon = await window.webContents.executeJavaScript(`ntc.uninstaller.icon(${JSON.stringify(p.id)})`);
      assert.ok(icon.startsWith('data:image/png;base64,'), 'Real game icon missing');
      const image = require('electron').nativeImage.createFromDataURL(icon);
      assert.equal(image.isEmpty(), false); assert.deepEqual(image.getSize(), { width: 32, height: 32 });
      gameIcons.push({ name: p.name, dimensions: image.getSize(), sha256: require('node:crypto').createHash('sha256').update(image.toPNG()).digest('hex') });
    }
    if (gameIcons.length > 1) assert.notEqual(gameIcons[0].sha256, gameIcons[1].sha256, 'Generic game icons still identical');
    const packageVersion = require(path.join(resource, 'app.asar', 'package.json')).version;
    assert.equal(packageVersion, require('../package.json').version);
    for (const file of ['release-history.js', 'update-service.cjs', 'update-ui.js']) assert.ok(fs.existsSync(path.join(resource, 'app.asar', 'src', file)));
    console.log(JSON.stringify({root,packageVersion,health,desktop:desktop.items.length,appx:store.items.length,rendered,gameSizes,gameIcons})); await service.dispose(); window.destroy(); app.quit();
  } run().catch(error=>{console.error(error);app.exit(1)});
}
