-- Meetups (v2), part 3: cover photos and the Going privately default.
--
-- 1. A private `meetup-covers` bucket. Paths are <user id>/<file>.jpg; you
--    upload only to your own folder. A cover can be read by its uploader and
--    by anyone who can see a meetup or date using it (so a Followers only
--    meetup's cover stays with its followers).
-- 2. A meetup's or date's cover must sit in the folder of one of its hosts,
--    so nobody can point a meetup at someone else's photo.
-- 3. The account default for Going privately (profiles.going_privately_default,
--    added in `meetups`) isn't readable or writable column by column, like
--    the other private settings; it's read and set through two functions.
--    Null means "on for private accounts, off otherwise".
--
-- Additive: one bucket, four storage policies, one trigger function with two
-- triggers, two functions.

/* 1. Bucket and storage rules ---------------------------------------------------- */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meetup-covers', 'meetup-covers', false, 4194304, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "meetup covers: read if you can see the meetup" on storage.objects;
create policy "meetup covers: read if you can see the meetup" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meetup-covers'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.event_series s where s.cover_path = name and private.can_see_series(s.id))
      or exists (select 1 from public.events e where e.cover_path = name and private.can_see_event(e.id))
    )
  );

drop policy if exists "meetup covers: owner uploads" on storage.objects;
create policy "meetup covers: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'meetup-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "meetup covers: owner replaces" on storage.objects;
create policy "meetup covers: owner replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'meetup-covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'meetup-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "meetup covers: owner deletes" on storage.objects;
create policy "meetup covers: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'meetup-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

/* 2. Covers come from a host's folder -------------------------------------------- */

create or replace function private.guard_meetup_cover()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  series uuid;
  folder text := split_part(coalesce(new.cover_path, ''), '/', 1);
begin
  if new.cover_path is null or (tg_op = 'UPDATE' and new.cover_path is not distinct from old.cover_path) then
    return new;
  end if;
  if new.cover_path !~ '^[0-9a-f-]{36}/[^/]+\.jpg$' then
    raise exception 'Not a meetup cover' using errcode = '22023';
  end if;
  -- The two tables name the series differently. (A record's fields are only
  -- read in the branch for its own table.)
  if tg_table_name = 'event_series' then
    -- On a new series the host row isn't there yet; the host is host_id.
    if folder = new.host_id::text then
      return new;
    end if;
    series := new.id;
  else
    series := new.series_id;
  end if;
  if not exists (
    select 1 from event_hosts h
     where h.series_id = series and h.user_id::text = folder
       and (h.role = 'host' or h.accepted_at is not null)
  ) then
    raise exception 'A meetup''s cover has to be a host''s photo' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_meetup_cover on public.event_series;
create trigger guard_meetup_cover before insert or update of cover_path on public.event_series
  for each row execute function private.guard_meetup_cover();

drop trigger if exists guard_meetup_cover on public.events;
create trigger guard_meetup_cover before insert or update of cover_path on public.events
  for each row execute function private.guard_meetup_cover();

/* 3. Going privately default ----------------------------------------------------- */

-- Your Going privately default, with null resolved: on for private accounts.
create or replace function public.my_going_privately_default()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(going_privately_default, is_private) from profiles where id = auth.uid();
$$;

create or replace function public.set_going_privately_default(value boolean)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update profiles set going_privately_default = value where id = auth.uid();
$$;

revoke execute on function public.my_going_privately_default(), public.set_going_privately_default(boolean) from anon, public;
grant execute on function public.my_going_privately_default(), public.set_going_privately_default(boolean) to authenticated;
