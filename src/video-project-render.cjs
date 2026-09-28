'use strict';

const projectModel = require('./video-project.js');

const seconds = ms => (ms / 1000).toFixed(3);
const decimal = number => Number(number).toFixed(5).replace(/0+$/, '').replace(/\.$/, '');

function buildRenderPlan(input, output, options = {}) {
  const project = projectModel.normalizeProject(input);
  const durationMs = projectModel.durationMs(project);
  if (!durationMs) throw new Error('Adicione ao menos um clipe antes de exportar.');
  const settings = { ...project.settings, resolution: String(options.resolution || project.settings.resolution), fps: Number(options.fps || project.settings.fps) };
  const { width, height } = projectModel.canvasDimensions(settings);
  const fps = settings.fps;
  if (!projectModel.FPS.includes(fps) || !['720', '1080', '2160'].includes(settings.resolution)) throw new Error('Configurações de exportação inválidas.');
  const args = ['-hide_banner', '-y', '-f', 'lavfi', '-i', `color=c=${settings.background}:s=${width}x${height}:r=${fps}:d=${seconds(durationMs)}`];
  const filters = [`[0:v]format=yuv420p,setsar=1[base0]`];
  const videoClips = [];
  const audioClips = [];
  const solo = project.tracks.some(track => track.kind === 'audio' && track.solo);
  const orderedVisualTracks = project.tracks.filter(track => track.kind === 'visual' && track.visible).reverse();
  for (const track of orderedVisualTracks) for (const clip of track.clips) videoClips.push({ track, clip });
  for (const track of project.tracks.filter(track => track.kind === 'audio' && !track.muted && (!solo || track.solo))) {
    for (const clip of track.clips) if (!clip.muted && clip.volume && track.volume) audioClips.push({ track, clip });
  }
  const inputs = new Map();
  function sourceFor(clip) {
    const asset = project.assets.find(item => item.id === clip.assetId);
    const file = clip.type === 'text' ? options.textFiles?.[clip.id] : asset?.path;
    if (!file) throw new Error(`Arquivo de origem não encontrado para ${clip.id}.`);
    const index = args.filter(arg => arg === '-i').length;
    if (clip.type === 'image' || clip.type === 'text') args.push('-loop', '1', '-framerate', String(fps), '-t', seconds(clip.durationMs), '-i', file);
    else args.push('-ss', seconds(clip.sourceStartMs), '-t', seconds(clip.durationMs * clip.speed), '-i', file);
    inputs.set(clip.id, index);
    return { index, asset };
  }
  let base = 'base0';
  videoClips.forEach(({ track, clip }, ordinal) => {
    const { index, asset } = sourceFor(clip);
    const t = clip.transform;
    const crop = t.crop;
    const cropX = decimal(crop.left / 100);
    const cropY = decimal(crop.top / 100);
    const cropW = decimal((100 - crop.left - crop.right) / 100);
    const cropH = decimal((100 - crop.top - crop.bottom) / 100);
    const vf = [`[${index}:v:0]setpts=(PTS-STARTPTS)/${decimal(clip.speed)}`, `crop=iw*${cropW}:ih*${cropH}:iw*${cropX}:ih*${cropY}`];
    if (t.flipX) vf.push('hflip');
    if (t.flipY) vf.push('vflip');
    if (t.rotation) vf.push(`rotate=${decimal(t.rotation)}*PI/180:ow=rotw(${decimal(t.rotation)}*PI/180):oh=roth(${decimal(t.rotation)}*PI/180):c=none`);
    const factor = decimal(t.scale / 100);
    const fit = t.fit === 'fill' ? 'increase' : 'decrease';
    vf.push(`scale=${width}*${factor}:${height}*${factor}:force_original_aspect_ratio=${fit}:force_divisible_by=2`, 'format=rgba');
    if (t.opacity !== 100) vf.push(`colorchannelmixer=aa=${decimal(t.opacity / 100)}`);
    if (clip.fadeInMs) vf.push(`fade=t=in:st=0:d=${seconds(clip.fadeInMs)}:alpha=1`);
    if (clip.fadeOutMs) vf.push(`fade=t=out:st=${seconds(clip.durationMs - clip.fadeOutMs)}:d=${seconds(clip.fadeOutMs)}:alpha=1`);
    vf.push(`trim=duration=${seconds(clip.durationMs)}`, `setpts=PTS+${seconds(clip.positionMs)}/TB`);
    filters.push(`${vf.join(',')}[vis${ordinal}]`);
    const x = `(W-w)/2+W*${decimal(t.x / 100)}`;
    const y = `(H-h)/2+H*${decimal(t.y / 100)}`;
    filters.push(`[${base}][vis${ordinal}]overlay=x='${x}':y='${y}':eof_action=pass:repeatlast=0:format=auto[base${ordinal + 1}]`);
    base = `base${ordinal + 1}`;
    if (clip.type === 'video' && asset?.hasAudio && !solo && !clip.muted && !track.muted && clip.volume && track.volume) audioClips.push({ track, clip, index });
  });
  const audioLabels = [];
  audioClips.forEach(({ track, clip, index: existingIndex }, ordinal) => {
    const index = existingIndex ?? sourceFor(clip).index;
    const af = [`[${index}:a:0]asetpts=PTS-STARTPTS`];
    if (clip.speed !== 1) af.push(`atempo=${decimal(clip.speed)}`);
    af.push(`atrim=duration=${seconds(clip.durationMs)}`);
    const volume = clip.volume * track.volume / 10000;
    af.push(`volume=${decimal(volume)}`);
    if (clip.fadeInMs) af.push(`afade=t=in:st=0:d=${seconds(clip.fadeInMs)}`);
    if (clip.fadeOutMs) af.push(`afade=t=out:st=${seconds(clip.durationMs - clip.fadeOutMs)}:d=${seconds(clip.fadeOutMs)}`);
    af.push(`adelay=${clip.positionMs}:all=1`);
    filters.push(`${af.join(',')}[aud${ordinal}]`);
    audioLabels.push(`[aud${ordinal}]`);
  });
  if (audioLabels.length) filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,atrim=duration=${seconds(durationMs)}[aout]`);
  const quality = options.quality || 'medium';
  const crf = { low: '30', medium: '23', high: '18', maximum: '12' }[quality];
  if (!crf) throw new Error('Qualidade de exportação inválida.');
  args.push('-filter_complex', filters.join(';'), '-map', `[${base}]`);
  if (audioLabels.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', quality === 'maximum' ? '320k' : '192k'); else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', quality === 'maximum' ? 'slow' : 'medium', '-crf', crf, '-r', String(fps), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', seconds(durationMs), '-progress', 'pipe:1', '-nostats', output);
  return { args, duration: durationMs / 1000, width, height, fps, project };
}

module.exports = { buildRenderPlan };
