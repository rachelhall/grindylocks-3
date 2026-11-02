-- Rolled-back check for 20261102130000_welcome_metro_areas.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
begin;

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
revoke all on function public.welcome_metro_areas() from public;
grant execute on function public.welcome_metro_areas() to anon, authenticated;

create temp table results (check_name text, ok boolean, detail text) on commit drop;
grant all on results to anon;

-- An empty metro area, which must not show.
insert into metro_areas (name, region, country, timezone)
values ('Check Empty Metro', 'Nowhere', 'US', 'America/Los_Angeles');

set local role anon;

insert into results
select 'anon can call it', count(*) > 0, count(*)::text || ' rows'
from public.welcome_metro_areas();

-- Signed out, the tables themselves stay closed: either refused outright
-- or no rows.
do $$
declare n bigint;
begin
  begin
    select count(*) into n from metro_areas;
    insert into results values ('anon still cannot read metro_areas directly', n = 0, n::text || ' rows');
  exception when insufficient_privilege then
    insert into results values ('anon still cannot read metro_areas directly', true, 'permission denied');
  end;
  begin
    select count(*) into n from parks;
    insert into results values ('anon still cannot read parks directly', n = 0, n::text || ' rows');
  exception when insufficient_privilege then
    insert into results values ('anon still cannot read parks directly', true, 'permission denied');
  end;
end $$;

insert into results
select 'metro areas without parks are left out',
  not exists (select 1 from public.welcome_metro_areas() w where w.name = 'Check Empty Metro'), '';

insert into results
select 'most parks first (San Diego leads)',
  (select w.name from public.welcome_metro_areas() w limit 1) = 'San Diego',
  (select w.name from public.welcome_metro_areas() w limit 1);

reset role;

insert into results
select 'every metro area with a park is listed',
  (select count(*) from public.welcome_metro_areas())
    = (select count(distinct metro_area_id) from parks where metro_area_id is not null),
  (select count(*) from public.welcome_metro_areas())::text;

do $$
begin
  raise exception 'RESULTS %', (select json_agg(r) from results r);
end $$;
