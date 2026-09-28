const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const clock = require('../src/media-project-playback-clock.js');

function state(positionMs = 0) {
  return { positionMs, playing: false, anchorPositionMs: positionMs, startedAtMs: null };
}

test('video playback clock catches up after RAF is suspended while minimized', () => {
  const playback = state();
  clock.start(playback, 10_000, 120_000);

  assert.equal(clock.positionAt(playback, 20_000, 120_000), 10_000);
  // No RAF callbacks occur during this interval. Absolute monotonic time still advances.
  assert.equal(clock.positionAt(playback, 50_000, 120_000), 40_000);
});

test('audio editor uses the monotonic clock instead of accumulating animation frames', () => {
  const ui = fs.readFileSync(path.resolve(__dirname, '../src/media-project-ui.js'), 'utf8');
  assert.match(ui, /audio: \{ positionMs: 0, playing: false, frame: 0, anchorPositionMs: 0, startedAtMs: null \}/);
  assert.match(ui, /function currentPositionMs\(kind[\s\S]*?return playbackClock\.positionAt\(state, nowMs, api\.durationMs\(model\(kind\)\)\)/);
  assert.doesNotMatch(ui, /timestamp - state\.lastFrame|state\.positionMs \+=/);
  const audio = state();
  clock.start(audio, 1_000, 120_000);
  assert.equal(clock.positionAt(audio, 31_000, 120_000), 30_000);
  assert.equal(clock.positionAt(audio, 61_000, 120_000), 60_000);
});

test('visual refreshes do not rebase the authoritative playback clock', () => {
  const playback = state();
  clock.start(playback, 5_000, 120_000);

  playback.positionMs = clock.positionAt(playback, 15_000, 120_000);
  assert.equal(playback.positionMs, 10_000);
  assert.equal(clock.positionAt(playback, 45_000, 120_000), 40_000);
});

test('focus/visibility refresh can read the live position without changing it', () => {
  const playback = state();
  clock.start(playback, 1_000, 90_000);

  const onRestore = now => {
    playback.positionMs = clock.positionAt(playback, now, 90_000);
    return playback.positionMs;
  };

  assert.equal(onRestore(31_000), 30_000);
  assert.equal(onRestore(31_016), 30_016);
  assert.equal(clock.positionAt(playback, 41_000, 90_000), 40_000);
});

test('all audio tracks can derive offsets from one authoritative timeline position', () => {
  const playback = state();
  clock.start(playback, 0, 180_000);
  const timelinePosition = clock.positionAt(playback, 40_000, 180_000);
  const tracks = [
    { timelineStartMs: 0, sourceStartMs: 0 },
    { timelineStartMs: 15_000, sourceStartMs: 2_500 },
    { timelineStartMs: 30_000, sourceStartMs: 8_000 },
  ];

  assert.deepEqual(tracks.map(track => track.sourceStartMs + timelinePosition - track.timelineStartMs), [40_000, 27_500, 18_000]);
});

test('pause freezes position across minimize and restore; resume continues from the pause point', () => {
  const playback = state();
  clock.start(playback, 10_000, 120_000);
  assert.equal(clock.pause(playback, 20_000, 120_000), 10_000);
  assert.equal(clock.positionAt(playback, 60_000, 120_000), 10_000);

  clock.start(playback, 60_000, 120_000);
  assert.equal(clock.positionAt(playback, 75_000, 120_000), 25_000);
});

test('manual seek during playback rebases the clock at the requested position', () => {
  const playback = state();
  clock.start(playback, 10_000, 120_000);
  assert.equal(clock.positionAt(playback, 20_000, 120_000), 10_000);
  assert.equal(clock.seek(playback, 65_000, 20_000, 120_000), 65_000);
  assert.equal(clock.positionAt(playback, 30_000, 120_000), 75_000);
});

test('playback that reaches project end while minimized clamps to the final position', () => {
  const playback = state();
  clock.start(playback, 10_000, 30_000);
  assert.equal(clock.positionAt(playback, 70_000, 30_000), 30_000);
  assert.equal(clock.pause(playback, 70_000, 30_000), 30_000);
  assert.equal(clock.positionAt(playback, 80_000, 30_000), 30_000);
});

test('project video editor restores from monotonic time without seeking from a stale UI playhead', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'src/video-project-ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');

  assert.match(html, /media-project-playback-clock\.js/);
  assert.match(ui, /const position = \(\) => clock\.positionAt\(playback, performance\.now\(\), duration\(\)\)/);
  assert.match(ui, /document\.addEventListener\('visibilitychange', \(\) => \{ refreshTransport\(\); updatePreview\(\); if \(playback\.playing && !document\.hidden\) \{ cancelAnimationFrame\(animationFrame\); frame\(\); \} \}\)/);
  assert.match(ui, /window\.addEventListener\('focus', \(\) => \{ refreshTransport\(\); updatePreview\(\); \}\)/);
  assert.match(ui, /function refreshTransport\(\)[\s\S]*?const at = position\(\)[\s\S]*?updatePlayhead\(\)/);
  assert.match(ui, /function frame\(\)[\s\S]*?if \(position\(\) >= duration\(\)\)[\s\S]*?refreshTransport\(\); updatePreview\(\)/);
  const restoreHandlers = ui.match(/document\.addEventListener\('visibilitychange'[\s\S]*?window\.addEventListener\('focus'[^;]+;/)?.[0] || '';
  assert.ok(restoreHandlers, 'visibility and focus handlers refresh the current playback');
  assert.doesNotMatch(restoreHandlers, /clock\.seek|\.currentTime\s*=/, 'restoring UI does not seek from the previous rendered time');
  assert.match(ui, /function syncPlayer\(player, clip, at, volume\)[\s\S]*?const expected = \(clip\.sourceStartMs \+ \(at - clip\.positionMs\) \* clip\.speed\) \/ 1000/);
  assert.match(ui, /if \(player\.readyState && Math\.abs\(player\.currentTime - expected\) > \(playback\.playing \? \.4 : \.06\)\)/, 'any drift correction derives from the current authoritative position');
});
