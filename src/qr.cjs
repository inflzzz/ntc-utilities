const QRCode = require('qrcode');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({ format: 'png', size: 512, foreground: '#111111', background: '#ffffff' });
const MIN_SIZE = 128;
const MAX_SIZE = 4096;

function normalizeQrUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Digite um link para gerar o QR Code.');
  const webProtocol = /^https?:\/\//i.test(raw);
  const hostWithPort = /^[^/:\s]+:\d+(?:[/?#]|$)/.test(raw);
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !webProtocol && !hostWithPort) throw new Error('Use um link que comece com http:// ou https://.');
  const candidate = webProtocol ? raw : `https://${raw}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('Este link não é válido. Confira o endereço e tente novamente.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('Use um link que comece com http:// ou https://.');
  return url.href;
}

function normalizeQrOptions(value = {}) {
  const format = ['png', 'svg'].includes(String(value.format || '').toLowerCase()) ? String(value.format).toLowerCase() : DEFAULTS.format;
  const size = Number(value.size ?? DEFAULTS.size);
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) throw new Error(`O tamanho deve ficar entre ${MIN_SIZE} e ${MAX_SIZE} px.`);
  const foreground = /^#[\da-f]{6}$/i.test(value.foreground || '') ? value.foreground : DEFAULTS.foreground;
  const background = /^#[\da-f]{6}$/i.test(value.background || '') ? value.background : DEFAULTS.background;
  return { format, size, foreground, background };
}

async function renderQr(value, options = {}) {
  const text = normalizeQrUrl(value);
  const settings = normalizeQrOptions(options);
  const qrOptions = {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: settings.size,
    color: { dark: `${settings.foreground}ff`, light: `${settings.background}ff` }
  };
  try {
    if (settings.format === 'svg') {
      const svg = await QRCode.toString(text, { ...qrOptions, type: 'svg' });
      return { text, ...settings, mime: 'image/svg+xml', buffer: Buffer.from(svg), dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
    }
    const buffer = await QRCode.toBuffer(text, { ...qrOptions, type: 'png' });
    return { text, ...settings, mime: 'image/png', buffer, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch (error) {
    if (/too big|amount of data|capacity/i.test(error.message)) throw new Error('Este link é longo demais para caber em um QR Code. Use um link menor.');
    throw error;
  }
}

function safeQrFilename(value, extension) {
  const base = String(value || 'qr-code').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/, '').slice(0, 120) || 'qr-code';
  return `${base}.${extension}`;
}

async function saveQrImage(payload = {}) {
  const url = normalizeQrUrl(payload.url);
  const options = normalizeQrOptions(payload);
  const folder = path.resolve(String(payload.folder || ''));
  if (!payload.folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('A pasta de destino não existe. Escolha outra pasta.');
  const requestedName = safeQrFilename(payload.name, options.format);
  let filename = requestedName;
  if (payload.duplicate !== 'overwrite') {
    const extension = path.extname(requestedName);
    const stem = path.basename(requestedName, extension);
    let index = 1;
    while (fs.existsSync(path.join(folder, filename))) filename = `${stem} (${index++})${extension}`;
  }
  const result = await renderQr(url, options);
  const extension = path.extname(requestedName);
  const stem = path.basename(requestedName, extension);
  let collisionIndex = 1;
  let file;
  while (true) {
    file = path.join(folder, filename);
    try { await fs.promises.writeFile(file, result.buffer, { flag: payload.duplicate === 'overwrite' ? 'w' : 'wx' }); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || payload.duplicate === 'overwrite') throw error;
      filename = `${stem} (${collisionIndex++})${extension}`;
    }
  }
  return { file, filename, url, format: options.format, size: result.buffer.length, pixelSize: options.size };
}

module.exports = { DEFAULTS, MIN_SIZE, MAX_SIZE, normalizeQrUrl, normalizeQrOptions, renderQr, saveQrImage };
