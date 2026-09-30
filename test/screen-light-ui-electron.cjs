/* Explicit Electron renderer integration test; node --test skips this runner. */
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const path = require('node:path');
  const assert = require('node:assert/strict');
  async function run() {
    await app.whenReady();
    const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    await window.loadFile(path.join(__dirname, 'screen-light-fixture.html'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      await window.NTCScreenLight.open();
      const root = document.getElementById('screenLightView');
      if (!root.querySelector('[data-live-status]').textContent.includes('Desativada')) throw new Error('Neutral state missing');
      if (root.querySelector('[data-current-kelvin]').textContent !== 'Sem ajuste') throw new Error('Inactive state must not claim applied Kelvin');
      const firstPoint = root.querySelector('[data-point-kelvin="0"]');
      firstPoint.value = '2300'; firstPoint.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      if (!window.testCalls.some(([type, patch]) => type === 'update' && patch.timeline?.[0]?.kelvin === 2300)) throw new Error('First timeline point cannot be edited');
      root.querySelector('[data-setting="enabled"]').click();
      await new Promise(resolve => setTimeout(resolve, 30));
      if (!root.querySelector('[data-live-status]').textContent.includes('HDR')) throw new Error('HDR limitation not visible');
      root.querySelector('.sl-advanced').open = true;
      root.querySelector('[data-action="probe"]').click();
      await new Promise(resolve => setTimeout(resolve, 30));
      if (!root.querySelector('.sl-advanced').open) throw new Error('Advanced panel collapsed after update');
      if (!root.querySelector('.sl-monitors').textContent.includes('bloqueado')) throw new Error('Monitor capability missing');
      root.querySelector('[data-mode="manual"]').click();
      await new Promise(resolve => setTimeout(resolve, 30));
      if (!root.querySelector('[data-mode="manual"]').classList.contains('active')) throw new Error('Manual mode failed');
      const range = root.querySelector('[data-range="manualKelvin"]'); range.value = '3000'; range.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      if (!window.testCalls.some(([type, patch]) => type === 'update' && patch.manualKelvin === 3000)) throw new Error('Temperature update missing');
      return { hdr: true, timeline: !!root.querySelector('[data-timeline]'), monitor: true, manual: true };
    })()`);
    assert.ok(Object.values(result).every(Boolean));
    console.log(JSON.stringify(result));
    window.destroy(); app.quit();
  }
  run().catch(error => { console.error(error); app.exit(1); });
}
