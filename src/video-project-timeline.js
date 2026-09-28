((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCVideoProjectTimeline = api;
})(globalThis, () => {
  'use strict';

  const STEPS_SECONDS = Object.freeze([1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400]);
  function formatTime(valueMs) {
    const total = Math.floor(Math.max(0, Number(valueMs) || 0) / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const seconds = total % 60;
    return hours
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  function rulerStepSeconds(pxPerSecond, durationMs, minimumSpacing = 82, maximumMarkers = 1600) {
    const px = Math.max(0.01, Number(pxPerSecond) || 1);
    const durationSeconds = Math.max(1, (Number(durationMs) || 0) / 1000);
    return STEPS_SECONDS.find(step => step * px >= minimumSpacing && durationSeconds / step <= maximumMarkers)
      || STEPS_SECONDS[STEPS_SECONDS.length - 1];
  }
  function zoomIncrement(pxPerSecond) {
    const zoom = Math.max(0.05, Number(pxPerSecond) || 1);
    if (zoom < 1) return 0.1;
    if (zoom < 5) return 0.5;
    if (zoom < 20) return 2;
    return 20;
  }
  function filmstripCount(widthPx, pxPerSecond) {
    if (Number(pxPerSecond) < 24 || Number(widthPx) < 88) return 0;
    return Math.max(1, Math.min(8, Math.floor(Number(widthPx) / 92)));
  }

  return Object.freeze({ STEPS_SECONDS, formatTime, rulerStepSeconds, zoomIncrement, filmstripCount });
});
