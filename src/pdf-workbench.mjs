const pdfLibrary = () => import('../node_modules/pdf-lib/dist/pdf-lib.esm.js');

export function parsePdfPageSelection(input, pageCount, { allowRepeated = false, allowEmpty = true } = {}) {
  const raw = String(input || '').trim();
  if (!raw) {
    if (!allowEmpty) throw new Error('Informe a ordem das páginas.');
    return Array.from({ length: pageCount }, (_value, index) => index);
  }
  const selected = [];
  const seen = new Set();
  for (const part of raw.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Use números separados por vírgula ou intervalos, como 1, 3-5.');
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > pageCount) throw new Error('Escolha páginas entre 1 e ' + pageCount + '.');
    for (let number = start; number <= end; number++) {
      const index = number - 1;
      if (allowRepeated || !seen.has(index)) selected.push(index);
      seen.add(index);
    }
  }
  if (!selected.length) throw new Error('Selecione pelo menos uma página.');
  return selected;
}

async function loadDocument(bytes) {
  const { PDFDocument } = await pdfLibrary();
  return PDFDocument.load(bytes, { updateMetadata: false });
}

async function saveDocument(document) {
  return new Uint8Array(await document.save());
}

async function copyDocumentInfo(source, target) {
  const values = [
    ['getTitle', 'setTitle'],
    ['getAuthor', 'setAuthor'],
    ['getSubject', 'setSubject'],
    ['getCreator', 'setCreator'],
    ['getProducer', 'setProducer']
  ];
  for (const [read, write] of values) {
    const value = source[read]();
    if (value) target[write](value);
  }
  const keywords = source.getKeywords();
  if (keywords?.trim()) target.setKeywords(keywords.split(/[;,]/).map(value => value.trim()).filter(Boolean));
}

export async function rebuildPdfPages(bytes, indices) {
  const { PDFDocument } = await pdfLibrary();
  const source = await loadDocument(bytes);
  if (!indices.length) throw new Error('O documento precisa manter pelo menos uma página.');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, indices);
  pages.forEach(page => output.addPage(page));
  await copyDocumentInfo(source, output);
  return saveDocument(output);
}

export async function rotatePdfPages(bytes, indices, amount) {
  const { degrees } = await pdfLibrary();
  const document = await loadDocument(bytes);
  const pages = document.getPages();
  for (const index of indices) {
    const current = pages[index].getRotation().angle;
    pages[index].setRotation(degrees((current + amount + 360) % 360));
  }
  return saveDocument(document);
}

export async function deletePdfPages(bytes, indices) {
  const document = await loadDocument(bytes);
  if (indices.length >= document.getPageCount()) throw new Error('O PDF precisa manter pelo menos uma página.');
  for (const index of [...indices].sort((a, b) => b - a)) document.removePage(index);
  return saveDocument(document);
}

export async function extractPdfPages(bytes, indices) {
  return rebuildPdfPages(bytes, indices);
}

export async function mergePdfFiles(files) {
  const { PDFDocument } = await pdfLibrary();
  if (files.length < 2) throw new Error('Selecione pelo menos dois PDFs para combinar.');
  const output = await PDFDocument.create();
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const source = await loadDocument(files[fileIndex].data);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
    if (fileIndex === 0) await copyDocumentInfo(source, output);
  }
  return saveDocument(output);
}

export async function insertBlankPdfPage(bytes, afterPageIndex = null) {
  const document = await loadDocument(bytes);
  const pages = document.getPages();
  const insertionIndex = Number.isInteger(afterPageIndex)
    ? Math.max(0, Math.min(pages.length, afterPageIndex + 1))
    : pages.length;
  const referencePage = pages[Math.max(0, Math.min(pages.length - 1, insertionIndex - 1))] || pages.at(-1);
  const [width, height] = referencePage ? referencePage.getSize() : [595.28, 841.89];
  document.insertPage(insertionIndex, [width, height]);
  return saveDocument(document);
}

export async function addPdfWatermark(bytes, indices, { text, opacity, angle }) {
  const { StandardFonts, degrees, rgb } = await pdfLibrary();
  const document = await loadDocument(bytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const color = rgb(0.58, 0.58, 0.58);
  for (const index of indices) {
    const page = document.getPage(index);
    const { width, height } = page.getSize();
    const size = Math.min(58, Math.max(26, width / 12));
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, {
      x: Math.max(24, (width - textWidth) / 2),
      y: height / 2,
      size,
      font,
      color,
      opacity,
      rotate: degrees(angle)
    });
  }
  return saveDocument(document);
}

export async function addPdfPageNumbers(bytes, { format, start }) {
  const { StandardFonts, rgb } = await pdfLibrary();
  const document = await loadDocument(bytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const total = document.getPageCount();
  for (let index = 0; index < total; index++) {
    const page = document.getPage(index);
    const { width } = page.getSize();
    const label = format.replaceAll('{n}', String(start + index)).replaceAll('{total}', String(total));
    const size = 10;
    const textWidth = font.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: (width - textWidth) / 2,
      y: 24,
      size,
      font,
      color: rgb(0.35, 0.35, 0.35)
    });
  }
  return saveDocument(document);
}

export async function addPdfText(bytes, pageIndex, { text, size, color }) {
  const { StandardFonts, rgb } = await pdfLibrary();
  const document = await loadDocument(bytes);
  const page = document.getPage(pageIndex);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const { height } = page.getSize();
  const hex = color.replace('#', '');
  page.drawText(text, {
    x: 48,
    y: Math.max(42, height - 58),
    size,
    font,
    color: rgb(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255
    )
  });
  return saveDocument(document);
}

export async function addPdfSignature(bytes, pageIndex, pngDataUrl) {
  const { PDFDocument } = await pdfLibrary();
  const document = await loadDocument(bytes);
  const page = document.getPage(pageIndex);
  const image = await document.embedPng(pngDataUrl);
  const { width, height } = page.getSize();
  const scale = Math.min(1, 190 / image.width, 62 / image.height);
  const imageWidth = image.width * scale;
  const imageHeight = image.height * scale;
  page.drawImage(image, {
    x: Math.max(32, width - imageWidth - 48),
    y: 38,
    width: imageWidth,
    height: imageHeight
  });
  return saveDocument(document);
}

export async function updatePdfMetadata(bytes, values) {
  const document = await loadDocument(bytes);
  document.setTitle(values.title.slice(0, 300));
  document.setAuthor(values.author.slice(0, 300));
  document.setSubject(values.subject.slice(0, 500));
  document.setKeywords(values.keywords.split(/[;,]/).map(value => value.trim()).filter(Boolean).slice(0, 50));
  return saveDocument(document);
}

export async function clearPdfMetadata(bytes) {
  const { PDFName } = await pdfLibrary();
  const document = await loadDocument(bytes);
  document.context.trailerInfo.Info = undefined;
  document.catalog.delete(PDFName.of('Metadata'));
  return saveDocument(document);
}

export async function createPdfFromImages(images, paperName = 'A4') {
  const { PDFDocument, rgb } = await pdfLibrary();
  const dimensions = {
    A4: [595.28, 841.89],
    Letter: [612, 792],
    Legal: [612, 1008]
  };
  const document = await PDFDocument.create();
  for (const image of images) {
    const embedded = image.mimeType === 'image/png'
      ? await document.embedPng(image.data)
      : await document.embedJpg(image.data);
    const [pageWidth, pageHeight] = dimensions[paperName] || dimensions.A4;
    const scale = Math.min((pageWidth - 64) / embedded.width, (pageHeight - 64) / embedded.height, 1);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    const page = document.addPage([pageWidth, pageHeight]);
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: rgb(1, 1, 1) });
    page.drawImage(embedded, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
  }
  return saveDocument(document);
}

export async function createPdfFromText(text, paperName = 'A4', fontSize = 12) {
  const { PDFDocument, StandardFonts, rgb } = await pdfLibrary();
  const dimensions = {
    A4: [595.28, 841.89],
    Letter: [612, 792],
    Legal: [612, 1008]
  };
  const [pageWidth, pageHeight] = dimensions[paperName] || dimensions.A4;
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const size = Math.max(8, Math.min(36, fontSize));
  const margin = 52;
  const lineHeight = size * 1.5;
  const maxWidth = pageWidth - margin * 2;
  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const addLine = line => {
    if (y < margin) {
      page = document.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line, { x: margin, y, size, font, color: rgb(0.12, 0.12, 0.12), maxWidth });
    y -= lineHeight;
  };
  for (const paragraph of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!paragraph.trim()) { y -= lineHeight; continue; }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && font.widthOfTextAtSize(next, size) > maxWidth) {
        addLine(line);
        line = word;
      } else line = next;
    }
    if (line) addLine(line);
    y -= lineHeight * 0.35;
  }
  return saveDocument(document);
}
