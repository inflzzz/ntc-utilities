const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { InstallationSizes } = require('./uninstaller-size.cjs');

class UninstallerHost {
  constructor({ helper, root }) { this.helper = helper; this.root = root; this.pending = new Map(); this.seq = 0; this.child = null; this.stream = null; this.buffer = ''; this.elevated = false; }
  attach(readable, writable) {
    this.stream = writable; this.buffer = '';
    readable.setEncoding('utf8');
    readable.on('data', chunk => {
      this.buffer += chunk;
      if (this.buffer.length > 70 * 1024 * 1024) { this.fail(new Error('Resposta do helper excedeu o limite.')); return; }
      let pos;
      while ((pos = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, pos); this.buffer = this.buffer.slice(pos + 1);
        try { const result = JSON.parse(line); const pending = this.pending.get(result.seq); if (!pending) continue; this.pending.delete(result.seq); result.error ? pending.reject(new Error(result.error)) : pending.resolve(result.result); }
        catch (error) { this.fail(error); }
      }
    });
    readable.once('end', () => { if (this.stream === writable) this.fail(new Error('O helper foi encerrado. Atualize a lista.')); });
    readable.on('error', error => { if (this.stream === writable) this.fail(error); });
  }
  fail(error) { for (const request of this.pending.values()) request.reject(error); this.pending.clear(); this.stream = null; }
  start() {
    if (this.stream) return;
    if (process.platform !== 'win32') throw new Error('O Desinstalador está disponível no Windows.');
    if (!fs.existsSync(this.helper)) throw new Error('Helper do Desinstalador ausente. Reinstale esta build do NTC.');
    this.child = spawn(this.helper, [this.root], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.attach(this.child.stdout, this.child.stdin); let stderr = '';
    this.child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    this.child.on('error', error => this.fail(error));
    this.child.once('exit', code => { if (code) this.fail(new Error(stderr || `Helper terminou com código ${code}.`)); });
  }
  async send(action, payload = {}) { this.start(); const seq = ++this.seq; return new Promise((resolve, reject) => { this.pending.set(seq, { resolve, reject }); this.stream.write(`${JSON.stringify({ seq, action, payload })}\n`, error => { if (error) { this.pending.delete(seq); reject(error); } }); }); }
  async elevate() {
    if (this.elevated) return;
    if (this.pending.size) throw new Error('Aguarde a operação atual antes da elevação.');
    const pipe = `ntc-uninstaller-${randomBytes(32).toString('hex')}`;
    const quotePs = value => `'${String(value).replaceAll("'", "''")}'`;
    const helperArgs = [this.root, '--pipe', pipe, '--pid', String(process.pid)].map(arg => `"${arg.replaceAll('"', '\\"')}"`).join(' ');
    const script = `$ErrorActionPreference='Stop'; Start-Process -FilePath ${quotePs(this.helper)} -ArgumentList ${quotePs(helperArgs)} -Verb RunAs -WindowStyle Hidden`;
    const launcher = spawn(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = ''; launcher.stderr.on('data', chunk => { errorText += chunk; });
    await new Promise((resolve, reject) => { launcher.on('error', reject); launcher.on('exit', code => code ? reject(new Error(errorText || 'Elevação cancelada.')) : resolve()); });
    const socket = await new Promise((resolve, reject) => {
      const started = Date.now(); const connect = () => {
        const candidate = net.createConnection(`\\\\.\\pipe\\${pipe}`);
        candidate.once('connect', () => resolve(candidate));
        candidate.once('error', error => { candidate.destroy(); if (Date.now() - started > 12000) reject(new Error(`Não foi possível conectar ao helper elevado: ${error.message}`)); else setTimeout(connect, 200); });
      }; connect();
    });
    this.child?.stdin.end(); this.child = null; this.elevated = true; this.attach(socket, socket);
    return this.send('health');
  }
  async dispose() { if (this.pending.size) await Promise.allSettled([...this.pending.values()].map(request => new Promise(resolve => { const done = request.resolve, failed = request.reject; request.resolve = value => { done(value); resolve(); }; request.reject = error => { failed(error); resolve(); }; }))); this.stream?.end(); this.child?.stdin.end(); }
}

class UninstallerService {
  constructor({ ipcMain, dialog, shell, app, getWindow, helper, host }) {
    Object.assign(this, { ipcMain, dialog, shell, app, getWindow });
    this.host = host || new UninstallerHost({ helper, root: path.join(app.getPath('userData'), 'uninstaller') });
    this.programs = new Map(); this.scans = new Map(); this.scanHosts = new Map(); this.historyHosts = new Map(); this.selectedPaths = new Set(); this.job = null; this.jobTask = null; this.adminHost = null; this.iconCache = new Map();
    this.sizes = new InstallationSizes();
  }
  emit() { const w = this.getWindow(); if (w && !w.isDestroyed()) w.webContents.send('uninstaller-event', this.job); }
  async confirm(message, detail, button = 'Continuar') {
    const result = await this.dialog.showMessageBox(this.getWindow(), {
      title: 'NTC Utilities', type: 'warning', message, detail,
      buttons: ['Cancelar', button], defaultId: 0, cancelId: 0, noLink: true,
    });
    return result.response === 1;
  }
  rememberScan(scan, host = this.host) { if (scan?.id) { this.scans.set(scan.id, scan); this.scanHosts.set(scan.id, host); } return scan; }
  hostFor(program) { return program?.hive === 'HKLM' && this.adminHost ? this.adminHost : this.host; }
  async ensureAdmin() {
    if (this.adminHost) return this.adminHost;
    const host = this.host.helper ? new UninstallerHost({ helper: this.host.helper, root: this.host.root }) : this.host;
    await host.elevate(); await host.send('list'); this.adminHost = host; return host;
  }
  async histories() { const rows = []; for (const host of new Set([this.host, this.adminHost].filter(Boolean))) { for (const row of await host.send('history')) { this.historyHosts.set(row.id, host); rows.push(row); } } return rows.sort((a, b) => String(b.date).localeCompare(String(a.date))); }
  async historyHost(id) { if (!this.historyHosts.has(id)) await this.histories(); const host = this.historyHosts.get(id); if (!host) throw new Error('Histórico fora da lista atual. Autorize operações de sistema para consultar backups elevados.'); return host; }
  async list(appx = false, refreshSizes = false) {
    if (this.job?.busy) throw new Error('Aguarde o término da operação.');
    if (!appx && refreshSizes) { this.sizes.invalidate(); this.iconCache.clear(); }
    const result = await this.host.send(appx ? 'appx' : 'list');
    if (!appx) for (const [id, p] of this.programs) if (p.type !== 'MSIX/AppX') this.programs.delete(id);
    result.items = await Promise.all(result.items.map(async p => ({ ...p, ...await this.sizes.initial(p) })));
    for (const p of result.items) this.programs.set(p.id, p);
    return result;
  }
  program(id) { const program = this.programs.get(String(id)); if (!program) throw new Error('Programa fora da lista atual. Atualize a lista.'); return program; }
  async analyze(id, deep = false, forced = false) {
    const p = this.program(id); if (this.job?.busy) throw new Error('Aguarde a operação atual.');
    if (forced && (p.protected || !await this.confirm(`Análise forçada de ${p.name}?`, 'O desinstalador oficial será ignorado. Revise todas as evidências; dados pessoais e recursos compartilhados permanecem desmarcados. Nenhuma sobra será removida nesta etapa.', 'Analisar'))) return { canceled: true };
    const host = this.hostFor(p); return this.rememberScan(await host.send('analyze', { id, deep: !!deep, forced: !!forced }), host);
  }
  async queue(ids, quiet, restorePoint) {
    if (this.job?.busy) throw new Error('Já existe uma operação em andamento.');
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) throw new Error('Seleção inválida.');
    ids = [...new Set(ids)]; const programs = ids.map(id => this.program(id));
    if (programs.some(p => p.protected)) throw new Error('Remova componentes protegidos da seleção.');
    const single = programs.length === 1;
    const detail = single
      ? 'O NTC iniciará o desinstalador oficial deste programa.'
      : `Programas selecionados:\n${programs.map(p => `• ${p.name}`).join('\n')}\n\nOs desinstaladores oficiais serão executados um por vez.`;
    if (!await this.confirm(
      single ? `Desinstalar “${programs[0].name}”?` : `Desinstalar ${programs.length} programas?`,
      `${detail}\n\nAs sobras serão apresentadas para sua revisão, sem remoção automática.\nO NTC não reiniciará o computador.`,
      single ? 'Desinstalar programa' : 'Desinstalar programas',
    )) return { canceled: true };
    this.sizes.invalidate();
    // Retain an elevated authoritative session from before HKLM uninstall, never import renderer paths into it.
    if (programs.some(p => p.hive === 'HKLM') || restorePoint) await this.ensureAdmin();
    if (restorePoint) await this.adminHost.send('restorePoint');
    this.job = { busy: true, total: ids.length, index: 0, name: '', stage: 'Fila preparada', canceled: false, results: [] }; this.emit();
    this.jobTask = (async () => {
      for (let index = 0; index < ids.length; index++) {
        if (this.job.canceled) break;
        this.job.index = index + 1; this.job.name = programs[index].name; this.job.stage = 'Executando desinstalador oficial'; this.emit();
        try {
          const host = this.hostFor(programs[index]); const result = await host.send('uninstall', { id: ids[index], fingerprint: programs[index].fingerprint, quiet: !!quiet });
          if (result.scan) this.rememberScan(result.scan, host);
          this.job.results.push({ id: ids[index], name: programs[index].name, ...result });
        } catch (error) { this.job.results.push({ id: ids[index], name: programs[index].name, error: error.message }); }
        this.emit();
      }
    })().finally(() => { this.job.busy = false; this.job.stage = this.job.canceled ? 'Fila interrompida após a operação atual' : 'Fila concluída · revise as sobras'; this.emit(); });
    return this.job;
  }
  async clean(scanId, ids) {
    if (this.job?.busy) throw new Error('Aguarde o desinstalador oficial.');
    const scan = this.scans.get(String(scanId)); if (!scan) throw new Error('Análise fora da sessão atual.');
    if (!Array.isArray(ids) || !ids.length || ids.length > 20000 || new Set(ids).size !== ids.length) throw new Error('Seleção inválida.');
    const chosen = ids.map(id => scan.items.find(item => item.id === id)); if (chosen.some(item => !item || !item.eligible || item.confidence === 'low')) throw new Error('Seleção contém item protegido ou sem evidência suficiente.');
    const total = chosen.reduce((sum, item) => sum + (Number(item.size) || 0), 0), personal = chosen.filter(item => item.personal).length;
    if (!await this.confirm(`Mover ${chosen.length} itens para quarentena e fazer backup do registro?`, `${scan.program.name}\n${(total / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB de arquivos conhecidos.\n${personal ? `ATENÇÃO: ${personal} item(ns) contêm dados pessoais selecionados por você.\n` : ''}Os caminhos e valores serão revalidados. Falhas e conflitos serão preservados e registrados.`, 'Remover selecionados')) return { canceled: true };
    const result = await (this.scanHosts.get(scanId) || this.host).send('clean', { scanId, ids }); this.scans.delete(scanId); this.scanHosts.delete(scanId); return result;
  }
  async choose(kind) {
    const result = await this.dialog.showOpenDialog(this.getWindow(), kind === 'installer' ? { title: 'Selecionar instalador para monitorar', properties: ['openFile'], filters: [{ name: 'Instaladores', extensions: ['exe', 'msi'] }] } : kind === 'folder' ? { title: 'Selecionar pasta para análise forçada', properties: ['openDirectory'] } : { title: 'Identificar executável ou atalho', properties: ['openFile'], filters: [{ name: 'Programas e atalhos', extensions: ['exe', 'lnk'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true }; const file = path.resolve(result.filePaths[0]); this.selectedPaths.add(file);
    return kind === 'installer' ? this.host.send('pick', { path: file }) : { path: file, ...await this.host.send('identify', { path: file }) };
  }
  async clearHistory() {
    if (this.job?.busy) throw new Error('Aguarde o término da desinstalação antes de limpar o histórico.');
    const histories = await this.histories();
    if (!histories.length) return { deleted: 0, retained: 0, errors: [] };
    const choice = await this.dialog.showMessageBox(this.getWindow(), {
      title: 'NTC Utilities', type: 'warning', message: 'Limpar histórico de quarentena?',
      detail: `${histories.length} registros neste histórico.\n\nPor padrão, apenas registros sem backups serão apagados. Registros com arquivos em quarentena ou backups do registro serão preservados.\n\nSe marcar a opção abaixo, os backups também serão excluídos permanentemente e não poderão mais ser restaurados pelo NTC.`,
      checkboxLabel: 'Excluir também os backups e arquivos em quarentena permanentemente', checkboxChecked: false,
      buttons: ['Cancelar', 'Limpar histórico'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice.response !== 1) return { canceled: true };
    if (this.job?.busy) throw new Error('Uma desinstalação começou. Aguarde sua conclusão.');
    const result = { deleted: 0, retained: 0, errors: [] };
    for (const history of histories) {
      try {
        const host = await this.historyHost(history.id);
        // Re-read through the authoritative host after confirmation; never purge new history IDs.
        const current = (await host.send('history')).find(row => row.id === history.id);
        if (!current) continue;
        const hasBackup = current.backupAvailable || current.records?.some(row => ['removed', 'planned'].includes(row.status));
        if (hasBackup && !choice.checkboxChecked) { result.retained++; continue; }
        await host.send('purge', { id: history.id }); this.historyHosts.delete(history.id); result.deleted++;
      } catch (error) { result.retained++; result.errors.push(`${history.name}: ${error.message}`); }
    }
    return result;
  }
  async forcedPath(file, deep) {
    const target = path.resolve(String(file || '')); if (!this.selectedPaths.has(target)) throw new Error('Escolha a pasta na ferramenta antes de analisar.');
    if (!await this.confirm('Analisar esta pasta como alvo manual?', `${target}\n\nEsta seleção não prova que todos os arquivos pertencem ao mesmo programa. Os candidatos exigirão revisão individual.`, 'Analisar')) return { canceled: true };
    const host = this.adminHost || this.host; return this.rememberScan(await host.send('forcedTarget', { path: target, deep: !!deep }), host);
  }
  register() {
    const handle = (name, fn) => this.ipcMain.handle(`uninstaller-${name}`, (event, ...args) => { const w = this.getWindow(); if (!w || event.sender !== w.webContents || event.senderFrame !== w.webContents.mainFrame) throw new Error('Solicitação não autorizada.'); return fn(...args); });
    handle('list', (appx, refreshSizes) => this.list(!!appx, !!refreshSizes)); handle('health', () => this.host.send('health')); handle('analyze', (id, deep, forced) => this.analyze(id, deep, forced)); handle('queue', (ids, quiet, restorePoint) => this.queue(ids, quiet, restorePoint)); handle('status', () => this.job); handle('cancel', () => { if (this.job?.busy) { this.job.canceled = true; this.emit(); } return true; }); handle('clean', (id, ids) => this.clean(id, ids));
    handle('size', (id, force) => {
      const program = this.program(id);
      return this.sizes.measure(program, !!force).catch(error => {
        if (error.name === 'AbortError') return { canceled: true };
        throw error;
      });
    });
    handle('history', () => this.histories()); handle('restore', async id => await this.confirm('Restaurar sobras deste histórico?', 'Os arquivos e entradas do registro serão restaurados quando não houver conflito. Isto não reinstala o aplicativo.', 'Restaurar sobras') ? (await this.historyHost(id)).send('restore', { id }) : { canceled: true }); handle('purge', async id => await this.confirm('Excluir este backup permanentemente?', 'Os itens em quarentena e os backups do registro deste histórico não poderão ser restaurados pelo NTC.', 'Excluir backup') ? (await this.historyHost(id)).send('purge', { id }) : { canceled: true });
    handle('clear-history', () => this.clearHistory());
    handle('export', async id => { const host = await this.historyHost(id); const history = (await host.send('history')).find(row => row.id === id); if (!history) throw new Error('Histórico não encontrado.'); const choice = await this.dialog.showSaveDialog(this.getWindow(), { title: 'Salvar relatório local', defaultPath: `NTC-Desinstalador-${id}.json`, filters: [{ name: 'Relatório JSON', extensions: ['json'] }] }); if (choice.canceled || !choice.filePath) return { canceled: true }; const report = { ...history, records: history.records.map(({ target, backup, quarantine, ...record }) => record) }; await fs.promises.writeFile(choice.filePath, JSON.stringify(report, null, 2), 'utf8'); return { saved: true }; });
    handle('history-analyze', async id => { const host = await this.historyHost(id); return this.rememberScan(await host.send('historyAnalyze', { id }), host); }); handle('choose', kind => this.choose(['folder', 'installer'].includes(kind) ? kind : 'file')); handle('identify', file => this.host.send('identify', { path: path.resolve(String(file || '')) })); handle('forced-path', (file, deep) => this.forcedPath(file, deep)); handle('hunter', () => this.host.send('hunter'));
    handle('processes', id => { this.program(id); return this.host.send('processes', { id }); }); handle('close-processes', async (id, force) => { const p = this.program(id); if (!await this.confirm(`${force ? 'Forçar encerramento' : 'Fechar janelas'} de ${p.name}?`, force ? 'O caminho de cada processo será validado. Trabalho não salvo poderá ser perdido.' : 'Somente processos com executáveis na pasta exclusiva serão considerados. Os que não encerrarem normalmente serão mantidos.', 'Fechar e continuar')) return { canceled: true }; return this.host.send('closeProcesses', { id, force: !!force }); });
    handle('snapshot', () => this.host.send('snapshot')); handle('snapshots', () => this.host.send('snapshots')); handle('compare', (before, after) => this.host.send('compare', { before, after })); handle('tracked', () => this.host.send('tracked'));
    handle('monitor-start', async id => await this.confirm('Iniciar este instalador com monitoramento?', 'O NTC cria snapshots locais antes/depois. A correlação temporal não será tratada como prova de propriedade. Termine também instaladores filhos antes de finalizar.', 'Iniciar') ? this.host.send('monitorStart', { id }) : { canceled: true }); handle('monitor-finish', id => this.host.send('monitorFinish', { id }));
    handle('elevate', async () => { await this.ensureAdmin(); return this.list(); }); handle('restore-point', async () => { if (!await this.confirm('Criar ponto de restauração do Windows?', 'O Windows solicitará elevação. A criação depende da Proteção do Sistema; a ferramenta confirma um novo ponto antes de indicar sucesso.', 'Criar')) return { canceled: true }; const host = await this.ensureAdmin(); return host.send('restorePoint'); });
    handle('estimate', id => { const p = this.program(id); return this.hostFor(p).send('estimate', { id }); });
    handle('metadata', id => { const p = this.program(id); return this.hostFor(p).send('metadata', { id }); });
    handle('icon', async id => {
      const p = this.program(id), key = [id, p.icon, p.location, p.fingerprint].join('|');
      if (!this.iconCache.has(key)) this.iconCache.set(key, this.host.send('icon', { id }).then(icon => typeof icon === 'string' && icon.startsWith('data:image/png;base64,') ? icon : '').catch(() => ''));
      return this.iconCache.get(key);
    });
    handle('reveal', id => { const p = this.program(id); if (p.location) this.shell.showItemInFolder(p.location); return true; });
    return this;
  }
  async dispose() { this.sizes.dispose(); if (this.job?.busy) { this.job.canceled = true; await this.jobTask; } await this.host.dispose(); await this.adminHost?.dispose(); }
}
module.exports = { UninstallerHost, UninstallerService };
