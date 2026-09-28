'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { rollBatch } = require('../src/rng.cjs');
const { runLegacyRollWithShadow } = require('../src/rng-shadow-bridge.cjs');
const {
  createRngShadowService, isShadowEnabled, isShadowLoggingEnabled
} = require('../src/rng-shadow-service.cjs');

function sameLegacyRoll(state, manual, shadowService) {
  return runLegacyRollWithShadow({
    legacyRoll: () => rollBatch(state, [0n, 0n, 0n, 0n], {
      rolledAt: '2026-09-27T00:00:00.000Z',
      event: manual ? { id: 'test-event', multiplier: 3 } : null,
      autoRollSeconds: manual ? 0 : 180,
      localHour: 12,
      randomRelicTargetValue: 0n,
      randomRelicChoiceValue: 0n,
      eventRelicChoiceValue: 0n
    }),
    manual,
    shadowService
  });
}

test('flag de shadow é independente, opt-in e logging exige opt-in adicional', () => {
  assert.equal(isShadowEnabled({ env: {}, packaged: false }), false);
  assert.equal(isShadowEnabled({ env: { NTC_RNG_ENGINE: 'luck2' }, packaged: false }), false);
  assert.equal(isShadowEnabled({ env: { NTC_RNG_SHADOW: '1' }, packaged: false }), true);
  assert.equal(isShadowEnabled({ env: { NTC_RNG_SHADOW: '1' }, packaged: true }), true);
  assert.equal(isShadowLoggingEnabled({ env: { NTC_RNG_SHADOW: '1' }, packaged: false }), false);
  assert.equal(isShadowLoggingEnabled({ env: { NTC_RNG_SHADOW: '1', NTC_RNG_SHADOW_LOG: '1' }, packaged: false }), true);
  assert.equal(isShadowLoggingEnabled({ env: { NTC_RNG_SHADOW: '1', NTC_RNG_SHADOW_LOG: '1' }, packaged: true }), false);
  assert.equal(isShadowLoggingEnabled({ env: { NTC_RNG_SHADOW_LOG: '1' }, packaged: false }), false);
});

test('shadow OFF, ON e com falha têm resultado e estado serializado legado idênticos', () => {
  const initial = { collectedIds: [], totalRolls: '0', fragments: '0' };
  const off = sameLegacyRoll(initial, false, null);
  let order = [];
  const on = sameLegacyRoll(initial, false, { scheduleAutoRoll() { order.push('scheduled'); return true; } });
  const failed = sameLegacyRoll(initial, false, { scheduleAutoRoll() { throw new Error('diagnostic-only failure'); } });
  assert.deepEqual(on, off);
  assert.deepEqual(failed, off);
  assert.equal(JSON.stringify(on.state), JSON.stringify(off.state));
  assert.deepEqual(order, ['scheduled']);

  const runSequence = shadowService => {
    let state = initial;
    const rolls = [];
    for (let i = 0; i < 25; i++) {
      const result = runLegacyRollWithShadow({
        legacyRoll: () => rollBatch(state, [BigInt(i)], {
          rolledAt: '2026-09-27T00:00:00.000Z', localHour: 12,
          randomRelicTargetValue: 0n, randomRelicChoiceValue: 0n, eventRelicChoiceValue: 0n
        }),
        shadowService
      });
      state = result.state;
      rolls.push(result.results.map(item => item.title.id));
    }
    return { state, serialized: JSON.stringify(state), rolls };
  };
  assert.deepEqual(runSequence({ scheduleAutoRoll() {} }), runSequence(null));
  assert.deepEqual(runSequence({ scheduleAutoRoll() { throw new Error('worker failure'); } }), runSequence(null));
});

test('ponte executa o legado primeiro, uma única vez; Manual nunca agenda shadow', () => {
  const calls = [];
  const expected = { marker: Symbol('legacy') };
  const result = runLegacyRollWithShadow({
    legacyRoll() { calls.push('legacy'); return expected; },
    shadowService: { scheduleAutoRoll() { calls.push('shadow'); } }
  });
  assert.strictEqual(result, expected);
  assert.deepEqual(calls, ['legacy', 'shadow']);
  calls.length = 0;
  const manual = runLegacyRollWithShadow({
    legacyRoll() { calls.push('legacy'); return expected; },
    manual: true,
    shadowService: { scheduleAutoRoll() { calls.push('shadow'); } }
  });
  assert.strictEqual(manual, expected);
  assert.deepEqual(calls, ['legacy']);
});

test('service aplica backpressure: máximo de uma tarefa e nenhuma fila durante worker ocupado', async () => {
  class FakeWorker extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit('message', { type: 'ready', initDurationMs: 1, mathIdentityHash: 'test' }));
    }
    terminate() { return Promise.resolve(0); }
    postMessage(message) {
      if (message.type === 'sample') {
        this.lastRequest = message.requestId;
        this.samples++;
      }
    }
    samples = 0;
  }
  let fake;
  const records = [];
  const service = createRngShadowService({ enabled: true, workerFactory: () => (fake = new FakeWorker()), onDiagnostic: r => records.push(r) });
  assert.equal(service.scheduleAutoRoll(), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.getDiagnostics().busy, true);
  assert.equal(service.scheduleAutoRoll(), false);
  assert.equal(service.scheduleAutoRoll(), false);
  assert.equal(service.getDiagnostics().droppedBusy, 2);
  fake.emit('message', { type: 'result', requestId: fake.lastRequest, ok: true, outcome: 'shadow-only-title', durationMs: 3, audit: { precisionBits: 128, cache: { backendHits: 2 } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.getDiagnostics().busy, false);
  assert.equal(service.getDiagnostics().succeeded, 1);
  assert.equal(records[0].titleId, 'shadow-only-title');
  service.dispose();
});

test('série longa sintética mantém worker, fila e operações limitados', async () => {
  class FakeWorker extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit('message', { type: 'ready', initDurationMs: 0 }));
    }
    terminate() { return Promise.resolve(0); }
    postMessage(message) {
      if (message.type !== 'sample') return;
      this.lastRequest = message.requestId;
      queueMicrotask(() => this.emit('message', { type: 'result', requestId: message.requestId, ok: true, outcome: 'shadow-only', durationMs: 1, audit: {} }));
    }
  }
  const service = createRngShadowService({ enabled: true, workerFactory: () => new FakeWorker() });
  for (let i = 0; i < 2_000; i++) service.scheduleAutoRoll();
  assert.equal(service.getDiagnostics().scheduled, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(service.getDiagnostics().accepted <= 1);
  assert.ok(service.getDiagnostics().droppedBusy >= 1_999);
  assert.equal(service.getDiagnostics().busy, false);
  assert.equal(service.getDiagnostics().succeeded, 1);
  service.dispose();
  assert.equal(service.getDiagnostics().busy, false);
});

test('telemetria é local, opt-in e roda em no máximo dois arquivos limitados', async () => {
  class FakeWorker extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit('message', { type: 'ready', initDurationMs: 1 }));
    }
    terminate() { return Promise.resolve(0); }
    postMessage(message) {
      if (message.type === 'sample') queueMicrotask(() => this.emit('message', {
        type: 'result', requestId: message.requestId, ok: true, outcome: 'basic-01', durationMs: 1, audit: {}, cache: { backendHits: 1, backendMisses: 0 }
      }));
    }
  }
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-rng-shadow-test-'));
  const service = createRngShadowService({ enabled: true, logEnabled: true, userDataPath, workerFactory: () => new FakeWorker(), maxLogBytes: 2048 });
  try {
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => {
        const previous = service.getDiagnostics().succeeded;
        const poll = setInterval(() => {
          if (service.getDiagnostics().succeeded > previous) { clearInterval(poll); resolve(); }
        }, 1);
        service.scheduleAutoRoll();
      });
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    service.dispose();
    await new Promise(resolve => setTimeout(resolve, 30));
    const logDir = path.join(userDataPath, 'diagnostics');
    const names = await fs.readdir(logDir);
    assert.ok(names.length <= 2);
    for (const name of names) assert.ok((await fs.stat(path.join(logDir, name))).size <= 2048);
    assert.ok(names.some(name => name === 'rng-shadow.ndjson'));
    assert.equal(service.getDiagnostics().succeeded, 20);
    assert.ok(service.getDiagnostics().droppedLogEntries <= 20);
  } finally {
    service.dispose();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
});

test('worker é reciclado no limite para conter memória de alto-marco', async () => {
  let created = 0;
  class FakeWorker extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit('message', { type: 'ready', initDurationMs: 1 }));
    }
    terminate() { return Promise.resolve(0); }
    postMessage(message) {
      if (message.type === 'sample') queueMicrotask(() => this.emit('message', {
        type: 'result', requestId: message.requestId, ok: true, outcome: 'basic-01', durationMs: 1, audit: {}
      }));
    }
  }
  const service = createRngShadowService({ enabled: true, maxSamplesPerWorker: 2, workerFactory: () => { created++; return new FakeWorker(); } });
  async function waitForSuccess(target) {
    const until = Date.now() + 1000;
    while (service.getDiagnostics().succeeded < target && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(service.getDiagnostics().succeeded, target);
  }
  service.scheduleAutoRoll();
  await waitForSuccess(1);
  service.scheduleAutoRoll();
  await waitForSuccess(2);
  assert.equal(service.getDiagnostics().workerRetirements, 1);
  service.scheduleAutoRoll();
  await waitForSuccess(3);
  assert.equal(created, 2);
  service.dispose();
});

test('sample shadow travado expira, é descartado e entra em cooldown sem afetar a chamada legada', async () => {
  class HangingWorker extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('message', { type: 'ready', initDurationMs: 1 })); }
    postMessage() {}
    terminate() { return Promise.resolve(0); }
  }
  const records = [];
  const service = createRngShadowService({ enabled: true, sampleTimeoutMs: 5, retryCooldownMs: 1000,
    workerFactory: () => new HangingWorker(), onDiagnostic: record => records.push(record) });
  const authoritative = runLegacyRollWithShadow({ legacyRoll: () => ({ state: { unchanged: true }, results: [{ title: { id: 'legacy-title' } }] }), shadowService: service });
  assert.equal(authoritative.results[0].title.id, 'legacy-title');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(service.getDiagnostics().busy, false);
  assert.equal(service.getDiagnostics().failed, 1);
  assert.equal(records[0].failureCode, 'shadow-sample-timeout');
  assert.equal(service.scheduleAutoRoll(), false);
  assert.equal(service.getDiagnostics().droppedCooldown, 1);
  service.dispose();
});
