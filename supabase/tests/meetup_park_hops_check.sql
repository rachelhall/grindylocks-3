-- Rolled-back check for 20261106191620_meetup_park_hops.sql. Paste the
-- migration where marked, then run: everything happens in one transaction
-- that ends by raising RESULTS [...], so nothing is kept. Every row should
-- have ok = true.
begin;

-- <the migration goes here>

/* Checks ------------------------------------------------------------------------------- */

create temp table t_results(step text, ok boolean, detail text);
create temp table t_ids(name text, id uuid);
grant all on t_results, t_ids to authenticated;

-- Four parks in one metro: A is the start, B, C and D are stops.
insert into t_ids
select 'park_' || chr(64 + n::int), id
  from (select id, row_number() over (order by slug) n from parks
         where metro_area_id = (select metro_area_id from parks group by metro_area_id order by count(*) desc limit 1)
         limit 4) x;

insert into auth.users (id, email, aud, role, instance_id) values
 ('e8000000-0000-4000-8000-0000000000b1','hop-host@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e8000000-0000-4000-8000-0000000000b2','hop-goer@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e8000000-0000-4000-8000-0000000000b3','hop-stopadmin@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e8000000-0000-4000-8000-0000000000b4','hop-startadmin@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e8000000-0000-4000-8000-0000000000b5','hop-blocker@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e8000000-0000-4000-8000-0000000000b6','hop-reporter@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private)
select u.id, u.name, now(), (select metro_area_id from parks where id = (select id from t_ids where name = 'park_A')), '{inline}', now(), false
  from (values ('e8000000-0000-4000-8000-0000000000b1'::uuid, 'hop_host'),
               ('e8000000-0000-4000-8000-0000000000b2'::uuid, 'hop_goer'),
               ('e8000000-0000-4000-8000-0000000000b3'::uuid, 'hop_stopadmin'),
               ('e8000000-0000-4000-8000-0000000000b4'::uuid, 'hop_startadmin'),
               ('e8000000-0000-4000-8000-0000000000b5'::uuid, 'hop_blocker'),
               ('e8000000-0000-4000-8000-0000000000b6'::uuid, 'hop_reporter')) u(id, name);
insert into role_assignments (user_id, role, park_id, accepted_at) values
 ('e8000000-0000-4000-8000-0000000000b3', 'park_admin', (select id from t_ids where name = 'park_C'), now()),
 ('e8000000-0000-4000-8000-0000000000b4', 'park_admin', (select id from t_ids where name = 'park_A'), now());
insert into blocks (blocker_id, blocked_id) values
 ('e8000000-0000-4000-8000-0000000000b5', 'e8000000-0000-4000-8000-0000000000b1');

set local role authenticated;

/* A person's park hop ------------------------------------------------------------------ */

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
insert into t_ids select 'hop', create_meetup(
  park => (select id from t_ids where name = 'park_A'),
  starts_at => date_trunc('hour', now()) + interval '3 days', ends_at => date_trunc('hour', now()) + interval '3 days 4 hours',
  title => 'Saturday crawl',
  more_parks => array[(select id from t_ids where name = 'park_B'), (select id from t_ids where name = 'park_C')]);
insert into t_results select 'a person''s meetup takes more parks, in order',
  array_agg(p.park_id order by p.position) = array[(select id from t_ids where name = 'park_B'), (select id from t_ids where name = 'park_C')]
  and array_agg(p.position order by p.position) = '{2,3}', count(*)::text
  from event_parks p where p.event_id = (select id from t_ids where name = 'hop');
insert into t_results select 'the series keeps the list too', count(*) = 2, count(*)::text
  from event_series_parks where series_id = (select series_id from events where id = (select id from t_ids where name = 'hop'));
insert into t_results select 'meetup_stops lists them for the card',
  jsonb_array_length(public.meetup_stops(e)) = 2 and public.meetup_stops(e) -> 0 ->> 'position' = '2', public.meetup_stops(e)::text
  from events e where e.id = (select id from t_ids where name = 'hop');

do $$ begin
  perform create_meetup(park => (select id from t_ids where name = 'park_A'),
    starts_at => date_trunc('hour', now()) + interval '4 days',
    more_parks => array[(select id from t_ids where name = 'park_A')]);
  insert into t_results values ('the start can''t be a stop too', false, 'went through');
exception when others then insert into t_results values ('the start can''t be a stop too', sqlerrm = 'That park is already the start', sqlerrm); end $$;
do $$ begin
  perform create_meetup(park => (select id from t_ids where name = 'park_A'),
    starts_at => date_trunc('hour', now()) + interval '4 days',
    more_parks => array[(select id from t_ids where name = 'park_B'), (select id from t_ids where name = 'park_B')]);
  insert into t_results values ('a park only once', false, 'went through');
exception when others then insert into t_results values ('a park only once', sqlerrm = 'Each park can be on a meetup once', sqlerrm); end $$;
do $$ begin
  perform create_meetup(park => (select id from t_ids where name = 'park_A'),
    starts_at => date_trunc('hour', now()) + interval '4 days',
    more_parks => array(select id from parks where id <> (select id from t_ids where name = 'park_A') limit 10));
  insert into t_results values ('11 parks are refused', false, 'went through');
exception when others then insert into t_results values ('11 parks are refused', sqlerrm = 'A meetup can have up to 10 parks', sqlerrm); end $$;

/* Park pages ---------------------------------------------------------------------------- */

insert into t_results select 'Upcoming at a stop lists it',
  exists (select 1 from park_meetups((select id from t_ids where name = 'park_C'), 50) m where m.id = (select id from t_ids where name = 'hop')), '';
insert into t_results select 'Upcoming at the start still lists it',
  exists (select 1 from park_meetups((select id from t_ids where name = 'park_A'), 50) m where m.id = (select id from t_ids where name = 'hop')), '';
insert into t_results select 'not at a park it doesn''t stop at',
  not exists (select 1 from park_meetups((select id from t_ids where name = 'park_D'), 50) m where m.id = (select id from t_ids where name = 'hop')), '';

-- Blocks hold at every stop.
select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
insert into t_results select 'someone who blocked the host doesn''t see it at a stop',
  not exists (select 1 from park_meetups((select id from t_ids where name = 'park_B'), 50) m where m.id = (select id from t_ids where name = 'hop'))
  and not exists (select 1 from event_parks where event_id = (select id from t_ids where name = 'hop')), '';

/* Edits ------------------------------------------------------------------------------- */

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
select set_going((select id from t_ids where name = 'hop'), true);

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select update_meetup((select id from t_ids where name = 'hop'), 'date',
  jsonb_build_object('parks', jsonb_build_array((select id from t_ids where name = 'park_C'), (select id from t_ids where name = 'park_D'), (select id from t_ids where name = 'park_B'))));
insert into t_results select 'editing reorders and adds',
  array_agg(p.park_id order by p.position) = array[(select id from t_ids where name = 'park_C'), (select id from t_ids where name = 'park_D'), (select id from t_ids where name = 'park_B')], ''
  from event_parks p where p.event_id = (select id from t_ids where name = 'hop');
reset role;
insert into t_results select 'people going hear about it once', count(*) = 1, count(*)::text
  from notifications where recipient_id = 'e8000000-0000-4000-8000-0000000000b2' and kind = 'meetup_changed'
   and event_id = (select id from t_ids where name = 'hop');
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select update_meetup((select id from t_ids where name = 'hop'), 'date', jsonb_build_object('park', (select id from t_ids where name = 'park_D')));
insert into t_results select 'moving the start onto a stop drops that stop',
  array_agg(p.park_id order by p.position) = array[(select id from t_ids where name = 'park_C'), (select id from t_ids where name = 'park_B')]
  and array_agg(p.position order by p.position) = '{2,3}', ''
  from event_parks p where p.event_id = (select id from t_ids where name = 'hop');
select update_meetup((select id from t_ids where name = 'hop'), 'date', jsonb_build_object('park', (select id from t_ids where name = 'park_A')));
select update_meetup((select id from t_ids where name = 'hop'), 'date', '{"title":"Still crawling"}');
insert into t_results select 'other edits keep the stops', count(*) = 2, count(*)::text
  from event_parks where event_id = (select id from t_ids where name = 'hop');

-- Repeats copy the list; editing upcoming dates changes them all.
insert into t_ids select 'weekly', create_meetup(
  park => (select id from t_ids where name = 'park_A'),
  starts_at => date_trunc('hour', now()) + interval '2 days', ends_at => date_trunc('hour', now()) + interval '2 days 2 hours',
  weekdays => array[extract(isodow from (date_trunc('hour', now()) + interval '2 days') at time zone private.park_tz((select id from t_ids where name = 'park_A')))::smallint],
  more_parks => array[(select id from t_ids where name = 'park_B')]);
insert into t_results select 'every repeat has the stop', count(*) > 1 and bool_and(exists (select 1 from event_parks p where p.event_id = e.id and p.park_id = (select id from t_ids where name = 'park_B'))), count(*)::text
  from events e where e.series_id = (select series_id from events where id = (select id from t_ids where name = 'weekly'));
select update_meetup((select id from t_ids where name = 'weekly'), 'upcoming',
  jsonb_build_object('parks', jsonb_build_array((select id from t_ids where name = 'park_C'))));
insert into t_results select 'editing upcoming dates changes every one, and the series',
  bool_and((select array_agg(p.park_id) from event_parks p where p.event_id = e.id) = array[(select id from t_ids where name = 'park_C')])
  and (select array_agg(park_id) from event_series_parks where series_id = min(e.series_id::text)::uuid) = array[(select id from t_ids where name = 'park_C')], count(*)::text
  from events e where e.series_id = (select series_id from events where id = (select id from t_ids where name = 'weekly'));
reset role;
insert into t_results select 'a new repeat takes the new list',
  (select count(*) from private.generate_meetup_dates((select series_id from events where id = (select id from t_ids where name = 'weekly')))) >= 0
  and not exists (select 1 from events e where e.series_id = (select series_id from events where id = (select id from t_ids where name = 'weekly'))
                    and not exists (select 1 from event_parks p where p.event_id = e.id and p.park_id = (select id from t_ids where name = 'park_C'))), '';
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select update_meetup((select id from t_ids where name = 'weekly'), 'upcoming', '{"parks":[]}');
insert into t_results select 'an empty list clears the stops', not exists (
  select 1 from event_parks p join events e on e.id = p.event_id
   where e.series_id = (select series_id from events where id = (select id from t_ids where name = 'weekly'))), '';

/* A page's base with parks ------------------------------------------------------------- */

reset role;
insert into pages (handle, display_name, roles, state, city, country, metro_area_id, timezone, logo_path, managed_at)
select 'hop_camp', 'Hop Camp', '{organizer}', 'managed', 'Somewhere', 'US', p.metro_area_id, 'America/Los_Angeles', 'hop/logo.jpg', now()
  from parks p where p.id = (select id from t_ids where name = 'park_A');
insert into page_members (page_id, user_id, role)
select id, 'e8000000-0000-4000-8000-0000000000b1'::uuid, 'owner'::page_member_role from pages where handle = 'hop_camp';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select set_page_location((select id from pages where handle = 'hop_camp'), 'Camp house 1',
  (select latitude from parks where id = (select id from t_ids where name = 'park_A')),
  (select longitude from parks where id = (select id from t_ids where name = 'park_A')));
insert into t_ids select 'camp', create_meetup(
  park => null, starts_at => date_trunc('hour', now()) + interval '5 days', ends_at => date_trunc('hour', now()) + interval '5 days 6 hours',
  as_page => (select id from pages where handle = 'hop_camp'), place => 'page',
  more_parks => array[(select id from t_ids where name = 'park_B'), (select id from t_ids where name = 'park_C'), (select id from t_ids where name = 'park_D')]);
insert into t_results select 'a page meets at its base, then 3 parks',
  e.place = 'page' and e.park_id is null and jsonb_array_length(public.meetup_stops(e)) = 3, public.meetup_stops(e)::text
  from events e where e.id = (select id from t_ids where name = 'camp');
insert into t_results select 'and shows at each park',
  exists (select 1 from park_meetups((select id from t_ids where name = 'park_D'), 50) m where m.id = (select id from t_ids where name = 'camp')), '';

/* Hiding at a stop, and reports --------------------------------------------------------- */

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b6","role":"authenticated"}', true);
select file_report(meetup => (select id from t_ids where name = 'hop'), reason => 'spam');

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
insert into t_results select 'the stop''s admin gets the report',
  exists (select 1 from moderation_queue() q where q.id = (select id from t_ids where name = 'hop')), '';
insert into t_results select 'the report detail says they can only hide at their park',
  (moderation_report_detail('meetup', (select id from t_ids where name = 'hop')) ->> 'stop_only')::boolean, '';
do $$ begin
  perform moderate_reports('meetup', (select id from t_ids where name = 'hop'), 'dismiss');
  insert into t_results values ('a stop''s admin can''t dismiss', false, 'went through');
exception when others then insert into t_results values ('a stop''s admin can''t dismiss', sqlerrm = 'stop_admins_hide_only', sqlerrm); end $$;
do $$ begin
  perform hide_meetup((select id from t_ids where name = 'hop'), true);
  insert into t_results values ('a stop''s admin can''t hide the whole meetup', false, 'went through');
exception when others then insert into t_results values ('a stop''s admin can''t hide the whole meetup', sqlstate = '42501', sqlerrm); end $$;
do $$ begin
  perform hide_meetup((select id from t_ids where name = 'hop'), true, (select id from t_ids where name = 'park_B'));
  insert into t_results values ('nor at someone else''s stop', false, 'went through');
exception when others then insert into t_results values ('nor at someone else''s stop', sqlstate = '42501', sqlerrm); end $$;

select moderate_reports('meetup', (select id from t_ids where name = 'hop'), 'keep_hidden');
insert into t_results select 'keeping it hidden hides it at their park only',
  (select hidden_at is not null from event_parks where event_id = (select id from t_ids where name = 'hop') and park_id = (select id from t_ids where name = 'park_C'))
  and (select hidden_at is null from events where id = (select id from t_ids where name = 'hop')), '';
insert into t_results select 'then it leaves their queue',
  not exists (select 1 from moderation_queue() q where q.id = (select id from t_ids where name = 'hop')), '';

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
insert into t_results select 'members no longer see it at that park',
  not exists (select 1 from park_meetups((select id from t_ids where name = 'park_C'), 50) m where m.id = (select id from t_ids where name = 'hop'))
  and exists (select 1 from park_meetups((select id from t_ids where name = 'park_B'), 50) m where m.id = (select id from t_ids where name = 'hop')), '';
insert into t_results select 'nor in its stops',
  jsonb_array_length(public.meetup_stops(e)) = 1, public.meetup_stops(e)::text
  from events e where e.id = (select id from t_ids where name = 'hop');

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'the host still sees the stop, marked hidden',
  (select bool_or((x ->> 'hidden')::boolean) from jsonb_array_elements(public.meetup_stops(e)) x), public.meetup_stops(e)::text
  from events e where e.id = (select id from t_ids where name = 'hop');
reset role;
insert into t_results select 'the hosts are told which park', count(*) = 1 and min(message) like 'stop:%', count(*)::text
  from notifications where recipient_id = 'e8000000-0000-4000-8000-0000000000b1' and kind = 'meetup_hidden'
   and event_id = (select id from t_ids where name = 'hop');
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b4","role":"authenticated"}', true);
insert into t_results select 'the report stays open for the start''s admin',
  exists (select 1 from moderation_queue() q where q.id = (select id from t_ids where name = 'hop')), '';
select moderate_reports('meetup', (select id from t_ids where name = 'hop'), 'dismiss');
insert into t_results select 'the start''s admin decides as before',
  not exists (select 1 from reports where event_id = (select id from t_ids where name = 'hop') and status = 'open'), '';

select set_config('request.jwt.claims', '{"sub":"e8000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
select hide_meetup((select id from t_ids where name = 'hop'), false, (select id from t_ids where name = 'park_C'));
insert into t_results select 'the stop''s admin can show it again',
  exists (select 1 from park_meetups((select id from t_ids where name = 'park_C'), 50) m where m.id = (select id from t_ids where name = 'hop')), '';
reset role;
insert into t_results select 'and the hosts'' bell row goes', count(*) = 0, count(*)::text
  from notifications where recipient_id = 'e8000000-0000-4000-8000-0000000000b1' and kind = 'meetup_hidden'
   and event_id = (select id from t_ids where name = 'hop');

/* Grants -------------------------------------------------------------------------------- */

insert into t_results select 'one create_meetup and one hide_meetup, callable by members',
  (select count(*) from pg_proc where proname = 'create_meetup' and pronamespace = 'public'::regnamespace) = 1
  and (select count(*) from pg_proc where proname = 'hide_meetup' and pronamespace = 'public'::regnamespace) = 1
  and has_function_privilege('authenticated', 'public.hide_meetup(uuid, boolean, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.hide_meetup(uuid, boolean, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.set_event_parks(uuid, uuid[])', 'execute'), '';
insert into t_results select 'members can''t write stops directly',
  not has_table_privilege('authenticated', 'public.event_parks', 'insert')
  and not has_table_privilege('authenticated', 'public.event_series_parks', 'insert'), '';

do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
