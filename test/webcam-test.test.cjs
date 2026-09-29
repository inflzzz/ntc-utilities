const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

test('webcam test is available under Video with preview, camera controls, capabilities and photo actions', () => {
  const catalog = read('catalog.js');
  const html = read('index.html');
  assert.match(catalog, /\['webcamTest', 'Teste de webcam', 'webcamTest'\]/);
  for (const id of ['webcamTestView', 'webcamPreview', 'webcamDeviceSelect', 'webcamResolutionSelect', 'webcamFpsSelect', 'webcamCapabilityRange', 'webcamCapture', 'webcamPhotoPreview', 'webcamPhotoDownload']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must be present in the webcam tool`);
  }
});

test('webcam uses local camera capture, actual track capabilities, and stops the camera when leaving', () => {
  const script = read('webcam-test.js');
  const app = read('app.js');
  assert.match(script, /navigator\.mediaDevices\.getUserMedia\(\{ audio: false, video \}\)/);
  assert.match(script, /getCapabilities\?\.\(\)/);
  assert.match(script, /getSettings\?\.\(\)/);
  assert.match(script, /track\.applyConstraints\(constraints\)/);
  assert.match(script, /previous\?\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
  assert.match(script, /canvas\.getContext\('2d'\)\.drawImage\(ui\.video/);
  assert.match(script, /canvas\.toBlob\(resolve, 'image\/jpeg', 0\.92\)/);
  assert.match(script, /URL\.createObjectURL\(blob\)/);
  assert.match(script, /URL\.revokeObjectURL\(photoUrl\)/);
  assert.match(app, /if \(target !== 'webcamTest'\) window\.NTCWebcamTest\?\.close\(\)/);
  assert.match(app, /if \(target === 'webcamTest'\) window\.NTCWebcamTest\?\.open\(\)/);
});

test('webcam photo is session-only unless the user explicitly downloads it', () => {
  const script = read('webcam-test.js');
  assert.doesNotMatch(script, /localStorage|sessionStorage|writeFile|saveFile|upload/i);
  assert.match(script, /link\.download = `NTC-webcam-/);
  assert.match(read('webcam-test.css'), /\.webcam-actions>button\{[^}]*height:38px;min-height:38px;margin:0/);
});
