-- Rolled-back check for 20261105010100_page_tools (the enums, 20261105010000_page_tools_enums,
-- are applied first). Runs the migration and the checks in one transaction, then
-- raises CHECK <ok> of <total>: <failures>, so nothing is kept. The checks run as
-- throwaway members made in the transaction: a page's team, followers, a skater
-- with a claim, and a throwaway admin with the owner role (Rachel's tools).
begin;
-- Brand and shop accounts part A, PR 6b: Rachel's page tools.
-- PRD: Grindylocks — Brand and Shop Accounts PRD › Web admin › Rachel's page
-- tools; Moderation; Renames, merges and splits; Teams. Mockups: the
-- "Rachel's page tools (PR 6b, web admin)" row of the Brand accounts (v2)
-- page (Admin-Pages, Admin-Page-Suspend, -Transfer, -Rename, -Merge,
-- -Split, -Close, and Page-Suspended on the phone).
--
-- Every tool is Rachel's only (private.require_owner()) and is logged in
-- moderation_actions with the page, so the page's History in the web admin
-- shows it. Teams hear about a tool through page_team_change in their bell,
-- with a detail string, as role changes do:
--   suspended, suspension_lifted, renamed:<old name>, merged:<old name>,
--   closed, reopened; a transfer reuses owner, role:manager and removed.
--
--  1. page_aliases.formerly: an old name kept for the handle redirect only
--     (Rename's "Keep as a Formerly name", unticked) isn't shown or searched.
--  2. Pages: admin_pages() for the list, admin_page_detail() for the pane
--     (with the History), admin_handle_check() for the live handle check,
--     merge_preview() for the Merge dialog.
--  3. suspend_page() / lift_page_suspension(): read-only until lifted, with
--     a reason the team sees (page_suspension_notice()), optionally hiding
--     the page's posts from the last 7 days (lifting brings back the ones it
--     hid). Cancelling upcoming meetups waits for PR 9 (pages can't host yet).
--  4. admin_transfer_page(): at once, no Accept step; on a disputed (frozen)
--     page it closes the dispute and unfreezes it.
--  5. admin_rename_page(): the handle trigger already keeps the 90-day
--     redirect and the old name; this decides whether the old name shows.
--  6. merge_pages(): every foreign key to pages is handled, and the function
--     refuses to run if one isn't (private.unhandled_page_references()).
--  7. split_page(): a new Unofficial page, product trees moved with their
--     IDs, and a one-time page_split notice to the old page's followers.
--  8. admin_close_page() / reopen_page(): Retired (with the years) or Closed;
--     reopening goes back to managed with an owner, else Unofficial.
--  9. The bell: my_page_notifications() gains page_split and whether you
--     follow the page (dropped and created again with the new column).
--     search_pages() leaves out old names that aren't Formerly names.
--
-- Patched (pg_temp.patch, one passage each): private.guard_post_fields() and
-- private.guard_comment_write() let these tools move a page's posts and
-- comments and hide its posts, through a transaction-local setting
-- (grindylocks.page_tools), like grindylocks.publishing.
--
-- Additive otherwise: a column, functions and grants.

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

-- False: the old name is kept only so the old handle redirects; it isn't
-- shown as "Formerly …" and Search doesn't match it.
alter table public.page_aliases add column if not exists formerly boolean not null default true;

/* 2. Guards let the page tools through --------------------------------------------------- */

do $$
declare
  def text := pg_get_functiondef('private.guard_post_fields()'::regprocedure);
begin
  def := pg_temp.patch(def,
    'auto_hiding boolean :=',
    'page_tools boolean := coalesce(current_setting(''grindylocks.page_tools'', true), '''') = ''on'';
  auto_hiding boolean :=',
    'guard_post_fields: declare');
  def := pg_temp.patch(def,
    'or new.page_id is distinct from old.page_id',
    'or (new.page_id is distinct from old.page_id and not page_tools)',
    'guard_post_fields: page_id');
  def := pg_temp.patch(def,
    'if not (is_mod or auto_hiding or',
    'if not (is_mod or page_tools or auto_hiding or',
    'guard_post_fields: status');
  execute def;

  def := pg_get_functiondef('private.guard_comment_write()'::regprocedure);
  def := pg_temp.patch(def,
    'or new.page_id is distinct from old.page_id',
    'or (new.page_id is distinct from old.page_id and coalesce(current_setting(''grindylocks.page_tools'', true), '''') <> ''on'')',
    'guard_comment_write: page_id');
  def := pg_temp.patch(def,
    'or new.reply_to_page_id is distinct from old.reply_to_page_id',
    'or (new.reply_to_page_id is distinct from old.reply_to_page_id and coalesce(current_setting(''grindylocks.page_tools'', true), '''') <> ''on'')',
    'guard_comment_write: reply_to_page_id');
  execute def;
end $$;

/* 3. Helpers ------------------------------------------------------------------------------ */

-- A notice to everyone on a page's team, in their bell (page_team_change).
create or replace function private.notify_page_team(page uuid, detail text)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  m record;
  n integer := 0;
begin
  for m in select pm.user_id from page_members pm where pm.page_id = page loop
    perform private.notify_page(m.user_id, 'page_team_change', page, null, detail);
    n := n + 1;
  end loop;
  return n;
end $$;

-- One line in the page's History.
create or replace function private.log_page_tool(
  what text,
  page uuid,
  msg text default null,
  snap jsonb default null,
  target_user uuid default null,
  subject uuid default null
)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  insert into moderation_actions (actor_id, action, page_id, message, snapshot, target_user_id, subject_id)
  values (auth.uid(), what, page, msg, snap, target_user, subject);
end $$;

-- What a handle check says: ok, invalid, official, username, page or held
-- (a member's old username, or another page's old handle, still held).
-- `page`: the page being renamed, whose own old handles it may take back.
create or replace function public.admin_handle_check(handle text, page uuid default null)
returns text
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  h text := btrim(ltrim(btrim(coalesce(handle, '')), '@'));
begin
  perform private.require_owner();
  if h !~ '^[a-zA-Z0-9_.]{2,30}$' then
    return 'invalid';
  end if;
  if position('official' in lower(h)) > 0 then
    return 'official';
  end if;
  if exists (select 1 from pages p where p.handle operator(extensions.=) h::citext and p.id is distinct from page) then
    return 'page';
  end if;
  if exists (select 1 from profiles u where u.username operator(extensions.=) h::citext) then
    return 'username';
  end if;
  if exists (
       select 1 from page_aliases a
        where a.handle operator(extensions.=) h::citext and a.redirect_until > now() and a.page_id is distinct from page
     )
     or exists (
       select 1 from reserved_usernames r where r.username operator(extensions.=) h::citext and r.reserved_until > now()
     ) then
    return 'held';
  end if;
  return 'ok';
end $$;

-- Refuses a handle the check doesn't call ok, with its answer as the message.
create or replace function private.require_free_handle(h text, page uuid default null)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  verdict text := public.admin_handle_check(h, page);
begin
  if verdict in ('invalid', 'official') then
    raise exception using errcode = '22023', message = 'invalid_handle', detail = verdict;
  elsif verdict <> 'ok' then
    raise exception using errcode = '23505', message = 'handle_taken', detail = verdict;
  end if;
  return btrim(ltrim(btrim(h), '@'));
end $$;

-- A year for the tape: 2014, or c. 2024 when it's approximate.
create or replace function private.clean_year_label(label text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(label, '')), '');
begin
  if v is null then
    return null;
  end if;
  v := regexp_replace(v, '^[cC]\.?\s*', 'c. ');
  if v !~ '^(c\. )?[12][0-9]{3}$' then
    raise exception using errcode = '22023', message = 'invalid_years';
  end if;
  return v;
end $$;

revoke all on function private.notify_page_team(uuid, text) from public, anon, authenticated;
revoke all on function private.log_page_tool(text, uuid, text, jsonb, uuid, uuid) from public, anon, authenticated;
revoke all on function private.require_free_handle(text, uuid) from public, anon, authenticated;
revoke all on function private.clean_year_label(text) from public, anon, authenticated;

/* 4. The Pages list and pane --------------------------------------------------------------- */

-- Every page, for Rachel's Pages list: search by name, handle and old names
-- (Formerly or not), and a type filter (brand or shop). The tabs and their
-- counts are worked out from these rows. Managed first, then unofficial,
-- name-only and the archives, each by name.
create or replace function public.admin_pages(q text default null, kind text default null)
returns table (
  id uuid,
  display_name text,
  handle text,
  roles text[],
  state text,
  city text,
  country text,
  has_logo boolean,
  suspended_at timestamptz,
  frozen boolean,
  founded_label text,
  ended_label text,
  closed_at timestamptz,
  team_count integer,
  owner_username text,
  followers integer,
  open_claims integer,
  matched_alias text
)
language plpgsql stable security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  needle text := private.fold(regexp_replace(btrim(coalesce(q, '')), '^@+', ''));
begin
  perform private.require_owner();
  return query
    with hits as (
      select p.*,
             (select a.name from page_aliases a
               where a.page_id = p.id and needle <> ''
                 and (position(needle in private.fold(a.name)) > 0
                      or (a.handle is not null and position(needle in private.fold(a.handle::text)) > 0))
               order by a.created_at desc limit 1) as alias_hit
        from pages p
       where (nullif(kind, '') is null or nullif(kind, '')::page_role = any (p.roles))
    )
    select h.id, h.display_name, h.handle::text, h.roles::text[], h.state::text, h.city, h.country::text,
           h.logo_path is not null, h.suspended_at, h.frozen_at is not null,
           h.founded_label, h.ended_label, h.closed_at,
           (select count(*)::integer from page_members m where m.page_id = h.id),
           (select u.username::text from page_members m join profiles u on u.id = m.user_id
             where m.page_id = h.id and m.role = 'owner'),
           (select count(*)::integer from page_follows f where f.page_id = h.id),
           (select count(*)::integer from page_claims c where c.page_id = h.id and c.status = 'pending'),
           case when needle <> '' and position(needle in private.fold(h.display_name)) = 0
                     and position(needle in private.fold(h.handle::text)) = 0 then h.alias_hit end
      from hits h
     where needle = ''
        or position(needle in private.fold(h.display_name)) > 0
        or position(needle in private.fold(h.handle::text)) > 0
        or h.alias_hit is not null
     order by case h.state when 'managed' then 0 when 'unofficial' then 1 when 'name_only' then 2 else 3 end,
              lower(h.display_name)
     limit 1000;
end $$;

-- A page's product trees: each model with its pro models, collabs and
-- special editions, grouped by family (or the model's name when it has
-- none), for Split's "Products to move".
create or replace function private.page_product_groups(page uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with recursive tree as (
    select p.id, p.id as root
      from products p
     where p.page_id = page
       and (p.base_id is null or not exists (select 1 from products b where b.id = p.base_id and b.page_id = page))
    union all
    select c.id, t.root from products c join tree t on c.base_id = t.id where c.page_id = page
  ),
  groups as (
    select r.part_type, coalesce(r.family, r.name) as label,
           count(*)::integer as n, array_agg(t.id order by t.id) as ids,
           count(distinct t.root)::integer as models
      from tree t join products r on r.id = t.root
     group by r.part_type, coalesce(r.family, r.name)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'part_type', g.part_type, 'label', g.label, 'count', g.n, 'models', g.models, 'ids', to_jsonb(g.ids)
         ) order by pt.sort, lower(g.label)), '[]'::jsonb)
    from groups g join part_types pt on pt.key = g.part_type;
$$;

revoke all on function private.page_product_groups(uuid) from public, anon, authenticated;

-- Everything the pane shows: the page, its team (for Transfer), its names,
-- counts for the dialogs, its product groups (for Split) and its History.
-- The History is every page tool, claim and claim decision, invite and
-- hand-over, and when it went OFFICIAL. Teams never see it.
create or replace function public.admin_page_detail(page uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p pages%rowtype;
begin
  perform private.require_owner();
  select * into p from pages where id = page;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'page', private.page_summary(p.id),
    'logo_path', p.logo_path,
    'metro', (select m.name from metro_areas m where m.id = p.metro_area_id),
    'founding_partner_at', p.founding_partner_at,
    'managed_at', p.managed_at,
    'created_at', p.created_at,
    'suspended_at', p.suspended_at,
    'suspended_reason', p.suspended_reason,
    'frozen_at', p.frozen_at,
    'closed_at', p.closed_at,
    'founded_label', p.founded_label,
    'ended_label', p.ended_label,
    'needs_translations', p.needs_translations_at is not null,
    'products', (select count(*) from products pr where pr.page_id = p.id),
    'open_claims', (select count(*) from page_claims c where c.page_id = p.id and c.status = 'pending'),
    'past_claims', (select count(*) from page_claims c where c.page_id = p.id and c.status in ('approved', 'declined', 'withdrawn')),
    'active_blocks', (select count(*) from page_blocks b where b.page_id = p.id and b.lifted_at is null),
    'open_reports', (select count(*) from page_reports r where r.page_id = p.id and r.status = 'open'),
    'recent_posts', (select count(*) from posts po
                      where po.page_id = p.id and po.status in ('visible', 'auto_hidden')
                        and po.created_at > now() - interval '7 days'),
    'aliases', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'handle', a.handle::text, 'redirect_until', a.redirect_until,
                                          'formerly', a.formerly, 'created_at', a.created_at) order by a.created_at desc)
        from page_aliases a where a.page_id = p.id
    ), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'username', u.username::text, 'role', m.role::text, 'joined_at', m.joined_at,
               'available', private.is_in_good_standing(m.user_id)
             ) order by private.page_role_rank(m.role) desc, m.joined_at)
        from page_members m join profiles u on u.id = m.user_id
       where m.page_id = p.id
    ), '[]'::jsonb),
    'handover', (
      select jsonb_build_object('username', u.username::text, 'created_at', i.created_at)
        from page_invites i join profiles u on u.id = i.invitee_id
       where i.page_id = p.id and i.kind = 'ownership' and private.page_invite_open(i)
       order by i.created_at desc limit 1
    ),
    'product_groups', private.page_product_groups(p.id),
    'history', coalesce((
      select jsonb_agg(h order by (h ->> 'at')::timestamptz desc)
        from (
          -- Page tools and the queue's decisions about the page.
          select jsonb_build_object(
                   'at', a.created_at, 'action', a.action,
                   'by', (select u.username::text from profiles u where u.id = a.actor_id),
                   'who', (select u.username::text from profiles u where u.id = a.target_user_id),
                   'message', a.message, 'snapshot', a.snapshot,
                   'split_from', a.page_id is distinct from p.id
                 ) as h
            from moderation_actions a
           where a.page_id = p.id
              or (a.action = 'page_split' and a.subject_id = p.id)
          union all
          -- Claims: sent, withdrawn, and decisions made before the web admin logged them.
          select jsonb_build_object('at', c.sent_at, 'action', 'claim_sent',
                                    'who', (select u.username::text from profiles u where u.id = c.user_id),
                                    'message', c.proof::text)
            from page_claims c where c.page_id = p.id and c.sent_at is not null
          union all
          select jsonb_build_object('at', c.decided_at,
                                    'action', case c.status when 'withdrawn' then 'claim_withdrawn'
                                                            when 'approved' then 'claim_approved'
                                                            else 'claim_declined' end,
                                    'who', (select u.username::text from profiles u where u.id = c.user_id),
                                    'message', c.decline_reason)
            from page_claims c
           where c.page_id = p.id and c.decided_at is not null
             and (c.status = 'withdrawn' or not exists (
                   select 1 from moderation_actions a where a.subject_id = c.id and a.action in ('claim_approved', 'claim_declined')))
          union all
          -- Claim invites, and accepted hand-overs.
          select jsonb_build_object('at', i.created_at, 'action', 'claim_invite_sent', 'who', i.email::text)
            from page_invites i where i.page_id = p.id and i.kind = 'claim'
          union all
          select jsonb_build_object('at', i.accepted_at,
                                    'action', case i.kind when 'claim' then 'claim_invite_accepted' else 'handed_over' end,
                                    'who', (select u.username::text from profiles u where u.id = i.accepted_by),
                                    'by', (select u.username::text from profiles u where u.id = i.invited_by))
            from page_invites i where i.page_id = p.id and i.kind in ('claim', 'ownership') and i.accepted_at is not null
          union all
          -- The first logo: the page read OFFICIAL from then.
          select jsonb_build_object('at', p.followers_told_at, 'action', 'went_official')
           where p.followers_told_at is not null
          union all
          select jsonb_build_object('at', p.created_at, 'action', case when p.created_by is null then 'seeded' else 'created' end,
                                    'by', (select u.username::text from profiles u where u.id = p.created_by),
                                    'message', coalesce((select a.handle::text from page_aliases a
                                                          where a.page_id = p.id and a.handle is not null
                                                          order by a.created_at limit 1), p.handle::text))
        ) x(h)
    ), '[]'::jsonb)
  );
end $$;

-- The suspension, for the page's own team (and Rachel): when and why. The
-- app shows it on the page and pinned at the top of the inbox.
create or replace function public.page_suspension_notice(page uuid)
returns table (suspended_at timestamptz, reason text)
language sql stable security definer
set search_path = public
as $$
  select p.suspended_at, p.suspended_reason
    from pages p
   where p.id = page and p.suspended_at is not null
     and (private.page_role_of(p.id) is not null or private.is_owner());
$$;

/* 5. Suspend and lift -------------------------------------------------------------------------- */

-- The page goes read-only until Rachel lifts it: nobody posts, comments or
-- hosts as it, and Edit page and Team lock (can_act_as_page() already
-- refuses a suspended page); the inbox keeps working. Followers aren't told;
-- the team gets a bell notice. hide_recent hides the page's posts from the
-- last 7 days. cancel_meetups is for PR 9 (pages host meetups then); until
-- then there's nothing to cancel. Returns how many posts were hidden.
-- Errors: not_found, reason_needed, not_managed, already_suspended.
create or replace function public.suspend_page(
  page uuid,
  reason text,
  hide_recent boolean default false,
  cancel_meetups boolean default false
)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := private.require_owner();
  why text := nullif(btrim(coalesce(reason, '')), '');
  p pages%rowtype;
  hidden uuid[] := '{}';
begin
  select * into p from pages where id = page for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if why is null or char_length(why) > 500 then
    raise exception 'reason_needed' using errcode = '22023';
  end if;
  if p.state <> 'managed' then
    raise exception 'not_managed' using errcode = '22023';
  end if;
  if p.suspended_at is not null then
    raise exception 'already_suspended' using errcode = '22023';
  end if;

  update pages set suspended_at = now(), suspended_reason = why, updated_at = now() where id = page;

  if hide_recent then
    perform set_config('grindylocks.page_tools', 'on', true);
    with h as (
      update posts set status = 'hidden'
       where page_id = page and status in ('visible', 'auto_hidden') and created_at > now() - interval '7 days'
      returning id
    )
    select coalesce(array_agg(id), '{}') into hidden from h;
    perform set_config('grindylocks.page_tools', 'off', true);
  end if;

  perform private.notify_page_team(page, 'suspended');
  perform private.log_page_tool('page_suspended', page, why,
    jsonb_build_object('hidden_posts', to_jsonb(hidden), 'cancel_meetups', coalesce(cancel_meetups, false)));
  return cardinality(hidden);
end $$;

-- Lifts it. Posts the suspension hid come back (unless they've been deleted
-- since); the team is told. Returns how many came back.
-- Errors: not_found, not_suspended.
create or replace function public.lift_page_suspension(page uuid)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := private.require_owner();
  p pages%rowtype;
  hid uuid[];
  n integer := 0;
begin
  select * into p from pages where id = page for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p.suspended_at is null then
    raise exception 'not_suspended' using errcode = '22023';
  end if;

  select array(select jsonb_array_elements_text(a.snapshot -> 'hidden_posts')::uuid) into hid
    from moderation_actions a
   where a.page_id = page and a.action = 'page_suspended'
   order by a.created_at desc limit 1;

  if coalesce(cardinality(hid), 0) > 0 then
    perform set_config('grindylocks.page_tools', 'on', true);
    update posts set status = 'visible' where id = any (hid) and page_id = page and status = 'hidden';
    get diagnostics n = row_count;
    perform set_config('grindylocks.page_tools', 'off', true);
  end if;

  update pages set suspended_at = null, suspended_reason = null, updated_at = now() where id = page;
  perform private.notify_page_team(page, 'suspension_lifted');
  perform private.log_page_tool('page_suspension_lifted', page, null, jsonb_build_object('restored_posts', n));
  return n;
end $$;

/* 6. Transfer ownership ------------------------------------------------------------------------ */

-- Makes someone the owner at once, with no Accept step: for when the owner
-- is gone, asks, or a dispute is settled. The new owner is someone on the
-- team (new_owner) or a member by username; the old owner stays as a
-- manager or leaves. A pending hand-over is cancelled. On a disputed
-- (frozen) page it closes the dispute: other open claims are declined (and
-- told, as when a claim is approved), "This is our brand" reports are
-- closed, and the page is unfrozen. Both people are told.
-- Errors: not_found, nobody_on_team (use Send claim invite), no_such_member,
-- suspended, already_owner.
create or replace function public.admin_transfer_page(
  page uuid,
  new_owner uuid default null,
  username text default null,
  old_owner_stays boolean default true,
  note text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  me uuid := private.require_owner();
  p pages%rowtype;
  who uuid := new_owner;
  old uuid;
  old_name text;
  c record;
  disputed boolean;
  why text := nullif(btrim(coalesce(note, '')), '');
begin
  select * into p from pages where id = page for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from page_members m where m.page_id = page) then
    raise exception 'nobody_on_team' using errcode = '22023';
  end if;
  if who is null and nullif(btrim(coalesce(admin_transfer_page.username, '')), '') is not null then
    select u.id into who from profiles u
     where u.username operator(extensions.=) btrim(ltrim(btrim(admin_transfer_page.username), '@'))::citext
       and u.deleted_at is null;
  end if;
  if who is null or not exists (select 1 from profiles u where u.id = who and u.onboarded_at is not null) then
    raise exception 'no_such_member' using errcode = '22023';
  end if;
  if not private.is_in_good_standing(who) then
    raise exception 'suspended' using errcode = '22023';
  end if;
  select m.user_id into old from page_members m where m.page_id = page and m.role = 'owner';
  if old = who then
    raise exception 'already_owner' using errcode = '22023';
  end if;
  select u.username::text into old_name from profiles u where u.id = old;

  -- A pending hand-over from Team is cancelled, with its bell row.
  update page_invites i set cancelled_at = now()
   where i.page_id = page and i.kind = 'ownership'
     and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;
  delete from notifications n where n.kind = 'page_invite' and n.page_id = page and n.message = 'ownership';

  if old is not null then
    if coalesce(old_owner_stays, true) then
      update page_members set role = 'manager' where page_id = page and user_id = old;
    else
      delete from page_members where page_id = page and user_id = old;
    end if;
  end if;
  insert into page_members (page_id, user_id, role, invited_by)
  values (page, who, 'owner', me)
  on conflict (page_id, user_id) do update set role = 'owner';

  disputed := p.frozen_at is not null;
  if disputed then
    -- The new owner's own claim, if they had one, is the one that won.
    update page_claims set status = 'approved', decided_at = now(), decided_by = me
     where page_claims.page_id = page and user_id = who and status = 'pending';
    for c in
      update page_claims
         set status = 'declined', decline_reason = 'another_claim_approved', decided_at = now(), decided_by = me
       where page_claims.page_id = page and user_id <> who and status in ('draft', 'pending')
      returning user_id
    loop
      perform private.notify_page(c.user_id, 'page_claim_declined', page, null, 'another_claim_approved');
    end loop;
    update page_reports set status = 'actioned', resolved_by = me, resolved_at = now()
     where page_reports.page_id = page and status = 'open' and reason = 'our_page';
    update pages set frozen_at = null, updated_at = now() where id = page;
  end if;

  perform private.notify_page(who, 'page_team_change', page, null, 'owner');
  if old is not null then
    perform private.notify_page(old, 'page_team_change', page, null,
      case when coalesce(old_owner_stays, true) then 'role:manager' else 'removed' end);
  end if;

  perform private.log_page_tool('page_transferred', page, why,
    jsonb_build_object('from', old_name, 'old_owner_stays', old is not null and coalesce(old_owner_stays, true),
                       'dispute_closed', disputed),
    who);
  return who;
end $$;

/* 7. Rename or change handle ----------------------------------------------------------------- */

-- Changes the display name, the handle or both. The handle trigger keeps the
-- old handle redirecting for 90 days (nobody can take it meanwhile) and
-- keeps the old name; keep_formerly false hides that old name (it isn't
-- shown as Formerly or searched). The team is told; followers aren't.
-- Errors: not_found, invalid_name, invalid_handle, handle_taken (detail:
-- username, page or held), nothing_changed.
create or replace function public.admin_rename_page(
  page uuid,
  display_name text,
  handle text,
  keep_formerly boolean default true
)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := private.require_owner();
  p pages%rowtype;
  new_name text := nullif(btrim(coalesce(display_name, '')), '');
  new_handle text := btrim(ltrim(btrim(coalesce(handle, '')), '@'));
  name_changed boolean;
  handle_changed boolean;
begin
  select * into p from pages where id = page for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if new_name is null or char_length(new_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  name_changed := new_name is distinct from p.display_name;
  handle_changed := lower(new_handle) <> lower(p.handle::text);
  if not name_changed and new_handle = p.handle::text then
    raise exception 'nothing_changed' using errcode = '22023';
  end if;
  if handle_changed then
    perform private.require_free_handle(new_handle, page);
  elsif new_handle !~ '^[a-zA-Z0-9_.]{2,30}$' then
    raise exception 'invalid_handle' using errcode = '22023';
  end if;

  update pages p2 set display_name = new_name, handle = new_handle where p2.id = page;

  if name_changed and not coalesce(keep_formerly, true) then
    update page_aliases a set formerly = false
     where a.page_id = page and a.name = p.display_name and a.created_at = now();
  end if;

  perform private.notify_page_team(page, 'renamed:' || p.display_name);
  perform private.log_page_tool('page_renamed', page, null, jsonb_build_object(
    'from_name', p.display_name, 'from_handle', p.handle::text,
    'to_name', new_name, 'to_handle', new_handle,
    'formerly', name_changed and coalesce(keep_formerly, true)));
end $$;

/* 8. Merge ------------------------------------------------------------------------------------- */

-- Every column that points at pages, and what a merge does with it. A new
-- foreign key to pages must be added here (and to merge_pages()) before a
-- merge will run: private.unhandled_page_references() lists any that aren't.
--   move:    points at the target instead.
--   combine: copied to the target without doubles, then dropped.
--   close:   the source's open items close (they go with the source).
--   drop:    the source's own details; the target keeps its own.
create or replace function private.merge_page_references()
returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'public.parks.run_by_page_id',             -- move
    'public.posts.page_id',                    -- move
    'public.comments.page_id',                 -- move
    'public.comments.reply_to_page_id',        -- move
    'public.notifications.actor_page_id',      -- move
    'public.notifications.page_id',            -- move (invites to the source's team: drop)
    'public.reports.impersonated_page_id',     -- move
    'public.moderation_actions.page_id',       -- move (the History comes along)
    'public.page_aliases.page_id',             -- move, plus the source's own name and handle
    'public.page_descriptions.page_id',        -- drop
    'public.page_links.page_id',               -- drop
    'public.page_hours.page_id',               -- drop
    'public.page_brands_carried.brand_id',     -- combine
    'public.page_brands_carried.shop_id',      -- combine
    'public.page_members.page_id',             -- close: the source's team is told and taken off
    'public.page_invites.page_id',             -- close
    'public.page_follows.page_id',             -- combine
    'public.page_mutes.page_id',               -- combine
    'public.user_page_blocks.page_id',         -- drop (they blocked a duplicate listing)
    'public.page_blocks.page_id',              -- close
    'public.page_reports.page_id',             -- close
    'public.page_suggestions.page_id',         -- move
    'public.page_mentions.page_id',            -- combine
    'public.page_mentions.by_page_id',         -- move
    'public.products.page_id',                 -- move (same-name clashes flagged)
    'public.products.partner_page_id',         -- move
    'public.product_suggestions.page_id',      -- move
    'public.page_claims.page_id',              -- close
    'private.page_emails.page_id',             -- close
    'public.page_fix_reports.page_id',         -- close
    'public.page_inbox_seen.page_id',          -- drop
    'private.page_post_makers.page_id',        -- move
    'private.page_comment_makers.page_id'      -- move
  ];
$$;

create or replace function private.unhandled_page_references()
returns setof text
language sql stable security definer
set search_path = ''
as $$
  select n.nspname || '.' || t.relname || '.' || a.attname
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f' and c.confrelid = 'public.pages'::regclass
  except
  select unnest(private.merge_page_references());
$$;

revoke all on function private.merge_page_references() from public, anon, authenticated;
revoke all on function private.unhandled_page_references() from public, anon, authenticated;

-- What a merge would do, for the dialog's "What happens" list.
create or replace function public.merge_preview(source uuid, target uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  s pages%rowtype;
  t pages%rowtype;
begin
  perform private.require_owner();
  select * into s from pages where id = source;
  select * into t from pages where id = target;
  if s.id is null or t.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if s.id = t.id then
    raise exception 'same_page' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'source', private.page_summary(s.id),
    'target', private.page_summary(t.id),
    'followers', (select count(*) from page_follows f where f.page_id = s.id),
    'followers_both', (select count(*) from page_follows f
                        where f.page_id = s.id
                          and exists (select 1 from page_follows g where g.page_id = t.id and g.user_id = f.user_id)),
    'mentions', (select count(*) from page_mentions m where m.page_id = s.id),
    'carried_by', (select count(*) from page_brands_carried b where b.brand_id = s.id),
    'collabs', (select count(*) from products pr where pr.partner_page_id = s.id),
    'posts', (select count(*) from posts po where po.page_id = s.id and po.status <> 'deleted'),
    'products', (select count(*) from products pr where pr.page_id = s.id),
    'clashes', (select count(*) from products pr
                 where pr.page_id = s.id
                   and exists (select 1 from products o where o.page_id = t.id and o.part_type = pr.part_type
                                 and lower(o.name) = lower(pr.name))),
    'open_claims', (select count(*) from page_claims c where c.page_id = s.id and c.status in ('draft', 'pending')),
    'open_reports', (select count(*) from page_reports r where r.page_id = s.id and r.status = 'open'),
    'active_blocks', (select count(*) from page_blocks b where b.page_id = s.id and b.lifted_at is null),
    'source_team', (select count(*) from page_members m where m.page_id = s.id),
    'unhandled', coalesce((select jsonb_agg(u) from private.unhandled_page_references() u), '[]'::jsonb)
  );
end $$;

-- Merges a duplicate (or a true rebrand) into the target, then deletes it.
-- Followers combine without doubles; posts, comments, mentions, gear links
-- (products and collabs), brands-carried rows and the History point at the
-- target; products move, and any with the same name and part as one of the
-- target's is flagged in Product suggestions. The source's name and handle
-- become Formerly names on the target, the handle redirecting for 90 days.
-- The source's open claims, reports, blocks, fixes and invites close. The
-- target's team and description stay. Nobody is told, apart from the
-- source's own team, which is told and taken off. Can't be undone, so
-- Rachel types the target's handle to confirm.
-- Errors: not_found, same_page, confirm_mismatch, unhandled_reference.
create or replace function public.merge_pages(source uuid, target uuid, confirm text)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := private.require_owner();
  s pages%rowtype;
  t pages%rowtype;
  counts jsonb;
  m record;
  moved_products uuid[];
  clash record;
  n_followers integer;
begin
  if exists (select 1 from private.unhandled_page_references()) then
    raise exception using errcode = '55000', message = 'unhandled_reference',
      detail = (select string_agg(u, ', ') from private.unhandled_page_references() u);
  end if;
  -- Lock both, in a fixed order.
  perform 1 from pages where id in (source, target) order by id for update;
  select * into s from pages where id = source;
  select * into t from pages where id = target;
  if s.id is null or t.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if s.id = t.id then
    raise exception 'same_page' using errcode = '22023';
  end if;
  if lower(btrim(ltrim(btrim(coalesce(confirm, '')), '@'))) <> lower(t.handle::text) then
    raise exception 'confirm_mismatch' using errcode = '22023';
  end if;

  counts := public.merge_preview(source, target) - 'source' - 'target' - 'unhandled';
  perform set_config('grindylocks.page_tools', 'on', true);

  -- The source's team is told (on the target, since the source goes) and taken off.
  for m in
    select pm.user_id from page_members pm
     where pm.page_id = source
       and not exists (select 1 from page_members o where o.page_id = target and o.user_id = pm.user_id)
  loop
    perform private.notify_page(m.user_id, 'page_team_change', target, null, 'merged:' || s.display_name);
  end loop;
  delete from notifications where page_id = source and kind = 'page_invite';
  delete from page_invites where page_id = source;
  delete from page_members where page_id = source;

  -- The target takes on the source's roles (a shop that also makes gear stays both).
  update pages set roles = (select array_agg(distinct r order by r) from unnest(t.roles || s.roles) r),
                   updated_at = now()
   where id = target;

  -- Combine: followers, mutes, brands carried, mentions.
  insert into page_follows (user_id, page_id, created_at)
  select f.user_id, target, f.created_at from page_follows f
   where f.page_id = source
     and not exists (select 1 from user_page_blocks b where b.page_id = target and b.user_id = f.user_id)
     and not exists (select 1 from page_blocks b where b.page_id = target and b.user_id = f.user_id and b.lifted_at is null)
  on conflict (user_id, page_id) do nothing;
  get diagnostics n_followers = row_count;
  delete from page_follows where page_id = source;

  insert into page_mutes (user_id, page_id, created_at)
  select x.user_id, target, x.created_at from page_mutes x where x.page_id = source
  on conflict (user_id, page_id) do nothing;
  delete from page_mutes where page_id = source;

  if 'brand' = any (s.roles) then
    insert into page_brands_carried (shop_id, brand_id, position)
    select b.shop_id, target, b.position from page_brands_carried b
     where b.brand_id = source and b.shop_id <> target
    on conflict (shop_id, brand_id) do nothing;
  end if;
  if 'shop' = any (s.roles) then
    insert into page_brands_carried (shop_id, brand_id, position)
    select target, b.brand_id, b.position from page_brands_carried b
     where b.shop_id = source and b.brand_id <> target
    on conflict (shop_id, brand_id) do nothing;
  end if;
  delete from page_brands_carried where shop_id = source or brand_id = source;

  delete from page_mentions x
   where x.page_id = source
     and exists (
       select 1 from page_mentions y
        where y.page_id = target
          and ((x.comment_id is null and x.event_comment_id is null and y.comment_id is null and y.event_comment_id is null
                and y.post_id = x.post_id)
               or (x.comment_id is not null and y.comment_id = x.comment_id)
               or (x.event_comment_id is not null and y.event_comment_id = x.event_comment_id))
     );
  update page_mentions set page_id = target where page_id = source;
  update page_mentions set by_page_id = target where by_page_id = source;

  -- Move.
  update parks set run_by_page_id = target where run_by_page_id = source;
  update posts set page_id = target where page_id = source;
  update comments set page_id = target where page_id = source;
  update comments set reply_to_page_id = target where reply_to_page_id = source;
  update notifications set page_id = target where page_id = source;
  update notifications set actor_page_id = target where actor_page_id = source;
  update reports set impersonated_page_id = target where impersonated_page_id = source;
  update moderation_actions set page_id = target where page_id = source;
  update page_suggestions set page_id = target where page_id = source;
  update private.page_post_makers set page_id = target where page_id = source;
  update private.page_comment_makers set page_id = target where page_id = source;
  update page_aliases set page_id = target where page_id = source;
  insert into page_aliases (page_id, name, handle, redirect_until, formerly)
  values (target, s.display_name, s.handle, now() + interval '90 days', true);

  -- Products: models first, then what's built on them (a pro model's base
  -- must be on the same page). Collabs pointing at the source point at the
  -- target, unless the target made them.
  select coalesce(array_agg(id), '{}') into moved_products from products where page_id = source;
  update products set page_id = target where page_id = source and base_id is null;
  update products set page_id = target where page_id = source;
  update products set partner_page_id = case when page_id = target then null else target end
   where partner_page_id = source;
  update product_suggestions set page_id = target where page_id = source;
  for clash in
    select pr.id, pr.name from products pr
     where pr.id = any (moved_products)
       and exists (select 1 from products o where o.page_id = target and o.id <> pr.id and not (o.id = any (moved_products))
                     and o.part_type = pr.part_type and lower(o.name) = lower(pr.name))
  loop
    insert into product_suggestions (page_id, kind, product_id, note)
    values (target, 'something_else', clash.id,
            left(format('Same name as another %s product after %s was merged into it. Keep one.', t.display_name, s.display_name), 300));
  end loop;

  -- Close and drop: everything else goes with the source.
  delete from private.page_emails where page_id = source;
  delete from page_claims where page_id = source;
  delete from page_fix_reports where page_id = source;
  delete from page_reports where page_id = source;
  delete from page_blocks where page_id = source;
  delete from user_page_blocks where page_id = source;
  delete from page_inbox_seen where page_id = source;
  delete from page_descriptions where page_id = source;
  delete from page_links where page_id = source;
  delete from page_hours where page_id = source;
  delete from pages where id = source;

  perform set_config('grindylocks.page_tools', 'off', true);

  counts := counts || jsonb_build_object(
    'source_id', s.id, 'source_name', s.display_name, 'source_handle', s.handle::text, 'source_state', s.state::text,
    'followers_added', n_followers);
  perform private.log_page_tool('page_merged', target, null, counts);
  return counts;
end $$;

/* 9. Split ------------------------------------------------------------------------------------- */

-- Makes a new Unofficial page (Needs translations, with its English factual
-- line) and moves the product trees Rachel picked to it: each picked
-- product's model with its pro models, collabs and special editions. IDs
-- stay the same, so setups and stock parts keep pointing where they did.
-- The old page's followers aren't moved; each gets a one-time page_split
-- notice (no push) with a Follow button. Returns the new page's id.
-- Errors: not_found, invalid_name, invalid_handle, handle_taken,
-- invalid_line, invalid_country, invalid_products.
create or replace function public.split_page(
  page uuid,
  name text,
  handle text,
  role public.page_role,
  line text,
  city text default null,
  country text default null,
  products uuid[] default '{}'
)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := private.require_owner();
  s pages%rowtype;
  clean_name text := nullif(btrim(coalesce(name, '')), '');
  clean_handle text;
  clean_line text := nullif(btrim(coalesce(line, '')), '');
  clean_country text := upper(nullif(btrim(coalesce(country, '')), ''));
  picked uuid[] := coalesce(products, '{}');
  trees uuid[];
  new_id uuid;
  told integer;
begin
  select * into s from pages where id = page for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if clean_name is null or char_length(clean_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  clean_handle := private.require_free_handle(handle);
  if clean_line is null or char_length(clean_line) > 300 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;
  if clean_country is not null and clean_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid_country' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(picked) as x(id) where not exists (select 1 from public.products p where p.id = x.id and p.page_id = page)) then
    raise exception 'invalid_products' using errcode = '22023';
  end if;

  -- Whole trees: each picked product's model, and everything built on it.
  with recursive roots as (
    select coalesce(p.base_id, p.id) as id from public.products p where p.id = any (picked)
  ),
  tree as (
    select r.id from roots r
    union
    select c.id from public.products c join tree t on c.base_id = t.id where c.page_id = page
  )
  select coalesce(array_agg(id), '{}') into trees from tree;

  insert into pages (handle, display_name, roles, state, city, country, location_type, needs_translations_at, created_by)
  values (clean_handle, clean_name, array[role], 'unofficial', nullif(btrim(coalesce(city, '')), ''), clean_country,
          case when role = 'shop' then 'online_only'::shop_location_type end, now(), me)
  returning id into new_id;
  insert into page_descriptions (page_id, locale, body, updated_by) values (new_id, 'en', clean_line, me);

  update public.products p set page_id = new_id where p.id = any (trees) and p.base_id is null;
  update public.products p set page_id = new_id where p.id = any (trees);
  update product_suggestions ps set page_id = new_id where ps.product_id = any (trees) and ps.status = 'open';

  insert into notifications (recipient_id, kind, page_id, message)
  select f.user_id, 'page_split', new_id, s.display_name
    from page_follows f
    join profiles pr on pr.id = f.user_id
   where f.page_id = page and pr.deleted_at is null and pr.onboarded_at is not null;
  get diagnostics told = row_count;

  perform private.log_page_tool('page_split', page, null, jsonb_build_object(
    'from_name', s.display_name, 'new_name', clean_name, 'new_handle', clean_handle,
    'products', cardinality(trees), 'followers_told', told
  ), null, new_id);
  return new_id;
end $$;

/* 10. Closed for good, and reopening ------------------------------------------------------------ */

-- Rachel closes a page for good: a shop becomes Closed (today), a brand
-- Retired, with the years on its tape (founded, ended; "c. 2024" when
-- approximate; the end defaults to this year). The archive note is the app's
-- own sentence from those years, in every language. Shops leave the map,
-- Near you and brands-carried lists; a managed page loses its logo and
-- OFFICIAL in the app (the logo is kept, for Reopen) and its team stays,
-- read-only, and is told. Open invites are cancelled. (A page's upcoming
-- meetups are cancelled here once pages host them, PR 9.)
-- Errors: not_found, already_closed, invalid_years.
create or replace function public.admin_close_page(page uuid, founded text default null, ended text default null)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := private.require_owner();
  p pages%rowtype;
  next_state public.page_state;
  from_label text := private.clean_year_label(founded);
  to_label text := private.clean_year_label(ended);
begin
  select * into p from pages where id = page for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p.state in ('closed', 'out_of_business') then
    raise exception 'already_closed' using errcode = '22023';
  end if;
  next_state := case when 'shop' = any (p.roles) then 'closed' else 'out_of_business' end;

  update pages
     set state = next_state,
         closed_at = case when next_state = 'closed' then now() else closed_at end,
         founded_label = case when next_state = 'out_of_business' then coalesce(from_label, founded_label) else founded_label end,
         ended_label = case when next_state = 'out_of_business'
                            then coalesce(to_label, ended_label, extract(year from now())::int::text) else ended_label end,
         temp_closed_at = null, temp_closed_until = null, temp_closed_note = null,
         updated_at = now()
   where id = page;

  update page_invites i set cancelled_at = now()
   where i.page_id = page and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;

  perform private.notify_page_team(page, 'closed');
  perform private.log_page_tool('page_closed', page, null, jsonb_build_object(
    'from_state', p.state::text, 'to_state', next_state::text,
    'founded', (select founded_label from pages where id = page), 'ended', (select ended_label from pages where id = page)));
  return next_state::text;
end $$;

-- Reopens an archive: managed if the page has an owner (its logo, if it
-- kept one, makes it OFFICIAL again), otherwise Unofficial (or Name only, if
-- it was that before Rachel closed it). The team is told.
-- Errors: not_found, not_closed.
create or replace function public.reopen_page(page uuid)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := private.require_owner();
  p pages%rowtype;
  prior_state text;
  next_state public.page_state;
begin
  select * into p from pages where id = page for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p.state not in ('closed', 'out_of_business') then
    raise exception 'not_closed' using errcode = '22023';
  end if;
  select a.snapshot ->> 'from_state' into prior_state
    from moderation_actions a where a.page_id = page and a.action = 'page_closed'
   order by a.created_at desc limit 1;
  next_state := case
    when exists (select 1 from page_members m where m.page_id = page and m.role = 'owner') then 'managed'
    when prior_state = 'name_only' then 'name_only'
    else 'unofficial' end;

  update pages
     set state = next_state,
         closed_at = null,
         ended_label = null,
         managed_at = case when next_state = 'managed' then coalesce(managed_at, now()) else managed_at end,
         updated_at = now()
   where id = page;

  perform private.notify_page_team(page, 'reopened');
  perform private.log_page_tool('page_reopened', page, null, jsonb_build_object(
    'from_state', p.state::text, 'to_state', next_state::text, 'ended', p.ended_label));
  return next_state::text;
end $$;

/* 11. The bell, and Search ------------------------------------------------------------------------ */

-- As in PR 5, plus page_split ("FR Skates has its own page", the old page's
-- name in message) and whether you follow the page, for the row's Follow
-- button. Dropped and created again for the new column.
drop function if exists public.my_page_notifications();

create function public.my_page_notifications()
returns table (
  id text,
  kind text,
  created_at timestamptz,
  unread boolean,
  page_id uuid,
  page_handle text,
  page_name text,
  page_roles text[],
  page_state text,
  page_logo_path text,
  actor_username text,
  actor_avatar_path text,
  message text,
  following boolean
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  seen timestamptz;
begin
  if me is null then
    return;
  end if;
  select ns.seen_at into seen from private.notifications_seen ns where ns.user_id = me;
  return query
    select 'p:' || n.id::text, n.kind::text, n.created_at, seen is null or n.created_at > seen,
           p.id, p.handle::text, p.display_name, p.roles::text[], p.state::text,
           case when p.state = 'managed' then p.logo_path end,
           case when a.deleted_at is null then a.username::text end,
           case when a.deleted_at is null then a.avatar_path end,
           n.message,
           exists (select 1 from page_follows f where f.page_id = p.id and f.user_id = me)
      from notifications n
      join pages p on p.id = n.page_id
      left join profiles a on a.id = n.actor_id
     where n.recipient_id = me
       and n.kind in ('page_claim_approved', 'page_claim_declined', 'page_team_change', 'page_claimed',
                      'suggestion_live', 'page_split')
       -- A page you blocked doesn't come back through the bell.
       and (n.kind not in ('page_claimed', 'page_split') or not exists (
             select 1 from user_page_blocks b where b.page_id = p.id and b.user_id = me))
     order by n.created_at desc
     limit 50;
end $$;

-- Search leaves out old names that aren't Formerly names.
do $$
begin
  execute pg_temp.patch(pg_get_functiondef('public.search_pages(text, boolean, integer)'::regprocedure),
    'where a.page_id = p.id',
    'where a.page_id = p.id and a.formerly',
    'search_pages: formerly');
end $$;

/* 12. Grants -------------------------------------------------------------------------------------- */

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_handle_check(text, uuid)',
    'public.admin_pages(text, text)',
    'public.admin_page_detail(uuid)',
    'public.page_suspension_notice(uuid)',
    'public.suspend_page(uuid, text, boolean, boolean)',
    'public.lift_page_suspension(uuid)',
    'public.admin_transfer_page(uuid, uuid, text, boolean, text)',
    'public.admin_rename_page(uuid, text, text, boolean)',
    'public.merge_preview(uuid, uuid)',
    'public.merge_pages(uuid, uuid, text)',
    'public.split_page(uuid, text, text, public.page_role, text, text, text, uuid[])',
    'public.admin_close_page(uuid, text, text)',
    'public.reopen_page(uuid)',
    'public.my_page_notifications()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
declare
  r text := '';
  ok int := 0; total int := 0;
  them uuid := (select id from public.pages where handle = 'themskates');
  razors uuid := (select id from public.pages where handle = 'razorsskates');
  shop uuid := (select id from public.pages where 'shop' = any (roles) and state = 'unofficial'
                 and not exists (select 1 from public.page_members m where m.page_id = pages.id) order by handle limit 1);
  metro uuid := (select id from public.metro_areas limit 1);
  a uuid := gen_random_uuid();   -- a throwaway admin (the owner role, like Rachel)
  o uuid := gen_random_uuid();   -- owns Them
  m uuid := gen_random_uuid();   -- manager on Them
  s uuid := gen_random_uuid();   -- staff on Them
  x uuid := gen_random_uuid();   -- staff on the duplicate
  z uuid := gen_random_uuid();   -- a skater outside the team, with a claim on Them
  f1 uuid := gen_random_uuid();  -- follows the duplicate and Razors
  f2 uuid := gen_random_uuid();  -- follows the duplicate and Them
  u uuid;
  dup uuid;
  post uuid;
  cmt uuid;
  root uuid;
  kids int;
  split uuid;
  n int;
  res text;
  j jsonb;
  them_name text := (select display_name from public.pages where handle = 'themskates');
  them_product text;
  them_part text;
begin
  foreach u in array array[a, o, m, s, x, z, f1, f2] loop
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'tools-check-' || u || '@example.com', now(), now(), '{}'::jsonb);
    insert into public.profiles (id) values (u) on conflict (id) do nothing;
    update public.profiles set onboarded_at = now(), age_confirmed_at = now(),
      disciplines = '{inline}', home_metro_area_id = metro,
      username = 'toolscheck' || left(replace(u::text, '-', ''), 8) where id = u;
  end loop;
  insert into public.role_assignments (user_id, role, accepted_at) values (a, 'owner', now());
  insert into private.push_devices (user_id, token, platform, language)
  values (f1, 'ExponentPushToken[tools-check]', 'ios', 'en') on conflict do nothing;

  -- Them: managed, with a logo, owner o, manager m, staff s.
  perform private.make_page_owner(them, o, null);
  update public.pages set logo_path = them || '/logo.png' where id = them;
  insert into public.page_members (page_id, user_id, role, joined_at) values (them, m, 'manager', now() - interval '2 days'),
    (them, s, 'staff', now() - interval '1 day');
  insert into public.page_follows (user_id, page_id) values (f2, them), (f1, razors);

  /* 1. Every reference to pages is handled by a merge -------------------------------------- */
  total := total + 1;
  select string_agg(x1, ', ') into res from private.unhandled_page_references() x1;
  if res is null then ok := ok + 1; else r := r || 'FAIL unhandled references: ' || res || '; '; end if;

  /* 2. Only Rachel ------------------------------------------------------------------------- */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.admin_pages();
    r := r || 'FAIL a page owner listed pages; ';
  exception when no_data_found then ok := ok + 1; end;
  total := total + 1;
  begin
    perform public.suspend_page(them, 'no');
    r := r || 'FAIL a page owner suspended a page; ';
  exception when no_data_found then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  total := total + 1;
  select count(*) into n from public.admin_pages();
  if n >= 68 and exists (select 1 from public.admin_pages('them') p where p.handle = 'themskates' and p.owner_username is not null
                           and p.team_count = 3)
  then ok := ok + 1; else r := r || 'FAIL admin_pages ' || n || '; '; end if;

  total := total + 1;
  select count(*) into n from public.admin_pages(null, 'shop') p where not ('shop' = any (p.roles));
  if n = 0 then ok := ok + 1; else r := r || 'FAIL type filter; '; end if;

  /* 3. Handle check ---------------------------------------------------------------------------- */
  total := total + 1;
  if public.admin_handle_check('a b') = 'invalid'
     and public.admin_handle_check('themofficial') = 'official'
     and public.admin_handle_check('@usdskates') = 'page'
     and public.admin_handle_check('themskates', them) = 'ok'
     and public.admin_handle_check((select username::text from public.profiles where id = o)) = 'username'
     and public.admin_handle_check('toolscheckfree') = 'ok'
  then ok := ok + 1; else r := r || 'FAIL handle check; '; end if;

  /* 4. Suspend and lift ------------------------------------------------------------------------- */
  -- A page post from staff, from today.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  insert into public.posts (author_id, page_id, caption, slide_count, published_at)
  values (null, them, 'sale this weekend', 1, now()) returning id into post;
  insert into public.comments (post_id, author_id, page_id, body) values (post, null, them, 'come by') returning id into cmt;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  total := total + 1;
  begin
    perform public.suspend_page(razors, 'nobody home');
    r := r || 'FAIL suspended an unofficial page; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  n := public.suspend_page(them, 'Sale ads tagged to parks again', true);
  if n = 1 and (select status::text from public.posts where id = post) = 'hidden'
     and (select suspended_at is not null and suspended_reason = 'Sale ads tagged to parks again' from public.pages where id = them)
  then ok := ok + 1; else r := r || 'FAIL suspend ' || n || '; '; end if;

  total := total + 1;
  select count(*) into n from public.notifications where page_id = them and kind = 'page_team_change' and message = 'suspended';
  if n = 3 then ok := ok + 1; else r := r || 'FAIL suspend notices ' || n || '; '; end if;

  total := total + 1;
  begin
    perform public.suspend_page(them, 'again');
    r := r || 'FAIL suspended twice; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  total := total + 1;
  if (select reason from public.page_suspension_notice(them)) = 'Sale ads tagged to parks again' then ok := ok + 1;
  else r := r || 'FAIL team can''t read the reason; '; end if;
  total := total + 1;
  execute 'set local role authenticated';
  begin
    insert into public.posts (author_id, page_id, caption, slide_count) values (null, them, 'while suspended', 1);
    r := r || 'FAIL posted as a suspended page; ';
  exception when insufficient_privilege then ok := ok + 1; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub', f2, 'role', 'authenticated')::text, true);
  total := total + 1;
  if not exists (select 1 from public.page_suspension_notice(them)) then ok := ok + 1;
  else r := r || 'FAIL a follower read the reason; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  total := total + 1;
  n := public.lift_page_suspension(them);
  if n = 1 and (select status::text from public.posts where id = post) = 'visible'
     and (select suspended_at is null and suspended_reason is null from public.pages where id = them)
     and exists (select 1 from public.notifications where page_id = them and message = 'suspension_lifted' and recipient_id = o)
  then ok := ok + 1; else r := r || 'FAIL lift ' || n || '; '; end if;

  /* 5. Rename ------------------------------------------------------------------------------------- */
  total := total + 1;
  begin
    perform public.admin_rename_page(them, 'Them', 'usdskates');
    r := r || 'FAIL took another page''s handle; ';
  exception when unique_violation then ok := ok + 1; end;

  total := total + 1;
  perform public.admin_rename_page(them, 'Them Check Renamed', 'themcheckrenamed', false);
  if (select handle::text from public.pages where id = them) = 'themcheckrenamed'
     and public.page_for_handle('themskates') = them
     and exists (select 1 from public.page_aliases where page_id = them and handle::text = 'themskates' and not formerly)
     and exists (select 1 from public.notifications where page_id = them and recipient_id = s and message = 'renamed:' || them_name)
  then ok := ok + 1; else r := r || 'FAIL rename; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', f2, 'role', 'authenticated')::text, true);
  total := total + 1;
  if not exists (select 1 from public.search_pages(them_name) p where p.id = them and p.formerly is not null)
  then ok := ok + 1; else r := r || 'FAIL search found a hidden old name; '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- Back to its own old handle (the page may take it back), keeping the name as Formerly.
  total := total + 1;
  perform public.admin_rename_page(them, them_name, 'themskates', true);
  if (select handle::text from public.pages where id = them) = 'themskates'
     and exists (select 1 from public.page_aliases where page_id = them and name = 'Them Check Renamed' and formerly)
  then ok := ok + 1; else r := r || 'FAIL rename back; '; end if;

  /* 6. Transfer, on a disputed page ------------------------------------------------------------------- */
  update public.pages set frozen_at = now() where id = them;
  insert into public.page_claims (page_id, user_id, role_title, proof, email, status, sent_at)
  values (them, z, 'Founder', 'email', 'z@themskates.com', 'pending', now());
  insert into public.page_reports (reporter_id, page_id, reason) values (z, them, 'our_page');

  total := total + 1;
  perform public.admin_transfer_page(them, m, null, false, 'Mads asked by email');
  if private.page_role_of(them, m) = 'owner' and private.page_role_of(them, o) is null
     and (select frozen_at is null from public.pages where id = them)
     and (select status::text from public.page_claims where page_id = them and user_id = z) = 'declined'
     and not exists (select 1 from public.page_reports where page_id = them and status = 'open')
     and exists (select 1 from public.notifications where recipient_id = m and page_id = them and message = 'owner')
     and exists (select 1 from public.notifications where recipient_id = o and page_id = them and message = 'removed')
     and exists (select 1 from public.notifications where recipient_id = z and page_id = them and kind = 'page_claim_declined')
  then ok := ok + 1; else r := r || 'FAIL transfer on a dispute; '; end if;

  total := total + 1;
  perform public.admin_transfer_page(them, null, (select username::text from public.profiles where id = z), true);
  if private.page_role_of(them, z) = 'owner' and private.page_role_of(them, m) = 'manager'
     and exists (select 1 from public.notifications where recipient_id = m and page_id = them and message = 'role:manager')
  then ok := ok + 1; else r := r || 'FAIL transfer by username; '; end if;

  total := total + 1;
  begin
    perform public.admin_transfer_page(them, z);
    r := r || 'FAIL transferred to the owner; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.admin_transfer_page(razors, z);
    r := r || 'FAIL transferred a page with nobody on it; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  /* 7. Merge ------------------------------------------------------------------------------------------- */
  select name, part_type into them_product, them_part from public.products where page_id = them and base_id is null order by name limit 1;
  insert into public.pages (handle, display_name, roles, state) values ('toolscheckdup', 'Them (dup)', '{brand}', 'unofficial')
  returning id into dup;
  insert into public.page_descriptions (page_id, locale, body) values (dup, 'en', 'A duplicate.');
  insert into public.products (page_id, part_type, name, entry_type, disciplines, status, sort)
  values (dup, them_part, them_product, 'model', (select disciplines from public.products where page_id = them and name = them_product limit 1), 'unknown', 0),
         (dup, 'boot', 'Dup Only Model', 'model', '{inline}', 'unknown', 1);
  insert into public.page_follows (user_id, page_id) values (f1, dup), (f2, dup);
  insert into public.page_members (page_id, user_id, role) values (dup, x, 'staff');
  insert into public.page_reports (reporter_id, page_id, reason) values (f1, dup, 'impersonation');

  total := total + 1;
  j := public.merge_preview(dup, them);
  if (j ->> 'followers')::int = 2 and (j ->> 'followers_both')::int = 1 and (j ->> 'products')::int = 2
     and (j ->> 'clashes')::int = 1 and (j ->> 'source_team')::int = 1 and jsonb_array_length(j -> 'unhandled') = 0
  then ok := ok + 1; else r := r || 'FAIL merge preview ' || j::text || '; '; end if;

  total := total + 1;
  begin
    perform public.merge_pages(dup, them, 'themskate');
    r := r || 'FAIL merged without the right handle; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  j := public.merge_pages(dup, them, '@ThemSkates');
  if not exists (select 1 from public.pages where id = dup)
     and (select count(*) from public.page_follows where page_id = them) = 2
     and (select count(*) from public.products where page_id = them and name in (them_product, 'Dup Only Model')) >= 3
     and exists (select 1 from public.product_suggestions where page_id = them and kind = 'something_else' and status = 'open')
     and public.page_for_handle('toolscheckdup') = them
     and exists (select 1 from public.page_aliases where page_id = them and name = 'Them (dup)' and formerly)
     and exists (select 1 from public.notifications where recipient_id = x and page_id = them and message = 'merged:Them (dup)')
     and private.page_role_of(them, x) is null
     and exists (select 1 from public.moderation_actions where page_id = them and action = 'page_merged')
     and (j ->> 'followers_added')::int = 1
  then ok := ok + 1; else r := r || 'FAIL merge ' || coalesce(j::text, '') || '; '; end if;

  /* 8. Split ------------------------------------------------------------------------------------------- */
  select p.id, (select count(*) from public.products k where k.base_id = p.id) into root, kids
    from public.products p
   where p.page_id = razors and p.base_id is null
     and exists (select 1 from public.products k where k.base_id = p.id)
   order by p.name limit 1;

  total := total + 1;
  begin
    perform public.split_page(razors, 'Split', 'usdskates', 'brand', 'line');
    r := r || 'FAIL split took a taken handle; ';
  exception when unique_violation then ok := ok + 1; end;

  total := total + 1;
  split := public.split_page(razors, 'Razors Split Check', 'toolschecksplit', 'brand',
                             'A check line.', null, 'us', array[root]);
  if (select state::text from public.pages where id = split) = 'unofficial'
     and (select needs_translations_at is not null and country = 'US' from public.pages where id = split)
     and (select count(*) from public.products where page_id = split) = kids + 1
     and (select page_id from public.products where id = root) = split
     and exists (select 1 from public.page_descriptions where page_id = split and locale = 'en')
  then ok := ok + 1; else r := r || 'FAIL split; '; end if;

  total := total + 1;
  if exists (select 1 from public.notifications where recipient_id = f1 and kind = 'page_split' and page_id = split)
     and not exists (select 1 from private.push_outbox ob join public.notifications nn on nn.id = ob.notification_id
                      where nn.kind = 'page_split')
     and not exists (select 1 from public.page_follows where page_id = split)
  then ok := ok + 1; else r := r || 'FAIL split notice; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', f1, 'role', 'authenticated')::text, true);
  total := total + 1;
  if exists (select 1 from public.my_page_notifications() p
              where p.kind = 'page_split' and p.page_id = split and not p.following
                and p.message = (select display_name from public.pages where id = razors))
  then ok := ok + 1; else r := r || 'FAIL split in the bell; '; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  /* 9. Closed for good, and reopening ----------------------------------------------------------------- */
  total := total + 1;
  begin
    perform public.admin_close_page(them, 'abc', null);
    r := r || 'FAIL bad years; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  res := public.admin_close_page(them, '2010', 'C 2024');
  if res = 'out_of_business'
     and (select founded_label = '2010' and ended_label = 'c. 2024' from public.pages where id = them)
     and exists (select 1 from public.notifications where recipient_id = z and page_id = them and message = 'closed')
  then ok := ok + 1; else r := r || 'FAIL close brand ' || coalesce(res, '') || '; '; end if;

  total := total + 1;
  res := public.reopen_page(them);
  if res = 'managed' and (select ended_label is null from public.pages where id = them)
  then ok := ok + 1; else r := r || 'FAIL reopen managed ' || coalesce(res, '') || '; '; end if;

  total := total + 1;
  if shop is null then r := r || 'FAIL no unofficial shop to close; ';
  else
    res := public.admin_close_page(shop);
    if res = 'closed' and public.reopen_page(shop) = 'unofficial' then ok := ok + 1;
    else r := r || 'FAIL close shop ' || coalesce(res, '') || '; '; end if;
  end if;

  /* 10. The pane ----------------------------------------------------------------------------------- */
  total := total + 1;
  j := public.admin_page_detail(them);
  if jsonb_array_length(j -> 'team') = 3
     and exists (select 1 from jsonb_array_elements(j -> 'history') h where h ->> 'action' = 'page_merged')
     and exists (select 1 from jsonb_array_elements(j -> 'history') h where h ->> 'action' = 'page_transferred')
     and exists (select 1 from jsonb_array_elements(j -> 'history') h where h ->> 'action' = 'seeded')
     and jsonb_array_length(j -> 'product_groups') > 0
  then ok := ok + 1; else r := r || 'FAIL detail; '; end if;

  total := total + 1;
  j := public.admin_page_detail(split);
  if exists (select 1 from jsonb_array_elements(j -> 'history') h where h ->> 'action' = 'page_split' and (h ->> 'split_from')::boolean)
  then ok := ok + 1; else r := r || 'FAIL split history; '; end if;

  raise exception 'CHECK % of %: %', ok, total, r;
end $$;
rollback;
