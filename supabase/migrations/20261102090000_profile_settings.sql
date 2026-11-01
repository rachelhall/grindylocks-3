-- Your profile, Edit profile and Settings (first version). Additive only:
-- nothing existing is dropped or replaced.
--
-- - profiles.bio (up to 150 characters) and profiles.username_changed_at.
-- - Username changes: once every 30 days, and the old name stays reserved
--   for its owner for 14 days (they can take it back; nobody else can).
--   Enforced in the database, so the rule holds whatever the app sends.
-- - username_available(): the live "free / taken" check for onboarding and
--   Edit profile. It also counts names held by people you've blocked (or who
--   blocked you), which the profiles read rule hides, and reserved names.
-- - A private `avatars` bucket: any signed-in member can read a photo unless
--   either of you has blocked the other; you can only write in your own folder.
--
-- Tags (slide_people_tags.user_id), filmer credits (post_slides.filmer_id),
-- comment replies (comments.reply_to_user_id), notifications and follows all
-- point at user IDs, so a username change needs nothing else rewritten.

-- 1. Profile columns ---------------------------------------------------------------

alter table public.profiles
  add column bio text constraint profiles_bio_length check (char_length(bio) <= 150),
  add column username_changed_at timestamptz;

comment on column public.profiles.bio is 'Short bio shown on the profile, up to 150 characters. Null when empty.';
comment on column public.profiles.username_changed_at is
  'When the member last changed their username after onboarding. Null until the first change. Set by the database.';

-- The photo always lives in the member's own folder of the avatars bucket.
alter table public.profiles
  add constraint profiles_avatar_path_own_folder
  check (avatar_path is null or avatar_path like id::text || '/%');

-- Members can read and edit their bio; username_changed_at is read-only.
grant select (bio, username_changed_at) on public.profiles to authenticated;
grant insert (bio), update (bio) on public.profiles to authenticated;

-- 2. Reserved usernames --------------------------------------------------------------

create table public.reserved_usernames (
  username extensions.citext primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reserved_until timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.reserved_usernames is
  'A username someone changed away from, held for them until reserved_until. Expired rows are ignored.';

create index reserved_usernames_user_idx on public.reserved_usernames (user_id);

alter table public.reserved_usernames enable row level security;

-- Members only see their own reserved names (to offer "take it back").
-- Everyone else learns only free/taken, through username_available().
revoke all on public.reserved_usernames from anon, authenticated;
grant select on public.reserved_usernames to authenticated;

create policy "see your own reserved names" on public.reserved_usernames
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 3. Free / taken check ---------------------------------------------------------------

create or replace function public.username_available(name text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(trim(name), '') ~ '^[a-zA-Z0-9_.]{2,30}$'
    and not exists (
      select 1 from public.profiles p
      where p.username = trim(name)::extensions.citext
        and p.id is distinct from (select auth.uid())
    )
    and not exists (
      select 1 from public.reserved_usernames r
      where r.username = trim(name)::extensions.citext
        and r.reserved_until > now()
        and r.user_id is distinct from (select auth.uid())
    );
$$;

comment on function public.username_available(text) is
  'True when the name fits the username rules and nobody else has or holds it (case-insensitive).';

revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- 4. Username change rules --------------------------------------------------------------

-- Security definer so it can write reserved_usernames, which members can't.
-- auth.uid() is the member making the change; it's null for the service
-- role and the dashboard, which skip the 30-day limit (support can fix a
-- name) but still respect other people's reservations.
create or replace function private.guard_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  taking_back boolean;
begin
  if new.username is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.username::text is not distinct from old.username::text then
      return new;
    end if;
    -- Same name, different capitals: not a change of name.
    if old.username is not null and lower(new.username::text) = lower(old.username::text) then
      return new;
    end if;
  end if;

  -- Held for someone else after they changed away from it.
  if exists (
    select 1 from public.reserved_usernames r
    where r.username = new.username and r.reserved_until > now() and r.user_id <> new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'username_reserved',
      detail = 'That username was changed recently and is held for its owner for 14 days.';
  end if;

  -- Picking a first name, or changing it during onboarding: no limits.
  if tg_op = 'INSERT' or old.username is null or old.onboarded_at is null then
    return new;
  end if;

  taking_back := exists (
    select 1 from public.reserved_usernames r
    where r.username = new.username and r.user_id = new.id and r.reserved_until > now()
  );

  if taking_back then
    -- Undoing a change: allowed any time within the 14 days. The name
    -- they're leaving was only theirs for a few days, so it isn't held,
    -- and the 30 days still count from the original change.
    delete from public.reserved_usernames where username = new.username;
    return new;
  end if;

  if (select auth.uid()) = new.id and old.username_changed_at > now() - interval '30 days' then
    raise exception using
      errcode = 'P0001',
      message = 'username_cooldown',
      detail = 'You can change your username once every 30 days.',
      hint = to_char((old.username_changed_at + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  insert into public.reserved_usernames (username, user_id, reserved_until)
  values (old.username, new.id, now() + interval '14 days')
  on conflict (username) do update
    set user_id = excluded.user_id, reserved_until = excluded.reserved_until, created_at = now();

  new.username_changed_at := now();
  return new;
end $$;

create trigger profiles_guard_username
  before insert or update of username on public.profiles
  for each row execute function private.guard_username();

revoke all on function private.guard_username() from public, anon, authenticated;

-- 5. Profile photos -----------------------------------------------------------------------

-- Photos are cropped square and re-encoded on the phone to a 512 px JPEG,
-- which is well under 2 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- Paths are <user id>/<file>.jpg. The case keeps a malformed folder name
-- from ever reaching the uuid cast.
create policy "avatars: members read unless blocked" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and case
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then not private.blocked_between(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

create policy "avatars: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: owner replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
