import { createClient } from 'npm:@supabase/supabase-js@2';
import catalogData from '../_shared/echo-title-catalog.json' with { type: 'json' };
import { ECHO_SIMULATOR_VERSION, isZeroEchoActivation, simulateEchoBatch } from '../_shared/echo-simulator.mjs';

const catalogRows = catalogData.titles;

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function oddsLabel(value: string): string {
  try { return `1 em ${new Intl.NumberFormat('pt-BR').format(BigInt(value))}`; } catch { return ''; }
}

function milestoneEvents(profileId: string, username: string, previousRolls: bigint, state: ReturnType<typeof simulateEchoBatch>) {
  const events: Array<Record<string, unknown>> = [];
  const rollMilestones = [100_000n, 1_000_000n, 5_000_000n, 10_000_000n];
  const collectionMilestones = [5, 10, 20, 40, 80, 120, 160, 200];
  const total = BigInt(state.total_rolls);
  for (const milestone of rollMilestones) if (previousRolls < milestone && total >= milestone) {
    events.push({ id: `${profileId}:ROLL_MILESTONE:${milestone}`, type: 'ROLL_MILESTONE', payload: { value: milestone.toString() }, createdAt: state.cursor_at });
  }
  const oldCount = Array.isArray(state.collected_ids) ? state.collected_ids.length - state.newDiscoveries.length : 0;
  for (const milestone of collectionMilestones) if (oldCount < milestone && state.collected_ids.length >= milestone) {
    events.push({ id: `${profileId}:COLLECTION_MILESTONE:${milestone}`, type: 'COLLECTION_MILESTONE', payload: { value: milestone }, createdAt: state.cursor_at });
  }
  void username;
  return events;
}

function projectEcho(config: Record<string, any>, state: ReturnType<typeof simulateEchoBatch>, catalog: any[]) {
  const byId = new Map(catalog.map(title => [title.id, title]));
  const counts: Record<string, number> = {};
  for (const titleId of state.collected_ids) {
    const tier = byId.get(titleId)?.tier;
    if (tier) counts[tier] = (counts[tier] || 0) + 1;
  }
  const best = byId.get(state.best_title_id || '') || null;
  const equipped = byId.get(state.equipped_title_id || '') || null;
  const bestRecord = best ? state.discoveries.find((item: any) => item.titleId === best.id) : null;
  const odds = bestRecord?.odds || bestRecord?.effectiveOddsDenominator || '';
  const milestones = [
    ...[100_000, 1_000_000, 5_000_000, 10_000_000].filter(value => BigInt(state.total_rolls) >= BigInt(value)).map(value => `rolls-${value}`),
    ...[5, 10, 20, 40, 80, 120, 160, 200].filter(value => state.collected_ids.length >= value).map(value => `collection-${value}`)
  ];
  return {
    collection_by_tier: counts,
    best: best ? { name: bestRecord?.name || best.name, tier: bestRecord?.tier || best.tier, odds: bestRecord ? oddsLabel(String(bestRecord.odds || bestRecord.effectiveOddsDenominator || '')) : '' } : null,
    equipped: equipped ? { name: equipped.name, tier: equipped.tier } : null,
    best_odds: odds ? oddsLabel(odds) : '',
    show_bot_badge: Boolean(config.show_bot_badge),
    visible: config.visible !== false,
    milestones
  };
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const jobToken = request.headers.get('x-ntc-echo-job') || '';
  if (jobToken.length < 32) return json(401, { error: 'unauthorized' });
  const requestBody = await request.json().catch(() => ({}));
  const catalogOnly = requestBody?.catalogOnly === true;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  let secretKeys: Record<string, string> = {};
  try { secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { /* Use the legacy server-only fallback below. */ }
  const supabaseKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !supabaseKey) return json(503, { error: 'server_configuration_missing' });

  const admin = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (!Array.isArray(catalogRows) || !catalogRows.length) throw new Error('Echo title catalog is empty');
    const { error: seedError } = await admin.rpc('ntc_echo_sync_catalog', {
      p_job_token: jobToken,
      p_catalog_version: catalogData.version,
      p_bootstrap_expected_count: catalogData.bootstrapExpectedCount,
      p_rows: catalogRows
    });
    if (seedError) throw seedError;

    if (catalogOnly) {
      return json(200, {
        ok: true,
        progressed: false,
        catalogVersion: catalogData.version,
        catalogRows: catalogRows.length
      });
    }

    const { data: claim, error: claimError } = await admin.rpc('ntc_echo_claim_batch', { p_job_token: jobToken });
    if (claimError) throw claimError;
    if (!claim || claim.busy) return json(200, { ok: true, busy: Boolean(claim?.busy), processed: 0 });
    if (claim.progressionEnabled !== true) {
      if (claim.zeroStateValidated !== true || !isZeroEchoActivation(claim.zeroStateValidation || [])) {
        throw new Error('Zero-state activation validation failed during catalog-only bootstrap');
      }
      if (claim.catalogReady !== true || Number(claim.catalogCount) !== catalogRows.length || Number(claim.catalogVersion) !== catalogData.version) {
        throw new Error('Catalog-only bootstrap did not confirm the canonical catalog version');
      }
      return json(200, {
        ok: true,
        progressed: false,
        catalogVersion: Number(claim.catalogVersion),
        catalogRows: Number(claim.catalogCount),
        zeroStateValidated: true,
        echoesVerified: (claim.zeroStateValidation as unknown[]).length
      });
    }
    const catalogVersion = Number(claim.catalogVersion);
    const catalog = Array.isArray(claim.catalog) ? claim.catalog.map((title: any) => ({ ...title, catalog_version: catalogVersion })) : [];
    const echoes = Array.isArray(claim.echoes) ? claim.echoes : [];
    if (claim.zeroStateValidated !== true) throw new Error('Zero-state activation validation is absent');
    const isFirstProgression = echoes.every((echo: any) => echo.state.cursor_at === claim.activationAt && String(echo.state.total_rolls) === '0');
    if (isFirstProgression && !isZeroEchoActivation(claim.zeroStateValidation || [])) throw new Error('Zero-state activation validation failed before first progression');
    if (!catalog.length || Number(claim.catalogVersion) !== catalogData.version) throw new Error('Server catalog version is empty or incompatible');

    const now = Date.now();
    const results: Array<Record<string, unknown>> = [];
    for (const echo of echoes) {
      const config = echo.config;
      const initial = echo.state;
      const previousRolls = BigInt(initial.total_rolls || '0');
      const next = config.active
        ? simulateEchoBatch({ state: initial, config, titles: catalog, now, maxDays: 14 })
        : { ...initial, cursor_at: new Date(now).toISOString(), newDiscoveries: [], status: 'offline', active_seconds: initial.active_seconds };
      const events = [];
      for (const discovery of next.newDiscoveries) {
        events.push({ id: `${config.profile_id}:TITLE_DISCOVERED:${discovery.titleId}`, type: 'TITLE_DISCOVERED', payload: { titleId: discovery.titleId, roll: discovery.roll }, titleId: discovery.titleId, createdAt: discovery.discoveredAt });
      }
      const bestBefore = initial.best_title_id || null;
      if (next.best_title_id && next.best_title_id !== bestBefore) {
        events.push({ id: `${config.profile_id}:BEST_DISCOVERY_CHANGED:${next.best_title_id}`, type: 'BEST_DISCOVERY_CHANGED', payload: { titleId: next.best_title_id }, titleId: next.best_title_id, createdAt: next.cursor_at });
      }
      events.push(...milestoneEvents(config.profile_id, config.id, previousRolls, next));
      const discoveryById = new Map((initial.discoveries || []).map((item: any) => [item.titleId, item]));
      for (const discovery of next.newDiscoveries) discoveryById.set(discovery.titleId, {
        titleId: discovery.titleId, name: discovery.name, tier: discovery.tier,
        tierRank: discovery.tierRank, catalogVersion: catalogData.version,
        roll: discovery.roll, odds: discovery.effectiveOddsDenominator, discoveredAt: discovery.discoveredAt
      });
      next.discoveries = [...discoveryById.values()];
      results.push({
        profile_id: config.profile_id,
        state: next,
        new_discoveries: next.newDiscoveries.map((item: any) => ({ titleId: item.titleId, roll: item.roll, odds: item.effectiveOddsDenominator || item.baseDenominator, oddsLabel: oddsLabel(item.effectiveOddsDenominator || item.baseDenominator), discoveredAt: item.discoveredAt })),
        events,
        projection: projectEcho(config, next, catalog)
      });
    }
    const { error: commitError } = await admin.rpc('ntc_echo_commit_batch', {
      p_job_token: jobToken,
      p_lease_id: claim.leaseId,
      p_revision: claim.revision,
      p_results: results
    });
    if (commitError) throw commitError;
    return json(200, { ok: true, processed: results.length, simulatorVersion: ECHO_SIMULATOR_VERSION });
  } catch (error) {
    const detail = error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    console.error('NTC Echo batch failed', detail);
    return json(500, { error: catalogOnly ? 'catalog_bootstrap_failed' : 'echo_batch_failed', ...(catalogOnly ? { detail } : {}) });
  }
});
