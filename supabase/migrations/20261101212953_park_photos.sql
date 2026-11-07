-- Park photos (v1, Nov 1 decisions). Additive only: a new table, bucket,
-- functions and policies; nothing existing is dropped or replaced.
--
-- - A park has up to 8 photos, shown in its page header (the first one,
--   filtered) and in the gallery (all of them, in full color).
-- - Every signed-in member can see them. People with a role at the park or
--   its metro area (park contributors, park admins, city admins, the owner)
--   add and reorder them. The uploader or a park/city admin removes one,
--   which archives it for everyone rather than deleting the row.
-- - Each photo carries its credit: photographer (defaults to the uploader's
--   username), source ("own photo", "permission from <park>",
--   "Wikimedia Commons") and license ("own", "permission", "CC BY-SA 4.0").
-- - Files live in the private park-media bucket at <park>/<photo>.jpg.
--   The phone uploads the file first, then inserts the row, which checks the
--   file is there.

-- 1. Table ----------------------------------------------------------------------

create table public.park_photos (
  id           uuid primary key default gen_random_uuid(),
  park_id      uuid not null references public.parks (id),
  uploaded_by  uuid not null default auth.uid() references public.profiles (id),
  storage_path text not null unique,
  width        integer not null check (width > 0),
  height       integer not null check (height > 0),
  sort_order   smallint not null default 0 check (sort_order >= 0),
  photographer text not null default '' check (length(photographer) <= 100),
  source       text not null default 'own photo' check (length(source) between 1 and 200),
  license      text not null default 'own' check (length(license) between 1 and 100),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  archived_by  uuid references public.profiles (id)
);

comment on table public.park_photos is
  'Photos of the park itself (not riding), shown in the park header and gallery. At most 8 active per park.';
comment on column public.park_photos.photographer is
  'Who took it, as shown in the credit. Left blank on insert, it becomes the uploader''s username.';
comment on column public.park_photos.source is
  'Where it came from: "own photo", "permission from <park>", "Wikimedia Commons", or other text.';
comment on column public.park_photos.license is
  'Terms it is used under: "own", "permission", "CC BY-SA 4.0", or other text.';
comment on column public.park_photos.archived_at is
  'Set when removed from the gallery. Archived photos are hidden from members; nothing is hard-deleted.';

create index park_photos_park_idx on public.park_photos (park_id, sort_order) where archived_at is null;
create index park_photos_uploader_idx on public.park_photos (uploaded_by);
create index park_photos_archived_by_idx on public.park_photos (archived_by) where archived_by is not null;

alter table public.park_photos enable row level security;

-- 2. Who can do what ----------------------------------------------------------

create policy "members read park photos" on public.park_photos for select to authenticated
  using (archived_at is null or private.can_contribute_park(park_id));

create policy "contributors add park photos" on public.park_photos for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and archived_at is null
    and private.can_contribute_park(park_id)
  );

-- Reordering (contributors) and archiving (uploader or admins) are both
-- updates; the guard trigger below says which fields each may change.
create policy "contributors and uploaders update park photos" on public.park_photos for update to authenticated
  using (private.can_contribute_park(park_id) or uploaded_by = (select auth.uid()))
  with check (private.can_contribute_park(park_id) or uploaded_by = (select auth.uid()));

revoke update on public.park_photos from authenticated;
grant update (sort_order, photographer, source, license, archived_at, archived_by)
  on public.park_photos to authenticated;

-- 3. Files ------------------------------------------------------------------------

-- Is there an uploaded file at this path? Runs as the owner, like
-- private.media_object_exists for post photos.
create or replace function private.park_media_object_exists(path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from storage.objects where bucket_id = 'park-media' and name = path);
$$;

-- The park a park-media path belongs to, or null if the path isn't
-- <park uuid>/<photo uuid>.jpg. Policies check for null first: the owner
-- passes can_contribute_park(null), and a bad path must never pass.
create or replace function private.park_media_park(path text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    then split_part(path, '/', 1)::uuid
  end;
$$;

-- 4. Guards -------------------------------------------------------------------------

create or replace function private.guard_park_photo()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
declare
  active_count integer;
begin
  -- Migrations and the service role (seeding, support) skip the member rules.
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

    -- One insert at a time per park, so two uploads can't pass 8 together.
    perform pg_advisory_xact_lock(hashtext('park_photos:' || new.park_id::text));
    select count(*) into active_count from park_photos where park_id = new.park_id and archived_at is null;
    if active_count >= 8 then
      raise exception 'A park has at most 8 photos';
    end if;

    -- New photos go at the end of the gallery.
    select coalesce(max(sort_order) + 1, 0) into new.sort_order
    from park_photos where park_id = new.park_id and archived_at is null;

    if btrim(new.photographer) = '' then
      new.photographer := coalesce((select username::text from profiles where id = new.uploaded_by), '');
    end if;
    new.created_at := now();
    return new;
  end if;

  -- UPDATE
  if new.park_id is distinct from old.park_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.storage_path is distinct from old.storage_path
     or new.width is distinct from old.width
     or new.height is distinct from old.height
     or new.created_at is distinct from old.created_at then
    raise exception 'A park photo''s file can''t be changed';
  end if;

  if new.sort_order is distinct from old.sort_order and not private.can_contribute_park(old.park_id) then
    raise exception 'Only contributors can reorder park photos';
  end if;

  if (new.photographer is distinct from old.photographer
      or new.source is distinct from old.source
      or new.license is distinct from old.license)
     and not (old.uploaded_by = auth.uid() or private.can_moderate_park(old.park_id)) then
    raise exception 'Only the uploader or a park admin can change a photo''s credit';
  end if;

  if old.archived_at is null and new.archived_at is not null then
    if not (old.uploaded_by = auth.uid() or private.can_moderate_park(old.park_id)) then
      raise exception 'Only the uploader or a park admin can remove a park photo';
    end if;
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif old.archived_at is not null and new.archived_at is null then
    if not private.can_moderate_park(old.park_id) then
      raise exception 'Only park admins can restore a park photo';
    end if;
    new.archived_by := null;
  elsif new.archived_by is distinct from old.archived_by then
    raise exception 'archived_by is set when a photo is archived';
  end if;

  return new;
end $$;

create trigger park_photos_guard
  before insert or update on public.park_photos
  for each row execute function private.guard_park_photo();

-- 5. Reordering ----------------------------------------------------------------------

-- Puts a park's active photos in the given order in one go (the first is the
-- header photo). Runs as the caller, so the policies and guard apply.
create or replace function public.reorder_park_photos(park uuid, photo_ids uuid[])
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  if not private.can_contribute_park(park) then
    raise exception 'Only contributors can reorder park photos';
  end if;
  if (select count(*) from park_photos where park_id = park and archived_at is null)
     <> coalesce(cardinality(photo_ids), 0)
     or exists (
       select 1 from unnest(photo_ids) as i(id)
       where not exists (select 1 from park_photos p where p.id = i.id and p.park_id = park and p.archived_at is null)
     ) then
    raise exception 'List every active photo of this park exactly once';
  end if;

  update park_photos p
  set sort_order = o.position - 1
  from unnest(photo_ids) with ordinality as o(id, position)
  where p.id = o.id and p.park_id = park and p.sort_order is distinct from o.position - 1;
end $$;

-- 6. Your role at a park ----------------------------------------------------------------

-- The signed-in member's strongest role that covers this park (owner, city
-- admin of its metro, park admin, park contributor), or null. Drives the
-- role badge and the Add photos button; the policies above do the enforcing.
create or replace function public.my_park_role(park uuid)
returns public.role_name
language sql stable security invoker
set search_path = public
as $$
  select r.role
  from role_assignments r
  left join parks p on p.id = park
  where r.user_id = auth.uid() and r.accepted_at is not null and r.ended_at is null
    and (
      r.role = 'owner'
      or (r.role = 'city_admin' and r.metro_area_id = p.metro_area_id)
      or (r.role in ('park_admin', 'park_contributor') and r.park_id = park)
    )
  order by case r.role
    when 'owner' then 0 when 'city_admin' then 1 when 'park_admin' then 2 else 3
  end
  limit 1;
$$;

revoke all on function private.park_media_object_exists(text) from public, anon;
revoke all on function private.park_media_park(text) from public, anon;
revoke all on function private.guard_park_photo() from public, anon;
revoke all on function public.reorder_park_photos(uuid, uuid[]) from public, anon;
revoke all on function public.my_park_role(uuid) from public, anon;
grant execute on function private.park_media_object_exists(text) to authenticated;
grant execute on function private.park_media_park(text) to authenticated;
grant execute on function public.reorder_park_photos(uuid, uuid[]) to authenticated;
grant execute on function public.my_park_role(uuid) to authenticated;

-- 7. Storage ----------------------------------------------------------------------------

-- JPEG only: photos are re-encoded on the phone (2048 px long edge, quality
-- 0.82), as post photos are.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('park-media', 'park-media', false, 15728640, array['image/jpeg'])
on conflict (id) do nothing;

create policy "park media: members read" on storage.objects for select to authenticated
  using (bucket_id = 'park-media');

-- Upload to <park>/<photo>.jpg when you have a role at that park or its metro.
create policy "park media: contributors upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'park-media'
    and private.park_media_park(name) is not null
    and private.can_contribute_park(private.park_media_park(name))
  );

-- A retried upload overwrites (upsert), but only until the photo is added:
-- a file in the gallery can't be swapped for another.
create policy "park media: contributors re-upload" on storage.objects for update to authenticated
  using (
    bucket_id = 'park-media'
    and private.park_media_park(name) is not null
    and private.can_contribute_park(private.park_media_park(name))
    and not exists (select 1 from public.park_photos p where p.storage_path = storage.objects.name)
  );

-- Clean up a file whose photo row never got added.
create policy "park media: contributors remove unused files" on storage.objects for delete to authenticated
  using (
    bucket_id = 'park-media'
    and private.park_media_park(name) is not null
    and private.can_contribute_park(private.park_media_park(name))
    and not exists (select 1 from public.park_photos p where p.storage_path = storage.objects.name)
  );
