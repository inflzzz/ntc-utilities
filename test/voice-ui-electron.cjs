/* Explicit Electron integration test; node --test intentionally skips this runner. */
if (process.versions.electron) {
  const { app, BrowserWindow } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  const assert = require('node:assert/strict');
  async function run() {
    await app.whenReady();
    const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadFile(process.env.NTC_VOICE_UI_TEST_FIXTURE || path.join(__dirname, '..', 'src', 'index.html'));
    const result = await Promise.race([window.webContents.executeJavaScript(`(async () => {
      const $ = id => document.getElementById(id);
      const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('UI did not reach expected state'); };
      if (!window.NTCVoiceModifier || !window.ntcCatalog?.byId?.has('voiceModifier')) throw new Error('Voice tool was not registered');
      $('vmFileTab').click();
      if ($('vmFilePanel').classList.contains('hidden') || !$('vmMicPanel').classList.contains('hidden')) throw new Error('File tab did not open');
      const engine = await import('../src/voice-engine.mjs');
      const tone = new AudioBuffer({ numberOfChannels: 1, length: 48000, sampleRate: 48000 });
      for (let i = 0; i < tone.length; i++) tone.getChannelData(0)[i] = 0.1 * Math.sin(2 * Math.PI * 440 * i / 48000);
      const file = new File([engine.encodeWav(tone)], 'voice-test.wav', { type: 'audio/wav' });
      const transfer = new DataTransfer(); transfer.items.add(file);
      $('vmFileInput').files = transfer.files;
      $('vmFileInput').dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => !$('vmPlay').disabled);
      $('vmPlay').click(); await waitFor(() => $('vmPlay').textContent === 'Pausar');
      for (const id of ['grave', 'robo', 'esquilo', 'narrador', 'natural']) { $('vmPreset').value = id; $('vmPreset').dispatchEvent(new Event('change', { bubbles: true })); }
      await new Promise(resolve => setTimeout(resolve, 220));
      if ($('vmChain').querySelectorAll('.vm-effect').length !== 0 || $('vmPlay').textContent !== 'Pausar') throw new Error('Rapid preset switching left stale pipeline or stopped playback');
      $('vmCompare').click();
      if ($('vmCompare').textContent !== 'Ouvindo: Original') throw new Error('A/B did not switch');
      $('vmPlay').click();
      $('vmMicTab').click();
      const contexts = [], tracks = [], constraints = [];
      const devices = navigator.mediaDevices;
      Object.defineProperty(devices, 'enumerateDevices', { configurable: true, value: async () => [
        { kind: 'audioinput', deviceId: 'mock-1', label: 'Microfone 1' },
        { kind: 'audioinput', deviceId: 'mock-2', label: 'Microfone 2' },
        { kind: 'audiooutput', deviceId: 'out-1', label: 'Saída 1' }
      ] });
      Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: async options => {
        constraints.push(options); const context = new AudioContext(); contexts.push(context);
        const stream = context.createMediaStreamDestination().stream;
        tracks.push(stream.getAudioTracks()[0]); return stream;
      } });
      window.NTCVoiceModifier.open();
      $('vmMicToggle').click(); await waitFor(() => $('vmMicStatus').textContent === 'Capturando');
      if ($('vmMonitor').checked) throw new Error('Monitoring started enabled');
      $('vmInputDevice').value = 'mock-2'; $('vmInputDevice').dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => tracks.length === 2 && $('vmMicStatus').textContent === 'Capturando');
      if (tracks[0].readyState !== 'ended' || constraints[1].audio.deviceId.exact !== 'mock-2') throw new Error('Input switch leaked prior track');
      window.NTCVoiceModifier.close();
      if (tracks[1].readyState !== 'ended' || $('vmMicStatus').textContent !== 'Desativado') throw new Error('Microphone cleanup failed');
      for (const context of contexts) await context.close();
      Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
      $('vmMicToggle').click(); await waitFor(() => $('vmMicStatus').textContent === 'Falha');
      if (!$('vmMessage').textContent.includes('negado')) throw new Error('Permission error not shown');
      return { fileLoaded: true, ab: true, rapidPresets: true, monitorDefaultOff: true, deviceSwitch: true, cleanup: true, permissionError: true };
    })()`), new Promise((_, reject) => setTimeout(() => reject(new Error('Voice UI test timed out')), 15000))]);
    assert.ok(Object.values(result).every(Boolean));
    if (process.env.NTC_VOICE_UI_TEST_RESULT) fs.writeFileSync(process.env.NTC_VOICE_UI_TEST_RESULT, JSON.stringify({ ok: true, result }));
    window.destroy(); app.quit();
  }
  run().catch(error => { if (process.env.NTC_VOICE_UI_TEST_RESULT) fs.writeFileSync(process.env.NTC_VOICE_UI_TEST_RESULT, JSON.stringify({ ok: false, error: String(error.stack || error) })); console.error(error); app.exit(1); });
}
