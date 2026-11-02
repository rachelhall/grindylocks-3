-- Rolled-back check for 20261102110000_engagement.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
-- Members B, C and D are made up for the check; B is the post's author (not
-- the owner account, which can moderate every post).
begin;
-- M4b, part 1: hidden likes, comments and notifications (Nov 1).
--
-- What this adds:
-- 1. Comment checks: comments can't be edited (only deleted), a comment is
--    1–1000 characters, a reply must be to a live comment on the same post,
--    and "replying to @name" must name someone in that thread.
-- 2. Deleted comments: their text is never readable again (a restrictive
--    read rule), and their notifications are removed. A deleted comment
--    with live replies shows as "Comment deleted" through post_comments().
-- 3. Notifications, written by triggers (members can't write them):
--      comment        to the post's author, the comment being replied to,
--                     the person named in "replying to", and anyone
--                     @mentioned (up to 10 per comment). One per person
--                     per comment; nobody hears about their own comment.
--      tag            people tagged on a slide, once the post is published
--                     (or when tagged later). Once per person per post.
--      filmer_credit  the slide's filmer, the same way.
--    Nobody is notified about a post they can't see, by someone they've
--    blocked (or who blocked them), or after deleting their account.
--    Removing a tag or credit removes its notification.
-- 4. Reading:
--      post_comments()        a post's comments, oldest first, with
--                             "Comment deleted" placeholders
--      comment_count(posts)   computed field: live comments you can see
--      liked_by_me(posts)     computed field: whether you liked the post
--      my_notifications()     the bell list: comments on your post grouped
--                             by post, then replies, mentions, tags,
--                             filmer credits, "joined with your invite" and
--                             "someone new" in your city, newest first
--      notifications_unread() whether the bell gets its dot
--      mark_notifications_seen()  opening Notifications clears the dot
--    Like counts and who liked a post stay hidden (only the owner can read
--    likes, as before).
--
-- Additive: a private table, functions, triggers and one restrictive read
-- rule. No existing rule, trigger or function is replaced or dropped.

/* 1. Comment checks ------------------------------------------------------------ */

create or replace function private.guard_comment_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent comments%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- Only deleting (setting deleted_at) is allowed; nothing else changes.
    if new.body is distinct from old.body
       or new.post_id is distinct from old.post_id
       or new.author_id is distinct from old.author_id
       or new.parent_id is distinct from old.parent_id
       or new.reply_to_user_id is distinct from old.reply_to_user_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Comments can''t be edited';
    end if;
    return new;
  end if;

  new.body := btrim(new.body);
  if char_length(new.body) = 0 or char_length(new.body) > 1000 then
    raise exception 'Comments are 1 to 1000 characters';
  end if;
  new.created_at := now();
  new.deleted_at := null;

  if new.parent_id is not null then
    select * into parent from comments where id = new.parent_id;
    if not found or parent.post_id <> new.post_id or parent.deleted_at is not null then
      raise exception 'Reply to a comment on this post';
    end if;
  end if;

  if new.reply_to_user_id is not null then
    if new.parent_id is null or not exists (
      select 1 from comments c
       where (c.id = new.parent_id or c.parent_id = new.parent_id)
         and c.author_id = new.reply_to_user_id
         and c.deleted_at is null
    ) then
      raise exception 'You can only reply to someone in this thread';
    end if;
  end if;

  return new;
end $$;

create trigger comments_guard_write
  before insert or update on public.comments
  for each row execute function private.guard_comment_write();

/* 2. Deleted comments stay unreadable ----------------------------------------- */

create policy "deleted comments are not readable"
  on public.comments
  as restrictive
  for select
  to authenticated
  using (deleted_at is null or private.can_moderate_post(post_id));

/* 3. Notifications ------------------------------------------------------------- */

-- Whether `viewer` can see a published post, by the same rules as
-- can_see_post() but for someone other than the caller.
create or replace function private.can_see_post_as(post uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from posts p
      join profiles a on a.id = p.author_id
     where p.id = post
       and p.published_at is not null
       and p.status = 'visible'
       and (
         p.author_id = viewer
         or (
           not exists (
             select 1 from blocks b
              where (b.blocker_id = viewer and b.blocked_id = p.author_id)
                 or (b.blocker_id = p.author_id and b.blocked_id = viewer)
           )
           and (
             not a.is_private
             or exists (
               select 1 from follows f
                where f.follower_id = viewer and f.followee_id = p.author_id and f.status = 'accepted'
             )
           )
         )
       )
  );
$$;

-- Writes one notification, unless it would be about yourself, to a deleted
-- or unfinished account, between blocked people, about a post the recipient
-- can't see, or a repeat of a tag or credit they already heard about.
create or replace function private.notify(
  recipient uuid,
  what public.notification_kind,
  actor uuid,
  post uuid,
  comment uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if recipient is null or recipient = actor then
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
  if post is not null and not private.can_see_post_as(post, recipient) then
    return;
  end if;
  if comment is null and exists (
    select 1 from notifications
     where recipient_id = recipient and kind = what and post_id is not distinct from post
  ) then
    return;
  end if;
  insert into notifications (recipient_id, kind, actor_id, post_id, comment_id)
  values (recipient, what, actor, post, comment);
end $$;

-- A new comment notifies the post's author, the thread it replies to, the
-- person it's replying to and anyone @mentioned, each once.
create or replace function private.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  done uuid[] := array[new.author_id];
  person uuid;
begin
  for person in
    select candidate
      from (
        select 1 as rank, (select author_id from posts where id = new.post_id) as candidate
        union all
        select 2, (select author_id from comments where id = new.parent_id)
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
      perform private.notify(person, 'comment', new.author_id, new.post_id, new.id);
      done := done || person;
    end if;
  end loop;
  return null;
end $$;

create trigger comments_notify
  after insert on public.comments
  for each row execute function private.notify_comment();

-- A deleted comment takes its notifications with it.
create or replace function private.unnotify_deleted_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from notifications where comment_id = new.id;
  end if;
  return null;
end $$;

create trigger comments_unnotify_deleted
  after update of deleted_at on public.comments
  for each row execute function private.unnotify_deleted_comment();

-- When a post is published, everyone tagged or credited on it hears about it.
create or replace function private.notify_post_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid;
begin
  if new.published_at is not null and old.published_at is null then
    for person in
      select distinct t.user_id
        from slide_people_tags t
        join post_slides s on s.id = t.slide_id
       where s.post_id = new.id
    loop
      perform private.notify(person, 'tag', new.author_id, new.id);
    end loop;
    for person in
      select distinct s.filmer_id from post_slides s where s.post_id = new.id and s.filmer_id is not null
    loop
      perform private.notify(person, 'filmer_credit', new.author_id, new.id);
    end loop;
  end if;
  return null;
end $$;

create trigger posts_notify_published
  after update of published_at on public.posts
  for each row execute function private.notify_post_published();

-- Tags and credits added after publishing (Edit post) notify too; ones
-- removed take their notification away once the person is off the post.
create or replace function private.notify_tag_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  the_post uuid;
  the_author uuid;
begin
  if tg_op = 'INSERT' then
    select p.id, p.author_id into the_post, the_author
      from post_slides s join posts p on p.id = s.post_id
     where s.id = new.slide_id and p.published_at is not null;
    if the_post is not null then
      perform private.notify(new.user_id, 'tag', the_author, the_post);
    end if;
  else
    select s.post_id into the_post from post_slides s where s.id = old.slide_id;
    if the_post is not null and not exists (
      select 1 from slide_people_tags t join post_slides s on s.id = t.slide_id
       where s.post_id = the_post and t.user_id = old.user_id
    ) then
      delete from notifications where recipient_id = old.user_id and kind = 'tag' and post_id = the_post;
    end if;
  end if;
  return null;
end $$;

create trigger slide_people_tags_notify
  after insert or delete on public.slide_people_tags
  for each row execute function private.notify_tag_change();

create or replace function private.notify_filmer_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  the_author uuid;
begin
  if new.filmer_id is not distinct from old.filmer_id then
    return null;
  end if;
  if new.filmer_id is not null then
    select author_id into the_author from posts where id = new.post_id and published_at is not null;
    if the_author is not null then
      perform private.notify(new.filmer_id, 'filmer_credit', the_author, new.post_id);
    end if;
  end if;
  if old.filmer_id is not null and not exists (
    select 1 from post_slides where post_id = new.post_id and filmer_id = old.filmer_id
  ) then
    delete from notifications
     where recipient_id = old.filmer_id and kind = 'filmer_credit' and post_id = new.post_id;
  end if;
  return null;
end $$;

create trigger post_slides_notify_filmer
  after update of filmer_id on public.post_slides
  for each row execute function private.notify_filmer_change();

/* 4. Reading ---------------------------------------------------------------------- */

-- A post's comments, oldest first. Deleted ones only show (as placeholders,
-- with no author or text) when they still have live replies. Comments by
-- people you've blocked, or who blocked you, are left out.
create or replace function public.post_comments(post uuid)
returns table (
  id uuid,
  parent_id uuid,
  author_id uuid,
  username text,
  avatar_path text,
  body text,
  reply_to_username text,
  is_poster boolean,
  deleted boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.parent_id,
         case when c.deleted_at is null then c.author_id end,
         case when c.deleted_at is null and a.deleted_at is null then a.username::text end,
         case when c.deleted_at is null and a.deleted_at is null then a.avatar_path end,
         case when c.deleted_at is null then c.body end,
         case when c.deleted_at is null and r.deleted_at is null then r.username::text end,
         c.deleted_at is null and c.author_id = p.author_id and not p.anonymized,
         c.deleted_at is not null,
         c.created_at
    from comments c
    join posts p on p.id = c.post_id
    left join profiles a on a.id = c.author_id
    left join profiles r on r.id = c.reply_to_user_id
   where c.post_id = post
     and private.can_see_post(post)
     and (c.author_id = auth.uid() or not private.blocked_between(c.author_id))
     and (
       c.deleted_at is null
       or (c.parent_id is null and exists (
             select 1 from comments x
              where x.parent_id = c.id and x.deleted_at is null
                and (x.author_id = auth.uid() or not private.blocked_between(x.author_id))
           ))
     )
   order by c.created_at, c.id;
$$;

-- Computed fields on posts (PostgREST selects them like columns).
create or replace function public.comment_count(public.posts)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
    from comments c
   where c.post_id = $1.id
     and c.deleted_at is null
     and (c.author_id = (select auth.uid()) or not private.blocked_between(c.author_id));
$$;

create or replace function public.liked_by_me(public.posts)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from likes where post_id = $1.id and user_id = (select auth.uid()));
$$;

-- When each member last opened Notifications. Kept out of profiles, which
-- other members can read.
create table if not exists private.notifications_seen (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);

-- The bell list, newest first (up to 100 rows):
--   comment         comments on your post, one row per post, with the last
--                   few people and how many commented
--   reply           someone replied to you, or in a thread you started
--   mention         someone @mentioned you
--   tag, filmer_credit, invite_used
--   someone_new     a member who joined your home metro area since you
--                   joined, and chose to say hi
--   visiting        a member visiting your home metro area (and which
--                   park, if they said)
-- Follow requests are read separately (my_follow_requests()).
create or replace function public.my_notifications()
returns table (
  id text,
  kind text,
  created_at timestamptz,
  actors jsonb,
  actor_count integer,
  post_id uuid,
  comment_id uuid,
  comment_body text,
  park_slug text,
  park_name text,
  metro_name text,
  unread boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    -- Comments on your post: one row per post.
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
  order by 3 desc
  limit 100;
end $$;

-- Whether the bell shows its dot: anything in the list, or a follow
-- request, newer than the last time Notifications was opened.
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

create or replace function public.mark_notifications_seen()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into private.notifications_seen (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = excluded.seen_at;
  update notifications set read_at = now() where recipient_id = auth.uid() and read_at is null;
$$;

revoke all on function public.post_comments(uuid) from public, anon;
revoke all on function public.comment_count(public.posts) from public, anon;
revoke all on function public.liked_by_me(public.posts) from public, anon;
revoke all on function public.my_notifications() from public, anon;
revoke all on function public.notifications_unread() from public, anon;
revoke all on function public.mark_notifications_seen() from public, anon;
revoke all on function private.can_see_post_as(uuid, uuid) from public, anon, authenticated;
revoke all on function private.notify(uuid, public.notification_kind, uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.post_comments(uuid) to authenticated;
grant execute on function public.comment_count(public.posts) to authenticated;
grant execute on function public.liked_by_me(public.posts) to authenticated;
grant execute on function public.my_notifications() to authenticated;
grant execute on function public.notifications_unread() to authenticated;
grant execute on function public.mark_notifications_seen() to authenticated;

create index if not exists notifications_comment_idx on public.notifications (comment_id);
create index if not exists comments_reply_to_idx on public.comments (reply_to_user_id);

create temp table t_results(step text, ok boolean, detail text);
grant all on t_results to authenticated;
insert into auth.users (id, email, aud, role, instance_id) values
 ('b0000000-0000-4000-8000-0000000000b0','m4b-b@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('b0000000-0000-4000-8000-0000000000c0','m4b-c@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('b0000000-0000-4000-8000-0000000000d0','m4b-d@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at) values
 ('b0000000-0000-4000-8000-0000000000b0','m4b_bee', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now()),
 ('b0000000-0000-4000-8000-0000000000c0','m4b_cee', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now()),
 ('b0000000-0000-4000-8000-0000000000d0','m4b_dee', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{quad}', now());

set local role authenticated;
-- B posts one photo, tagging C as a person and as the filmer.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b0","role":"authenticated"}', true);
insert into posts (id, author_id, metro_area_id, slide_count) values ('a0000000-0000-4000-8000-0000000000f1','b0000000-0000-4000-8000-0000000000b0','93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925',1);
insert into post_slides (id, post_id, position, kind, storage_path, width, height, upload_status) values
 ('c0000000-0000-4000-8000-0000000000f1','a0000000-0000-4000-8000-0000000000f1',0,'photo','b0000000-0000-4000-8000-0000000000b0/a0000000-0000-4000-8000-0000000000f1/c0000000-0000-4000-8000-0000000000f1.jpg',1000,800,'uploading');
select set_slide_tags('c0000000-0000-4000-8000-0000000000f1',null,'rail','b0000000-0000-4000-8000-0000000000c0',array['b0000000-0000-4000-8000-0000000000c0'::uuid]);

reset role;
select set_config('request.jwt.claims', '', true);
insert into t_results select 'no tag notice before publishing', count(*)=0, count(*)::text from notifications where recipient_id='b0000000-0000-4000-8000-0000000000c0';
update post_slides set upload_status='ready' where post_id='a0000000-0000-4000-8000-0000000000f1';
insert into t_results select 'tag and credit notices on publish', count(*)=2 and bool_and(actor_id='b0000000-0000-4000-8000-0000000000b0'), string_agg(kind::text, ',') from notifications where recipient_id='b0000000-0000-4000-8000-0000000000c0';

set local role authenticated;
-- C comments, mentioning D and the owner (grindylocks).
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000c0","role":"authenticated"}', true);
insert into comments (id, post_id, author_id, body) values ('e0000000-0000-4000-8000-0000000000e1','a0000000-0000-4000-8000-0000000000f1','b0000000-0000-4000-8000-0000000000c0','  so clean @m4b_dee @grindylocks @m4b_cee  ');
insert into t_results select 'comment body trimmed', body = 'so clean @m4b_dee @grindylocks @m4b_cee', body from comments where id='e0000000-0000-4000-8000-0000000000e1';
do $$ begin update comments set body='edited' where id='e0000000-0000-4000-8000-0000000000e1'; insert into t_results values('comments cannot be edited',false,'no error'); exception when others then insert into t_results values('comments cannot be edited',true,sqlerrm); end $$;
do $$ begin insert into comments (post_id, author_id, body) values ('a0000000-0000-4000-8000-0000000000f1','b0000000-0000-4000-8000-0000000000c0','   '); insert into t_results values('empty comment refused',false,'no error'); exception when others then insert into t_results values('empty comment refused',true,sqlerrm); end $$;
do $$ begin insert into comments (post_id, author_id, body, parent_id, reply_to_user_id) values ('a0000000-0000-4000-8000-0000000000f1','b0000000-0000-4000-8000-0000000000c0','hey','e0000000-0000-4000-8000-0000000000e1','b0000000-0000-4000-8000-0000000000d0'); insert into t_results values('replying to someone outside the thread refused',false,'no error'); exception when others then insert into t_results values('replying to someone outside the thread refused',true,sqlerrm); end $$;

reset role;
select set_config('request.jwt.claims', '', true);
insert into t_results select 'post author notified of comment', count(*)=1, count(*)::text from notifications where recipient_id='b0000000-0000-4000-8000-0000000000b0' and kind='comment';
insert into t_results select 'mentions notified', count(*)=2, string_agg(recipient_id::text, ',') from notifications where comment_id='e0000000-0000-4000-8000-0000000000e1' and recipient_id in ('b0000000-0000-4000-8000-0000000000d0','08b422ac-9f87-4c0f-b979-29ecdd41ed5b');
insert into t_results select 'no notice for mentioning yourself', count(*)=0, count(*)::text from notifications where comment_id='e0000000-0000-4000-8000-0000000000e1' and recipient_id='b0000000-0000-4000-8000-0000000000c0';

set local role authenticated;
-- B replies to C.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b0","role":"authenticated"}', true);
insert into comments (id, post_id, author_id, body, parent_id, reply_to_user_id) values ('e0000000-0000-4000-8000-0000000000e2','a0000000-0000-4000-8000-0000000000f1','b0000000-0000-4000-8000-0000000000b0','thanks!','e0000000-0000-4000-8000-0000000000e1','b0000000-0000-4000-8000-0000000000c0');
do $$ begin insert into comments (post_id, author_id, body, parent_id) values ('a0000000-0000-4000-8000-0000000000f1','b0000000-0000-4000-8000-0000000000b0','deeper','e0000000-0000-4000-8000-0000000000e2'); insert into t_results values('replies stay one level',false,'no error'); exception when others then insert into t_results values('replies stay one level',true,sqlerrm); end $$;
insert into t_results select 'comment count', comment_count(p)=2, comment_count(p)::text from posts p where id='a0000000-0000-4000-8000-0000000000f1';
insert into t_results select 'not liked yet', not liked_by_me(p), '' from posts p where id='a0000000-0000-4000-8000-0000000000f1';
insert into likes (post_id, user_id) values ('a0000000-0000-4000-8000-0000000000f1','b0000000-0000-4000-8000-0000000000b0');
insert into t_results select 'liked', liked_by_me(p), '' from posts p where id='a0000000-0000-4000-8000-0000000000f1';
insert into t_results select 'grouped comment row for the poster', count(*)=1 and min(actor_count)=1 and min(actors->0->>'username')='m4b_cee', coalesce(string_agg(kind||':'||actors::text, ' | '), 'none') from my_notifications() where kind='comment';
insert into t_results select 'poster unread before opening', notifications_unread(), '';
select mark_notifications_seen();
insert into t_results select 'poster dot cleared after opening', not notifications_unread(), '';

-- C sees the reply, tag and credit; D sees the mention; C sees D's hello.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000d0","role":"authenticated"}', true);
insert into t_results select 'mention shown as mention', count(*)=1, coalesce(string_agg(kind, ','), 'none') from my_notifications() where kind='mention';
insert into announcements (user_id, kind, metro_area_id) values ('b0000000-0000-4000-8000-0000000000d0','joined','93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925');
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000c0","role":"authenticated"}', true);
insert into t_results select 'reply, tag, credit and hello for C', count(*) filter (where kind='reply')=1 and count(*) filter (where kind='tag')=1 and count(*) filter (where kind='filmer_credit')=1 and count(*) filter (where kind='someone_new')=1, string_agg(kind, ',') from my_notifications();
insert into t_results select 'nobody sees likes of others', count(*)=0, count(*)::text from likes where post_id='a0000000-0000-4000-8000-0000000000f1';

-- C deletes their comment: placeholder (it has a reply), text unreadable, notices gone.
update comments set deleted_at = now() where id='e0000000-0000-4000-8000-0000000000e1';
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b0","role":"authenticated"}', true);
insert into t_results select 'deleted comment is a placeholder', count(*)=2 and bool_or(deleted and body is null and username is null), string_agg(coalesce(body,'<deleted>'), ',') from post_comments('a0000000-0000-4000-8000-0000000000f1');
insert into t_results select 'deleted comment text unreadable', count(*)=0, count(*)::text from comments where id='e0000000-0000-4000-8000-0000000000e1';
insert into t_results select 'deleted comment not counted', comment_count(p)=1, comment_count(p)::text from posts p where id='a0000000-0000-4000-8000-0000000000f1';
reset role;
select set_config('request.jwt.claims', '', true);
insert into t_results select 'deleted comment notices removed', count(*)=0, count(*)::text from notifications where comment_id='e0000000-0000-4000-8000-0000000000e1';

-- Private author: someone who can't see the post isn't told about it.
update profiles set is_private = true where id='b0000000-0000-4000-8000-0000000000b0';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b0","role":"authenticated"}', true);
insert into comments (post_id, author_id, body) values ('a0000000-0000-4000-8000-0000000000f1','b0000000-0000-4000-8000-0000000000b0','@m4b_dee you should come');
reset role;
select set_config('request.jwt.claims', '', true);
insert into t_results select 'no notice about a post you cannot see', count(*)=1, count(*)::text from notifications where recipient_id='b0000000-0000-4000-8000-0000000000d0';

-- Blocks: once C blocks B, nothing from B reaches C (C already has one
-- notice for B's reply, from before the block; no second one is added).
insert into blocks (blocker_id, blocked_id) values ('b0000000-0000-4000-8000-0000000000c0','b0000000-0000-4000-8000-0000000000b0');
select private.notify('b0000000-0000-4000-8000-0000000000c0','comment','b0000000-0000-4000-8000-0000000000b0',null,'e0000000-0000-4000-8000-0000000000e2');
insert into t_results select 'no notice between blocked people', count(*)=1, count(*)::text from notifications where recipient_id='b0000000-0000-4000-8000-0000000000c0' and comment_id='e0000000-0000-4000-8000-0000000000e2';

-- Taking yourself off a post removes the tag notice.
delete from blocks where blocker_id='b0000000-0000-4000-8000-0000000000c0';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000c0","role":"authenticated"}', true);
delete from slide_people_tags where slide_id='c0000000-0000-4000-8000-0000000000f1' and user_id='b0000000-0000-4000-8000-0000000000c0';
select remove_my_filmer_credit('c0000000-0000-4000-8000-0000000000f1');
reset role;
select set_config('request.jwt.claims', '', true);
insert into t_results select 'tag and credit notices removed', count(*)=0, string_agg(kind::text, ',') from notifications where recipient_id='b0000000-0000-4000-8000-0000000000c0' and kind in ('tag','filmer_credit');

do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
