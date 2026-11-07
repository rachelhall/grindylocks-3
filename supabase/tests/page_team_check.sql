-- Rolled-back check for 20261104194451_page_team (the enum, 20261104185354_page_team_enums,
-- is applied first). Runs the migration and the checks in one transaction, then
-- raises CHECK <ok> of <total>: <failures>, so nothing is kept. Member checks run
-- as throwaway members made in the transaction; Rachel's steps run with no API
-- request, as from the SQL editor.
begin;

-- Brand and shop accounts, part A, PR 7a: running a page.
-- PRD: Grindylocks — Brand and Shop Accounts PRD (Teams, Permissions,
-- Acting as a page, Blocking and muting, Moderation › the owner deletes
-- their account). Mockups: the Brand accounts (v2) page, "running a page"
-- row (Profile-PagesYouManage, Page-TeamView, Page-Edit, Page-Team,
-- Page-Inbox, Delete-Owner-Team, Delete-Owner-Solo).
--
--  1. Team: the members and open invites (page_team(),
--     page_team_invites()), changing a role, removing someone, leaving, and
--     handing ownership over (offer_page_ownership(); the new owner accepts
--     from the bell's Page invites box, already built in PR 5). Changes
--     write page_team_change to the person's bell. Who can do what follows
--     the PRD's matrix: managers invite and move staff up to manager and
--     remove staff; only the owner moves a manager down, removes a manager
--     or hands the page over.
--  2. A page blocks a skater (managers and owners): block_from_page(),
--     unblock_from_page() and the page's Blocked list. Rachel still sees
--     every block in the web admin's Page blocks.
--  3. Edit page: the main language and descriptions, up to 3 links, the
--     header photo, how people visit a shop, Closed for a while (staff too)
--     and Brands we carry; owner-only "closed for good" (a shop) or
--     "stopped making gear" (a brand). Address and pin, and hours, come with
--     PR 7b once their screens are mocked.
--  4. The page's inbox: @mentions of the page from captions, post comments
--     and meetup comments (page_mentions, PR 2), with New and Earlier from a
--     per-member seen marker. Comments on the page's own posts join it with
--     page posts (PR 8). Members who switched on the page's inbox push get a
--     page_mention push for each new mention; it never shows in the bell.
--     my_pages() gains the number of new inbox items, for the dots.
--  5. The owner's delete stop: delete_my_account() refuses while you own a
--     page that has other people on its team (hand it over first). A page
--     where you're the only one goes back to Unofficial, as before.
--     my_owned_pages() feeds the Delete account screen.
--
-- Replaced, same signatures: private.accept_page_invite() (tells the old
-- owner when the hand-over is accepted), public.answer_page_invite() (tells
-- the owner when it's declined), public.delete_my_account(),
-- private.enqueue_push_notification(). Dropped and created again with a new
-- column (same grants): public.my_pages(). Replaced, same columns:
-- public.push_claim() (page_mention). push-send is redeployed with this
-- migration for the page_mention push and the two new team-change sentences.
--
-- Additive otherwise: a table, functions and a trigger.

/* 1. Tables ------------------------------------------------------------------------- */

-- When each member last opened a page's inbox: New is what came after.
create table if not exists public.page_inbox_seen (
  page_id uuid not null references public.pages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (page_id, user_id)
);

alter table public.page_inbox_seen enable row level security;
revoke all on public.page_inbox_seen from anon, authenticated;

/* 2. Team ---------------------------------------------------------------------------- */

-- The team, for the Team screen: everyone on it can see it, and Rachel.
-- Owner first, then managers, then staff, longest-serving first.
create or replace function public.page_team(page uuid)
returns table (
  user_id uuid,
  username text,
  avatar_path text,
  role text,
  joined_at timestamptz,
  is_me boolean
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if private.page_role_of(page) is null and not private.is_rachel() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return query
    select m.user_id, pr.username::text, pr.avatar_path, m.role::text, m.joined_at, m.user_id = auth.uid()
      from page_members m
      join profiles pr on pr.id = m.user_id
     where m.page_id = page
     order by private.page_role_rank(m.role) desc, m.joined_at;
end $$;

-- Open invites for the Team screen's Waiting list (managers and the owner):
-- team invites by username or email, and an ownership hand-over.
create or replace function public.page_team_invites(page uuid)
returns table (
  id uuid,
  kind text,
  role text,
  username text,
  avatar_path text,
  email text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if private.page_role_rank(private.page_role_of(page)) < 2 and not private.is_rachel() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return query
    select i.id, i.kind::text, i.role::text,
           case when pr.deleted_at is null then pr.username::text end,
           case when pr.deleted_at is null then pr.avatar_path end,
           i.email::text, i.created_at, i.expires_at
      from page_invites i
      left join profiles pr on pr.id = i.invitee_id
     where i.page_id = page and i.kind in ('team', 'ownership')
       and private.page_invite_open(i)
     order by i.created_at desc;
end $$;

-- Moves someone between staff and manager. Managers can move staff up;
-- only the owner moves a manager down. Tells the person.
-- Errors: not_allowed, not_on_the_team, invalid_role.
create or replace function public.set_page_member_role(page uuid, member uuid, role public.page_member_role)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  mine public.page_member_role := private.page_role_of(page);
  theirs public.page_member_role := private.page_role_of(page, member);
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if role not in ('staff', 'manager') then
    raise exception using errcode = '22023', message = 'invalid_role';
  end if;
  if theirs is null then
    raise exception using errcode = '22023', message = 'not_on_the_team';
  end if;
  if theirs = 'owner' or member = auth.uid() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if theirs = role then
    return;
  end if;
  -- Only the owner moves a manager down (so two managers can't lock each other out).
  if theirs = 'manager' and mine <> 'owner' then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  update page_members m set role = set_page_member_role.role
   where m.page_id = page and m.user_id = member;
  perform private.notify_page(member, 'page_team_change', page, auth.uid(), 'role:' || role::text);
end $$;

-- Takes someone off the team. The owner removes anyone; managers remove
-- staff only. Tells the person. Errors: not_allowed, not_on_the_team.
create or replace function public.remove_page_member(page uuid, member uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  mine public.page_member_role := private.page_role_of(page);
  theirs public.page_member_role := private.page_role_of(page, member);
begin
  if not private.can_act_as_page(page, 'manager') or member = auth.uid() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if theirs is null then
    raise exception using errcode = '22023', message = 'not_on_the_team';
  end if;
  if theirs = 'owner' or (theirs = 'manager' and mine <> 'owner') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;

  delete from page_members m where m.page_id = page and m.user_id = member;
  delete from page_inbox_seen s where s.page_id = page and s.user_id = member;
  -- An ownership hand-over to them can't go ahead now.
  update page_invites i set cancelled_at = now()
   where i.page_id = page and i.kind = 'ownership' and i.invitee_id = member
     and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;
  perform private.notify_page(member, 'page_team_change', page, auth.uid(), 'removed');
end $$;

-- Leave a page's team yourself. The owner hands the page over first.
-- Works even while the page is suspended or frozen: leaving is always yours.
create or replace function public.leave_page_team(page uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  mine public.page_member_role := private.page_role_of(page);
begin
  if mine is null then
    return;
  end if;
  if mine = 'owner' then
    raise exception using errcode = '42501', message = 'owner_hands_over_first';
  end if;
  delete from page_members m where m.page_id = page and m.user_id = me;
  delete from page_inbox_seen s where s.page_id = page and s.user_id = me;
  update page_invites i set cancelled_at = now()
   where i.page_id = page and i.kind = 'ownership' and i.invitee_id = me
     and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;
end $$;

-- The owner offers the page to someone on the team. They accept or decline
-- from the bell's Page invites box; accepting makes the old owner a manager.
-- One open hand-over at a time: offering again replaces it.
-- Errors: not_allowed, not_on_the_team, suspended (they can't take it now).
create or replace function public.offer_page_ownership(page uuid, member uuid)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  inv uuid;
begin
  if not private.can_act_as_page(page, 'owner') or member = me then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if private.page_role_of(page, member) is null then
    raise exception using errcode = '22023', message = 'not_on_the_team';
  end if;
  if not private.is_in_good_standing(member) then
    raise exception using errcode = '22023', message = 'suspended';
  end if;

  perform 1 from pages p where p.id = page for update;
  update page_invites i set cancelled_at = now()
   where i.page_id = page and i.kind = 'ownership'
     and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;
  delete from notifications n where n.kind = 'page_invite' and n.page_id = page and n.message = 'ownership';

  insert into page_invites (page_id, kind, invitee_id, invited_by)
  values (page, 'ownership', member, me)
  returning id into inv;
  perform private.notify_page(member, 'page_invite', page, me, 'ownership');
  return inv;
end $$;

-- As in PR 5, plus: when a hand-over is accepted, the old owner hears who
-- has the page now (they're a manager from here).
create or replace function private.accept_page_invite(inv public.page_invites, who uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  had public.page_member_role;
  old_owner uuid;
begin
  if inv.kind = 'claim' then
    if exists (select 1 from page_members m where m.page_id = inv.page_id) then
      raise exception using errcode = '22023', message = 'invite_closed';
    end if;
    perform private.make_page_owner(inv.page_id, who, inv.invited_by, inv.logo_path);
  elsif inv.kind = 'ownership' then
    select m.user_id into old_owner from page_members m
     where m.page_id = inv.page_id and m.role = 'owner' and m.user_id <> who;
    update page_members set role = 'manager' where page_id = inv.page_id and role = 'owner' and user_id <> who;
    insert into page_members (page_id, user_id, role, invited_by)
    values (inv.page_id, who, 'owner', inv.invited_by)
    on conflict (page_id, user_id) do update set role = 'owner';
    if old_owner is not null then
      perform private.notify_page(old_owner, 'page_team_change', inv.page_id, who, 'handed_over');
    end if;
  else
    select m.role into had from page_members m where m.page_id = inv.page_id and m.user_id = who;
    if had is null then
      insert into page_members (page_id, user_id, role, invited_by) values (inv.page_id, who, inv.role, inv.invited_by);
    elsif private.page_role_rank(had) < private.page_role_rank(inv.role) then
      update page_members set role = inv.role where page_id = inv.page_id and user_id = who;
    end if;
  end if;

  update page_invites set accepted_at = now(), accepted_by = who where id = inv.id;
  -- Its bell row has done its job.
  delete from notifications n where n.recipient_id = who and n.kind = 'page_invite' and n.page_id = inv.page_id;
end $$;

revoke all on function private.accept_page_invite(public.page_invites, uuid) from public, anon, authenticated;

-- As in PR 5, plus: declining a hand-over tells the owner, who can offer it
-- to someone else (or ask Rachel). Returns the page's handle.
-- Errors: not_found, invite_closed, suspended.
create or replace function public.answer_page_invite(invite uuid, accept boolean)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_email text;
  inv page_invites%rowtype;
begin
  if me is null or not exists (select 1 from profiles p where p.id = me and p.deleted_at is null and p.banned_at is null) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select lower(u.email) into my_email from auth.users u where u.id = me;
  select * into inv from page_invites i
   where i.id = invite and (i.invitee_id = me or (i.invitee_id is null and lower(i.email::text) = my_email))
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'not_found';
  end if;
  if not private.page_invite_open(inv) then
    raise exception using errcode = '22023', message = 'invite_closed';
  end if;

  if accept then
    if not private.is_in_good_standing(me) then
      raise exception using errcode = '42501', message = 'suspended';
    end if;
    perform private.accept_page_invite(inv, me);
  else
    update page_invites set declined_at = now() where id = inv.id;
    delete from notifications n where n.recipient_id = me and n.kind = 'page_invite' and n.page_id = inv.page_id;
    if inv.kind = 'ownership' then
      perform private.notify_page(
        (select m.user_id from page_members m where m.page_id = inv.page_id and m.role = 'owner'),
        'page_team_change', inv.page_id, me, 'ownership_declined');
    end if;
  end if;
  return (select p.handle::text from pages p where p.id = inv.page_id);
end $$;

/* 3. A page blocks a skater ---------------------------------------------------------- */

-- Managers and owners, mainly for harassment in comments. The skater can't
-- follow, mention or (with page posts) comment on the page, and isn't told.
-- Rachel sees every block (Page blocks). Errors: not_allowed, not_found,
-- on_the_team.
create or replace function public.block_from_page(page uuid, who uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if who is null or not exists (select 1 from profiles p where p.id = who) then
    raise exception using errcode = '22023', message = 'not_found';
  end if;
  if private.page_role_of(page, who) is not null then
    raise exception using errcode = '22023', message = 'on_the_team';
  end if;
  insert into page_blocks (page_id, user_id, blocked_by)
  values (page, who, auth.uid())
  on conflict (page_id, user_id) where lifted_at is null do nothing;
end $$;

-- Lifts the page's block. Kept, with who lifted it, for Rachel's Lifted tab.
create or replace function public.unblock_from_page(page uuid, who uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  update page_blocks b set lifted_at = now(), lifted_by = auth.uid()
   where b.page_id = page and b.user_id = who and b.lifted_at is null;
end $$;

-- The page's Blocked list (managers and the owner), newest first.
create or replace function public.page_blocked_people(page uuid)
returns table (
  user_id uuid,
  username text,
  avatar_path text,
  blocked_at timestamptz,
  blocked_by_username text
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if private.page_role_rank(private.page_role_of(page)) < 2 and not private.is_rachel() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return query
    select b.user_id,
           case when pr.deleted_at is null then pr.username::text end,
           case when pr.deleted_at is null then pr.avatar_path end,
           b.created_at,
           case when bb.deleted_at is null then bb.username::text end
      from page_blocks b
      join profiles pr on pr.id = b.user_id
      left join profiles bb on bb.id = b.blocked_by
     where b.page_id = page and b.lifted_at is null
     order by b.created_at desc;
end $$;

/* 4. Edit page ----------------------------------------------------------------------- */

-- Languages a page can write in: the app's four.
create or replace function private.page_language_ok(lang text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select lang in ('en', 'es', 'da', 'de');
$$;

-- The main language and up to 3 links (managers and the owner). Links are
-- kept in the order given; blanks and repeats are dropped.
-- Errors: not_allowed, invalid_language, invalid_link, too_many_links.
create or replace function public.update_page_details(page uuid, main_language text, links text[])
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  clean text[];
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if not private.page_language_ok(main_language) then
    raise exception using errcode = '22023', message = 'invalid_language';
  end if;
  select coalesce(array_agg(u order by first), '{}') into clean
    from (
      select btrim(l) as u, min(o) as first
        from unnest(coalesce(links, '{}')) with ordinality as x(l, o)
       where btrim(coalesce(l, '')) <> ''
       group by btrim(l)
    ) d;
  if cardinality(clean) > 3 then
    raise exception using errcode = '22023', message = 'too_many_links';
  end if;
  if exists (select 1 from unnest(clean) u where char_length(u) not between 4 and 300 or u ~ '\s' or u !~ '\.') then
    raise exception using errcode = '22023', message = 'invalid_link';
  end if;

  update pages p set main_language = update_page_details.main_language, updated_at = now() where p.id = page;
  delete from page_links l where l.page_id = page;
  insert into page_links (page_id, position, url)
  select page, o::smallint, u from unnest(clean) with ordinality as x(u, o);
end $$;

-- The description in one language (managers and the owner). An empty body
-- takes that language off, except the main language's.
-- Errors: not_allowed, invalid_language, too_long, main_language_needed.
create or replace function public.set_page_description(page uuid, locale text, body text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  clean text := btrim(coalesce(body, ''));
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if not private.page_language_ok(locale) then
    raise exception using errcode = '22023', message = 'invalid_language';
  end if;
  if clean = '' then
    if exists (select 1 from pages p where p.id = page and p.main_language = locale) then
      raise exception using errcode = '22023', message = 'main_language_needed';
    end if;
    delete from page_descriptions d where d.page_id = page and d.locale = set_page_description.locale;
    return;
  end if;
  if char_length(clean) > 300 then
    raise exception using errcode = '22023', message = 'too_long';
  end if;
  insert into page_descriptions (page_id, locale, body, source, updated_by, updated_at)
  values (page, locale, clean, 'author', auth.uid(), now())
  on conflict on constraint page_descriptions_pkey do update
    set body = excluded.body, source = 'author', updated_by = excluded.updated_by, updated_at = now();
  -- The team writes its own: Rachel's "Needs translations" flag (PR 6) is moot.
  update pages p set needs_translations_at = null, updated_at = now() where p.id = page;
end $$;

-- The header photo (managers and the owner), already uploaded to the page's
-- folder; null takes it off. Shown with the park header's photocopy look.
create or replace function public.set_page_header(page uuid, path text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if not private.can_manage_page_media(page) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if path is not null and (path not like page::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'page-images' and o.name = path)) then
    raise exception using errcode = '22023', message = 'invalid_header';
  end if;
  update pages p set header_path = path, updated_at = now() where p.id = page;
end $$;

-- How people visit a shop (managers and the owner): storefront, by
-- appointment (with whether its pin shows) or online only.
-- Errors: not_allowed, not_a_shop.
create or replace function public.set_page_location_type(page uuid, location_type public.shop_location_type, show_pin boolean default true)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if not exists (select 1 from pages p where p.id = page and 'shop' = any (p.roles)) then
    raise exception using errcode = '22023', message = 'not_a_shop';
  end if;
  update pages p
     set location_type = set_page_location_type.location_type,
         -- Storefronts always show their pin.
         show_pin = case when set_page_location_type.location_type = 'by_appointment' then coalesce(set_page_location_type.show_pin, false) else true end,
         updated_at = now()
   where p.id = page;
end $$;

-- Closed for a while (everyone on the team: whoever's behind the counter
-- knows). "Closed until [date]" or "Closed for now" with no date, with a
-- note. Off clears all three. Errors: not_allowed, not_a_shop, invalid_date,
-- note_needed, too_long.
create or replace function public.set_page_temp_closed(page uuid, closed boolean, closed_until date default null, note text default null)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  clean text := btrim(coalesce(note, ''));
  tz text;
begin
  if not private.can_act_as_page(page, 'staff') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select coalesce(m.timezone, p.timezone, 'UTC') into tz
    from pages p left join metro_areas m on m.id = p.metro_area_id
   where p.id = page and 'shop' = any (p.roles);
  if not found then
    raise exception using errcode = '22023', message = 'not_a_shop';
  end if;

  if not coalesce(closed, false) then
    update pages p set temp_closed_at = null, temp_closed_until = null, temp_closed_note = null, updated_at = now()
     where p.id = page;
    return;
  end if;
  if closed_until is not null and closed_until < (now() at time zone tz)::date then
    raise exception using errcode = '22023', message = 'invalid_date';
  end if;
  if clean = '' then
    raise exception using errcode = '22023', message = 'note_needed';
  end if;
  if char_length(clean) > 200 then
    raise exception using errcode = '22023', message = 'too_long';
  end if;
  update pages p
     set temp_closed_at = coalesce(p.temp_closed_at, now()),
         temp_closed_until = closed_until,
         temp_closed_note = clean,
         updated_at = now()
   where p.id = page;
end $$;

-- Brands we carry (managers and the owner), in the order given: brand pages
-- only, not the shop itself, at most 60. Errors: not_allowed, not_a_shop,
-- not_a_brand, too_many.
create or replace function public.set_page_brands_carried(page uuid, brands uuid[])
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  clean uuid[];
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if not exists (select 1 from pages p where p.id = page and 'shop' = any (p.roles)) then
    raise exception using errcode = '22023', message = 'not_a_shop';
  end if;
  select coalesce(array_agg(b order by first), '{}') into clean
    from (select b, min(o) as first from unnest(coalesce(brands, '{}')) with ordinality as x(b, o)
           where b is not null and b <> page group by b) d;
  if cardinality(clean) > 60 then
    raise exception using errcode = '22023', message = 'too_many';
  end if;
  if exists (select 1 from unnest(clean) b
              where not exists (select 1 from pages p where p.id = b and 'brand' = any (p.roles))) then
    raise exception using errcode = '22023', message = 'not_a_brand';
  end if;

  delete from page_brands_carried c where c.shop_id = page;
  insert into page_brands_carried (shop_id, brand_id, position)
  select page, b, (o - 1)::smallint from unnest(clean) with ordinality as x(b, o);
  update pages p set updated_at = now() where p.id = page;
end $$;

-- The owner closes the page for good: a shop becomes Closed, a brand that
-- isn't a shop becomes Retired (out of business, this year on the tape). It
-- stays up as a read-only archive with its posts and followers; open team
-- invites are cancelled. Only Rachel can bring it back. (A page's upcoming
-- meetups are cancelled here once pages can host them, PR 9.)
-- Errors: not_allowed.
create or replace function public.close_page_for_good(page uuid)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  p pages%rowtype;
  next_state public.page_state;
begin
  if not private.can_act_as_page(page, 'owner') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select * into p from pages where id = page for update;
  next_state := case when 'shop' = any (p.roles) then 'closed' else 'out_of_business' end;

  update pages
     set state = next_state,
         closed_at = case when next_state = 'closed' then now() else closed_at end,
         ended_label = case when next_state = 'out_of_business'
                            then coalesce(ended_label, extract(year from now())::int::text) else ended_label end,
         temp_closed_at = null, temp_closed_until = null, temp_closed_note = null,
         updated_at = now()
   where id = page;

  update page_invites i set cancelled_at = now()
   where i.page_id = page and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;
  return next_state::text;
end $$;

/* 5. The page's inbox ---------------------------------------------------------------- */

-- New items since a member last opened the inbox (for the dots).
create or replace function private.page_inbox_new(page uuid, who uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select count(*)::integer
    from page_mentions pm
    join profiles a on a.id = pm.author_id
   where pm.page_id = page
     and pm.created_at > coalesce((select s.seen_at from page_inbox_seen s where s.page_id = page and s.user_id = who),
                                  (select m.joined_at from page_members m where m.page_id = page and m.user_id = who),
                                  '-infinity')
     and pm.author_id <> who
     and a.deleted_at is null and a.banned_at is null
     and (pm.post_id is null or private.can_see_post_as(pm.post_id, who))
     and not exists (select 1 from page_blocks b where b.page_id = page and b.user_id = pm.author_id and b.lifted_at is null)
     and not exists (select 1 from blocks b
                      where (b.blocker_id = who and b.blocked_id = pm.author_id) or (b.blocker_id = pm.author_id and b.blocked_id = who));
$$;

-- The inbox (anyone on the team): @mentions of the page, newest first, with
-- what was said. Left out: authors the page blocked, authors who blocked the
-- page (their mentions aren't kept), people blocked either way with you,
-- deleted or banned accounts, and posts or meetups you can't see.
create or replace function public.page_inbox(page uuid, max_rows integer default 100)
returns table (
  id uuid,
  kind text,
  created_at timestamptz,
  unread boolean,
  author_id uuid,
  author_username text,
  author_avatar_path text,
  body text,
  post_id uuid,
  comment_id uuid,
  event_id uuid,
  event_comment_id uuid,
  event_title text
)
language plpgsql stable security definer
set search_path = public
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
    select pm.id,
           case when pm.event_comment_id is not null then 'meetup_comment'
                when pm.comment_id is not null then 'comment'
                else 'caption' end,
           pm.created_at,
           pm.created_at > seen and pm.author_id <> me,
           pm.author_id, a.username::text, a.avatar_path,
           left(coalesce(ec.body, c.body, po.caption), 280),
           pm.post_id, pm.comment_id, ec.event_id, pm.event_comment_id,
           coalesce(ev.title, ev.note)::text
      from page_mentions pm
      join profiles a on a.id = pm.author_id
      left join posts po on po.id = pm.post_id
      left join comments c on c.id = pm.comment_id
      left join event_comments ec on ec.id = pm.event_comment_id
      left join events ev on ev.id = ec.event_id
     where pm.page_id = page
       and a.deleted_at is null and a.banned_at is null
       and not exists (select 1 from page_blocks b where b.page_id = page and b.user_id = pm.author_id and b.lifted_at is null)
       and not private.blocked_between(pm.author_id)
       and (pm.post_id is null or private.can_see_post_as(pm.post_id, me))
       and (ec.id is null or private.can_see_event_as(ec.event_id, me))
     order by pm.created_at desc
     limit greatest(1, least(coalesce(max_rows, 100), 200));
end $$;

-- Opening the inbox: everything up to now is Earlier.
create or replace function public.mark_page_inbox_seen(page uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if private.page_role_of(page) is null then
    return;
  end if;
  insert into page_inbox_seen (page_id, user_id, seen_at) values (page, auth.uid(), now())
  on conflict (page_id, user_id) do update set seen_at = now();
end $$;

-- A new mention buzzes the team members who switched on this page's inbox
-- push (off by default). Not the bell: mentions of a page are the page's.
create or replace function private.notify_page_mention()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  ev uuid;
begin
  if new.event_comment_id is not null then
    select ec.event_id into ev from event_comments ec where ec.id = new.event_comment_id;
  end if;
  insert into notifications (recipient_id, kind, actor_id, page_id, post_id, comment_id, event_id, event_comment_id)
  select m.user_id, 'page_mention', new.author_id, new.page_id, new.post_id, new.comment_id, ev, new.event_comment_id
    from page_members m
    join profiles r on r.id = m.user_id
    join pages p on p.id = m.page_id
   where m.page_id = new.page_id
     and m.inbox_push
     and m.user_id <> new.author_id
     and p.state = 'managed'
     and r.deleted_at is null and r.banned_at is null
     and not exists (select 1 from blocks b
                      where (b.blocker_id = m.user_id and b.blocked_id = new.author_id)
                         or (b.blocker_id = new.author_id and b.blocked_id = m.user_id));
  return null;
end $$;

drop trigger if exists page_mentions_notify on public.page_mentions;
create trigger page_mentions_notify
  after insert on public.page_mentions
  for each row execute function private.notify_page_mention();

-- As in PR 5, plus how many inbox items are new for you.
drop function if exists public.my_pages();

create function public.my_pages()
returns table (
  page_id uuid,
  handle text,
  display_name text,
  roles text[],
  state text,
  logo_path text,
  role text,
  inbox_push boolean,
  inbox_new integer
)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.handle::text, p.display_name, p.roles::text[], p.state::text,
         case when p.state = 'managed' then p.logo_path end,
         m.role::text, m.inbox_push,
         private.page_inbox_new(p.id, m.user_id)
    from page_members m
    join pages p on p.id = m.page_id
   where m.user_id = auth.uid()
   order by p.display_name;
$$;

/* 6. Deleting your account while you own a page --------------------------------------- */

-- The pages you own, for Delete account: how many are on the team, an open
-- hand-over (and to whom), or who last declined one.
create or replace function public.my_owned_pages()
returns table (
  page_id uuid,
  handle text,
  display_name text,
  roles text[],
  state text,
  logo_path text,
  team_size integer,
  handover_id uuid,
  handover_username text,
  declined_username text
)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.handle::text, p.display_name, p.roles::text[], p.state::text,
         case when p.state = 'managed' then p.logo_path end,
         (select count(*)::integer from page_members t where t.page_id = p.id),
         open_inv.id, open_inv.username,
         case when open_inv.id is null then last_inv.declined_username end
    from page_members m
    join pages p on p.id = m.page_id
    left join lateral (
      select i.id, pr.username::text as username
        from page_invites i join profiles pr on pr.id = i.invitee_id
       where i.page_id = p.id and i.kind = 'ownership' and private.page_invite_open(i)
       order by i.created_at desc limit 1
    ) open_inv on true
    left join lateral (
      select case when i.declined_at is not null then pr.username::text end as declined_username
        from page_invites i join profiles pr on pr.id = i.invitee_id
       where i.page_id = p.id and i.kind = 'ownership'
       order by i.created_at desc limit 1
    ) last_inv on true
   where m.user_id = auth.uid() and m.role = 'owner'
   order by p.display_name;
$$;

-- As in M5, plus the owner's delete stop: while you own a page that has
-- other people on its team, hand it over first (Delete-Owner-Team). A page
-- where you're the only one goes back to Unofficial when your roles end
-- (Delete-Owner-Solo).
create or replace function public.delete_my_account(keep_posts boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  last_code timestamptz;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if exists (select 1 from profiles where id = me and deleted_at is not null) then
    return;
  end if;

  if exists (
    select 1 from page_members m
     where m.user_id = me and m.role = 'owner'
       and exists (select 1 from page_members t where t.page_id = m.page_id and t.user_id <> me)
  ) then
    raise exception 'transfer_page_first' using errcode = '42501';
  end if;

  select max(to_timestamp((m ->> 'timestamp')::double precision)) into last_code
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
   where m ->> 'method' = 'otp';
  if last_code is null or last_code < now() - interval '15 minutes' then
    raise exception 'confirm_with_a_code' using errcode = '42501';
  end if;

  perform private.end_roles(me, 'account_deleted', me);

  update invites set cancelled_at = now()
   where inviter_id = me and used_by is null and cancelled_at is null and returned_at is null;

  if keep_posts then
    update posts set anonymized = true where author_id = me;
    update park_photos set photographer = ''
     where uploaded_by = me and photographer = (select username::text from profiles where id = me);
  else
    update posts set status = 'deleted' where author_id = me and status <> 'deleted';
    update comments set deleted_at = now() where author_id = me and deleted_at is null;
    update park_photos set archived_at = now() where uploaded_by = me and archived_at is null;
  end if;

  delete from likes where user_id = me;
  delete from follows where follower_id = me or followee_id = me;
  delete from saved_parks where user_id = me;
  delete from blocks where blocker_id = me;
  delete from notifications where recipient_id = me;
  delete from announcements where user_id = me;
  delete from reserved_usernames where user_id = me;
  delete from admin_seen where user_id = me;
  delete from private.push_devices where user_id = me;
  delete from private.push_settings where user_id = me;
  delete from private.push_outbox where recipient_id = me;
  delete from page_inbox_seen where user_id = me;

  update profiles
     set deleted_at = now(), username = null, avatar_path = null, bio = null,
         home_metro_area_id = null, home_park_id = null, disciplines = '{}',
         open_to_meetup = false, hide_from_regulars = true, is_private = true
   where id = me;
end;
$$;

/* 7. Push ------------------------------------------------------------------------------ */

create or replace function private.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'park_report_accepted', 'caption_mention',
                  'meetup_changed', 'meetup_cancelled', 'meetup_reminder', 'meetup_comment',
                  'page_invite', 'page_claim_approved', 'page_claim_declined', 'page_team_change',
                  'page_claimed', 'suggestion_live', 'page_mention')
     and exists (select 1 from private.push_devices d where d.user_id = new.recipient_id) then
    insert into private.push_outbox (recipient_id, notification_id) values (new.recipient_id, new.id);
  end if;
  return null;
end $$;

-- As in PR 5, plus page_mention: a mention of a page you're on, for members
-- who switched on that page's inbox push. Same columns, so it's replaced in
-- place and keeps its grants.
create or replace function public.push_claim(max_rows integer default 100)
returns table (
  outbox_id bigint,
  send boolean,
  kind text,
  actor_username text,
  comment_body text,
  post_id uuid,
  park_name text,
  park_slug text,
  metro_name text,
  devices jsonb,
  event_id uuid,
  event_starts_at timestamptz,
  event_timezone text,
  event_title text,
  detail text,
  page_handle text,
  page_name text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select o.id
      from private.push_outbox o
     where o.sent_at is null
       and o.attempts < 3
       and o.created_at > now() - interval '1 day'
       and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
     order by o.id
     limit greatest(1, least(max_rows, 500))
     for update skip locked
  ),
  claimed as (
    update private.push_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
      from picked
     where o.id = picked.id
    returning o.*
  ),
  -- Notifications: the same reply / mention / comment split as the bell.
  from_notifications as (
    select cl.id as oid,
           cl.recipient_id as rid,
           case
             when n.kind = 'comment' then
               case
                 when c.reply_to_user_id = cl.recipient_id
                   or (select pc.author_id from comments pc where pc.id = c.parent_id) = cl.recipient_id then 'reply'
                 when p.author_id = cl.recipient_id then 'comment'
                 else 'mention'
               end
             when n.kind = 'meetup_comment' then
               case
                 when ec.reply_to_user_id = cl.recipient_id
                   or (select k.author_id from event_comments k where k.id = ec.parent_id) = cl.recipient_id then 'meetup_reply'
                 when private.hosts_series(ev.series_id, cl.recipient_id) then 'meetup_comment'
                 else 'meetup_mention'
               end
             else n.kind::text
           end as k,
           n.actor_id as aid,
           a.username::text as uname,
           case when n.kind = 'caption_mention' then p.caption
                when n.kind = 'meetup_comment' then ec.body
                -- A page's inbox: what mentioned it (a meetup comment, a comment or a caption).
                when n.kind = 'page_mention' then coalesce(ec.body, c.body, p.caption)
                else c.body end as cbody,
           n.post_id as pid,
           coalesce(fx.display_name, evp.display_name)::text as pk,
           coalesce(fx.slug, evp.slug)::text as pslug,
           null::text as metro,
           (n.id is not null
             and (n.comment_id is null or (c.id is not null and c.deleted_at is null))
             and (n.post_id is null or private.can_see_post_as(n.post_id, cl.recipient_id))
             and (n.event_id is null or private.can_see_event_as(n.event_id, cl.recipient_id))
             and (n.event_comment_id is null or (ec.id is not null and ec.deleted_at is null))
             and (n.kind <> 'meetup_reminder' or (ev.status = 'scheduled' and ev.starts_at > now()))
             and (a.id is null or a.deleted_at is null)
             -- Page notices need their page.
             and (n.kind::text not like 'page%' and n.kind <> 'suggestion_live' or pg.id is not null)
             -- A page's inbox push: still on the team with the switch on, and the page hasn't blocked the author.
             and (n.kind <> 'page_mention' or (
                   exists (select 1 from page_members m
                            where m.page_id = n.page_id and m.user_id = cl.recipient_id and m.inbox_push)
                   and not exists (select 1 from page_blocks b
                                    where b.page_id = n.page_id and b.user_id = n.actor_id and b.lifted_at is null)))) as ok,
           ev.id as eid,
           ev.starts_at as estart,
           case when ev.id is not null then private.park_tz(ev.park_id) end as etz,
           coalesce(ev.title, ev.note)::text as etitle,
           case when n.kind in ('meetup_changed', 'meetup_cancelled', 'page_claim_declined', 'page_team_change', 'suggestion_live',
                                'page_invite')
                then n.message end as edetail,
           pg.handle::text as phandle,
           pg.display_name::text as pname
      from claimed cl
      left join notifications n on n.id = cl.notification_id
      left join comments c on c.id = n.comment_id
      left join posts p on p.id = n.post_id
      left join profiles a on a.id = n.actor_id
      -- A park fix going live names the park.
      left join parks fx on fx.id = n.park_id and n.kind = 'park_report_accepted'
      left join event_comments ec on ec.id = n.event_comment_id
      left join events ev on ev.id = n.event_id
      left join parks evp on evp.id = ev.park_id
      left join pages pg on pg.id = n.page_id
     where cl.notification_id is not null
  ),
  from_announcements as (
    select cl.id,
           cl.recipient_id,
           case when an.kind = 'visiting' then 'visiting' else 'someone_new' end,
           an.user_id,
           u.username::text,
           null::text,
           null::uuid,
           pk.display_name::text,
           pk.slug::text,
           ma.name::text,
           (an.id is not null
             and u.deleted_at is null
             and u.banned_at is null
             and r.home_metro_area_id = an.metro_area_id),
           null::uuid,
           null::timestamptz,
           null::text,
           null::text,
           null::text,
           null::text,
           null::text
      from claimed cl
      left join announcements an on an.id = cl.announcement_id
      left join profiles u on u.id = an.user_id
      left join profiles r on r.id = cl.recipient_id
      left join parks pk on pk.id = an.park_id
      left join metro_areas ma on ma.id = an.metro_area_id
     where cl.announcement_id is not null
  ),
  everything as (
    select * from from_notifications
    union all
    select * from from_announcements
  )
  select e.oid,
         (e.ok
           and r.deleted_at is null
           and (e.aid is null or not exists (
                 select 1 from blocks b
                  where (b.blocker_id = e.rid and b.blocked_id = e.aid)
                     or (b.blocker_id = e.aid and b.blocked_id = e.rid)))
           and case e.k
                 when 'comment' then coalesce(s.comments, true)
                 when 'reply' then coalesce(s.comments, true)
                 when 'mention' then coalesce(s.mentions, true)
                 when 'caption_mention' then coalesce(s.mentions, true)
                 when 'tag' then coalesce(s.tags, true)
                 when 'filmer_credit' then coalesce(s.filmer_credits, true)
                 when 'invite_used' then coalesce(s.invites, true)
                 when 'someone_new' then coalesce(s.someone_new, true)
                 when 'visiting' then coalesce(s.someone_new, true)
                 when 'park_report_accepted' then coalesce(s.park_fixes, true)
                 when 'meetup_changed' then coalesce(s.meetups, true)
                 when 'meetup_cancelled' then coalesce(s.meetups, true)
                 when 'meetup_reminder' then coalesce(s.meetups, true)
                 when 'meetup_comment' then coalesce(s.comments, true)
                 when 'meetup_reply' then coalesce(s.comments, true)
                 when 'meetup_mention' then coalesce(s.mentions, true)
                 when 'page_invite' then coalesce(s.teams_claims, true)
                 when 'page_claim_approved' then coalesce(s.teams_claims, true)
                 when 'page_claim_declined' then coalesce(s.teams_claims, true)
                 when 'page_team_change' then coalesce(s.teams_claims, true)
                 when 'page_claimed' then coalesce(s.pages_joining, true)
                 when 'suggestion_live' then coalesce(s.park_fixes, true)
                 -- The page's own switch (Inboxes of pages you manage) decided it already.
                 when 'page_mention' then true
                 else false
               end
           and dv.list is not null),
         e.k,
         e.uname,
         left(e.cbody, 140),
         e.pid,
         e.pk,
         e.pslug,
         e.metro,
         coalesce(dv.list, '[]'::jsonb),
         e.eid,
         e.estart,
         e.etz,
         left(e.etitle, 80),
         left(e.edetail, 140),
         e.phandle,
         e.pname
    from everything e
    join profiles r on r.id = e.rid
    left join private.push_settings s on s.user_id = e.rid
    left join lateral (
      select jsonb_agg(jsonb_build_object('token', d.token, 'language', d.language)) as list
        from private.push_devices d
       where d.user_id = e.rid
    ) dv on true
   order by e.oid;
end $$;


/* Grants ------------------------------------------------------------------------------- */

revoke all on function private.page_language_ok(text) from public, anon, authenticated;
revoke all on function private.page_inbox_new(uuid, uuid) from public, anon, authenticated;
revoke all on function private.notify_page_mention() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.page_team(uuid)',
    'public.page_team_invites(uuid)',
    'public.set_page_member_role(uuid, uuid, public.page_member_role)',
    'public.remove_page_member(uuid, uuid)',
    'public.leave_page_team(uuid)',
    'public.offer_page_ownership(uuid, uuid)',
    'public.answer_page_invite(uuid, boolean)',
    'public.block_from_page(uuid, uuid)',
    'public.unblock_from_page(uuid, uuid)',
    'public.page_blocked_people(uuid)',
    'public.update_page_details(uuid, text, text[])',
    'public.set_page_description(uuid, text, text)',
    'public.set_page_header(uuid, text)',
    'public.set_page_location_type(uuid, public.shop_location_type, boolean)',
    'public.set_page_temp_closed(uuid, boolean, date, text)',
    'public.set_page_brands_carried(uuid, uuid[])',
    'public.close_page_for_good(uuid)',
    'public.page_inbox(uuid, integer)',
    'public.mark_page_inbox_seen(uuid)',
    'public.my_pages()',
    'public.my_owned_pages()',
    'public.delete_my_account(boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
declare
  r text := '';
  ok int := 0; total int := 0;
  them uuid := (select id from public.pages where handle = 'themskates');      -- a brand
  eightset uuid := (select id from public.pages where handle = '8set_store');  -- a shop (and a brand)
  bones uuid := (select id from public.pages where handle = 'bonesbearings');
  o uuid := gen_random_uuid();   -- owns Them and 8SET
  m uuid := gen_random_uuid();   -- manager on Them
  s uuid := gen_random_uuid();   -- staff on Them, then on 8SET
  x uuid := gen_random_uuid();   -- a skater who mentions Them
  y uuid := gen_random_uuid();   -- owns Bones alone
  u uuid;
  inv uuid;
  post uuid;
  n int;
  res text;
  rec record;
begin
  -- Throwaway members, made in this transaction (it rolls back).
  foreach u in array array[o, m, s, x, y] loop
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'team-check-' || u || '@example.com', now(), now(), '{}'::jsonb);
    insert into public.profiles (id) values (u) on conflict (id) do nothing;
    update public.profiles set onboarded_at = now(), age_confirmed_at = now(),
      disciplines = '{inline}', home_metro_area_id = (select id from public.metro_areas limit 1),
      username = 'teamcheck' || left(replace(u::text, '-', ''), 8) where id = u;
  end loop;

  -- Rachel hands out the pages (as from the SQL editor).
  perform private.make_page_owner(them, o, null);
  perform private.make_page_owner(eightset, o, null);
  perform private.make_page_owner(bones, y, null);
  insert into public.page_members (page_id, user_id, role) values (them, m, 'manager'), (them, s, 'staff');
  update public.page_members set inbox_push = true where page_id = them and user_id = m;
  -- Joined a while ago, so a mention made now is new for them (now() is fixed within a transaction).
  update public.page_members set joined_at = now() - interval '1 hour' where user_id in (o, m, s, y);
  insert into private.push_devices (user_id, token, platform, language)
  values (m, 'ExponentPushToken[team-check]', 'ios', 'en') on conflict do nothing;

  /* The inbox -------------------------------------------------------------------- */
  insert into public.posts (author_id, metro_area_id, caption, published_at)
  values (x, (select id from public.metro_areas limit 1), 'new frames from @themskates', now())
  returning id into post;

  total := total + 1;
  if exists (select 1 from public.page_mentions where page_id = them and post_id = post) then ok := ok + 1;
  else r := r || 'FAIL mention not kept; '; end if;

  total := total + 1;
  select count(*) into n from public.notifications where kind = 'page_mention' and page_id = them;
  if n = 1 and exists (select 1 from public.notifications where kind = 'page_mention' and recipient_id = m)
  then ok := ok + 1; else r := r || 'FAIL inbox push rows ' || n || '; '; end if;

  total := total + 1;
  if exists (select 1 from private.push_outbox ob join public.notifications nn on nn.id = ob.notification_id
              where nn.kind = 'page_mention' and ob.recipient_id = m)
  then ok := ok + 1; else r := r || 'FAIL inbox push not queued; '; end if;

  total := total + 1;
  n := 0;
  for rec in select * from public.push_claim(500) loop
    if rec.kind = 'page_mention' and rec.send and rec.comment_body = 'new frames from @themskates' and rec.page_name is not null then
      n := 1;
    end if;
  end loop;
  if n = 1 then ok := ok + 1; else r := r || 'FAIL push_claim page_mention; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into n from public.page_inbox(them) i where i.unread and i.post_id = post and i.kind = 'caption';
  if n = 1 then ok := ok + 1; else r := r || 'FAIL staff inbox ' || n || '; '; end if;

  total := total + 1;
  if (select inbox_new from public.my_pages() where page_id = them) = 1 then ok := ok + 1;
  else r := r || 'FAIL inbox_new before seen; '; end if;

  perform public.mark_page_inbox_seen(them);
  total := total + 1;
  if (select inbox_new from public.my_pages() where page_id = them) = 0
     and not exists (select 1 from public.page_inbox(them) i where i.unread)
  then ok := ok + 1; else r := r || 'FAIL seen marker; '; end if;

  total := total + 1;
  begin
    perform public.block_from_page(them, x);
    r := r || 'FAIL staff blocked a skater; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.page_team_invites(them);
    r := r || 'FAIL staff read invites; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  select count(*) into n from public.page_team(them);
  if n = 3 and (select t.role from public.page_team(them) t limit 1) = 'owner' then ok := ok + 1;
  else r := r || 'FAIL staff sees team ' || n || '; '; end if;

  total := total + 1;
  begin
    perform public.update_page_details(them, 'en', array['themskates.com']);
    r := r || 'FAIL staff edited details; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  /* An outsider ------------------------------------------------------------------ */
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.page_inbox(them);
    r := r || 'FAIL outsider read inbox; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.page_team(them);
    r := r || 'FAIL outsider read team; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform 1 from public.page_inbox_seen;
    r := r || 'FAIL outsider reads seen markers; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  /* The manager ------------------------------------------------------------------ */
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);

  perform public.block_from_page(them, x);
  perform public.block_from_page(them, x);  -- again: nothing new
  total := total + 1;
  select count(*) into n from public.page_blocked_people(them);
  if n = 1 and not exists (select 1 from public.page_inbox(them) i where i.author_id = x)
  then ok := ok + 1; else r := r || 'FAIL block list or inbox after block (' || n || '); '; end if;

  total := total + 1;
  begin
    perform public.block_from_page(them, s);
    r := r || 'FAIL blocked a teammate; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  perform public.unblock_from_page(them, x);
  total := total + 1;
  select count(*) into n from public.page_blocked_people(them);
  if n = 0 and exists (select 1 from public.page_inbox(them) i where i.author_id = x) then ok := ok + 1;
  else r := r || 'FAIL unblock; '; end if;

  perform public.set_page_member_role(them, s, 'manager');
  total := total + 1;
  if private.page_role_of(them, s) = 'manager' then ok := ok + 1; else r := r || 'FAIL manager promoted staff; '; end if;

  total := total + 1;
  begin
    perform public.set_page_member_role(them, s, 'staff');
    r := r || 'FAIL manager demoted a manager; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.remove_page_member(them, s);
    r := r || 'FAIL manager removed a manager; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.offer_page_ownership(them, m);
    r := r || 'FAIL manager offered ownership; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.close_page_for_good(them);
    r := r || 'FAIL manager closed the page; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  -- Edit page.
  perform public.update_page_details(them, 'da', array[' themskates.com ', 'instagram.com/themskates', 'themskates.com', '']);
  total := total + 1;
  if (select main_language from public.pages where id = them) = 'da'
     and (select array_agg(url order by position) from public.page_links where page_id = them)
         = array['themskates.com', 'instagram.com/themskates']
  then ok := ok + 1; else r := r || 'FAIL details and links; '; end if;

  total := total + 1;
  begin
    perform public.update_page_details(them, 'da', array['a.com', 'b.com', 'c.com', 'd.com']);
    r := r || 'FAIL four links; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  perform public.set_page_description(them, 'da', 'Skøjter fra Santa Ana.');
  perform public.set_page_description(them, 'en', 'Skates from Santa Ana.');
  perform public.set_page_description(them, 'en', '');
  total := total + 1;
  if (select body from public.page_descriptions where page_id = them and locale = 'da') = 'Skøjter fra Santa Ana.'
     and not exists (select 1 from public.page_descriptions where page_id = them and locale = 'en')
  then ok := ok + 1; else r := r || 'FAIL descriptions; '; end if;

  total := total + 1;
  begin
    perform public.set_page_description(them, 'da', '  ');
    r := r || 'FAIL emptied the main language; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.set_page_temp_closed(them, true, null, 'Away');
    r := r || 'FAIL temp closed a brand; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.set_page_header(them, them::text || '/nope.jpg');
    r := r || 'FAIL header that isn''t there; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  /* Staff on a shop ------------------------------------------------------------- */
  execute 'reset role';
  insert into public.page_members (page_id, user_id, role) values (eightset, s, 'staff');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);

  perform public.set_page_temp_closed(eightset, true, (now() + interval '10 days')::date, 'Moving next door');
  total := total + 1;
  if (select temp_closed_note from public.pages where id = eightset) = 'Moving next door'
     and (select temp_closed_until from public.pages where id = eightset) is not null
  then ok := ok + 1; else r := r || 'FAIL staff closed for a while; '; end if;

  total := total + 1;
  begin
    perform public.set_page_temp_closed(eightset, true, '2020-01-01', 'Back soon');
    r := r || 'FAIL a date in the past; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  perform public.set_page_temp_closed(eightset, false);
  total := total + 1;
  if (select temp_closed_at is null and temp_closed_note is null from public.pages where id = eightset) then ok := ok + 1;
  else r := r || 'FAIL reopen; '; end if;

  total := total + 1;
  begin
    perform public.set_page_location_type(eightset, 'online_only');
    r := r || 'FAIL staff changed how people visit; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  /* The owner -------------------------------------------------------------------- */
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);

  perform public.set_page_location_type(eightset, 'by_appointment', false);
  total := total + 1;
  if (select location_type::text = 'by_appointment' and not show_pin from public.pages where id = eightset) then ok := ok + 1;
  else r := r || 'FAIL location type; '; end if;

  perform public.set_page_brands_carried(eightset, array[them, bones, them, eightset]);
  total := total + 1;
  if (select array_agg(brand_id order by position) from public.page_brands_carried where shop_id = eightset) = array[them, bones]
  then ok := ok + 1; else r := r || 'FAIL brands carried; '; end if;

  total := total + 1;
  begin
    perform public.set_page_brands_carried(eightset, array[(select id from public.pages where 'shop' = any (roles) and not 'brand' = any (roles) limit 1)]);
    r := r || 'FAIL carried a shop; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  perform public.set_page_member_role(them, s, 'staff');
  total := total + 1;
  execute 'reset role';
  if private.page_role_of(them, s) = 'staff'
     and exists (select 1 from public.notifications where recipient_id = s and kind = 'page_team_change' and message = 'role:staff')
  then ok := ok + 1; else r := r || 'FAIL owner demoted a manager; '; end if;
  execute 'set local role authenticated';

  -- The delete stop: a page with a team needs a new owner first.
  total := total + 1;
  begin
    perform public.delete_my_account(true);
    r := r || 'FAIL deleted while owning a team; ';
  exception when insufficient_privilege then
    get stacked diagnostics res = message_text;
    if res = 'transfer_page_first' then ok := ok + 1; else r := r || 'FAIL delete stop said ' || res || '; '; end if;
  end;

  total := total + 1;
  select count(*) into n from public.my_owned_pages() p where p.team_size >= 2;
  if n = 2 then ok := ok + 1; else r := r || 'FAIL owned pages ' || n || '; '; end if;

  -- Hand Them over to the manager, who declines, then to staff, who accepts.
  inv := public.offer_page_ownership(them, m);
  total := total + 1;
  if (select handover_username from public.my_owned_pages() where page_id = them) is not null then ok := ok + 1;
  else r := r || 'FAIL open hand-over not shown; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.answer_page_invite(inv, false);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  total := total + 1;
  if (select declined_username from public.my_owned_pages() where page_id = them) is not null
     and exists (select 1 from public.notifications where recipient_id = o and message = 'ownership_declined')
  then ok := ok + 1; else r := r || 'FAIL decline not shown to the owner; '; end if;

  inv := public.offer_page_ownership(them, s);
  perform public.offer_page_ownership(them, s);  -- again: replaces the first
  total := total + 1;
  select count(*) into n from public.page_team_invites(them) i where i.kind = 'ownership';
  if n = 1 then ok := ok + 1; else r := r || 'FAIL two open hand-overs (' || n || '); '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  select i.id into inv from public.my_page_invites() i where i.kind = 'ownership';
  perform public.answer_page_invite(inv, true);
  total := total + 1;
  execute 'reset role';
  if private.page_role_of(them, s) = 'owner' and private.page_role_of(them, o) = 'manager'
     and exists (select 1 from public.notifications where recipient_id = o and message = 'handed_over')
  then ok := ok + 1; else r := r || 'FAIL hand-over accepted; '; end if;
  execute 'set local role authenticated';

  -- The new owner removes the old one, now a manager.
  perform public.remove_page_member(them, o);
  total := total + 1;
  execute 'reset role';
  if private.page_role_of(them, o) is null
     and exists (select 1 from public.notifications where recipient_id = o and message = 'removed')
  then ok := ok + 1; else r := r || 'FAIL owner removed a manager; '; end if;
  execute 'set local role authenticated';

  total := total + 1;
  begin
    perform public.leave_page_team(them);
    r := r || 'FAIL owner left; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.leave_page_team(them);
  total := total + 1;
  if private.page_role_of(them, m) is null then ok := ok + 1; else r := r || 'FAIL manager left; '; end if;

  -- The new owner closes Them for good: a brand retires.
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  res := public.close_page_for_good(them);
  total := total + 1;
  if res = 'out_of_business' and (select ended_label from public.pages where id = them) is not null then ok := ok + 1;
  else r := r || 'FAIL retire ' || coalesce(res, 'null') || '; '; end if;

  total := total + 1;
  begin
    perform public.update_page_details(them, 'en', '{}');
    r := r || 'FAIL edited an archive; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  -- 8SET's owner (o) closes the shop.
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  total := total + 1;
  res := public.close_page_for_good(eightset);
  execute 'reset role';
  if res = 'closed' and (select closed_at is not null and state = 'closed' from public.pages where id = eightset)
  then ok := ok + 1; else r := r || 'FAIL close shop ' || coalesce(res, 'null') || ' '
    || coalesce((select state::text || '/' || coalesce(closed_at::text, '-') from public.pages where id = eightset), '?') || '; '; end if;
  execute 'set local role authenticated';

  -- A solo owner isn't stopped by the page (only by the sign-in code).
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform public.delete_my_account(true);
    r := r || 'FAIL deleted without a code; ';
  exception when insufficient_privilege then
    get stacked diagnostics res = message_text;
    if res = 'confirm_with_a_code' then ok := ok + 1; else r := r || 'FAIL solo owner stopped by ' || res || '; '; end if;
  end;

  raise exception 'CHECK % of %: %', ok, total, r;
end $$;
rollback;
