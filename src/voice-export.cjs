const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function saveVoiceAudio(payload, { dialog, window, runFfmpeg }) {
  const format = String(payload?.format || '').toLowerCase();
  if (!['wav', 'mp3', 'flac', 'opus'].includes(format)) throw new Error('Formato de saída inválido.');
  const bytes = Buffer.from(payload?.wav || []);
  if (bytes.length < 44 || bytes.length > 250_000_000 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Áudio WAV inválido ou grande demais.');
  const name = String(payload?.name || 'voz-modificada').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
  const selection = await dialog.showSaveDialog(window, { title: 'Exportar voz modificada', defaultPath: `${name}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
  if (selection.canceled || !selection.filePath) return { canceled: true };
  const destination = path.resolve(selection.filePath);
  if (path.extname(destination).toLowerCase() !== `.${format}`) throw new Error(`O arquivo deve terminar em .${format}.`);
  if (payload?.sourcePath && destination.toLowerCase() === path.resolve(String(payload.sourcePath)).toLowerCase()) throw new Error('Escolha outro nome: o arquivo original não pode ser sobrescrito.');
  const temporary = path.join(path.dirname(destination), `.ntc-voice-${randomUUID()}.${format}`);
  const temporaryInput = format === 'wav' ? null : path.join(path.dirname(destination), `.ntc-voice-${randomUUID()}.wav`);
  try {
    if (format === 'wav') await fs.promises.writeFile(temporary, bytes);
    else {
      await fs.promises.writeFile(temporaryInput, bytes);
      const codec = format === 'mp3' ? ['-codec:a', 'libmp3lame', '-q:a', '3'] : format === 'opus' ? ['-codec:a', 'libopus', '-b:a', '128k'] : ['-codec:a', 'flac'];
      await runFfmpeg(['-v', 'error', '-y', '-i', temporaryInput, ...codec, temporary]);
    }
    await fs.promises.copyFile(temporary, destination);
    return { file: destination };
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    if (temporaryInput) await fs.promises.rm(temporaryInput, { force: true }).catch(() => {});
  }
}
module.exports = { saveVoiceAudio };
