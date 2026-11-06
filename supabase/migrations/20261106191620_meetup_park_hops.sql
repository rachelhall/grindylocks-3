-- More parks on a meetup (PR 9b, park hops). PRD: Grindylocks — Meetups PRD
-- (Pages as hosts › More parks on a meetup) and the Blading Camp spike.
-- Mockups: the "More parks on a meetup (PR 9b)" row of the Brand accounts
-- (v2) page (Hop-Compose, Hop-Parks, Hop-ParkUpcoming, Hop-Meetup,
-- Hop-Home), approved Nov 6.
--
--  1. Stops. A meetup keeps its main place (stop 1: a park, or for pages
--     their base or an address) and can list up to 9 more parks, in order,
--     for any host. No times, routes or check-ins per stop; going is for the
--     whole meetup, and the main place still sets the time zone.
--     event_series_parks is the series' list (repeats copy it to each new
--     date); event_parks is each date's own list, which a "this date" edit
--     can change and which carries per-park hiding.
--  2. Park pages: Upcoming, Past and the past count list a meetup at every
--     park it stops at. A post at a stop can be linked to the meetup.
--  3. Every stop is moderated by its own park: its admins can hide a date
--     at their park only (hide_meetup(..., at_park)), and reports on the
--     meetup reach them. Hiding at a stop leaves the reports open for the
--     main place's moderators, who keep every other decision.
--     Visibility and blocks are the meetup's own, so they hold at every stop.
--
-- Additive: two tables, a few functions, a trigger, and patched functions.

create or replace function pg_temp.patch(def text, pattern text, replacement text, label text, expected integer default 1)
returns text
language plpgsql
as $$
declare
  n integer := (select count(*) from regexp_matches(def, pattern, 'g'));
begin
  if n <> expected then
    raise exception 'patch %: expected % match(es), found %', label, expected, n;
  end if;
  return regexp_replace(def, pattern, replacement, 'g');
end $$;

/* 1. Tables ---------------------------------------------------------------------------- */

create table if not exists public.event_series_parks (
  series_id uuid not null references public.event_series(id) on delete cascade,
  park_id uuid not null references public.parks(id) on delete cascade,
  position smallint not null check (position between 2 and 10),
  primary key (series_id, position),
  unique (series_id, park_id)
);

create table if not exists public.event_parks (
  event_id uuid not null references public.events(id) on delete cascade,
  park_id uuid not null references public.parks(id) on delete cascade,
  position smallint not null check (position between 2 and 10),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles(id) on delete set null,
  primary key (event_id, position),
  unique (event_id, park_id)
);
create index if not exists event_parks_park_idx on public.event_parks (park_id);
create index if not exists event_series_parks_park_idx on public.event_series_parks (park_id);

comment on table public.event_parks is
  'A date''s stops after its main place (position 2 to 10). Hidden per park by that park''s admins.';
comment on table public.event_series_parks is
  'A meetup''s stops after its main place, copied to each new date.';

/* 2. Helpers --------------------------------------------------------------------------- */

-- Is this date at that park: its main park, or a stop not hidden there
-- (hosts still see their own hidden stops)?
create or replace function private.meetup_at_park(e public.events, park uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
select park is not null and (
  e.park_id = park
  or exists (select 1 from event_parks p
              where p.event_id = e.id and p.park_id = park
                and (p.hidden_at is null or private.hosts_series(e.series_id)))
);
$$;

-- Does the signed-in member moderate a (not hidden) stop of this date?
create or replace function private.can_moderate_meetup_stop(event uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
select exists (select 1 from event_parks p
                where p.event_id = event and p.hidden_at is null
                  and private.can_moderate_park(p.park_id));
$$;

-- Checks a list of more parks: up to 9, real parks, no repeats, not the
-- main park. Returns it without nulls.
create or replace function private.clean_meetup_parks(parks uuid[], main_park uuid)
returns uuid[]
language plpgsql
stable security definer
set search_path = public
as $$
declare
  list uuid[] := array(select x from unnest(coalesce(parks, '{}')) with ordinality u(x, i) where x is not null order by i);
begin
  if cardinality(list) > 9 then
    raise exception 'A meetup can have up to 10 parks' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(list) x) <> cardinality(list) then
    raise exception 'Each park can be on a meetup once' using errcode = '22023';
  end if;
  if main_park is not null and main_park = any (list) then
    raise exception 'That park is already the start' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(list) x where not exists (select 1 from parks p where p.id = x)) then
    raise exception 'Pick a park' using errcode = '22023';
  end if;
  return list;
end $$;

-- Sets a series' list.
create or replace function private.set_series_parks(series uuid, parks uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  list uuid[] := private.clean_meetup_parks(parks, (select s.park_id from event_series s where s.id = series));
begin
  delete from event_series_parks where series_id = series;
  insert into event_series_parks (series_id, park_id, position)
  select series, x, (i + 1)::smallint from unnest(list) with ordinality u(x, i);
end $$;

-- Sets a date's list. Parks that stay keep their hiding; the date's own
-- main park (seasons can move it) is left out.
create or replace function private.set_event_parks(event uuid, parks uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  main_park uuid := (select e.park_id from events e where e.id = event);
  list uuid[] := array(select x from unnest(coalesce(parks, '{}')) with ordinality u(x, i)
                        where x is not null and x is distinct from main_park order by i);
  kept jsonb := (select coalesce(jsonb_object_agg(p.park_id, jsonb_build_object('at', p.hidden_at, 'by', p.hidden_by)), '{}')
                   from event_parks p where p.event_id = event and p.hidden_at is not null);
begin
  list := private.clean_meetup_parks(list, main_park);
  delete from event_parks where event_id = event;
  insert into event_parks (event_id, park_id, position, hidden_at, hidden_by)
  select event, x, (i + 1)::smallint, (kept -> x::text ->> 'at')::timestamptz, (kept -> x::text ->> 'by')::uuid
    from unnest(list) with ordinality u(x, i);
end $$;

-- New dates (create_meetup, repeats) take the series' list.
create or replace function private.copy_series_parks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from event_series_parks where series_id = new.series_id) then
    perform private.set_event_parks(new.id,
      array(select p.park_id from event_series_parks p where p.series_id = new.series_id order by p.position));
  end if;
  return null;
end $$;

drop trigger if exists events_copy_series_parks on public.events;
create trigger events_copy_series_parks after insert on public.events
  for each row execute function private.copy_series_parks();

-- When a date moves to a park that's one of its stops, that stop drops off.
create or replace function private.drop_main_park_stop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from event_parks p where p.event_id = new.id and p.park_id = new.park_id) then
    perform private.set_event_parks(new.id,
      array(select p.park_id from event_parks p where p.event_id = new.id order by p.position));
  end if;
  return null;
end $$;

drop trigger if exists events_drop_main_park_stop on public.events;
create trigger events_drop_main_park_stop after update of park_id on public.events
  for each row when (new.park_id is distinct from old.park_id and new.park_id is not null)
  execute function private.drop_main_park_stop();

-- update_meetup's parks change: the date, or that date and every later one
-- (and the series); a one-off changes its series too. People going hear
-- about it once, unless the main place changed in the same edit (they hear
-- about that already).
create or replace function private.apply_meetup_parks_change(event uuid, scope text, changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e events;
  s event_series;
  list uuid[];
  before jsonb;
begin
  if not (changes ? 'parks') then
    return;
  end if;
  if jsonb_typeof(changes -> 'parks') not in ('array', 'null') then
    raise exception 'parks is a list of parks' using errcode = '22023';
  end if;
  list := array(select x::uuid from jsonb_array_elements_text(coalesce(nullif(changes -> 'parks', 'null'::jsonb), '[]')) x);
  select * into e from events x where x.id = event;
  select * into s from event_series x where x.id = e.series_id;

  select jsonb_object_agg(x.id, (select coalesce(jsonb_agg(p.park_id order by p.position), '[]')
                                    from event_parks p where p.event_id = x.id))
    into before
    from events x
   where x.id = e.id or (scope = 'upcoming' and x.series_id = s.id and x.status = 'scheduled' and x.starts_at >= e.starts_at);

  if scope = 'date' and cardinality(s.weekdays) > 0 then
    perform private.set_event_parks(e.id, list);
  else
    perform private.set_series_parks(s.id, list);
    perform private.set_event_parks(x.id, list)
       from events x
      where x.id = e.id or (x.series_id = s.id and x.status = 'scheduled' and x.starts_at >= e.starts_at);
  end if;

  if not (changes ?| array['place', 'park', 'address', 'latitude', 'longitude']) then
    perform private.notify_meetup(f.user_id, 'meetup_changed', auth.uid(), f.id, null, null, 'park', f.page)
       from (select distinct on (g.user_id) g.user_id, x.id, s.host_page_id as page
               from events x
               join event_going g on g.event_id = x.id
              where before ? x.id::text and x.ends_at > now()
                and (before -> x.id::text) is distinct from
                    (select coalesce(jsonb_agg(p.park_id order by p.position), '[]') from event_parks p where p.event_id = x.id)
              order by g.user_id, x.starts_at) f;
  end if;
end $$;

/* 3. Reading stops --------------------------------------------------------------------- */

-- A date's stops after the main place, in order: [{id, slug, display_name,
-- position, hidden}]. Hidden stops show only to the meetup's hosts and that
-- park's moderators.
create or replace function public.meetup_stops(public.events)
returns jsonb
language sql
stable security definer
set search_path = public
as $$
select coalesce(jsonb_agg(jsonb_build_object(
         'id', k.id, 'slug', k.slug, 'display_name', k.display_name,
         'position', p.position, 'hidden', p.hidden_at is not null) order by p.position), '[]'::jsonb)
  from event_parks p
  join parks k on k.id = p.park_id
 where p.event_id = $1.id
   and (p.hidden_at is null or private.hosts_series($1.series_id) or private.can_moderate_park(p.park_id));
$$;

alter table public.event_parks enable row level security;
alter table public.event_series_parks enable row level security;
drop policy if exists "read stops of dates you can see" on public.event_parks;
create policy "read stops of dates you can see" on public.event_parks for select to authenticated
  using (private.can_see_event(event_id)
         and (hidden_at is null or private.hosts_series((select e.series_id from public.events e where e.id = event_id))
              or private.can_moderate_park(park_id)));
drop policy if exists "read stops of meetups you can see" on public.event_series_parks;
create policy "read stops of meetups you can see" on public.event_series_parks for select to authenticated
  using (private.can_see_series(series_id));
revoke all on public.event_parks, public.event_series_parks from public, anon, authenticated;
grant select on public.event_parks, public.event_series_parks to authenticated;

/* 4. Park lists, posts and recent meetups ---------------------------------------------- */

do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.park_meetups(uuid, integer)'::regprocedure);
  def := pg_temp.patch(def, 'e\.park_id = park_meetups\.park', 'private.meetup_at_park(e, park_meetups.park)', 'park_meetups');
  execute def;

  def := pg_get_functiondef('public.park_past_meetups(uuid, timestamptz, uuid, integer)'::regprocedure);
  def := pg_temp.patch(def, 'e\.park_id = park_past_meetups\.park', 'private.meetup_at_park(e, park_past_meetups.park)', 'park_past_meetups');
  execute def;

  def := pg_get_functiondef('public.park_past_meetup_count(uuid)'::regprocedure);
  def := pg_temp.patch(def, 'e\.park_id = park_past_meetup_count\.park', 'private.meetup_at_park(e, park_past_meetup_count.park)', 'park_past_meetup_count');
  execute def;

  def := pg_get_functiondef('public.my_recent_meetups(uuid)'::regprocedure);
  def := pg_temp.patch(def, 'e\.park_id = my_recent_meetups\.park', 'private.meetup_at_park(e, my_recent_meetups.park)', 'my_recent_meetups');
  execute def;

  -- A post at any stop (not hidden there) can be linked.
  def := pg_get_functiondef('private.guard_post_event()'::regprocedure);
  def := pg_temp.patch(def,
    'or e\.park_id is distinct from new\.park_id',
    'or not (e.park_id is not distinct from new.park_id or private.meetup_at_park(e, new.park_id))',
    'guard_post_event');
  execute def;
end $$;

/* 5. create_meetup(more_parks) and update_meetup(changes.parks) ------------------------ */

do $$
declare
  old_fn regprocedure := 'public.create_meetup'::regproc::oid::regprocedure;
  def text := pg_get_functiondef(old_fn);
begin
  def := pg_temp.patch(def,
    'who_for text DEFAULT NULL::text\)\s*RETURNS uuid',
    'who_for text DEFAULT NULL::text, more_parks uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid',
    'create_meetup: parameter');
  -- The list goes on the series before any date is made, so the trigger
  -- copies it to the first date and to every repeat.
  def := pg_temp.patch(def,
    '(end loop;\s*)(if cardinality\(coalesce\(create_meetup\.weekdays)',
    '\1perform private.set_series_parks(s, more_parks);
\2',
    'create_meetup: parks');
  execute def;
  execute format('drop function %s', old_fn);
end $$;

revoke all on function public.create_meetup(uuid, timestamptz, timestamptz, text, text, public.meetup_visibility,
  public.discipline[], text, smallint[], date, jsonb, uuid[], uuid, public.meetup_place, text, double precision,
  double precision, integer, text, boolean, jsonb, text, uuid[]) from public, anon;
grant execute on function public.create_meetup(uuid, timestamptz, timestamptz, text, text, public.meetup_visibility,
  public.discipline[], text, smallint[], date, jsonb, uuid[], uuid, public.meetup_place, text, double precision,
  double precision, integer, text, boolean, jsonb, text, uuid[]) to authenticated;

do $$
declare
  def text := pg_get_functiondef('public.update_meetup(uuid, text, jsonb)'::regprocedure);
begin
  def := pg_temp.patch(def,
    'return n;',
    'perform private.apply_meetup_parks_change(e.id, scope, changes);
return n;',
    'update_meetup: parks', 2);
  execute def;
end $$;

/* 6. Hiding at a stop ------------------------------------------------------------------ */

drop function if exists public.hide_meetup(uuid, boolean);
create or replace function public.hide_meetup(event uuid, hide boolean default true, at_park uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  e events;
  changed boolean;
  park_name text;
begin
  select * into e from events where id = hide_meetup.event;
  if e.id is not null and at_park is not null and at_park is distinct from e.park_id then
    -- A stop: only that park's moderators, and only there.
    if not exists (select 1 from event_parks p where p.event_id = e.id and p.park_id = at_park)
       or not private.can_moderate_park(at_park) then
      raise exception 'Only this park''s admins can hide its meetups' using errcode = '42501';
    end if;
    if hide then
      update event_parks set hidden_at = now(), hidden_by = me
       where event_id = e.id and park_id = at_park and hidden_at is null;
    else
      update event_parks set hidden_at = null, hidden_by = null
       where event_id = e.id and park_id = at_park and hidden_at is not null;
    end if;
    changed := found;
    if changed then
      insert into moderation_actions (actor_id, action, target_user_id, park_id, event_id, page_id)
      values (me, case when hide then 'meetup_hidden' else 'meetup_unhidden' end,
              (select host_id from event_series where id = e.series_id), at_park, e.id,
              (select host_page_id from event_series where id = e.series_id));
      select display_name into park_name from parks where id = at_park;
      if hide then
        perform private.notify_meetup(h.person, 'meetup_hidden', null, e.id, null, null, 'stop:' || park_name)
           from private.series_host_people(e.series_id) as h(person);
      else
        delete from notifications x
         where x.kind = 'meetup_hidden' and x.event_id = e.id and x.message = 'stop:' || park_name;
      end if;
    end if;
    return;
  end if;
  -- The main place: as before, the whole date.
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

revoke all on function public.hide_meetup(uuid, boolean, uuid) from public, anon;
grant execute on function public.hide_meetup(uuid, boolean, uuid) to authenticated;

/* 7. Reports reach every stop's admins ------------------------------------------------- */

do $$
declare
  def text;
begin
  -- A stop's moderators can see the date (as the main park's can).
  def := pg_get_functiondef('private.can_see_event(uuid)'::regprocedure);
  def := pg_temp.patch(def,
    'or private\.can_moderate_meetup\(event\);',
    'or private.can_moderate_meetup(event)
or private.can_moderate_meetup_stop(event);',
    'can_see_event');
  execute def;

  -- Meetup reports (not meetup comments, which are the whole meetup's).
  def := pg_get_functiondef('private.can_moderate_report_target(uuid, uuid, uuid, uuid)'::regprocedure);
  def := pg_temp.patch(def,
    'when meetup is not null then private\.can_moderate_meetup\(meetup\)',
    'when meetup is not null then private.can_moderate_meetup(meetup) or private.can_moderate_meetup_stop(meetup)',
    'can_moderate_report_target');
  execute def;

  -- A stop-only moderator can keep it hidden at their park(s); the reports
  -- stay open for the main place's moderators.
  def := pg_get_functiondef('public.moderate_reports(text, uuid, text, text, integer, boolean)'::regprocedure);
  def := pg_temp.patch(def,
    '(raise exception ''nothing_to_review'' using errcode = ''P0002'';\s*end if;)',
    '\1
  if target_kind = ''meetup'' and not private.can_moderate_meetup(target) then
    if decision <> ''keep_hidden'' then
      raise exception ''stop_admins_hide_only'' using errcode = ''42501'';
    end if;
    perform public.hide_meetup(target, true, p.park_id)
       from event_parks p
      where p.event_id = target and p.hidden_at is null and private.can_moderate_park(p.park_id);
    return;
  end if;',
    'moderate_reports');
  execute def;

  def := pg_get_functiondef('public.moderation_report_detail(text, uuid)'::regprocedure);
  def := pg_temp.patch(def,
    '(\n)(\s*)return result;',
    '\1\2if target_kind = ''meetup'' then
\2  result := result || jsonb_build_object(
\2    ''stop_only'', not private.can_moderate_meetup(target),
\2    ''stops'', public.meetup_stops(ev));
\2end if;
\2return result;',
    'moderation_report_detail');
  execute def;
end $$;

-- meetup_at_park and can_moderate_meetup_stop stay callable: the park lists
-- run as the member. The writers are only reached through the functions above.
revoke execute on function private.clean_meetup_parks(uuid[], uuid), private.set_series_parks(uuid, uuid[]), private.set_event_parks(uuid, uuid[]),
  private.apply_meetup_parks_change(uuid, text, jsonb), private.copy_series_parks(), private.drop_main_park_stop()
  from public, anon, authenticated;
revoke all on function public.meetup_stops(public.events) from public, anon;
grant execute on function public.meetup_stops(public.events) to authenticated;
