-- Sponsorships (brand and shop accounts, part B), PR 1: the data model, the
-- functions the app calls, and the hooks into blocks, bans, deleted
-- accounts, page states, merges and pushes. Needs 20261107152646_sponsorships_enums.
-- PRD: Grindylocks — Brand and Shop Accounts PRD (Sponsorships). Mockups: the
-- two Sponsorships (part B) rows on the Brand accounts (v2) page.
--
--   sponsorships              one row per invite. pending → active (accepted)
--                             → ended; or pending → declined, cancelled or
--                             expired. Ended rows are the team's Former riders.
--   page_sponsorship_levels   a page's levels switched off or renamed (no row:
--                             on, with its usual name).
--   product_riders            pro models a rider confirmed while accepting.
--                             They stay linked after the sponsorship ends
--                             (Rachel, Nov 7); the rider can unlink one.
--
-- The rules (Nov 7): managers and owners of a managed page with a logo send
-- invites (brands, shops and organizers alike); any member who has finished
-- onboarding can be sponsored, by several pages; one open invite per page and
-- rider, expiring after 30 days; page-initiated only; accepting is public,
-- even for private accounts; a level change takes effect at once (up pushes,
-- down is bell only); either side ends it quietly, only the other side is
-- told, and nothing stays on the profile. A block either way ends it, as do a
-- ban or a deleted account. A page that can't send any more (archived,
-- suspended, frozen, back to Unofficial or without a logo) keeps its riders,
-- and its waiting invites are cancelled. A merge keeps the target's
-- sponsorship when a rider has one on both pages (Rachel, Nov 7).

/* Tables ------------------------------------------------------------------------------- */

create table public.sponsorships (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  level public.sponsorship_level not null,
  status public.sponsorship_status not null default 'pending',
  -- Who sent it, for "Sent by mads.rolls for Them's team" on the accept sheet.
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  answered_at timestamptz,
  accepted_at timestamptz,
  level_changed_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles(id) on delete set null,
  -- Why a pending invite closed or an active sponsorship ended.
  closed_reason text check (closed_reason in ('rider', 'page', 'block', 'account', 'merged', 'page_changed', 'level_off')),
  check ((status in ('active', 'ended')) = (accepted_at is not null)),
  check ((status = 'ended') = (ended_at is not null))
);

-- One open invite and one sponsorship per page and rider.
create unique index sponsorships_one_pending on public.sponsorships (page_id, rider_id) where status = 'pending';
create unique index sponsorships_one_active on public.sponsorships (page_id, rider_id) where status = 'active';
create index sponsorships_rider on public.sponsorships (rider_id, status);
create index sponsorships_page on public.sponsorships (page_id, status);
create index sponsorships_expiring on public.sponsorships (expires_at) where status = 'pending';
create index sponsorships_sent_by on public.sponsorships (sent_by) where sent_by is not null;

create table public.page_sponsorship_levels (
  page_id uuid not null references public.pages(id) on delete cascade,
  level public.sponsorship_level not null,
  enabled boolean not null default true,
  -- Shown in capitals on badges; null keeps the usual name (Flow, Am, Pro, Ambassador).
  name text check (name is null or char_length(name) between 1 and 16 and name = btrim(name)),
  updated_at timestamptz not null default now(),
  primary key (page_id, level)
);

create table public.product_riders (
  product_id uuid not null references public.products(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  sponsorship_id uuid references public.sponsorships(id) on delete set null,
  primary key (product_id, rider_id)
);
create index product_riders_rider on public.product_riders (rider_id);

-- Everything is read and written through the functions below.
alter table public.sponsorships enable row level security;
alter table public.page_sponsorship_levels enable row level security;
alter table public.product_riders enable row level security;
revoke all on public.sponsorships, public.page_sponsorship_levels, public.product_riders from public, anon, authenticated;

-- The push switch for sponsorship invites and moving up (Settings › Push).
alter table private.push_settings add column if not exists sponsorships boolean;

/* Helpers ------------------------------------------------------------------------------ */

-- Rank in enum order: flow 1, am 2, pro 3, ambassador 4. Moving to a higher
-- rank is moving up.
create or replace function private.sponsorship_level_rank(l public.sponsorship_level)
returns integer language sql stable set search_path to '' as $$
  select array_position(enum_range(null::public.sponsorship_level), l);
$$;

create or replace function private.sponsorship_level_on(page uuid, l public.sponsorship_level)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce((select x.enabled from public.page_sponsorship_levels x where x.page_id = page and x.level = l), true);
$$;

create or replace function private.sponsorship_level_name(page uuid, l public.sponsorship_level)
returns text language sql stable security definer set search_path to '' as $$
  select x.name from public.page_sponsorship_levels x where x.page_id = page and x.level = l;
$$;

-- Managers and owners of a managed page with a logo that isn't suspended or
-- frozen, while they're in good standing (can_act_as_page checks the rest).
create or replace function private.can_sponsor_from(page uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_act_as_page(page, 'manager')
     and exists (select 1 from public.pages p where p.id = page and p.logo_path is not null);
$$;

-- Does a pro model's rider text name this member? Every word of the rider
-- text (accents folded, two letters or more) must appear in the username
-- with its punctuation taken out: "Kaito" matches kaito.rolls, "Chris Farmer"
-- matches chris_farmer and farmerchris. The rider still has to confirm it,
-- and only on an invite the brand itself sent.
create or replace function private.pro_name_matches(pro_rider text, username text)
returns boolean language sql stable set search_path to '' as $$
  with u as (select replace(private.slugify(coalesce(username, '')), '-', '') as squashed),
       w as (select word from regexp_split_to_table(private.slugify(coalesce(pro_rider, '')), '-') as word
              where char_length(word) >= 2)
  select exists (select 1 from w)
     and char_length((select squashed from u)) >= 2
     and not exists (select 1 from w, u where position(w.word in u.squashed) = 0);
$$;

-- The page's pro models whose rider text matches this member and that aren't
-- linked to them yet: "Is this your pro model?" on the accept sheet.
create or replace function private.pro_model_candidates(page uuid, rider uuid)
returns table (id uuid, name text, edition text, part_type text, first_year text)
language sql stable security definer set search_path to '' as $$
  select p.id, p.name, p.edition, p.part_type, p.first_year
    from public.products p
    join public.profiles u on u.id = rider
   where p.page_id = page and p.entry_type = 'pro' and p.pro_rider is not null
     and private.pro_name_matches(p.pro_rider, u.username::text)
     and not exists (select 1 from public.product_riders r where r.product_id = p.id and r.rider_id = rider)
   order by p.sort, p.name;
$$;

-- Told to the page's managers and owners (the people who can act on it).
create or replace function private.notify_sponsorship_team(page uuid, what public.notification_kind, actor uuid, msg text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m record;
begin
  for m in select pm.user_id from page_members pm where pm.page_id = page and pm.role in ('manager', 'owner') loop
    perform private.notify_page(m.user_id, what, page, actor, msg);
  end loop;
end $$;

-- Close invites and end sponsorships without telling anyone (blocks, bans,
-- deleted accounts, page changes, merges). Either side may be null for "all".
create or replace function private.close_sponsorships_quietly(page uuid, rider uuid, reason text, end_active boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_variable
begin
  with closed as (
    update sponsorships s
       set status = 'cancelled', answered_at = now(), closed_reason = reason
     where s.status = 'pending'
       and (page is null or s.page_id = page) and (rider is null or s.rider_id = rider)
    returning s.page_id, s.rider_id
  )
  delete from notifications n using closed c
   where n.recipient_id = c.rider_id and n.page_id = c.page_id and n.kind = 'sponsorship_invite';

  if end_active then
    update sponsorships s
       set status = 'ended', ended_at = now(), closed_reason = reason
     where s.status = 'active'
       and (page is null or s.page_id = page) and (rider is null or s.rider_id = rider);
  end if;
end $$;

-- Invites past their 30 days: marked expired and taken out of the bell.
-- Reads already leave them out; this keeps the Page invites box tidy.
create or replace function private.expire_sponsorship_invites()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  with gone as (
    update sponsorships s set status = 'expired'
     where s.status = 'pending' and s.expires_at <= now()
    returning s.page_id, s.rider_id
  ), cleared as (
    delete from notifications x using gone g
     where x.recipient_id = g.rider_id and x.page_id = g.page_id and x.kind = 'sponsorship_invite'
  )
  select count(*) into n from gone;
  return n;
end $$;

/* Sending, cancelling and answering -------------------------------------------------- */

create or replace function public.send_sponsorship(page uuid, rider uuid, level public.sponsorship_level)
returns uuid language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_variable
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if not private.can_sponsor_from(page) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if level is null then
    raise exception using errcode = '22023', message = 'level_off';
  end if;
  if rider is null or not exists (
    select 1 from profiles u where u.id = rider and u.onboarded_at is not null and u.deleted_at is null and u.banned_at is null
  ) then
    raise exception using errcode = '22023', message = 'not_found';
  end if;
  if rider = me then
    raise exception using errcode = '22023', message = 'not_yourself';
  end if;
  if exists (select 1 from user_page_blocks b where b.page_id = page and b.user_id = rider)
     or exists (select 1 from page_blocks b where b.page_id = page and b.user_id = rider and b.lifted_at is null)
     or private.blocked_between(rider) then
    raise exception using errcode = '22023', message = 'blocked';
  end if;
  if not private.sponsorship_level_on(page, level) then
    raise exception using errcode = '22023', message = 'level_off';
  end if;
  if exists (select 1 from sponsorships s where s.page_id = page and s.rider_id = rider and s.status = 'active') then
    raise exception using errcode = '22023', message = 'already_riding';
  end if;

  perform private.expire_sponsorship_invites();
  if exists (select 1 from sponsorships s where s.page_id = page and s.rider_id = rider and s.status = 'pending') then
    raise exception using errcode = '22023', message = 'already_invited';
  end if;
  -- Invites push to people who may not know the page: at most 20 a day per page.
  if (select count(*) from sponsorships s where s.page_id = page and s.created_at > now() - interval '1 day') >= 20 then
    raise exception using errcode = '22023', message = 'too_many';
  end if;

  insert into sponsorships (page_id, rider_id, level, sent_by)
  values (page, rider, level, me)
  returning id into new_id;

  -- One row per page in the rider's Page invites box.
  delete from notifications n where n.recipient_id = rider and n.page_id = page and n.kind = 'sponsorship_invite';
  perform private.notify_page(rider, 'sponsorship_invite', page, null, level::text);
  return new_id;
end $$;

create or replace function public.cancel_sponsorship_invite(invite uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare s sponsorships%rowtype;
begin
  select * into s from sponsorships x where x.id = invite for update;
  if not found or not private.can_act_as_page(s.page_id, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if s.status <> 'pending' then
    raise exception using errcode = '22023', message = 'invite_closed';
  end if;
  update sponsorships set status = 'cancelled', answered_at = now(), closed_reason = 'page', ended_by = auth.uid()
   where id = s.id;
  delete from notifications n where n.recipient_id = s.rider_id and n.page_id = s.page_id and n.kind = 'sponsorship_invite';
end $$;

-- Review → Accept (with any pro models ticked) or Decline. Not now does nothing.
-- A decline tells nobody; an accept tells the team's managers and owners.
create or replace function public.answer_sponsorship(invite uuid, accept boolean, pro_models uuid[] default '{}')
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := auth.uid();
  s sponsorships%rowtype;
begin
  if me is null or not exists (select 1 from profiles u where u.id = me and u.deleted_at is null and u.banned_at is null) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select * into s from sponsorships x where x.id = invite and x.rider_id = me for update;
  if not found then
    raise exception using errcode = '22023', message = 'not_found';
  end if;
  if s.status <> 'pending' or s.expires_at <= now()
     or not exists (select 1 from pages p where p.id = s.page_id and p.state = 'managed'
                     and p.suspended_at is null and p.frozen_at is null and p.logo_path is not null) then
    raise exception using errcode = '22023', message = 'invite_closed';
  end if;

  if accept then
    if not private.is_in_good_standing(me) then
      raise exception using errcode = '42501', message = 'suspended';
    end if;
    if exists (select unnest(coalesce(pro_models, '{}')) except select c.id from private.pro_model_candidates(s.page_id, me) c) then
      raise exception using errcode = '22023', message = 'not_a_match';
    end if;
    update sponsorships set status = 'active', answered_at = now(), accepted_at = now() where id = s.id;
    insert into product_riders (product_id, rider_id, sponsorship_id)
    select distinct m, me, s.id from unnest(coalesce(pro_models, '{}')) m
    on conflict (product_id, rider_id) do nothing;
    perform private.notify_sponsorship_team(s.page_id, 'sponsorship_accepted', me, s.level::text);
    -- The rider's own row ("You now ride for 8SET as SHOP TEAM"): from the
    -- page, so actor_id stays empty, unlike the team's rows.
    perform private.notify_page(me, 'sponsorship_accepted', s.page_id, null, s.level::text);
  else
    update sponsorships set status = 'declined', answered_at = now() where id = s.id;
  end if;

  delete from notifications n where n.recipient_id = me and n.page_id = s.page_id and n.kind = 'sponsorship_invite';
  return (select p.handle::text from pages p where p.id = s.page_id);
end $$;

/* Changing and ending ------------------------------------------------------------------ */

create or replace function public.set_sponsorship_level(sponsorship uuid, level public.sponsorship_level)
returns void language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_variable
declare s sponsorships%rowtype;
begin
  select * into s from sponsorships x where x.id = sponsorship for update;
  if not found or not private.can_act_as_page(s.page_id, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if s.status <> 'active' then
    raise exception using errcode = '22023', message = 'not_active';
  end if;
  if level is null or not private.sponsorship_level_on(s.page_id, level) then
    raise exception using errcode = '22023', message = 'level_off';
  end if;
  if level = s.level then
    return;
  end if;
  update sponsorships x set level = level, level_changed_at = now() where x.id = s.id;
  -- Moving up pushes; moving down is bell only (see enqueue_push_notification).
  perform private.notify_page(s.rider_id, 'sponsorship_level', s.page_id, null,
    case when private.sponsorship_level_rank(level) > private.sponsorship_level_rank(s.level) then 'up:' else 'down:' end || level::text);
end $$;

-- Either side ends it. The rider ending it tells the team's managers and
-- owners; the page ending it tells the rider. Followers are never told.
create or replace function public.end_sponsorship(sponsorship uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := auth.uid();
  s sponsorships%rowtype;
begin
  select * into s from sponsorships x where x.id = sponsorship for update;
  if not found or me is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if s.rider_id = me then
    if s.status <> 'active' then
      raise exception using errcode = '22023', message = 'not_active';
    end if;
    update sponsorships set status = 'ended', ended_at = now(), ended_by = me, closed_reason = 'rider' where id = s.id;
    perform private.notify_sponsorship_team(s.page_id, 'sponsorship_ended', me, 'rider');
  elsif private.can_act_as_page(s.page_id, 'manager') then
    if s.status <> 'active' then
      raise exception using errcode = '22023', message = 'not_active';
    end if;
    update sponsorships set status = 'ended', ended_at = now(), ended_by = me, closed_reason = 'page' where id = s.id;
    perform private.notify_page(s.rider_id, 'sponsorship_ended', s.page_id, null, 'page');
  else
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
end $$;

-- Levels: [{"level": "flow", "enabled": true, "name": "Shop team"}, …]. A
-- level with riders can't be switched off (move them first); invites still
-- waiting at a level that's switched off are cancelled. At least one level
-- stays on. An empty name keeps the usual one.
create or replace function public.set_sponsorship_levels(page uuid, levels jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_variable
declare
  item jsonb;
  l sponsorship_level;
  on_ boolean;
  nm text;
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if levels is null or jsonb_typeof(levels) <> 'array' then
    raise exception using errcode = '22023', message = 'bad_levels';
  end if;
  for item in select * from jsonb_array_elements(levels) loop
    begin
      l := (item ->> 'level')::sponsorship_level;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'bad_levels';
    end;
    on_ := coalesce((item ->> 'enabled')::boolean, true);
    nm := nullif(btrim(coalesce(item ->> 'name', '')), '');
    if char_length(nm) > 16 then
      raise exception using errcode = '22023', message = 'name_too_long';
    end if;
    if not on_ and exists (select 1 from sponsorships s where s.page_id = page and s.level = l and s.status = 'active') then
      raise exception using errcode = '22023', message = 'level_in_use';
    end if;
    insert into page_sponsorship_levels as x (page_id, level, enabled, name)
    values (page, l, on_, nm)
    on conflict (page_id, level) do update set enabled = excluded.enabled, name = excluded.name, updated_at = now();
  end loop;

  if not exists (select 1 from unnest(enum_range(null::sponsorship_level)) e where private.sponsorship_level_on(page, e)) then
    raise exception using errcode = '22023', message = 'no_levels';
  end if;

  with closed as (
    update sponsorships s set status = 'cancelled', answered_at = now(), closed_reason = 'level_off'
     where s.page_id = page and s.status = 'pending' and not private.sponsorship_level_on(page, s.level)
    returning s.rider_id
  )
  delete from notifications n using closed c
   where n.recipient_id = c.rider_id and n.page_id = page and n.kind = 'sponsorship_invite';
end $$;

-- A rider takes a pro model off their profile.
create or replace function public.unlink_pro_model(product uuid)
returns void language sql security definer set search_path to 'public' as $$
  delete from product_riders r where r.product_id = product and r.rider_id = auth.uid();
$$;

/* Reads -------------------------------------------------------------------------------- */

-- The rider's waiting invites, for the bell's Page invites box and the accept
-- sheet (badge preview, who sent it, matching pro models).
create or replace function public.my_sponsorship_invites()
returns table (id uuid, page_id uuid, page_handle text, page_name text, page_roles text[], page_logo_path text,
               level text, level_name text, sent_by_username text, created_at timestamptz, expires_at timestamptz,
               pro_models jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  return query
    select s.id, p.id, p.handle::text, p.display_name, p.roles::text[], p.logo_path,
           s.level::text, private.sponsorship_level_name(p.id, s.level),
           case when u.deleted_at is null and not private.blocked_between(u.id) then u.username::text end,
           s.created_at, s.expires_at,
           coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'edition', c.edition,
                                                          'part_type', c.part_type, 'first_year', c.first_year))
                       from private.pro_model_candidates(p.id, me) c), '[]'::jsonb)
      from sponsorships s
      join pages p on p.id = s.page_id
      left join profiles u on u.id = s.sent_by
     where s.rider_id = me and s.status = 'pending' and s.expires_at > now()
       and p.state = 'managed' and p.suspended_at is null and p.frozen_at is null
     order by s.created_at desc;
end $$;

-- Rides for: a member's sponsors, newest first. Public, even on a private
-- account; left out for anyone the rider blocked (or who blocked them), and
-- pages you blocked or that blocked you. sponsorship_id comes back only for
-- the rider, for Your sponsors › End.
create or replace function public.rider_sponsors(rider uuid)
returns table (sponsorship_id uuid, page_id uuid, page_handle text, page_name text, page_roles text[], page_state text,
               page_logo_path text, level text, level_name text, accepted_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if not exists (select 1 from profiles u where u.id = rider and u.deleted_at is null and u.banned_at is null) then return; end if;
  if rider <> me and private.blocked_between(rider) then return; end if;
  return query
    select case when rider = me then s.id end, p.id, p.handle::text, p.display_name, p.roles::text[], p.state::text,
           case when p.state = 'managed' then p.logo_path end,
           s.level::text, private.sponsorship_level_name(p.id, s.level), s.accepted_at
      from sponsorships s
      join pages p on p.id = s.page_id
     where s.rider_id = rider and s.status = 'active'
       and not exists (select 1 from user_page_blocks b where b.page_id = p.id and b.user_id = me)
       and not exists (select 1 from page_blocks b where b.page_id = p.id and b.user_id = me and b.lifted_at is null)
     order by s.accepted_at desc;
end $$;

-- The page's Team riders tab: everyone sees the riders, highest level first,
-- newest first within a level; no counts.
create or replace function public.page_team_riders(page uuid)
returns table (user_id uuid, username text, avatar_path text, disciplines text[], metro_name text,
               level text, level_name text, accepted_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if exists (select 1 from user_page_blocks b where b.page_id = page and b.user_id = me)
     or exists (select 1 from page_blocks b where b.page_id = page and b.user_id = me and b.lifted_at is null) then
    return;
  end if;
  return query
    select u.id, u.username::text, u.avatar_path, u.disciplines::text[], ma.name::text,
           s.level::text, private.sponsorship_level_name(page, s.level), s.accepted_at
      from sponsorships s
      join profiles u on u.id = s.rider_id
      left join metro_areas ma on ma.id = u.home_metro_area_id
     where s.page_id = page and s.status = 'active'
       and u.deleted_at is null and u.banned_at is null
       and (u.id = me or not private.blocked_between(u.id))
     order by private.sponsorship_level_rank(s.level) desc, s.accepted_at desc;
end $$;

-- The team's view (managers and owners): section 'rider' (with the
-- sponsorship id for ⋯), 'waiting' (invites with days left, for Cancel) and
-- 'former' (team only: the latest ended sponsorship of each rider who isn't
-- riding or invited again).
create or replace function public.page_sponsorships(page uuid)
returns table (section text, sponsorship_id uuid, user_id uuid, username text, avatar_path text, disciplines text[],
               metro_name text, level text, level_name text, sent_at timestamptz, accepted_at timestamptz,
               expires_at timestamptz, ended_at timestamptz, ended_by_rider boolean)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if private.page_role_rank(private.page_role_of(page)) < private.page_role_rank('manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return query
    with live as (
      select s.* from sponsorships s
       where s.page_id = page
         and (s.status = 'active' or (s.status = 'pending' and s.expires_at > now()))
    ), former as (
      select distinct on (s.rider_id) s.* from sponsorships s
       where s.page_id = page and s.status = 'ended'
         and not exists (select 1 from live l where l.rider_id = s.rider_id)
       order by s.rider_id, s.ended_at desc
    ), rows_ as (
      select case when l.status = 'active' then 'rider' else 'waiting' end as section_, l.* from live l
      union all
      select 'former', f.* from former f
    )
    select r.section_, r.id, u.id, u.username::text, u.avatar_path, u.disciplines::text[], ma.name::text,
           r.level::text, private.sponsorship_level_name(page, r.level), r.created_at, r.accepted_at,
           case when r.section_ = 'waiting' then r.expires_at end, r.ended_at,
           case when r.section_ = 'former' then r.closed_reason = 'rider' end
      from rows_ r
      join profiles u on u.id = r.rider_id
      left join metro_areas ma on ma.id = u.home_metro_area_id
     where u.deleted_at is null and u.banned_at is null
     order by case r.section_ when 'rider' then 0 when 'waiting' then 1 else 2 end,
              private.sponsorship_level_rank(r.level) desc,
              coalesce(r.accepted_at, r.created_at) desc, r.ended_at desc nulls last;
end $$;

-- The Levels sheet and the level chips on Sponsor a rider (anyone on the team).
create or replace function public.page_sponsorship_levels(page uuid)
returns table (level text, enabled boolean, name text, riders integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if private.page_role_of(page) is null then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  return query
    select e::text, private.sponsorship_level_on(page, e), private.sponsorship_level_name(page, e),
           (select count(*)::integer from sponsorships s where s.page_id = page and s.level = e and s.status = 'active')
      from unnest(enum_range(null::sponsorship_level)) e
     order by private.sponsorship_level_rank(e);
end $$;

-- Confirmed pro models for a page's products (the product sheet links the
-- rider), or for one member (their profile).
create or replace function public.pro_model_riders(page uuid default null, rider uuid default null)
returns table (product_id uuid, page_id uuid, product_name text, user_id uuid, username text, confirmed_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if auth.uid() is null or (page is null and rider is null) then return; end if;
  return query
    select pr.id, pr.page_id, pr.name, u.id, u.username::text, r.confirmed_at
      from product_riders r
      join products pr on pr.id = r.product_id
      join profiles u on u.id = r.rider_id
     where (page is null or pr.page_id = page) and (rider is null or r.rider_id = rider)
       and u.deleted_at is null and u.banned_at is null
       and (u.id = auth.uid() or not private.blocked_between(u.id))
     order by pr.sort, pr.name;
end $$;

/* Hooks -------------------------------------------------------------------------------- */

-- A block either way ends the sponsorship and closes a waiting invite, quietly.
create or replace function private.close_sponsorships_on_block()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  perform private.close_sponsorships_quietly(new.page_id, new.user_id, 'block');
  return new;
end $$;

create trigger sponsorships_on_user_page_block after insert on public.user_page_blocks
  for each row execute function private.close_sponsorships_on_block();
create trigger sponsorships_on_page_block after insert on public.page_blocks
  for each row when (new.lifted_at is null) execute function private.close_sponsorships_on_block();

-- A ban or a deleted account ends the person's sponsorships, closes their
-- invites (to them, and the ones they sent for a page) and unlinks their pro
-- models. Nobody is told.
create or replace function private.close_sponsorships_on_account()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if not ((new.banned_at is not null and old.banned_at is null)
          or (new.deleted_at is not null and old.deleted_at is null)) then
    return new;
  end if;
  perform private.close_sponsorships_quietly(null, new.id, 'account');
  with closed as (
    update public.sponsorships s set status = 'cancelled', answered_at = now(), closed_reason = 'account'
     where s.sent_by = new.id and s.status = 'pending'
    returning s.page_id, s.rider_id
  )
  delete from public.notifications n using closed c
   where n.recipient_id = c.rider_id and n.page_id = c.page_id and n.kind = 'sponsorship_invite';
  delete from public.product_riders r where r.rider_id = new.id;
  return new;
end $$;

create trigger sponsorships_on_account after update of banned_at, deleted_at on public.profiles
  for each row execute function private.close_sponsorships_on_account();

-- A page that can't send any more (archived, suspended, frozen, back to
-- Unofficial, or its logo gone) keeps its riders; its waiting invites close.
create or replace function private.close_sponsorship_invites_on_page()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  perform private.close_sponsorships_quietly(new.id, null, 'page_changed', false);
  return new;
end $$;

create trigger sponsorships_on_page_change after update of state, suspended_at, frozen_at, logo_path on public.pages
  for each row
  when (new.state <> 'managed' or new.suspended_at is not null or new.frozen_at is not null or new.logo_path is null)
  execute function private.close_sponsorship_invites_on_page();

/* Merges ------------------------------------------------------------------------------- */

-- Called by merge_pages() before the source goes. Waiting invites on the
-- source close; a rider on both pages keeps the target's sponsorship (the
-- source's ends quietly), as does a rider the target blocked or who blocked
-- it; everything else (history included) moves to the target, whose levels
-- in use are switched back on. The source's level names go with it.
create or replace function private.merge_page_sponsorships(source uuid, target uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform private.close_sponsorships_quietly(source, null, 'merged', false);
  update sponsorships s set status = 'ended', ended_at = now(), closed_reason = 'merged'
   where s.page_id = source and s.status = 'active'
     and (exists (select 1 from sponsorships t where t.page_id = target and t.rider_id = s.rider_id and t.status = 'active')
          or exists (select 1 from user_page_blocks b where b.page_id = target and b.user_id = s.rider_id)
          or exists (select 1 from page_blocks b where b.page_id = target and b.user_id = s.rider_id and b.lifted_at is null));
  update sponsorships set page_id = target where page_id = source;
  update page_sponsorship_levels x set enabled = true, updated_at = now()
   where x.page_id = target and not x.enabled
     and exists (select 1 from sponsorships s where s.page_id = target and s.level = x.level and s.status = 'active');
  delete from page_sponsorship_levels where page_id = source;
end $$;

create or replace function private.merge_page_references()
returns text[] language sql immutable set search_path to '' as $$
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
'private.page_comment_makers.page_id',     -- move
'public.event_series.host_page_id',        -- move (page meetups)
'public.event_comments.page_id',           -- move
'private.event_series_makers.page_id',     -- move
'private.event_comment_makers.page_id',    -- move
'public.sponsorships.page_id',             -- move (a rider on both keeps the target's; waiting invites close)
'public.page_sponsorship_levels.page_id'   -- drop (the target's levels stay)
];
$$;

-- merge_pages() gets one line before the source is deleted. Patched from its
-- live definition so the rest of it stays exactly as applied.
do $$
declare
  d text := pg_get_functiondef('public.merge_pages(uuid,uuid,text)'::regprocedure);
  anchor text := 'delete from pages where id = source;';
begin
  if position('merge_page_sponsorships' in d) > 0 then
    return;
  end if;
  if (char_length(d) - char_length(replace(d, anchor, ''))) / char_length(anchor) <> 1 then
    raise exception 'merge_pages: expected one "%"', anchor;
  end if;
  execute replace(d, anchor, 'perform private.merge_page_sponsorships(source, target);' || chr(10) || anchor);
end $$;

/* Notifications and pushes ------------------------------------------------------------- */

-- Pushes: an invite, and moving up. Accepts, endings and moving down are bell only.
create or replace function private.enqueue_push_notification()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (new.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'park_report_accepted', 'caption_mention',
                   'meetup_changed', 'meetup_cancelled', 'meetup_reminder', 'meetup_comment',
                   'page_invite', 'page_claim_approved', 'page_claim_declined', 'page_team_change',
                   'page_claimed', 'suggestion_live', 'page_mention', 'page_comment', 'sponsorship_invite')
      or (new.kind = 'sponsorship_level' and new.message like 'up:%'))
     and exists (select 1 from private.push_devices d where d.user_id = new.recipient_id) then
    insert into private.push_outbox (recipient_id, notification_id) values (new.recipient_id, new.id);
  end if;
  return null;
end $$;

-- push_claim(): three edits to its live definition, each checked to match once.
--  1. Sponsorship rows need their page, like page rows.
--  2. detail: sponsorship rows send their message plus the page's own name for
--     the level after a tab ("up:pro\tShop team"); a closed organizer's
--     cancelled meetups say page_inactive ("… is no longer active").
--  3. The new Sponsorships push switch.
do $$
declare
  d text := pg_get_functiondef('public.push_claim(integer)'::regprocedure);
  edits text[][] := array[
    array['n.kind <> ''suggestion_live'' or pg.id is not null',
          'n.kind <> ''suggestion_live'' and n.kind::text not like ''sponsorship%'' or pg.id is not null'],
    array['then n.message end as edetail',
          'then case when n.kind = ''meetup_cancelled'' and split_part(n.message, '':'', 1) = ''page_closed''
                          and pg.id is not null and not (pg.roles && array[''shop'', ''brand'']::page_role[])
                     then ''page_inactive'' || substr(n.message, char_length(''page_closed'') + 1)
                     else n.message end
                when n.kind::text like ''sponsorship%''
                then n.message || coalesce(chr(9) || (select l.name from page_sponsorship_levels l
                                                       where l.page_id = n.page_id
                                                         and l.level::text = split_part(n.message, '':'', -1)), '''')
           end as edetail'],
    array['when ''page_comment'' then true',
          'when ''page_comment'' then true
                 when ''sponsorship_invite'' then coalesce(s.sponsorships, true)
                 when ''sponsorship_level'' then coalesce(s.sponsorships, true)']
  ];
  i integer;
begin
  if position('sponsorship_invite' in d) > 0 then
    return;
  end if;
  for i in 1 .. array_length(edits, 1) loop
    if (char_length(d) - char_length(replace(d, edits[i][1], ''))) / char_length(edits[i][1]) <> 1 then
      raise exception 'push_claim: expected one "%"', edits[i][1];
    end if;
    d := replace(d, edits[i][1], edits[i][2]);
  end loop;
  execute d;
end $$;

-- The Sponsorships switch joins the push settings (on by default).
drop function if exists public.my_push_settings();
create function public.my_push_settings()
returns table (comments boolean, mentions boolean, tags boolean, filmer_credits boolean, invites boolean, someone_new boolean,
               park_fixes boolean, meetups boolean, teams_claims boolean, pages_joining boolean, sponsorships boolean)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(s.comments, true), coalesce(s.mentions, true), coalesce(s.tags, true), coalesce(s.filmer_credits, true), coalesce(s.invites, true),
         coalesce(s.someone_new, true), coalesce(s.park_fixes, true), coalesce(s.meetups, true), coalesce(s.teams_claims, true),
         coalesce(s.pages_joining, true), coalesce(s.sponsorships, true)
    from (select auth.uid() as me) m left join private.push_settings s on s.user_id = m.me where m.me is not null;
$$;

create or replace function public.set_push_setting(setting text, enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if enabled is null then raise exception 'on or off' using errcode = '22023'; end if;
  insert into private.push_settings (user_id) values (me) on conflict (user_id) do nothing;
  case setting
    when 'comments' then update private.push_settings set comments = enabled, updated_at = now() where user_id = me;
    when 'mentions' then update private.push_settings set mentions = enabled, updated_at = now() where user_id = me;
    when 'tags' then update private.push_settings set tags = enabled, updated_at = now() where user_id = me;
    when 'filmer_credits' then update private.push_settings set filmer_credits = enabled, updated_at = now() where user_id = me;
    when 'invites' then update private.push_settings set invites = enabled, updated_at = now() where user_id = me;
    when 'someone_new' then update private.push_settings set someone_new = enabled, updated_at = now() where user_id = me;
    when 'park_fixes' then update private.push_settings set park_fixes = enabled, updated_at = now() where user_id = me;
    when 'meetups' then update private.push_settings set meetups = enabled, updated_at = now() where user_id = me;
    when 'teams_claims' then update private.push_settings set teams_claims = enabled, updated_at = now() where user_id = me;
    when 'pages_joining' then update private.push_settings set pages_joining = enabled, updated_at = now() where user_id = me;
    when 'sponsorships' then update private.push_settings set sponsorships = enabled, updated_at = now() where user_id = me;
    else raise exception 'unknown setting %', setting using errcode = '22023';
  end case;
end $$;

/* Expiry ------------------------------------------------------------------------------- */

select cron.schedule('sponsorship-invites-expire', '23 4 * * *', 'select private.expire_sponsorship_invites()');

/* Grants ------------------------------------------------------------------------------- */

revoke all on function private.sponsorship_level_rank(public.sponsorship_level) from public, anon, authenticated;
revoke all on function private.sponsorship_level_on(uuid, public.sponsorship_level) from public, anon, authenticated;
revoke all on function private.sponsorship_level_name(uuid, public.sponsorship_level) from public, anon, authenticated;
revoke all on function private.can_sponsor_from(uuid) from public, anon, authenticated;
revoke all on function private.pro_name_matches(text, text) from public, anon, authenticated;
revoke all on function private.pro_model_candidates(uuid, uuid) from public, anon, authenticated;
revoke all on function private.notify_sponsorship_team(uuid, public.notification_kind, uuid, text) from public, anon, authenticated;
revoke all on function private.close_sponsorships_quietly(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function private.expire_sponsorship_invites() from public, anon, authenticated;
revoke all on function private.close_sponsorships_on_block() from public, anon, authenticated;
revoke all on function private.close_sponsorships_on_account() from public, anon, authenticated;
revoke all on function private.close_sponsorship_invites_on_page() from public, anon, authenticated;
revoke all on function private.merge_page_sponsorships(uuid, uuid) from public, anon, authenticated;
-- Called inside the security-definer reads above as the signed-in member.
grant execute on function private.sponsorship_level_rank(public.sponsorship_level) to authenticated;
grant execute on function private.sponsorship_level_on(uuid, public.sponsorship_level) to authenticated;
grant execute on function private.sponsorship_level_name(uuid, public.sponsorship_level) to authenticated;

revoke all on function public.send_sponsorship(uuid, uuid, public.sponsorship_level) from public, anon;
revoke all on function public.cancel_sponsorship_invite(uuid) from public, anon;
revoke all on function public.answer_sponsorship(uuid, boolean, uuid[]) from public, anon;
revoke all on function public.set_sponsorship_level(uuid, public.sponsorship_level) from public, anon;
revoke all on function public.end_sponsorship(uuid) from public, anon;
revoke all on function public.set_sponsorship_levels(uuid, jsonb) from public, anon;
revoke all on function public.unlink_pro_model(uuid) from public, anon;
revoke all on function public.my_sponsorship_invites() from public, anon;
revoke all on function public.rider_sponsors(uuid) from public, anon;
revoke all on function public.page_team_riders(uuid) from public, anon;
revoke all on function public.page_sponsorships(uuid) from public, anon;
revoke all on function public.page_sponsorship_levels(uuid) from public, anon;
revoke all on function public.pro_model_riders(uuid, uuid) from public, anon;
revoke all on function public.my_push_settings() from public, anon;
grant execute on function public.send_sponsorship(uuid, uuid, public.sponsorship_level) to authenticated;
grant execute on function public.cancel_sponsorship_invite(uuid) to authenticated;
grant execute on function public.answer_sponsorship(uuid, boolean, uuid[]) to authenticated;
grant execute on function public.set_sponsorship_level(uuid, public.sponsorship_level) to authenticated;
grant execute on function public.end_sponsorship(uuid) to authenticated;
grant execute on function public.set_sponsorship_levels(uuid, jsonb) to authenticated;
grant execute on function public.unlink_pro_model(uuid) to authenticated;
grant execute on function public.my_sponsorship_invites() to authenticated;
grant execute on function public.rider_sponsors(uuid) to authenticated;
grant execute on function public.page_team_riders(uuid) to authenticated;
grant execute on function public.page_sponsorships(uuid) to authenticated;
grant execute on function public.page_sponsorship_levels(uuid) to authenticated;
grant execute on function public.pro_model_riders(uuid, uuid) to authenticated;
grant execute on function public.my_push_settings() to authenticated;
