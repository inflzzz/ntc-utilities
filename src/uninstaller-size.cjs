// Read-only size discovery. Inferred paths are never used by the removal/ownership engine.
const fs = require('node:fs');
const path = require('node:path');

const numericSize = value => Number.isSafeInteger(value) && value >= 0;
function broadRoot(root) {
  const normalize = value => path.resolve(value).toLowerCase();
  const candidate = normalize(root);
  if (candidate === normalize(path.parse(root).root)) return true;
  const parents = ['WINDIR', 'SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP'];
  return parents.some(key => process.env[key] && candidate === normalize(process.env[key])) ||
    /[\\/](?:common files|steamapps|steamapps[\\/]common|windows[\\/](?:system32|syswow64)|windowsapps)$/i.test(root);
}
function pathCandidates(program) {
  const roots = [];
  const expand = value => String(value || '').trim().replace(/%([^%]+)%/g, (match, key) => process.env[key] || match);
  const add = (value, inferred = false) => {
    if (!value || !path.isAbsolute(value) || value.startsWith('\\\\')) return;
    const root = path.resolve(value);
    if (broadRoot(root) || roots.some(row => row.root.toLowerCase() === root.toLowerCase())) return;
    // A launcher/uninstaller in Windows is not the application's own directory.
    if (inferred && process.env.WINDIR && root.toLowerCase().startsWith(path.resolve(process.env.WINDIR).toLowerCase() + path.sep)) return;
    roots.push({ root, inferred });
  };
  add(program.location);
  if (!roots.length) {
    const icon = expand(program.icon).replace(/^"([^"]+)".*$/, '$1').replace(/,-?\d+$/, '');
    if (path.isAbsolute(icon)) add(path.dirname(icon), true);
    const command = expand(program.command || program.quiet);
    const match = command.match(/^\s*"([^"]+\.exe)"/i) || command.match(/^\s*(.+?\.exe)(?=\s|$)/i);
    if (match && !/steam:\/\/|com\.epicgames\.launcher|\/appid\b/i.test(command)) add(path.dirname(match[1]), true);
  }
  return roots;
}
async function steamSize(program) {
  const appId = String(program.key || '').match(/\\Steam App (\d+)$/)?.[1];
  const root = program.location;
  if (!appId || !root || path.basename(path.dirname(root)).toLowerCase() !== 'common' || path.basename(path.dirname(path.dirname(root))).toLowerCase() !== 'steamapps') return null;
  try {
    const manifest = path.join(path.dirname(path.dirname(root)), `appmanifest_${appId}.acf`);
    if ((await fs.promises.stat(manifest)).size > 1024 * 1024) return null;
    const text = await fs.promises.readFile(manifest, 'utf8');
    const field = name => { const matches = [...text.matchAll(new RegExp(`^\\s*"${name}"\\s*"([^"\\r\\n]*)"`, 'gm'))]; return matches.length === 1 ? matches[0][1] : ''; };
    const directory = field('installdir'), rawSize = field('SizeOnDisk');
    if (field('appid') !== appId || !directory || path.isAbsolute(directory) || !/^\d+$/.test(rawSize)) return null;
    if (path.resolve(path.dirname(root), directory).toLowerCase() !== path.resolve(root).toLowerCase()) return null;
    const bytes = Number(rawSize);
    if (!numericSize(bytes) || !(await fs.promises.stat(root)).isDirectory()) return null;
    return { bytes, source: 'Biblioteca Steam · tamanho registrado; verificação da pasta em andamento', root };
  } catch { return null; }
}
function checkAbort(signal) { if (signal?.aborted) { const error = new Error('Medição cancelada.'); error.name = 'AbortError'; throw error; } }
async function measureDirectory(root, signal) {
  const stack = [root]; let bytes = 0, files = 0, directories = 0, skipped = 0, reason = '';
  while (stack.length) {
    checkAbort(signal); const directory = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); directories++; }
    catch (error) { skipped++; reason ||= error.code === 'EACCES' || error.code === 'EPERM' ? 'O Windows negou acesso a parte da pasta.' : 'Algumas entradas não puderam ser lidas ou mudaram durante a medição.'; continue; }
    for (let index = 0; index < entries.length; index += 16) {
      checkAbort(signal);
      await Promise.all(entries.slice(index, index + 16).map(async entry => {
        const file = path.join(directory, entry.name);
        try {
          // lstat is intentional: do not follow links into other apps, volumes or cycles.
          const info = await fs.promises.lstat(file);
          if (info.isSymbolicLink()) { skipped++; reason ||= 'Links e junctions internos não são somados para evitar duplicidade e ciclos.'; }
          else if (info.isDirectory()) stack.push(file);
          else if (info.isFile()) { bytes += info.size; files++; }
        } catch { skipped++; reason ||= 'Algumas entradas não puderam ser lidas ou mudaram durante a medição.'; }
      }));
    }
  }
  return { bytes: directories ? bytes : null, partial: skipped > 0, files, skipped, reason, root, source: 'Soma dos tamanhos dos arquivos da pasta de instalação', status: directories ? 'complete' : 'unavailable' };
}

class InstallationSizes {
  constructor() { this.cache = new Map(); this.controller = new AbortController(); }
  invalidate() { this.controller.abort(); this.controller = new AbortController(); this.cache.clear(); }
  dispose() { this.invalidate(); }
  async initial(program) {
    const steam = await steamSize(program);
    return steam ? { size: steam.bytes, sizeSource: steam.source, sizeStatus: 'pending', sizeRoot: steam.root } : { sizeStatus: 'pending' };
  }
  async measure(program, force = false) {
    const key = [program.id, program.fingerprint, program.location, program.command, program.icon].join('|');
    const old = this.cache.get(key);
    if (!force && old && Date.now() - old.created < 120000) return old.promise;
    const signal = this.controller.signal;
    const promise = (async () => {
      checkAbort(signal);
      for (const candidate of pathCandidates(program)) {
        try {
          const info = await fs.promises.stat(candidate.root);
          if (!info.isDirectory()) continue;
          // Resolve a root junction once; skip links within the measured installation.
          const realRoot = await fs.promises.realpath(candidate.root);
          if (broadRoot(realRoot)) continue;
          const result = await measureDirectory(realRoot, signal);
          if (candidate.inferred) { result.source += ' · localização inferida do executável/ícone'; result.inferred = true; }
          return result;
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          if (error.code === 'EACCES' || error.code === 'EPERM') return { bytes: null, status: 'unavailable', reason: 'O Windows negou acesso à pasta de instalação.' };
        }
      }
      // Registration estimates remain a labelled fallback when no attributable folder exists.
      if (numericSize(program.size)) return { bytes: program.size, source: program.sizeSource || 'Tamanho registrado pelo instalador', partial: false, status: 'registered', reason: 'Não foi possível localizar uma pasta própria para verificar este tamanho.' };
      return { bytes: null, status: 'unavailable', reason: 'A instalação não registra uma pasta própria e não foi possível localizá-la pelo executável ou ícone.' };
    })();
    this.cache.set(key, { created: Date.now(), promise });
    if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value);
    promise.catch(() => { if (this.cache.get(key)?.promise === promise) this.cache.delete(key); });
    return promise;
  }
}
module.exports = { InstallationSizes, measureDirectory, steamSize, pathCandidates };
