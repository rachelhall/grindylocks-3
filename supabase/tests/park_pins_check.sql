-- Rolled-back check for 20261102160000_park_pins.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
do $check$
declare
  out jsonb;
begin
update public.parks p
set location = extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography
from (values
  ('louisville-extreme-lou', 38.2571615::float8, -85.7401187::float8),
  ('memorial-spot-arv',      39.8043484, -105.0863429),
  ('wolffe-spot-arv',        39.8011317, -105.0911012),
  ('skyline-spot-arv',       39.7973904, -105.1272423),
  ('aboveboard-gso',         36.0241670, -79.7991419),
  ('glenwood-gso',           36.0493789, -79.8230232)
) as v(slug, lat, lng)
where p.slug = v.slug
  and p.location is null;

update public.parks p
set location = extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography
from (values
  ('arvada-co',  39.8265368::float8, -105.1437412::float8, 39.826613::float8, -105.143774::float8),
  ('latham-gso', 36.0839510,         -79.7989802,          36.083840,         -79.799230)
) as v(slug, lat, lng, old_lat, old_lng)
where p.slug = v.slug
  and round(p.latitude::numeric, 6) = round(v.old_lat::numeric, 6)
  and round(p.longitude::numeric, 6) = round(v.old_lng::numeric, 6);

  select jsonb_agg(r order by r->>'check') into out from (
    -- Every seed park now has a pin.
    select jsonb_build_object('check', 'no parks without a pin',
      'ok', count(*) = 0, 'detail', coalesce(string_agg(slug, ', '), '')) r
    from public.parks where location is null
    union all
    -- Each pin is within 1 km of the expected point (and lat/lng follow location).
    select jsonb_build_object('check', 'pin ' || slug,
      'ok', latitude is not null and abs(latitude - e.lat) < 0.01 and abs(longitude - e.lng) < 0.01,
      'detail', latitude || ', ' || longitude)
    from public.parks p
    join (values ('louisville-extreme-lou', 38.257, -85.740), ('memorial-spot-arv', 39.804, -105.086),
                 ('wolffe-spot-arv', 39.801, -105.091), ('skyline-spot-arv', 39.797, -105.127),
                 ('aboveboard-gso', 36.024, -79.799), ('glenwood-gso', 36.049, -79.823),
                 ('arvada-co', 39.8265, -105.1437), ('latham-gso', 36.0840, -79.7990)) e(slug, lat, lng)
      using (slug)
    union all
    -- The six new pins show up in parks_near from Arvada City Hall.
    select jsonb_build_object('check', 'parks_near finds Memorial Park first from Arvada City Hall',
      'ok', (select slug from public.parks_near(39.8030, -105.0850, 1)) = 'memorial-spot-arv',
      'detail', (select slug || ' ' || round(distance_m) || ' m' from public.parks_near(39.8030, -105.0850, 1)))
  ) x;
  raise exception 'RESULTS %', out;
end
$check$;
