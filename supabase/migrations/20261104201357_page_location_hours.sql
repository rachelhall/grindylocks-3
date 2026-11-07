-- Brand and shop accounts, part A, PR 7b: a shop's address and pin, and its
-- hours. PRD: Grindylocks — Brand and Shop Accounts PRD (Shops, Permissions,
-- Acting as a page › Edit page). Mockups: the Brand accounts (v2) page,
-- "running a page" row (Page-Address, Page-Hours, Page-Hours-Row,
-- Page-Hours-Seasons), approved Nov 4.
--
--  1. set_page_location(): the address as the team writes it and the pin
--     (managers and the owner). The city and metro area stay with Rachel,
--     since they decide Near you and which city admin gets the shop's
--     reports.
--  2. set_page_hours(): replaces a shop's hours in one go (everyone on the
--     team: whoever's behind the counter knows). Each opening is a row; a day
--     with a lunch break is two. Hours are the same all year (no dates) or
--     sets of dates (seasons), and shops use clock times only: the sunrise
--     and sunset anchors stay for parks.
--
-- Additive: two functions.

/* 1. Address and pin ------------------------------------------------------------------ */

-- Errors: not_allowed, not_a_shop, too_long, invalid_pin.
create or replace function public.set_page_location(page uuid, address text, latitude double precision, longitude double precision)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  clean text := nullif(btrim(coalesce(set_page_location.address, '')), '');
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if not exists (select 1 from pages p where p.id = page and 'shop' = any (p.roles)) then
    raise exception using errcode = '22023', message = 'not_a_shop';
  end if;
  if char_length(clean) > 200 then
    raise exception using errcode = '22023', message = 'too_long';
  end if;
  if (latitude is null) <> (longitude is null)
     or latitude not between -90 and 90 or longitude not between -180 and 180
     or latitude = 'NaN'::double precision or longitude = 'NaN'::double precision then
    raise exception using errcode = '22023', message = 'invalid_pin';
  end if;

  update pages p
     set address = clean,
         location = case when set_page_location.latitude is null then null
                         else extensions.st_setsrid(extensions.st_makepoint(set_page_location.longitude, set_page_location.latitude), 4326)::extensions.geography end,
         updated_at = now()
   where p.id = page;
end $$;

/* 2. Hours ---------------------------------------------------------------------------- */

-- The last day of a month, counting 29 February (seasons repeat every year).
create or replace function private.month_days(m integer)
returns integer
language sql immutable
set search_path = ''
as $$
  select case when m = 2 then 29 when m in (4, 6, 9, 11) then 30 else 31 end;
$$;

-- hours: a JSON array of openings, each
--   {"days": [1, 2], "start": "10:00", "end": "17:00", "note": null,
--    "season": null | {"start_month": 4, "start_day": 1, "end_month": 9, "end_day": 30}}
-- with days as ISO weekdays (1 = Monday). An empty array clears the hours.
-- An end at or before the start runs past midnight, as on park hours.
-- Errors: not_allowed, not_a_shop, invalid_hours, too_many.
create or replace function public.set_page_hours(page uuid, hours jsonb)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  item jsonb;
  season jsonb;
  d integer[];
  t_start time;
  t_end time;
  note_clean text;
  sm integer;
  sd integer;
  em integer;
  ed integer;
begin
  if not private.can_act_as_page(page, 'staff') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if not exists (select 1 from pages p where p.id = page and 'shop' = any (p.roles)) then
    raise exception using errcode = '22023', message = 'not_a_shop';
  end if;
  if hours is null or jsonb_typeof(hours) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_hours';
  end if;
  if jsonb_array_length(hours) > 60 then
    raise exception using errcode = '22023', message = 'too_many';
  end if;

  delete from page_hours h where h.page_id = page;

  for item in select value from jsonb_array_elements(hours) loop
    begin
      if jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'days') <> 'array' then
        raise exception 'shape';
      end if;
      select coalesce(array_agg(distinct x::integer order by x::integer), '{}') into d
        from jsonb_array_elements_text(item -> 'days') x;
      if cardinality(d) = 0 or not d <@ array[1, 2, 3, 4, 5, 6, 7] then
        raise exception 'days';
      end if;
      if coalesce(item ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(item ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'time';
      end if;
      t_start := (item ->> 'start')::time;
      t_end := (item ->> 'end')::time;
      if t_start = t_end then
        raise exception 'empty';
      end if;
      note_clean := nullif(btrim(coalesce(item ->> 'note', '')), '');
      if char_length(note_clean) > 140 then
        raise exception 'note';
      end if;

      season := item -> 'season';
      if season is null or jsonb_typeof(season) = 'null' then
        sm := null; sd := null; em := null; ed := null;
      else
        sm := (season ->> 'start_month')::integer;
        sd := (season ->> 'start_day')::integer;
        em := (season ->> 'end_month')::integer;
        ed := (season ->> 'end_day')::integer;
        if sm is null or sd is null or em is null or ed is null
           or sm not between 1 and 12 or em not between 1 and 12
           or sd not between 1 and private.month_days(sm) or ed not between 1 and private.month_days(em) then
          raise exception 'season';
        end if;
      end if;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid_hours';
    end;

    insert into page_hours (page_id, season_start_month, season_start_day, season_end_month, season_end_day,
                            days, start_anchor, start_time, end_anchor, end_time, note)
    values (page, sm, sd, em, ed, d::smallint[], 'clock', t_start, 'clock', t_end, note_clean);
  end loop;

  update pages p set updated_at = now() where p.id = page;
end $$;

/* Grants ------------------------------------------------------------------------------- */

revoke all on function private.month_days(integer) from public, anon, authenticated;

revoke all on function public.set_page_location(uuid, text, double precision, double precision) from public, anon;
grant execute on function public.set_page_location(uuid, text, double precision, double precision) to authenticated;
revoke all on function public.set_page_hours(uuid, jsonb) from public, anon;
grant execute on function public.set_page_hours(uuid, jsonb) to authenticated;
