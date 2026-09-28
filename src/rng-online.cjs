'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const SYNC_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const LEADERBOARD_LIMIT = 100;
const RETRY_MAX_MS = 60_000;
const ONLINE_SESSION_STORAGE_KEY = 'ntc-rng-online-session';
const PUBLIC_COLUMNS = 'id,profile_kind,display_name,total_rolls_text,discovered_titles,collection_percentage,equipped_title_name,equipped_tier,best_title_name,best_tier,best_odds,achievements,playtime_seconds_text,active_seconds_text,collection_by_tier,milestones,secrets_found,relics_owned,relics_total,events_participated,longest_singular_drought,longest_same_title_streak,show_bot_badge,activity_status,last_seen,catalog_version';

function parseEnvFile(source = '') {
  const values = {};
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^\s*(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value.trim();
  }
  return values;
}

function isPublishableKey(value) {
  return typeof value === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(value);
}

function readOnlineConfig({ rootDir, packaged = false, env = process.env } = {}) {
  let fileConfig = {};
  if (packaged) {
    try { fileConfig = require('./rng-online-config.generated.cjs'); } catch { fileConfig = {}; }
  } else {
    try { fileConfig = parseEnvFile(fs.readFileSync(path.join(rootDir || path.resolve(__dirname, '..'), '.env.online.local'), 'utf8')); } catch { fileConfig = {}; }
  }
  const url = String(env.SUPABASE_URL || fileConfig.SUPABASE_URL || '').trim();
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || fileConfig.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !publishableKey) return { configured: false, url: '', publishableKey: '' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) return { configured: false, url: '', publishableKey: '' };
  } catch { return { configured: false, url: '', publishableKey: '' }; }
  if (!isPublishableKey(publishableKey)) return { configured: false, url: '', publishableKey: '' };
  return { configured: true, url: url.replace(/\/$/, ''), publishableKey };
}

function countAsDecimal(value, field) {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value).toString();
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error(`Contagem local inválida para sincronizar: ${field}.`);
}

function profileToRow(profile, achievementIds = []) {
  const identity = profile?.identity || {};
  const equipped = identity.equippedTitle || null;
  const record = profile?.record || null;
  const progress = profile?.progress || {};
  const collection = profile?.collection || {};
  const displayName = String(identity.displayName || '').trim();
  if (!displayName) return null;
  if ([...displayName].length > 32) throw new Error('O nome do perfil excede 32 caracteres.');
  const completion = Number(collection.completion);
  const collectionPercentage = Number.isFinite(completion) ? Math.max(0, Math.min(100, completion * 100)) : 0;
  const rolls = BigInt(countAsDecimal(progress.totalRolls ?? '0', 'total_rolls'));
  const collected = Number(collection.collected) || 0;
  const ownedTitles = Number(collection.owned ?? collection.collected) || 0;
  const milestones = [100, 1_000, 10_000, 100_000, 1_000_000, 5_000_000, 10_000_000]
    .filter(value => rolls >= BigInt(value)).map(value => `rolls-${value}`);
  for (const threshold of [5, 10, 20, 40, 80, 120, 160, 200]) if (collected >= threshold) milestones.push(`collection-${threshold}`);
  return {
    profile_kind: 'real',
    catalog_version: Number.isSafeInteger(profile?.catalogVersion) && profile.catalogVersion > 0 ? profile.catalogVersion : 1,
    display_name: displayName,
    total_rolls: rolls.toString(),
    discovered_titles: Number.isSafeInteger(ownedTitles) && ownedTitles >= 0 ? ownedTitles : 0,
    collection_percentage: collectionPercentage.toFixed(2),
    equipped_title_id: equipped?.id || null,
    equipped_title_name: equipped?.name || null,
    equipped_tier: equipped?.tierId || null,
    best_title_id: record?.titleId || null,
    best_title_name: record?.name || null,
    best_tier: record?.tierId || null,
    best_odds: String(record?.acquisitionOdds || record?.baseOdds || '').slice(0, 160),
    active_seconds: countAsDecimal(progress.appOpenSeconds ?? '0', 'active_seconds'),
    collection_by_tier: collection.countsByTier && typeof collection.countsByTier === 'object' ? collection.countsByTier : {},
    milestones: Array.isArray(progress.milestones) ? progress.milestones : milestones,
    secrets_found: Number.isSafeInteger(progress.secretsUnlocked) ? Math.max(0, progress.secretsUnlocked) : 0,
    relics_owned: Number.isSafeInteger(progress.relicsOwned) ? Math.max(0, progress.relicsOwned) : 0,
    relics_total: Number.isSafeInteger(progress.relicsTotal) ? Math.max(0, progress.relicsTotal) : 0,
    events_participated: Number.isSafeInteger(progress.eventsParticipated) ? Math.max(0, progress.eventsParticipated) : 0,
    longest_singular_drought: countAsDecimal(progress.longestSingularDrought ?? '0', 'longest_singular_drought'),
    longest_same_title_streak: countAsDecimal(progress.longestSameTitleStreak ?? '0', 'longest_same_title_streak'),
    achievements: [...new Set((Array.isArray(achievementIds) ? achievementIds : []).filter(id => typeof id === 'string').map(id => id.slice(0, 100)))].slice(0, 500),
    playtime_seconds: countAsDecimal(progress.appOpenSeconds ?? '0', 'playtime_seconds')
  };
}

function safeErrorMessage(error) {
  const message = String(error?.message || 'Falha de sincronização.');
  if (/failed to fetch|network|fetch failed|timeout|offline|enotfound|econn|socket/i.test(message)) return 'Sem conexão. O jogo continua funcionando localmente.';
  if (/anonymous_provider_disabled/i.test(`${error?.code || ''} ${message}`)) return 'Ative o login anônimo nas configurações de Auth do Supabase.';
  if (/relation .* does not exist|schema cache|profiles/i.test(message)) return 'A configuração do NTC Online ainda não foi aplicada ao banco.';
  return 'Não foi possível sincronizar agora. Vamos tentar novamente.';
}

function createEncryptedStorage({ safeStorage, storagePath, storageKey = ONLINE_SESSION_STORAGE_KEY }) {
  async function read(key) {
    if (key !== storageKey) return null;
    try {
      const encrypted = await fs.promises.readFile(storagePath, 'utf8');
      if (!safeStorage.isEncryptionAvailable()) return null;
      const value = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      // Older builds accidentally treated Supabase's setItem(key, value) as setItem(value).
      // Ignore that encrypted key marker so Auth can create and persist a fresh session.
      return value === storageKey ? null : value;
    } catch { return null; }
  }
  async function write(key, value) {
    if (key !== storageKey) throw new Error('Chave de armazenamento de sessão inválida.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('O armazenamento seguro do sistema está indisponível.');
    await fs.promises.mkdir(path.dirname(storagePath), { recursive: true });
    const encrypted = safeStorage.encryptString(String(value)).toString('base64');
    const temporary = `${storagePath}.tmp`;
    await fs.promises.writeFile(temporary, encrypted, { mode: 0o600 });
    await fs.promises.rename(temporary, storagePath);
  }
  return {
    getItem: read,
    setItem: write,
    async removeItem(key) { if (key !== storageKey) return; try { await fs.promises.unlink(storagePath); } catch {} }
  };
}

function createRngOnlineService({ app, safeStorage, config, getSnapshot, onState, createClientImpl = createClient, now = Date.now, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  let client = null;
  let userId = '';
  let channel = null;
  let interval = null;
  let retryTimer = null;
  let observeTimer = null;
  let retryCount = 0;
  let state = { status: config?.configured ? 'connecting' : 'unconfigured', message: config?.configured ? 'Conectando ao NTC Online…' : 'Configure a URL e a Publishable Key do Supabase para conectar.', leaderboard: [], updatedAt: null };
  let lastFingerprint = '';
  let lastImportantFingerprint = '';
  let lastSyncAt = 0;
  let lastPollAt = 0;
  let pendingSnapshot = null;
  let syncPromise = null;
  let resetInProgress = false;
  let closed = false;

  const publish = patch => {
    state = { ...state, ...patch };
    try { onState?.(structuredClone(state)); } catch {}
  };
  const getState = () => structuredClone(state);
  const localRow = snapshot => profileToRow(snapshot?.playerProfile, (snapshot?.achievements || []).filter(item => item.unlocked).map(item => item.id));
  const rowFingerprint = row => row ? JSON.stringify(row) : '';
  const importantFingerprint = row => row ? JSON.stringify([row.display_name, row.discovered_titles, row.equipped_title_id, row.best_title_id, row.best_odds]) : '';

  async function refreshLeaderboard() {
    if (!client || !userId || closed) return false;
    const { data, error } = await client.from('profiles').select(PUBLIC_COLUMNS).eq('visible', true).order('total_rolls', { ascending: false }).order('display_name', { ascending: true }).limit(LEADERBOARD_LIMIT);
    if (error) throw error;
    const leaderboard = (Array.isArray(data) ? data : []).map((entry, index) => ({
      rank: index + 1,
      id: String(entry.id),
      kind: entry.profile_kind === 'echo' ? 'echo' : 'real',
      displayName: String(entry.display_name || 'Viajante'),
      totalRolls: String(entry.total_rolls_text || '0'),
      discoveredTitles: Number(entry.discovered_titles) || 0,
      collectionPercentage: Number(entry.collection_percentage) || 0,
      equippedTitleName: entry.equipped_title_name || '',
      equippedTier: entry.equipped_tier || '',
      bestTitleName: entry.best_title_name || '',
      bestTier: entry.best_tier || '',
      bestOdds: entry.best_odds || '',
      achievements: Array.isArray(entry.achievements) ? entry.achievements.length : 0,
      playtimeSeconds: String(entry.playtime_seconds_text || '0'),
      activeSeconds: String(entry.active_seconds_text || entry.playtime_seconds_text || '0'),
      collectionByTier: entry.collection_by_tier && typeof entry.collection_by_tier === 'object' ? entry.collection_by_tier : {},
      milestones: Array.isArray(entry.milestones) ? entry.milestones : [],
      secretsFound: Number(entry.secrets_found) || 0,
      relicsOwned: Number(entry.relics_owned) || 0,
      relicsTotal: Number(entry.relics_total) || 0,
      eventsParticipated: Number(entry.events_participated) || 0,
      longestSingularDrought: String(entry.longest_singular_drought || '0'),
      longestSameTitleStreak: String(entry.longest_same_title_streak || '0'),
      showBotBadge: entry.show_bot_badge === true,
      activityStatus: entry.profile_kind === 'echo'
        ? (entry.activity_status === 'online' ? 'online' : 'offline')
        : (entry.last_seen && now() - Date.parse(entry.last_seen) < 120_000 ? 'online' : 'offline'),
      lastSeen: entry.last_seen || null
    }));
    lastPollAt = now();
    publish({ status: 'online', message: 'Conectado', leaderboard, updatedAt: new Date(lastPollAt).toISOString() });
    return true;
  }

  async function syncProfile(snapshot, force = false) {
    if (!client || !userId || closed) return false;
    const row = localRow(snapshot);
    if (!row) return false;
    const profileDiscoveries = Array.isArray(snapshot?.playerProfile?.discoveries) ? snapshot.playerProfile.discoveries : [];
    const fingerprint = rowFingerprint([row, profileDiscoveries.map(item => `${item.titleId}:${item.roll}`).join('|')]);
    const heartbeatDue = now() - lastSyncAt >= HEARTBEAT_INTERVAL_MS;
    if (!force && fingerprint === lastFingerprint && !heartbeatDue) return false;
    const payload = { ...row, owner_user_id: userId };
    const { data, error } = await client.from('profiles').upsert(payload, { onConflict: 'owner_user_id' }).select('id').single();
    if (error) throw error;
    const profileId = data?.id;
    if (profileId && profileDiscoveries.length) {
      const discoveries = profileDiscoveries.map(item => ({
        profile_id: profileId,
        title_id: String(item.titleId || '').slice(0, 96),
        title_name: String(item.name || '').slice(0, 100),
        tier: String(item.tierId || '').slice(0, 24),
        tier_rank: Number.isInteger(item.tierRank) ? Math.max(0, Math.min(32767, item.tierRank)) : 0,
        catalog_version: Number.isSafeInteger(item.catalogVersion) && item.catalogVersion > 0 ? item.catalogVersion : 1,
        discovered_roll: countAsDecimal(item.roll || '0', 'discovered_roll'),
        effective_odds_label: String(item.odds || '').slice(0, 160),
        discovered_at: item.discoveredAt || new Date().toISOString()
      })).filter(item => item.title_id && item.discovered_roll !== '0');
      if (discoveries.length) {
        const result = await client.from('profile_discoveries').upsert(discoveries, { onConflict: 'profile_id,title_id', ignoreDuplicates: true });
        if (result.error) throw result.error;
      }
    }
    lastFingerprint = fingerprint;
    lastSyncAt = now();
    return true;
  }

  async function runCycle({ forceSync = false, forcePoll = false } = {}) {
    if (resetInProgress) return false;
    if (syncPromise) return syncPromise;
    const snapshot = pendingSnapshot || getSnapshot?.();
    pendingSnapshot = null;
    syncPromise = (async () => {
      try {
        if (snapshot) await syncProfile(snapshot, forceSync);
        if (forcePoll || now() - lastPollAt >= SYNC_INTERVAL_MS) await refreshLeaderboard();
        retryCount = 0;
        return true;
      } catch (error) {
        const message = safeErrorMessage(error);
        publish({ status: /sem conexão/i.test(message) ? 'offline' : 'error', message });
        scheduleRetry();
        return false;
      } finally { syncPromise = null; }
    })();
    return syncPromise;
  }

  function scheduleRetry() {
    if (closed || retryTimer) return;
    retryCount++;
    const delay = Math.min(RETRY_MAX_MS, 2_000 * 2 ** Math.min(retryCount - 1, 5));
    retryTimer = setTimeoutImpl(() => { retryTimer = null; void connect(); }, delay);
  }

  async function connect() {
    if (closed || !config?.configured) return getState();
    publish({ status: 'connecting', message: 'Conectando ao NTC Online…' });
    try {
      if (!client) {
        const storage = createEncryptedStorage({ safeStorage, storagePath: path.join(app.getPath('userData'), 'ntc-online-session.enc'), storageKey: ONLINE_SESSION_STORAGE_KEY });
        if (!safeStorage?.isEncryptionAvailable()) throw new Error('O armazenamento seguro do sistema está indisponível.');
        client = createClientImpl(config.url, config.publishableKey, {
          auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, storage, storageKey: ONLINE_SESSION_STORAGE_KEY },
          realtime: { params: { eventsPerSecond: 5 } }
        });
      }
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      let session = sessionResult.data?.session;
      if (!session) {
        const signInResult = await client.auth.signInAnonymously();
        if (signInResult.error) throw signInResult.error;
        session = signInResult.data?.session;
      }
      userId = session?.user?.id || '';
      if (!userId) throw new Error('O Supabase não retornou uma identidade online.');
      retryCount = 0;
      if (!interval) interval = setIntervalImpl(() => { void runCycle({ forcePoll: false }); }, SYNC_INTERVAL_MS);
      await runCycle({ forceSync: true, forcePoll: true });
      subscribeRealtime();
      return getState();
    } catch (error) {
      const message = safeErrorMessage(error);
      publish({ status: /sem conexão/i.test(message) ? 'offline' : 'error', message });
      scheduleRetry();
      return getState();
    }
  }

  function subscribeRealtime() {
    if (!client || channel || closed) return;
    try {
      channel = client.channel('ntc-rng-public-leaderboard')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          if (retryTimer) { clearTimeoutImpl(retryTimer); retryTimer = null; }
          if (now() - lastPollAt > 800) void runCycle({ forcePoll: true });
        })
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Realtime is opportunistic; the polling cycle remains active.
          }
        });
    } catch { channel = null; }
  }

  function observe(snapshot) {
    if (closed || resetInProgress) return;
    pendingSnapshot = snapshot;
    let row;
    try { row = localRow(snapshot); } catch (error) { publish({ status: 'error', message: safeErrorMessage(error) }); return; }
    const profileDiscoveries = Array.isArray(snapshot?.playerProfile?.discoveries) ? snapshot.playerProfile.discoveries : [];
    const fingerprint = rowFingerprint([row, profileDiscoveries.map(item => `${item.titleId}:${item.roll}`).join('|')]);
    const important = importantFingerprint(row);
    const changed = fingerprint !== lastFingerprint;
    const importantChanged = important && important !== lastImportantFingerprint;
    if (row) lastImportantFingerprint = important;
    if (client && userId && changed && importantChanged) {
      if (retryTimer) { clearTimeoutImpl(retryTimer); retryTimer = null; }
      if (observeTimer) clearTimeoutImpl(observeTimer);
      observeTimer = setTimeoutImpl(() => { observeTimer = null; if (!closed && !resetInProgress) void runCycle({ forceSync: true }); }, 350);
    }
  }

  async function resetOwnProfile() {
    if (closed || !client || !userId) throw new Error('Conecte-se ao NTC Online antes de resetar também o perfil do ranking. Nenhum progresso local foi alterado.');
    resetInProgress = true;
    try {
      if (observeTimer) { clearTimeoutImpl(observeTimer); observeTimer = null; }
      if (retryTimer) { clearTimeoutImpl(retryTimer); retryTimer = null; }
      if (syncPromise) await syncPromise;
      pendingSnapshot = null;
      const { data, error } = await client.rpc('ntc_reset_my_rng_profile');
      if (error) throw error;
      lastFingerprint = '';
      lastImportantFingerprint = '';
      lastSyncAt = now();
      let leaderboardRefreshed = false;
      try { leaderboardRefreshed = await refreshLeaderboard(); }
      catch (refreshError) { publish({ status: 'error', message: safeErrorMessage(refreshError) }); }
      return {
        ok: true,
        profileFound: data?.profile_found === true,
        deletedDiscoveries: Number.isSafeInteger(data?.deleted_discoveries) ? data.deleted_discoveries : 0,
        leaderboardRefreshed
      };
    } finally { resetInProgress = false; }
  }

  function start() {
    if (!config?.configured) return Promise.resolve(getState());
    return connect();
  }

  function retry() {
    if (retryTimer) { clearTimeoutImpl(retryTimer); retryTimer = null; }
    retryCount = 0;
    return connect();
  }

  async function flush(timeoutMs = 1200) {
    if (!client || !userId || closed) return false;
    let timeout;
    try {
      return await Promise.race([
        runCycle({ forceSync: true, forcePoll: false }),
        new Promise(resolve => { timeout = setTimeoutImpl(() => resolve(false), timeoutMs); })
      ]);
    } finally { if (timeout) clearTimeoutImpl(timeout); }
  }

  function dispose() {
    closed = true;
    if (interval) clearIntervalImpl(interval);
    if (retryTimer) clearTimeoutImpl(retryTimer);
    if (observeTimer) clearTimeoutImpl(observeTimer);
    if (channel && client) void client.removeChannel(channel);
    interval = retryTimer = observeTimer = channel = null;
  }

  return { start, retry, observe, flush, resetOwnProfile, dispose, getState };
}

module.exports = { SYNC_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, LEADERBOARD_LIMIT, parseEnvFile, isPublishableKey, readOnlineConfig, countAsDecimal, profileToRow, safeErrorMessage, createEncryptedStorage, createRngOnlineService };
