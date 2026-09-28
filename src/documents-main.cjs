'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { rtfToHtml } = require('./documents-rtf.cjs');

const CHANNELS = Object.freeze({
  state: 'documents-get-state',
  saveState: 'documents-save-state',
  openText: 'documents-open-text',
  openImage: 'documents-open-image',
  parseRichText: 'documents-parse-rich-text',
  saveText: 'documents-save-text',
  openPdf: 'pdf-open-file',
  readPdf: 'pdf-read-file',
  openPdfs: 'pdf-open-files',
  openImages: 'pdf-open-images',
  savePdf: 'pdf-save-file',
  saveImage: 'pdf-save-image'
});

const NOTE_COLORS = new Set(['yellow', 'pink', 'blue', 'violet']);
const DOCUMENT_FONTS = new Set(['Arial', 'Aptos', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']);
const DOCUMENT_FONT_SIZES = new Set(['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px', '72px']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.html', '.htm', '.rtf']);
const IMAGE_MIME_TYPES = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' });
const MAX_DOCUMENT_HTML_LENGTH = 32_000_000;
const MAX_DOCUMENT_FILE_BYTES = 64 * 1024 * 1024;
const DEFAULT_STATE = Object.freeze({
  version: 1,
  activeTab: 'editor',
  draft: { title: 'Sem título', html: '' },
  notes: [],
  lastPdfPath: '',
  lastPdfPage: 1,
  pdfZoom: 1,
  pageLayout: { leftMargin: 12, rightMargin: 12, paper: 'A4', orientation: 'portrait' }
});

function normalizeNote(note) {
  if (!note || typeof note !== 'object' || Array.isArray(note)) return null;
  const id = String(note.id || '').slice(0, 80);
  if (!id) return null;
  return {
    id,
    title: String(note.title || '').slice(0, 160),
    text: String(note.text || '').slice(0, 50000),
    color: note.color === 'green' ? 'violet' : NOTE_COLORS.has(note.color) ? note.color : 'violet',
    expanded: note.expanded === true,
    updatedAt: Number.isFinite(Number(note.updatedAt)) ? Math.max(0, Number(note.updatedAt)) : Date.now()
  };
}

function normalizeDocumentsState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(DEFAULT_STATE);
  const draft = value.draft && typeof value.draft === 'object' && !Array.isArray(value.draft) ? value.draft : {};
  return {
    version: 1,
    activeTab: ['editor', 'notes'].includes(value.activeTab) ? value.activeTab : 'editor',
    draft: {
      title: String(draft.title || 'Sem título').slice(0, 240),
      html: String(draft.html || '').slice(0, MAX_DOCUMENT_HTML_LENGTH),
      fontFamily: DOCUMENT_FONTS.has(draft.fontFamily) ? draft.fontFamily : 'Arial',
      fontSize: DOCUMENT_FONT_SIZES.has(draft.fontSize) ? draft.fontSize : '16px'
    },
    notes: (Array.isArray(value.notes) ? value.notes : []).slice(0, 200).map(normalizeNote).filter(Boolean),
    lastPdfPath: String(value.lastPdfPath || '').slice(0, 4096),
    lastPdfPage: Number.isSafeInteger(Number(value.lastPdfPage)) ? Math.max(1, Math.min(100_000, Number(value.lastPdfPage))) : 1,
    pdfZoom: Number.isFinite(Number(value.pdfZoom)) ? Math.max(0.5, Math.min(2.5, Number(value.pdfZoom))) : 1,
    pageLayout: {
      leftMargin: Number.isFinite(Number(value.pageLayout?.leftMargin)) ? Math.max(5, Math.min(35, Math.round(Number(value.pageLayout.leftMargin)))) : 12,
      rightMargin: Number.isFinite(Number(value.pageLayout?.rightMargin)) ? Math.max(5, Math.min(35, Math.round(Number(value.pageLayout.rightMargin)))) : 12,
      paper: ['A4', 'Letter', 'Legal'].includes(value.pageLayout?.paper) ? value.pageLayout.paper : 'A4',
      orientation: ['portrait', 'landscape'].includes(value.pageLayout?.orientation) ? value.pageLayout.orientation : 'portrait'
    }
  };
}

function initializeDocumentsService({ app, ipcMain, dialog, getMainWindow, fsImpl = fs, pathImpl = path }) {
  const storageFile = pathImpl.join(app.getPath('userData'), 'ntc-documents-data.json');
  const backupFile = pathImpl.join(app.getPath('userData'), 'ntc-documents-data.backup.json');
  const validSender = event => {
    const window = getMainWindow?.();
    return Boolean(window && !window.isDestroyed?.() && event?.sender === window.webContents);
  };

  function readState() {
    for (const file of [storageFile, backupFile]) {
      try { return normalizeDocumentsState(JSON.parse(fsImpl.readFileSync(file, 'utf8'))); }
      catch { /* Try the recoverable copy before starting with an empty state. */ }
    }
    return structuredClone(DEFAULT_STATE);
  }

  function writeState(value) {
    const state = normalizeDocumentsState(value);
    fsImpl.mkdirSync(pathImpl.dirname(storageFile), { recursive: true });
    const temporary = `${storageFile}.tmp`;
    try {
      normalizeDocumentsState(JSON.parse(fsImpl.readFileSync(storageFile, 'utf8')));
      fsImpl.copyFileSync(storageFile, backupFile);
    } catch { /* Keep the previous backup if the primary file is corrupt. */ }
    fsImpl.writeFileSync(temporary, JSON.stringify(state));
    fsImpl.renameSync(temporary, storageFile);
    return state;
  }

  function selectedTextFile(filePath) {
    const resolved = pathImpl.resolve(String(filePath || ''));
    const extension = pathImpl.extname(resolved).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) throw new Error('Escolha um arquivo TXT, MD, HTML ou RTF.');
    const stat = fsImpl.statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_DOCUMENT_FILE_BYTES) throw new Error('O arquivo de texto precisa ter até 64 MB.');
    return { resolved, extension };
  }

  function selectedPdf(filePath) {
    const resolved = pathImpl.resolve(String(filePath || ''));
    if (pathImpl.extname(resolved).toLowerCase() !== '.pdf') throw new Error('Escolha um arquivo PDF válido.');
    const stat = fsImpl.statSync(resolved);
    if (!stat.isFile() || stat.size > 500 * 1024 * 1024) throw new Error('O arquivo PDF excede o limite de 500 MB.');
    return { resolved, stat };
  }

  function selectedImage(filePath) {
    const resolved = pathImpl.resolve(String(filePath || ''));
    const extension = pathImpl.extname(resolved).toLowerCase();
    if (!Object.hasOwn(IMAGE_MIME_TYPES, extension)) throw new Error('Escolha uma imagem PNG ou JPG.');
    const stat = fsImpl.statSync(resolved);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('A imagem precisa ter até 4 MB.');
    return { resolved, extension, stat };
  }

  async function readPdf(filePath) {
    const { resolved, stat } = selectedPdf(filePath);
    const data = await fsImpl.promises.readFile(resolved);
    return { name: pathImpl.basename(resolved), path: resolved, size: stat.size, data: new Uint8Array(data) };
  }

  ipcMain.handle(CHANNELS.state, event => validSender(event) ? readState() : null);
  ipcMain.handle(CHANNELS.saveState, (event, value) => {
    if (!validSender(event)) return { ok: false, error: 'Origem não autorizada.' };
    try { return { ok: true, state: writeState(value) }; }
    catch { return { ok: false, error: 'Não foi possível salvar os documentos e as notas.' }; }
  });
  ipcMain.handle(CHANNELS.openText, async event => {
    if (!validSender(event)) return null;
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Abrir documento',
      properties: ['openFile'],
      filters: [{ name: 'Documentos de texto', extensions: ['txt', 'md', 'html', 'htm', 'rtf'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const { resolved, extension } = selectedTextFile(result.filePaths[0]);
    const content = fsImpl.readFileSync(resolved, 'utf8');
    return { name: pathImpl.basename(resolved), extension, content };
  });
  ipcMain.handle(CHANNELS.openImage, async event => {
    if (!validSender(event)) return null;
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Inserir imagem', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const image = selectedImage(result.filePaths[0]);
      const data = fsImpl.readFileSync(image.resolved);
      return { name: pathImpl.basename(image.resolved), mimeType: IMAGE_MIME_TYPES[image.extension], dataUrl: `data:${IMAGE_MIME_TYPES[image.extension]};base64,${data.toString('base64')}` };
    } catch (error) { return { error: error.message || 'Não foi possível abrir essa imagem.' }; }
  });
  ipcMain.handle(CHANNELS.parseRichText, (event, content) => {
    if (!validSender(event) || typeof content !== 'string' || content.length > 64_000_000) return null;
    try { return rtfToHtml(content); } catch { return null; }
  });
  ipcMain.handle(CHANNELS.saveText, async (event, payload = {}) => {
    if (!validSender(event)) return { ok: false, error: 'Origem não autorizada.' };
    const format = ['html', 'rtf', 'txt', 'md'].includes(payload.format) ? payload.format : 'html';
    const filters = { html: ['html', 'htm'], rtf: ['rtf'], txt: ['txt'], md: ['md'] };
    const name = String(payload.name || 'Documento').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 120) || 'Documento';
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: 'Salvar documento',
      defaultPath: `${name}.${format}`,
      filters: [{ name: format === 'html' ? 'Documento HTML' : format === 'rtf' ? 'Rich Text Format' : format === 'md' ? 'Markdown' : 'Texto simples', extensions: filters[format] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      const content = String(payload.content || '').slice(0, MAX_DOCUMENT_FILE_BYTES);
      fsImpl.writeFileSync(result.filePath, content, 'utf8');
      return { ok: true, name: pathImpl.basename(result.filePath), path: result.filePath };
    } catch { return { ok: false, error: 'Não foi possível salvar o documento.' }; }
  });
  ipcMain.handle(CHANNELS.openPdf, async event => {
    if (!validSender(event)) return null;
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Abrir PDF', properties: ['openFile'], filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const pdf = await readPdf(result.filePaths[0]);
    const state = readState();
    state.lastPdfPath = pdf.path;
    state.lastPdfPage = 1;
    state.pdfZoom = 1;
    writeState(state);
    return pdf;
  });
  ipcMain.handle(CHANNELS.readPdf, async (event, filePath) => {
    if (!validSender(event) || typeof filePath !== 'string') return null;
    try { return await readPdf(filePath); } catch { return null; }
  });
  ipcMain.handle(CHANNELS.openPdfs, async event => {
    if (!validSender(event)) return null;
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Selecionar PDFs para combinar', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePaths.length) return [];
    if (result.filePaths.length > 50) throw new Error('Selecione até 50 PDFs por combinação.');
    const files = [];
    let totalBytes = 0;
    for (const filePath of result.filePaths) {
      const pdf = await readPdf(filePath);
      totalBytes += pdf.size;
      if (totalBytes > 500 * 1024 * 1024) throw new Error('O tamanho total dos PDFs excede 500 MB.');
      files.push(pdf);
    }
    return files;
  });
  ipcMain.handle(CHANNELS.openImages, async event => {
    if (!validSender(event)) return null;
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Selecionar imagens para criar um PDF', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imagens PNG e JPEG', extensions: ['png', 'jpg', 'jpeg'] }]
    });
    if (result.canceled || !result.filePaths.length) return [];
    if (result.filePaths.length > 50) throw new Error('Selecione até 50 imagens por operação.');
    const images = [];
    let totalBytes = 0;
    for (const filePath of result.filePaths) {
      const image = selectedImage(filePath);
      totalBytes += image.stat.size;
      if (totalBytes > 100 * 1024 * 1024) throw new Error('O tamanho total das imagens excede 100 MB.');
      images.push({ name: pathImpl.basename(image.resolved), mimeType: IMAGE_MIME_TYPES[image.extension], data: new Uint8Array(fsImpl.readFileSync(image.resolved)) });
    }
    return images;
  });
  ipcMain.handle(CHANNELS.savePdf, async (event, payload = {}) => {
    if (!validSender(event)) return { ok: false, error: 'Origem não autorizada.' };
    try {
      const data = payload.data instanceof ArrayBuffer
        ? Buffer.from(payload.data)
        : ArrayBuffer.isView(payload.data)
          ? Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength)
          : null;
      if (!data?.length || data.length > 500 * 1024 * 1024 || !data.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
        return { ok: false, error: 'O conteúdo não é um PDF válido ou excede 500 MB.' };
      }
      const safeName = String(payload.name || 'Documento').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 120) || 'Documento';
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Salvar PDF', defaultPath: `${safeName}.pdf`,
        filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const outputPath = pathImpl.extname(result.filePath).toLowerCase() === '.pdf' ? result.filePath : `${result.filePath}.pdf`;
      fsImpl.writeFileSync(outputPath, data);
      return { ok: true, name: pathImpl.basename(outputPath), path: outputPath };
    } catch (error) { return { ok: false, error: error.message || 'Não foi possível salvar o PDF.' }; }
  });
  ipcMain.handle(CHANNELS.saveImage, async (event, payload = {}) => {
    if (!validSender(event)) return { ok: false, error: 'Origem não autorizada.' };
    try {
      const dataUrl = String(payload.dataUrl || '');
      if (!dataUrl.startsWith('data:image/png;base64,')) return { ok: false, error: 'A imagem PNG não é válida.' };
      const data = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
      if (data.length < 8 || data.length > 100 * 1024 * 1024 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return { ok: false, error: 'A imagem PNG excede 100 MB ou está corrompida.' };
      }
      const safeName = pathImpl.basename(String(payload.name || 'pagina')).slice(0, 120) || 'pagina';
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Salvar página como imagem', defaultPath: safeName + '.png',
        filters: [{ name: 'Imagem PNG', extensions: ['png'] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const outputPath = pathImpl.extname(result.filePath).toLowerCase() === '.png' ? result.filePath : result.filePath + '.png';
      fsImpl.writeFileSync(outputPath, data);
      return { ok: true, name: pathImpl.basename(outputPath), path: outputPath };
    } catch (error) { return { ok: false, error: error.message || 'Não foi possível salvar a imagem.' }; }
  });

  return { readState, writeState, readPdf, storageFile };
}

module.exports = { CHANNELS, DEFAULT_STATE, NOTE_COLORS, DOCUMENT_FONTS, DOCUMENT_FONT_SIZES, normalizeDocumentsState, initializeDocumentsService };
