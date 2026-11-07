-- Map pins for the last six seed parks, from OpenStreetMap (Nov 2).
--
-- Six parks have had no coordinates since the Oct 31 seed (OSM couldn't be
-- reached that session), so they don't show on the map. This gives them pins,
-- and swaps the two interim Stray Rocket pins (Arvada, Latham) for OSM's.
--
-- Points are the centre of the skate area OSM maps, except:
-- - Above Board: OSM's node for the business ("Above Board Skatepark and
--   Skate Shop"), since it's indoors.
-- - Wolffe Park: OSM hasn't mapped the skate spot, so the pin is the centre
--   of the (unnamed) park area at 8475 W 57th Ave. A local admin can nudge it.
--
-- Data only: no schema change. latitude/longitude are generated from
-- location, so only location is written. Each update only fills an empty pin
-- (or replaces the exact interim one), so it never overwrites a later fix.

update public.parks p
set location = extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography
from (values
  -- OSM way 566507173 (sport=skateboard, "David Armstrong Extreme Park")
  ('louisville-extreme-lou', 38.2571615::float8, -85.7401187::float8),
  -- OSM way 621542751 (sport=skateboard), inside Johnny Roberts Memorial Park
  ('memorial-spot-arv',      39.8043484, -105.0863429),
  -- OSM way 366142308 (unnamed park at 8475 W 57th Ave); skate spot not mapped
  ('wolffe-spot-arv',        39.8011317, -105.0911012),
  -- OSM way 1537706192 ("Skyline Park Skatepark")
  ('skyline-spot-arv',       39.7973904, -105.1272423),
  -- OSM node 13797385489 ("Above Board Skatepark and Skate Shop")
  ('aboveboard-gso',         36.0241670, -79.7991419),
  -- OSM node 12857753060 ("Glenwood Skate Spot")
  ('glenwood-gso',           36.0493789, -79.8230232)
) as v(slug, lat, lng)
where p.slug = v.slug
  and p.location is null;

-- Interim Stray Rocket pins → OSM. Only if still the interim point.
update public.parks p
set location = extensions.st_setsrid(extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography
from (values
  -- OSM way 211555458 (sport=skateboard); about 10 m from the old pin
  ('arvada-co',  39.8265368::float8, -105.1437412::float8, 39.826613::float8, -105.143774::float8),
  -- OSM way 1357930128 ("Latham Skate Park"); about 25 m from the old pin
  ('latham-gso', 36.0839510,         -79.7989802,          36.083840,         -79.799230)
) as v(slug, lat, lng, old_lat, old_lng)
where p.slug = v.slug
  and round(p.latitude::numeric, 6) = round(v.old_lat::numeric, 6)
  and round(p.longitude::numeric, 6) = round(v.old_lng::numeric, 6);
