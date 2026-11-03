-- Meetups (v2), part 4: where meetups show.
-- PRD: Grindylocks — Meetups PRD (Nov 3). Mockups: the Meetups (v2) row
-- (Meet-Home, Meet-Park, Meet-Profile-B, Meet-Past, Meet-Post-Chip).
--
-- 1. Computed fields on `events`, so every list reads dates with one
--    PostgREST select: the count going (or "went"), up to three faces for
--    the card, whether you're going, the hosts, the comment count, how many
--    posts are linked, and the date's place in Home.
-- 2. Which dates are listed. Ending a whole series cancels every date left,
--    so only the first of those shows; the rest would pile up as crossed-out
--    weeks.
-- 3. Home (feed_meetups): a date's card appears once, at its feed time, for
--    its hosts and for people who follow the host, an accepted co-host or
--    the series. A one-off's feed time is when it was posted. In a series,
--    the first date's is when the series was posted and each later date's is
--    when the date before it ends, so a weekly meetup brings one card a
--    week and nothing is pushed back up on the day.
-- 4. Park pages and profiles (park_meetups, park_past_meetups,
--    profile_meetups, profile_past_meetups): Upcoming shows each series
--    once, at its next date; Past shows every date, newest first. A profile
--    lists the meetups the person hosts or co-hosts.
-- 5. Checking in from your own profile (check_in_parks): parks within about
--    500 m of where the phone is now, nearest first. The position isn't
--    stored; check_in() still makes the real check.
--
-- Every list function runs as the caller (security invoker), so the
-- existing read rules on `events` decide what's visible; hidden dates are
-- left out for everyone but their hosts.
--
-- Additive: new functions only. Nothing existing is replaced or dropped.

/* 1. Computed fields ------------------------------------------------------------- */

-- When the date takes its place in Home (see the header).
create or replace function public.feed_at(public.events)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    s.created_at,
    coalesce((select max(x.ends_at) from events x where x.series_id = $1.series_id and x.starts_at < $1.starts_at), s.created_at)
  )
    from event_series s where s.id = $1.series_id;
$$;

-- Everyone going, hosts included; once the date has ended, the count kept on it.
create or replace function public.going_total(public.events)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    $1.went_count,
    (select count(*) from event_hosts h where h.series_id = $1.series_id and (h.role = 'host' or h.accepted_at is not null))::integer
      + (select count(*) from event_going g where g.event_id = $1.id)::integer
  );
$$;

-- Up to three people the caller may see by name, people they follow first,
-- for the card's row of faces. Empty once the date has ended (the list is
-- for hosts only then).
create or replace function public.going_faces(public.events)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.user_id, 'username', f.username, 'avatar_path', f.avatar_path,
                                               'following', f.following) order by f.n), '[]'::jsonb)
    from (
      select l.*, row_number() over (order by l.following desc, (l.user_id = auth.uid()), case l.role when 'host' then 0 when 'co_host' then 1 else 2 end, l.username) as n
        from public.event_going_list($1.id) l
       where $1.ends_at > now()
    ) f
   where f.n <= 3;
$$;

create or replace function public.i_am_going(public.events)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from event_going g where g.event_id = $1.id and g.user_id = auth.uid())
      or private.hosts_series($1.series_id);
$$;

-- The host, then accepted co-hosts in the order they accepted.
create or replace function public.host_list(public.events)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'role', h.role)
                            order by h.role = 'host' desc, h.accepted_at), '[]'::jsonb)
    from event_hosts h
    join profiles p on p.id = h.user_id and p.deleted_at is null
   where h.series_id = $1.series_id and (h.role = 'host' or h.accepted_at is not null);
$$;

-- Comments the caller can see (the comment read rules apply).
create or replace function public.meetup_comment_count(public.events)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
    from event_comments c
   where c.event_id = $1.id
     and c.deleted_at is null
     and (c.author_id = (select auth.uid()) or not private.blocked_between(c.author_id));
$$;

-- Linked posts the caller can see (the post read rules apply).
create or replace function public.linked_post_count(public.events)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
    from posts p
   where p.event_id = $1.id and p.status = 'visible' and p.published_at is not null;
$$;

/* 2. Which dates are listed ------------------------------------------------------ */

-- False for dates cancelled when the host ended the whole series, except
-- the first of them (it shows crossed out where the series used to be).
create or replace function private.meetup_listed(e public.events)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from event_series s
     where s.id = e.series_id
       and s.ended_at is not null
       and e.status = 'cancelled'
       and e.cancelled_at = s.ended_at
       and exists (select 1 from events x
                    where x.series_id = s.id and x.status = 'cancelled'
                      and x.cancelled_at = s.ended_at and x.starts_at < e.starts_at)
  );
$$;

-- Hidden dates only reach their hosts in lists.
create or replace function private.meetup_shown(e public.events)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (e.hidden_at is null or private.hosts_series(e.series_id)) and private.meetup_listed(e);
$$;

/* 3. Home ------------------------------------------------------------------------ */

-- Dates whose feed time falls in (newer_than, up_to], newest first. Home
-- asks for the window each page of posts covers, so cards sit among posts
-- by time.
create or replace function public.feed_meetups(
  newer_than timestamptz default null,
  up_to timestamptz default null,
  max_results integer default 20
)
returns setof public.events
language sql
stable
security invoker
set search_path = public
as $$
  select e.*
    from events e
   where private.meetup_shown(e)
     and (
       private.hosts_series(e.series_id)
       or exists (
         select 1 from event_hosts h
           join follows f on f.followee_id = h.user_id and f.follower_id = (select auth.uid()) and f.status = 'accepted'
          where h.series_id = e.series_id and (h.role = 'host' or h.accepted_at is not null)
       )
       or exists (select 1 from event_series_follows sf where sf.series_id = e.series_id and sf.user_id = (select auth.uid()))
     )
     and public.feed_at(e) <= now()
     and (newer_than is null or public.feed_at(e) > newer_than)
     and (up_to is null or public.feed_at(e) <= up_to)
   order by public.feed_at(e) desc, e.id desc
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

/* 4. Park pages and profiles ----------------------------------------------------- */

-- Upcoming at a park: each series once, at its next date (scheduled or
-- cancelled), soonest first.
create or replace function public.park_meetups(park uuid, max_results integer default 5)
returns setof public.events
language sql
stable
security invoker
set search_path = public
as $$
  select * from (
    select distinct on (e.series_id) e.*
      from events e
     where e.park_id = park_meetups.park and e.ends_at > now() and private.meetup_shown(e)
     order by e.series_id, e.starts_at
  ) up
   order by up.starts_at, up.id
   limit least(greatest(coalesce(max_results, 5), 1), 50);
$$;

-- Past at a park: every date that has ended, newest first, paged on
-- (starts_at, id).
create or replace function public.park_past_meetups(
  park uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  max_results integer default 10
)
returns setof public.events
language sql
stable
security invoker
set search_path = public
as $$
  select e.*
    from events e
   where e.park_id = park_past_meetups.park and e.ends_at <= now() and private.meetup_shown(e)
     and (before_at is null
          or (e.starts_at, e.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by e.starts_at desc, e.id desc
   limit least(greatest(coalesce(max_results, 10), 1), 50);
$$;

-- For the collapsed row ("Past meetups 6").
create or replace function public.park_past_meetup_count(park uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::integer
    from events e
   where e.park_id = park_past_meetup_count.park and e.ends_at <= now() and private.meetup_shown(e);
$$;

-- Series a member hosts or co-hosts (accepted).
create or replace function private.hosted_by(person uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select h.series_id from event_hosts h
   where h.user_id = person and (h.role = 'host' or h.accepted_at is not null);
$$;

-- A profile's Upcoming, like park_meetups.
create or replace function public.profile_meetups(person uuid, max_results integer default 20)
returns setof public.events
language sql
stable
security invoker
set search_path = public
as $$
  select * from (
    select distinct on (e.series_id) e.*
      from events e
     where e.series_id in (select private.hosted_by(profile_meetups.person))
       and e.ends_at > now() and private.meetup_shown(e)
     order by e.series_id, e.starts_at
  ) up
   order by up.starts_at, up.id
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- A profile's Past, like park_past_meetups.
create or replace function public.profile_past_meetups(
  person uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  max_results integer default 20
)
returns setof public.events
language sql
stable
security invoker
set search_path = public
as $$
  select e.*
    from events e
   where e.series_id in (select private.hosted_by(profile_past_meetups.person))
     and e.ends_at <= now() and private.meetup_shown(e)
     and (before_at is null
          or (e.starts_at, e.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by e.starts_at desc, e.id desc
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

/* 5. Checking in from your own profile ------------------------------------------- */

-- Parks within about 500 m of the phone, nearest first. Nothing is stored.
create or replace function public.check_in_parks(latitude double precision, longitude double precision)
returns table (id uuid, slug text, display_name text, distance_m double precision)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select p.id, p.slug, p.display_name,
         st_distance(p.location, st_setsrid(st_makepoint(check_in_parks.longitude, check_in_parks.latitude), 4326)::geography)
    from parks p
   where check_in_parks.latitude between -90 and 90 and check_in_parks.longitude between -180 and 180
     and p.location is not null
     and st_dwithin(p.location, st_setsrid(st_makepoint(check_in_parks.longitude, check_in_parks.latitude), 4326)::geography, 500)
   order by 4
   limit 10;
$$;

/* Grants ------------------------------------------------------------------------- */

-- The private helpers keep the default grants, like the other meetup
-- helpers the read rules call.
revoke all on function public.feed_at(public.events), public.going_total(public.events), public.going_faces(public.events),
  public.i_am_going(public.events), public.host_list(public.events), public.meetup_comment_count(public.events),
  public.linked_post_count(public.events),
  public.feed_meetups(timestamptz, timestamptz, integer),
  public.park_meetups(uuid, integer),
  public.park_past_meetups(uuid, timestamptz, uuid, integer),
  public.park_past_meetup_count(uuid),
  public.profile_meetups(uuid, integer),
  public.profile_past_meetups(uuid, timestamptz, uuid, integer),
  public.check_in_parks(double precision, double precision) from public, anon;

grant execute on function public.feed_at(public.events), public.going_total(public.events), public.going_faces(public.events),
  public.i_am_going(public.events), public.host_list(public.events), public.meetup_comment_count(public.events),
  public.linked_post_count(public.events),
  public.feed_meetups(timestamptz, timestamptz, integer),
  public.park_meetups(uuid, integer),
  public.park_past_meetups(uuid, timestamptz, uuid, integer),
  public.park_past_meetup_count(uuid),
  public.profile_meetups(uuid, integer),
  public.profile_past_meetups(uuid, timestamptz, uuid, integer),
  public.check_in_parks(double precision, double precision) to authenticated;
