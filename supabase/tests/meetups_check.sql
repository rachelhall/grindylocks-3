-- Rolled-back check for 20261103060000_meetups.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
begin;
-- Meetups (v2), part 1: the data model, access rules and functions.
-- PRD: Grindylocks — Meetups PRD (Nov 3). Mockups: the Meetups (v2) row.
--
-- One model for everything the app calls a meetup (`events` in the code):
--
--   event_series          the meetup itself: host, visibility, the repeat
--                         rule (weekdays, start time, length, seasons). A
--                         one-off meetup is a series with no weekdays and
--                         one date, so hosts, co-hosts and follows always
--                         hang off the series.
--   event_series_seasons  "Fælled May–Sept, Xhall Oct–April": each date's
--                         park comes from the season its month falls in.
--   events                one row per date (occurrence), with its own park,
--                         times, title, note, cover and status, so one
--                         Thursday can be moved or rained out alone.
--   event_hosts           the host and co-hosts (co-hosts accept first).
--   event_going           "I'm going", per date. Hosts are implicitly on
--                         every date and never have a row. Rows are deleted
--                         a week after the date ends; the count stays on
--                         the date as went_count.
--   event_series_follows  following a repeating meetup to see each new date.
--   event_comments        comments on a date, one level of replies.
--   check_ins             Here now: one per member, 3 hours, no history.
--   posts.event_id        "From Thursday's meetup?"
--   profiles.going_privately_default
--                         the account default for Going privately; null
--                         means "on for private accounts, off otherwise".
--
-- Who can see what (all enforced here, both apps just call these):
--   * A meetup is visible to its hosts, and otherwise to anyone not blocked
--     with the host or an accepted co-host: Public meetups to every member,
--     Followers only meetups to people who follow the host or a co-host.
--     Hidden dates (park admins, part 5) show only to hosts and moderators.
--   * The going list: hosts first, then people you follow, then everyone
--     else. Private accounts are named only to hosts and their followers;
--     Going privately names you to hosts only; blocked people are never
--     named to each other. The count includes everyone. After a date ends
--     only hosts see the list, for a week.
--   * Here now: followers by default, or Friends only (both follow each
--     other). Strangers get an unnamed count, only once 3 or more members
--     are checked in at the park.
--
-- Writes all go through the functions below (the tables have no write
-- policies), except comments, which use a policy like post comments.
--
-- Scheduled jobs (pg_cron): dates are made 12 weeks ahead every night;
-- every 15 minutes, finished dates get their went_count, going lists older
-- than a week and ended check-ins are deleted.
--
-- Not here yet (later PRs): notifications and push (changes, cancellations,
-- reminders, co-host invites, the hosts' grouped bell row), reports and
-- park admins hiding a date, the Home feed card and cover photo storage.
--
-- Additive: new types, tables, policies, functions, one column on posts and
-- one on profiles, the pg_cron extension and three jobs. Nothing existing
-- is replaced or dropped.

create extension if not exists pg_cron;

/* Types ----------------------------------------------------------------------- */

do $$ begin
  create type public.meetup_visibility as enum ('public', 'followers');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meetup_status as enum ('scheduled', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meetup_cancel_reason as enum ('rained_out', 'park_closed', 'something_came_up', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meetup_host_role as enum ('host', 'co_host');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.check_in_audience as enum ('followers', 'friends');
exception when duplicate_object then null; end $$;

/* Tables ---------------------------------------------------------------------- */

create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  park_id uuid not null references public.parks (id),
  visibility public.meetup_visibility not null,
  disciplines public.discipline[] not null default '{}',
  title text check (title is null or char_length(title) between 1 and 80),
  note text check (note is null or char_length(note) between 1 and 280),
  cover_path text,
  -- Repeat rule. Empty weekdays = a one-off. ISO weekdays, 1 = Monday.
  weekdays smallint[] not null default '{}'
    check (weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  start_time time not null,
  duration interval not null check (duration > interval '0' and duration <= interval '24 hours'),
  starts_on date not null,
  ends_on date check (ends_on is null or ends_on >= starts_on),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_series_host_idx on public.event_series (host_id);

create table if not exists public.event_series_seasons (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.event_series (id) on delete cascade,
  park_id uuid not null references public.parks (id),
  from_month smallint not null check (from_month between 1 and 12),
  to_month smallint not null check (to_month between 1 and 12)
);

create index if not exists event_series_seasons_series_idx on public.event_series_seasons (series_id);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.event_series (id) on delete cascade,
  park_id uuid not null references public.parks (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  disciplines public.discipline[] not null default '{}',
  title text check (title is null or char_length(title) between 1 and 80),
  note text check (note is null or char_length(note) between 1 and 280),
  cover_path text,
  status public.meetup_status not null default 'scheduled',
  cancel_reason public.meetup_cancel_reason,
  cancel_note text check (cancel_note is null or char_length(cancel_note) between 1 and 140),
  cancelled_at timestamptz,
  went_count integer,
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours'),
  check ((status = 'cancelled') = (cancel_reason is not null))
);

create index if not exists events_series_idx on public.events (series_id, starts_at);
create index if not exists events_park_idx on public.events (park_id, starts_at);
create index if not exists events_ends_idx on public.events (ends_at);

create table if not exists public.event_hosts (
  series_id uuid not null references public.event_series (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.meetup_host_role not null,
  invited_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (series_id, user_id)
);

create index if not exists event_hosts_user_idx on public.event_hosts (user_id);
create unique index if not exists event_hosts_one_host on public.event_hosts (series_id) where role = 'host';

create table if not exists public.event_going (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  going_privately boolean not null default false,
  remind_me boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists event_going_user_idx on public.event_going (user_id);

create table if not exists public.event_series_follows (
  series_id uuid not null references public.event_series (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (series_id, user_id)
);

create index if not exists event_series_follows_user_idx on public.event_series_follows (user_id);

create table if not exists public.event_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.event_comments (id) on delete cascade,
  reply_to_user_id uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists event_comments_event_idx on public.event_comments (event_id, created_at);

create table if not exists public.check_ins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  park_id uuid not null references public.parks (id),
  audience public.check_in_audience not null default 'followers',
  started_at timestamptz not null default now(),
  ends_at timestamptz not null
);

create index if not exists check_ins_park_idx on public.check_ins (park_id, ends_at);

alter table public.posts
  add column if not exists event_id uuid references public.events (id) on delete set null;

create index if not exists posts_event_idx on public.posts (event_id) where event_id is not null;

alter table public.profiles
  add column if not exists going_privately_default boolean;

/* Helpers --------------------------------------------------------------------- */

-- The park's clock (each metro area has a time zone).
create or replace function private.park_tz(park uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(m.timezone, 'UTC')
    from parks p join metro_areas m on m.id = p.metro_area_id
   where p.id = park;
$$;

-- Is month m inside a season running from a to b (which may wrap the year)?
create or replace function private.month_in(m integer, a integer, b integer)
returns boolean
language sql
immutable
as $$
  select case when a <= b then m between a and b else m >= a or m <= b end;
$$;

-- The host or an accepted co-host.
create or replace function private.hosts_series(series uuid, who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select who is not null and exists (
    select 1 from event_hosts h
     where h.series_id = series and h.user_id = who
       and (h.role = 'host' or h.accepted_at is not null)
  );
$$;

create or replace function private.is_main_host(series uuid, who uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select who is not null and exists (
    select 1 from event_series s where s.id = series and s.host_id = who
  );
$$;

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

create or replace function private.can_see_series(series uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.can_see_series_as(series, auth.uid());
$$;

create or replace function private.can_see_event_as(event uuid, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from events e
     where e.id = event
       and private.can_see_series_as(e.series_id, viewer)
       and (e.hidden_at is null or private.hosts_series(e.series_id, viewer))
  );
$$;

create or replace function private.can_see_event(event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.can_see_event_as(event, auth.uid())
      or exists (select 1 from events e where e.id = event and private.can_moderate_park(e.park_id));
$$;

-- Makes the series' dates up to 12 weeks ahead (on the park's clock). Dates
-- that already exist (scheduled or cancelled) are left alone, so a rained
-- out Thursday is never remade. Returns how many dates were added.
create or replace function private.generate_meetup_dates(series uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s event_series;
  d date;
  last_day date;
  p uuid;
  tz text;
  start_local timestamp;
  added integer := 0;
begin
  select * into s from event_series where id = series for update;
  if s.id is null or s.ended_at is not null or cardinality(s.weekdays) = 0 then
    return 0;
  end if;
  last_day := least(coalesce(s.ends_on, 'infinity'::date),
                    (now() at time zone private.park_tz(s.park_id))::date + 84);
  d := greatest(s.starts_on, (now() at time zone private.park_tz(s.park_id))::date - 1);
  while d <= last_day loop
    if extract(isodow from d)::smallint = any (s.weekdays) then
      select x.park_id into p
        from event_series_seasons x
       where x.series_id = s.id and private.month_in(extract(month from d)::int, x.from_month, x.to_month)
       order by x.from_month
       limit 1;
      p := coalesce(p, s.park_id);
      tz := private.park_tz(p);
      start_local := d + s.start_time;
      if (start_local at time zone tz) > now()
         and not exists (
           select 1 from events e
            where e.series_id = s.id
              and ((e.starts_at at time zone private.park_tz(e.park_id))::date) = d
         ) then
        insert into events (series_id, park_id, starts_at, ends_at, disciplines, title, note, cover_path)
        values (s.id, p, start_local at time zone tz, (start_local at time zone tz) + s.duration,
                s.disciplines, s.title, s.note, s.cover_path);
        added := added + 1;
      end if;
    end if;
    p := null;
    d := d + 1;
  end loop;
  return added;
end $$;

-- Seasons arrive as [{"park": uuid, "from_month": 5, "to_month": 9}, ...].
create or replace function private.set_series_seasons(series uuid, seasons jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  x jsonb;
begin
  delete from event_series_seasons where series_id = series;
  if seasons is null or jsonb_typeof(seasons) <> 'array' or jsonb_array_length(seasons) = 0 then
    return;
  end if;
  if jsonb_array_length(seasons) > 4 then
    raise exception 'A meetup can have at most 4 seasons' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(seasons) loop
    if not exists (select 1 from parks where id = (x->>'park')::uuid) then
      raise exception 'Each season needs a park' using errcode = '22023';
    end if;
    insert into event_series_seasons (series_id, park_id, from_month, to_month)
    values (series, (x->>'park')::uuid, (x->>'from_month')::smallint, (x->>'to_month')::smallint);
  end loop;
end $$;

create or replace function private.clean_text(t text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')), '');
$$;

/* Access rules ---------------------------------------------------------------- */

alter table public.event_series enable row level security;
alter table public.event_series_seasons enable row level security;
alter table public.events enable row level security;
alter table public.event_hosts enable row level security;
alter table public.event_going enable row level security;
alter table public.event_series_follows enable row level security;
alter table public.event_comments enable row level security;
alter table public.check_ins enable row level security;

drop policy if exists "read meetups you can see" on public.event_series;
create policy "read meetups you can see" on public.event_series
  for select to authenticated using (private.can_see_series(id));

drop policy if exists "read seasons of meetups you can see" on public.event_series_seasons;
create policy "read seasons of meetups you can see" on public.event_series_seasons
  for select to authenticated using (private.can_see_series(series_id));

drop policy if exists "read dates you can see" on public.events;
create policy "read dates you can see" on public.events
  for select to authenticated using (private.can_see_event(id));

-- Co-hosts who haven't accepted are listed only to themselves and the hosts.
drop policy if exists "read hosts of meetups you can see" on public.event_hosts;
create policy "read hosts of meetups you can see" on public.event_hosts
  for select to authenticated using (
    user_id = (select auth.uid())
    or private.hosts_series(series_id)
    or ((role = 'host' or accepted_at is not null) and private.can_see_series(series_id))
  );

-- Going rows are read through event_going_list(); members see their own.
drop policy if exists "read your own going" on public.event_going;
create policy "read your own going" on public.event_going
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "read your own series follows" on public.event_series_follows;
create policy "read your own series follows" on public.event_series_follows
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "read your own check-in" on public.check_ins;
create policy "read your own check-in" on public.check_ins
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "read meetup comments" on public.event_comments;
create policy "read meetup comments" on public.event_comments
  for select to authenticated using (
    private.can_see_event(event_id)
    and (author_id = (select auth.uid()) or not private.blocked_between(author_id))
  );

drop policy if exists "comment on a meetup" on public.event_comments;
create policy "comment on a meetup" on public.event_comments
  for insert to authenticated with check (
    author_id = (select auth.uid())
    and private.is_active_member()
    and private.can_see_event(event_id)
    and deleted_at is null
  );

-- Comments: trimmed, 1–1000 characters, replies one level deep inside the
-- same date, never edited. Deleting goes through delete_meetup_comment().
create or replace function private.guard_event_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent event_comments;
begin
  if tg_op = 'UPDATE' then
    if new.body is distinct from old.body and new.deleted_at is null then
      raise exception 'Comments can''t be edited';
    end if;
    return new;
  end if;
  new.body := btrim(new.body);
  if char_length(new.body) not between 1 and 1000 then
    raise exception 'A comment is 1 to 1000 characters' using errcode = '22023';
  end if;
  new.created_at := clock_timestamp();
  if new.parent_id is not null then
    select * into parent from event_comments where id = new.parent_id;
    if parent.id is null or parent.event_id <> new.event_id or parent.parent_id is not null then
      raise exception 'Replies stay one level deep' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_event_comment on public.event_comments;
create trigger guard_event_comment before insert or update on public.event_comments
  for each row execute function private.guard_event_comment();

/* Making and changing meetups ------------------------------------------------- */

-- Makes a meetup and returns its first date's id. The fast path is park,
-- starts_at and maybe a note. weekdays (ISO, 1 = Monday) make it repeat,
-- with seasons choosing each date's park; the first date is the first
-- matching day on or after starts_at's day.
create or replace function public.create_meetup(
  park uuid,
  starts_at timestamptz,
  ends_at timestamptz default null,
  note text default null,
  title text default null,
  visibility public.meetup_visibility default null,
  disciplines public.discipline[] default null,
  cover_path text default null,
  weekdays smallint[] default null,
  repeat_ends_on date default null,
  seasons jsonb default null,
  co_hosts uuid[] default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  host profiles;
  tz text;
  finish timestamptz := coalesce(create_meetup.ends_at, create_meetup.starts_at + interval '2 hours');
  s uuid;
  first_event uuid;
  co uuid;
begin
  if me is null or not private.is_active_member() then
    raise exception 'You can''t make meetups right now' using errcode = '42501';
  end if;
  if not exists (select 1 from parks where id = park) then
    raise exception 'Pick a park' using errcode = '22023';
  end if;
  if finish <= create_meetup.starts_at or finish > create_meetup.starts_at + interval '24 hours' then
    raise exception 'A meetup ends after it starts, within 24 hours' using errcode = '22023';
  end if;
  if finish <= now() or create_meetup.starts_at > now() + interval '1 year' then
    raise exception 'Pick a time that hasn''t passed, within a year' using errcode = '22023';
  end if;
  if cardinality(coalesce(co_hosts, '{}')) > 10 then
    raise exception 'A meetup can have at most 10 co-hosts' using errcode = '22023';
  end if;

  select * into host from profiles where id = me;
  tz := private.park_tz(park);

  insert into event_series (host_id, park_id, visibility, disciplines, title, note, cover_path,
                            weekdays, start_time, duration, starts_on, ends_on)
  values (
    me, park,
    coalesce(create_meetup.visibility, case when host.is_private then 'followers' else 'public' end::meetup_visibility),
    coalesce(create_meetup.disciplines, host.disciplines, '{}'),
    private.clean_text(create_meetup.title),
    private.clean_text(create_meetup.note),
    create_meetup.cover_path,
    coalesce((select array_agg(distinct w order by w) from unnest(create_meetup.weekdays) w), '{}'),
    (create_meetup.starts_at at time zone tz)::time,
    finish - create_meetup.starts_at,
    (create_meetup.starts_at at time zone tz)::date,
    repeat_ends_on
  )
  returning id into s;

  insert into event_hosts (series_id, user_id, role, accepted_at) values (s, me, 'host', now());

  foreach co in array coalesce(co_hosts, '{}') loop
    if co <> me
       and exists (select 1 from profiles where id = co and deleted_at is null and banned_at is null)
       and not exists (select 1 from blocks where (blocker_id = me and blocked_id = co) or (blocker_id = co and blocked_id = me)) then
      insert into event_hosts (series_id, user_id, role, invited_by) values (s, co, 'co_host', me)
      on conflict do nothing;
    end if;
  end loop;

  if cardinality(coalesce(create_meetup.weekdays, '{}')) = 0 then
    insert into events (series_id, park_id, starts_at, ends_at, disciplines, title, note, cover_path)
    select s, x.park_id, create_meetup.starts_at, finish, x.disciplines, x.title, x.note, x.cover_path
      from event_series x where x.id = s
    returning id into first_event;
  else
    perform private.set_series_seasons(s, seasons);
    perform private.generate_meetup_dates(s);
    select e.id into first_event from events e where e.series_id = s order by e.starts_at limit 1;
    if first_event is null then
      raise exception 'No dates fall in the next 12 weeks' using errcode = '22023';
    end if;
  end if;

  return first_event;
end $$;

-- Edits a date, or with scope 'upcoming' this date and every later one
-- (and the series, so new dates follow). changes may hold park, starts_at,
-- ends_at, title, note, cover_path, disciplines and visibility (visibility
-- always applies to the whole meetup). Missing keys stay as they are; an
-- empty title or note clears it. Hosts and co-hosts can edit. Returns how
-- many dates changed.
create or replace function public.update_meetup(event uuid, scope text, changes jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e events;
  s event_series;
  tz text;
  new_start timestamptz;
  new_end timestamptz;
  new_park uuid;
  local_start time;
  len interval;
  n integer := 0;
begin
  select * into e from events where id = update_meetup.event;
  if e.id is null or not private.hosts_series(e.series_id) then
    raise exception 'Only hosts can edit this meetup' using errcode = '42501';
  end if;
  if scope not in ('date', 'upcoming') then
    raise exception 'scope is date or upcoming' using errcode = '22023';
  end if;
  if e.status = 'cancelled' or e.ends_at <= now() then
    raise exception 'This date can''t be edited any more' using errcode = '22023';
  end if;
  select * into s from event_series where id = e.series_id;

  new_park := coalesce((changes->>'park')::uuid, e.park_id);
  if not exists (select 1 from parks where id = new_park) then
    raise exception 'Pick a park' using errcode = '22023';
  end if;
  new_start := coalesce((changes->>'starts_at')::timestamptz, e.starts_at);
  new_end := coalesce((changes->>'ends_at')::timestamptz,
                      case when changes ? 'starts_at' then new_start + (e.ends_at - e.starts_at) else e.ends_at end);
  if new_end <= new_start or new_end > new_start + interval '24 hours' or new_end <= now() then
    raise exception 'A meetup ends after it starts, within 24 hours, and not in the past' using errcode = '22023';
  end if;

  if changes ? 'visibility' then
    update event_series set visibility = (changes->>'visibility')::meetup_visibility, updated_at = now()
     where id = s.id;
  end if;

  if scope = 'date' or cardinality(s.weekdays) = 0 then
    update events x set
      park_id = new_park,
      starts_at = new_start,
      ends_at = new_end,
      title = case when changes ? 'title' then private.clean_text(changes->>'title') else x.title end,
      note = case when changes ? 'note' then private.clean_text(changes->>'note') else x.note end,
      cover_path = case when changes ? 'cover_path' then nullif(changes->>'cover_path', '') else x.cover_path end,
      disciplines = case when changes ? 'disciplines'
                         then array(select jsonb_array_elements_text(changes->'disciplines'))::discipline[]
                         else x.disciplines end,
      updated_at = now()
     where x.id = e.id;
    get diagnostics n = row_count;
    if cardinality(s.weekdays) = 0 then
      -- A one-off's series mirrors its only date.
      update event_series set park_id = new_park, title = (select title from events where id = e.id),
             note = (select note from events where id = e.id), cover_path = (select cover_path from events where id = e.id),
             disciplines = (select disciplines from events where id = e.id),
             start_time = (new_start at time zone private.park_tz(new_park))::time,
             duration = new_end - new_start, starts_on = (new_start at time zone private.park_tz(new_park))::date,
             updated_at = now()
       where id = s.id;
    end if;
    return n;
  end if;

  -- This date and every later one.
  if changes ? 'park' and exists (select 1 from event_series_seasons where series_id = s.id) then
    raise exception 'This meetup''s park comes from its seasons; change them in Repeats' using errcode = '22023';
  end if;
  tz := private.park_tz(new_park);
  local_start := (new_start at time zone tz)::time;
  len := new_end - new_start;

  update event_series set
    park_id = case when changes ? 'park' then new_park else park_id end,
    start_time = local_start,
    duration = len,
    title = case when changes ? 'title' then private.clean_text(changes->>'title') else title end,
    note = case when changes ? 'note' then private.clean_text(changes->>'note') else note end,
    cover_path = case when changes ? 'cover_path' then nullif(changes->>'cover_path', '') else cover_path end,
    disciplines = case when changes ? 'disciplines'
                       then array(select jsonb_array_elements_text(changes->'disciplines'))::discipline[]
                       else disciplines end,
    updated_at = now()
   where id = s.id;

  update events x set
    park_id = case when changes ? 'park' then new_park else x.park_id end,
    starts_at = (((x.starts_at at time zone private.park_tz(x.park_id))::date + local_start)
                 at time zone private.park_tz(case when changes ? 'park' then new_park else x.park_id end)),
    ends_at = (((x.starts_at at time zone private.park_tz(x.park_id))::date + local_start)
               at time zone private.park_tz(case when changes ? 'park' then new_park else x.park_id end)) + len,
    title = case when changes ? 'title' then private.clean_text(changes->>'title') else x.title end,
    note = case when changes ? 'note' then private.clean_text(changes->>'note') else x.note end,
    cover_path = case when changes ? 'cover_path' then nullif(changes->>'cover_path', '') else x.cover_path end,
    disciplines = case when changes ? 'disciplines'
                       then array(select jsonb_array_elements_text(changes->'disciplines'))::discipline[]
                       else x.disciplines end,
    updated_at = now()
   where x.series_id = s.id and x.status = 'scheduled' and x.starts_at >= e.starts_at;
  get diagnostics n = row_count;
  return n;
end $$;

-- Changes how a meetup repeats (host only). Later dates that nobody but the
-- hosts is going to are remade from the new rule; dates people are going
-- to stay put. Empty weekdays aren't allowed here: end the series instead.
create or replace function public.set_meetup_repeat(series uuid, weekdays smallint[], repeat_ends_on date default null, seasons jsonb default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not private.is_main_host(series) then
    raise exception 'Only the host can change how a meetup repeats' using errcode = '42501';
  end if;
  if cardinality(coalesce(weekdays, '{}')) = 0 then
    raise exception 'Pick at least one day' using errcode = '22023';
  end if;
  update event_series s set
    weekdays = (select array_agg(distinct w order by w) from unnest(set_meetup_repeat.weekdays) w),
    ends_on = repeat_ends_on,
    updated_at = now()
   where s.id = series;
  perform private.set_series_seasons(series, seasons);
  delete from events e
   where e.series_id = series and e.status = 'scheduled' and e.starts_at > now()
     and not exists (select 1 from event_going g where g.event_id = e.id);
  return private.generate_meetup_dates(series);
end $$;

-- Cancels a date (hosts and co-hosts), or with scope 'series' every later
-- date and the series itself (host only). Cancelled dates stay, crossed
-- out with their reason.
create or replace function public.cancel_meetup(event uuid, reason public.meetup_cancel_reason, scope text default 'date', note text default null)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e events;
  n integer;
begin
  select * into e from events where id = cancel_meetup.event;
  if e.id is null or not private.hosts_series(e.series_id) then
    raise exception 'Only hosts can cancel this meetup' using errcode = '42501';
  end if;
  if e.status = 'cancelled' or e.ends_at <= now() then
    raise exception 'This date can''t be cancelled' using errcode = '22023';
  end if;
  if scope = 'series' then
    if not private.is_main_host(e.series_id) then
      raise exception 'Only the host can end the series' using errcode = '42501';
    end if;
    update events x set status = 'cancelled', cancel_reason = cancel_meetup.reason,
           cancel_note = private.clean_text(cancel_meetup.note), cancelled_at = now(), updated_at = now()
     where x.series_id = e.series_id and x.status = 'scheduled' and x.starts_at >= e.starts_at;
    get diagnostics n = row_count;
    update event_series set ended_at = now(), updated_at = now() where id = e.series_id;
    return n;
  elsif scope <> 'date' then
    raise exception 'scope is date or series' using errcode = '22023';
  end if;
  update events x set status = 'cancelled', cancel_reason = cancel_meetup.reason,
         cancel_note = private.clean_text(cancel_meetup.note), cancelled_at = now(), updated_at = now()
   where x.id = e.id;
  return 1;
end $$;

-- Whether this meetup can still be deleted: only for mistakes, while nobody
-- but the hosts has said they're going and before the first date starts.
create or replace function public.can_delete_meetup(event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from events e
     where e.id = can_delete_meetup.event
       and private.is_main_host(e.series_id)
       and not exists (select 1 from event_going g join events x on x.id = g.event_id where x.series_id = e.series_id)
       and now() < (select min(x.starts_at) from events x where x.series_id = e.series_id)
  );
$$;

-- Deletes the whole meetup (host only), when can_delete_meetup() allows it.
create or replace function public.delete_meetup(event uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s uuid;
begin
  if not public.can_delete_meetup(event) then
    raise exception 'Once someone is going or it has started, a meetup can only be cancelled' using errcode = '42501';
  end if;
  select series_id into s from events where id = event;
  delete from event_series where id = s;
end $$;

/* Co-hosts -------------------------------------------------------------------- */

create or replace function public.invite_co_hosts(series uuid, people uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  p uuid;
  n integer := 0;
begin
  if not private.is_main_host(series) then
    raise exception 'Only the host can change co-hosts' using errcode = '42501';
  end if;
  foreach p in array coalesce(people, '{}') loop
    if p <> me
       and exists (select 1 from profiles where id = p and deleted_at is null and banned_at is null)
       and not exists (select 1 from blocks where (blocker_id = me and blocked_id = p) or (blocker_id = p and blocked_id = me)) then
      insert into event_hosts (series_id, user_id, role, invited_by) values (series, p, 'co_host', me)
      on conflict do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  if (select count(*) from event_hosts where series_id = series and role = 'co_host') > 10 then
    raise exception 'A meetup can have at most 10 co-hosts' using errcode = '22023';
  end if;
  return n;
end $$;

create or replace function public.respond_co_host_invite(series uuid, accept boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if accept then
    if not private.is_active_member() then
      raise exception 'You can''t co-host right now' using errcode = '42501';
    end if;
    update event_hosts set accepted_at = now()
     where series_id = series and user_id = auth.uid() and role = 'co_host' and accepted_at is null;
    -- A co-host is on every date already; drop any going rows they had.
    delete from event_going g using events e
     where g.event_id = e.id and e.series_id = series and g.user_id = auth.uid();
  else
    delete from event_hosts where series_id = series and user_id = auth.uid() and role = 'co_host';
  end if;
end $$;

-- The host removes a co-host, or a co-host steps down.
create or replace function public.remove_co_host(series uuid, person uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not (private.is_main_host(series) or person = auth.uid()) then
    raise exception 'Only the host can change co-hosts' using errcode = '42501';
  end if;
  delete from event_hosts where series_id = series and user_id = person and role = 'co_host';
end $$;

/* Going ----------------------------------------------------------------------- */

-- I'm going (going = true) or not. going_privately and remind_me default
-- to the account setting and off; pass them to change this date only.
create or replace function public.set_going(event uuid, going boolean, going_privately boolean default null, remind_me boolean default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e events;
  default_private boolean;
begin
  select * into e from events where id = set_going.event;
  if e.id is null or not private.can_see_event(e.id) then
    raise exception 'Meetup not found' using errcode = '42501';
  end if;
  if not going then
    delete from event_going where event_id = e.id and user_id = me;
    return;
  end if;
  if not private.is_active_member() then
    raise exception 'You can''t say you''re going right now' using errcode = '42501';
  end if;
  if e.status <> 'scheduled' or e.ends_at <= now() then
    raise exception 'This date is over or cancelled' using errcode = '22023';
  end if;
  if private.hosts_series(e.series_id) then
    return; -- hosts are on every date already
  end if;
  select coalesce(p.going_privately_default, p.is_private) into default_private from profiles p where p.id = me;
  insert into event_going as g (event_id, user_id, going_privately, remind_me)
  values (e.id, me, coalesce(set_going.going_privately, default_private), coalesce(set_going.remind_me, false))
  on conflict (event_id, user_id) do update
    set going_privately = coalesce(set_going.going_privately, g.going_privately),
        remind_me = coalesce(set_going.remind_me, g.remind_me);
end $$;

-- Hosts quietly take someone off the list (a safety tool, like blocking).
create or replace function public.remove_from_going(event uuid, person uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from events e where e.id = event and private.hosts_series(e.series_id)) then
    raise exception 'Only hosts can remove people' using errcode = '42501';
  end if;
  delete from event_going where event_id = event and user_id = person;
end $$;

-- The going list as the caller may see it: hosts (HOST, CO-HOST) first,
-- then people you follow, then everyone else. Rows the caller can't be
-- shown by name are left out; event_going_summary() counts them.
create or replace function public.event_going_list(event uuid)
returns table (user_id uuid, username citext, avatar_path text, role text, following boolean, going_privately boolean)
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select x.*, private.hosts_series(x.series_id) as i_host
      from events x where x.id = event_going_list.event and private.can_see_event(x.id)
  ),
  people as (
    select h.user_id, case h.role when 'host' then 'host' else 'co_host' end as role, false as going_privately
      from e join event_hosts h on h.series_id = e.series_id and (h.role = 'host' or h.accepted_at is not null)
    union all
    select g.user_id, 'going', g.going_privately
      from e join event_going g on g.event_id = e.id
  )
  select p.user_id, pr.username, pr.avatar_path, p.role,
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.followee_id = p.user_id and f.status = 'accepted'),
         case when e.i_host then p.going_privately else false end
    from people p
    join profiles pr on pr.id = p.user_id and pr.deleted_at is null
    cross join e
   where (
       -- After the end, only hosts see the list, for a week.
       e.ends_at > now() or (e.i_host and e.ends_at > now() - interval '7 days')
     )
     and (
       p.user_id = auth.uid()
       or p.role <> 'going'
       or e.i_host
       or (
         not p.going_privately
         and not exists (select 1 from blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                                                 or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
         and (not pr.is_private
              or exists (select 1 from follows f where f.follower_id = auth.uid() and f.followee_id = p.user_id and f.status = 'accepted'))
       )
     )
     and (p.role <> 'going' or e.i_host
          or not exists (select 1 from blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                                                  or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())))
   order by case p.role when 'host' then 0 when 'co_host' then 1 else 2 end,
            exists (select 1 from follows f where f.follower_id = auth.uid() and f.followee_id = p.user_id and f.status = 'accepted') desc,
            pr.username;
$$;

-- The count (everyone, hosts included; after the end, went_count), how
-- many of them the caller can't see by name, and the caller's own row.
create or replace function public.event_going_summary(event uuid)
returns table (total integer, unnamed integer, i_am_going boolean, i_host boolean, my_going_privately boolean, my_remind_me boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e events;
  everyone integer;
  named integer;
  mine event_going;
begin
  select * into e from events where id = event_going_summary.event;
  if e.id is null or not private.can_see_event(e.id) then
    return;
  end if;
  everyone := (select count(*) from event_hosts h where h.series_id = e.series_id and (h.role = 'host' or h.accepted_at is not null))
            + (select count(*) from event_going g where g.event_id = e.id);
  if e.went_count is not null then
    everyone := e.went_count;
  end if;
  named := (select count(*) from public.event_going_list(e.id));
  select * into mine from event_going g where g.event_id = e.id and g.user_id = auth.uid();
  return query select everyone,
                      greatest(everyone - named, 0),
                      mine.user_id is not null or private.hosts_series(e.series_id),
                      private.hosts_series(e.series_id),
                      coalesce(mine.going_privately, false),
                      coalesce(mine.remind_me, false);
end $$;

create or replace function public.follow_meetup_series(series uuid, follow boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not follow then
    delete from event_series_follows where series_id = series and user_id = auth.uid();
    return;
  end if;
  if not private.can_see_series(series) or not private.is_active_member() then
    raise exception 'Meetup not found' using errcode = '42501';
  end if;
  insert into event_series_follows (series_id, user_id) values (series, auth.uid()) on conflict do nothing;
end $$;

/* Comments -------------------------------------------------------------------- */

-- Comments on a date, oldest first, with HOST / CO-HOST labels. Deleted
-- comments with replies stay as placeholders.
create or replace function public.meetup_comments(event uuid)
returns table (id uuid, parent_id uuid, author_id uuid, username citext, avatar_path text, author_role text,
               reply_to_username citext, body text, created_at timestamptz, deleted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.parent_id,
         case when c.deleted_at is null then c.author_id end,
         case when c.deleted_at is null then a.username end,
         case when c.deleted_at is null then a.avatar_path end,
         case when c.deleted_at is not null then null
              when h.role = 'host' then 'host'
              when h.role = 'co_host' then 'co_host' end,
         r.username,
         case when c.deleted_at is null then c.body end,
         c.created_at,
         c.deleted_at is not null
    from event_comments c
    join events e on e.id = c.event_id
    join profiles a on a.id = c.author_id
    left join event_hosts h on h.series_id = e.series_id and h.user_id = c.author_id and (h.role = 'host' or h.accepted_at is not null)
    left join profiles r on r.id = c.reply_to_user_id
   where c.event_id = meetup_comments.event
     and private.can_see_event(c.event_id)
     and (c.author_id = auth.uid() or not private.blocked_between(c.author_id))
     and (c.deleted_at is null or exists (select 1 from event_comments k where k.parent_id = c.id and k.deleted_at is null))
   order by coalesce((select p.created_at from event_comments p where p.id = c.parent_id), c.created_at), c.parent_id nulls first, c.created_at;
$$;

-- Authors delete their own comments; hosts and co-hosts any comment on
-- their meetup; park moderators any at their parks. The text is erased.
create or replace function public.delete_meetup_comment(comment uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c event_comments;
  e events;
begin
  select * into c from event_comments where id = comment;
  select * into e from events where id = c.event_id;
  if c.id is null or not (c.author_id = auth.uid() or private.hosts_series(e.series_id) or private.can_moderate_park(e.park_id)) then
    raise exception 'You can''t delete this comment' using errcode = '42501';
  end if;
  update event_comments set deleted_at = now(), body = '[deleted]' where id = c.id;
end $$;

/* Here now -------------------------------------------------------------------- */

create or replace function private.can_see_check_in(owner uuid, audience public.check_in_audience, viewer uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select owner = viewer or (
    viewer is not null
    and not exists (select 1 from blocks b where (b.blocker_id = viewer and b.blocked_id = owner)
                                            or (b.blocker_id = owner and b.blocked_id = viewer))
    and exists (select 1 from follows f where f.follower_id = viewer and f.followee_id = owner and f.status = 'accepted')
    and (audience = 'followers'
         or exists (select 1 from follows f where f.follower_id = owner and f.followee_id = viewer and f.status = 'accepted'))
  );
$$;

-- Checks in at a park for 3 hours. The phone's position is used once, to
-- confirm it's within about 500 m of the park's pin, and isn't stored.
-- One check-in at a time: a new one replaces the old.
create or replace function public.check_in(park uuid, latitude double precision, longitude double precision,
                                           audience public.check_in_audience default 'followers')
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  me uuid := auth.uid();
  finish timestamptz := now() + interval '3 hours';
begin
  if me is null or not private.is_active_member() then
    raise exception 'You can''t check in right now' using errcode = '42501';
  end if;
  if check_in.latitude not between -90 and 90 or check_in.longitude not between -180 and 180 then
    raise exception 'That location doesn''t look right' using errcode = '22023';
  end if;
  if not exists (
    select 1 from parks p
     where p.id = check_in.park and p.location is not null
       and st_dwithin(p.location, st_setsrid(st_makepoint(check_in.longitude, check_in.latitude), 4326)::geography, 500)
  ) then
    raise exception 'You need to be at the park to check in' using errcode = 'P0001', hint = 'not_at_park';
  end if;
  insert into check_ins as c (user_id, park_id, audience, started_at, ends_at)
  values (me, check_in.park, check_in.audience, now(), finish)
  on conflict (user_id) do update
    set park_id = excluded.park_id, audience = excluded.audience, started_at = excluded.started_at, ends_at = excluded.ends_at;
  return finish;
end $$;

-- I left. Nothing is kept.
create or replace function public.check_out()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from check_ins where user_id = auth.uid();
$$;

-- People at a park the caller may see by name (themselves included).
create or replace function public.park_here_now(park uuid)
returns table (user_id uuid, username citext, avatar_path text, ends_at timestamptz, following boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.user_id, p.username, p.avatar_path, c.ends_at,
         exists (select 1 from follows f where f.follower_id = auth.uid() and f.followee_id = c.user_id and f.status = 'accepted')
    from check_ins c
    join profiles p on p.id = c.user_id and p.deleted_at is null
   where c.park_id = park_here_now.park and c.ends_at > now()
     and private.can_see_check_in(c.user_id, c.audience)
   order by c.user_id = auth.uid() desc, c.started_at desc;
$$;

-- How many people at the park the caller can't see by name ("3 skaters
-- here now"), or 0 while fewer than 3 are checked in, so nobody can tell
-- someone is there alone. People blocked either way aren't counted.
create or replace function public.park_here_now_unnamed(park uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with here as (
    select c.* from check_ins c
     where c.park_id = park_here_now_unnamed.park and c.ends_at > now()
       and not exists (select 1 from blocks b where (b.blocker_id = auth.uid() and b.blocked_id = c.user_id)
                                               or (b.blocker_id = c.user_id and b.blocked_id = auth.uid()))
  )
  select case when (select count(*) from here) < 3 then 0
              else (select count(*) from here h where not private.can_see_check_in(h.user_id, h.audience))::integer end;
$$;

-- A member's current check-in, for the profile tag ("At Memo · until 7:30").
create or replace function public.profile_check_in(person uuid)
returns table (park_id uuid, park_slug text, park_name text, ends_at timestamptz, audience public.check_in_audience)
language sql
stable
security definer
set search_path = public
as $$
  select c.park_id, p.slug, p.display_name, c.ends_at,
         case when c.user_id = auth.uid() then c.audience end
    from check_ins c join parks p on p.id = c.park_id
   where c.user_id = person and c.ends_at > now()
     and private.can_see_check_in(c.user_id, c.audience);
$$;

/* From this session ----------------------------------------------------------- */

-- Meetups at this park the caller said they were going to (or hosted), that
-- have started and ended no more than 7 days ago: the "From Thursday's
-- meetup?" chip when posting.
create or replace function public.my_recent_meetups(park uuid)
returns table (event_id uuid, title text, note text, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.title, e.note, e.starts_at, e.ends_at
    from events e
   where e.park_id = my_recent_meetups.park
     and e.status = 'scheduled' and e.hidden_at is null
     and e.starts_at <= now() and e.ends_at > now() - interval '7 days'
     and (exists (select 1 from event_going g where g.event_id = e.id and g.user_id = auth.uid())
          or private.hosts_series(e.series_id))
   order by e.starts_at desc;
$$;

-- A post can link to a meetup at its park that the author was going to (or
-- hosted), from its start until 7 days after it ends. Moving the post to
-- another park drops the link.
create or replace function private.guard_post_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e events;
begin
  if tg_op = 'UPDATE' and new.event_id is not null and new.event_id is not distinct from old.event_id then
    if new.park_id is distinct from old.park_id then
      new.event_id := null;
    end if;
    return new;
  end if;
  if new.event_id is null then
    return new;
  end if;
  select * into e from events where id = new.event_id;
  if e.id is null
     or e.park_id is distinct from new.park_id
     or e.status <> 'scheduled'
     or now() < e.starts_at or now() > e.ends_at + interval '7 days'
     or not (exists (select 1 from event_going g where g.event_id = e.id and g.user_id = new.author_id)
             or private.hosts_series(e.series_id, new.author_id)) then
    raise exception 'This post can''t be linked to that meetup' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists guard_post_event on public.posts;
create trigger guard_post_event before insert or update of event_id, park_id on public.posts
  for each row execute function private.guard_post_event();

/* Scheduled jobs -------------------------------------------------------------- */

-- Nightly: make dates up to 12 weeks ahead for every running series.
create or replace function private.roll_meetups()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s uuid;
  n integer := 0;
begin
  for s in select id from event_series where ended_at is null and cardinality(weekdays) > 0
                                       and (ends_on is null or ends_on >= current_date - 1) loop
    n := n + private.generate_meetup_dates(s);
  end loop;
  return n;
end $$;

-- Every 15 minutes: keep the count on dates that ended, delete going lists
-- a week after the end and check-ins that ran out.
create or replace function private.finish_meetups()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update events e
     set went_count = (select count(*) from event_hosts h where h.series_id = e.series_id and (h.role = 'host' or h.accepted_at is not null))
                    + (select count(*) from event_going g where g.event_id = e.id)
   where e.ends_at <= now() and e.went_count is null and e.status = 'scheduled';
  delete from event_going g using events e
   where g.event_id = e.id and e.ends_at <= now() - interval '7 days';
  delete from check_ins where ends_at <= now();
end $$;

select cron.schedule('meetups-roll', '17 3 * * *', 'select private.roll_meetups()');
select cron.schedule('meetups-finish', '*/15 * * * *', 'select private.finish_meetups()');

/* Grants ---------------------------------------------------------------------- */

revoke execute on function public.create_meetup, public.update_meetup, public.set_meetup_repeat,
  public.cancel_meetup, public.can_delete_meetup, public.delete_meetup, public.invite_co_hosts,
  public.respond_co_host_invite, public.remove_co_host, public.set_going, public.remove_from_going,
  public.event_going_list, public.event_going_summary, public.follow_meetup_series, public.meetup_comments,
  public.delete_meetup_comment, public.check_in, public.check_out, public.park_here_now,
  public.park_here_now_unnamed, public.profile_check_in, public.my_recent_meetups
  from anon, public;

grant execute on function public.create_meetup, public.update_meetup, public.set_meetup_repeat,
  public.cancel_meetup, public.can_delete_meetup, public.delete_meetup, public.invite_co_hosts,
  public.respond_co_host_invite, public.remove_co_host, public.set_going, public.remove_from_going,
  public.event_going_list, public.event_going_summary, public.follow_meetup_series, public.meetup_comments,
  public.delete_meetup_comment, public.check_in, public.check_out, public.park_here_now,
  public.park_here_now_unnamed, public.profile_check_in, public.my_recent_meetups
  to authenticated;

revoke execute on function private.generate_meetup_dates(uuid), private.set_series_seasons(uuid, jsonb),
  private.roll_meetups(), private.finish_meetups()
  from public, anon, authenticated;


-- The checks themselves. Members are made up for the check; everything
-- runs as an ordinary member unless it says reset role.
--
--   H  mt_host      public, hosts the meetups
--   C  mt_cohost    invited as co-host
--   P  mt_priv      private account, followed by F
--   F  mt_fan       follows H and P
--   S  mt_stranger  follows nobody
--   G  mt_goer      public, goes privately
--   B  mt_blocked   blocked by H

create temp table t_results(step text, ok boolean, detail text);
create temp table t_ids(name text primary key, id uuid);
grant all on t_results, t_ids to authenticated;

insert into auth.users (id, email, aud, role, instance_id) values
 ('d1000000-0000-4000-8000-0000000000a1','mt-h@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d1000000-0000-4000-8000-0000000000a2','mt-c@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d1000000-0000-4000-8000-0000000000a3','mt-p@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d1000000-0000-4000-8000-0000000000a4','mt-f@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d1000000-0000-4000-8000-0000000000a5','mt-s@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d1000000-0000-4000-8000-0000000000a6','mt-g@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('d1000000-0000-4000-8000-0000000000a7','mt-b@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private) values
 ('d1000000-0000-4000-8000-0000000000a1','mt_host', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d1000000-0000-4000-8000-0000000000a2','mt_cohost', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d1000000-0000-4000-8000-0000000000a3','mt_priv', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{quad}', now(), true),
 ('d1000000-0000-4000-8000-0000000000a4','mt_fan', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d1000000-0000-4000-8000-0000000000a5','mt_stranger', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{skateboard}', now(), false),
 ('d1000000-0000-4000-8000-0000000000a6','mt_goer', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false),
 ('d1000000-0000-4000-8000-0000000000a7','mt_blocked', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now(), false);
insert into follows (follower_id, followee_id, status) values
 ('d1000000-0000-4000-8000-0000000000a4','d1000000-0000-4000-8000-0000000000a1','accepted'),
 ('d1000000-0000-4000-8000-0000000000a4','d1000000-0000-4000-8000-0000000000a3','accepted');
-- A follow to a private account always starts as a request; P accepts F.
update follows set status = 'accepted' where follower_id = 'd1000000-0000-4000-8000-0000000000a4' and followee_id = 'd1000000-0000-4000-8000-0000000000a3';
insert into blocks (blocker_id, blocked_id) values ('d1000000-0000-4000-8000-0000000000a1','d1000000-0000-4000-8000-0000000000a7');

-- Memo 8dc45317-…, City Heights ff7f5301-…, Fælledparken 27eb94af-…, Xhall 6c91f4f3-…

/* Making meetups --------------------------------------------------------------- */
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_ids select 'm1', create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e', starts_at => now() + interval '1 day', note => '  I''ll be at   Memo Saturday at 4 ');
insert into t_ids select 'm2', create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e', starts_at => now() + interval '2 days', visibility => 'followers');
insert into t_ids select 'm3', create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e', starts_at => now() + interval '3 days', title => 'Oops wrong park');
insert into t_results select 'fast path: 2 hours, public, note tidied, host disciplines',
  e.ends_at - e.starts_at = interval '2 hours' and s.visibility = 'public' and e.note = 'I''ll be at Memo Saturday at 4' and e.disciplines = '{inline}',
  e.note || ' / ' || s.visibility from events e join event_series s on s.id = e.series_id where e.id = (select id from t_ids where name = 'm1');
do $$ begin perform create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e', starts_at => now() - interval '3 hours');
  insert into t_results values ('a meetup in the past is refused', false, 'no error');
exception when others then insert into t_results values ('a meetup in the past is refused', true, sqlerrm); end $$;
do $$ begin perform create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e', starts_at => now() + interval '1 day', ends_at => now() + interval '3 days');
  insert into t_results values ('longer than 24 hours is refused', false, 'no error');
exception when others then insert into t_results values ('longer than 24 hours is refused', true, sqlerrm); end $$;

-- A private host defaults to Followers only.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
insert into t_ids select 'mp', create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e', starts_at => now() + interval '1 day');
insert into t_results select 'private host starts at Followers only', s.visibility = 'followers', s.visibility::text
  from events e join event_series s on s.id = e.series_id where e.id = (select id from t_ids where name = 'mp');

/* Who can see a meetup --------------------------------------------------------- */
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
insert into t_results select 'stranger sees a public meetup, not a followers-only one',
  exists (select 1 from events where id = (select id from t_ids where name = 'm1'))
  and not exists (select 1 from events where id = (select id from t_ids where name = 'm2')), '';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into t_results select 'follower sees the followers-only meetup',
  exists (select 1 from events where id = (select id from t_ids where name = 'm2')), '';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
insert into t_results select 'blocked member sees neither',
  not exists (select 1 from events where id in (select id from t_ids where name in ('m1','m2'))), '';
do $$ begin perform set_going((select id from t_ids where name = 'm1'), true);
  insert into t_results values ('blocked member can''t say they''re going', false, 'no error');
exception when others then insert into t_results values ('blocked member can''t say they''re going', true, sqlerrm); end $$;

/* Going ------------------------------------------------------------------------ */
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
select set_going((select id from t_ids where name = 'm1'), true);
insert into t_results select 'private account goes privately by default', going_privately, going_privately::text
  from event_going where event_id = (select id from t_ids where name = 'm1') and user_id = 'd1000000-0000-4000-8000-0000000000a3';
select set_going((select id from t_ids where name = 'm1'), true, going_privately => false, remind_me => true);
insert into t_results select 'switch changes this date only', not going_privately and remind_me, ''
  from event_going where event_id = (select id from t_ids where name = 'm1') and user_id = 'd1000000-0000-4000-8000-0000000000a3';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a6","role":"authenticated"}', true);
select set_going((select id from t_ids where name = 'm1'), true, going_privately => true);
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
select set_going((select id from t_ids where name = 'm1'), true);
insert into t_results select 'public account is public by default', not going_privately, ''
  from event_going where event_id = (select id from t_ids where name = 'm1') and user_id = 'd1000000-0000-4000-8000-0000000000a4';

-- F follows P: sees host, P and themselves; not G (going privately).
insert into t_results select 'follower''s list: host first, then followed, no private goer',
  string_agg(username::text || ':' || role, ',' order by ord) = 'mt_host:host,mt_priv:going,mt_fan:going',
  string_agg(username::text || ':' || role, ',' order by ord)
  from (select l.*, row_number() over () ord from event_going_list((select id from t_ids where name = 'm1')) l) x;
-- S follows nobody: sees host and F; P (private) and G (privately) are counted.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
insert into t_results select 'stranger''s list names only public goers',
  string_agg(username::text, ',' order by username) = 'mt_fan,mt_host', string_agg(username::text, ',' order by username)
  from event_going_list((select id from t_ids where name = 'm1'));
insert into t_results select 'count includes everyone, unnamed counted', total = 4 and unnamed = 2 and not i_am_going,
  total || ' / ' || unnamed from event_going_summary((select id from t_ids where name = 'm1'));
insert into t_results select 'going rows aren''t readable directly', count(*) = 0, count(*)::text from event_going;
-- H sees everyone, with who's going privately.
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'host sees the full list',
  count(*) = 4 and bool_or(username = 'mt_goer' and going_privately), string_agg(username::text, ',')
  from event_going_list((select id from t_ids where name = 'm1'));
insert into t_results select 'host counts as going', i_am_going and i_host, '' from event_going_summary((select id from t_ids where name = 'm1'));

/* Co-hosts --------------------------------------------------------------------- */
select invite_co_hosts((select series_id from events where id = (select id from t_ids where name = 'm1')), array['d1000000-0000-4000-8000-0000000000a2'::uuid]);
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
insert into t_results select 'invited co-host isn''t listed until they accept', count(*) = 0, count(*)::text
  from event_going_list((select id from t_ids where name = 'm1')) where role = 'co_host';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
do $$ begin perform update_meetup((select id from t_ids where name = 'm1'), 'date', '{"title":"x"}');
  insert into t_results values ('invited co-host can''t edit yet', false, 'no error');
exception when others then insert into t_results values ('invited co-host can''t edit yet', true, sqlerrm); end $$;
select respond_co_host_invite((select series_id from events where id = (select id from t_ids where name = 'm1')), true);
select update_meetup((select id from t_ids where name = 'm1'), 'date', '{"title":"Saturday session"}');
insert into t_results select 'co-host edits the title', title = 'Saturday session', title from events where id = (select id from t_ids where name = 'm1');
select remove_from_going((select id from t_ids where name = 'm1'), 'd1000000-0000-4000-8000-0000000000a6');
insert into t_results select 'co-host quietly removes someone from going', count(*) = 4, count(*)::text
  from event_going_list((select id from t_ids where name = 'm1'));
do $$ begin perform cancel_meetup((select id from t_ids where name = 'm1'), 'rained_out', 'series');
  insert into t_results values ('co-host can''t end the series', false, 'no error');
exception when others then insert into t_results values ('co-host can''t end the series', true, sqlerrm); end $$;
do $$ begin perform delete_meetup((select id from t_ids where name = 'm3'));
  insert into t_results values ('co-host can''t delete', false, 'no error');
exception when others then insert into t_results values ('co-host can''t delete', true, sqlerrm); end $$;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
insert into t_results select 'accepted co-host listed second as CO-HOST',
  string_agg(username::text || ':' || role, ',' order by ord) like 'mt_host:host,mt_cohost:co_host,%',
  string_agg(username::text || ':' || role, ',' order by ord)
  from (select l.*, row_number() over () ord from event_going_list((select id from t_ids where name = 'm1')) l) x;

/* Delete and cancel ------------------------------------------------------------ */
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'delete offered only while nobody else is going',
  not can_delete_meetup((select id from t_ids where name = 'm1')) and can_delete_meetup((select id from t_ids where name = 'm3')), '';
select delete_meetup((select id from t_ids where name = 'm3'));
insert into t_results select 'host deletes a mistake', not exists (select 1 from events where id = (select id from t_ids where name = 'm3')), '';
do $$ begin perform delete_meetup((select id from t_ids where name = 'm1'));
  insert into t_results values ('someone going: delete refused', false, 'no error');
exception when others then insert into t_results values ('someone going: delete refused', true, sqlerrm); end $$;
select cancel_meetup((select id from t_ids where name = 'm2'), 'park_closed');
insert into t_results select 'cancelled date stays with its reason', status = 'cancelled' and cancel_reason = 'park_closed', status::text
  from events where id = (select id from t_ids where name = 'm2');

/* Repeats with seasons (Copenhagen) -------------------------------------------- */
insert into t_ids select 'cph', create_meetup(
  park => '27eb94af-49df-46ab-a11c-189d8c51478a',
  starts_at => ((now() at time zone 'Europe/Copenhagen')::date + 1 + time '18:00') at time zone 'Europe/Copenhagen',
  ends_at => ((now() at time zone 'Europe/Copenhagen')::date + 1 + time '21:00') at time zone 'Europe/Copenhagen',
  weekdays => '{1,3,5}',
  seasons => '[{"park":"27eb94af-49df-46ab-a11c-189d8c51478a","from_month":5,"to_month":9},{"park":"6c91f4f3-e8c7-4648-ac79-d0723edfd56e","from_month":10,"to_month":4}]');
insert into t_ids select 'cph_series', series_id from events where id = (select id from t_ids where name = 'cph');
insert into t_results select 'series makes ~12 weeks of Mon/Wed/Fri dates at 18:00 Copenhagen',
  count(*) between 34 and 37
  and bool_and(extract(isodow from starts_at at time zone 'Europe/Copenhagen') in (1,3,5))
  and bool_and((starts_at at time zone 'Europe/Copenhagen')::time = '18:00')
  and bool_and(ends_at - starts_at = interval '3 hours')
  and max(starts_at) <= now() + interval '85 days',
  count(*)::text || ' dates' from events where series_id = (select id from t_ids where name = 'cph_series');
insert into t_results select 'winter dates take the winter season''s park',
  bool_and(park_id = case when extract(month from starts_at at time zone 'Europe/Copenhagen') between 5 and 9
                          then '27eb94af-49df-46ab-a11c-189d8c51478a'::uuid else '6c91f4f3-e8c7-4648-ac79-d0723edfd56e'::uuid end),
  string_agg(distinct park_id::text, ',') from events where series_id = (select id from t_ids where name = 'cph_series');
select cancel_meetup((select id from t_ids where name = 'cph'), 'rained_out');
reset role;
insert into t_results select 'rolling again adds nothing and keeps the rained-out date',
  private.generate_meetup_dates((select id from t_ids where name = 'cph_series')) = 0
  and (select status from events where id = (select id from t_ids where name = 'cph')) = 'cancelled', '';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
-- Move every later date to 19:00, from the second date on.
insert into t_ids select 'cph2', id from events where series_id = (select id from t_ids where name = 'cph_series') order by starts_at offset 1 limit 1;
select update_meetup((select id from t_ids where name = 'cph2'), 'upcoming',
  jsonb_build_object('starts_at', ((select starts_at from events where id = (select id from t_ids where name = 'cph2')) + interval '1 hour')));
insert into t_results select 'all upcoming moves to 19:00, first date untouched',
  bool_and((starts_at at time zone 'Europe/Copenhagen')::time = '19:00') filter (where starts_at >= (select starts_at from events where id = (select id from t_ids where name = 'cph2')))
  and (select (starts_at at time zone 'Europe/Copenhagen')::time from events where id = (select id from t_ids where name = 'cph')) = '18:00'
  and (select start_time from event_series where id = (select id from t_ids where name = 'cph_series')) = '19:00',
  '' from events where series_id = (select id from t_ids where name = 'cph_series') and status = 'scheduled';
do $$ begin perform update_meetup((select id from t_ids where name = 'cph2'), 'upcoming', '{"park":"8dc45317-2f2a-4f66-b6e2-0a600537f16e"}');
  insert into t_results values ('seasonal park can''t be changed for all upcoming', false, 'no error');
exception when others then insert into t_results values ('seasonal park can''t be changed for all upcoming', true, sqlerrm); end $$;
select cancel_meetup((select id from t_ids where name = 'cph2'), 'something_came_up', 'series');
insert into t_results select 'ending the series cancels later dates and ends it',
  (select ended_at is not null from event_series where id = (select id from t_ids where name = 'cph_series'))
  and not exists (select 1 from events where series_id = (select id from t_ids where name = 'cph_series') and status = 'scheduled'), '';

/* Here now --------------------------------------------------------------------- */
select check_in('8dc45317-2f2a-4f66-b6e2-0a600537f16e', 32.6985, -117.1300);
insert into t_results select 'check in at the pin, 3 hours', ends_at = now() + interval '3 hours', '' from check_ins;
do $$ begin perform check_in('8dc45317-2f2a-4f66-b6e2-0a600537f16e', 32.744595, -117.110801);
  insert into t_results values ('checking in from another park is refused', false, 'no error');
exception when others then insert into t_results values ('checking in from another park is refused', true, sqlerrm); end $$;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into t_results select 'follower sees the host by name', count(*) = 1 and min(username) = 'mt_host', coalesce(min(username)::text, 'none')
  from park_here_now('8dc45317-2f2a-4f66-b6e2-0a600537f16e');
insert into t_results select 'profile tag for a follower', count(*) = 1 and min(park_name) = 'Memo', '' from profile_check_in('d1000000-0000-4000-8000-0000000000a1');
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
insert into t_results select 'stranger: no names, no count while someone is alone',
  (select count(*) from park_here_now('8dc45317-2f2a-4f66-b6e2-0a600537f16e')) = 0
  and park_here_now_unnamed('8dc45317-2f2a-4f66-b6e2-0a600537f16e') = 0
  and not exists (select 1 from profile_check_in('d1000000-0000-4000-8000-0000000000a1')), '';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select check_in('8dc45317-2f2a-4f66-b6e2-0a600537f16e', 32.6981, -117.1299);
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a6","role":"authenticated"}', true);
select check_in('8dc45317-2f2a-4f66-b6e2-0a600537f16e', 32.6981, -117.1299);
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
insert into t_results select 'stranger sees "3 skaters here now" once 3 are in', park_here_now_unnamed('8dc45317-2f2a-4f66-b6e2-0a600537f16e') = 3,
  park_here_now_unnamed('8dc45317-2f2a-4f66-b6e2-0a600537f16e')::text;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into t_results select 'follower: one name plus two unnamed', park_here_now_unnamed('8dc45317-2f2a-4f66-b6e2-0a600537f16e') = 2, '';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
insert into t_results select 'blocked member isn''t counted or counting the blocker', park_here_now_unnamed('8dc45317-2f2a-4f66-b6e2-0a600537f16e') = 0, '';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select check_in('8dc45317-2f2a-4f66-b6e2-0a600537f16e', 32.6985, -117.1300, 'friends');
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into t_results select 'Friends only hides you from one-way followers', count(*) = 0, '' from park_here_now('8dc45317-2f2a-4f66-b6e2-0a600537f16e');
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select check_out();
insert into t_results select 'I left: nothing kept', not exists (select 1 from check_ins), '';

/* Comments --------------------------------------------------------------------- */
insert into event_comments (event_id, author_id, body) values ((select id from t_ids where name = 'm1'), 'd1000000-0000-4000-8000-0000000000a1', 'bring wax');
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
insert into event_comments (event_id, author_id, body) values ((select id from t_ids where name = 'm1'), 'd1000000-0000-4000-8000-0000000000a2', 'see you there');
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
insert into event_comments (id, event_id, author_id, body) values ('d1000000-0000-4000-8000-0000000000c1', (select id from t_ids where name = 'm1'), 'd1000000-0000-4000-8000-0000000000a5', '  can I come?  ');
insert into t_results select 'HOST and CO-HOST labels', string_agg(coalesce(author_role, '-'), ',' order by created_at) = 'host,co_host,-',
  string_agg(coalesce(author_role, '-'), ',' order by created_at) from meetup_comments((select id from t_ids where name = 'm1'));
do $$ begin update event_comments set body = 'edited' where id = 'd1000000-0000-4000-8000-0000000000c1';
  if exists (select 1 from event_comments where body = 'edited') then insert into t_results values ('comments can''t be edited', false, 'edited');
  else insert into t_results values ('comments can''t be edited', true, 'no rows changed'); end if;
exception when others then insert into t_results values ('comments can''t be edited', true, sqlerrm); end $$;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
do $$ begin insert into event_comments (event_id, author_id, body) values ((select id from t_ids where name = 'm1'), 'd1000000-0000-4000-8000-0000000000a7', 'hi');
  insert into t_results values ('blocked member can''t comment', false, 'no error');
exception when others then insert into t_results values ('blocked member can''t comment', true, sqlerrm); end $$;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select delete_meetup_comment('d1000000-0000-4000-8000-0000000000c1');
insert into t_results select 'host deletes any comment', count(*) = 2, count(*)::text from meetup_comments((select id from t_ids where name = 'm1'));

/* From this session ------------------------------------------------------------ */
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$ begin insert into posts (author_id, metro_area_id, slide_count, park_id, event_id) values ('d1000000-0000-4000-8000-0000000000a4','93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925',1,'8dc45317-2f2a-4f66-b6e2-0a600537f16e',(select id from t_ids where name = 'm1'));
  insert into t_results values ('no linking before the meetup starts', false, 'no error');
exception when others then insert into t_results values ('no linking before the meetup starts', true, sqlerrm); end $$;
reset role;
update events set starts_at = now() - interval '26 hours', ends_at = now() - interval '24 hours' where id = (select id from t_ids where name = 'm1');
select private.finish_meetups();
insert into t_results select 'went count kept at the end (host, co-host, 2 going)', went_count = 4, went_count::text
  from events where id = (select id from t_ids where name = 'm1');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
insert into t_results select 'chip offers yesterday''s meetup to someone who went', count(*) = 1, count(*)::text
  from my_recent_meetups('8dc45317-2f2a-4f66-b6e2-0a600537f16e');
insert into posts (id, author_id, metro_area_id, slide_count, park_id, event_id) values ('d1000000-0000-4000-8000-0000000000f1','d1000000-0000-4000-8000-0000000000a4','93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925',1,'8dc45317-2f2a-4f66-b6e2-0a600537f16e',(select id from t_ids where name = 'm1'));
insert into t_results select 'post links to the meetup', event_id = (select id from t_ids where name = 'm1'), '' from posts where id = 'd1000000-0000-4000-8000-0000000000f1';
update posts set park_id = 'ff7f5301-1a48-497f-8049-a64b51fd92ec' where id = 'd1000000-0000-4000-8000-0000000000f1';
insert into t_results select 'moving the post to another park drops the link', event_id is null, '' from posts where id = 'd1000000-0000-4000-8000-0000000000f1';
insert into t_results select 'after the end, others see no list, just the count',
  (select count(*) from event_going_list((select id from t_ids where name = 'm1'))) = 0
  and (select total from event_going_summary((select id from t_ids where name = 'm1'))) = 4, '';
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
do $$ begin insert into posts (author_id, metro_area_id, slide_count, park_id, event_id) values ('d1000000-0000-4000-8000-0000000000a5','93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925',1,'8dc45317-2f2a-4f66-b6e2-0a600537f16e',(select id from t_ids where name = 'm1'));
  insert into t_results values ('someone who wasn''t going can''t link', false, 'no error');
exception when others then insert into t_results values ('someone who wasn''t going can''t link', true, sqlerrm); end $$;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'hosts still see the list for a week', count(*) = 4, count(*)::text from event_going_list((select id from t_ids where name = 'm1'));
reset role;
update events set starts_at = now() - interval '9 days', ends_at = now() - interval '8 days' where id = (select id from t_ids where name = 'm1');
select private.finish_meetups();
insert into t_results select 'going rows deleted a week after the end', count(*) = 0, count(*)::text from event_going where event_id = (select id from t_ids where name = 'm1');

/* Suspended members ------------------------------------------------------------ */
update profiles set suspended_until = now() + interval '1 day' where id = 'd1000000-0000-4000-8000-0000000000a5';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d1000000-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
do $$ begin perform create_meetup(park => '8dc45317-2f2a-4f66-b6e2-0a600537f16e', starts_at => now() + interval '1 day');
  insert into t_results values ('suspended members can''t make meetups', false, 'no error');
exception when others then insert into t_results values ('suspended members can''t make meetups', true, sqlerrm); end $$;
do $$ begin perform check_in('8dc45317-2f2a-4f66-b6e2-0a600537f16e', 32.6985, -117.1300);
  insert into t_results values ('suspended members can''t check in', false, 'no error');
exception when others then insert into t_results values ('suspended members can''t check in', true, sqlerrm); end $$;
reset role;

insert into t_results select 'cron jobs scheduled', count(*) = 2, string_agg(jobname, ',') from cron.job where jobname in ('meetups-roll', 'meetups-finish');

do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
