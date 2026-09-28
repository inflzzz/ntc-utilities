-- Versioned, append-only title catalog. Existing Echo profiles and local saves are untouched.
begin;

alter table public.profiles
  add column if not exists catalog_version integer not null default 1 check (catalog_version > 0);

alter table public.profile_discoveries
  add column if not exists catalog_version integer not null default 1 check (catalog_version > 0);

do $$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid='public.profile_discoveries'::regclass and contype='c'
      and (pg_get_constraintdef(oid) ilike '%title_id%' or pg_get_constraintdef(oid) ilike '%tier_rank%')
  loop
    execute format('alter table public.profile_discoveries drop constraint %I', item.conname);
  end loop;
end;
$$;
alter table public.profile_discoveries
  add constraint profile_discoveries_title_id_format_check check (title_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$'),
  add constraint profile_discoveries_tier_rank_check check (tier_rank between 0 and 32767);

alter table ntc_private.echo_title_catalog
  add column if not exists description text not null default '',
  add column if not exists acquisition text not null default 'normal',
  add column if not exists active boolean not null default true,
  add column if not exists collection_eligible boolean not null default true,
  add column if not exists event_id text,
  add column if not exists asset_id text,
  add column if not exists presentation_id text;
do $$
declare item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid='ntc_private.echo_title_catalog'::regclass and contype='c'
      and (pg_get_constraintdef(oid) ilike '%title_id%' or pg_get_constraintdef(oid) ilike '%tier_rank%')
  loop
    execute format('alter table ntc_private.echo_title_catalog drop constraint %I', item.conname);
  end loop;
end;
$$;
alter table ntc_private.echo_title_catalog
  add constraint echo_title_catalog_title_id_format_check check (title_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$'),
  add constraint echo_title_catalog_tier_rank_check check (tier_rank between 0 and 32767),
  add constraint echo_title_catalog_acquisition_check check (acquisition in ('normal','event','limited','exclusive','unobtainable')),
  add constraint echo_title_catalog_metadata_check check (
    (acquisition <> 'event' or nullif(btrim(event_id),'') is not null)
    and (acquisition <> 'unobtainable' or event_id is null)
    and char_length(title_name) between 1 and 120
    and char_length(description) <= 2000
  );

alter table ntc_private.echo_discoveries
  add column if not exists title_name_snapshot text,
  add column if not exists tier_snapshot text,
  add column if not exists tier_rank_snapshot smallint,
  add column if not exists catalog_version integer not null default 1;

create table if not exists ntc_private.echo_catalog_versions (
  catalog_version integer primary key check (catalog_version > 0),
  bootstrap_expected_count integer not null check (bootstrap_expected_count > 0),
  title_count integer not null check (title_count > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{32}$'),
  published_at timestamptz not null default transaction_timestamp()
);
revoke all on ntc_private.echo_catalog_versions from public, anon, authenticated;

create or replace function public.ntc_echo_sync_catalog(
  p_job_token text,
  p_catalog_version integer,
  p_bootstrap_expected_count integer,
  p_rows jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  expected_token text;
  world ntc_private.echo_world%rowtype;
  actual_count integer;
  content_hash text;
  previous_count integer;
begin
  select decrypted_secret into expected_token from vault.decrypted_secrets where name='ntc_echo_job_token' limit 1;
  if expected_token is null or p_job_token is distinct from expected_token then raise exception 'Unauthorized'; end if;
  if p_catalog_version is null or p_catalog_version < 1 or p_bootstrap_expected_count is null or p_bootstrap_expected_count < 1
    or p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) < 1 then raise exception 'Invalid catalog envelope'; end if;
  actual_count := jsonb_array_length(p_rows);
  if p_catalog_version=1 and actual_count <> p_bootstrap_expected_count then raise exception 'Bootstrap catalog size mismatch'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(id text, name text, tier text, tier_rank integer, base_weight text, base_denominator text, acquisition text, active boolean, collection_eligible boolean, event_id text, asset_id text, presentation_id text, description text)
    where nullif(btrim(id),'') is null or id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$'
      or nullif(btrim(name),'') is null or char_length(name)>120
      or nullif(btrim(tier),'') is null or tier_rank is null or tier_rank<0 or tier_rank>32767
      or base_weight is null or base_weight !~ '^[0-9]+$' or base_weight::numeric<=0
      or (coalesce(base_denominator,'')<>'' and (base_denominator !~ '^[0-9]+$' or base_denominator::numeric<=0))
      or acquisition is null or acquisition not in ('normal','event','limited','exclusive','unobtainable')
      or active is null or collection_eligible is null
      or (acquisition='normal' and not active)
      or (acquisition='event' and nullif(btrim(event_id),'') is null)
      or (acquisition='unobtainable' and event_id is not null and btrim(event_id)<>'')
      or char_length(coalesce(description,''))>2000
      or char_length(coalesce(asset_id,''))>128 or char_length(coalesce(presentation_id,''))>128
  ) then raise exception 'Catalog contains invalid title metadata'; end if;
  if (select count(distinct r.id) from jsonb_to_recordset(p_rows) as r(id text)) <> actual_count then raise exception 'Catalog contains duplicate title IDs'; end if;

  select * into world from ntc_private.echo_world where singleton for update;
  if not found then raise exception 'Echo world is missing'; end if;
  if world.lease_until is not null and world.lease_until > transaction_timestamp() then raise exception 'Echo batch is in progress'; end if;
  if p_catalog_version < world.catalog_version then raise exception 'Catalog version cannot move backwards'; end if;

  -- Historical IDs are append-only. Retire a title by changing its lifecycle fields, never by deleting its row.
  select count(*) into previous_count from ntc_private.echo_title_catalog old
    where old.catalog_version=world.catalog_version;
  if previous_count>0 and exists (
    select 1 from ntc_private.echo_title_catalog old
    where old.catalog_version=world.catalog_version
      and not exists (select 1 from jsonb_to_recordset(p_rows) as incoming(id text) where incoming.id=old.title_id)
  ) then raise exception 'A published title ID is missing from the next catalog version'; end if;

  content_hash := md5(p_rows::text);
  if exists (select 1 from ntc_private.echo_catalog_versions v where v.catalog_version=p_catalog_version and v.content_hash<>content_hash) then
    raise exception 'Catalog version is immutable; increment catalog version for content changes';
  end if;
  insert into ntc_private.echo_catalog_versions(catalog_version,bootstrap_expected_count,title_count,content_hash)
  values (p_catalog_version,p_bootstrap_expected_count,actual_count,content_hash)
  on conflict (catalog_version) do nothing;
  insert into ntc_private.echo_title_catalog(catalog_version,title_id,title_name,tier,tier_rank,base_weight,base_denominator,description,acquisition,active,collection_eligible,event_id,asset_id,presentation_id)
  select p_catalog_version,r.id,r.name,r.tier,r.tier_rank,r.base_weight::numeric,nullif(r.base_denominator,'')::numeric,
    coalesce(r.description,''),r.acquisition,r.active,r.collection_eligible,nullif(r.event_id,''),nullif(r.asset_id,''),nullif(r.presentation_id,'')
  from jsonb_to_recordset(p_rows) as r(id text,name text,tier text,tier_rank smallint,base_weight text,base_denominator text,description text,acquisition text,active boolean,collection_eligible boolean,event_id text,asset_id text,presentation_id text)
  on conflict (catalog_version,title_id) do nothing;
  if (select count(*) from ntc_private.echo_title_catalog where catalog_version=p_catalog_version)<>actual_count then raise exception 'Catalog row count mismatch'; end if;
  update ntc_private.echo_world set catalog_version=p_catalog_version where singleton;
  return actual_count;
end;
$$;

revoke all on function public.ntc_echo_sync_catalog(text,jsonb) from public,anon,authenticated,service_role;
drop function public.ntc_echo_sync_catalog(text,jsonb);
revoke all on function public.ntc_echo_sync_catalog(text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.ntc_echo_sync_catalog(text,integer,integer,jsonb) to service_role;

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
      'config',jsonb_build_object('id',c.username,'seed',c.seed,'timezone',c.timezone,'weekdays',c.weekdays,'session_chance',c.session_chance,'start_minute',c.start_minute,'end_minute',c.end_minute,'min_session_minutes',c.min_session_minutes,'max_session_minutes',c.max_session_minutes,'min_actions_per_second',c.min_actions_per_second,'max_actions_per_second',c.max_actions_per_second,'show_bot_badge',c.show_bot_badge,'equip_policy',c.equip_policy,'active',c.active,'visible',c.visible,'profile_id',c.profile_id,'config_version',c.config_version),
      'state',jsonb_build_object('profile_id',s.profile_id,'activation_at',s.activation_at,'cursor_at',s.cursor_at,'total_rolls',s.total_rolls::text,'active_seconds',s.active_seconds::text,'fractional_rolls',s.fractional_rolls,'collected_ids',s.collected_ids,'equipped_title_id',s.equipped_title_id,'best_title_id',s.best_title_id,'random_counter',s.random_counter,'revision',s.revision,'simulator_version',s.simulator_version,'activity_status',s.activity_status,'discoveries',coalesce((select jsonb_agg(jsonb_build_object('titleId',d.title_id,'name',d.title_name_snapshot,'tier',d.tier_snapshot,'tierRank',d.tier_rank_snapshot,'catalogVersion',d.catalog_version,'roll',d.discovered_roll::text,'odds',d.effective_odds_denominator::text,'oddsLabel',d.effective_odds_label,'discoveredAt',d.discovered_at) order by d.discovered_roll) from ntc_private.echo_discoveries d where d.profile_id=s.profile_id),'[]'::jsonb)))
      order by c.username) from ntc_private.echo_configs c join ntc_private.echo_state s on s.profile_id=c.profile_id where c.active),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.ntc_echo_claim_batch(text) from public,anon,authenticated;
grant execute on function public.ntc_echo_claim_batch(text) to service_role;

create or replace function public.ntc_echo_commit_batch(p_job_token text,p_lease_id uuid,p_revision bigint,p_results jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare expected_token text; item jsonb; old_state ntc_private.echo_state%rowtype; new_state jsonb; d jsonb; event jsonb; v_profile_id uuid; world ntc_private.echo_world%rowtype; catalog_total integer; target_total integer; owned_count integer;
begin
  select decrypted_secret into expected_token from vault.decrypted_secrets where name='ntc_echo_job_token' limit 1;
  if expected_token is null or p_job_token is distinct from expected_token then raise exception 'Unauthorized'; end if;
  select * into world from ntc_private.echo_world where singleton and lease_id=p_lease_id and revision=p_revision and lease_until>transaction_timestamp() for update;
  if not found then raise exception 'Echo lease expired or revision changed'; end if;
  select count(*) into catalog_total from ntc_private.echo_title_catalog where catalog_version=world.catalog_version;
  if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)>4 then raise exception 'Invalid result batch'; end if;
  for item in select value from jsonb_array_elements(p_results) loop
    v_profile_id:=(item->>'profile_id')::uuid;
    select * into old_state from ntc_private.echo_state s where s.profile_id=v_profile_id for update;
    if not found or old_state.lease_id is distinct from p_lease_id then raise exception 'Echo state is not claimed'; end if;
    new_state:=item->'state';
    if (new_state->>'total_rolls')::numeric<old_state.total_rolls or (new_state->>'active_seconds')::numeric<old_state.active_seconds or (new_state->>'cursor_at')::timestamptz<old_state.cursor_at or not(new_state->'collected_ids' @> to_jsonb(old_state.collected_ids)) then raise exception 'Echo state cannot move backwards'; end if;
    if jsonb_array_length(coalesce(new_state->'collected_ids','[]'::jsonb))>catalog_total or jsonb_array_length(coalesce(item->'new_discoveries','[]'::jsonb))>catalog_total then raise exception 'Invalid discovery list'; end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(new_state->'collected_ids','[]'::jsonb)) id where not exists(select 1 from ntc_private.echo_title_catalog t where t.catalog_version=world.catalog_version and t.title_id=id.value)) then raise exception 'Unknown title ID in Echo ownership'; end if;
    update ntc_private.echo_state set cursor_at=(new_state->>'cursor_at')::timestamptz,total_rolls=(new_state->>'total_rolls')::numeric,active_seconds=(new_state->>'active_seconds')::numeric,fractional_rolls=coalesce((new_state->>'fractional_rolls')::numeric,0),collected_ids=array(select jsonb_array_elements_text(new_state->'collected_ids')),equipped_title_id=nullif(new_state->>'equipped_title_id',''),best_title_id=nullif(new_state->>'best_title_id',''),random_counter=(new_state->>'random_counter')::bigint,revision=revision+1,activity_status=case when new_state->>'status'='online' then 'online' else 'offline' end,lease_id=null where profile_id=v_profile_id;
    for d in select value from jsonb_array_elements(coalesce(item->'new_discoveries','[]'::jsonb)) loop
      if not exists(select 1 from ntc_private.echo_title_catalog t where t.catalog_version=world.catalog_version and t.title_id=d->>'titleId') then raise exception 'Discovery references an unknown title ID'; end if;
      insert into ntc_private.echo_discoveries(profile_id,title_id,discovered_roll,effective_odds_denominator,effective_odds_label,discovered_at,title_name_snapshot,tier_snapshot,tier_rank_snapshot,catalog_version)
      select v_profile_id,d->>'titleId',(d->>'roll')::numeric,(d->>'odds')::numeric,coalesce(d->>'oddsLabel',''),(d->>'discoveredAt')::timestamptz,t.title_name,t.tier,t.tier_rank,world.catalog_version
      from ntc_private.echo_title_catalog t where t.catalog_version=world.catalog_version and t.title_id=d->>'titleId'
      on conflict(profile_id,title_id) do nothing;
      insert into public.profile_discoveries(profile_id,title_id,title_name,tier,tier_rank,discovered_roll,effective_odds_denominator,effective_odds_label,discovered_at,catalog_version)
      select v_profile_id,d->>'titleId',t.title_name,t.tier,t.tier_rank,(d->>'roll')::numeric,(d->>'odds')::numeric,coalesce(d->>'oddsLabel',''),(d->>'discoveredAt')::timestamptz,world.catalog_version
      from ntc_private.echo_title_catalog t where t.catalog_version=world.catalog_version and t.title_id=d->>'titleId'
      on conflict(profile_id,title_id) do nothing;
    end loop;
    for event in select value from jsonb_array_elements(coalesce(item->'events','[]'::jsonb)) loop
      insert into ntc_private.echo_events(event_id,profile_id,event_type,payload,created_at) values(event->>'id',v_profile_id,event->>'type',event->'payload',(event->>'createdAt')::timestamptz) on conflict(event_id) do nothing;
    end loop;
    select count(*) into target_total from ntc_private.echo_title_catalog t where t.catalog_version=world.catalog_version and t.collection_eligible and ((t.active and t.acquisition<>'unobtainable') or t.title_id=any(array(select jsonb_array_elements_text(new_state->'collected_ids'))));
    select count(*) into owned_count from ntc_private.echo_title_catalog t where t.catalog_version=world.catalog_version and t.collection_eligible and t.title_id=any(array(select jsonb_array_elements_text(new_state->'collected_ids')));
    update public.profiles p set catalog_version=world.catalog_version,total_rolls=(new_state->>'total_rolls')::numeric,discovered_titles=jsonb_array_length(new_state->'collected_ids'),collection_percentage=case when target_total=0 then 0 else round(owned_count::numeric*100/target_total,2) end,
      equipped_title_id=nullif(new_state->>'equipped_title_id',''),equipped_title_name=nullif(item->'projection'->'equipped'->>'name',''),equipped_tier=nullif(item->'projection'->'equipped'->>'tier',''),best_title_id=nullif(new_state->>'best_title_id',''),best_title_name=nullif(item->'projection'->'best'->>'name',''),best_tier=nullif(item->'projection'->'best'->>'tier',''),best_odds=coalesce(item->'projection'->'best'->>'odds',''),active_seconds=(new_state->>'active_seconds')::numeric,playtime_seconds=(new_state->>'active_seconds')::numeric,collection_by_tier=coalesce(item->'projection'->'collection_by_tier','{}'::jsonb),milestones=coalesce(item->'projection'->'milestones','[]'::jsonb),show_bot_badge=(item->'projection'->>'show_bot_badge')::boolean,activity_status=case when new_state->>'status'='online' then 'online' else 'offline' end,visible=(item->'projection'->>'visible')::boolean
      where p.id=v_profile_id and p.profile_kind='echo';
  end loop;
  update ntc_private.echo_world set lease_id=null,lease_until=null where singleton and lease_id=p_lease_id;
  return true;
end;
$$;
revoke all on function public.ntc_echo_commit_batch(text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.ntc_echo_commit_batch(text,uuid,bigint,jsonb) to service_role;

create or replace function ntc_private.enable_echo_progression_after_validation()
returns boolean language plpgsql security definer set search_path = '' as $$
declare world ntc_private.echo_world%rowtype; catalog_count integer; expected_count integer;
begin
  select * into world from ntc_private.echo_world where singleton for update;
  if not found then raise exception 'Echo world is missing'; end if;
  if world.progression_enabled then return true; end if;
  if not exists(select 1 from ntc_private.echo_activation_audit a where a.activation_at=world.activation_at and a.initial_zero_state_validated and a.validated_usernames @> array['nyancat99','lulu','testandoinfinito','AstraUltraMegaLow']::text[]) then raise exception 'Echo zero-state audit is missing or incomplete'; end if;
  select count(*) into catalog_count from ntc_private.echo_title_catalog where catalog_version=world.catalog_version;
  select title_count into expected_count from ntc_private.echo_catalog_versions where catalog_version=world.catalog_version;
  if expected_count is null or catalog_count<>expected_count or catalog_count<1 then raise exception 'Current versioned Echo catalog is incomplete'; end if;
  if exists(select 1 from ntc_private.echo_configs c join public.profiles p on p.id=c.profile_id join ntc_private.echo_state s on s.profile_id=p.id where p.total_rolls<>0 or p.discovered_titles<>0 or p.collection_percentage<>0 or p.best_title_id is not null or p.equipped_title_id is not null or p.playtime_seconds<>0 or p.active_seconds<>0 or s.total_rolls<>0 or s.active_seconds<>0 or cardinality(s.collected_ids)<>0 or s.cursor_at<>world.activation_at or s.activation_at<>world.activation_at or exists(select 1 from ntc_private.echo_discoveries d where d.profile_id=p.id) or exists(select 1 from ntc_private.echo_events e where e.profile_id=p.id) or exists(select 1 from public.profile_discoveries d where d.profile_id=p.id)) then raise exception 'Echoes are no longer at the audited zero state'; end if;
  update ntc_private.echo_world set progression_enabled=true where singleton;
  return true;
end;
$$;
revoke all on function ntc_private.enable_echo_progression_after_validation() from public,anon,authenticated,service_role;

commit;
