(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NTC_Renamer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_ITEMS = 1000;
  const MAX_FILENAME_LENGTH = 255;
  const INVALID_FILENAME_CHARACTERS = /[\u0000-\u001f<>:"/\\|?*]/;
  const RESERVED_FILENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

  function pathParts(filePath) {
    const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    const directory = filePath.slice(0, separator + 1);
    const originalName = filePath.slice(separator + 1);
    const dot = originalName.lastIndexOf('.');
    const extension = dot > 0 ? originalName.slice(dot) : '';
    const baseName = extension ? originalName.slice(0, -extension.length) : originalName;
    return { directory, originalName, baseName, extension };
  }

  function pathKey(value) {
    return String(value).replaceAll('/', '\\').replace(/\\+/g, '\\').replace(/\\$/, '').toLowerCase();
  }

  function createRenamePlan(filePaths, options = {}) {
    if (!Array.isArray(filePaths) || filePaths.length > MAX_ITEMS) throw new Error(`Selecione no máximo ${MAX_ITEMS} arquivos por vez.`);
    if (!options || typeof options !== 'object') options = {};
    const settings = {
      prefix: String(options.prefix || ''),
      suffix: String(options.suffix || ''),
      find: String(options.find || ''),
      replacement: String(options.replacement || ''),
      numbering: Boolean(options.numbering),
      numberStart: Math.max(0, Math.min(999999999, Math.trunc(Number.isFinite(Number(options.numberStart)) && options.numberStart !== '' ? Number(options.numberStart) : 1))),
      numberDigits: Math.max(1, Math.min(8, Math.trunc(Number(options.numberDigits) || 3))),
      numberPosition: options.numberPosition === 'prefix' ? 'prefix' : 'suffix',
      numberSeparator: ['-', '_', ' '].includes(options.numberSeparator) ? options.numberSeparator : '-'
    };

    return filePaths.map((source, index) => {
      if (typeof source !== 'string' || !source || Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\')) < 0) throw new Error('Um dos caminhos de arquivo é inválido.');
      const parts = pathParts(source);
      let nextBase = parts.baseName;
      if (settings.find) nextBase = nextBase.split(settings.find).join(settings.replacement);
      nextBase = `${settings.prefix}${nextBase}${settings.suffix}`;
      if (settings.numbering) {
        const number = String(settings.numberStart + index).padStart(settings.numberDigits, '0');
        const numbered = settings.numberPosition === 'prefix'
          ? `${number}${settings.numberSeparator}${nextBase}`
          : `${nextBase}${settings.numberSeparator}${number}`;
        nextBase = numbered;
      }
      const newName = `${nextBase}${parts.extension}`;
      return {
        source,
        directory: parts.directory,
        originalName: parts.originalName,
        originalBaseName: parts.baseName,
        extension: parts.extension,
        newBaseName: nextBase,
        newName,
        destination: `${parts.directory}${newName}`,
        changed: newName !== parts.originalName,
        status: 'pending',
        message: ''
      };
    });
  }

  function validateRenamePlan(plan, fileExists = () => false) {
    if (!Array.isArray(plan) || !plan.length) return { valid: false, items: [], changedCount: 0, errorCount: 0 };
    const sourceCounts = new Map();
    const targetCounts = new Map();
    for (const item of plan) {
      const source = pathKey(item.source);
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
      if (item.changed) {
        const target = pathKey(item.destination);
        targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
      }
    }
    const movingSources = new Set(plan.filter(item => item.changed).map(item => pathKey(item.source)));
    let changedCount = 0;
    let errorCount = 0;
    const items = plan.map(item => {
      let status = 'ready';
      let message = 'Pronto';
      if (sourceCounts.get(pathKey(item.source)) > 1) {
        status = 'invalid'; message = 'Arquivo selecionado mais de uma vez';
      } else if (!item.changed) {
        status = 'no-change'; message = 'Sem alteração';
      } else if (!item.newBaseName || item.newBaseName === '.' || item.newBaseName === '..' || /[. ]$/.test(item.newBaseName) || INVALID_FILENAME_CHARACTERS.test(item.newBaseName) || RESERVED_FILENAME.test(item.newName)) {
        status = 'invalid'; message = 'Nome inválido no Windows';
      } else if (item.newName.length > MAX_FILENAME_LENGTH) {
        status = 'invalid'; message = 'Nome excede 255 caracteres';
      } else if (targetCounts.get(pathKey(item.destination)) > 1) {
        status = 'duplicate'; message = 'Dois arquivos ficariam com este nome';
      } else if (fileExists(item.destination) && !movingSources.has(pathKey(item.destination))) {
        status = 'exists'; message = 'Já existe um arquivo com este nome';
      }
      if (status === 'ready') changedCount += 1;
      else if (status !== 'no-change') errorCount += 1;
      return { ...item, status, message };
    });
    return {
      valid: changedCount > 0 && errorCount === 0,
      items,
      changedCount,
      errorCount
    };
  }

  return { MAX_ITEMS, createRenamePlan, validateRenamePlan };
});
