const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { normalizeSettings, resolveTarget, nextTimelinePoint, solarTimeline } = require('./screen-light-model.cjs');

class ScreenLightHost {
  constructor(executable, recoveryFile) {
    this.executable = executable;
    this.recoveryFile = recoveryFile;
    this.process = null;
    this.buffer = '';
    this.pending = null;
    this.dead = false;
    this.stopping = false;
    this.onUnexpectedExit = null;
  }
  async start() {
    if (!fs.existsSync(this.executable)) throw new Error('Helper nativo não encontrado no pacote.');
    this.process = spawn(this.executable, [String(process.pid), this.recoveryFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', chunk => {
      this.buffer += chunk;
      let end;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, end).replace(/\r$/, '');
        this.buffer = this.buffer.slice(end + 1);
        if (this.pending) this.pending.line(line);
      }
    });
    this.process.stderr.on('data', chunk => console.error('Luz da Tela helper:', String(chunk).trim()));
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', (code, signal) => this.fail(new Error(`Helper encerrado (${code ?? signal}).`)));
    const response = await this.receiveReady();
    if (!response.startsWith('READY\t')) throw new Error(`Não foi possível iniciar o helper: ${response}`);
    return this;
  }
  fail(error) {
    if (this.dead) return;
    this.dead = true;
    if (this.pending) { const pending = this.pending; this.pending = null; pending.reject(error); }
    if (!this.stopping) this.onUnexpectedExit?.(error);
  }
  receiveReady() {
    return this.waitForResponse(null, 5000);
  }
  waitForResponse(command, timeout = 4000, multiline = false) {
    if (this.dead || this.pending) return Promise.reject(new Error('Helper indisponível ou ocupado.'));
    return new Promise((resolve, reject) => {
      const lines = [];
      const timer = setTimeout(() => { this.pending = null; reject(new Error('Helper não respondeu no prazo.')); }, timeout);
      this.pending = {
        line: line => {
          if (multiline && line !== 'END') { lines.push(line); return; }
          clearTimeout(timer);
          this.pending = null;
          resolve(multiline ? lines : line);
        },
        reject: error => { clearTimeout(timer); reject(error); }
      };
      if (command !== null) this.process.stdin.write(`${command}\n`);
    });
  }
  send(command, options = {}) { return this.waitForResponse(command, options.timeout, options.multiline); }
  async stop() {
    if (!this.process) return;
    if (this.dead) throw new Error('Helper encerrado antes de confirmar a restauração da tela.');
    this.stopping = true;
    let response;
    try { response = await this.send('EXIT', { timeout: 2500 }); }
    finally { this.process.stdin.end(); }
    if (!response.startsWith('OK\t')) throw new Error(`Restauração da tela não confirmada: ${response}`);
  }
}

class ScreenLightService {
  constructor({ file, helperFile, onChange, onTrayChange, registerShortcut, unregisterShortcut }) {
    this.file = file;
    this.helperFile = helperFile;
    this.recoveryFile = path.join(path.dirname(file), 'screen-light-recovery.bin');
    this.onChange = onChange || (() => {});
    this.onTrayChange = onTrayChange || (() => {});
    this.registerShortcut = registerShortcut || (() => false);
    this.unregisterShortcut = unregisterShortcut || (() => {});
    this.settings = normalizeSettings();
    this.host = null;
    this.monitors = [];
    this.status = 'disabled';
    this.error = '';
    this.applied = null;
    this.limitation = '';
    this.foreground = { executable: '', fullscreen: false };
    this.timer = null;
    this.contextTimer = null;
    this.transitionTimer = null;
    this.generation = 0;
    this.lastTargetSignature = '';
    this.chain = Promise.resolve();
    this.shortcutsRegistered = {};
    this.shortcutErrors = [];
    this.disposed = false;
  }
  async initialize() {
    try { this.settings = normalizeSettings(JSON.parse(await fs.promises.readFile(this.file, 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') console.error('Configuração Luz da Tela inválida:', error); }
    this.timer = setInterval(() => { if (this.settings.enabled) void this.refresh().catch(error => this.report(error)); }, 30_000);
    this.timer.unref?.();
    this.contextTimer = setInterval(() => {
      if (this.settings.enabled && (this.settings.exceptions.length || this.settings.pauseFullscreen)) void this.refresh().catch(error => this.report(error));
    }, 4_000);
    this.contextTimer.unref?.();
    this.configureShortcuts();
    if (this.settings.enabled) await this.refresh({ reprobe: true });
    this.emit();
  }
  enqueue(task) {
    const next = this.chain.catch(() => {}).then(task);
    this.chain = next;
    return next;
  }
  async ensureHost() {
    if (process.platform !== 'win32') throw new Error('Luz da Tela está disponível apenas no Windows.');
    if (this.host && !this.host.dead) return this.host;
    const host = await new ScreenLightHost(this.helperFile, this.recoveryFile).start();
    host.onUnexpectedExit = error => {
      this.report(error);
      if (this.settings.enabled && !this.disposed) setTimeout(() => void this.refresh({ reprobe: true }), 1000);
    };
    this.host = host;
    const rows = await host.send('LIST', { multiline: true });
    this.monitors = rows.filter(line => line.startsWith('D\t')).map(line => {
      const [, index, id, name, hdr, gamma] = line.split('\t');
      return { index: Number(index), id, name, hdr: Number(hdr), gamma: gamma === '1' };
    });
    return host;
  }
  async refresh({ reprobe = false } = {}) {
    return this.enqueue(async () => {
      if (this.disposed) return this.state();
      if (!this.settings.enabled) {
        if (!await this.restoreAndStop()) return this.state();
        this.status = 'disabled';
        this.applied = null;
        this.limitation = '';
        this.emit();
        return this.state();
      }
      try {
        const host = await this.ensureHost();
        if (reprobe) {
          const result = await host.send('REPROBE');
          if (!result.startsWith('OK\t')) throw new Error('Não foi possível reexaminar os monitores com segurança.');
          const rows = await host.send('LIST', { multiline: true });
          this.monitors = rows.filter(line => line.startsWith('D\t')).map(line => {
            const [, index, id, name, hdr, gamma] = line.split('\t');
            return { index: Number(index), id, name, hdr: Number(hdr), gamma: gamma === '1' };
          });
          this.applied = null;
          this.lastTargetSignature = '';
        }
        if (this.settings.exceptions.length || this.settings.pauseFullscreen) {
          const response = await host.send('FOREGROUND');
          const [, executable, fullscreen] = response.split('\t');
          this.foreground = { executable: executable || '', fullscreen: fullscreen === '1' };
        }
        await this.applyTarget(host);
      } catch (error) { this.report(error); }
      this.emit();
      return this.state();
    });
  }
  async applyTarget(host) {
    const target = resolveTarget(this.settings, new Date(), this.foreground);
    const signature = JSON.stringify({ target, overrides: this.settings.monitorOverrides });
    if (signature === this.lastTargetSignature && (this.status === 'active' || this.transitionTimer)) return;
    this.generation++;
    if (this.transitionTimer) { clearTimeout(this.transitionTimer); this.transitionTimer = null; }
    if (!target.active) {
      const result = await host.send('RESTORE');
      if (!result.startsWith('OK\t')) throw new Error('Não foi possível restaurar a aparência original.');
      this.applied = null;
      this.status = target.reason;
      this.error = '';
      this.limitation = '';
      this.lastTargetSignature = signature;
      return;
    }
    for (const item of this.monitors) {
      if (this.settings.monitorOverrides[item.id]?.enabled === false && item.hdr === 0 && item.gamma) {
        const restored = await host.send(`RESTORE_INDEX\t${item.index}`);
        if (!restored.startsWith('OK\t')) throw new Error(`Não foi possível restaurar ${item.id}.`);
      }
    }
    const capable = this.monitors.filter(item => item.hdr === 0 && item.gamma && this.settings.monitorOverrides[item.id]?.enabled !== false);
    if (!capable.length) {
      this.applied = null;
      this.status = this.monitors.some(item => item.hdr > 0) ? 'hdr-blocked' : 'unsupported';
      this.limitation = '';
      this.error = this.monitors.some(item => item.hdr === 1) ? 'HDR ativo: ajuste de gamma bloqueado neste monitor.' :
        this.monitors.some(item => item.hdr === 2) ? 'Gerenciamento de cor/gama ampla ativo em SDR: gamma bloqueado para preservar as cores.' :
          this.monitors.some(item => item.hdr === 3) ? 'Cor avançada ativa: gamma bloqueado para preservar as cores.' :
            'Nenhum monitor SDR compatível confirmou suporte a ajuste de cor.';
      this.lastTargetSignature = signature;
      return;
    }
    const previous = this.applied;
    const duration = previous ? (target.reason === 'manual' ? Math.min(this.settings.transitionMs, 1000) :
      target.reason === 'profile' || target.reason === 'exception-profile' ? Math.min(this.settings.transitionMs, 3000) : this.settings.transitionMs) : 0;
    const start = Date.now();
    const generation = this.generation;
    const step = async () => {
      if (generation !== this.generation || this.disposed) return;
      const progress = duration ? Math.min(1, (Date.now() - start) / duration) : 1;
      const eased = progress * progress * (3 - 2 * progress);
      const current = previous && progress < 1 ? {
        kelvin: Math.round(previous.kelvin + (target.kelvin - previous.kelvin) * eased),
        intensity: Math.round(previous.intensity + (target.intensity - previous.intensity) * eased),
        dim: Math.round(previous.dim + (target.dim - previous.dim) * eased)
      } : target;
      const failures = [];
      const limited = [];
      const effectiveByMonitor = {};
      for (const item of capable) {
        const override = this.settings.monitorOverrides[item.id];
        const kelvin = override?.kelvin ?? current.kelvin;
        const candidates = [...new Set([current.intensity, 75, 60, 45, 30, 15].filter(intensity => intensity <= current.intensity && intensity >= 0))];
        let response = '';
        let effective = current.intensity;
        for (const intensity of candidates) {
          response = await host.send(`APPLY\t${item.index}\t${kelvin}\t${intensity}\t${current.dim}`, { timeout: 5000 });
          if (response.startsWith('OK\t')) { effective = intensity; break; }
          if (!response.includes('gamma-not-confirmed')) break;
        }
        if (!response.startsWith('OK\t')) failures.push(`${item.id}: ${response.split('\t')[1] || 'erro'}`);
        else {
          effectiveByMonitor[item.id] = effective;
          if (effective < current.intensity) limited.push({ id: item.id, intensity: effective });
        }
      }
      if (failures.length) {
        const restored = await host.send('RESTORE');
        this.status = 'partial';
        this.error = `${failures.join('; ')}${restored.startsWith('OK\t') ? '' : '; restauração não confirmada'}`;
        this.limitation = '';
        this.applied = null;
        this.lastTargetSignature = '';
        this.emit();
        return;
      }
      this.applied = { kelvin: current.kelvin, intensity: Math.min(...Object.values(effectiveByMonitor)), dim: current.dim, perMonitor: effectiveByMonitor };
      this.limitation = limited.length ? `Intensidade limitada pelo driver em ${limited.map(item => `${item.id}: ${item.intensity}%`).join(', ')}.` : '';
      this.status = 'active';
      this.error = '';
      this.lastTargetSignature = signature;
      this.emit();
      if (progress < 1 && generation === this.generation) {
        this.transitionTimer = setTimeout(() => { void this.enqueue(step).catch(error => this.report(error)); }, Math.max(80, Math.min(30_000, Math.round(duration / 120))));
      }
    };
    await step();
  }
  async restoreAndStop() {
    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.generation++;
    this.lastTargetSignature = '';
    if ((!this.host || this.host.dead) && fs.existsSync(this.recoveryFile)) {
      try { await this.ensureHost(); }
      catch (error) { this.report(error); return false; }
    }
    if (this.host) {
      const host = this.host;
      this.host = null;
      try { await host.stop(); }
      catch (error) { this.report(error); return false; }
    }
    return true;
  }
  async update(patch) {
    const safe = patch && typeof patch === 'object' ? patch : {};
    const next = normalizeSettings({ ...this.settings, ...safe });
    this.settings = next;
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2));
    await fs.promises.rename(temporary, this.file);
    this.configureShortcuts();
    return this.refresh();
  }
  async pause(minutes) {
    const value = Number(minutes);
    return this.update({ pauseUntil: value === -1 ? -1 : value === 0 ? 0 : Date.now() + Math.max(1, Math.min(1440, value)) * 60_000 });
  }
  async probe() {
    return this.enqueue(async () => {
      try { await this.ensureHost(); this.status = this.settings.enabled ? this.status : 'disabled'; this.error = ''; if (!this.settings.enabled) await this.restoreAndStop(); }
      catch (error) { this.report(error); }
      this.emit();
      return this.state();
    });
  }
  async runningProcesses() {
    return this.enqueue(async () => {
      const host = await this.ensureHost();
      const rows = await host.send('PROCESSES', { multiline: true, timeout: 7000 });
      if (!this.settings.enabled) await this.restoreAndStop();
      return [...new Set(rows.filter(row => row.startsWith('P\t')).map(row => row.slice(2)))].sort((a, b) => a.localeCompare(b));
    });
  }
  onDisplayChange() { if (this.settings.enabled) void this.refresh({ reprobe: true }); }
  onResume() { if (this.settings.enabled) setTimeout(() => void this.refresh({ reprobe: true }), 1500); }
  configureShortcuts() {
    for (const accelerator of Object.values(this.shortcutsRegistered)) this.unregisterShortcut(accelerator);
    this.shortcutsRegistered = {};
    this.shortcutErrors = [];
    for (const [action, accelerator] of Object.entries(this.settings.shortcuts)) {
      if (!accelerator) continue;
      let registered = false;
      try { registered = this.registerShortcut(accelerator, () => void this.shortcut(action)); } catch { /* Atalho inválido. */ }
      if (!registered) { this.shortcutErrors.push(`${action}: ${accelerator} está inválido ou em uso.`); continue; }
      this.shortcutsRegistered[action] = accelerator;
    }
  }
  async shortcut(action) {
    const settings = this.settings;
    if (action === 'toggle') return this.update({ enabled: !settings.enabled });
    if (action === 'night') return this.update({ enabled: true, mode: 'profile', profileId: 'night' });
    if (action === 'pauseHour') return this.pause(60);
    if (action === 'warmer' || action === 'cooler') return this.update({ enabled: true, mode: 'manual', manualKelvin: settings.manualKelvin + (action === 'cooler' ? 200 : -200) });
    if (action === 'intensityUp' || action === 'intensityDown') return this.update({ intensity: settings.intensity + (action === 'intensityUp' ? 10 : -10) });
  }
  report(error) { this.status = 'error'; this.error = error?.message || String(error); this.emit(); }
  emit() { const value = this.state(); this.onChange(value); this.onTrayChange(); }
  state() {
    const now = new Date();
    const solar = solarTimeline(now, this.settings.solar);
    const point = nextTimelinePoint(solar?.points || this.settings.timeline, now.getHours() * 60 + now.getMinutes());
    return { settings: this.settings, monitors: this.monitors, status: this.status, error: this.error, limitation: this.limitation, applied: this.applied, shortcutErrors: this.shortcutErrors,
      target: resolveTarget(this.settings, now, this.foreground), nextPoint: point, solar: solar?.times || null };
  }
  async dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    clearInterval(this.contextTimer);
    clearTimeout(this.transitionTimer);
    for (const accelerator of Object.values(this.shortcutsRegistered)) this.unregisterShortcut(accelerator);
    await this.enqueue(() => this.restoreAndStop());
  }
}

module.exports = { ScreenLightHost, ScreenLightService };
