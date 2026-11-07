-- Rolled-back check for 20261105014436_page_comments (run after 20261104232214_page_comments_enums is
-- applied). Runs the migration and the checks in one transaction, then raises CHECK <ok> of <total>:
-- <failures>, so nothing is kept. Member checks run as throwaway members made in the transaction.
begin;

-- Brand and shop accounts part A, PR 8b: commenting as a page.
--
-- Like page posts (PR 8a), a comment made as a page has comments.page_id set
-- and no author_id. The member who wrote it is kept in
-- private.page_comment_makers, which only the database reads, so nobody
-- outside the team can tell from the data which member wrote it.
--
-- Where a page may comment (private.can_comment_as_page): its own posts, and
-- posts that mention it in the caption or in any comment, as long as the
-- post's author and the page haven't blocked each other either way. Who: the
-- same people who can post as the page (a managed page with a logo that
-- isn't suspended, disputed or closed; the member in good standing).
--
-- The page's inbox (private.page_inbox_rows): @mentions as before, plus
-- comments on the page's posts and replies to the page's comments. A mention
-- inside a comment that's already an inbox comment shows once. Members who
-- switched the inbox push on get a page_comment push; it never shows in
-- anyone's bell. Page posts and page comments now record the pages they
-- mention (page_mentions.by_page_id), and the inbox shows the page as the
-- one who mentioned.
--
-- Notifications for comments made as the page come from the page (actor_id
-- empty, page_id set), like tags on page posts.
--
-- Reports on shop page posts, and on comments made as a shop, go to the
-- shop's metro city admin; brand ones go to Rachel. Park and city admins can
-- still hide page posts from the post's own menu. The page's own team can't
-- report its posts or comments. Warn, Suspend and Ban are refused on page
-- content (page tools come with PR 6b); Keep hidden works.
--
-- Where a function below is patched rather than rewritten, pg_temp.patch()
-- replaces one passage of the live definition (spacing may differ) and fails
-- unless that passage is there exactly once.

/* 0. Patching helper --------------------------------------------------------------------- */

create or replace function pg_temp.patch(def text, old_part text, new_part text, what text)
returns text
language plpgsql
as $$
declare
  pat text := regexp_replace(regexp_replace(btrim(old_part), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '\s+', '\\s+', 'g');
  hits integer;
begin
  select count(*) into hits from regexp_matches(def, pat, 'g');
  if hits <> 1 then
    raise exception '%: the passage to patch was found % times', what, hits;
  end if;
  return replace(def, substring(def from pat), new_part);
end $$;

/* 1. Columns ------------------------------------------------------------------------------ */

alter table public.comments add column if not exists page_id uuid references public.pages (id) on delete cascade;
alter table public.comments add column if not exists reply_to_page_id uuid references public.pages (id) on delete set null;
alter table public.comments alter column author_id drop not null;
alter table public.comments drop constraint if exists comments_author_or_page;
alter table public.comments add constraint comments_author_or_page check ((author_id is null) = (page_id is not null));
alter table public.comments drop constraint if exists comments_reply_to_one;
alter table public.comments add constraint comments_reply_to_one check (num_nonnulls(reply_to_user_id, reply_to_page_id) <= 1);
create index if not exists comments_page_idx on public.comments (page_id, created_at desc) where page_id is not null;
create index if not exists comments_reply_to_page_idx on public.comments (reply_to_page_id) where reply_to_page_id is not null;

create table if not exists private.page_comment_makers (
  comment_id uuid primary key references public.comments (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  member_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists page_comment_makers_member_idx on private.page_comment_makers (member_id);
revoke all on private.page_comment_makers from public, anon, authenticated;

-- A page mentioned by another page's post or comment.
alter table public.page_mentions add column if not exists by_page_id uuid references public.pages (id) on delete cascade;
alter table public.page_mentions alter column author_id drop not null;
alter table public.page_mentions drop constraint if exists page_mentions_author_or_page;
alter table public.page_mentions add constraint page_mentions_author_or_page check (num_nonnulls(author_id, by_page_id) = 1);

-- The page that wrote a page_mention or page_comment (page_id is the inbox's page).
alter table public.notifications add column if not exists actor_page_id uuid references public.pages (id) on delete cascade;

/* 2. Helpers ------------------------------------------------------------------------------ */

-- Whether someone wrote this comment as a page, while still on its team.
create or replace function private.made_comment(comment uuid, who uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.page_comment_makers k
     where k.comment_id = comment and k.member_id = who
       and private.page_role_of(k.page_id, who) is not null
  );
$$;

-- Where a page may comment, whoever is asking: its own posts, and posts that
-- mention it in the caption or any comment, unless the post's author and
-- the page have blocked each other.
create or replace function private.page_may_comment_on(page uuid, post uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
     where p.id = post and p.published_at is not null and p.status = 'visible'
       and (p.page_id = page
            or exists (select 1 from public.page_mentions m
                        where m.post_id = p.id and m.page_id = page and m.by_page_id is distinct from page))
       and (p.author_id is null or (
             not exists (select 1 from public.user_page_blocks b where b.user_id = p.author_id and b.page_id = page)
             and not exists (select 1 from public.page_blocks b
                              where b.user_id = p.author_id and b.page_id = page and b.lifted_at is null)))
  );
$$;

-- Whether the caller can comment as this page on this post.
create or replace function private.can_comment_as_page(page uuid, post uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_post_as_page(page)
     and private.page_may_comment_on(page, post)
     and private.can_see_post(post);
$$;

-- Whether a page has blocked this person from commenting on this (page) post.
create or replace function private.page_blocks_commenter(post uuid, who uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
      join public.page_blocks b on b.page_id = p.page_id
     where p.id = post and b.user_id = who and b.lifted_at is null
  );
$$;

-- Pages mentioned by a page's own caption or comment (not itself). Pages
-- can't block each other, so there's nothing else to leave out.
create or replace function private.pages_mentioned_by_page(body text, page uuid)
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
   where pg.id <> page
   limit 10;
$$;

-- Whether a comment goes into this page's inbox as a comment: it's on one of
-- the page's posts, or answers one of the page's comments.
create or replace function private.is_inbox_comment(comment uuid, page uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.comments c
      join public.posts po on po.id = c.post_id
      left join public.comments par on par.id = c.parent_id
     where c.id = comment and c.page_id is distinct from page
       and (po.page_id = page or par.page_id = page or c.reply_to_page_id = page)
  );
$$;

-- Who reviews reports on a page's posts and comments: the shop's metro city
-- admin for a shop, Rachel for a brand (and always Rachel).
create or replace function private.can_review_page_content(page uuid)
returns boolean
language sql stable security definer
set search_path = 'public'
as $$
  select private.is_owner()
      or exists (select 1 from pages p
                  where p.id = page and 'shop' = any (p.roles) and p.metro_area_id is not null
                    and private.has_role('city_admin', p.metro_area_id));
$$;

revoke all on function private.made_comment(uuid, uuid) from public, anon, authenticated;
revoke all on function private.page_may_comment_on(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_comment_as_page(uuid, uuid) from public, anon, authenticated;
revoke all on function private.page_blocks_commenter(uuid, uuid) from public, anon, authenticated;
revoke all on function private.pages_mentioned_by_page(text, uuid) from public, anon, authenticated;
revoke all on function private.is_inbox_comment(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_review_page_content(uuid) from public, anon, authenticated;
grant execute on function private.made_comment(uuid, uuid) to authenticated;
grant execute on function private.can_comment_as_page(uuid, uuid) to authenticated;
grant execute on function private.page_blocks_commenter(uuid, uuid) to authenticated;

/* 3. Access rules on comments ---------------------------------------------------------------- */

drop policy if exists "comment as a page" on public.comments;
create policy "comment as a page" on public.comments for insert to authenticated
  with check (author_id is null and page_id is not null and private.can_comment_as_page(page_id, post_id));

-- A page that blocked a skater: they can't comment on its posts.
drop policy if exists "page blocks stop comments" on public.comments;
create policy "page blocks stop comments" on public.comments as restrictive for insert to authenticated
  with check (author_id is null or not private.page_blocks_commenter(post_id, author_id));

-- Comments made as a page you blocked are hidden from you.
drop policy if exists "read comments" on public.comments;
create policy "read comments" on public.comments for select to authenticated
  using (
    private.can_see_post(post_id)
    and (author_id = (select auth.uid()) or not private.blocked_between(author_id))
    and (page_id is null or private.can_see_page_posts(page_id))
  );

-- Removing: your own comment; any comment on your post; a comment you wrote
-- as a page (while on its team); and, for managers and owners, the page's
-- comments and any comment on the page's posts. Moderators as before.
drop policy if exists "edit or remove comments" on public.comments;
create policy "edit or remove comments" on public.comments for update to authenticated
  using (
    author_id = (select auth.uid())
    or exists (select 1 from posts p where p.id = comments.post_id and p.author_id = (select auth.uid()))
    or private.can_moderate_post(post_id)
    or (page_id is not null and (private.made_comment(id) or private.can_act_as_page(page_id, 'manager')))
    or exists (select 1 from posts p
                where p.id = comments.post_id and p.page_id is not null
                  and private.can_act_as_page(p.page_id, 'manager'))
  )
  with check (true);

/* 4. Writing comments ------------------------------------------------------------------------- */

create or replace function private.guard_comment_write()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  parent comments%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- Deleting erases the text for good, so it can't be read again.
    if old.deleted_at is null and new.deleted_at is not null then
      new.body := '[deleted]';
      return new;
    end if;
    -- Otherwise nothing changes: comments can't be edited.
    if new.body is distinct from old.body
       or new.post_id is distinct from old.post_id
       or new.author_id is distinct from old.author_id
       or new.page_id is distinct from old.page_id
       or new.parent_id is distinct from old.parent_id
       or new.reply_to_user_id is distinct from old.reply_to_user_id
       or new.reply_to_page_id is distinct from old.reply_to_page_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Comments can''t be edited';
    end if;
    return new;
  end if;

  new.body := btrim(new.body);
  if char_length(new.body) = 0 or char_length(new.body) > 1000 then
    raise exception 'Comments are 1 to 1000 characters';
  end if;
  new.created_at := now();
  new.deleted_at := null;

  if new.parent_id is not null then
    select * into parent from comments where id = new.parent_id;
    if not found or parent.post_id <> new.post_id or parent.deleted_at is not null then
      raise exception 'Reply to a comment on this post';
    end if;
  end if;

  if new.reply_to_user_id is not null then
    if new.parent_id is null or not exists (
      select 1 from comments c
       where (c.id = new.parent_id or c.parent_id = new.parent_id)
         and c.author_id = new.reply_to_user_id
         and c.deleted_at is null
    ) then
      raise exception 'You can only reply to someone in this thread';
    end if;
  end if;

  -- Answering a page's comment in the thread.
  if new.reply_to_page_id is not null then
    if new.parent_id is null or not exists (
      select 1 from comments c
       where (c.id = new.parent_id or c.parent_id = new.parent_id)
         and c.page_id = new.reply_to_page_id
         and c.deleted_at is null
    ) then
      raise exception 'You can only reply to someone in this thread';
    end if;
  end if;

  return new;
end $$;

-- Record who wrote a page comment.
create or replace function private.record_page_comment_maker()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.page_id is not null then
    if auth.uid() is null then
      raise exception 'A page comment needs the member who wrote it';
    end if;
    insert into private.page_comment_makers (comment_id, page_id, member_id)
    values (new.id, new.page_id, auth.uid());
  end if;
  return null;
end $$;

drop trigger if exists comments_record_page_maker on public.comments;
create trigger comments_record_page_maker after insert on public.comments
  for each row execute function private.record_page_comment_maker();

/* 5. Reading comments -------------------------------------------------------------------------- */

-- A post's comments, oldest first. Comments made as a page carry the page
-- (and no author); is_poster is true for the page's own comments on its own
-- posts. can_delete and by_my_page save the app from working out the
-- page rules itself.
drop function if exists public.post_comments(uuid);
create function public.post_comments(post uuid)
returns table (
  id uuid,
  parent_id uuid,
  author_id uuid,
  username text,
  avatar_path text,
  body text,
  reply_to_username text,
  is_poster boolean,
  deleted boolean,
  created_at timestamptz,
  page jsonb,
  reply_to_page_id uuid,
  can_delete boolean,
  by_my_page boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.parent_id,
         case when c.deleted_at is null then c.author_id end,
         case when c.deleted_at is null and a.deleted_at is null then a.username::text end,
         case when c.deleted_at is null and a.deleted_at is null then a.avatar_path end,
         case when c.deleted_at is null then c.body end,
         case when c.deleted_at is null then coalesce(case when r.deleted_at is null then r.username::text end, rp.handle::text) end,
         coalesce(c.deleted_at is null
           and ((c.author_id = p.author_id and not p.anonymized) or c.page_id = p.page_id), false),
         c.deleted_at is not null,
         c.created_at,
         case when c.deleted_at is null and cp.id is not null then
           jsonb_build_object('id', cp.id, 'handle', cp.handle::text, 'display_name', cp.display_name,
                              'logo_path', case when cp.state = 'managed' then cp.logo_path end,
                              'state', cp.state::text, 'roles', to_jsonb(cp.roles::text[]))
         end,
         case when c.deleted_at is null then c.reply_to_page_id end,
         coalesce(c.deleted_at is null and (
           c.author_id = auth.uid()
           or p.author_id = auth.uid()
           or (c.page_id is not null and (private.made_comment(c.id) or private.can_act_as_page(c.page_id, 'manager')))
           or (p.page_id is not null and private.can_act_as_page(p.page_id, 'manager'))
         ), false),
         c.page_id is not null and private.page_role_of(c.page_id) is not null
    from comments c
    join posts p on p.id = c.post_id
    left join profiles a on a.id = c.author_id
    left join profiles r on r.id = c.reply_to_user_id
    left join pages cp on cp.id = c.page_id
    left join pages rp on rp.id = c.reply_to_page_id
   where c.post_id = post
     and private.can_see_post(post)
     and (c.author_id = auth.uid() or not private.blocked_between(c.author_id))
     and (c.page_id is null or private.can_see_page_posts(c.page_id))
     and (
       c.deleted_at is null
       or (c.parent_id is null and exists (
             select 1 from comments x
              where x.parent_id = c.id and x.deleted_at is null
                and (x.author_id = auth.uid() or not private.blocked_between(x.author_id))
                and (x.page_id is null or private.can_see_page_posts(x.page_id))
           ))
     )
   order by c.created_at, c.id;
$$;

revoke all on function public.post_comments(uuid) from public, anon;
grant execute on function public.post_comments(uuid) to authenticated;

create or replace function public.comment_count(public.posts)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
    from comments c
   where c.post_id = $1.id
     and c.deleted_at is null
     and (c.author_id = (select auth.uid()) or not private.blocked_between(c.author_id))
     and (c.page_id is null or private.can_see_page_posts(c.page_id));
$$;

-- For the comment box: the pages the caller can comment as on this post.
create or replace function public.comment_as_pages(post uuid)
returns table (page_id uuid, handle text, display_name text, logo_path text, state text, roles text[])
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.handle::text, p.display_name, p.logo_path, p.state::text, p.roles::text[]
    from public.page_members m
    join public.pages p on p.id = m.page_id
   where m.user_id = (select auth.uid())
     and private.can_comment_as_page(p.id, post)
   order by p.display_name;
$$;

revoke all on function public.comment_as_pages(uuid) from public, anon;
grant execute on function public.comment_as_pages(uuid) to authenticated;

/* 6. Notifications for comments ------------------------------------------------------------------ */

-- A comment made as a page tells people as the page (actor_id empty, page_id
-- set). The member who wrote it isn't told; someone who blocked the page, or
-- whom it blocked, isn't either.
create or replace function private.notify_comment_from_page(recipient uuid, post uuid, comment uuid, page uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if recipient is null or recipient = auth.uid() then
    return;
  end if;
  if not exists (select 1 from profiles where id = recipient and deleted_at is null and onboarded_at is not null) then
    return;
  end if;
  if exists (select 1 from user_page_blocks b where b.user_id = recipient and b.page_id = page)
     or exists (select 1 from page_blocks b where b.page_id = page and b.user_id = recipient and b.lifted_at is null) then
    return;
  end if;
  if not private.can_see_post_as(post, recipient) then
    return;
  end if;
  insert into notifications (recipient_id, kind, actor_id, post_id, comment_id, page_id)
  values (recipient, 'comment', null, post, comment, page);
end $$;

-- The inbox push for a comment: to members of each page whose post it's on
-- or whose comment it answers, who switched that page's inbox push on.
create or replace function private.notify_page_inboxes(comment uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  c comments%rowtype;
  post_page uuid;
  parent_page uuid;
begin
  select * into c from comments where id = comment;
  select page_id into post_page from posts where id = c.post_id;
  select page_id into parent_page from comments where id = c.parent_id;
  insert into notifications (recipient_id, kind, actor_id, actor_page_id, page_id, post_id, comment_id, message)
  select m.user_id, 'page_comment', c.author_id, c.page_id, t.pid, c.post_id, c.id, t.what
    from (
      select distinct on (v.pid) v.pid, v.what
        from (values (post_page, 'post', 1), (parent_page, 'reply', 2), (c.reply_to_page_id, 'reply', 3)) as v(pid, what, rank)
       where v.pid is not null and v.pid is distinct from c.page_id
       order by v.pid, v.rank
    ) t
    join page_members m on m.page_id = t.pid
    join profiles r on r.id = m.user_id
    join pages p on p.id = t.pid
   where m.inbox_push
     and m.user_id is distinct from c.author_id
     and m.user_id is distinct from auth.uid()
     and p.state = 'managed'
     and r.deleted_at is null and r.banned_at is null
     and (c.author_id is null or (
           not exists (select 1 from blocks b
                        where (b.blocker_id = m.user_id and b.blocked_id = c.author_id)
                           or (b.blocker_id = c.author_id and b.blocked_id = m.user_id))
           and not exists (select 1 from page_blocks b
                            where b.page_id = t.pid and b.user_id = c.author_id and b.lifted_at is null)))
     and private.can_see_post_as(c.post_id, m.user_id);
end $$;

revoke all on function private.notify_comment_from_page(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.notify_page_inboxes(uuid) from public, anon, authenticated;

create or replace function private.notify_comment()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  done uuid[] := case when new.author_id is null then array[]::uuid[] else array[new.author_id] end;
  person uuid;
begin
  for person in
    select candidate
      from (
        select 1 as rank, (select author_id from posts where id = new.post_id) as candidate
        union all
        select 2, (select author_id from comments where id = new.parent_id)
        union all
        select 3, new.reply_to_user_id
        union all
        select 4, m.id
          from (
            select distinct p.id
              from regexp_matches(new.body, '@([A-Za-z0-9._]{2,30})', 'g') as r(m)
              join profiles p on lower(p.username::text) = lower(r.m[1])
             limit 10
          ) m
      ) c
     where candidate is not null
     order by rank
  loop
    if not person = any (done) then
      if new.page_id is not null then
        perform private.notify_comment_from_page(person, new.post_id, new.id, new.page_id);
      else
        perform private.notify(person, 'comment', new.author_id, new.post_id, new.id);
      end if;
      done := done || person;
    end if;
  end loop;
  -- Comments on a page's post, or answering a page's comment, go to its inbox.
  perform private.notify_page_inboxes(new.id);
  return null;
end $$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function private.notify_comment();

create or replace function private.enqueue_push_notification()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'park_report_accepted', 'caption_mention',
                  'meetup_changed', 'meetup_cancelled', 'meetup_reminder', 'meetup_comment',
                  'page_invite', 'page_claim_approved', 'page_claim_declined', 'page_team_change',
                  'page_claimed', 'suggestion_live', 'page_mention', 'page_comment')
     and exists (select 1 from private.push_devices d where d.user_id = new.recipient_id) then
    insert into private.push_outbox (recipient_id, notification_id) values (new.recipient_id, new.id);
  end if;
  return null;
end $$;

/* 7. Page mentions from pages ---------------------------------------------------------------------- */

create or replace function private.track_caption_page_mentions()
returns trigger
language plpgsql security definer
set search_path to ''
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
  if new.page_id is null then
    delete from public.page_mentions m
     where m.post_id = new.id and m.comment_id is null and m.event_comment_id is null
       and m.page_id not in (select private.pages_mentioned(new.caption, new.author_id));
    insert into public.page_mentions (page_id, author_id, post_id)
    select pid, new.author_id, new.id from private.pages_mentioned(new.caption, new.author_id) as pid
    on conflict do nothing;
  else
    -- A page post's caption: the page is the one who mentioned.
    delete from public.page_mentions m
     where m.post_id = new.id and m.comment_id is null and m.event_comment_id is null
       and m.page_id not in (select private.pages_mentioned_by_page(new.caption, new.page_id));
    insert into public.page_mentions (page_id, by_page_id, post_id)
    select pid, new.page_id, new.id from private.pages_mentioned_by_page(new.caption, new.page_id) as pid
    on conflict do nothing;
  end if;
  return null;
end $$;

create or replace function private.track_comment_page_mentions()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
begin
  if tg_table_name = 'comments' then
    if new.deleted_at is not null then
      delete from public.page_mentions where comment_id = new.id;
    elsif tg_op = 'INSERT' and new.page_id is not null then
      insert into public.page_mentions (page_id, by_page_id, post_id, comment_id)
      select pid, new.page_id, new.post_id, new.id from private.pages_mentioned_by_page(new.body, new.page_id) as pid
      on conflict do nothing;
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

-- The inbox push for a mention. Not for a mention inside a comment the
-- inbox already shows as a comment (that one pushed as page_comment).
create or replace function private.notify_page_mention()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  ev uuid;
begin
  if new.comment_id is not null and private.is_inbox_comment(new.comment_id, new.page_id) then
    return null;
  end if;
  if new.event_comment_id is not null then
    select ec.event_id into ev from event_comments ec where ec.id = new.event_comment_id;
  end if;
  insert into notifications (recipient_id, kind, actor_id, actor_page_id, page_id, post_id, comment_id, event_id, event_comment_id)
  select m.user_id, 'page_mention', new.author_id, new.by_page_id, new.page_id, new.post_id, new.comment_id, ev, new.event_comment_id
    from page_members m
    join profiles r on r.id = m.user_id
    join pages p on p.id = m.page_id
   where m.page_id = new.page_id
     and m.inbox_push
     and m.user_id is distinct from new.author_id
     and m.user_id is distinct from auth.uid()
     and p.state = 'managed'
     and r.deleted_at is null and r.banned_at is null
     and (new.author_id is null or not exists (
           select 1 from blocks b
            where (b.blocker_id = m.user_id and b.blocked_id = new.author_id)
               or (b.blocker_id = new.author_id and b.blocked_id = m.user_id)));
  return null;
end $$;

/* 8. The inbox ---------------------------------------------------------------------------------------- */

-- Everything in a page's inbox as one member sees it: comments on the
-- page's posts ('post_comment'), replies to its comments ('reply'), and
-- @mentions ('caption', 'comment', 'meetup_comment'), from people or pages.
create or replace function private.page_inbox_rows(page uuid, who uuid)
returns table (id uuid, kind text, created_at timestamptz, author_id uuid, author_page_id uuid, body text,
               post_id uuid, comment_id uuid, event_id uuid, event_comment_id uuid)
language sql stable security definer
set search_path = 'public'
as $$
  with targets as (
    select c.id from posts po join comments c on c.post_id = po.id where po.page_id = page
    union
    select c.id from comments par join comments c on c.parent_id = par.id where par.page_id = page
    union
    select c.id from comments c where c.reply_to_page_id = page
  ),
  inbox_comments as (
    select c.id,
           case when po.page_id = page then 'post_comment' else 'reply' end as kind,
           c.created_at, c.author_id, c.page_id as author_page_id, c.body,
           c.post_id, c.id as comment_id, null::uuid as event_id, null::uuid as event_comment_id
      from targets t
      join comments c on c.id = t.id
      join posts po on po.id = c.post_id
     where c.deleted_at is null and c.page_id is distinct from page
  ),
  mentions as (
    select pm.id,
           case when pm.event_comment_id is not null then 'meetup_comment'
                when pm.comment_id is not null then 'comment'
                else 'caption' end,
           pm.created_at, pm.author_id, pm.by_page_id,
           coalesce(ec.body, c.body, po.caption),
           pm.post_id, pm.comment_id, ec.event_id, pm.event_comment_id
      from page_mentions pm
      left join posts po on po.id = pm.post_id
      left join comments c on c.id = pm.comment_id
      left join event_comments ec on ec.id = pm.event_comment_id
     where pm.page_id = page
       and (pm.comment_id is null or pm.comment_id not in (select ic.comment_id from inbox_comments ic))
  ),
  everything as (
    select * from inbox_comments
    union all
    select * from mentions
  )
  select e.id, e.kind, e.created_at, e.author_id, e.author_page_id, e.body,
         e.post_id, e.comment_id, e.event_id, e.event_comment_id
    from everything e
    left join profiles a on a.id = e.author_id
   where (e.author_id is null or (
           a.deleted_at is null and a.banned_at is null
           and not exists (select 1 from page_blocks b
                            where b.page_id = page and b.user_id = e.author_id and b.lifted_at is null)
           and not exists (select 1 from blocks b
                            where (b.blocker_id = who and b.blocked_id = e.author_id)
                               or (b.blocker_id = e.author_id and b.blocked_id = who))))
     and (e.post_id is null or private.can_see_post_as(e.post_id, who))
     and (e.event_id is null or private.can_see_event_as(e.event_id, who));
$$;

revoke all on function private.page_inbox_rows(uuid, uuid) from public, anon, authenticated;

create or replace function private.page_inbox_new(page uuid, who uuid)
returns integer
language sql stable security definer
set search_path = 'public'
as $$
  select count(*)::integer
    from private.page_inbox_rows(page, who) r
   where r.created_at > coalesce((select s.seen_at from page_inbox_seen s where s.page_id = page and s.user_id = who),
                                 (select m.joined_at from page_members m where m.page_id = page and m.user_id = who),
                                 '-infinity')
     and r.author_id is distinct from who;
$$;

drop function if exists public.page_inbox(uuid, integer);
create function public.page_inbox(page uuid, max_rows integer default 100)
returns table (
  id uuid,
  kind text,
  created_at timestamptz,
  unread boolean,
  author_id uuid,
  author_username text,
  author_avatar_path text,
  author_page jsonb,
  body text,
  post_id uuid,
  comment_id uuid,
  event_id uuid,
  event_comment_id uuid,
  event_title text
)
language plpgsql stable security definer
set search_path = 'public'
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  seen timestamptz;
begin
  if private.page_role_of(page) is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select coalesce(s.seen_at, m.joined_at) into seen
    from page_members m
    left join page_inbox_seen s on s.page_id = m.page_id and s.user_id = m.user_id
   where m.page_id = page and m.user_id = me;

  return query
    select r.id, r.kind, r.created_at,
           r.created_at > seen and r.author_id is distinct from me,
           r.author_id, a.username::text, a.avatar_path,
           case when ap.id is not null then
             jsonb_build_object('id', ap.id, 'handle', ap.handle::text, 'display_name', ap.display_name,
                                'logo_path', case when ap.state = 'managed' then ap.logo_path end,
                                'state', ap.state::text)
           end,
           left(r.body, 280),
           r.post_id, r.comment_id, r.event_id, r.event_comment_id,
           coalesce(ev.title, ev.note)::text
      from private.page_inbox_rows(page, me) r
      left join profiles a on a.id = r.author_id
      left join pages ap on ap.id = r.author_page_id
      left join events ev on ev.id = r.event_id
     order by r.created_at desc
     limit greatest(1, least(coalesce(max_rows, 100), 200));
end $$;

revoke all on function public.page_inbox(uuid, integer) from public, anon;
grant execute on function public.page_inbox(uuid, integer) to authenticated;

/* 9. Page blocks: the skater's comments on the page's posts --------------------------------------------- */

create or replace function public.page_block_detail(block uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  b page_blocks%rowtype;
begin
  perform private.require_owner();
  select * into b from page_blocks where id = block;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', b.id,
    'created_at', b.created_at,
    'lifted_at', b.lifted_at,
    'lifted_by', (select u.username::text from profiles u where u.id = b.lifted_by),
    'skater', (select u.username::text from profiles u where u.id = b.user_id),
    'blocked_by', (select u.username::text from profiles u where u.id = b.blocked_by),
    'blocked_by_role', (select m.role::text from page_members m where m.page_id = b.page_id and m.user_id = b.blocked_by),
    'page', private.page_summary(b.page_id),
    'week', (
      select jsonb_build_object('count', count(*), 'by', coalesce(jsonb_agg(by_name), '[]'::jsonb))
        from (
          select u.username::text as by_name
            from page_blocks x left join profiles u on u.id = x.blocked_by
           where x.page_id = b.page_id and x.lifted_at is null and x.created_at > now() - interval '7 days'
        ) w
    ),
    -- The skater's comments on the page's posts and replies to its comments
    -- in the last 30 days (PR 8b).
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'created_at', c.created_at,
               'where', case when po.page_id = b.page_id then 'post' else 'reply' end,
               'text', case when c.deleted_at is null then c.body end,
               'deleted', c.deleted_at is not null
             ) order by c.created_at desc)
        from comments c
        join posts po on po.id = c.post_id
        left join comments par on par.id = c.parent_id
       where c.author_id = b.user_id
         and (po.page_id = b.page_id or par.page_id = b.page_id or c.reply_to_page_id = b.page_id)
         and c.created_at > now() - interval '30 days'
    ), '[]'::jsonb),
    'mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'created_at', pm.created_at,
               'where', case when pm.comment_id is not null then 'comment'
                             when pm.event_comment_id is not null then 'meetup_comment'
                             else 'caption' end,
               'text', coalesce(
                 case when c.deleted_at is not null then null else c.body end,
                 case when ec.deleted_at is not null then null else ec.body end,
                 case when pm.comment_id is null and pm.event_comment_id is null then po.caption end),
               'deleted', coalesce(c.deleted_at is not null, false) or coalesce(ec.deleted_at is not null, false)
             ) order by pm.created_at desc)
        from page_mentions pm
        left join comments c on c.id = pm.comment_id
        left join event_comments ec on ec.id = pm.event_comment_id
        left join posts po on po.id = pm.post_id
       where pm.page_id = b.page_id and pm.author_id = b.user_id
         and pm.created_at > now() - interval '30 days'
         and (pm.comment_id is null or not private.is_inbox_comment(pm.comment_id, b.page_id))
    ), '[]'::jsonb)
  );
end $$;

/* 10. Reports ------------------------------------------------------------------------------------------- */

create or replace function private.can_moderate_report_target(post uuid, comment uuid, meetup uuid, meetup_comment uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select case
    when post is not null then
      case when (select p.page_id from posts p where p.id = post) is not null
           then private.can_review_page_content((select p.page_id from posts p where p.id = post))
           else private.can_moderate_post(post) end
    when comment is not null then
      case when (select c.page_id from comments c where c.id = comment) is not null
           then private.can_review_page_content((select c.page_id from comments c where c.id = comment))
           else private.can_moderate_post((select c.post_id from comments c where c.id = comment)) end
    when meetup is not null then private.can_moderate_park((select e.park_id from events e where e.id = meetup))
    when meetup_comment is not null then private.can_moderate_park((
      select e.park_id from event_comments c join events e on e.id = c.event_id where c.id = meetup_comment))
    else false
  end;
$$;

do $patch$
declare
  def text;
begin
  -- file_report: the page's own team can't report its posts or comments.
  def := pg_get_functiondef('public.file_report(uuid, uuid, uuid, public.report_reason, text, uuid, uuid, uuid)'::regprocedure);
  def := pg_temp.patch(def,
    $o$  if target_user = me then
    raise exception 'cannot_report_yourself' using errcode = '22023';
  end if;$o$,
    $n$  if target_user = me then
    raise exception 'cannot_report_yourself' using errcode = '22023';
  end if;
  if (post is not null and exists (select 1 from posts p
                                    where p.id = post and p.page_id is not null
                                      and private.page_role_of(p.page_id) is not null))
     or (comment is not null and c.page_id is not null and private.page_role_of(c.page_id) is not null) then
    raise exception 'cannot_report_yourself' using errcode = '22023';
  end if;$n$, 'file_report');
  execute def;

  -- moderate_reports: page content has no person to warn, suspend or ban,
  -- and nobody to tell when it's kept hidden.
  def := pg_get_functiondef('public.moderate_reports(text, uuid, text, text, integer, boolean)'::regprocedure);
  def := pg_temp.patch(def,
    $o$  if decision in ('warn', 'suspend', 'ban') and person = me then$o$,
    $n$  if decision in ('warn', 'suspend', 'ban') and person is null then
    raise exception 'page_content' using errcode = '22023';
  end if;
  if decision in ('warn', 'suspend', 'ban') and person = me then$n$, 'moderate_reports (person)');
  def := pg_temp.patch(def,
    $o$  if decision = 'keep_hidden' and target_kind <> 'meetup' then$o$,
    $n$  if decision = 'keep_hidden' and target_kind <> 'meetup' and person is not null then$n$,
    'moderate_reports (notice)');
  execute def;

  -- moderation_report_detail: the page behind a page post or comment, and
  -- (for Rachel) the member who made it.
  def := pg_get_functiondef('public.moderation_report_detail(text, uuid)'::regprocedure);
  def := pg_temp.patch(def,
    $o$  return result;
end;$o$,
    $n$  result := result || jsonb_build_object(
    'page', case when target_kind = 'post' and post_row.page_id is not null then private.page_summary(post_row.page_id)
                 when target_kind = 'comment' and c.page_id is not null then private.page_summary(c.page_id) end,
    'post_page', case when post_row.page_id is not null then
                   (select jsonb_build_object('handle', pp.handle::text, 'display_name', pp.display_name)
                      from pages pp where pp.id = post_row.page_id) end,
    'made_by', case when private.is_owner() then
                 case when target_kind = 'post' and post_row.page_id is not null then
                        (select u.username::text from private.page_post_makers k join profiles u on u.id = k.member_id
                          where k.post_id = post_row.id)
                      when target_kind = 'comment' and c.page_id is not null then
                        (select u.username::text from private.page_comment_makers k join profiles u on u.id = k.member_id
                          where k.comment_id = c.id) end end);
  return result;
end;$n$, 'moderation_report_detail');
  execute def;

  -- moderation_queue: report rows on page posts and page comments carry the
  -- page; a shop's are filed under its metro area; a brand's are Sent to you.
  def := pg_get_functiondef('public.moderation_queue(uuid)'::regprocedure);
  def := pg_temp.patch(def,
    $o$left join profiles u on u.id = g.person$o$,
    $n$left join profiles u on u.id = g.person
      left join pages pp on pp.id = case g.tkind when 'post' then po.page_id
                                                  when 'comment' then (select cc.page_id from comments cc where cc.id = g.tid) end$n$,
    'moderation_queue (join)');
  def := pg_temp.patch(def,
    $o$coalesce(po.metro_area_id, pk.metro_area_id, u.home_metro_area_id) as mid,$o$,
    $n$coalesce(case when 'shop' = any (pp.roles) then pp.metro_area_id end,
                    po.metro_area_id, pk.metro_area_id, u.home_metro_area_id) as mid,$n$,
    'moderation_queue (metro)');
  def := pg_temp.patch(def,
    $o$when owner and (g.escalated or g.owner_only or g.tkind = 'person') then 'sent_to_you'$o$,
    $n$when owner and (g.escalated or g.owner_only or g.tkind = 'person'
                             or (pp.id is not null and not ('shop' = any (pp.roles)))) then 'sent_to_you'$n$,
    'moderation_queue (sent to you)');
  def := pg_temp.patch(def,
    $o$null::uuid as pgid, null::text as pgname, null::text as pghandle, null::text[] as pgroles,
           null::text as pgplace, null::boolean as flg$o$,
    $n$pp.id as pgid, pp.display_name::text as pgname, pp.handle::text as pghandle, pp.roles::text[] as pgroles,
           coalesce(pp.city, pp.country::text) as pgplace, null::boolean as flg$n$,
    'moderation_queue (page columns)');
  execute def;
end
$patch$;

/* 11. The bell and pushes --------------------------------------------------------------------------------- */

do $patch$
declare
  def text;
begin
  -- my_notifications: comments made as a page carry the page as the actor,
  -- also when grouped per post ("8SET and mari.rolls commented").
  def := pg_get_functiondef('public.my_notifications()'::regprocedure);
  def := pg_temp.patch(def,
    $o$left join pages pa on pa.id = n.page_id and n.kind in ('tag', 'filmer_credit', 'caption_mention')$o$,
    $n$left join pages pa on pa.id = n.page_id and n.kind in ('tag', 'filmer_credit', 'caption_mention', 'comment')$n$,
    'my_notifications (page join)');
  def := pg_temp.patch(def,
    $o$(select jsonb_agg(jsonb_build_object('id', x.actor_id, 'username', x.actor_username, 'avatar_path', x.actor_avatar)
                             order by x.at desc)
              from (select t2.actor_id, max(t2.actor_username) as actor_username, max(t2.actor_avatar) as actor_avatar,
                           max(t2.created_at) as at
                      from typed t2
                     where t2.shown_kind = 'comment' and t2.post_id = t.post_id
                     group by t2.actor_id$o$,
    $n$(select jsonb_agg(coalesce(x.page_actor, jsonb_build_object('id', x.actor_id, 'username', x.actor_username, 'avatar_path', x.actor_avatar))
                             order by x.at desc)
              from (select t2.actor_id, max(t2.actor_username) as actor_username, max(t2.actor_avatar) as actor_avatar,
                           (array_agg(t2.page_actor))[1] as page_actor,
                           max(t2.created_at) as at
                      from typed t2
                     where t2.shown_kind = 'comment' and t2.post_id = t.post_id
                     group by t2.actor_id, t2.page_actor->'page'->>'id'$n$,
    'my_notifications (grouped people)');
  def := pg_temp.patch(def,
    $o$count(distinct t.actor_id)::integer as people_count,
           t.post_id as gpost,$o$,
    $n$count(distinct coalesce(t.actor_id::text, t.page_actor->'page'->>'id'))::integer as people_count,
           t.post_id as gpost,$n$,
    'my_notifications (grouped count)');
  execute def;

  -- push_claim: page_comment pushes like page_mention, and a page that
  -- mentions or comments is named in the push.
  def := pg_get_functiondef('public.push_claim(integer)'::regprocedure);
  def := pg_temp.patch(def,
    $o$when n.kind = 'page_mention' then coalesce(ec.body, c.body, p.caption)$o$,
    $n$when n.kind in ('page_mention', 'page_comment') then coalesce(ec.body, c.body, p.caption)$n$,
    'push_claim (body)');
  def := pg_temp.patch(def,
    $o$and (n.kind <> 'page_mention' or ($o$,
    $n$and (n.kind not in ('page_mention', 'page_comment') or ($n$,
    'push_claim (inbox switch)');
  def := pg_temp.patch(def,
    $o$when 'page_mention' then true$o$,
    $n$when 'page_mention' then true
                 when 'page_comment' then true$n$,
    'push_claim (settings)');
  def := pg_temp.patch(def,
    $o$a.username::text as uname,$o$,
    $n$coalesce(a.username::text, ap.display_name::text) as uname,$n$,
    'push_claim (name)');
  def := pg_temp.patch(def,
    $o$left join pages pg on pg.id = n.page_id$o$,
    $n$left join pages pg on pg.id = n.page_id
      left join pages ap on ap.id = n.actor_page_id$n$,
    'push_claim (actor page)');
  def := pg_temp.patch(def,
    $o$'page_invite')
                then n.message end as edetail,$o$,
    $n$'page_invite', 'page_comment')
                then n.message end as edetail,$n$,
    'push_claim (detail)');
  execute def;
end
$patch$;

/* Checks ------------------------------------------------------------------------------------------------ */

-- A post made and published the way the app does it, as `maker` (a person,
-- or a member posting as `pg`). Runs as the table owner with the member's
-- claims set, so auth.uid() is the member.
create function pg_temp.make_post(maker uuid, pg uuid, park uuid, cap text)
returns uuid
language plpgsql
as $f$
declare
  post uuid := gen_random_uuid();
  slide uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('sub', maker, 'role', 'authenticated')::text, true);
  insert into public.posts (id, author_id, page_id, park_id, caption, slide_count)
  values (post, case when pg is null then maker end, pg, park, cap, 1);
  insert into public.post_slides (id, post_id, position, kind, width, height, storage_path, upload_status)
  values (slide, post, 0, 'photo', 1080, 1350,
          case when pg is null then maker::text else 'page/' || pg end || '/' || post || '/' || slide || '.jpg', 'uploading');
  update public.post_slides set upload_status = 'ready' where id = slide;
  perform set_config('request.jwt.claims', '', true);
  return post;
end $f$;

-- A comment made through the access rules, as `who`: as themselves, or as
-- page `pg`. Returns its id; raises what the rules raise.
create function pg_temp.comment(who uuid, pg uuid, post uuid, body text,
                                parent uuid default null, to_page uuid default null)
returns uuid
language plpgsql
as $f$
declare
  id uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.comments (id, post_id, author_id, page_id, body, parent_id, reply_to_page_id)
  values (id, post, case when pg is null then who end, pg, body, parent, to_page);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return id;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise;
end $f$;

do $$
declare
  r text := '';
  ok int := 0; total int := 0;
  eightset uuid := (select id from public.pages where handle = '8set_store');          -- shop and brand, Copenhagen
  bos uuid := (select id from public.pages where handle = 'bos_bootsonwheels');       -- a shop in San Diego
  them uuid := (select id from public.pages where handle = 'themskates');             -- a brand
  cph uuid := (select metro_area_id from public.pages where handle = '8set_store');
  prags uuid := (select id from public.parks where slug = 'prags-boulevard-cph');
  o uuid := gen_random_uuid();   -- owns 8SET, Bo's and Them
  m uuid := gen_random_uuid();   -- manager on 8SET, inbox push on
  s uuid := gen_random_uuid();   -- staff on 8SET, comments as it
  x uuid := gen_random_uuid();   -- a skater
  y uuid := gen_random_uuid();   -- another skater
  b uuid := gen_random_uuid();   -- blocked 8SET
  w uuid := gen_random_uuid();   -- 8SET blocked them
  ca uuid := gen_random_uuid();  -- Copenhagen city admin
  rach uuid := gen_random_uuid(); -- a throwaway owner (Rachel's role)
  u uuid;
  p_page uuid; p_brand uuid; p_x uuid; p_y uuid; p_plain uuid; p_w uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid;
  blk uuid;
  n int;
  j jsonb;
  rec record;
begin
  foreach u in array array[o, m, s, x, y, b, w, ca, rach] loop
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'page-comments-check-' || u || '@example.com', now(), now(), '{}'::jsonb);
    insert into public.profiles (id) values (u) on conflict (id) do nothing;
    update public.profiles set onboarded_at = now(), age_confirmed_at = now(),
      disciplines = '{inline}', home_metro_area_id = cph,
      username = 'pccheck' || left(replace(u::text, '-', ''), 8) where id = u;
  end loop;
  insert into public.role_assignments (user_id, role, metro_area_id, accepted_at) values (ca, 'city_admin', cph, now());
  insert into public.role_assignments (user_id, role, accepted_at) values (rach, 'owner', now());

  perform private.make_page_owner(eightset, o, null);
  perform private.make_page_owner(bos, o, null);
  perform private.make_page_owner(them, o, null);
  insert into public.page_members (page_id, user_id, role, inbox_push) values (eightset, m, 'manager', true), (eightset, s, 'staff', false);
  update public.page_members set inbox_push = true where page_id = bos and user_id = o;
  update public.pages set logo_path = id || '/logo.png' where id in (eightset, bos, them);
  insert into public.user_page_blocks (user_id, page_id) values (b, eightset);
  insert into public.page_blocks (page_id, user_id, blocked_by) values (eightset, w, o) returning id into blk;
  update public.page_members set joined_at = now() - interval '1 day' where user_id in (o, m, s);
  insert into private.push_devices (token, user_id, platform) values ('ExponentPushToken[pccheck-m]', m, 'ios');

  p_page := pg_temp.make_post(s, eightset, prags, 'Sunday at Prags. Thanks @bos_bootsonwheels');
  p_brand := pg_temp.make_post(o, them, null, 'new 909s');
  p_x := pg_temp.make_post(x, null, prags, 'new frames from @8set_store');
  p_y := pg_temp.make_post(y, null, prags, 'where do I get these?');
  p_plain := pg_temp.make_post(x, null, prags, 'just skating');
  p_w := pg_temp.make_post(w, null, prags, 'session');

  /* Who may comment as the page --------------------------------------------------------------------------- */
  total := total + 1;
  begin
    c1 := pg_temp.comment(s, eightset, p_page, 'first Sunday of December');
    ok := ok + 1;
  exception when others then r := r || 'FAIL own post: ' || sqlerrm || '; '; end;

  total := total + 1;
  if (select author_id is null and page_id = eightset from public.comments where id = c1)
     and exists (select 1 from private.page_comment_makers k where k.comment_id = c1 and k.member_id = s)
  then ok := ok + 1; else r := r || 'FAIL author hidden and maker kept; '; end if;

  total := total + 1;
  begin
    c2 := pg_temp.comment(s, eightset, p_x, 'come by the shop @' || (select username from public.profiles where id = y));
    ok := ok + 1;
  exception when others then r := r || 'FAIL caption mention: ' || sqlerrm || '; '; end;

  total := total + 1;
  begin
    perform pg_temp.comment(s, eightset, p_plain, 'unasked');
    r := r || 'FAIL commented without a mention; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  -- y's post mentions 8SET only in x's comment.
  perform pg_temp.comment(x, null, p_y, '@8set_store do you have this?');
  total := total + 1;
  begin
    c3 := pg_temp.comment(s, eightset, p_y, 'yes, in the shop');
    ok := ok + 1;
  exception when others then r := r || 'FAIL comment mention: ' || sqlerrm || '; '; end;

  -- 8SET blocked w: someone else mentions 8SET under w's post, and the page still can't comment.
  perform pg_temp.comment(y, null, p_w, 'that''s @8set_store gear');
  total := total + 1;
  begin
    perform pg_temp.comment(s, eightset, p_w, 'hi');
    r := r || 'FAIL commented on a blocked skater''s post; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform pg_temp.comment(x, eightset, p_page, 'not on the team');
    r := r || 'FAIL a stranger commented as 8SET; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform pg_temp.comment(w, null, p_page, 'blocked skater');
    r := r || 'FAIL page-blocked skater commented on its post; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  if (select count(*) from public.comment_as_pages(p_y)) = 1 and not exists (select 1 from public.comment_as_pages(p_plain))
  then ok := ok + 1; else r := r || 'FAIL comment_as_pages; '; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  /* Notifications come from the page ---------------------------------------------------------------------- */
  total := total + 1;
  if exists (select 1 from public.notifications where recipient_id = x and kind = 'comment' and comment_id = c2
               and actor_id is null and page_id = eightset)
     and exists (select 1 from public.notifications where recipient_id = y and kind = 'comment' and comment_id = c2)
     and not exists (select 1 from public.notifications where recipient_id = s and comment_id = c2)
  then ok := ok + 1; else r := r || 'FAIL comment notifications from the page; '; end if;

  -- y's post: x and 8SET both commented, grouped in y's bell with the page as an actor.
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  select * into rec from public.my_notifications() t where t.kind = 'comment' and t.post_id = p_y;
  if rec.actor_count = 2 and exists (select 1 from jsonb_array_elements(rec.actors) e where e -> 'page' ->> 'handle' = '8set_store')
  then ok := ok + 1; else r := r || 'FAIL grouped bell row: ' || coalesce(rec.actors::text, 'none') || '; '; end if;
  execute 'reset role';

  /* The inbox ------------------------------------------------------------------------------------------------ */
  c4 := pg_temp.comment(x, null, p_page, 'doing this again next month? @8set_store');
  c5 := pg_temp.comment(x, null, p_x, 'see you there', c2, eightset);

  total := total + 1;
  if (select count(*) from public.notifications where recipient_id = m and kind = 'page_comment' and comment_id in (c4, c5)) = 2
     and not exists (select 1 from public.notifications where kind = 'page_mention' and comment_id = c4)
     and not exists (select 1 from public.notifications where recipient_id = s and kind = 'page_comment')
     and (select message from public.notifications where recipient_id = m and kind = 'page_comment' and comment_id = c5) = 'reply'
  then ok := ok + 1; else r := r || 'FAIL inbox pushes; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  total := total + 1;
  if (select count(*) from public.page_inbox(eightset) i where i.comment_id = c4) = 1
     and (select kind from public.page_inbox(eightset) i where i.comment_id = c4) = 'post_comment'
     and (select kind from public.page_inbox(eightset) i where i.comment_id = c5) = 'reply'
     and not exists (select 1 from public.page_inbox(eightset) i where i.comment_id = c1)
  then ok := ok + 1; else r := r || 'FAIL inbox rows; '; end if;

  total := total + 1;
  if (select inbox_new from public.my_pages() where page_id = eightset) >= 3 then ok := ok + 1;
  else r := r || 'FAIL inbox count; '; end if;

  -- 8SET's caption mentioned Bo's: Bo's inbox shows 8SET as the one who mentioned.
  total := total + 1;
  if exists (select 1 from public.page_inbox(bos) i
              where i.kind = 'caption' and i.post_id = p_page and i.author_id is null
                and i.author_page ->> 'handle' = '8set_store')
  then ok := ok + 1; else r := r || 'FAIL page mention from a page post; '; end if;
  execute 'reset role';

  total := total + 1;
  if exists (select 1 from public.notifications where recipient_id = o and kind = 'page_mention' and page_id = bos
               and actor_page_id = eightset and post_id = p_page)
  then ok := ok + 1; else r := r || 'FAIL page mention push from a page; '; end if;

  /* The comment list ------------------------------------------------------------------------------------------- */
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into rec from public.post_comments(p_x) t where t.id = c2;
  total := total + 1;
  if rec.author_id is null and rec.page ->> 'handle' = '8set_store' and rec.can_delete and not rec.by_my_page and not rec.is_poster
  then ok := ok + 1; else r := r || 'FAIL page comment row for the post author; '; end if;
  select * into rec from public.post_comments(p_x) t where t.id = c5;
  total := total + 1;
  if rec.reply_to_username = '8set_store' and rec.reply_to_page_id = eightset then ok := ok + 1;
  else r := r || 'FAIL reply to a page; '; end if;
  select * into rec from public.post_comments(p_page) t where t.id = c1;
  total := total + 1;
  if rec.is_poster and not rec.can_delete then ok := ok + 1; else r := r || 'FAIL poster label on a page post; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  select * into rec from public.post_comments(p_x) t where t.id = c2;
  total := total + 1;
  if rec.can_delete and rec.by_my_page then ok := ok + 1; else r := r || 'FAIL maker''s view; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  total := total + 1;
  if not exists (select 1 from public.post_comments(p_y) t where t.id = c3)
     and not exists (select 1 from public.comments where id = c3)
     and (select public.comment_count(p.*) from public.posts p where p.id = p_y) = 1
  then ok := ok + 1; else r := r || 'FAIL page comments hidden from someone who blocked the page; '; end if;

  /* Removing ------------------------------------------------------------------------------------------------------ */
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  update public.comments set deleted_at = now() where id = c2;
  total := total + 1;
  if (select deleted_at is null from public.comments where id = c2) then ok := ok + 1;
  else r := r || 'FAIL stranger removed a page comment; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  update public.comments set deleted_at = now() where id = c4;
  total := total + 1;
  execute 'reset role';
  if (select deleted_at is not null from public.comments where id = c4) then ok := ok + 1;
  else r := r || 'FAIL manager removed a comment on the page''s post; '; end if;

  /* Reports -------------------------------------------------------------------------------------------------------- */
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.file_report(p_page, null, null, 'spam', null, null, null, null);
    r := r || 'FAIL the team reported its own post; ';
  exception when others then
    if sqlerrm = 'cannot_report_yourself' then ok := ok + 1; else r := r || 'FAIL team report: ' || sqlerrm || '; '; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.file_report(p_page, null, null, 'spam', null, null, null, null);
    perform public.file_report(null, c3, null, 'spam', null, null, null, null);
    perform public.file_report(p_brand, null, null, 'spam', null, null, null, null);
    ok := ok + 1;
  exception when others then r := r || 'FAIL reporting page content: ' || sqlerrm || '; '; end;

  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);
  total := total + 1;
  if exists (select 1 from public.moderation_queue() q where q.id = p_page and q.page_handle = '8set_store')
     and exists (select 1 from public.moderation_queue() q where q.id = c3 and q.page_handle = '8set_store')
     and not exists (select 1 from public.moderation_queue() q where q.id = p_brand)
  then ok := ok + 1; else r := r || 'FAIL city admin queue; '; end if;

  total := total + 1;
  begin
    perform public.moderate_reports('post', p_page, 'warn', 'stop', null, false);
    r := r || 'FAIL warned page content; ';
  exception when others then
    if sqlerrm = 'page_content' then ok := ok + 1; else r := r || 'FAIL warn: ' || sqlerrm || '; '; end if;
  end;

  total := total + 1;
  begin
    perform public.moderate_reports('post', p_page, 'keep_hidden', null, null, true);
    ok := ok + 1;
  exception when others then r := r || 'FAIL keep hidden: ' || sqlerrm || '; '; end;

  perform set_config('request.jwt.claims', json_build_object('sub', rach, 'role', 'authenticated')::text, true);
  total := total + 1;
  if (select q.state from public.moderation_queue() q where q.id = p_brand) = 'sent_to_you'
     and (public.moderation_report_detail('comment', c3) ->> 'made_by') = (select username::text from public.profiles where id = s)
     and (public.moderation_report_detail('comment', c3) -> 'page' ->> 'handle') = '8set_store'
  then ok := ok + 1; else r := r || 'FAIL owner queue and detail; '; end if;

  total := total + 1;
  j := public.page_block_detail(blk);
  if jsonb_typeof(j -> 'comments') = 'array' then ok := ok + 1; else r := r || 'FAIL page block detail; '; end if;
  execute 'reset role';

  /* Pushes ------------------------------------------------------------------------------------------------------ */
  total := total + 1;
  n := 0;
  for rec in select * from public.push_claim(500) loop
    if rec.kind = 'page_comment' and rec.detail = 'reply' and rec.page_name = (select display_name from public.pages where id = eightset)
       and rec.send then n := n + 1; end if;
  end loop;
  if n = 1 then ok := ok + 1; else r := r || 'FAIL push_claim for page_comment (' || n || '); '; end if;

  raise exception 'CHECK % of %: %', ok, total, r;
end $$;
rollback;
