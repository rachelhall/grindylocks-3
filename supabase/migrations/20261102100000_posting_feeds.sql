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
