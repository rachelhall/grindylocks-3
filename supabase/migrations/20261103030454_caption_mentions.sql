-- v2, caption mentions (Nov 2; Mentions (v2) mockups approved the same day).
--
-- Someone @mentioned in a post's caption hears about it, like a comment
-- mention: a notification under the bell and a push (the Mentions push
-- switch covers both).
--
-- - Up to 10 people per caption, matched by username the same way comment
--   mentions are.
-- - Sent when the post is published, and when a published post's caption is
--   edited. Once per person per post: people already mentioned aren't told
--   again. Someone taken out of the caption loses the notification quietly,
--   the way removed tags do; they aren't told.
-- - People tagged on a slide or credited as filmer already heard about the
--   post, so a caption mention doesn't notify them a second time.
-- - private.notify() keeps the usual checks: nobody hears about their own
--   post, a post they can't see, or from someone blocked either way.
--
-- my_notifications() and push_claim() are the current versions with only the
-- new kind added (the caption standing in for the comment text);
-- enqueue_push_notification() just adds the kind to its list.

/* 1. Who a caption mentions ----------------------------------------------------- */

create or replace function private.caption_mentioned(body text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
    from (
      select distinct p.id
        from regexp_matches(coalesce(body, ''), '@([A-Za-z0-9._]{2,30})', 'g') as r(m)
        join profiles p on lower(p.username::text) = lower(r.m[1])
       limit 10
    ) m;
$$;

/* 2. Notifying ------------------------------------------------------------------- */

create or replace function private.notify_caption_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid;
begin
  if new.published_at is null then
    return null;
  end if;
  -- Already published and the caption didn't change: nothing to do.
  if tg_op = 'UPDATE' and old.published_at is not null
     and new.caption is not distinct from old.caption then
    return null;
  end if;
  -- Edited out of the caption: the notification goes, quietly.
  if tg_op = 'UPDATE' and old.published_at is not null then
    delete from notifications n
     where n.post_id = new.id
       and n.kind = 'caption_mention'
       and n.recipient_id not in (select x from private.caption_mentioned(new.caption) as x);
  end if;
  for person in select x from private.caption_mentioned(new.caption) as x loop
    -- Tagged or credited on this post: they've heard about it already.
    if exists (
      select 1 from post_slides s
       where s.post_id = new.id
         and (s.filmer_id = person
              or exists (select 1 from slide_people_tags t where t.slide_id = s.id and t.user_id = person))
    ) then
      continue;
    end if;
    -- notify() skips repeats: one caption mention per person per post.
    perform private.notify(person, 'caption_mention', new.author_id, new.id);
  end loop;
  return null;
end $$;

create trigger posts_notify_caption_mentions
  after insert or update of published_at, caption on public.posts
  for each row execute function private.notify_caption_mentions();

/* 3. The bell: caption mentions, with the caption as the snippet ------------------ */

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

/* 4. Push: queued and sent like comment mentions ------------------------------ */

create or replace function private.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'park_report_accepted', 'caption_mention')
     and exists (select 1 from private.push_devices d where d.user_id = new.recipient_id) then
    insert into private.push_outbox (recipient_id, notification_id) values (new.recipient_id, new.id);
  end if;
  return null;
end $$;

create or replace function public.push_claim(max_rows integer default 100)
returns table (
  outbox_id bigint,
  send boolean,
  kind text,
  actor_username text,
  comment_body text,
  post_id uuid,
  park_name text,
  metro_name text,
  devices jsonb
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
             when n.kind <> 'comment' then n.kind::text
             when c.reply_to_user_id = cl.recipient_id
               or (select pc.author_id from comments pc where pc.id = c.parent_id) = cl.recipient_id then 'reply'
             when p.author_id = cl.recipient_id then 'comment'
             else 'mention'
           end as k,
           n.actor_id as aid,
           a.username::text as uname,
           case when n.kind = 'caption_mention' then p.caption else c.body end as cbody,
           n.post_id as pid,
           null::text as pk,
           null::text as metro,
           (n.id is not null
             and (n.comment_id is null or (c.id is not null and c.deleted_at is null))
             and (n.post_id is null or private.can_see_post_as(n.post_id, cl.recipient_id))
             and (a.id is null or a.deleted_at is null)) as ok
      from claimed cl
      left join notifications n on n.id = cl.notification_id
      left join comments c on c.id = n.comment_id
      left join posts p on p.id = n.post_id
      left join profiles a on a.id = n.actor_id
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
           ma.name::text,
           (an.id is not null
             and u.deleted_at is null
             and u.banned_at is null
             and r.home_metro_area_id = an.metro_area_id)
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
                 else false
               end
           and dv.list is not null),
         e.k,
         e.uname,
         left(e.cbody, 140),
         e.pid,
         e.pk,
         e.metro,
         coalesce(dv.list, '[]'::jsonb)
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

revoke all on function private.caption_mentioned(text) from public, anon, authenticated;
revoke all on function private.notify_caption_mentions() from public, anon, authenticated;
