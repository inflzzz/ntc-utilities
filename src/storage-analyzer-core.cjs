const path = require('node:path');

const TYPE = Object.freeze({ DIRECTORY: 1, FILE: 2, LINK: 3, OTHER: 4, DELETED: 255 });
const CATEGORY_NAMES = ['Outros', 'Vídeo', 'Imagem', 'Áudio', 'Compactado', 'Executável', 'Documento', 'Código', 'Sistema'];
const EXTENSION_CATEGORY = new Map();
for (const [category, extensions] of Object.entries({
  1: ['mp4','mkv','mov','avi','webm','wmv','m4v','mpeg','mpg','ts'],
  2: ['jpg','jpeg','png','gif','webp','bmp','tif','tiff','heic','avif','svg','ico'],
  3: ['mp3','wav','flac','aac','m4a','ogg','opus','wma'],
  4: ['zip','rar','7z','tar','gz','bz2','xz','cab','iso'],
  5: ['exe','dll','msi','msix','appx','sys','com','scr'],
  6: ['pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','txt','rtf','epub'],
  7: ['js','cjs','mjs','ts','tsx','jsx','css','scss','html','htm','json','xml','yaml','yml','py','cs','cpp','c','h','hpp','java','go','rs','php','rb','sql','sh','ps1'],
  8: ['dat','edb','evtx','mui','drv','dmp','etl']
})) for (const extension of extensions) EXTENSION_CATEGORY.set(extension, Number(category));

function categoryForName(name) {
  const extension = path.extname(String(name || '')).slice(1).toLocaleLowerCase('en-US');
  return { id: EXTENSION_CATEGORY.get(extension) || 0, extension };
}

function normalizeFilter(value = {}) {
  const kind = ['all','files','folders'].includes(value.kind) ? value.kind : 'all';
  const hasCategory = value.category !== null && value.category !== undefined && value.category !== '';
  const category = hasCategory ? Number(value.category) : Number.NaN;
  return {
    query: String(value.query || '').trim().toLocaleLowerCase(),
    path: String(value.path || '').trim().toLocaleLowerCase(),
    extension: String(value.extension || '').trim().replace(/^\./, '').toLocaleLowerCase(),
    category: Number.isInteger(category) && category >= 0 && category < CATEGORY_NAMES.length ? category : null,
    minSize: Math.max(0, Number(value.minSize) || 0),
    maxSize: Number.isFinite(Number(value.maxSize)) && Number(value.maxSize) > 0 ? Number(value.maxSize) : Number.MAX_SAFE_INTEGER,
    olderThan: Math.max(0, Number(value.olderThan) || 0),
    kind
  };
}

class CompactStorageModel {
  constructor(rootPath = '', options = {}) {
    this.rootPath = path.resolve(rootPath || '.');
    this.capacity = Math.max(1024, Number(options.capacity) || 4096);
    this.count = 0;
    this.names = new Array(this.capacity);
    this.extensions = new Array(this.capacity);
    this.parent = new Int32Array(this.capacity);
    this.type = new Uint8Array(this.capacity);
    this.category = new Uint8Array(this.capacity);
    this.logical = new Float64Array(this.capacity);
    this.allocated = new Float64Array(this.capacity);
    this.mtime = new Float64Array(this.capacity);
    this.fileCount = new Uint32Array(this.capacity);
    this.folderCount = new Uint32Array(this.capacity);
    this.allocationUnknown = new Uint32Array(this.capacity);
    this.flags = new Uint8Array(this.capacity);
    this.children = new Map();
    this.errors = [];
    this.extensionTotals = new Map();
    this.categoryTotals = Array.from({ length: CATEGORY_NAMES.length }, () => ({ count: 0, logical: 0, allocated: 0 }));
    this.directoryCategoryTotals = new Map();
    this.finalized = false;
    this.rootId = this.addDirectory(path.basename(this.rootPath) || this.rootPath, -1, Date.now());
  }

  ensureCapacity(needed) {
    if (needed <= this.capacity) return;
    let capacity = this.capacity;
    while (capacity < needed) capacity *= 2;
    const grow = (value, Type) => { const next = new Type(capacity); next.set(value); return next; };
    this.parent = grow(this.parent, Int32Array); this.type = grow(this.type, Uint8Array); this.category = grow(this.category, Uint8Array);
    this.logical = grow(this.logical, Float64Array); this.allocated = grow(this.allocated, Float64Array); this.mtime = grow(this.mtime, Float64Array);
    this.fileCount = grow(this.fileCount, Uint32Array); this.folderCount = grow(this.folderCount, Uint32Array); this.allocationUnknown = grow(this.allocationUnknown, Uint32Array); this.flags = grow(this.flags, Uint8Array);
    this.names.length = capacity; this.extensions.length = capacity; this.capacity = capacity;
  }

  addBase(name, parentId, type, modified) {
    const id = this.count++;
    this.ensureCapacity(this.count);
    this.names[id] = String(name || ''); this.parent[id] = Number(parentId); this.type[id] = type; this.mtime[id] = Number(modified) || 0;
    if (parentId >= 0) { let list = this.children.get(parentId); if (!list) this.children.set(parentId, list = []); list.push(id); }
    return id;
  }

  addDirectory(name, parentId, modified = 0) {
    const id = this.addBase(name, parentId, TYPE.DIRECTORY, modified);
    this.folderCount[id] = 1;
    return id;
  }

  addLink(name, parentId, modified = 0) { return this.addBase(name, parentId, TYPE.LINK, modified); }

  addFile(name, parentId, logical, allocated, modified = 0, duplicatePhysical = false, allocationEstimated = false) {
    const id = this.addBase(name, parentId, TYPE.FILE, modified);
    const classification = categoryForName(name);
    this.extensions[id] = classification.extension; this.category[id] = classification.id;
    this.logical[id] = Math.max(0, Number(logical) || 0);
    this.allocated[id] = duplicatePhysical ? 0 : Math.max(0, Number(allocated) || 0);
    this.flags[id] = (duplicatePhysical ? 1 : 0) | (allocationEstimated ? 2 : 0); this.fileCount[id] = 1; this.allocationUnknown[id] = allocationEstimated ? 1 : 0;
    const category = this.categoryTotals[classification.id]; category.count++; category.logical += this.logical[id]; category.allocated += this.allocated[id];
    let directoryCategories = this.directoryCategoryTotals.get(parentId); if (!directoryCategories) this.directoryCategoryTotals.set(parentId, directoryCategories = new Float64Array(CATEGORY_NAMES.length)); directoryCategories[classification.id] += this.allocated[id];
    const extensionKey = classification.extension || '(sem extensão)';
    const extension = this.extensionTotals.get(extensionKey) || { extension: extensionKey, category: classification.id, count: 0, logical: 0, allocated: 0 };
    extension.count++; extension.logical += this.logical[id]; extension.allocated += this.allocated[id]; this.extensionTotals.set(extensionKey, extension);
    return id;
  }

  addError(error) {
    if (this.errors.length < 500) this.errors.push({ path: String(error.path || ''), code: String(error.code || 'UNKNOWN'), message: String(error.message || 'Não foi possível acessar este item.') });
  }

  finalize() {
    if (this.finalized) return this;
    for (let id = this.count - 1; id > 0; id--) {
      if (this.type[id] === TYPE.DELETED) continue;
      const parent = this.parent[id];
      if (parent < 0) continue;
      this.logical[parent] += this.logical[id]; this.allocated[parent] += this.allocated[id];
      this.fileCount[parent] += this.fileCount[id]; this.folderCount[parent] += this.folderCount[id];
      this.allocationUnknown[parent] += this.allocationUnknown[id];
      if (this.mtime[id] > this.mtime[parent]) this.mtime[parent] = this.mtime[id];
      if (this.type[id] === TYPE.DIRECTORY) {
        const own = this.directoryCategoryTotals.get(id);
        if (own) {
          let dominant = 0; for (let category = 1; category < own.length; category++) if (own[category] > own[dominant]) dominant = category; this.category[id] = dominant;
          let parentCategories = this.directoryCategoryTotals.get(parent); if (!parentCategories) this.directoryCategoryTotals.set(parent, parentCategories = new Float64Array(CATEGORY_NAMES.length)); for (let category = 0; category < own.length; category++) parentCategories[category] += own[category];
        }
      }
    }
    const rootCategories = this.directoryCategoryTotals.get(this.rootId); if (rootCategories) { let dominant = 0; for (let category = 1; category < rootCategories.length; category++) if (rootCategories[category] > rootCategories[dominant]) dominant = category; this.category[this.rootId] = dominant; }
    this.directoryCategoryTotals = null;
    this.finalized = true;
    return this;
  }

  itemPath(id) {
    if (!Number.isInteger(id) || id < 0 || id >= this.count || this.type[id] === TYPE.DELETED) return '';
    if (id === this.rootId) return this.rootPath;
    const parts = [];
    for (let cursor = id; cursor > this.rootId && cursor >= 0; cursor = this.parent[cursor]) parts.push(this.names[cursor]);
    return path.join(this.rootPath, ...parts.reverse());
  }

  item(id) {
    if (!Number.isInteger(id) || id < 0 || id >= this.count || this.type[id] === TYPE.DELETED) return null;
    return { id, parentId: this.parent[id], name: this.names[id], path: this.itemPath(id), type: this.type[id] === TYPE.DIRECTORY ? 'folder' : this.type[id] === TYPE.FILE ? 'file' : 'link', extension: this.extensions[id] || '', category: CATEGORY_NAMES[this.category[id]] || CATEGORY_NAMES[0], categoryId: this.category[id], logical: this.logical[id], allocated: this.allocated[id], allocationUnknown: this.allocationUnknown[id], allocationEstimated: Boolean(this.flags[id] & 2), modified: this.mtime[id], files: this.fileCount[id], folders: Math.max(0, this.folderCount[id] - (this.type[id] === TYPE.DIRECTORY ? 1 : 0)), duplicatePhysical: Boolean(this.flags[id] & 1) };
  }

  breadcrumbs(id) {
    const result = [];
    for (let cursor = id; cursor >= 0; cursor = this.parent[cursor]) { const item = this.item(cursor); if (item) result.push({ id: cursor, name: cursor === this.rootId ? this.rootPath : item.name }); }
    return result.reverse();
  }

  matches(id, rawFilter) {
    const filter = rawFilter.query === undefined ? normalizeFilter(rawFilter) : rawFilter;
    const type = this.type[id];
    if (type === TYPE.DELETED || type === TYPE.LINK || type === TYPE.OTHER) return false;
    if (filter.kind === 'files' && type !== TYPE.FILE || filter.kind === 'folders' && type !== TYPE.DIRECTORY) return false;
    const size = this.allocated[id];
    if (size < filter.minSize || size > filter.maxSize) return false;
    if (filter.category !== null && (type !== TYPE.FILE || this.category[id] !== filter.category)) return false;
    if (filter.extension && (type !== TYPE.FILE || this.extensions[id] !== filter.extension)) return false;
    if (filter.olderThan && (!this.mtime[id] || this.mtime[id] > Date.now() - filter.olderThan)) return false;
    if (filter.query) {
      const name = this.names[id].toLocaleLowerCase();
      if (!name.includes(filter.query)) return false;
    }
    if (filter.path && !this.itemPath(id).toLocaleLowerCase().includes(filter.path)) return false;
    return true;
  }

  query(options = {}) {
    this.finalize();
    const filter = normalizeFilter({ ...options.filters, query: options.query ?? options.filters?.query, kind: options.kind || options.filters?.kind });
    const sort = ['name','modified','logical','allocated'].includes(options.sort) ? options.sort : 'allocated';
    const direction = options.direction === 'asc' ? 1 : -1;
    const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
    const limit = Math.min(250, Math.max(1, Math.floor(Number(options.limit) || 100)));
    const candidates = [];
    const cap = 20000;
    for (let id = 0; id < this.count; id++) {
      if (!this.matches(id, filter)) continue;
      candidates.push(id);
      if (candidates.length >= cap && filter.query) break;
    }
    const values = sort === 'modified' ? this.mtime : this[sort];
    const compare = sort === 'name' ? (a,b) => this.names[a].localeCompare(this.names[b], 'pt-BR') * direction : (a,b) => ((values[a] - values[b]) || this.names[a].localeCompare(this.names[b], 'pt-BR')) * direction;
    candidates.sort(compare);
    return { total: candidates.length, capped: candidates.length === cap && Boolean(filter.query), offset, limit, items: candidates.slice(offset, offset + limit).map(id => this.item(id)) };
  }

  typeBreakdown() {
    this.finalize();
    const total = this.allocated[this.rootId] || 0;
    const categories = this.categoryTotals.map((entry, id) => ({ id, name: CATEGORY_NAMES[id], ...entry, percent: total ? entry.allocated / total * 100 : 0 })).filter(entry => entry.count).sort((a,b) => b.allocated - a.allocated);
    const extensions = [...this.extensionTotals.values()].filter(entry => entry.count).map(entry => ({ ...entry, categoryName: CATEGORY_NAMES[entry.category], percent: total ? entry.allocated / total * 100 : 0 })).sort((a,b) => b.allocated - a.allocated);
    return { categories, extensions: extensions.slice(0, 250) };
  }

  treemap(rootId = this.rootId, rawFilter = {}, maxNodes = 5000, sizeKey = 'allocated') {
    this.finalize();
    const root = this.item(Number(rootId));
    if (!root || root.type !== 'folder') throw new Error('Pasta do mapa inválida.');
    const filter = normalizeFilter(rawFilter);
    const useFilter = Boolean(filter.query || filter.path || filter.extension || filter.category !== null || filter.minSize || filter.maxSize < Number.MAX_SAFE_INTEGER || filter.olderThan || filter.kind !== 'all');
    const metric = sizeKey === 'logical' ? this.logical : this.allocated;
    const limit = Math.max(1, Math.min(5000, Number(maxNodes) || 5000));
    const makeNode = id => ({ id, parentId: this.parent[id], name: this.names[id], type: this.type[id] === TYPE.DIRECTORY ? 'folder' : 'file', logical: this.logical[id], allocated: this.allocated[id], allocationUnknown: this.allocationUnknown[id], allocationEstimated: Boolean(this.flags[id] & 2), modified: this.mtime[id], categoryId: this.category[id], category: CATEGORY_NAMES[this.category[id]], extension: this.extensions[id] || '', files: this.fileCount[id], folders: Math.max(0, this.folderCount[id] - 1), duplicatePhysical: Boolean(this.flags[id] & 1), childCount: 0, children: [] });
    const nodes = [makeNode(root.id)], queue = [0];
    let truncated = false;
    for (let cursor = 0; cursor < queue.length && nodes.length < limit; cursor++) {
      const index = queue[cursor], id = nodes[index].id;
      const children = (this.children.get(id) || []).filter(child => this.type[child] !== TYPE.DELETED && this.type[child] !== TYPE.LINK);
      nodes[index].childCount = children.length;
      const visible = children.filter(child => !useFilter || this.type[child] === TYPE.DIRECTORY || this.matches(child, filter));
      visible.sort((a,b) => metric[b] - metric[a]);
      const allowance = Math.min(128, limit - nodes.length);
      if (visible.length > allowance) truncated = true;
      for (const child of visible.slice(0, allowance)) {
        const childIndex = nodes.length;
        nodes.push(makeNode(child)); nodes[index].children.push(childIndex);
        if (this.type[child] === TYPE.DIRECTORY) queue.push(childIndex);
      }
    }
    if (queue.length && nodes.length >= limit) truncated = true;
    return { rootId: root.id, root, breadcrumbs: this.breadcrumbs(root.id), nodes, truncated, totalNodes: this.count };
  }

  hasMatchingDescendant(id, filter, budget) {
    const stack = [...(this.children.get(id) || [])]; let visited = 0;
    while (stack.length && visited++ < budget) { const child = stack.pop(); if (this.type[child] === TYPE.FILE && this.matches(child, filter)) return true; if (this.type[child] === TYPE.DIRECTORY) stack.push(...(this.children.get(child) || [])); }
    return false;
  }

  findings(now = Date.now()) {
    this.finalize();
    const findings = [];
    const add = (id, label, predicate) => { let count = 0, allocated = 0; for (let index = 1; index < this.count; index++) if (this.type[index] === TYPE.FILE && predicate(index)) { count++; allocated += this.allocated[index]; } if (count) findings.push({ id, label, count, allocated }); };
    add('huge', 'Arquivos maiores que 5 GB', id => this.allocated[id] >= 5 * 1024 ** 3);
    add('old', 'Arquivos sem modificação há mais de 2 anos', id => this.mtime[id] > 0 && this.mtime[id] < now - 730 * 86400000);
    add('old-archives', 'Arquivos compactados antigos', id => this.category[id] === 4 && this.mtime[id] > 0 && this.mtime[id] < now - 365 * 86400000);
    add('downloads', 'Arquivos antigos em Downloads', id => this.mtime[id] > 0 && this.mtime[id] < now - 365 * 86400000 && this.itemPath(id).toLocaleLowerCase().includes(`${path.sep}downloads${path.sep}`));
    return findings.sort((a,b) => b.allocated - a.allocated);
  }

  summary(status = 'complete', elapsedMs = 0) {
    this.finalize();
    return { status, rootPath: this.rootPath, root: this.item(this.rootId), entries: this.count, files: this.fileCount[this.rootId], folders: Math.max(0, this.folderCount[this.rootId] - 1), logical: this.logical[this.rootId], allocated: this.allocated[this.rootId], allocationUnknown: this.allocationUnknown[this.rootId], errors: this.errors.length, errorDetails: this.errors.slice(0, 100), elapsedMs, memoryBytes: this.memoryEstimate() };
  }

  memoryEstimate() { return this.count * (4 + 1 + 1 + 8 + 8 + 8 + 4 + 4 + 4 + 1) + this.names.slice(0, this.count).reduce((sum, name) => sum + String(name || '').length * 2, 0); }

  removeItem(id) {
    this.finalize();
    if (!Number.isInteger(id) || id <= this.rootId || id >= this.count || this.type[id] === TYPE.DELETED) return false;
    const logical = this.logical[id], allocated = this.allocated[id], files = this.fileCount[id], folders = this.folderCount[id], unknown = this.allocationUnknown[id];
    for (let cursor = this.parent[id]; cursor >= 0; cursor = this.parent[cursor]) { this.logical[cursor] = Math.max(0, this.logical[cursor] - logical); this.allocated[cursor] = Math.max(0, this.allocated[cursor] - allocated); this.fileCount[cursor] = Math.max(0, this.fileCount[cursor] - files); this.folderCount[cursor] = Math.max(0, this.folderCount[cursor] - folders); this.allocationUnknown[cursor] = Math.max(0, this.allocationUnknown[cursor] - unknown); }
    const stack = [id]; while (stack.length) { const current = stack.pop(); if (this.type[current] === TYPE.FILE) { const category = this.categoryTotals[this.category[current]]; category.count = Math.max(0, category.count - 1); category.logical = Math.max(0, category.logical - this.logical[current]); category.allocated = Math.max(0, category.allocated - this.allocated[current]); const extension = this.extensionTotals.get(this.extensions[current] || '(sem extensão)'); if (extension) { extension.count = Math.max(0, extension.count - 1); extension.logical = Math.max(0, extension.logical - this.logical[current]); extension.allocated = Math.max(0, extension.allocated - this.allocated[current]); } } this.type[current] = TYPE.DELETED; stack.push(...(this.children.get(current) || [])); }
    return true;
  }
}

module.exports = { CompactStorageModel, TYPE, CATEGORY_NAMES, categoryForName, normalizeFilter };
