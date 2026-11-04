-- Rolled-back check for 20261104230000_posting_as_page. Runs the migration and the checks in one
-- transaction, then raises CHECK <ok> of <total>: <failures>, so nothing is kept. Member checks run
-- as throwaway members made in the transaction.
begin;

-- Brand and shop accounts part A, PR 8a: posting as a page.
--
-- A page post's public author is the page: posts.page_id is set and
-- posts.author_id is null. The member who made it is kept in
-- private.page_post_makers, which only the database reads (the team sees
-- "by [member]" through page_post_bylines()). So nobody outside the team can
-- learn from the data which member posted, and everything keyed on
-- author_id (a member's profile grid, their followers' Home, regulars,
-- deleting their account) leaves page posts alone without special cases.
--
-- Who can post as a page: staff, managers and owners of a managed page with
-- a logo that isn't suspended, frozen (disputed) or closed, while they're in
-- good standing (private.can_post_as_page).
--
-- Near you: posts.near_you is decided when the post publishes. A managed
-- shop gets one Near you post a day and five a week (Monday to Sunday), on
-- its own clock; deleted posts still count. Over the cap, the post still
-- reaches followers. Brand posts reach followers only.
--
-- Not in 8a (PR 8b): commenting as a page, comments on page posts in the
-- page's inbox, report routing for page posts, and the Page blocks detail.
-- Until then comments on a page post notify nobody, and page posts don't
-- record page mentions in their captions (the inbox learns page authors in 8b).
--
-- Where a function below is patched rather than rewritten (file_report,
-- my_notifications), the patch replaces one exact passage of the live
-- definition and fails if that passage isn't there exactly once.

/* 1. Columns ---------------------------------------------------------------------------- */

alter table public.posts add column if not exists page_id uuid references public.pages (id) on delete cascade;
alter table public.posts add column if not exists near_you boolean not null default false;
alter table public.posts alter column author_id drop not null;
alter table public.posts alter column metro_area_id drop not null;

alter table public.posts drop constraint if exists posts_author_or_page;
alter table public.posts add constraint posts_author_or_page check ((author_id is null) = (page_id is not null));
-- A brand post with no park has no metro; everyone else's post has one.
alter table public.posts drop constraint if exists posts_metro_unless_page;
alter table public.posts add constraint posts_metro_unless_page check (metro_area_id is not null or page_id is not null);
alter table public.posts drop constraint if exists posts_near_you_pages_only;
alter table public.posts add constraint posts_near_you_pages_only check (not near_you or page_id is not null);

create index if not exists posts_page_idx on public.posts (page_id, published_at desc, id desc)
  where page_id is not null;
create index if not exists posts_near_you_idx on public.posts (published_at desc, id desc)
  where near_you;

create table if not exists private.page_post_makers (
  post_id uuid primary key references public.posts (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  member_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists page_post_makers_member_idx on private.page_post_makers (member_id);
revoke all on private.page_post_makers from public, anon, authenticated;

/* 2. Helpers ---------------------------------------------------------------------------- */

-- Whether the caller can post as this page.
create or replace function private.can_post_as_page(page uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_act_as_page(page, 'staff')
     and exists (select 1 from public.pages p
                  where p.id = page and p.logo_path is not null and p.closed_at is null);
$$;

-- Whether someone made this post: its author, or the member who posted it
-- as a page while they're still on that page's team.
create or replace function private.made_post(post uuid, who uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
     where p.id = post
       and (p.author_id = who
            or (p.page_id is not null
                and exists (select 1 from private.page_post_makers k where k.post_id = p.id and k.member_id = who)
                and private.page_role_of(p.page_id, who) is not null))
  );
$$;

-- Page posts are hidden only from someone who blocked the page. A page
-- blocking a skater stops their comments and follows, not their reading.
create or replace function private.can_see_page_posts(page uuid, viewer uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (select 1 from public.user_page_blocks b where b.user_id = viewer and b.page_id = page);
$$;

-- The page posts the caller made (for their own Home).
create or replace function private.page_posts_i_made()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select k.post_id from private.page_post_makers k where k.member_id = (select auth.uid());
$$;

-- For the stream-upload function and the app: whether the caller made this post.
create or replace function public.i_made_post(post uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.made_post(post);
$$;

revoke all on function private.can_post_as_page(uuid) from public, anon, authenticated;
revoke all on function private.made_post(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_see_page_posts(uuid, uuid) from public, anon, authenticated;
revoke all on function private.page_posts_i_made() from public, anon, authenticated;
revoke all on function public.i_made_post(uuid) from public, anon;
grant execute on function private.can_post_as_page(uuid) to authenticated;
grant execute on function private.made_post(uuid, uuid) to authenticated;
grant execute on function private.can_see_page_posts(uuid, uuid) to authenticated;
grant execute on function private.page_posts_i_made() to authenticated;
grant execute on function public.i_made_post(uuid) to authenticated;

/* 3. Seeing posts ------------------------------------------------------------------------ */

create or replace function private.can_see_post(post uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from posts p where p.id = post and (
      p.author_id = auth.uid()
      or (p.status = 'visible' and p.author_id is not null and private.can_see_content_of(p.author_id))
      or (p.status = 'visible' and p.page_id is not null and private.can_see_page_posts(p.page_id))
      or (p.page_id is not null and private.page_role_of(p.page_id) is not null)
      or private.can_moderate_post(p.id)
    )
  );
$$;

create or replace function private.can_see_post_as(post uuid, viewer uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from posts p
      left join profiles a on a.id = p.author_id
     where p.id = post
       and p.published_at is not null
       and p.status = 'visible'
       and (
         (p.page_id is not null and private.can_see_page_posts(p.page_id, viewer))
         or (p.author_id is not null and (
           p.author_id = viewer
           or (
             not exists (
               select 1 from blocks b
                where (b.blocker_id = viewer and b.blocked_id = p.author_id)
                   or (b.blocker_id = p.author_id and b.blocked_id = viewer)
             )
             and (
               not a.is_private
               or exists (
                 select 1 from follows f
                  where f.follower_id = viewer and f.followee_id = p.author_id and f.status = 'accepted'
               )
             )
           )
         ))
       )
  );
$$;

drop policy if exists "read posts" on public.posts;
create policy "read posts" on public.posts for select to authenticated
  using (
    author_id = (select auth.uid())
    or (status = 'visible' and author_id is not null and private.can_see_content_of(author_id))
    or (status = 'visible' and page_id is not null and private.can_see_page_posts(page_id))
    or (page_id is not null and private.page_role_of(page_id) is not null)
    or private.can_moderate_post(id)
  );

drop policy if exists "unpublished posts are private" on public.posts;
create policy "unpublished posts are private" on public.posts as restrictive for select to authenticated
  using (
    published_at is not null
    or author_id = (select auth.uid())
    or (page_id is not null and private.made_post(id))
    or private.can_moderate_post(id)
  );

/* 4. Writing posts ------------------------------------------------------------------------ */

drop policy if exists "publish posts as a page" on public.posts;
create policy "publish posts as a page" on public.posts for insert to authenticated
  with check (author_id is null and page_id is not null and status = 'visible' and private.can_post_as_page(page_id));

drop policy if exists "posts start off near you" on public.posts;
create policy "posts start off near you" on public.posts as restrictive for insert to authenticated
  with check (not near_you);

drop policy if exists "edit own posts or moderate" on public.posts;
create policy "edit own posts or moderate" on public.posts for update to authenticated
  using (
    author_id = (select auth.uid())
    or (page_id is not null and (private.made_post(id) or private.can_act_as_page(page_id, 'manager')))
    or private.can_moderate_post(id)
  )
  with check (
    author_id = (select auth.uid())
    or (page_id is not null and (private.made_post(id) or private.can_act_as_page(page_id, 'manager')))
    or private.can_moderate_post(id)
  );

-- Record who made a page post.
create or replace function private.record_page_post_maker()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.page_id is not null then
    if auth.uid() is null then
      raise exception 'A page post needs the member who made it';
    end if;
    insert into private.page_post_makers (post_id, page_id, member_id)
    values (new.id, new.page_id, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists posts_record_page_maker on public.posts;
create trigger posts_record_page_maker after insert on public.posts
  for each row execute function private.record_page_post_maker();

-- Who may change what. A page post is edited by the member who made it
-- (while they can still act for the page) and removed by them or by any
-- manager or owner of the page.
create or replace function private.guard_post_fields()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  is_page boolean := old.page_id is not null;
  is_author boolean := case when old.page_id is not null
                            then private.made_post(old.id) and private.can_act_as_page(old.page_id, 'staff')
                            else old.author_id = auth.uid() end;
  can_remove boolean := is_author
                        or (old.page_id is not null
                            and (private.made_post(old.id) or private.can_act_as_page(old.page_id, 'manager')));
  is_mod boolean := private.can_moderate_post(old.id);
  auto_hiding boolean := coalesce(current_setting('grindylocks.auto_hiding', true), '') = 'on'
                         and old.status = 'visible' and new.status = 'auto_hidden';
begin
  if new.author_id is distinct from old.author_id or new.page_id is distinct from old.page_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A post''s author and date can''t change';
  end if;
  -- Decided when the post goes up (posts_set_near_you), never by an update.
  if new.near_you is distinct from old.near_you then
    raise exception 'Near you is decided when a post goes up';
  end if;
  if new.status is distinct from old.status then
    if not (is_mod or auto_hiding or (can_remove and new.status = 'deleted')) then
      raise exception 'Only moderators can hide or restore a post';
    end if;
  end if;
  if not is_author and (new.caption is distinct from old.caption or new.park_id is distinct from old.park_id
                        or new.metro_area_id is distinct from old.metro_area_id) then
    raise exception 'Only the author can edit a post';
  end if;
  if is_author and (new.caption is distinct from old.caption or new.park_id is distinct from old.park_id) then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

-- A page post's metro: its park's, else the page's (a shop's metro area;
-- brands usually have none). The metro the app sends is ignored.
create or replace function private.set_post_metro()
returns trigger
language plpgsql security definer
set search_path to 'public'
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
    elsif new.page_id is not null then
      new.metro_area_id := (select metro_area_id from pages where id = new.page_id);
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

-- Linking a page post to a meetup: the member who posts it must be going
-- (pages hosting meetups come with PR 9).
create or replace function private.guard_post_event()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  e events;
  who uuid := coalesce(new.author_id, auth.uid());
begin
  if tg_op = 'UPDATE' and new.event_id is not null and new.event_id is not distinct from old.event_id then
    if new.park_id is distinct from old.park_id then
      new.event_id := null;
    end if;
    return new;
  end if;
  if new.event_id is null then
    return new;
  end if;
  select * into e from events where id = new.event_id;
  if e.id is null
     or e.park_id is distinct from new.park_id
     or e.status <> 'scheduled'
     or now() < e.starts_at or now() > e.ends_at + interval '7 days'
     or not (exists (select 1 from event_going g where g.event_id = e.id and g.user_id = who)
             or private.hosts_series(e.series_id, who)) then
    raise exception 'This post can''t be linked to that meetup' using errcode = '22023';
  end if;
  return new;
end $$;

/* 5. Near you ------------------------------------------------------------------------------ */

-- The page's Near you posts so far today and this week (Monday to Sunday),
-- on its own clock. Deleted posts count, so deleting and posting again
-- doesn't free a slot.
create or replace function private.near_you_used(page uuid, at_time timestamptz default now(), except_post uuid default null)
returns table (today integer, this_week integer)
language sql stable security definer
set search_path = ''
as $$
  with pg as (select coalesce(p.timezone, 'UTC') as tz from public.pages p where p.id = page)
  select count(*) filter (where (x.published_at at time zone pg.tz)::date = (at_time at time zone pg.tz)::date)::integer,
         count(*) filter (where date_trunc('week', x.published_at at time zone pg.tz)
                                = date_trunc('week', at_time at time zone pg.tz))::integer
    from pg
    left join public.posts x
      on x.page_id = page and x.near_you and x.id is distinct from except_post
     and x.published_at > at_time - interval '8 days';
$$;

-- Whether a page can reach Near you at all: a managed shop with a metro area.
create or replace function private.page_reaches_near_you(page uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pages p
     where p.id = page and 'shop' = any (p.roles) and p.state = 'managed'
       and p.closed_at is null and p.suspended_at is null and p.metro_area_id is not null
  );
$$;

create or replace function private.set_post_near_you()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  used record;
begin
  if new.page_id is null or old.published_at is not null or new.published_at is null then
    return new;
  end if;
  if not private.page_reaches_near_you(new.page_id) then
    new.near_you := false;
    return new;
  end if;
  -- Two posts going up at once can't both take the last slot.
  perform pg_advisory_xact_lock(hashtextextended('near_you:' || new.page_id::text, 0));
  select * into used from private.near_you_used(new.page_id, new.published_at, new.id);
  new.near_you := used.today < 1 and used.this_week < 5;
  return new;
end $$;

drop trigger if exists posts_set_near_you on public.posts;
create trigger posts_set_near_you before update of published_at on public.posts
  for each row execute function private.set_post_near_you();

-- For Caption's reach line: whether this page's next post would reach Near
-- you, and where. The team only.
create or replace function public.page_near_you_status(page uuid)
returns table (reaches boolean, used_today boolean, week_left integer, metro_name text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  used record;
begin
  if private.page_role_of(page) is null then
    return;
  end if;
  if not private.page_reaches_near_you(page) then
    return query select false, false, 0, null::text;
    return;
  end if;
  select * into used from private.near_you_used(page);
  return query
  select used.today < 1 and used.this_week < 5,
         used.today >= 1,
         greatest(5 - used.this_week, 0),
         (select m.name::text from public.metro_areas m join public.pages p on p.metro_area_id = m.id where p.id = page);
end $$;

revoke all on function private.near_you_used(uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function private.page_reaches_near_you(uuid) from public, anon, authenticated;
revoke all on function public.page_near_you_status(uuid) from public, anon;
grant execute on function public.page_near_you_status(uuid) to authenticated;

/* 6. Feeds ---------------------------------------------------------------------------------- */

-- Following: your own posts (and the page posts you made), the people you
-- follow (not what they post as a page), and the pages you follow, minus
-- pages you muted. Blocked pages are already gone through the read rules.
create or replace function public.feed_following(before_at timestamp with time zone default null, before_id uuid default null, max_results integer default 20)
returns setof posts
language sql stable
set search_path to 'public'
as $$
  select p.*
    from posts p
   where p.published_at is not null
     and p.status = 'visible'
     and (p.author_id = (select auth.uid())
          or p.author_id in (select followee_id from follows
                              where follower_id = (select auth.uid()) and status = 'accepted')
          or (p.page_id in (select page_id from page_follows where user_id = (select auth.uid()))
              and p.page_id not in (select page_id from page_mutes where user_id = (select auth.uid())))
          or p.id in (select private.page_posts_i_made()))
     and (before_at is null
          or (p.published_at, p.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- Near you: people's posts in your metro (not yours, not people you
-- follow), and Near you page posts from shops in your metro that you don't
-- follow (followers see them in Following) and haven't muted.
create or replace function public.feed_nearby(metro uuid default null, before_at timestamp with time zone default null, before_id uuid default null, max_results integer default 20)
returns setof posts
language sql stable
set search_path to 'public'
as $$
  with here as (
    select coalesce(metro, (select home_metro_area_id from profiles where id = (select auth.uid()))) as m
  )
  select p.*
    from posts p, here
   where p.published_at is not null
     and p.status = 'visible'
     and (
       (p.page_id is null
        and p.metro_area_id = here.m
        and p.author_id <> (select auth.uid())
        and p.author_id not in (select followee_id from follows
                                 where follower_id = (select auth.uid()) and status = 'accepted'))
       or (p.near_you
           and p.page_id in (select id from pages where metro_area_id = here.m)
           and p.page_id not in (select page_id from page_follows where user_id = (select auth.uid()))
           and p.page_id not in (select page_id from page_mutes where user_id = (select auth.uid()))
           and p.id not in (select private.page_posts_i_made()))
     )
     and (before_at is null
          or (p.published_at, p.id) < (before_at, coalesce(before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- "by [member]" on a page's post tiles, for its team only.
create or replace function public.page_post_bylines(page uuid, posts uuid[])
returns table (post_id uuid, username text)
language sql stable security definer
set search_path = ''
as $$
  select k.post_id, case when pr.deleted_at is null then pr.username::text end
    from private.page_post_makers k
    join public.profiles pr on pr.id = k.member_id
   where k.page_id = page
     and k.post_id = any (posts)
     and private.page_role_of(page) is not null;
$$;

revoke all on function public.page_post_bylines(uuid, uuid[]) from public, anon;
grant execute on function public.page_post_bylines(uuid, uuid[]) to authenticated;

/* 7. Slides, tags and media ------------------------------------------------------------------ */

drop policy if exists "author manages slides" on public.post_slides;
create policy "author manages slides" on public.post_slides for all to authenticated
  using (private.made_post(post_id))
  with check (private.made_post(post_id));

drop policy if exists "author tags people" on public.slide_people_tags;
create policy "author tags people" on public.slide_people_tags for insert to authenticated
  with check (
    tagged_by = (select auth.uid())
    and exists (select 1 from post_slides s where s.id = slide_people_tags.slide_id and private.made_post(s.post_id))
    and not private.blocked_between(user_id)
  );

drop policy if exists "author or tagged person removes a tag" on public.slide_people_tags;
create policy "author or tagged person removes a tag" on public.slide_people_tags for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from post_slides s where s.id = slide_people_tags.slide_id and private.made_post(s.post_id))
  );

-- Page post media lives under page/<page>/<post>/, not in the member's
-- folder, so deleting the member's account doesn't take it.
drop policy if exists "post media: author uploads" on storage.objects;
create policy "post media: author uploads" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and exists (select 1 from public.post_slides s
                 where s.storage_path = objects.name and private.made_post(s.post_id)
                   and s.upload_status in ('uploading', 'failed'))
  );

drop policy if exists "post media: author re-uploads" on storage.objects;
create policy "post media: author re-uploads" on storage.objects for update to authenticated
  using (
    bucket_id = 'post-media'
    and exists (select 1 from public.post_slides s
                 where s.storage_path = objects.name and private.made_post(s.post_id)
                   and s.upload_status in ('uploading', 'failed'))
  );

drop policy if exists "post media: page post maker deletes" on storage.objects;
create policy "post media: page post maker deletes" on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-media'
    and (storage.foldername(name))[1] = 'page'
    and exists (select 1 from public.post_slides s
                 where s.storage_path = objects.name and private.made_post(s.post_id))
  );

/* 8. Notifications from a page post ------------------------------------------------------------ */

-- Tags, filmer credits and caption mentions on a page post come from the
-- page (actor_id null, page_id set), never from the member who posted it.
create or replace function private.notify_from_page(recipient uuid, what public.notification_kind, post uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  pg uuid;
begin
  select p.page_id into pg from posts p where p.id = post;
  if recipient is null or pg is null then
    return;
  end if;
  -- The member who posted it doesn't hear about their own tags.
  if exists (select 1 from private.page_post_makers k where k.post_id = post and k.member_id = recipient) then
    return;
  end if;
  if not exists (select 1 from profiles where id = recipient and deleted_at is null and onboarded_at is not null) then
    return;
  end if;
  if exists (select 1 from user_page_blocks b where b.user_id = recipient and b.page_id = pg)
     or exists (select 1 from page_blocks b where b.page_id = pg and b.user_id = recipient and b.lifted_at is null) then
    return;
  end if;
  if not private.can_see_post_as(post, recipient) then
    return;
  end if;
  if exists (select 1 from notifications where recipient_id = recipient and kind = what and post_id = post) then
    return;
  end if;
  insert into notifications (recipient_id, kind, actor_id, post_id, page_id)
  values (recipient, what, null, post, pg);
end $$;

revoke all on function private.notify_from_page(uuid, public.notification_kind, uuid) from public, anon, authenticated;

create or replace function private.notify_post_published()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  person uuid;
begin
  if new.published_at is not null and old.published_at is null then
    for person in
      select distinct t.user_id
        from slide_people_tags t
        join post_slides s on s.id = t.slide_id
       where s.post_id = new.id
    loop
      if new.page_id is not null then
        perform private.notify_from_page(person, 'tag', new.id);
      else
        perform private.notify(person, 'tag', new.author_id, new.id);
      end if;
    end loop;
    for person in
      select distinct s.filmer_id from post_slides s where s.post_id = new.id and s.filmer_id is not null
    loop
      if new.page_id is not null then
        perform private.notify_from_page(person, 'filmer_credit', new.id);
      else
        perform private.notify(person, 'filmer_credit', new.author_id, new.id);
      end if;
    end loop;
  end if;
  return null;
end $$;

create or replace function private.notify_tag_change()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  the_post uuid;
  the_author uuid;
  the_page uuid;
begin
  if tg_op = 'INSERT' then
    select p.id, p.author_id, p.page_id into the_post, the_author, the_page
      from post_slides s join posts p on p.id = s.post_id
     where s.id = new.slide_id and p.published_at is not null;
    if the_post is not null then
      if the_page is not null then
        perform private.notify_from_page(new.user_id, 'tag', the_post);
      else
        perform private.notify(new.user_id, 'tag', the_author, the_post);
      end if;
    end if;
  else
    select s.post_id into the_post from post_slides s where s.id = old.slide_id;
    if the_post is not null and not exists (
      select 1 from slide_people_tags t join post_slides s on s.id = t.slide_id
       where s.post_id = the_post and t.user_id = old.user_id
    ) then
      delete from notifications where recipient_id = old.user_id and kind = 'tag' and post_id = the_post;
    end if;
  end if;
  return null;
end $$;

create or replace function private.notify_caption_mentions()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  person uuid;
begin
  if new.published_at is null then
    return null;
  end if;
  -- Already published and the caption didn't change: nothing to do.
  if tg_op = 'UPDATE' and old.published_at is not null
     and new.caption is not distinct from old.caption then
    return null;
  end if;
  -- Edited out of the caption: the notification goes, quietly.
  if tg_op = 'UPDATE' and old.published_at is not null then
    delete from notifications n
     where n.post_id = new.id
       and n.kind = 'caption_mention'
       and n.recipient_id not in (select x from private.caption_mentioned(new.caption) as x);
  end if;
  for person in select x from private.caption_mentioned(new.caption) as x loop
    -- Tagged or credited on this post: they've heard about it already.
    if exists (
      select 1 from post_slides s
       where s.post_id = new.id
         and (s.filmer_id = person
              or exists (select 1 from slide_people_tags t where t.slide_id = s.id and t.user_id = person))
    ) then
      continue;
    end if;
    -- One caption mention per person per post.
    if new.page_id is not null then
      perform private.notify_from_page(person, 'caption_mention', new.id);
    else
      perform private.notify(person, 'caption_mention', new.author_id, new.id);
    end if;
  end loop;
  return null;
end $$;

-- Page posts don't record page mentions until PR 8b, when the page inbox
-- learns to show a page as the one who mentioned.
create or replace function private.track_caption_page_mentions()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
begin
  if new.page_id is not null then
    return null;
  end if;
  if new.published_at is null or new.status = 'deleted' then
    delete from public.page_mentions m
     where m.post_id = new.id and m.comment_id is null and m.event_comment_id is null;
    return null;
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null and old.status is not distinct from new.status
     and new.caption is not distinct from old.caption then
    return null;
  end if;
  delete from public.page_mentions m
   where m.post_id = new.id and m.comment_id is null and m.event_comment_id is null
     and m.page_id not in (select private.pages_mentioned(new.caption, new.author_id));
  insert into public.page_mentions (page_id, author_id, post_id)
  select pid, new.author_id, new.id from private.pages_mentioned(new.caption, new.author_id) as pid
  on conflict do nothing;
  return null;
end $$;

/* 9. Patches: reporting a page post, and the bell naming the page ------------------------------ */

do $patch$
declare
  def text;
  old_part text;
  new_part text;
begin
  -- file_report: a page post has no author, so "found" can't mean "has an author".
  def := pg_get_functiondef('public.file_report(uuid, uuid, uuid, public.report_reason, text, uuid, uuid, uuid)'::regprocedure);
  old_part := $o$    if target_user is null or not private.can_see_post(post) then$o$;
  new_part := $n$    if not exists (select 1 from posts p where p.id = post and p.published_at is not null and p.status <> 'deleted')
       or not private.can_see_post(post) then$n$;
  if array_length(string_to_array(def, old_part), 1) <> 2 then
    raise exception 'file_report: the passage to patch was not found exactly once';
  end if;
  execute replace(def, old_part, new_part);

  -- my_notifications: tags, credits and caption mentions from a page carry
  -- the page as the actor; a page the recipient blocked shows nothing.
  def := pg_get_functiondef('public.my_notifications()'::regprocedure);
  old_part := $o$      left join profiles a on a.id = n.actor_id
     where n.recipient_id = me
       and n.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'caption_mention')$o$;
  new_part := $n$      left join profiles a on a.id = n.actor_id
      left join pages pa on pa.id = n.page_id and n.kind in ('tag', 'filmer_credit', 'caption_mention')
     where n.recipient_id = me
       and n.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'caption_mention')
       and (pa.id is null or not exists (select 1 from user_page_blocks ub where ub.user_id = me and ub.page_id = pa.id))$n$;
  if array_length(string_to_array(def, old_part), 1) <> 2 then
    raise exception 'my_notifications: the actor join was not found exactly once';
  end if;
  def := replace(def, old_part, new_part);

  old_part := $o$           a.username::text as actor_username,
           a.avatar_path as actor_avatar
      from notifications n$o$;
  new_part := $n$           a.username::text as actor_username,
           a.avatar_path as actor_avatar,
           case when pa.id is not null then
             jsonb_build_object('id', null, 'username', pa.display_name, 'avatar_path', null,
                                'page', jsonb_build_object('id', pa.id, 'handle', pa.handle, 'display_name', pa.display_name,
                                                           'logo_path', pa.logo_path, 'state', pa.state))
           end as page_actor
      from notifications n$n$;
  if array_length(string_to_array(def, old_part), 1) <> 2 then
    raise exception 'my_notifications: the actor columns were not found exactly once';
  end if;
  def := replace(def, old_part, new_part);

  old_part := $o$           case when t.actor_id is null then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('id', t.actor_id, 'username', t.actor_username, 'avatar_path', t.actor_avatar))
           end,
           case when t.actor_id is null then 0 else 1 end,$o$;
  new_part := $n$           case when t.page_actor is not null then jsonb_build_array(t.page_actor)
                when t.actor_id is null then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('id', t.actor_id, 'username', t.actor_username, 'avatar_path', t.actor_avatar))
           end,
           case when t.page_actor is not null then 1 when t.actor_id is null then 0 else 1 end,$n$;
  if array_length(string_to_array(def, old_part), 1) <> 2 then
    raise exception 'my_notifications: the single-row actors were not found exactly once';
  end if;
  execute replace(def, old_part, new_part);
end
$patch$;

-- A page post made the way the app makes one (as the member), then published
-- by its slide finishing (as the upload pipeline does). Runs as the table
-- owner with the member's claims set, so auth.uid() is the member.
create function pg_temp.page_post(pg uuid, maker uuid, park uuid, cap text, tag uuid default null)
returns uuid
language plpgsql
as $f$
declare
  post uuid := gen_random_uuid();
  slide uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('sub', maker, 'role', 'authenticated')::text, true);
  insert into public.posts (id, author_id, page_id, park_id, caption, slide_count)
  values (post, null, pg, park, cap, 1);
  insert into public.post_slides (id, post_id, position, kind, width, height, storage_path, upload_status)
  values (slide, post, 0, 'photo', 1080, 1350, 'page/' || pg || '/' || post || '/' || slide || '.jpg', 'uploading');
  if tag is not null then
    insert into public.slide_people_tags (slide_id, user_id, tagged_by) values (slide, tag, maker);
  end if;
  update public.post_slides set upload_status = 'ready' where id = slide;
  return post;
end $f$;

do $$
declare
  r text := '';
  ok int := 0; total int := 0;
  eightset uuid := (select id from public.pages where handle = '8set_store');          -- a shop in Copenhagen
  bos uuid := (select id from public.pages where handle = 'bos_bootsonwheels');       -- a shop in San Diego
  them uuid := (select id from public.pages where handle = 'themskates');             -- a brand, no logo
  cph uuid := (select metro_area_id from public.pages where handle = '8set_store');
  prags uuid := (select id from public.parks where slug = 'prags-boulevard-cph');
  o uuid := gen_random_uuid();   -- owns 8SET and Bo's
  m uuid := gen_random_uuid();   -- manager on 8SET
  s uuid := gen_random_uuid();   -- staff on 8SET, posts as it
  x uuid := gen_random_uuid();   -- a Copenhagen skater who doesn't follow 8SET
  f uuid := gen_random_uuid();   -- follows 8SET (and s)
  q uuid := gen_random_uuid();   -- follows 8SET, then mutes it
  b uuid := gen_random_uuid();   -- blocks 8SET
  u uuid;
  p1 uuid; p2 uuid; p3 uuid;
  n int;
  res text;
  rec record;
begin
  foreach u in array array[o, m, s, x, f, q, b] loop
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'post-as-check-' || u || '@example.com', now(), now(), '{}'::jsonb);
    insert into public.profiles (id) values (u) on conflict (id) do nothing;
    update public.profiles set onboarded_at = now(), age_confirmed_at = now(),
      disciplines = '{inline}', home_metro_area_id = cph,
      username = 'postascheck' || left(replace(u::text, '-', ''), 8) where id = u;
  end loop;

  perform private.make_page_owner(eightset, o, null);
  perform private.make_page_owner(bos, o, null);
  perform private.make_page_owner(them, o, null);
  insert into public.page_members (page_id, user_id, role) values (eightset, m, 'manager'), (eightset, s, 'staff');
  update public.pages set logo_path = id || '/logo.png' where id in (eightset, bos);
  insert into public.page_follows (user_id, page_id) values (f, eightset), (q, eightset);
  insert into public.page_mutes (user_id, page_id) values (q, eightset);
  insert into public.user_page_blocks (user_id, page_id) values (b, eightset);
  insert into public.follows (follower_id, followee_id, status) values (f, s, 'accepted');

  /* Who can post as a page (the insert rule) ------------------------------------------------ */
  execute 'set local role authenticated';

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    insert into public.posts (author_id, page_id, caption, slide_count) values (null, eightset, 'staff can', 1);
    ok := ok + 1;
  exception when others then r := r || 'FAIL staff posting as 8SET: ' || sqlerrm || '; '; end;

  total := total + 1;
  begin
    insert into public.posts (author_id, page_id, caption, slide_count) values (null, them, 'no logo', 1);
    r := r || 'FAIL posted as a page with no logo; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    insert into public.posts (author_id, page_id, caption, slide_count) values (null, eightset, 'not on the team', 1);
    r := r || 'FAIL a non-member posted as 8SET; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    insert into public.posts (author_id, page_id, caption, slide_count, metro_area_id) values (x, eightset, 'both', 1, cph);
    r := r || 'FAIL a post with an author and a page; ';
  exception when insufficient_privilege or check_violation then ok := ok + 1; end;

  total := total + 1;
  begin
    insert into public.posts (author_id, metro_area_id, caption, slide_count, near_you) values (x, cph, 'sneaky', 1, true);
    r := r || 'FAIL a post started in Near you; ';
  exception when insufficient_privilege or check_violation then ok := ok + 1; end;
  execute 'reset role';

  total := total + 1;
  if exists (select 1 from private.page_post_makers k join public.posts p on p.id = k.post_id
              where p.caption = 'staff can' and k.member_id = s and p.metro_area_id = cph)
  then ok := ok + 1; else r := r || 'FAIL maker or metro not recorded; '; end if;

  /* Publishing, Near you and the cap ------------------------------------------------------------ */
  p1 := pg_temp.page_post(eightset, s, prags, 'Sunday at Prags with the crew', x);
  p2 := pg_temp.page_post(eightset, s, prags, 'second one today');
  perform set_config('request.jwt.claims', '', true);

  total := total + 1;
  if (select published_at is not null and near_you from public.posts where id = p1)
     and (select published_at is not null and not near_you from public.posts where id = p2)
  then ok := ok + 1; else r := r || 'FAIL daily cap: '
    || coalesce((select near_you::text from public.posts where id = p1), '?') || '/'
    || coalesce((select near_you::text from public.posts where id = p2), '?') || '; '; end if;

  -- Bo's already used five slots this week (Monday and Tuesday, its clock), posted by its owner.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  insert into public.posts (author_id, page_id, metro_area_id, caption, slide_count, published_at, near_you)
  select null, bos, (select metro_area_id from public.pages where id = bos), 'earlier ' || g, 1,
         ((date_trunc('week', now() at time zone 'America/Los_Angeles') + interval '10 hours'
           + (g % 2) * interval '1 day') at time zone 'America/Los_Angeles'),
         true
    from generate_series(1, 5) g;
  p3 := pg_temp.page_post(bos, o, null, 'weekly cap');
  perform set_config('request.jwt.claims', '', true);
  total := total + 1;
  if (select published_at is not null and not near_you from public.posts where id = p3)
     and (select today = 0 and this_week = 5 from private.near_you_used(bos))
  then ok := ok + 1; else r := r || 'FAIL weekly cap; '; end if;

  -- A brand never reaches Near you; its post with no park has no metro.
  update public.pages set logo_path = id || '/logo.png' where id = them;
  p3 := pg_temp.page_post(them, o, null, 'brand post');
  perform set_config('request.jwt.claims', '', true);
  total := total + 1;
  if (select published_at is not null and not near_you and metro_area_id is null from public.posts where id = p3)
  then ok := ok + 1; else r := r || 'FAIL brand post; '; end if;

  /* Feeds ------------------------------------------------------------------------------------- */
  execute 'set local role authenticated';

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  total := total + 1;
  if exists (select 1 from public.feed_nearby() where id = p1)
     and not exists (select 1 from public.feed_nearby() where id = p2)
  then ok := ok + 1; else r := r || 'FAIL Near you for a non-follower; '; end if;

  total := total + 1;
  if (select count(*) from public.feed_following() where id in (p1, p2)) = 0
  then ok := ok + 1; else r := r || 'FAIL non-follower got Following; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', f, 'role', 'authenticated')::text, true);
  total := total + 1;
  if (select count(*) from public.feed_following() where id in (p1, p2)) = 2
     and not exists (select 1 from public.feed_nearby() where id = p1)
  then ok := ok + 1; else r := r || 'FAIL follower feeds; '; end if;

  -- f follows s too: s's page posts reach f through the page, never through s.
  total := total + 1;
  if not exists (select 1 from public.feed_following() p where p.author_id = s)
  then ok := ok + 1; else r := r || 'FAIL member''s followers see page posts as theirs; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', q, 'role', 'authenticated')::text, true);
  total := total + 1;
  if not exists (select 1 from public.feed_following() where id in (p1, p2))
     and not exists (select 1 from public.feed_nearby() where id = p1)
     and exists (select 1 from public.posts where id = p1)
  then ok := ok + 1; else r := r || 'FAIL muted page in Home (or hidden elsewhere); '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  total := total + 1;
  if not exists (select 1 from public.posts where id in (p1, p2))
     and not exists (select 1 from public.post_slides where post_id = p1)
  then ok := ok + 1; else r := r || 'FAIL blocked page''s posts visible; '; end if;

  -- The member's own Home has the page posts they made.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  total := total + 1;
  if (select count(*) from public.feed_following() where id in (p1, p2)) = 2
  then ok := ok + 1; else r := r || 'FAIL maker''s own Home; '; end if;

  /* Who posted stays inside the team -------------------------------------------------------------- */
  total := total + 1;
  if (select username from public.page_post_bylines(eightset, array[p1]) limit 1) = (select username::text from public.profiles where id = s)
  then ok := ok + 1; else r := r || 'FAIL team byline; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  total := total + 1;
  if not exists (select 1 from public.page_post_bylines(eightset, array[p1]))
     and (select author_id from public.posts where id = p1) is null
  then ok := ok + 1; else r := r || 'FAIL byline leaked; '; end if;

  total := total + 1;
  begin
    perform 1 from private.page_post_makers;
    r := r || 'FAIL makers table readable; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  if not public.i_made_post(p1) then ok := ok + 1; else r := r || 'FAIL i_made_post for a stranger; '; end if;

  /* Notifications come from the page --------------------------------------------------------------- */
  execute 'reset role';
  total := total + 1;
  if exists (select 1 from public.notifications where recipient_id = x and kind = 'tag' and post_id = p1
               and actor_id is null and page_id = eightset)
  then ok := ok + 1; else r := r || 'FAIL tag from the page; '; end if;
  execute 'set local role authenticated';

  total := total + 1;
  n := 0;
  for rec in select * from public.my_notifications() loop
    if rec.kind = 'tag' and rec.post_id = p1 and rec.actors -> 0 -> 'page' ->> 'handle' = '8set_store' then n := 1; end if;
  end loop;
  if n = 1 then ok := ok + 1; else r := r || 'FAIL bell row from the page; '; end if;

  /* Reporting a page post ---------------------------------------------------------------------- */
  total := total + 1;
  begin
    perform public.file_report(p1, null, null, 'spam', null, null, null, null);
    ok := ok + 1;
  exception when others then r := r || 'FAIL report a page post: ' || sqlerrm || '; '; end;

  /* Editing and removing ------------------------------------------------------------------------ */
  total := total + 1;
  begin
    update public.posts set caption = 'hijacked' where id = p1;
    if (select caption from public.posts where id = p1) = 'hijacked' then r := r || 'FAIL stranger edited; ';
    else ok := ok + 1; end if;
  exception when others then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    update public.posts set caption = 'manager rewrite' where id = p1;
    r := r || 'FAIL manager edited someone''s page post; ';
  exception when raise_exception then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  update public.posts set caption = 'Sunday at Prags, thanks all' where id = p1;
  total := total + 1;
  if (select caption = 'Sunday at Prags, thanks all' and edited_at is not null from public.posts where id = p1)
  then ok := ok + 1; else r := r || 'FAIL maker edit; '; end if;

  total := total + 1;
  begin
    update public.posts set near_you = false where id = p1;
    r := r || 'FAIL near_you changed by an update; ';
  exception when raise_exception then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  update public.posts set status = 'deleted' where id = p2;
  total := total + 1;
  execute 'reset role';
  if (select status = 'deleted' from public.posts where id = p2) then ok := ok + 1;
  else r := r || 'FAIL manager delete; '; end if;

  /* Regulars, profiles and leaving -------------------------------------------------------------------- */
  -- Six more page posts at Prags by s: s never becomes a regular from them.
  for n in 1..6 loop
    perform pg_temp.page_post(eightset, s, prags, 'regulars ' || n);
  end loop;
  perform set_config('request.jwt.claims', '', true);
  total := total + 1;
  if not exists (select 1 from public.park_regulars where park_id = prags and user_id = s)
  then ok := ok + 1; else r := r || 'FAIL page posts counted toward regulars; '; end if;

  -- A private member's page posts stay public.
  update public.profiles set is_private = true where id = s;
  total := total + 1;
  if private.can_see_post_as(p1, x) then ok := ok + 1; else r := r || 'FAIL private maker hid page post; '; end if;

  -- s leaves the team: no more editing.
  delete from public.page_members where page_id = eightset and user_id = s;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    update public.posts set caption = 'after leaving' where id = p1;
    if (select caption from public.posts where id = p1) = 'after leaving' then r := r || 'FAIL edited after leaving; ';
    else ok := ok + 1; end if;
  exception when others then ok := ok + 1; end;

  /* Caption status for the team ------------------------------------------------------------------ */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  select * into rec from public.page_near_you_status(eightset);
  total := total + 1;
  if rec.reaches = false and rec.used_today and rec.metro_name is not null then ok := ok + 1;
  else r := r || 'FAIL near you status ' || coalesce(rec.reaches::text, 'null') || '; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  total := total + 1;
  if not exists (select 1 from public.page_near_you_status(eightset)) then ok := ok + 1;
  else r := r || 'FAIL near you status for a stranger; '; end if;

  raise exception 'CHECK % of %: %', ok, total, r;
end $$;
rollback;
