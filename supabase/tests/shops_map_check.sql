-- Rolled-back check for 20261104142601_shops_map.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
begin;

-- Brand and shop accounts, part A, PR 3: shops and the map.
--
-- 1. shops_in_bounds(): shop pins for the map. Storefronts, and
--    by-appointment shops that chose to show a pin; online-only shops never
--    have one. Retired, closed and name-only pages aren't on the map, and
--    neither are shops you blocked (like Search). Each pin carries its
--    hours and time zone, so the map can say "open now" and the filter
--    sheet's Open now can cover shops, each on its own clock.
-- 2. parks.run_by_page_id: the business that runs a private park
--    (Rocketown, SkateATL, Above Board), shown as "Run by …" on the park
--    page. Only Rachel sets it: a trigger refuses the change from anyone
--    else, park contributors and admins included (members hold a
--    table-wide update grant on parks, so a column grant can't do it).
-- 3. Pins for the four seeded storefronts, from OpenStreetMap (Nov 4):
--    Bo's Boots on Wheels from its OSM shop (way 1032737235); 8SET, Asphalt
--    Beach and Fritzy's from their address points (node 340495016, way
--    89757752, way 35340212), since OSM doesn't map those shops yet.
--    Oak City is by appointment without a pin, and L.O.W is online only.
-- 4. Hours for the four storefronts (from Rachel, Nov 4), and Bo's old name.

/* 1. Shop pins -------------------------------------------------------------------------- */

create or replace function public.shops_in_bounds(
  north double precision,
  south double precision,
  east double precision,
  west double precision
)
returns table (
  id uuid,
  handle text,
  display_name text,
  state public.page_state,
  logo_path text,
  city text,
  country text,
  location_type public.shop_location_type,
  address text,
  latitude double precision,
  longitude double precision,
  timezone text,
  temp_closed_at timestamptz,
  temp_closed_until date,
  hours jsonb
)
language sql stable security invoker
set search_path = ''
as $$
  select p.id, p.handle::text, p.display_name, p.state, p.logo_path, p.city, p.country::text,
         p.location_type, p.address, p.latitude, p.longitude,
         coalesce(m.timezone, p.timezone) as timezone,
         p.temp_closed_at, p.temp_closed_until,
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'id', h.id,
                     'season_start_month', h.season_start_month, 'season_start_day', h.season_start_day,
                     'season_end_month', h.season_end_month, 'season_end_day', h.season_end_day,
                     'days', h.days,
                     'start_anchor', h.start_anchor, 'start_time', h.start_time,
                     'end_anchor', h.end_anchor, 'end_time', h.end_time,
                     'note', h.note) order by h.days[1], h.start_time)
              from public.page_hours h where h.page_id = p.id),
           '[]'::jsonb) as hours
    from public.pages p
    left join public.metro_areas m on m.id = p.metro_area_id
   where (select auth.uid()) is not null
     and 'shop' = any (p.roles)
     and p.state in ('unofficial', 'managed')
     and p.location is not null
     and (p.location_type = 'storefront' or (p.location_type = 'by_appointment' and p.show_pin))
     and p.latitude between south and north
     and case when west <= east then p.longitude between west and east
              else p.longitude >= west or p.longitude <= east end
     and not exists (select 1 from public.user_page_blocks b
                      where b.page_id = p.id and b.user_id = (select auth.uid()))
   order by p.display_name
   limit 200;
$$;

comment on function public.shops_in_bounds(double precision, double precision, double precision, double precision) is
  'Shop pins inside the visible map area, with hours for "open now" (Brand and Shop Accounts PRD, Shops on the map).';

revoke all on function public.shops_in_bounds(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.shops_in_bounds(double precision, double precision, double precision, double precision) to authenticated;

create index if not exists pages_shop_pins_idx on public.pages (latitude, longitude)
  where location is not null and 'shop' = any (roles);

/* 2. Run by ----------------------------------------------------------------------------- */

alter table public.parks
  add column if not exists run_by_page_id uuid references public.pages (id) on delete set null;

comment on column public.parks.run_by_page_id is
  'The business that runs a private park, shown as "Run by …" on the park page. Set by Rachel only.';

create index if not exists parks_run_by_idx on public.parks (run_by_page_id) where run_by_page_id is not null;

grant select (run_by_page_id) on public.parks to authenticated;

-- Only the owner sets it (or the dashboard and migrations, which run with
-- no signed-in member).
create or replace function private.guard_park_run_by()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.run_by_page_id is not null
      or tg_op = 'UPDATE' and new.run_by_page_id is distinct from old.run_by_page_id)
     and (select auth.uid()) is not null
     and not private.is_owner() then
    raise exception using errcode = '42501', message = 'only_owner_sets_run_by';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_park_run_by() from public, anon, authenticated;

drop trigger if exists parks_guard_run_by on public.parks;
create trigger parks_guard_run_by
  before insert or update of run_by_page_id on public.parks
  for each row execute function private.guard_park_run_by();

/* 3. Pins for the seeded storefronts (OpenStreetMap, Nov 4) ----------------------------- */

update public.pages p
   set location = extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography,
       updated_at = now()
  from (values
    ('8set_store', 55.6982960, 12.5371930),
    ('asphaltbeachskateshop', 36.1763892, -86.7530966),
    ('fritzys_roller_skate_shop', 32.7913257, -117.2537802),
    ('bos_bootsonwheels', 32.8354462, -117.1465133)
  ) as v(handle, lat, lng)
 where lower(p.handle::text) = v.handle
   and p.location is null;

/* 4. Hours for the seeded storefronts (from Rachel, Nov 4) ------------------------------- */

-- On each shop's own clock. Days not listed are closed. Only added while a
-- shop has no hours yet, so a team's own hours are never overwritten.
--   Bo's Boots on Wheels: Tue, Wed, Fri 12:00–18:00; Sat, Sun 11:00–17:00.
--   8SET: Mon, Tue, Thu, Fri 10:00–17:00; Wed 11:00–14:30 and 15:45–17:00;
--         Sat 10:00–14:00.
--   Asphalt Beach: Mon–Sat 10:00–16:00.
--   Fritzy's: Tue–Thu 12:00–18:00; Fri 12:00–19:00; Sat 11:00–19:00;
--             Sun 11:00–17:00.
insert into public.page_hours (page_id, days, start_anchor, start_time, end_anchor, end_time)
select p.id, v.days, 'clock', v.start_time, 'clock', v.end_time
  from (values
    ('bos_bootsonwheels', array[2, 3, 5]::smallint[], time '12:00', time '18:00'),
    ('bos_bootsonwheels', array[6, 7]::smallint[], time '11:00', time '17:00'),
    ('8set_store', array[1, 2, 4, 5]::smallint[], time '10:00', time '17:00'),
    ('8set_store', array[3]::smallint[], time '11:00', time '14:30'),
    ('8set_store', array[3]::smallint[], time '15:45', time '17:00'),
    ('8set_store', array[6]::smallint[], time '10:00', time '14:00'),
    ('asphaltbeachskateshop', array[1, 2, 3, 4, 5, 6]::smallint[], time '10:00', time '16:00'),
    ('fritzys_roller_skate_shop', array[2, 3, 4]::smallint[], time '12:00', time '18:00'),
    ('fritzys_roller_skate_shop', array[5]::smallint[], time '12:00', time '19:00'),
    ('fritzys_roller_skate_shop', array[6]::smallint[], time '11:00', time '19:00'),
    ('fritzys_roller_skate_shop', array[7]::smallint[], time '11:00', time '17:00')
  ) as v(handle, days, start_time, end_time)
  join public.pages p on lower(p.handle::text) = v.handle
 where not exists (select 1 from public.page_hours h where h.page_id = p.id);

-- Bo's was Sin City Skates before, so Search finds it by the old name.
insert into public.page_aliases (page_id, name)
select p.id, 'Sin City Skates'
  from public.pages p
 where lower(p.handle::text) = 'bos_bootsonwheels'
   and not exists (select 1 from public.page_aliases a where a.page_id = p.id and a.name = 'Sin City Skates');

/* Checks ------------------------------------------------------------------------------- */

create temp table t_results(step text, ok boolean, detail text);
grant all on t_results to authenticated;

insert into auth.users (id, email, aud, role, instance_id) values
 ('e3000000-0000-4000-8000-0000000000a1','sm-skater@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private)
values ('e3000000-0000-4000-8000-0000000000a1', 'sm_skater', now(), (select id from metro_areas where name = 'San Diego'), '{inline}', now(), false);

insert into role_assignments (user_id, role, park_id, accepted_at)
values ('e3000000-0000-4000-8000-0000000000a1', 'park_contributor', (select id from parks order by slug limit 1), now());

-- As the owner: the seed data landed.
insert into t_results select 'four storefronts have pins', count(*) = 4, string_agg(handle::text, ',' order by handle)
  from pages where location is not null and 'shop' = any (roles);
insert into t_results select 'hours rows per shop', string_agg(lower(p.handle::text) || '=' || n, ',' order by p.handle) = '8set_store=4,asphaltbeachskateshop=1,bos_bootsonwheels=2,fritzys_roller_skate_shop=4', string_agg(lower(p.handle::text) || '=' || n, ',' order by p.handle)
  from pages p join lateral (select count(*) n from page_hours h where h.page_id = p.id) c on c.n > 0;
insert into t_results select 'Bo''s is formerly Sin City Skates', count(*) = 1, count(*)::text
  from page_aliases a join pages p on p.id = a.page_id where lower(p.handle::text) = 'bos_bootsonwheels' and a.name = 'Sin City Skates';

-- As an ordinary member.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

insert into t_results select 'member sees the four storefront pins worldwide', count(*) = 4, string_agg(handle, ',' order by handle)
  from shops_in_bounds(90, -90, 180, -180);
insert into t_results select 'no pins for by-appointment without a pin or online only', count(*) = 0, string_agg(handle, ',')
  from shops_in_bounds(90, -90, 180, -180) where handle in ('oakcityinlineskateshop', 'lowskateacademy');
insert into t_results select 'Bo''s pin has hours and San Diego time', jsonb_array_length(hours) = 2 and timezone = 'America/Los_Angeles', timezone || ' ' || jsonb_array_length(hours)
  from shops_in_bounds(90, -90, 180, -180) where handle = 'bos_bootsonwheels';
insert into t_results select '8SET pin is on Copenhagen time', timezone = 'Europe/Copenhagen', timezone
  from shops_in_bounds(90, -90, 180, -180) where handle = '8set_store';
insert into t_results select 'a San Diego box shows only San Diego shops', count(*) = 2, string_agg(handle, ',' order by handle)
  from shops_in_bounds(33.0, 32.6, -117.0, -117.4);
insert into t_results select 'a view across the antimeridian wraps', count(*) = 2, string_agg(handle, ',' order by handle)
  from shops_in_bounds(90, -90, -117.2, 12.5);
insert into t_results select 'member reads run_by_page_id', true, coalesce((select run_by_page_id::text from parks limit 1), 'null');

do $$ begin
  update public.parks set run_by_page_id = (select id from public.pages limit 1)
   where id = (select park_id from public.role_assignments where user_id = 'e3000000-0000-4000-8000-0000000000a1');
  insert into t_results values ('a park contributor can''t set Run by', false, 'update went through');
exception when insufficient_privilege then
  insert into t_results values ('a park contributor can''t set Run by', true, sqlerrm);
end $$;
with u as (
  update public.parks set surface = coalesce(surface, 'smooth concrete')
   where id = (select park_id from public.role_assignments where user_id = 'e3000000-0000-4000-8000-0000000000a1')
  returning 1)
insert into t_results select 'the contributor still edits the park''s other fields', count(*) = 1, count(*)::text from u;

insert into user_page_blocks (user_id, page_id) select 'e3000000-0000-4000-8000-0000000000a1', id from pages where handle = '8set_store';
insert into t_results select 'a shop you blocked leaves the map', count(*) = 3, string_agg(handle, ',' order by handle)
  from shops_in_bounds(90, -90, 180, -180);

select set_config('request.jwt.claims', '', true);
insert into t_results select 'signed out sees no pins', count(*) = 0, count(*)::text from shops_in_bounds(90, -90, 180, -180);

-- Back as the owner: states and pin choices.
reset role;
update pages set show_pin = true, location = extensions.st_setsrid(extensions.st_makepoint(-78.64, 35.78), 4326)::extensions.geography
 where handle = 'oakcityinlineskateshop';
update pages set state = 'closed', closed_at = now() where handle = 'asphaltbeachskateshop';
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from role_assignments where role = 'owner' and ended_at is null limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
with u as (
  update parks set run_by_page_id = (select id from pages where handle = 'fritzys_roller_skate_shop')
   where slug = (select slug from parks order by slug limit 1) returning 1)
insert into t_results select 'the owner sets Run by', count(*) = 1, count(*)::text from u;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into t_results select 'a by-appointment shop that shows its pin is on the map', count(*) = 1, count(*)::text
  from shops_in_bounds(90, -90, 180, -180) where handle = 'oakcityinlineskateshop';
insert into t_results select 'a closed shop leaves the map', count(*) = 0, count(*)::text
  from shops_in_bounds(90, -90, 180, -180) where handle = 'asphaltbeachskateshop';
insert into t_results select 'Run by reads through to the page', count(*) = 1, max(g.handle::text)
  from parks k join pages g on g.id = k.run_by_page_id;

reset role;
do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
