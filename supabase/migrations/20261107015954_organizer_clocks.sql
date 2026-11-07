-- Organizer clocks (Nov 6, Rachel): an organizer's base meetups run on its
-- metro area's clock. Organizer pages have no time zone of their own, so a
-- base meetup is refused, not given UTC, when the organizer has no metro area.
--
-- "Organizer" here means a page with the organizer role and not the shop
-- role: a shop that's also an organizer (L.O.W.) meets at its storefront on
-- the shop's clock, as before. Nothing else changes: parks use the park's
-- metro area, shops their own time zone then their metro area's, and an
-- address its metro area's (an address already needs one).
--
-- No organizer pages exist yet (checked Nov 6), so no meetup moves.

create or replace function private.place_tz(place public.meetup_place, park uuid, page uuid, metro uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    case place
      when 'park' then (select m.timezone from parks p join metro_areas m on m.id = p.metro_area_id where p.id = park)
      when 'page' then (select case when 'organizer' = any (p.roles) and not 'shop' = any (p.roles)
                                    then m.timezone
                                    else coalesce(p.timezone, m.timezone) end
                          from pages p left join metro_areas m on m.id = p.metro_area_id
                         where p.id = page)
      else coalesce((select m.timezone from metro_areas m where m.id = metro),
                    (select p.timezone from pages p where p.id = page))
    end,
    'UTC');
$$;

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
    -- A shop's storefront (or a by-appointment shop that shows its pin), or
    -- an organizer's base.
    if p.latitude is null
       or (case when 'shop' = any (p.roles)
                then p.location_type is null
                     or not (p.location_type = 'storefront' or (p.location_type = 'by_appointment' and p.show_pin))
                else not ('organizer' = any (p.roles)) end) then
      raise exception 'This page has no location to meet at' using errcode = '22023';
    end if;
    -- An organizer's base runs on its metro area's clock.
    if not 'shop' = any (p.roles) and p.metro_area_id is null then
      raise exception 'This organizer needs a city before it can meet at its base' using errcode = '22023';
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
