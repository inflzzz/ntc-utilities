'use strict';

// Dedicated worker for disposable neutral-Auto shadow samples. It receives no
// player state or legacy outcome and returns no game-facing value.
const { parentPort } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSnapshot, hashSnapshot } = require('./rng-pool-model.cjs');
const { validateRollPlan } = require('./rng-roll-plan.cjs');
const {
  BACKEND_ID, BACKEND_VERSION, FORMULA_VERSION, MANUAL_POWER_VERSION,
  createProductionIntervalBackend
} = require('./rng-luck2-precision.cjs');
const { SAMPLER_VERSION, createPoolSampler } = require('./rng-pool-sampler.cjs');

const SHADOW_MAX_MS = 2_000;
let backend = null;
let sampler = null;
let snapshot = null;
let rollPlan = null;
let mathIdentity = null;
let busy = false;
let sampleCacheDiagnostics = null;

function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

function loadCanonicalArtifact() {
  const artifactPath = path.join(__dirname, '..', 'content', 'rng-pool2-catalog-v1.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const { artifactSha256, ...body } = artifact;
  if (sha256(JSON.stringify(body)) !== artifactSha256) throw new Error('canonical-artifact-hash-mismatch');
  if (sha256(JSON.stringify(artifact.mathIdentity)) !== artifact.mathIdentityHash) throw new Error('math-identity-hash-mismatch');
  snapshot = createSnapshot(artifact.snapshot);
  if (hashSnapshot(snapshot) !== artifact.mathIdentity.snapshotHash) throw new Error('snapshot-hash-mismatch');
  rollPlan = validateRollPlan(artifact.rollPlan, snapshot);
  if (sha256(JSON.stringify(rollPlan)) !== artifact.mathIdentity.rollPlanHash) throw new Error('roll-plan-hash-mismatch');
  if (artifact.mathIdentity.catalogVersion !== artifact.catalogVersion
    || artifact.mathIdentity.formulaVersion !== FORMULA_VERSION
    || artifact.mathIdentity.manualPowerVersion !== MANUAL_POWER_VERSION
    || artifact.mathIdentity.samplerVersion !== SAMPLER_VERSION) throw new Error('math-version-mismatch');
  const slotIds = new Set(snapshot.cohorts.flatMap(cohort => cohort.slots.map(slot => slot.titleId)));
  if (slotIds.size !== 200 || artifact.titles.length !== 200
    || artifact.titles.some(title => !slotIds.has(title.titleId) || title.titleId !== title.slotId)) {
    throw new Error('canonical-title-roster-mismatch');
  }
  return { artifact, identity: artifact.mathIdentity, snapshot, rollPlan };
}

async function initialize() {
  const startedAt = performance.now();
  const loaded = loadCanonicalArtifact();
  backend = await createProductionIntervalBackend({ allowUncertified: false });
  if (backend.metadata.backendId !== BACKEND_ID || backend.metadata.backendVersion !== BACKEND_VERSION
    || backend.metadata.certified !== true || backend.metadata.manifestRuntimeHashMatches !== true
    || backend.metadata.runtimeSha256 !== loaded.identity.backendRuntimeSha256) {
    throw new Error('certified-backend-identity-mismatch');
  }
  mathIdentity = loaded.identity;
  snapshot = loaded.snapshot;
  rollPlan = loaded.rollPlan;
  sampler = createPoolSampler({ backend, onSampleDiagnostics: value => { sampleCacheDiagnostics = value; } });
  parentPort.postMessage({
    type: 'ready',
    initDurationMs: Math.max(0, performance.now() - startedAt),
    mathIdentityHash: loaded.artifact.mathIdentityHash,
    snapshotHash: loaded.identity.snapshotHash,
    snapshotVersion: loaded.identity.snapshotVersion,
    rollPlanHash: loaded.identity.rollPlanHash,
    rollPlanVersion: loaded.identity.rollPlanVersion,
    formulaVersion: loaded.identity.formulaVersion,
    samplerVersion: loaded.identity.samplerVersion,
    backendId: backend.metadata.backendId,
    backendVersion: backend.metadata.backendVersion,
    backendRuntimeSha256: backend.metadata.runtimeSha256,
    precisionInitialBits: 128,
    memory: (() => {
      const usage = process.memoryUsage();
      return { processRssBytes: usage.rss, workerHeapUsedBytes: usage.heapUsed, workerExternalBytes: usage.external };
    })()
  });
}

async function sample(requestId) {
  if (busy) {
    parentPort.postMessage({ type: 'result', requestId, ok: false, failureCode: 'worker-busy' });
    return;
  }
  busy = true;
  const startedAt = performance.now();
  const cpuStartedAt = process.cpuUsage();
  sampleCacheDiagnostics = null;
  try {
    const prepared = await sampler.prepareRoll({
      snapshot,
      rollPlan,
      channels: { coreLuck: '1', buildLuck: '1', temporaryLuck: '1' },
      mode: 'auto'
    });
    const result = await prepared.sample();
    const durationMs = Math.max(0, performance.now() - startedAt);
    const cpu = process.cpuUsage(cpuStartedAt);
    if (durationMs > SHADOW_MAX_MS) {
      parentPort.postMessage({ type: 'result', requestId, ok: false, failureCode: 'operational-time-limit', durationMs,
        audit: result.audit, cache: sampleCacheDiagnostics, processCpuUserMs: cpu.user / 1000, processCpuSystemMs: cpu.system / 1000 });
      return;
    }
    const usage = process.memoryUsage();
    parentPort.postMessage({
      type: 'result', requestId, ok: true, durationMs, outcome: result.outcome, audit: result.audit,
      memory: { processRssBytes: usage.rss, workerHeapUsedBytes: usage.heapUsed, workerExternalBytes: usage.external },
      cache: sampleCacheDiagnostics, processCpuUserMs: cpu.user / 1000, processCpuSystemMs: cpu.system / 1000
    });
  } catch (error) {
    const cpu = process.cpuUsage(cpuStartedAt);
    parentPort.postMessage({
      type: 'result', requestId, ok: false,
      failureCode: error?.reasonCode || (String(error?.message || '').includes('hash') ? 'snapshot-plan-hash-invalid' : 'shadow-sample-failed'),
      durationMs: Math.max(0, performance.now() - startedAt),
      audit: error?.audit || null,
      cache: sampleCacheDiagnostics, processCpuUserMs: cpu.user / 1000, processCpuSystemMs: cpu.system / 1000
    });
  } finally { busy = false; }
}

parentPort.on('message', message => {
  if (message?.type === 'sample' && message.context === 'canonical-neutral-auto') {
    void sample(message.requestId);
  } else if (message?.type === 'shutdown') {
    backend?.clearCache();
    parentPort.close();
  }
});

void initialize().catch(error => {
  parentPort.postMessage({ type: 'init-failed', failureCode: String(error?.message || '').includes('hash') ? 'snapshot-plan-hash-invalid' : 'backend-init-failed' });
});
