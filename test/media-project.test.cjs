const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mediaProject = require('../src/media-project.js');

function audioFixture() {
  const project = mediaProject.createProject('audio', 'Mix de teste');
  const stems = [
    { id: 'stem-vocal', path: 'C:\\Mídia\\vocal (final).wav', name: 'Vocal.wav', kind: 'audio', durationMs: 12000, width: 0, height: 0 },
    { id: 'stem-drum', path: 'C:\\Mídia\\drum.wav', name: 'Drum.wav', kind: 'audio', durationMs: 10000, width: 0, height: 0 },
  ];
  project.assets = stems;
  project.tracks = stems.map((asset, index) => ({ id: `track-${index}`, kind: 'audio', name: asset.name, muted: false, volume: 100, clips: [{ id: `clip-${index}`, assetId: asset.id, positionMs: index ? 2000 : 0, sourceStartMs: 0, durationMs: asset.durationMs, volume: index ? 80 : 100, muted: false }] }));
  return project;
}

function videoFixture() {
  const project = mediaProject.createProject('video', 'Slideshow');
  project.assets = [
    { id: 'image-1', path: 'D:\\Fotos\\imagem um.png', name: 'imagem um.png', kind: 'image', durationMs: 0, width: 1920, height: 1080 },
    { id: 'music-1', path: 'D:\\Música\\faixa.wav', name: 'faixa.wav', kind: 'audio', durationMs: 12000, width: 0, height: 0 },
  ];
  project.tracks = [
    { id: 'visuals', kind: 'visual', name: 'Imagens', muted: false, volume: 100, clips: [{ id: 'visual-clip', assetId: 'image-1', positionMs: 0, sourceStartMs: 0, durationMs: 12000, volume: 100, muted: false }] },
    { id: 'music', kind: 'audio', name: 'Música', muted: false, volume: 100, clips: [{ id: 'music-clip', assetId: 'music-1', positionMs: 0, sourceStartMs: 0, durationMs: 12000, volume: 100, muted: false }] },
  ];
  return project;
}

test('audio project schema v2 normalizes safe fields and round-trips', () => {
  const project = audioFixture();
  const normalized = mediaProject.normalizeProject(project);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.kind, 'audio');
  assert.equal(mediaProject.durationMs(normalized), 12000);
  assert.deepEqual(mediaProject.normalizeProject(JSON.parse(JSON.stringify(normalized))), normalized);
});

test('media project validation rejects unsupported versions, missing assets and clips outside source duration', () => {
  const wrongVersion = audioFixture(); wrongVersion.schemaVersion = 3;
  assert.throws(() => mediaProject.normalizeProject(wrongVersion), /versão 3 não suportada/);
  const missingAsset = audioFixture(); missingAsset.tracks[0].clips[0].assetId = 'missing';
  assert.throws(() => mediaProject.normalizeProject(missingAsset), /não existe/);
  const tooLong = audioFixture(); tooLong.tracks[0].clips[0].durationMs = 13000;
  assert.throws(() => mediaProject.normalizeProject(tooLong), /excede a duração/);
});

test('audio project mixdown overlaps stems and honors per-clip and per-track gain and mute', () => {
  const project = audioFixture();
  project.tracks[1].volume = 50;
  const graph = mediaProject.audioFilterGraph(project, new Map([['stem-vocal', 0], ['stem-drum', 1]]), 12);
  assert.equal(graph.hasAudio, true);
  assert.match(graph.filters[0], /\[0:a:0\].*volume=1\.0000,adelay=0:all=1/);
  assert.match(graph.filters[1], /\[1:a:0\].*volume=0\.4000,adelay=2000:all=1/);
  assert.match(graph.filters[2], /amix=inputs=2:duration=longest:dropout_transition=0:normalize=0/);
  assert.match(graph.filters[2], /atrim=duration=12\.000/);
  project.tracks[1].muted = true;
  assert.match(mediaProject.audioFilterGraph(project, new Map([['stem-vocal', 0], ['stem-drum', 1]]), 12).filters[1], /volume=0\.0000/);
});

test('audio render plan uses explicit FFmpeg argv and supports all classic output formats', () => {
  const project = audioFixture();
  const wav = mediaProject.audioRenderPlan(project, 'C:\\Output\\My Mix.wav', 'wav');
  assert.equal(wav.duration, 12);
  assert.equal(wav.kind, 'audio');
  assert.ok(wav.args.includes('C:\\Mídia\\vocal (final).wav'));
  assert.ok(wav.args.includes('C:\\Output\\My Mix.wav'));
  assert.ok(wav.args.includes('pcm_s16le'));
  assert.ok(wav.args.includes('pipe:1'));
  const mp3 = mediaProject.audioRenderPlan(project, 'mix.mp3', 'mp3');
  assert.ok(mp3.args.includes('libmp3lame'));
  assert.ok(mediaProject.audioRenderPlan(project, 'mix.ogg', 'ogg').args.includes('libvorbis'));
  assert.throws(() => mediaProject.audioRenderPlan(project, 'mix.xyz', 'xyz'), /formato de mixdown/);
});

test('video project builds a synchronized 720p image-and-audio MP4 timeline', () => {
  const plan = mediaProject.videoRenderPlan(videoFixture(), 'C:\\Output\\slideshow.mp4', '720');
  assert.equal(plan.kind, 'video');
  assert.equal(plan.duration, 12);
  assert.ok(plan.args.includes('D:\\Fotos\\imagem um.png'));
  assert.ok(plan.args.includes('D:\\Música\\faixa.wav'));
  assert.ok(plan.args.some(argument => argument.includes('scale=1280:720')));
  assert.ok(plan.args.includes('+faststart'));
  assert.ok(plan.args.includes('192k'));
  assert.match(plan.args[plan.args.indexOf('-filter_complex') + 1], /concat=n=1:v=1:a=0\[vout\]/);
});

test('video timeline fills image gaps with black and rejects overlapping visuals or absent audio', () => {
  const project = videoFixture();
  const visual = project.tracks[0];
  project.assets.push({ id: 'image-2', path: 'D:\\Fotos\\segundo.jpg', name: 'segundo.jpg', kind: 'image', durationMs: 0, width: 800, height: 600 });
  visual.clips.push({ id: 'visual-clip-2', assetId: 'image-2', positionMs: 14000, sourceStartMs: 0, durationMs: 3000, volume: 100, muted: false });
  const plan = mediaProject.videoRenderPlan(project, 'out.mp4', '1080');
  assert.equal(plan.duration, 17);
  assert.ok(plan.args.some(argument => argument.includes('color=c=black:s=1920x1080')));
  assert.ok(plan.args.some(argument => argument.includes('scale=1920:1080')));
  visual.clips[1].positionMs = 11000;
  assert.throws(() => mediaProject.videoRenderPlan(project, 'out.mp4', '1080'), /sobrepostos/);
  const noAudio = videoFixture(); noAudio.tracks = noAudio.tracks.filter(track => track.kind !== 'audio');
  assert.throws(() => mediaProject.videoRenderPlan(noAudio, 'out.mp4', '1080'), /trilha de áudio/);
});

test('media project bounds keep time integer-based and reject excessive projects', () => {
  const project = audioFixture();
  project.tracks[0].clips[0].positionMs = .5;
  assert.throws(() => mediaProject.normalizeProject(project), /posição fora do limite/);
  const large = audioFixture(); large.tracks[0].clips[0].durationMs = mediaProject.MAX_PROJECT_MS + 1;
  assert.throws(() => mediaProject.normalizeProject(large), /duração do clipe fora do limite/);
});

test('video project workspace is the only video editor and keeps dedicated preload operations', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const audioUi = fs.readFileSync(path.join(root, 'src/media-project-ui.js'), 'utf8');
  const videoUi = fs.readFileSync(path.join(root, 'src/video-project-ui.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(allIds).size, allIds.length, 'the updated page keeps every DOM id unique');
  for (const id of ['audioProjectTimeline', 'audioProjectExport', 'videoEditorView', 'videoProjectPanel', 'ntcvTimelineContent', 'ntcvCanvas', 'ntcvInspector']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="audioLegacyMode"/);
  for (const id of ['videoProjectVisualTimeline', 'videoProjectAudioTimeline', 'videoProjectExport', 'videoLegacyMode', 'videoProjectMode', 'videoEditorImport', 'videoEditorWorkspace']) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-view="videoEditor"/);
  assert.match(html, /id="videoView"[\s\S]*?Conversor de vídeo[\s\S]*?id="videoEditorView"/, 'the separate video converter and project editor remain distinct routes');
  assert.doesNotMatch(html, /Editor clássico de vídeo|Editor clássico continua disponível|id="videoProjectMode"|id="videoLegacyMode"/);
  assert.match(preload, /startMediaProjectRender: payload => ipcRenderer\.invoke\('start-media-project-render', payload\)/);
  assert.match(preload, /cancelMediaProjectRender: id => ipcRenderer\.invoke\('cancel-media-project-render', id\)/);
  assert.match(main, /ipcMain\.handle\('start-media-project-render'/);
  assert.match(main, /ipcMain\.handle\('start-media-project-render'/);
  assert.match(main, /ipcMain\.handle\('start-media-project-render', async \(event, item\) => \{\s*assertMainWindowSender\(event\);/);
  assert.doesNotMatch(preload, /chooseVideoEditorFile|chooseVideoEditorAudio|startVideoEdit|cancelVideoEdit|onVideoEditorEvent/);
  assert.doesNotMatch(main, /choose-video-editor-file|choose-video-editor-audio|start-video-edit|cancel-video-edit|video-editor-event|keptVideoSegments/);
  assert.match(audioUi, /function bind\(\)[\s\S]*?renderProject\('audio'\)/);
  assert.match(videoUi, /const root = document\.getElementById\('ntcvEditor'\)/);
  const staticVideoIds = [...videoUi.matchAll(/\$\('([^'`$]+)'\)/g)].map(match => match[1]);
  for (const id of staticVideoIds) assert.match(html, new RegExp(`id="${id}"`), `missing project video UI id ${id}`);
});

test('new video workspace keeps editor hierarchy, export states and audio tool separate', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const audioUi = fs.readFileSync(path.join(root, 'src/media-project-ui.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src/video-project-ui.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src/video-project.css'), 'utf8');
  for (const id of ['ntcvMediaPanel', 'ntcvCanvas', 'ntcvPreviewEmpty', 'ntcvTransformOverlay', 'ntcvInspector', 'ntcvTimelineDrop', 'ntcvZoom', 'ntcvExportDialog', 'ntcvOpenOutputFolder']) {
    if (id === 'ntcvMediaPanel') assert.match(html, /class="ntcv-media-panel"/);
    else assert.match(html, new RegExp(`id="${id}"`), `missing project editor control ${id}`);
  }
  assert.match(html, /id="audioProjectOpenFolder"/);
  assert.match(html, /id="audioProjectRetry"/);
  assert.match(html, /id="audioProjectZoom"/);
  assert.match(audioUi, /const drawWidth = kind === 'audio' \? Math\.min\(rect\.width, 2000\) : rect\.width/);
  assert.match(audioUi, /Math\.min\(8000, Math\.max\(600/);
  assert.match(html, /class="ntcv-media-panel"[\s\S]*class="ntcv-view-panel"[\s\S]*class="ntcv-inspector"[\s\S]*class="ntcv-timeline-panel"/);
  assert.doesNotMatch(html, /seletor de editor|modo de edição|Editor clássico de vídeo/);
  assert.match(ui, /ntcvCancelRender'\)\.hidden = false/);
  assert.match(ui, /ntcvCancelRender'\)\.hidden = true/);
  assert.match(ui, /ntcvOpenOutputFolder'\)\.hidden = false/);
  assert.match(ui, /ntc\.openFileFolder\(renderOutput\)/);
  assert.match(ui, /data-track-action="mute"/);
  assert.match(ui, /data-track-action="solo"/);
  assert.match(ui, /data-track-action="lock"/);
  assert.match(ui, /data-filter/);
  assert.match(styles, /\.app-shell\.video-editor-shell\.sidebar-compact \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(styles, /\.ntcv-timeline-panel \{ height: 38%; min-height: 220px; max-height: 72%; \}/);
  assert.match(styles, /\.ntcv-timeline-toolbar input \{ width: clamp\(70px, 8vw, 120px\); \}/);
});

test('audio mixdown never depends on removed video-project controls and renders every saved clip', () => {
  const ui = fs.readFileSync(path.resolve(__dirname, '../src/media-project-ui.js'), 'utf8');
  assert.match(ui, /resolution: byId\('videoProjectResolution'\)\.value \} : \{ range: options\.range, trackId: options\.trackId \}/);
  assert.doesNotMatch(ui, /resolution: byId\('videoProjectResolution'\)\.value \}\);/);
  assert.match(ui, /const clips = track\.clips\.map\(item => \{/);
  assert.match(ui, /const key = project\.kind === 'audio' \? clip\.id : clip\.assetId;/);
  assert.match(ui, /renderProject\(kind\);\s*try \{\s*const result = await window\.ntc\.startMediaProjectRender/);
});

test('bundled FFmpeg renders a real WAV mixdown and synchronized image-plus-music MP4', { skip: !fs.existsSync(path.resolve(__dirname, '../resources/bin/ffmpeg.exe')) }, t => {
  const ffmpeg = path.resolve(__dirname, '../resources/bin/ffmpeg.exe');
  const ffprobe = path.resolve(__dirname, '../resources/bin/ffprobe.exe');
  if (!fs.existsSync(ffprobe)) return t.skip('FFprobe empacotado não está disponível.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-media-project-'));
  const run = (binary, args) => {
    const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stderr || result.stdout}`);
    return result.stdout;
  };
  const vocal = path.join(directory, 'vocal.wav');
  const drums = path.join(directory, 'drums.wav');
  const still = path.join(directory, 'still.png');
  const mixdown = path.join(directory, 'mix.wav');
  const mp3 = path.join(directory, 'mix.mp3');
  const mp4 = path.join(directory, 'slideshow.mp4');
  const mp4FullHd = path.join(directory, 'slideshow-1080.mp4');
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', vocal]);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'pcm_s16le', drums]);
  run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:d=0.1', '-frames:v', '1', still]);

  const audio = audioFixture();
  audio.assets[0].path = vocal; audio.assets[0].durationMs = 1000;
  audio.assets[1].path = drums; audio.assets[1].durationMs = 1000;
  audio.tracks[0].clips[0].durationMs = 1000;
  audio.tracks[1].clips[0].positionMs = 0; audio.tracks[1].clips[0].durationMs = 1000;
  const audioPlan = mediaProject.audioRenderPlan(audio, mixdown, 'wav');
  run(ffmpeg, audioPlan.args);
  assert.ok(fs.statSync(mixdown).size > 44, 'mixdown WAV contém áudio além do cabeçalho');
  const audioProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mixdown]));
  assert.ok(audioProbe.streams.some(stream => stream.codec_type === 'audio'));
  assert.ok(Number(audioProbe.format.duration) > .9 && Number(audioProbe.format.duration) < 1.1);
  run(ffmpeg, mediaProject.audioRenderPlan(audio, mp3, 'mp3').args);
  const mp3Probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp3]));
  assert.equal(mp3Probe.streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'mp3');

  const sixStems = audioFixture();
  sixStems.assets = Array.from({ length: 6 }, (_, index) => ({ ...audio.assets[index % 2], id: `stem-${index}`, name: `Stem ${index + 1}`, path: index % 2 ? drums : vocal }));
  sixStems.tracks = sixStems.assets.map((asset, index) => ({ id: `track-six-${index}`, kind: 'audio', name: asset.name, muted: false, volume: 50, clips: [{ id: `clip-six-${index}`, assetId: asset.id, positionMs: 0, sourceStartMs: 0, durationMs: 1000, volume: 100, muted: false }] }));
  const sixOutput = path.join(directory, 'six-stems.wav');
  const sixPlan = mediaProject.audioRenderPlan(sixStems, sixOutput, 'wav');
  assert.match(sixPlan.args.join(' '), /amix=inputs=6/);
  run(ffmpeg, sixPlan.args);
  const sixProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', sixOutput]));
  assert.equal(sixProbe.streams.filter(stream => stream.codec_type === 'audio').length, 1, 'seis stems geram um único stream mixado');
  assert.ok(Number(sixProbe.format.duration) > .9 && Number(sixProbe.format.duration) < 1.1);
  const sixMp3 = path.join(directory, 'six-stems.mp3');
  run(ffmpeg, mediaProject.audioRenderPlan(sixStems, sixMp3, 'mp3').args);
  const sixMp3Probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', sixMp3]));
  assert.equal(sixMp3Probe.streams.filter(stream => stream.codec_type === 'audio').length, 1, 'MP3 também contém um único mix de seis stems');
  assert.equal(sixMp3Probe.streams.find(stream => stream.codec_type === 'audio').codec_name, 'mp3');

  const video = videoFixture();
  video.assets[0].path = still; video.assets[0].durationMs = 0;
  video.assets[1].path = vocal; video.assets[1].durationMs = 1000;
  video.tracks[0].clips[0].durationMs = 1000;
  video.tracks[1].clips[0].durationMs = 1000;
  const videoPlan = mediaProject.videoRenderPlan(video, mp4, '720');
  run(ffmpeg, videoPlan.args);
  const videoProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]));
  const visualStream = videoProbe.streams.find(stream => stream.codec_type === 'video');
  assert.equal(visualStream.width, 1280);
  assert.equal(visualStream.height, 720);
  assert.ok(videoProbe.streams.some(stream => stream.codec_type === 'audio'));
  assert.ok(Number(videoProbe.format.duration) > .9 && Number(videoProbe.format.duration) < 1.1);
  run(ffmpeg, mediaProject.videoRenderPlan(video, mp4FullHd, '1080').args);
  const fullHdProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', mp4FullHd]));
  assert.equal(fullHdProbe.streams[0].width, 1920);
  assert.equal(fullHdProbe.streams[0].height, 1080);
  fs.rmSync(directory, { recursive: true, force: true });
});
