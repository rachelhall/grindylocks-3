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
