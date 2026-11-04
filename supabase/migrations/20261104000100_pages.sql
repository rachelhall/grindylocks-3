-- Brand and shop accounts, part A, PR 1: the pages data model and access rules.
-- PRD: Grindylocks — Brand and Shop Accounts PRD. Mockups: the Brand
-- accounts (v2) page on the Mockups canvas.
--
--   pages                   one per organization: handle, display name, roles
--                           (brand, shop), state, place, website, logo and
--                           header, shop location and closures, and the
--                           managed, founding partner, suspended and frozen
--                           (disputed claim) markers.
--   page_aliases            "Formerly …" names Search finds, and old handles
--                           that redirect for a while after a rename.
--   page_descriptions       the description per language (the factual line
--                           for unofficial pages; the team's own text later).
--   page_links              up to 3 links (Instagram allowed, unlike profiles).
--   page_hours              a storefront's opening hours, the park hours shape
--                           (park_sessions) without disciplines.
--   page_brands_carried     a shop's "Brands we carry".
--   page_members            the team: owner, managers and staff.
--   page_invites            team invites and ownership hand-overs (the
--                           functions that send and answer them come with the
--                           invites and team PRs).
--   page_follows            following a page. Nobody can read who follows a
--                           page; the team gets a number only.
--   page_mutes              muting a page (hides it from your Home feed).
--   user_page_blocks        a skater blocking a page.
--   page_blocks             a page blocking a skater (managers and owners).
--                           Rachel sees every one; lifted blocks are kept.
--
-- Handles share one namespace with usernames: a page's handle (or an old
-- handle still redirecting) can't be taken as a username, a username can't be
-- given to a page, and usernames can't contain "official".
--
-- Who can see what:
--   * Pages and their public details (aliases, descriptions, links, hours,
--     brands carried) are visible to every signed-in member.
--   * A team sees its own members and invites; an invitee sees their invite;
--     Rachel (owner role) sees all.
--   * Follows, mutes and your blocks of pages are visible only to you.
--     page_follower_count() gives the number to the team and Rachel only.
--   * Page blocks are visible to the page's managers and owner, and to Rachel.
--
-- Writes: members follow, mute and block pages through policies (suspended
-- members can still mute and block, not follow). Everything
-- else (making pages, claims, teams, editing a page) goes through functions
-- in later PRs, or is done by Rachel in Supabase for now.
--
-- Also: when someone is banned or deletes their account, their page roles
-- end; a managed page left with nobody goes back to Unofficial (logo off).
--
-- Additive: new tables, functions, policies and triggers; username_available()
-- is replaced to also check page handles. Nothing existing is dropped.

/* Tables ---------------------------------------------------------------------- */

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  handle extensions.citext not null unique
    check (handle::text ~ '^[a-zA-Z0-9_.]{2,30}$'),
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  roles public.page_role[] not null check (cardinality(roles) >= 1),
  state public.page_state not null default 'unofficial',
  -- Where it's from: the tape reads BRAND · SANTA ANA, or the country when no
  -- city is known.
  city text check (city is null or char_length(city) between 1 and 80),
  region text check (region is null or char_length(region) between 1 and 80),
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  -- Shops: the metro area decides Near you and which city admin gets reports.
  metro_area_id uuid references public.metro_areas (id),
  -- The shop's own clock for hours and "open now" when it has no metro area.
  timezone text,
  -- The language the team writes in; the app shows the viewer's language if
  -- the page has it, else this one.
  main_language text not null default 'en' check (main_language ~ '^[a-z]{2}$'),
  website text check (website is null or char_length(website) between 4 and 200),
  logo_path text,
  header_path text,
  -- Archive years on the tape: 1993–C. 2005. Text, since years are often "c.".
  founded_label text check (founded_label is null or char_length(founded_label) between 1 and 20),
  ended_label text check (ended_label is null or char_length(ended_label) between 1 and 20),
  -- Shops.
  location_type public.shop_location_type,
  address text check (address is null or char_length(address) between 1 and 200),
  location extensions.geography(point, 4326),
  latitude double precision generated always as (extensions.st_y(location::extensions.geometry)) stored,
  longitude double precision generated always as (extensions.st_x(location::extensions.geometry)) stored,
  -- By-appointment shops choose whether their pin shows; storefronts always do.
  show_pin boolean not null default true,
  -- Temporarily closed: "Closed until [date]", or "Closed for now" with no date.
  temp_closed_at timestamptz,
  temp_closed_until date,
  temp_closed_note text check (temp_closed_note is null or char_length(temp_closed_note) between 1 and 200),
  -- Markers.
  managed_at timestamptz,
  founding_partner_at timestamptz,
  closed_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text,
  frozen_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pages_shop_fields check (
    'shop' = any (roles)
    or (location_type is null and address is null and location is null and temp_closed_at is null)
  ),
  constraint pages_closed_is_a_shop check (state <> 'closed' or 'shop' = any (roles)),
  constraint pages_out_of_business_is_a_brand check (state <> 'out_of_business' or 'brand' = any (roles))
);

comment on table public.pages is
  'Brand and shop pages (one per organization, with roles). See the Brand and Shop Accounts PRD.';

create index if not exists pages_roles_idx on public.pages using gin (roles);
create index if not exists pages_metro_idx on public.pages (metro_area_id);
create index if not exists pages_location_idx on public.pages using gist (location);
create index if not exists pages_name_trgm_idx on public.pages
  using gin (lower(display_name) extensions.gin_trgm_ops);

create table if not exists public.page_aliases (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  -- A former display name, shown as "Formerly …" and matched by Search.
  name text not null check (char_length(trim(name)) between 1 and 60),
  -- Set when this alias is an old handle: it redirects to the page until
  -- redirect_until, and nobody can take it as a username or handle meanwhile.
  handle extensions.citext,
  redirect_until timestamptz,
  created_at timestamptz not null default now(),
  check ((handle is null) = (redirect_until is null))
);

create index if not exists page_aliases_page_idx on public.page_aliases (page_id);
create index if not exists page_aliases_handle_idx on public.page_aliases (handle) where handle is not null;

create table if not exists public.page_descriptions (
  page_id uuid not null references public.pages (id) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}$'),
  body text not null check (char_length(trim(body)) between 1 and 300),
  -- author: written by a person (us for unofficial pages, the team later).
  source public.text_source not null default 'author',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (page_id, locale)
);

create table if not exists public.page_links (
  page_id uuid not null references public.pages (id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  url text not null check (char_length(url) between 4 and 300),
  primary key (page_id, position)
);

create table if not exists public.page_hours (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  season_start_month smallint check (season_start_month between 1 and 12),
  season_start_day smallint check (season_start_day between 1 and 31),
  season_end_month smallint check (season_end_month between 1 and 12),
  season_end_day smallint check (season_end_day between 1 and 31),
  -- ISO weekdays, 1 = Monday.
  days smallint[] not null check (cardinality(days) >= 1 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  start_anchor public.time_anchor not null default 'clock',
  start_time time,
  end_anchor public.time_anchor not null default 'clock',
  end_time time,
  note text check (note is null or char_length(note) between 1 and 140)
);

create index if not exists page_hours_page_idx on public.page_hours (page_id);

create table if not exists public.page_brands_carried (
  shop_id uuid not null references public.pages (id) on delete cascade,
  brand_id uuid not null references public.pages (id) on delete cascade,
  position smallint not null default 0,
  primary key (shop_id, brand_id),
  check (shop_id <> brand_id)
);

create index if not exists page_brands_carried_brand_idx on public.page_brands_carried (brand_id);

create table if not exists public.page_members (
  page_id uuid not null references public.pages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.page_member_role not null,
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (page_id, user_id)
);

create unique index if not exists page_members_one_owner on public.page_members (page_id) where role = 'owner';
create index if not exists page_members_user_idx on public.page_members (user_id);

create table if not exists public.page_invites (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  kind public.page_invite_kind not null,
  -- The role a team invite offers. Ownership hand-overs leave it null.
  role public.page_member_role check (role is null or role <> 'owner'),
  -- A member (by username) or an email (doubles as a sign-up invite).
  invitee_id uuid references public.profiles (id) on delete cascade,
  email extensions.citext,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  check ((invitee_id is null) <> (email is null)),
  check ((kind = 'team') = (role is not null)),
  check (kind = 'team' or invitee_id is not null)
);

create index if not exists page_invites_page_idx on public.page_invites (page_id);
create index if not exists page_invites_invitee_idx on public.page_invites (invitee_id) where invitee_id is not null;
create index if not exists page_invites_email_idx on public.page_invites (email) where email is not null;

create table if not exists public.page_follows (
  user_id uuid not null references public.profiles (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

create index if not exists page_follows_page_idx on public.page_follows (page_id);

create table if not exists public.page_mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

create table if not exists public.user_page_blocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

create index if not exists user_page_blocks_page_idx on public.user_page_blocks (page_id);

create table if not exists public.page_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The team member who blocked, for Rachel's Page blocks page.
  blocked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references public.profiles (id) on delete set null
);

create unique index if not exists page_blocks_one_active on public.page_blocks (page_id, user_id) where lifted_at is null;
create index if not exists page_blocks_created_idx on public.page_blocks (created_at desc);

/* Helpers --------------------------------------------------------------------- */

-- Someone's role on a page's team, or null.
create or replace function private.page_role_of(page uuid, who uuid default auth.uid())
returns public.page_member_role
language sql stable security definer
set search_path = ''
as $$
  select m.role from public.page_members m where m.page_id = page and m.user_id = who;
$$;

create or replace function private.page_role_rank(r public.page_member_role)
returns smallint
language sql immutable
set search_path = ''
as $$
  select case r when 'owner' then 3 when 'manager' then 2 when 'staff' then 1 else 0 end::smallint;
$$;

-- Whether the caller can act for a page at least at this role: an active
-- member (not suspended or banned), on a managed page that isn't suspended
-- or frozen by a dispute. The posting, team and editing functions in later
-- PRs check this.
create or replace function private.can_act_as_page(page uuid, at_least public.page_member_role default 'staff')
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_active_member()
    and exists (
      select 1 from public.page_members m join public.pages p on p.id = m.page_id
      where m.page_id = page and m.user_id = (select auth.uid())
        and private.page_role_rank(m.role) >= private.page_role_rank(at_least)
        and p.state = 'managed' and p.suspended_at is null and p.frozen_at is null
    );
$$;

-- A handle or username is taken by a page: a page's handle, or an old handle
-- still redirecting.
create or replace function private.handle_used_by_page(name text, except_page uuid default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.pages p
      where p.handle = trim(name)::extensions.citext and p.id is distinct from except_page
    )
    or exists (
      select 1 from public.page_aliases a
      where a.handle = trim(name)::extensions.citext and a.redirect_until > now()
        and a.page_id is distinct from except_page
    );
$$;

-- Whether the caller may follow a page: an active member, a page that has
-- someone to hear from (or will: Unofficial pages are "tell me when they're
-- here"), and no block either way.
create or replace function private.can_follow_page(page uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_active_member()
    and exists (select 1 from public.pages p where p.id = page and p.state in ('unofficial', 'managed'))
    and not exists (select 1 from public.user_page_blocks b where b.page_id = page and b.user_id = (select auth.uid()))
    and not exists (
      select 1 from public.page_blocks b
      where b.page_id = page and b.user_id = (select auth.uid()) and b.lifted_at is null
    );
$$;

revoke all on function private.page_role_of(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_act_as_page(uuid, public.page_member_role) from public, anon, authenticated;
revoke all on function private.handle_used_by_page(text, uuid) from public, anon, authenticated;
revoke all on function private.can_follow_page(uuid) from public, anon, authenticated;
grant execute on function private.page_role_of(uuid, uuid) to authenticated;
grant execute on function private.page_role_rank(public.page_member_role) to authenticated;
grant execute on function private.can_act_as_page(uuid, public.page_member_role) to authenticated;
grant execute on function private.can_follow_page(uuid) to authenticated;

/* One namespace for handles and usernames ------------------------------------- */

-- Pages: the handle can't be someone's username, a username held for its
-- owner after a change, or another page's handle (or redirecting old handle).
-- Changing a handle keeps the old one as a redirect for 90 days; changing the
-- display name keeps the old one as a "Formerly" alias.
create or replace function private.guard_page_handle()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.handle::text is not distinct from old.handle::text
     and new.display_name is not distinct from old.display_name then
    return new;
  end if;

  if tg_op = 'INSERT' or new.handle is distinct from old.handle then
    if exists (select 1 from public.profiles p where p.username = new.handle) then
      raise exception using errcode = '23505', message = 'handle_taken',
        detail = 'A member already has this as their username.';
    end if;
    if exists (
      select 1 from public.reserved_usernames r
      where r.username = new.handle and r.reserved_until > now()
    ) then
      raise exception using errcode = '23505', message = 'handle_taken',
        detail = 'This username is held for a member who changed away from it.';
    end if;
    if exists (
      select 1 from public.page_aliases a
      where a.handle = new.handle and a.redirect_until > now() and a.page_id <> new.id
    ) then
      raise exception using errcode = '23505', message = 'handle_taken',
        detail = 'Another page''s old handle still redirects here.';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if lower(new.handle::text) <> lower(old.handle::text) then
      insert into public.page_aliases (page_id, name, handle, redirect_until)
      values (old.id, old.display_name, old.handle, now() + interval '90 days');
    elsif new.display_name is distinct from old.display_name then
      insert into public.page_aliases (page_id, name) values (old.id, old.display_name);
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists pages_guard_handle on public.pages;
create trigger pages_guard_handle
  before insert or update of handle, display_name on public.pages
  for each row execute function private.guard_page_handle();

revoke all on function private.guard_page_handle() from public, anon, authenticated;

-- Profiles: a username can't be a page handle (or a redirecting old one), and
-- can't contain "official". Runs beside guard_username(), which keeps
-- handling the 30-day and 14-day username rules.
create or replace function private.guard_username_against_pages()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.username is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and lower(new.username::text) = lower(coalesce(old.username::text, '')) then
    return new;
  end if;
  if private.handle_used_by_page(new.username::text) then
    raise exception using errcode = '23505', message = 'username_reserved',
      detail = 'That name belongs to a brand or shop page.';
  end if;
  if position('official' in lower(new.username::text)) > 0 then
    raise exception using errcode = '23514', message = 'username_not_allowed',
      detail = 'Usernames can''t contain "official".';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_username_pages on public.profiles;
create trigger profiles_guard_username_pages
  before insert or update of username on public.profiles
  for each row execute function private.guard_username_against_pages();

revoke all on function private.guard_username_against_pages() from public, anon, authenticated;

-- The live free / taken check, now also refusing page handles and "official".
create or replace function public.username_available(name text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(trim(name), '') ~ '^[a-zA-Z0-9_.]{2,30}$'
    and position('official' in lower(coalesce(trim(name), ''))) = 0
    and not exists (
      select 1 from public.profiles p
      where p.username = trim(name)::extensions.citext
        and p.id is distinct from (select auth.uid())
    )
    and not exists (
      select 1 from public.reserved_usernames r
      where r.username = trim(name)::extensions.citext
        and r.reserved_until > now()
        and r.user_id is distinct from (select auth.uid())
    )
    and not private.handle_used_by_page(name);
$$;

comment on function public.username_available(text) is
  'True when the name fits the username rules, has no "official" in it, and no member or page has or holds it (case-insensitive).';

revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

/* Shops carry brands ------------------------------------------------------------ */

create or replace function private.check_brand_carried()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pages where id = new.shop_id and 'shop' = any (roles)) then
    raise exception using errcode = '23514', message = 'not_a_shop';
  end if;
  if not exists (select 1 from public.pages where id = new.brand_id and 'brand' = any (roles)) then
    raise exception using errcode = '23514', message = 'not_a_brand';
  end if;
  return new;
end $$;

drop trigger if exists page_brands_carried_check on public.page_brands_carried;
create trigger page_brands_carried_check
  before insert or update on public.page_brands_carried
  for each row execute function private.check_brand_carried();

revoke all on function private.check_brand_carried() from public, anon, authenticated;

/* Blocks end follows -------------------------------------------------------------- */

create or replace function private.unfollow_page_on_block()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'page_blocks' and new.lifted_at is not null then
    return new;
  end if;
  delete from public.page_follows where user_id = new.user_id and page_id = new.page_id;
  return new;
end $$;

drop trigger if exists user_page_blocks_unfollow on public.user_page_blocks;
create trigger user_page_blocks_unfollow
  after insert on public.user_page_blocks
  for each row execute function private.unfollow_page_on_block();

drop trigger if exists page_blocks_unfollow on public.page_blocks;
create trigger page_blocks_unfollow
  after insert on public.page_blocks
  for each row execute function private.unfollow_page_on_block();

revoke all on function private.unfollow_page_on_block() from public, anon, authenticated;

/* Bans and deleted accounts end page roles -------------------------------------- */

-- Like role_assignments, page roles end when someone is banned or deletes
-- their account. A managed page with nobody left goes back to Unofficial:
-- the logo goes (so the OFFICIAL stamp does), posts stay, followers stay, and
-- it can be claimed again. A page that still has members but lost its owner
-- waits for Rachel to pick the new one (her page tools, a later PR).
create or replace function private.end_page_roles()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  left_pages uuid[];
begin
  if not ((new.banned_at is not null and old.banned_at is null)
          or (new.deleted_at is not null and old.deleted_at is null)) then
    return new;
  end if;

  with gone as (
    delete from public.page_members where user_id = new.id returning page_id
  )
  select coalesce(array_agg(page_id), '{}') into left_pages from gone;

  update public.pages p
     set state = 'unofficial', logo_path = null, updated_at = now()
   where p.id = any (left_pages)
     and p.state = 'managed'
     and not exists (select 1 from public.page_members m where m.page_id = p.id);

  update public.page_invites
     set cancelled_at = now()
   where (invited_by = new.id or invitee_id = new.id)
     and accepted_at is null and declined_at is null and cancelled_at is null;

  return new;
end $$;

drop trigger if exists profiles_end_page_roles on public.profiles;
create trigger profiles_end_page_roles
  after update of banned_at, deleted_at on public.profiles
  for each row execute function private.end_page_roles();

revoke all on function private.end_page_roles() from public, anon, authenticated;

/* The follower number ------------------------------------------------------------- */

-- Only the page's team and Rachel get the number. Nobody gets the list.
create or replace function public.page_follower_count(page uuid)
returns integer
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if private.page_role_of(page) is null and not private.is_owner() then
    raise exception using errcode = '42501', message = 'not_on_the_team';
  end if;
  return (select count(*)::integer from public.page_follows f where f.page_id = page);
end $$;

revoke all on function public.page_follower_count(uuid) from public, anon;
grant execute on function public.page_follower_count(uuid) to authenticated;

/* Access rules -------------------------------------------------------------------- */

alter table public.pages enable row level security;
alter table public.page_aliases enable row level security;
alter table public.page_descriptions enable row level security;
alter table public.page_links enable row level security;
alter table public.page_hours enable row level security;
alter table public.page_brands_carried enable row level security;
alter table public.page_members enable row level security;
alter table public.page_invites enable row level security;
alter table public.page_follows enable row level security;
alter table public.page_mutes enable row level security;
alter table public.user_page_blocks enable row level security;
alter table public.page_blocks enable row level security;

revoke all on public.pages, public.page_aliases, public.page_descriptions, public.page_links,
  public.page_hours, public.page_brands_carried, public.page_members, public.page_invites,
  public.page_follows, public.page_mutes, public.user_page_blocks, public.page_blocks
  from anon, authenticated;

-- Pages: every column but who created it and why it's suspended (those reach
-- the team and Rachel through functions later).
grant select (id, handle, display_name, roles, state, city, region, country, metro_area_id, timezone,
  main_language, website, logo_path, header_path, founded_label, ended_label, location_type, address,
  location, latitude, longitude, show_pin, temp_closed_at, temp_closed_until, temp_closed_note,
  managed_at, founding_partner_at, closed_at, suspended_at, frozen_at, created_at, updated_at)
  on public.pages to authenticated;

create policy "pages: members read" on public.pages
  for select to authenticated using (true);

grant select on public.page_aliases, public.page_descriptions, public.page_links,
  public.page_hours, public.page_brands_carried to authenticated;

create policy "page aliases: members read" on public.page_aliases
  for select to authenticated using (true);
create policy "page descriptions: members read" on public.page_descriptions
  for select to authenticated using (true);
create policy "page links: members read" on public.page_links
  for select to authenticated using (true);
create policy "page hours: members read" on public.page_hours
  for select to authenticated using (true);
create policy "brands carried: members read" on public.page_brands_carried
  for select to authenticated using (true);

grant select on public.page_members, public.page_invites, public.page_blocks to authenticated;

create policy "page members: the team, yourself and Rachel" on public.page_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.page_role_of(page_id) is not null
    or private.is_owner()
  );

create policy "page invites: invitee, managers and Rachel" on public.page_invites
  for select to authenticated
  using (
    invitee_id = (select auth.uid())
    or private.page_role_of(page_id) in ('owner', 'manager')
    or private.is_owner()
  );

create policy "page blocks: managers and Rachel" on public.page_blocks
  for select to authenticated
  using (
    private.page_role_of(page_id) in ('owner', 'manager')
    or private.is_owner()
  );

grant select, insert, delete on public.page_follows, public.page_mutes, public.user_page_blocks to authenticated;

create policy "page follows: see your own" on public.page_follows
  for select to authenticated using (user_id = (select auth.uid()));
create policy "page follows: follow" on public.page_follows
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_follow_page(page_id));
create policy "page follows: unfollow" on public.page_follows
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "page mutes: see your own" on public.page_mutes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "page mutes: mute" on public.page_mutes
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "page mutes: unmute" on public.page_mutes
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "page blocks by you: see your own" on public.user_page_blocks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "page blocks by you: block" on public.user_page_blocks
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "page blocks by you: unblock" on public.user_page_blocks
  for delete to authenticated using (user_id = (select auth.uid()));
