-- Rolled-back check for 20261102005646_posting_feeds.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true. Passed in full on Nov 1, before the migration was applied.
-- It won't run again as is now that the migration is in (the triggers already exist).
begin;
-- M4a: the full posting flow and feeds (Nov 1).
--
-- What this adds:
-- 1. A post's metro area follows its park. On insert and whenever the park
--    changes, metro_area_id is taken from the park, or from the author's home
--    metro area when there's no park. Members can't set it to anything else.
-- 2. When a post's park changes (or is removed), slide obstacle tags that
--    belong to another park are cleared, so a tag never points at the wrong
--    park. General obstacle types stay.
-- 3. Slide tag checks: a tagged obstacle must be at the post's park and be
--    active (or a pending one the author suggested, so "suggest it" works
--    without leaving the post flow); street plaza placeholders can't be
--    tagged; filmers can't be someone blocked either way or a deleted account.
-- 4. set_slide_tags(): one call sets a slide's obstacle (or general type),
--    filmer and people tags, for posting and for editing after publishing.
--    Editing tags on a published post stamps edited_at.
-- 5. remove_my_filmer_credit(): a filmer takes their own credit off a slide,
--    the same way a tagged person can already remove their own tag.
-- 6. Feeds, all security invoker so the posts read rules (private accounts,
--    blocks, hidden posts) still apply, and all returning posts rows so the
--    app can embed slides and authors with PostgREST:
--      feed_following()  people you follow (and you), newest first
--      feed_nearby()     your home metro area (or another), minus you and
--                        people you follow
--      obstacle_posts()  posts with a slide tagged to an obstacle (or one
--                        merged into it)
--      tagged_posts()    posts with a slide tagging a member
--      filmed_posts()    posts with a slide filmed by a member
--    Paging is keyset on (published_at, id), newest first.
-- 7. park_regulars_list(): a park's regulars for the park page, most
--    recently active first, without blocked people.
--
-- Additive: new functions, triggers and an index. No existing rule, trigger
-- or function is replaced or dropped.

/* 1. Metro area follows the park ------------------------------------------- */

create or replace function private.set_post_metro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  park_metro uuid;
  home_metro uuid;
begin
  if tg_op = 'INSERT' or new.park_id is distinct from old.park_id then
    if new.park_id is not null then
      select metro_area_id into park_metro from parks where id = new.park_id;
      if park_metro is null then
        raise exception 'Unknown park';
      end if;
      new.metro_area_id := park_metro;
    else
      select home_metro_area_id into home_metro from profiles where id = new.author_id;
      new.metro_area_id := coalesce(home_metro, new.metro_area_id,
                                    case when tg_op = 'UPDATE' then old.metro_area_id end);
    end if;
  elsif new.metro_area_id is distinct from old.metro_area_id
        and not private.can_moderate_post(old.id) then
    raise exception 'A post''s metro area comes from its park';
  end if;
  return new;
end $$;

create trigger posts_set_metro
  before insert or update of park_id, metro_area_id on public.posts
  for each row execute function private.set_post_metro();

/* 2. Park change clears obstacle tags from other parks --------------------- */

create or replace function private.clear_stale_obstacle_tags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update post_slides s
     set obstacle_id = null
    from obstacles o
   where s.post_id = new.id
     and o.id = s.obstacle_id
     and o.park_id is distinct from new.park_id;
  return null;
end $$;

create trigger posts_clear_stale_obstacle_tags
  after update of park_id on public.posts
  for each row
  when (old.park_id is distinct from new.park_id)
  execute function private.clear_stale_obstacle_tags();

/* 3. Slide tag checks ------------------------------------------------------- */

create or replace function private.guard_slide_tags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row posts%rowtype;
  obs obstacles%rowtype;
  viewer uuid := auth.uid();
begin
  -- Server-side writes (the upload service, the park-change cleanup above)
  -- aren't member edits.
  if viewer is null then
    return new;
  end if;

  select * into post_row from posts where id = new.post_id;

  if new.obstacle_id is not null
     and (tg_op = 'INSERT' or new.obstacle_id is distinct from old.obstacle_id) then
    select * into obs from obstacles where id = new.obstacle_id;
    if obs.id is null or obs.park_id is distinct from post_row.park_id then
      raise exception 'That obstacle isn''t at this post''s park';
    end if;
    if not (obs.status = 'active'
            or (obs.status = 'pending' and obs.suggested_by = post_row.author_id)) then
      raise exception 'That obstacle can''t be tagged';
    end if;
    if obs.general_type = 'street_plaza' then
      raise exception 'Street plaza areas can''t be tagged';
    end if;
  end if;

  if new.obstacle_type = 'street_plaza'
     and (tg_op = 'INSERT' or new.obstacle_type is distinct from old.obstacle_type) then
    raise exception 'Street plaza areas can''t be tagged';
  end if;

  if new.filmer_id is not null
     and (tg_op = 'INSERT' or new.filmer_id is distinct from old.filmer_id) then
    if private.blocked_between(new.filmer_id) then
      raise exception 'You can''t credit that person';
    end if;
    if not exists (select 1 from profiles
                   where id = new.filmer_id and deleted_at is null and onboarded_at is not null) then
      raise exception 'You can''t credit that person';
    end if;
  end if;

  return new;
end $$;

create trigger post_slides_guard_tags
  before insert or update of obstacle_id, obstacle_type, filmer_id on public.post_slides
  for each row execute function private.guard_slide_tags();

/* 4. set_slide_tags() -------------------------------------------------------- */

create or replace function public.set_slide_tags(
  slide uuid,
  obstacle uuid default null,
  obstacle_kind public.obstacle_type default null,
  filmer uuid default null,
  people uuid[] default '{}'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  wanted uuid[] := array(select distinct u from unnest(coalesce(people, '{}')) as u where u is not null);
  the_post uuid;
begin
  if cardinality(wanted) > 20 then
    raise exception 'Up to 20 people per slide';
  end if;

  -- The "author manages slides" rule limits this to the author's own slides.
  update post_slides
     set obstacle_id = obstacle,
         obstacle_type = case when obstacle is null then obstacle_kind end,
         filmer_id = filmer
   where id = slide
  returning post_id into the_post;
  if the_post is null then
    raise exception 'Slide not found';
  end if;

  delete from slide_people_tags
   where slide_id = slide and not (user_id = any (wanted));

  insert into slide_people_tags (slide_id, user_id, tagged_by)
  select slide, u, auth.uid() from unnest(wanted) as u
  on conflict (slide_id, user_id) do nothing;

  update posts set edited_at = now()
   where id = the_post and published_at is not null;
end $$;

/* 5. remove_my_filmer_credit() ---------------------------------------------- */

create or replace function public.remove_my_filmer_credit(slide uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update post_slides set filmer_id = null
   where id = slide and filmer_id = auth.uid();
$$;

/* 6. Feeds -------------------------------------------------------------------- */

-- Following feed: published, visible posts by people you follow, and your own.
create or replace function public.feed_following(
  before_at timestamptz default null,
  before_id uuid default null,
  max_results integer default 20
)
returns setof public.posts
language sql stable
security invoker
set search_path = public
as $$
  select p.*
    from posts p
   where p.published_at is not null
     and p.status = 'visible'
     and (p.author_id = (select auth.uid())
          or p.author_id in (select followee_id from follows
                              where follower_id = (select auth.uid()) and status = 'accepted'))
     and (before_at is null
          or (p.published_at, p.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- Near you: a metro area's posts (yours by default), minus your own and
-- people you follow (they're in the following feed already).
create or replace function public.feed_nearby(
  metro uuid default null,
  before_at timestamptz default null,
  before_id uuid default null,
  max_results integer default 20
)
returns setof public.posts
language sql stable
security invoker
set search_path = public
as $$
  select p.*
    from posts p
   where p.published_at is not null
     and p.status = 'visible'
     and p.metro_area_id = coalesce(metro, (select home_metro_area_id from profiles where id = (select auth.uid())))
     and p.author_id <> (select auth.uid())
     and p.author_id not in (select followee_id from follows
                              where follower_id = (select auth.uid()) and status = 'accepted')
     and (before_at is null
          or (p.published_at, p.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- An obstacle's feed: posts with any slide tagged to it, or to an obstacle
-- merged into it, so merging never empties a feed.
create or replace function public.obstacle_posts(
  obstacle uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  max_results integer default 30
)
returns setof public.posts
language sql stable
security invoker
set search_path = public
as $$
  select p.*
    from posts p
   where p.published_at is not null
     and p.status = 'visible'
     and exists (
       select 1 from post_slides s
        where s.post_id = p.id
          and (s.obstacle_id = obstacle
               or s.obstacle_id in (select id from obstacles where merged_into = obstacle))
     )
     and (before_at is null
          or (p.published_at, p.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(max_results, 30), 1), 50);
$$;

-- A member's Tagged tab.
create or replace function public.tagged_posts(
  person uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  max_results integer default 30
)
returns setof public.posts
language sql stable
security invoker
set search_path = public
as $$
  select p.*
    from posts p
   where p.published_at is not null
     and p.status = 'visible'
     and exists (
       select 1 from post_slides s
         join slide_people_tags t on t.slide_id = s.id
        where s.post_id = p.id and t.user_id = person
     )
     and (before_at is null
          or (p.published_at, p.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(max_results, 30), 1), 50);
$$;

-- A member's Filmed tab.
create or replace function public.filmed_posts(
  person uuid,
  before_at timestamptz default null,
  before_id uuid default null,
  max_results integer default 30
)
returns setof public.posts
language sql stable
security invoker
set search_path = public
as $$
  select p.*
    from posts p
   where p.published_at is not null
     and p.status = 'visible'
     and exists (select 1 from post_slides s where s.post_id = p.id and s.filmer_id = person)
     and (before_at is null
          or (p.published_at, p.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(max_results, 30), 1), 50);
$$;

create index if not exists posts_published_author_idx
  on public.posts (author_id, published_at desc)
  where status = 'visible' and published_at is not null;

/* 7. Regulars ------------------------------------------------------------------ */

-- park_regulars (the view) already applies the rules: more than 5 posts
-- there or home park, and never private, hidden, deleted or banned members.
-- This adds what the park page needs and drops anyone blocked either way.
create or replace function public.park_regulars_list(park uuid, max_results integer default 30)
returns table (
  id uuid,
  username text,
  avatar_path text,
  disciplines public.discipline[],
  last_active_at timestamptz
)
language sql stable
security definer
set search_path = public
as $$
  select pr.id, pr.username, pr.avatar_path, pr.disciplines, pr.last_active_at
    from park_regulars r
    join profiles pr on pr.id = r.user_id
   where r.park_id = park
     and pr.username is not null
     and pr.onboarded_at is not null
     and not private.blocked_between(pr.id)
   order by pr.last_active_at desc nulls last
   limit least(greatest(coalesce(max_results, 30), 1), 100);
$$;

/* Grants ------------------------------------------------------------------------ */

revoke all on function public.set_slide_tags(uuid, uuid, public.obstacle_type, uuid, uuid[]) from public, anon;
revoke all on function public.remove_my_filmer_credit(uuid) from public, anon;
revoke all on function public.feed_following(timestamptz, uuid, integer) from public, anon;
revoke all on function public.feed_nearby(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.obstacle_posts(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.tagged_posts(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.filmed_posts(uuid, timestamptz, uuid, integer) from public, anon;
revoke all on function public.park_regulars_list(uuid, integer) from public, anon;

grant execute on function public.set_slide_tags(uuid, uuid, public.obstacle_type, uuid, uuid[]) to authenticated;
grant execute on function public.remove_my_filmer_credit(uuid) to authenticated;
grant execute on function public.feed_following(timestamptz, uuid, integer) to authenticated;
grant execute on function public.feed_nearby(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.obstacle_posts(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.tagged_posts(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.filmed_posts(uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.park_regulars_list(uuid, integer) to authenticated;

create temp table t_results(step text, ok boolean, detail text);
grant all on t_results to authenticated;
insert into auth.users (id, email, aud, role, instance_id) values ('b0000000-0000-4000-8000-000000000001','testb@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at) values ('b0000000-0000-4000-8000-000000000001','testb_m4a', now(), '93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', '{inline}', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08b422ac-9f87-4c0f-b979-29ecdd41ed5b","role":"authenticated"}', true);
insert into posts (id, author_id, metro_area_id, park_id, slide_count) values ('a0000000-0000-4000-8000-0000000000a1','08b422ac-9f87-4c0f-b979-29ecdd41ed5b','f11b68be-b1c5-4931-8ec6-6ca0b79d9642','2b722ed9-f690-4ff5-9320-21d3e64fc126',2);
insert into t_results select 'metro taken from park', metro_area_id='93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', metro_area_id::text from posts where id='a0000000-0000-4000-8000-0000000000a1';
insert into post_slides (id, post_id, position, kind, storage_path, width, height, upload_status) values
 ('c0000000-0000-4000-8000-0000000000c1','a0000000-0000-4000-8000-0000000000a1',0,'photo','08b422ac-9f87-4c0f-b979-29ecdd41ed5b/a0000000-0000-4000-8000-0000000000a1/c0000000-0000-4000-8000-0000000000c1.jpg',1000,800,'uploading'),
 ('c0000000-0000-4000-8000-0000000000c2','a0000000-0000-4000-8000-0000000000a1',1,'photo','08b422ac-9f87-4c0f-b979-29ecdd41ed5b/a0000000-0000-4000-8000-0000000000a1/c0000000-0000-4000-8000-0000000000c2.jpg',1000,800,'uploading');
select set_slide_tags('c0000000-0000-4000-8000-0000000000c1','6d0d165d-8bac-4c89-9f16-bfa7be530a72',null,'b0000000-0000-4000-8000-000000000001',array['b0000000-0000-4000-8000-000000000001'::uuid]);
insert into t_results select 'tags set', s.obstacle_id is not null and s.filmer_id is not null and (select count(*) from slide_people_tags where slide_id=s.id)=1, coalesce(s.obstacle_id::text,'') from post_slides s where id='c0000000-0000-4000-8000-0000000000c1';
do $$ begin perform set_slide_tags('c0000000-0000-4000-8000-0000000000c2','251482d1-be1f-4a11-9eda-6a9041766ba0'); insert into t_results values('other park obstacle refused',false,'no error'); exception when others then insert into t_results values('other park obstacle refused',true,sqlerrm); end $$;
do $$ begin perform set_slide_tags('c0000000-0000-4000-8000-0000000000c2',null,'street_plaza'); insert into t_results values('street plaza type refused',false,'no error'); exception when others then insert into t_results values('street plaza type refused',true,sqlerrm); end $$;
insert into obstacles (id, park_id, name, general_type, status, suggested_by) values ('d0000000-0000-4000-8000-0000000000d1','2b722ed9-f690-4ff5-9320-21d3e64fc126','Test rail','rail','pending','08b422ac-9f87-4c0f-b979-29ecdd41ed5b');
do $$ begin perform set_slide_tags('c0000000-0000-4000-8000-0000000000c2','d0000000-0000-4000-8000-0000000000d1'); insert into t_results values('own pending suggestion taggable',true,''); exception when others then insert into t_results values('own pending suggestion taggable',false,sqlerrm); end $$;
do $$ begin perform set_slide_tags('c0000000-0000-4000-8000-0000000000c2',null,'rail'); insert into t_results values('general type only',true,''); exception when others then insert into t_results values('general type only',false,sqlerrm); end $$;
-- (The direct metro change check runs as member B below: the test owner can moderate every post.)
update posts set park_id='fc96a6fb-c726-4012-90c4-5a04a6136fc7' where id='a0000000-0000-4000-8000-0000000000a1';
insert into t_results select 'park change clears obstacle and moves metro', p.metro_area_id='f11b68be-b1c5-4931-8ec6-6ca0b79d9642' and s.obstacle_id is null, coalesce(s.obstacle_id::text,'null')||' '||p.metro_area_id from posts p join post_slides s on s.post_id=p.id and s.position=0 where p.id='a0000000-0000-4000-8000-0000000000a1';
insert into t_results select 'general type kept', obstacle_type='rail', coalesce(obstacle_type::text,'null') from post_slides where id='c0000000-0000-4000-8000-0000000000c2';

reset role;
select set_config('request.jwt.claims', '', true);
update post_slides set obstacle_id='251482d1-be1f-4a11-9eda-6a9041766ba0' where id='c0000000-0000-4000-8000-0000000000c1';
-- Publish the proper way: mark the slides uploaded and let publish_when_ready() do it.
update post_slides set upload_status='ready' where post_id='a0000000-0000-4000-8000-0000000000a1';
insert into t_results select 'post publishes when slides are ready', published_at is not null, coalesce(published_at::text,'null') from posts where id='a0000000-0000-4000-8000-0000000000a1';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08b422ac-9f87-4c0f-b979-29ecdd41ed5b","role":"authenticated"}', true);
select set_slide_tags('c0000000-0000-4000-8000-0000000000c2',null,'ledge');
insert into t_results select 'tag edit after publish stamps edited_at', edited_at is not null, coalesce(edited_at::text,'null') from posts where id='a0000000-0000-4000-8000-0000000000a1';
insert into t_results select 'own posts in following feed', count(*)=1, count(*)::text from feed_following();

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into posts (id, author_id, metro_area_id, slide_count) values ('a0000000-0000-4000-8000-0000000000b1','b0000000-0000-4000-8000-000000000001','f11b68be-b1c5-4931-8ec6-6ca0b79d9642',1);
insert into t_results select 'no park: home metro used', metro_area_id='93cd132b-dd8b-4bbb-a2ea-9ddf6bab7925', metro_area_id::text from posts where id='a0000000-0000-4000-8000-0000000000b1';
do $$ begin update posts set metro_area_id='f11b68be-b1c5-4931-8ec6-6ca0b79d9642' where id='a0000000-0000-4000-8000-0000000000b1'; insert into t_results values('member metro change refused',false,'no error'); exception when others then insert into t_results values('member metro change refused',true,sqlerrm); end $$;
insert into t_results select 'following feed empty before follow', count(*)=0, count(*)::text from feed_following();
insert into t_results select 'nearby other metro shows unfollowed post', count(*)=1, count(*)::text from feed_nearby('f11b68be-b1c5-4931-8ec6-6ca0b79d9642');
insert into follows (follower_id, followee_id) values ('b0000000-0000-4000-8000-000000000001','08b422ac-9f87-4c0f-b979-29ecdd41ed5b');
insert into t_results select 'following feed after follow', count(*)=1, count(*)::text from feed_following();
insert into t_results select 'nearby excludes followed', count(*)=0, count(*)::text from feed_nearby('f11b68be-b1c5-4931-8ec6-6ca0b79d9642');
insert into t_results select 'tagged tab', count(*)=1, count(*)::text from tagged_posts('b0000000-0000-4000-8000-000000000001');
insert into t_results select 'filmed tab', count(*)=1, count(*)::text from filmed_posts('b0000000-0000-4000-8000-000000000001');
insert into t_results select 'obstacle feed', count(*)=1, count(*)::text from obstacle_posts('251482d1-be1f-4a11-9eda-6a9041766ba0');
insert into t_results select 'paging past last post', count(*)=0, count(*)::text from feed_following((select published_at from posts where id='a0000000-0000-4000-8000-0000000000a1'),'a0000000-0000-4000-8000-0000000000a1');
do $$ begin perform set_slide_tags('c0000000-0000-4000-8000-0000000000c1',null,null,null,'{}'); insert into t_results values('others cannot retag',false,'no error'); exception when others then insert into t_results values('others cannot retag',true,sqlerrm); end $$;
select remove_my_filmer_credit('c0000000-0000-4000-8000-0000000000c1');
insert into t_results select 'filmer removes own credit', filmer_id is null, coalesce(filmer_id::text,'null') from post_slides where id='c0000000-0000-4000-8000-0000000000c1';
delete from slide_people_tags where slide_id='c0000000-0000-4000-8000-0000000000c1' and user_id='b0000000-0000-4000-8000-000000000001';
insert into t_results select 'tagged person removes own tag', count(*)=0, count(*)::text from tagged_posts('b0000000-0000-4000-8000-000000000001');
insert into t_results select 'regulars list', count(*)>=1, string_agg(username,',') from park_regulars_list('ff7f5301-1a48-497f-8049-a64b51fd92ec');

select set_config('request.jwt.claims', '{"sub":"08b422ac-9f87-4c0f-b979-29ecdd41ed5b","role":"authenticated"}', true);
insert into blocks (blocker_id, blocked_id) values ('08b422ac-9f87-4c0f-b979-29ecdd41ed5b','b0000000-0000-4000-8000-000000000001');
do $$ begin perform set_slide_tags('c0000000-0000-4000-8000-0000000000c2',null,null,'b0000000-0000-4000-8000-000000000001'); insert into t_results values('blocked filmer refused',false,'no error'); exception when others then insert into t_results values('blocked filmer refused',true,sqlerrm); end $$;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into t_results select 'regulars hide blocked', count(*)=0, count(*)::text from park_regulars_list('ff7f5301-1a48-497f-8049-a64b51fd92ec') where username='grindylocks';

reset role;
do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
