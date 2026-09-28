-- Foundation for the public NTC RNG leaderboard.
-- Client writes are limited by RLS to the authenticated owner and profile_kind=real.

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  profile_kind text not null default 'real' check (profile_kind in ('real', 'echo')),
  owner_user_id uuid unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 32),
  total_rolls numeric(39, 0) not null default 0 check (total_rolls >= 0),
  total_rolls_text text generated always as (total_rolls::text) stored,
  discovered_titles integer not null default 0 check (discovered_titles >= 0),
  collection_percentage numeric(5, 2) not null default 0 check (collection_percentage between 0 and 100),
  equipped_title_id text,
  equipped_title_name text,
  equipped_tier text,
  best_title_id text,
  best_title_name text,
  best_tier text,
  best_odds text not null default '' check (char_length(best_odds) <= 160),
  achievements jsonb not null default '[]'::jsonb check (jsonb_typeof(achievements) = 'array'),
  playtime_seconds numeric(39, 0) not null default 0 check (playtime_seconds >= 0),
  playtime_seconds_text text generated always as (playtime_seconds::text) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint profiles_identity_kind_owner_check check (
    (profile_kind = 'real' and owner_user_id is not null)
    or (profile_kind = 'echo' and owner_user_id is null)
  )
);

create index if not exists profiles_leaderboard_total_rolls_idx
  on public.profiles (total_rolls desc, display_name asc);

create or replace function public.ntc_profiles_touch_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
    -- Keep published aggregates stable if an old local backup is restored.
    new.total_rolls := greatest(old.total_rolls, new.total_rolls);
    new.discovered_titles := greatest(old.discovered_titles, new.discovered_titles);
    new.collection_percentage := greatest(old.collection_percentage, new.collection_percentage);
    new.playtime_seconds := greatest(old.playtime_seconds, new.playtime_seconds);
    select coalesce(pg_catalog.jsonb_agg(achievement order by achievement), '[]'::jsonb)
      into new.achievements
      from (
        select distinct achievement
        from pg_catalog.jsonb_array_elements(old.achievements || new.achievements) as items(achievement)
      ) as unique_achievements;
  end if;
  new.updated_at := now();
  new.last_seen := now();
  return new;
end;
$$;

drop trigger if exists ntc_profiles_touch_timestamps on public.profiles;
create trigger ntc_profiles_touch_timestamps
before insert or update on public.profiles
for each row execute function public.ntc_profiles_touch_timestamps();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists profiles_authenticated_read on public.profiles;
create policy profiles_authenticated_read
  on public.profiles for select to authenticated
  using (true);

drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert
  on public.profiles for insert to authenticated
  with check (profile_kind = 'real' and owner_user_id = (select auth.uid()));

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update
  on public.profiles for update to authenticated
  using (profile_kind = 'real' and owner_user_id = (select auth.uid()))
  with check (profile_kind = 'real' and owner_user_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;
