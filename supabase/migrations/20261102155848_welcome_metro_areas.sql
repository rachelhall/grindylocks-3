-- Welcome screen city tape (Nov 2).
--
-- The welcome screen shows the metro areas that have parks ("Parks in San
-- Diego, Copenhagen, … +4 more"), so the list grows by itself as parks are
-- added. That screen is shown before sign-in, so this is the second thing a
-- signed-out visitor can ask, after invite_preview(): metro area names only,
-- most parks first. No park counts, no parks, no people.
--
-- Additive: one new function. Nothing is replaced or dropped.

create or replace function public.welcome_metro_areas()
returns table (name text)
language sql stable security definer
set search_path = public
as $$
  select m.name
  from metro_areas m
  join parks p on p.metro_area_id = m.id
  group by m.id, m.name
  order by count(*) desc, m.name;
$$;

comment on function public.welcome_metro_areas() is
  'Metro area names that have at least one park, most parks first. For the signed-out welcome screen.';

revoke all on function public.welcome_metro_areas() from public;
-- The second thing a signed-out visitor can ask (after invite_preview).
grant execute on function public.welcome_metro_areas() to anon, authenticated;
