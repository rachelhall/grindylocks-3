-- Upload path (M1). Additive only: no existing policy, function or trigger
-- is dropped or replaced.
--
-- - A post publishes on its own once all of its slides' media is ready.
--   Until then only the author and moderators can see it.
-- - Photos live in the private post-media bucket, readable by whoever can
--   see the (published) post.
-- - Video slides are created and updated only by the Stream edge functions,
--   which use the secret key; members can't set a Stream ID or mark a video
--   ready themselves.

-- 1. Posts: expected slide count and publish time ---------------------------

alter table public.posts
  add column slide_count smallint not null default 1 check (slide_count between 1 and 10),
  add column published_at timestamptz;

comment on column public.posts.slide_count is
  'Number of slides the post was created with. It publishes when this many slides are ready.';
comment on column public.posts.published_at is
  'Set by the database when every slide is ready. Null means still uploading; only the author and moderators see it.';

create index posts_published_metro_idx on public.posts (metro_area_id, published_at desc)
  where status = 'visible' and published_at is not null;
create index posts_published_park_idx on public.posts (park_id, published_at desc)
  where status = 'visible' and published_at is not null;

-- Restrictive policies are ANDed with the existing permissive ones.
create policy "new posts start unpublished" on public.posts
  as restrictive for insert to authenticated
  with check (published_at is null);

create policy "unpublished posts are private" on public.posts
  as restrictive for select to authenticated
  using (
    published_at is not null
    or author_id = (select auth.uid())
    or private.can_moderate_post(id)
  );

-- The slide read policy goes through private.can_see_post, which bypasses
-- RLS; this makes slides follow the post's own visibility.
create policy "slides follow their post" on public.post_slides
  as restrictive for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_slides.post_id));

-- published_at only changes through the publish trigger; slide_count never.
create or replace function private.guard_post_publish()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.slide_count is distinct from old.slide_count then
    raise exception 'A post''s slide count can''t change';
  end if;
  if new.published_at is distinct from old.published_at
     and coalesce(current_setting('grindylocks.publishing', true), '') <> 'on' then
    raise exception 'Posts publish on their own once their media is ready';
  end if;
  return new;
end $$;

create trigger posts_guard_publish
  before update on public.posts
  for each row execute function private.guard_post_publish();

-- 2. Slides: what members may write -----------------------------------------

-- Is there an uploaded object at this path? Members can't list other
-- people's objects, so this runs as the owner.
create or replace function private.media_object_exists(path text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from storage.objects where bucket_id = 'post-media' and name = path);
$$;

-- Security invoker, so current_user tells members ('authenticated') apart
-- from the edge functions ('service_role') and migrations ('postgres').
create or replace function private.guard_slide_media()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
declare
  post_row posts%rowtype;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select * into post_row from posts where id = new.post_id;
    if new.kind = 'video' then
      raise exception 'Video slides are created by the upload service';
    end if;
    if post_row.published_at is not null then
      raise exception 'Slides can''t be added after a post is published';
    end if;
    if new.position >= post_row.slide_count then
      raise exception 'This post has % slides', post_row.slide_count;
    end if;
    if new.upload_status <> 'uploading' then
      raise exception 'New slides start as uploading';
    end if;
    if new.storage_path is distinct from
       (auth.uid()::text || '/' || new.post_id::text || '/' || new.id::text || '.jpg') then
      raise exception 'Photo path must be <user>/<post>/<slide>.jpg';
    end if;
    return new;
  end if;

  -- UPDATE: tags can change; the media itself can't.
  if new.post_id is distinct from old.post_id
     or new.kind is distinct from old.kind
     or new.position is distinct from old.position
     or new.storage_path is distinct from old.storage_path
     or new.stream_video_id is distinct from old.stream_video_id
     or new.duration_s is distinct from old.duration_s
     or new.width is distinct from old.width
     or new.height is distinct from old.height then
    raise exception 'A slide''s media can''t be changed';
  end if;

  if new.upload_status is distinct from old.upload_status then
    if new.kind = 'video' then
      raise exception 'Video status is set by the upload service';
    end if;
    if new.upload_status = 'processing' then
      raise exception 'Photos don''t have a processing step';
    end if;
    if new.upload_status = 'ready' and not private.media_object_exists(new.storage_path) then
      raise exception 'The photo hasn''t finished uploading';
    end if;
  end if;
  return new;
end $$;

create trigger post_slides_guard_media
  before insert or update on public.post_slides
  for each row execute function private.guard_slide_media();

-- 3. Publishing ---------------------------------------------------------------

create or replace function private.publish_when_ready()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from posts p
    where p.id = new.post_id and p.published_at is null
      and p.slide_count = (
        select count(*) from post_slides s where s.post_id = p.id and s.upload_status = 'ready'
      )
  ) then
    perform set_config('grindylocks.publishing', 'on', true);
    update posts set published_at = now() where id = new.post_id and published_at is null;
    perform set_config('grindylocks.publishing', 'off', true);
  end if;
  return null;
end $$;

create trigger post_slides_publish
  after insert or update of upload_status on public.post_slides
  for each row execute function private.publish_when_ready();

revoke all on function private.media_object_exists(text) from public, anon;
grant execute on function private.media_object_exists(text) to authenticated, service_role;
revoke all on function private.publish_when_ready() from public, anon, authenticated;
revoke all on function private.guard_post_publish() from public, anon, authenticated;
revoke all on function private.guard_slide_media() from public, anon;

-- 4. Photo storage ------------------------------------------------------------

-- Photos are re-encoded to JPEG on the phone (HEIC and PNG included), so the
-- bucket only takes JPEG. 15 MB is far above a 2048 px JPEG.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 15728640, array['image/jpeg'])
on conflict (id) do nothing;

-- Upload only to a path one of your own unfinished photo slides points at.
create policy "post media: author uploads" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and exists (
      select 1 from public.post_slides s join public.posts p on p.id = s.post_id
      where s.storage_path = storage.objects.name
        and p.author_id = (select auth.uid())
        and s.upload_status in ('uploading', 'failed')
    )
  );

-- A retried upload overwrites (upsert), which needs update too.
create policy "post media: author re-uploads" on storage.objects for update to authenticated
  using (
    bucket_id = 'post-media'
    and exists (
      select 1 from public.post_slides s join public.posts p on p.id = s.post_id
      where s.storage_path = storage.objects.name
        and p.author_id = (select auth.uid())
        and s.upload_status in ('uploading', 'failed')
    )
  );

-- Read a photo when you can see its post: the slide must be visible to you,
-- and slides follow the post's visibility (published, not blocked, private
-- accounts only for followers).
create policy "post media: read with the post" on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and exists (
      select 1 from public.post_slides s where s.storage_path = storage.objects.name
    )
  );

create policy "post media: author deletes" on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create index post_slides_storage_path_idx on public.post_slides (storage_path)
  where storage_path is not null;
create index post_slides_stream_video_idx on public.post_slides (stream_video_id)
  where stream_video_id is not null;
