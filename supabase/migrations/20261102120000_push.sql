-- M4b, part 2: push notifications (Nov 1, night).
--
-- What this adds:
-- 1. Devices: each phone that allows notifications registers its Expo push
--    token, with its language (en, es, da or de) so the text arrives in the
--    phone's language. A token belongs to one member at a time: signing in
--    as someone else on the same phone moves it. Signing out removes it.
-- 2. Switches: one per type, all on by default (Settings › Push
--    notifications). They only decide what reaches the phone; the bell
--    still lists everything.
--      comments        comments on your post and replies to you
--      mentions        @mentions in a comment
--      tags, filmer_credits, invites
--      someone_new     someone joining or visiting your home city
--      park_fixes      your park info report accepted (M5; stored now)
--    Follows don't notify, so follow requests never push. Likes never
--    notify at all.
-- 3. The outbox: a new notification row, or a "say hi" / visiting
--    announcement in your home metro area, puts a row in a private outbox
--    for each member with a registered phone. Each batch of new rows pings
--    the `push-send` Edge Function through pg_net (fire and forget, so a
--    slow or missing function never holds up a comment or a post).
-- 4. Sending: `push-send` claims rows with push_claim(), which checks
--    everything again at send time (the notification still exists, the
--    comment isn't deleted, the post is still visible, nobody blocked
--    anybody, the switch is on) and returns the text's ingredients and the
--    phones to send to. push_done() marks rows sent and forgets tokens Expo
--    says are dead. Rows that fail are tried again on the next ping, up to
--    three times, for a day.
--
-- Additive: one extension (pg_net), private tables, new functions and
-- triggers. No existing rule, trigger or function is replaced or dropped.

create extension if not exists pg_net with schema extensions;

/* 1. Devices ------------------------------------------------------------------ */

create table if not exists private.push_devices (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  language text not null default 'en' check (language in ('en', 'es', 'da', 'de')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_devices_user_idx on private.push_devices (user_id);

-- Registers (or re-registers) this phone for the signed-in member.
create or replace function public.register_push_device(token text, platform text, language text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  lang text := case when language in ('en', 'es', 'da', 'de') then language else 'en' end;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$' then
    raise exception 'not an Expo push token' using errcode = '22023';
  end if;
  if platform not in ('ios', 'android') then
    raise exception 'unknown platform' using errcode = '22023';
  end if;
  insert into private.push_devices as d (token, user_id, platform, language)
  values (register_push_device.token, me, register_push_device.platform, lang)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        language = excluded.language,
        updated_at = now();
end $$;

-- Forgets this phone (on sign-out). Only your own phones.
create or replace function public.unregister_push_device(token text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from private.push_devices d
   where d.token = unregister_push_device.token and d.user_id = auth.uid();
$$;

/* 2. Switches ----------------------------------------------------------------- */

-- No row means everything is on.
create table if not exists private.push_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  comments boolean not null default true,
  mentions boolean not null default true,
  tags boolean not null default true,
  filmer_credits boolean not null default true,
  invites boolean not null default true,
  someone_new boolean not null default true,
  park_fixes boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.my_push_settings()
returns table (
  comments boolean,
  mentions boolean,
  tags boolean,
  filmer_credits boolean,
  invites boolean,
  someone_new boolean,
  park_fixes boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.comments, true), coalesce(s.mentions, true), coalesce(s.tags, true),
         coalesce(s.filmer_credits, true), coalesce(s.invites, true), coalesce(s.someone_new, true),
         coalesce(s.park_fixes, true)
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
    else raise exception 'unknown setting %', setting using errcode = '22023';
  end case;
end $$;

/* 3. The outbox ----------------------------------------------------------------- */

create table if not exists private.push_outbox (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  -- Exactly one of these. Deleting the notification or announcement drops
  -- the row, so a removed tag or deleted comment is never pushed late.
  notification_id uuid references public.notifications (id) on delete cascade,
  announcement_id uuid references public.announcements (id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  sent_at timestamptz,
  check ((notification_id is null) <> (announcement_id is null))
);

create index if not exists push_outbox_pending_idx on private.push_outbox (id) where sent_at is null;

-- Where push-send lives. A table, not a hard-coded string in a trigger, so
-- it can change without a migration.
create table if not exists private.push_config (
  id boolean primary key default true check (id),
  send_url text not null
);

insert into private.push_config (send_url)
values ('https://ytfdgacofenkehnbbhsc.supabase.co/functions/v1/push-send')
on conflict (id) do nothing;

-- A notification goes in the outbox if its recipient has a phone registered.
create or replace function private.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'park_report_accepted')
     and exists (select 1 from private.push_devices d where d.user_id = new.recipient_id) then
    insert into private.push_outbox (recipient_id, notification_id) values (new.recipient_id, new.id);
  end if;
  return null;
end $$;

create trigger notifications_push
  after insert on public.notifications
  for each row execute function private.enqueue_push_notification();

-- A "say hi" or visiting announcement goes to everyone with a phone
-- registered whose home metro area it's in, the same people who see it
-- under the bell.
create or replace function private.enqueue_push_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into private.push_outbox (recipient_id, announcement_id)
  select p.id, new.id
    from profiles p
   where p.home_metro_area_id = new.metro_area_id
     and p.id <> new.user_id
     and p.onboarded_at is not null
     and p.deleted_at is null
     and p.joined_at <= new.created_at
     and exists (select 1 from private.push_devices d where d.user_id = p.id)
     and not exists (
       select 1 from blocks b
        where (b.blocker_id = p.id and b.blocked_id = new.user_id)
           or (b.blocker_id = new.user_id and b.blocked_id = p.id)
     );
  return null;
end $$;

create trigger announcements_push
  after insert on public.announcements
  for each row execute function private.enqueue_push_announcement();

-- One ping per statement that adds outbox rows. Any failure here is
-- swallowed: the rows wait for the next ping instead.
create or replace function private.ping_push_send()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  url text;
begin
  select c.send_url into url from private.push_config c;
  if url is not null then
    perform net.http_post(
      url := url,
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
  end if;
  return null;
exception when others then
  return null;
end $$;

create trigger push_outbox_ping
  after insert on private.push_outbox
  for each statement execute function private.ping_push_send();

/* 4. Sending (Edge Function only) ------------------------------------------------- */

-- Claims up to `max_rows` pending rows and returns what push-send needs to
-- write each message. Rows that shouldn't go out any more come back with
-- send = false, so they're marked done too.
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
           c.body as cbody,
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

-- Marks rows sent and forgets tokens Expo reported as no longer registered.
create or replace function public.push_done(outbox_ids bigint[], dead_tokens text[] default '{}')
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update private.push_outbox set sent_at = now() where id = any (outbox_ids);
  delete from private.push_devices where token = any (coalesce(dead_tokens, '{}'));
$$;

/* Access --------------------------------------------------------------------------- */

revoke all on function public.register_push_device(text, text, text) from public, anon;
revoke all on function public.unregister_push_device(text) from public, anon;
revoke all on function public.my_push_settings() from public, anon;
revoke all on function public.set_push_setting(text, boolean) from public, anon;
revoke all on function public.push_claim(integer) from public, anon, authenticated;
revoke all on function public.push_done(bigint[], text[]) from public, anon, authenticated;
revoke all on function private.enqueue_push_notification() from public, anon, authenticated;
revoke all on function private.enqueue_push_announcement() from public, anon, authenticated;
revoke all on function private.ping_push_send() from public, anon, authenticated;

grant execute on function public.register_push_device(text, text, text) to authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;
grant execute on function public.my_push_settings() to authenticated;
grant execute on function public.set_push_setting(text, boolean) to authenticated;
grant execute on function public.push_claim(integer) to service_role;
grant execute on function public.push_done(bigint[], text[]) to service_role;
