/* Own hidden renderer only; no desktop automation, downloads or installation. */
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron'); const path = require('node:path');
  app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'ntc-update-tests'));
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1100, height: 820, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    window.webContents.on('console-message', event => console.log(event.message));
    await window.loadFile(path.join(__dirname, 'updates-fixture.html'));
    const result = await window.webContents.executeJavaScript(`(() => { try {
      const $ = id => document.getElementById(id), ok = (v, m) => { if (!v) throw Error(m); };
      const values = new Map([['ntc-last-seen-changelog-version', '1.0.0']]); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
      let delayed, toasts = 0; const ui = createNTCUpdateUi({ document, history: NTCReleaseHistory, storage, releases: NTC_CHANGELOG, showToast: () => toasts++, getVersion: () => '1.0.0', timers: { setTimeout: fn => delayed = fn } });
      const update = { status: 'available', currentVersion: '1.0.0', version: '1.4.0', releases: NTC_CHANGELOG };
      $('origin').focus(); ui.show(update); ok(document.activeElement === $('origin'), 'Automatic popup stole focus');
      ok($('updateSummary').textContent.includes('6 versões'), 'Skipped versions count');
      $('viewUpdateChangelog').click(); ok(document.querySelectorAll('.changelog-entry').length === 6, 'Missing skipped history');
      ok($('changelogList').textContent.includes('Luz da Tela'), 'Old version notes lost'); ok($('changelogList').textContent.includes('Desinstalador'), 'Latest notes lost');
      ui.close(); ok(storage.getItem('ntc-last-seen-changelog-version') === '1.0.0', 'Uninstalled preview marked read');
      ui.dismiss(); ui.show(update); ok($('updateNotice').classList.contains('hidden'), 'Dismissed notice reopened');
      ui.show({ ...update, manual: true }); ok(!$('updateNotice').classList.contains('hidden'), 'Manual check did not reopen');
      ui.dismiss(); ui.show({ ...update, status: 'downloaded' }); ok($('updateAction').textContent === 'Instalar e reiniciar', 'Install-ready state');
      ui.show({ status: 'current', version: '1.4.0' }); ui.show({ status: 'error', message: 'Offline' }); ok(toasts === 0, 'Periodic toast spam');
      ui.afterUpgrade('1.4.0', true); ok(storage.getItem('ntc-last-seen-changelog-version') === '1.0.0', 'Marked read too soon'); delayed(); ok(document.querySelectorAll('.changelog-entry').length === 6, 'Post-upgrade interval incorrect'); ui.close(); ok(storage.getItem('ntc-last-seen-changelog-version') === '1.4.0', 'Read marker not saved');
      ui.open(); ok(document.querySelectorAll('.changelog-entry').length === NTC_CHANGELOG.length, 'Settings history incomplete'); ui.close();
      ui.show({ ...update, releases: [{ version: '1.4.0', changes: ['<img src=x onerror=alert(1)>safe text'] }] }); $('viewUpdateChangelog').click(); ok(!$('changelogList').querySelector('img'), 'Remote HTML rendered');
      return { checks: 16, skippedVersions: 6, focusPreserved: true };
    } catch (error) { console.error(error.stack); throw error; } })()`);
    console.log(JSON.stringify(result)); window.destroy(); app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
