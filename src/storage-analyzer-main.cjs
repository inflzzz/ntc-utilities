const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

function pathKey(value) { const resolved = path.resolve(String(value || '')); return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved; }
function isSystemPath(value) { const normalized = pathKey(value); return process.platform === 'win32' && [/^[a-z]:\\windows(?:\\|$)/i, /^[a-z]:\\program files(?: \(x86\))?(?:\\|$)/i, /^[a-z]:\\programdata(?:\\|$)/i, /\\appdata(?:\\|$)/i].some(pattern => pattern.test(normalized)); }

async function listWindowsDrives() {
  const roots = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `${letter}:\\`);
  const results = await Promise.all(roots.map(async root => {
    try { await fs.promises.access(root, fs.constants.R_OK); const stat = await fs.promises.statfs(root); const total = Number(stat.blocks) * Number(stat.bsize); const free = Number(stat.bavail) * Number(stat.bsize); return { path: root, name: root, total, free, used: Math.max(0, total - free) }; }
    catch { return null; }
  }));
  return results.filter(Boolean);
}

class StorageAnalyzerService {
  constructor({ ipcMain, dialog, shell, clipboard, getWindow, workerFile, helperFile }) {
    this.ipcMain = ipcMain; this.dialog = dialog; this.shell = shell; this.clipboard = clipboard; this.getWindow = getWindow;
    this.workerFile = workerFile || path.join(__dirname, 'storage-analyzer-worker.cjs');
    this.helperFile = helperFile || '';
    this.worker = null; this.cancelView = null; this.authorizedRoots = new Set(); this.pending = new Map(); this.nextRequestId = 1; this.status = { status: 'idle' }; this.bridgeProfile = { workerToMainIpcMs: 0, workerToMainIpcMessages: 0, mainToRendererSendMs: 0, mainToRendererMessages: 0 };
  }
  send(channel, payload) { const window = this.getWindow(); if (window && !window.isDestroyed()) { window.webContents.send(channel, payload); return true; } return false; }
  async drives() { const drives = process.platform === 'win32' ? await listWindowsDrives() : [{ path: '/', name: '/', ...(await this.statfs('/')) }]; for (const drive of drives) this.authorizedRoots.add(pathKey(drive.path)); return drives; }
  async statfs(root) { const stat = await fs.promises.statfs(root); const total = Number(stat.blocks) * Number(stat.bsize), free = Number(stat.bavail) * Number(stat.bsize); return { total, free, used: total - free }; }
  async chooseFolder() { const result = await this.dialog.showOpenDialog(this.getWindow(), { title: 'Escolha uma pasta para analisar', properties: ['openDirectory'] }); if (result.canceled || !result.filePaths[0]) return null; const root = path.resolve(result.filePaths[0]); this.authorizedRoots.add(pathKey(root)); const usage = await this.statfs(root).catch(() => ({ total: 0, free: 0, used: 0 })); return { path: root, name: path.basename(root) || root, ...usage }; }
  validateRoot(root) { const resolved = path.resolve(String(root || '')); if (!this.authorizedRoots.has(pathKey(resolved))) throw new Error('Escolha o disco ou a pasta dentro do Analisador de Armazenamento.'); return resolved; }
  async start(root) {
    root = this.validateRoot(root); await this.stopWorker();
    this.bridgeProfile = { workerToMainIpcMs: 0, workerToMainIpcMessages: 0, mainToRendererSendMs: 0, mainToRendererMessages: 0 };
    const cancelBuffer = new SharedArrayBuffer(4); this.cancelView = new Int32Array(cancelBuffer); this.status = { status: 'starting', rootPath: root };
    const worker = this.worker = new Worker(this.workerFile); worker.on('message', message => this.onMessage(worker, message)); worker.on('error', error => { this.status = { status: 'error', message: error.message }; this.send('storage-analyzer-event', this.status); this.rejectPending(error); }); worker.on('exit', code => { if (this.worker === worker && code !== 0 && this.status.status !== 'cancelled') { this.status = { status: 'error', message: `O scanner foi encerrado (código ${code}).` }; this.send('storage-analyzer-event', this.status); } });
    await new Promise((resolve, reject) => { const ready = message => { if (message?.type === 'ready') { worker.off('message', ready); resolve(); } }; worker.on('message', ready); worker.once('error', reject); });
    worker.postMessage({ type: 'scan', rootPath: root, cancelBuffer, helperPath: this.helperFile, profile: true }); this.status = { status: 'scanning', rootPath: root }; return this.status;
  }
  onMessage(worker, message) {
    if (worker !== this.worker) return;
    if (message.type === 'progress' || message.type === 'complete' || message.type === 'cancelled' || message.type === 'failure') {
      const payload = message.payload || {};
      if (Number.isFinite(payload.workerSentAtEpochMs)) {
        this.bridgeProfile.workerToMainIpcMs += Math.max(0, Date.now() - payload.workerSentAtEpochMs);
        this.bridgeProfile.workerToMainIpcMessages++;
      }
      if (message.type === 'complete') {
        payload.profile = payload.profile || {};
        Object.assign(payload.profile, this.bridgeProfile);
      }
      payload.mainSentAtEpochMs = Date.now();
      this.status = payload;
      const sendStarted = performance.now();
      const delivered = this.send('storage-analyzer-event', payload);
      const sendElapsed = performance.now() - sendStarted;
      this.bridgeProfile.mainToRendererSendMs += sendElapsed;
      if (delivered) this.bridgeProfile.mainToRendererMessages++;
      if (message.type === 'complete') {
        payload.profile.mainToRendererSendMs = this.bridgeProfile.mainToRendererSendMs;
        payload.profile.mainToRendererMessages = this.bridgeProfile.mainToRendererMessages;
      }
    }
    if (message.type === 'rpc') { const pending = this.pending.get(message.requestId); if (!pending) return; this.pending.delete(message.requestId); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
  }
  rpc(action, payload = {}) { if (!this.worker || !['complete','scanning'].includes(this.status.status)) return Promise.reject(new Error('Nenhuma análise disponível.')); const requestId = this.nextRequestId++; return new Promise((resolve, reject) => { this.pending.set(requestId, { resolve, reject }); this.worker.postMessage({ type: 'rpc', requestId, action, payload }); }); }
  cancel() { if (!this.cancelView || this.status.status !== 'scanning') return false; Atomics.store(this.cancelView, 0, 1); return true; }
  async stopWorker() {
    const worker = this.worker;
    if (!worker) return;
    const wasScanning = ['starting', 'scanning'].includes(this.status.status);
    if (this.cancelView) Atomics.store(this.cancelView, 0, 1);
    if (wasScanning) await new Promise(resolve => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(timer); worker.off('message', onMessage); worker.off('exit', finish); resolve(); };
      const onMessage = message => { if (['complete', 'cancelled', 'failure'].includes(message?.type)) finish(); };
      const timer = setTimeout(finish, 7000);
      worker.on('message', onMessage); worker.once('exit', finish);
    });
    if (this.worker === worker) this.worker = null;
    this.cancelView = null;
    this.rejectPending(new Error('A análise anterior foi encerrada.'));
    await worker.terminate().catch(() => {});
  }
  rejectPending(error) { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }
  async itemPath(id) { const item = await this.rpc('item', { id }); if (!item?.path || !pathKey(item.path).startsWith(pathKey(this.status.rootPath))) throw new Error('Item inválido ou fora da análise atual.'); return item; }
  async action(action, id) {
    const item = await this.itemPath(Number(id));
    if (action === 'open') return this.shell.openPath(item.path);
    if (action === 'reveal') { this.shell.showItemInFolder(item.path); return true; }
    if (action === 'copy') { this.clipboard.writeText(item.path); return true; }
    if (action === 'properties') { this.showProperties(item.path); return true; }
    if (action === 'trash') { if (item.id === 0) throw new Error('A raiz da análise não pode ser movida para a Lixeira.'); await this.shell.trashItem(item.path); return this.rpc('remove', { id: item.id }); }
    throw new Error('Ação inválida.');
  }
  showProperties(filePath) {
    if (process.platform !== 'win32') { this.shell.showItemInFolder(filePath); return; }
    const script = "$p=$args[0];$s=New-Object -ComObject Shell.Application;$folder=$s.Namespace((Split-Path -LiteralPath $p));if($folder){$item=$folder.ParseName((Split-Path -Leaf $p));if($item){$item.InvokeVerb('properties')}}";
    spawn('powershell.exe', ['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command', script, filePath], { windowsHide: true, stdio: 'ignore' }).unref();
  }
  register() {
    const handle = (channel, fn) => this.ipcMain.handle(channel, (event, ...args) => { const window = this.getWindow(); if (!window || event.sender !== window.webContents) throw new Error('Solicitação inválida.'); return fn(...args); });
    handle('storage-analyzer-drives', () => this.drives()); handle('storage-analyzer-choose', () => this.chooseFolder()); handle('storage-analyzer-start', root => this.start(root)); handle('storage-analyzer-cancel', () => this.cancel()); handle('storage-analyzer-status', () => this.status);
    handle('storage-analyzer-query', value => this.rpc('query', value)); handle('storage-analyzer-treemap', value => this.rpc('treemap', value)); handle('storage-analyzer-types', () => this.rpc('types')); handle('storage-analyzer-findings', () => this.rpc('findings')); handle('storage-analyzer-item', id => this.rpc('item', { id })); handle('storage-analyzer-action', (action, id) => this.action(action, id));
    return this;
  }
  dispose() { return this.stopWorker(); }
}

module.exports = { StorageAnalyzerService, listWindowsDrives, pathKey, isSystemPath };
