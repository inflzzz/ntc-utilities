const SCHEMA_VERSION = 1;
const MIN_KELVIN = 1200;
const MAX_KELVIN = 6500;
const TRANSITIONS = [0, 10_000, 60_000, 600_000, 1_800_000, 3_600_000];
const DEFAULT_POINTS = [
  { minute: 0, kelvin: 2200 }, { minute: 420, kelvin: 4500 },
  { minute: 540, kelvin: 6500 }, { minute: 1020, kelvin: 5500 },
  { minute: 1140, kelvin: 4200 }, { minute: 1320, kelvin: 3000 }
];
const BUILTIN_PROFILES = Object.freeze({
  day: { name: 'Dia', kelvin: 6500, intensity: 100, dim: 0 },
  night: { name: 'Noite', kelvin: 3000, intensity: 90, dim: 0 },
  dawn: { name: 'Madrugada', kelvin: 2200, intensity: 85, dim: 10 },
  reading: { name: 'Leitura', kelvin: 4000, intensity: 65, dim: 0 },
  film: { name: 'Filme', kelvin: 5000, intensity: 45, dim: 0 },
  games: { name: 'Jogos', kelvin: 5500, intensity: 35, dim: 0 },
  work: { name: 'Trabalho', kelvin: 6000, intensity: 45, dim: 0 },
  darkroom: { name: 'Darkroom', kelvin: 2600, intensity: 70, dim: 25 }
});

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}
function normalizePoints(input) {
  const map = new Map();
  for (const point of Array.isArray(input) ? input.slice(0, 48) : []) {
    if (!point || !Number.isFinite(Number(point.minute)) || !Number.isFinite(Number(point.kelvin))) continue;
    const minute = Math.round(clamp(point.minute, 0, 1439) / 5) * 5;
    map.set(Math.min(1435, minute), { minute: Math.min(1435, minute), kelvin: Math.round(clamp(point.kelvin, MIN_KELVIN, MAX_KELVIN)) });
  }
  const points = [...map.values()].sort((a, b) => a.minute - b.minute);
  return points.length >= 2 ? points : DEFAULT_POINTS.map(point => ({ ...point }));
}
function normalizeProfile(value, index) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name || '').trim().slice(0, 40);
  if (!name) return null;
  return {
    id: /^[a-z0-9-]{8,64}$/.test(String(value.id || '')) ? value.id : `custom-${index + 1}`,
    name,
    kelvin: Math.round(clamp(value.kelvin, MIN_KELVIN, MAX_KELVIN, 4500)),
    intensity: Math.round(clamp(value.intensity, 0, 100, 100)),
    dim: Math.round(clamp(value.dim, 0, 50, 0))
  };
}
function normalizeSettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const profiles = (Array.isArray(raw.customProfiles) ? raw.customProfiles : []).slice(0, 30).map(normalizeProfile).filter(Boolean);
  const ids = new Set();
  const customProfiles = profiles.filter(profile => !ids.has(profile.id) && ids.add(profile.id));
  const knownProfiles = new Set([...Object.keys(BUILTIN_PROFILES), ...customProfiles.map(profile => profile.id)]);
  const mode = ['automatic', 'manual', 'profile'].includes(raw.mode) ? raw.mode : 'automatic';
  const transitionMs = TRANSITIONS.includes(Number(raw.transitionMs)) ? Number(raw.transitionMs) : 600_000;
  const monitorOverrides = {};
  for (const [id, value] of Object.entries(raw.monitorOverrides || {})) {
    if (!/^\\\\\.\\DISPLAY\d+$/i.test(id) || !value || typeof value !== 'object') continue;
    monitorOverrides[id] = { enabled: value.enabled !== false, kelvin: Math.round(clamp(value.kelvin, MIN_KELVIN, MAX_KELVIN, 4500)) };
  }
  const exceptions = (Array.isArray(raw.exceptions) ? raw.exceptions : []).slice(0, 40).map(rule => {
    const executable = String(rule?.executable || '').trim().slice(0, 500);
    if (!executable || !/\.exe$/i.test(executable)) return null;
    const profileId = String(rule?.profileId || 'off');
    return { executable, enabled: rule.enabled !== false, profileId: profileId === 'off' || knownProfiles.has(profileId) ? profileId : 'off' };
  }).filter(Boolean);
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: raw.enabled === true,
    mode,
    manualKelvin: Math.round(clamp(raw.manualKelvin, MIN_KELVIN, MAX_KELVIN, 4500)),
    intensity: Math.round(clamp(raw.intensity, 0, 100, 100)),
    dim: Math.round(clamp(raw.dim, 0, 50, 0)),
    timeline: normalizePoints(raw.timeline || DEFAULT_POINTS),
    transitionMs,
    profileId: knownProfiles.has(raw.profileId) ? raw.profileId : 'night',
    customProfiles,
    pauseUntil: raw.pauseUntil === -1 ? -1 : Math.max(0, Math.round(clamp(raw.pauseUntil, 0, Number.MAX_SAFE_INTEGER, 0))),
    monitorOverrides,
    exceptions,
    pauseFullscreen: raw.pauseFullscreen === true,
    solar: {
      enabled: raw.solar?.enabled === true,
      configured: raw.solar?.configured === true,
      latitude: clamp(raw.solar?.latitude, -90, 90, 0),
      longitude: clamp(raw.solar?.longitude, -180, 180, 0),
      city: String(raw.solar?.city || '').trim().slice(0, 80)
    },
    shortcuts: Object.fromEntries(Object.entries(raw.shortcuts || {}).filter(([key, value]) =>
      ['toggle', 'warmer', 'cooler', 'intensityUp', 'intensityDown', 'night', 'pauseHour'].includes(key) && typeof value === 'string' && value.length <= 80
    ))
  };
}
function solarTimes(date, latitude, longitude) {
  const rad = Math.PI / 180;
  const day = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86_400_000);
  const yearAngle = 2 * Math.PI / 365 * (day - 1);
  const equation = 229.18 * (0.000075 + 0.001868 * Math.cos(yearAngle) - 0.032077 * Math.sin(yearAngle) -
    0.014615 * Math.cos(2 * yearAngle) - 0.040849 * Math.sin(2 * yearAngle));
  const declination = 0.006918 - 0.399912 * Math.cos(yearAngle) + 0.070257 * Math.sin(yearAngle) -
    0.006758 * Math.cos(2 * yearAngle) + 0.000907 * Math.sin(2 * yearAngle) -
    0.002697 * Math.cos(3 * yearAngle) + 0.00148 * Math.sin(3 * yearAngle);
  const lat = clamp(latitude, -90, 90) * rad;
  const cosine = (Math.cos(90.833 * rad) / (Math.cos(lat) * Math.cos(declination))) - Math.tan(lat) * Math.tan(declination);
  if (!Number.isFinite(cosine) || cosine < -1 || cosine > 1) return null;
  const hourAngle = Math.acos(cosine) / rad;
  const offset = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTimezoneOffset();
  const wrap = minute => ((Math.round(minute) % 1440) + 1440) % 1440;
  return {
    sunrise: wrap(720 - 4 * (longitude + hourAngle) - equation - offset),
    sunset: wrap(720 - 4 * (longitude - hourAngle) - equation - offset)
  };
}
function solarTimeline(date, solar) {
  if (!solar?.enabled || !solar.configured) return null;
  const times = solarTimes(date, solar.latitude, solar.longitude);
  if (!times) return null;
  const points = [
    { minute: 0, kelvin: 2200 },
    { minute: times.sunrise - 60, kelvin: 3500 },
    { minute: times.sunrise + 60, kelvin: 6500 },
    { minute: times.sunset - 60, kelvin: 5500 },
    { minute: times.sunset + 60, kelvin: 3500 },
    { minute: 1320, kelvin: 2800 }
  ].map(point => ({ ...point, minute: Math.max(0, Math.min(1435, point.minute)) }));
  return { times, points: normalizePoints(points) };
}
function interpolateTimeline(points, minute) {
  const rows = normalizePoints(points);
  const time = ((minute % 1440) + 1440) % 1440;
  let prior = rows[rows.length - 1];
  let next = rows[0];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].minute <= time) prior = rows[i];
    if (rows[i].minute > time) { next = rows[i]; break; }
  }
  const from = prior.minute;
  const to = next.minute <= from ? next.minute + 1440 : next.minute;
  const current = time < from ? time + 1440 : time;
  return Math.round(prior.kelvin + (next.kelvin - prior.kelvin) * ((current - from) / (to - from)));
}
function nextTimelinePoint(points, minute) {
  const rows = normalizePoints(points);
  const time = ((minute % 1440) + 1440) % 1440;
  return rows.find(point => point.minute > time) || rows[0];
}
function matchException(exceptions, executable) {
  const name = String(executable || '').toLowerCase();
  if (!name) return null;
  return (exceptions || []).find(rule => rule.enabled &&
    (rule.executable.toLowerCase() === name ||
      (!rule.executable.includes('\\') && name.split('\\').pop() === rule.executable.toLowerCase()))) || null;
}
function resolveTarget(settingsInput, now = new Date(), context = {}) {
  const settings = normalizeSettings(settingsInput);
  if (!settings.enabled) return { active: false, reason: 'disabled', kelvin: 6500, intensity: 0, dim: 0 };
  const rule = matchException(settings.exceptions, context.executable);
  if (rule?.profileId === 'off') return { active: false, reason: 'exception', kelvin: 6500, intensity: 0, dim: 0 };
  if (settings.pauseUntil === -1 || settings.pauseUntil > now.getTime()) return { active: false, reason: 'paused', kelvin: 6500, intensity: 0, dim: 0 };
  if (!rule && settings.pauseFullscreen && context.fullscreen) return { active: false, reason: 'fullscreen', kelvin: 6500, intensity: 0, dim: 0 };
  const profile = rule ? (BUILTIN_PROFILES[rule.profileId] || settings.customProfiles.find(item => item.id === rule.profileId)) :
    settings.mode === 'profile' ? (BUILTIN_PROFILES[settings.profileId] || settings.customProfiles.find(item => item.id === settings.profileId)) : null;
  const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const solar = solarTimeline(now, settings.solar);
  return {
    active: true,
    reason: rule ? 'exception-profile' : settings.mode,
    kelvin: profile?.kelvin ?? (settings.mode === 'automatic' ? interpolateTimeline(solar?.points || settings.timeline, minute) : settings.manualKelvin),
    intensity: profile?.intensity ?? settings.intensity,
    dim: profile?.dim ?? settings.dim
  };
}

module.exports = { SCHEMA_VERSION, MIN_KELVIN, MAX_KELVIN, TRANSITIONS, DEFAULT_POINTS, BUILTIN_PROFILES, normalizeSettings, normalizePoints, interpolateTimeline, nextTimelinePoint, matchException, resolveTarget, solarTimes, solarTimeline };
