-- Development reset: remove only the authenticated user's real public profile
-- and its discovery rows. The auth.users identity and all other profiles remain.
create or replace function public.ntc_reset_my_rng_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_profile_id uuid;
  v_deleted_discoveries integer := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'An authenticated session is required.';
  end if;

  select p.id into v_profile_id
  from public.profiles as p
  where p.owner_user_id = v_user_id and p.profile_kind = 'real'
  for update;

  if v_profile_id is null then
    return pg_catalog.jsonb_build_object('profile_found', false, 'deleted_discoveries', 0);
  end if;

  delete from public.profile_discoveries as d where d.profile_id = v_profile_id;
  get diagnostics v_deleted_discoveries = row_count;

  delete from public.profiles as p
  where p.id = v_profile_id and p.owner_user_id = v_user_id and p.profile_kind = 'real';
  if not found then
    raise exception using errcode = '40001', message = 'The authenticated profile changed during reset.';
  end if;

  return pg_catalog.jsonb_build_object(
    'profile_found', true,
    'deleted_discoveries', v_deleted_discoveries
  );
end;
$$;

revoke all on function public.ntc_reset_my_rng_profile() from public, anon, authenticated;
grant execute on function public.ntc_reset_my_rng_profile() to authenticated;
