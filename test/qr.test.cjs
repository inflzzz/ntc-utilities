const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jsQR = require('jsqr');
const sharp = require('sharp');
const { normalizeQrUrl, normalizeQrOptions, renderQr, saveQrImage } = require('../src/qr.cjs');

test('adds https to a bare URL and preserves its query and unicode path', () => {
  assert.equal(normalizeQrUrl('example.com/ação?x=1&y=dois'), 'https://example.com/a%C3%A7%C3%A3o?x=1&y=dois');
  assert.equal(normalizeQrUrl('localhost:3000/qr'), 'https://localhost:3000/qr');
});

test('accepts only web URLs and rejects unsupported protocols', () => {
  assert.throws(() => normalizeQrUrl('javascript:alert(1)'), /http/);
  assert.throws(() => normalizeQrUrl(''), /Digite um link/);
});

test('constrains output size and validates formats', () => {
  assert.throws(() => normalizeQrOptions({ size: 64 }), /entre 128 e 4096/);
  assert.equal(normalizeQrOptions({ format: 'pdf' }).format, 'png');
  assert.equal(normalizeQrOptions({ size: 700 }).size, 700);
});

test('reports an actionable message for links exceeding QR capacity', async () => {
  await assert.rejects(renderQr(`https://example.com/${'x'.repeat(5000)}`), /link é longo demais/i);
});

for (const format of ['png', 'svg']) {
  test(`generated ${format.toUpperCase()} QR decodes to the original URL`, async () => {
    const url = 'https://example.com/qr?campaign=ntc&name=olá';
    const result = await renderQr(url, { format, size: 512, foreground: '#163a59', background: '#f7eecb' });
    const png = format === 'svg' ? await sharp(result.buffer).png().toBuffer() : result.buffer;
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 512);
    assert.equal(info.height, 512);
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    assert.ok(decoded, 'QR must be readable after rasterizing');
    assert.equal(decoded.data, normalizeQrUrl(url));
    assert.match(result.dataUrl, format === 'svg' ? /^data:image\/svg\+xml;base64,/ : /^data:image\/png;base64,/);
  });
}

test('QR generator and its independent history tab are wired into the app', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.match(html, /data-view="qrGenerator"/);
  assert.match(html, /data-open-tool="qrGenerator"/);
  assert.match(html, /id="qrHistoryTab"/);
  assert.match(html, /id="qrHistoryList"/);
  assert.match(app, /ntc-qr-history/);
  assert.match(app, /ntc-history/);
  assert.match(app, /function renderQrHistory\(\)/);
});

test('live preview bytes match files saved with the same settings', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-qr-preview-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const format of ['png', 'svg']) {
    const settings = { format, size: 384, foreground: '#26364a', background: '#fff8e9' };
    const preview = await renderQr('https://example.com/preview', settings);
    const saved = await saveQrImage({ ...settings, url: 'https://example.com/preview', folder, name: `preview-${format}` });
    assert.deepEqual(fs.readFileSync(saved.file), preview.buffer);
  }
});

test('saves PNG and SVG files, applies duplicate names, and supports overwrite', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-qr-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const first = await saveQrImage({ url: 'https://example.com', folder, name: 'site', format: 'png', size: 256 });
  const duplicate = await saveQrImage({ url: 'https://example.org', folder, name: 'site', format: 'png', size: 256 });
  const overwrite = await saveQrImage({ url: 'https://example.net', folder, name: 'site', format: 'png', size: 256, duplicate: 'overwrite' });
  const svg = await saveQrImage({ url: 'https://example.com', folder, name: 'vector', format: 'svg', size: 320 });
  assert.equal(first.filename, 'site.png');
  assert.equal(duplicate.filename, 'site (1).png');
  assert.equal(overwrite.filename, 'site.png');
  assert.equal(svg.filename, 'vector.svg');
  assert.equal((await sharp(svg.file).metadata()).format, 'svg');
  assert.equal((await sharp(first.file).metadata()).format, 'png');
});
