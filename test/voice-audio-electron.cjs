/* Run with Electron, not node: node_modules/electron/dist/electron.exe test/voice-audio-electron.cjs */
if (process.versions.electron) {
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on('console-message', (_event, level, message) => { if (process.env.NTC_VOICE_TEST_RESULT) fs.appendFileSync(`${process.env.NTC_VOICE_TEST_RESULT}.log`, `${level}: ${message}\n`); });
  await window.loadFile(process.env.NTC_VOICE_TEST_FIXTURE || path.join(__dirname, 'voice-fixture.html'));
  const engineUrl = process.env.NTC_VOICE_TEST_ENGINE ? pathToFileURL(process.env.NTC_VOICE_TEST_ENGINE).href : '../src/voice-engine.mjs';
  const ffmpeg = path.join(__dirname, '..', 'resources', 'bin', 'ffmpeg.exe');
  const formats = {
    wav: ['-c:a', 'pcm_s16le', '-f', 'wav'],
    mp3: ['-c:a', 'libmp3lame', '-f', 'mp3'],
    flac: ['-c:a', 'flac', '-f', 'flac'],
    opus: ['-c:a', 'libopus', '-f', 'ogg'],
    aac: ['-c:a', 'aac', '-f', 'adts'],
    m4a: ['-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4']
  };
  const encodedSamples = fs.existsSync(ffmpeg) ? Object.fromEntries(Object.entries(formats).map(([name, args]) => [name, execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-ac', '1', '-ar', '48000', ...args, 'pipe:1'], { maxBuffer: 2_000_000 }).toString('base64')])) : {};
  const results = await Promise.race([window.webContents.executeJavaScript(`(async () => {
    console.log('import start');
    const voice = await import(${JSON.stringify(engineUrl)});
    console.log('import complete');
    const supportedInputs = {};
    for (const [name, encoded] of Object.entries(${JSON.stringify(encodedSamples)})) {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const decoder = new AudioContext();
      try { const decoded = await decoder.decodeAudioData(bytes.buffer); supportedInputs[name] = decoded.duration > 0 && decoded.numberOfChannels > 0; }
      catch { supportedInputs[name] = false; }
      finally { await decoder.close(); }
    }
    const sampleRate = 48000, duration = 1.25;
    const input = new AudioBuffer({ numberOfChannels: 1, length: Math.round(duration * sampleRate), sampleRate });
    const samples = input.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.28 * Math.sin(2 * Math.PI * 440 * i / sampleRate);
    function frequency(buffer, expected) {
      const data = buffer.getChannelData(0), begin = Math.round(data.length * 0.42), end = Math.round(data.length * 0.8);
      let bestLag = 0, best = -Infinity;
      const baseLag = sampleRate / expected;
      for (let lag = Math.floor(baseLag * 0.82); lag <= Math.ceil(baseLag * 1.18); lag++) {
        let corr = 0, energy = 0;
        for (let i = begin; i < end; i++) { corr += data[i] * data[i + lag]; energy += data[i] * data[i]; }
        const score = corr / (energy || 1);
        if (score > best) { best = score; bestLag = lag; }
      }
      return sampleRate / bestLag;
    }
    const chain = semitones => [{ id: 'pitch-test', type: 'pitch', enabled: true, params: { semitones } }];
    console.log('render up start');
    const up = await voice.renderVoiceFile(input, chain(12));
    console.log('render up complete');
    const down = await voice.renderVoiceFile(input, chain(-12));
    console.log('render down complete');
    const untouched = await voice.renderVoiceFile(input, []);
    console.log('render untouched complete');
    const formant = await voice.renderVoiceFile(input, [{ id: 'formant-test', type: 'formant', enabled: true, params: { semitones: 4 } }]);
    console.log('render formant complete');
    const vowel = new AudioBuffer({ numberOfChannels: 1, length: input.length, sampleRate });
    const vowelSamples = vowel.getChannelData(0);
    for (let i = 0; i < vowelSamples.length; i++) for (let harmonic = 1; harmonic <= 16; harmonic++) {
      const f = harmonic * 220;
      const envelope = 0.10 * Math.exp(-Math.pow((f - 800) / 450, 2)) + 0.055 * Math.exp(-Math.pow((f - 1700) / 470, 2));
      vowelSamples[i] += envelope * Math.sin(2 * Math.PI * f * i / sampleRate);
    }
    const vowelNeutral = await voice.renderVoiceFile(vowel, []);
    const vowelShifted = await voice.renderVoiceFile(vowel, [{ id: 'formant-vowel', type: 'formant', enabled: true, params: { semitones: 4 } }]);
    const vowelShiftedDown = await voice.renderVoiceFile(vowel, [{ id: 'formant-vowel', type: 'formant', enabled: true, params: { semitones: -4 } }]);
    const difference = (a, b) => {
      const first = a.getChannelData(0), second = b.getChannelData(0);
      const begin = Math.floor(first.length * 0.28), end = Math.floor(first.length * 0.72);
      let total = 0;
      for (let i = begin; i < end; i++) total += Math.pow(first[i] - second[i], 2);
      return Math.sqrt(total / (end - begin));
    };
    const effectCases = [
      ['eq', { bass: 0, mid: 18, treble: 0 }],
      ['compressor', { threshold: -42, ratio: 8, attack: 4, release: 100, makeup: 3 }],
      ['reverb', { mix: 55, decay: 1.1 }],
      ['delay', { time: 130, feedback: 36, mix: 50 }],
      ['distortion', { drive: 88, mix: 70 }],
      ['chorus', { rate: 1.4, depth: 12, mix: 55 }],
      ['flanger', { rate: 1.2, depth: 6, feedback: 30, mix: 55 }],
      ['robot', { frequency: 45, mix: 86 }],
      ['telephone', { low: 350, high: 1800, drive: 55 }]
    ];
    const effects = {};
    for (const [type, params] of effectCases) {
      const processed = await voice.renderVoiceFile(input, [{ id: type, type, enabled: true, params }]);
      effects[type] = difference(processed, untouched);
    }
    const quiet = new AudioBuffer({ numberOfChannels: 1, length: input.length, sampleRate });
    for (let i = 0; i < quiet.length; i++) quiet.getChannelData(0)[i] = input.getChannelData(0)[i] * 0.1;
    const quietClean = await voice.renderVoiceFile(quiet, []);
    const quietGated = await voice.renderVoiceFile(quiet, [{ id: 'gate', type: 'gate', enabled: true, params: { threshold: -12, attack: 8, release: 100 } }]);
    effects.gate = difference(quietGated, quietClean);
    const bypassed = await voice.renderVoiceFile(input, [{ id: 'disabled', type: 'distortion', enabled: false, params: { drive: 88, mix: 100 } }]);
    const orderA = await voice.renderVoiceFile(input, [{ id: 'eq', type: 'eq', enabled: true, params: { bass: 0, mid: 18, treble: 0 } }, { id: 'distortion', type: 'distortion', enabled: true, params: { drive: 88, mix: 70 } }]);
    const orderB = await voice.renderVoiceFile(input, [{ id: 'distortion', type: 'distortion', enabled: true, params: { drive: 88, mix: 70 } }, { id: 'eq', type: 'eq', enabled: true, params: { bass: 0, mid: 18, treble: 0 } }]);
    function centroid(buffer) {
      const data = buffer.getChannelData(0), start = Math.floor(data.length * 0.45), length = 12000;
      let weighted = 0, total = 0;
      for (let harmonic = 2; harmonic <= 16; harmonic++) {
        const f = harmonic * 220;
        let real = 0, imag = 0;
        for (let i = 0; i < length; i++) { const angle = 2 * Math.PI * f * i / sampleRate; real += data[start + i] * Math.cos(angle); imag += data[start + i] * Math.sin(angle); }
        const energy = real * real + imag * imag;
        weighted += f * energy; total += energy;
      }
      return weighted / total;
    }
    const stats = (buffer, expected) => { const data = buffer.getChannelData(0); let finite = true, peak = 0, rms = 0; for (const v of data) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); rms += v*v; } return { finite, peak, rms: Math.sqrt(rms / data.length), length: data.length, frequency: frequency(buffer, expected) }; };
    const onset = buffer => { const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > 0.05) return i / sampleRate * 1000; return null; };
    return { up: stats(up, 880), down: stats(down, 220), untouched: stats(untouched, 440), formant: stats(formant, 440), sourceLength: input.length, neutralCentroid: centroid(vowelNeutral), shiftedCentroid: centroid(vowelShifted), downCentroid: centroid(vowelShiftedDown), effects, bypassDifference: difference(bypassed, untouched), orderDifference: difference(orderA, orderB), onsetMs: { clean: onset(untouched), pitch: onset(up), formant: onset(formant) }, supportedInputs };
  })()`), new Promise((_, reject) => setTimeout(() => reject(new Error('DSP test timed out after 25 seconds')), 25000))]);
  assert.equal(results.up.length, results.sourceLength);
  assert.equal(results.down.length, results.sourceLength);
  assert.ok(Math.abs(results.up.frequency - 880) < 35, JSON.stringify(results));
  assert.ok(Math.abs(results.down.frequency - 220) < 20, JSON.stringify(results));
  assert.ok(Math.abs(results.formant.frequency - 440) < 35, JSON.stringify(results));
  assert.ok(results.shiftedCentroid > results.neutralCentroid + 100, JSON.stringify(results));
  assert.ok(results.downCentroid < results.neutralCentroid - 25, JSON.stringify(results));
  for (const [name, difference] of Object.entries(results.effects)) assert.ok(difference > 0.001, `${name}: ${difference}`);
  assert.ok(results.bypassDifference < 0.0001, JSON.stringify(results));
  assert.ok(results.orderDifference > 0.001, JSON.stringify(results));
  for (const [name, supported] of Object.entries(results.supportedInputs)) assert.ok(supported, `Input decoding failed: ${name}`);
  for (const result of Object.values(results).filter(value => value && typeof value === 'object' && 'finite' in value)) {
    assert.ok(result.finite && result.peak <= 1.001 && result.rms > 0.005, JSON.stringify(result));
  }
  process.stdout.write(JSON.stringify(results) + '\n');
  if (process.env.NTC_VOICE_TEST_RESULT) fs.writeFileSync(process.env.NTC_VOICE_TEST_RESULT, JSON.stringify({ ok: true, results }));
  window.destroy();
  app.quit();
}
run().catch(error => { console.error(error); if (process.env.NTC_VOICE_TEST_RESULT) fs.writeFileSync(process.env.NTC_VOICE_TEST_RESULT, JSON.stringify({ ok: false, error: String(error.stack || error) })); app.exit(1); });
}
