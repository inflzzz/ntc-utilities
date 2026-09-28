-- Keep the four Echoes at their audited zero state until an operator explicitly enables progression.
begin;

alter table ntc_private.echo_world
  add column if not exists progression_enabled boolean not null default false;

create or replace function public.ntc_echo_claim_batch(p_job_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  expected_token text;
  lease uuid := gen_random_uuid();
  world ntc_private.echo_world%rowtype;
  result jsonb;
  catalog_rows integer;
begin
  select decrypted_secret into expected_token from vault.decrypted_secrets where name = 'ntc_echo_job_token' limit 1;
  if expected_token is null or p_job_token is distinct from expected_token then raise exception 'Unauthorized'; end if;
  select * into world from ntc_private.echo_world where singleton for update;
  if not found or not exists (select 1 from ntc_private.echo_activation_audit a where a.activation_at=world.activation_at and a.initial_zero_state_validated) then
    raise exception 'Echo zero-state activation audit missing';
  end if;

  select count(*) into catalog_rows
  from ntc_private.echo_title_catalog
  where catalog_version=world.catalog_version;

  if not world.progression_enabled then
    select jsonb_agg(entry order by entry->>'display_name')
    into result
    from (
      select jsonb_build_object(
        'display_name', p.display_name,
        'total_rolls', p.total_rolls::text,
        'discovered_titles', p.discovered_titles,
        'collection_percentage', p.collection_percentage,
        'best_title_id', p.best_title_id,
        'equipped_title_id', p.equipped_title_id,
        'playtime_seconds', p.playtime_seconds::text,
        'active_seconds', p.active_seconds::text,
        'history_count',
          (select count(*) from ntc_private.echo_discoveries d where d.profile_id=p.id)
          +(select count(*) from ntc_private.echo_events e where e.profile_id=p.id)
          +(select count(*) from public.profile_discoveries d where d.profile_id=p.id)
      ) as entry
      from ntc_private.echo_configs c
      join public.profiles p on p.id=c.profile_id
    ) validated;

    return jsonb_build_object(
      'progressionEnabled', false,
      'activationAt', world.activation_at,
      'simulatorVersion', world.simulator_version,
      'zeroStateValidated', exists (
        select 1 from ntc_private.echo_activation_audit a
        where a.activation_at=world.activation_at and a.initial_zero_state_validated
      ),
      'zeroStateValidation', coalesce(result, '[]'::jsonb),
      'catalogReady', catalog_rows=200,
      'catalogCount', catalog_rows
    );
  end if;

  if catalog_rows <> 200 then raise exception 'Echo title catalog missing'; end if;
  if world.lease_until is not null and world.lease_until > transaction_timestamp() then return jsonb_build_object('busy', true); end if;
  update ntc_private.echo_world set lease_id=lease, lease_until=transaction_timestamp()+interval '3 minutes', revision=revision+1 where singleton;
  update ntc_private.echo_state s set lease_id=lease
    where s.profile_id in (select c.profile_id from ntc_private.echo_configs c where c.active);
  select jsonb_build_object(
    'progressionEnabled', true,
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

revoke all on function public.ntc_echo_claim_batch(text) from public, anon, authenticated;
grant execute on function public.ntc_echo_claim_batch(text) to service_role;

create or replace function ntc_private.enable_echo_progression_after_validation()
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare world ntc_private.echo_world%rowtype;
begin
  select * into world from ntc_private.echo_world where singleton for update;
  if not found then raise exception 'Echo world is missing'; end if;
  if world.progression_enabled then return true; end if;
  if not exists (
    select 1 from ntc_private.echo_activation_audit a
    where a.activation_at=world.activation_at and a.initial_zero_state_validated
      and a.validated_usernames @> array['nyancat99','lulu','testandoinfinito','AstraUltraMegaLow']::text[]
  ) then raise exception 'Echo zero-state audit is missing or incomplete'; end if;
  if (select count(*) from ntc_private.echo_title_catalog where catalog_version=world.catalog_version) <> 200 then
    raise exception 'Echo title catalog must contain exactly 200 titles';
  end if;
  if (select count(*) from ntc_private.echo_configs) <> 4 then raise exception 'Expected exactly four initial Echoes'; end if;
  if (select count(*) from ntc_private.echo_state s join ntc_private.echo_configs c on c.profile_id=s.profile_id) <> 4 then
    raise exception 'Expected four initialized Echo states';
  end if;
  if exists (
    select 1
    from ntc_private.echo_configs c
    join public.profiles p on p.id=c.profile_id
    join ntc_private.echo_state s on s.profile_id=p.id
    where p.total_rolls<>0 or p.discovered_titles<>0 or p.collection_percentage<>0
      or p.best_title_id is not null or p.equipped_title_id is not null
      or p.playtime_seconds<>0 or p.active_seconds<>0
      or s.total_rolls<>0 or s.active_seconds<>0 or cardinality(s.collected_ids)<>0
      or s.cursor_at<>world.activation_at or s.activation_at<>world.activation_at
      or exists (select 1 from ntc_private.echo_discoveries d where d.profile_id=p.id)
      or exists (select 1 from ntc_private.echo_events e where e.profile_id=p.id)
      or exists (select 1 from public.profile_discoveries d where d.profile_id=p.id)
  ) then raise exception 'Echoes are no longer at the audited zero state'; end if;
  update ntc_private.echo_world set progression_enabled=true where singleton;
  return true;
end;
$$;

revoke all on function ntc_private.enable_echo_progression_after_validation() from public, anon, authenticated, service_role;

commit;
