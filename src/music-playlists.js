(() => {
  function normalizeMusicPlaylists(value) {
    if (!Array.isArray(value)) return [];
    const ids = new Set();
    return value.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const id = typeof item.id === 'string' ? item.id.trim().slice(0, 100) : '';
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 48) : '';
      if (!id || !name || ids.has(id)) return [];
      ids.add(id);
      const description = typeof item.description === 'string' ? item.description.trim().slice(0, 300) : '';
      const coverDataUrl = typeof item.coverDataUrl === 'string' && item.coverDataUrl.length <= 600_000 && /^data:image\/(?:jpeg|png|webp);base64,/i.test(item.coverDataUrl) ? item.coverDataUrl : '';
      const seenTracks = new Set();
      const trackIds = (Array.isArray(item.trackIds) ? item.trackIds : []).filter(trackId => {
        if (typeof trackId !== 'string' || !trackId || seenTracks.has(trackId)) return false;
        seenTracks.add(trackId);
        return true;
      });
      return [{ id, name, description, coverDataUrl, trackIds }];
    });
  }

  function toggleMusicPlaylistTrack(playlist, trackId) {
    if (!playlist || typeof trackId !== 'string' || !trackId) return playlist;
    const hasTrack = playlist.trackIds.includes(trackId);
    return { ...playlist, trackIds: hasTrack ? playlist.trackIds.filter(id => id !== trackId) : [...playlist.trackIds, trackId] };
  }

  function reorderMusicPlaylistTracks(playlist, sourceId, targetId, position = 'before') {
    if (!playlist) return playlist;
    const ids = [...playlist.trackIds];
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return playlist;
    const [source] = ids.splice(sourceIndex, 1);
    const adjustedTarget = ids.indexOf(targetId);
    ids.splice(adjustedTarget + (position === 'after' ? 1 : 0), 0, source);
    return { ...playlist, trackIds: ids };
  }

  const musicPlaylists = Object.freeze({ normalizeMusicPlaylists, toggleMusicPlaylistTrack, reorderMusicPlaylistTracks });
  globalThis.ntcMusicPlaylists = musicPlaylists;
  if (typeof module === 'object' && module.exports) module.exports = musicPlaylists;
})();
