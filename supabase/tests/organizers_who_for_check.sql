-- Rolled-back check for 20261106152832_organizers_who_for.sql (apply
-- 20261106152252_organizers_enums.sql first). Paste the migration where
-- marked, then run: everything happens in one transaction that ends by
-- raising RESULTS [...], so nothing is kept. Every row should have ok = true.
begin;

-- <the migration goes here>

/* Checks ------------------------------------------------------------------------------- */

create temp table t_results(step text, ok boolean, detail text);
grant all on t_results to authenticated;

insert into auth.users (id, email, aud, role, instance_id) values
 ('e7000000-0000-4000-8000-0000000000c1','owf-owner@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e7000000-0000-4000-8000-0000000000c2','owf-skater@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e7000000-0000-4000-8000-0000000000c3','owf-staff@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private)
select u.id, u.name, now(), (select id from metro_areas where name = 'Copenhagen'), '{inline}', now(), false
  from (values ('e7000000-0000-4000-8000-0000000000c1'::uuid, 'owf_owner'),
               ('e7000000-0000-4000-8000-0000000000c2'::uuid, 'owf_skater'),
               ('e7000000-0000-4000-8000-0000000000c3'::uuid, 'owf_staff')) u(id, name);

insert into pages (handle, display_name, roles, state, city, country, metro_area_id, timezone, logo_path, managed_at)
values ('owf_camp', 'OWF Camp', '{organizer}', 'managed', 'Copenhagen', 'DK',
        (select id from metro_areas where name = 'Copenhagen'), 'Europe/Copenhagen', 'owf/logo.jpg', now()),
       ('owf_brand', 'OWF Brand', '{brand}', 'managed', null, 'DK', null, null, 'owf/logo.jpg', now());
insert into page_members (page_id, user_id, role)
select id, 'e7000000-0000-4000-8000-0000000000c1'::uuid, 'owner'::page_member_role from pages where handle in ('owf_camp', 'owf_brand')
union all
select id, 'e7000000-0000-4000-8000-0000000000c3'::uuid, 'staff'::page_member_role from pages where handle = 'owf_camp';

create temp table t_ids as select
  (select id from pages where handle = 'owf_camp') as camp,
  (select id from pages where handle = 'owf_brand') as brand,
  (select id from parks order by slug limit 1) as park;
create temp table t_events(name text, id uuid);
grant select on t_ids to authenticated;
grant all on t_events to authenticated;

-- Shapes the database refuses outright.
do $$ begin
  update pages set location_type = 'storefront' where id = (select camp from t_ids);
  insert into t_results values ('an organizer has no shop location type', false, 'went through');
exception when others then insert into t_results values ('an organizer has no shop location type', sqlerrm ~ 'pages_shop_fields', sqlerrm); end $$;
do $$ begin
  update pages set state = 'inactive' where id = (select brand from t_ids);
  insert into t_results values ('only organizers can be No longer active', false, 'went through');
exception when others then insert into t_results values ('only organizers can be No longer active', sqlerrm ~ 'pages_inactive_is_an_organizer', sqlerrm); end $$;

set local role authenticated;

/* Who it's for, from a person ---------------------------------------------------------- */

select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);
insert into t_events select 'person', create_meetup(
  park => (select park from t_ids), starts_at => date_trunc('hour', now()) + interval '3 days',
  ends_at => date_trunc('hour', now()) + interval '3 days 2 hours', who_for => E'  Beginners\n   welcome  ');
insert into t_results select 'a person''s meetup keeps the line, folded to one', e.who_for = 'Beginners welcome' and s.who_for = 'Beginners welcome', e.who_for
  from events e join event_series s on s.id = e.series_id where e.id = (select id from t_events where name = 'person');

insert into t_events select 'plain', create_meetup(
  park => (select park from t_ids), starts_at => date_trunc('hour', now()) + interval '4 days',
  ends_at => date_trunc('hour', now()) + interval '4 days 2 hours');
insert into t_results select 'a meetup without one has none', who_for is null, coalesce(who_for, 'null')
  from events where id = (select id from t_events where name = 'plain');

do $$ begin
  perform create_meetup(park => (select park from t_ids), starts_at => date_trunc('hour', now()) + interval '5 days',
                        ends_at => date_trunc('hour', now()) + interval '5 days 2 hours', who_for => repeat('a', 61));
  insert into t_results values ('61 characters are refused', false, 'went through');
exception when others then insert into t_results values ('61 characters are refused', sqlerrm ~ '60 characters', sqlerrm); end $$;

select update_meetup((select id from t_events where name = 'person'), 'date', '{"who_for":"Girls and women, all levels"}');
insert into t_results select 'editing a date changes the line', who_for = 'Girls and women, all levels', who_for
  from events where id = (select id from t_events where name = 'person');
select update_meetup((select id from t_events where name = 'person'), 'date', '{"title":"Sunday roll"}');
insert into t_results select 'other edits keep the line', who_for = 'Girls and women, all levels', who_for
  from events where id = (select id from t_events where name = 'person');
select update_meetup((select id from t_events where name = 'person'), 'date', '{"who_for":"   "}');
insert into t_results select 'a blank line clears it', who_for is null, coalesce(who_for, 'null')
  from events where id = (select id from t_events where name = 'person');

-- Repeats copy the line to every date.
insert into t_events select 'weekly', create_meetup(
  park => (select park from t_ids), starts_at => date_trunc('hour', now()) + interval '2 days',
  ends_at => date_trunc('hour', now()) + interval '2 days 2 hours',
  weekdays => array[extract(isodow from now() + interval '2 days')::smallint], who_for => '40+ session');
insert into t_results select 'every generated date has the line', count(*) > 1 and bool_and(e.who_for = '40+ session'), count(*)::text
  from events e where e.series_id = (select series_id from events where id = (select id from t_events where name = 'weekly'));
select update_meetup((select id from t_events where name = 'weekly'), 'upcoming', '{"who_for":"Quads only"}');
insert into t_results select 'editing upcoming dates changes them all, and the series',
  bool_and(e.who_for = 'Quads only') and (select who_for from event_series where id = min(e.series_id::text)::uuid) = 'Quads only', count(*)::text
  from events e where e.series_id = (select series_id from events where id = (select id from t_events where name = 'weekly'))
   and e.starts_at >= (select starts_at from events where id = (select id from t_events where name = 'weekly'));

/* The organizer's base ----------------------------------------------------------------- */

select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
do $$ begin
  perform create_meetup(park => null, starts_at => date_trunc('hour', now()) + interval '6 days',
                        ends_at => date_trunc('hour', now()) + interval '6 days 2 hours', as_page => (select camp from t_ids), place => 'page');
  insert into t_results values ('no base, no meetup at the page', false, 'went through');
exception when others then insert into t_results values ('no base, no meetup at the page', sqlerrm = 'This page has no location to meet at', sqlerrm); end $$;
reset role;
insert into t_results select 'no base, no Near you', not private.page_reaches_near_you((select camp from t_ids)), '';
set local role authenticated;

select set_page_location((select camp from t_ids), '  Calle Larios 1, Málaga  ', 55.6935, 12.5572);
insert into t_results select 'the owner sets a base', address = 'Calle Larios 1, Málaga' and latitude is not null, address
  from pages where id = (select camp from t_ids);
reset role;
insert into t_results select 'with a base, Near you', private.page_reaches_near_you((select camp from t_ids)), '';
set local role authenticated;
do $$ begin
  perform set_page_location((select brand from t_ids), 'x', null, null);
  insert into t_results values ('a brand still has no address', false, 'went through');
exception when others then insert into t_results values ('a brand still has no address', sqlerrm = 'not_a_shop', sqlerrm); end $$;

insert into t_events select 'camp', create_meetup(
  park => null, starts_at => date_trunc('hour', now()) + interval '6 days',
  ends_at => date_trunc('hour', now()) + interval '6 days 2 hours',
  as_page => (select camp from t_ids), place => 'page', who_for => 'Women and girls, all levels', capacity => 44);
insert into t_results select 'a meetup at the base, with the line',
  e.place = 'page' and e.who_for = 'Women and girls, all levels' and (public.meetup_place_info(e) ->> 'address') = 'Calle Larios 1, Málaga'
  and public.meetup_timezone(e) = 'Europe/Copenhagen', public.meetup_place_info(e)::text
  from events e where e.id = (select id from t_events where name = 'camp');

/* No longer active --------------------------------------------------------------------- */

select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
do $$ begin
  perform close_page_for_good((select camp from t_ids));
  insert into t_results values ('staff can''t close the page', false, 'went through');
exception when others then insert into t_results values ('staff can''t close the page', sqlerrm = 'not_allowed', sqlerrm); end $$;

select set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
insert into t_results select 'the owner closes an organizer: No longer active', close_page_for_good((select camp from t_ids)) = 'inactive', '';
insert into t_results select 'years on the tape, closed_at set',
  state = 'inactive' and ended_label = extract(year from now())::int::text and closed_at is not null, state || ' ' || coalesce(ended_label, 'null')
  from pages where id = (select camp from t_ids);
insert into t_results select 'its upcoming meetup is cancelled', status = 'cancelled' and cancel_reason = 'page_closed', status || ' ' || coalesce(cancel_reason::text, 'null')
  from events where id = (select id from t_events where name = 'camp');
insert into t_results select 'its series has ended', s.ended_at is not null, ''
  from events e join event_series s on s.id = e.series_id where e.id = (select id from t_events where name = 'camp');
reset role;
insert into t_results select 'an archive can''t post or host', not private.can_post_as_page((select camp from t_ids)), '';
set local role authenticated;
reset role;
insert into t_results select 'an archive leaves Near you', not private.page_reaches_near_you((select camp from t_ids)), '';
set local role authenticated;
do $$ begin
  perform close_page_for_good((select camp from t_ids));
  insert into t_results values ('closing twice is refused', false, 'went through');
-- The team is read-only once closed, so the owner check refuses it first.
exception when others then insert into t_results values ('closing twice is refused', sqlerrm in ('not_allowed', 'already_closed'), sqlerrm); end $$;

insert into t_results select 'a brand still retires', close_page_for_good((select brand from t_ids)) = 'out_of_business', '';
reset role;
insert into t_results select 'a Retired brand can''t post any more', not private.can_post_as_page((select brand from t_ids)), '';
set local role authenticated;

reset role;
insert into t_results select 'Rachel''s Close and Reopen know No longer active',
  pg_get_functiondef('public.admin_close_page(uuid, text, text)'::regprocedure) ~ 'else ''inactive'' end'
  and pg_get_functiondef('public.reopen_page(uuid)'::regprocedure) ~ '''out_of_business'', ''inactive''\)', '';
insert into t_results select 'one create_meetup, callable by members',
  count(*) = 1 and bool_and(has_function_privilege('authenticated', p.oid, 'execute'))
  and not bool_or(has_function_privilege('anon', p.oid, 'execute')), count(*)::text
  from pg_proc p where p.proname = 'create_meetup' and p.pronamespace = 'public'::regnamespace;

do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
