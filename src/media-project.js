((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCMediaProject = api;
})(globalThis, () => {
  'use strict';

  const VERSION = 1;
  const MAX_ASSETS = 64;
  const MAX_TRACKS = 32;
  const MAX_CLIPS = 256;
  const MAX_PROJECT_MS = 24 * 60 * 60 * 1000;

  function invalid(message) { throw new Error(`Projeto de mídia inválido: ${message}`); }
  function positiveInt(value, label, allowZero = false) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > MAX_PROJECT_MS) invalid(`${label} fora do limite.`);
    return number;
  }
  function projectId(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) invalid(`${label} ausente.`);
    return value.trim();
  }

  function createProject(kind, name = 'Novo projeto') {
    if (!['audio', 'video'].includes(kind)) invalid('tipo não reconhecido.');
    return { schemaVersion: VERSION, id: `project-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind, name: String(name).slice(0, 100), fps: 30, resolution: '1080', assets: [], tracks: [] };
  }

  function normalizeProject(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('documento ausente.');
    if (input.schemaVersion !== VERSION) invalid(`versão ${input.schemaVersion ?? 'ausente'} não suportada.`);
    if (!['audio', 'video'].includes(input.kind)) invalid('tipo não reconhecido.');
    if (!Array.isArray(input.assets) || input.assets.length > MAX_ASSETS) invalid(`máximo de ${MAX_ASSETS} mídias excedido.`);
    if (!Array.isArray(input.tracks) || input.tracks.length > MAX_TRACKS) invalid(`máximo de ${MAX_TRACKS} faixas excedido.`);

    const assets = input.assets.map(asset => {
      if (!asset || typeof asset !== 'object') invalid('mídia inválida.');
      const kind = asset.kind;
      if (!['audio', 'image', 'video'].includes(kind)) invalid('formato de mídia inválido.');
      if (input.kind === 'audio' && kind !== 'audio') invalid('o projeto de áudio só aceita áudio.');
      if (input.kind === 'video' && !['audio', 'image', 'video'].includes(kind)) invalid('mídia incompatível com vídeo.');
      if (typeof asset.path !== 'string' || !asset.path.trim() || asset.path.length > 32768) invalid('caminho de mídia inválido.');
      return { id: projectId(asset.id, 'id da mídia'), path: asset.path, name: String(asset.name || '').slice(0, 260), kind, durationMs: positiveInt(asset.durationMs, 'duração da mídia', true), width: Math.max(0, Number(asset.width) || 0), height: Math.max(0, Number(asset.height) || 0) };
    });
    const assetIds = new Set(assets.map(asset => asset.id));
    if (assetIds.size !== assets.length) invalid('ids de mídia duplicados.');
    let clipCount = 0;
    const tracks = input.tracks.map(track => {
      if (!track || !['audio', 'visual'].includes(track.kind)) invalid('faixa inválida.');
      if (input.kind === 'audio' && track.kind !== 'audio') invalid('faixa visual em projeto de áudio.');
      if (!Array.isArray(track.clips)) invalid('clipes da faixa inválidos.');
      clipCount += track.clips.length;
      const clips = track.clips.map(clip => {
        if (!clip || typeof clip !== 'object') invalid('clipe inválido.');
        const assetId = projectId(clip.assetId, 'assetId');
        if (!assetIds.has(assetId)) invalid(`mídia ${assetId} não existe.`);
        const asset = assets.find(item => item.id === assetId);
        const positionMs = positiveInt(clip.positionMs, 'posição', true);
        const sourceStartMs = positiveInt(clip.sourceStartMs, 'início de origem', true);
        const durationMs = positiveInt(clip.durationMs, 'duração do clipe');
        if (positionMs + durationMs > MAX_PROJECT_MS || sourceStartMs + durationMs > MAX_PROJECT_MS) invalid('clipe excede o limite de 24 horas.');
        if (asset.durationMs && sourceStartMs + durationMs > asset.durationMs + 100) invalid('clipe excede a duração da mídia de origem.');
        return { id: projectId(clip.id, 'id do clipe'), assetId, positionMs, sourceStartMs, durationMs, volume: Math.max(0, Math.min(300, Number.isFinite(Number(clip.volume)) ? Number(clip.volume) : 100)), muted: Boolean(clip.muted) };
      });
      if (new Set(clips.map(clip => clip.id)).size !== clips.length) invalid('ids de clipe duplicados na faixa.');
      return { id: projectId(track.id, 'id da faixa'), kind: track.kind, name: String(track.name || '').slice(0, 100), muted: Boolean(track.muted), volume: Math.max(0, Math.min(300, Number.isFinite(Number(track.volume)) ? Number(track.volume) : 100)), clips };
    });
    if (clipCount > MAX_CLIPS) invalid(`máximo de ${MAX_CLIPS} clipes excedido.`);
    if (new Set(tracks.map(track => track.id)).size !== tracks.length) invalid('ids de faixa duplicados.');
    return { schemaVersion: VERSION, id: projectId(input.id, 'id do projeto'), kind: input.kind, name: String(input.name || 'Projeto sem nome').slice(0, 100), fps: [24, 25, 30, 50, 60].includes(Number(input.fps)) ? Number(input.fps) : 30, resolution: ['720', '1080'].includes(String(input.resolution)) ? String(input.resolution) : '1080', assets, tracks };
  }

  function durationMs(project) {
    return normalizeProject(project).tracks.reduce((total, track) => Math.max(total, ...track.clips.map(clip => clip.positionMs + clip.durationMs)), 0);
  }

  function audioFilterGraph(projectInput, audioInputIndexes, duration) {
    const project = normalizeProject(projectInput);
    const durationSeconds = Number(duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) invalid('duração de exportação inválida.');
    const clips = project.tracks.filter(track => track.kind === 'audio').flatMap(track => track.clips.map(clip => ({ ...clip, track })));
    const filters = [];
    const labels = [];
    clips.forEach((clip, index) => {
      const inputIndex = audioInputIndexes.get(clip.assetId);
      if (!Number.isInteger(inputIndex) || inputIndex < 0) invalid(`entrada de áudio ausente para ${clip.assetId}.`);
      const gain = clip.muted || clip.track.muted ? 0 : clip.volume * clip.track.volume / 10000;
      const label = `audio_clip_${index}`;
      filters.push(`[${inputIndex}:a:0]atrim=start=${(clip.sourceStartMs / 1000).toFixed(3)}:duration=${(clip.durationMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,volume=${gain.toFixed(4)},adelay=${clip.positionMs}:all=1[${label}]`);
      labels.push(`[${label}]`);
    });
    if (!labels.length) return { filters, labels, output: null, hasAudio: false };
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0,atrim=duration=${durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
    return { filters, labels, output: '[aout]', hasAudio: true };
  }

  function audioRenderPlan(projectInput, output, format = 'wav') {
    const project = normalizeProject(projectInput);
    if (project.kind !== 'audio') invalid('esperado um projeto de áudio.');
    if (!['wav', 'mp3'].includes(format)) invalid('formato de mixdown não suportado.');
    const duration = durationMs(project) / 1000;
    if (!duration) invalid('adicione ao menos um clipe de áudio.');
    const assetIds = [...new Set(project.tracks.filter(track => track.kind === 'audio').flatMap(track => track.clips.map(clip => clip.assetId)))];
    if (!assetIds.length) invalid('adicione ao menos um clipe de áudio.');
    const args = ['-hide_banner', '-y'];
    const indexes = new Map();
    assetIds.forEach((id, index) => { indexes.set(id, index); args.push('-i', project.assets.find(asset => asset.id === id).path); });
    const graph = audioFilterGraph(project, indexes, duration);
    args.push('-filter_complex', graph.filters.join(';'), '-map', graph.output);
    args.push(...(format === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '192k']), '-t', duration.toFixed(3), '-progress', 'pipe:1', '-nostats', output);
    return { args, duration, output, kind: 'audio', format };
  }

  function videoRenderPlan(projectInput, output, resolution = '1080') {
    const project = normalizeProject(projectInput);
    if (project.kind !== 'video') invalid('esperado um projeto de vídeo.');
    if (!['720', '1080'].includes(String(resolution))) invalid('resolução de vídeo não suportada.');
    const visualTracks = project.tracks.filter(track => track.kind === 'visual' && track.clips.length);
    if (visualTracks.length !== 1) invalid('a timeline precisa ter exatamente uma faixa visual.');
    const visualClips = [...visualTracks[0].clips].sort((a, b) => a.positionMs - b.positionMs);
    if (visualClips.some(clip => project.assets.find(asset => asset.id === clip.assetId)?.kind !== 'image')) invalid('esta versão exporta clipes visuais de imagem.');
    const audioIds = [...new Set(project.tracks.filter(track => track.kind === 'audio').flatMap(track => track.clips.map(clip => clip.assetId)))];
    if (!audioIds.length) invalid('adicione ao menos uma trilha de áudio.');
    if (!visualClips.length) invalid('adicione ao menos uma imagem.');
    const audioEnd = Math.max(0, ...project.tracks.filter(track => track.kind === 'audio').flatMap(track => track.clips.map(clip => clip.positionMs + clip.durationMs)));
    const visualEnd = Math.max(...visualClips.map(clip => clip.positionMs + clip.durationMs));
    const durationMs = Math.max(audioEnd, visualEnd);
    const duration = durationMs / 1000;
    const fps = project.fps;
    const width = Number(resolution) === 720 ? 1280 : 1920;
    const height = Number(resolution);
    const args = ['-hide_banner', '-y'];
    const segments = [];
    let cursor = 0;
    for (const clip of visualClips) {
      if (clip.positionMs < cursor - 20) invalid('clipes visuais sobrepostos não são aceitos nesta versão.');
      if (clip.positionMs > cursor + 20) segments.push({ kind: 'black', durationMs: clip.positionMs - cursor });
      segments.push({ kind: 'image', durationMs: clip.durationMs, clip });
      cursor = clip.positionMs + clip.durationMs;
    }
    if (durationMs > cursor + 20) segments.push({ kind: 'black', durationMs: durationMs - cursor });
    const videoFilters = [];
    const videoLabels = [];
    segments.forEach((segment, index) => {
      let inputIndex;
      const seconds = (segment.durationMs / 1000).toFixed(3);
      if (segment.kind === 'image') {
        inputIndex = index;
        const image = project.assets.find(asset => asset.id === segment.clip.assetId);
        args.push('-loop', '1', '-framerate', String(fps), '-t', seconds, '-i', image.path);
      } else {
        inputIndex = index;
        args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${seconds}`);
      }
      const label = `visual_${index}`;
      videoFilters.push(`[${inputIndex}:v:0]trim=duration=${seconds},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${label}]`);
      videoLabels.push(`[${label}]`);
    });
    videoFilters.push(`${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0[vout]`);
    const indexes = new Map();
    audioIds.forEach((id, offset) => { indexes.set(id, segments.length + offset); args.push('-i', project.assets.find(asset => asset.id === id).path); });
    const audioGraph = audioFilterGraph(project, indexes, duration);
    const filters = [...videoFilters, ...audioGraph.filters];
    args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', audioGraph.output, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', duration.toFixed(3), '-progress', 'pipe:1', '-nostats', output);
    return { args, duration, output, kind: 'video', format: 'mp4' };
  }

  return { VERSION, MAX_ASSETS, MAX_TRACKS, MAX_CLIPS, MAX_PROJECT_MS, createProject, normalizeProject, durationMs, audioFilterGraph, audioRenderPlan, videoRenderPlan };
});
