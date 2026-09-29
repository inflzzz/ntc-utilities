const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

test('microphone test is discoverable and has controls for live capture, device details and playback', () => {
  const catalog = read('catalog.js');
  const html = read('index.html');
  assert.match(catalog, /\['microphoneTest', 'Teste de microfone', 'microphoneTest'\]/);
  for (const id of ['microphoneTestView', 'microphoneDeviceSelect', 'microphoneLevelMeter', 'microphoneChannels', 'microphoneSampleRate', 'microphoneRecordToggle', 'microphonePlayback']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must be present in the microphone tool`);
  }
});

test('microphone capture reports actual track settings and releases capture when the tool closes', () => {
  const script = read('microphone-test.js');
  const app = read('app.js');
  assert.match(script, /navigator\.mediaDevices\.getUserMedia\(constraints\)/);
  assert.match(script, /track\.getSettings\?\.\(\)/);
  assert.match(script, /settings\.channelCount/);
  assert.match(script, /settings\.sampleRate/);
  assert.match(script, /track\.stop\(\)/);
  assert.match(script, /cancelAnimationFrame\(animationFrame\)/);
  assert.match(script, /MediaRecorder\(stream/);
  assert.doesNotMatch(script, /Pronto para gravar até 30 segundos/);
  assert.match(script, /URL\.createObjectURL\(blob\)/);
  assert.match(read('microphone-test.css'), /\.microphone-actions>button\{[^}]*height:38px;min-height:38px;margin:0/);
  assert.match(app, /if \(target !== 'microphoneTest'\) window\.NTCMicrophoneTest\?\.close\(\)/);
  assert.match(app, /if \(target === 'microphoneTest'\) window\.NTCMicrophoneTest\?\.open\(\)/);
});

test('microphone test does not save recordings or write microphone data to persistent storage', () => {
  const script = read('microphone-test.js');
  assert.doesNotMatch(script, /localStorage|sessionStorage|writeFile|saveFile|upload/i);
  assert.match(script, /setTimeout\(\(\) => stopRecording\(\), 30000\)/);
  assert.match(script, /URL\.revokeObjectURL\(playbackUrl\)/);
});
