/* Optional hardware smoke test. Run explicitly with Electron; never by node --test. */
if (process.versions.electron) {
  const { app, BrowserWindow, session } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  async function run() {
    await app.whenReady();
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media'));
    const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadFile(path.join(__dirname, 'voice-fixture.html'));
    const result = await Promise.race([window.webContents.executeJavaScript(`(async () => {
      let stream = null, context = null, engine = null, source = null, capture = {};
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const track = stream.getAudioTracks()[0];
        context = new AudioContext({ latencyHint: 'interactive' });
        const voice = await import('../src/voice-engine.mjs');
        await voice.prepareVoiceContext(context);
        engine = new voice.VoiceEngine(context);
        engine.setChain([{ id: 'mic-pitch', type: 'pitch', enabled: true, params: { semitones: -4 } }]);
        engine.setOutputGain(0);
        source = context.createMediaStreamSource(stream); source.connect(engine.input);
        await context.resume();
        await new Promise(resolve => setTimeout(resolve, 350));
        const settings = track.getSettings();
        capture = { activeDuringCapture: track.readyState === 'live', channels: settings.channelCount || null, sampleRate: settings.sampleRate || context.sampleRate, contextState: context.state };
      } catch (error) { capture = { error: error.name + ': ' + error.message }; }
      finally { source?.disconnect(); engine?.close(); stream?.getTracks().forEach(track => track.stop()); if (context) await context.close(); capture.tracksStopped = stream ? stream.getTracks().every(track => track.readyState === 'ended') : null; capture.contextClosed = context ? context.state === 'closed' : null; }
      return capture;
    })()`), new Promise((_, reject) => setTimeout(() => reject(new Error('Live mic test timed out')), 10000))]);
    if (process.env.NTC_VOICE_MIC_TEST_RESULT) fs.writeFileSync(process.env.NTC_VOICE_MIC_TEST_RESULT, JSON.stringify(result));
    window.destroy(); app.quit();
  }
  run().catch(error => { if (process.env.NTC_VOICE_MIC_TEST_RESULT) fs.writeFileSync(process.env.NTC_VOICE_MIC_TEST_RESULT, JSON.stringify({ error: String(error) })); console.error(error); app.exit(1); });
}
