-- Rolled-back check for 20261104072712_page_screens (run after
-- 20261104072507_page_screens_enums is applied, since the new report reasons
-- can't be used in the transaction that adds them). Runs the migration and the
-- checks in one transaction, then raises an exception carrying the results
-- (RESULTS [...]), so nothing is kept. Every row should have ok = true.
-- Member checks run as ordinary members, not the owner.
begin;
-- Brand and shop accounts, part A, PR 2: what the page screens, Search and
-- the @ list need. PRD: Grindylocks — Brand and Shop Accounts PRD (What each
-- page shows, Handles, Followers, Blocking and muting, Moderation). Mockups:
-- Brand accounts (v2) page — brand pages, discovery, reporting rows.
--
--   page_for_handle()     a handle (or an old one still redirecting) → page.
--   page_viewer_state()   following, muted, blocked, and whether you can follow.
--   search_pages()        Search's Pages filter and the @ list's Pages heading;
--                         matches handles, names and "Formerly" names.
--   page_reports          reports about a page itself (Pretending to be a brand
--   file_page_report()    or shop, This is our brand or shop, Wrong info, Spam,
--                         Harassment, Something else). They go to Rachel only;
--                         her web admin screens for them come with PR 6.
--   reports.impersonated_page_id, file_report(…, impersonating)
--                         "Pretending to be a brand or shop" on profile reports,
--                         with the page it imitates. Person reports already go
--                         straight to Rachel.
--   page_suggestions      "Can't find a brand or shop? Suggest it". Rachel's
--   suggest_page()        Suggested brands queue comes with PR 6.
--   page_mentions         @mentions of a page in captions, post comments and
--                         meetup comments, stored for the page's inbox (PR 7
--                         reads them, checking the team can see each one).
--
-- Additive: new tables, functions, a column and triggers; file_report() is
-- dropped and recreated in this migration with one new trailing parameter.

/* 1. Finding a page --------------------------------------------------------------- */

-- The page a handle points at: its current handle, or an old handle that
-- still redirects after a rename. Case-insensitive.
create or replace function public.page_for_handle(h text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select p.id from public.pages p
      where p.handle operator(extensions.=) regexp_replace(trim(coalesce(h, '')), '^@+', '')::extensions.citext),
    (select a.page_id from public.page_aliases a
      where a.handle operator(extensions.=) regexp_replace(trim(coalesce(h, '')), '^@+', '')::extensions.citext
        and a.redirect_until > now()
      order by a.created_at desc limit 1)
  );
$$;

-- Your relationship to a page, for its Follow button and ⋯ menu. team_role is
-- your role on its team, if any (the team sees Edit page instead of Mute,
-- Block and Report, once PR 7 adds it). Whether the page blocked you is only
-- visible as can_follow = false.
create or replace function public.page_viewer_state(page uuid)
returns table (following boolean, muted boolean, blocked boolean, can_follow boolean,
               team_role public.page_member_role)
language sql stable security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.page_follows f where f.page_id = page and f.user_id = (select auth.uid())),
    exists (select 1 from public.page_mutes m where m.page_id = page and m.user_id = (select auth.uid())),
    exists (select 1 from public.user_page_blocks b where b.page_id = page and b.user_id = (select auth.uid())),
    private.can_follow_page(page),
    private.page_role_of(page);
$$;

-- Search's Pages filter (for_mention = false) and the @ list (true).
-- Matches the handle, the display name and "Formerly" names, ignoring case and
-- accents. Pages you follow come first, then names starting with what you
-- typed. Pages you blocked never show. In the @ list, pages that can't be
-- followed any more (Retired, Closed, name only) and pages that blocked you
-- are left out too, since mentioning them would reach nobody; with an empty
-- query it lists the pages you follow.
create or replace function public.search_pages(q text, for_mention boolean default false, max_results integer default 20)
returns table (id uuid, handle text, display_name text, roles public.page_role[], state public.page_state,
               city text, country text, logo_path text, following boolean, formerly text)
language sql stable security definer
set search_path = ''
as $$
  with needle as (
    select private.fold(regexp_replace(trim(coalesce(q, '')), '^@+', '')) as n
  ),
  matched as (
    select p.*,
           exists (select 1 from public.page_follows f where f.page_id = p.id and f.user_id = (select auth.uid())) as is_following,
           (select a.name from public.page_aliases a
             where a.page_id = p.id
               and position((select n from needle) in private.fold(a.name)) > 0
               and position((select n from needle) in private.fold(p.display_name)) = 0
               and position((select n from needle) in private.fold(p.handle::text)) = 0
             order by a.created_at desc limit 1) as alias_hit
      from public.pages p
     where (select auth.uid()) is not null
       and not exists (select 1 from public.user_page_blocks b where b.page_id = p.id and b.user_id = (select auth.uid()))
       and (not for_mention or private.can_follow_page(p.id))
  )
  select m.id, m.handle::text, m.display_name, m.roles, m.state, m.city, m.country::text, m.logo_path,
         m.is_following, m.alias_hit
    from matched m
   where case
           when length((select n from needle)) = 0 then for_mention and m.is_following
           when length((select n from needle)) < 2 then false
           else position((select n from needle) in private.fold(m.handle::text)) > 0
             or position((select n from needle) in private.fold(m.display_name)) > 0
             or m.alias_hit is not null
         end
   order by m.is_following desc,
            (private.fold(m.display_name) like (select n from needle) || '%'
             or private.fold(m.handle::text) like (select n from needle) || '%') desc,
            (m.state in ('unofficial', 'managed')) desc,
            lower(m.display_name)
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

/* 2. Reporting a page --------------------------------------------------------------- */

create table if not exists public.page_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  page_id uuid not null references public.pages (id) on delete cascade,
  reason public.report_reason not null
    check (reason in ('impersonation', 'our_page', 'wrong_info', 'spam', 'harassment', 'other')),
  details text check (details is null or char_length(details) between 1 and 500),
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.page_reports is
  'Reports about a brand or shop page itself. Rachel only (the Moderation section of the Brand and Shop Accounts PRD).';

create index if not exists page_reports_page_idx on public.page_reports (page_id);
create index if not exists page_reports_open_idx on public.page_reports (created_at) where status = 'open';

alter table public.page_reports enable row level security;
revoke all on public.page_reports from anon, authenticated;
grant select on public.page_reports to authenticated;
grant update (status, resolved_by, resolved_at) on public.page_reports to authenticated;

create policy "page reports: your own and Rachel" on public.page_reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or private.is_owner());

create policy "page reports: Rachel resolves" on public.page_reports
  for update to authenticated
  using (private.is_owner()) with check (private.is_owner());

-- Report a page. Suspended members can still report; the team can't report
-- its own page. A repeat while the first is open is quietly accepted.
create or replace function public.file_page_report(page uuid, reason public.report_reason, details text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean text := nullif(btrim(coalesce(details, '')), '');
begin
  if me is null or not exists (
    select 1 from public.profiles
     where id = me and onboarded_at is not null and deleted_at is null and banned_at is null
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pages where id = page) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if reason not in ('impersonation', 'our_page', 'wrong_info', 'spam', 'harassment', 'other') then
    raise exception 'not_a_page_reason' using errcode = '22023';
  end if;
  if clean is not null and char_length(clean) > 500 then
    raise exception 'details_too_long' using errcode = '22023';
  end if;
  if private.page_role_of(page, me) is not null then
    raise exception 'cannot_report_your_page' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.page_reports r
     where r.reporter_id = me and r.page_id = page and r.status = 'open'
  ) then
    return;
  end if;
  insert into public.page_reports (reporter_id, page_id, reason, details)
  values (me, page, reason, clean);
end $$;

/* 3. "Pretending to be a brand or shop" on profile reports --------------------------- */

alter table public.reports
  add column if not exists impersonated_page_id uuid references public.pages (id) on delete set null;

drop function if exists public.file_report(uuid, uuid, uuid, public.report_reason, text, uuid, uuid);

-- Report a post, a comment, a person, a meetup date or a meetup comment
-- (exactly one). A repeat report of the same thing by the same person while
-- the first is still open is quietly accepted and changes nothing.
-- Suspended members can still report. New in PR 2: "Pretending to be a brand
-- or shop" (impersonation) is for people only, with the page it imitates
-- (impersonating); the page-only reasons are refused here.
create function public.file_report(
  post uuid default null,
  comment uuid default null,
  person uuid default null,
  reason public.report_reason default 'other',
  details text default null,
  meetup uuid default null,
  meetup_comment uuid default null,
  impersonating uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_user uuid;
  c comments%rowtype;
  mc event_comments%rowtype;
  clean text := nullif(btrim(coalesce(details, '')), '');
begin
  if me is null or not exists (
    select 1 from profiles where id = me and onboarded_at is not null and deleted_at is null and banned_at is null
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if num_nonnulls(post, comment, person, meetup, meetup_comment) <> 1 then
    raise exception 'report_one_thing' using errcode = '22023';
  end if;
  if clean is not null and char_length(clean) > 500 then
    raise exception 'details_too_long' using errcode = '22023';
  end if;
  if reason = 'wrong_park' and post is null then
    raise exception 'wrong_park_is_for_posts' using errcode = '22023';
  end if;
  if reason in ('our_page', 'wrong_info') then
    raise exception 'page_reason' using errcode = '22023';
  end if;
  if reason = 'impersonation' and person is null then
    raise exception 'impersonation_is_for_people' using errcode = '22023';
  end if;
  if impersonating is not null and (reason <> 'impersonation'
       or not exists (select 1 from pages where id = impersonating)) then
    raise exception 'impersonating_needs_a_page' using errcode = '22023';
  end if;

  if post is not null then
    select p.author_id into target_user from posts p
     where p.id = post and p.published_at is not null and p.status <> 'deleted';
    if target_user is null or not private.can_see_post(post) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  elsif comment is not null then
    select * into c from comments where id = comment;
    if c.id is null or c.deleted_at is not null or not private.can_see_post(c.post_id)
       or private.blocked_between(c.author_id) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    target_user := c.author_id;
  elsif meetup is not null then
    select s.host_id into target_user from events e join event_series s on s.id = e.series_id
     where e.id = meetup;
    if target_user is null or not private.can_see_event(meetup) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  elsif meetup_comment is not null then
    select * into mc from event_comments where id = meetup_comment;
    if mc.id is null or mc.deleted_at is not null or not private.can_see_event(mc.event_id)
       or private.blocked_between(mc.author_id) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    target_user := mc.author_id;
  else
    if not exists (select 1 from profiles where id = person and deleted_at is null and onboarded_at is not null) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    target_user := person;
  end if;

  if target_user = me then
    raise exception 'cannot_report_yourself' using errcode = '22023';
  end if;

  -- One report per person per post, ever (a unique index already says so);
  -- everything else once while a report is open.
  if exists (
    select 1 from reports r
     where r.reporter_id = me
       and (r.status = 'open' or post is not null)
       and r.post_id is not distinct from post
       and r.comment_id is not distinct from comment
       and r.event_id is not distinct from meetup
       and r.event_comment_id is not distinct from meetup_comment
       and (post is not null or comment is not null or meetup is not null or meetup_comment is not null
            or r.reported_user_id = person)
  ) then
    return;
  end if;

  insert into reports (reporter_id, post_id, comment_id, event_id, event_comment_id, reported_user_id,
                       reason, details, impersonated_page_id)
  values (me, post, comment, meetup, meetup_comment, target_user, reason, clean, impersonating);
end;
$$;

/* 4. Suggesting a brand or shop ------------------------------------------------------- */

create table if not exists public.page_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggester_id uuid references public.profiles (id) on delete set null,
  role public.page_role not null,
  name text not null check (char_length(trim(name)) between 1 and 60),
  what text check (what is null or char_length(what) between 1 and 200),
  link text check (link is null or char_length(link) between 1 and 200),
  status public.review_status not null default 'open',
  -- Approving makes an Unofficial page (PR 6); merging points at an existing one.
  page_id uuid references public.pages (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.page_suggestions is
  'Skaters'' "Suggest a brand or shop". Rachel reviews them in the web admin''s Suggested brands queue.';

create index if not exists page_suggestions_open_idx on public.page_suggestions (created_at) where status = 'open';
create index if not exists page_suggestions_suggester_idx on public.page_suggestions (suggester_id, created_at);

alter table public.page_suggestions enable row level security;
revoke all on public.page_suggestions from anon, authenticated;
grant select on public.page_suggestions to authenticated;
grant update (status, page_id, reviewed_by, reviewed_at) on public.page_suggestions to authenticated;

create policy "page suggestions: your own and Rachel" on public.page_suggestions
  for select to authenticated
  using (suggester_id = (select auth.uid()) or private.is_owner());

create policy "page suggestions: Rachel reviews" on public.page_suggestions
  for update to authenticated
  using (private.is_owner()) with check (private.is_owner());

-- Suggest a brand or shop. Up to 10 a day per person, so it can't be used to
-- flood Rachel's queue. Suspended members can't (it's a contribution).
create or replace function public.suggest_page(role public.page_role, name text, what text default null, link text default null)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean_name text := nullif(btrim(coalesce(name, '')), '');
  clean_what text := nullif(btrim(coalesce(what, '')), '');
  clean_link text := nullif(btrim(coalesce(link, '')), '');
  new_id uuid;
begin
  if not private.is_active_member() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if clean_name is null or char_length(clean_name) > 60 then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if clean_what is not null and char_length(clean_what) > 200
     or clean_link is not null and char_length(clean_link) > 200 then
    raise exception 'too_long' using errcode = '22023';
  end if;
  if (select count(*) from public.page_suggestions s
       where s.suggester_id = me and s.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_suggestions' using errcode = '54000';
  end if;
  insert into public.page_suggestions (suggester_id, role, name, what, link)
  values (me, role, clean_name, clean_what, clean_link)
  returning id into new_id;
  return new_id;
end $$;

/* 5. Page mentions, kept for the page's inbox ----------------------------------------- */

-- One row per page per caption or comment that @mentions it. Nobody is
-- notified: the page's inbox (PR 7) reads these, and its per-member push
-- switch (off by default) comes with it. A mention isn't kept when the author
-- blocked the page or the page blocked the author.
create table if not exists public.page_mentions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  event_comment_id uuid references public.event_comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A caption mention has post_id only; a comment mention has its post too.
  check (num_nonnulls(comment_id, event_comment_id) <= 1),
  check (post_id is not null or event_comment_id is not null)
);

create unique index if not exists page_mentions_caption on public.page_mentions (page_id, post_id)
  where comment_id is null and event_comment_id is null;
create unique index if not exists page_mentions_comment on public.page_mentions (page_id, comment_id)
  where comment_id is not null;
create unique index if not exists page_mentions_event_comment on public.page_mentions (page_id, event_comment_id)
  where event_comment_id is not null;
create index if not exists page_mentions_page_idx on public.page_mentions (page_id, created_at desc);

alter table public.page_mentions enable row level security;
revoke all on public.page_mentions from anon, authenticated;
grant select on public.page_mentions to authenticated;

create policy "page mentions: the team and Rachel" on public.page_mentions
  for select to authenticated
  using (private.page_role_of(page_id) is not null or private.is_owner());

-- The pages a piece of text mentions, by current handle or an old handle
-- still redirecting; up to 10, skipping blocks either way with the author.
create or replace function private.pages_mentioned(body text, author uuid)
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct pg.id
    from (
      select distinct lower(r.m[1]) as h
        from regexp_matches(coalesce(body, ''), '@([A-Za-z0-9._]{2,30})', 'g') as r(m)
    ) t
    join lateral (select public.page_for_handle(t.h) as id) pg on pg.id is not null
   where not exists (select 1 from public.user_page_blocks b where b.page_id = pg.id and b.user_id = author)
     and not exists (select 1 from public.page_blocks b
                      where b.page_id = pg.id and b.user_id = author and b.lifted_at is null)
   limit 10;
$$;

-- Captions: kept in step with the caption once the post is published.
create or replace function private.track_caption_page_mentions()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
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

drop trigger if exists posts_track_page_mentions on public.posts;
create trigger posts_track_page_mentions
  after insert or update of caption, published_at, status on public.posts
  for each row execute function private.track_caption_page_mentions();

-- Post comments and meetup comments can't be edited, only deleted.
create or replace function private.track_comment_page_mentions()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'comments' then
    if new.deleted_at is not null then
      delete from public.page_mentions where comment_id = new.id;
    elsif tg_op = 'INSERT' then
      insert into public.page_mentions (page_id, author_id, post_id, comment_id)
      select pid, new.author_id, new.post_id, new.id from private.pages_mentioned(new.body, new.author_id) as pid
      on conflict do nothing;
    end if;
  else
    if new.deleted_at is not null then
      delete from public.page_mentions where event_comment_id = new.id;
    elsif tg_op = 'INSERT' then
      insert into public.page_mentions (page_id, author_id, event_comment_id)
      select pid, new.author_id, new.id from private.pages_mentioned(new.body, new.author_id) as pid
      on conflict do nothing;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists comments_track_page_mentions on public.comments;
create trigger comments_track_page_mentions
  after insert or update of deleted_at on public.comments
  for each row execute function private.track_comment_page_mentions();

drop trigger if exists event_comments_track_page_mentions on public.event_comments;
create trigger event_comments_track_page_mentions
  after insert or update of deleted_at on public.event_comments
  for each row execute function private.track_comment_page_mentions();

/* Grants -------------------------------------------------------------------------------- */

revoke all on function private.pages_mentioned(text, uuid) from public, anon, authenticated;
revoke all on function private.track_caption_page_mentions() from public, anon, authenticated;
revoke all on function private.track_comment_page_mentions() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.page_for_handle(text)',
    'public.page_viewer_state(uuid)',
    'public.search_pages(text, boolean, integer)',
    'public.file_page_report(uuid, public.report_reason, text)',
    'public.file_report(uuid, uuid, uuid, public.report_reason, text, uuid, uuid, uuid)',
    'public.suggest_page(public.page_role, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
/* Checks ----------------------------------------------------------------------- */
create temp table t_results(step text, ok boolean, detail text);
grant all on t_results to authenticated, anon;

insert into auth.users (id, email, aud, role, instance_id) values
 ('e2000000-0000-4000-8000-0000000000a1','ps-skater@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e2000000-0000-4000-8000-0000000000a2','ps-copycat@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e2000000-0000-4000-8000-0000000000a3','ps-staff@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e2000000-0000-4000-8000-0000000000a4','ps-suspended@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private, suspended_until)
select v.id::uuid, v.username, now(), (select id from metro_areas where name = 'San Diego'), '{inline}', now(), false, v.susp
from (values
 ('e2000000-0000-4000-8000-0000000000a1','ps_skater', null::timestamptz),
 ('e2000000-0000-4000-8000-0000000000a2','them.skates', null),
 ('e2000000-0000-4000-8000-0000000000a3','ps_staff', null),
 ('e2000000-0000-4000-8000-0000000000a4','ps_suspended', now() + interval '1 day')
) as v (id, username, susp);

-- A renamed page for Formerly matching and the redirect: Seba was "Seba Skates" once.
insert into page_aliases (page_id, name) select id, 'Hightech Skates' from pages where handle = 'sebaskates';
insert into page_aliases (page_id, name, handle, redirect_until) select id, 'Dead Wheels', 'deadwheelsco', now() + interval '90 days' from pages where handle = 'deadwheels';
-- The staff member is on Them's team.
insert into page_members (page_id, user_id, role) select id, 'e2000000-0000-4000-8000-0000000000a3', 'staff' from pages where handle = 'themskates';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

/* Finding pages */
insert into t_results select 'page_for_handle finds a handle in any case, with or without @',
  page_for_handle('@THEMSKATES') = (select id from pages where handle = 'themskates'), '';
insert into t_results select 'page_for_handle follows an old handle that still redirects',
  page_for_handle('deadwheelsco') = (select id from pages where handle = 'deadwheels'), '';
insert into t_results select 'page_for_handle is null for a member''s username',
  page_for_handle('ps_skater') is null, '';

insert into t_results select 'search finds a page by name', count(*) >= 1, string_agg(handle, ',')
  from search_pages('them') where handle = 'themskates';
insert into t_results select 'search finds a page by a Formerly name and says so',
  bool_and(formerly = 'Hightech Skates'), string_agg(handle || ':' || coalesce(formerly, '-'), ',')
  from search_pages('hightech') where handle = 'sebaskates';
insert into t_results select 'search ignores accents and case', count(*) >= 1, ''
  from search_pages('THÉM') where handle = 'themskates';
insert into t_results select 'one letter finds nothing', count(*) = 0, count(*)::text from search_pages('t');
insert into t_results select 'an empty search lists nothing outside the @ list', count(*) = 0, count(*)::text from search_pages('');

insert into page_follows (user_id, page_id) select 'e2000000-0000-4000-8000-0000000000a1', id from pages where handle = 'deadwheels';
insert into t_results select 'followed pages come first (two letters)', (array_agg(handle order by ord))[1] = 'deadwheels', string_agg(handle, ',' order by ord)
  from (select s.*, row_number() over () ord from search_pages('de') s) x;
insert into t_results select 'the @ list with nothing typed lists pages you follow',
  count(*) = 1 and bool_and(handle = 'deadwheels'), string_agg(handle, ',') from search_pages('', true);
insert into t_results select 'the @ list leaves out Retired pages', count(*) = 0, string_agg(handle, ',')
  from search_pages('senate', true);
insert into t_results select 'Search still shows Retired pages', count(*) = 1, string_agg(handle, ',')
  from search_pages('senate');

/* Viewer state, mute and block */
insert into t_results select 'viewer state: following and can follow',
  following and not muted and not blocked and can_follow and team_role is null, ''
  from page_viewer_state((select id from pages where handle = 'deadwheels'));
insert into t_results select 'viewer state: a Retired page can''t be followed', not can_follow, ''
  from page_viewer_state((select id from pages where handle = 'senate'));
insert into page_mutes (user_id, page_id) select 'e2000000-0000-4000-8000-0000000000a1', id from pages where handle = 'deadwheels';
insert into t_results select 'muting keeps the follow', following and muted, ''
  from page_viewer_state((select id from pages where handle = 'deadwheels'));
insert into user_page_blocks (user_id, page_id) select 'e2000000-0000-4000-8000-0000000000a1', id from pages where handle = 'deadwheels';
insert into t_results select 'blocking unfollows', not following and blocked and not can_follow, ''
  from page_viewer_state((select id from pages where handle = 'deadwheels'));
insert into t_results select 'a blocked page is gone from Search', count(*) = 0, '' from search_pages('dead') where handle = 'deadwheels';

/* Reporting a page */
select file_page_report((select id from pages where handle = 'themskates'), 'impersonation', 'Not the real one');
select file_page_report((select id from pages where handle = 'themskates'), 'impersonation', 'again');
insert into t_results select 'a page report is filed once while open', count(*) = 1, count(*)::text from page_reports;
do $$ begin perform file_page_report((select id from pages where handle = 'themskates'), 'wrong_park');
  insert into t_results values ('"Not at this park" isn''t a page reason', false, 'no error');
exception when others then insert into t_results values ('"Not at this park" isn''t a page reason', sqlerrm = 'not_a_page_reason', sqlerrm); end $$;
select file_page_report((select id from pages where handle = 'rollerblade'), 'our_page', 'I run marketing, me@rollerblade.com');
select file_page_report((select id from pages where handle = 'roces'), 'wrong_info');
insert into t_results select 'This is ours and Wrong info are page reasons', count(*) = 3, count(*)::text from page_reports;
do $$ begin insert into page_reports (reporter_id, page_id, reason) select 'e2000000-0000-4000-8000-0000000000a1', id, 'spam' from pages where handle = 'k2skates';
  insert into t_results values ('members can''t write page reports directly', false, 'no error');
exception when others then insert into t_results values ('members can''t write page reports directly', true, sqlerrm); end $$;
do $$ begin update page_reports set status = 'dismissed';
  insert into t_results values ('members can''t resolve page reports', (select count(*) from page_reports where status = 'dismissed') = 0, 'update ran');
exception when others then insert into t_results values ('members can''t resolve page reports', true, sqlerrm); end $$;

/* Pretending to be a brand or shop, on a profile */
select file_report(person => 'e2000000-0000-4000-8000-0000000000a2', reason => 'impersonation',
  impersonating => (select id from pages where handle = 'themskates'));
insert into t_results select 'a profile report names the page it imitates',
  count(*) = 1 and bool_and(impersonated_page_id = (select id from pages where handle = 'themskates')), count(*)::text
  from reports where reporter_id = 'e2000000-0000-4000-8000-0000000000a1';
do $$ begin perform file_report(person => 'e2000000-0000-4000-8000-0000000000a3', reason => 'our_page');
  insert into t_results values ('page-only reasons are refused on profiles', false, 'no error');
exception when others then insert into t_results values ('page-only reasons are refused on profiles', sqlerrm = 'page_reason', sqlerrm); end $$;
do $$ begin perform file_report(person => 'e2000000-0000-4000-8000-0000000000a3', reason => 'spam',
    impersonating => (select id from pages where handle = 'themskates'));
  insert into t_results values ('a page goes only with Pretending to be a brand or shop', false, 'no error');
exception when others then insert into t_results values ('a page goes only with Pretending to be a brand or shop', sqlerrm = 'impersonating_needs_a_page', sqlerrm); end $$;
select file_report(person => 'e2000000-0000-4000-8000-0000000000a3', reason => 'spam');
insert into t_results select 'ordinary profile reports still work', count(*) = 2, count(*)::text
  from reports where reporter_id = 'e2000000-0000-4000-8000-0000000000a1';

/* The team can't report its own page */
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
do $$ begin perform file_page_report((select id from pages where handle = 'themskates'), 'spam');
  insert into t_results values ('the team can''t report its own page', false, 'no error');
exception when others then insert into t_results values ('the team can''t report its own page', sqlerrm = 'cannot_report_your_page', sqlerrm); end $$;
insert into t_results select 'viewer state shows the team role', team_role = 'staff', team_role::text
  from page_viewer_state((select id from pages where handle = 'themskates'));
insert into t_results select 'other people''s page reports stay hidden', count(*) = 0, count(*)::text from page_reports;

/* Suggesting a brand or shop */
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select suggest_page('brand', '  Thrills Wheels ', 'Wheels from Barcelona', '@thrillswheels');
insert into t_results select 'a suggestion is saved, trimmed and open', count(*) = 1 and bool_and(name = 'Thrills Wheels' and status = 'open'), count(*)::text
  from page_suggestions;
do $$ begin perform suggest_page('shop', '   ');
  insert into t_results values ('a suggestion needs a name', false, 'no error');
exception when others then insert into t_results values ('a suggestion needs a name', sqlerrm = 'name_required', sqlerrm); end $$;
do $$ begin for i in 1..9 loop perform suggest_page('shop', 'Shop ' || i); end loop;
  perform suggest_page('shop', 'One too many');
  insert into t_results values ('ten suggestions a day at most', false, 'no error');
exception when others then insert into t_results values ('ten suggestions a day at most', sqlerrm = 'too_many_suggestions', sqlerrm); end $$;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
insert into t_results select 'suggestions are private to the suggester', count(*) = 0, count(*)::text from page_suggestions;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
do $$ begin perform suggest_page('brand', 'Something');
  insert into t_results values ('suspended members can''t suggest', false, 'no error');
exception when others then insert into t_results values ('suspended members can''t suggest', sqlerrm = 'not_allowed', sqlerrm); end $$;

/* Page mentions */
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
insert into posts (id, author_id, metro_area_id, slide_count, caption)
values ('a2000000-0000-4000-8000-0000000000f1','e2000000-0000-4000-8000-0000000000a2',(select id from metro_areas where name = 'San Diego'),1,
        '909s from @ThemSkates and wheels by @deadwheelsco, hi @ps_skater');
insert into post_slides (id, post_id, position, kind, storage_path, width, height, upload_status) values
 ('c2000000-0000-4000-8000-0000000000f1','a2000000-0000-4000-8000-0000000000f1',0,'photo',
  'e2000000-0000-4000-8000-0000000000a2/a2000000-0000-4000-8000-0000000000f1/c2000000-0000-4000-8000-0000000000f1.jpg',1000,800,'uploading');
reset role;
select set_config('request.jwt.claims', '', true);
insert into t_results select 'no page mention before the post is published', count(*) = 0, count(*)::text from page_mentions;
update post_slides set upload_status = 'ready' where post_id = 'a2000000-0000-4000-8000-0000000000f1';
insert into t_results select 'publishing keeps the caption''s page mentions (old handles too)', count(*) = 2,
  string_agg((select handle::text from pages where id = page_id), ',') from page_mentions;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
update posts set caption = '909s from @themskates' where id = 'a2000000-0000-4000-8000-0000000000f1';
insert into t_results select 'the author can''t read page mentions', count(*) = 0, count(*)::text from page_mentions;
reset role;
insert into t_results select 'editing a page out of the caption drops its mention', count(*) = 1, count(*)::text
  from page_mentions where post_id = 'a2000000-0000-4000-8000-0000000000f1';
set local role authenticated;

-- The skater blocked Dead: their comment mentioning it isn't kept.
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
insert into comments (id, post_id, author_id, body) values
 ('e2000000-0000-4000-8000-0000000000e1','a2000000-0000-4000-8000-0000000000f1','e2000000-0000-4000-8000-0000000000a1',
  'love these @themskates @deadwheels');
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
insert into t_results select 'the team sees its page''s mentions, and a blocked page gets none',
  count(*) = 2 and bool_and(page_id = (select id from pages where handle = 'themskates')), count(*)::text from page_mentions;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
update comments set deleted_at = now() where id = 'e2000000-0000-4000-8000-0000000000e1';
reset role;
insert into t_results select 'deleting the comment drops its mention', count(*) = 0, count(*)::text
  from page_mentions where comment_id = 'e2000000-0000-4000-8000-0000000000e1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e2000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
update posts set status = 'deleted' where id = 'a2000000-0000-4000-8000-0000000000f1';
reset role;
insert into t_results select 'deleting the post drops its caption mentions', count(*) = 0, count(*)::text from page_mentions;

/* Grants */
insert into t_results select 'members can call the new functions',
  has_function_privilege('authenticated', 'public.search_pages(text, boolean, integer)', 'execute')
  and has_function_privilege('authenticated', 'public.file_page_report(uuid, public.report_reason, text)', 'execute')
  and has_function_privilege('authenticated', 'public.file_report(uuid, uuid, uuid, public.report_reason, text, uuid, uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.suggest_page(public.page_role, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.page_viewer_state(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.page_for_handle(text)', 'execute'), '';
insert into t_results select 'signed-out visitors can''t',
  not has_function_privilege('anon', 'public.search_pages(text, boolean, integer)', 'execute')
  and not has_function_privilege('anon', 'public.page_for_handle(text)', 'execute'), '';

do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
