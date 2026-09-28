-- Resolve a PL/pgSQL variable/column ambiguity in the v1 catalog sync RPC.
begin;

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
  v_content_hash text;
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

  select count(*) into previous_count from ntc_private.echo_title_catalog old
    where old.catalog_version=world.catalog_version;
  if previous_count>0 and exists (
    select 1 from ntc_private.echo_title_catalog old
    where old.catalog_version=world.catalog_version
      and not exists (select 1 from jsonb_to_recordset(p_rows) as incoming(id text) where incoming.id=old.title_id)
  ) then raise exception 'A published title ID is missing from the next catalog version'; end if;

  v_content_hash := md5(p_rows::text);
  if exists (select 1 from ntc_private.echo_catalog_versions v where v.catalog_version=p_catalog_version and v.content_hash<>v_content_hash) then
    raise exception 'Catalog version is immutable; increment catalog version for content changes';
  end if;
  insert into ntc_private.echo_catalog_versions(catalog_version,bootstrap_expected_count,title_count,content_hash)
  values (p_catalog_version,p_bootstrap_expected_count,actual_count,v_content_hash)
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

revoke all on function public.ntc_echo_sync_catalog(text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.ntc_echo_sync_catalog(text,integer,integer,jsonb) to service_role;

commit;
