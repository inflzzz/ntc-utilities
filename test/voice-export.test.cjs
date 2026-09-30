const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { saveVoiceAudio } = require('../src/voice-export.cjs');

function wav() {
  const data = Buffer.alloc(48);
  data.write('RIFF', 0); data.writeUInt32LE(40, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(48000, 24); data.writeUInt32LE(96000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(4, 40);
  return data;
}

function voiceSample() {
  const frames = 4800, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(48000, 24); data.writeUInt32LE(96000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / 48000)), 44 + i * 2);
  return data;
}

function runBinary(binary, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(binary, args, { windowsHide: true });
    let output = '';
    process.stdout.on('data', part => { output += part; });
    process.stderr.on('data', part => { output += part; });
    process.on('error', reject);
    process.on('close', code => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

test('export rejects invalid data, unsupported format and original overwrite', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-voice-export-'));
  try {
    const destination = path.join(folder, 'original.wav');
    const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: destination }) };
    const services = { dialog, runFfmpeg: async () => {} };
    await assert.rejects(saveVoiceAudio({ format: 'exe', wav: wav() }, services), /Formato/);
    await assert.rejects(saveVoiceAudio({ format: 'wav', wav: Buffer.alloc(44) }, services), /inválido/);
    await assert.rejects(saveVoiceAudio({ format: 'wav', wav: wav(), sourcePath: destination }, services), /original/);
    assert.equal(fs.existsSync(destination), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('cancel does not create output; WAV saves a valid copy', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-voice-export-'));
  try {
    const destination = path.join(folder, 'processed.wav');
    const dialog = { showSaveDialog: async () => ({ canceled: true }) };
    const services = { dialog, runFfmpeg: async () => { throw new Error('FFmpeg should not run'); } };
    assert.deepEqual(await saveVoiceAudio({ format: 'wav', wav: wav() }, services), { canceled: true });
    assert.equal(fs.existsSync(destination), false);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    assert.equal((await saveVoiceAudio({ format: 'wav', wav: wav() }, services)).file, destination);
    assert.deepEqual(fs.readFileSync(destination), wav());
    assert.deepEqual(fs.readdirSync(folder), ['processed.wav']);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('compressed output routes through the bundled FFmpeg adapter without changing source', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-voice-export-'));
  try {
    const destination = path.join(folder, 'processed.mp3');
    let args;
    const result = await saveVoiceAudio({ format: 'mp3', wav: wav() }, {
      dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) },
      runFfmpeg: async value => { args = value; assert.equal(fs.readFileSync(value[value.indexOf('-i') + 1]).toString('ascii', 0, 4), 'RIFF'); fs.writeFileSync(value.at(-1), 'encoded'); }
    });
    assert.equal(result.file, destination);
    assert.ok(args.includes('libmp3lame'));
    assert.equal(fs.readFileSync(destination, 'utf8'), 'encoded');
    assert.deepEqual(fs.readdirSync(folder), ['processed.mp3']);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('bundled FFmpeg creates playable MP3, FLAC and Opus exports', async t => {
  const ffmpeg = path.join(__dirname, '..', 'resources', 'bin', 'ffmpeg.exe');
  const ffprobe = path.join(__dirname, '..', 'resources', 'bin', 'ffprobe.exe');
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) return t.skip('Bundled FFmpeg unavailable on this host');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-voice-export-real-'));
  try {
    for (const format of ['mp3', 'flac', 'opus']) {
      const destination = path.join(folder, `voice.${format}`);
      await saveVoiceAudio({ format, wav: voiceSample() }, {
        dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) },
        runFfmpeg: args => runBinary(ffmpeg, args)
      });
      const info = JSON.parse(await runBinary(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate', '-of', 'json', destination]));
      assert.equal(info.streams[0].codec_name, format === 'opus' ? 'opus' : format);
      assert.ok(Number(info.streams[0].sample_rate) > 0);
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
