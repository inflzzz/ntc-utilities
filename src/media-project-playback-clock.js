((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCMediaProjectPlaybackClock = api;
})(globalThis, () => {
  'use strict';

  function clampPosition(positionMs, durationMs) {
    const duration = Math.max(0, Number(durationMs) || 0);
    const position = Number(positionMs);
    return Math.max(0, Math.min(duration, Number.isFinite(position) ? position : 0));
  }

  function positionAt(state, nowMs, durationMs) {
    if (!state) return 0;
    if (!state.playing) return clampPosition(state.positionMs, durationMs);
    const now = Number(nowMs);
    const startedAt = Number(state.startedAtMs);
    const anchor = Number(state.anchorPositionMs);
    if (!Number.isFinite(now) || !Number.isFinite(startedAt) || !Number.isFinite(anchor)) {
      return clampPosition(state.positionMs, durationMs);
    }
    return clampPosition(anchor + Math.max(0, now - startedAt), durationMs);
  }

  function start(state, nowMs, durationMs) {
    let position = clampPosition(state.positionMs, durationMs);
    if (position >= Math.max(0, Number(durationMs) || 0)) position = 0;
    state.positionMs = position;
    state.anchorPositionMs = position;
    state.startedAtMs = Number(nowMs);
    state.playing = true;
    return position;
  }

  function pause(state, nowMs, durationMs) {
    const position = positionAt(state, nowMs, durationMs);
    state.positionMs = position;
    state.anchorPositionMs = position;
    state.startedAtMs = null;
    state.playing = false;
    return position;
  }

  function seek(state, positionMs, nowMs, durationMs) {
    const position = clampPosition(positionMs, durationMs);
    state.positionMs = position;
    state.anchorPositionMs = position;
    state.startedAtMs = state.playing ? Number(nowMs) : null;
    return position;
  }

  return Object.freeze({ clampPosition, positionAt, start, pause, seek });
});
