-- Rolled-back check for 20261102170000_moderation.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true. Needs 20261102160000_moderation_enums
-- applied first (a transaction can't use enum values it adds).
-- Test people are made up (zz_mod_*) and vanish with the rollback.
begin;

-- M5 roles and safety: the moderation functions (Nov 2).
--
-- Every moderation action is a Postgres function that both the app and the
-- web admin call with the signed-in person's own session; neither app holds
-- moderation logic. Each function checks the caller's role and scope itself
-- (security definer, so the tables need no new grants).
--
--  1. Notices and the moderation log: notifications.message, table
--     moderation_actions.
--  2. Roles: private.end_roles() ends every role a person holds, logs it and
--     tells the next role up. A ban and an account deletion both use it.
--  3. Members report things: file_report() (posts, comments, people) and
--     report_park_info() (park info, with an optional photo in the new
--     private `report-photos` bucket).
--  4. The queue: moderation_queue() (one list of report groups, park info
--     reports and suggested obstacles, in the caller's scope) and
--     moderation_report_detail() (one report group with the person's history).
--  5. Acting on reports: moderate_reports(): dismiss (and restore), keep
--     hidden, warn, suspend 1/7/30 days, escalate to the owner, ban (owner
--     only; ends the person's roles). The app's quick hide/dismiss calls the
--     same function.
--  6. Park info and obstacles: review_park_info() (approve and apply, or
--     decline; the reporter is told when a fix goes live), review_obstacle()
--     (approve, merge, decline) and set_park_verified().
--  7. Members' own side: my_restriction() (suspension or ban, with the
--     reason), my_notifications() now also lists moderation notices and park
--     fixes going live, delete_my_account() and export_my_data().
--
-- Report routing stays as it is: harassment and anything involving a minor go
-- only to the owner ("Sent to you"), and so do reports about a person rather
-- than a post or comment. Escalated reports leave the city or park admin's
-- queue and go to the owner.
--
-- Also a fix: auto-hide after 3 reports failed whenever a member filed the
-- third report (the post guard refused the trigger's change); see section 3.
--
-- Additive: one new column, two tables, one bucket with its policies, new
-- functions. Replaced with the same signatures: my_notifications() (adds
-- kinds), reports_auto_hide() and private.guard_post_fields() (the fix).
-- Nothing is dropped.

/* 1. Notices and the moderation log ------------------------------------------ */

alter table public.notifications
  add column if not exists message text check (message is null or char_length(message) <= 500);

comment on column public.notifications.message is
  'Text a moderator wrote for the person (a warning, a suspension or a removal reason).';

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id),
  action text not null check (action in (
    'dismiss', 'keep_hidden', 'warn', 'suspend', 'escalate', 'ban',
    'park_info_approved', 'park_info_declined',
    'obstacle_approved', 'obstacle_merged', 'obstacle_declined',
    'park_verified'
  )),
  target_user_id uuid references public.profiles (id),
  post_id uuid references public.posts (id),
  comment_id uuid references public.comments (id),
  park_id uuid references public.parks (id),
  obstacle_id uuid references public.obstacles (id),
  park_info_report_id uuid references public.park_info_reports (id),
  report_ids uuid[] not null default '{}',
  -- What the person was told (warnings, suspensions, removals).
  message text check (message is null or char_length(message) <= 500),
  suspended_until timestamptz,
  -- A removed comment's text, kept here because deleting a comment erases it.
  snapshot jsonb,
  created_at timestamptz not null default now()
);

comment on table public.moderation_actions is
  'Log of every moderation action. Written only by the moderation functions.';

create index if not exists moderation_actions_target_idx on public.moderation_actions (target_user_id, created_at desc);

alter table public.moderation_actions enable row level security;
revoke all on public.moderation_actions from anon, authenticated;
grant select on public.moderation_actions to authenticated;

create policy "owner reads the moderation log, admins their own actions"
  on public.moderation_actions for select to authenticated
  using (private.is_owner() or actor_id = (select auth.uid()));

-- Data export requests, to keep them to one a day.
create table if not exists private.data_exports (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists data_exports_user_idx on private.data_exports (user_id, created_at desc);

/* Helpers ------------------------------------------------------------------- */

-- The caller's highest active role: 0 owner, 1 city admin, 2 park admin,
-- 3 park contributor, 9 none.
create or replace function private.role_rank(person uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(min(case role
           when 'owner' then 0 when 'city_admin' then 1
           when 'park_admin' then 2 else 3 end), 9)
    from role_assignments
   where user_id = person and accepted_at is not null and ended_at is null;
$$;

-- Whether the caller may act on a report: the same routing as the reports
-- read rule, plus "escalated and person reports are the owner's".
create or replace function private.can_review_report(r public.reports)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_owner() or (
    r.status = 'open'
    and r.reason not in ('harassment', 'involves_minor')
    and (
      (r.post_id is not null and private.can_moderate_post(r.post_id))
      or (r.comment_id is not null
          and private.can_moderate_post((select c.post_id from comments c where c.id = r.comment_id)))
    )
  );
$$;

-- The open (or escalated) reports about one post, comment or person.
create or replace function private.reports_for(target_kind text, target uuid)
returns setof public.reports
language sql
stable
security definer
set search_path = public
as $$
  select r.* from reports r
   where r.status in ('open', 'escalated')
     and case target_kind
           when 'post' then r.post_id = target
           when 'comment' then r.comment_id = target
           when 'person' then r.reported_user_id = target and r.post_id is null and r.comment_id is null
           else false
         end;
$$;

/* 2. Roles --------------------------------------------------------------------- */

-- Ends every role (and unaccepted role invite) a person holds, logs each in
-- role_change_log, and tells the next role up (city admin, else the owner)
-- that the spot is open, unless that's the person doing it.
create or replace function private.end_roles(person uuid, reason text, actor uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  ra record;
  n integer := 0;
  told uuid;
begin
  for ra in
    update role_assignments
       set ended_at = now(), ended_reason = reason
     where user_id = person and ended_at is null
    returning *
  loop
    n := n + 1;
    insert into role_change_log (assignment_id, actor_id, action, details)
    values (ra.id, actor, 'ended', jsonb_build_object('reason', reason, 'role', ra.role));

    if ra.accepted_at is null or ra.role = 'owner' then
      continue;
    end if;

    told := null;
    -- A park contributor's park admin comes first.
    if ra.role = 'park_contributor' then
      select x.user_id into told from role_assignments x
       where x.role = 'park_admin' and x.park_id = ra.park_id
         and x.accepted_at is not null and x.ended_at is null and x.user_id <> person
       order by x.created_at limit 1;
    end if;
    if told is null and ra.role in ('park_contributor', 'park_admin') then
      select x.user_id into told from role_assignments x
        join parks p on p.id = ra.park_id
       where x.role = 'city_admin' and x.metro_area_id = p.metro_area_id
         and x.accepted_at is not null and x.ended_at is null and x.user_id <> person
       order by x.created_at limit 1;
    end if;
    if told is null then
      select x.user_id into told from role_assignments x
       where x.role = 'owner' and x.accepted_at is not null and x.ended_at is null and x.user_id <> person
       order by x.created_at limit 1;
    end if;

    if told is not null and told is distinct from actor then
      insert into notifications (recipient_id, kind, actor_id, park_id, message)
      values (told, 'role_vacated', person, ra.park_id, ra.role::text);
    end if;
  end loop;
  return n;
end;
$$;

/* 3. Members report things ------------------------------------------------------ */

-- Fix: auto-hide after 3 reports never worked for members. The third report
-- is filed by an ordinary member, and the post guard only lets moderators
-- change a post's status, so the insert failed. The auto-hide trigger now
-- marks its own change (like publishing does) and the guard lets that one
-- change through: visible to auto_hidden, nothing else. Both functions are
-- replaced with the same signatures.
create or replace function public.reports_auto_hide()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.post_id is not null and (
    select count(distinct reporter_id) from reports
    where post_id = new.post_id and status = 'open'
  ) >= 3 then
    perform set_config('grindylocks.auto_hiding', 'on', true);
    update posts set status = 'auto_hidden' where id = new.post_id and status = 'visible';
    perform set_config('grindylocks.auto_hiding', 'off', true);
  end if;
  return new;
end;
$$;

create or replace function private.guard_post_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_author boolean := old.author_id = auth.uid();
  is_mod boolean := private.can_moderate_post(old.id);
  auto_hiding boolean := coalesce(current_setting('grindylocks.auto_hiding', true), '') = 'on'
                         and old.status = 'visible' and new.status = 'auto_hidden';
begin
  if new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at then
    raise exception 'A post''s author and date can''t change';
  end if;
  if new.status is distinct from old.status then
    if not (is_mod or auto_hiding or (is_author and new.status = 'deleted')) then
      raise exception 'Only moderators can hide or restore a post';
    end if;
  end if;
  if not is_author and (new.caption is distinct from old.caption or new.park_id is distinct from old.park_id
                        or new.metro_area_id is distinct from old.metro_area_id) then
    raise exception 'Only the author can edit a post';
  end if;
  if is_author and (new.caption is distinct from old.caption or new.park_id is distinct from old.park_id) then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

-- Report a post, a comment or a person (exactly one). A repeat report of the
-- same thing by the same person while the first is still open is quietly
-- accepted and changes nothing. Suspended members can still report.
create or replace function public.file_report(
  post uuid default null,
  comment uuid default null,
  person uuid default null,
  reason public.report_reason default 'other',
  details text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_user uuid;
  c comments%rowtype;
  clean text := nullif(btrim(coalesce(details, '')), '');
begin
  if me is null or not exists (
    select 1 from profiles where id = me and onboarded_at is not null and deleted_at is null and banned_at is null
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if num_nonnulls(post, comment, person) <> 1 then
    raise exception 'report_one_thing' using errcode = '22023';
  end if;
  if clean is not null and char_length(clean) > 500 then
    raise exception 'details_too_long' using errcode = '22023';
  end if;
  if reason = 'wrong_park' and post is null then
    raise exception 'wrong_park_is_for_posts' using errcode = '22023';
  end if;

  if post is not null then
    select p.author_id into target_user from posts p
     where p.id = post and p.published_at is not null and p.status <> 'deleted';
    if target_user is null or not private.can_see_post(post) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  elsif comment is not null then
    select * into c from comments where id = comment;
    if c.id is null or c.deleted_at is not null or not private.can_see_post(c.post_id)
       or private.blocked_between(c.author_id) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    target_user := c.author_id;
  else
    if not exists (select 1 from profiles where id = person and deleted_at is null and onboarded_at is not null) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    target_user := person;
  end if;

  if target_user = me then
    raise exception 'cannot_report_yourself' using errcode = '22023';
  end if;

  if exists (
    select 1 from reports r
     where r.reporter_id = me and r.status = 'open'
       and r.post_id is not distinct from post
       and r.comment_id is not distinct from comment
       and (post is not null or comment is not null or r.reported_user_id = person)
  ) then
    return;
  end if;

  insert into reports (reporter_id, post_id, comment_id, reported_user_id, reason, details)
  values (me, post, comment, target_user, reason, clean);
end;
$$;

-- Photos attached to park info reports: `<park>/<reporter>/<id>.jpg`, private.
-- The reporter uploads and reads their own; the park's contributors and
-- admins read them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

create or replace function private.report_photo_park(path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    then split_part(path, '/', 1)::uuid
  end;
$$;

create policy "report photos: reporter uploads"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-photos'
    and private.report_photo_park(name) is not null
    and split_part(name, '/', 2) = (select auth.uid())::text
  );

create policy "report photos: reporter and park contributors read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'report-photos'
    and private.report_photo_park(name) is not null
    and (split_part(name, '/', 2) = (select auth.uid())::text
         or private.can_contribute_park(private.report_photo_park(name)))
  );

create policy "report photos: reporter removes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'report-photos' and split_part(name, '/', 2) = (select auth.uid())::text);

-- Report something wrong on a park page. `suggested` is the reporter's fix in
-- the same shape review_park_info() applies (see there); note and photo are
-- optional. Returns the new report's id.
create or replace function public.report_park_info(
  park uuid,
  field public.park_field,
  obstacle uuid default null,
  suggested jsonb default null,
  note text default null,
  photo_path text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := nullif(btrim(coalesce(note, '')), '');
  new_id uuid;
begin
  if me is null or not exists (
    select 1 from profiles where id = me and onboarded_at is not null and deleted_at is null and banned_at is null
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from parks where id = park) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if field = 'obstacle' then
    if obstacle is null or not exists (
      select 1 from obstacles o where o.id = obstacle and o.park_id = park and o.status = 'active'
    ) then
      raise exception 'pick_an_obstacle' using errcode = '22023';
    end if;
  elsif obstacle is not null then
    raise exception 'obstacle_only_for_obstacle_reports' using errcode = '22023';
  end if;
  if clean is not null and char_length(clean) > 500 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;
  if suggested is not null and octet_length(suggested::text) > 4000 then
    raise exception 'suggestion_too_long' using errcode = '22023';
  end if;
  if photo_path is not null and (
       private.report_photo_park(photo_path) is distinct from park
       or split_part(photo_path, '/', 2) <> me::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'report-photos' and o.name = photo_path)
     ) then
    raise exception 'photo_not_uploaded' using errcode = '22023';
  end if;
  if clean is null and suggested is null and photo_path is null then
    raise exception 'say_what_is_wrong' using errcode = '22023';
  end if;
  if (select count(*) from park_info_reports r
       where r.reporter_id = me and r.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_reports' using errcode = '54000';
  end if;

  insert into park_info_reports (park_id, reporter_id, field, obstacle_id, suggested_value, note, photo_path)
  values (park, me, field, obstacle, suggested, clean, photo_path)
  returning id into new_id;
  return new_id;
end;
$$;

/* 4. The queue ------------------------------------------------------------------ */

-- One row per thing waiting for the caller: a group of reports about one post,
-- comment or person; a park info report; a suggested obstacle. Only what the
-- caller may act on, newest first. `metro` narrows it to one metro area.
--
-- state: 'sent_to_you' (owner: escalated, harassment, a minor, or a person
-- report), 'auto_hidden' (a post hidden after 3 reports), 'hidden', or 'open'.
create or replace function public.moderation_queue(metro uuid default null)
returns table (
  kind text,
  id uuid,
  target text,
  report_count integer,
  reason text,
  username text,
  label text,
  park_id uuid,
  park_name text,
  park_slug text,
  metro_area_id uuid,
  metro_name text,
  state text,
  waiting_since timestamptz,
  latest_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  owner boolean := private.is_owner();
begin
  if me is null or private.role_rank(me) > 3 then
    return;
  end if;

  return query
  with mine as (
    select r.*,
           case when r.post_id is not null then 'post'
                when r.comment_id is not null then 'comment'
                else 'person' end as tkind,
           coalesce(r.post_id, r.comment_id, r.reported_user_id) as tid,
           coalesce(r.post_id, (select c.post_id from comments c where c.id = r.comment_id)) as on_post
      from reports r
     where r.status in ('open', 'escalated')
       and (r.status = 'open' or owner)
       and private.can_review_report(r)
  ),
  groups as (
    select m.tkind, m.tid, min(m.on_post::text)::uuid as on_post,
           count(distinct m.reporter_id)::integer as n,
           mode() within group (order by m.reason) as top_reason,
           min(m.created_at) as first_at, max(m.created_at) as last_at,
           bool_or(m.status = 'escalated') as escalated,
           bool_or(m.reason in ('harassment', 'involves_minor')) as owner_only,
           min(m.reported_user_id::text)::uuid as person
      from mine m
     group by m.tkind, m.tid
  ),
  report_rows as (
    select 'report'::text as k, g.tid, g.tkind, g.n, g.top_reason::text,
           u.username::text as uname, null::text as lbl,
           pk.id as pid, pk.display_name::text as pname, pk.slug::text as pslug,
           coalesce(po.metro_area_id, u.home_metro_area_id) as mid,
           case
             when owner and (g.escalated or g.owner_only or g.tkind = 'person') then 'sent_to_you'
             when po.status = 'auto_hidden' and g.tkind = 'post' then 'auto_hidden'
             when po.status = 'hidden' and g.tkind = 'post' then 'hidden'
             else 'open'
           end as st,
           g.first_at, g.last_at
      from groups g
      left join posts po on po.id = g.on_post
      left join parks pk on pk.id = po.park_id
      left join profiles u on u.id = g.person
  ),
  info_rows as (
    select 'park_info'::text, r.id, r.field::text, 1, null::text,
           u.username::text, ob.name::text,
           pk.id, pk.display_name::text, pk.slug::text, pk.metro_area_id,
           'open'::text, r.created_at, r.created_at
      from park_info_reports r
      join parks pk on pk.id = r.park_id
      left join profiles u on u.id = r.reporter_id
      left join obstacles ob on ob.id = r.obstacle_id
     where r.status = 'open' and private.can_contribute_park(r.park_id)
  ),
  obstacle_rows as (
    select 'obstacle'::text, o.id, o.general_type::text, 1, null::text,
           u.username::text, o.name::text,
           pk.id, pk.display_name::text, pk.slug::text, pk.metro_area_id,
           'open'::text, o.created_at, o.created_at
      from obstacles o
      join parks pk on pk.id = o.park_id
      left join profiles u on u.id = o.suggested_by
     where o.status = 'pending' and private.can_contribute_park(o.park_id)
  ),
  everything as (
    select * from report_rows
    union all select * from info_rows
    union all select * from obstacle_rows
  )
  select e.k, e.tid, e.tkind, e.n, e.top_reason, e.uname, e.lbl,
         e.pid, e.pname, e.pslug, e.mid, ma.name::text, e.st, e.first_at, e.last_at
    from everything e
    left join metro_areas ma on ma.id = e.mid
   where metro is null or e.mid = metro
   order by e.last_at desc
   limit 500;
end;
$$;

-- Everything the detail pane shows for one report group: the post or comment
-- (with its slides), the reports, and the reported person's history.
-- target_kind: 'post', 'comment' or 'person'.
create or replace function public.moderation_report_detail(target_kind text, target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  person uuid;
  post_row posts%rowtype;
  c comments%rowtype;
  result jsonb;
begin
  if me is null or not exists (
    select 1 from private.reports_for(target_kind, target) r where private.can_review_report(r)
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if target_kind = 'post' then
    select * into post_row from posts where id = target;
    person := post_row.author_id;
  elsif target_kind = 'comment' then
    select * into c from comments where id = target;
    select * into post_row from posts where id = c.post_id;
    person := c.author_id;
  else
    person := target;
  end if;

  select jsonb_build_object(
    'kind', target_kind,
    'post', case when post_row.id is null then null else jsonb_build_object(
      'id', post_row.id,
      'caption', post_row.caption,
      'status', post_row.status,
      'created_at', coalesce(post_row.published_at, post_row.created_at),
      'author', (select username::text from profiles where id = post_row.author_id),
      'park', (select jsonb_build_object('id', pk.id, 'name', pk.display_name, 'slug', pk.slug,
                                         'metro', (select name from metro_areas where id = pk.metro_area_id))
                 from parks pk where pk.id = post_row.park_id),
      'slides', (select coalesce(jsonb_agg(jsonb_build_object(
                   'kind', s.kind, 'storage_path', s.storage_path, 'stream_video_id', s.stream_video_id,
                   'width', s.width, 'height', s.height, 'duration_s', s.duration_s) order by s.position), '[]'::jsonb)
                   from post_slides s where s.post_id = post_row.id)
    ) end,
    'comment', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'body', c.body, 'created_at', c.created_at, 'deleted', c.deleted_at is not null,
      'author', (select username::text from profiles where id = c.author_id)
    ) end,
    'reports', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', r.id, 'reason', r.reason, 'details', r.details, 'status', r.status,
                  'created_at', r.created_at,
                  'reporter', (select username::text from profiles where id = r.reporter_id)
                ) order by r.created_at), '[]'::jsonb)
                from private.reports_for(target_kind, target) r),
    'person', (select jsonb_build_object(
      'id', u.id,
      'username', u.username,
      'deleted', u.deleted_at is not null,
      'joined_at', u.joined_at,
      'invited_by', (select iu.username::text from invites i join profiles iu on iu.id = i.inviter_id
                      where i.used_by = u.id order by i.used_at desc limit 1),
      'post_count', (select count(*) from posts p where p.author_id = u.id and p.published_at is not null and p.status <> 'deleted'),
      'earlier_reports', (select count(*) from reports r where r.reported_user_id = u.id and r.status not in ('open', 'escalated')),
      'earlier_dismissed', (select count(*) from reports r where r.reported_user_id = u.id and r.status = 'dismissed'),
      'warnings', (select count(*) from moderation_actions a where a.target_user_id = u.id and a.action = 'warn'),
      'suspensions', (select count(*) from moderation_actions a where a.target_user_id = u.id and a.action = 'suspend'),
      'suspended_until', case when u.suspended_until > now() then u.suspended_until end,
      'banned', u.banned_at is not null,
      'holds_role', private.role_rank(u.id) < 9
    ) from profiles u where u.id = person),
    'can_ban', private.is_owner(),
    'can_escalate', not private.is_owner()
  ) into result;
  return result;
end;
$$;

/* 5. Acting on reports ------------------------------------------------------------ */

-- Hides a post (status 'hidden') or removes a comment (keeping its text in the
-- log). Returns the snapshot to log, if any.
create or replace function private.hide_target(target_kind text, target uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  snap jsonb;
begin
  if target_kind = 'post' then
    update posts set status = 'hidden' where id = target and status in ('visible', 'auto_hidden');
  elsif target_kind = 'comment' then
    select jsonb_build_object('body', body, 'created_at', created_at) into snap
      from comments where id = target and deleted_at is null;
    update comments set deleted_at = now() where id = target and deleted_at is null;
  end if;
  return snap;
end;
$$;

-- Acts on every open (or escalated) report about one post, comment or person.
--
-- decision:
--   dismiss      reports dismissed; a hidden post comes back. Tells nobody.
--   keep_hidden  the post stays hidden (or the comment is removed); the
--                person is told, with `message` if given.
--   warn         the person is warned with `message` (required).
--   suspend      `days` 1, 7 or 30, with `message` (required). They can sign
--                in and look around but can't post, comment, like or follow.
--   escalate     sends the reports to the owner (city and park admins only).
--   ban          owner only: banned for good, their roles end, unused invites
--                are cancelled and all their posts are hidden.
-- `hide` (warn, suspend): also keep the reported post or comment hidden. When
-- false, an auto-hidden post comes back.
create or replace function public.moderate_reports(
  target_kind text,
  target uuid,
  decision text,
  message text default null,
  days integer default null,
  hide boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  owner boolean := private.is_owner();
  ids uuid[];
  person uuid;
  the_post uuid;
  the_comment uuid;
  clean text := nullif(btrim(coalesce(message, '')), '');
  snap jsonb;
  until timestamptz;
  new_status report_status;
  new_action report_action;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if target_kind not in ('post', 'comment', 'person') then
    raise exception 'unknown_target' using errcode = '22023';
  end if;
  if decision not in ('dismiss', 'keep_hidden', 'warn', 'suspend', 'escalate', 'ban') then
    raise exception 'unknown_decision' using errcode = '22023';
  end if;
  if clean is not null and char_length(clean) > 500 then
    raise exception 'message_too_long' using errcode = '22023';
  end if;

  select array_agg(r.id) into ids
    from private.reports_for(target_kind, target) r
   where private.can_review_report(r);
  if ids is null then
    raise exception 'nothing_to_review' using errcode = 'P0002';
  end if;

  if target_kind = 'post' then
    the_post := target;
    select author_id into person from posts where id = target;
  elsif target_kind = 'comment' then
    the_comment := target;
    select author_id, post_id into person, the_post from comments where id = target;
  else
    person := target;
  end if;

  if target_kind = 'person' and decision = 'keep_hidden' then
    raise exception 'nothing_to_hide' using errcode = '22023';
  end if;
  if decision in ('warn', 'suspend', 'ban') and person = me then
    raise exception 'not_on_yourself' using errcode = '22023';
  end if;
  if decision = 'ban' and not owner then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if decision = 'escalate' and owner then
    raise exception 'already_with_the_owner' using errcode = '22023';
  end if;
  if decision in ('warn', 'suspend') and clean is null then
    raise exception 'message_required' using errcode = '22023';
  end if;
  if decision = 'suspend' and (days is null or days not in (1, 7, 30)) then
    raise exception 'suspend_1_7_or_30_days' using errcode = '22023';
  end if;
  -- City and park admins don't act on other role holders; they escalate.
  if decision in ('warn', 'suspend') and not owner and private.role_rank(person) < 9 then
    raise exception 'escalate_role_holders' using errcode = '42501';
  end if;
  if decision = 'ban' and private.role_rank(person) = 0 then
    raise exception 'not_on_the_owner' using errcode = '42501';
  end if;

  -- The post or comment.
  if decision = 'keep_hidden' or (decision in ('warn', 'suspend', 'ban') and (hide or decision = 'ban')) then
    snap := private.hide_target(target_kind, target);
  elsif decision in ('dismiss', 'warn', 'suspend') and target_kind = 'post' then
    update posts set status = 'visible' where id = target and status in ('auto_hidden', 'hidden');
  end if;

  -- The person.
  if decision = 'suspend' then
    update profiles
       set suspended_until = greatest(coalesce(suspended_until, now()), now() + make_interval(days => days))
     where id = person
    returning suspended_until into until;
  elsif decision = 'ban' then
    update profiles set banned_at = now() where id = person and banned_at is null;
    perform private.end_roles(person, 'banned', me);
    update invites set cancelled_at = now()
     where inviter_id = person and used_by is null and cancelled_at is null and returned_at is null;
    update posts set status = 'hidden' where author_id = person and status in ('visible', 'auto_hidden');
  end if;

  -- The reports.
  new_status := case decision
    when 'dismiss' then 'dismissed'
    when 'escalate' then 'escalated'
    else 'actioned' end;
  new_action := case decision
    when 'dismiss' then 'dismiss'
    when 'keep_hidden' then 'hide_post'
    when 'warn' then 'warn'
    when 'suspend' then 'suspend'
    when 'escalate' then 'escalate'
    else 'ban' end;
  update reports
     set status = new_status, action = new_action, resolved_by = me,
         resolved_at = case when decision = 'escalate' then null else now() end
   where id = any (ids);

  -- What the person is told.
  if decision = 'keep_hidden' then
    insert into notifications (recipient_id, kind, post_id, comment_id, message)
    values (person,
            case when target_kind = 'comment' then 'comment_removed' else 'post_removed' end::notification_kind,
            the_post, null, clean);
  elsif decision = 'warn' then
    insert into notifications (recipient_id, kind, post_id, message) values (person, 'warning', the_post, clean);
  elsif decision = 'suspend' then
    insert into notifications (recipient_id, kind, post_id, message) values (person, 'suspension', the_post, clean);
  end if;

  insert into moderation_actions (actor_id, action, target_user_id, post_id, comment_id, report_ids,
                                  message, suspended_until, snapshot)
  values (me, decision, person, the_post, the_comment, ids, clean, until, snap);
end;
$$;

/* 6. Park info and obstacles -------------------------------------------------------- */

-- Applies one field's value to a park and logs it in park_edits. Value shapes:
--   hours        {"days":[1..7], "start":"09:00"|"sunrise", "end":"22:00"|"sunset"}
--                Replaces those days in the park's general sessions (the
--                all-year sessions with the widest set of disciplines);
--                discipline-only and seasonal sessions stay as they are.
--   status       {"status":"open"|"temporarily_closed"|"seasonal_closure"|"coming_soon"}
--   lighting     {"night_lighting":true|false}
--   location     {"address":"…"} and/or {"latitude":…, "longitude":…}
--   fees         {"is_paid":true|false, "entry_fee":"…"}
--   disciplines  {"disciplines":["inline","quad",…]} (the general sessions)
--   helmet_rule  {"helmet_required":true|false|null}
--   description  {"body":"…", "locale":"en"}
--   obstacle, other: nothing is applied automatically.
create or replace function private.apply_park_field(
  park uuid, field public.park_field, value jsonb, report uuid, editor uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  p parks%rowtype;
  old_value jsonb;
  new_value jsonb := value;
  general discipline[];
  want_days smallint[];
  s park_sessions%rowtype;
  start_anchor time_anchor;
  start_time time;
  end_anchor time_anchor;
  end_time time;
begin
  select * into p from parks where id = park for update;
  if value is null or field in ('obstacle', 'other') then
    return null;
  end if;

  case field
  when 'status' then
    old_value := jsonb_build_object('status', p.status);
    update parks set status = (value ->> 'status')::park_status where id = park;
  when 'lighting' then
    old_value := jsonb_build_object('night_lighting', p.night_lighting);
    update parks set night_lighting = (value ->> 'night_lighting')::boolean where id = park;
  when 'fees' then
    old_value := jsonb_build_object('is_paid', p.is_paid, 'entry_fee', p.entry_fee);
    update parks
       set is_paid = coalesce((value ->> 'is_paid')::boolean, is_paid),
           entry_fee = case when value ? 'entry_fee' then nullif(btrim(value ->> 'entry_fee'), '') else entry_fee end
     where id = park;
  when 'helmet_rule' then
    old_value := jsonb_build_object('helmet_required', p.helmet_required);
    update parks set helmet_required = (value ->> 'helmet_required')::boolean where id = park;
  when 'location' then
    old_value := jsonb_build_object('address', p.address, 'latitude', p.latitude, 'longitude', p.longitude);
    if value ? 'latitude' and value ? 'longitude' then
      if abs((value ->> 'latitude')::float8) > 90 or abs((value ->> 'longitude')::float8) > 180 then
        raise exception 'bad_coordinates' using errcode = '22023';
      end if;
    end if;
    update parks
       set address = case when value ? 'address' then nullif(btrim(value ->> 'address'), '') else address end,
           location = case when value ? 'latitude' and value ? 'longitude'
                           then st_setsrid(st_makepoint((value ->> 'longitude')::float8, (value ->> 'latitude')::float8), 4326)::geography
                           else location end
     where id = park;
  when 'description' then
    select jsonb_build_object('body', d.body, 'locale', d.locale) into old_value
      from park_descriptions d where d.park_id = park and d.locale = coalesce(value ->> 'locale', 'en');
    if nullif(btrim(value ->> 'body'), '') is null or char_length(value ->> 'body') > 2000 then
      raise exception 'bad_description' using errcode = '22023';
    end if;
    insert into park_descriptions (park_id, locale, body, source, author_id, updated_at)
    values (park, coalesce(value ->> 'locale', 'en'), btrim(value ->> 'body'), 'author', editor, now())
    on conflict (park_id, locale) do update
      set body = excluded.body, source = 'author', author_id = excluded.author_id, updated_at = now();
  when 'hours', 'disciplines' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'park_id' order by x.id), '[]'::jsonb) into old_value
      from park_sessions x where x.park_id = park;
    -- The general sessions' disciplines: the widest all-year set.
    select x.disciplines into general from park_sessions x
     where x.park_id = park and x.season_start_month is null
     order by cardinality(x.disciplines) desc limit 1;

    if field = 'disciplines' then
      if jsonb_typeof(value -> 'disciplines') <> 'array' or jsonb_array_length(value -> 'disciplines') = 0 then
        raise exception 'bad_disciplines' using errcode = '22023';
      end if;
      update park_sessions x
         set disciplines = array(select jsonb_array_elements_text(value -> 'disciplines'))::discipline[]
       where x.park_id = park and x.season_start_month is null
         and (general is null or x.disciplines = general);
      if not found then
        insert into park_sessions (park_id, disciplines, note)
        values (park, array(select jsonb_array_elements_text(value -> 'disciplines'))::discipline[], 'Hours not listed');
      end if;
    else
      want_days := array(select jsonb_array_elements_text(value -> 'days'))::smallint[];
      if cardinality(want_days) = 0 or exists (select 1 from unnest(want_days) d where d < 1 or d > 7) then
        raise exception 'bad_days' using errcode = '22023';
      end if;
      if value ->> 'start' = 'sunrise' then start_anchor := 'sunrise';
      else start_anchor := 'clock'; start_time := (value ->> 'start')::time; end if;
      if value ->> 'end' = 'sunset' then end_anchor := 'sunset';
      else end_anchor := 'clock'; end_time := (value ->> 'end')::time; end if;

      -- Take those days out of the general sessions, then add the new one.
      for s in
        select * from park_sessions x
         where x.park_id = park and x.season_start_month is null
           and (general is null or x.disciplines = general)
           and x.days && want_days
      loop
        if s.days <@ want_days then
          delete from park_sessions where id = s.id;
        else
          update park_sessions
             set days = array(select d from unnest(s.days) d where d <> all (want_days) order by d)
           where id = s.id;
        end if;
      end loop;
      insert into park_sessions (park_id, days, start_anchor, start_time, end_anchor, end_time, disciplines)
      values (park, array(select distinct d from unnest(want_days) d order by d), start_anchor, start_time,
              end_anchor, end_time, coalesce(general, array['inline', 'quad', 'skateboard']::discipline[]));
    end if;
  end case;

  insert into park_edits (park_id, editor_id, field, old_value, new_value, info_report_id)
  values (park, editor, field::text, old_value, new_value, report);
  return new_value;
end;
$$;

-- Approve (and apply) or decline a park info report. `value` replaces the
-- reporter's suggestion when the reviewer changed it. Approving tells the
-- reporter their fix is live; declining tells nobody.
create or replace function public.review_park_info(
  report uuid,
  approve boolean,
  value jsonb default null,
  mark_verified boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r park_info_reports%rowtype;
  applied jsonb;
begin
  select * into r from park_info_reports where id = report for update;
  if r.id is null or me is null or not private.can_contribute_park(r.park_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'open' then
    raise exception 'already_reviewed' using errcode = '22023';
  end if;

  if approve then
    applied := private.apply_park_field(r.park_id, r.field, coalesce(value, r.suggested_value), r.id, me);
    update park_info_reports
       set status = 'accepted', reviewed_by = me, reviewed_at = now(), applied_value = applied
     where id = r.id;
    if mark_verified then
      perform public.set_park_verified(r.park_id);
    end if;
    if r.reporter_id <> me and exists (select 1 from profiles where id = r.reporter_id and deleted_at is null) then
      insert into notifications (recipient_id, kind, park_id) values (r.reporter_id, 'park_report_accepted', r.park_id);
    end if;
  else
    update park_info_reports set status = 'rejected', reviewed_by = me, reviewed_at = now() where id = r.id;
  end if;

  insert into moderation_actions (actor_id, action, target_user_id, park_id, obstacle_id, park_info_report_id)
  values (me, case when approve then 'park_info_approved' else 'park_info_declined' end,
          r.reporter_id, r.park_id, r.obstacle_id, r.id);
end;
$$;

-- Marks a park's info as checked today. Park and city admins.
create or replace function public.set_park_verified(park uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  before timestamptz;
begin
  if me is null or not private.can_moderate_park(park) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select verified_at into before from parks where id = park;
  update parks set verified_at = now(), verified_by = me where id = park;
  insert into park_edits (park_id, editor_id, field, old_value, new_value)
  values (park, me, 'verified_at', to_jsonb(before), to_jsonb(now()));
  insert into moderation_actions (actor_id, action, park_id) values (me, 'park_verified', park);
end;
$$;

-- A suggested obstacle:
--   approve  it joins the park's list (name and type as given), with its own
--            feed; everyone sees the tag. Park contributors can approve.
--   merge    its tags move to `merge_into`, an obstacle the park already has.
--   decline  posts keep their tag as the obstacle's type.
-- Merging and declining archive the suggestion, so they're for park admins.
create or replace function public.review_obstacle(
  obstacle uuid,
  decision text,
  name text default null,
  general_type public.obstacle_type default null,
  merge_into uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  o obstacles%rowtype;
  target obstacles%rowtype;
  clean text := nullif(btrim(coalesce(name, '')), '');
begin
  select * into o from obstacles where id = obstacle for update;
  if o.id is null or me is null or not private.can_contribute_park(o.park_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if o.status <> 'pending' then
    raise exception 'already_reviewed' using errcode = '22023';
  end if;

  if decision = 'approve' then
    if clean is not null and char_length(clean) > 60 then
      raise exception 'name_too_long' using errcode = '22023';
    end if;
    if coalesce(general_type, o.general_type) = 'street_plaza' then
      raise exception 'street_plaza_is_a_placeholder' using errcode = '22023';
    end if;
    update obstacles
       set status = 'active', approved_by = me,
           name = coalesce(clean, obstacles.name),
           general_type = coalesce(review_obstacle.general_type, obstacles.general_type)
     where id = o.id;
    insert into moderation_actions (actor_id, action, target_user_id, park_id, obstacle_id)
    values (me, 'obstacle_approved', o.suggested_by, o.park_id, o.id);
  elsif decision = 'merge' then
    if not private.can_moderate_park(o.park_id) then
      raise exception 'park_admins_merge' using errcode = '42501';
    end if;
    select * into target from obstacles where id = merge_into;
    if target.id is null or target.id = o.id or target.park_id <> o.park_id
       or target.status <> 'active' or target.general_type = 'street_plaza' then
      raise exception 'pick_an_obstacle_at_this_park' using errcode = '22023';
    end if;
    update post_slides set obstacle_id = target.id where obstacle_id = o.id;
    update obstacles set status = 'archived', merged_into = target.id where id = o.id;
    insert into moderation_actions (actor_id, action, target_user_id, park_id, obstacle_id)
    values (me, 'obstacle_merged', o.suggested_by, o.park_id, o.id);
  elsif decision = 'decline' then
    if not private.can_moderate_park(o.park_id) then
      raise exception 'park_admins_decline' using errcode = '42501';
    end if;
    update post_slides
       set obstacle_id = null, obstacle_type = coalesce(obstacle_type, o.general_type)
     where obstacle_id = o.id;
    update obstacles set status = 'archived' where id = o.id;
    insert into moderation_actions (actor_id, action, target_user_id, park_id, obstacle_id)
    values (me, 'obstacle_declined', o.suggested_by, o.park_id, o.id);
  else
    raise exception 'unknown_decision' using errcode = '22023';
  end if;
end;
$$;

-- Tag counts for a suggested obstacle ("2 slides in 1 post"), and the park's
-- obstacles it could merge into. For the detail pane.
create or replace function public.obstacle_review_detail(obstacle uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  o obstacles%rowtype;
begin
  select * into o from obstacles where id = obstacle;
  if o.id is null or not private.can_contribute_park(o.park_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', o.id, 'name', o.name, 'general_type', o.general_type, 'status', o.status, 'notes', o.notes,
    'created_at', o.created_at,
    'suggested_by', (select username::text from profiles where id = o.suggested_by),
    'park', (select jsonb_build_object('id', pk.id, 'name', pk.display_name, 'slug', pk.slug) from parks pk where pk.id = o.park_id),
    'slide_count', (select count(*) from post_slides s where s.obstacle_id = o.id),
    'post_count', (select count(distinct s.post_id) from post_slides s where s.obstacle_id = o.id),
    'can_merge', private.can_moderate_park(o.park_id),
    'merge_options', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'general_type', x.general_type)
                                                 order by x.name), '[]'::jsonb)
                        from obstacles x
                       where x.park_id = o.park_id and x.status = 'active' and x.id <> o.id),
    'has_street_plaza', exists (select 1 from obstacles x where x.park_id = o.park_id and x.status = 'active'
                                and x.general_type = 'street_plaza')
  );
end;
$$;

-- A park info report with what the park lists now, for the detail pane.
create or replace function public.park_info_review_detail(report uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r park_info_reports%rowtype;
  p parks%rowtype;
begin
  select * into r from park_info_reports where id = report;
  if r.id is null or not private.can_contribute_park(r.park_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into p from parks where id = r.park_id;
  return jsonb_build_object(
    'id', r.id, 'field', r.field, 'status', r.status, 'suggested', r.suggested_value, 'note', r.note,
    'photo_path', r.photo_path, 'created_at', r.created_at,
    'reporter', (select username::text from profiles where id = r.reporter_id),
    'obstacle', (select jsonb_build_object('id', o.id, 'name', o.name, 'general_type', o.general_type)
                   from obstacles o where o.id = r.obstacle_id),
    'park', jsonb_build_object('id', p.id, 'name', p.display_name, 'slug', p.slug, 'verified_at', p.verified_at,
                               'can_verify', private.can_moderate_park(p.id)),
    'current', case r.field
      when 'status' then jsonb_build_object('status', p.status)
      when 'lighting' then jsonb_build_object('night_lighting', p.night_lighting)
      when 'fees' then jsonb_build_object('is_paid', p.is_paid, 'entry_fee', p.entry_fee)
      when 'helmet_rule' then jsonb_build_object('helmet_required', p.helmet_required)
      when 'location' then jsonb_build_object('address', p.address, 'latitude', p.latitude, 'longitude', p.longitude)
      when 'description' then (select jsonb_build_object('body', d.body, 'locale', d.locale)
                                 from park_descriptions d where d.park_id = p.id and d.locale = 'en')
      when 'hours' then (select coalesce(jsonb_agg(jsonb_build_object(
                           'days', x.days, 'start_anchor', x.start_anchor, 'start_time', x.start_time,
                           'end_anchor', x.end_anchor, 'end_time', x.end_time, 'disciplines', x.disciplines,
                           'season_start_month', x.season_start_month, 'note', x.note) order by x.id), '[]'::jsonb)
                           from park_sessions x where x.park_id = p.id)
      when 'disciplines' then (select coalesce(jsonb_agg(distinct d), '[]'::jsonb)
                                 from park_sessions x, unnest(x.disciplines) d
                                where x.park_id = p.id and x.season_start_month is null)
      else null end
  );
end;
$$;

/* 7. Members' own side -------------------------------------------------------------- */

-- The signed-in member's suspension or ban, with the reason they were given.
create or replace function public.my_restriction()
returns table (suspended_until timestamptz, banned boolean, message text)
language sql
stable
security definer
set search_path = public
as $$
  select case when p.suspended_until > now() then p.suspended_until end,
         p.banned_at is not null,
         case when p.banned_at is not null or p.suspended_until > now() then (
           select a.message from moderation_actions a
            where a.target_user_id = p.id and a.action in ('suspend', 'ban')
            order by a.created_at desc limit 1)
         end
    from profiles p
   where p.id = auth.uid();
$$;

-- Same as before, plus: park fixes going live (park_fix_live), moderation
-- notices (post_removed, comment_removed, warning, suspension; the moderator's
-- message comes in comment_body) and role_vacated (the role ended comes in
-- comment_body, the park in park_slug and park_name).
create or replace function public.my_notifications()
returns table(id text, kind text, created_at timestamp with time zone, actors jsonb, actor_count integer, post_id uuid, comment_id uuid, comment_body text, park_slug text, park_name text, metro_name text, unread boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  seen timestamptz;
  my_metro uuid;
  joined timestamptz;
begin
  if me is null then
    return;
  end if;
  select pr.home_metro_area_id, pr.joined_at into my_metro, joined
    from profiles pr where pr.id = me;
  select ns.seen_at into seen from private.notifications_seen ns where ns.user_id = me;

  return query
  with mine as (
    select n.*,
           c.body,
           c.parent_id,
           c.reply_to_user_id,
           (select author_id from comments where comments.id = c.parent_id) as thread_author,
           p.author_id as post_author,
           a.username::text as actor_username,
           a.avatar_path as actor_avatar
      from notifications n
      left join comments c on c.id = n.comment_id
      left join posts p on p.id = n.post_id
      left join profiles a on a.id = n.actor_id
     where n.recipient_id = me
       and n.kind in ('comment', 'tag', 'filmer_credit', 'invite_used')
       and (n.post_id is null or private.can_see_post(n.post_id))
       and (n.comment_id is null or c.deleted_at is null)
       and (n.actor_id is null or not private.blocked_between(n.actor_id))
       and (a.id is null or a.deleted_at is null)
  ),
  typed as (
    select m.*,
           case
             when m.kind <> 'comment' then m.kind::text
             when m.reply_to_user_id = me or m.thread_author = me then 'reply'
             when m.post_author = me then 'comment'
             else 'mention'
           end as shown_kind
      from mine m
  ),
  grouped as (
    select 'c:' || t.post_id::text as gid,
           'comment'::text as gkind,
           max(t.created_at) as at,
           (select jsonb_agg(jsonb_build_object('id', x.actor_id, 'username', x.actor_username, 'avatar_path', x.actor_avatar)
                             order by x.at desc)
              from (select t2.actor_id, max(t2.actor_username) as actor_username, max(t2.actor_avatar) as actor_avatar,
                           max(t2.created_at) as at
                      from typed t2
                     where t2.shown_kind = 'comment' and t2.post_id = t.post_id
                     group by t2.actor_id
                     order by max(t2.created_at) desc
                     limit 2) x) as people,
           count(distinct t.actor_id)::integer as people_count,
           t.post_id as gpost,
           (array_agg(t.comment_id order by t.created_at desc))[1] as gcomment,
           (array_agg(t.body order by t.created_at desc))[1] as gbody
      from typed t
     where t.shown_kind = 'comment'
     group by t.post_id
    union all
    select t.id::text,
           t.shown_kind,
           t.created_at,
           case when t.actor_id is null then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('id', t.actor_id, 'username', t.actor_username, 'avatar_path', t.actor_avatar))
           end,
           case when t.actor_id is null then 0 else 1 end,
           t.post_id,
           t.comment_id,
           t.body
      from typed t
     where t.shown_kind <> 'comment'
  ),
  hellos as (
    select 'a:' || an.id::text as gid,
           case when an.kind = 'visiting' then 'visiting' else 'someone_new' end::text as gkind,
           an.created_at as at,
           jsonb_build_array(jsonb_build_object('id', u.id, 'username', u.username::text, 'avatar_path', u.avatar_path)) as people,
           1 as people_count,
           an.park_id as park,
           ma.name::text as metro
      from announcements an
      join profiles u on u.id = an.user_id
      left join metro_areas ma on ma.id = an.metro_area_id
     where my_metro is not null
       and an.metro_area_id = my_metro
       and an.user_id <> me
       and an.created_at >= joined
       and u.deleted_at is null
       and u.banned_at is null
       and not private.blocked_between(an.user_id)
  ),
  -- Park fixes going live, moderation notices and vacated roles.
  notices as (
    select 'n:' || n.id::text as gid,
           case n.kind when 'park_report_accepted' then 'park_fix_live' else n.kind::text end as gkind,
           n.created_at as at,
           case when n.kind = 'role_vacated' and a.id is not null and a.deleted_at is null
                then jsonb_build_array(jsonb_build_object('id', a.id, 'username', a.username::text, 'avatar_path', a.avatar_path))
                else '[]'::jsonb end as people,
           case when n.kind = 'role_vacated' and a.id is not null and a.deleted_at is null then 1 else 0 end as people_count,
           -- Removed posts stay readable to their author, so the row can open them.
           n.post_id as gpost,
           n.message as gbody,
           n.park_id as park
      from notifications n
      left join profiles a on a.id = n.actor_id
     where n.recipient_id = me
       and n.kind in ('park_report_accepted', 'post_removed', 'comment_removed', 'warning', 'suspension', 'role_vacated')
  )
  select g.gid, g.gkind, g.at, coalesce(g.people, '[]'::jsonb), g.people_count, g.gpost, g.gcomment,
         left(g.gbody, 140), null::text, null::text, null::text,
         seen is null or g.at > seen
    from grouped g
  union all
  select h.gid, h.gkind, h.at, h.people, h.people_count, null::uuid, null::uuid, null::text,
         pk.slug::text, pk.display_name::text, h.metro,
         seen is null or h.at > seen
    from hellos h
    left join parks pk on pk.id = h.park
  union all
  select x.gid, x.gkind, x.at, x.people, x.people_count, x.gpost, null::uuid, x.gbody,
         pk.slug::text, pk.display_name::text, null::text,
         seen is null or x.at > seen
    from notices x
    left join parks pk on pk.id = x.park
  order by 3 desc
  limit 100;
end $function$;

-- Deletes the signed-in member's account (the database side; the
-- `delete-account` Edge Function then removes their files and sign-in).
-- Needs a sign-in code entered in the last 15 minutes, so a phone left
-- unlocked can't do it.
--   keep_posts true (the default): posts, comments and park photos stay up,
--   shown as "deleted user". false: they're removed for everyone.
-- Either way: tags and filmer credits on other people's posts stay as
-- "deleted user"; roles end and the next role up is told; unused invite
-- links are cancelled; invitees keep their accounts.
create or replace function public.delete_my_account(keep_posts boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  last_code timestamptz;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if exists (select 1 from profiles where id = me and deleted_at is not null) then
    return;
  end if;

  select max(to_timestamp((m ->> 'timestamp')::double precision)) into last_code
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
   where m ->> 'method' = 'otp';
  if last_code is null or last_code < now() - interval '15 minutes' then
    raise exception 'confirm_with_a_code' using errcode = '42501';
  end if;

  perform private.end_roles(me, 'account_deleted', me);

  update invites set cancelled_at = now()
   where inviter_id = me and used_by is null and cancelled_at is null and returned_at is null;

  if keep_posts then
    update posts set anonymized = true where author_id = me;
    update park_photos set photographer = ''
     where uploaded_by = me and photographer = (select username::text from profiles where id = me);
  else
    update posts set status = 'deleted' where author_id = me and status <> 'deleted';
    update comments set deleted_at = now() where author_id = me and deleted_at is null;
    update park_photos set archived_at = now() where uploaded_by = me and archived_at is null;
  end if;

  delete from likes where user_id = me;
  delete from follows where follower_id = me or followee_id = me;
  delete from saved_parks where user_id = me;
  delete from blocks where blocker_id = me;
  delete from park_regulars where user_id = me;
  delete from notifications where recipient_id = me;
  delete from announcements where user_id = me;
  delete from reserved_usernames where user_id = me;
  delete from admin_seen where user_id = me;
  delete from private.push_devices where user_id = me;
  delete from private.push_settings where user_id = me;
  delete from private.push_outbox where recipient_id = me;

  update profiles
     set deleted_at = now(), username = null, avatar_path = null, bio = null,
         home_metro_area_id = null, home_park_id = null, disciplines = '{}',
         open_to_meetup = false, hide_from_regulars = true, is_private = true
   where id = me;
end;
$$;

-- Everything Grindylocks stores about the signed-in member, as JSON, for
-- "Get a copy of my data". At most once a day; the `export-data` Edge Function
-- emails it.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or exists (select 1 from profiles where id = me and deleted_at is not null) then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if exists (select 1 from private.data_exports where user_id = me and created_at > now() - interval '1 day') then
    raise exception 'export_once_a_day' using errcode = '54000';
  end if;
  insert into private.data_exports (user_id) values (me);

  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                  from auth.users u where u.id = me),
    'profile', (select to_jsonb(p) from profiles p where p.id = me),
    'posts', (select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
                 'slides', (select coalesce(jsonb_agg(to_jsonb(s) order by s.position), '[]'::jsonb)
                              from post_slides s where s.post_id = p.id)) order by p.created_at), '[]'::jsonb)
                from posts p where p.author_id = me),
    'comments', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb) from comments c where c.author_id = me),
    'likes', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at), '[]'::jsonb) from likes l where l.user_id = me),
    'following', (select coalesce(jsonb_agg(jsonb_build_object('username', u.username, 'status', f.status, 'since', f.created_at)), '[]'::jsonb)
                    from follows f join profiles u on u.id = f.followee_id where f.follower_id = me),
    'followers', (select coalesce(jsonb_agg(jsonb_build_object('username', u.username, 'status', f.status, 'since', f.created_at)), '[]'::jsonb)
                    from follows f join profiles u on u.id = f.follower_id where f.followee_id = me),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('username', u.username, 'since', b.created_at)), '[]'::jsonb)
                  from blocks b join profiles u on u.id = b.blocked_id where b.blocker_id = me),
    'saved_parks', (select coalesce(jsonb_agg(jsonb_build_object('park', pk.display_name, 'saved_at', s.created_at)), '[]'::jsonb)
                      from saved_parks s join parks pk on pk.id = s.park_id where s.user_id = me),
    'tagged_in', (select coalesce(jsonb_agg(jsonb_build_object('post_id', s.post_id, 'tagged_at', t.created_at)), '[]'::jsonb)
                    from slide_people_tags t join post_slides s on s.id = t.slide_id where t.user_id = me),
    'filmed', (select coalesce(jsonb_agg(jsonb_build_object('post_id', s.post_id)), '[]'::jsonb)
                 from post_slides s where s.filmer_id = me),
    'park_photos', (select coalesce(jsonb_agg(to_jsonb(ph)), '[]'::jsonb) from park_photos ph where ph.uploaded_by = me),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('created_at', i.created_at, 'used_at', i.used_at,
                                  'cancelled_at', i.cancelled_at)), '[]'::jsonb) from invites i where i.inviter_id = me),
    'reports_filed', (select coalesce(jsonb_agg(jsonb_build_object('reason', r.reason, 'details', r.details,
                        'status', r.status, 'created_at', r.created_at)), '[]'::jsonb) from reports r where r.reporter_id = me),
    'park_info_reports', (select coalesce(jsonb_agg(jsonb_build_object('field', r.field, 'suggested', r.suggested_value,
                            'note', r.note, 'status', r.status, 'created_at', r.created_at)), '[]'::jsonb)
                            from park_info_reports r where r.reporter_id = me),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('role', ra.role, 'since', ra.accepted_at, 'ended_at', ra.ended_at)), '[]'::jsonb)
                from role_assignments ra where ra.user_id = me),
    'moderation', (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'message', a.message,
                     'suspended_until', a.suspended_until, 'at', a.created_at)), '[]'::jsonb)
                     from moderation_actions a
                    where a.target_user_id = me and a.action in ('keep_hidden', 'warn', 'suspend', 'ban')),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'at', n.created_at)), '[]'::jsonb)
                        from notifications n where n.recipient_id = me),
    'push_settings', (select to_jsonb(s) - 'user_id' from private.push_settings s where s.user_id = me),
    'push_devices', (select count(*) from private.push_devices d where d.user_id = me)
  );
end;
$$;

/* Grants ------------------------------------------------------------------------- */

revoke all on function private.role_rank(uuid) from public, anon, authenticated;
revoke all on function private.can_review_report(public.reports) from public, anon, authenticated;
revoke all on function private.reports_for(text, uuid) from public, anon, authenticated;
revoke all on function private.end_roles(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.hide_target(text, uuid) from public, anon, authenticated;
revoke all on function private.apply_park_field(uuid, public.park_field, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function private.report_photo_park(text) to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.file_report(uuid, uuid, uuid, public.report_reason, text)',
    'public.report_park_info(uuid, public.park_field, uuid, jsonb, text, text)',
    'public.moderation_queue(uuid)',
    'public.moderation_report_detail(text, uuid)',
    'public.moderate_reports(text, uuid, text, text, integer, boolean)',
    'public.review_park_info(uuid, boolean, jsonb, boolean)',
    'public.set_park_verified(uuid)',
    'public.review_obstacle(uuid, text, text, public.obstacle_type, uuid)',
    'public.obstacle_review_detail(uuid)',
    'public.park_info_review_detail(uuid)',
    'public.my_restriction()',
    'public.delete_my_account(boolean)',
    'public.export_my_data()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;


create temp table results (check_name text, ok boolean, detail text) on commit drop;
create temp table ids (name text primary key, id uuid) on commit drop;
create temp table nums (name text primary key, n bigint) on commit drop;
grant all on results, ids, nums to anon, authenticated;

create function pg_temp.id(n text) returns uuid language sql stable as $$ select id from ids where name = n $$;
grant execute on function pg_temp.id(text) to anon, authenticated;

-- Signs in as a test person. With code => true the token says they entered a
-- sign-in code a minute ago (what delete_my_account() asks for).
create function pg_temp.who(n text, code boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', (select id from ids where name = n), 'role', 'authenticated',
    'amr', case when code then json_build_array(json_build_object('method', 'otp', 'timestamp', extract(epoch from now()) - 60))
                else json_build_array(json_build_object('method', 'otp', 'timestamp', extract(epoch from now()) - 7200)) end
  )::text, true)
$$;

create function pg_temp.check(name text, ok boolean, detail text default '') returns void language sql as $$
  insert into results values (name, coalesce(ok, false), detail)
$$;
grant execute on function pg_temp.check(text, boolean, text) to anon, authenticated;

-- Runs a statement and records whether it failed with the expected message.
create function pg_temp.refuses(name text, stmt text, expect text) returns void language plpgsql as $$
begin
  execute stmt;
  insert into results values (name, false, 'accepted');
exception when others then
  insert into results values (name, sqlerrm like '%' || expect || '%', sqlerrm);
end $$;
grant execute on function pg_temp.refuses(text, text, text) to anon, authenticated;

/* Fixtures (as the database owner) ------------------------------------------------- */

do $$
declare
  park_p uuid; metro_m uuid; park_q uuid; metro_q uuid;
  n text;
begin
  -- A park with obstacles, in a metro area with another park; and a park elsewhere.
  select p.id, p.metro_area_id into park_p, metro_m from parks p
   where exists (select 1 from obstacles o where o.park_id = p.id and o.status = 'active' and o.general_type <> 'street_plaza')
     and exists (select 1 from park_sessions s where s.park_id = p.id and s.season_start_month is null)
   order by p.slug limit 1;
  select p.id, p.metro_area_id into park_q, metro_q from parks p where p.metro_area_id <> metro_m order by p.slug limit 1;
  insert into ids values ('park_p', park_p), ('metro_m', metro_m), ('park_q', park_q), ('metro_q', metro_q);
  insert into ids select 'owner', user_id from role_assignments
   where role = 'owner' and accepted_at is not null and ended_at is null limit 1;
  insert into ids select 'active_obstacle', o.id from obstacles o
   where o.park_id = park_p and o.status = 'active' and o.general_type <> 'street_plaza' order by o.name limit 1;

  foreach n in array array['alice', 'bob', 'cara', 'dan', 'cam', 'pat', 'con', 'eve'] loop
    insert into ids values (n, gen_random_uuid());
    insert into profiles (id, username, onboarded_at, age_confirmed_at, home_metro_area_id, disciplines)
    values ((select id from ids where name = n), 'zz_mod_' || n, now(), now(),
            case when n = 'eve' then metro_q else metro_m end, '{inline}');
  end loop;

  insert into role_assignments (user_id, role, metro_area_id, accepted_at)
  values ((select id from ids where name = 'cam'), 'city_admin', metro_m, now());
  insert into role_assignments (user_id, role, park_id, accepted_at)
  values ((select id from ids where name = 'pat'), 'park_admin', park_p, now()),
         ((select id from ids where name = 'con'), 'park_contributor', park_p, now());

  -- Posts: alice x2 and con x1 at park P, eve x1 at park Q.
  foreach n in array array['alice_post', 'alice_post2', 'con_post', 'eve_post'] loop
    insert into ids values (n, gen_random_uuid());
    insert into posts (id, author_id, park_id, caption, slide_count, published_at)
    values ((select id from ids where name = n),
            (select id from ids where name = split_part(n, '_', 1)),
            case when n = 'eve_post' then park_q else park_p end,
            'zz test ' || n, 1, now());
  end loop;
  insert into ids values ('alice_slide', gen_random_uuid());
  insert into post_slides (id, post_id, position, kind, storage_path, width, height, upload_status)
  values ((select id from ids where name = 'alice_slide'), (select id from ids where name = 'alice_post2'), 0, 'photo',
          'zz/none.jpg', 1080, 1350, 'ready');

  insert into invites (code, inviter_id) values ('ZZMODPAT', (select id from ids where name = 'pat'));
  insert into follows (follower_id, followee_id) values ((select id from ids where name = 'con'), (select id from ids where name = 'alice'));
end $$;

-- dan comments on alice's post.
select pg_temp.who('dan');
set local role authenticated;
insert into comments (post_id, author_id, body) values (pg_temp.id('alice_post'), pg_temp.id('dan'), 'zz rude comment');
reset role;
insert into ids select 'dan_comment', id from comments where author_id = pg_temp.id('dan');

/* Signed out ------------------------------------------------------------------------ */

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.refuses('anon cannot read the queue', 'select * from public.moderation_queue()', 'permission denied');
select pg_temp.refuses('anon cannot report', $$select public.file_report(post => gen_random_uuid(), reason => 'spam')$$, 'permission denied');
reset role;

/* Reporting --------------------------------------------------------------------------- */

select pg_temp.who('bob'); set local role authenticated;
select public.file_report(post => pg_temp.id('alice_post'), reason => 'spam', details => '  ad  ');
select public.file_report(post => pg_temp.id('alice_post'), reason => 'spam');
select pg_temp.check('a repeat report is quiet and adds nothing',
  (select count(*) from reports where post_id = pg_temp.id('alice_post')) = 1);
select pg_temp.check('details are trimmed',
  (select details from reports where post_id = pg_temp.id('alice_post')) = 'ad');
select pg_temp.refuses('one thing per report',
  format($$select public.file_report(post => %L, person => %L)$$, pg_temp.id('alice_post'), pg_temp.id('alice')), 'report_one_thing');
select pg_temp.refuses('not at this park is only for posts',
  format($$select public.file_report(person => %L, reason => 'wrong_park')$$, pg_temp.id('alice')), 'wrong_park_is_for_posts');
select pg_temp.check('members can''t read the moderation log', (select count(*) from moderation_actions) = 0);
reset role;

select pg_temp.who('alice'); set local role authenticated;
select pg_temp.refuses('you can''t report your own post',
  format($$select public.file_report(post => %L, reason => 'spam')$$, pg_temp.id('alice_post')), 'cannot_report_yourself');
reset role;

select pg_temp.who('cara'); set local role authenticated;
select public.file_report(post => pg_temp.id('alice_post'), reason => 'spam');
reset role;
select pg_temp.who('dan'); set local role authenticated;
select public.file_report(post => pg_temp.id('alice_post'), reason => 'wrong_park');
reset role;
select pg_temp.check('three reporters auto-hide the post',
  (select status from posts where id = pg_temp.id('alice_post')) = 'auto_hidden');

select pg_temp.who('bob'); set local role authenticated;
select public.file_report(comment => pg_temp.id('dan_comment'), reason => 'harassment');
select public.file_report(person => pg_temp.id('dan'), reason => 'harassment', details => 'follows people around');
reset role;

/* The queue ----------------------------------------------------------------------------- */

select pg_temp.who('eve'); set local role authenticated;
select pg_temp.check('a member elsewhere has an empty queue', (select count(*) from public.moderation_queue()) = 0);
reset role;

select pg_temp.who('pat'); set local role authenticated;
select pg_temp.check('the park admin sees the post, 3 reports, auto-hidden',
  exists (select 1 from public.moderation_queue() q where q.kind = 'report' and q.id = pg_temp.id('alice_post')
          and q.report_count = 3 and q.state = 'auto_hidden' and q.reason = 'spam'));
select pg_temp.check('harassment reports skip the park admin',
  not exists (select 1 from public.moderation_queue() q where q.id in (pg_temp.id('dan_comment'), pg_temp.id('dan'))));
select pg_temp.check('the metro filter narrows the queue',
  (select count(*) from public.moderation_queue(pg_temp.id('metro_q'))) = 0
  and (select count(*) from public.moderation_queue(pg_temp.id('metro_m'))) > 0);
select pg_temp.check('the detail pane has the post, reports and history',
  (select (d -> 'post' ->> 'id')::uuid = pg_temp.id('alice_post')
      and jsonb_array_length(d -> 'reports') = 3
      and d -> 'person' ->> 'username' = 'zz_mod_alice'
      and (d ->> 'can_escalate')::boolean and not (d ->> 'can_ban')::boolean
     from public.moderation_report_detail('post', pg_temp.id('alice_post')) d));
select pg_temp.refuses('the park admin can''t open a harassment report',
  format($$select public.moderation_report_detail('comment', %L)$$, pg_temp.id('dan_comment')), 'not_found');
select pg_temp.refuses('a warning needs a message',
  format($$select public.moderate_reports('post', %L, 'warn')$$, pg_temp.id('alice_post')), 'message_required');
select pg_temp.refuses('only the owner bans',
  format($$select public.moderate_reports('post', %L, 'ban')$$, pg_temp.id('alice_post')), 'owner_only');
select pg_temp.refuses('suspensions are 1, 7 or 30 days',
  format($$select public.moderate_reports('post', %L, 'suspend', 'x', 3)$$, pg_temp.id('alice_post')), 'suspend_1_7_or_30_days');

-- Dismiss and restore.
select public.moderate_reports('post', pg_temp.id('alice_post'), 'dismiss');
select pg_temp.check('dismissing brings the post back',
  (select status from posts where id = pg_temp.id('alice_post')) = 'visible');
select pg_temp.check('dismissing closes the reports',
  (select bool_and(status = 'dismissed' and action = 'dismiss') from reports where post_id = pg_temp.id('alice_post')));
reset role;
select pg_temp.check('dismissing tells nobody',
  not exists (select 1 from notifications where recipient_id = pg_temp.id('alice') and kind = 'post_removed'));

-- Keep hidden.
select pg_temp.who('cara'); set local role authenticated;
select public.file_report(post => pg_temp.id('alice_post'), reason => 'spam');
reset role;
select pg_temp.who('pat'); set local role authenticated;
select public.moderate_reports('post', pg_temp.id('alice_post'), 'keep_hidden', 'Ads go somewhere else.');
reset role;
select pg_temp.check('keeping it hidden hides the post',
  (select status from posts where id = pg_temp.id('alice_post')) = 'hidden');
select pg_temp.who('alice'); set local role authenticated;
select pg_temp.check('the poster is told, with the message',
  exists (select 1 from public.my_notifications() n where n.kind = 'post_removed'
          and n.post_id = pg_temp.id('alice_post') and n.comment_body = 'Ads go somewhere else.'));
select pg_temp.check('the poster can still open their removed post',
  exists (select 1 from posts where id = pg_temp.id('alice_post')));
reset role;
select pg_temp.who('bob'); set local role authenticated;
select pg_temp.refuses('a hidden post can''t be reported',
  format($$select public.file_report(post => %L, reason => 'spam')$$, pg_temp.id('alice_post')), 'not_found');
reset role;

-- City admins don't act on role holders; they escalate.
select pg_temp.who('bob'); set local role authenticated;
select public.file_report(post => pg_temp.id('con_post'), reason => 'spam');
reset role;
select pg_temp.who('cam'); set local role authenticated;
select pg_temp.refuses('a city admin can''t warn a role holder',
  format($$select public.moderate_reports('post', %L, 'warn', 'Careful.')$$, pg_temp.id('con_post')), 'escalate_role_holders');
select public.moderate_reports('post', pg_temp.id('con_post'), 'escalate');
select pg_temp.check('escalated reports leave the city admin''s queue',
  not exists (select 1 from public.moderation_queue() q where q.id = pg_temp.id('con_post')));
select pg_temp.check('city admins can read their own actions in the log',
  exists (select 1 from moderation_actions where action = 'escalate' and post_id = pg_temp.id('con_post')));
reset role;

/* The owner ------------------------------------------------------------------------------ */

select pg_temp.who('owner'); set local role authenticated;
select pg_temp.check('escalated reports reach the owner as Sent to you',
  exists (select 1 from public.moderation_queue() q where q.id = pg_temp.id('con_post') and q.state = 'sent_to_you'));
select pg_temp.check('harassment reports reach the owner as Sent to you',
  exists (select 1 from public.moderation_queue() q where q.id = pg_temp.id('dan_comment') and q.state = 'sent_to_you')
  and exists (select 1 from public.moderation_queue() q where q.id = pg_temp.id('dan') and q.target = 'person'));
select pg_temp.refuses('the owner doesn''t escalate',
  format($$select public.moderate_reports('post', %L, 'escalate')$$, pg_temp.id('con_post')), 'already_with_the_owner');
select public.moderate_reports('post', pg_temp.id('con_post'), 'dismiss');

-- Remove the comment.
select public.moderate_reports('comment', pg_temp.id('dan_comment'), 'keep_hidden', 'Keep it friendly.');
reset role;
select pg_temp.check('a removed comment is deleted',
  (select deleted_at is not null and body = '[deleted]' from comments where id = pg_temp.id('dan_comment')));
select pg_temp.check('its text is kept in the log',
  (select snapshot ->> 'body' = 'zz rude comment' from moderation_actions where comment_id = pg_temp.id('dan_comment')));
select pg_temp.who('dan'); set local role authenticated;
select pg_temp.check('the commenter is told',
  exists (select 1 from public.my_notifications() n where n.kind = 'comment_removed' and n.comment_body = 'Keep it friendly.'));
reset role;

-- Suspend dan for 7 days.
select pg_temp.who('owner'); set local role authenticated;
select pg_temp.refuses('a suspension needs a reason',
  format($$select public.moderate_reports('person', %L, 'suspend', null, 7)$$, pg_temp.id('dan')), 'message_required');
select public.moderate_reports('person', pg_temp.id('dan'), 'suspend', 'Following people around.', 7);
reset role;
select pg_temp.check('suspended for about 7 days',
  (select suspended_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
     from profiles where id = pg_temp.id('dan')));
select pg_temp.who('dan'); set local role authenticated;
select pg_temp.check('they see the suspension and the reason',
  (select r.suspended_until is not null and not r.banned and r.message = 'Following people around.' from public.my_restriction() r));
select pg_temp.check('the suspension notice is in their notifications',
  exists (select 1 from public.my_notifications() n where n.kind = 'suspension'));
select pg_temp.refuses('suspended members can''t comment',
  format($$insert into comments (post_id, author_id, body) values (%L, %L, 'hi')$$, pg_temp.id('alice_post2'), pg_temp.id('dan')),
  'row-level security');
select public.file_report(post => pg_temp.id('alice_post2'), reason => 'other', details => 'still can report');
select pg_temp.check('suspended members can still report',
  exists (select 1 from reports where reporter_id = pg_temp.id('dan') and post_id = pg_temp.id('alice_post2')));
reset role;

-- Ban pat (a park admin): their roles end.
select pg_temp.who('bob'); set local role authenticated;
select public.file_report(person => pg_temp.id('pat'), reason => 'other', details => 'abusing the admin role');
reset role;
select pg_temp.who('owner'); set local role authenticated;
select public.moderate_reports('person', pg_temp.id('pat'), 'ban', 'Abusing the admin role.');
reset role;
select pg_temp.check('a ban sets banned_at', (select banned_at is not null from profiles where id = pg_temp.id('pat')));
select pg_temp.check('a ban ends the person''s roles',
  not exists (select 1 from role_assignments where user_id = pg_temp.id('pat') and ended_at is null)
  and exists (select 1 from role_assignments where user_id = pg_temp.id('pat') and ended_reason = 'banned'));
select pg_temp.check('the ended role is in the role change log',
  exists (select 1 from role_change_log l join role_assignments r on r.id = l.assignment_id
          where r.user_id = pg_temp.id('pat') and l.action = 'ended' and l.details ->> 'reason' = 'banned'));
select pg_temp.check('the city admin is told the park admin spot is open',
  exists (select 1 from notifications where recipient_id = pg_temp.id('cam') and kind = 'role_vacated'
          and actor_id = pg_temp.id('pat') and park_id = pg_temp.id('park_p')));
select pg_temp.check('a ban cancels unused invites',
  (select cancelled_at is not null from invites where code = 'ZZMODPAT'));
select pg_temp.who('pat'); set local role authenticated;
select pg_temp.check('a banned admin''s queue is empty', (select count(*) from public.moderation_queue()) = 0);
select pg_temp.check('they see the ban', (select banned from public.my_restriction()));
reset role;

/* Park info ------------------------------------------------------------------------------- */

select pg_temp.who('bob'); set local role authenticated;
select pg_temp.refuses('a park info report says something',
  format($$select public.report_park_info(%L, 'hours')$$, pg_temp.id('park_p')), 'say_what_is_wrong');
select pg_temp.refuses('obstacle reports name an obstacle',
  format($$select public.report_park_info(%L, 'obstacle', note => 'gone')$$, pg_temp.id('park_p')), 'pick_an_obstacle');
insert into ids select 'info_hours', public.report_park_info(pg_temp.id('park_p'), 'hours',
  suggested => '{"days":[1,2,3,4,5,6,7],"start":"09:00","end":"22:00"}', note => 'New sign by the gate');
insert into ids select 'info_status', public.report_park_info(pg_temp.id('park_p'), 'status',
  suggested => '{"status":"temporarily_closed"}');
reset role;

select pg_temp.who('eve'); set local role authenticated;
select pg_temp.refuses('a member elsewhere can''t review',
  format($$select public.review_park_info(%L, true)$$, pg_temp.id('info_hours')), 'not_found');
reset role;

select pg_temp.who('con'); set local role authenticated;
select pg_temp.check('the contributor sees the park info reports',
  (select count(*) from public.moderation_queue() q where q.kind = 'park_info') >= 2);
select pg_temp.check('the contributor sees no post reports',
  not exists (select 1 from public.moderation_queue() q where q.kind = 'report'));
select pg_temp.check('the detail has what''s listed now',
  (select d -> 'current' is not null and d ->> 'reporter' = 'zz_mod_bob'
     from public.park_info_review_detail(pg_temp.id('info_hours')) d));
select pg_temp.refuses('contributors can''t mark a park verified',
  format($$select public.review_park_info(%L, true, null, true)$$, pg_temp.id('info_hours')), 'not_allowed');
reset role;
insert into nums select 'seasonal', count(*) from park_sessions where park_id = pg_temp.id('park_p') and season_start_month is not null;
select pg_temp.who('con'); set local role authenticated;
select public.review_park_info(pg_temp.id('info_hours'), true);
reset role;
select pg_temp.check('approving applies the hours to every day',
  exists (select 1 from park_sessions where park_id = pg_temp.id('park_p') and days = '{1,2,3,4,5,6,7}'
          and start_anchor = 'clock' and start_time = '09:00' and end_time = '22:00'));
select pg_temp.check('discipline and seasonal sessions stay',
  (select count(*) from park_sessions where park_id = pg_temp.id('park_p') and season_start_month is not null)
  = (select n from nums where name = 'seasonal'));
select pg_temp.check('the change is in the park''s edit history',
  exists (select 1 from park_edits where info_report_id = pg_temp.id('info_hours') and field = 'hours'));
select pg_temp.who('bob'); set local role authenticated;
select pg_temp.check('the reporter is told their fix is live',
  exists (select 1 from public.my_notifications() n where n.kind = 'park_fix_live' and n.park_slug is not null));
reset role;

select pg_temp.who('cam'); set local role authenticated;
select public.review_park_info(pg_temp.id('info_status'), false);
select public.set_park_verified(pg_temp.id('park_p'));
reset role;
select pg_temp.check('declining changes nothing',
  (select status from parks where id = pg_temp.id('park_p')) <> 'temporarily_closed'
  and (select status from park_info_reports where id = pg_temp.id('info_status')) = 'rejected');
select pg_temp.check('a city admin marks the park verified',
  (select verified_at > now() - interval '1 minute' and verified_by = pg_temp.id('cam') from parks where id = pg_temp.id('park_p')));

/* Suggested obstacles ----------------------------------------------------------------------- */

select pg_temp.who('alice'); set local role authenticated;
insert into obstacles (park_id, name, general_type, status, suggested_by)
values (pg_temp.id('park_p'), 'zz long kinked rail', 'rail', 'pending', pg_temp.id('alice')),
       (pg_temp.id('park_p'), 'zz hip', 'hip', 'pending', pg_temp.id('alice')),
       (pg_temp.id('park_p'), 'zz same bowl', 'bowl', 'pending', pg_temp.id('alice'));
reset role;
insert into ids select 'ob_' || split_part(name, ' ', 2), id from obstacles where name like 'zz %' and park_id = pg_temp.id('park_p');
update post_slides set obstacle_id = pg_temp.id('ob_long') where id = pg_temp.id('alice_slide');

select pg_temp.who('con'); set local role authenticated;
select pg_temp.check('the obstacle detail counts tags and lists merge options',
  (select (d ->> 'slide_count')::int = 1 and (d ->> 'post_count')::int = 1 and not (d ->> 'can_merge')::boolean
          and jsonb_array_length(d -> 'merge_options') > 0
     from public.obstacle_review_detail(pg_temp.id('ob_long')) d));
select pg_temp.refuses('contributors don''t decline',
  format($$select public.review_obstacle(%L, 'decline')$$, pg_temp.id('ob_long')), 'park_admins_decline');
select public.review_obstacle(pg_temp.id('ob_hip'), 'approve', ' Hip by the bowl ', 'hip');
reset role;
select pg_temp.check('a contributor approves, with the new name',
  (select status = 'active' and name = 'Hip by the bowl' and approved_by = pg_temp.id('con') from obstacles where id = pg_temp.id('ob_hip')));

select pg_temp.who('cam'); set local role authenticated;
select public.review_obstacle(pg_temp.id('ob_long'), 'decline');
reset role;
select pg_temp.check('declining keeps the tag as the type',
  (select obstacle_id is null and obstacle_type = 'rail' from post_slides where id = pg_temp.id('alice_slide'))
  and (select status from obstacles where id = pg_temp.id('ob_long')) = 'archived');

update post_slides set obstacle_id = pg_temp.id('ob_same'), obstacle_type = null where id = pg_temp.id('alice_slide');
select pg_temp.who('cam'); set local role authenticated;
select pg_temp.refuses('merging needs an obstacle at this park',
  format($$select public.review_obstacle(%L, 'merge', merge_into => %L)$$, pg_temp.id('ob_same'), pg_temp.id('ob_same')),
  'pick_an_obstacle_at_this_park');
select public.review_obstacle(pg_temp.id('ob_same'), 'merge', merge_into => pg_temp.id('active_obstacle'));
reset role;
select pg_temp.check('merging moves the tags',
  (select obstacle_id = pg_temp.id('active_obstacle') from post_slides where id = pg_temp.id('alice_slide'))
  and (select status = 'archived' and merged_into = pg_temp.id('active_obstacle') from obstacles where id = pg_temp.id('ob_same')));

/* Deleting an account ------------------------------------------------------------------------- */

select pg_temp.who('con'); set local role authenticated;
select pg_temp.refuses('deleting needs a fresh sign-in code', 'select public.delete_my_account(false)', 'confirm_with_a_code');
reset role;
select pg_temp.who('con', true); set local role authenticated;
select public.delete_my_account(false);
select public.delete_my_account(false);
reset role;
select pg_temp.check('the profile is deleted and its name freed',
  (select deleted_at is not null and username is null from profiles where id = pg_temp.id('con')));
select pg_temp.check('delete them: their posts are deleted',
  (select status from posts where id = pg_temp.id('con_post')) = 'deleted');
select pg_temp.check('their roles end',
  not exists (select 1 from role_assignments where user_id = pg_temp.id('con') and ended_at is null)
  and exists (select 1 from role_assignments where user_id = pg_temp.id('con') and ended_reason = 'account_deleted'));
select pg_temp.check('the next role up is told (the city admin, with no park admin left)',
  exists (select 1 from notifications where recipient_id = pg_temp.id('cam') and kind = 'role_vacated' and actor_id = pg_temp.id('con')));
select pg_temp.check('their follows are gone', not exists (select 1 from follows where follower_id = pg_temp.id('con')));

select pg_temp.who('alice', true); set local role authenticated;
select public.delete_my_account();
reset role;
select pg_temp.check('keep them: posts stay up, anonymized',
  (select bool_and(anonymized and status <> 'deleted') from posts where author_id = pg_temp.id('alice')));

/* Data export ------------------------------------------------------------------------------- */

select pg_temp.who('bob'); set local role authenticated;
select pg_temp.check('the export has the member''s data',
  (select d ? 'profile' and d ? 'posts' and jsonb_array_length(d -> 'reports_filed') >= 1 from public.export_my_data() d));
select pg_temp.refuses('one export a day', 'select public.export_my_data()', 'export_once_a_day');
reset role;

/* Results ------------------------------------------------------------------------------------- */

reset role;
do $$
declare r text;
begin
  select json_agg(results)::text into r from results;
  raise exception 'RESULTS %', r;
end $$;
