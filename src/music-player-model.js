'use strict';
(() => {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function visibleRange(scrollTop, viewportHeight, total, rowHeight = 58, overscan = 8) {
    const first = clamp(Math.floor(scrollTop / rowHeight) - overscan, 0, total);
    const last = clamp(Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan, first, total);
    return { first, last };
  }
  function virtualLayout(scrollTop, viewportHeight, total, rowHeight = 58, overscan = 8) {
    const height = Math.min(total * rowHeight, 8_000_000);
    if (total * rowHeight <= height) {
      const range = visibleRange(scrollTop, viewportHeight, total, rowHeight, overscan);
      return { ...range, top: range.first * rowHeight, height };
    }
    const visible = Math.ceil(viewportHeight / rowHeight);
    const maxScroll = Math.max(1, height - viewportHeight);
    const logical = clamp(scrollTop / maxScroll, 0, 1) * Math.max(0, total - visible);
    const first = clamp(Math.floor(logical) - overscan, 0, total);
    const last = clamp(first + visible + overscan * 2 + 1, first, total);
    const top = clamp(scrollTop - (logical - first) * rowHeight, 0, Math.max(0, height - (last - first) * rowHeight));
    return { first, last, top, height };
  }
  function normalizeQueue(value) {
    return (Array.isArray(value) ? value : []).slice(0, 100000).filter(item => Number.isSafeInteger(Number(item?.id)) && Number(item.id) > 0).map(item => ({ id: Number(item.id), key: String(item.key || `${item.id}-${Math.random()}`) }));
  }
  function moveQueueItem(items, from, to) {
    const result = items.slice();
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= result.length || to < 0 || to >= result.length) return result;
    const [item] = result.splice(from, 1); result.splice(to, 0, item); return result;
  }
  function playThreshold(duration) { return Number.isFinite(duration) && duration > 0 ? Math.min(30, duration * 0.5) : 30; }
  function shouldRecordPlay(elapsed, duration, alreadyRecorded) { return !alreadyRecorded && elapsed >= playThreshold(duration); }
  function transitionTrackIdentity(state = {}, action = {}) {
    const next = { selectedTrackId: state.selectedTrackId ?? null, currentTrackId: state.currentTrackId ?? null };
    const id = Number(action.id);
    if (!Number.isSafeInteger(id) || id <= 0) return next;
    if (action.type === 'select') next.selectedTrackId = id;
    if (action.type === 'play') {
      next.currentTrackId = id;
      if (action.select === true) next.selectedTrackId = id;
    }
    return next;
  }
  function selectTrackInView(state = {}, id, view = 'library') {
    const identity = transitionTrackIdentity(state, { type: 'select', id });
    return {
      ...state,
      ...identity,
      selectedQueueKey: view === 'queue' ? state.selectedQueueKey ?? null : null,
      selectedPlaylistItemId: view === 'playlist' ? state.selectedPlaylistItemId ?? null : null
    };
  }
  function trackRowState(state = {}, id) {
    const trackId = Number(id);
    return { selected: Number(state.selectedTrackId) === trackId, current: Number(state.currentTrackId) === trackId, playing: Number(state.currentTrackId) === trackId && state.playing === true };
  }
  function libraryCountLabel(visible, total) {
    const count = Math.max(0, Number(total) || 0);
    const shown = Math.max(0, Math.min(count, Number(visible) || 0));
    return shown === count ? `${count} faixas` : `${shown} de ${count} faixas`;
  }
  function crossfadeVolumes(elapsed, duration, volume) {
    const progress = clamp((Number(elapsed) || 0) / Math.max(0.001, Number(duration) || 0), 0, 1);
    const level = clamp(Number(volume) || 0, 0, 1);
    return { from: level * (1 - progress), to: level * progress };
  }
  function nextQueueIndex({ length, index, repeat = 'off', shuffle = false }, random = Math.random) {
    if (length < 1) return -1;
    if (repeat === 'one') return index;
    if (shuffle && length > 1) { const offset = 1 + Math.floor(clamp(random(), 0, 0.999999999) * (length - 1)); return (index + offset) % length; }
    if (index + 1 < length) return index + 1;
    return repeat === 'all' ? 0 : -1;
  }
  function parseLrc(content) {
    const lines = [];
    for (const line of String(content || '').split(/\r?\n/)) {
      const timestamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
      const lyric = line.replace(/(?:\[\d{1,3}:\d{2}(?:\.\d{1,3})?\])+/g, '').trim();
      for (const match of timestamps) lines.push({ time: Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`), text: lyric });
    }
    return lines.sort((a, b) => a.time - b.time);
  }
  const model = Object.freeze({ visibleRange, virtualLayout, normalizeQueue, moveQueueItem, playThreshold, shouldRecordPlay, transitionTrackIdentity, selectTrackInView, trackRowState, libraryCountLabel, crossfadeVolumes, nextQueueIndex, parseLrc });
  globalThis.ntcMusicModel = model;
  if (typeof module === 'object' && module.exports) module.exports = model;
})();
