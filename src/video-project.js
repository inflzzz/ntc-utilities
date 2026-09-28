((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTCVideoProject = api;
})(globalThis, () => {
  'use strict';

  const VERSION = 2;
  const MAX_ASSETS = 128;
  const MAX_TRACKS = 16;
  const MAX_CLIPS = 512;
  const MAX_PROJECT_MS = 24 * 60 * 60 * 1000;
  const MIN_CLIP_MS = 1;
  const ASPECTS = Object.freeze({ '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:3': [4, 3] });
  const FPS = Object.freeze([24, 25, 30, 50, 60]);
  const SPEEDS = Object.freeze([0.5, 1, 1.5, 2]);
  const FONTS = Object.freeze(['Arial', 'Segoe UI', 'Georgia', 'Consolas']);

  function fail(message) { throw new Error(`Projeto de vídeo inválido: ${message}`); }
  function uid(prefix) {
    const uuid = globalThis.crypto?.randomUUID?.();
    return `${prefix}-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  }
  function identifier(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f]/.test(value)) fail(`${label} inválido.`);
    return value;
  }
  function bounded(value, min, max, label, integer = false) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isSafeInteger(number))) fail(`${label} fora do limite.`);
    return number;
  }
  function text(value, max, label) {
    if (typeof value !== 'string' || value.length > max) fail(`${label} inválido.`);
    return value;
  }
  function color(value, label) {
    if (typeof value !== 'string' || !/^#[\da-fA-F]{6}$/.test(value)) fail(`${label} inválida.`);
    return value.toLowerCase();
  }
  function defaultTransform() {
    return { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100, fit: 'fit', flipX: false, flipY: false, crop: { left: 0, right: 0, top: 0, bottom: 0 } };
  }
  function defaultText() {
    return { content: 'Novo texto', font: 'Arial', size: 64, weight: 700, align: 'center', color: '#ffffff' };
  }
  function createTrack(kind, name, role = '') {
    return { id: uid('track'), kind, role, name, visible: true, muted: false, solo: false, locked: false, volume: 100, clips: [] };
  }
  function createProject(name = 'Novo projeto') {
    return {
      schemaVersion: VERSION, kind: 'video', id: uid('project'), name,
      settings: { resolution: '1080', aspectRatio: '16:9', fps: 30, background: '#000000' },
      assets: [],
      tracks: [createTrack('visual', 'Sobreposição', 'overlay'), createTrack('visual', 'Vídeo / mídia', 'base'), createTrack('audio', 'Áudio 1')]
    };
  }
  function normalizeSettings(input) {
    const source = input || {};
    const resolution = String(source.resolution ?? '1080');
    if (!['720', '1080'].includes(resolution)) fail('resolução não suportada.');
    const aspectRatio = String(source.aspectRatio ?? '16:9');
    if (!ASPECTS[aspectRatio]) fail('proporção não suportada.');
    const fps = bounded(source.fps ?? 30, 1, 120, 'FPS', true);
    if (!FPS.includes(fps)) fail('FPS não suportado.');
    return { resolution, aspectRatio, fps, background: color(source.background ?? '#000000', 'cor de fundo') };
  }
  function normalizeAsset(asset) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) fail('mídia inválida.');
    if (!['image', 'video', 'audio'].includes(asset.kind)) fail('tipo de mídia não suportado.');
    const mediaPath = text(asset.path, 32768, 'caminho da mídia');
    if (!mediaPath.trim() || /[\u0000-\u001f]/.test(mediaPath)) fail('caminho da mídia inválido.');
    const duration = bounded(asset.durationMs ?? 0, 0, MAX_PROJECT_MS, 'duração da mídia', true);
    if (asset.kind !== 'image' && duration < MIN_CLIP_MS) fail('duração de vídeo ou áudio inválida.');
    return {
      id: identifier(asset.id, 'id da mídia'), kind: asset.kind, path: mediaPath,
      name: text(asset.name ?? '', 260, 'nome da mídia'), durationMs: duration,
      width: bounded(asset.width ?? 0, 0, 16384, 'largura', true),
      height: bounded(asset.height ?? 0, 0, 16384, 'altura', true),
      fps: bounded(asset.fps ?? 0, 0, 240, 'FPS da mídia'), hasAudio: Boolean(asset.hasAudio)
    };
  }
  function normalizeTransform(input) {
    const source = input || defaultTransform();
    const cropSource = source.crop || {};
    const crop = {};
    for (const edge of ['left', 'right', 'top', 'bottom']) crop[edge] = bounded(cropSource[edge] ?? 0, 0, 90, `crop ${edge}`);
    if (crop.left + crop.right >= 100 || crop.top + crop.bottom >= 100) fail('crop remove toda a imagem.');
    const fit = source.fit ?? 'fit';
    if (!['fit', 'fill'].includes(fit)) fail('modo de encaixe inválido.');
    return {
      x: bounded(source.x ?? 0, -200, 200, 'posição X'),
      y: bounded(source.y ?? 0, -200, 200, 'posição Y'),
      scale: bounded(source.scale ?? 100, 10, 400, 'escala'),
      rotation: bounded(source.rotation ?? 0, -180, 180, 'rotação'),
      opacity: bounded(source.opacity ?? 100, 0, 100, 'opacidade'),
      fit, flipX: Boolean(source.flipX), flipY: Boolean(source.flipY), crop
    };
  }
  function normalizeText(input) {
    const source = input || defaultText();
    const font = source.font ?? 'Arial';
    if (!FONTS.includes(font)) fail('fonte não suportada.');
    const align = source.align ?? 'center';
    if (!['left', 'center', 'right'].includes(align)) fail('alinhamento de texto inválido.');
    const weight = bounded(source.weight ?? 700, 400, 700, 'peso de texto', true);
    if (![400, 700].includes(weight)) fail('peso de texto inválido.');
    return {
      content: text(source.content ?? '', 500, 'conteúdo do texto'), font,
      size: bounded(source.size ?? 64, 12, 240, 'tamanho do texto', true),
      weight, align, color: color(source.color ?? '#ffffff', 'cor do texto')
    };
  }
  function normalizeClip(clip, track, assetMap) {
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) fail('clipe inválido.');
    const type = clip.type || assetMap.get(clip.assetId)?.kind;
    if (!['image', 'video', 'audio', 'text'].includes(type)) fail('tipo de clipe inválido.');
    if (track.kind === 'visual' ? type === 'audio' : type !== 'audio') fail('clipe incompatível com a faixa.');
    const assetId = type === 'text' ? null : identifier(clip.assetId, 'referência à mídia');
    const asset = assetId ? assetMap.get(assetId) : null;
    if (type !== 'text' && (!asset || asset.kind !== type)) fail('clipe referencia mídia ausente ou de outro tipo.');
    const positionMs = bounded(clip.positionMs ?? 0, 0, MAX_PROJECT_MS, 'posição do clipe', true);
    const durationMs = bounded(clip.durationMs, MIN_CLIP_MS, MAX_PROJECT_MS, 'duração do clipe', true);
    const sourceStartMs = bounded(clip.sourceStartMs ?? 0, 0, MAX_PROJECT_MS, 'início da fonte', true);
    const speed = bounded(clip.speed ?? 1, 0.5, 2, 'velocidade');
    if (!SPEEDS.includes(speed)) fail('velocidade não suportada.');
    if (positionMs + durationMs > MAX_PROJECT_MS) fail('clipe ultrapassa o limite do projeto.');
    if ((type === 'video' || type === 'audio') && sourceStartMs + durationMs * speed > asset.durationMs + 100) fail('clipe excede sua mídia de origem.');
    return {
      id: identifier(clip.id, 'id do clipe'), assetId, type, positionMs, durationMs, sourceStartMs, speed,
      volume: bounded(clip.volume ?? 100, 0, 300, 'volume do clipe'), muted: Boolean(clip.muted),
      fadeInMs: bounded(clip.fadeInMs ?? 0, 0, durationMs, 'fade in', true),
      fadeOutMs: bounded(clip.fadeOutMs ?? 0, 0, durationMs, 'fade out', true),
      transform: type === 'audio' ? null : normalizeTransform(clip.transform),
      text: type === 'text' ? normalizeText(clip.text) : null
    };
  }
  function normalizeTrack(track, assetMap) {
    if (!track || !['visual', 'audio'].includes(track.kind) || !Array.isArray(track.clips)) fail('faixa inválida.');
    const role = track.kind === 'visual' && ['base', 'overlay'].includes(track.role) ? track.role : '';
    return {
      id: identifier(track.id, 'id da faixa'), kind: track.kind, role,
      name: text(track.name ?? '', 100, 'nome da faixa'),
      visible: track.kind === 'visual' ? track.visible !== false : true,
      muted: Boolean(track.muted), solo: track.kind === 'audio' && Boolean(track.solo),
      locked: Boolean(track.locked), volume: bounded(track.volume ?? 100, 0, 300, 'volume da faixa'),
      clips: track.clips.map(clip => normalizeClip(clip, track, assetMap))
    };
  }
  function migrateV1(input) {
    if (input.kind !== 'video') fail('esperado um projeto de vídeo.');
    const assets = input.assets || [];
    const byId = new Map(assets.map(asset => [asset.id, asset]));
    const tracks = (input.tracks || []).map((track, index) => ({
      ...track, role: track.kind === 'visual' && index === (input.tracks || []).findIndex(item => item.kind === 'visual') ? 'base' : '',
      visible: true, solo: false, locked: false,
      clips: (track.clips || []).map(clip => ({ ...clip, type: byId.get(clip.assetId)?.kind, speed: 1, fadeInMs: 0, fadeOutMs: 0, transform: defaultTransform() }))
    }));
    if (!tracks.some(track => track.kind === 'visual')) tracks.unshift(createTrack('visual', 'Vídeo / mídia', 'base'));
    return {
      schemaVersion: VERSION, kind: 'video', id: input.id, name: input.name,
      settings: { resolution: input.resolution || '1080', aspectRatio: '16:9', fps: input.fps || 30, background: '#000000' },
      assets: assets.map(asset => ({ ...asset, fps: 0, hasAudio: false })), tracks
    };
  }
  function normalizeProject(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('documento ausente.');
    const source = input.schemaVersion === 1 ? migrateV1(input) : input;
    if (source.schemaVersion !== VERSION) fail(`versão ${source.schemaVersion ?? 'ausente'} não suportada.`);
    if (source.kind !== 'video') fail('esperado um projeto de vídeo.');
    if (!Array.isArray(source.assets) || source.assets.length > MAX_ASSETS) fail('limite de mídias excedido.');
    if (!Array.isArray(source.tracks) || source.tracks.length > MAX_TRACKS) fail('limite de faixas excedido.');
    const assets = source.assets.map(normalizeAsset);
    const assetMap = new Map(assets.map(asset => [asset.id, asset]));
    if (assetMap.size !== assets.length) fail('ids de mídias duplicados.');
    const tracks = source.tracks.map(track => normalizeTrack(track, assetMap));
    if (new Set(tracks.map(track => track.id)).size !== tracks.length) fail('ids de faixas duplicados.');
    const allClips = tracks.flatMap(track => track.clips);
    if (allClips.length > MAX_CLIPS || new Set(allClips.map(clip => clip.id)).size !== allClips.length) fail('limite ou ids de clipes inválidos.');
    return {
      schemaVersion: VERSION, kind: 'video', id: identifier(source.id, 'id do projeto'),
      name: text(source.name ?? 'Projeto sem nome', 100, 'nome do projeto'),
      settings: normalizeSettings(source.settings), assets, tracks
    };
  }
  function durationMs(project) {
    return project.tracks.reduce((max, track) => Math.max(max, ...track.clips.map(clip => clip.positionMs + clip.durationMs)), 0);
  }
  function canvasDimensions(settings) {
    const [a, b] = ASPECTS[settings.aspectRatio] || ASPECTS['16:9'];
    const height = Number(settings.resolution);
    const width = Math.round(height * a / b / 2) * 2;
    return { width, height };
  }
  function findClip(project, clipId) {
    for (const track of project.tracks) {
      const clip = track.clips.find(item => item.id === clipId);
      if (clip) return { track, clip, asset: project.assets.find(asset => asset.id === clip.assetId) || null };
    }
    return null;
  }
  function importAsset(project, inspected) {
    const asset = normalizeAsset({ ...inspected, id: uid('asset') });
    const existing = project.assets.find(item => item.path.toLocaleLowerCase('en-US') === asset.path.toLocaleLowerCase('en-US'));
    if (existing) return existing;
    if (project.assets.length >= MAX_ASSETS) fail('limite de mídias excedido.');
    project.assets.push(asset);
    return asset;
  }
  function addTrack(project, kind, name, role = '') {
    if (project.tracks.length >= MAX_TRACKS) fail('limite de faixas excedido.');
    const track = createTrack(kind, name || (kind === 'visual' ? 'Sobreposição' : 'Áudio'), role);
    project.tracks.splice(kind === 'visual' ? 0 : project.tracks.length, 0, track);
    return track;
  }
  function renameTrack(project, trackId, name) {
    const track = project.tracks.find(item => item.id === trackId);
    if (!track) fail('faixa não encontrada.');
    const next = text(String(name || '').trim(), 100, 'nome da faixa');
    if (!next) fail('nome da faixa vazio.');
    track.name = next;
    return track;
  }
  function addTrackRelative(project, trackId, placement = 'after') {
    const reference = project.tracks.find(item => item.id === trackId);
    if (!reference) fail('faixa de referência não encontrada.');
    const track = addTrack(project, reference.kind, reference.kind === 'visual' ? 'Nova faixa visual' : 'Nova faixa de áudio');
    project.tracks.splice(project.tracks.indexOf(track), 1);
    const referenceIndex = project.tracks.indexOf(reference);
    project.tracks.splice(referenceIndex + (placement === 'before' ? 0 : 1), 0, track);
    return track;
  }
  function removeTrack(project, trackId) {
    const track = project.tracks.find(item => item.id === trackId);
    if (!track) return false;
    if (track.clips.length) fail('remova primeiro os clipes desta faixa.');
    if (project.tracks.filter(item => item.kind === track.kind).length <= 1) fail('o projeto precisa manter ao menos uma faixa deste tipo.');
    project.tracks = project.tracks.filter(item => item.id !== trackId);
    return true;
  }
  function appendPosition(track) { return Math.max(0, ...track.clips.map(clip => clip.positionMs + clip.durationMs)); }
  function contiguous(clips) {
    const sorted = [...clips].sort((a, b) => a.positionMs - b.positionMs);
    return sorted.every((clip, index) => index === 0 || Math.abs(clip.positionMs - (sorted[index - 1].positionMs + sorted[index - 1].durationMs)) <= 20);
  }
  function insertInSequence(track, clip, proposed) {
    const others = track.clips.filter(item => item !== clip).sort((a, b) => a.positionMs - b.positionMs);
    if (track.role !== 'base' || !others.length || !contiguous(others) || !others.some(item => proposed >= item.positionMs && proposed < item.positionMs + item.durationMs)) return false;
    const index = others.findIndex(item => proposed < item.positionMs + item.durationMs / 2);
    others.splice(index < 0 ? others.length : index, 0, clip);
    let cursor = Math.min(...others.map(item => item.positionMs));
    for (const item of others) { item.positionMs = cursor; cursor += item.durationMs; }
    track.clips = others;
    return true;
  }
  function addClip(project, assetId, trackId = null, positionMs = null) {
    const asset = project.assets.find(item => item.id === assetId);
    if (!asset) fail('mídia não encontrada no projeto.');
    const kind = asset.kind === 'audio' ? 'audio' : 'visual';
    let track = project.tracks.find(item => item.id === trackId);
    if (track && track.kind !== kind) fail('faixa incompatível com a mídia.');
    if (!track) track = project.tracks.find(item => item.kind === kind && (kind === 'audio' || item.role === 'base')) || addTrack(project, kind, kind === 'audio' ? 'Áudio' : 'Vídeo / mídia', kind === 'visual' ? 'base' : '');
    if (track.locked) fail('a faixa está bloqueada.');
    const duration = asset.kind === 'image' ? 5000 : asset.durationMs;
    const clip = {
      id: uid('clip'), assetId, type: asset.kind,
      positionMs: positionMs === null ? appendPosition(track) : Math.max(0, Math.round(positionMs)),
      sourceStartMs: 0, durationMs: duration, speed: 1, volume: 100, muted: false,
      fadeInMs: 0, fadeOutMs: 0, transform: defaultTransform(), text: null
    };
    track.clips.push(clip);
    if (positionMs !== null) insertInSequence(track, clip, clip.positionMs);
    return clip;
  }
  function addText(project, positionMs = 0, durationMs = 5000) {
    let track = project.tracks.find(item => item.kind === 'visual' && item.role === 'overlay') || addTrack(project, 'visual', 'Texto / overlay', 'overlay');
    if (track.locked) fail('a faixa está bloqueada.');
    const clip = {
      id: uid('clip'), assetId: null, type: 'text', positionMs: Math.round(positionMs), durationMs: Math.round(durationMs),
      sourceStartMs: 0, speed: 1, volume: 100, muted: false, fadeInMs: 0, fadeOutMs: 0,
      transform: defaultTransform(), text: defaultText()
    };
    track.clips.push(clip);
    return clip;
  }
  function removeClip(project, clipId) {
    const found = findClip(project, clipId);
    if (!found) return false;
    if (found.track.locked) fail('a faixa está bloqueada.');
    found.track.clips = found.track.clips.filter(item => item.id !== clipId);
    return true;
  }
  function removeAsset(project, assetId) {
    if (project.tracks.some(track => track.clips.some(clip => clip.assetId === assetId))) fail('remova primeiro os clipes desta mídia da timeline.');
    const count = project.assets.length;
    project.assets = project.assets.filter(item => item.id !== assetId);
    return project.assets.length !== count;
  }
  function duplicateClip(project, clipId) {
    const found = findClip(project, clipId);
    if (!found) fail('clipe não encontrado.');
    if (found.track.locked) fail('a faixa está bloqueada.');
    const copy = structuredClone(found.clip);
    copy.id = uid('clip');
    copy.positionMs = appendPosition(found.track);
    found.track.clips.push(copy);
    return copy;
  }
  function splitClip(project, clipId, playheadMs) {
    const found = findClip(project, clipId);
    if (!found) fail('clipe não encontrado.');
    if (found.track.locked) fail('a faixa está bloqueada.');
    const at = Math.round(playheadMs);
    const left = at - found.clip.positionMs;
    const right = found.clip.durationMs - left;
    if (left < 100 || right < 100) fail('posicione o playhead dentro do clipe para dividir.');
    const second = structuredClone(found.clip);
    second.id = uid('clip');
    second.positionMs = at;
    second.sourceStartMs += Math.round(left * second.speed);
    second.durationMs = right;
    second.fadeInMs = 0;
    found.clip.durationMs = left;
    found.clip.fadeOutMs = 0;
    found.track.clips.splice(found.track.clips.indexOf(found.clip) + 1, 0, second);
    return second;
  }
  function trimClip(project, clipId, edge, newTimeMs) {
    const found = findClip(project, clipId);
    if (!found) fail('clipe não encontrado.');
    if (found.track.locked) fail('a faixa está bloqueada.');
    const clip = found.clip;
    const at = Math.round(newTimeMs);
    if (edge === 'start') {
      const delta = at - clip.positionMs;
      if (clip.durationMs - delta < 100 || at < 0) fail('trim de início inválido.');
      if (clip.type !== 'image' && clip.type !== 'text' && clip.sourceStartMs + delta * clip.speed < 0) fail('início fora da mídia.');
      clip.positionMs = at;
      clip.durationMs -= delta;
      if (clip.type === 'video' || clip.type === 'audio') clip.sourceStartMs += Math.round(delta * clip.speed);
    } else if (edge === 'end') {
      if (at - clip.positionMs < 100) fail('trim de fim inválido.');
      clip.durationMs = at - clip.positionMs;
    } else fail('extremidade de trim inválida.');
    clip.fadeInMs = Math.min(clip.fadeInMs, clip.durationMs);
    clip.fadeOutMs = Math.min(clip.fadeOutMs, clip.durationMs);
    return clip;
  }
  function moveClip(project, clipId, trackId, positionMs) {
    const found = findClip(project, clipId);
    const destination = project.tracks.find(item => item.id === trackId);
    if (!found || !destination || found.track.kind !== destination.kind) fail('destino do clipe inválido.');
    if (found.track.locked || destination.locked) fail('a faixa está bloqueada.');
    const position = Math.round(positionMs);
    if (position < 0 || position + found.clip.durationMs > MAX_PROJECT_MS) fail('posição fora do projeto.');
    const wasContiguous = destination.role === 'base' && contiguous(destination.clips);
    if (found.track !== destination) {
      found.track.clips = found.track.clips.filter(item => item.id !== clipId);
      destination.clips.push(found.clip);
    }
    if (!(wasContiguous && insertInSequence(destination, found.clip, position))) found.clip.positionMs = position;
    return found.clip;
  }
  function moveClipLayer(project, clipId, direction) {
    const found = findClip(project, clipId);
    if (!found || found.track.kind !== 'visual') fail('clipe visual não encontrado.');
    if (found.track.locked) fail('a faixa está bloqueada.');
    if (!['up', 'down'].includes(direction)) fail('direção de camada inválida.');
    const tracks = project.tracks.filter(track => track.kind === 'visual');
    const index = tracks.indexOf(found.track);
    const destination = tracks[index + (direction === 'up' ? -1 : 1)];
    if (!destination) return false;
    if (destination.locked) fail('a faixa de destino está bloqueada.');
    found.track.clips = found.track.clips.filter(item => item.id !== clipId);
    destination.clips.push(found.clip);
    return found.clip;
  }
  function snapTime(project, proposedMs, trackId, playheadMs, thresholdMs = 120, ignoreClipId = null) {
    if (!project.tracks.some(item => item.id === trackId)) fail('faixa inválida para encaixe.');
    const anchors = [0, Math.max(0, Math.round(playheadMs))];
    for (const track of project.tracks) for (const clip of track.clips) if (clip.id !== ignoreClipId) anchors.push(clip.positionMs, clip.positionMs + clip.durationMs);
    const proposed = Math.max(0, Math.round(proposedMs));
    const nearest = anchors.reduce((best, value) => Math.abs(value - proposed) < Math.abs(best - proposed) ? value : best, anchors[0]);
    return Math.abs(nearest - proposed) <= thresholdMs ? nearest : proposed;
  }
  function visibleVisualClips(project) {
    return project.tracks.filter(track => track.kind === 'visual' && track.visible).flatMap(track => track.clips);
  }
  function hasPreviewContent(project) { return visibleVisualClips(project).length > 0; }

  return Object.freeze({
    VERSION, MAX_ASSETS, MAX_TRACKS, MAX_CLIPS, MAX_PROJECT_MS, MIN_CLIP_MS, ASPECTS, FPS, SPEEDS, FONTS,
    uid, defaultTransform, defaultText, createProject, normalizeProject, migrateV1, durationMs, canvasDimensions,
    findClip, importAsset, addTrack, renameTrack, addTrackRelative, removeTrack, addClip, addText, removeClip, removeAsset, duplicateClip, splitClip, trimClip,
    moveClip, moveClipLayer, snapTime, visibleVisualClips, hasPreviewContent
  });
});
