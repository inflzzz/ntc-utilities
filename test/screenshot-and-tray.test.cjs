const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('screenshot capture has a separate shortcut, destination and annotation editor', () => {
  const html = read('src/index.html');
  const app = read('src/app.js');
  const editor = read('src/screenshot-editor.js');
  const preload = read('preload.cjs');
  const main = read('main.cjs');
  for (const tool of ['pen', 'arrow', 'rect', 'ellipse', 'highlight', 'blur', 'pixelate', 'crop', 'text', 'number']) assert.match(html, new RegExp(`data-shot-tool="${tool}"`));
  assert.match(html, /id="screenshotArrowSize"/);
  assert.match(html, /id="captureScreenshot"/);
  assert.match(html, /id="screenshotShortcut"/);
  assert.match(html, /id="chooseScreenshotFolder"/);
  assert.match(html, /id="screenshotUndo"/);
  assert.match(editor, /window\.NTC_ScreenshotEditor/);
  assert.match(editor, /output\.toBlob/);
  assert.match(app, /window\.ntc\.saveScreenshot/);
  assert.match(app, /window\.ntc\.copyScreenshot/);
  assert.match(preload, /registerScreenshotShortcut:.*register-screenshot-shortcut/);
  assert.match(preload, /onScreenshotHotkeyCapture/);
  assert.match(main, /ipcMain\.handle\('screen-capture-save'/);
  assert.match(main, /ipcMain\.handle\('screen-capture-copy'/);
  assert.match(editor, /event\.key === 'Escape'[\s\S]*closeEditor\(\)/);
  assert.match(editor, /event\.key\.toLowerCase\(\) === 'c'[\s\S]*copyScreenshot/);
  assert.match(editor, /function arrowCap\(/);
  assert.match(editor, /function drawArrowHead\(/);
  assert.match(editor, /target\.lineCap = 'butt'[\s\S]*target\.lineTo\(x2 - cap\.ux \* cap\.shaftInset/);
  assert.match(editor, /copyScreenshot\(true\)/);
  assert.match(editor, /if \(copied && closeAfterCopy\) closeEditor\(\)/);
  assert.match(editor, /beginHandleDrag\(event, point, 'image-move'/);
  assert.match(editor, /command\.x1 = drag\.originalX \+ point\.x - drag\.startX/);
  assert.match(html, /title="Remover elemento"/);
  assert.match(read('src/styles.css'), /#closeScreenshotEditor:hover \{ color: #fff; background: transparent; \}/);
  assert.doesNotMatch(preload, /commitScreenshot|finishScreenshot/);
});

test('minimizing hides the window in the tray while the main-process roll clock keeps running', () => {
  const main = read('main.cjs');
  assert.match(main, /window-minimize',[\s\S]*ensureTray\(\); window\.hide\(\)/);
  assert.match(main, /mainWindow\.on\('close',[\s\S]*event\.preventDefault\(\); ensureTray\(\); mainWindow\.hide\(\)/);
  assert.match(main, /trayIcon\.on\('click', showMainWindow\)/);
  assert.match(main, /label: 'Sair do NTC Utilities', click: requestExitFromTray/);
  assert.match(main, /function requestExitFromTray\(\)[\s\S]*if \(recordingSessions\.size[\s\S]*screen-close-request[\s\S]*forceClose = true;[\s\S]*app\.quit\(\)/);
  assert.match(main, /rngClock = setInterval\(\(\) => \{[\s\S]*performRngRoll\(\)/);
  assert.match(main, /Auto-roll \$\{active \? 'ativo em segundo plano' : 'pausado'\}/);
});

test('screen recording starts with computer audio and the selected microphone without asking first', () => {
  const html = read('src/index.html');
  const app = read('src/app.js');
  assert.match(html, /id="recordMicrophone"/);
  assert.match(app, /getScreenStream\(true, true, microphoneId\)/);
  assert.match(app, /Microfone indisponível; a gravação seguirá com o áudio do computador/);
  assert.doesNotMatch(app, /recordingAudioChoice|Microfone da gravação/);
  assert.doesNotMatch(html, /Deseja adicionar o microfone ao áudio do computador/);
});

test('maximized windows use available width across tools', () => {
  const main = read('main.cjs');
  const preload = read('preload.cjs');
  const app = read('src/app.js');
  const css = read('src/styles.css');
  assert.match(main, /mainWindow\.on\('maximize',[\s\S]*window-maximized/);
  assert.match(preload, /onWindowMaximized/);
  assert.match(app, /window\.ntc\.onWindowMaximized\(updateMaximizedLayout\)/);
  assert.match(css, /body\.window-maximized \.view \{ width: 100%; max-width: none/);
});

test('existing users see the full release changelog once after upgrading', () => {
  const app = read('src/app.js');
  const changelog = read('src/changelog.js');
  assert.match(app, /hadExistingAppData = \[[^\]]*'ntc-folder'[^\]]*\]/);
  assert.match(app, /function showChangelogAfterUpgrade\(version\)/);
  assert.match(app, /ntc-last-seen-changelog-version/);
  assert.match(app, /window\.setTimeout\(\(\) => \{ localStorage\.setItem\(key, version\); openChangelog\(\); \}, 2500\)/);
  assert.match(app, /showChangelogAfterUpgrade\(version\)/);
  assert.match(changelog, /version: '0\.6\.0'/);
});

test('RNG progress is saved outside the installation with a recoverable local backup', () => {
  const main = read('main.cjs');
  assert.match(main, /app\.getPath\('userData'\)/);
  assert.match(main, /ntc-rng-state\.backup\.json/);
  assert.match(main, /JSON\.parse\(fs\.readFileSync\(rngBackupPath\(\), 'utf8'\)\)/);
  assert.match(main, /fs\.copyFileSync\(rngBackupPath\(\), rngStatePath\(\)\)/);
  assert.match(main, /persistRngGame\(\);[\s\S]*globalShortcut\.unregisterAll\(\)/);
});
