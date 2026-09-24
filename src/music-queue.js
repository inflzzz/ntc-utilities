'use strict';

function reorderMusicTracks(tracks, sourceId, targetId, position = 'before') {
  const reordered = tracks.slice();
  if (sourceId === targetId) return reordered;
  const sourceIndex = reordered.findIndex(track => track.id === sourceId);
  const targetIndex = reordered.findIndex(track => track.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return reordered;
  const [source] = reordered.splice(sourceIndex, 1);
  const updatedTargetIndex = reordered.findIndex(track => track.id === targetId);
  reordered.splice(updatedTargetIndex + (position === 'after' ? 1 : 0), 0, source);
  return reordered;
}

function reorderMusicTrackIds(trackIds, sourceId, targetId, position = 'before') {
  const ids = [...trackIds];
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return ids;
  const [source] = ids.splice(sourceIndex, 1);
  const adjustedTarget = ids.indexOf(targetId);
  ids.splice(adjustedTarget + (position === 'after' ? 1 : 0), 0, source);
  return ids;
}

function reorderVisibleMusicTrackIds(allIds, visibleIds, sourceId, targetId, position = 'before') {
  const allSet = new Set(allIds);
  const visibleSet = new Set(visibleIds.filter(id => allSet.has(id)));
  if (!visibleSet.has(sourceId) || !visibleSet.has(targetId)) return [...allIds];
  const visibleOrder = visibleIds.filter(id => visibleSet.has(id));
  const reorderedVisible = reorderMusicTrackIds(visibleOrder, sourceId, targetId, position);
  let nextVisible = 0;
  return allIds.map(id => visibleSet.has(id) ? reorderedVisible[nextVisible++] : id);
}

const musicQueue = Object.freeze({ reorderMusicTracks, reorderMusicTrackIds, reorderVisibleMusicTrackIds });
globalThis.ntcMusicQueue = musicQueue;
if (typeof module === 'object' && module.exports) module.exports = musicQueue;
