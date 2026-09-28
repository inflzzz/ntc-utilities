'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CHANNELS, NOTE_COLORS, normalizeDocumentsState, initializeDocumentsService } = require('../src/documents-main.cjs');
const { rtfToHtml } = require('../src/documents-rtf.cjs');

test('document state is bounded and keeps only valid formatting, post-it colors and tabs', () => {
  const state = normalizeDocumentsState({
    activeTab: 'untrusted',
    draft: { title: 'A'.repeat(300), html: 'x'.repeat(32_000_050), fontFamily: 'Comic Sans', fontSize: '999px' },
    notes: [{ id: 'ok', title: 'B'.repeat(200), text: 'C'.repeat(60_000), color: 'javascript:', expanded: true }, null],
    lastPdfPath: 'D'.repeat(5000), lastPdfPage: 0, pdfZoom: 99
  });
  assert.equal(state.activeTab, 'editor');
  assert.equal(state.draft.title.length, 240);
  assert.equal(state.draft.html.length, 32_000_000);
  assert.equal(state.draft.fontFamily, 'Arial');
  assert.equal(state.draft.fontSize, '16px');
  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].color, 'violet');
  assert.equal(state.notes[0].text.length, 50_000);
  assert.equal(state.notes[0].expanded, true);
  assert.equal(state.lastPdfPath.length, 4096);
  assert.equal(state.lastPdfPage, 1);
  assert.equal(state.pdfZoom, 2.5);
  assert.deepEqual(state.pageLayout, { leftMargin: 12, rightMargin: 12, paper: 'A4', orientation: 'portrait' });
});

test('legacy green post-it notes migrate to violet and green is no longer an available note color', () => {
  const state = normalizeDocumentsState({ notes: [{ id: 'legacy-green', color: 'green' }] });
  assert.equal(state.notes[0].color, 'violet');
  assert.equal(NOTE_COLORS.has('green'), false);
});

test('document state preserves every font, size, and page option exposed by the editor', () => {
  const state = normalizeDocumentsState({
    draft: { fontFamily: 'Aptos', fontSize: '72px' },
    pageLayout: { leftMargin: 16, rightMargin: 18, paper: 'Letter', orientation: 'landscape' }
  });
  assert.equal(state.draft.fontFamily, 'Aptos');
  assert.equal(state.draft.fontSize, '72px');
  assert.deepEqual(state.pageLayout, { leftMargin: 16, rightMargin: 18, paper: 'Letter', orientation: 'landscape' });
});

test('documents and last PDF path persist in user data; IPC rejects other senders', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-documents-'));
  const pdfPath = path.join(root, 'exemplo.pdf');
  await fs.writeFile(pdfPath, Buffer.from('%PDF mock content'));
  const handlers = new Map();
  const webContents = {};
  const window = { webContents, isDestroyed: () => false };
  let chosenPath = pdfPath;
  const service = initializeDocumentsService({
    app: { getPath: () => root },
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [chosenPath] }), showSaveDialog: async () => ({ canceled: false, filePath: path.join(root, 'salvo.html') }) },
    getMainWindow: () => window
  });
  const invoke = (channel, sender = webContents, ...args) => handlers.get(channel)({ sender }, ...args);
  try {
    assert.equal(await invoke(CHANNELS.state, {}), null);
    assert.equal(await invoke(CHANNELS.parseRichText, {}), null);
    assert.match(await invoke(CHANNELS.parseRichText, webContents, String.raw`{\rtf1\ansi\b Texto\b0}`), /<strong>Texto<\/strong>/);
    const saved = await invoke(CHANNELS.saveState, webContents, {
      activeTab: 'notes', draft: { title: 'Rascunho', html: '<p>Persistente</p>' },
      notes: [{ id: 'nota-1', title: 'Lembrete', text: 'Não apagar', color: 'blue' }]
    });
    assert.equal(saved.ok, true);

    const opened = await invoke(CHANNELS.openPdf);
    assert.equal(opened.name, 'exemplo.pdf');
    assert.deepEqual([...opened.data], [...Buffer.from('%PDF mock content')]);
    const restored = await invoke(CHANNELS.state);
    assert.equal(restored.activeTab, 'notes');
    assert.equal(restored.draft.title, 'Rascunho');
    assert.equal(restored.notes[0].text, 'Não apagar');
    assert.equal(restored.lastPdfPath, pdfPath);
    assert.equal(restored.lastPdfPage, 1);
    assert.equal(restored.pdfZoom, 1);
    assert.equal((await invoke(CHANNELS.readPdf, webContents, path.join(root, 'nao.pdf'))), null);

    service.writeState({ ...restored, activeTab: 'editor' });
    await fs.writeFile(service.storageFile, '{ dados corrompidos');
    assert.equal(service.readState().lastPdfPath, pdfPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the document editor and PDF reader are separate navigable tools', async () => {
  const [html, preload] = await Promise.all([
    fs.readFile(path.join(__dirname, '..', 'src', 'index.html'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'preload.cjs'), 'utf8')
  ]);
  assert.match(html, /data-view="documents"/);
  assert.match(html, /data-view="pdf"/);
  assert.match(html, /id="documentsView"/);
  assert.match(html, /id="pdfView"/);
  assert.match(html, /data-documents-tab="notes"/);
  assert.match(html, /id="documentFontFamily"/);
  assert.match(html, /id="documentFontSize"/);
  assert.match(html, /id="documentInsertDrawing"/);
  assert.match(html, /id="documentDrawingCanvas"/);
  assert.doesNotMatch(html, /Este espaço poderá receber outras ferramentas para PDF/);
  assert.match(html, /src="\.\/documents-ui\.js"/);
  assert.match(html, /type="module" src="\.\/documents-pdf\.mjs"/);
  assert.match(preload, /parseRichText:\s*content => ipcRenderer\.invoke\('documents-parse-rich-text'/);
  assert.doesNotMatch(preload, /require\(['"]\.\/src\//);
});

test('document formatting has visible selected states and post-it resizing is accessible and animated', async () => {
  const [html, css, ui] = await Promise.all([
    fs.readFile(path.join(__dirname, '..', 'src', 'index.html'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8'),
    fs.readFile(path.join(__dirname, '..', 'src', 'documents-ui.js'), 'utf8')
  ]);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-label="Fonte"/);
  assert.match(html, /aria-label="Tamanho da fonte"/);
  assert.match(css, /\.document-format-toolbar button\.is-active/);
  assert.match(ui, /data-note-expand/);
  assert.match(ui, /duration: 280/);
  assert.match(ui, /prefers-reduced-motion: reduce/);
  assert.match(ui, /Recolher nota/);
});

test('RTF import preserves common WordPad formatting, Unicode, paragraph alignment, and embedded PNG data', () => {
  const source = String.raw`{\rtf1\ansi{\fonttbl{\f0\fnil Arial;}}{\colortbl;\red255\green0\blue0;}\f0\fs24\qc\sl360\slmult1\b Ol\u225?\b0\cf1 vermelho\par {\pict\pngblip89504e470d0a}}`;
  const html = rtfToHtml(source);
  assert.match(html, /text-align:center/);
  assert.match(html, /line-height:1.5/);
  assert.match(html, /<strong>Olá<\/strong>/);
  assert.match(html, /color:#ff0000/);
  assert.match(html, /data:image\/png;base64,/);
});

test('PDF.js can open a local PDF without sending it to a service', async () => {
  const [{ PDFDocument }, pdfjs] = await Promise.all([
    import('pdf-lib'),
    import('pdfjs-dist/legacy/build/pdf.mjs')
  ]);
  const document = await PDFDocument.create();
  document.addPage();
  const bytes = await document.save();
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  assert.equal(pdf.numPages, 1);
  await pdf.destroy();
});

test('text editor opens supported documents and saves through the native dialog', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-document-files-'));
  const source = path.join(root, 'rascunho.md');
  const rtfSource = path.join(root, 'rascunho.rtf');
  await fs.writeFile(source, '# Olá\nTexto local');
  await fs.writeFile(rtfSource, String.raw`{\rtf1\ansi Texto formatado}`);
  const handlers = new Map();
  const webContents = {};
  let openPath = source;
  let savePath = path.join(root, 'saida.html');
  const service = initializeDocumentsService({
    app: { getPath: () => root },
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [openPath] }), showSaveDialog: async () => ({ canceled: false, filePath: savePath }) },
    getMainWindow: () => ({ webContents, isDestroyed: () => false })
  });
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: webContents }, ...args);
  try {
    assert.deepEqual(await invoke(CHANNELS.openText), { name: 'rascunho.md', extension: '.md', content: '# Olá\nTexto local' });
    openPath = rtfSource;
    assert.deepEqual(await invoke(CHANNELS.openText), { name: 'rascunho.rtf', extension: '.rtf', content: String.raw`{\rtf1\ansi Texto formatado}` });
    const result = await invoke(CHANNELS.saveText, { format: 'html', name: 'saída', content: '<p>Documento</p>' });
    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(path.join(root, 'saida.html'), 'utf8'), '<p>Documento</p>');
    savePath = path.join(root, 'saida.rtf');
    const rtfResult = await invoke(CHANNELS.saveText, { format: 'rtf', name: 'saída', content: String.raw`{\rtf1 Documento}` });
    assert.equal(rtfResult.ok, true);
    assert.equal(await fs.readFile(savePath, 'utf8'), String.raw`{\rtf1 Documento}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
