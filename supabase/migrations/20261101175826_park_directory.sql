-- Park directory (M2). Additive only.
--
-- - Coordinates as plain numbers on parks, so the app can read pins and
--   filter by map bounds without decoding PostGIS values.
-- - A time zone per metro area, so "open now" uses the park's own clock,
--   not the phone's (a traveler in San Diego looking at Copenhagen).
-- - parks_near(): "near me", nearest first, using the PostGIS index.
-- - search_directory(): one search box for cities (metro areas, and the
--   cities inside them) and parks (display name, official name, aliases),
--   accent-insensitive, so "faelled" finds Fælledparken.

-- 1. Coordinates ----------------------------------------------------------------

alter table public.parks
  add column latitude double precision
    generated always as (extensions.st_y(location::extensions.geometry)) stored,
  add column longitude double precision
    generated always as (extensions.st_x(location::extensions.geometry)) stored;

comment on column public.parks.latitude is 'From location; read-only.';
comment on column public.parks.longitude is 'From location; read-only.';

create index parks_lat_lng_idx on public.parks (latitude, longitude) where location is not null;

-- 2. Metro area time zones -----------------------------------------------------

alter table public.metro_areas add column timezone text;
comment on column public.metro_areas.timezone is
  'IANA time zone for the parks in this metro area, for opening hours and "open now".';

update public.metro_areas set timezone = case name
  when 'San Diego' then 'America/Los_Angeles'
  when 'Los Angeles' then 'America/Los_Angeles'
  when 'Nashville' then 'America/Chicago'
  when 'Copenhagen' then 'Europe/Copenhagen'
  when 'Atlanta' then 'America/New_York'
  when 'Greenville' then 'America/New_York'
  when 'Spartanburg' then 'America/New_York'
  when 'Greensboro' then 'America/New_York'
  when 'Louisville' then 'America/Kentucky/Louisville'
  when 'Denver' then 'America/Denver'
end
where timezone is null;

-- 3. Search helpers --------------------------------------------------------------

-- Lowercase and drop accents, Danish letters included: "Fælledparken" →
-- "faelledparken", "Peñasquitos" → "penasquitos", "Nørrebro" → "norrebro".
create or replace function private.fold(s text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select translate(
    replace(replace(replace(lower(coalesce(s, '')), 'æ', 'ae'), 'ß', 'ss'), 'œ', 'oe'),
    'áàâäãåāçćčéèêëēęíìîïīñńóòôöõøōúùûüūýÿžźżšś',
    'aaaaaaaccceeeeeeiiiiinnoooooooouuuuuyyzzzss'
  );
$$;

-- 4. Near me ----------------------------------------------------------------------

create or replace function public.parks_near(lat double precision, lng double precision, max_results integer default 20)
returns table (
  id uuid,
  slug text,
  display_name text,
  park_type public.park_type,
  status public.park_status,
  setting public.park_setting,
  night_lighting boolean,
  city text,
  latitude double precision,
  longitude double precision,
  distance_m double precision
)
language sql stable
security invoker
set search_path = ''
as $$
  select p.id, p.slug, p.display_name, p.park_type, p.status, p.setting, p.night_lighting, p.city,
         p.latitude, p.longitude,
         extensions.st_distance(
           p.location,
           extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
         ) as distance_m
  from public.parks p
  where p.location is not null
  order by p.location operator(extensions.<->)
           extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
  limit least(greatest(max_results, 1), 100);
$$;

-- 5. Search -----------------------------------------------------------------------

-- Cities first (a metro area matches on its own name or on any of its
-- parks' cities, so "Encinitas" finds San Diego), then parks.
create or replace function public.search_directory(q text, max_results integer default 30)
returns table (
  kind text,
  id uuid,
  name text,
  detail text,
  country text,
  metro_area_id uuid,
  park_count integer,
  slug text,
  status public.park_status,
  park_type public.park_type,
  matched_alias text
)
language sql stable
security invoker
set search_path = ''
as $$
  with needle as (select private.fold(trim(q)) as n),
  metros as (
    select m.id, m.name, m.region, m.country,
           (select count(*) from public.parks p where p.metro_area_id = m.id)::integer as park_count,
           case
             when private.fold(m.name) like (select n from needle) || '%' then 0
             when private.fold(m.name) like '%' || (select n from needle) || '%' then 1
             else 2
           end as rank
    from public.metro_areas m
    where length((select n from needle)) >= 2
      and (
        private.fold(m.name) like '%' || (select n from needle) || '%'
        or exists (
          select 1 from public.parks p
          where p.metro_area_id = m.id and private.fold(p.city) like '%' || (select n from needle) || '%'
        )
      )
  ),
  parks as (
    select p.id, p.display_name, p.city, p.metro_area_id, p.slug, p.status, p.park_type,
           case
             when private.fold(p.display_name) like '%' || (select n from needle) || '%' then null
             when private.fold(p.official_name) like '%' || (select n from needle) || '%' then p.official_name
             else (select a from unnest(p.aliases) a
                   where private.fold(a) like '%' || (select n from needle) || '%' limit 1)
           end as matched_alias,
           case
             when private.fold(p.display_name) like (select n from needle) || '%' then 0
             when private.fold(p.display_name) like '%' || (select n from needle) || '%' then 1
             else 2
           end as rank
    from public.parks p
    where length((select n from needle)) >= 2
      and (
        private.fold(p.display_name) like '%' || (select n from needle) || '%'
        or private.fold(p.official_name) like '%' || (select n from needle) || '%'
        or exists (select 1 from unnest(p.aliases) a where private.fold(a) like '%' || (select n from needle) || '%')
      )
  )
  (select 'metro'::text, id, name, region, country::text, id, park_count,
          null::text, null::public.park_status, null::public.park_type, null::text
   from metros order by rank, name limit 10)
  union all
  (select 'park'::text, id, display_name, city, null::text, metro_area_id, null::integer,
          slug, status, park_type, matched_alias
   from parks order by rank, display_name limit greatest(max_results, 1));
$$;

-- Sign-in only, like everything else.
revoke all on function public.parks_near(double precision, double precision, integer) from public, anon;
revoke all on function public.search_directory(text, integer) from public, anon;
grant execute on function public.parks_near(double precision, double precision, integer) to authenticated;
grant execute on function public.search_directory(text, integer) to authenticated;
grant execute on function private.fold(text) to authenticated;
