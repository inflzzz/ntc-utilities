'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const { PDFDocument, PDFName } = require('pdf-lib');

const scrypt = promisify(crypto.scrypt);
const ENCRYPTED_FILE_MAGIC = Buffer.from('NTCSEC01', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = ENCRYPTED_FILE_MAGIC.length + SALT_BYTES + IV_BYTES;
const MAX_PASSWORD_CHARS = 1024;
const IMAGE_FORMATS = new Map([
  ['.jpg', 'jpeg'], ['.jpeg', 'jpeg'], ['.png', 'png'], ['.webp', 'webp'], ['.tif', 'tiff'], ['.tiff', 'tiff']
]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v']);
const PDF_EXTENSION = '.pdf';
const CLEANABLE_EXTENSIONS = [...IMAGE_FORMATS.keys(), ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, PDF_EXTENSION];
const PASSWORD_GROUPS = Object.freeze({
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{}:,.?'
});
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomFrom(characters) {
  return characters[crypto.randomInt(0, characters.length)];
}

function shuffleSecurely(values) {
  for (let index = values.length - 1; index > 0; index--) {
    const swap = crypto.randomInt(0, index + 1);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function generatePasswords(options = {}) {
  const length = Number(options.length ?? 24);
  const count = Number(options.count ?? 1);
  if (!Number.isSafeInteger(length) || length < 8 || length > 256) throw new Error('O tamanho da senha deve ficar entre 8 e 256 caracteres.');
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw new Error('Gere entre 1 e 20 senhas por vez.');
  const selected = ['lowercase', 'uppercase', 'numbers', 'symbols'].filter(name => options[name] !== false);
  if (!selected.length) throw new Error('Ative ao menos um tipo de caractere.');
  if (selected.length > length) throw new Error('O tamanho escolhido é menor que a quantidade de grupos ativos.');
  const groups = selected.map(name => options.excludeAmbiguous === true
    ? PASSWORD_GROUPS[name].replace(/[Il1|O0]/g, '')
    : PASSWORD_GROUPS[name]);
  const alphabet = [...new Set(groups.join(''))].join('');
  return Array.from({ length: count }, () => {
    const characters = groups.map(randomFrom);
    while (characters.length < length) characters.push(randomFrom(alphabet));
    return shuffleSecurely(characters).join('');
  });
}

function generateSecureCodes(options = {}) {
  const format = options.format;
  if (format === 'hex') {
    const bytes = Number(options.bytes ?? 32);
    if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) throw new Error('A chave deve ter entre 16 e 128 bytes.');
    return { format, values: [crypto.randomBytes(bytes).toString('hex')], bits: bytes * 8 };
  }
  if (format === 'base64url') {
    const bytes = Number(options.bytes ?? 32);
    if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) throw new Error('O token deve ter entre 16 e 128 bytes.');
    return { format, values: [crypto.randomBytes(bytes).toString('base64url')], bits: bytes * 8 };
  }
  if (format === 'recovery') {
    const count = Number(options.count ?? 10);
    const characters = Number(options.characters ?? 10);
    if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw new Error('Gere entre 1 e 50 códigos de recuperação.');
    if (!Number.isSafeInteger(characters) || characters < 8 || characters > 32) throw new Error('Cada código deve ter entre 8 e 32 caracteres.');
    const values = Array.from({ length: count }, () => {
      const raw = Array.from({ length: characters }, () => randomFrom(RECOVERY_ALPHABET)).join('');
      const splitAt = Math.floor(raw.length / 2);
      return `${raw.slice(0, splitAt)}-${raw.slice(splitAt)}`;
    });
    return { format, values, bits: Math.floor(characters * Math.log2(RECOVERY_ALPHABET.length)) };
  }
  throw new Error('Formato de código seguro inválido.');
}

function assertRegularFile(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('Selecione um arquivo válido.');
  return { resolved, stat };
}

async function hashFile(filePath, algorithm = 'sha256') {
  if (!['sha256', 'sha384', 'sha512', 'sha3-256', 'blake2b512'].includes(algorithm)) throw new Error('Algoritmo de hash não permitido.');
  const { resolved, stat } = assertRegularFile(filePath);
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(resolved)) hash.update(chunk);
  return { name: path.basename(resolved), size: stat.size, algorithm, digest: hash.digest('hex') };
}

async function mapWithLimit(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, concurrency));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index], index);
    }
  }));
  return results;
}

function uniqueOutputPath(folder, filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(folder, filename);
  let index = 1;
  while (fs.existsSync(candidate)) candidate = path.join(folder, `${stem} (${index++})${extension}`);
  return candidate;
}

async function cleanPdfMetadata(source, output) {
  const data = await fsp.readFile(source);
  const document = await PDFDocument.load(data, { updateMetadata: false });
  document.catalog.delete(PDFName.of('Metadata'));
  document.context.trailerInfo.Info = undefined;
  const clean = await document.save({ useObjectStreams: true });
  await fsp.writeFile(output, clean, { flag: 'wx' });
}

async function cleanMetadataFile(filePath, outputFolder, { sharp, runFfmpeg }) {
  const { resolved, stat } = assertRegularFile(filePath);
  const extension = path.extname(resolved).toLowerCase();
  if (!CLEANABLE_EXTENSIONS.includes(extension)) throw new Error('Formato não compatível para limpeza de metadados.');
  if (extension === PDF_EXTENSION && stat.size > 500 * 1024 * 1024) throw new Error('PDF acima do limite de 500 MB.');
  const sourceName = path.basename(resolved);
  const desiredName = `${path.basename(sourceName, extension)} - sem metadados${extension}`;
  const output = uniqueOutputPath(outputFolder, desiredName);
  const temporary = path.join(outputFolder, `.ntc-clean-${crypto.randomBytes(12).toString('hex')}${extension}`);
  try {
    if (IMAGE_FORMATS.has(extension)) {
      let pipelineImage = sharp(resolved, { limitInputPixels: 268_402_689 }).rotate();
      const format = IMAGE_FORMATS.get(extension);
      if (format === 'jpeg') pipelineImage = pipelineImage.jpeg({ quality: 100, chromaSubsampling: '4:4:4' });
      else if (format === 'png') pipelineImage = pipelineImage.png({ compressionLevel: 9 });
      else if (format === 'webp') pipelineImage = pipelineImage.webp({ quality: 100, lossless: true });
      else pipelineImage = pipelineImage.tiff({ quality: 100, compression: 'lzw' });
      await pipelineImage.toFile(temporary);
    } else if (extension === PDF_EXTENSION) {
      await cleanPdfMetadata(resolved, temporary);
    } else {
      if (typeof runFfmpeg !== 'function') throw new Error('O FFmpeg não está disponível para limpar este formato.');
      await runFfmpeg(['-hide_banner', '-v', 'error', '-i', resolved, '-map', '0', '-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1', '-c', 'copy', '-n', temporary]);
    }
    await commitWithoutOverwrite(temporary, output);
    const resultStat = await fsp.stat(output);
    return { ok: true, name: path.basename(output), size: resultStat.size };
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}

function normalizePassphrase(value, { encrypt }) {
  if (typeof value !== 'string' || value.length > MAX_PASSWORD_CHARS) throw new Error('Senha inválida ou longa demais.');
  if (!value.trim()) throw new Error('Informe a senha para continuar.');
  if (encrypt && [...value].length < 12) throw new Error('Use uma senha com pelo menos 12 caracteres para criptografar.');
  return value;
}

async function deriveEncryptionKey(password, salt) {
  return scrypt(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

async function commitWithoutOverwrite(temporaryPath, outputPath) {
  await fsp.link(temporaryPath, outputPath);
  await fsp.unlink(temporaryPath);
}

async function encryptFile(inputPath, outputPath, passphrase) {
  const password = normalizePassphrase(passphrase, { encrypt: true });
  const { resolved: input, stat } = assertRegularFile(inputPath);
  const output = path.resolve(outputPath);
  if (input === output) throw new Error('O arquivo criptografado precisa ser salvo em outro caminho.');
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const header = Buffer.concat([ENCRYPTED_FILE_MAGIC, salt, iv]);
  const temporary = `${output}.ntc-${crypto.randomBytes(12).toString('hex')}.tmp`;
  let key;
  try {
    key = await deriveEncryptionKey(password, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(ENCRYPTED_FILE_MAGIC);
    await fsp.writeFile(temporary, header, { flag: 'wx' });
    await pipeline(fs.createReadStream(input), cipher, fs.createWriteStream(temporary, { flags: 'a' }));
    await fsp.appendFile(temporary, cipher.getAuthTag());
    await commitWithoutOverwrite(temporary, output);
    return { ok: true, name: path.basename(output), outputPath: output, sourceBytes: stat.size, outputBytes: (await fsp.stat(output)).size };
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  } finally { key?.fill(0); }
}

async function decryptFile(inputPath, outputPath, passphrase) {
  const password = normalizePassphrase(passphrase, { encrypt: false });
  const { resolved: input, stat } = assertRegularFile(inputPath);
  const output = path.resolve(outputPath);
  if (input === output) throw new Error('O arquivo descriptografado precisa ser salvo em outro caminho.');
  if (stat.size < HEADER_BYTES + TAG_BYTES) throw new Error('Esse arquivo não é um arquivo NTC criptografado válido.');
  const file = await fsp.open(input, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  let key;
  const temporary = `${output}.ntc-${crypto.randomBytes(12).toString('hex')}.tmp`;
  try {
    const headerRead = await file.read(header, 0, HEADER_BYTES, 0);
    const tagRead = await file.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    if (headerRead.bytesRead !== HEADER_BYTES || tagRead.bytesRead !== TAG_BYTES || !header.subarray(0, ENCRYPTED_FILE_MAGIC.length).equals(ENCRYPTED_FILE_MAGIC)) {
      throw new Error('Esse arquivo não é um arquivo NTC criptografado válido.');
    }
    const salt = header.subarray(ENCRYPTED_FILE_MAGIC.length, ENCRYPTED_FILE_MAGIC.length + SALT_BYTES);
    const iv = header.subarray(ENCRYPTED_FILE_MAGIC.length + SALT_BYTES);
    key = await deriveEncryptionKey(password, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(ENCRYPTED_FILE_MAGIC);
    decipher.setAuthTag(tag);
    const dataBytes = stat.size - HEADER_BYTES - TAG_BYTES;
    const source = dataBytes ? fs.createReadStream(input, { start: HEADER_BYTES, end: stat.size - TAG_BYTES - 1 }) : Readable.from([]);
    await pipeline(source, decipher, fs.createWriteStream(temporary, { flags: 'wx' }));
    await commitWithoutOverwrite(temporary, output);
    return { ok: true, name: path.basename(output), outputPath: output, outputBytes: (await fsp.stat(output)).size };
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    if (error.code === 'ERR_OSSL_EVP_BAD_DECRYPT' || error.code === 'ERR_CRYPTO_AUTH_FAILED' || /authenticate|auth tag|bad decrypt/i.test(error.message)) {
      throw new Error('A senha está incorreta ou o arquivo criptografado foi alterado.');
    }
    throw error;
  } finally {
    key?.fill(0);
    await file.close().catch(() => {});
  }
}

function createSecurityService({ ipcMain, getMainWindow, dialog, clipboard, sharp, runFfmpeg, ignoreClipboardText }) {
  const channels = Object.freeze({ generate: 'security-generate', copy: 'security-copy-secret', hash: 'security-hash-files', clean: 'security-clean-metadata', selectFile: 'security-select-encryption-file', registerDroppedFile: 'security-register-dropped-file', releaseFile: 'security-release-encryption-file', encrypt: 'security-encrypt-file' });
  const selectedFiles = new Map();
  const validSender = event => {
    const window = getMainWindow?.();
    return Boolean(window && !window.isDestroyed?.() && event?.sender === window.webContents);
  };
  const parent = () => {
    const window = getMainWindow?.();
    return window && !window.isDestroyed?.() ? window : undefined;
  };
  const handle = (channel, callback) => ipcMain.handle(channel, async (event, ...args) => {
    if (!validSender(event)) return { ok: false, message: 'Origem da solicitação inválida.' };
    try { return await callback(...args); }
    catch (error) { return { ok: false, message: error.message || 'Não foi possível concluir a operação.' }; }
  });

  handle(channels.generate, options => {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Opções de geração inválidas.');
    if (options.kind === 'password') return { ok: true, values: generatePasswords(options) };
    if (options.kind === 'code') return { ok: true, ...generateSecureCodes(options) };
    throw new Error('Tipo de geração inválido.');
  });
  handle(channels.copy, text => {
    if (typeof text !== 'string' || !text || text.length > 10_000) throw new Error('Conteúdo para cópia inválido.');
    ignoreClipboardText?.(text);
    clipboard.writeText(text);
    return { ok: true };
  });
  handle(channels.hash, async algorithm => {
    const selection = await dialog.showOpenDialog(parent(), { title: 'Escolha arquivos para calcular o hash', properties: ['openFile', 'multiSelections'] });
    if (selection.canceled) return { ok: true, canceled: true, files: [] };
    if (selection.filePaths.length > 100) throw new Error('Selecione no máximo 100 arquivos por operação.');
    const results = await mapWithLimit(selection.filePaths, 4, async file => {
      try { return { ...(await hashFile(file, algorithm)), ok: true }; }
      catch (error) { return { name: path.basename(file), ok: false, message: error.message }; }
    });
    return { ok: true, files: results };
  });
  handle(channels.clean, async () => {
    const selection = await dialog.showOpenDialog(parent(), {
      title: 'Escolha arquivos para remover metadados', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imagens, áudio, vídeo e PDF', extensions: CLEANABLE_EXTENSIONS.map(extension => extension.slice(1)) }]
    });
    if (selection.canceled) return { ok: true, canceled: true, files: [] };
    if (selection.filePaths.length > 100) throw new Error('Selecione no máximo 100 arquivos por operação.');
    const destination = await dialog.showOpenDialog(parent(), { title: 'Escolha onde salvar as cópias limpas', properties: ['openDirectory', 'createDirectory'] });
    if (destination.canceled || !destination.filePaths[0]) return { ok: true, canceled: true, files: [] };
    const results = await mapWithLimit(selection.filePaths, 2, async file => {
      try { return { source: path.basename(file), ...(await cleanMetadataFile(file, destination.filePaths[0], { sharp, runFfmpeg })) }; }
      catch (error) { return { source: path.basename(file), ok: false, message: error.message || 'Não foi possível limpar os metadados.' }; }
    });
    return { ok: true, folder: destination.filePaths[0], files: results };
  });
  const rememberFile = filePath => {
    if (typeof filePath !== 'string' || !filePath || filePath.length > 32_768) throw new Error('Arquivo inválido. Selecione ou arraste um arquivo local.');
    const { resolved, stat } = assertRegularFile(filePath);
    while (selectedFiles.size >= 20) selectedFiles.delete(selectedFiles.keys().next().value);
    const id = crypto.randomBytes(24).toString('base64url');
    selectedFiles.set(id, resolved);
    return { ok: true, file: { id, name: path.basename(resolved), size: stat.size, extension: path.extname(resolved).slice(1).toUpperCase() || 'Arquivo' } };
  };
  handle(channels.selectFile, async () => {
    const selected = await dialog.showOpenDialog(parent(), { title: 'Selecionar arquivo', properties: ['openFile'], filters: [{ name: 'Todos os arquivos', extensions: ['*'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: true, canceled: true };
    return rememberFile(selected.filePaths[0]);
  });
  handle(channels.registerDroppedFile, filePath => rememberFile(filePath));
  handle(channels.releaseFile, id => {
    if (typeof id === 'string') selectedFiles.delete(id);
    return { ok: true };
  });
  handle(channels.encrypt, async options => {
    if (!options || !['encrypt', 'decrypt'].includes(options.action)) throw new Error('Ação de criptografia inválida.');
    if (typeof options.selectionId !== 'string' || !selectedFiles.has(options.selectionId)) throw new Error('Selecione ou arraste novamente o arquivo que deseja processar.');
    const password = normalizePassphrase(options.password, { encrypt: options.action === 'encrypt' });
    const input = selectedFiles.get(options.selectionId);
    const selectedName = path.basename(input);
    const originalName = selectedName.toLowerCase().endsWith('.ntcenc') ? selectedName.slice(0, -7) : selectedName;
    const originalExtension = path.extname(originalName);
    const defaultName = options.action === 'encrypt'
      ? `${selectedName}.ntcenc`
      : `${path.basename(originalName, originalExtension)} - descriptografado${originalExtension}`;
    const output = uniqueOutputPath(path.dirname(input), defaultName);
    const result = await (options.action === 'encrypt'
      ? encryptFile(input, output, password)
      : decryptFile(input, output, password));
    selectedFiles.delete(options.selectionId);
    return result;
  });
  return { channels };
}

module.exports = {
  CLEANABLE_EXTENSIONS,
  PASSWORD_GROUPS,
  ENCRYPTED_FILE_MAGIC,
  generatePasswords,
  generateSecureCodes,
  hashFile,
  cleanMetadataFile,
  encryptFile,
  decryptFile,
  createSecurityService
};
