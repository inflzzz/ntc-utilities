'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const allowedTags = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUB', 'SUP', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'H2', 'H3', 'BLOCKQUOTE', 'IMG']);
  const fontFamilies = ['Arial', 'Aptos', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  const fontSizes = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px', '72px'];
  const noteColors = ['yellow', 'pink', 'blue', 'violet'];
  let state = { version: 1, activeTab: 'editor', draft: { title: 'Sem título', html: '', fontFamily: 'Arial', fontSize: '16px' }, notes: [], lastPdfPath: '', pageLayout: { leftMargin: 12, rightMargin: 12, paper: 'A4', orientation: 'portrait' } };
  let saveTimer = null;
  let draggedNoteId = '';
  let savedRange = null;
  let findCursor = 0;
  let initialized = false;

  function safeColor(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
    const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/);
    if (rgb) return `#${rgb.slice(1, 4).map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0')).join('')}`;
    return ['black', 'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'grey', 'transparent'].includes(raw) ? raw : '';
  }

  function safeStyle(element) {
    const familyValue = element.style.fontFamily.replace(/["']/g, '').trim().toLowerCase();
    const family = fontFamilies.find(value => value.toLowerCase() === familyValue);
    const size = fontSizes.includes(element.style.fontSize.trim()) ? element.style.fontSize.trim() : '';
    const numberStyle = property => {
      const match = element.style[property].trim().match(/^(-?\d{1,3})px$/);
      return match ? `${Math.max(-400, Math.min(400, Number(match[1])))}px` : '';
    };
    const alignment = ['left', 'center', 'right', 'justify'].includes(element.style.textAlign) ? element.style.textAlign : '';
    const lineHeight = ['1', '1.15', '1.5', '1.75', '2'].includes(element.style.lineHeight.trim()) ? element.style.lineHeight.trim() : '';
    const verticalAlign = ['sub', 'super'].includes(element.style.verticalAlign) ? element.style.verticalAlign : '';
    const listStyleType = ['disc', 'circle', 'square', 'decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'].includes(element.style.listStyleType) ? element.style.listStyleType : '';
    return {
      family, size,
      color: safeColor(element.style.color),
      backgroundColor: safeColor(element.style.backgroundColor),
      textAlign: alignment,
      marginLeft: numberStyle('marginLeft'),
      marginRight: numberStyle('marginRight'),
      textIndent: numberStyle('textIndent'),
      lineHeight,
      verticalAlign,
      listStyleType
    };
  }

  function cleanHtml(html) {
    const parsed = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
    const root = parsed.body.firstElementChild;
    const cleanChildren = parent => {
      for (const node of [...parent.childNodes]) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (!allowedTags.has(node.tagName)) {
          if (node.tagName === 'FONT') {
            const wrapper = document.createElement('span');
            const face = String(node.getAttribute('face') || '').replace(/["']/g, '').trim().toLowerCase();
            const family = fontFamilies.find(value => value.toLowerCase() === face);
            const legacySizes = ['', '12px', '14px', '16px', '18px', '24px', '32px', '32px'];
            const size = legacySizes[Number(node.getAttribute('size'))] || '';
            if (family) wrapper.style.fontFamily = family;
            if (size) wrapper.style.fontSize = size;
            wrapper.append(...node.childNodes);
            cleanChildren(wrapper);
            node.replaceWith(wrapper);
            continue;
          }
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'].includes(node.tagName)) node.remove();
          else node.replaceWith(...node.childNodes);
          continue;
        }
        if (node.tagName === 'IMG') {
          const source = node.getAttribute('src') || '';
          const safeSource = source.length <= 5_600_000 && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/]+=*$/i.test(source) ? source : '';
          const alt = String(node.getAttribute('alt') || '').slice(0, 300);
          const width = Number.parseInt(node.getAttribute('width'), 10);
          const height = Number.parseInt(node.getAttribute('height'), 10);
          for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
          if (!safeSource) { node.remove(); continue; }
          node.setAttribute('src', safeSource);
          node.setAttribute('alt', alt);
          if (Number.isFinite(width) && width >= 16 && width <= 2400) node.setAttribute('width', String(width));
          if (Number.isFinite(height) && height >= 16 && height <= 2400) node.setAttribute('height', String(height));
          continue;
        }
        const styles = ['SPAN', 'P', 'DIV', 'LI', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL'].includes(node.tagName) ? safeStyle(node) : {};
        const listType = node.tagName === 'OL' && ['1', 'a', 'A', 'i', 'I'].includes(node.getAttribute('type')) ? node.getAttribute('type') : '';
        const safeHref = node.tagName === 'A' ? (() => {
          const href = String(node.getAttribute('href') || '').trim();
          try { const url = new URL(href); return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href.slice(0, 2048) : ''; } catch { return ''; }
        })() : '';
        for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
        if (node.tagName === 'A' && safeHref) { node.setAttribute('href', safeHref); node.setAttribute('rel', 'noreferrer'); }
        if (listType) node.setAttribute('type', listType);
        for (const [property, value] of Object.entries(styles)) {
          if (value) node.style[property] = value;
        }
        cleanChildren(node);
      }
    };
    cleanChildren(root);
    return root.innerHTML;
  }

  function status(message, error = false) {
    const element = $('#documentSaveStatus');
    element.textContent = message;
    element.dataset.error = String(error);
  }

  function persistState(immediate = false) {
    clearTimeout(saveTimer);
    if (!immediate) status('Salvando…');
    const save = async () => {
      try {
        const result = await window.ntc.saveDocumentsState(state);
        status(result?.ok ? 'Rascunho salvo neste computador' : (result?.error || 'Não foi possível salvar o rascunho.'), !result?.ok);
      } catch (error) { status(error.message || 'Não foi possível salvar o rascunho.', true); }
    };
    if (immediate) void save();
    else saveTimer = setTimeout(() => { void save(); }, 450);
  }

  function updateWordCount() {
    const count = ($('#documentEditor').innerText.trim().match(/\S+/g) || []).length;
    $('#documentWordCount').textContent = `${count} ${count === 1 ? 'palavra' : 'palavras'}`;
  }

  function switchDocumentsTab(tab, save = true) {
    const selected = tab === 'notes' ? 'notes' : 'editor';
    state.activeTab = selected;
    $$('.documents-tab').forEach(button => {
      const active = button.dataset.documentsTab === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('[data-documents-panel]').forEach(panel => {
      const active = panel.dataset.documentsPanel === selected;
      panel.classList.toggle('hidden', !active);
      panel.classList.toggle('active', active);
    });
    if (save) persistState(true);
  }

  function htmlDocument(title, content) {
    const safeTitle = String(title || 'Documento').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const family = fontFamilies.includes(state.draft.fontFamily) ? state.draft.fontFamily : 'Arial';
    const size = fontSizes.includes(state.draft.fontSize) ? state.draft.fontSize : '16px';
    const left = Math.max(5, Math.min(35, Number(state.pageLayout?.leftMargin) || 12));
    const right = Math.max(5, Math.min(35, Number(state.pageLayout?.rightMargin) || 12));
    const paper = ['A4', 'Letter', 'Legal'].includes(state.pageLayout?.paper) ? state.pageLayout.paper : 'A4';
    const orientation = state.pageLayout?.orientation === 'landscape' ? 'landscape' : 'portrait';
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTitle}</title><style>@page{size:${paper} ${orientation};margin:20mm ${right}% 20mm ${left}%}body{max-width:820px;margin:0 auto;padding:0 8px;font:${size}/1.7 "${family}",sans-serif;color:#222}h2{margin-top:1.2em}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #ccc;color:#555}img{max-width:100%;height:auto}</style></head><body><h1>${safeTitle}</h1>${cleanHtml(content)}</body></html>`;
  }

  function htmlToRtf(content) {
    const parsed = new DOMParser().parseFromString(`<body>${cleanHtml(content)}</body>`, 'text/html');
    const elements = [...parsed.body.querySelectorAll('*')];
    const fonts = [...new Set([state.draft.fontFamily, ...elements.map(element => safeStyle(element).family).filter(Boolean)])].filter(font => fontFamilies.includes(font));
    if (!fonts.length) fonts.push('Arial');
    const colors = [...new Set(elements.flatMap(element => { const style = safeStyle(element); return [style.color, style.backgroundColor].filter(color => /^#[0-9a-f]{6}$/i.test(color)); }))];
    const fontIndex = new Map(fonts.map((font, index) => [font, index]));
    const colorIndex = new Map(colors.map((color, index) => [color.toLowerCase(), index + 1]));
    const encode = value => {
      const text = String(value);
      let encoded = '';
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        const code = text.charCodeAt(index);
        if (character === '\\' || character === '{' || character === '}') encoded += `\\${character}`;
        else if (character === '\n') encoded += '\\line ';
        else if (code < 128) encoded += character;
        else encoded += `\\u${code > 32767 ? code - 65536 : code}?`;
      }
      return encoded;
    };
    const colorCommands = (style, tag) => {
      const commands = [];
      if (style.family && fontIndex.has(style.family)) commands.push(`\\f${fontIndex.get(style.family)}`);
      if (style.size) commands.push(`\\fs${Math.round(Number.parseFloat(style.size) * 1.5)}`);
      if (style.color && colorIndex.has(style.color.toLowerCase())) commands.push(`\\cf${colorIndex.get(style.color.toLowerCase())}`);
      if (style.backgroundColor && colorIndex.has(style.backgroundColor.toLowerCase())) commands.push(`\\highlight${colorIndex.get(style.backgroundColor.toLowerCase())}`);
      const semantic = { B: '\\b', STRONG: '\\b', I: '\\i', EM: '\\i', U: '\\ul', S: '\\strike', SUB: '\\sub', SUP: '\\super' }[tag];
      if (semantic) commands.push(semantic);
      return commands.join(' ');
    };
    const imageToRtf = image => {
      const match = (image.getAttribute('src') || '').match(/^data:image\/(png|jpeg);base64,([a-z\d+/]+=*)$/i);
      if (!match || match[2].length > 5_600_000) return '';
      const binary = atob(match[2]);
      let hex = '';
      for (let index = 0; index < binary.length; index += 1) hex += binary.charCodeAt(index).toString(16).padStart(2, '0');
      const width = Math.max(16, Math.min(2400, Number(image.getAttribute('width')) || 320));
      const height = Math.max(16, Math.min(2400, Number(image.getAttribute('height')) || 220));
      return `{\\pict\\${match[1] === 'jpeg' ? 'jpegblip' : 'pngblip'}\\picwgoal${width * 15}\\pichgoal${height * 15}\n${hex}}`;
    };
    const render = node => {
      if (node.nodeType === Node.TEXT_NODE) return encode(node.nodeValue);
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName;
      if (tag === 'IMG') return imageToRtf(node);
      const style = safeStyle(node);
      if (tag === 'UL' || tag === 'OL') {
        let number = 0;
        return `{${[...node.children].filter(child => child.tagName === 'LI').map(item => {
          number += 1;
          const marker = tag === 'UL' ? '•' : node.type === 'a' ? `${String.fromCharCode(96 + Math.min(number, 26))}.` : node.type === 'A' ? `${String.fromCharCode(64 + Math.min(number, 26))}.` : node.type === 'i' || node.type === 'I' ? `${number === 1 ? 'i' : number}.` : `${number}.`;
          return `{\\pard\\li720\\fi-360 ${encode(marker)}\\tab ${[...item.childNodes].map(render).join('')}\\par}`;
        }).join('')}}`;
      }
      const body = [...node.childNodes].map(render).join('');
      if (['P', 'DIV', 'H2', 'H3', 'BLOCKQUOTE', 'LI'].includes(tag)) {
        const paragraph = [];
        if (style.textAlign === 'center') paragraph.push('\\qc');
        else if (style.textAlign === 'right') paragraph.push('\\qr');
        else if (style.textAlign === 'justify') paragraph.push('\\qj');
        else paragraph.push('\\ql');
        if (style.marginLeft) paragraph.push(`\\li${Math.round(Number.parseFloat(style.marginLeft) * 15)}`);
        if (style.marginRight) paragraph.push(`\\ri${Math.round(Number.parseFloat(style.marginRight) * 15)}`);
        if (style.textIndent) paragraph.push(`\\fi${Math.round(Number.parseFloat(style.textIndent) * 15)}`);
        if (style.lineHeight) paragraph.push(`\\sl${Math.round(Number.parseFloat(style.lineHeight) * 240)}\\slmult1`);
        if (tag === 'H2' || tag === 'H3') paragraph.push('\\b');
        return `{\\pard ${paragraph.join(' ')} ${body}\\par}`;
      }
      if (tag === 'A') {
        const href = String(node.getAttribute('href') || '').replace(/["\\{}]/g, '');
        return href ? `{\\field{\\*\\fldinst HYPERLINK "${href}"}{\\fldrslt ${body}}}` : body;
      }
      const commands = colorCommands(style, tag);
      return commands ? `{${commands} ${body}}` : body;
    };
    const fontTable = `{\\fonttbl${fonts.map((font, index) => `{\\f${index}\\fnil ${font};}`).join('')}}`;
    const colorTable = `{\\colortbl;${colors.map(color => { const hex = color.slice(1); return `\\red${parseInt(hex.slice(0, 2), 16)}\\green${parseInt(hex.slice(2, 4), 16)}\\blue${parseInt(hex.slice(4, 6), 16)};`; }).join('')}}`;
    const defaultSize = Math.round(Number.parseFloat(state.draft.fontSize || '16px') * 1.5);
    const dimensions = state.pageLayout?.paper === 'Legal' ? [12240, 20160] : state.pageLayout?.paper === 'Letter' ? [12240, 15840] : [11906, 16838];
    const [paperWidth, paperHeight] = state.pageLayout?.orientation === 'landscape' ? [dimensions[1], dimensions[0]] : dimensions;
    const leftMargin = Math.round(paperWidth * (Number(state.pageLayout?.leftMargin) || 12) / 100);
    const rightMargin = Math.round(paperWidth * (Number(state.pageLayout?.rightMargin) || 12) / 100);
    return `{\\rtf1\\ansi\\deff0\\uc1\n${fontTable}\n${colorTable}\n\\viewkind4\\paperw${paperWidth}\\paperh${paperHeight}\\margl${leftMargin}\\margr${rightMargin}\\pard\\f${fontIndex.get(state.draft.fontFamily) || 0}\\fs${defaultSize} ${[...parsed.body.childNodes].map(render).join('')}\n}`;
  }

  function markdownText() {
    const editor = $('#documentEditor');
    const convert = node => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const inner = [...node.childNodes].map(convert).join('');
      if (node.tagName === 'H2') return `## ${inner}\n\n`;
      if (node.tagName === 'LI') return `- ${inner}\n`;
      if (node.tagName === 'P' || node.tagName === 'DIV' || node.tagName === 'BLOCKQUOTE') return `${inner}\n\n`;
      if (node.tagName === 'BR') return '\n';
      if (['STRONG', 'B'].includes(node.tagName)) return `**${inner}**`;
      if (['EM', 'I'].includes(node.tagName)) return `*${inner}*`;
      return inner;
    };
    return `# ${$('#documentTitle').value.trim() || 'Documento'}\n\n${[...editor.childNodes].map(convert).join('').trim()}\n`;
  }

  function renderNotes() {
    const board = $('#notesBoard');
    if (!state.notes.length) {
      board.innerHTML = '<div class="notes-empty"><strong>Nenhuma nota por aqui</strong><span>Crie um post-it para deixar algo à vista.</span></div>';
      return;
    }
    board.innerHTML = state.notes.map(note => `<article class="postit-card${note.expanded ? ' expanded' : ''}" data-note-id="${escapeAttribute(note.id)}" data-color="${note.color}" draggable="true"><div class="postit-heading"><span class="postit-grip" aria-hidden="true" title="Arraste para reorganizar">⠿</span><input class="postit-title" type="text" maxlength="160" value="${escapeAttribute(note.title)}" placeholder="Título da nota" aria-label="Título da nota"></div><textarea class="postit-text" maxlength="50000" placeholder="Escreva uma nota…" aria-label="Conteúdo da nota">${escapeText(note.text)}</textarea><div class="postit-actions"><div class="postit-colors" role="group" aria-label="Cor da nota">${noteColors.map(color => `<button class="postit-color" type="button" data-note-color="${color}" aria-label="Cor ${color}" aria-pressed="${note.color === color}" title="${color}"></button>`).join('')}</div><div class="postit-actions-end"><button class="postit-expand" type="button" aria-label="${note.expanded ? 'Recolher nota' : 'Expandir nota'}" title="${note.expanded ? 'Recolher nota' : 'Expandir nota'}" aria-expanded="${Boolean(note.expanded)}" data-note-expand><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M7 3H3v4M3 3l5 5m5 9h4v-4m0 4-5-5"/></svg></button><button class="postit-delete" type="button" data-delete-note>Excluir</button></div></div></article>`).join('');
    board.querySelectorAll('.postit-card').forEach(card => {
      const id = card.dataset.noteId;
      const note = state.notes.find(item => item.id === id);
      card.querySelector('.postit-title').addEventListener('input', event => { note.title = event.target.value; note.updatedAt = Date.now(); persistState(); });
      card.querySelector('.postit-text').addEventListener('input', event => { note.text = event.target.value; note.updatedAt = Date.now(); persistState(); });
      card.querySelectorAll('[data-note-color]').forEach(button => button.addEventListener('click', () => {
        note.color = button.dataset.noteColor;
        note.updatedAt = Date.now();
        renderNotes();
        persistState(true);
      }));
      card.querySelector('[data-note-expand]').addEventListener('click', event => {
        const button = event.currentTarget;
        const currentHeight = card.getBoundingClientRect().height;
        card.getAnimations().forEach(animation => animation.cancel());
        card.style.height = `${currentHeight}px`;
        note.expanded = !note.expanded;
        card.classList.toggle('expanded', note.expanded);
        button.setAttribute('aria-expanded', String(note.expanded));
        button.setAttribute('aria-label', note.expanded ? 'Recolher nota' : 'Expandir nota');
        button.title = note.expanded ? 'Recolher nota' : 'Expandir nota';
        card.style.removeProperty('height');
        const nextHeight = card.getBoundingClientRect().height;
        card.style.height = `${currentHeight}px`;
        if (currentHeight !== nextHeight && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          card.style.willChange = 'height';
          const animation = card.animate([{ height: `${currentHeight}px` }, { height: `${nextHeight}px` }], {
            duration: 280,
            easing: 'cubic-bezier(.22,.68,0,1)',
            fill: 'none'
          });
          animation.onfinish = () => { card.style.height = ''; card.style.willChange = ''; };
        } else card.style.height = '';
        note.updatedAt = Date.now();
        persistState(true);
      });
      card.querySelector('[data-delete-note]').addEventListener('click', () => {
        state.notes = state.notes.filter(item => item.id !== id);
        renderNotes();
        persistState(true);
      });
      card.addEventListener('dragstart', event => { draggedNoteId = id; card.classList.add('dragging'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); });
      card.addEventListener('dragend', () => { draggedNoteId = ''; card.classList.remove('dragging'); board.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over')); });
      card.addEventListener('dragover', event => { if (!draggedNoteId || draggedNoteId === id) return; event.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', event => {
        event.preventDefault();
        card.classList.remove('drag-over');
        const from = state.notes.findIndex(item => item.id === draggedNoteId);
        const to = state.notes.findIndex(item => item.id === id);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = state.notes.splice(from, 1);
        state.notes.splice(to, 0, moved);
        renderNotes();
        persistState(true);
      });
    });
  }

  function escapeText(value) { return String(value || '').replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]); }
  function escapeAttribute(value) { return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function saveSelection() {
    const editor = $('#documentEditor');
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) savedRange = selection.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    if (!savedRange || !$('#documentEditor').contains(savedRange.commonAncestorContainer)) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
    return true;
  }

  function selectedBlock() {
    const selection = window.getSelection();
    let element = selection?.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection?.anchorNode?.parentElement;
    while (element && element !== $('#documentEditor')) {
      if (['P', 'DIV', 'LI', 'H2', 'H3', 'BLOCKQUOTE'].includes(element.tagName)) return element;
      element = element.parentElement;
    }
    return null;
  }

  function syncFormattingToolbar() {
    const editor = $('#documentEditor');
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
    for (const button of $$('[data-document-command]')) {
      const { documentCommand: command, documentValue: value } = button.dataset;
      let active = false;
      try {
        if (command === 'formatBlock') active = selectedBlock()?.tagName === value.toUpperCase();
        else if (command.startsWith('insert')) active = document.queryCommandState(command);
        else active = document.queryCommandState(command);
      } catch { /* Some Chromium selections do not report a formatting state. */ }
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    const block = selectedBlock();
    const source = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
    const styledElement = source?.closest('span[style],p[style],div[style],li[style],h2[style],h3[style],blockquote[style]');
    const computed = window.getComputedStyle(styledElement || block || editor);
    const family = fontFamilies.find(name => computed.fontFamily.replace(/["']/g, '').toLowerCase().startsWith(name.toLowerCase()));
    const size = fontSizes.find(option => Math.round(Number.parseFloat(computed.fontSize)) === Number.parseFloat(option));
    $('#documentFontFamily').value = family || state.draft.fontFamily || 'Arial';
    $('#documentFontSize').value = size || state.draft.fontSize || '16px';
    $('#documentFontFamily').classList.toggle('has-format', Boolean(styledElement?.style.fontFamily || block?.style.fontFamily));
    $('#documentFontSize').classList.toggle('has-format', Boolean(styledElement?.style.fontSize || block?.style.fontSize));
    const lineHeight = block?.style.lineHeight || '1.75';
    $('#documentLineSpacing').value = ['1', '1.15', '1.5', '1.75', '2'].includes(lineHeight) ? lineHeight : '1.75';
    const list = block?.closest('ul,ol');
    $('#documentListStyle').value = list?.tagName === 'OL' ? list.type || '1' : list?.style.listStyleType || 'disc';
  }

  function applyInlineStyle(property, value) {
    const editor = $('#documentEditor');
    editor.focus();
    restoreSelection();
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      const key = property === 'fontFamily' ? 'fontFamily' : 'fontSize';
      state.draft[key] = value;
      editor.style[property] = value;
      persistState();
      return;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      const block = selectedBlock();
      if (block) block.style[property] = value;
      else {
        state.draft[property === 'fontFamily' ? 'fontFamily' : 'fontSize'] = value;
        editor.style[property] = value;
      }
    } else {
      const startContainer = range.startContainer;
      const startOffset = range.startOffset;
      const endContainer = range.endContainer;
      const endOffset = range.endOffset;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.length && range.intersectsNode(node)) textNodes.push(node);
      }
      const wrappers = [];
      for (const node of textNodes.reverse()) {
        const start = node === startContainer ? startOffset : 0;
        const end = node === endContainer ? endOffset : node.length;
        if (start >= end) continue;
        const part = document.createRange();
        part.setStart(node, start);
        part.setEnd(node, end);
        const wrapper = document.createElement('span');
        wrapper.style[property] = value;
        wrapper.append(part.extractContents());
        part.insertNode(wrapper);
        wrappers.push(wrapper);
      }
      if (wrappers.length) {
        wrappers.reverse();
        const firstWalker = document.createTreeWalker(wrappers[0], NodeFilter.SHOW_TEXT);
        const lastWalker = document.createTreeWalker(wrappers.at(-1), NodeFilter.SHOW_TEXT);
        const firstText = firstWalker.nextNode();
        let lastText = lastWalker.nextNode();
        while (lastWalker.nextNode()) lastText = lastWalker.currentNode;
        if (firstText && lastText) {
          const restored = document.createRange();
          restored.setStart(firstText, 0);
          restored.setEnd(lastText, lastText.length);
          selection.removeAllRanges();
          selection.addRange(restored);
          savedRange = restored.cloneRange();
        }
      }
    }
    state.draft = { ...state.draft, title: $('#documentTitle').value, html: cleanHtml(editor.innerHTML) };
    updateWordCount();
    persistState();
    syncFormattingToolbar();
  }

  function saveEditorMarkup() {
    state.draft = { ...state.draft, title: $('#documentTitle').value, html: cleanHtml($('#documentEditor').innerHTML) };
    updateWordCount();
    persistState();
    syncFormattingToolbar();
  }

  function applyParagraphStyle(property, value) {
    const editor = $('#documentEditor');
    editor.focus();
    restoreSelection();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const blocks = range?.collapsed ? [selectedBlock()].filter(Boolean) : range ? [...editor.querySelectorAll('p,li,h2,h3,blockquote')].filter(block => range.intersectsNode(block)) : [];
    if (blocks.length) blocks.forEach(block => { block.style[property] = value; });
    else editor.style[property] = value;
    saveEditorMarkup();
  }

  function adjustIndent(amount) {
    const editor = $('#documentEditor');
    editor.focus();
    restoreSelection();
    const block = selectedBlock();
    if (!block) return;
    const current = Number.parseFloat(block.style.marginLeft) || 0;
    block.style.marginLeft = `${Math.max(0, Math.min(360, current + amount))}px`;
    saveEditorMarkup();
  }

  function applyListStyle() {
    const requested = $('#documentListStyle').value;
    const ordered = ['1', 'a', 'A', 'i', 'I'].includes(requested);
    const editor = $('#documentEditor');
    editor.focus();
    restoreSelection();
    let list = selectedBlock()?.closest('ul,ol');
    if (!list || (ordered && list.tagName !== 'OL') || (!ordered && list.tagName !== 'UL')) {
      document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList');
      list = selectedBlock()?.closest('ul,ol');
    }
    if (list) {
      if (ordered) {
        list.removeAttribute('type');
        if (requested !== '1') list.setAttribute('type', requested);
      } else {
        list.removeAttribute('type');
        list.style.listStyleType = requested;
      }
      saveEditorMarkup();
    }
  }

  function syncPageMargins(persist = true) {
    const leftMargin = Math.max(5, Math.min(35, Number($('#documentLeftMargin').value) || 12));
    const rightMargin = Math.max(5, Math.min(35, Number($('#documentRightMargin').value) || 12));
    state.pageLayout = { ...state.pageLayout, leftMargin, rightMargin };
    const editor = $('#documentEditor');
    editor.style.paddingLeft = `calc(${leftMargin}% + 18px)`;
    editor.style.paddingRight = `calc(${rightMargin}% + 18px)`;
    if (persist) persistState();
  }

  function syncDocumentPageSize() {
    const paper = $('#documentPaper').value;
    const orientation = $('#documentOrientation').value;
    const dimensions = {
      A4: [794, 1123],
      Letter: [816, 1056],
      Legal: [816, 1344]
    }[paper] || [794, 1123];
    const [pageWidth, pageHeight] = orientation === 'landscape' ? [dimensions[1], dimensions[0]] : dimensions;
    const editor = $('#documentEditor');
    editor.style.width = `min(100%, ${pageWidth}px)`;
    editor.style.aspectRatio = `${pageWidth} / ${pageHeight}`;
    editor.dataset.paper = paper;
    editor.dataset.orientation = orientation;
  }

  function runEditorCommand(command, value = null) {
    const editor = $('#documentEditor');
    editor.focus();
    restoreSelection();
    document.execCommand(command, false, value);
    saveSelection();
    saveEditorMarkup();
  }

  function findTextNodes() {
    const walker = document.createTreeWalker($('#documentEditor'), NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({ node, start: text.length });
      text += node.nodeValue;
    }
    return { nodes, text };
  }

  function selectTextAt(offset, length, nodes) {
    let start = null;
    let end = null;
    for (const entry of nodes) {
      const nodeEnd = entry.start + entry.node.length;
      if (!start && offset >= entry.start && offset <= nodeEnd) start = { node: entry.node, offset: offset - entry.start };
      if (offset + length >= entry.start && offset + length <= nodeEnd) { end = { node: entry.node, offset: offset + length - entry.start }; break; }
    }
    if (!start || !end) return false;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
    $('#documentEditor').focus();
    return true;
  }

  function findNextText() {
    const query = $('#documentFindText').value;
    if (!query) { status('Digite algo para localizar.', true); return false; }
    const { nodes, text } = findTextNodes();
    const foldedText = text.toLocaleLowerCase();
    const foldedQuery = query.toLocaleLowerCase();
    let index = foldedText.indexOf(foldedQuery, Math.min(findCursor, text.length));
    if (index < 0 && findCursor > 0) index = foldedText.indexOf(foldedQuery, 0);
    if (index < 0 || !selectTextAt(index, query.length, nodes)) { status('Nenhuma outra ocorrência encontrada.', true); return false; }
    findCursor = index + query.length;
    status(`Ocorrência encontrada em ${index + 1}.`);
    return true;
  }

  function replaceSelectedText() {
    const query = $('#documentFindText').value;
    if (!query) { status('Digite algo para localizar.', true); return; }
    const selection = window.getSelection();
    const selectedText = selection?.toString() || '';
    if (selectedText.toLocaleLowerCase() !== query.toLocaleLowerCase()) {
      if (!findNextText()) return;
    }
    $('#documentEditor').focus();
    restoreSelection();
    document.execCommand('insertText', false, $('#documentReplaceText').value);
    saveSelection();
    saveEditorMarkup();
    status('Ocorrência substituída.');
  }

  function replaceAllText() {
    const query = $('#documentFindText').value;
    if (!query) { status('Digite algo para localizar.', true); return; }
    const replacement = $('#documentReplaceText').value;
    const walker = document.createTreeWalker($('#documentEditor'), NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      node.nodeValue = node.nodeValue.replace(expression, () => { count += 1; return replacement; });
    }
    if (count) saveEditorMarkup();
    status(count ? `${count} ocorrência(s) substituída(s).` : 'Nenhuma ocorrência encontrada.', !count);
  }

  async function insertDocumentImage() {
    saveSelection();
    const image = await window.ntc.openDocumentImage();
    if (!image) return;
    if (image.error) { status(image.error, true); return; }
    $('#documentEditor').focus();
    restoreSelection();
    const markup = `<img src="${escapeAttribute(image.dataUrl)}" alt="${escapeAttribute(image.name)}">`;
    document.execCommand('insertHTML', false, markup);
    saveEditorMarkup();
    status(`Imagem inserida: ${image.name}`);
  }

  function insertDocumentDate() {
    const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    runEditorCommand('insertText', date);
  }

  function insertDocumentLink() {
    const entered = window.prompt('Endereço do link (URL):');
    if (!entered) return;
    const target = entered.trim();
    let href = target;
    try { if (!/^(?:https?:|mailto:)/i.test(href)) href = `https://${href}`; const parsed = new URL(href); if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('invalid'); href = parsed.href; }
    catch { status('Informe um link HTTP, HTTPS ou e-mail válido.', true); return; }
    const selection = window.getSelection();
    if (selection?.toString()) runEditorCommand('createLink', href);
    else {
      $('#documentEditor').focus();
      restoreSelection();
      document.execCommand('insertHTML', false, `<a href="${escapeAttribute(href)}">${escapeText(target)}</a>`);
      saveEditorMarkup();
    }
  }

  function printDocument() {
    const frame = document.createElement('iframe');
    frame.className = 'document-print-frame';
    frame.title = 'Visualização de impressão';
    frame.srcdoc = htmlDocument($('#documentTitle').value, $('#documentEditor').innerHTML);
    frame.addEventListener('load', () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 1200);
    }, { once: true });
    document.body.append(frame);
  }

  async function initialize() {
    if (initialized) return;
    const saved = await window.ntc.getDocumentsState();
    if (saved && typeof saved === 'object') state = { ...state, ...saved, draft: { ...state.draft, ...(saved.draft || {}) }, notes: Array.isArray(saved.notes) ? saved.notes : [] };
    $('#documentTitle').value = state.draft.title || 'Sem título';
    $('#documentFontFamily').value = fontFamilies.includes(state.draft.fontFamily) ? state.draft.fontFamily : 'Arial';
    $('#documentFontSize').value = fontSizes.includes(state.draft.fontSize) ? state.draft.fontSize : '16px';
    $('#documentEditor').innerHTML = cleanHtml(state.draft.html);
    $('#documentEditor').style.fontFamily = fontFamilies.includes(state.draft.fontFamily) ? state.draft.fontFamily : 'Arial';
    $('#documentEditor').style.fontSize = fontSizes.includes(state.draft.fontSize) ? state.draft.fontSize : '16px';
    $('#documentLeftMargin').value = String(state.pageLayout?.leftMargin ?? 12);
    $('#documentRightMargin').value = String(state.pageLayout?.rightMargin ?? 12);
    $('#documentPaper').value = ['A4', 'Letter', 'Legal'].includes(state.pageLayout?.paper) ? state.pageLayout.paper : 'A4';
    $('#documentOrientation').value = state.pageLayout?.orientation === 'landscape' ? 'landscape' : 'portrait';
    syncDocumentPageSize();
    syncPageMargins(false);
    updateWordCount();
    renderNotes();
    switchDocumentsTab(state.activeTab, false);
    initialized = true;
  }

  $$('.documents-tab').forEach(button => button.addEventListener('click', () => switchDocumentsTab(button.dataset.documentsTab)));
  $('#documentEditor').addEventListener('input', () => {
    state.draft = { ...state.draft, title: $('#documentTitle').value, html: cleanHtml($('#documentEditor').innerHTML) };
    saveSelection();
    updateWordCount();
    persistState();
    syncFormattingToolbar();
  });
  $('#documentEditor').addEventListener('keyup', () => { saveSelection(); syncFormattingToolbar(); });
  $('#documentEditor').addEventListener('mouseup', () => { saveSelection(); syncFormattingToolbar(); });
  document.addEventListener('selectionchange', () => { saveSelection(); syncFormattingToolbar(); });
  $('#documentEditor').addEventListener('paste', event => {
    event.preventDefault();
    const clipboard = event.clipboardData;
    const richText = clipboard?.getData('text/html');
    if (richText) {
      const safeContent = cleanHtml(new DOMParser().parseFromString(richText, 'text/html').body.innerHTML);
      document.execCommand('insertHTML', false, safeContent);
      return;
    }
    const imageFile = [...(clipboard?.files || [])].find(file => ['image/png', 'image/jpeg'].includes(file.type));
    if (imageFile) {
      if (imageFile.size > 4 * 1024 * 1024) { status('A imagem colada precisa ter até 4 MB.', true); return; }
      const reader = new FileReader();
      reader.onload = () => { document.execCommand('insertHTML', false, cleanHtml(`<img src="${escapeAttribute(reader.result)}" alt="Imagem colada">`)); saveEditorMarkup(); };
      reader.onerror = () => status('Não foi possível inserir a imagem copiada.', true);
      reader.readAsDataURL(imageFile);
      return;
    }
    document.execCommand('insertText', false, clipboard?.getData('text/plain') || '');
  });
  $('#documentTitle').addEventListener('input', () => {
    state.draft.title = $('#documentTitle').value;
    persistState();
  });
  ['documentFontFamily', 'documentFontSize'].forEach(id => {
    const control = $(`#${id}`);
    control.addEventListener('pointerdown', saveSelection);
    control.addEventListener('mousedown', saveSelection);
    control.addEventListener('change', () => applyInlineStyle(id === 'documentFontFamily' ? 'fontFamily' : 'fontSize', control.value));
  });
  $$('[data-document-command]').forEach(button => button.addEventListener('mousedown', event => { saveSelection(); event.preventDefault(); }));
  $$('[data-document-command]').forEach(button => button.addEventListener('click', () => runEditorCommand(button.dataset.documentCommand, button.dataset.documentValue || null)));
  ['documentTextColor', 'documentHighlightColor'].forEach((id, index) => {
    const picker = $(`#${id}`);
    picker.addEventListener('pointerdown', saveSelection);
    picker.addEventListener('mousedown', saveSelection);
    picker.addEventListener('change', () => applyInlineStyle(index === 0 ? 'color' : 'backgroundColor', picker.value));
  });
  $('#documentLineSpacing').addEventListener('pointerdown', saveSelection);
  $('#documentLineSpacing').addEventListener('change', () => applyParagraphStyle('lineHeight', $('#documentLineSpacing').value));
  $('#documentListStyle').addEventListener('pointerdown', saveSelection);
  $('#documentListStyle').addEventListener('mousedown', saveSelection);
  $('#documentListStyle').addEventListener('change', applyListStyle);
  $('#documentLeftMargin').addEventListener('input', syncPageMargins);
  $('#documentRightMargin').addEventListener('input', syncPageMargins);
  $('#documentPaper').addEventListener('change', () => {
    state.pageLayout = { ...state.pageLayout, paper: ['A4', 'Letter', 'Legal'].includes($('#documentPaper').value) ? $('#documentPaper').value : 'A4' };
    syncDocumentPageSize();
    persistState(true);
  });
  $('#documentOrientation').addEventListener('change', () => {
    state.pageLayout = { ...state.pageLayout, orientation: $('#documentOrientation').value === 'landscape' ? 'landscape' : 'portrait' };
    syncDocumentPageSize();
    persistState(true);
  });
  $('#documentIndentLess').addEventListener('click', () => adjustIndent(-24));
  $('#documentIndentMore').addEventListener('click', () => adjustIndent(24));
  $('#documentInsertImage').addEventListener('mousedown', event => { saveSelection(); event.preventDefault(); });
  $('#documentInsertImage').addEventListener('click', () => { void insertDocumentImage(); });
  $('#documentInsertDrawing').addEventListener('mousedown', event => { saveSelection(); event.preventDefault(); });
  $('#documentInsertDrawing').addEventListener('click', () => {
    const dialog = $('#documentDrawingDialog');
    const context = $('#documentDrawingCanvas').getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 1000, 620);
    $('#documentDrawingInsert').disabled = true;
    dialog.showModal();
  });
  $('#documentDrawingClose').addEventListener('click', () => $('#documentDrawingDialog').close());
  $('#documentDrawingCancel').addEventListener('click', () => $('#documentDrawingDialog').close());
  $('#documentDrawingSize').addEventListener('input', () => { $('#documentDrawingSizeValue').value = `${$('#documentDrawingSize').value} px`; });
  $('#documentDrawingClear').addEventListener('click', () => {
    const canvas = $('#documentDrawingCanvas');
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    $('#documentDrawingInsert').disabled = true;
  });
  (() => {
    const canvas = $('#documentDrawingCanvas');
    const context = canvas.getContext('2d');
    let drawing = false;
    const point = event => {
      const bounds = canvas.getBoundingClientRect();
      return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
    };
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      const { x, y } = point(event);
      context.beginPath();
      context.moveTo(x, y);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = $('#documentDrawingColor').value;
      context.lineWidth = Number($('#documentDrawingSize').value);
      context.lineTo(x + 0.1, y + 0.1);
      context.stroke();
      $('#documentDrawingInsert').disabled = false;
    });
    canvas.addEventListener('pointermove', event => {
      if (!drawing) return;
      const { x, y } = point(event);
      context.lineTo(x, y);
      context.stroke();
    });
    const stopDrawing = () => { drawing = false; };
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
    canvas.addEventListener('lostpointercapture', stopDrawing);
  })();
  $('#documentDrawingInsert').addEventListener('click', () => {
    const canvas = $('#documentDrawingCanvas');
    const image = `<img src="${canvas.toDataURL('image/png')}" alt="Desenho inserido" width="1000" height="620">`;
    $('#documentDrawingDialog').close();
    $('#documentEditor').focus();
    restoreSelection();
    document.execCommand('insertHTML', false, cleanHtml(image));
    saveEditorMarkup();
    status('Desenho inserido no documento.');
  });
  $('#documentInsertDate').addEventListener('mousedown', event => { saveSelection(); event.preventDefault(); });
  $('#documentInsertDate').addEventListener('click', insertDocumentDate);
  $('#documentInsertLink').addEventListener('mousedown', event => { saveSelection(); event.preventDefault(); });
  $('#documentInsertLink').addEventListener('click', insertDocumentLink);
  $('#documentEditor').addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
  $('#documentFindNext').addEventListener('click', findNextText);
  $('#documentReplaceOne').addEventListener('click', replaceSelectedText);
  $('#documentReplaceAll').addEventListener('click', replaceAllText);
  $('#documentSelectAll').addEventListener('click', () => runEditorCommand('selectAll'));
  $('#documentUndo').addEventListener('click', () => runEditorCommand('undo'));
  $('#documentRedo').addEventListener('click', () => runEditorCommand('redo'));
  $('#documentFindText').addEventListener('input', () => { findCursor = 0; });
  $('#documentPrint').addEventListener('click', printDocument);
  $('#documentNew').addEventListener('click', async () => {
    if ($('#documentEditor').innerText.trim() && !window.confirm('Substituir o rascunho atual? Se não salvou uma cópia, o conteúdo será descartado.')) return;
    $('#documentTitle').value = 'Sem título';
    $('#documentEditor').innerHTML = '';
    state.draft = { title: 'Sem título', html: '', fontFamily: 'Arial', fontSize: '16px' };
    $('#documentFontFamily').value = 'Arial';
    $('#documentFontSize').value = '16px';
    $('#documentEditor').style.fontFamily = 'Arial';
    $('#documentEditor').style.fontSize = '16px';
    updateWordCount();
    persistState(true);
    $('#documentEditor').focus();
  });
  $('#documentOpen').addEventListener('click', async () => {
    try {
      const file = await window.ntc.openTextDocument();
      if (!file) return;
      $('#documentTitle').value = file.name.replace(/\.[^.]+$/, '');
      if (['.html', '.htm'].includes(file.extension)) $('#documentEditor').innerHTML = cleanHtml(new DOMParser().parseFromString(file.content, 'text/html').body.innerHTML);
      else if (file.extension === '.rtf') {
        const richText = await window.ntc.parseRichText(file.content);
        if (typeof richText !== 'string') { status('Não foi possível interpretar esse arquivo RTF.', true); return; }
        $('#documentEditor').innerHTML = cleanHtml(richText);
      }
      else $('#documentEditor').textContent = file.content;
      state.draft = { ...state.draft, title: $('#documentTitle').value, html: cleanHtml($('#documentEditor').innerHTML) };
      updateWordCount();
      persistState(true);
      status(`${file.name} aberto; rascunho atualizado`);
    } catch (error) { status(error.message || 'Não foi possível abrir o documento.', true); }
  });
  $('#documentSave').addEventListener('click', async () => {
    const format = $('#documentFormat').value;
    const title = $('#documentTitle').value.trim() || 'Documento';
    const content = format === 'html' ? htmlDocument(title, $('#documentEditor').innerHTML) : format === 'rtf' ? htmlToRtf($('#documentEditor').innerHTML) : format === 'md' ? markdownText() : $('#documentEditor').innerText;
    const result = await window.ntc.saveTextDocument({ format, name: title, content });
    if (result?.ok) status(`Documento salvo: ${result.name}`);
    else if (!result?.canceled) status(result?.error || 'Não foi possível salvar o documento.', true);
  });
  $('#noteAdd').addEventListener('click', () => {
    state.notes.unshift({ id: crypto.randomUUID(), title: '', text: '', color: 'violet', expanded: false, updatedAt: Date.now() });
    renderNotes();
    persistState(true);
    $('#notesBoard .postit-title')?.focus();
  });

  window.ntcDocumentsUi = {
    open() { if (initialized) switchDocumentsTab(state.activeTab, false); else void initialize(); },
    switchTab: switchDocumentsTab,
    setLastPdfPath(filePath) { state.lastPdfPath = String(filePath || '').slice(0, 4096); persistState(true); },
    updatePdfProgress(page, zoom) { state.lastPdfPage = page; state.pdfZoom = zoom; persistState(true); },
    refresh: initialize
  };

  void initialize();
})();
