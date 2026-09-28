const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const model = require('../src/video-project.js');
const old = require('../src/media-project.js');
const { buildRenderPlan } = require('../src/video-project-render.cjs');
const { writeTextPng } = require('../src/video-project-text.cjs');
const { createHistory } = require('../src/video-project-history.js');
const editorLayout = require('../src/video-project-layout.js');
const timeline = require('../src/video-project-timeline.js');
const transform = require('../src/video-project-transform.js');

const ffmpeg = path.join(__dirname, '..', 'resources', 'bin', 'ffmpeg.exe');
const ffprobe = path.join(__dirname, '..', 'resources', 'bin', 'ffprobe.exe');
function asset(project, kind, file, durationMs = 2000, hasAudio = false) {
  return model.importAsset(project, { path: file, name: path.basename(file), kind, durationMs: kind === 'image' ? 0 : durationMs, width: 64, height: 36, fps: kind === 'video' ? 24 : 0, hasAudio });
}
function run(file, args) { const result = spawnSync(file, args, { encoding: 'utf8', timeout: 45000 }); assert.equal(result.status, 0, result.stderr?.slice(-3000)); return result.stdout; }
async function pixelAt(file, time, x, y) {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { timeout: 45000 });
  assert.equal(result.status, 0, result.stderr?.toString().slice(-2000));
  return sharp(result.stdout).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer();
}

test('v2: assets independem dos clipes, imagem inicia em 5s e áudio não estica o visual', () => {
  const p = model.createProject();
  assert.equal(model.hasPreviewContent(p), false);
  const img = asset(p, 'image', 'C:/foto.png');
  const song = asset(p, 'audio', 'C:/song.wav', 30000);
  const first = model.addClip(p, img.id);
  const second = model.addClip(p, img.id);
  model.addClip(p, song.id);
  assert.equal(first.durationMs, 5000);
  assert.equal(second.positionMs, 5000);
  assert.equal(p.assets.length, 2);
  assert.equal(model.durationMs(p), 30000);
  assert.equal(model.visibleVisualClips(p).length, 2);
  assert.equal(model.hasPreviewContent(p), true);
  assert.throws(() => model.removeAsset(p, img.id));
  model.removeClip(p, first.id); model.removeClip(p, second.id);
  assert.equal(model.visibleVisualClips(p).length, 0);
  assert.equal(model.hasPreviewContent(p), false);
  assert.equal(model.removeAsset(p, img.id), true);
});

test('empty state follows visual clips for image, video and reopened project', () => {
  const p = model.createProject();
  const image = asset(p, 'image', 'C:/image.png');
  const video = asset(p, 'video', 'C:/video.mp4');
  assert.equal(model.hasPreviewContent(p), false);
  const a = model.addClip(p, image.id); assert.equal(model.hasPreviewContent(p), true);
  model.removeClip(p, a.id); assert.equal(model.hasPreviewContent(p), false);
  model.addClip(p, video.id); assert.equal(model.hasPreviewContent(p), true);
  assert.equal(model.hasPreviewContent(model.normalizeProject(JSON.parse(JSON.stringify(p)))), true);
});

test('preview overlay uses clip state and no image-src CSS rule can force it visible', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-project-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const videoCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-project.css'), 'utf8');
  assert.match(ui, /ntcvPreviewEmpty'\)\.hidden = model\.hasPreviewContent\(project\)/);
  assert.doesNotMatch(css, /media-project-preview-shell:has\(img\[src\]/);
  assert.match(videoCss, /\.ntcv-preview-empty\[hidden\]\s*\{\s*display:\s*none/);
});

test('project preview reuses compositor layers, prewarms only nearby media, and replaces relinked sources safely', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-project-ui.js'), 'utf8');
  assert.match(ui, /const previewLayers = new Map\(\)/);
  assert.match(ui, /const previewSources = new Map\(\)/);
  assert.match(ui, /slice\(0, 12\)/);
  assert.match(ui, /slice\(0, 8\)/);
  assert.match(ui, /function loadPreviewSource\(prepared, asset, track\)/);
  assert.match(ui, /prepared\.requestedSourceToken !== token/);
  assert.match(ui, /prepared\.media\.removeAttribute\('src'\)/);
  assert.match(ui, /if \(prepared\.textSource !== source\)/, 'text image data is not reassigned on every playback frame');
  assert.doesNotMatch(ui, /ntcvPreviewLayer\.replaceChildren|stage\.replaceChildren/);
  assert.match(ui, /if \(force \|\| previewSignature !== signature\)/, 'layers are only reordered when the active composition changes');
  assert.match(ui, /function prunePreviewCaches\(activeIds, warmIds\)/);
});

test('editor shortcuts skip editable fields and support precise selected-layer nudging', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-project-ui.js'), 'utf8');
  assert.match(ui, /function isTextTarget\(target\)[\s\S]*?input,textarea,select,button,\[contenteditable="true"\]/);
  assert.match(ui, /\$\('videoProjectPanel'\)\.classList\.contains\('hidden'\) \|\| \$\('ntcvExportDialog'\)\.open \|\| isTextTarget\(event\.target\)/);
  assert.match(ui, /event\.key === 'Delete' \|\| event\.key === 'Backspace'/);
  assert.match(ui, /event\.key\.toLowerCase\(\) === 'z'.*event\.shiftKey \? 'redo' : 'undo'/);
  assert.match(ui, /event\.key\.toLowerCase\(\) === 'y'.*command = 'redo'/);
  assert.match(ui, /event\.key\.toLowerCase\(\) === 's'.*event\.shiftKey \? 'save-as' : 'save'/);
  assert.match(ui, /event\.key\.toLowerCase\(\) === 'd'.*command = 'duplicate'/);
  assert.match(ui, /event\.key\.toLowerCase\(\) === 'b'.*command = 'split'/);
  assert.match(ui, /event\.key === 'Home'.*command = 'start'/);
  assert.match(ui, /\['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'\]/);
  assert.match(ui, /const step = event\.shiftKey \? 10 : 1/);
  assert.match(ui, /changeZoomAt\(pxPerSecond \* factor, event\.clientX\)/);
});

test('v2: split, trim, move, duplicate, track, snap and validation', () => {
  const p = model.createProject();
  const a = asset(p, 'video', 'C:/video.mp4', 10000, true);
  const clip = model.addClip(p, a.id);
  clip.durationMs = 6000;
  const right = model.splitClip(p, clip.id, 2500);
  assert.equal(right.sourceStartMs, 2500);
  model.trimClip(p, right.id, 'start', 3000);
  assert.equal(right.sourceStartMs, 3000);
  const track = model.addTrack(p, 'visual', 'Overlay');
  model.moveClip(p, right.id, track.id, 7000);
  assert.equal(model.findClip(p, right.id).track.id, track.id);
  assert.equal(model.snapTime(p, 7050, track.id, 0), 7000);
  const copy = model.duplicateClip(p, right.id);
  assert.notEqual(copy.id, right.id);
  assert.equal(model.normalizeProject(p).schemaVersion, 2);
  p.tracks[0].clips.push({ ...clip, id: clip.id });
  assert.throws(() => model.normalizeProject(p));
});

test('direct transform geometry agrees with FFmpeg crop/rotate/fit ordering and preserves clip-local edits', () => {
  const p = model.createProject();
  const a = asset(p, 'image', 'C:/crop-rotate.png');
  const clip = model.addClip(p, a.id);
  clip.transform = { ...clip.transform, x: 25, y: -10, scale: 125, rotation: 90, fit: 'fit', crop: { left: 10, right: 10, top: 20, bottom: 20 } };
  const canvas = { width: 1920, height: 1080 };
  const g = transform.geometry(clip, a, canvas);
  assert.deepEqual(g.center, { x: 1440, y: 432 });
  assert.ok(g.width > 0 && g.height > 0);
  assert.equal(transform.contains(clip, a, canvas, g.visibleCenter), true);
  assert.equal(transform.contains(clip, a, canvas, { x: 0, y: 0 }), false);
  assert.equal(transform.scaleFromDrag(100, 80, 120), 150);
  assert.equal(transform.scaleFromDrag(390, 80, 120), 400);
  assert.equal(transform.snappedAngle(89, 3), 90);
  assert.equal(transform.snappedAngle(83, 3), 83);

  const plan = buildRenderPlan(p, 'out.mp4');
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
  assert.ok(graph.indexOf('crop=iw*0.8:ih*0.6:iw*0.1:ih*0.2') < graph.indexOf('rotate='));
  assert.ok(graph.indexOf('rotate=') < graph.indexOf('scale=1920*1.25:1080*1.25:force_original_aspect_ratio=decrease'));
  assert.match(graph, /overlay=x='\(W-w\)\/2\+W\*0\.25':y='\(H-h\)\/2\+H\*-0\.1'/);

  const overlay = p.tracks.find(track => track.kind === 'visual' && track.role === 'overlay');
  const intervening = model.addTrack(p, 'visual', 'Overlay');
  const original = JSON.stringify(clip);
  assert.equal(model.moveClipLayer(p, clip.id, 'up'), clip);
  assert.equal(model.findClip(p, clip.id).track.id, overlay.id);
  assert.equal(JSON.stringify(clip), original, 'layer changes preserve clip identity, timing, and transform');
  model.addTrack(p, 'visual', 'Locked');
  intervening.locked = true;
  assert.throws(() => model.moveClipLayer(p, clip.id, 'up'), /faixa de destino está bloqueada/);
});

test('track management renames, inserts relative tracks and refuses unsafe removal', () => {
  const p = model.createProject();
  const base = p.tracks.find(track => track.kind === 'visual');
  assert.equal(model.renameTrack(p, base.id, 'Gameplay').name, 'Gameplay');
  const above = model.addTrackRelative(p, base.id, 'before');
  const below = model.addTrackRelative(p, base.id, 'after');
  assert.equal(p.tracks.indexOf(above), p.tracks.indexOf(base) - 1);
  assert.equal(p.tracks.indexOf(below), p.tracks.indexOf(base) + 1);
  assert.equal(model.removeTrack(p, above.id), true);
  const image = asset(p, 'image', 'C:/used.png');
  model.addClip(p, image.id, below.id);
  assert.throws(() => model.removeTrack(p, below.id), /clipes/i);
  assert.throws(() => model.renameTrack(p, base.id, '   '), /nome/i);
});

test('editor layout preferences normalize and persist outside project state', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const saved = editorLayout.save(storage, { media: 999, inspector: 50, timeline: 420, mediaCollapsed: true, trackDensity: 'expanded', mediaView: 'grid', sidebarCompact: false });
  assert.deepEqual(saved, { media: 360, inspector: 210, timeline: 420, mediaCollapsed: true, inspectorCollapsed: false, sidebarCompact: false, trackDensity: 'expanded', mediaView: 'grid' });
  assert.deepEqual(editorLayout.load(storage), saved);
  assert.equal(editorLayout.load({ getItem: () => '{broken' }).media, editorLayout.DEFAULTS.media);
});

test('timeline helpers keep long projects legible and simplify filmstrips at low zoom', () => {
  assert.equal(timeline.formatTime(92_000), '01:32');
  assert.equal(timeline.formatTime(5_748_000), '01:35:48');
  assert.ok(timeline.rulerStepSeconds(.05, 3_600_000) >= 60);
  assert.ok(timeline.rulerStepSeconds(200, 5_000) <= 1);
  assert.equal(timeline.filmstripCount(500, 10), 0);
  assert.equal(timeline.filmstripCount(500, 80), 5);
  assert.equal(timeline.filmstripCount(2000, 80), 8);
  assert.equal(timeline.zoomIncrement(.1), .1);
  assert.equal(timeline.zoomIncrement(100), 20);
});

test('video editor polish is wired without replacing the monotonic playback clock', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-project-ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  assert.match(ui, /clock\.positionAt\(playback, performance\.now\(\), duration\(\)\)/);
  assert.doesNotMatch(ui, /playback\.positionMs\s*\+=/);
  assert.match(ui, /timelineModel\.rulerStepSeconds/);
  assert.match(ui, /model\.addTrackRelative/);
  assert.match(ui, /videoProjectFilmstrip/);
  assert.match(html, /id="ntcvMediaSearch"/);
  assert.match(html, /id="ntcvTrackMenu"/);
  assert.match(main, /window-enter-video-editor/);
  assert.match(main, /video-project-filmstrip/);
  assert.match(preload, /enterVideoEditorWindowMode/);
  assert.match(preload, /videoProjectFilmstrip/);
});

test('video editor hides the app navigation and offers an explicit way back', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-project-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-project.css'), 'utf8');
  assert.match(html, /id="closeVideoEditor"[^>]*>\s*<span[^>]*>←<\/span> Fechar editor/);
  assert.doesNotMatch(html, /data-ntcv="toggle-sidebar"/);
  assert.match(app, /\$\('#closeVideoEditor'\)\.onclick\s*=\s*\(\)\s*=>\s*navigateToView\('home'\)/);
  assert.match(ui, /classList\.toggle\('video-editor-shell', next\)/);
  assert.match(css, /\.app-shell\.video-editor-shell\s*>\s*\.sidebar\s*\{\s*display:\s*none\s*;/);
  assert.match(css, /\.app-shell\.video-editor-shell\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('video workspace disables shared page scrolling only while its view is active', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'video-project.css'), 'utf8');
  const appCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(css, /\.content-scroll:has\(#videoEditorView\.active #videoProjectPanel:not\(\.hidden\)\)\s*\{\s*overflow:\s*hidden/);
  assert.doesNotMatch(css, /\.content-scroll:has\(#videoProjectPanel:not\(\.hidden\)\)/);
  assert.match(appCss, /\.content-scroll\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/);
});

test('base-track drag reorders a contiguous sequence instead of overlapping clips', () => {
  const p = model.createProject();
  const a = asset(p, 'image', 'C:/a.png');
  const b = asset(p, 'image', 'C:/b.png');
  const c = asset(p, 'image', 'C:/c.png');
  const first = model.addClip(p, a.id);
  const middle = model.addClip(p, b.id);
  const last = model.addClip(p, c.id);
  const track = model.findClip(p, last.id).track;
  model.moveClip(p, last.id, track.id, 5000);
  assert.deepEqual([first, middle, last].map(clip => clip.positionMs), [0, 10000, 5000]);
  assert.equal(model.durationMs(p), 15000);
});

test('undo/redo records one logical edit, clears redo after a new edit and tracks dirty snapshots', () => {
  const p = model.createProject();
  const saved = JSON.stringify(p);
  const history = createHistory(5);
  const a = asset(p, 'image', 'C:/image.png');
  const imported = JSON.stringify(p);
  history.record(saved, imported);
  model.addClip(p, a.id);
  const placed = JSON.stringify(p);
  history.record(imported, placed);
  assert.notEqual(saved, placed);
  assert.equal(history.undo(placed), imported);
  assert.equal(history.redo(imported), placed);
  assert.equal(history.undo(placed), imported);
  const alternate = JSON.stringify(model.createProject('Outro'));
  history.record(imported, alternate);
  assert.equal(history.canRedo, false);
  history.clear();
  assert.equal(history.canUndo, false);
});

test('v1 video migration preserves media, ids, clip timing and does not extend image', () => {
  const p = old.createProject('video', 'Legado');
  p.assets.push({ id: 'img', path: 'C:/img.png', name: 'img', kind: 'image', durationMs: 0, width: 100, height: 100 });
  p.assets.push({ id: 'snd', path: 'C:/snd.wav', name: 'snd', kind: 'audio', durationMs: 9000, width: 0, height: 0 });
  p.tracks.push({ id: 'v1', kind: 'visual', name: 'Visual', muted: false, volume: 100, clips: [{ id: 'clip1', assetId: 'img', positionMs: 2000, sourceStartMs: 0, durationMs: 3000, volume: 100, muted: false }] });
  p.tracks.push({ id: 'a1', kind: 'audio', name: 'Áudio', muted: false, volume: 100, clips: [{ id: 'clip2', assetId: 'snd', positionMs: 0, sourceStartMs: 0, durationMs: 9000, volume: 100, muted: false }] });
  const migrated = model.normalizeProject(old.normalizeProject(p));
  assert.equal(migrated.assets[0].id, 'img');
  assert.equal(migrated.tracks[0].clips[0].id, 'clip1');
  assert.equal(migrated.tracks[0].clips[0].durationMs, 3000);
  assert.equal(model.durationMs(migrated), 9000);
});

test('render plan includes visual/audio tracks, speed, trim, fades, transforms and no audio when absent', () => {
  const p = model.createProject();
  const image = asset(p, 'image', 'C:/foto.png');
  const video = asset(p, 'video', 'C:/video.mp4', 4000, true);
  const audio = asset(p, 'audio', 'C:/music.wav', 8000);
  const picture = model.addClip(p, image.id); picture.transform.fit = 'fill'; picture.transform.rotation = 12; picture.transform.crop.left = 5;
  const moving = model.addClip(p, video.id); moving.speed = 2; moving.durationMs = 1500; moving.fadeInMs = 200;
  model.addClip(p, audio.id);
  const plan = buildRenderPlan(p, 'C:/export.mp4', { resolution: '720', fps: 24 });
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1];
  assert.match(graph, /amix=inputs=2/);
  assert.match(graph, /rotate=/);
  assert.match(graph, /force_original_aspect_ratio=increase/);
  assert.match(graph, /atempo=2/);
  assert.equal(plan.height, 720);
  assert.equal(plan.width, 1280);
  model.removeClip(p, moving.id); model.removeClip(p, p.tracks.find(t => t.kind === 'audio').clips[0].id);
  const silent = buildRenderPlan(p, 'C:/silent.mp4');
  assert.ok(silent.args.includes('-an'));
});

test('real FFmpeg renders image, video, audio and text in mixed timeline', { skip: !fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-video-v2-test-'));
  try {
    const picture = path.join(dir, 'image.png');
    const video = path.join(dir, 'video.mp4');
    const audio = path.join(dir, 'audio.wav');
    const title = path.join(dir, 'title.png');
    await sharp({ create: { width: 64, height: 36, channels: 3, background: '#b64354' } }).png().toFile(picture);
    await writeTextPng(model.defaultText(), title);
    const titleStats = await sharp(title).stats();
    assert.ok(titleStats.channels[3].max > 0, 'text renderer must produce visible glyphs');
    run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=24:duration=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
    run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=1', audio]);
    const p = model.createProject(); p.settings.resolution = '720'; p.settings.fps = 24;
    const imageAsset = asset(p, 'image', picture);
    const videoAsset = asset(p, 'video', video, 500, true);
    const audioAsset = asset(p, 'audio', audio, 1000);
    const imageClip = model.addClip(p, imageAsset.id); imageClip.durationMs = 500;
    const videoClip = model.addClip(p, videoAsset.id); videoClip.durationMs = 500;
    const audioClip = model.addClip(p, audioAsset.id); audioClip.durationMs = 1000; audioClip.volume = 50;
    const textClip = model.addText(p, 0, 1000);
    const output = path.join(dir, 'result.mp4');
    const plan = buildRenderPlan(p, output, { textFiles: { [textClip.id]: title } });
    run(ffmpeg, plan.args);
    const result = JSON.parse(run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]));
    assert.ok(result.streams.some(stream => stream.codec_type === 'audio'));
    assert.ok(result.streams.some(stream => stream.codec_type === 'video' && stream.width === 1280 && stream.height === 720));
    assert.ok(Number(result.format.duration) >= .95);
    const still = model.createProject(); still.settings.resolution = '720'; still.settings.fps = 24;
    const stillAsset = asset(still, 'image', picture); model.addClip(still, stillAsset.id).durationMs = 250;
    const stillOut = path.join(dir, 'still.mp4'); run(ffmpeg, buildRenderPlan(still, stillOut).args);
    const stillProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', stillOut]));
    assert.equal(stillProbe.streams.filter(stream => stream.codec_type === 'audio').length, 0);
    assert.ok(stillProbe.streams.some(stream => stream.codec_type === 'video'));
    const imageColor = await pixelAt(stillOut, .1, 640, 360);
    assert.ok(imageColor[0] > 100 && imageColor[0] > imageColor[1] * 1.5, 'image must be composited over the canvas');
    const longAudio = asset(still, 'audio', audio, 1000); model.addClip(still, longAudio.id);
    const tailOut = path.join(dir, 'tail.mp4'); run(ffmpeg, buildRenderPlan(still, tailOut).args);
    const tailProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', tailOut]));
    assert.ok(Number(tailProbe.format.duration) >= .95);
    assert.equal(model.findClip(still, still.tracks.find(track => track.kind === 'visual' && track.role === 'base').clips[0].id).clip.durationMs, 250);
    const backgroundColor = await pixelAt(tailOut, .75, 640, 360);
    assert.ok(backgroundColor[0] < 30 && backgroundColor[1] < 30 && backgroundColor[2] < 30, 'audio tail must show project background, not a frozen image');
    const moving = model.createProject(); moving.settings.resolution = '720'; moving.settings.aspectRatio = '9:16'; moving.settings.fps = 24;
    const movingAsset = asset(moving, 'video', video, 500, true);
    const movingClip = model.addClip(moving, movingAsset.id); movingClip.speed = 2; movingClip.durationMs = 250; movingClip.fadeInMs = 100;
    const portraitOut = path.join(dir, 'portrait.mp4'); run(ffmpeg, buildRenderPlan(moving, portraitOut).args);
    const portraitProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', portraitOut]));
    assert.ok(portraitProbe.streams.some(stream => stream.codec_type === 'video' && stream.height === 720 && stream.width < 720));
    assert.ok(portraitProbe.streams.some(stream => stream.codec_type === 'audio'));
    const fullHd = model.createProject(); fullHd.settings.fps = 24;
    const fullAsset = asset(fullHd, 'image', picture); model.addClip(fullHd, fullAsset.id).durationMs = 120;
    const hdOut = path.join(dir, 'hd.mp4'); run(ffmpeg, buildRenderPlan(fullHd, hdOut).args);
    const hdProbe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', hdOut]));
    assert.ok(hdProbe.streams.some(stream => stream.codec_type === 'video' && stream.width === 1920 && stream.height === 1080));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
