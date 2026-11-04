-- Rolled-back check for 20261104220000_page_location_hours.sql.
-- Paste the migration where marked, then run: everything happens in one
-- transaction that ends by raising RESULTS [...], so nothing is kept.
-- Every row should have ok = true.
begin;

-- <the migration goes here>

/* Checks ------------------------------------------------------------------------------- */

create temp table t_results(step text, ok boolean, detail text);
grant all on t_results to authenticated;

insert into auth.users (id, email, aud, role, instance_id) values
 ('e7000000-0000-4000-8000-0000000000a1','plh-owner@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e7000000-0000-4000-8000-0000000000a2','plh-staff@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e7000000-0000-4000-8000-0000000000a3','plh-skater@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private)
select u.id, u.name, now(), (select id from metro_areas where name = 'Copenhagen'), '{inline}', now(), false
  from (values ('e7000000-0000-4000-8000-0000000000a1'::uuid, 'plh_owner'),
               ('e7000000-0000-4000-8000-0000000000a2'::uuid, 'plh_staff'),
               ('e7000000-0000-4000-8000-0000000000a3'::uuid, 'plh_skater')) u(id, name);

update pages set state = 'managed' where handle = '8set_store';
insert into page_members (page_id, user_id, role)
select id, 'e7000000-0000-4000-8000-0000000000a1'::uuid, 'owner'::page_member_role from pages where handle = '8set_store'
union all
select id, 'e7000000-0000-4000-8000-0000000000a2'::uuid, 'staff'::page_member_role from pages where handle = '8set_store';

create temp table t_ids as select (select id from pages where handle = '8set_store') as shop,
                                  (select id from pages where 'brand' = any (roles) and not 'shop' = any (roles) limit 1) as brand;
grant select on t_ids to authenticated;

set local role authenticated;

-- The owner: address and pin.
select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_page_location((select shop from t_ids), '  Bregnerødgade 18, 2200 København N  ', 55.6935, 12.5572);
insert into t_results select 'owner sets the address, trimmed', address = 'Bregnerødgade 18, 2200 København N', address
  from pages where id = (select shop from t_ids);
insert into t_results select 'owner sets the pin', round(latitude::numeric, 4) = 55.6935 and round(longitude::numeric, 4) = 12.5572, latitude || ',' || longitude
  from pages where id = (select shop from t_ids);

do $$ begin
  perform set_page_location((select shop from t_ids), 'x', 55.0, null);
  insert into t_results values ('half a pin is refused', false, 'went through');
exception when others then insert into t_results values ('half a pin is refused', sqlerrm = 'invalid_pin', sqlerrm); end $$;
do $$ begin
  perform set_page_location((select shop from t_ids), 'x', 91, 10);
  insert into t_results values ('a pin off the globe is refused', false, 'went through');
exception when others then insert into t_results values ('a pin off the globe is refused', sqlerrm = 'invalid_pin', sqlerrm); end $$;
do $$ begin
  perform set_page_location((select shop from t_ids), repeat('a', 201), null, null);
  insert into t_results values ('a 201-character address is refused', false, 'went through');
exception when others then insert into t_results values ('a 201-character address is refused', sqlerrm = 'too_long', sqlerrm); end $$;
do $$ begin
  perform set_page_location((select brand from t_ids), 'x', null, null);
  insert into t_results values ('a brand has no address', false, 'went through');
exception when others then insert into t_results values ('a brand has no address', sqlerrm in ('not_allowed', 'not_a_shop'), sqlerrm); end $$;

-- The owner: hours, with a split day and seasons.
select set_page_hours((select shop from t_ids), '[
  {"days":[1,2,4,5],"start":"10:00","end":"17:00"},
  {"days":[3],"start":"11:00","end":"14:30"},
  {"days":[3],"start":"15:45","end":"17:00","note":"  Workshop only  "},
  {"days":[6,6],"start":"10:00","end":"14:00"}
]'::jsonb);
insert into t_results select 'four rows, one per opening', count(*) = 4, count(*)::text from page_hours where page_id = (select shop from t_ids);
insert into t_results select 'clock anchors and no season', bool_and(start_anchor = 'clock' and end_anchor = 'clock' and season_start_month is null), ''
  from page_hours where page_id = (select shop from t_ids);
insert into t_results select 'repeated days collapse, note trimmed',
  exists (select 1 from page_hours where page_id = (select shop from t_ids) and days = '{6}')
  and exists (select 1 from page_hours where page_id = (select shop from t_ids) and note = 'Workshop only'), '';

select set_page_hours((select shop from t_ids), '[
  {"days":[2,3,4,5],"start":"12:00","end":"19:00","season":{"start_month":4,"start_day":1,"end_month":9,"end_day":30}},
  {"days":[4,5,6],"start":"12:00","end":"17:00","season":{"start_month":11,"start_day":1,"end_month":2,"end_day":29}}
]'::jsonb);
insert into t_results select 'seasons replace the old hours', count(*) = 2 and bool_and(season_start_month is not null), count(*)::text
  from page_hours where page_id = (select shop from t_ids);

do $$ declare bad jsonb; label text; begin
  foreach bad in array array[
    '[{"days":[],"start":"10:00","end":"17:00"}]'::jsonb,
    '[{"days":[8],"start":"10:00","end":"17:00"}]',
    '[{"days":[1],"start":"25:00","end":"17:00"}]',
    '[{"days":[1],"start":"10:00","end":"10:00"}]',
    '[{"days":[1],"start":"10:00"}]',
    '[{"days":[1],"start":"10:00","end":"17:00","season":{"start_month":2,"start_day":30,"end_month":3,"end_day":1}}]',
    '[{"days":[1],"start":"10:00","end":"17:00","season":{"start_month":4}}]',
    '{"days":[1]}'
  ] loop
    begin
      perform set_page_hours((select shop from t_ids), bad);
      insert into t_results values ('bad hours refused: ' || bad::text, false, 'went through');
    exception when others then
      insert into t_results values ('bad hours refused: ' || bad::text, sqlerrm = 'invalid_hours', sqlerrm);
    end;
  end loop;
end $$;
insert into t_results select 'a refused save keeps the old hours', count(*) = 2, count(*)::text from page_hours where page_id = (select shop from t_ids);

do $$ begin
  perform set_page_hours((select shop from t_ids), (select jsonb_agg('{"days":[1],"start":"10:00","end":"11:00"}'::jsonb) from generate_series(1, 61)));
  insert into t_results values ('61 openings are refused', false, 'went through');
exception when others then insert into t_results values ('61 openings are refused', sqlerrm = 'too_many', sqlerrm); end $$;

-- Staff: hours yes, address no.
select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
select set_page_hours((select shop from t_ids), '[{"days":[1,2,3,4,5,6],"start":"09:00","end":"18:00"}]'::jsonb);
insert into t_results select 'staff change hours', count(*) = 1, count(*)::text from page_hours where page_id = (select shop from t_ids);
do $$ begin
  perform set_page_location((select shop from t_ids), 'Somewhere else 1', 55.7, 12.6);
  insert into t_results values ('staff can''t move the address', false, 'went through');
exception when others then insert into t_results values ('staff can''t move the address', sqlerrm = 'not_allowed', sqlerrm); end $$;

-- Someone off the team: neither.
select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$ begin
  perform set_page_hours((select shop from t_ids), '[]'::jsonb);
  insert into t_results values ('a skater off the team can''t change hours', false, 'went through');
exception when others then insert into t_results values ('a skater off the team can''t change hours', sqlerrm = 'not_allowed', sqlerrm); end $$;
do $$ begin
  perform set_page_location((select shop from t_ids), 'x', null, null);
  insert into t_results values ('a skater off the team can''t set the address', false, 'went through');
exception when others then insert into t_results values ('a skater off the team can''t set the address', sqlerrm = 'not_allowed', sqlerrm); end $$;
insert into t_results select 'a skater still reads the hours', count(*) = 1, count(*)::text from page_hours where page_id = (select shop from t_ids);

-- The owner clears the hours, and the pin.
select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_page_hours((select shop from t_ids), '[]'::jsonb);
insert into t_results select 'an empty list clears the hours', count(*) = 0, count(*)::text from page_hours where page_id = (select shop from t_ids);
select set_page_location((select shop from t_ids), '', null, null);
insert into t_results select 'a blank address and no pin clear both', address is null and location is null, coalesce(address, 'null')
  from pages where id = (select shop from t_ids);

-- A suspended page can't be edited.
reset role;
update pages set suspended_at = now() where id = (select shop from t_ids);
set local role authenticated;
do $$ begin
  perform set_page_hours((select shop from t_ids), '[]'::jsonb);
  insert into t_results values ('a suspended page''s hours are locked', false, 'went through');
exception when others then insert into t_results values ('a suspended page''s hours are locked', sqlerrm = 'not_allowed', sqlerrm); end $$;

reset role;
do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
