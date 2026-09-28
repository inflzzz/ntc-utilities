begin;

alter table ntc_private.echo_configs
  add column if not exists activity_profile text not null default 'legacy_weekly',
  add column if not exists min_active_minutes_per_day smallint not null default 240,
  add column if not exists max_active_minutes_per_day smallint not null default 540,
  add column if not exists min_sessions_per_day smallint not null default 1,
  add column if not exists max_sessions_per_day smallint not null default 1,
  add column if not exists min_break_minutes smallint not null default 30,
  add column if not exists max_break_minutes smallint not null default 120;

alter table ntc_private.echo_configs
  drop constraint if exists echo_configs_activity_profile_check;
alter table ntc_private.echo_configs
  add constraint echo_configs_activity_profile_check
  check (activity_profile in ('legacy_weekly','bot_24_7','regular_daily','fragmented_daily','intense_daily'));
alter table ntc_private.echo_configs
  drop constraint if exists echo_configs_daily_activity_check;
alter table ntc_private.echo_configs
  add constraint echo_configs_daily_activity_check
  check (
    min_active_minutes_per_day between 1 and 1440
    and max_active_minutes_per_day between min_active_minutes_per_day and 1440
    and min_sessions_per_day between 1 and 24
    and max_sessions_per_day between min_sessions_per_day and 24
    and min_break_minutes between 0 and 1439
    and max_break_minutes between min_break_minutes and 1439
    and min_active_minutes_per_day >= min_sessions_per_day * min_session_minutes
    and max_active_minutes_per_day + (max_sessions_per_day - 1) * min_break_minutes <= 1440
  );

do $$
declare
  world ntc_private.echo_world%rowtype;
  expected_names text[] := array['AstraUltraMegaLow','lulu','nyancat99','testandoinfinito'];
  configured_names text[];
begin
  select * into world from ntc_private.echo_world where singleton for update;
  if not found then raise exception 'Echo world missing; refusing activity-profile update'; end if;
  if not world.progression_enabled then raise exception 'Echo progression gate is not enabled; refusing to alter activation state'; end if;
  if world.lease_id is not null or world.lease_until is not null then raise exception 'Echo lease exists; refusing cursor reset'; end if;
  if exists (select 1 from cron.job where jobname='ntc-advance-echoes-every-15-minutes' and active) then
    raise exception 'Echo Cron is active; pause it before changing activity profiles';
  end if;

  select array_agg(username order by username) into configured_names from ntc_private.echo_configs;
  if configured_names is distinct from expected_names then raise exception 'Expected exactly the four known Echo configurations'; end if;
  if (select count(*) from ntc_private.echo_state) <> 4
    or (select count(*) from ntc_private.echo_discoveries) <> 0
    or (select count(*) from ntc_private.echo_events) <> 0
    or (select count(*) from public.profile_discoveries d join ntc_private.echo_configs c on c.profile_id=d.profile_id) <> 0
    then raise exception 'Echo history exists; refusing cursor reset'; end if;
  if exists (
    select 1
    from ntc_private.echo_configs c
    join ntc_private.echo_state s on s.profile_id=c.profile_id
    join public.profiles p on p.id=c.profile_id
    where p.profile_kind <> 'echo'
      or s.activation_at <> world.activation_at
      or s.total_rolls <> 0 or s.active_seconds <> 0 or s.fractional_rolls <> 0
      or s.random_counter <> 0 or cardinality(s.collected_ids) <> 0
      or s.equipped_title_id is not null or s.best_title_id is not null
      or p.total_rolls <> 0 or p.discovered_titles <> 0 or p.collection_percentage <> 0
      or p.playtime_seconds <> 0 or p.active_seconds <> 0
      or p.equipped_title_id is not null or p.best_title_id is not null
      or p.show_bot_badge <> (c.username='AstraUltraMegaLow')
  ) then raise exception 'Echo state is not the expected zero state; refusing cursor reset'; end if;
end;
$$;

update ntc_private.echo_configs set
  activity_profile = case username
    when 'AstraUltraMegaLow' then 'bot_24_7'
    when 'nyancat99' then 'regular_daily'
    when 'lulu' then 'fragmented_daily'
    when 'testandoinfinito' then 'intense_daily'
  end,
  weekdays = array[0,1,2,3,4,5,6]::smallint[],
  session_chance = 1,
  start_minute = 0,
  end_minute = 1439,
  min_session_minutes = case username when 'nyancat99' then 90 when 'lulu' then 30 when 'testandoinfinito' then 120 else 1 end,
  max_session_minutes = case username when 'nyancat99' then 720 when 'lulu' then 180 when 'testandoinfinito' then 900 else 1440 end,
  min_actions_per_second = case username when 'AstraUltraMegaLow' then 0.300 else min_actions_per_second end,
  max_actions_per_second = case username when 'AstraUltraMegaLow' then 0.450 else max_actions_per_second end,
  min_active_minutes_per_day = case username when 'nyancat99' then 360 when 'lulu' then 240 when 'testandoinfinito' then 480 else 1440 end,
  max_active_minutes_per_day = case username when 'nyancat99' then 720 when 'lulu' then 540 when 'testandoinfinito' then 900 else 1440 end,
  min_sessions_per_day = case username when 'nyancat99' then 2 when 'lulu' then 4 when 'testandoinfinito' then 2 else 1 end,
  max_sessions_per_day = case username when 'nyancat99' then 3 when 'lulu' then 7 when 'testandoinfinito' then 4 else 1 end,
  min_break_minutes = case username when 'nyancat99' then 45 when 'lulu' then 30 when 'testandoinfinito' then 20 else 0 end,
  max_break_minutes = case username when 'nyancat99' then 240 when 'lulu' then 240 when 'testandoinfinito' then 300 else 0 end,
  show_bot_badge = (username='AstraUltraMegaLow'),
  active = true,
  visible = true,
  config_version = config_version + 1;

-- The previous manual dry run only moved cursors: the guard above proves there
-- is no roll, time, seed, discovery, event, or public state to erase. Rewind
-- only those cursors to the original activation instant; activation_at itself
-- is preserved as each Echo's birth timestamp.
update ntc_private.echo_state set cursor_at=activation_at, activity_status='offline', simulator_version=2;
update ntc_private.echo_world set simulator_version=2, revision=revision+1 where singleton;

create or replace function public.ntc_echo_claim_batch(p_job_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  expected_token text; lease uuid:=gen_random_uuid(); world ntc_private.echo_world%rowtype;
  result jsonb; catalog_rows integer; version_meta ntc_private.echo_catalog_versions%rowtype;
begin
  select decrypted_secret into expected_token from vault.decrypted_secrets where name='ntc_echo_job_token' limit 1;
  if expected_token is null or p_job_token is distinct from expected_token then raise exception 'Unauthorized'; end if;
  select * into world from ntc_private.echo_world where singleton for update;
  if not found or not exists(select 1 from ntc_private.echo_activation_audit a where a.activation_at=world.activation_at and a.initial_zero_state_validated) then raise exception 'Echo zero-state activation audit missing'; end if;
  select count(*) into catalog_rows from ntc_private.echo_title_catalog where catalog_version=world.catalog_version;
  select * into version_meta from ntc_private.echo_catalog_versions where catalog_version=world.catalog_version;
  if not world.progression_enabled then
    select jsonb_agg(entry order by entry->>'display_name') into result from (
      select jsonb_build_object('display_name',p.display_name,'total_rolls',p.total_rolls::text,'discovered_titles',p.discovered_titles,'collection_percentage',p.collection_percentage,'best_title_id',p.best_title_id,'equipped_title_id',p.equipped_title_id,'playtime_seconds',p.playtime_seconds::text,'active_seconds',p.active_seconds::text,
        'history_count',(select count(*) from ntc_private.echo_discoveries d where d.profile_id=p.id)+(select count(*) from ntc_private.echo_events e where e.profile_id=p.id)+(select count(*) from public.profile_discoveries d where d.profile_id=p.id)) entry
      from ntc_private.echo_configs c join public.profiles p on p.id=c.profile_id) validated;
    return jsonb_build_object('progressionEnabled',false,'activationAt',world.activation_at,'simulatorVersion',world.simulator_version,
      'catalogVersion',world.catalog_version,'catalogExpectedCount',version_meta.title_count,'zeroStateValidated',true,
      'zeroStateValidation',coalesce(result,'[]'::jsonb),'catalogReady',catalog_rows>0 and catalog_rows=version_meta.title_count,'catalogCount',catalog_rows);
  end if;
  if version_meta.catalog_version is null or catalog_rows<>version_meta.title_count or catalog_rows<1 then raise exception 'Versioned Echo catalog is incomplete'; end if;
  if world.lease_until is not null and world.lease_until>transaction_timestamp() then return jsonb_build_object('busy',true); end if;
  update ntc_private.echo_world set lease_id=lease,lease_until=transaction_timestamp()+interval '3 minutes',revision=revision+1 where singleton;
  update ntc_private.echo_state s set lease_id=lease where s.profile_id in(select c.profile_id from ntc_private.echo_configs c where c.active);
  select jsonb_build_object(
    'progressionEnabled',true,'leaseId',lease,'revision',world.revision+1,'activationAt',world.activation_at,'simulatorVersion',world.simulator_version,
    'catalogVersion',world.catalog_version,'catalogExpectedCount',version_meta.title_count,'zeroStateValidated',true,
    'catalog',(select jsonb_agg(jsonb_build_object('id',title_id,'name',title_name,'description',description,'tier',tier,'tier_rank',tier_rank,'base_weight',base_weight::text,'base_denominator',coalesce(base_denominator::text,''),'acquisition',acquisition,'active',active,'collection_eligible',collection_eligible,'event_id',event_id,'asset_id',asset_id,'presentation_id',presentation_id) order by tier_rank,title_id) from ntc_private.echo_title_catalog where catalog_version=world.catalog_version),
    'zeroStateValidation',(select jsonb_agg(jsonb_build_object('display_name',p.display_name,'total_rolls',p.total_rolls::text,'discovered_titles',p.discovered_titles,'collection_percentage',p.collection_percentage,'best_title_id',p.best_title_id,'equipped_title_id',p.equipped_title_id,'playtime_seconds',p.playtime_seconds::text,'active_seconds',p.active_seconds::text,'history_count',(select count(*) from ntc_private.echo_discoveries d where d.profile_id=p.id)+(select count(*) from ntc_private.echo_events e where e.profile_id=p.id)+(select count(*) from public.profile_discoveries d where d.profile_id=p.id)) order by p.display_name) from ntc_private.echo_configs c join public.profiles p on p.id=c.profile_id),
    'echoes',coalesce((select jsonb_agg(jsonb_build_object(
      'config',jsonb_build_object('id',c.username,'seed',c.seed,'timezone',c.timezone,'activity_profile',c.activity_profile,'weekdays',c.weekdays,'session_chance',c.session_chance,'start_minute',c.start_minute,'end_minute',c.end_minute,'min_session_minutes',c.min_session_minutes,'max_session_minutes',c.max_session_minutes,'min_active_minutes_per_day',c.min_active_minutes_per_day,'max_active_minutes_per_day',c.max_active_minutes_per_day,'min_sessions_per_day',c.min_sessions_per_day,'max_sessions_per_day',c.max_sessions_per_day,'min_break_minutes',c.min_break_minutes,'max_break_minutes',c.max_break_minutes,'min_actions_per_second',c.min_actions_per_second,'max_actions_per_second',c.max_actions_per_second,'show_bot_badge',c.show_bot_badge,'equip_policy',c.equip_policy,'active',c.active,'visible',c.visible,'profile_id',c.profile_id,'config_version',c.config_version),
      'state',jsonb_build_object('profile_id',s.profile_id,'activation_at',s.activation_at,'cursor_at',s.cursor_at,'total_rolls',s.total_rolls::text,'active_seconds',s.active_seconds::text,'fractional_rolls',s.fractional_rolls,'collected_ids',s.collected_ids,'equipped_title_id',s.equipped_title_id,'best_title_id',s.best_title_id,'random_counter',s.random_counter,'revision',s.revision,'simulator_version',s.simulator_version,'activity_status',s.activity_status,'discoveries',coalesce((select jsonb_agg(jsonb_build_object('titleId',d.title_id,'name',d.title_name_snapshot,'tier',d.tier_snapshot,'tierRank',d.tier_rank_snapshot,'catalogVersion',d.catalog_version,'roll',d.discovered_roll::text,'odds',d.effective_odds_denominator::text,'oddsLabel',d.effective_odds_label,'discoveredAt',d.discovered_at) order by d.discovered_roll) from ntc_private.echo_discoveries d where d.profile_id=s.profile_id),'[]'::jsonb)))
      order by c.username) from ntc_private.echo_configs c join ntc_private.echo_state s on s.profile_id=c.profile_id where c.active),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.ntc_echo_claim_batch(text) from public,anon,authenticated;
grant execute on function public.ntc_echo_claim_batch(text) to service_role;

commit;
