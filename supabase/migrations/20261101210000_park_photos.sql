-- Park photos and the park page header (Nov 1). Additive only.
--
-- - park_photos: a few wide shots of the whole park, shown in the park page
--   header (the first one) and the park photo gallery. Riding shots go in
--   posts, not here.
-- - Up to 8 photos per park (the "0 / 8" on the contributor card).
-- - Every photo carries a credit: photographer (free text, defaults to the
--   uploader's username), source and license.
-- - Photos are archived for the whole gallery, never deleted, like obstacles.
-- - Members read. Contributors and admins for the park, city admins for its
--   metro and the owner (private.can_contribute_park) add and reorder.
--   Uploaders and admins (private.can_moderate_park) archive.
-- - Files live in the park-media bucket (JPEG only) at
--   <park id>/<photo id>.jpg. Every signed-in member can read them; only
--   people who can contribute to that park can write there. The app uploads
--   the file first, then inserts the row, and the row checks the file is
--   there.

-- 1. Table ---------------------------------------------------------------------

create table public.park_photos (
  id uuid primary key default gen_random_uuid(),
  park_id uuid not null references public.parks(id),
  uploaded_by uuid not null references public.profiles(id),
  storage_path text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  sort_order integer not null default 0,
  photographer text not null default '' check (length(photographer) <= 80),
  source text not null default 'own photo' check (length(source) between 1 and 120),
  license text not null default 'own' check (length(license) between 1 and 60),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id)
);

comment on table public.park_photos is
  'Wide shots of a whole park for the park page header and gallery. Archived, never deleted.';
comment on column public.park_photos.storage_path is 'Path in the park-media bucket: <park id>/<photo id>.jpg.';
comment on column public.park_photos.sort_order is 'Gallery order, lowest first. The first photo fills the park page header.';
comment on column public.park_photos.photographer is 'Who took it, as credited. Defaults to the uploader''s username.';
comment on column public.park_photos.source is 'Where it came from: "own photo", "permission from <park>", "Wikimedia Commons"…';
comment on column public.park_photos.license is 'Terms: "own", "permission", "CC BY-SA 4.0"…';
comment on column public.park_photos.archived_at is 'Set when archived; the photo leaves the gallery for everyone.';

create index park_photos_park_idx on public.park_photos (park_id, sort_order, created_at)
  where archived_at is null;

alter table public.park_photos enable row level security;

-- 2. Storage ---------------------------------------------------------------------

-- Re-encoded to JPEG on the phone (2048 px long edge, quality 0.82), like
-- post photos. 15 MB is far above that.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('park-media', 'park-media', false, 15728640, array['image/jpeg'])
on conflict (id) do nothing;

-- Is there an uploaded park photo at this path? Runs as the owner, like
-- private.media_object_exists does for post-media.
create or replace function private.park_media_object_exists(path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from storage.objects where bucket_id = 'park-media' and name = path);
$$;

-- The park a park-media path belongs to, if it's well formed and the park
-- exists. Never casts a malformed folder name, so a bad path is a plain "no".
create or replace function private.park_media_park(path text)
returns uuid
language sql stable
set search_path = ''
as $$
  select p.id from public.parks p
  where path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and p.id::text = split_part(path, '/', 1);
$$;

create policy "park media: members read" on storage.objects for select to authenticated
  using (bucket_id = 'park-media');

create policy "park media: contributors upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'park-media'
    and private.can_contribute_park(private.park_media_park(name))
  );

-- A retried upload overwrites (upsert), which needs update too. Only while
-- no photo row points at the file yet: a published photo's file never changes.
create policy "park media: contributors re-upload" on storage.objects for update to authenticated
  using (
    bucket_id = 'park-media'
    and private.can_contribute_park(private.park_media_park(name))
    and not exists (select 1 from public.park_photos ph where ph.storage_path = storage.objects.name)
  );

-- 3. Row rules -----------------------------------------------------------------------

create policy "members read park photos" on public.park_photos for select to authenticated
  using (
    archived_at is null
    or uploaded_by = (select auth.uid())
    or private.can_contribute_park(park_id)
  );

create policy "contributors add park photos" on public.park_photos for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and archived_at is null
    and private.is_active_member()
    and private.can_contribute_park(park_id)
  );

-- Contributors reorder; uploaders and admins archive. What each may change
-- is checked by the trigger below.
create policy "contributors and uploaders edit park photos" on public.park_photos for update to authenticated
  using (private.can_contribute_park(park_id) or uploaded_by = (select auth.uid()))
  with check (private.can_contribute_park(park_id) or uploaded_by = (select auth.uid()));

-- No delete policy: photos are archived, never deleted.

-- Security invoker, so current_user tells members ('authenticated') apart
-- from the owner's tools ('service_role') and migrations ('postgres').
create or replace function private.guard_park_photo()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.storage_path is distinct from (new.park_id::text || '/' || new.id::text || '.jpg') then
      raise exception 'Park photo path must be <park>/<photo>.jpg';
    end if;
    if not private.park_media_object_exists(new.storage_path) then
      raise exception 'The photo hasn''t finished uploading';
    end if;
    if (select count(*) from park_photos where park_id = new.park_id and archived_at is null) >= 8 then
      raise exception 'A park has at most 8 photos';
    end if;
    new.photographer := coalesce(
      nullif(trim(new.photographer), ''),
      (select username::text from profiles where id = new.uploaded_by),
      ''
    );
    new.sort_order := coalesce(
      (select max(sort_order) + 1 from park_photos where park_id = new.park_id and archived_at is null),
      0
    );
    new.created_at := now();
    return new;
  end if;

  -- UPDATE: the file, the park and who uploaded it never change.
  if new.park_id is distinct from old.park_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.storage_path is distinct from old.storage_path
     or new.width is distinct from old.width
     or new.height is distinct from old.height
     or new.created_at is distinct from old.created_at then
    raise exception 'A park photo''s file can''t be changed';
  end if;

  if new.sort_order is distinct from old.sort_order and not private.can_contribute_park(old.park_id) then
    raise exception 'Only contributors and admins can reorder park photos';
  end if;

  if (new.photographer, new.source, new.license) is distinct from (old.photographer, old.source, old.license)
     and old.uploaded_by <> auth.uid() and not private.can_moderate_park(old.park_id) then
    raise exception 'Only the uploader or an admin can change a photo''s credit';
  end if;

  if new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by then
    if old.archived_at is null and new.archived_at is not null then
      if old.uploaded_by <> auth.uid() and not private.can_moderate_park(old.park_id) then
        raise exception 'Only the uploader or an admin can archive a park photo';
      end if;
      new.archived_at := now();
      new.archived_by := auth.uid();
    elsif not private.can_moderate_park(old.park_id) then
      raise exception 'Only admins can bring back an archived park photo';
    end if;
  end if;
  return new;
end $$;

create trigger park_photos_guard
  before insert or update on public.park_photos
  for each row execute function private.guard_park_photo();

-- 4. Reordering ----------------------------------------------------------------------

-- Puts a park's photos in the given order in one statement. Security
-- invoker: the update rule and the trigger above still apply. Photos left
-- out keep their place after the listed ones.
create or replace function public.reorder_park_photos(park uuid, photo_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.park_photos ph
  set sort_order = o.ord - 1
  from unnest(photo_ids) with ordinality as o(id, ord)
  where ph.id = o.id and ph.park_id = park and ph.archived_at is null;

  update public.park_photos ph
  set sort_order = cardinality(photo_ids) + ph.sort_order
  where ph.park_id = park and ph.archived_at is null and not (ph.id = any (photo_ids));
$$;

comment on function public.reorder_park_photos(uuid, uuid[]) is
  'Sets the gallery order of a park''s photos. Contributors and admins for the park only.';

-- 5. Grants ----------------------------------------------------------------------------

revoke all on public.park_photos from anon;
revoke all on function private.park_media_object_exists(text) from public, anon;
grant execute on function private.park_media_object_exists(text) to authenticated, service_role;
revoke all on function private.park_media_park(text) from public, anon;
grant execute on function private.park_media_park(text) to authenticated, service_role;
revoke all on function private.guard_park_photo() from public, anon;
revoke all on function public.reorder_park_photos(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_park_photos(uuid, uuid[]) to authenticated;
