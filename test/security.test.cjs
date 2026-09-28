'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { PDFDocument, PDFName } = require('pdf-lib');
const {
  generatePasswords,
  generateSecureCodes,
  hashFile,
  cleanMetadataFile,
  encryptFile,
  decryptFile,
  createSecurityService
} = require('../src/security.cjs');

async function withTempFolder(run) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-security-test-'));
  try { await run(folder); }
  finally { await fs.rm(folder, { recursive: true, force: true }); }
}

function runProgram(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = '';
    child.stderr.on('data', data => { errorText += data.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(errorText || `Processo terminou com código ${code}.`)));
  });
}

test('password generator enforces selected character groups, limits, ambiguity and multiple results', () => {
  const passwords = generatePasswords({ length: 64, count: 5, lowercase: true, uppercase: true, numbers: true, symbols: true, excludeAmbiguous: true });
  assert.equal(passwords.length, 5);
  for (const password of passwords) {
    assert.equal(password.length, 64);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /\d/);
    assert.match(password, /[!@#$%^&*()\-_=+\[\]{}:,.?]/);
    assert.doesNotMatch(password, /[Il1|O0]/);
  }
  assert.throws(() => generatePasswords({ length: 7 }), /entre 8 e 256/);
  assert.throws(() => generatePasswords({ length: 8, lowercase: false, uppercase: false, numbers: false, symbols: false }), /ao menos um tipo/);
  assert.throws(() => generatePasswords({ count: 21 }), /entre 1 e 20/);
});

test('secure codes support hex keys, Base64URL tokens and unique recovery codes', () => {
  const hex = generateSecureCodes({ format: 'hex', bytes: 32 });
  assert.equal(hex.values[0].length, 64);
  assert.equal(hex.bits, 256);
  const token = generateSecureCodes({ format: 'base64url', bytes: 24 });
  assert.match(token.values[0], /^[A-Za-z0-9_-]+$/);
  const recovery = generateSecureCodes({ format: 'recovery', count: 20, characters: 12 });
  assert.equal(new Set(recovery.values).size, 20);
  assert.ok(recovery.values.every(value => /^[A-HJ-KM-NP-Z2-9]{6}-[A-HJ-KM-NP-Z2-9]{6}$/.test(value)));
  assert.throws(() => generateSecureCodes({ format: 'hex', bytes: 4 }), /entre 16 e 128/);
});

test('hash streams a file and returns its SHA-256 digest without changing it', async () => {
  await withTempFolder(async folder => {
    const input = path.join(folder, 'sample.bin');
    const bytes = Buffer.from('NTC security test');
    await fs.writeFile(input, bytes);
    const result = await hashFile(input);
    assert.equal(result.digest, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.name, 'sample.bin');
    assert.equal(await fs.readFile(input, 'utf8'), bytes.toString('utf8'));
  });
});

test('file encryption round-trips data, authenticates it, rejects wrong passwords, and never overwrites', async () => {
  await withTempFolder(async folder => {
    const input = path.join(folder, 'sample.bin');
    const encrypted = path.join(folder, 'sample.bin.ntcenc');
    const decrypted = path.join(folder, 'sample-restored.bin');
    const wrongOutput = path.join(folder, 'wrong-output.bin');
    const bytes = crypto.randomBytes(1024 * 1024 + 13);
    await fs.writeFile(input, bytes);
    const result = await encryptFile(input, encrypted, 'long test passphrase 123');
    assert.equal(result.ok, true);
    assert.ok((await fs.stat(encrypted)).size > bytes.length);
    await decryptFile(encrypted, decrypted, 'long test passphrase 123');
    assert.deepEqual(await fs.readFile(decrypted), bytes);
    await assert.rejects(decryptFile(encrypted, wrongOutput, 'incorrect password'), /senha está incorreta/);
    await assert.rejects(fs.access(wrongOutput));
    const tampered = path.join(folder, 'tampered.ntcenc');
    const encryptedBytes = await fs.readFile(encrypted);
    encryptedBytes[encryptedBytes.length - 1] ^= 0x01;
    await fs.writeFile(tampered, encryptedBytes);
    await assert.rejects(decryptFile(tampered, wrongOutput, 'long test passphrase 123'), /senha está incorreta/);
    await assert.rejects(encryptFile(input, encrypted, 'another long passphrase'), error => error.code === 'EEXIST');
    await assert.rejects(encryptFile(input, path.join(folder, 'short.ntcenc'), 'short'), /pelo menos 12 caracteres/);
  });
});

test('image metadata cleaning saves a metadata-free copy and preserves the source', async () => {
  await withTempFolder(async folder => {
    const input = path.join(folder, 'foto.jpg');
    const outputFolder = path.join(folder, 'limpas');
    await fs.mkdir(outputFolder);
    await sharp({ create: { width: 4, height: 3, channels: 3, background: '#f0f0f0' } }).jpeg().withExif({ IFD0: { Artist: 'Private author' } }).toFile(input);
    const result = await cleanMetadataFile(input, outputFolder, { sharp });
    assert.equal(result.ok, true);
    assert.equal(result.name, 'foto - sem metadados.jpg');
    assert.equal((await sharp(path.join(outputFolder, result.name)).metadata()).exif, undefined);
    assert.ok((await sharp(input).metadata()).exif);
  });
});

test('PDF metadata cleaning removes Info and XMP while keeping its page content', async () => {
  await withTempFolder(async folder => {
    const input = path.join(folder, 'report.pdf');
    const outputFolder = path.join(folder, 'clean');
    await fs.mkdir(outputFolder);
    const original = await PDFDocument.create();
    original.addPage([200, 200]);
    original.setTitle('Private title');
    original.setAuthor('Private author');
    original.setSubject('Private subject');
    original.catalog.set(PDFName.of('Metadata'), original.context.obj({ Private: 'XMP metadata' }));
    await fs.writeFile(input, await original.save());
    const result = await cleanMetadataFile(input, outputFolder, { sharp });
    const clean = await PDFDocument.load(await fs.readFile(path.join(outputFolder, result.name)), { updateMetadata: false });
    assert.equal(clean.context.trailerInfo.Info, undefined);
    assert.equal(clean.catalog.has(PDFName.of('Metadata')), false);
    assert.equal(clean.getTitle(), undefined);
    assert.equal(clean.getAuthor(), undefined);
    assert.equal(clean.getPageCount(), 1);
    assert.equal((await PDFDocument.load(await fs.readFile(input))).getTitle(), 'Private title');
  });
});

test('metadata cleaner remuxes media without metadata and keeps source intact', async () => {
  await withTempFolder(async folder => {
    const input = path.join(folder, 'clip.mkv');
    const outputFolder = path.join(folder, 'clean');
    await fs.mkdir(outputFolder);
    await fs.writeFile(input, 'original');
    const argsSeen = [];
    const runFfmpeg = async args => { argsSeen.push(args); await fs.writeFile(args.at(-1), 'clean'); };
    const result = await cleanMetadataFile(input, outputFolder, { sharp, runFfmpeg });
    assert.equal(result.name, 'clip - sem metadados.mkv');
    assert.ok(argsSeen[0].includes('-map_metadata'));
    assert.ok(argsSeen[0].includes('-map_chapters'));
    assert.equal(await fs.readFile(input, 'utf8'), 'original');
  });
});

test('bundled FFmpeg strips actual audio tags when available', async t => {
  const root = path.join(__dirname, '..');
  const ffmpeg = path.join(root, 'resources', 'bin', 'ffmpeg.exe');
  const ffprobe = path.join(root, 'resources', 'bin', 'ffprobe.exe');
  if (!require('node:fs').existsSync(ffmpeg) || !require('node:fs').existsSync(ffprobe)) return t.skip('Bundled media tools are not installed in this checkout.');
  await withTempFolder(async folder => {
    const input = path.join(folder, 'tagged.wav');
    const cleanFolder = path.join(folder, 'clean');
    await fs.mkdir(cleanFolder);
    await runProgram(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=523:duration=0.25', '-metadata', 'title=Private title', '-metadata', 'artist=Private artist', '-y', input]);
    const result = await cleanMetadataFile(input, cleanFolder, { sharp, runFfmpeg: args => runProgram(ffmpeg, args) });
    const tags = await new Promise((resolve, reject) => {
      const child = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', path.join(cleanFolder, result.name)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let errorText = '';
      child.stdout.on('data', data => { output += data.toString(); });
      child.stderr.on('data', data => { errorText += data.toString(); });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(output) : reject(new Error(errorText)));
    });
    assert.doesNotMatch(tags, /Private title|Private artist/);
    assert.match(tags, /"streams"/);
  });
});

test('security IPC validates its sender and exposes only the dedicated operations', async () => {
  const handlers = new Map();
  const copied = [];
  const sender = {};
  const window = { webContents: sender, isDestroyed: () => false };
  const service = createSecurityService({
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    getMainWindow: () => window,
    clipboard: { writeText: text => copied.push(text) },
    sharp,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    ignoreClipboardText: text => copied.push(`ignored:${text}`)
  });
  const invoke = (channel, event, ...args) => handlers.get(channel)(event, ...args);
  const denied = await invoke(service.channels.generate, { sender: {} }, { kind: 'password' });
  assert.equal(denied.ok, false);
  const generated = await invoke(service.channels.generate, { sender }, { kind: 'password', length: 24 });
  assert.equal(generated.ok, true);
  assert.equal(generated.values[0].length, 24);
  assert.deepEqual(await invoke(service.channels.copy, { sender }, generated.values[0]), { ok: true });
  assert.deepEqual(copied, [`ignored:${generated.values[0]}`, generated.values[0]]);
  assert.deepEqual(await invoke(service.channels.hash, { sender }, 'sha256'), { ok: true, canceled: true, files: [] });
});

test('encryption IPC accepts a selected or dragged JPEG and saves both operations beside the source', async () => {
  await withTempFolder(async folder => {
    const input = path.join(folder, 'foto.jpg');
    const encrypted = path.join(folder, 'foto.jpg.ntcenc');
    const restored = path.join(folder, 'foto - descriptografado.jpg');
    const original = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#d8c7a0' } }).jpeg().toBuffer();
    await fs.writeFile(input, original);

    const handlers = new Map();
    const sender = {};
    const window = { webContents: sender, isDestroyed: () => false };
    let openDialogCount = 0;
    const dialog = {
      showOpenDialog: async () => { openDialogCount++; return { canceled: false, filePaths: [input] }; }
    };
    const service = createSecurityService({
      ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
      getMainWindow: () => window,
      dialog,
      clipboard: { writeText() {} },
      sharp
    });
    const selectFile = () => handlers.get(service.channels.selectFile)({ sender });
    const registerDroppedFile = filePath => handlers.get(service.channels.registerDroppedFile)({ sender }, filePath);
    const invoke = options => handlers.get(service.channels.encrypt)({ sender }, options);

    const selectedFile = await selectFile();
    assert.equal(selectedFile.ok, true);
    assert.equal(selectedFile.file.name, 'foto.jpg');
    assert.equal(openDialogCount, 1);
    const protectedFile = await invoke({ action: 'encrypt', password: 'senha forte para jpeg 123', selectionId: selectedFile.file.id });
    assert.equal(protectedFile.ok, true, protectedFile.message);
    assert.equal(protectedFile.outputPath, encrypted);
    assert.equal(openDialogCount, 1);
    assert.ok((await fs.stat(encrypted)).size > original.length);

    const droppedFile = await registerDroppedFile(encrypted);
    assert.equal(droppedFile.ok, true);
    assert.equal(droppedFile.file.name, 'foto.jpg.ntcenc');
    const decryptedFile = await invoke({ action: 'decrypt', password: 'senha forte para jpeg 123', selectionId: droppedFile.file.id });
    assert.equal(decryptedFile.ok, true, decryptedFile.message);
    assert.equal(decryptedFile.outputPath, restored);
    assert.equal(openDialogCount, 1);
    assert.deepEqual(await fs.readFile(restored), original);
  });
});

test('security tools are linked from the app navigation and have no password analyser', async () => {
  const root = path.join(__dirname, '..');
  const [html, preload, appSource, ui, styles] = await Promise.all([
    fs.readFile(path.join(root, 'src', 'index.html'), 'utf8'),
    fs.readFile(path.join(root, 'preload.cjs'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'app.js'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'security-ui.js'), 'utf8'),
    fs.readFile(path.join(root, 'src', 'styles.css'), 'utf8')
  ]);
  assert.match(html, /data-view="security"/);
  assert.match(html, /data-open-tool="security"/);
  assert.match(html, /data-security-tab="secrets"/);
  assert.match(html, /id="securityCleanMetadata"/);
  assert.match(html, /id="securityHashFiles"/);
  assert.match(html, /id="securityEncryptFile"/);
  assert.match(html, /id="securityFileDropzone"/);
  assert.match(html, /id="securityChooseFile"/);
  assert.match(html, /id="securitySelectedFile"/);
  assert.match(html, /id="securityEncryptionPassword"[^>]*disabled/);
  assert.match(html, /id="securityHistoryTab"/);
  assert.match(html, /id="securityHistoryPanel"/);
  assert.match(html, /arraste ou selecione o arquivo/);
  assert.match(html, /original permanece intacto/);
  assert.doesNotMatch(html, /janelas confusas/);
  assert.match(html, /\.ntcenc/);
  assert.doesNotMatch(html, /Analisador de senha|Verificar força da senha/);
  assert.match(preload, /generateSecurityValues/);
  assert.match(preload, /copySecuritySecret/);
  assert.match(preload, /transformSecureFile/);
  assert.match(preload, /selectSecureFile/);
  assert.match(preload, /registerDroppedSecureFile/);
  assert.match(appSource, /ntc-security-history/);
  assert.match(appSource, /securityHistoryTab/);
  assert.match(ui, /ntc-security-history/);
  assert.match(ui, /pathForFile\(file\)/);
  assert.match(appSource, /ntcSecurityUi\?\.close/);
  assert.match(ui, /window\.ntcSecurityUi =/);
  assert.match(styles, /\.security-encryption-actions button \{[^}]*margin: 0/);
  assert.match(styles, /\.security-warning-note \{[^}]*align-items: center/);
  assert.match(styles, /\.toast \{[^}]*overflow-wrap: anywhere/);
  assert.equal((styles.match(/security-operation-spin 4s linear infinite/g) || []).length, 2);
  assert.match(styles, /security-encryption-actions button\[aria-busy="true"\]::before \{ animation-duration: 4s !important/);
});
