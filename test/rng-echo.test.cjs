'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { TITLES, currentWeights, normalizeState, POOL, CATALOG_VERSION, BOOTSTRAP_EXPECTED_COUNT } = require('../src/rng.cjs');
const { simulateEchoBatch, isZeroEchoActivation, effectiveWeights, scheduleForDay, ECHO_SIMULATOR_VERSION } = require('../supabase/functions/_shared/echo-simulator.mjs');

const catalog = require('../supabase/functions/_shared/echo-title-catalog.json');
const activation = '2026-09-26T12:00:00.000Z';

test('NTC Online Ecos: o catálogo derivado coincide com a fonte canônica versionada e os pesos-base do RNG real', () => {
  assert.equal(catalog.version, CATALOG_VERSION);
  assert.equal(catalog.bootstrapExpectedCount, BOOTSTRAP_EXPECTED_COUNT);
  assert.ok(catalog.titles.length >= BOOTSTRAP_EXPECTED_COUNT);
  if (catalog.version === 1) assert.equal(catalog.titles.length, BOOTSTRAP_EXPECTED_COUNT);
  const expected = new Map(TITLES.map(title => [title.id, title]));
  for (const row of catalog.titles) {
    const source = expected.get(row.id);
    assert.ok(source, `título desconhecido: ${row.id}`);
    assert.equal(row.name, source.name);
    assert.equal(row.tier, source.tier);
    assert.equal(row.base_weight, source.baseWeight.toString());
    assert.equal(row.base_denominator, source.denominator?.toString() || '');
  }
  assert.equal(catalog.titles.reduce((sum, row) => sum + BigInt(row.base_weight), 0n), POOL);
});

test('NTC Online Ecos: a ativação inicial só é aprovada para os quatro perfis totalmente zerados', () => {
  const names = ['nyancat99', 'lulu', 'testandoinfinito', 'AstraUltraMegaLow'];
  const zero = names.map(display_name => ({ display_name, total_rolls: '0', discovered_titles: 0, collection_percentage: '0', best_title_id: null, equipped_title_id: null, playtime_seconds: '0', active_seconds: '0', history_count: 0 }));
  assert.equal(isZeroEchoActivation(zero), true);
  assert.equal(isZeroEchoActivation(zero.slice(1)), false);
  assert.equal(isZeroEchoActivation(zero.map((item, index) => index ? item : { ...item, total_rolls: '1' })), false);
  assert.equal(isZeroEchoActivation(zero.map((item, index) => index ? item : { ...item, history_count: 1 })), false);
});

test('NTC Online Ecos: catálogo pode ser carregado sem progredir até ativação explícita', () => {
  const root = path.join(__dirname, '..');
  const gate = fs.readFileSync(path.join(root, 'supabase/migrations/202609260003_ntc_echo_progression_gate.sql'), 'utf8');
  const dynamic = fs.readFileSync(path.join(root, 'supabase/migrations/202609260004_versioned_dynamic_title_catalog.sql'), 'utf8');
  const edge = fs.readFileSync(path.join(root, 'supabase/functions/advance-echoes/index.ts'), 'utf8');
  assert.match(gate, /add column if not exists progression_enabled boolean not null default false/i);
  assert.match(dynamic, /catalog_version integer primary key/i);
  assert.match(dynamic, /A published title ID is missing from the next catalog version/i);
  assert.match(dynamic, /pg_get_constraintdef\(oid\) ilike '%title_id%'/i);
  assert.match(dynamic, /tier_rank between 0 and 32767/i);
  assert.match(dynamic, /catalog_rows>0 and catalog_rows=version_meta\.title_count/i);
  assert.match(dynamic, /catalog_total/i);
  assert.doesNotMatch(dynamic, /jsonb_array_length\(p_rows\)\s*<>\s*200|catalog_rows\s*<>\s*200|\/\s*200/i);
  assert.match(edge, /ntc_echo_sync_catalog[\s\S]*p_catalog_version:[\s\S]*ntc_echo_claim_batch[\s\S]*claim\.progressionEnabled !== true[\s\S]*progressed: false/);
  assert.match(edge, /zero-state activation validation failed during catalog-only bootstrap/i);
});

test('NTC Online Ecos: migration registra o marco zero e bloqueia claim antes de validar os quatro', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202609260002_ntc_echoes.sql'), 'utf8');
  assert.match(migration, /insert into ntc_private\.echo_activation_audit[\s\S]*initial_zero_state_validated[\s\S]*true/i);
  assert.match(migration, /Echo zero-state activation audit missing/i);
  assert.match(migration, /select c\.profile_id, w\.activation_at, w\.activation_at/i);
  for (const name of ['nyancat99', 'lulu', 'testandoinfinito', 'AstraUltraMegaLow']) assert.ok(migration.includes(name));
  assert.match(migration, /show_bot_badge[\s\S]*true/i);
  assert.match(migration, /on conflict \(activation_at\) do nothing/i);
});

test('NTC Online Ecos: RLS reserva escrita de Ecos à autoridade e a UI só diferencia a badge BOT', () => {
  const root = path.join(__dirname, '..');
  const phaseOne = fs.readFileSync(path.join(root, 'supabase/migrations/202609260001_ntc_online_profiles.sql'), 'utf8');
  const phaseTwo = fs.readFileSync(path.join(root, 'supabase/migrations/202609260002_ntc_echoes.sql'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  assert.match(phaseOne, /alter table public\.profiles enable row level security/i);
  assert.match(phaseOne, /profiles_owner_insert[\s\S]*profile_kind = 'real'[\s\S]*auth\.uid/i);
  assert.match(phaseOne, /profiles_owner_update[\s\S]*profile_kind = 'real'[\s\S]*auth\.uid/i);
  assert.match(phaseTwo, /alter table public\.profile_discoveries enable row level security/i);
  assert.match(phaseTwo, /revoke all on function public\.ntc_echo_commit_batch[\s\S]*from public, anon, authenticated/i);
  assert.match(phaseTwo, /grant execute on function public\.ntc_echo_commit_batch[\s\S]*to service_role/i);
  assert.doesNotMatch(phaseTwo, /alter table public\.profiles disable row level security/i);
  assert.match(app, /entry\.showBotBadge \? '<em class="rng-online-bot-badge">BOT<\/em>'/);
  assert.doesNotMatch(app, /entry\.kind === 'echo' \? 'ECO' : 'JOGADOR'/);
});

test('NTC Online Ecos: marco zero não cria rolls retroativos; batches são determinísticos e só avançam depois do cursor', () => {
  const config = { id: 'nyancat99', seed: 'test-seed', weekdays: [0,1,2,3,4,5,6], session_chance: 1, start_minute: 0, end_minute: 1439, min_session_minutes: 60, max_session_minutes: 60, min_actions_per_second: .45, max_actions_per_second: .65 };
  const state = { activation_at: activation, cursor_at: activation, total_rolls: '0', active_seconds: '0', collected_ids: [], discoveries: [], equipped_title_id: null, best_title_id: null, random_counter: 0, fractional_rolls: 0 };
  const exactActivation = simulateEchoBatch({ state, config, titles: catalog.titles, now: Date.parse(activation) });
  assert.equal(exactActivation.total_rolls, '0');
  assert.deepEqual(exactActivation.newDiscoveries, []);
  const now = Date.parse('2026-09-29T12:00:00.000Z');
  const first = simulateEchoBatch({ state, config, titles: catalog.titles, now });
  const retry = simulateEchoBatch({ state, config, titles: catalog.titles, now });
  assert.deepEqual(first, retry);
  assert.ok(BigInt(first.total_rolls) > 0n);
  assert.ok(first.active_seconds > 0);
  assert.ok(first.newDiscoveries.length > 0);
  assert.equal(new Set(first.collected_ids).size, first.collected_ids.length);
  assert.ok(first.newDiscoveries.every(item => BigInt(item.roll) <= BigInt(first.total_rolls)));
  const localZeroWeights = currentWeights(normalizeState({ collectedIds: [], totalRolls: 0 }));
  for (const row of catalog.titles) assert.equal(BigInt(row.base_weight), localZeroWeights.get(row.id));
  const collectedIds = [...catalog.titles.filter(row => row.tier === 'basic').slice(0, 10), ...catalog.titles.filter(row => row.tier === 'epic').slice(0, 5)].map(row => row.id);
  const localProgressWeights = currentWeights(normalizeState({ collectedIds, totalRolls: 1_000_000 }));
  const serverProgressWeights = effectiveWeights(catalog.titles, collectedIds, '1000000');
  for (const row of catalog.titles) assert.equal(serverProgressWeights.get(row.id), localProgressWeights.get(row.id), `peso de progressão divergiu em ${row.id}`);
});

test('NTC Online Ecos: não há histórico de rolls por ação e um batch tem teto de catch-up de 14 dias', () => {
  const config = { id: 'lulu', seed: 'test-lulu', weekdays: [0,1,2,3,4,5,6], session_chance: 1, start_minute: 0, end_minute: 1439, min_session_minutes: 20, max_session_minutes: 20, min_actions_per_second: .2, max_actions_per_second: .35 };
  const state = { activation_at: activation, cursor_at: activation, total_rolls: '0', active_seconds: '0', collected_ids: [], discoveries: [], equipped_title_id: null, best_title_id: null, random_counter: 0, fractional_rolls: 0 };
  const result = simulateEchoBatch({ state, config, titles: catalog.titles, now: Date.parse('2026-12-31T00:00:00.000Z') });
  assert.ok(Date.parse(result.simulatedTo) - Date.parse(activation) <= 14 * 86_400_000);
  assert.ok(result.discoveries.length <= catalog.titles.length);
  assert.equal('rollHistory' in result, false);
});

test('NTC Online Ecos: simulador aceita catálogo futuro maior e exclui legado do pool sem perder sua posse', () => {
  const added = {
    ...catalog.titles[0],
    id: 'basic-reliquia-do-amanha',
    name: 'Relíquia do Amanhã',
    base_weight: '1000000',
    acquisition: 'normal',
    active: true,
  };
  const futureCatalog = [...catalog.titles, added];
  const weights = effectiveWeights(futureCatalog, [], '0');
  assert.equal(weights.size, catalog.titles.length + 1);
  assert.equal([...weights.values()].reduce((sum, weight) => sum + weight, 0n), POOL);
  assert.ok(weights.has(added.id));

  const retired = { ...catalog.titles[1], id: 'event-title-retired-v1', acquisition: 'unobtainable', active: false };
  const available = effectiveWeights([...catalog.titles, added, retired], [retired.id], '1000');
  assert.equal(available.has(retired.id), false);
  assert.ok(available.has(added.id));
  assert.ok(available.size > 0);
});

test('NTC Online Ecos: atividade diária é determinística, cumpre as quatro personalidades e mantém Astra 24/7', () => {
  assert.equal(ECHO_SIMULATOR_VERSION, 2);
  const configs = [
    { id: 'AstraUltraMegaLow', activity_profile: 'bot_24_7', seed: 'ntc-echo-astra-ultramega-low-v1', timezone: 'America/Sao_Paulo', min_actions_per_second: .3, max_actions_per_second: .45, min_session_minutes: 1, max_session_minutes: 1440, min_active_minutes_per_day: 1440, max_active_minutes_per_day: 1440, min_sessions_per_day: 1, max_sessions_per_day: 1, min_break_minutes: 0, max_break_minutes: 0 },
    { id: 'nyancat99', activity_profile: 'regular_daily', seed: 'ntc-echo-nyancat99-v1', timezone: 'America/Sao_Paulo', min_actions_per_second: .45, max_actions_per_second: .65, min_session_minutes: 90, max_session_minutes: 720, min_active_minutes_per_day: 360, max_active_minutes_per_day: 720, min_sessions_per_day: 2, max_sessions_per_day: 3, min_break_minutes: 45, max_break_minutes: 240 },
    { id: 'lulu', activity_profile: 'fragmented_daily', seed: 'ntc-echo-lulu-v1', timezone: 'America/Sao_Paulo', min_actions_per_second: .2, max_actions_per_second: .35, min_session_minutes: 30, max_session_minutes: 180, min_active_minutes_per_day: 240, max_active_minutes_per_day: 540, min_sessions_per_day: 4, max_sessions_per_day: 7, min_break_minutes: 30, max_break_minutes: 240 },
    { id: 'testandoinfinito', activity_profile: 'intense_daily', seed: 'ntc-echo-testandoinfinito-v1', timezone: 'America/Sao_Paulo', min_actions_per_second: .25, max_actions_per_second: .75, min_session_minutes: 120, max_session_minutes: 900, min_active_minutes_per_day: 480, max_active_minutes_per_day: 900, min_sessions_per_day: 2, max_sessions_per_day: 4, min_break_minutes: 20, max_break_minutes: 300 },
  ];
  const dailyRange = { nyancat99: [360, 720], lulu: [240, 540], testandoinfinito: [480, 900] };
  for (const config of configs) {
    for (let offset = 0; offset < 35; offset++) {
      const noon = new Date(Date.UTC(2026, 8, 26 + offset, 12));
      const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(noon);
      const first = scheduleForDay(config, dateKey);
      assert.deepEqual(scheduleForDay(config, dateKey), first, `${config.id} precisa repetir o mesmo calendário em ${dateKey}`);
      assert.ok(first.length >= config.min_sessions_per_day && first.length <= config.max_sessions_per_day);
      let totalMinutes = 0;
      for (let index = 0; index < first.length; index++) {
        const session = first[index];
        const duration = (session.end - session.start) / 60_000;
        totalMinutes += duration;
        assert.ok(duration >= config.min_session_minutes);
        assert.ok(session.rate >= config.min_actions_per_second && session.rate <= config.max_actions_per_second);
        if (index) assert.ok(first[index - 1].end < session.start, `${config.id} não deve sobrepor sessões em ${dateKey}`);
      }
      if (config.activity_profile === 'bot_24_7') {
        assert.equal(first.length, 1);
        assert.equal(totalMinutes, 1440);
        const tomorrow = new Date(Date.parse(`${dateKey}T12:00:00Z`) + 86_400_000);
        const tomorrowKey = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
        assert.equal(first[0].end, scheduleForDay(config, tomorrowKey)[0].start, 'Astra não pode ter intervalo offline à meia-noite');
      } else {
        const [minimum, maximum] = dailyRange[config.id];
        assert.ok(totalMinutes >= minimum && totalMinutes <= maximum, `${config.id} ficou com ${totalMinutes} min em ${dateKey}`);
      }
    }
  }
});

test('NTC Online Ecos: Astra gera rolls e conta somente o tempo posterior ao marco de ativação', () => {
  const config = { id: 'AstraUltraMegaLow', activity_profile: 'bot_24_7', seed: 'ntc-echo-astra-ultramega-low-v1', timezone: 'America/Sao_Paulo', min_actions_per_second: .3, max_actions_per_second: .45, min_session_minutes: 1, max_session_minutes: 1440, min_active_minutes_per_day: 1440, max_active_minutes_per_day: 1440, min_sessions_per_day: 1, max_sessions_per_day: 1, min_break_minutes: 0, max_break_minutes: 0 };
  const state = { activation_at: activation, cursor_at: activation, total_rolls: '0', active_seconds: '0', collected_ids: [], discoveries: [], equipped_title_id: null, best_title_id: null, random_counter: 0, fractional_rolls: 0 };
  const now = Date.parse('2026-09-26T15:00:00.000Z');
  const result = simulateEchoBatch({ state, config, titles: catalog.titles, now });
  assert.equal(result.active_seconds, Math.floor((now - Date.parse(activation)) / 1000));
  assert.ok(BigInt(result.total_rolls) > 0n);
  assert.deepEqual(result, simulateEchoBatch({ state, config, titles: catalog.titles, now }));
  const baseline = effectiveWeights(catalog.titles, [], '0');
  for (const row of catalog.titles) assert.equal(baseline.get(row.id), BigInt(row.base_weight));
});
