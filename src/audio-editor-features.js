((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCAudioEditorFeatures = api;
})(globalThis, () => {
  'use strict';

  const FORMATS = Object.freeze({
    mp3: { label: 'MP3', codec: 'libmp3lame', bitrate: true, cover: true },
    m4a: { label: 'M4A / AAC', codec: 'aac', bitrate: true, cover: true },
    aac: { label: 'AAC', codec: 'aac', bitrate: true, cover: false },
    ogg: { label: 'OGG Vorbis', codec: 'libvorbis', bitrate: true, cover: false },
    opus: { label: 'Opus', codec: 'libopus', bitrate: true, cover: false },
    wav: { label: 'WAV', codec: 'pcm_s16le', bitrate: false, cover: false },
    flac: { label: 'FLAC', codec: 'flac', bitrate: false, cover: true },
    aiff: { label: 'AIFF', codec: 'pcm_s16be', bitrate: false, cover: false },
    wma: { label: 'WMA', codec: 'wmav2', bitrate: true, cover: false },
    ac3: { label: 'AC-3', codec: 'ac3', bitrate: true, cover: false }
  });
  const BITRATES = Object.freeze(['128', '192', '256', '320']);
  const PRESETS = Object.freeze({
    voz: { gain: 1, eqBass: -2, eqMid: 3, eqTreble: 2, removeSilence: false },
    musica: { gain: 0, eqBass: 2, eqMid: 0, eqTreble: 2, removeSilence: false },
    podcast: { gain: 2, eqBass: -1, eqMid: 3, eqTreble: 1, removeSilence: true }
  });
  const METADATA_FIELDS = Object.freeze(['title', 'artist', 'album', 'year', 'genre']);
  function bounded(value, minimum, maximum, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }
  function normalizeEffects(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    return {
      gain: bounded(input.gain, -120, 60),
      eqBass: bounded(input.eqBass, -24, 24),
      eqMid: bounded(input.eqMid, -24, 24),
      eqTreble: bounded(input.eqTreble, -24, 24),
      normalize: Boolean(input.normalize),
      removeSilence: Boolean(input.removeSilence)
    };
  }
  function normalizeOutput(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    const format = Object.hasOwn(FORMATS, input.format) ? input.format : 'wav';
    const metadata = {};
    METADATA_FIELDS.forEach(field => { metadata[field] = String(input.metadata?.[field] || '').slice(0, field === 'year' ? 4 : 260); });
    return {
      format,
      quality: FORMATS[format].bitrate && BITRATES.includes(String(input.quality)) ? String(input.quality) : (FORMATS[format].bitrate ? '192' : 'lossless'),
      outputName: String(input.outputName || 'Mix NTC').slice(0, 150),
      metadata,
      coverPath: typeof input.coverPath === 'string' ? input.coverPath.slice(0, 32768) : '',
      preserveSourceCover: input.preserveSourceCover !== false
    };
  }
  function codecArgs(format, quality) {
    const details = FORMATS[format];
    if (!details) throw new Error('Formato de áudio inválido.');
    return details.bitrate ? ['-c:a', details.codec, '-b:a', `${BITRATES.includes(String(quality)) ? quality : '192'}k`] : ['-c:a', details.codec];
  }
  function effectFilters(input) {
    const effects = normalizeEffects(input);
    const filters = [];
    if (effects.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    if (effects.gain) filters.push(`volume=${effects.gain}dB`);
    if (effects.eqBass) filters.push(`equalizer=f=100:t=q:w=1:g=${effects.eqBass}`);
    if (effects.eqMid) filters.push(`equalizer=f=1000:t=q:w=1:g=${effects.eqMid}`);
    if (effects.eqTreble) filters.push(`equalizer=f=6000:t=q:w=1:g=${effects.eqTreble}`);
    if (effects.removeSilence) filters.push('silenceremove=start_periods=1:start_duration=0.25:start_threshold=-45dB:stop_periods=-1:stop_duration=0.25:stop_threshold=-45dB');
    return filters;
  }
  return { FORMATS, BITRATES, PRESETS, METADATA_FIELDS, normalizeEffects, normalizeOutput, codecArgs, effectFilters };
});
