'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ClipboardHistoryStore,
  DEFAULT_QUOTA_BYTES,
  DEFAULT_RETENTION_DAYS,
  DAY_MS
} = require('../src/clipboard-history.cjs');

async function withStore(run, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-clipboard-test-'));
  let clock = options.now ?? 1_800_000_000_000;
  let nextId = 1;
  const store = new ClipboardHistoryStore(root, {
    now: () => clock,
    idFactory: () => String(nextId++).padStart(32, '0')
  });
  await store.ready;
  try { await run({ root, store, setNow: value => { clock = value; }, getNow: () => clock }); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('starts with the requested local defaults', async () => {
  await withStore(async ({ store }) => {
    assert.deepEqual((await store.getState()).settings, { quotaBytes: DEFAULT_QUOTA_BYTES, retentionDays: DEFAULT_RETENTION_DAYS });
    assert.equal((await store.list()).total, 0);
  });
});

test('persists text and image payloads separately and reloads them', async () => {
  await withStore(async ({ root, store }) => {
    await store.saveSettings({ quotaBytes: 12345, retentionDays: null });
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const saved = await store.record({ text: 'texto salvo', image });
    assert.equal(saved.saved, true);
    assert.equal(saved.item.kind, 'mixed');
    const reloaded = new ClipboardHistoryStore(root);
    await reloaded.ready;
    assert.deepEqual((await reloaded.getState()).settings, { quotaBytes: 12345, retentionDays: null });
    const item = await reloaded.readItem(saved.item.id);
    assert.equal(item.text, 'texto salvo');
    assert.deepEqual(item.image, image);
    assert.equal(item.entry.hasImage, true);
  });
});

test('deduplicates identical clips, moves them to the top, and preserves pinning', async () => {
  await withStore(async ({ store, setNow, getNow }) => {
    const first = await store.record({ text: 'mesmo conteúdo' });
    await store.setPinned(first.item.id, true);
    setNow(getNow() + 5000);
    const duplicate = await store.record({ text: 'mesmo conteúdo' });
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.count, 1);
    assert.equal(duplicate.item.id, first.item.id);
    assert.equal(duplicate.item.pinned, true);
    assert.equal(duplicate.item.createdAt, getNow());
  });
});

test('searches full text and filters text, images, pinned entries, and pages', async () => {
  await withStore(async ({ store }) => {
    const text = await store.record({ text: 'Texto completo com palavra escondida' });
    await store.record({ image: Buffer.from('png') });
    await store.setPinned(text.item.id, true);
    assert.equal((await store.list({ query: 'palavra escondida' })).total, 1);
    assert.equal((await store.list({ filter: 'image' })).total, 1);
    assert.equal((await store.list({ filter: 'text' })).total, 1);
    assert.equal((await store.list({ filter: 'pinned' })).total, 1);
    const page = await store.list({ limit: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.hasMore, true);
  });
});

test('expires unpinned clips after the configured retention but keeps pinned clips', async () => {
  await withStore(async ({ store, setNow, getNow }) => {
    await store.saveSettings({ quotaBytes: DEFAULT_QUOTA_BYTES, retentionDays: 1 });
    const expired = await store.record({ text: 'expira' });
    const pinned = await store.record({ text: 'fixado' });
    await store.setPinned(pinned.item.id, true);
    setNow(getNow() + DAY_MS);
    const nextStore = new ClipboardHistoryStore(path.dirname(store.rootPath), { now: getNow });
    await nextStore.ready;
    const list = await nextStore.list();
    assert.deepEqual(list.items.map(item => item.id), [pinned.item.id]);
    assert.equal(await nextStore.readItem(expired.item.id), null);
  });
});

test('Never retention survives arbitrarily large time jumps', async () => {
  await withStore(async ({ store, setNow, getNow }) => {
    await store.saveSettings({ quotaBytes: DEFAULT_QUOTA_BYTES, retentionDays: null });
    const saved = await store.record({ text: 'não expira' });
    setNow(getNow() + DAY_MS * 10_000);
    assert.equal((await store.list()).items[0].id, saved.item.id);
  });
});

test('shortening retention immediately removes entries that already expired', async () => {
  await withStore(async ({ store, setNow, getNow }) => {
    const old = await store.record({ text: 'antigo' });
    setNow(getNow() + DAY_MS * 4);
    const current = await store.record({ text: 'recente' });
    const result = await store.saveSettings({ quotaBytes: DEFAULT_QUOTA_BYTES, retentionDays: 2 });
    assert.equal(result.removedCount, 1);
    assert.deepEqual((await store.list()).items.map(item => item.id), [current.item.id]);
    assert.equal(await store.readItem(old.item.id), null);
  });
});

test('quota removes the oldest unpinned clips first and protects pinned entries', async () => {
  await withStore(async ({ store }) => {
    await store.saveSettings({ quotaBytes: 7, retentionDays: null });
    const pinned = await store.record({ text: 'abc' });
    const old = await store.record({ text: 'def' });
    await store.setPinned(pinned.item.id, true);
    const latest = await store.record({ text: 'ghi' });
    assert.equal(latest.saved, true);
    assert.equal(latest.usedBytes, 6);
    assert.deepEqual((await store.list()).items.map(item => item.id), [latest.item.id, pinned.item.id]);
    assert.equal(await store.readItem(old.item.id), null);
  });
});

test('rejects a clip that exceeds quota and warns when pinned data occupies the quota', async () => {
  await withStore(async ({ store }) => {
    await store.saveSettings({ quotaBytes: 3, retentionDays: null });
    const pinned = await store.record({ text: 'abc' });
    await store.setPinned(pinned.item.id, true);
    const tooLarge = await store.record({ text: 'abcd' });
    assert.equal(tooLarge.saved, false);
    assert.equal(tooLarge.reason, 'item-exceeds-limit');
    const blocked = await store.record({ text: 'x' });
    assert.equal(blocked.saved, false);
    assert.equal(blocked.reason, 'quota-pinned');
    assert.equal(blocked.count, 1);
  });
});

test('pinning prevents retention expiry and unpinning restores normal expiry', async () => {
  await withStore(async ({ store, setNow, getNow }) => {
    await store.saveSettings({ quotaBytes: DEFAULT_QUOTA_BYTES, retentionDays: 1 });
    const saved = await store.record({ text: 'fixa e depois expira' });
    await store.setPinned(saved.item.id, true);
    setNow(getNow() + DAY_MS * 2);
    const reloaded = new ClipboardHistoryStore(path.dirname(store.rootPath), { now: getNow });
    await reloaded.ready;
    assert.equal((await reloaded.list()).total, 1);
    await reloaded.setPinned(saved.item.id, false);
    const next = new ClipboardHistoryStore(path.dirname(store.rootPath), { now: getNow });
    await next.ready;
    assert.equal((await next.list()).total, 0);
  });
});

test('supports deleting one item and clearing all items without changing settings', async () => {
  await withStore(async ({ store }) => {
    await store.saveSettings({ quotaBytes: 1234, retentionDays: null });
    const first = await store.record({ text: 'um' });
    await store.record({ text: 'dois' });
    assert.equal((await store.deleteItem(first.item.id)).count, 1);
    const cleared = await store.clear();
    assert.equal(cleared.removedCount, 1);
    assert.equal(cleared.count, 0);
    assert.deepEqual(cleared.settings, { quotaBytes: 1234, retentionDays: null });
  });
});

test('a malformed manifest leaves existing files untouched and blocks overwriting the history', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ntc-clipboard-corrupt-'));
  const folder = path.join(root, 'ntc-clipboard');
  const payloads = path.join(folder, 'items');
  await fs.mkdir(payloads, { recursive: true });
  const damaged = '{"history": ';
  const oldPayload = path.join(payloads, `${'a'.repeat(32)}.txt`);
  await fs.writeFile(path.join(folder, 'history.json'), damaged);
  await fs.writeFile(oldPayload, 'recoverable data');
  try {
    const store = new ClipboardHistoryStore(root);
    const clearBeforeInitialization = store.clear();
    const recordBeforeInitialization = store.record({ text: 'new' });
    await store.ready;
    assert.equal((await store.getState()).unavailable, true);
    assert.equal((await clearBeforeInitialization).ok, false);
    assert.equal((await recordBeforeInitialization).saved, false);
    assert.equal(await fs.readFile(path.join(folder, 'history.json'), 'utf8'), damaged);
    assert.equal(await fs.readFile(oldPayload, 'utf8'), 'recoverable data');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
