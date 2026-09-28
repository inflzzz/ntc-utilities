'use strict';

const SAFE_FONTS = ['Arial', 'Aptos', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const SAFE_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
const SKIPPED_DESTINATIONS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'generator', 'xmlnstbl', 'listtable', 'listoverridetable', 'header', 'footer', 'object', 'pict', 'themedata', 'datastore']);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function findGroupEnd(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '\\') { index += 1; continue; }
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return index;
  }
  return source.length - 1;
}

function extractDestination(source, name) {
  const marker = `\\${name}`;
  const position = source.indexOf(marker);
  if (position < 0) return '';
  const start = source.lastIndexOf('{', position);
  const end = findGroupEnd(source, start);
  return source.slice(start + 1, end);
}

function rtfTables(source) {
  const fonts = [];
  const fontTable = extractDestination(source, 'fonttbl');
  const fontPattern = /\\f(\d+)[^{};]*?([^{};]+);/g;
  let match;
  while ((match = fontPattern.exec(fontTable))) {
    const name = match[2].replace(/\\[a-z]+-?\d*\s?/gi, '').trim();
    const font = SAFE_FONTS.find(candidate => candidate.toLowerCase() === name.toLowerCase());
    if (font) fonts[Number(match[1])] = font;
  }
  const colorTable = extractDestination(source, 'colortbl');
  const colors = [''];
  for (const entry of colorTable.split(';')) {
    const red = entry.match(/\\red(\d+)/)?.[1];
    const green = entry.match(/\\green(\d+)/)?.[1];
    const blue = entry.match(/\\blue(\d+)/)?.[1];
    if (red !== undefined && green !== undefined && blue !== undefined) {
      colors.push(`#${[red, green, blue].map(value => Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, '0')).join('')}`);
    }
  }
  return { fonts, colors };
}

function nearestFontSize(points) {
  const pixels = Math.max(1, Number(points) * 96 / 72);
  return `${SAFE_SIZES.reduce((best, size) => Math.abs(size - pixels) < Math.abs(best - pixels) ? size : best, SAFE_SIZES[0])}px`;
}

function stateStyle(state, tables) {
  const css = [];
  if (tables.fonts[state.font]) css.push(`font-family:${tables.fonts[state.font]}`);
  if (state.size) css.push(`font-size:${nearestFontSize(state.size / 2)} `);
  if (tables.colors[state.color]) css.push(`color:${tables.colors[state.color]}`);
  if (tables.colors[state.highlight]) css.push(`background-color:${tables.colors[state.highlight]}`);
  if (state.vertical) css.push(`vertical-align:${state.vertical}`);
  return css.length ? ` style="${css.join(';')}"` : '';
}

function paragraphStyle(state) {
  const css = [];
  if (state.align) css.push(`text-align:${state.align}`);
  if (state.left) css.push(`margin-left:${Math.max(-400, Math.min(400, state.left / 15))}px`);
  if (state.right) css.push(`margin-right:${Math.max(-400, Math.min(400, state.right / 15))}px`);
  if (state.first) css.push(`text-indent:${Math.max(-400, Math.min(400, state.first / 15))}px`);
  if (state.line > 0 && state.lineMultiple) {
    const options = [1, 1.15, 1.5, 1.75, 2];
    const ratio = state.line / 240;
    const closest = options.reduce((best, candidate) => Math.abs(candidate - ratio) < Math.abs(best - ratio) ? candidate : best, options[0]);
    if (Math.abs(closest - ratio) <= 0.12) css.push(`line-height:${closest}`);
  }
  return css.length ? ` style="${css.join(';')}"` : '';
}

function styledText(text, state, tables) {
  let result = escapeHtml(text);
  if (state.bold) result = `<strong>${result}</strong>`;
  if (state.italic) result = `<em>${result}</em>`;
  if (state.underline) result = `<u>${result}</u>`;
  if (state.strike) result = `<s>${result}</s>`;
  if (state.vertical === 'sub') result = `<sub>${result}</sub>`;
  else if (state.vertical === 'super') result = `<sup>${result}</sup>`;
  const style = stateStyle(state, tables);
  if (style) result = `<span${style}>${result}</span>`;
  return result;
}

function rtfToHtml(source) {
  const input = String(source || '').slice(0, 64_000_000);
  const tables = rtfTables(input);
  const initial = { bold: false, italic: false, underline: false, strike: false, vertical: '', font: 0, size: 24, color: 0, highlight: 0, align: '', left: 0, right: 0, first: 0, line: 0, lineMultiple: false };
  const stack = [];
  const paragraphs = [];
  let paragraph = [];
  let state = { ...initial };
  const appendText = text => {
    const key = JSON.stringify(state);
    const last = paragraph.at(-1);
    if (last?.type === 'text' && last.key === key) last.text += text;
    else paragraph.push({ type: 'text', text, key, state: { ...state } });
  };
  const appendHtml = html => paragraph.push({ type: 'html', html });
  const flush = () => {
    const content = paragraph.map(token => token.type === 'text' ? styledText(token.text, token.state, tables) : token.html).join('');
    const style = paragraphStyle(state);
    paragraphs.push(`<p${style}>${content || '<br>'}</p>`);
    paragraph = [];
  };
  const emitImage = group => {
    const kind = /\\jpegblip/.test(group) ? 'jpeg' : /\\pngblip/.test(group) ? 'png' : '';
    if (!kind) return;
    const payload = group.replace(/^.*?\\(?:jpegblip|pngblip)/s, '').replace(/\\(?:picw|pich|picwgoal|pichgoal)-?\d+/g, '').replace(/\\[a-z]+-?\d*\s?/gi, '').replace(/[^a-f\d]/gi, '');
    if (!payload || payload.length > 11_200_000 || payload.length % 2) return;
    const dataUrl = `data:image/${kind};base64,${Buffer.from(payload, 'hex').toString('base64')}`;
    appendHtml(`<img src="${dataUrl}" alt="Imagem inserida no documento">`);
  };

  for (let index = 0; index < input.length;) {
    const character = input[index];
    if (character === '{') {
      const groupStart = input.slice(index + 1, index + 100);
      const destination = groupStart.match(/^\\\*?([a-z]+)/i)?.[1]?.toLowerCase();
      if (destination && SKIPPED_DESTINATIONS.has(destination)) {
        const end = findGroupEnd(input, index);
        if (destination === 'pict') emitImage(input.slice(index, end + 1));
        index = end + 1;
        continue;
      }
      stack.push({ ...state });
      index += 1;
      continue;
    }
    if (character === '}') {
      state = stack.pop() || { ...initial };
      index += 1;
      continue;
    }
    if (character !== '\\') {
      if (character === '\r' || character === '\n') { index += 1; continue; }
      appendText(character);
      index += 1;
      continue;
    }
    const next = input[index + 1];
    if (next === '\\' || next === '{' || next === '}') { appendText(next); index += 2; continue; }
    if (next === "'") {
      const byte = Number.parseInt(input.slice(index + 2, index + 4), 16);
      if (Number.isFinite(byte)) appendText(new TextDecoder('windows-1252').decode(Uint8Array.of(byte)));
      index += 4;
      continue;
    }
    if (next === '*') { index += 2; continue; }
    const control = input.slice(index + 1).match(/^([a-z]+)(-?\d+)? ?/i);
    if (!control) {
      if (next === '~') appendText('\u00a0');
      else if (next === '_') appendText('\u2011');
      index += 2;
      continue;
    }
    const word = control[1].toLowerCase();
    const value = control[2] === undefined ? null : Number(control[2]);
    index += control[0].length + 1;
    if (word === 'u' && value !== null) {
      appendText(String.fromCharCode(value < 0 ? value + 65536 : value));
      if (input[index] === '?') index += 1;
      continue;
    }
    if (word === 'uc') continue;
    if (word === 'par') { flush(); continue; }
    if (word === 'line') { appendHtml('<br>'); continue; }
    if (word === 'tab') { appendHtml('&emsp;'); continue; }
    if (word === 'bullet') { appendText('•'); continue; }
    if (word === 'emdash') { appendText('—'); continue; }
    if (word === 'endash') { appendText('–'); continue; }
    if (word === 'lquote') { appendText('‘'); continue; }
    if (word === 'rquote') { appendText('’'); continue; }
    if (word === 'ldblquote') { appendText('“'); continue; }
    if (word === 'rdblquote') { appendText('”'); continue; }
    if (word === 'pard') { state.align = ''; state.left = 0; state.right = 0; state.first = 0; state.line = 0; state.lineMultiple = false; continue; }
    if (word === 'plain') { state.bold = false; state.italic = false; state.underline = false; state.strike = false; state.vertical = ''; state.font = 0; state.size = 24; state.color = 0; state.highlight = 0; continue; }
    if (word === 'b') { state.bold = value === null ? true : value !== 0; continue; }
    if (word === 'i') { state.italic = value === null ? true : value !== 0; continue; }
    if (word === 'ul') { state.underline = true; continue; }
    if (word === 'ulnone' || word === 'ul0') { state.underline = false; continue; }
    if (word === 'strike') { state.strike = value === null ? true : value !== 0; continue; }
    if (word === 'super') { state.vertical = 'super'; continue; }
    if (word === 'sub') { state.vertical = 'sub'; continue; }
    if (word === 'nosupersub') { state.vertical = ''; continue; }
    if (word === 'f' && value !== null) { state.font = value; continue; }
    if (word === 'fs' && value !== null) { state.size = value; continue; }
    if (word === 'cf' && value !== null) { state.color = value; continue; }
    if (word === 'highlight' && value !== null) { state.highlight = value; continue; }
    if (word === 'ql') { state.align = 'left'; continue; }
    if (word === 'qc') { state.align = 'center'; continue; }
    if (word === 'qr') { state.align = 'right'; continue; }
    if (word === 'qj') { state.align = 'justify'; continue; }
    if (word === 'li' && value !== null) { state.left = value; continue; }
    if (word === 'ri' && value !== null) { state.right = value; continue; }
    if (word === 'fi' && value !== null) { state.first = value; }
    if (word === 'sl' && value !== null) { state.line = value; }
    if (word === 'slmult' && value !== null) { state.lineMultiple = value === 1; }
  }
  if (paragraph.length) flush();
  return paragraphs.join('');
}

module.exports = { rtfToHtml };
