const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSettings, normalizePoints, interpolateTimeline, nextTimelinePoint,
  resolveTarget, matchException, solarTimes, solarTimeline, BUILTIN_PROFILES
} = require('../src/screen-light-model.cjs');

test('timeline interpolates smoothly and wraps across midnight', () => {
  const points = [{ minute: 60, kelvin: 2000 }, { minute: 720, kelvin: 6000 }];
  assert.equal(interpolateTimeline(points, 60), 2000);
  assert.equal(interpolateTimeline(points, 390), 4000);
  assert.equal(interpolateTimeline(points, 720), 6000);
  assert.equal(interpolateTimeline(points, 1110), 4000);
  assert.equal(interpolateTimeline(points, -330), 4000);
  assert.deepEqual(nextTimelinePoint(points, 1439), { minute: 60, kelvin: 2000 });
});

test('invalid and duplicated points are clamped, sorted and de-duplicated', () => {
  assert.deepEqual(normalizePoints([{ minute: 600, kelvin: 9999 }, { minute: 5, kelvin: 100 }, { minute: 600, kelvin: 5500 }]), [
    { minute: 5, kelvin: 1200 }, { minute: 600, kelvin: 5500 }
  ]);
  assert.equal(normalizePoints([{ minute: 100, kelvin: 2000 }]).length, 6);
});

test('state migration and invalid input retain safe schema defaults', () => {
  const old = normalizeSettings({ schemaVersion: 0, enabled: true, manualKelvin: 50, intensity: 500, dim: 99, transitionMs: 1, timeline: null });
  assert.equal(old.schemaVersion, 1);
  assert.equal(old.manualKelvin, 1200);
  assert.equal(old.intensity, 100);
  assert.equal(old.dim, 50);
  assert.equal(old.transitionMs, 600000);
  assert.equal(old.timeline.length, 6);
  assert.equal(normalizeSettings(null).enabled, false);
});

test('profile selection and exception priority are deterministic', () => {
  const date = new Date(2026, 8, 30, 23, 0);
  const settings = normalizeSettings({ enabled: true, mode: 'profile', profileId: 'night', pauseFullscreen: true,
    exceptions: [{ executable: 'VLC.exe', profileId: 'film' }, { executable: 'Photoshop.exe', profileId: 'off' }] });
  assert.equal(resolveTarget(settings, date, { executable: 'C:\\Tools\\VLC.exe', fullscreen: true }).kelvin, BUILTIN_PROFILES.film.kelvin);
  assert.equal(resolveTarget(settings, date, { executable: 'Photoshop.exe', fullscreen: true }).reason, 'exception');
  assert.equal(resolveTarget(settings, date, { executable: 'game.exe', fullscreen: true }).reason, 'fullscreen');
  assert.equal(resolveTarget(settings, date, { executable: 'game.exe', fullscreen: false }).kelvin, BUILTIN_PROFILES.night.kelvin);
  assert.equal(matchException(settings.exceptions, 'VLC.exe').profileId, 'film');
});

test('pause and disabled states restore neutral target, then resume', () => {
  const date = new Date(2026, 8, 30, 12, 0);
  assert.equal(resolveTarget({ enabled: false }, date).active, false);
  assert.equal(resolveTarget({ enabled: true, pauseUntil: -1 }, date).reason, 'paused');
  assert.equal(resolveTarget({ enabled: true, pauseUntil: date.getTime() + 1000 }, date).reason, 'paused');
  assert.equal(resolveTarget({ enabled: true, pauseUntil: date.getTime() - 1000 }, date).active, true);
});

test('custom profiles persist and reserved presets are not overwritten', () => {
  const settings = normalizeSettings({ customProfiles: [{ id: 'custom-test', name: 'Meu perfil', kelvin: 3300, intensity: 42, dim: 13 }],
    enabled: true, mode: 'profile', profileId: 'custom-test' });
  assert.equal(resolveTarget(settings, new Date(2026, 8, 30, 9)).kelvin, 3300);
  assert.equal(normalizeSettings(JSON.parse(JSON.stringify(settings))).customProfiles[0].name, 'Meu perfil');
  assert.equal(normalizeSettings({ profileId: 'unknown' }).profileId, 'night');
});

test('monitor overrides reject arbitrary keys and retain distinct displays', () => {
  const a = '\\\\.\\DISPLAY1', b = '\\\\.\\DISPLAY2';
  const settings = normalizeSettings({ monitorOverrides: { [a]: { kelvin: 2800 }, [b]: { enabled: false }, invalid: { kelvin: 1200 } } });
  assert.equal(settings.monitorOverrides[a].kelvin, 2800);
  assert.equal(settings.monitorOverrides[b].enabled, false);
  assert.equal(settings.monitorOverrides.invalid, undefined);
});

test('solar times are local, offline, seasonal and handle polar dates', () => {
  const equinox = solarTimes(new Date(2026, 2, 20, 12), 0, 0);
  const offset = new Date(2026, 2, 20, 12).getTimezoneOffset();
  assert.ok((equinox.sunrise + offset + 1440) % 1440 >= 340 && (equinox.sunrise + offset + 1440) % 1440 <= 390);
  assert.ok((equinox.sunset + offset + 1440) % 1440 >= 1060 && (equinox.sunset + offset + 1440) % 1440 <= 1110);
  const polar = solarTimes(new Date(2026, 5, 21, 12), 89, 0);
  assert.equal(polar, null);
  const schedule = solarTimeline(new Date(2026, 2, 20, 12), { enabled: true, configured: true, latitude: 0, longitude: 0 });
  assert.ok(schedule.points.length >= 2);
  assert.equal(solarTimeline(new Date(), { enabled: true, configured: false }), null);
});
