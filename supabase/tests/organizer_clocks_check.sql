-- Rolled-back check for the organizer_clocks migration.
-- Run after the migration's SQL in one transaction; it always ends by
-- raising, so nothing is kept. The last line reads RESULTS: n of m.

do $$
declare
  sd uuid := (select id from metro_areas where name = 'San Diego');
  org_none uuid;   -- organizer with a base, no metro area, its own time zone set
  org_sd uuid;     -- organizer with a base in San Diego, a stray time zone set
  org_nopin uuid;  -- organizer in San Diego without a base
  shop_tz uuid;    -- storefront shop with its own time zone, in San Diego
  shop_org uuid;   -- shop that's also an organizer, no metro area
  brand uuid;      -- brand with no place
  park uuid := (select p.id from parks p where p.metro_area_id = sd limit 1);
  pt geography := 'SRID=4326;POINT(-117.15 32.75)'::geography;
  r record;
  passed int := 0;
  total int := 0;
  failures text := '';

begin
  insert into pages (handle, display_name, roles, location, timezone)
    values ('zz_clock_org_none', 'Clock Org None', '{organizer}', pt, 'Europe/Madrid') returning id into org_none;
  insert into pages (handle, display_name, roles, location, timezone, metro_area_id)
    values ('zz_clock_org_sd', 'Clock Org SD', '{organizer}', pt, 'Europe/Madrid', sd) returning id into org_sd;
  insert into pages (handle, display_name, roles, metro_area_id)
    values ('zz_clock_org_nopin', 'Clock Org No Pin', '{organizer}', sd) returning id into org_nopin;
  insert into pages (handle, display_name, roles, location, location_type, timezone, metro_area_id)
    values ('zz_clock_shop', 'Clock Shop', '{shop}', pt, 'storefront', 'Europe/Copenhagen', sd) returning id into shop_tz;
  insert into pages (handle, display_name, roles, location, location_type, timezone)
    values ('zz_clock_shop_org', 'Clock Shop Org', '{shop,organizer}', pt, 'storefront', 'Europe/Copenhagen') returning id into shop_org;
  insert into pages (handle, display_name, roles)
    values ('zz_clock_brand', 'Clock Brand', '{brand}') returning id into brand;

  -- place_tz
  total := total + 1;
  if private.place_tz('page', null, org_sd, null) = 'America/Los_Angeles' then passed := passed + 1;
  else failures := failures || ' [1 organizer base uses metro, not its own time zone]'; end if;

  total := total + 1;
  if private.place_tz('page', null, org_none, null) = 'UTC' then passed := passed + 1;
  else failures := failures || ' [2 organizer without metro ignores its own time zone]'; end if;

  total := total + 1;
  if private.place_tz('page', null, shop_tz, null) = 'Europe/Copenhagen' then passed := passed + 1;
  else failures := failures || ' [3 shop keeps its own time zone first]'; end if;

  total := total + 1;
  if private.place_tz('page', null, shop_org, null) = 'Europe/Copenhagen' then passed := passed + 1;
  else failures := failures || ' [4 shop that is also an organizer keeps the shop clock]'; end if;

  total := total + 1;
  if private.place_tz('park', park, null, null) = 'America/Los_Angeles' then passed := passed + 1;
  else failures := failures || ' [5 park unchanged]'; end if;

  total := total + 1;
  if private.place_tz('address', null, org_none, sd) = 'America/Los_Angeles' then passed := passed + 1;
  else failures := failures || ' [6 address uses the metro passed in]'; end if;

  -- resolve_meetup_place
  total := total + 1;
  begin
    perform private.resolve_meetup_place(org_none, 'page', null, null, null, null);
    failures := failures || ' [7 organizer base without metro was allowed]';
  exception when sqlstate '22023' then
    if sqlerrm like '%needs a city%base%' then passed := passed + 1;
    else failures := failures || ' [7 wrong refusal: ' || sqlerrm || ']'; end if;
  end;

  total := total + 1;
  begin
    perform private.resolve_meetup_place(org_sd, 'page', null, null, null, null);
    passed := passed + 1;
  exception when others then failures := failures || ' [8 organizer base with metro refused: ' || sqlerrm || ']';
  end;

  total := total + 1;
  begin
    perform private.resolve_meetup_place(org_nopin, 'page', null, null, null, null);
    failures := failures || ' [9 organizer without a base was allowed]';
  exception when sqlstate '22023' then
    if sqlerrm like '%no location to meet at%' then passed := passed + 1;
    else failures := failures || ' [9 wrong refusal: ' || sqlerrm || ']'; end if;
  end;

  total := total + 1;
  begin
    perform private.resolve_meetup_place(shop_org, 'page', null, null, null, null);
    passed := passed + 1;
  exception when others then failures := failures || ' [10 shop-organizer storefront without metro refused: ' || sqlerrm || ']';
  end;

  total := total + 1;
  begin
    perform private.resolve_meetup_place(shop_tz, 'page', null, null, null, null);
    passed := passed + 1;
  exception when others then failures := failures || ' [11 storefront refused: ' || sqlerrm || ']';
  end;

  total := total + 1;
  begin
    perform private.resolve_meetup_place(brand, 'page', null, null, null, null);
    failures := failures || ' [12 brand with no place was allowed]';
  exception when sqlstate '22023' then passed := passed + 1;
  end;

  total := total + 1;
  begin
    perform private.resolve_meetup_place(org_none, 'address', null, '1 Main St', 32.7, -117.1);
    failures := failures || ' [13 address without metro was allowed]';
  exception when sqlstate '22023' then
    if sqlerrm like '%needs a city before it can meet at an address%' then passed := passed + 1;
    else failures := failures || ' [13 wrong refusal: ' || sqlerrm || ']'; end if;
  end;

  total := total + 1;
  begin
    select * into r from private.resolve_meetup_place(org_sd, 'address', null, '1 Main St', 32.7, -117.1);
    if r.o_metro = sd then passed := passed + 1;
    else failures := failures || ' [14 address metro not set]'; end if;
  exception when others then failures := failures || ' [14 address refused: ' || sqlerrm || ']';
  end;

  total := total + 1;
  begin
    select * into r from private.resolve_meetup_place(null, 'park', park, null, null, null);
    if r.o_park = park then passed := passed + 1;
    else failures := failures || ' [15 park not returned]'; end if;
  exception when others then failures := failures || ' [15 park refused: ' || sqlerrm || ']';
  end;

  raise exception 'RESULTS: % of %.%', passed, total, failures;
end $$;
