'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEnvFile, readOnlineConfig, countAsDecimal, profileToRow, createEncryptedStorage, createRngOnlineService } = require('../src/rng-online.cjs');

test('NTC Online: lê apenas URL e Publishable Key do arquivo local', () => {
  const emptyConfigRoot = path.join(os.tmpdir(), `ntc-online-config-${process.pid}-${Date.now()}`);
  assert.deepEqual(parseEnvFile('# comment\nSUPABASE_URL=https://x.supabase.co\nSUPABASE_PUBLISHABLE_KEY="sb_publishable_abc-123"\nSERVICE_ROLE=ignored'), {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc-123'
  });
  assert.equal(readOnlineConfig({ rootDir: emptyConfigRoot, env: {}, packaged: false }).configured, false);
  assert.equal(readOnlineConfig({ rootDir: emptyConfigRoot, env: { SUPABASE_URL: 'http://localhost:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' }, packaged: false }).configured, false);
  assert.equal(readOnlineConfig({ rootDir: emptyConfigRoot, env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'service_role_secret' }, packaged: false }).configured, false);
});

test('NTC Online: transporta agregados como strings e valida contagens não seguras', () => {
  assert.equal(countAsDecimal('900719925474099312345', 'total_rolls'), '900719925474099312345');
  assert.throws(() => countAsDecimal(Number.MAX_SAFE_INTEGER + 1, 'total_rolls'), /Contagem local inválida/);
  const row = profileToRow({
    identity: { displayName: '  Edu 🜂  ', equippedTitle: { id: 'title-a', name: 'Vigia', tierId: 'epic' } },
    record: { titleId: 'title-b', name: 'Peregrino', tierId: 'unique', acquisitionOdds: '1 em 814.955' },
    progress: { totalRolls: 150000, appOpenSeconds: 9000, secretsUnlocked: 2, relicsOwned: 3, relicsTotal: 8, eventsParticipated: 4, longestSingularDrought: 700, longestSameTitleStreak: 8 },
    collection: { collected: 42, completion: .21, countsByTier: { basic: 20, epic: 20, unique: 2 } }
  }, ['rolls-100', 'rolls-100', 1]);
  assert.equal(row.display_name, 'Edu 🜂');
  assert.equal(row.total_rolls, '150000');
  assert.equal(row.playtime_seconds, '9000');
  assert.equal(row.collection_percentage, '21.00');
  assert.deepEqual(row.achievements, ['rolls-100']);
  assert.equal(row.best_odds, '1 em 814.955');
  assert.deepEqual(row.collection_by_tier, { basic: 20, epic: 20, unique: 2 });
  assert.equal(row.secrets_found, 2);
  assert.equal(row.relics_owned, 3);
  assert.equal(row.events_participated, 4);
  assert.equal(profileToRow({ identity: { displayName: '' } }), null);
});

test('NTC Online: persiste sessão usando conteúdo cifrado pelo armazenamento do sistema', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-online-test-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: value => value.toString().replace(/^encrypted:/, '')
  };
  const storagePath = path.join(folder, 'session.enc');
  const storage = createEncryptedStorage({ safeStorage, storagePath });
  await storage.setItem('ntc-rng-online-session', 'session-secret');
  assert.notEqual(fs.readFileSync(path.join(folder, 'session.enc'), 'utf8'), 'session-secret');
  assert.equal(await storage.getItem('ntc-rng-online-session'), 'session-secret');
  await storage.removeItem('ntc-rng-online-session');
  assert.equal(await storage.getItem('ntc-rng-online-session'), null);

  const legacyPath = path.join(folder, 'legacy-session.enc');
  await fs.promises.writeFile(legacyPath, Buffer.from('encrypted:ntc-rng-online-session').toString('base64'));
  const legacyStorage = createEncryptedStorage({ safeStorage, storagePath: legacyPath });
  assert.equal(await legacyStorage.getItem('ntc-rng-online-session'), null);
});

test('NTC Online: cria sessão anônima, publica só o perfil local e lê ranking sem bloquear a app', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-online-service-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let anonymousLogins = 0;
  let uploaded = null;
  let channelCallback = null;
  let clientOptions = null;
  const uploadedDiscoveries = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInAnonymously: async () => { anonymousLogins++; return { data: { session: { user: { id: 'user-1', is_anonymous: true } } }, error: null }; }
    },
    from: table => ({
      upsert: (row, options) => {
        if (table === 'profiles') {
          uploaded = { row, options };
          return { select() { return { single: async () => ({ data: { id: 'profile-1' }, error: null }) }; } };
        }
        uploadedDiscoveries.push(...row);
        return Promise.resolve({ data: null, error: null });
      },
      select: () => ({ eq() { return this; }, order() { return this; }, limit: async () => ({ data: [
        { id: 'profile-1', profile_kind: 'real', display_name: 'Edu', total_rolls_text: '150000', discovered_titles: 12, collection_percentage: 6, achievements: ['rolls-100'], playtime_seconds_text: '1000', active_seconds_text: '1000', show_bot_badge: false, activity_status: 'offline' }
      ], error: null }) }),
    }),
    channel: () => ({ on(_kind, _filter, callback) { channelCallback = callback; return this; }, subscribe() { return this; } }),
    removeChannel: async () => true
  };
  const service = createRngOnlineService({
    app: { getPath: () => folder },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    config: { configured: true, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test' },
    getSnapshot: () => ({ playerProfile: { identity: { displayName: 'Edu' }, discoveries: [{ titleId: 'basic-01', name: 'Primeira Faísca', tierId: 'basic', tierRank: 0, roll: '1', odds: '1 em 2' }], collection: { collected: 12, completion: .06 }, progress: { totalRolls: 150000, appOpenSeconds: 1000 } }, achievements: [{ id: 'rolls-100', unlocked: true }] }),
    createClientImpl: (_url, _key, options) => { clientOptions = options; return client; }
  });
  t.after(() => service.dispose());
  const state = await service.start();
  assert.equal(state.status, 'online');
  assert.equal(anonymousLogins, 1);
  assert.equal(clientOptions.auth.persistSession, true);
  assert.equal(uploaded.row.owner_user_id, 'user-1');
  assert.equal(uploaded.row.total_rolls, '150000');
  assert.equal(uploaded.row.profile_kind, 'real');
  assert.equal(uploaded.options.onConflict, 'owner_user_id');
  assert.equal(uploaded.row.active_seconds, '1000');
  assert.equal(uploadedDiscoveries[0].profile_id, 'profile-1');
  assert.equal(uploadedDiscoveries[0].effective_odds_label, '1 em 2');
  assert.equal(state.leaderboard[0].displayName, 'Edu');
  assert.equal(state.leaderboard[0].totalRolls, '150000');
  assert.equal(typeof channelCallback, 'function');
});

test('NTC Online reset chama somente o RPC da sessão autenticada e confirma remoção no ranking', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-online-reset-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  let remoteRows = [{ id: 'profile-own', profile_kind: 'real', display_name: 'Edu', total_rolls_text: '152003', discovered_titles: 40, collection_percentage: 20, achievements: ['rolls-100'], playtime_seconds_text: '1000', active_seconds_text: '900' }];
  const rpcCalls = [];
  const authCalls = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'only-current-auth-user' } } }, error: null }),
      signInAnonymously: async () => { authCalls.push('signInAnonymously'); throw new Error('must reuse the existing session'); },
      signOut: async () => { authCalls.push('signOut'); }
    },
    rpc: async (...args) => {
      rpcCalls.push(args);
      remoteRows = [];
      return { data: { profile_found: true, deleted_discoveries: 40 }, error: null };
    },
    from: table => ({
      upsert: (_row, _options) => ({ select() { return { single: async () => ({ data: { id: 'profile-own' }, error: null }) }; } }),
      select: () => ({ eq() { return this; }, order() { return this; }, limit: async () => ({ data: table === 'profiles' ? remoteRows : [], error: null }) })
    }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => true
  };
  const service = createRngOnlineService({
    app: { getPath: () => folder },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    config: { configured: true, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_test' },
    getSnapshot: () => ({ playerProfile: { identity: { displayName: 'Edu' }, discoveries: [], collection: { collected: 40, completion: .2 }, progress: { totalRolls: 152003, appOpenSeconds: 900 } }, achievements: [] }),
    createClientImpl: () => client
  });
  t.after(() => service.dispose());

  assert.equal((await service.start()).status, 'online');
  const result = await service.resetOwnProfile();

  assert.deepEqual(rpcCalls, [['ntc_reset_my_rng_profile']]);
  assert.deepEqual(authCalls, [], 'reset preserves the auth identity and session');
  assert.deepEqual(result, { ok: true, profileFound: true, deletedDiscoveries: 40, leaderboardRefreshed: true });
  assert.deepEqual(service.getState().leaderboard, [], 'the next ranking read no longer contains this profile');
});
