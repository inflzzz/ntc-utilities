'use strict';

// Explicitly opt-in observer. Its worker gets only a request id and a
// fixed neutral profile; no legacy result or player/game state crosses here.
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const LOG_NAME = 'rng-shadow.ndjson';
const MAX_LOG_BYTES = 512 * 1024;
const MAX_SAMPLES_PER_WORKER = 100;
const RETRY_COOLDOWN_MS = 60_000;
const INIT_TIMEOUT_MS = 15_000;
const SAMPLE_TIMEOUT_MS = 3_000;

function isShadowEnabled({ env = process.env } = {}) {
  return env.NTC_RNG_SHADOW === '1';
}

function isShadowLoggingEnabled({ env = process.env, packaged = false } = {}) {
  return !packaged && env.NTC_RNG_SHADOW === '1' && env.NTC_RNG_SHADOW_LOG === '1';
}

function createRngShadowService({
  enabled = false,
  logEnabled = false,
  userDataPath = '',
  workerFactory = () => new Worker(path.join(__dirname, 'rng-shadow-worker.cjs')),
  now = Date.now,
  onDiagnostic = () => {},
  maxLogBytes = MAX_LOG_BYTES,
  retryCooldownMs = RETRY_COOLDOWN_MS,
  initTimeoutMs = INIT_TIMEOUT_MS,
  sampleTimeoutMs = SAMPLE_TIMEOUT_MS,
  maxSamplesPerWorker = MAX_SAMPLES_PER_WORKER
} = {}) {
  if (!Number.isSafeInteger(sampleTimeoutMs) || sampleTimeoutMs < 1) throw new RangeError('sampleTimeoutMs must be a positive safe integer.');
  if (!Number.isSafeInteger(maxSamplesPerWorker) || maxSamplesPerWorker < 1) throw new RangeError('maxSamplesPerWorker must be a positive safe integer.');
  let worker = null;
  let busy = false;
  let scheduled = null;
  let disposed = false;
  let workerReady = false;
  let nextRequestId = 1;
  let activeRequestId = null;
  let initTimer = null;
  let sampleTimer = null;
  let retryAfter = 0;
  let logWritePending = false;
  const stats = {
    accepted: 0, succeeded: 0, failed: 0, droppedBusy: 0,
    droppedCooldown: 0, droppedDisabled: 0, droppedLogEntries: 0,
    workerRetirements: 0
  };

  function diagnostics() {
    return Object.freeze({
      enabled: Boolean(enabled), logEnabled: Boolean(logEnabled && enabled),
      busy, scheduled: Boolean(scheduled), workerReady, disposed,
      retryAfter, ...stats
    });
  }

  function emit(record) {
    try { onDiagnostic(Object.freeze({ ...record })); } catch { /* observer must never affect rolls */ }
    if (!enabled || !logEnabled || disposed || !userDataPath) return;
    if (logWritePending) { stats.droppedLogEntries++; return; }
    logWritePending = true;
    const line = `${JSON.stringify(record)}\n`;
    const logDir = path.join(userDataPath, 'diagnostics');
    const currentPath = path.join(logDir, LOG_NAME);
    const previousPath = `${currentPath}.1`;
    fs.promises.mkdir(logDir, { recursive: true }).then(async () => {
      let currentSize = 0;
      try { currentSize = (await fs.promises.stat(currentPath)).size; } catch {}
      if (currentSize + Buffer.byteLength(line) > maxLogBytes) {
        try { await fs.promises.rm(previousPath, { force: true }); } catch {}
        try { await fs.promises.rename(currentPath, previousPath); } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      await fs.promises.appendFile(currentPath, line, { encoding: 'utf8' });
    }).catch(() => { stats.droppedLogEntries++; }).finally(() => { logWritePending = false; });
  }

  function baseRecord(extra = {}) {
    return {
      timestamp: new Date(now()).toISOString(),
      context: 'canonical-neutral-auto', mode: 'auto',
      status: 'failed', ...extra
    };
  }

  function clearInitTimer() {
    if (initTimer) clearTimeout(initTimer);
    initTimer = null;
  }

  function clearSampleTimer() {
    if (sampleTimer) clearTimeout(sampleTimer);
    sampleTimer = null;
  }

  function abandonWorker({ cooldown = true } = {}) {
    clearInitTimer();
    clearSampleTimer();
    const old = worker;
    worker = null;
    workerReady = false;
    busy = false;
    activeRequestId = null;
    if (cooldown) retryAfter = now() + retryCooldownMs;
    if (old) {
      try { void old.terminate(); } catch {}
    }
  }

  function retireWorker(expectedWorker) {
    if (!worker || (expectedWorker && worker !== expectedWorker)) return;
    clearInitTimer();
    const old = worker;
    worker = null;
    workerReady = false;
    stats.workerRetirements++;
    try { old.postMessage({ type: 'shutdown' }); } catch {}
    try { void old.terminate(); } catch {}
  }

  function sendSample(targetWorker, requestId) {
    clearSampleTimer();
    sampleTimer = setTimeout(() => {
      if (worker !== targetWorker || !busy || activeRequestId !== requestId) return;
      stats.failed++;
      emit(baseRecord({ status: 'failed', failureCode: 'shadow-sample-timeout', requestId }));
      abandonWorker();
    }, sampleTimeoutMs);
    try { targetWorker.postMessage({ type: 'sample', requestId, context: 'canonical-neutral-auto' }); }
    catch {
      clearSampleTimer();
      stats.failed++;
      emit(baseRecord({ status: 'failed', failureCode: 'worker-message-failed', requestId }));
      abandonWorker();
    }
  }

  function complete(message) {
    if (!busy || message?.requestId !== activeRequestId) return;
    clearSampleTimer();
    const record = baseRecord({
      status: message.ok ? 'success' : 'failed',
      failureCode: message.ok ? undefined : String(message.failureCode || 'shadow-sample-failed'),
      durationMs: Number.isFinite(message.durationMs) ? Math.max(0, message.durationMs) : null,
      titleId: message.ok ? String(message.outcome || '') : undefined,
      snapshotHash: worker?.metadata?.snapshotHash,
      snapshotVersion: worker?.metadata?.snapshotVersion,
      rollPlanHash: worker?.metadata?.rollPlanHash,
      rollPlanVersion: worker?.metadata?.rollPlanVersion,
      formulaVersion: worker?.metadata?.formulaVersion,
      samplerVersion: worker?.metadata?.samplerVersion,
      backendId: worker?.metadata?.backendId,
      backendVersion: worker?.metadata?.backendVersion,
      backendRuntimeSha256: worker?.metadata?.backendRuntimeSha256,
      precisionInitialBits: 128,
      precisionFinalBits: message.audit?.precisionBits ?? null,
      cache: message.cache || null,
      processCpuUserMs: Number.isFinite(message.processCpuUserMs) ? message.processCpuUserMs : null,
      processCpuSystemMs: Number.isFinite(message.processCpuSystemMs) ? message.processCpuSystemMs : null,
      backendInitDurationMs: worker?.metadata?.initDurationMs ?? null,
      memory: message.memory || worker?.metadata?.memory || null
    });
    busy = false;
    activeRequestId = null;
    if (worker) worker.completedSamples = (worker.completedSamples || 0) + 1;
    message.ok ? stats.succeeded++ : stats.failed++;
    emit(record);
    if (worker && worker.completedSamples >= maxSamplesPerWorker) retireWorker(worker);
  }

  function startWorker(requestId) {
    try {
      worker = workerFactory();
      workerReady = false;
      worker.metadata = null;
      const ownedWorker = worker;
      ownedWorker.completedSamples = 0;
      initTimer = setTimeout(() => {
        if (worker !== ownedWorker || workerReady) return;
        stats.failed++;
        emit(baseRecord({ status: 'failed', failureCode: 'backend-init-timeout', requestId }));
        abandonWorker();
      }, initTimeoutMs);
      ownedWorker.on('message', message => {
        if (worker !== ownedWorker || disposed) return;
        if (message?.type === 'ready') {
          clearInitTimer();
          workerReady = true;
          ownedWorker.metadata = {
            initDurationMs: Number.isFinite(message.initDurationMs) ? message.initDurationMs : null,
            mathIdentityHash: message.mathIdentityHash,
            snapshotHash: message.snapshotHash,
            snapshotVersion: message.snapshotVersion,
            rollPlanHash: message.rollPlanHash,
            rollPlanVersion: message.rollPlanVersion,
            formulaVersion: message.formulaVersion,
            samplerVersion: message.samplerVersion,
            backendId: message.backendId,
            backendVersion: message.backendVersion,
            backendRuntimeSha256: message.backendRuntimeSha256,
            memory: message.memory || null
          };
          sendSample(ownedWorker, requestId);
          return;
        }
        if (message?.type === 'init-failed') {
          stats.failed++;
          emit(baseRecord({ status: 'failed', failureCode: String(message.failureCode || 'backend-init-failed'), requestId }));
          abandonWorker();
          return;
        }
        if (message?.type === 'result') complete(message);
      });
      ownedWorker.on('error', () => {
        if (worker !== ownedWorker) return;
        if (busy) {
          stats.failed++;
          emit(baseRecord({ status: 'failed', failureCode: 'worker-error', requestId: activeRequestId }));
        }
        abandonWorker();
      });
      ownedWorker.on('exit', code => {
        if (worker !== ownedWorker) return;
        if (!disposed && busy) {
          stats.failed++;
          emit(baseRecord({ status: 'failed', failureCode: code === 0 ? 'worker-exited' : 'worker-exit-error', requestId: activeRequestId }));
        }
        abandonWorker({ cooldown: !disposed });
      });
    } catch {
      stats.failed++;
      emit(baseRecord({ status: 'failed', failureCode: 'worker-start-failed', requestId }));
      abandonWorker();
    }
  }

  function runOne() {
    scheduled = null;
    if (!enabled || disposed) { stats.droppedDisabled++; return; }
    if (busy) { stats.droppedBusy++; return; }
    if (now() < retryAfter) { stats.droppedCooldown++; return; }
    busy = true;
    activeRequestId = nextRequestId++;
    stats.accepted++;
    if (worker && workerReady) {
      sendSample(worker, activeRequestId);
      return;
    }
    if (!worker) startWorker(activeRequestId);
  }

  function scheduleAutoRoll() {
    if (!enabled || disposed) { stats.droppedDisabled++; return false; }
    if (busy || scheduled) { stats.droppedBusy++; return false; }
    if (now() < retryAfter) { stats.droppedCooldown++; return false; }
    scheduled = setImmediate(runOne);
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (scheduled) clearImmediate(scheduled);
    scheduled = null;
    clearInitTimer();
    clearSampleTimer();
    const old = worker;
    worker = null;
    workerReady = false;
    busy = false;
    activeRequestId = null;
    if (old) {
      try { old.postMessage({ type: 'shutdown' }); } catch {}
      try { void old.terminate(); } catch {}
    }
  }

  return Object.freeze({ scheduleAutoRoll, dispose, getDiagnostics: diagnostics });
}

module.exports = {
  LOG_NAME, MAX_LOG_BYTES, MAX_SAMPLES_PER_WORKER, RETRY_COOLDOWN_MS, INIT_TIMEOUT_MS, SAMPLE_TIMEOUT_MS,
  isShadowEnabled, isShadowLoggingEnabled, createRngShadowService
};
