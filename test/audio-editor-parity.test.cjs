const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const media = require('../src/media-project.js');
const features = require('../src/audio-editor-features.js');

const ffmpeg = path.resolve(__dirname, '../resources/bin/ffmpeg.exe');
const ffprobe = path.resolve(__dirname, '../resources/bin/ffprobe.exe');
function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${path.basename(binary)} ${args.join(' ')}\n${result.stderr?.slice(-1500)}`);
  return result.stdout;
}
function fixture(files) {
  const project = media.createProject('audio', 'Seis instrumentos');
  project.assets = files.map((file, index) => ({ id: `asset-${index}`, path: file, name: path.basename(file), kind: 'audio', durationMs: 1000 }));
  project.tracks = files.map((_, index) => ({ id: `track-${index}`, kind: 'audio', name: `Instrumento ${index + 1}`, volume: 100, muted: false,
    clips: [{ id: `clip-${index}`, assetId: `asset-${index}`, positionMs: 0, sourceStartMs: 0, durationMs: 1000, volume: 100, muted: false }] }));
  return project;
}

test('v1 projects migrate in memory to v2 and preserve ids, source trim, collection of clips and video v1', () => {
  const project = fixture(['C:/old/song.wav']);
  project.schemaVersion = 1;
  delete project.output; delete project.markers;
  const migrated = media.normalizeProject(project);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.tracks[0].clips[0].id, 'clip-0');
  assert.equal(migrated.tracks[0].clips[0].effects.gain, 0);
  assert.equal(migrated.output.format, 'wav');
  assert.deepEqual(migrated.markers, []);
  assert.equal(project.schemaVersion, 1, 'opening does not mutate the original saved document');
  assert.deepEqual(media.normalizeProject(JSON.parse(JSON.stringify(migrated))), migrated);
  const video = media.createProject('video');
  assert.equal(video.schemaVersion, 1);
});

test('audio navigation has one editor and classic-only IPC, controls and listeners are gone', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  assert.match(html, /id="converterView"[\s\S]*?id="audioProjectPanel"/);
  for (const obsolete of ['audioLegacyMode', 'audioProjectMode', 'converterLegacyImport', 'converterEditor', 'conversionQueueSection', 'conversionProgress']) {
    assert.doesNotMatch(html, new RegExp(`id="${obsolete}"`));
  }
  assert.doesNotMatch(app, /addMediaFiles|startNextConversion|renderConversionQueue|currentConversion/);
  assert.doesNotMatch(main, /ipcMain\.handle\('start-conversion'|ipcMain\.handle\('choose-media-files'/);
  assert.doesNotMatch(preload, /startConversion:|cancelConversion:|chooseMediaFiles:|onConversionEvent:/);
  assert.match(app, /NTCMediaProjectUi\?\.importAudioPaths/);
  assert.match(html, /id="rngMaintenanceView"/);
});

test('classic output formats, bitrates, effects, metadata, marker ranges and track isolation build explicit plans', () => {
  const project = fixture(['C:/stems/one.wav', 'C:/stems/two.wav']);
  project.tracks[0].clips[0].effects = { gain: 2, eqBass: 3, eqMid: -1, eqTreble: 4, normalize: true, removeSilence: true };
  project.output.metadata = { title: 'Canção', artist: 'NTC', album: 'Teste', year: '2026', genre: 'Rock' };
  project.markers.push({ id: 'range-1', name: 'Parte', startMs: 100, endMs: 700 });
  for (const [format, details] of Object.entries(features.FORMATS)) {
    project.output.format = format;
    project.output.quality = details.bitrate ? '256' : 'lossless';
    const plan = media.audioRenderPlan(project, `C:/out/mix.${format}`, format, { range: project.markers[0], trackId: 'track-0' });
    assert.ok(plan.args.includes(details.codec), format);
    assert.equal(plan.duration, .6);
    assert.ok(plan.args.includes('C:/stems/one.wav'));
    assert.ok(!plan.args.includes('C:/stems/two.wav'));
    assert.match(plan.args[plan.args.indexOf('-filter_complex') + 1], /loudnorm=I=-16:TP=-1\.5:LRA=11/);
    assert.match(plan.args[plan.args.indexOf('-filter_complex') + 1], /silenceremove=/);
    assert.match(plan.args[plan.args.indexOf('-filter_complex') + 1], /atrim=start=0\.100:end=0\.700/);
    assert.ok(plan.args.includes('title=Canção'));
    assert.ok(plan.args.includes('date=2026'));
    if (details.bitrate) assert.ok(plan.args.includes('256k'));
  }
  assert.throws(() => media.audioRenderPlan(project, 'out.wav', 'wav', { range: { startMs: 900, endMs: 100 } }), /trecho/);
});

test('bundled FFmpeg exports six stems in WAV and MP3 and all classic output containers', { skip: !fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe) }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-audio-parity-'));
  try {
    const files = Array.from({ length: 6 }, (_, index) => path.join(directory, `stem-${index}.wav`));
    files.forEach((file, index) => run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${220 + index * 110}:duration=1`, '-c:a', 'pcm_s16le', file]));
    const project = fixture(files);
    project.output.metadata = { title: 'Seis stems', artist: 'NTC', album: 'Auditoria', year: '2026', genre: 'Instrumental' };
    const serialized = JSON.stringify(media.normalizeProject(project));
    const reopened = media.normalizeProject(JSON.parse(serialized));
    assert.equal(reopened.tracks.length, 6);
    for (const format of Object.keys(features.FORMATS)) {
      reopened.output.format = format;
      const file = path.join(directory, `mix.${format}`);
      const plan = media.audioRenderPlan(reopened, file, format);
      run(ffmpeg, plan.args);
      assert.ok(fs.statSync(file).size > 100);
      const info = JSON.parse(run(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
      assert.ok(info.streams.some(stream => stream.codec_type === 'audio'), format);
      if (['wav', 'mp3', 'flac', 'm4a'].includes(format)) assert.match(JSON.stringify(info.format.tags || {}), /Seis stems/i);
      if (['mp3', 'flac', 'm4a'].includes(format)) {
        const tags = JSON.stringify(info.format.tags || {});
        assert.match(tags, /NTC/);
        assert.match(tags, /Auditoria/);
        assert.match(tags, /2026/);
        assert.match(tags, /Instrumental/);
      }
    }
    reopened.output.format = 'wav';
    const stemFile = path.join(directory, 'solo.wav');
    run(ffmpeg, media.audioRenderPlan(reopened, stemFile, 'wav', { trackId: 'track-2' }).args);
    assert.ok(fs.statSync(stemFile).size > 100);
    const rangeFile = path.join(directory, 'range.wav');
    run(ffmpeg, media.audioRenderPlan(reopened, rangeFile, 'wav', { range: { startMs: 200, endMs: 700 } }).args);
    const rangeInfo = JSON.parse(run(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', rangeFile]));
    assert.ok(Number(rangeInfo.format.duration) >= .45 && Number(rangeInfo.format.duration) <= .55);
  } finally {
    if (directory.startsWith(os.tmpdir() + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('custom cover and preserved source cover are embedded in supported exports', { skip: !fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe) }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-audio-cover-'));
  try {
    const source = path.join(directory, 'source.wav');
    const cover = path.join(directory, 'cover.jpg');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', source]);
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-frames:v', '1', '-update', '1', cover]);
    const project = fixture([source]);
    for (const format of ['mp3', 'm4a', 'flac']) {
      project.output.format = format;
      const file = path.join(directory, `covered.${format}`);
      run(ffmpeg, media.audioRenderPlan(project, file, format, { cover: { kind: 'file', path: cover, streamIndex: 0 } }).args);
      const info = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', file]));
      assert.ok(info.streams.some(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic), format);
    }
    const sourceWithCover = path.join(directory, 'source-covered.mp3');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', source, '-i', cover, '-map', '0:a:0', '-map', '1:v:0', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic', sourceWithCover]);
    const inherited = fixture([sourceWithCover]);
    inherited.assets[0].coverStreamIndex = 1;
    inherited.output.format = 'mp3';
    const reused = path.join(directory, 'reused.mp3');
    run(ffmpeg, media.audioRenderPlan(inherited, reused, 'mp3', { cover: { kind: 'source', assetId: 'asset-0', streamIndex: 1 } }).args);
    const info = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', reused]));
    assert.ok(info.streams.some(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic));
  } finally {
    if (directory.startsWith(os.tmpdir() + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('clip gain changes actual PCM output and audio embedded in video remains importable', { skip: !fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe) }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-audio-gain-'));
  try {
    const source = path.join(directory, 'source.wav');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', source]);
    const project = fixture([source]);
    const neutral = path.join(directory, 'neutral.wav');
    run(ffmpeg, media.audioRenderPlan(project, neutral, 'wav').args);
    project.tracks[0].clips[0].effects = { gain: 6 };
    const boosted = path.join(directory, 'boosted.wav');
    run(ffmpeg, media.audioRenderPlan(project, boosted, 'wav').args);
    function rms(file) {
      const pcm = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 's16le', '-acodec', 'pcm_s16le', '-'], { timeout: 30000 }).stdout;
      let sum = 0;
      for (let offset = 0; offset < pcm.length; offset += 2) { const value = pcm.readInt16LE(offset); sum += value * value; }
      return Math.sqrt(sum / (pcm.length / 2));
    }
    assert.ok(rms(boosted) / rms(neutral) > 1.9);
    const video = path.join(directory, 'source.mp4');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1', '-i', source, '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);
    const extracted = fixture([video]);
    const output = path.join(directory, 'from-video.wav');
    run(ffmpeg, media.audioRenderPlan(extracted, output, 'wav').args);
    assert.ok(fs.statSync(output).size > 100);
  } finally {
    if (directory.startsWith(os.tmpdir() + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('equalizer, loudness normalization and silence removal survive a real render', { skip: !fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe) }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-audio-effects-'));
  try {
    const source = path.join(directory, 'source.wav');
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=0.7', '-af', 'adelay=300:all=1', '-t', '1', source]);
    const project = fixture([source]);
    project.tracks[0].clips[0].effects = { gain: 2, eqBass: 3, eqMid: -2, eqTreble: 1, normalize: true, removeSilence: true };
    const output = path.join(directory, 'processed.wav');
    run(ffmpeg, media.audioRenderPlan(project, output, 'wav').args);
    const info = JSON.parse(run(ffprobe, ['-v', 'error', '-show_format', '-of', 'json', output]));
    assert.ok(Number(info.format.duration) > .4 && Number(info.format.duration) < .9);
  } finally {
    if (directory.startsWith(os.tmpdir() + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  }
});
