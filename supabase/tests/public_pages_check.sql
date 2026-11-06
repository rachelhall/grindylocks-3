-- Rolled-back check for 20261106220000_public_pages.sql. Paste the migration
-- where marked, then run: everything happens in one transaction that ends by
-- raising RESULTS [...], so nothing is kept. Every row should have ok = true.
begin;

-- <the migration goes here>

/* Checks ------------------------------------------------------------------------------- */

create temp table t_results(step text, ok boolean, detail text);
grant all on t_results to anon, authenticated;

/* Slugs ------------------------------------------------------------------------------------ */

insert into t_results select 'every metro area has a slug, all different',
  count(*) = count(distinct slug) and bool_and(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'), string_agg(slug, ', ' order by slug)
  from metro_areas;
insert into t_results select 'San Diego and Los Angeles slugs',
  exists (select 1 from metro_areas where name = 'San Diego' and slug = 'san-diego')
  and exists (select 1 from metro_areas where name = 'Los Angeles' and slug = 'los-angeles'), '';

-- A new metro area gets its slug from its name, accents folded.
insert into metro_areas (name, region, country, timezone) values ('Málaga', 'Andalucía', 'ES', 'Europe/Madrid');
insert into t_results select 'a new metro area gets a slug from its name', slug = 'malaga', slug
  from metro_areas where name = 'Málaga';
insert into t_results select 'Danish letters fold too', private.slugify('Fælledparken Øst Å') = 'faelledparken-ost-a',
  private.slugify('Fælledparken Øst Å');

/* Posts for the count ------------------------------------------------------------------------ */

insert into auth.users (id, email, aud, role, instance_id) values
 ('e8000000-0000-4000-8000-0000000000d1','pp-public@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e8000000-0000-4000-8000-0000000000d2','pp-private@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private)
select u.id, u.name, now(), (select id from metro_areas where name = 'San Diego'), '{inline}', now(), u.priv
  from (values ('e8000000-0000-4000-8000-0000000000d1'::uuid, 'pp_public', false),
               ('e8000000-0000-4000-8000-0000000000d2'::uuid, 'pp_private', true)) u(id, name, priv);

create temp table t_park as select id, metro_area_id from parks where slug = 'alga-norte-cb';
insert into t_results select 'Alga Norte starts with no posts', private.public_post_count((select id from t_park)) = 0,
  private.public_post_count((select id from t_park))::text;

insert into posts (author_id, park_id, metro_area_id, status, published_at)
select 'e8000000-0000-4000-8000-0000000000d1', id, metro_area_id, 'visible', now() from t_park
union all
select 'e8000000-0000-4000-8000-0000000000d2', id, metro_area_id, 'visible', now() from t_park
union all
select 'e8000000-0000-4000-8000-0000000000d1', id, metro_area_id, 'visible', null from t_park
union all
select 'e8000000-0000-4000-8000-0000000000d1', id, metro_area_id, 'hidden', now() from t_park;

/* As a signed-out visitor --------------------------------------------------------------------- */

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

insert into t_results select 'the count leaves out private, unpublished and hidden posts',
  (public_park('alga-norte-cb')->>'post_count')::int = 1, public_park('alga-norte-cb')->>'post_count';

insert into t_results select 'public_metro_areas: metro areas with parks, San Diego first',
  count(*) = 11 and (array_agg(slug order by park_count desc, name))[1] = 'san-diego'
  and not bool_or(slug = 'malaga'), count(*)::text
  from public_metro_areas();

insert into t_results select 'public_metro: San Diego and its 23 parks',
  public_metro('san-diego')->>'name' = 'San Diego'
  and jsonb_array_length(public_metro('san-diego')->'parks') = 23
  and public_metro('san-diego')->>'timezone' = 'America/Los_Angeles',
  jsonb_array_length(public_metro('san-diego')->'parks')::text;
insert into t_results select 'public_metro: a park row has its obstacle count and pin',
  (select (e->>'obstacle_count')::int = 9 and e ? 'latitude' and e ? 'longitude'
     from jsonb_array_elements(public_metro('san-diego')->'parks') e where e->>'slug' = 'city-heights-sd'), '';
insert into t_results select 'public_metro: unknown slug and a metro area with no parks give null',
  public_metro('nowhere') is null and public_metro('malaga') is null, '';

insert into t_results select 'public_park: City Heights facts, metro and obstacles',
  public_park('city-heights-sd')->>'display_name' = 'City Heights'
  and public_park('city-heights-sd')->'metro'->>'slug' = 'san-diego'
  and jsonb_array_length(public_park('city-heights-sd')->'obstacles') = 9
  and jsonb_array_length(public_park('city-heights-sd')->'descriptions') >= 1
  and jsonb_array_length(public_park('city-heights-sd')->'photos') = 0
  and public_park('city-heights-sd') ? 'updated_at', '';
insert into t_results select 'public_park: hours come without their notes',
  jsonb_array_length(public_park('two-rivers-nash')->'sessions') >= 1
  and not exists (select 1 from jsonb_array_elements(public_park('two-rivers-nash')->'sessions') s where s ? 'note'), '';
insert into t_results select 'public_park: nothing people-shaped',
  not (public_park('city-heights-sd')::text ~* '(username|author|regular|uploaded_by|meetup|check_in)'), '';
insert into t_results select 'public_park: street plaza placeholders come last',
  (select bool_and(ord > (select max(o2.ord) from jsonb_array_elements(public_park('two-rivers-nash')->'obstacles') with ordinality o2(e, ord)
                          where o2.e->>'general_type' <> 'street_plaza'))
     from jsonb_array_elements(public_park('two-rivers-nash')->'obstacles') with ordinality o(e, ord)
     where o.e->>'general_type' = 'street_plaza'), '';
insert into t_results select 'public_park: unknown slug gives null', public_park('nowhere') is null, '';

insert into t_results select 'public_sitemap: 11 metro areas and every park',
  count(*) filter (where kind = 'metro') = 11
  and count(*) filter (where kind = 'park') = 54
  and bool_and(updated_at is not null),
  count(*) filter (where kind = 'metro') || ' metro, ' || count(*) filter (where kind = 'park') || ' parks'
  from public_sitemap();

-- The tables themselves stay closed.
do $$ declare n int; begin
  select count(*) into n from parks;
  insert into t_results values ('signed out, the parks table stays closed', n = 0, n::text);
exception when insufficient_privilege then insert into t_results values ('signed out, the parks table stays closed', true, sqlerrm); end $$;
do $$ declare n int; begin
  select count(*) into n from posts;
  insert into t_results values ('signed out, the posts table stays closed', n = 0, n::text);
exception when insufficient_privilege then insert into t_results values ('signed out, the posts table stays closed', true, sqlerrm); end $$;
do $$ begin
  perform private.public_post_count((select id from parks limit 1));
  insert into t_results values ('signed out, the private helpers can''t be called', false, 'went through');
exception when others then insert into t_results values ('signed out, the private helpers can''t be called', true, sqlerrm); end $$;

reset role;

/* Grants and the bucket ------------------------------------------------------------------------ */

insert into t_results select 'the four functions: anon and members can call them, nobody else',
  bool_and(has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'))
  and bool_and(p.prosecdef) and count(*) = 4, count(*)::text
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('public_metro_areas', 'public_metro', 'public_park', 'public_sitemap');
insert into t_results select 'park-media is public; member content stays private',
  (select public from storage.buckets where id = 'park-media')
  and not exists (select 1 from storage.buckets where id in ('post-media', 'avatars', 'meetup-covers') and public), '';

do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
