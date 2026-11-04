-- Rolled-back check for 20261103230100_meetup_changes.sql (apply
-- 20261103230000_meetup_changes_enums.sql first: new enum values can't be used
-- in the transaction that adds them). Runs the migration and the checks in one
-- transaction, then raises an exception carrying the results, so nothing is
-- kept. Every row should have ok = true.
begin;
-- Meetups (v2), PR 5: changes, cancelling, notifications and reports.
-- PRD: Grindylocks — Meetups PRD (Changes, cancelling and deleting;
-- Notifications; Moderation and safety). Decisions: Product Decisions, Nov 3.
-- The functions for editing, cancelling and deleting already exist (PR #40);
-- this adds what happens around them.
--
--  1. Columns: notifications and reports can point at a meetup date, a
--     meetup comment or a series; the moderation log too. event_going gets
--     reminded_at, push_settings a `meetups` switch.
--  2. Invited co-hosts can see the meetup they're invited to (a Followers
--     only meetup was hidden from an invitee who didn't follow the host, so
--     they couldn't reach the accept banner).
--  3. Who hears what (private.notify_meetup() checks blocks, deleted
--     accounts and that the recipient can see the meetup):
--       * a date's day, time or park changing, or a cancellation: everyone
--         going on the dates affected, once per person, naming their first
--         affected date. Edits to the title, note, cover or disciplines say
--         nothing. A time change re-arms Remind me.
--       * Remind me: a job every 5 minutes, so it lands 55–60 minutes before
--         the start. It's in the bell too, and leaves it if the date is
--         cancelled.
--       * the hosts' grouped bell row ("Ana and 3 others are going"): one
--         row per person going, grouped in my_notifications(); it goes away
--         if they stop going before the date ends.
--       * the co-host invite (bell only), cleared once answered.
--       * comments: hosts and co-hosts hear about comments, the person
--         replied to about replies, and anyone @mentioned who can see the
--         meetup about mentions.
--       * park admins hiding a date: its hosts (bell only), with the
--         moderator's note when it came from a report.
--     Pushes: changes, cancellations and reminders under the Meetups switch;
--     comments and replies under Comments; mentions under Mentions. Going,
--     co-host invites and hidden dates are bell only.
--  4. The @ list in meetup comments: meetup_mention_people() suggests only
--     people who can see the meetup.
--  5. Reports on meetups and meetup comments, with the same reasons (but
--     "Not at this park", which is for posts) and routing as posts: the
--     park's admins, then the city admin and the owner; harassment, anything
--     involving a minor and reports about a person go to the owner. The
--     queue, the detail pane and moderate_reports() handle them; keeping a
--     meetup hidden hides that date, a meetup comment is removed.
--  6. hide_meetup(): park admins (and the city admin and owner) hide or
--     unhide a date at their park, logged in moderation_actions.
--
-- Replaced, same signatures: private.can_see_series_as(),
-- private.can_review_report(), private.reports_for(), private.hide_target(),
-- private.enqueue_push_notification(), public.set_push_setting(),
-- public.moderation_queue(), public.moderation_report_detail(),
-- public.moderate_reports(), the reports read and resolve policies.
-- Dropped and created again with new columns or parameters (same grants):
-- public.my_notifications(), public.push_claim(), public.my_push_settings(),
-- public.file_report(). push-send is redeployed with this migration, since
-- push_claim()'s columns change.
--
-- Additive otherwise: columns, indexes, functions, triggers, one cron job.

/* 1. Columns -------------------------------------------------------------------- */

alter table public.notifications
  add column if not exists event_id uuid references public.events (id) on delete cascade,
  add column if not exists event_comment_id uuid references public.event_comments (id) on delete cascade,
  add column if not exists series_id uuid references public.event_series (id) on delete cascade;

create index if not exists notifications_event_idx on public.notifications (event_id) where event_id is not null;
create index if not exists notifications_event_comment_idx on public.notifications (event_comment_id) where event_comment_id is not null;
create index if not exists notifications_series_idx on public.notifications (series_id) where series_id is not null;

-- A report outlives a deleted meetup as a report about its host.
alter table public.reports
  add column if not exists event_id uuid references public.events (id) on delete set null,
  add column if not exists event_comment_id uuid references public.event_comments (id) on delete set null;

create index if not exists reports_event_idx on public.reports (event_id) where event_id is not null;
create index if not exists reports_event_comment_idx on public.reports (event_comment_id) where event_comment_id is not null;

alter table public.moderation_actions
  add column if not exists event_id uuid references public.events (id) on delete set null,
  add column if not exists event_comment_id uuid references public.event_comments (id) on delete set null;

alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check check (action in (
  'dismiss', 'keep_hidden', 'warn', 'suspend', 'escalate', 'ban',
  'park_info_approved', 'park_info_declined',
  'obstacle_approved', 'obstacle_merged', 'obstacle_declined',
  'park_verified',
  'meetup_hidden', 'meetup_unhidden'
));

alter table public.event_going
  add column if not exists reminded_at timestamptz;

alter table private.push_settings
  add column if not exists meetups boolean not null default true;

/* 2. Invited co-hosts can see the meetup ---------------------------------------- */

create or replace function private.can_see_series_as(series uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select viewer is not null and exists (
    select 1 from event_series s
     where s.id = series
       and (
         private.hosts_series(s.id, viewer)
         -- Invited to co-host and not answered yet.
         or exists (select 1 from event_hosts h where h.series_id = s.id and h.user_id = viewer)
         or (
           -- Not blocked with the host or any accepted co-host.
           not exists (
             select 1
               from event_hosts h
               join blocks b on (b.blocker_id = viewer and b.blocked_id = h.user_id)
                             or (b.blocker_id = h.user_id and b.blocked_id = viewer)
              where h.series_id = s.id and (h.role = 'host' or h.accepted_at is not null)
           )
           and (
             s.visibility = 'public'
             or exists (
               select 1
                 from event_hosts h
                 join follows f on f.followee_id = h.user_id and f.follower_id = viewer and f.status = 'accepted'
                where h.series_id = s.id and (h.role = 'host' or h.accepted_at is not null)
             )
           )
         )
       )
  );
$$;

/* 3. Who hears what ------------------------------------------------------------- */

-- Writes one meetup notification, unless it would be to yourself, to a
-- deleted or unfinished account, between blocked people, or about a meetup
-- the recipient can't see.
create or replace function private.notify_meetup(
  recipient uuid,
  what public.notification_kind,
  actor uuid,
  event uuid default null,
  series uuid default null,
  comment uuid default null,
  msg text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if recipient is null or recipient is not distinct from actor then
    return;
  end if;
  if not exists (
    select 1 from profiles where id = recipient and deleted_at is null and onboarded_at is not null
  ) then
    return;
  end if;
  if actor is not null and exists (
    select 1 from blocks
     where (blocker_id = recipient and blocked_id = actor)
        or (blocker_id = actor and blocked_id = recipient)
  ) then
    return;
  end if;
  if event is not null and not private.can_see_event_as(event, recipient) then
    return;
  end if;
  if event is null and series is not null and not private.can_see_series_as(series, recipient) then
    return;
  end if;
  insert into notifications (recipient_id, kind, actor_id, event_id, series_id, event_comment_id, message)
  values (recipient, what, actor, event, series, comment, left(msg, 500));
end $$;

-- Co-host invites: in the invitee's bell until they answer, or the host
-- withdraws it.
create or replace function private.notify_co_host_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.role = 'co_host' and new.accepted_at is null then
      perform private.notify_meetup(new.user_id, 'co_host_invite', new.invited_by, null, new.series_id);
    end if;
    return null;
  end if;
  if tg_op = 'DELETE' or (old.accepted_at is null and new.accepted_at is not null) then
    delete from notifications n
     where n.kind = 'co_host_invite' and n.series_id = old.series_id and n.recipient_id = old.user_id;
  end if;
  return null;
end $$;

drop trigger if exists event_hosts_notify on public.event_hosts;
create trigger event_hosts_notify
  after insert or update or delete on public.event_hosts
  for each row execute function private.notify_co_host_invite();

-- Going: one row per person in each host's bell, grouped there. Saying
-- you're not going (or a host taking you off) before the date ends removes
-- it, and your reminder; after the end, the weekly cleanup of going rows
-- leaves the bell alone.
create or replace function private.notify_meetup_going()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e events;
  h uuid;
begin
  if tg_op = 'INSERT' then
    select * into e from events where id = new.event_id;
    for h in
      select user_id from event_hosts
       where series_id = e.series_id and (role = 'host' or accepted_at is not null)
    loop
      perform private.notify_meetup(h, 'meetup_going', new.user_id, new.event_id);
    end loop;
    return null;
  end if;
  if exists (select 1 from events where id = old.event_id and ends_at > now()) then
    delete from notifications n
     where n.event_id = old.event_id
       and ((n.kind = 'meetup_going' and n.actor_id = old.user_id)
            or (n.kind = 'meetup_reminder' and n.recipient_id = old.user_id));
  end if;
  return null;
end $$;

drop trigger if exists event_going_notify on public.event_going;
create trigger event_going_notify
  after insert or delete on public.event_going
  for each row execute function private.notify_meetup_going();

-- Comments: the hosts, the thread's author, the person replied to and
-- anyone @mentioned, each once. Who sees it as a comment, reply or mention
-- is worked out when the bell and push read it, like post comments.
create or replace function private.notify_meetup_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e events;
  done uuid[] := array[new.author_id];
  person uuid;
begin
  select * into e from events where id = new.event_id;
  for person in
    select candidate
      from (
        select 1 as rank, h.user_id as candidate
          from event_hosts h
         where h.series_id = e.series_id and (h.role = 'host' or h.accepted_at is not null)
        union all
        select 2, (select author_id from event_comments where id = new.parent_id)
        union all
        select 3, new.reply_to_user_id
        union all
        select 4, m.id
          from (
            select distinct p.id
              from regexp_matches(new.body, '@([A-Za-z0-9._]{2,30})', 'g') as r(m)
              join profiles p on lower(p.username::text) = lower(r.m[1])
             limit 10
          ) m
      ) c
     where candidate is not null
     order by rank
  loop
    if not person = any (done) then
      perform private.notify_meetup(person, 'meetup_comment', new.author_id, new.event_id, null, new.id);
      done := done || person;
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists event_comments_notify on public.event_comments;
create trigger event_comments_notify
  after insert on public.event_comments
  for each row execute function private.notify_meetup_comment();

-- A deleted comment takes its notifications with it.
create or replace function private.unnotify_meetup_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from notifications where event_comment_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists event_comments_unnotify on public.event_comments;
create trigger event_comments_unnotify
  after update on public.event_comments
  for each row execute function private.unnotify_meetup_comment();

-- Changes, cancellations and hiding, once per statement so a change to a
-- whole series tells each person once, about their first affected date.
create or replace function private.notify_meetup_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Day, time or park changed on an upcoming date. `message` says what.
  perform private.notify_meetup(f.user_id, 'meetup_changed', auth.uid(), f.id, null, null, f.what)
     from (select distinct on (g.user_id) g.user_id, n.id,
                  concat_ws(',',
                    case when n.starts_at <> o.starts_at or n.ends_at <> o.ends_at then 'time' end,
                    case when n.park_id <> o.park_id then 'park' end) as what
             from new_rows n
             join old_rows o on o.id = n.id
             join event_going g on g.event_id = n.id
            where n.status = 'scheduled' and o.status = 'scheduled' and n.ends_at > now()
              and (n.starts_at <> o.starts_at or n.ends_at <> o.ends_at or n.park_id <> o.park_id)
            order by g.user_id, n.starts_at) f;

  -- A new start time re-arms Remind me.
  delete from notifications x
   using new_rows n join old_rows o on o.id = n.id
   where n.starts_at <> o.starts_at and x.kind = 'meetup_reminder' and x.event_id = n.id;
  update event_going g set reminded_at = null
    from new_rows n join old_rows o on o.id = n.id
   where n.starts_at <> o.starts_at and g.event_id = n.id and g.reminded_at is not null;

  -- Cancelled. `message` is the reason, plus ":series" when one statement
  -- cancelled several dates of the series (ending it).
  perform private.notify_meetup(f.user_id, 'meetup_cancelled', auth.uid(), f.id, null, null, f.reason)
     from (select distinct on (g.user_id) g.user_id, x.id,
                  x.cancel_reason::text || case when x.dates > 1 then ':series' else '' end as reason
             from (select n.id, n.starts_at, n.cancel_reason,
                          count(*) over (partition by n.series_id) as dates
                     from new_rows n
                     join old_rows o on o.id = n.id
                    where o.status = 'scheduled' and n.status = 'cancelled') x
             join event_going g on g.event_id = x.id
            order by g.user_id, x.starts_at) f;
  delete from notifications x
   using new_rows n join old_rows o on o.id = n.id
   where o.status = 'scheduled' and n.status = 'cancelled'
     and x.kind = 'meetup_reminder' and x.event_id = n.id;

  -- Hidden by park admins: its hosts hear about it; unhidden, the row goes.
  perform private.notify_meetup(h.user_id, 'meetup_hidden', null, n.id)
     from new_rows n
     join old_rows o on o.id = n.id
     join event_hosts h on h.series_id = n.series_id and (h.role = 'host' or h.accepted_at is not null)
    where o.hidden_at is null and n.hidden_at is not null;
  delete from notifications x
   using new_rows n join old_rows o on o.id = n.id
   where o.hidden_at is not null and n.hidden_at is null
     and x.kind = 'meetup_hidden' and x.event_id = n.id;

  return null;
end $$;

drop trigger if exists events_notify on public.events;
create trigger events_notify
  after update on public.events
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.notify_meetup_updates();

-- Remind me: every 5 minutes, dates starting within the hour.
create or replace function private.send_meetup_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    update event_going g set reminded_at = now()
      from events e
     where e.id = g.event_id
       and g.remind_me and g.reminded_at is null
       and e.status = 'scheduled' and e.hidden_at is null
       and e.starts_at > now() and e.starts_at <= now() + interval '1 hour'
    returning g.user_id, g.event_id
  loop
    perform private.notify_meetup(r.user_id, 'meetup_reminder', null, r.event_id);
    n := n + 1;
  end loop;
  return n;
end $$;

select cron.schedule('meetups-remind', '*/5 * * * *', 'select private.send_meetup_reminders()');

/* 4. The @ list in meetup comments ---------------------------------------------- */

-- People to suggest after @ in a meetup's comments: hosts, then people who
-- commented, then people you follow, then anyone matching (from 2
-- letters). Only people who can see the meetup, never anyone blocked
-- either way, never yourself. The going list isn't used, since some people
-- go privately.
create or replace function public.meetup_mention_people(event uuid, q text default '')
returns table (id uuid, username citext, avatar_path text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select x.id, x.series_id from events x
     where x.id = meetup_mention_people.event and private.can_see_event(x.id)
  ),
  needle as (
    select lower(btrim(coalesce(q, ''), ' @')) as s
  ),
  pool as (
    select h.user_id as pid, 1 as rank, 'host'::text as why
      from e join event_hosts h on h.series_id = e.series_id and (h.role = 'host' or h.accepted_at is not null)
    union all
    select c.author_id, 2, 'commented'
      from e join event_comments c on c.event_id = e.id and c.deleted_at is null
    union all
    select f.followee_id, 3, 'following'
      from follows f where f.follower_id = auth.uid() and f.status = 'accepted' and exists (select 1 from e)
    union all
    select m.id, 4, 'other'
      from (select p.id from profiles p, needle nd
             where char_length(nd.s) >= 2 and lower(p.username::text) like nd.s || '%'
               and exists (select 1 from e)
             order by p.username limit 50) m
  ),
  best as (
    select distinct on (pl.pid) pl.pid, pl.rank, pl.why from pool pl order by pl.pid, pl.rank
  )
  select p.id, p.username, p.avatar_path, b.why
    from best b
    join profiles p on p.id = b.pid
    cross join needle nd
    cross join e
   where p.id <> auth.uid()
     and p.deleted_at is null and p.onboarded_at is not null and p.banned_at is null
     and (nd.s = '' and b.rank <= 2 or nd.s <> '' and lower(p.username::text) like nd.s || '%')
     and not private.blocked_between(p.id)
     and private.can_see_event_as(e.id, p.id)
   order by b.rank, p.username
   limit 20;
$$;

/* 5. The bell ------------------------------------------------------------------- */

drop function if exists public.my_notifications();

create function public.my_notifications()
returns table(
  id text, kind text, created_at timestamp with time zone, actors jsonb, actor_count integer,
  post_id uuid, comment_id uuid, comment_body text, park_slug text, park_name text, metro_name text,
  unread boolean,
  event_id uuid, event_starts_at timestamp with time zone, event_timezone text, event_title text, detail text
)
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
           case when n.kind = 'caption_mention' then p.caption else c.body end as body,
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
       and n.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'caption_mention')
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
  ),
  -- Meetups. A co-host invite points at the series; it opens the next date.
  meet as (
    select n.id as nid, n.kind as nkind, n.created_at as at, n.actor_id, n.message,
           ev.id as eid, ev.series_id as esid, ev.starts_at as estart, ev.park_id as epark,
           coalesce(ev.title, ev.note) as etitle,
           ec.id as ecid, ec.body as ebody, ec.reply_to_user_id as ereply_to,
           (select k.author_id from event_comments k where k.id = ec.parent_id) as ethread_author,
           a.username::text as actor_username, a.avatar_path as actor_avatar
      from notifications n
      left join event_comments ec on ec.id = n.event_comment_id
      join events ev on ev.id = coalesce(n.event_id, (
             select x.id from events x where x.series_id = n.series_id
              order by (x.ends_at <= now()), case when x.ends_at > now() then x.starts_at end, x.starts_at desc
              limit 1))
      left join profiles a on a.id = n.actor_id
     where n.recipient_id = me
       and n.kind in ('meetup_changed', 'meetup_cancelled', 'meetup_reminder', 'meetup_going',
                      'co_host_invite', 'meetup_comment', 'meetup_hidden')
       and private.can_see_event(ev.id)
       and (n.event_comment_id is null or ec.deleted_at is null)
       and (n.actor_id is null or not private.blocked_between(n.actor_id))
       and (a.id is null or a.deleted_at is null)
  ),
  meet_typed as (
    select m.*,
           case
             when m.nkind <> 'meetup_comment' then m.nkind::text
             when m.ereply_to = me or m.ethread_author = me then 'meetup_reply'
             when private.hosts_series(m.esid) then 'meetup_comment'
             else 'meetup_mention'
           end as shown_kind
      from meet m
  ),
  meet_rows as (
    -- Going and comments on your meetup: one row per date.
    select case t.shown_kind when 'meetup_going' then 'mg:' else 'mc:' end || t.eid::text as gid,
           t.shown_kind as gkind,
           max(t.at) as at,
           (select jsonb_agg(jsonb_build_object('id', x.actor_id, 'username', x.actor_username, 'avatar_path', x.actor_avatar)
                             order by x.at desc)
              from (select t2.actor_id, max(t2.actor_username) as actor_username, max(t2.actor_avatar) as actor_avatar,
                           max(t2.at) as at
                      from meet_typed t2
                     where t2.shown_kind = t.shown_kind and t2.eid = t.eid
                     group by t2.actor_id
                     order by max(t2.at) desc
                     limit 2) x) as people,
           count(distinct t.actor_id)::integer as people_count,
           (array_agg(t.ecid order by t.at desc))[1] as gcomment,
           (array_agg(t.ebody order by t.at desc))[1] as gbody,
           t.eid, min(t.estart) as estart, min(t.epark::text)::uuid as epark, min(t.etitle) as etitle,
           null::text as gdetail
      from meet_typed t
     where t.shown_kind in ('meetup_going', 'meetup_comment')
     group by t.shown_kind, t.eid
    union all
    select 'm:' || t.nid::text,
           t.shown_kind,
           t.at,
           case when t.actor_id is null or t.shown_kind = 'meetup_hidden' then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('id', t.actor_id, 'username', t.actor_username, 'avatar_path', t.actor_avatar))
           end,
           case when t.actor_id is null or t.shown_kind = 'meetup_hidden' then 0 else 1 end,
           t.ecid,
           coalesce(t.ebody, case when t.shown_kind = 'meetup_hidden' then t.message end),
           t.eid, t.estart, t.epark, t.etitle,
           case when t.shown_kind in ('meetup_changed', 'meetup_cancelled') then t.message end
      from meet_typed t
     where t.shown_kind not in ('meetup_going', 'meetup_comment')
  )
  select g.gid, g.gkind, g.at, coalesce(g.people, '[]'::jsonb), g.people_count, g.gpost, g.gcomment,
         left(g.gbody, 140), null::text, null::text, null::text,
         seen is null or g.at > seen,
         null::uuid, null::timestamptz, null::text, null::text, null::text
    from grouped g
  union all
  select h.gid, h.gkind, h.at, h.people, h.people_count, null::uuid, null::uuid, null::text,
         pk.slug::text, pk.display_name::text, h.metro,
         seen is null or h.at > seen,
         null::uuid, null::timestamptz, null::text, null::text, null::text
    from hellos h
    left join parks pk on pk.id = h.park
  union all
  select x.gid, x.gkind, x.at, x.people, x.people_count, x.gpost, null::uuid, x.gbody,
         pk.slug::text, pk.display_name::text, null::text,
         seen is null or x.at > seen,
         null::uuid, null::timestamptz, null::text, null::text, null::text
    from notices x
    left join parks pk on pk.id = x.park
  union all
  select mr.gid, mr.gkind, mr.at, coalesce(mr.people, '[]'::jsonb), mr.people_count, null::uuid, mr.gcomment,
         left(mr.gbody, 140), pk.slug::text, pk.display_name::text, null::text,
         seen is null or mr.at > seen,
         mr.eid, mr.estart, private.park_tz(mr.epark), mr.etitle, mr.gdetail
    from meet_rows mr
    left join parks pk on pk.id = mr.epark
  order by 3 desc
  limit 100;
end $function$;

-- Same body as before; created again because my_notifications() was.
create or replace function public.notifications_unread()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.my_notifications() n where n.unread)
      or exists (
           select 1 from follows f
            where f.followee_id = auth.uid() and f.status = 'pending'
              and f.created_at > coalesce((select seen_at from private.notifications_seen where user_id = auth.uid()), '-infinity')
         );
$$;

/* 6. Push ----------------------------------------------------------------------- */

create or replace function private.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'park_report_accepted', 'caption_mention',
                  'meetup_changed', 'meetup_cancelled', 'meetup_reminder', 'meetup_comment')
     and exists (select 1 from private.push_devices d where d.user_id = new.recipient_id) then
    insert into private.push_outbox (recipient_id, notification_id) values (new.recipient_id, new.id);
  end if;
  return null;
end $$;

drop function if exists public.my_push_settings();

create function public.my_push_settings()
returns table (
  comments boolean,
  mentions boolean,
  tags boolean,
  filmer_credits boolean,
  invites boolean,
  someone_new boolean,
  park_fixes boolean,
  meetups boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.comments, true), coalesce(s.mentions, true), coalesce(s.tags, true),
         coalesce(s.filmer_credits, true), coalesce(s.invites, true), coalesce(s.someone_new, true),
         coalesce(s.park_fixes, true), coalesce(s.meetups, true)
    from (select auth.uid() as me) m
    left join private.push_settings s on s.user_id = m.me
   where m.me is not null;
$$;

create or replace function public.set_push_setting(setting text, enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if enabled is null then
    raise exception 'on or off' using errcode = '22023';
  end if;
  insert into private.push_settings (user_id) values (me) on conflict (user_id) do nothing;
  case setting
    when 'comments' then update private.push_settings set comments = enabled, updated_at = now() where user_id = me;
    when 'mentions' then update private.push_settings set mentions = enabled, updated_at = now() where user_id = me;
    when 'tags' then update private.push_settings set tags = enabled, updated_at = now() where user_id = me;
    when 'filmer_credits' then update private.push_settings set filmer_credits = enabled, updated_at = now() where user_id = me;
    when 'invites' then update private.push_settings set invites = enabled, updated_at = now() where user_id = me;
    when 'someone_new' then update private.push_settings set someone_new = enabled, updated_at = now() where user_id = me;
    when 'park_fixes' then update private.push_settings set park_fixes = enabled, updated_at = now() where user_id = me;
    when 'meetups' then update private.push_settings set meetups = enabled, updated_at = now() where user_id = me;
    else raise exception 'unknown setting %', setting using errcode = '22023';
  end case;
end $$;

drop function if exists public.push_claim(integer);

create function public.push_claim(max_rows integer default 100)
returns table (
  outbox_id bigint,
  send boolean,
  kind text,
  actor_username text,
  comment_body text,
  post_id uuid,
  park_name text,
  park_slug text,
  metro_name text,
  devices jsonb,
  event_id uuid,
  event_starts_at timestamptz,
  event_timezone text,
  event_title text,
  detail text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select o.id
      from private.push_outbox o
     where o.sent_at is null
       and o.attempts < 3
       and o.created_at > now() - interval '1 day'
       and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
     order by o.id
     limit greatest(1, least(max_rows, 500))
     for update skip locked
  ),
  claimed as (
    update private.push_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
      from picked
     where o.id = picked.id
    returning o.*
  ),
  -- Notifications: the same reply / mention / comment split as the bell.
  from_notifications as (
    select cl.id as oid,
           cl.recipient_id as rid,
           case
             when n.kind = 'comment' then
               case
                 when c.reply_to_user_id = cl.recipient_id
                   or (select pc.author_id from comments pc where pc.id = c.parent_id) = cl.recipient_id then 'reply'
                 when p.author_id = cl.recipient_id then 'comment'
                 else 'mention'
               end
             when n.kind = 'meetup_comment' then
               case
                 when ec.reply_to_user_id = cl.recipient_id
                   or (select k.author_id from event_comments k where k.id = ec.parent_id) = cl.recipient_id then 'meetup_reply'
                 when private.hosts_series(ev.series_id, cl.recipient_id) then 'meetup_comment'
                 else 'meetup_mention'
               end
             else n.kind::text
           end as k,
           n.actor_id as aid,
           a.username::text as uname,
           case when n.kind = 'caption_mention' then p.caption
                when n.kind = 'meetup_comment' then ec.body
                else c.body end as cbody,
           n.post_id as pid,
           coalesce(fx.display_name, evp.display_name)::text as pk,
           coalesce(fx.slug, evp.slug)::text as pslug,
           null::text as metro,
           (n.id is not null
             and (n.comment_id is null or (c.id is not null and c.deleted_at is null))
             and (n.post_id is null or private.can_see_post_as(n.post_id, cl.recipient_id))
             and (n.event_id is null or private.can_see_event_as(n.event_id, cl.recipient_id))
             and (n.event_comment_id is null or (ec.id is not null and ec.deleted_at is null))
             and (n.kind <> 'meetup_reminder' or (ev.status = 'scheduled' and ev.starts_at > now()))
             and (a.id is null or a.deleted_at is null)) as ok,
           ev.id as eid,
           ev.starts_at as estart,
           case when ev.id is not null then private.park_tz(ev.park_id) end as etz,
           coalesce(ev.title, ev.note)::text as etitle,
           case when n.kind in ('meetup_changed', 'meetup_cancelled') then n.message end as edetail
      from claimed cl
      left join notifications n on n.id = cl.notification_id
      left join comments c on c.id = n.comment_id
      left join posts p on p.id = n.post_id
      left join profiles a on a.id = n.actor_id
      -- A park fix going live names the park.
      left join parks fx on fx.id = n.park_id and n.kind = 'park_report_accepted'
      left join event_comments ec on ec.id = n.event_comment_id
      left join events ev on ev.id = n.event_id
      left join parks evp on evp.id = ev.park_id
     where cl.notification_id is not null
  ),
  from_announcements as (
    select cl.id,
           cl.recipient_id,
           case when an.kind = 'visiting' then 'visiting' else 'someone_new' end,
           an.user_id,
           u.username::text,
           null::text,
           null::uuid,
           pk.display_name::text,
           pk.slug::text,
           ma.name::text,
           (an.id is not null
             and u.deleted_at is null
             and u.banned_at is null
             and r.home_metro_area_id = an.metro_area_id),
           null::uuid,
           null::timestamptz,
           null::text,
           null::text,
           null::text
      from claimed cl
      left join announcements an on an.id = cl.announcement_id
      left join profiles u on u.id = an.user_id
      left join profiles r on r.id = cl.recipient_id
      left join parks pk on pk.id = an.park_id
      left join metro_areas ma on ma.id = an.metro_area_id
     where cl.announcement_id is not null
  ),
  everything as (
    select * from from_notifications
    union all
    select * from from_announcements
  )
  select e.oid,
         (e.ok
           and r.deleted_at is null
           and (e.aid is null or not exists (
                 select 1 from blocks b
                  where (b.blocker_id = e.rid and b.blocked_id = e.aid)
                     or (b.blocker_id = e.aid and b.blocked_id = e.rid)))
           and case e.k
                 when 'comment' then coalesce(s.comments, true)
                 when 'reply' then coalesce(s.comments, true)
                 when 'mention' then coalesce(s.mentions, true)
                 when 'caption_mention' then coalesce(s.mentions, true)
                 when 'tag' then coalesce(s.tags, true)
                 when 'filmer_credit' then coalesce(s.filmer_credits, true)
                 when 'invite_used' then coalesce(s.invites, true)
                 when 'someone_new' then coalesce(s.someone_new, true)
                 when 'visiting' then coalesce(s.someone_new, true)
                 when 'park_report_accepted' then coalesce(s.park_fixes, true)
                 when 'meetup_changed' then coalesce(s.meetups, true)
                 when 'meetup_cancelled' then coalesce(s.meetups, true)
                 when 'meetup_reminder' then coalesce(s.meetups, true)
                 when 'meetup_comment' then coalesce(s.comments, true)
                 when 'meetup_reply' then coalesce(s.comments, true)
                 when 'meetup_mention' then coalesce(s.mentions, true)
                 else false
               end
           and dv.list is not null),
         e.k,
         e.uname,
         left(e.cbody, 140),
         e.pid,
         e.pk,
         e.pslug,
         e.metro,
         coalesce(dv.list, '[]'::jsonb),
         e.eid,
         e.estart,
         e.etz,
         left(e.etitle, 80),
         e.edetail
    from everything e
    join profiles r on r.id = e.rid
    left join private.push_settings s on s.user_id = e.rid
    left join lateral (
      select jsonb_agg(jsonb_build_object('token', d.token, 'language', d.language)) as list
        from private.push_devices d
       where d.user_id = e.rid
    ) dv on true
   order by e.oid;
end $$;

/* 7. Reports -------------------------------------------------------------------- */

-- Whether the caller moderates where a reported thing lives: a post's park
-- or metro, or a meetup date's park.
create or replace function private.can_moderate_report_target(
  post uuid, comment uuid, meetup uuid, meetup_comment uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when post is not null then private.can_moderate_post(post)
    when comment is not null then private.can_moderate_post((select c.post_id from comments c where c.id = comment))
    when meetup is not null then private.can_moderate_park((select e.park_id from events e where e.id = meetup))
    when meetup_comment is not null then private.can_moderate_park((
      select e.park_id from event_comments c join events e on e.id = c.event_id where c.id = meetup_comment))
    else false
  end;
$$;

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
    and private.can_moderate_report_target(r.post_id, r.comment_id, r.event_id, r.event_comment_id)
  );
$$;

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
           when 'meetup' then r.event_id = target
           when 'meetup_comment' then r.event_comment_id = target
           when 'person' then r.reported_user_id = target and r.post_id is null and r.comment_id is null
                              and r.event_id is null and r.event_comment_id is null
           else false
         end;
$$;

drop policy if exists "read reports" on public.reports;
create policy "read reports" on public.reports
  for select to authenticated using (
    reporter_id = (select auth.uid())
    or private.is_owner()
    or (reason not in ('harassment', 'involves_minor')
        and private.can_moderate_report_target(post_id, comment_id, event_id, event_comment_id))
  );

drop policy if exists "resolve reports" on public.reports;
create policy "resolve reports" on public.reports
  for update to authenticated
  using (
    private.is_owner()
    or (reason not in ('harassment', 'involves_minor')
        and private.can_moderate_report_target(post_id, comment_id, event_id, event_comment_id))
  )
  with check (action is distinct from 'ban' or private.is_owner());

drop function if exists public.file_report(uuid, uuid, uuid, public.report_reason, text);

-- Report a post, a comment, a person, a meetup date or a meetup comment
-- (exactly one). A repeat report of the same thing by the same person while
-- the first is still open is quietly accepted and changes nothing.
-- Suspended members can still report.
create function public.file_report(
  post uuid default null,
  comment uuid default null,
  person uuid default null,
  reason public.report_reason default 'other',
  details text default null,
  meetup uuid default null,
  meetup_comment uuid default null
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
  mc event_comments%rowtype;
  clean text := nullif(btrim(coalesce(details, '')), '');
begin
  if me is null or not exists (
    select 1 from profiles where id = me and onboarded_at is not null and deleted_at is null and banned_at is null
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if num_nonnulls(post, comment, person, meetup, meetup_comment) <> 1 then
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
  elsif meetup is not null then
    select s.host_id into target_user from events e join event_series s on s.id = e.series_id
     where e.id = meetup;
    if target_user is null or not private.can_see_event(meetup) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  elsif meetup_comment is not null then
    select * into mc from event_comments where id = meetup_comment;
    if mc.id is null or mc.deleted_at is not null or not private.can_see_event(mc.event_id)
       or private.blocked_between(mc.author_id) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    target_user := mc.author_id;
  else
    if not exists (select 1 from profiles where id = person and deleted_at is null and onboarded_at is not null) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    target_user := person;
  end if;

  if target_user = me then
    raise exception 'cannot_report_yourself' using errcode = '22023';
  end if;

  -- One report per person per post, ever (a unique index already says so);
  -- everything else once while a report is open.
  if exists (
    select 1 from reports r
     where r.reporter_id = me
       and (r.status = 'open' or post is not null)
       and r.post_id is not distinct from post
       and r.comment_id is not distinct from comment
       and r.event_id is not distinct from meetup
       and r.event_comment_id is not distinct from meetup_comment
       and (post is not null or comment is not null or meetup is not null or meetup_comment is not null
            or r.reported_user_id = person)
  ) then
    return;
  end if;

  insert into reports (reporter_id, post_id, comment_id, event_id, event_comment_id, reported_user_id, reason, details)
  values (me, post, comment, meetup, meetup_comment, target_user, reason, clean);
end;
$$;

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
                when r.event_id is not null then 'meetup'
                when r.event_comment_id is not null then 'meetup_comment'
                else 'person' end as tkind,
           coalesce(r.post_id, r.comment_id, r.event_id, r.event_comment_id, r.reported_user_id) as tid,
           coalesce(r.post_id, (select c.post_id from comments c where c.id = r.comment_id)) as on_post,
           coalesce(r.event_id, (select c.event_id from event_comments c where c.id = r.event_comment_id)) as on_event
      from reports r
     where r.status in ('open', 'escalated')
       and (r.status = 'open' or owner)
       and private.can_review_report(r)
  ),
  groups as (
    select m.tkind, m.tid, min(m.on_post::text)::uuid as on_post, min(m.on_event::text)::uuid as on_event,
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
           u.username::text as uname,
           case when ev.id is not null then coalesce(ev.title, ev.note)::text end as lbl,
           pk.id as pid, pk.display_name::text as pname, pk.slug::text as pslug,
           coalesce(po.metro_area_id, pk.metro_area_id, u.home_metro_area_id) as mid,
           case
             when owner and (g.escalated or g.owner_only or g.tkind = 'person') then 'sent_to_you'
             when po.status = 'auto_hidden' and g.tkind = 'post' then 'auto_hidden'
             when po.status = 'hidden' and g.tkind = 'post' then 'hidden'
             when ev.hidden_at is not null and g.tkind = 'meetup' then 'hidden'
             else 'open'
           end as st,
           g.first_at, g.last_at
      from groups g
      left join posts po on po.id = g.on_post
      left join events ev on ev.id = g.on_event
      left join parks pk on pk.id = coalesce(po.park_id, ev.park_id)
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

-- Everything the detail pane shows for one report group: the post, comment,
-- meetup date or meetup comment, the reports, and the reported person's
-- history. target_kind: 'post', 'comment', 'meetup', 'meetup_comment' or
-- 'person'.
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
  ev events%rowtype;
  mc event_comments%rowtype;
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
  elsif target_kind = 'meetup' then
    select * into ev from events where id = target;
    select host_id into person from event_series where id = ev.series_id;
  elsif target_kind = 'meetup_comment' then
    select * into mc from event_comments where id = target;
    select * into ev from events where id = mc.event_id;
    person := mc.author_id;
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
    'comment', case
      when c.id is not null then jsonb_build_object(
        'id', c.id, 'body', c.body, 'created_at', c.created_at, 'deleted', c.deleted_at is not null,
        'author', (select username::text from profiles where id = c.author_id))
      when mc.id is not null then jsonb_build_object(
        'id', mc.id, 'body', mc.body, 'created_at', mc.created_at, 'deleted', mc.deleted_at is not null,
        'author', (select username::text from profiles where id = mc.author_id))
    end,
    'meetup', case when ev.id is null then null else jsonb_build_object(
      'id', ev.id,
      'title', ev.title,
      'note', ev.note,
      'starts_at', ev.starts_at,
      'ends_at', ev.ends_at,
      'timezone', private.park_tz(ev.park_id),
      'status', ev.status,
      'cancel_reason', ev.cancel_reason,
      'hidden', ev.hidden_at is not null,
      'visibility', (select visibility from event_series where id = ev.series_id),
      'host', (select p.username::text from event_series s join profiles p on p.id = s.host_id where s.id = ev.series_id),
      'park', (select jsonb_build_object('id', pk.id, 'name', pk.display_name, 'slug', pk.slug,
                                         'metro', (select name from metro_areas where id = pk.metro_area_id))
                 from parks pk where pk.id = ev.park_id)
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

-- Hides a post (status 'hidden'), hides a meetup date, or removes a post or
-- meetup comment (keeping its text in the log). Returns the snapshot to
-- log, if any.
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
  elsif target_kind = 'meetup' then
    update events set hidden_at = now(), hidden_by = auth.uid(), updated_at = now()
     where id = target and hidden_at is null;
  elsif target_kind = 'meetup_comment' then
    select jsonb_build_object('body', body, 'created_at', created_at) into snap
      from event_comments where id = target and deleted_at is null;
    update event_comments set deleted_at = now(), body = '[deleted]' where id = target and deleted_at is null;
  end if;
  return snap;
end;
$$;

-- Acts on every open (or escalated) report about one post, comment, meetup
-- date, meetup comment or person. As before (see the moderation migration),
-- with meetups: keeping a meetup hidden hides that date and its hosts hear
-- about it (with the message); dismissing brings a hidden date back.
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
  the_event uuid;
  the_event_comment uuid;
  clean text := nullif(btrim(coalesce(message, '')), '');
  snap jsonb;
  until timestamptz;
  new_status report_status;
  new_action report_action;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if target_kind not in ('post', 'comment', 'meetup', 'meetup_comment', 'person') then
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
  elsif target_kind = 'meetup' then
    the_event := target;
    select s.host_id into person from events e join event_series s on s.id = e.series_id where e.id = target;
  elsif target_kind = 'meetup_comment' then
    the_event_comment := target;
    select author_id, event_id into person, the_event from event_comments where id = target;
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

  -- The post, comment or meetup date.
  if decision = 'keep_hidden' or (decision in ('warn', 'suspend', 'ban') and (hide or decision = 'ban')) then
    snap := private.hide_target(target_kind, target);
    if target_kind = 'meetup' and clean is not null then
      update notifications set message = clean
       where kind = 'meetup_hidden' and event_id = target and created_at = now();
    end if;
  elsif decision in ('dismiss', 'warn', 'suspend') and target_kind = 'post' then
    update posts set status = 'visible' where id = target and status in ('auto_hidden', 'hidden');
  elsif decision = 'dismiss' and target_kind = 'meetup' then
    update events set hidden_at = null, hidden_by = null, updated_at = now()
     where id = target and hidden_at is not null;
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

  -- What the person is told. A hidden meetup date is told to its hosts by
  -- the events trigger instead.
  if decision = 'keep_hidden' and target_kind <> 'meetup' then
    insert into notifications (recipient_id, kind, post_id, comment_id, message)
    values (person,
            case when target_kind in ('comment', 'meetup_comment') then 'comment_removed' else 'post_removed' end::notification_kind,
            the_post, null, clean);
  elsif decision = 'warn' then
    insert into notifications (recipient_id, kind, post_id, message) values (person, 'warning', the_post, clean);
  elsif decision = 'suspend' then
    insert into notifications (recipient_id, kind, post_id, message) values (person, 'suspension', the_post, clean);
  end if;

  insert into moderation_actions (actor_id, action, target_user_id, post_id, comment_id, event_id, event_comment_id,
                                  report_ids, message, suspended_until, snapshot)
  values (me, decision, person, the_post, the_comment, the_event, the_event_comment, ids, clean, until, snap);
end;
$$;

/* 8. Park admins hide a date ---------------------------------------------------- */

-- Hides (or brings back) one meetup date at a park the caller moderates.
-- Hidden dates show only to their hosts and moderators; the hosts are told.
create or replace function public.hide_meetup(event uuid, hide boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e events;
  changed boolean;
begin
  select * into e from events where id = hide_meetup.event;
  if e.id is null or not private.can_moderate_park(e.park_id) then
    raise exception 'Only this park''s admins can hide its meetups' using errcode = '42501';
  end if;
  if hide then
    update events set hidden_at = now(), hidden_by = me, updated_at = now() where id = e.id and hidden_at is null;
  else
    update events set hidden_at = null, hidden_by = null, updated_at = now() where id = e.id and hidden_at is not null;
  end if;
  changed := found;
  if changed then
    insert into moderation_actions (actor_id, action, target_user_id, park_id, event_id)
    values (me, case when hide then 'meetup_hidden' else 'meetup_unhidden' end,
            (select host_id from event_series where id = e.series_id), e.park_id, e.id);
  end if;
end $$;

/* Grants ------------------------------------------------------------------------- */

revoke all on function private.notify_meetup(uuid, public.notification_kind, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.notify_co_host_invite() from public, anon, authenticated;
revoke all on function private.notify_meetup_going() from public, anon, authenticated;
revoke all on function private.notify_meetup_comment() from public, anon, authenticated;
revoke all on function private.unnotify_meetup_comment() from public, anon, authenticated;
revoke all on function private.notify_meetup_updates() from public, anon, authenticated;
revoke all on function private.send_meetup_reminders() from public, anon, authenticated;
revoke all on function private.can_moderate_report_target(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.can_moderate_report_target(uuid, uuid, uuid, uuid) to authenticated;

revoke all on function public.push_claim(integer) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.my_notifications()',
    'public.notifications_unread()',
    'public.my_push_settings()',
    'public.set_push_setting(text, boolean)',
    'public.meetup_mention_people(uuid, text)',
    'public.file_report(uuid, uuid, uuid, public.report_reason, text, uuid, uuid)',
    'public.moderation_queue(uuid)',
    'public.moderation_report_detail(text, uuid)',
    'public.moderate_reports(text, uuid, text, text, integer, boolean)',
    'public.hide_meetup(uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

/* Checks ------------------------------------------------------------------------- */

create temp table t_results(step text, ok boolean, detail text);
create temp table t_ids(name text primary key, id uuid);
grant all on t_results, t_ids to authenticated;

-- H hosts, C co-hosts, G goes (follows H), S is a stranger, P is Memo's park
-- admin, M can't see Followers only meetups, B blocks H.
insert into auth.users (id, email, aud, role, instance_id) values
 ('d5000000-0000-4000-8000-0000000000a1','mc-h@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d5000000-0000-4000-8000-0000000000a2','mc-c@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d5000000-0000-4000-8000-0000000000a3','mc-g@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d5000000-0000-4000-8000-0000000000a4','mc-s@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d5000000-0000-4000-8000-0000000000a5','mc-p@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d5000000-0000-4000-8000-0000000000a6','mc-m@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d5000000-0000-4000-8000-0000000000a7','mc-b@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private) values
 ('d5000000-0000-4000-8000-0000000000a1','mc_host', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d5000000-0000-4000-8000-0000000000a2','mc_cohost', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d5000000-0000-4000-8000-0000000000a3','mc_goer', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d5000000-0000-4000-8000-0000000000a4','mc_stranger', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d5000000-0000-4000-8000-0000000000a5','mc_parkadmin', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d5000000-0000-4000-8000-0000000000a6','mc_mentioned', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d5000000-0000-4000-8000-0000000000a7','mc_blocker', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false);
insert into follows (follower_id, followee_id, status) values
 ('d5000000-0000-4000-8000-0000000000a3','d5000000-0000-4000-8000-0000000000a1','accepted');
insert into role_assignments (user_id, role, park_id, accepted_at) values
 ('d5000000-0000-4000-8000-0000000000a5','park_admin','8dc45317-2f2a-4f66-b6e2-0a600537f16e', now());
insert into blocks (blocker_id, blocked_id) values
 ('d5000000-0000-4000-8000-0000000000a7','d5000000-0000-4000-8000-0000000000a1');
insert into private.push_devices (token, user_id, platform, language) values
 ('ExponentPushToken[mc-check-goer]','d5000000-0000-4000-8000-0000000000a3','ios','en');

set local role authenticated;

-- H: a weekly public meetup at Memo (tomorrow's weekday) and a Followers only one-off.
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_ids select 'weekly', create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e',
  starts_at => date_trunc('minute', now()) + interval '1 day', title => 'Weekly check', visibility => 'public',
  weekdays => array[extract(isodow from (date_trunc('minute', now()) + interval '1 day') at time zone private.park_tz('8dc45317-2f2a-4f66-b6e2-0a600537f16e'))::smallint]);
insert into t_ids select 'series', series_id from events where id = (select id from t_ids where name = 'weekly');
insert into t_ids select 'second', id from events where series_id = (select id from t_ids where name = 'series') order by starts_at offset 1 limit 1;
insert into t_ids select 'fo', create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e',
  starts_at => now() + interval '3 days', note => 'Followers only', visibility => 'followers');
insert into t_ids select 'fo_series', series_id from events where id = (select id from t_ids where name = 'fo');

-- Co-host invites
select invite_co_hosts((select id from t_ids where name = 'series'), array['d5000000-0000-4000-8000-0000000000a2'::uuid]);
select invite_co_hosts((select id from t_ids where name = 'fo_series'), array['d5000000-0000-4000-8000-0000000000a2'::uuid]);
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
insert into t_results select 'co-host invite is in the bell, pointing at a date', count(*) = 2 and bool_and(n.event_id is not null), count(*)::text
  from my_notifications() n where n.kind = 'co_host_invite';
insert into t_results select 'invitee can see a Followers only meetup they''re invited to',
  exists (select 1 from events where id = (select id from t_ids where name = 'fo')), '';
select respond_co_host_invite((select id from t_ids where name = 'series'), true);
select respond_co_host_invite((select id from t_ids where name = 'fo_series'), false);
insert into t_results select 'answered invites leave the bell', count(*) = 0, count(*)::text
  from my_notifications() n where n.kind = 'co_host_invite';
insert into t_results select 'declined invitee can''t see the Followers only meetup any more',
  not exists (select 1 from events where id = (select id from t_ids where name = 'fo')), '';

-- Going: the hosts' grouped row
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select set_going((select id from t_ids where name = 'weekly'), true, remind_me => true);
select set_going((select id from t_ids where name = 'second'), true);
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
select set_going((select id from t_ids where name = 'weekly'), true);
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'host: two going grouped in one row', count(*) = 1 and min(n.actor_count) = 2, string_agg(n.actor_count::text, ',')
  from my_notifications() n where n.kind = 'meetup_going' and n.event_id = (select id from t_ids where name = 'weekly');
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
insert into t_results select 'co-host gets the going row too', count(*) = 1, count(*)::text
  from my_notifications() n where n.kind = 'meetup_going' and n.event_id = (select id from t_ids where name = 'weekly');
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
select set_going((select id from t_ids where name = 'weekly'), false);
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'not going any more: back to one in the row', min(n.actor_count) = 1, string_agg(n.actor_count::text, ',')
  from my_notifications() n where n.kind = 'meetup_going' and n.event_id = (select id from t_ids where name = 'weekly');
reset role;
insert into t_results select 'going never pushes', count(*) = 0, count(*)::text
  from private.push_outbox o join notifications n on n.id = o.notification_id where n.kind = 'meetup_going';
set local role authenticated;

-- Comments
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into event_comments (event_id, author_id, body)
values ((select id from t_ids where name = 'weekly'), 'd5000000-0000-4000-8000-0000000000a4', 'see you there @mc_goer');
insert into t_ids select 'scomment', id from event_comments where author_id = 'd5000000-0000-4000-8000-0000000000a4';
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'host hears about a comment as a comment', count(*) = 1, count(*)::text
  from my_notifications() n where n.kind = 'meetup_comment';
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
insert into t_results select 'co-host hears about it too', count(*) = 1, count(*)::text
  from my_notifications() n where n.kind = 'meetup_comment';
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
insert into t_results select 'mentioned goer sees a mention', count(*) = 1, count(*)::text
  from my_notifications() n where n.kind = 'meetup_mention';
insert into event_comments (event_id, author_id, parent_id, reply_to_user_id, body)
values ((select id from t_ids where name = 'weekly'), 'd5000000-0000-4000-8000-0000000000a3',
        (select id from t_ids where name = 'scomment'), 'd5000000-0000-4000-8000-0000000000a4', 'yes!');
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into t_results select 'commenter hears about the reply', count(*) = 1, count(*)::text
  from my_notifications() n where n.kind = 'meetup_reply';
-- H mentions M and the blocker on the Followers only one-off: neither hears.
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into event_comments (event_id, author_id, body)
values ((select id from t_ids where name = 'fo'), 'd5000000-0000-4000-8000-0000000000a1', 'hey @mc_mentioned @mc_blocker @mc_goer');
insert into t_ids select 'hcomment', id from event_comments where author_id = 'd5000000-0000-4000-8000-0000000000a1';
reset role;
insert into t_results select 'mentions only reach people who can see the meetup',
  (select count(*) from notifications where kind = 'meetup_comment' and event_id = (select id from t_ids where name = 'fo')) = 1
  and exists (select 1 from notifications where kind = 'meetup_comment' and event_id = (select id from t_ids where name = 'fo')
               and recipient_id = 'd5000000-0000-4000-8000-0000000000a3'), '';
set local role authenticated;

-- The @ list
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select '@ list on a Followers only meetup: goer yes, others no',
  bool_or(p.username = 'mc_goer') and not bool_or(p.username in ('mc_mentioned', 'mc_stranger', 'mc_blocker')),
  string_agg(p.username::text, ',')
  from meetup_mention_people((select id from t_ids where name = 'fo'), 'mc_') p;
insert into t_results select '@ list with nothing typed: hosts and commenters', bool_and(p.reason in ('host', 'commented')) and count(*) >= 2,
  string_agg(p.username || ':' || p.reason, ',')
  from meetup_mention_people((select id from t_ids where name = 'weekly'), '') p;
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a6","role":"authenticated"}', true);
insert into t_results select '@ list on a meetup you can''t see is empty', count(*) = 0, count(*)::text
  from meetup_mention_people((select id from t_ids where name = 'fo'), 'mc_') p;

-- Changes
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select update_meetup((select id from t_ids where name = 'weekly'), 'date', '{"title":"New title","note":"New note"}');
reset role;
insert into t_results select 'title and note edits say nothing', count(*) = 0, count(*)::text
  from notifications where kind = 'meetup_changed' and recipient_id = 'd5000000-0000-4000-8000-0000000000a3';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select update_meetup((select id from t_ids where name = 'weekly'), 'upcoming',
  jsonb_build_object('starts_at', (select starts_at + interval '1 hour' from events where id = (select id from t_ids where name = 'weekly'))));
reset role;
insert into t_results select 'series time change: one row for someone going to two dates, naming the first',
  count(*) = 1 and min(event_id::text) = (select id::text from t_ids where name = 'weekly') and min(message) = 'time',
  count(*)::text || ' ' || coalesce(min(message), '')
  from notifications where kind = 'meetup_changed' and recipient_id = 'd5000000-0000-4000-8000-0000000000a3';
insert into t_results select 'nobody else going, nobody else told', count(*) = 0, count(*)::text
  from notifications where kind = 'meetup_changed' and recipient_id <> 'd5000000-0000-4000-8000-0000000000a3'
   and event_id in (select id from events where series_id = (select id from t_ids where name = 'series'));
insert into t_results select 'the change is queued for push', count(*) = 1, count(*)::text
  from private.push_outbox o join notifications n on n.id = o.notification_id
 where n.kind = 'meetup_changed' and n.recipient_id = 'd5000000-0000-4000-8000-0000000000a3';

-- Reminders
update events set starts_at = now() + interval '30 minutes', ends_at = now() + interval '90 minutes'
 where id = (select id from t_ids where name = 'weekly');
insert into t_results select 'reminder sent once, 30 minutes out', private.send_meetup_reminders() = 1 and private.send_meetup_reminders() = 0, '';
insert into t_results select 'reminder is in the goer''s bell', count(*) = 1, count(*)::text
  from notifications where kind = 'meetup_reminder' and recipient_id = 'd5000000-0000-4000-8000-0000000000a3';
update events set starts_at = now() + interval '40 minutes', ends_at = now() + interval '100 minutes'
 where id = (select id from t_ids where name = 'weekly');
insert into t_results select 'a new start time re-arms the reminder',
  (select reminded_at is null from event_going where event_id = (select id from t_ids where name = 'weekly') and user_id = 'd5000000-0000-4000-8000-0000000000a3')
  and private.send_meetup_reminders() = 1, '';

-- Push: what push-send gets
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
insert into t_results select 'Meetups switch on by default', bool_and(meetups), '' from my_push_settings();
create temp table t_claim as select * from push_claim(500) c
  where c.devices @> '[{"token":"ExponentPushToken[mc-check-goer]"}]';
insert into t_results select 'push rows for the goer carry the date and the park''s clock',
  count(*) >= 3 and bool_and(c.event_id is not null and c.event_timezone is not null and c.send),
  string_agg(c.kind || ':' || c.send::text, ',')
  from t_claim c where c.kind in ('meetup_changed', 'meetup_reminder');
insert into t_results select 'the mention push is a meetup_mention', count(*) = 2 and bool_and(c.send), count(*)::text
  from t_claim c where c.kind = 'meetup_mention';
set local role authenticated;
select set_push_setting('meetups', false);
reset role;

-- Cancelling
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select cancel_meetup((select id from t_ids where name = 'weekly'), 'rained_out', 'date');
reset role;
insert into t_results select 'cancelling tells the goer, with the reason', count(*) = 1 and min(message) = 'rained_out', count(*)::text
  from notifications where kind = 'meetup_cancelled' and recipient_id = 'd5000000-0000-4000-8000-0000000000a3';
insert into t_results select 'the reminder leaves the bell', count(*) = 0, count(*)::text
  from notifications where kind = 'meetup_reminder' and event_id = (select id from t_ids where name = 'weekly');
insert into t_results select 'Meetups switch off: the cancellation isn''t pushed', bool_and(not c.send), string_agg(c.send::text, ',')
  from push_claim(500) c where c.kind = 'meetup_cancelled' and c.devices @> '[{"token":"ExponentPushToken[mc-check-goer]"}]';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select cancel_meetup((select id from t_ids where name = 'second'), 'park_closed', 'series');
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
insert into t_results select 'ending the series shows as a series cancellation', count(*) = 1, string_agg(n.detail, ',')
  from my_notifications() n where n.kind = 'meetup_cancelled' and n.detail = 'park_closed:series';

-- Reports
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_ids select 'pub', create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e',
  starts_at => now() + interval '5 days', note => 'Reported one', visibility => 'public');
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$ begin
  perform file_report(meetup => (select id from t_ids where name = 'pub'), reason => 'wrong_park');
  insert into t_results values ('"Not at this park" refused for meetups', false, 'accepted');
exception when others then
  insert into t_results values ('"Not at this park" refused for meetups', sqlerrm = 'wrong_park_is_for_posts', sqlerrm);
end $$;
select file_report(meetup => (select id from t_ids where name = 'pub'), reason => 'spam');
select file_report(meetup => (select id from t_ids where name = 'pub'), reason => 'spam');
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select file_report(meetup_comment => (select id from t_ids where name = 'hcomment'), reason => 'inappropriate');
reset role;
insert into t_results select 'a repeat report changes nothing', count(*) = 1, count(*)::text
  from reports where event_id = (select id from t_ids where name = 'pub');
insert into t_results select 'meetup reports aren''t person reports', count(*) = 0, count(*)::text
  from private.reports_for('person', 'd5000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$ begin
  perform file_report(meetup_comment => (select id from event_comments where body = 'yes!'), reason => 'spam');
  insert into t_results values ('reporting another''s comment works', true, '');
exception when others then
  insert into t_results values ('reporting another''s comment works', false, sqlerrm);
end $$;
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
insert into t_results select 'park admin sees the meetup report in the queue, labelled',
  count(*) = 1 and min(q.label) = 'Reported one' and min(q.park_slug) is not null, count(*)::text
  from moderation_queue() q where q.target = 'meetup' and q.id = (select id from t_ids where name = 'pub');
insert into t_results select 'park admin sees the meetup comment report', count(*) >= 1, count(*)::text
  from moderation_queue() q where q.target = 'meetup_comment';
insert into t_results select 'the detail pane shows the meetup and its host',
  (moderation_report_detail('meetup', (select id from t_ids where name = 'pub')) -> 'meetup' ->> 'host') = 'mc_host', '';
select moderate_reports('meetup', (select id from t_ids where name = 'pub'), 'keep_hidden', 'Not a real meetup');
insert into t_results select 'kept hidden: the date is hidden', (select hidden_at is not null from events where id = (select id from t_ids where name = 'pub')), '';
select moderate_reports('meetup_comment', (select id from t_ids where name = 'hcomment'), 'keep_hidden');
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'host hears the date was hidden, with the note', count(*) = 1 and min(n.comment_body) = 'Not a real meetup',
  count(*)::text || ' ' || coalesce(min(n.comment_body), '')
  from my_notifications() n where n.kind = 'meetup_hidden';
insert into t_results select 'host''s comment was removed and they''re told', count(*) = 1, count(*)::text
  from my_notifications() n where n.kind = 'comment_removed';
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into t_results select 'a hidden date is gone for others', not exists (select 1 from events where id = (select id from t_ids where name = 'pub')), '';

-- Hiding directly
do $$ begin
  perform hide_meetup((select id from t_ids where name = 'second'));
  insert into t_results values ('strangers can''t hide meetups', false, 'hid it');
exception when others then
  insert into t_results values ('strangers can''t hide meetups', sqlstate = '42501', sqlerrm);
end $$;
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
select hide_meetup((select id from t_ids where name = 'pub'), false);
insert into t_results select 'unhidden: the hosts'' row goes', count(*) = 0, count(*)::text
  from notifications where kind = 'meetup_hidden' and event_id = (select id from t_ids where name = 'pub');
reset role;
insert into t_results select 'hiding and unhiding are logged', count(*) = 1, count(*)::text
  from moderation_actions where event_id = (select id from t_ids where name = 'pub') and action = 'meetup_unhidden';
set local role authenticated;

-- Deleting a mistake takes its notifications with it
select set_config('request.jwt.claims', '{"sub":"d5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_ids select 'oops', create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e',
  starts_at => now() + interval '6 days', note => 'Wrong park', visibility => 'public',
  co_hosts => array['d5000000-0000-4000-8000-0000000000a2'::uuid]);
select delete_meetup((select id from t_ids where name = 'oops'));
reset role;
insert into t_results select 'deleted meetup: nothing left in anyone''s bell', count(*) = 0, count(*)::text
  from notifications where series_id is not null and recipient_id = 'd5000000-0000-4000-8000-0000000000a2'
   and kind = 'co_host_invite';

-- Grants
insert into t_results select 'anon can''t call the @ list', not has_function_privilege('anon', 'public.meetup_mention_people(uuid, text)', 'execute'), '';
insert into t_results select 'members can''t claim pushes', not has_function_privilege('authenticated', 'public.push_claim(integer)', 'execute'), '';
insert into t_results select 'members can file reports', has_function_privilege('authenticated', 'public.file_report(uuid, uuid, uuid, public.report_reason, text, uuid, uuid)', 'execute'), '';
insert into t_results select 'members can call hide_meetup (it checks the role)', has_function_privilege('authenticated', 'public.hide_meetup(uuid, boolean)', 'execute'), '';

do $$ begin raise exception 'RESULTS ok=% of %; failed: %', (select count(*) filter (where ok) from t_results), (select count(*) from t_results),
  coalesce((select json_agg(t_results) from t_results where not ok)::text, 'none'); end $$;
