-- Rolled-back check for 20261105070100_page_meetups (apply 20261105070000_page_meetups_enums first).
-- Runs the migration and the checks in one transaction, then raises CHECK <ok> of <total>: <failures>,
-- so nothing is kept. Member checks run as throwaway members made in the transaction.
begin;

-- Brand and shop accounts part A, PR 9: pages as meetup hosts.
-- PRDs: Grindylocks — Meetups PRD › Pages as hosts; Brand and Shop Accounts
-- PRD › Acting as a page, Goes quiet. Mockups: the "Pages as meetup hosts
-- (PR 9)" row of the Brand accounts (v2) page (PageMeet-*), plus
-- Shop-Meetup-Compose. Decisions: Product Decisions, Nov 4 (~7:05 p.m.) and
-- Nov 5 (the plan).
--
--  1. The host. event_series.host_id becomes optional and host_page_id is
--     added; a meetup has exactly one. A page meetup has no 'host' row in
--     event_hosts (co-hosts, people only, still do). The member who made it
--     is kept in private.event_series_makers, read only by functions.
--     private.hosts_series() counts anyone who can act as the page (staff
--     and up, page managed, not suspended or frozen) as a host, which carries
--     editing, cancelling dates, hidden dates and HOST everywhere.
--     private.is_main_host() (delete, end the series, change co-hosts) is the
--     member who made it, or the page's managers and owner.
--     Making one needs private.can_post_as_page() (a logo, not closed).
--  2. Who sees it: the page's blocks both ways (user_page_blocks and
--     page_blocks) as well as the co-hosts' blocks; Followers only means the
--     page's followers plus the co-hosts' followers. Home adds meetups from
--     pages you follow and haven't muted; page_meetups() feeds Upcoming on
--     page screens. Page meetups never reach the maker's own profile.
--  3. The place: park_id becomes optional; place is park, page (the host's
--     own storefront, live: it follows the shop if its address changes) or
--     address (an address and a pin in the page's metro area). Time zones
--     come from private.place_tz(): the park's, else the page's own. Seasons
--     stay parks only. Reports and hiding for places that aren't parks go to
--     that metro's city admin, with Rachel as backup.
--  4. Several days (pages only): events.multi_day and event_days (one row
--     per day with its hours). A date spans the whole thing, so going,
--     reminders (an hour before the first day) and clean-up work unchanged.
--     Single days stay capped at 24 hours; several days at 14, no repeats.
--  5. Page-only fields on the series and each date: capacity (set_going()
--     refuses once it's full; hosts and co-hosts don't count), ticket_url
--     (https:// only) and adults_only (going needs confirmed_adult).
--  6. Notices: changes, cancellations and comments from a page meetup come
--     from the page (notifications.page_id, no actor_id); the hosts' rows go
--     to the whole team and the co-hosts. A page can comment on its own
--     meetups (event_comments.page_id; the member in
--     private.event_comment_makers).
--  7. Page tools: Suspend with "cancel upcoming meetups" (page_suspended) and
--     Close for good (page_closed, always) cancel the page's upcoming dates
--     and end its series. merge_pages() moves page meetups to the target.
--
-- Patched (pg_temp.patch, one exact passage each): my_notifications(),
-- push_claim(), file_report(), moderation_queue(), moderation_report_detail(),
-- suspend_page(), admin_close_page(), merge_pages().
--
-- No meetups existed when this was written (0 series), so the columns change
-- in place with no data to carry over.

/* 0. Patching helper --------------------------------------------------------------------- */

create or replace function pg_temp.patch(def text, old_part text, new_part text, what text)
returns text
language plpgsql
as $$
declare
  pat text := regexp_replace(regexp_replace(btrim(old_part), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '\s+', '\\s+', 'g');
  hits integer;
begin
  select count(*) into hits from regexp_matches(def, pat, 'g');
  if hits <> 1 then
    raise exception '%: the passage to patch was found % times', what, hits;
  end if;
  return replace(def, substring(def from pat), new_part);
end $$;

/* 1. Columns ------------------------------------------------------------------------------ */

alter table public.event_series
  alter column host_id drop not null,
  alter column park_id drop not null,
  add column if not exists host_page_id uuid references public.pages (id),
  add column if not exists place public.meetup_place not null default 'park',
  add column if not exists address text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists metro_area_id uuid references public.metro_areas (id),
  add column if not exists capacity integer,
  add column if not exists ticket_url text,
  add column if not exists adults_only boolean not null default false,
  add column if not exists multi_day boolean not null default false;

alter table public.events
  alter column park_id drop not null,
  add column if not exists place public.meetup_place not null default 'park',
  add column if not exists address text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists metro_area_id uuid references public.metro_areas (id),
  add column if not exists capacity integer,
  add column if not exists ticket_url text,
  add column if not exists adults_only boolean not null default false,
  add column if not exists multi_day boolean not null default false;

create index if not exists event_series_host_page_idx on public.event_series (host_page_id) where host_page_id is not null;

-- One host: a person or a page.
alter table public.event_series drop constraint if exists event_series_one_host;
alter table public.event_series add constraint event_series_one_host
  check (num_nonnulls(host_id, host_page_id) = 1);

-- Length: 24 hours, or 14 days for a page meetup over several days.
alter table public.event_series drop constraint if exists event_series_duration_check;
alter table public.event_series add constraint event_series_duration_check
  check (duration > interval '0'
         and duration <= case when multi_day then interval '14 days' else interval '24 hours' end);
alter table public.events drop constraint if exists events_check;
alter table public.events add constraint events_check
  check (ends_at > starts_at
         and ends_at <= starts_at + case when multi_day then interval '14 days' else interval '24 hours' end);

-- The place and the page-only fields, on both tables.
do $$
declare
  t text;
begin
  foreach t in array array['event_series', 'events'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_place_check');
    execute format($c$alter table public.%I add constraint %I check (
      (place = 'park') = (park_id is not null)
      and (place = 'address') = (address is not null)
      and (place <> 'address' or (latitude between -90 and 90 and longitude between -180 and 180 and metro_area_id is not null))
      and (place = 'address' or (latitude is null and longitude is null and metro_area_id is null))
      and (address is null or char_length(address) between 1 and 200)
    )$c$, t, t || '_place_check');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_page_fields_check');
    execute format($c$alter table public.%I add constraint %I check (
      (capacity is null or capacity between 1 and 10000)
      and (ticket_url is null or (ticket_url ~ '^https://\S+$' and char_length(ticket_url) <= 500))
    )$c$, t, t || '_page_fields_check');
  end loop;
end $$;

-- Places other than parks, and every page-only field, need a page host;
-- several days can't repeat.
alter table public.event_series drop constraint if exists event_series_page_only_check;
alter table public.event_series add constraint event_series_page_only_check check (
  (host_page_id is not null
   or (place = 'park' and capacity is null and ticket_url is null and not adults_only and not multi_day))
  and (not multi_day or cardinality(weekdays) = 0)
);

-- 18+ meetups: when this person confirmed they're 18 or older.
alter table public.event_going add column if not exists confirmed_adult_at timestamptz;

-- The days of a meetup over several days, each with its own hours.
create table if not exists public.event_days (
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  primary key (event_id, day),
  check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours')
);

-- Who on the team made a page meetup. Never shown outside the team.
create table if not exists private.event_series_makers (
  series_id uuid primary key references public.event_series (id) on delete cascade,
  page_id uuid not null references public.pages (id),
  member_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- A page commenting on its own meetup.
alter table public.event_comments
  alter column author_id drop not null,
  add column if not exists page_id uuid references public.pages (id);
alter table public.event_comments drop constraint if exists event_comments_one_author;
alter table public.event_comments add constraint event_comments_one_author
  check (num_nonnulls(author_id, page_id) = 1);

create table if not exists private.event_comment_makers (
  comment_id uuid primary key references public.event_comments (id) on delete cascade,
  page_id uuid not null references public.pages (id),
  member_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

revoke all on private.event_series_makers, private.event_comment_makers from public, anon, authenticated;

/* 2. Helpers ------------------------------------------------------------------------------ */

-- can_act_as_page() for any member, not only the caller.
create or replace function private.acts_as_page(page uuid, who uuid, at_least public.page_member_role default 'staff')
returns boolean
language sql stable security definer
set search_path = public
as $$
  select page is not null and who is not null
     and exists (select 1 from profiles u where u.id = who and u.deleted_at is null and u.banned_at is null)
     and exists (
       select 1 from page_members m join pages p on p.id = m.page_id
        where m.page_id = page and m.user_id = who
          and private.page_role_rank(m.role) >= private.page_role_rank(at_least)
          and p.state = 'managed' and p.suspended_at is null and p.frozen_at is null
     );
$$;

-- The host, an accepted co-host, or someone who can act as the host page.
create or replace function private.hosts_series(series uuid, who uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public
as $$
  select who is not null and (
    exists (
      select 1 from event_hosts h
       where h.series_id = series and h.user_id = who
         and (h.role = 'host' or h.accepted_at is not null)
    )
    or exists (
      select 1 from event_series s
       where s.id = series and s.host_page_id is not null and private.acts_as_page(s.host_page_id, who)
    )
  );
$$;

-- Deleting, ending the series and changing co-hosts: the person hosting, or
-- for a page, the member who made it (still on the team) and the page's
-- managers and owner.
create or replace function private.is_main_host(series uuid, who uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public
as $$
  select who is not null and exists (
    select 1 from event_series s
     where s.id = series
       and (s.host_id = who
            or (s.host_page_id is not null
                and (private.acts_as_page(s.host_page_id, who, 'manager')
                     or (private.acts_as_page(s.host_page_id, who)
                         and exists (select 1 from private.event_series_makers k
                                      where k.series_id = s.id and k.member_id = who)))))
  );
$$;

-- Everyone who hears what hosts hear: the host, accepted co-hosts and, for
-- a page meetup, the page's team.
create or replace function private.series_host_people(series uuid)
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select h.user_id from event_hosts h
   where h.series_id = series and (h.role = 'host' or h.accepted_at is not null)
  union
  select m.user_id
    from event_series s
    join pages p on p.id = s.host_page_id and p.state = 'managed'
    join page_members m on m.page_id = p.id
   where s.id = series;
$$;

-- A place's clock: the park's, else the host page's own, else the metro's.
create or replace function private.place_tz(place public.meetup_place, park uuid, page uuid, metro uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    case place
      when 'park' then (select m.timezone from parks p join metro_areas m on m.id = p.metro_area_id where p.id = park)
      when 'page' then (select coalesce(p.timezone, m.timezone) from pages p left join metro_areas m on m.id = p.metro_area_id
                         where p.id = page)
      else coalesce((select m.timezone from metro_areas m where m.id = metro),
                    (select p.timezone from pages p where p.id = page))
    end,
    'UTC');
$$;

create or replace function private.event_tz(event uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select private.place_tz(e.place, e.park_id, s.host_page_id, e.metro_area_id)
    from events e join event_series s on s.id = e.series_id
   where e.id = event;
$$;

create or replace function private.series_tz(series uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select private.place_tz(s.place, s.park_id, s.host_page_id, s.metro_area_id) from event_series s where s.id = series;
$$;

-- The metro area a date's place is in (who moderates it when it isn't at a park).
create or replace function private.event_metro(event uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select case e.place
           when 'park' then (select p.metro_area_id from parks p where p.id = e.park_id)
           when 'page' then (select p.metro_area_id from pages p where p.id = s.host_page_id)
           else e.metro_area_id
         end
    from events e join event_series s on s.id = e.series_id
   where e.id = event;
$$;

-- Park admins for a park, otherwise the metro's city admin; Rachel always.
create or replace function private.can_moderate_meetup(event uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select private.is_owner() or exists (
    select 1 from events e
     where e.id = event
       and case when e.park_id is not null then private.can_moderate_park(e.park_id)
                else private.can_moderate_metro(private.event_metro(e.id)) end
  );
$$;

-- Checks a place and fills in what's stored for it.
create or replace function private.resolve_meetup_place(
  page uuid,
  place public.meetup_place,
  park uuid,
  address text,
  latitude double precision,
  longitude double precision,
  out o_park uuid,
  out o_address text,
  out o_latitude double precision,
  out o_longitude double precision,
  out o_metro uuid
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  p pages;
begin
  if place is null or place = 'park' then
    if not exists (select 1 from parks x where x.id = park) then
      raise exception 'Pick a park' using errcode = '22023';
    end if;
    o_park := park;
    return;
  end if;
  if page is null then
    raise exception 'Only pages can meet somewhere other than a park' using errcode = '22023';
  end if;
  select * into p from pages where id = page;
  if place = 'page' then
    -- A storefront, or a by-appointment shop that shows its pin.
    if p.latitude is null
       or p.location_type is null
       or not (p.location_type = 'storefront' or (p.location_type = 'by_appointment' and p.show_pin)) then
      raise exception 'This page has no location to meet at' using errcode = '22023';
    end if;
    return;
  end if;
  -- An address with a pin, in the page's metro area.
  if p.metro_area_id is null then
    raise exception 'This page needs a city before it can meet at an address' using errcode = '22023';
  end if;
  o_address := private.clean_text(address);
  if o_address is null or char_length(o_address) > 200 then
    raise exception 'Add the address' using errcode = '22023';
  end if;
  if latitude is null or longitude is null
     or latitude not between -90 and 90 or longitude not between -180 and 180 then
    raise exception 'Drop the pin on the map' using errcode = '22023';
  end if;
  o_latitude := latitude;
  o_longitude := longitude;
  o_metro := p.metro_area_id;
end $$;

-- Several days arrive as [{"starts_at": …, "ends_at": …}, …], one per day,
-- in order. 2 to 14 days in a row on the place's clock, each up to 24 hours.
create or replace function private.parse_meetup_days(days jsonb, tz text)
returns table (day date, starts_at timestamptz, ends_at timestamptz)
language plpgsql stable
set search_path = public
as $$
declare
  x jsonb;
  s timestamptz;
  f timestamptz;
  d date;
  prev date;
  n integer := 0;
begin
  if days is null or jsonb_typeof(days) <> 'array' or jsonb_array_length(days) not between 2 and 14 then
    raise exception 'Several days means 2 to 14 days' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(days) loop
    s := (x->>'starts_at')::timestamptz;
    f := (x->>'ends_at')::timestamptz;
    if s is null or f is null or f <= s or f > s + interval '24 hours' then
      raise exception 'Each day ends after it starts, within 24 hours' using errcode = '22023';
    end if;
    d := (s at time zone tz)::date;
    if prev is not null and d <> prev + 1 then
      raise exception 'The days run one after another' using errcode = '22023';
    end if;
    prev := d;
    n := n + 1;
    day := d; starts_at := s; ends_at := f;
    return next;
  end loop;
end $$;

create or replace function private.clean_ticket_url(url text)
returns text
language plpgsql immutable
as $$
declare
  u text := nullif(btrim(coalesce(url, '')), '');
begin
  if u is not null and (u !~ '^https://\S+$' or char_length(u) > 500) then
    raise exception 'A ticket link starts with https://' using errcode = '22023';
  end if;
  return u;
end $$;

/* 3. Who sees a meetup -------------------------------------------------------------------- */

create or replace function private.can_see_series_as(series uuid, viewer uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select viewer is not null and exists (
    select 1 from event_series s
     where s.id = series
       and (
         private.hosts_series(s.id, viewer)
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
           -- Nor with the host page, either way.
           and (s.host_page_id is null or (
             not exists (select 1 from user_page_blocks b where b.user_id = viewer and b.page_id = s.host_page_id)
             and not exists (select 1 from page_blocks b
                              where b.page_id = s.host_page_id and b.user_id = viewer and b.lifted_at is null)))
           and (
             s.visibility = 'public'
             or exists (
               select 1
                 from event_hosts h
                 join follows f on f.followee_id = h.user_id and f.follower_id = viewer and f.status = 'accepted'
                where h.series_id = s.id and (h.role = 'host' or h.accepted_at is not null)
             )
             or exists (select 1 from page_follows pf where pf.page_id = s.host_page_id and pf.user_id = viewer)
           )
         )
       )
  );
$$;

-- Park admins, or for other places the metro's city admin, also see hidden dates.
create or replace function private.can_see_event(event uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select private.can_see_event_as(event, auth.uid())
      or private.can_moderate_meetup(event);
$$;

/* 4. Making dates ------------------------------------------------------------------------- */

-- Makes the series' dates up to 12 weeks ahead (on the place's clock). Dates
-- that already exist are left alone. Returns how many dates were added.
create or replace function private.generate_meetup_dates(series uuid)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  s event_series;
  d date;
  last_day date;
  p uuid;
  tz text;
  home_tz text;
  start_local timestamp;
  added integer := 0;
begin
  select * into s from event_series where id = series for update;
  if s.id is null or s.ended_at is not null or cardinality(s.weekdays) = 0 then
    return 0;
  end if;
  home_tz := private.series_tz(s.id);
  last_day := least(coalesce(s.ends_on, 'infinity'::date), (now() at time zone home_tz)::date + 84);
  d := greatest(s.starts_on, (now() at time zone home_tz)::date - 1);
  while d <= last_day loop
    if extract(isodow from d)::smallint = any (s.weekdays) then
      p := null;
      if s.place = 'park' then
        select x.park_id into p
          from event_series_seasons x
         where x.series_id = s.id and private.month_in(extract(month from d)::int, x.from_month, x.to_month)
         order by x.from_month
         limit 1;
        p := coalesce(p, s.park_id);
        tz := private.place_tz('park', p, null, null);
      else
        tz := home_tz;
      end if;
      start_local := d + s.start_time;
      if (start_local at time zone tz) > now()
         and not exists (
           select 1 from events e
            where e.series_id = s.id
              and ((e.starts_at at time zone private.event_tz(e.id))::date) = d
         ) then
        insert into events (series_id, park_id, place, address, latitude, longitude, metro_area_id,
                            starts_at, ends_at, disciplines, title, note, cover_path,
                            capacity, ticket_url, adults_only)
        values (s.id, p, s.place, s.address, s.latitude, s.longitude, s.metro_area_id,
                start_local at time zone tz, (start_local at time zone tz) + s.duration,
                s.disciplines, s.title, s.note, s.cover_path,
                s.capacity, s.ticket_url, s.adults_only);
        added := added + 1;
      end if;
    end if;
    d := d + 1;
  end loop;
  return added;
end $$;

/* 5. Making and changing meetups ---------------------------------------------------------- */

drop function if exists public.create_meetup(uuid, timestamptz, timestamptz, text, text, public.meetup_visibility,
  public.discipline[], text, smallint[], date, jsonb, uuid[]);

-- Makes a meetup and returns its first date's id. People: a park, a time and
-- maybe a note. Pages (as_page) can also pick place 'page' or 'address', and
-- set capacity, a ticket link, 18+ and several days (days).
create or replace function public.create_meetup(
  park uuid default null,
  starts_at timestamptz default null,
  ends_at timestamptz default null,
  note text default null,
  title text default null,
  visibility public.meetup_visibility default null,
  disciplines public.discipline[] default null,
  cover_path text default null,
  weekdays smallint[] default null,
  repeat_ends_on date default null,
  seasons jsonb default null,
  co_hosts uuid[] default null,
  as_page uuid default null,
  place public.meetup_place default null,
  address text default null,
  latitude double precision default null,
  longitude double precision default null,
  capacity integer default null,
  ticket_url text default null,
  adults_only boolean default null,
  days jsonb default null
)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  host profiles;
  where_at record;
  the_place public.meetup_place := coalesce(create_meetup.place, 'park');
  tz text;
  first_start timestamptz := create_meetup.starts_at;
  finish timestamptz;
  several boolean := create_meetup.days is not null;
  link text := private.clean_ticket_url(create_meetup.ticket_url);
  s uuid;
  first_event uuid;
  co uuid;
begin
  if me is null or not private.is_active_member() then
    raise exception 'You can''t make meetups right now' using errcode = '42501';
  end if;
  if as_page is not null and not private.can_post_as_page(as_page) then
    raise exception 'You can''t make meetups as this page' using errcode = '42501';
  end if;
  if as_page is null and (the_place <> 'park' or create_meetup.capacity is not null or link is not null
                          or coalesce(create_meetup.adults_only, false) or several) then
    raise exception 'Only pages can use these meetup options' using errcode = '22023';
  end if;
  if create_meetup.capacity is not null and create_meetup.capacity not between 1 and 10000 then
    raise exception 'Capacity is 1 to 10000' using errcode = '22023';
  end if;

  select * into where_at
    from private.resolve_meetup_place(as_page, the_place, create_meetup.park, create_meetup.address,
                                      create_meetup.latitude, create_meetup.longitude);
  tz := private.place_tz(the_place, where_at.o_park, as_page, where_at.o_metro);

  if several then
    if cardinality(coalesce(create_meetup.weekdays, '{}')) > 0 then
      raise exception 'A meetup over several days can''t repeat' using errcode = '22023';
    end if;
    select min(d.starts_at), max(d.ends_at) into first_start, finish
      from private.parse_meetup_days(create_meetup.days, tz) d;
  else
    finish := coalesce(create_meetup.ends_at, create_meetup.starts_at + interval '2 hours');
    if first_start is null or finish <= first_start or finish > first_start + interval '24 hours' then
      raise exception 'A meetup ends after it starts, within 24 hours' using errcode = '22023';
    end if;
  end if;
  if finish <= now() or first_start > now() + interval '1 year' then
    raise exception 'Pick a time that hasn''t passed, within a year' using errcode = '22023';
  end if;
  if cardinality(coalesce(co_hosts, '{}')) > 10 then
    raise exception 'A meetup can have at most 10 co-hosts' using errcode = '22023';
  end if;
  if the_place <> 'park' and seasons is not null and jsonb_typeof(seasons) = 'array' and jsonb_array_length(seasons) > 0 then
    raise exception 'Seasons are for meetups at parks' using errcode = '22023';
  end if;

  select * into host from profiles where id = me;

  insert into event_series (host_id, host_page_id, park_id, place, address, latitude, longitude, metro_area_id,
                            visibility, disciplines, title, note, cover_path,
                            weekdays, start_time, duration, starts_on, ends_on,
                            capacity, ticket_url, adults_only, multi_day)
  values (
    case when as_page is null then me end, as_page,
    where_at.o_park, the_place, where_at.o_address, where_at.o_latitude, where_at.o_longitude, where_at.o_metro,
    coalesce(create_meetup.visibility,
             case when as_page is null and host.is_private then 'followers' else 'public' end::meetup_visibility),
    coalesce(create_meetup.disciplines, case when as_page is null then host.disciplines end, '{}'),
    private.clean_text(create_meetup.title),
    private.clean_text(create_meetup.note),
    create_meetup.cover_path,
    coalesce((select array_agg(distinct w order by w) from unnest(create_meetup.weekdays) w), '{}'),
    (first_start at time zone tz)::time,
    finish - first_start,
    (first_start at time zone tz)::date,
    repeat_ends_on,
    create_meetup.capacity, link, coalesce(create_meetup.adults_only, false), several
  )
  returning id into s;

  if as_page is null then
    insert into event_hosts (series_id, user_id, role, accepted_at) values (s, me, 'host', now());
  else
    insert into private.event_series_makers (series_id, page_id, member_id) values (s, as_page, me);
  end if;

  foreach co in array coalesce(co_hosts, '{}') loop
    if co <> me
       and exists (select 1 from profiles where id = co and deleted_at is null and banned_at is null)
       and not exists (select 1 from blocks where (blocker_id = me and blocked_id = co) or (blocker_id = co and blocked_id = me))
       and (as_page is null or (
             not exists (select 1 from user_page_blocks b where b.user_id = co and b.page_id = as_page)
             and not exists (select 1 from page_blocks b where b.page_id = as_page and b.user_id = co and b.lifted_at is null)
             -- The team manages a page meetup as the page; they aren't co-hosts.
             and not exists (select 1 from page_members m where m.page_id = as_page and m.user_id = co))) then
      insert into event_hosts (series_id, user_id, role, invited_by) values (s, co, 'co_host', me)
      on conflict do nothing;
    end if;
  end loop;

  if cardinality(coalesce(create_meetup.weekdays, '{}')) = 0 then
    insert into events (series_id, park_id, place, address, latitude, longitude, metro_area_id,
                        starts_at, ends_at, disciplines, title, note, cover_path,
                        capacity, ticket_url, adults_only, multi_day)
    select s, x.park_id, x.place, x.address, x.latitude, x.longitude, x.metro_area_id,
           first_start, finish, x.disciplines, x.title, x.note, x.cover_path,
           x.capacity, x.ticket_url, x.adults_only, x.multi_day
      from event_series x where x.id = s
    returning id into first_event;
    if several then
      insert into event_days (event_id, day, starts_at, ends_at)
      select first_event, d.day, d.starts_at, d.ends_at from private.parse_meetup_days(create_meetup.days, tz) d;
    end if;
  else
    if the_place = 'park' then
      perform private.set_series_seasons(s, seasons);
    end if;
    perform private.generate_meetup_dates(s);
    select e.id into first_event from events e where e.series_id = s order by e.starts_at limit 1;
    if first_event is null then
      raise exception 'No dates fall in the next 12 weeks' using errcode = '22023';
    end if;
  end if;

  return first_event;
end $$;

-- Edits a date, or with scope 'upcoming' this date and every later one (and
-- the series, so new dates follow). changes may hold park, starts_at,
-- ends_at, title, note, cover_path, disciplines and visibility (always the
-- whole meetup) and, for pages, place, address, latitude, longitude,
-- capacity, ticket_url, adults_only and days (several days). Missing keys
-- stay as they are; an empty title, note, ticket_url or capacity clears it.
-- Hosts, co-hosts and the page's team can edit. Returns how many dates changed.
create or replace function public.update_meetup(event uuid, scope text, changes jsonb)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  e events;
  s event_series;
  tz text;
  new_start timestamptz;
  new_end timestamptz;
  new_place public.meetup_place;
  where_at record;
  place_changed boolean;
  local_start time;
  len interval;
  new_capacity integer;
  new_link text;
  new_adults boolean;
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

  if s.host_page_id is null and (changes ?| array['place', 'address', 'latitude', 'longitude', 'capacity',
                                                  'ticket_url', 'adults_only', 'days']) then
    raise exception 'Only pages can use these meetup options' using errcode = '22023';
  end if;
  if changes ? 'days' and not e.multi_day then
    raise exception 'Only a meetup over several days has days' using errcode = '22023';
  end if;

  -- The place.
  place_changed := changes ?| array['place', 'park', 'address', 'latitude', 'longitude'];
  new_place := coalesce((changes->>'place')::meetup_place, case when changes ? 'park' then 'park'::meetup_place end, e.place);
  if place_changed then
    select * into where_at
      from private.resolve_meetup_place(s.host_page_id, new_place,
             coalesce((changes->>'park')::uuid, e.park_id),
             coalesce(changes->>'address', e.address),
             coalesce((changes->>'latitude')::double precision, e.latitude),
             coalesce((changes->>'longitude')::double precision, e.longitude));
  else
    select e.park_id as o_park, e.address as o_address, e.latitude as o_latitude,
           e.longitude as o_longitude, e.metro_area_id as o_metro into where_at;
  end if;
  tz := private.place_tz(new_place, where_at.o_park, s.host_page_id, where_at.o_metro);

  -- The time.
  if changes ? 'days' then
    select min(d.starts_at), max(d.ends_at) into new_start, new_end
      from private.parse_meetup_days(changes->'days', tz) d;
  else
    new_start := coalesce((changes->>'starts_at')::timestamptz, e.starts_at);
    new_end := coalesce((changes->>'ends_at')::timestamptz,
                        case when changes ? 'starts_at' then new_start + (e.ends_at - e.starts_at) else e.ends_at end);
  end if;
  if new_end <= new_start or new_end <= now()
     or new_end > new_start + (case when e.multi_day then interval '14 days' else interval '24 hours' end) then
    raise exception 'A meetup ends after it starts, within 24 hours, and not in the past' using errcode = '22023';
  end if;
  if e.multi_day and not (changes ? 'days') and (changes ? 'starts_at' or changes ? 'ends_at') then
    raise exception 'Change a meetup over several days by its days' using errcode = '22023';
  end if;

  -- Page-only fields.
  new_capacity := case when changes ? 'capacity' then nullif(changes->>'capacity', '')::integer else e.capacity end;
  if new_capacity is not null and new_capacity not between 1 and 10000 then
    raise exception 'Capacity is 1 to 10000' using errcode = '22023';
  end if;
  new_link := case when changes ? 'ticket_url' then private.clean_ticket_url(changes->>'ticket_url') else e.ticket_url end;
  new_adults := coalesce((changes->>'adults_only')::boolean, e.adults_only);

  if changes ? 'visibility' then
    update event_series set visibility = (changes->>'visibility')::meetup_visibility, updated_at = now()
     where id = s.id;
  end if;

  if scope = 'date' or cardinality(s.weekdays) = 0 then
    update events x set
      park_id = where_at.o_park, place = new_place, address = where_at.o_address,
      latitude = where_at.o_latitude, longitude = where_at.o_longitude, metro_area_id = where_at.o_metro,
      starts_at = new_start,
      ends_at = new_end,
      capacity = new_capacity, ticket_url = new_link, adults_only = new_adults,
      title = case when changes ? 'title' then private.clean_text(changes->>'title') else x.title end,
      note = case when changes ? 'note' then private.clean_text(changes->>'note') else x.note end,
      cover_path = case when changes ? 'cover_path' then nullif(changes->>'cover_path', '') else x.cover_path end,
      disciplines = case when changes ? 'disciplines'
                         then array(select jsonb_array_elements_text(changes->'disciplines'))::discipline[]
                         else x.disciplines end,
      updated_at = now()
     where x.id = e.id;
    get diagnostics n = row_count;
    if changes ? 'days' then
      delete from event_days where event_id = e.id;
      insert into event_days (event_id, day, starts_at, ends_at)
      select e.id, d.day, d.starts_at, d.ends_at from private.parse_meetup_days(changes->'days', tz) d;
    end if;
    if cardinality(s.weekdays) = 0 then
      -- A one-off's series mirrors its only date.
      update event_series set park_id = where_at.o_park, place = new_place, address = where_at.o_address,
             latitude = where_at.o_latitude, longitude = where_at.o_longitude, metro_area_id = where_at.o_metro,
             capacity = new_capacity, ticket_url = new_link, adults_only = new_adults,
             title = (select title from events where id = e.id),
             note = (select note from events where id = e.id), cover_path = (select cover_path from events where id = e.id),
             disciplines = (select disciplines from events where id = e.id),
             start_time = (new_start at time zone tz)::time,
             duration = new_end - new_start, starts_on = (new_start at time zone tz)::date,
             updated_at = now()
       where id = s.id;
    end if;
    return n;
  end if;

  -- This date and every later one.
  if place_changed and exists (select 1 from event_series_seasons where series_id = s.id) then
    raise exception 'This meetup''s park comes from its seasons; change them in Repeats' using errcode = '22023';
  end if;
  local_start := (new_start at time zone tz)::time;
  len := new_end - new_start;

  update event_series set
    park_id = case when place_changed then where_at.o_park else park_id end,
    place = new_place,
    address = case when place_changed then where_at.o_address else address end,
    latitude = case when place_changed then where_at.o_latitude else latitude end,
    longitude = case when place_changed then where_at.o_longitude else longitude end,
    metro_area_id = case when place_changed then where_at.o_metro else metro_area_id end,
    start_time = local_start,
    duration = len,
    capacity = new_capacity, ticket_url = new_link, adults_only = new_adults,
    title = case when changes ? 'title' then private.clean_text(changes->>'title') else title end,
    note = case when changes ? 'note' then private.clean_text(changes->>'note') else note end,
    cover_path = case when changes ? 'cover_path' then nullif(changes->>'cover_path', '') else cover_path end,
    disciplines = case when changes ? 'disciplines'
                       then array(select jsonb_array_elements_text(changes->'disciplines'))::discipline[]
                       else disciplines end,
    updated_at = now()
   where id = s.id;

  update events x set
    park_id = case when place_changed then where_at.o_park else x.park_id end,
    place = case when place_changed then new_place else x.place end,
    address = case when place_changed then where_at.o_address else x.address end,
    latitude = case when place_changed then where_at.o_latitude else x.latitude end,
    longitude = case when place_changed then where_at.o_longitude else x.longitude end,
    metro_area_id = case when place_changed then where_at.o_metro else x.metro_area_id end,
    starts_at = (((x.starts_at at time zone private.event_tz(x.id))::date + local_start)
                 at time zone case when place_changed then tz else private.event_tz(x.id) end),
    ends_at = (((x.starts_at at time zone private.event_tz(x.id))::date + local_start)
               at time zone case when place_changed then tz else private.event_tz(x.id) end) + len,
    capacity = new_capacity, ticket_url = new_link, adults_only = new_adults,
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

-- Hosts can't pick the page tools' cancel reasons.
create or replace function private.guard_meetup_cancel_reason()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.cancel_reason in ('page_closed', 'page_suspended')
     and new.cancel_reason is distinct from old.cancel_reason
     and coalesce(current_setting('grindylocks.page_tools', true), '') <> 'on' then
    raise exception 'Pick a reason for cancelling' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists guard_meetup_cancel_reason on public.events;
create trigger guard_meetup_cancel_reason before update of cancel_reason on public.events
  for each row execute function private.guard_meetup_cancel_reason();

/* 6. Going -------------------------------------------------------------------------------- */

drop function if exists public.set_going(uuid, boolean, boolean, boolean);

-- I'm going (going = true) or not. A full meetup turns new people away
-- (hosts and co-hosts don't take a spot); an 18+ meetup needs
-- confirmed_adult the first time.
create or replace function public.set_going(
  event uuid,
  going boolean,
  going_privately boolean default null,
  remind_me boolean default null,
  confirmed_adult boolean default null
)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e events;
  default_private boolean;
  already boolean;
begin
  select * into e from events where id = set_going.event for update;
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
    return;
  end if;
  already := exists (select 1 from event_going g where g.event_id = e.id and g.user_id = me);
  if not already then
    if e.adults_only and not coalesce(confirmed_adult, false) then
      raise exception 'adult_confirm_needed' using errcode = '22023';
    end if;
    if e.capacity is not null and (select count(*) from event_going g where g.event_id = e.id) >= e.capacity then
      raise exception 'meetup_full' using errcode = '22023';
    end if;
  end if;
  select coalesce(p.going_privately_default, p.is_private) into default_private from profiles p where p.id = me;
  insert into event_going as g (event_id, user_id, going_privately, remind_me, confirmed_adult_at)
  values (e.id, me, coalesce(set_going.going_privately, default_private), coalesce(set_going.remind_me, false),
          case when e.adults_only then now() end)
  on conflict (event_id, user_id) do update
    set going_privately = coalesce(set_going.going_privately, g.going_privately),
        remind_me = coalesce(set_going.remind_me, g.remind_me);
end $$;

/* 7. Fields the app reads with a date ----------------------------------------------------- */

-- The host page, or null for a person's meetup.
create or replace function public.meetup_host_page(public.events)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name,
                            'logo_path', p.logo_path, 'state', p.state, 'roles', p.roles)
    from event_series s join pages p on p.id = s.host_page_id
   where s.id = $1.series_id;
$$;

-- Where it happens: {kind, park, page, address, latitude, longitude, metro_name}.
create or replace function public.meetup_place_info(public.events)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'kind', $1.place,
    'park', (select jsonb_build_object('id', k.id, 'slug', k.slug, 'display_name', k.display_name)
               from parks k where k.id = $1.park_id),
    'page', case when $1.place = 'page' then (
              select jsonb_build_object('id', p.id, 'handle', p.handle, 'display_name', p.display_name,
                                        'address', p.address, 'latitude', p.latitude, 'longitude', p.longitude)
                from event_series s join pages p on p.id = s.host_page_id where s.id = $1.series_id) end,
    'address', case when $1.place = 'page' then
                 (select p.address from event_series s join pages p on p.id = s.host_page_id where s.id = $1.series_id)
               else $1.address end,
    'latitude', case when $1.place = 'page' then
                  (select p.latitude from event_series s join pages p on p.id = s.host_page_id where s.id = $1.series_id)
                else $1.latitude end,
    'longitude', case when $1.place = 'page' then
                   (select p.longitude from event_series s join pages p on p.id = s.host_page_id where s.id = $1.series_id)
                 else $1.longitude end,
    'metro_name', (select m.name from metro_areas m where m.id = private.event_metro($1.id))
  );
$$;

-- The place's clock.
create or replace function public.meetup_timezone(public.events)
returns text
language sql stable security definer
set search_path = public
as $$
  select private.event_tz($1.id);
$$;

-- Official: hosted by the page that runs the park.
create or replace function public.meetup_official(public.events)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select $1.park_id is not null and exists (
    select 1 from event_series s join parks k on k.run_by_page_id = s.host_page_id
     where s.id = $1.series_id and k.id = $1.park_id
  );
$$;

-- Spots taken: everyone going (hosts and co-hosts don't take one).
create or replace function public.spots_taken(public.events)
returns integer
language sql stable security definer
set search_path = public
as $$
  select case when $1.capacity is null then null
              else (select count(*)::integer from event_going g where g.event_id = $1.id) end;
$$;

-- The days of a meetup over several days, in order.
create or replace function public.meetup_days(public.events)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'starts_at', d.starts_at, 'ends_at', d.ends_at)
                            order by d.day), '[]'::jsonb)
    from event_days d where d.event_id = $1.id;
$$;

-- Whether you're on the host page's team (you manage it as the page).
create or replace function public.i_run_meetup(public.events)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from event_series s
                  where s.id = $1.series_id and s.host_page_id is not null
                    and private.acts_as_page(s.host_page_id, auth.uid()));
$$;

-- The host and accepted co-hosts; a page host comes first as kind 'page'.
create or replace function public.host_list(public.events)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_array(jsonb_build_object('kind', 'page', 'id', p.id, 'handle', p.handle,
                                                'username', p.display_name, 'avatar_path', null,
                                                'logo_path', p.logo_path, 'role', 'host'))
      from event_series s join pages p on p.id = s.host_page_id where s.id = $1.series_id
  ), '[]'::jsonb)
  || coalesce((
    select jsonb_agg(jsonb_build_object('kind', 'person', 'id', u.id, 'username', u.username,
                                        'avatar_path', u.avatar_path, 'role', h.role)
                     order by h.role = 'host' desc, h.accepted_at)
      from event_hosts h
      join profiles u on u.id = h.user_id and u.deleted_at is null
     where h.series_id = $1.series_id and (h.role = 'host' or h.accepted_at is not null)
  ), '[]'::jsonb);
$$;

/* 8. Where page meetups show -------------------------------------------------------------- */

create or replace function public.feed_meetups(newer_than timestamptz default null, up_to timestamptz default null, max_results integer default 20)
returns setof public.events
language sql stable
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
       or exists (
         select 1 from event_series s
           join page_follows pf on pf.page_id = s.host_page_id and pf.user_id = (select auth.uid())
          where s.id = e.series_id
            and not exists (select 1 from page_mutes pm where pm.page_id = s.host_page_id and pm.user_id = (select auth.uid()))
       )
     )
     and public.feed_at(e) <= now()
     and (newer_than is null or public.feed_at(e) > newer_than)
     and (up_to is null or public.feed_at(e) <= up_to)
   order by public.feed_at(e) desc, e.id desc
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- Upcoming on a page screen: each series' next date, cancelled ones too
-- (crossed out), soonest first.
create or replace function public.page_meetups(page uuid, max_results integer default 20)
returns setof public.events
language sql stable
set search_path = public
as $$
  select * from (
    select distinct on (e.series_id) e.*
      from events e
      join event_series s on s.id = e.series_id
     where s.host_page_id = page_meetups.page and e.ends_at > now() and private.meetup_shown(e)
     order by e.series_id, e.starts_at
  ) up
   order by up.starts_at, up.id
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

/* 9. Covers ------------------------------------------------------------------------------- */

-- A page meetup's cover is a photo from someone on the page's team.
create or replace function private.guard_meetup_cover()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  series uuid;
  page uuid;
  folder text := split_part(coalesce(new.cover_path, ''), '/', 1);
begin
  if new.cover_path is null or (tg_op = 'UPDATE' and new.cover_path is not distinct from old.cover_path) then
    return new;
  end if;
  if new.cover_path !~ '^[0-9a-f-]{36}/[^/]+\.jpg$' then
    raise exception 'Not a meetup cover' using errcode = '22023';
  end if;
  if tg_table_name = 'event_series' then
    if folder = new.host_id::text then
      return new;
    end if;
    if new.host_page_id is not null and folder = auth.uid()::text and private.acts_as_page(new.host_page_id, auth.uid()) then
      return new;
    end if;
    series := new.id;
  else
    series := new.series_id;
  end if;
  select s.host_page_id into page from event_series s where s.id = series;
  if not exists (
       select 1 from event_hosts h
        where h.series_id = series and h.user_id::text = folder
          and (h.role = 'host' or h.accepted_at is not null))
     and not (page is not null and exists (select 1 from page_members m where m.page_id = page and m.user_id::text = folder)) then
    raise exception 'A meetup''s cover has to be a host''s photo' using errcode = '42501';
  end if;
  return new;
end $$;

/* 10. Notices ----------------------------------------------------------------------------- */

drop function if exists private.notify_meetup(uuid, public.notification_kind, uuid, uuid, uuid, uuid, text);

-- from_page: the notice comes from that page (no actor), as page posts do.
create or replace function private.notify_meetup(
  recipient uuid,
  what public.notification_kind,
  actor uuid,
  event uuid default null,
  series uuid default null,
  comment uuid default null,
  msg text default null,
  from_page uuid default null
)
returns void
language plpgsql volatile security definer
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
  if from_page is not null and (
       exists (select 1 from user_page_blocks b where b.user_id = recipient and b.page_id = from_page)
       or exists (select 1 from page_blocks b where b.page_id = from_page and b.user_id = recipient and b.lifted_at is null)) then
    return;
  end if;
  if event is not null and not private.can_see_event_as(event, recipient) then
    return;
  end if;
  if event is null and series is not null and not private.can_see_series_as(series, recipient) then
    return;
  end if;
  insert into notifications (recipient_id, kind, actor_id, event_id, series_id, event_comment_id, message, page_id)
  values (recipient, what, case when from_page is null then actor end, event, series, comment, left(msg, 500), from_page);
end $$;

create or replace function private.notify_meetup_going()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  e events;
  h uuid;
begin
  if tg_op = 'INSERT' then
    select * into e from events where id = new.event_id;
    for h in select private.series_host_people(e.series_id) loop
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

create or replace function private.notify_co_host_invite()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  pg uuid;
begin
  if tg_op = 'INSERT' then
    if new.role = 'co_host' and new.accepted_at is null then
      select host_page_id into pg from event_series where id = new.series_id;
      perform private.notify_meetup(new.user_id, 'co_host_invite', new.invited_by, null, new.series_id, null, null, pg);
    end if;
    return null;
  end if;
  if tg_op = 'DELETE' or (old.accepted_at is null and new.accepted_at is not null) then
    delete from notifications n
     where n.kind = 'co_host_invite' and n.series_id = old.series_id and n.recipient_id = old.user_id;
  end if;
  return null;
end $$;

create or replace function private.notify_meetup_updates()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform private.notify_meetup(f.user_id, 'meetup_changed', auth.uid(), f.id, null, null, f.what, f.page)
     from (select distinct on (g.user_id) g.user_id, n.id, s.host_page_id as page,
                  concat_ws(',',
                    case when n.starts_at <> o.starts_at or n.ends_at <> o.ends_at then 'time' end,
                    case when n.park_id is distinct from o.park_id or n.place <> o.place
                              or n.address is distinct from o.address
                              or n.latitude is distinct from o.latitude
                              or n.longitude is distinct from o.longitude then 'park' end) as what
             from new_rows n
             join old_rows o on o.id = n.id
             join event_series s on s.id = n.series_id
             join event_going g on g.event_id = n.id
            where n.status = 'scheduled' and o.status = 'scheduled' and n.ends_at > now()
              and (n.starts_at <> o.starts_at or n.ends_at <> o.ends_at
                   or n.park_id is distinct from o.park_id or n.place <> o.place
                   or n.address is distinct from o.address
                   or n.latitude is distinct from o.latitude or n.longitude is distinct from o.longitude)
            order by g.user_id, n.starts_at) f;
  delete from notifications x
   using new_rows n join old_rows o on o.id = n.id
   where n.starts_at <> o.starts_at and x.kind = 'meetup_reminder' and x.event_id = n.id;
  update event_going g set reminded_at = null
    from new_rows n join old_rows o on o.id = n.id
   where n.starts_at <> o.starts_at and g.event_id = n.id and g.reminded_at is not null;
  perform private.notify_meetup(f.user_id, 'meetup_cancelled', auth.uid(), f.id, null, null, f.reason, f.page)
     from (select distinct on (g.user_id) g.user_id, x.id, x.page,
                  x.cancel_reason::text || case when x.dates > 1 then ':series' else '' end as reason
             from (select n.id, n.starts_at, n.cancel_reason, s.host_page_id as page,
                          count(*) over (partition by n.series_id) as dates
                     from new_rows n
                     join old_rows o on o.id = n.id
                     join event_series s on s.id = n.series_id
                    where o.status = 'scheduled' and n.status = 'cancelled') x
             join event_going g on g.event_id = x.id
            order by g.user_id, x.starts_at) f;
  delete from notifications x
   using new_rows n join old_rows o on o.id = n.id
   where o.status = 'scheduled' and n.status = 'cancelled'
     and x.kind = 'meetup_reminder' and x.event_id = n.id;
  perform private.notify_meetup(h.person, 'meetup_hidden', null, n.id)
     from new_rows n
     join old_rows o on o.id = n.id
     cross join lateral private.series_host_people(n.series_id) as h(person)
    where o.hidden_at is null and n.hidden_at is not null;
  delete from notifications x
   using new_rows n join old_rows o on o.id = n.id
   where o.hidden_at is not null and n.hidden_at is null
     and x.kind = 'meetup_hidden' and x.event_id = n.id;
  return null;
end $$;

create or replace function private.notify_meetup_comment()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  e events;
  done uuid[] := array[coalesce(new.author_id, auth.uid())];
  person uuid;
begin
  select * into e from events where id = new.event_id;
  for person in
    select candidate
      from (
        -- A page's own comment doesn't go back to its team.
        select 1 as rank, h.person as candidate
          from private.series_host_people(e.series_id) as h(person)
         where new.page_id is null or not exists (select 1 from page_members m where m.page_id = new.page_id and m.user_id = h.person)
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
      perform private.notify_meetup(person, 'meetup_comment', new.author_id, new.event_id, null, new.id, null, new.page_id);
      done := done || person;
    end if;
  end loop;
  return null;
end $$;

-- The bell: page notices show the page as the actor, and use the place's clock.
do $$
declare
  def text := pg_get_functiondef('public.my_notifications()'::regprocedure);
begin
  def := pg_temp.patch(def,
    'a.username::text as actor_username, a.avatar_path as actor_avatar
      from notifications n
      left join event_comments ec on ec.id = n.event_comment_id',
    'a.username::text as actor_username, a.avatar_path as actor_avatar,
           case when mp.id is not null then
             jsonb_build_object(''id'', null, ''username'', mp.display_name, ''avatar_path'', null,
                                ''page'', jsonb_build_object(''id'', mp.id, ''handle'', mp.handle, ''display_name'', mp.display_name,
                                                           ''logo_path'', mp.logo_path, ''state'', mp.state))
           end as page_actor
      from notifications n
      left join pages mp on mp.id = n.page_id and n.actor_id is null
      left join event_comments ec on ec.id = n.event_comment_id',
    'my_notifications: meet page actor');
  def := pg_temp.patch(def,
    'and (n.actor_id is null or not private.blocked_between(n.actor_id))
       and (a.id is null or a.deleted_at is null)
  ),
  meet_typed as (',
    'and (n.actor_id is null or not private.blocked_between(n.actor_id))
       and (a.id is null or a.deleted_at is null)
       and (mp.id is null or not exists (select 1 from user_page_blocks ub where ub.user_id = me and ub.page_id = mp.id))
  ),
  meet_typed as (',
    'my_notifications: meet page blocks');
  def := pg_temp.patch(def,
    '(select jsonb_agg(jsonb_build_object(''id'', x.actor_id, ''username'', x.actor_username, ''avatar_path'', x.actor_avatar)
                             order by x.at desc)
              from (select t2.actor_id, max(t2.actor_username) as actor_username, max(t2.actor_avatar) as actor_avatar,
                           max(t2.at) as at
                      from meet_typed t2
                     where t2.shown_kind = t.shown_kind and t2.eid = t.eid
                     group by t2.actor_id',
    '(select jsonb_agg(coalesce(x.page_actor, jsonb_build_object(''id'', x.actor_id, ''username'', x.actor_username, ''avatar_path'', x.actor_avatar))
                             order by x.at desc)
              from (select t2.actor_id, max(t2.actor_username) as actor_username, max(t2.actor_avatar) as actor_avatar,
                           max(t2.at) as at, (array_agg(t2.page_actor))[1] as page_actor
                      from meet_typed t2
                     where t2.shown_kind = t.shown_kind and t2.eid = t.eid
                     group by t2.actor_id, (t2.page_actor->''page''->>''id'')',
    'my_notifications: grouped actors');
  def := pg_temp.patch(def,
    'count(distinct t.actor_id)::integer as people_count,',
    'count(distinct coalesce(t.actor_id::text, t.page_actor->''page''->>''id''))::integer as people_count,',
    'my_notifications: grouped count');
  def := pg_temp.patch(def,
    'case when t.actor_id is null or t.shown_kind = ''meetup_hidden'' then ''[]''::jsonb
                else jsonb_build_array(jsonb_build_object(''id'', t.actor_id, ''username'', t.actor_username, ''avatar_path'', t.actor_avatar))
           end,
           case when t.actor_id is null or t.shown_kind = ''meetup_hidden'' then 0 else 1 end,',
    'case when t.shown_kind = ''meetup_hidden'' then ''[]''::jsonb
                when t.page_actor is not null then jsonb_build_array(t.page_actor)
                when t.actor_id is null then ''[]''::jsonb
                else jsonb_build_array(jsonb_build_object(''id'', t.actor_id, ''username'', t.actor_username, ''avatar_path'', t.actor_avatar))
           end,
           case when t.shown_kind = ''meetup_hidden'' then 0 when t.page_actor is not null then 1
                when t.actor_id is null then 0 else 1 end,',
    'my_notifications: single actors');
  def := pg_temp.patch(def,
    'mr.eid, mr.estart, private.park_tz(mr.epark), mr.etitle, mr.gdetail',
    'mr.eid, mr.estart, private.event_tz(mr.eid), mr.etitle, mr.gdetail',
    'my_notifications: time zone');
  execute def;

  -- Pushes: the place's clock (the page's name already comes from n.page_id).
  def := pg_get_functiondef('public.push_claim(integer)'::regprocedure);
  def := pg_temp.patch(def,
    'case when ev.id is not null then private.park_tz(ev.park_id) end as etz,',
    'case when ev.id is not null then private.event_tz(ev.id) end as etz,',
    'push_claim: time zone');
  def := pg_temp.patch(def,
    '(n.kind::text not like ''page%'' and n.kind <> ''suggestion_live'' or pg.id is not null)',
    '(n.kind::text not like ''page%'' and n.kind <> ''suggestion_live'' or pg.id is not null)
             -- A page''s meetup notice: not to someone who blocked the page.
             and (n.event_id is null or n.page_id is null
                  or not exists (select 1 from user_page_blocks ub where ub.user_id = cl.recipient_id and ub.page_id = n.page_id))',
    'push_claim: page blocks');
  execute def;
end $$;

/* 11. A page commenting on its own meetup ------------------------------------------------- */

drop policy if exists "comment on a meetup" on public.event_comments;
create policy "comment on a meetup" on public.event_comments
  for insert to authenticated with check (
    deleted_at is null
    and private.is_active_member()
    and private.can_see_event(event_id)
    and (
      (author_id = (select auth.uid()) and page_id is null)
      or (author_id is null and page_id is not null
          and private.can_act_as_page(page_id)
          and exists (select 1 from events e join event_series s on s.id = e.series_id
                       where e.id = event_comments.event_id and s.host_page_id = event_comments.page_id))
    )
  );

drop policy if exists "read meetup comments" on public.event_comments;
create policy "read meetup comments" on public.event_comments
  for select to authenticated using (
    private.can_see_event(event_id)
    and (author_id is null or author_id = (select auth.uid()) or not private.blocked_between(author_id))
    and (page_id is null or not exists (select 1 from user_page_blocks b
                                         where b.user_id = (select auth.uid()) and b.page_id = event_comments.page_id))
  );

create or replace function private.record_event_comment_maker()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.page_id is not null then
    if auth.uid() is null then
      raise exception 'A page comment needs the member who made it';
    end if;
    insert into private.event_comment_makers (comment_id, page_id, member_id)
    values (new.id, new.page_id, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists record_event_comment_maker on public.event_comments;
create trigger record_event_comment_maker after insert on public.event_comments
  for each row execute function private.record_event_comment_maker();

drop function if exists public.meetup_comments(uuid);

-- The comments on a date. A page's comment has no author; page holds it.
create or replace function public.meetup_comments(event uuid)
returns table (id uuid, parent_id uuid, author_id uuid, username citext, avatar_path text, author_role text,
               reply_to_username citext, body text, created_at timestamptz, deleted boolean, page jsonb)
language sql stable security definer
set search_path = public
as $$
  select c.id, c.parent_id,
         case when c.deleted_at is null then c.author_id end,
         case when c.deleted_at is null then a.username end,
         case when c.deleted_at is null then a.avatar_path end,
         case when c.deleted_at is not null then null
              when c.page_id is not null then 'host'
              when h.role = 'host' then 'host'
              when h.role = 'co_host' then 'co_host' end,
         r.username,
         case when c.deleted_at is null then c.body end,
         c.created_at,
         c.deleted_at is not null,
         case when c.deleted_at is null and pg.id is not null then
           jsonb_build_object('id', pg.id, 'handle', pg.handle, 'display_name', pg.display_name, 'logo_path', pg.logo_path)
         end
    from event_comments c
    join events e on e.id = c.event_id
    left join profiles a on a.id = c.author_id
    left join pages pg on pg.id = c.page_id
    left join event_hosts h on h.series_id = e.series_id and h.user_id = c.author_id and (h.role = 'host' or h.accepted_at is not null)
    left join profiles r on r.id = c.reply_to_user_id
   where c.event_id = meetup_comments.event
     and private.can_see_event(c.event_id)
     and (c.author_id is null or c.author_id = auth.uid() or not private.blocked_between(c.author_id))
     and (c.page_id is null or not exists (select 1 from user_page_blocks b where b.user_id = auth.uid() and b.page_id = c.page_id))
     and (a.id is not null or pg.id is not null)
     and (c.deleted_at is null or exists (select 1 from event_comments k where k.parent_id = c.id and k.deleted_at is null))
   order by coalesce((select p.created_at from event_comments p where p.id = c.parent_id), c.created_at), c.parent_id nulls first, c.created_at;
$$;

/* 12. Moderation -------------------------------------------------------------------------- */

create or replace function private.can_moderate_report_target(post uuid, comment uuid, meetup uuid, meetup_comment uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when post is not null then
      case when (select p.page_id from posts p where p.id = post) is not null
           then private.can_review_page_content((select p.page_id from posts p where p.id = post))
           else private.can_moderate_post(post) end
    when comment is not null then
      case when (select c.page_id from comments c where c.id = comment) is not null
           then private.can_review_page_content((select c.page_id from comments c where c.id = comment))
           else private.can_moderate_post((select c.post_id from comments c where c.id = comment)) end
    when meetup is not null then private.can_moderate_meetup(meetup)
    when meetup_comment is not null then private.can_moderate_meetup((
      select c.event_id from event_comments c where c.id = meetup_comment))
    else false
  end;
$$;

create or replace function public.can_hide_meetup(event uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select private.can_moderate_meetup(can_hide_meetup.event);
$$;

create or replace function public.hide_meetup(event uuid, hide boolean default true)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e events;
  changed boolean;
begin
  select * into e from events where id = hide_meetup.event;
  if e.id is null or not private.can_moderate_meetup(e.id) then
    raise exception 'Only this park''s admins can hide its meetups' using errcode = '42501';
  end if;
  if hide then
    update events set hidden_at = now(), hidden_by = me, updated_at = now() where id = e.id and hidden_at is null;
  else
    update events set hidden_at = null, hidden_by = null, updated_at = now() where id = e.id and hidden_at is not null;
  end if;
  changed := found;
  if changed then
    insert into moderation_actions (actor_id, action, target_user_id, park_id, event_id, page_id)
    values (me, case when hide then 'meetup_hidden' else 'meetup_unhidden' end,
            (select host_id from event_series where id = e.series_id), e.park_id, e.id,
            (select host_page_id from event_series where id = e.series_id));
  end if;
end $$;

create or replace function public.delete_meetup_comment(comment uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  c event_comments;
  e events;
begin
  select * into c from event_comments where id = comment;
  select * into e from events where id = c.event_id;
  if c.id is null or not (c.author_id = auth.uid()
                          or private.hosts_series(e.series_id)
                          or private.can_moderate_meetup(e.id)) then
    raise exception 'You can''t delete this comment' using errcode = '42501';
  end if;
  update event_comments set deleted_at = now(), body = '[deleted]' where id = c.id;
end $$;

do $$
declare
  def text := pg_get_functiondef((select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                   where s.nspname = 'public' and p.proname = 'file_report'));
begin
  -- A page meetup has no person host: it's found by the date, and its team
  -- can't report it.
  def := pg_temp.patch(def,
    'if target_user is null or not private.can_see_event(meetup) then',
    'if not exists (select 1 from events e where e.id = meetup) or not private.can_see_event(meetup) then',
    'file_report: meetup host');
  def := pg_temp.patch(def,
    'or (comment is not null and c.page_id is not null and private.page_role_of(c.page_id) is not null) then',
    'or (comment is not null and c.page_id is not null and private.page_role_of(c.page_id) is not null)
     or (meetup is not null and exists (select 1 from events e join event_series s on s.id = e.series_id
                                         where e.id = meetup and s.host_page_id is not null
                                           and private.page_role_of(s.host_page_id) is not null))
     or (meetup_comment is not null and mc.page_id is not null and private.page_role_of(mc.page_id) is not null) then',
    'file_report: own page');
  def := pg_temp.patch(def,
    'or private.blocked_between(mc.author_id) then',
    'or (mc.author_id is not null and private.blocked_between(mc.author_id)) then',
    'file_report: page comment');
  execute def;

  -- The queue's city: a meetup away from a park takes its place's metro area.
  -- (Meetups keep their park routing, so they aren't marked as page content.)
  def := pg_get_functiondef((select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                              where s.nspname = 'public' and p.proname = 'moderation_queue'));
  def := pg_temp.patch(def,
    'po.metro_area_id, pk.metro_area_id, u.home_metro_area_id) as mid,',
    'po.metro_area_id, pk.metro_area_id, private.event_metro(ev.id), u.home_metro_area_id) as mid,',
    'moderation_queue: meetup metro');
  execute def;

  def := pg_get_functiondef((select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                              where s.nspname = 'public' and p.proname = 'moderation_report_detail'));
  def := pg_temp.patch(def,
    '''timezone'', private.park_tz(ev.park_id),',
    '''timezone'', private.event_tz(ev.id),',
    'moderation_report_detail: time zone');
  def := pg_temp.patch(def,
    '''host'', (select p.username::text from event_series s join profiles p on p.id = s.host_id where s.id = ev.series_id),',
    '''host'', coalesce((select p.username::text from event_series s join profiles p on p.id = s.host_id where s.id = ev.series_id),
                      (select pg.display_name from event_series s join pages pg on pg.id = s.host_page_id where s.id = ev.series_id)),
      ''place'', public.meetup_place_info(ev),',
    'moderation_report_detail: host');
  execute def;
end $$;

/* 13. Page tools -------------------------------------------------------------------------- */

-- Cancels a page's upcoming dates (not yet ended) and ends its series.
-- People going are told through the usual cancel notice, from the page.
create or replace function private.cancel_page_meetups(page uuid, why public.meetup_cancel_reason)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  n integer;
begin
  perform set_config('grindylocks.page_tools', 'on', true);
  update events e set status = 'cancelled', cancel_reason = why, cancelled_at = now(), updated_at = now()
    from event_series s
   where s.id = e.series_id and s.host_page_id = page
     and e.status = 'scheduled' and e.ends_at > now();
  get diagnostics n = row_count;
  update event_series set ended_at = now(), updated_at = now()
   where host_page_id = page and ended_at is null;
  perform set_config('grindylocks.page_tools', 'off', true);
  return n;
end $$;

do $$
declare
  def text := pg_get_functiondef('public.suspend_page(uuid, text, boolean, boolean)'::regprocedure);
begin
  def := pg_temp.patch(def,
    'perform private.notify_page_team(page, ''suspended'');',
    'if cancel_meetups then
    perform private.cancel_page_meetups(page, ''page_suspended'');
  end if;

  perform private.notify_page_team(page, ''suspended'');',
    'suspend_page: cancel meetups');
  execute def;

  def := pg_get_functiondef('public.admin_close_page(uuid, text, text)'::regprocedure);
  def := pg_temp.patch(def,
    'perform private.notify_page_team(page, ''closed'');',
    'perform private.cancel_page_meetups(page, ''page_closed'');
  perform private.notify_page_team(page, ''closed'');',
    'admin_close_page: cancel meetups');
  execute def;

  def := pg_get_functiondef('public.merge_pages(uuid, uuid, text)'::regprocedure);
  def := pg_temp.patch(def,
    'update private.page_comment_makers set page_id = target where page_id = source;',
    'update private.page_comment_makers set page_id = target where page_id = source;
  update event_series set host_page_id = target where host_page_id = source;
  update event_comments set page_id = target where page_id = source;
  update private.event_series_makers set page_id = target where page_id = source;
  update private.event_comment_makers set page_id = target where page_id = source;',
    'merge_pages: meetups');
  execute def;
end $$;

create or replace function private.merge_page_references()
returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'public.parks.run_by_page_id',             -- move
    'public.posts.page_id',                    -- move
    'public.comments.page_id',                 -- move
    'public.comments.reply_to_page_id',        -- move
    'public.notifications.actor_page_id',      -- move
    'public.notifications.page_id',            -- move (invites to the source's team: drop)
    'public.reports.impersonated_page_id',     -- move
    'public.moderation_actions.page_id',       -- move (the History comes along)
    'public.page_aliases.page_id',             -- move, plus the source's own name and handle
    'public.page_descriptions.page_id',        -- drop
    'public.page_links.page_id',               -- drop
    'public.page_hours.page_id',               -- drop
    'public.page_brands_carried.brand_id',     -- combine
    'public.page_brands_carried.shop_id',      -- combine
    'public.page_members.page_id',             -- close: the source's team is told and taken off
    'public.page_invites.page_id',             -- close
    'public.page_follows.page_id',             -- combine
    'public.page_mutes.page_id',               -- combine
    'public.user_page_blocks.page_id',         -- drop (they blocked a duplicate listing)
    'public.page_blocks.page_id',              -- close
    'public.page_reports.page_id',             -- close
    'public.page_suggestions.page_id',         -- move
    'public.page_mentions.page_id',            -- combine
    'public.page_mentions.by_page_id',         -- move
    'public.products.page_id',                 -- move (same-name clashes flagged)
    'public.products.partner_page_id',         -- move
    'public.product_suggestions.page_id',      -- move
    'public.page_claims.page_id',              -- close
    'private.page_emails.page_id',             -- close
    'public.page_fix_reports.page_id',         -- close
    'public.page_inbox_seen.page_id',          -- drop
    'private.page_post_makers.page_id',        -- move
    'private.page_comment_makers.page_id',     -- move
    'public.event_series.host_page_id',        -- move (page meetups)
    'public.event_comments.page_id',           -- move
    'private.event_series_makers.page_id',     -- move
    'private.event_comment_makers.page_id'     -- move
  ];
$$;

/* 14. Access ------------------------------------------------------------------------------ */

alter table public.event_days enable row level security;
drop policy if exists "read days of dates you can see" on public.event_days;
create policy "read days of dates you can see" on public.event_days
  for select to authenticated using (private.can_see_event(event_id));
grant select on public.event_days to authenticated;

revoke execute on function public.create_meetup(uuid, timestamptz, timestamptz, text, text, public.meetup_visibility,
  public.discipline[], text, smallint[], date, jsonb, uuid[], uuid, public.meetup_place, text, double precision,
  double precision, integer, text, boolean, jsonb) from public, anon;
grant execute on function public.create_meetup(uuid, timestamptz, timestamptz, text, text, public.meetup_visibility,
  public.discipline[], text, smallint[], date, jsonb, uuid[], uuid, public.meetup_place, text, double precision,
  double precision, integer, text, boolean, jsonb) to authenticated;

revoke execute on function public.set_going(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_going(uuid, boolean, boolean, boolean, boolean) to authenticated;

revoke execute on function public.meetup_comments(uuid), public.page_meetups(uuid, integer),
  public.meetup_host_page(public.events), public.meetup_place_info(public.events), public.meetup_timezone(public.events),
  public.meetup_official(public.events), public.spots_taken(public.events), public.meetup_days(public.events),
  public.i_run_meetup(public.events) from public, anon;
grant execute on function public.meetup_comments(uuid), public.page_meetups(uuid, integer),
  public.meetup_host_page(public.events), public.meetup_place_info(public.events), public.meetup_timezone(public.events),
  public.meetup_official(public.events), public.spots_taken(public.events), public.meetup_days(public.events),
  public.i_run_meetup(public.events) to authenticated;

revoke execute on function private.acts_as_page(uuid, uuid, public.page_member_role), private.series_host_people(uuid),
  private.place_tz(public.meetup_place, uuid, uuid, uuid), private.event_tz(uuid), private.series_tz(uuid),
  private.event_metro(uuid), private.can_moderate_meetup(uuid),
  private.resolve_meetup_place(uuid, public.meetup_place, uuid, text, double precision, double precision),
  private.parse_meetup_days(jsonb, text), private.clean_ticket_url(text),
  private.cancel_page_meetups(uuid, public.meetup_cancel_reason),
  private.notify_meetup(uuid, public.notification_kind, uuid, uuid, uuid, uuid, text, uuid) from public, anon;

do $$
declare
  r text := '';
  ok int := 0; total int := 0;
  shop uuid := (select id from public.pages where handle = '8set_store');
  brand uuid := (select id from public.pages where handle = 'themskates');
  shop_metro uuid := (select metro_area_id from public.pages where handle = '8set_store');
  park uuid := (select id from public.parks order by slug limit 1);
  metro uuid := (select id from public.metro_areas limit 1);
  a uuid := gen_random_uuid();   -- the owner role, like Rachel
  o uuid := gen_random_uuid();   -- owns 8SET and Them
  s uuid := gen_random_uuid();   -- staff on 8SET, makes the meetups
  s2 uuid := gen_random_uuid();  -- other staff on 8SET
  z uuid := gen_random_uuid();   -- a skater
  f uuid := gen_random_uuid();   -- follows 8SET
  c uuid := gen_random_uuid();   -- a co-host
  cf uuid := gen_random_uuid();  -- follows the co-host
  b uuid := gen_random_uuid();   -- blocked by 8SET
  ca uuid := gen_random_uuid();  -- 8SET's city admin
  u uuid;
  ev uuid; ev_follow uuid; ev_addr uuid; ev_camp uuid; ev_park uuid; ev_brand uuid;
  ser uuid;
  n int;
  t text;
  j jsonb;
begin
  foreach u in array array[a, o, s, s2, z, f, c, cf, b, ca] loop
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'meet-check-' || u || '@example.com', now(), now(), '{}'::jsonb);
    insert into public.profiles (id) values (u) on conflict (id) do nothing;
    update public.profiles set onboarded_at = now(), age_confirmed_at = now(),
      disciplines = '{inline}', home_metro_area_id = metro,
      username = 'meetcheck' || left(replace(u::text, '-', ''), 8) where id = u;
  end loop;
  insert into public.role_assignments (user_id, role, accepted_at) values (a, 'owner', now());
  insert into public.role_assignments (user_id, role, metro_area_id, accepted_at) values (ca, 'city_admin', shop_metro, now());
  perform private.make_page_owner(shop, o, null);
  perform private.make_page_owner(brand, o, null);
  update public.pages set logo_path = id || '/logo.png' where id in (shop, brand);
  insert into public.page_members (page_id, user_id, role, joined_at) values (shop, s, 'staff', now()), (shop, s2, 'staff', now());
  insert into public.page_follows (user_id, page_id) values (f, shop);
  insert into public.follows (follower_id, followee_id, status) values (cf, c, 'accepted');
  insert into public.page_blocks (page_id, user_id, blocked_by) values (shop, b, o);

  /* 1. Merges handle the new references ---------------------------------------------------- */
  total := total + 1;
  select string_agg(x1, ', ') into t from private.unhandled_page_references() x1;
  if t is null then ok := ok + 1; else r := r || 'FAIL unhandled references: ' || t || '; '; end if;

  /* 2. Who can host as a page -------------------------------------------------------------- */
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.create_meetup(starts_at => now() + interval '1 day', as_page => shop, place => 'page');
    r := r || 'FAIL a skater hosted as 8SET; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.create_meetup(park => park, starts_at => now() + interval '1 day', capacity => 10);
    r := r || 'FAIL a person set capacity; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.create_meetup(starts_at => now() + interval '1 day', as_page => shop, place => 'page',
                                 ticket_url => 'http://8set.dk');
    r := r || 'FAIL an http ticket link; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  ev := public.create_meetup(starts_at => now() + interval '1 day', ends_at => now() + interval '1 day 3 hours',
                             as_page => shop, place => 'page', capacity => 1, adults_only => true,
                             ticket_url => 'https://8set.dk/night', title => 'Shop night', co_hosts => array[c, s2]);
  select series_id into ser from public.events where id = ev;
  if (select host_id is null and host_page_id = shop and place = 'page' from public.event_series where id = ser)
     and exists (select 1 from private.event_series_makers where series_id = ser and member_id = s)
     and not exists (select 1 from public.event_hosts where series_id = ser and role = 'host')
     and exists (select 1 from public.event_hosts where series_id = ser and user_id = c and role = 'co_host')
     and not exists (select 1 from public.event_hosts where series_id = ser and user_id = s2)
     and (select capacity = 1 and adults_only and ticket_url = 'https://8set.dk/night' from public.events where id = ev)
     and private.event_tz(ev) = (select coalesce(timezone, 'UTC') from public.pages where id = shop)
  then ok := ok + 1; else r := r || 'FAIL page meetup made; '; end if;

  total := total + 1;
  if private.hosts_series(ser, s) and private.hosts_series(ser, s2) and private.hosts_series(ser, o)
     and not private.hosts_series(ser, z)
     and private.is_main_host(ser, s) and private.is_main_host(ser, o) and not private.is_main_host(ser, s2)
  then ok := ok + 1; else r := r || 'FAIL hosts and main host; '; end if;

  total := total + 1;
  begin
    perform public.create_meetup(starts_at => now() + interval '1 day', as_page => brand, place => 'page');
    r := r || 'FAIL a brand with no location met at its page; ';
  exception when insufficient_privilege or invalid_parameter_value then ok := ok + 1; end;

  -- The co-host accepts.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.respond_co_host_invite(ser, true);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);

  /* 3. Places ----------------------------------------------------------------------------- */
  total := total + 1;
  ev_addr := public.create_meetup(starts_at => now() + interval '2 days', as_page => shop, place => 'address',
                                  address => 'Enghavevej 40', latitude => 55.66, longitude => 12.54);
  if (select place = 'address' and metro_area_id = shop_metro and park_id is null from public.events where id = ev_addr)
     and (public.meetup_place_info((select e from public.events e where e.id = ev_addr)) ->> 'address') = 'Enghavevej 40'
  then ok := ok + 1; else r := r || 'FAIL address place; '; end if;

  total := total + 1;
  begin
    perform public.create_meetup(starts_at => now() + interval '2 days', as_page => shop, place => 'address',
                                 address => 'Somewhere');
    r := r || 'FAIL an address with no pin; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  update public.parks set run_by_page_id = shop where id = park;
  ev_park := public.create_meetup(park => park, starts_at => now() + interval '3 days', as_page => shop,
                                  weekdays => array[1, 3, 5]::smallint[]);
  if public.meetup_official((select e from public.events e where e.id = ev_park))
     and not public.meetup_official((select e from public.events e where e.id = ev))
     and (select count(*) from public.events where series_id = (select series_id from public.events where id = ev_park)) > 3
  then ok := ok + 1; else r := r || 'FAIL official and repeats; '; end if;

  /* 4. Several days ----------------------------------------------------------------------- */
  total := total + 1;
  ev_camp := public.create_meetup(as_page => shop, place => 'page', days => (
    select jsonb_agg(jsonb_build_object('starts_at', d + interval '10 hours', 'ends_at', d + interval '17 hours') order by d)
      from generate_series(date_trunc('day', now() + interval '10 days'), date_trunc('day', now() + interval '12 days'), interval '1 day') d));
  if (select multi_day and ends_at - starts_at > interval '2 days' from public.events where id = ev_camp)
     and (select count(*) from public.event_days where event_id = ev_camp) = 3
     and jsonb_array_length(public.meetup_days((select e from public.events e where e.id = ev_camp))) = 3
  then ok := ok + 1; else r := r || 'FAIL several days; '; end if;

  total := total + 1;
  begin
    perform public.create_meetup(as_page => shop, place => 'page', days => (
      select jsonb_agg(jsonb_build_object('starts_at', d + interval '10 hours', 'ends_at', d + interval '17 hours') order by d)
        from generate_series(date_trunc('day', now() + interval '10 days'), date_trunc('day', now() + interval '24 days'), interval '1 day') d));
    r := r || 'FAIL 15 days; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.create_meetup(as_page => shop, place => 'page', days => jsonb_build_array(
      jsonb_build_object('starts_at', now() + interval '10 days', 'ends_at', now() + interval '10 days 2 hours'),
      jsonb_build_object('starts_at', now() + interval '12 days', 'ends_at', now() + interval '12 days 2 hours')));
    r := r || 'FAIL days with a gap; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.create_meetup(as_page => shop, place => 'page', weekdays => array[2]::smallint[], days => (
      select jsonb_agg(jsonb_build_object('starts_at', d + interval '10 hours', 'ends_at', d + interval '17 hours') order by d)
        from generate_series(date_trunc('day', now() + interval '10 days'), date_trunc('day', now() + interval '11 days'), interval '1 day') d));
    r := r || 'FAIL several days repeating; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  /* 5. Who sees it ------------------------------------------------------------------------ */
  ev_follow := public.create_meetup(starts_at => now() + interval '4 days', as_page => shop, place => 'page',
                                    visibility => 'followers', co_hosts => array[c]);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform public.respond_co_host_invite((select series_id from public.events where id = ev_follow), true);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);

  total := total + 1;
  if private.can_see_event_as(ev_follow, f) and private.can_see_event_as(ev_follow, cf)
     and not private.can_see_event_as(ev_follow, z)
  then ok := ok + 1; else r := r || 'FAIL followers only; '; end if;

  total := total + 1;
  insert into public.user_page_blocks (user_id, page_id) values (z, shop);
  if not private.can_see_event_as(ev, z) and not private.can_see_event_as(ev, b) and private.can_see_event_as(ev, f) then ok := ok + 1;
  else r := r || 'FAIL blocks both ways; '; end if;
  delete from public.user_page_blocks where user_id = z and page_id = shop;

  /* 6. Going: 18+ and Full ---------------------------------------------------------------- */
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.set_going(ev, true);
    r := r || 'FAIL going without the 18+ confirm; ';
  exception when invalid_parameter_value then
    if sqlerrm = 'adult_confirm_needed' then ok := ok + 1; else r := r || 'FAIL 18+ message ' || sqlerrm || '; '; end if;
  end;

  total := total + 1;
  perform public.set_going(ev, true, confirmed_adult => true);
  if (select confirmed_adult_at is not null from public.event_going where event_id = ev and user_id = z)
     and public.spots_taken((select e from public.events e where e.id = ev)) = 1
     and exists (select 1 from public.notifications where recipient_id = s and kind = 'meetup_going' and event_id = ev)
     and exists (select 1 from public.notifications where recipient_id = o and kind = 'meetup_going' and event_id = ev)
     and exists (select 1 from public.notifications where recipient_id = c and kind = 'meetup_going' and event_id = ev)
  then ok := ok + 1; else r := r || 'FAIL going and the team told; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.set_going(ev, true, confirmed_adult => true);
    r := r || 'FAIL going when full; ';
  exception when invalid_parameter_value then
    if sqlerrm = 'meetup_full' then ok := ok + 1; else r := r || 'FAIL full message ' || sqlerrm || '; '; end if;
  end;

  -- The co-host doesn't take a spot, and a spot comes back when someone drops out.
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  perform public.set_going(ev, false);
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  perform public.set_going(ev, true, confirmed_adult => true);
  if exists (select 1 from public.event_going where event_id = ev and user_id = f) then ok := ok + 1;
  else r := r || 'FAIL a spot coming back; '; end if;

  /* 7. Home, Upcoming and notices from the page ------------------------------------------- */
  total := total + 1;
  if exists (select 1 from public.feed_meetups() e where e.id = ev)
     and exists (select 1 from public.page_meetups(shop) e where e.id = ev)
  then ok := ok + 1; else r := r || 'FAIL Home and Upcoming; '; end if;

  total := total + 1;
  insert into public.page_mutes (user_id, page_id) values (f, shop);
  if not exists (select 1 from public.feed_meetups() e where e.id = ev) then ok := ok + 1;
  else r := r || 'FAIL muted page in Home; '; end if;
  delete from public.page_mutes where user_id = f and page_id = shop;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  total := total + 1;
  perform public.update_meetup(ev, 'date', jsonb_build_object('starts_at', now() + interval '1 day 1 hour',
                                                              'ends_at', now() + interval '1 day 4 hours'));
  if exists (select 1 from public.notifications where recipient_id = f and kind = 'meetup_changed' and event_id = ev
               and actor_id is null and page_id = shop)
  then ok := ok + 1; else r := r || 'FAIL change notice from the page; '; end if;

  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.my_notifications() x
              where x.kind = 'meetup_changed' and x.event_id = ev
                and x.actors -> 0 -> 'page' ->> 'id' = shop::text and x.event_timezone = private.event_tz(ev))
  then ok := ok + 1; else r := r || 'FAIL the bell shows the page; '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);

  total := total + 1;
  begin
    perform public.update_meetup(ev, 'date', jsonb_build_object('ticket_url', 'ftp://x'));
    r := r || 'FAIL editing in a bad ticket link; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  perform public.update_meetup(ev_addr, 'date', jsonb_build_object('place', 'page'));
  if (select place = 'page' and address is null and metro_area_id is null from public.events where id = ev_addr)
  then ok := ok + 1; else r := r || 'FAIL moving to the shop; '; end if;

  total := total + 1;
  begin
    perform public.cancel_meetup(ev_addr, 'page_closed');
    r := r || 'FAIL a host picked page_closed; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  /* 8. The page comments on its own meetup ------------------------------------------------ */
  total := total + 1;
  execute 'set local role authenticated';
  insert into public.event_comments (event_id, page_id, body) values (ev, shop, 'See you at the shop');
  execute 'reset role';
  if exists (select 1 from public.meetup_comments(ev) x where x.author_role = 'host' and x.page ->> 'id' = shop::text)
     and exists (select 1 from private.event_comment_makers k join public.event_comments ec on ec.id = k.comment_id
                  where ec.event_id = ev and k.member_id = s)
     and exists (select 1 from public.notifications where recipient_id = c and kind = 'meetup_comment' and page_id = shop)
     and not exists (select 1 from public.notifications where recipient_id = o and kind = 'meetup_comment' and event_id = ev)
  then ok := ok + 1; else r := r || 'FAIL commenting as the page; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    execute 'set local role authenticated';
    insert into public.event_comments (event_id, page_id, body) values (ev, shop, 'Not mine');
    execute 'reset role';
    r := r || 'FAIL a skater commented as the page; ';
  exception when insufficient_privilege then execute 'reset role'; ok := ok + 1; end;

  /* 9. Moderation ------------------------------------------------------------------------- */
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);
  if public.can_hide_meetup(ev) and private.can_see_event(ev_follow) then ok := ok + 1;
  else r := r || 'FAIL the city admin moderates the shop''s meetups; '; end if;

  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  perform public.file_report(meetup => ev, reason => 'other', details => 'check');
  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.moderation_queue() q where q.kind = 'report' and q.id = ev and q.metro_area_id = shop_metro)
  then ok := ok + 1; else r := r || 'FAIL report reaches the city admin; '; end if;

  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  begin
    perform public.file_report(meetup => ev, reason => 'other');
    r := r || 'FAIL the team reported its own meetup; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  /* 10. Page tools ------------------------------------------------------------------------ */
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  total := total + 1;
  perform public.suspend_page(shop, 'Checking', false, false);
  if (select status = 'scheduled' from public.events where id = ev) then ok := ok + 1;
  else r := r || 'FAIL suspend without cancelling; '; end if;
  perform public.lift_page_suspension(shop);

  total := total + 1;
  perform public.suspend_page(shop, 'Checking', false, true);
  if (select status = 'cancelled' and cancel_reason = 'page_suspended' from public.events where id = ev)
     and (select status = 'cancelled' from public.events where id = ev_camp)
     and not exists (select 1 from public.event_series where host_page_id = shop and ended_at is null)
     and exists (select 1 from public.notifications where recipient_id = f and kind = 'meetup_cancelled' and event_id = ev
                   and page_id = shop and actor_id is null and message like 'page_suspended%')
  then ok := ok + 1; else r := r || 'FAIL suspend cancels meetups; '; end if;
  perform public.lift_page_suspension(shop);

  -- Close for good: a new meetup at the shop, then the shop closes.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  ev := public.create_meetup(starts_at => now() + interval '5 days', as_page => shop, place => 'page');
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  perform public.set_going(ev, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  total := total + 1;
  perform public.admin_close_page(shop);
  if (select status = 'cancelled' and cancel_reason = 'page_closed' from public.events where id = ev)
     and exists (select 1 from public.notifications where recipient_id = z and kind = 'meetup_cancelled' and event_id = ev
                   and page_id = shop and message like 'page_closed%')
  then ok := ok + 1; else r := r || 'FAIL close cancels meetups; '; end if;

  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  begin
    perform public.create_meetup(starts_at => now() + interval '5 days', as_page => shop, place => 'page');
    r := r || 'FAIL a closed shop made a meetup; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  /* 11. People's meetups still work ------------------------------------------------------- */
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', z, 'role', 'authenticated')::text, true);
  ev := public.create_meetup(park => park, starts_at => now() + interval '1 day', note => 'Memo at 4');
  if (select host_id = z and host_page_id is null and place = 'park' from public.event_series s join public.events e on e.series_id = s.id where e.id = ev)
     and (select (x -> 0 ->> 'kind') = 'person' from public.host_list((select e from public.events e where e.id = ev)) x)
  then ok := ok + 1; else r := r || 'FAIL a person''s meetup; '; end if;

  raise exception 'CHECK % of %: %', ok, total, r;
end $$;
rollback;
