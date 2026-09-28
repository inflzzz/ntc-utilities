((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCVideoProjectLayout = api;
})(globalThis, () => {
  'use strict';

  const KEY = 'ntc-video-editor-layout-v2';
  const DEFAULTS = Object.freeze({
    media: 220,
    inspector: 270,
    timeline: 300,
    mediaCollapsed: false,
    inspectorCollapsed: false,
    sidebarCompact: true,
    trackDensity: 'normal',
    mediaView: 'list'
  });

  const finite = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  function normalize(value = {}) {
    return {
      media: finite(value.media, DEFAULTS.media, 150, 360),
      inspector: finite(value.inspector, DEFAULTS.inspector, 210, 390),
      timeline: finite(value.timeline, DEFAULTS.timeline, 220, 700),
      mediaCollapsed: Boolean(value.mediaCollapsed),
      inspectorCollapsed: Boolean(value.inspectorCollapsed),
      sidebarCompact: value.sidebarCompact !== false,
      trackDensity: ['compact', 'normal', 'expanded'].includes(value.trackDensity) ? value.trackDensity : DEFAULTS.trackDensity,
      mediaView: ['list', 'grid'].includes(value.mediaView) ? value.mediaView : DEFAULTS.mediaView
    };
  }
  function load(storage) {
    try { return normalize(JSON.parse(storage.getItem(KEY) || '{}')); }
    catch { return normalize(); }
  }
  function save(storage, value) {
    const normalized = normalize(value);
    storage.setItem(KEY, JSON.stringify(normalized));
    return normalized;
  }

  return Object.freeze({ KEY, DEFAULTS, normalize, load, save });
});
