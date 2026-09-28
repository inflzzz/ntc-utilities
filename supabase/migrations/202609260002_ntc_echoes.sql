-- Phase 2: global Echo profiles. Existing real profiles and local RNG state are untouched.
begin;

create schema if not exists ntc_private;
revoke all on schema ntc_private from public, anon, authenticated;

alter table public.profiles
  add column if not exists show_bot_badge boolean not null default false,
  add column if not exists visible boolean not null default true,
  add column if not exists activity_status text not null default 'offline',
  add column if not exists active_seconds numeric(39, 0) not null default 0 check (active_seconds >= 0),
  add column if not exists active_seconds_text text generated always as (active_seconds::text) stored,
  add column if not exists collection_by_tier jsonb not null default '{}'::jsonb,
  add column if not exists milestones jsonb not null default '[]'::jsonb,
  add column if not exists secrets_found integer not null default 0 check (secrets_found >= 0),
  add column if not exists relics_owned integer not null default 0 check (relics_owned >= 0),
  add column if not exists relics_total integer not null default 0 check (relics_total >= 0),
  add column if not exists events_participated integer not null default 0 check (events_participated >= 0),
  add column if not exists longest_singular_drought numeric(39, 0) not null default 0 check (longest_singular_drought >= 0),
  add column if not exists longest_same_title_streak numeric(39, 0) not null default 0 check (longest_same_title_streak >= 0);

alter table public.profiles drop constraint if exists profiles_echo_public_fields_check;
alter table public.profiles add constraint profiles_echo_public_fields_check check (
  activity_status in ('online', 'offline') and
  (profile_kind = 'echo' or (show_bot_badge = false and visible = true))
);

drop policy if exists profiles_authenticated_read on public.profiles;
create policy profiles_authenticated_read on public.profiles for select to authenticated using (visible);
create unique index if not exists profiles_echo_display_name_unique_idx
  on public.profiles (lower(btrim(display_name))) where profile_kind = 'echo';

create table if not exists public.profile_discoveries (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title_id text not null check (title_id ~ '^(basic|epic|unique|legendary|mythic|exalted|glorious|transcendent|dimensional|ntc)-[0-9]{2}$'),
  title_name text not null check (char_length(title_name) between 1 and 100),
  tier text not null,
  tier_rank smallint not null check (tier_rank between 0 and 9),
  discovered_roll numeric(39, 0) not null check (discovered_roll > 0),
  effective_odds_denominator numeric(80, 0) check (effective_odds_denominator > 0),
  effective_odds_label text not null default '' check (char_length(effective_odds_label) <= 160),
  discovered_at timestamptz not null,
  primary key (profile_id, title_id)
);
create index if not exists profile_discoveries_profile_order_idx on public.profile_discoveries(profile_id, tier_rank desc, discovered_roll asc);
alter table public.profile_discoveries enable row level security;
revoke all on public.profile_discoveries from anon, authenticated;
grant select, insert, update on public.profile_discoveries to authenticated;
grant all on public.profile_discoveries to service_role;
drop policy if exists profile_discoveries_public_read on public.profile_discoveries;
create policy profile_discoveries_public_read on public.profile_discoveries for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = profile_id and p.visible)
);
drop policy if exists profile_discoveries_real_owner_write on public.profile_discoveries;
create policy profile_discoveries_real_owner_write on public.profile_discoveries for insert to authenticated with check (
  exists (select 1 from public.profiles p where p.id = profile_id and p.profile_kind = 'real' and p.owner_user_id = (select auth.uid()))
);
create policy profile_discoveries_real_owner_update on public.profile_discoveries for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.profile_kind = 'real' and p.owner_user_id = (select auth.uid())))
  with check (exists (select 1 from public.profiles p where p.id = profile_id and p.profile_kind = 'real' and p.owner_user_id = (select auth.uid())));

create table if not exists ntc_private.echo_world (
  singleton boolean primary key default true check (singleton),
  activation_at timestamptz not null,
  simulator_version integer not null default 1,
  revision bigint not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  catalog_version integer not null default 1
);

create table if not exists ntc_private.echo_configs (
  username text primary key,
  seed text not null,
  timezone text not null default 'America/Sao_Paulo',
  weekdays smallint[] not null,
  session_chance numeric(5, 4) not null check (session_chance between 0 and 1),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 0 and 1439),
  min_session_minutes smallint not null,
  max_session_minutes smallint not null,
  min_actions_per_second numeric(5, 3) not null,
  max_actions_per_second numeric(5, 3) not null,
  show_bot_badge boolean not null default false,
  equip_policy text not null default 'strictly_higher_tier',
  active boolean not null default true,
  visible boolean not null default true,
  profile_id uuid not null unique references public.profiles(id),
  config_version integer not null default 1
);

create table if not exists ntc_private.echo_title_catalog (
  catalog_version integer not null,
  title_id text not null,
  title_name text not null,
  tier text not null,
  tier_rank smallint not null,
  base_weight numeric(80, 0) not null check (base_weight > 0),
  base_denominator numeric(80, 0),
  primary key (catalog_version, title_id)
);

create table if not exists ntc_private.echo_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  activation_at timestamptz not null,
  cursor_at timestamptz not null,
  total_rolls numeric(39, 0) not null default 0,
  active_seconds numeric(39, 0) not null default 0,
  fractional_rolls numeric(20, 12) not null default 0,
  collected_ids text[] not null default '{}',
  equipped_title_id text,
  best_title_id text,
  random_counter bigint not null default 0,
  revision bigint not null default 0,
  lease_id uuid,
  simulator_version integer not null default 1,
  activity_status text not null default 'offline',
  check (total_rolls >= 0 and active_seconds >= 0 and random_counter >= 0)
);

create table if not exists ntc_private.echo_discoveries (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title_id text not null,
  discovered_roll numeric(39, 0) not null,
  effective_odds_denominator numeric(80, 0) not null,
  effective_odds_label text not null default '',
  discovered_at timestamptz not null,
  primary key (profile_id, title_id),
  unique (profile_id, discovered_roll)
);

create table if not exists ntc_private.echo_events (
  event_id text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('TITLE_DISCOVERED', 'BEST_DISCOVERY_CHANGED', 'ROLL_MILESTONE', 'COLLECTION_MILESTONE')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create or replace function public.ntc_profiles_reserve_echo_names()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.profile_kind = 'real' and exists (
    select 1 from ntc_private.echo_configs c where lower(btrim(c.username)) = lower(btrim(new.display_name))
  ) then
    raise exception 'Este nome é reservado para um Eco do NTC.' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists ntc_profiles_reserve_echo_names on public.profiles;
create trigger ntc_profiles_reserve_echo_names before insert or update of display_name, profile_kind on public.profiles
for each row execute function public.ntc_profiles_reserve_echo_names();
revoke all on function public.ntc_profiles_reserve_echo_names() from public, anon, authenticated;

create or replace function public.ntc_profiles_keep_echo_aggregates_monotonic()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.active_seconds := greatest(old.active_seconds, new.active_seconds);
    new.secrets_found := greatest(old.secrets_found, new.secrets_found);
    new.relics_owned := greatest(old.relics_owned, new.relics_owned);
    new.relics_total := greatest(old.relics_total, new.relics_total);
    new.events_participated := greatest(old.events_participated, new.events_participated);
    new.longest_singular_drought := greatest(old.longest_singular_drought, new.longest_singular_drought);
    new.longest_same_title_streak := greatest(old.longest_same_title_streak, new.longest_same_title_streak);
    select coalesce(jsonb_object_agg(key, greatest(old_value, new_value)), '{}'::jsonb)
      into new.collection_by_tier
      from (
        select key,
          coalesce((old.collection_by_tier->>key)::integer, 0) as old_value,
          coalesce((new.collection_by_tier->>key)::integer, 0) as new_value
        from (select jsonb_object_keys(coalesce(old.collection_by_tier,'{}'::jsonb)) as key
              union select jsonb_object_keys(coalesce(new.collection_by_tier,'{}'::jsonb))) keys
      ) counts;
    select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
      into new.milestones
      from (select distinct value from jsonb_array_elements(old.milestones || new.milestones)) all_values;
  end if;
  return new;
end;
$$;
drop trigger if exists ntc_profiles_keep_echo_aggregates_monotonic on public.profiles;
create trigger ntc_profiles_keep_echo_aggregates_monotonic before update on public.profiles
for each row execute function public.ntc_profiles_keep_echo_aggregates_monotonic();
revoke all on function public.ntc_profiles_keep_echo_aggregates_monotonic() from public, anon, authenticated;

create table if not exists ntc_private.echo_activation_audit (
  activation_at timestamptz primary key,
  validated_usernames text[] not null,
  initial_zero_state_validated boolean not null,
  validated_at timestamptz not null,
  check (initial_zero_state_validated and cardinality(validated_usernames) = 4)
);

revoke all on all tables in schema ntc_private from public, anon, authenticated;
grant usage on schema ntc_private to service_role;
grant all on all tables in schema ntc_private to service_role;

do $$
declare
  activation timestamptz := transaction_timestamp();
  collision text;
  audited boolean;
begin
  select p.display_name into collision
  from public.profiles p
  where p.profile_kind = 'real'
    and lower(btrim(p.display_name)) in ('nyancat99', 'lulu', 'testandoinfinito', 'astraultramegalow')
  limit 1;
  if collision is not null then
    raise exception 'Migration interrompida: nome de Eco reservado já pertence a perfil real: %', collision;
  end if;

  insert into ntc_private.echo_world(singleton, activation_at, simulator_version, catalog_version)
  values (true, activation, 1, 1)
  on conflict (singleton) do nothing;

  -- Existing identities are never silently reset on migration replay.
  insert into public.profiles(profile_kind, owner_user_id, display_name, total_rolls, discovered_titles,
      collection_percentage, achievements, playtime_seconds, show_bot_badge, visible, activity_status,
      active_seconds, collection_by_tier, milestones)
  values
    ('echo', null, 'nyancat99', 0, 0, 0, '[]', 0, false, true, 'offline', 0, '{}'::jsonb, '[]'::jsonb),
    ('echo', null, 'lulu', 0, 0, 0, '[]', 0, false, true, 'offline', 0, '{}'::jsonb, '[]'::jsonb),
    ('echo', null, 'testandoinfinito', 0, 0, 0, '[]', 0, false, true, 'offline', 0, '{}'::jsonb, '[]'::jsonb),
    ('echo', null, 'AstraUltraMegaLow', 0, 0, 0, '[]', 0, true, true, 'offline', 0, '{}'::jsonb, '[]'::jsonb)
  on conflict do nothing;

  insert into ntc_private.echo_configs(username, seed, weekdays, session_chance, start_minute, end_minute,
      min_session_minutes, max_session_minutes, min_actions_per_second, max_actions_per_second,
      show_bot_badge, equip_policy, profile_id)
  select seed.username, seed.seed, seed.weekdays, seed.session_chance, seed.start_minute, seed.end_minute,
      seed.min_session_minutes, seed.max_session_minutes, seed.min_actions_per_second, seed.max_actions_per_second,
      seed.show_bot_badge, 'strictly_higher_tier', p.id
  from (values
    ('nyancat99', 'ntc-echo-nyancat99-v1', array[1,2,3,4,5]::smallint[], 0.88::numeric, 1020::smallint, 1320::smallint, 35::smallint, 90::smallint, 0.450::numeric, 0.650::numeric, false),
    ('lulu', 'ntc-echo-lulu-v1', array[2,4,6]::smallint[], 0.76::numeric, 840::smallint, 1260::smallint, 20::smallint, 45::smallint, 0.200::numeric, 0.350::numeric, false),
    ('testandoinfinito', 'ntc-echo-testandoinfinito-v1', array[1,3,5,6]::smallint[], 0.68::numeric, 600::smallint, 1380::smallint, 15::smallint, 110::smallint, 0.250::numeric, 0.750::numeric, false),
    ('AstraUltraMegaLow', 'ntc-echo-astra-ultramega-low-v1', array[2,4,6]::smallint[], 0.42::numeric, 1140::smallint, 1439::smallint, 90::smallint, 180::smallint, 0.550::numeric, 0.850::numeric, true)
  ) as seed(username, seed, weekdays, session_chance, start_minute, end_minute, min_session_minutes,
      max_session_minutes, min_actions_per_second, max_actions_per_second, show_bot_badge)
  join public.profiles p on lower(p.display_name) = lower(seed.username) and p.profile_kind = 'echo'
  on conflict (username) do nothing;

  insert into ntc_private.echo_state(profile_id, activation_at, cursor_at, simulator_version)
  select c.profile_id, w.activation_at, w.activation_at, w.simulator_version
  from ntc_private.echo_configs c cross join ntc_private.echo_world w
  where w.singleton
  on conflict (profile_id) do nothing;

  select exists (select 1 from ntc_private.echo_activation_audit a join ntc_private.echo_world w on w.activation_at=a.activation_at where w.singleton and a.initial_zero_state_validated) into audited;
  -- Fail closed if any of the four simultaneous births is not exactly empty.
  if not audited and ((select count(*) from ntc_private.echo_configs) <> 4
    or exists (
      select 1 from ntc_private.echo_configs c
      join public.profiles p on p.id = c.profile_id
      join ntc_private.echo_state s on s.profile_id = p.id
      where p.total_rolls <> 0 or p.discovered_titles <> 0 or p.collection_percentage <> 0
        or p.best_title_id is not null or p.equipped_title_id is not null or p.playtime_seconds <> 0
        or p.active_seconds <> 0 or s.total_rolls <> 0 or s.active_seconds <> 0
        or cardinality(s.collected_ids) <> 0 or s.cursor_at <> s.activation_at
        or exists (select 1 from ntc_private.echo_discoveries d where d.profile_id = p.id)
        or exists (select 1 from ntc_private.echo_events e where e.profile_id = p.id)
        or exists (select 1 from public.profile_discoveries d where d.profile_id = p.id)
    )) then
    raise exception 'Validação de marco zero dos quatro Ecos falhou; nenhum job poderá iniciar.';
  end if;

  insert into ntc_private.echo_activation_audit(activation_at, validated_usernames, initial_zero_state_validated, validated_at)
  select w.activation_at, array['nyancat99','lulu','testandoinfinito','AstraUltraMegaLow'], true, transaction_timestamp()
  from ntc_private.echo_world w where w.singleton
  on conflict (activation_at) do nothing;
end;
$$;

create or replace function public.ntc_echo_sync_catalog(p_job_token text, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare expected_token text; row_count integer;
begin
  select decrypted_secret into expected_token from vault.decrypted_secrets where name = 'ntc_echo_job_token' limit 1;
  if expected_token is null or p_job_token is distinct from expected_token then raise exception 'Unauthorized'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 200 then raise exception 'Invalid catalog size'; end if;
  insert into ntc_private.echo_title_catalog(catalog_version, title_id, title_name, tier, tier_rank, base_weight, base_denominator)
  select 1, item.id, item.name, item.tier, item.tier_rank, item.base_weight::numeric, nullif(item.base_denominator, '')::numeric
  from jsonb_to_recordset(p_rows) as item(id text, name text, tier text, tier_rank smallint, base_weight text, base_denominator text)
  on conflict (catalog_version, title_id) do update set title_name=excluded.title_name, tier=excluded.tier,
    tier_rank=excluded.tier_rank, base_weight=excluded.base_weight, base_denominator=excluded.base_denominator;
  if (select count(*) from ntc_private.echo_title_catalog where catalog_version = 1) <> 200 then raise exception 'Catalog validation failed'; end if;
  return 200;
end;
$$;

create or replace function public.ntc_echo_claim_batch(p_job_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  expected_token text;
  lease uuid := gen_random_uuid();
  world ntc_private.echo_world%rowtype;
  result jsonb;
begin
  select decrypted_secret into expected_token from vault.decrypted_secrets where name = 'ntc_echo_job_token' limit 1;
  if expected_token is null or p_job_token is distinct from expected_token then raise exception 'Unauthorized'; end if;
  select * into world from ntc_private.echo_world where singleton for update;
  if not found or not exists (select 1 from ntc_private.echo_activation_audit a where a.activation_at=world.activation_at and a.initial_zero_state_validated) then
    raise exception 'Echo zero-state activation audit missing';
  end if;
  if (select count(*) from ntc_private.echo_title_catalog where catalog_version=world.catalog_version) <> 200 then raise exception 'Echo title catalog missing'; end if;
  if world.lease_until is not null and world.lease_until > transaction_timestamp() then return jsonb_build_object('busy', true); end if;
  update ntc_private.echo_world set lease_id=lease, lease_until=transaction_timestamp()+interval '3 minutes', revision=revision+1 where singleton;
  update ntc_private.echo_state s set lease_id=lease
    where s.profile_id in (select c.profile_id from ntc_private.echo_configs c where c.active);
  select jsonb_build_object(
    'leaseId', lease,
    'revision', world.revision+1,
    'activationAt', world.activation_at,
    'simulatorVersion', world.simulator_version,
    'zeroStateValidated', exists (select 1 from ntc_private.echo_activation_audit a where a.activation_at=world.activation_at and a.initial_zero_state_validated),
    'catalog', (select jsonb_agg(jsonb_build_object('id',title_id,'name',title_name,'tier',tier,'tier_rank',tier_rank,'base_weight',base_weight::text,'base_denominator',coalesce(base_denominator::text,'')) order by tier_rank,title_id) from ntc_private.echo_title_catalog where catalog_version=world.catalog_version),
    'zeroStateValidation', (select jsonb_agg(jsonb_build_object('display_name',p.display_name,'total_rolls',p.total_rolls::text,'discovered_titles',p.discovered_titles,'collection_percentage',p.collection_percentage,'best_title_id',p.best_title_id,'equipped_title_id',p.equipped_title_id,'playtime_seconds',p.playtime_seconds::text,'active_seconds',p.active_seconds::text,'history_count',(select count(*) from ntc_private.echo_discoveries d where d.profile_id=p.id)+(select count(*) from ntc_private.echo_events e where e.profile_id=p.id)+(select count(*) from public.profile_discoveries d where d.profile_id=p.id)) order by p.display_name) from ntc_private.echo_configs c join public.profiles p on p.id=c.profile_id),
    'echoes', coalesce((select jsonb_agg(jsonb_build_object(
      'config', jsonb_build_object('id',c.username,'seed',c.seed,'timezone',c.timezone,'weekdays',c.weekdays,'session_chance',c.session_chance,'start_minute',c.start_minute,'end_minute',c.end_minute,'min_session_minutes',c.min_session_minutes,'max_session_minutes',c.max_session_minutes,'min_actions_per_second',c.min_actions_per_second,'max_actions_per_second',c.max_actions_per_second,'show_bot_badge',c.show_bot_badge,'equip_policy',c.equip_policy,'active',c.active,'visible',c.visible,'profile_id',c.profile_id,'config_version',c.config_version),
      'state', jsonb_build_object('profile_id',s.profile_id,'activation_at',s.activation_at,'cursor_at',s.cursor_at,'total_rolls',s.total_rolls::text,'active_seconds',s.active_seconds::text,'fractional_rolls',s.fractional_rolls,'collected_ids',s.collected_ids,'equipped_title_id',s.equipped_title_id,'best_title_id',s.best_title_id,'random_counter',s.random_counter,'revision',s.revision,'simulator_version',s.simulator_version,'activity_status',s.activity_status,'discoveries',coalesce((select jsonb_agg(jsonb_build_object('titleId',d.title_id,'roll',d.discovered_roll::text,'odds',d.effective_odds_denominator::text,'oddsLabel',d.effective_odds_label,'discoveredAt',d.discovered_at) order by d.discovered_roll) from ntc_private.echo_discoveries d where d.profile_id=s.profile_id),'[]'::jsonb))
    ) order by c.username) from ntc_private.echo_configs c join ntc_private.echo_state s on s.profile_id=c.profile_id where c.active), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.ntc_echo_commit_batch(p_job_token text, p_lease_id uuid, p_revision bigint, p_results jsonb)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  expected_token text;
  item jsonb;
  old_state ntc_private.echo_state%rowtype;
  new_state jsonb;
  d jsonb;
  event jsonb;
  v_profile_id uuid;
begin
  select decrypted_secret into expected_token from vault.decrypted_secrets where name = 'ntc_echo_job_token' limit 1;
  if expected_token is null or p_job_token is distinct from expected_token then raise exception 'Unauthorized'; end if;
  perform 1 from ntc_private.echo_world where singleton and lease_id=p_lease_id and revision=p_revision and lease_until > transaction_timestamp() for update;
  if not found then raise exception 'Echo lease expired or revision changed'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 4 then raise exception 'Invalid result batch'; end if;
  for item in select value from jsonb_array_elements(p_results)
  loop
    v_profile_id := (item->>'profile_id')::uuid;
    select * into old_state from ntc_private.echo_state s where s.profile_id=v_profile_id for update;
    if not found or old_state.lease_id is distinct from p_lease_id then raise exception 'Echo state is not claimed'; end if;
    new_state := item->'state';
    if (new_state->>'total_rolls')::numeric < old_state.total_rolls
      or (new_state->>'active_seconds')::numeric < old_state.active_seconds
      or (new_state->>'cursor_at')::timestamptz < old_state.cursor_at
      or not (new_state->'collected_ids' @> to_jsonb(old_state.collected_ids)) then raise exception 'Echo state cannot move backwards'; end if;
    if jsonb_array_length(coalesce(new_state->'collected_ids','[]'::jsonb)) > 200
      or jsonb_array_length(coalesce(item->'new_discoveries','[]'::jsonb)) > 200 then raise exception 'Invalid discovery list'; end if;
    update ntc_private.echo_state set cursor_at=(new_state->>'cursor_at')::timestamptz,
      total_rolls=(new_state->>'total_rolls')::numeric, active_seconds=(new_state->>'active_seconds')::numeric,
      fractional_rolls=coalesce((new_state->>'fractional_rolls')::numeric,0), collected_ids=array(select jsonb_array_elements_text(new_state->'collected_ids')),
      equipped_title_id=nullif(new_state->>'equipped_title_id',''), best_title_id=nullif(new_state->>'best_title_id',''),
      random_counter=(new_state->>'random_counter')::bigint, revision=revision+1,
      activity_status=case when new_state->>'status'='online' then 'online' else 'offline' end, lease_id=null
      where ntc_private.echo_state.profile_id=v_profile_id;
    for d in select value from jsonb_array_elements(coalesce(item->'new_discoveries','[]'::jsonb))
    loop
      insert into ntc_private.echo_discoveries(profile_id,title_id,discovered_roll,effective_odds_denominator,effective_odds_label,discovered_at)
      values (v_profile_id,d->>'titleId',(d->>'roll')::numeric,(d->>'odds')::numeric,coalesce(d->>'oddsLabel',''),(d->>'discoveredAt')::timestamptz)
      on conflict (profile_id,title_id) do nothing;
      insert into public.profile_discoveries(profile_id,title_id,title_name,tier,tier_rank,discovered_roll,effective_odds_denominator,effective_odds_label,discovered_at)
      select v_profile_id,d->>'titleId',t.title_name,t.tier,t.tier_rank,(d->>'roll')::numeric,(d->>'odds')::numeric,coalesce(d->>'oddsLabel',''),(d->>'discoveredAt')::timestamptz
      from ntc_private.echo_title_catalog t where t.catalog_version=1 and t.title_id=d->>'titleId'
      on conflict (profile_id,title_id) do nothing;
    end loop;
    for event in select value from jsonb_array_elements(coalesce(item->'events','[]'::jsonb))
    loop
      insert into ntc_private.echo_events(event_id,profile_id,event_type,payload,created_at)
      values (event->>'id',v_profile_id,event->>'type',event->'payload',(event->>'createdAt')::timestamptz) on conflict (event_id) do nothing;
    end loop;
    update public.profiles p set total_rolls=(new_state->>'total_rolls')::numeric,
      discovered_titles=jsonb_array_length(new_state->'collected_ids'),
      collection_percentage=round(jsonb_array_length(new_state->'collected_ids')::numeric*100/200,2),
      equipped_title_id=nullif(new_state->>'equipped_title_id',''), equipped_title_name=nullif(item->'projection'->'equipped'->>'name',''),
      equipped_tier=nullif(item->'projection'->'equipped'->>'tier',''), best_title_id=nullif(new_state->>'best_title_id',''),
      best_title_name=nullif(item->'projection'->'best'->>'name',''), best_tier=nullif(item->'projection'->'best'->>'tier',''),
      best_odds=coalesce(item->'projection'->'best'->>'odds',''), active_seconds=(new_state->>'active_seconds')::numeric,
      playtime_seconds=(new_state->>'active_seconds')::numeric, collection_by_tier=coalesce(item->'projection'->'collection_by_tier','{}'::jsonb),
      milestones=coalesce(item->'projection'->'milestones','[]'::jsonb), show_bot_badge=(item->'projection'->>'show_bot_badge')::boolean,
      activity_status=case when new_state->>'status'='online' then 'online' else 'offline' end,
      visible=(item->'projection'->>'visible')::boolean
    where p.id=v_profile_id and p.profile_kind='echo';
  end loop;
  update ntc_private.echo_world set lease_id=null, lease_until=null where singleton and lease_id=p_lease_id;
  return true;
end;
$$;

revoke all on function public.ntc_echo_sync_catalog(text,jsonb) from public, anon, authenticated;
revoke all on function public.ntc_echo_claim_batch(text) from public, anon, authenticated;
revoke all on function public.ntc_echo_commit_batch(text,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.ntc_echo_sync_catalog(text,jsonb) to service_role;
grant execute on function public.ntc_echo_claim_batch(text) to service_role;
grant execute on function public.ntc_echo_commit_batch(text,uuid,bigint,jsonb) to service_role;

-- The Edge Function is explicitly public at the gateway but requires this private random token,
-- then uses service-role-only RPCs. The secret never enters the desktop app.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'ntc_echo_job_token', 'Private authorization for the scheduled NTC Echo function')
where not exists (select 1 from vault.secrets where name='ntc_echo_job_token');
-- Add the existing Publishable Key to Vault once under the name ntc_publishable_key before Cron can invoke the endpoint.

create or replace function ntc_private.invoke_echo_function()
returns void language plpgsql security definer set search_path = '' as $$
declare
  job_token text;
  publishable_key text;
begin
  select decrypted_secret into job_token from vault.decrypted_secrets where name='ntc_echo_job_token' limit 1;
  select decrypted_secret into publishable_key from vault.decrypted_secrets where name='ntc_publishable_key' limit 1;
  if job_token is null or publishable_key is null then raise exception 'NTC Echo scheduler Vault secrets are missing'; end if;
  perform net.http_post(
    url := 'https://jzvbvqinrdrhapwgrruy.supabase.co/functions/v1/advance-echoes',
    headers := jsonb_build_object('content-type','application/json','apikey',publishable_key,'x-ntc-echo-job',job_token),
    body := jsonb_build_object('source','pg_cron'),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function ntc_private.invoke_echo_function() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname='ntc-advance-echoes-every-15-minutes';
select cron.schedule('ntc-advance-echoes-every-15-minutes', '*/15 * * * *', 'select ntc_private.invoke_echo_function()');

commit;
