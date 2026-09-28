// Isolated renderer test with synthetic clipboard items; never reads the real clipboard.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(os.tmpdir(), 'ntc-ui-clipboard-audit');
app.setPath('userData', path.join(os.tmpdir(), `ntc-clipboard-audit-${process.pid}`));
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /\.m?js(?:\?|$)/i.test(details.url) }));
  await fs.mkdir(output, { recursive: true });
  const window = new BrowserWindow({ show: false, width: 1366, height: 768, webPreferences: { sandbox: true, contextIsolation: true } });
  await window.loadFile(path.join(root, 'src', 'index.html'));
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('.app-shell').classList.add('ready');
    document.querySelector('.splash').classList.add('hidden');
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === 'clipboardHistoryView'));
    const svg = (width, height, color) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="' + color + '"/><circle cx="50%" cy="50%" r="20" fill="#fff"/></svg>');
    const now = Date.now();
    const records = [
      { id: 'text', kind: 'text', textPreview: 'Um trecho de texto copiado para reutilizar em outro aplicativo.', hasImage: false, sizeBytes: 63 },
      { id: 'link', kind: 'text', textPreview: 'https://exemplo.com/um-link', hasImage: false, sizeBytes: 30 },
      { id: 'landscape', kind: 'image', textPreview: '', hasImage: true, sizeBytes: 2048 },
      { id: 'portrait', kind: 'image', textPreview: '', hasImage: true, sizeBytes: 2048 },
      { id: 'mixed', kind: 'mixed', textPreview: 'Legenda da captura de tela', hasImage: true, sizeBytes: 4096 },
      { id: 'long', kind: 'text', textPreview: 'Texto longo '.repeat(55), hasImage: false, sizeBytes: 550 }
    ].map((item, index) => ({ ...item, createdAt: now - index * 3600000, pinned: false }));
    const images = { landscape: svg(1200, 600, '#633d5a'), portrait: svg(480, 1000, '#4c685e'), mixed: svg(4000, 4000, '#545267') };
    window.__audit = { records, images, copied: [], toasts: [] };
    window.ntc = {
      getClipboardHistoryState: async () => ({ supported: true, listenerReady: true, count: records.length, usedBytes: 9000, settings: { quotaBytes: 262144000, retentionDays: 30 } }),
      listClipboardHistory: async ({ filter, query, offset, limit }) => {
        const matched = records.filter(item => (!query || item.textPreview.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || filter === 'pinned' ? filter !== 'pinned' || item.pinned : filter === 'image' ? item.hasImage : item.kind === 'text'));
        return { items: matched.slice(offset, offset + limit), total: matched.length, hasMore: offset + limit < matched.length };
      },
      thumbnailClipboardHistoryItem: async id => ({ imageDataUrl: images[id] || '' }),
      previewClipboardHistoryItem: async id => ({ text: records.find(item => item.id === id)?.textPreview || '', hasMoreText: false, imageDataUrl: images[id] || '' }),
      copyClipboardHistoryItem: async id => (window.__audit.copied.push(id), { ok: true }),
      pinClipboardHistoryItem: async (id, pinned) => { const item = records.find(item => item.id === id); if (item) item.pinned = pinned; return { ok: true }; },
      deleteClipboardHistoryItem: async id => { const index = records.findIndex(item => item.id === id); if (index >= 0) records.splice(index, 1); return { ok: true }; },
      clearClipboardHistory: async () => { records.length = 0; return { ok: true }; },
      saveClipboardHistorySettings: async value => ({ ok: true, settings: value }),
      onClipboardHistoryStatus: () => {}, onClipboardHistoryChanged: () => {}
    };
  })()`);
  await window.webContents.executeJavaScript(await fs.readFile(path.join(root, 'src', 'clipboard-history-ui.js'), 'utf8'));
  await window.webContents.executeJavaScript(`window.ntcClipboardHistoryUi.initialize({ showToast: value => window.__audit.toasts.push(value), confirmAction: async () => true })`);
  await new Promise(resolve => setTimeout(resolve, 250));
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(output, 'clipboard-list.png'), (await window.webContents.capturePage()).toPNG());
  const report = await window.webContents.executeJavaScript(`(() => {
    const list = document.querySelector('#clipboardHistoryList');
    const initial = { items: list.querySelectorAll('.clipboard-item').length,
      thumbnails: list.querySelectorAll('.clipboard-thumbnail img').length,
      textVisible: list.textContent.includes('Um trecho de texto'),
      linkVisible: list.textContent.includes('Link copiado'),
      scrollWidth: document.querySelector('.content-scroll').scrollWidth,
      clientWidth: document.querySelector('.content-scroll').clientWidth };
    list.querySelector('[data-clipboard-action="copy"][data-id="text"]').click();
    list.querySelector('[data-clipboard-action="preview"][data-id="landscape"]').click();
    return { initial };
  })()`);
  await new Promise(resolve => setTimeout(resolve, 150));
  report.actions = await window.webContents.executeJavaScript(`(() => { const image = document.getElementById('clipboardPreviewImage'); return { copied: window.__audit.copied, previewVisible: !document.getElementById('clipboardPreviewDialog').classList.contains('hidden'), previewImage: image.hasAttribute('src'), previewSize: [image.naturalWidth, image.naturalHeight], thumbnailSizes: [...document.querySelectorAll('#clipboardHistoryList .clipboard-thumbnail img')].map(item => [item.naturalWidth, item.naturalHeight]) }; })()`);
  await window.webContents.executeJavaScript(`window.ntcClipboardHistoryUi.closePreview(); document.querySelector('.content-scroll').scrollTop = 1000`);
  await new Promise(resolve => setTimeout(resolve, 250));
  report.afterScroll = await window.webContents.executeJavaScript(`({ thumbnails: document.querySelectorAll('#clipboardHistoryList .clipboard-thumbnail img').length })`);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(output, 'clipboard-items.png'), (await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.equal(report.initial.items, 6);
  assert.ok(report.initial.thumbnails >= 2);
  assert.equal(report.initial.textVisible, true);
  assert.equal(report.initial.linkVisible, true);
  assert.equal(report.initial.scrollWidth, report.initial.clientWidth);
  assert.deepEqual(report.actions.copied, ['text']);
  assert.equal(report.actions.previewVisible, true);
  assert.equal(report.actions.previewImage, true);
  assert.deepEqual(report.actions.previewSize, [1200, 600]);
  assert.ok(report.actions.thumbnailSizes.some(([width, height]) => width === 1200 && height === 600));
  assert.ok(report.afterScroll.thumbnails >= 3);
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
