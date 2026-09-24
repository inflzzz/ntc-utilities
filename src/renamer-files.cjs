'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_ITEMS, createRenamePlan, validateRenamePlan } = require('./renamer.js');

function entryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function expandRenamePaths(inputPaths) {
  if (!Array.isArray(inputPaths) || inputPaths.length > MAX_ITEMS) throw new Error(`Selecione no máximo ${MAX_ITEMS} arquivos ou pastas por vez.`);
  const pending = inputPaths.map(filePath => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Um dos caminhos selecionados é inválido.');
    return filePath;
  }).reverse();
  const files = [];
  const seenFiles = new Set();
  const seenDirectories = new Set();
  let ignoredSymbolicLinks = 0;

  while (pending.length) {
    const current = pending.pop();
    let stat;
    try { stat = fs.lstatSync(current); } catch { throw new Error('Um arquivo ou pasta selecionado não existe mais ou não pode ser acessado.'); }
    if (stat.isSymbolicLink()) { ignoredSymbolicLinks += 1; continue; }
    if (stat.isDirectory()) {
      const directoryKey = path.resolve(current).toLowerCase();
      if (seenDirectories.has(directoryKey)) continue;
      seenDirectories.add(directoryKey);
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { throw new Error('Não foi possível ler uma das pastas selecionadas. Verifique suas permissões.'); }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR', { numeric: true, sensitivity: 'base' }) || left.name.localeCompare(right.name));
      for (const entry of entries.reverse()) pending.push(path.join(current, entry.name));
      continue;
    }
    if (!stat.isFile()) throw new Error('A seleção contém algo que não é arquivo ou pasta.');
    const fileKey = path.resolve(current).toLowerCase();
    if (seenFiles.has(fileKey)) continue;
    seenFiles.add(fileKey);
    files.push(current);
    if (files.length > MAX_ITEMS) throw new Error(`A seleção contém mais de ${MAX_ITEMS} arquivos. Reduza a pasta ou escolha menos arquivos.`);
  }

  return { files, ignoredSymbolicLinks };
}

function makePreview(filePaths, options) {
  if (!Array.isArray(filePaths) || filePaths.length > MAX_ITEMS) throw new Error(`Selecione no máximo ${MAX_ITEMS} arquivos ou pastas por vez.`);
  const expanded = expandRenamePaths(filePaths);
  const plan = createRenamePlan(expanded.files, options);
  return { ...validateRenamePlan(plan, entryExists), ignoredSymbolicLinks: expanded.ignoredSymbolicLinks };
}

function safeRollback(staged, committed) {
  const errors = [];
  for (const item of [...committed].reverse()) {
    try { fs.renameSync(item.destination, item.temporaryPath); } catch (error) { errors.push(`${item.destination}: ${error.message}`); }
  }
  for (const item of [...staged].reverse()) {
    try {
      if (entryExists(item.temporaryPath)) fs.renameSync(item.temporaryPath, item.source);
    } catch (error) { errors.push(`${item.source}: ${error.message}`); }
  }
  return errors;
}

function renameFiles(filePaths, options) {
  const preview = makePreview(filePaths, options);
  if (!preview.valid) {
    const issue = preview.items.find(item => item.status !== 'ready' && item.status !== 'no-change');
    throw new Error(issue?.message || 'Ajuste as opções de renomeação antes de continuar.');
  }

  const staged = preview.items.filter(item => item.status === 'ready');
  for (const item of staged) {
    item.temporaryPath = path.join(path.dirname(item.source), `.ntc-rename-${crypto.randomUUID()}.tmp`);
    if (entryExists(item.temporaryPath)) throw new Error('Não foi possível reservar um nome temporário seguro. Tente novamente.');
  }

  const movedToTemporary = [];
  const movedToDestination = [];
  try {
    for (const item of staged) {
      fs.renameSync(item.source, item.temporaryPath);
      movedToTemporary.push(item);
    }
    for (const item of staged) {
      if (entryExists(item.destination)) throw new Error(`O arquivo “${item.newName}” apareceu durante a operação; nenhum arquivo existente foi substituído.`);
      fs.renameSync(item.temporaryPath, item.destination);
      movedToDestination.push(item);
    }
  } catch (error) {
    const rollbackErrors = safeRollback(movedToTemporary, movedToDestination);
    if (rollbackErrors.length) throw new Error(`Falha ao renomear e não foi possível restaurar todos os nomes automaticamente. Confira os arquivos temporários .ntc-rename-*.tmp. Detalhes: ${rollbackErrors.join('; ')}`);
    throw new Error(`Não foi possível concluir a renomeação. Os nomes originais foram restaurados. ${error.message}`);
  }

  return {
    renamedCount: staged.length,
    ignoredSymbolicLinks: preview.ignoredSymbolicLinks,
    items: staged.map(item => ({ originalName: item.originalName, newName: item.newName, source: item.source, destination: item.destination }))
  };
}

function previewFileRenames(filePaths, options) {
  const preview = makePreview(filePaths, options);
  return {
    valid: preview.valid,
    changedCount: preview.changedCount,
    errorCount: preview.errorCount,
    ignoredSymbolicLinks: preview.ignoredSymbolicLinks,
    items: preview.items.map(({ originalName, newName, changed, status, message }) => ({ originalName, newName, changed, status, message }))
  };
}

module.exports = { expandRenamePaths, previewFileRenames, renameFiles };
