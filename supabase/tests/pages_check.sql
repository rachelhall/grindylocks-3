-- Rolled-back check for the pages migrations (enums, pages, seed).
-- Runs them and the checks in one transaction, then raises an exception
-- carrying the results (RESULTS [...]), so nothing is kept. Every row should have ok = true.
begin;
-- Brand and shop accounts, part A, PR 1: the new enum types.
-- Kept in their own migration and applied first, because Postgres can't use
-- a new enum value in the transaction that adds it.

do $$ begin
  -- What a page is. One page per organization; a page can hold several
  -- roles (8SET is a shop that also has its own gear). Builder and school
  -- come later as new values.
  create type public.page_role as enum ('brand', 'shop');
exception when duplicate_object then null; end $$;

do $$ begin
  -- unofficial: seeded, nobody manages it. name_only: the brand opted out;
  -- kept so gear links don't break. managed: claimed and verified (it shows
  -- OFFICIAL once it has a logo). out_of_business: a brand's archive (the
  -- app says Retired). closed: a shop's archive.
  create type public.page_state as enum ('unofficial', 'name_only', 'managed', 'out_of_business', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.page_member_role as enum ('staff', 'manager', 'owner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.shop_location_type as enum ('storefront', 'by_appointment', 'online_only');
exception when duplicate_object then null; end $$;

do $$ begin
  -- team: join the team at a role. ownership: take over as owner.
  create type public.page_invite_kind as enum ('team', 'ownership');
exception when duplicate_object then null; end $$;
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
-- (citext comparisons name extensions.= explicitly: with an empty
-- search_path a bare = falls back to case-sensitive text.)
create or replace function private.handle_used_by_page(candidate text, except_page uuid default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.pages p
      where p.handle operator(extensions.=) trim(candidate)::extensions.citext
        and p.id is distinct from except_page
    )
    or exists (
      select 1 from public.page_aliases a
      where a.handle operator(extensions.=) trim(candidate)::extensions.citext
        and a.redirect_until > now()
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
    if exists (select 1 from public.profiles p where p.username operator(extensions.=) new.handle) then
      raise exception using errcode = '23505', message = 'handle_taken',
        detail = 'A member already has this as their username.';
    end if;
    if exists (
      select 1 from public.reserved_usernames r
      where r.username operator(extensions.=) new.handle and r.reserved_until > now()
    ) then
      raise exception using errcode = '23505', message = 'handle_taken',
        detail = 'This username is held for a member who changed away from it.';
    end if;
    if exists (
      select 1 from public.page_aliases a
      where a.handle operator(extensions.=) new.handle and a.redirect_until > now() and a.page_id <> new.id
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
      where p.username operator(extensions.=) trim(name)::extensions.citext
        and p.id is distinct from (select auth.uid())
    )
    and not exists (
      select 1 from public.reserved_usernames r
      where r.username operator(extensions.=) trim(name)::extensions.citext
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
  -- Both tables have user_id and page_id; page_blocks fires on insert only,
  -- when the block is new.
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
-- Brand and shop accounts, part A, PR 1: the seeded pages.
-- Generated by supabase/seed/pages/build_pages_seed.py from pages.csv and
-- descriptions.csv; edit those and regenerate rather than editing this file.
-- 68 pages, every one Unofficial or an archive, with a reserved handle
-- and a factual line in English, Spanish, Danish and German.
-- Insert-only: existing handles and descriptions are left alone.

insert into public.pages (handle, display_name, roles, state, city, region, country, metro_area_id,
  timezone, website, founded_label, ended_label, location_type, address, show_pin, closed_at)
select v.handle, v.display_name, v.roles::public.page_role[], v.state::public.page_state, v.city, v.region,
  v.country, m.id, v.timezone, v.website, v.founded_label, v.ended_label,
  v.location_type::public.shop_location_type, v.address, v.show_pin,
  case when v.state in ('out_of_business', 'closed') then now() end
from (values
  ('powerslide', 'Powerslide', '{brand}', 'unofficial', null, null, 'DE', null, null, 'powerslide.com', null, null, null, null, true),
  ('kizerframes', 'Kizer', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('usdskates', 'USD', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('wickedbearings', 'Wicked', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('undercoverwheels', 'UnderCover', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('mesmerskates', 'Mesmer', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('gawds', 'GAWDS', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('ennuiprotection', 'Ennui', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('chayaskates', 'Chaya', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('iqonskates', 'Iqon', '{brand}', 'unofficial', null, null, 'DE', null, null, null, null, null, null, null, true),
  ('rollerblade', 'Rollerblade', '{brand}', 'unofficial', null, null, 'IT', null, null, 'rollerblade.com', null, null, null, null, true),
  ('blankskates', 'Blank', '{brand}', 'unofficial', null, null, 'US', null, null, null, null, null, null, null, true),
  ('themskates', 'Them', '{brand}', 'unofficial', 'Santa Ana', 'California', 'US', null, null, null, null, null, null, null, true),
  ('razorsskates', 'Razors', '{brand}', 'unofficial', null, null, 'US', null, null, null, null, null, null, null, true),
  ('groundcontrolframes', 'Ground Control', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('k2skates', 'K2', '{brand}', 'unofficial', null, null, 'US', null, null, null, null, null, null, null, true),
  ('roces', 'Roces', '{brand}', 'unofficial', 'Montebelluna', null, 'IT', null, null, 'roces.com', null, null, null, null, true),
  ('sebaskates', 'Seba', '{brand}', 'unofficial', null, null, 'FR', null, null, 'sebaskates.com', null, null, null, null, true),
  ('frskates', 'FR Skates', '{brand}', 'unofficial', null, null, 'FR', null, null, null, null, null, null, null, true),
  ('factionskates', 'Faction', '{brand}', 'unofficial', null, null, 'US', null, null, null, null, null, null, null, true),
  ('flyingeagleskates', 'Flying Eagle', '{brand}', 'unofficial', null, null, 'CN', null, null, null, null, null, null, null, true),
  ('deadwheels', 'Dead', '{brand}', 'unofficial', 'Huntington Beach', 'California', 'US', null, null, null, null, null, null, null, true),
  ('rekdprotection', 'REKD', '{brand}', 'unofficial', null, null, 'GB', null, null, null, null, null, null, null, true),
  ('endlessblading', 'Endless Blading', '{brand}', 'unofficial', null, null, null, null, null, 'endlessblading.com', null, null, null, null, true),
  ('intuitionliners', 'Intuition', '{brand}', 'unofficial', null, null, 'CA', null, null, null, null, null, null, null, true),
  ('kaltik', 'Kaltik', '{brand}', 'unofficial', null, null, 'IE', null, null, 'kaltik.eu', null, null, null, null, true),
  ('mushroomblading', 'Mushroom Blading', '{brand}', 'unofficial', null, null, null, null, null, 'mushroomblading.com', null, null, null, null, true),
  ('wizardskating', 'Wizard', '{brand}', 'unofficial', null, null, 'CA', null, null, 'wizardskating.com', null, null, null, null, true),
  ('oysius', 'Oysi', '{brand}', 'unofficial', null, null, 'US', null, null, 'oysius.com', null, null, null, null, true),
  ('reignliners', 'Reign', '{brand}', 'unofficial', null, 'California', 'US', null, null, null, null, null, null, null, true),
  ('tnecskates', 'TNEC', '{brand}', 'unofficial', null, null, 'US', null, null, null, null, null, null, null, true),
  ('5050frames', '50/50', '{brand}', 'unofficial', null, 'California', 'US', null, null, null, null, null, null, null, true),
  ('chromawheels', 'Chroma', '{brand}', 'unofficial', null, null, 'US', null, null, 'chromawheels.com', null, null, null, null, true),
  ('sicurethane', 'Sic Urethane', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('bacemint', 'Bacemint', '{brand}', 'unofficial', 'Philadelphia', 'Pennsylvania', 'US', null, null, 'bacemint.com', null, null, null, null, true),
  ('senateblading', 'Senate', '{brand}', 'out_of_business', null, null, 'US', null, null, null, '1993', 'c. 2005', null, null, true),
  ('valoskates', 'Valo', '{brand}', 'out_of_business', null, null, null, null, null, null, '2004', '2018', null, null, true),
  ('remzskates', 'Remz', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('triple8', 'Triple 8', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('187killerpads', '187 Killer Pads', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('bonesbearings', 'Bones', '{brand}', 'unofficial', 'Santa Barbara', 'California', 'US', null, null, 'bonesbearings.com', null, null, null, null, true),
  ('rollerbones', 'RollerBones', '{brand}', 'unofficial', 'Santa Barbara', 'California', 'US', null, null, 'rollerbones.com', null, null, null, null, true),
  ('riedellskates', 'Riedell', '{brand}', 'unofficial', 'Red Wing', 'Minnesota', 'US', null, null, 'riedellskates.com', null, null, null, null, true),
  ('moxiskates', 'Moxi', '{brand}', 'unofficial', 'Long Beach', 'California', 'US', null, null, 'moxiskates.com', null, null, null, null, true),
  ('impalarollerskates', 'Impala', '{brand}', 'unofficial', 'Melbourne', null, 'AU', null, null, 'impalarollerskates.com', null, null, null, null, true),
  ('derbylaces', 'Derby Laces', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('suregripskates', 'Sure-Grip', '{brand}', 'unofficial', null, 'California', 'US', null, null, null, null, null, null, null, true),
  ('bontskates', 'Bont', '{brand}', 'unofficial', null, null, 'AU', null, null, 'bont.com', null, null, null, null, true),
  ('moonlightroller', 'Moonlight Roller', '{brand}', 'unofficial', 'Chattanooga', 'Tennessee', 'US', null, null, 'moonlightroller.com', null, null, null, null, true),
  ('lazoparty', 'Lazo', '{brand}', 'unofficial', 'Long Beach', 'California', 'US', null, null, 'lazo.com', null, null, null, null, true),
  ('oc_ramps', 'OC Ramps', '{brand}', 'unofficial', null, 'California', 'US', null, null, 'ocramps.com', null, null, null, null, true),
  ('keenramps', 'Keen Ramps', '{brand}', 'unofficial', 'Long Beach', 'California', 'US', null, null, null, null, null, null, null, true),
  ('skatelite', 'Skatelite', '{brand}', 'unofficial', 'Tacoma', 'Washington', 'US', null, null, 'skatelite.com', null, null, null, null, true),
  ('antikskates', 'Antik', '{brand}', 'unofficial', 'Red Wing', 'Minnesota', 'US', null, null, 'antikskates.com', null, null, null, null, true),
  ('powerdyne', 'PowerDyne', '{brand}', 'unofficial', 'Red Wing', 'Minnesota', 'US', null, null, null, null, null, null, null, true),
  ('radarwheels', 'Radar', '{brand}', 'unofficial', null, null, 'US', null, null, null, null, null, null, null, true),
  ('kwikbearings', 'KwiK', '{brand}', 'unofficial', 'Red Wing', 'Minnesota', 'US', null, null, null, null, null, null, null, true),
  ('atomskates', 'Atom', '{brand}', 'unofficial', null, 'California', 'US', null, null, 'atomskates.com', null, null, null, null, true),
  ('rioroller', 'Rio Roller', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('chuffedskates', 'Chuffed', '{brand}', 'unofficial', null, null, null, null, null, 'chuffedskates.com', null, null, null, null, true),
  ('brunnyhardcore', 'Brunny Hardcore', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('chicksinbowls', 'Chicks in Bowls', '{brand}', 'unofficial', null, null, null, null, null, null, null, null, null, null, true),
  ('8set_store', '8SET', '{shop,brand}', 'unofficial', 'Copenhagen', null, 'DK', 'Copenhagen', 'Europe/Copenhagen', '8setstore.com', null, null, 'storefront', 'Bregnerødgade 18, København N', true),
  ('oakcityinlineskateshop', 'Oak City Inline Skate Shop', '{shop}', 'unofficial', null, 'North Carolina', 'US', null, 'America/New_York', 'oakcityskate.com', null, null, 'by_appointment', null, false),
  ('asphaltbeachskateshop', 'Asphalt Beach', '{shop}', 'unofficial', 'Nashville', 'Tennessee', 'US', 'Nashville', 'America/Chicago', 'asphaltbeach.com', null, null, 'storefront', '961 Woodland St, Nashville, TN', true),
  ('fritzys_roller_skate_shop', 'Fritzy''s Roller Skate Shop', '{shop}', 'unofficial', 'San Diego', 'California', 'US', 'San Diego', 'America/Los_Angeles', 'fritzys.com', null, null, 'storefront', '4150 Mission Blvd, Suite 161, San Diego, CA', true),
  ('bos_bootsonwheels', 'Bo''s Boots on Wheels', '{shop}', 'unofficial', 'San Diego', 'California', 'US', 'San Diego', 'America/Los_Angeles', 'bosbootsonwheels.com', null, null, 'storefront', '8280 Clairemont Mesa Blvd #126, San Diego, CA', true),
  ('lowskateacademy', 'L.O.W Skate Academy', '{shop}', 'unofficial', 'Copenhagen', null, 'DK', 'Copenhagen', 'Europe/Copenhagen', 'lowacademy.dk', null, null, 'online_only', null, false)
) as v (handle, display_name, roles, state, city, region, country, metro, timezone, website,
        founded_label, ended_label, location_type, address, show_pin)
left join public.metro_areas m on m.name = v.metro
on conflict (handle) do nothing;

insert into public.page_descriptions (page_id, locale, body)
select p.id, v.locale, v.body
from (values
  ('powerslide', 'en', 'Inline and quad skates, frames, wheels and protection from Germany.'),
  ('powerslide', 'es', 'Patines en línea y quad, frames, ruedas y protecciones de Alemania.'),
  ('powerslide', 'da', 'Inline- og quadskøjter, frames, hjul og beskyttelse fra Tyskland.'),
  ('powerslide', 'de', 'Inline- und Quad-Skates, Frames, Rollen und Schützer aus Deutschland.'),
  ('kizerframes', 'en', 'Inline frames from Germany, part of the Powerslide group.'),
  ('kizerframes', 'es', 'Frames para patines en línea de Alemania, del grupo Powerslide.'),
  ('kizerframes', 'da', 'Inline-frames fra Tyskland, en del af Powerslide-gruppen.'),
  ('kizerframes', 'de', 'Inline-Frames aus Deutschland, Teil der Powerslide-Gruppe.'),
  ('usdskates', 'en', 'Aggressive skates from Germany, part of the Powerslide group.'),
  ('usdskates', 'es', 'Patines agresivos de Alemania, del grupo Powerslide.'),
  ('usdskates', 'da', 'Aggressive skates fra Tyskland, en del af Powerslide-gruppen.'),
  ('usdskates', 'de', 'Aggressive Skates aus Deutschland, Teil der Powerslide-Gruppe.'),
  ('wickedbearings', 'en', 'Skate bearings from Germany, part of the Powerslide group.'),
  ('wickedbearings', 'es', 'Rodamientos para patines de Alemania, del grupo Powerslide.'),
  ('wickedbearings', 'da', 'Kuglelejer til skøjter fra Tyskland, en del af Powerslide-gruppen.'),
  ('wickedbearings', 'de', 'Kugellager für Skates aus Deutschland, Teil der Powerslide-Gruppe.'),
  ('undercoverwheels', 'en', 'Inline wheels from Germany, part of the Powerslide group.'),
  ('undercoverwheels', 'es', 'Ruedas para patines en línea de Alemania, del grupo Powerslide.'),
  ('undercoverwheels', 'da', 'Inline-hjul fra Tyskland, en del af Powerslide-gruppen.'),
  ('undercoverwheels', 'de', 'Inline-Rollen aus Deutschland, Teil der Powerslide-Gruppe.'),
  ('mesmerskates', 'en', 'Aggressive skates and frames from Germany, part of the Powerslide group.'),
  ('mesmerskates', 'es', 'Patines agresivos y frames de Alemania, del grupo Powerslide.'),
  ('mesmerskates', 'da', 'Aggressive skates og frames fra Tyskland, en del af Powerslide-gruppen.'),
  ('mesmerskates', 'de', 'Aggressive Skates und Frames aus Deutschland, Teil der Powerslide-Gruppe.'),
  ('gawds', 'en', 'Aggressive skates and wheels from Germany, part of the Powerslide group.'),
  ('gawds', 'es', 'Patines agresivos y ruedas de Alemania, del grupo Powerslide.'),
  ('gawds', 'da', 'Aggressive skates og hjul fra Tyskland, en del af Powerslide-gruppen.'),
  ('gawds', 'de', 'Aggressive Skates und Rollen aus Deutschland, Teil der Powerslide-Gruppe.'),
  ('ennuiprotection', 'en', 'Protection and helmets from Germany, part of the Powerslide group.'),
  ('ennuiprotection', 'es', 'Protecciones y cascos de Alemania, del grupo Powerslide.'),
  ('ennuiprotection', 'da', 'Beskyttelse og hjelme fra Tyskland, en del af Powerslide-gruppen.'),
  ('ennuiprotection', 'de', 'Schützer und Helme aus Deutschland, Teil der Powerslide-Gruppe.'),
  ('chayaskates', 'en', 'Quad skates for park, derby and the street, from the Powerslide group in Germany.'),
  ('chayaskates', 'es', 'Patines quad para park, derby y calle, del grupo Powerslide en Alemania.'),
  ('chayaskates', 'da', 'Quadskøjter til park, derby og gaden, fra Powerslide-gruppen i Tyskland.'),
  ('chayaskates', 'de', 'Quad-Skates für Park, Derby und Straße, von der Powerslide-Gruppe in Deutschland.'),
  ('iqonskates', 'en', 'Aggressive and urban skates, frames, wheels and bearings from Germany.'),
  ('iqonskates', 'es', 'Patines agresivos y urbanos, frames, ruedas y rodamientos de Alemania.'),
  ('iqonskates', 'da', 'Aggressive og urban-skøjter, frames, hjul og kuglelejer fra Tyskland.'),
  ('iqonskates', 'de', 'Aggressive und Urban-Skates, Frames, Rollen und Kugellager aus Deutschland.'),
  ('rollerblade', 'en', 'Inline skates for the street, the park and getting around, founded in the US.'),
  ('rollerblade', 'es', 'Patines en línea para la calle, el park y moverse por la ciudad, fundada en EE. UU.'),
  ('rollerblade', 'da', 'Inlineskøjter til gaden, parken og transport, grundlagt i USA.'),
  ('rollerblade', 'de', 'Inlineskates für Straße, Park und Alltag, gegründet in den USA.'),
  ('blankskates', 'en', 'Aggressive skates and frames, Rollerblade''s street brand.'),
  ('blankskates', 'es', 'Patines agresivos y frames, la marca callejera de Rollerblade.'),
  ('blankskates', 'da', 'Aggressive skates og frames, Rollerblades street-mærke.'),
  ('blankskates', 'de', 'Aggressive Skates und Frames, die Street-Marke von Rollerblade.'),
  ('themskates', 'en', 'Aggressive skates, frames and liners from Santa Ana, CA.'),
  ('themskates', 'es', 'Patines agresivos, frames y liners de Santa Ana, California.'),
  ('themskates', 'da', 'Aggressive skates, frames og liners fra Santa Ana, Californien.'),
  ('themskates', 'de', 'Aggressive Skates, Frames und Liner aus Santa Ana, Kalifornien.'),
  ('razorsskates', 'en', 'Aggressive skates from the US, with roots in Germany.'),
  ('razorsskates', 'es', 'Patines agresivos de EE. UU., con raíces en Alemania.'),
  ('razorsskates', 'da', 'Aggressive skates fra USA med rødder i Tyskland.'),
  ('razorsskates', 'de', 'Aggressive Skates aus den USA, mit Wurzeln in Deutschland.'),
  ('groundcontrolframes', 'en', 'Aggressive frames and wheels, stock on most Razors skates.'),
  ('groundcontrolframes', 'es', 'Frames y ruedas para patinaje agresivo, de serie en la mayoría de los Razors.'),
  ('groundcontrolframes', 'da', 'Aggressive frames og hjul, som sidder på de fleste Razors-skøjter.'),
  ('groundcontrolframes', 'de', 'Aggressive Frames und Rollen, serienmäßig an den meisten Razors-Skates.'),
  ('k2skates', 'en', 'Inline skates from the US, including aggressive and urban models.'),
  ('k2skates', 'es', 'Patines en línea de EE. UU., con modelos agresivos y urbanos.'),
  ('k2skates', 'da', 'Inlineskøjter fra USA, også aggressive og urban-modeller.'),
  ('k2skates', 'de', 'Inlineskates aus den USA, auch Aggressive- und Urban-Modelle.'),
  ('roces', 'en', 'Aggressive and recreational skates from Montebelluna, Italy, since 1952.'),
  ('roces', 'es', 'Patines agresivos y recreativos de Montebelluna, Italia, desde 1952.'),
  ('roces', 'da', 'Aggressive skates og fritidsskøjter fra Montebelluna i Italien siden 1952.'),
  ('roces', 'de', 'Aggressive und Freizeit-Skates aus Montebelluna, Italien, seit 1952.'),
  ('sebaskates', 'en', 'Freestyle, freeride and street skates from France.'),
  ('sebaskates', 'es', 'Patines de freestyle, freeride y calle de Francia.'),
  ('sebaskates', 'da', 'Freestyle-, freeride- og street-skøjter fra Frankrig.'),
  ('sebaskates', 'de', 'Freestyle-, Freeride- und Street-Skates aus Frankreich.'),
  ('frskates', 'en', 'Freeride and freestyle skates and frames from France.'),
  ('frskates', 'es', 'Patines y frames de freeride y freestyle de Francia.'),
  ('frskates', 'da', 'Freeride- og freestyle-skøjter og frames fra Frankrig.'),
  ('frskates', 'de', 'Freeride- und Freestyle-Skates und Frames aus Frankreich.'),
  ('factionskates', 'en', 'Aggressive boots and skates from the US.'),
  ('factionskates', 'es', 'Botas y patines agresivos de EE. UU.'),
  ('factionskates', 'da', 'Aggressive støvler og skøjter fra USA.'),
  ('factionskates', 'de', 'Aggressive Boots und Skates aus den USA.'),
  ('flyingeagleskates', 'en', 'Freeskate and urban skates from China.'),
  ('flyingeagleskates', 'es', 'Patines de freeskate y urbanos de China.'),
  ('flyingeagleskates', 'da', 'Freeskate- og urban-skøjter fra Kina.'),
  ('flyingeagleskates', 'de', 'Freeskate- und Urban-Skates aus China.'),
  ('deadwheels', 'en', 'Aggressive wheels from Huntington Beach, CA.'),
  ('deadwheels', 'es', 'Ruedas para patinaje agresivo de Huntington Beach, California.'),
  ('deadwheels', 'da', 'Aggressive hjul fra Huntington Beach, Californien.'),
  ('deadwheels', 'de', 'Aggressive Rollen aus Huntington Beach, Kalifornien.'),
  ('rekdprotection', 'en', 'Protection and helmets from the UK.'),
  ('rekdprotection', 'es', 'Protecciones y cascos del Reino Unido.'),
  ('rekdprotection', 'da', 'Beskyttelse og hjelme fra Storbritannien.'),
  ('rekdprotection', 'de', 'Schützer und Helme aus Großbritannien.'),
  ('endlessblading', 'en', 'Urban, freestyle and wizard frames.'),
  ('endlessblading', 'es', 'Frames urbanos, de freestyle y wizard.'),
  ('endlessblading', 'da', 'Urban-, freestyle- og wizard-frames.'),
  ('endlessblading', 'de', 'Urban-, Freestyle- und Wizard-Frames.'),
  ('intuitionliners', 'en', 'Heat-moldable skate liners from Canada.'),
  ('intuitionliners', 'es', 'Liners termomoldeables para patines de Canadá.'),
  ('intuitionliners', 'da', 'Varmeformbare liners til skøjter fra Canada.'),
  ('intuitionliners', 'de', 'Thermoformbare Liner für Skates aus Kanada.'),
  ('kaltik', 'en', 'Aggressive skates, frames and wheels from Ireland.'),
  ('kaltik', 'es', 'Patines agresivos, frames y ruedas de Irlanda.'),
  ('kaltik', 'da', 'Aggressive skates, frames og hjul fra Irland.'),
  ('kaltik', 'de', 'Aggressive Skates, Frames und Rollen aus Irland.'),
  ('mushroomblading', 'en', 'Inline wheels, from a crew linked to the Wizard skating scene.'),
  ('mushroomblading', 'es', 'Ruedas para patines en línea, de un crew ligado a la escena wizard.'),
  ('mushroomblading', 'da', 'Inline-hjul fra et crew med rødder i wizard-miljøet.'),
  ('mushroomblading', 'de', 'Inline-Rollen von einer Crew aus der Wizard-Szene.'),
  ('wizardskating', 'en', 'Wizard frames, boots and wheels from Canada.'),
  ('wizardskating', 'es', 'Frames, botas y ruedas wizard de Canadá.'),
  ('wizardskating', 'da', 'Wizard-frames, -støvler og -hjul fra Canada.'),
  ('wizardskating', 'de', 'Wizard-Frames, Boots und Rollen aus Kanada.'),
  ('oysius', 'en', 'Inline frames designed and made in the US.'),
  ('oysius', 'es', 'Frames para patines en línea diseñados y fabricados en EE. UU.'),
  ('oysius', 'da', 'Inline-frames designet og lavet i USA.'),
  ('oysius', 'de', 'Inline-Frames, entworfen und gefertigt in den USA.'),
  ('reignliners', 'en', 'Skate liners from California.'),
  ('reignliners', 'es', 'Liners para patines de California.'),
  ('reignliners', 'da', 'Liners til skøjter fra Californien.'),
  ('reignliners', 'de', 'Liner für Skates aus Kalifornien.'),
  ('tnecskates', 'en', 'Affordable aggressive skates from the US.'),
  ('tnecskates', 'es', 'Patines agresivos asequibles de EE. UU.'),
  ('tnecskates', 'da', 'Aggressive skøjter til en god pris fra USA.'),
  ('tnecskates', 'de', 'Günstige Aggressive Skates aus den USA.'),
  ('5050frames', 'en', 'Aggressive frames and wheels from California.'),
  ('5050frames', 'es', 'Frames y ruedas para patinaje agresivo de California.'),
  ('5050frames', 'da', 'Aggressive frames og hjul fra Californien.'),
  ('5050frames', 'de', 'Aggressive Frames und Rollen aus Kalifornien.'),
  ('chromawheels', 'en', 'Aggressive wheels and bearings made in the US.'),
  ('chromawheels', 'es', 'Ruedas y rodamientos para patinaje agresivo hechos en EE. UU.'),
  ('chromawheels', 'da', 'Aggressive hjul og kuglelejer lavet i USA.'),
  ('chromawheels', 'de', 'Aggressive Rollen und Kugellager aus den USA.'),
  ('sicurethane', 'en', 'Aggressive wheels, including pro wheels.'),
  ('sicurethane', 'es', 'Ruedas para patinaje agresivo, incluidas ruedas pro.'),
  ('sicurethane', 'da', 'Aggressive hjul, også pro-hjul.'),
  ('sicurethane', 'de', 'Aggressive Rollen, auch Pro-Rollen.'),
  ('bacemint', 'en', 'Apparel and videos from Philadelphia, PA, with gear through collabs.'),
  ('bacemint', 'es', 'Ropa y videos de Filadelfia, Pensilvania, con material en colaboraciones.'),
  ('bacemint', 'da', 'Tøj og videoer fra Philadelphia, Pennsylvania, med udstyr i samarbejder.'),
  ('bacemint', 'de', 'Kleidung und Videos aus Philadelphia, Pennsylvania, mit Ausrüstung über Kollabos.'),
  ('senateblading', 'en', 'Wheels and grind plates from the US. Stopped making gear around 2005.'),
  ('senateblading', 'es', 'Ruedas y grind plates de EE. UU. Dejó de fabricar material hacia 2005.'),
  ('senateblading', 'da', 'Hjul og grind plates fra USA. Holdt op med at lave udstyr omkring 2005.'),
  ('senateblading', 'de', 'Rollen und Grind Plates aus den USA. Hat um 2005 aufgehört, Ausrüstung herzustellen.'),
  ('valoskates', 'en', 'Aggressive skates made with Roces. Stopped making gear in 2018.'),
  ('valoskates', 'es', 'Patines agresivos hechos con Roces. Dejó de fabricar material en 2018.'),
  ('valoskates', 'da', 'Aggressive skates lavet sammen med Roces. Holdt op med at lave udstyr i 2018.'),
  ('valoskates', 'de', 'Aggressive Skates, gefertigt mit Roces. Hat 2018 aufgehört, Ausrüstung herzustellen.'),
  ('remzskates', 'en', 'Aggressive skates and liners, distributed with Razors.'),
  ('remzskates', 'es', 'Patines agresivos y liners, distribuidos junto a Razors.'),
  ('remzskates', 'da', 'Aggressive skates og liners, som distribueres sammen med Razors.'),
  ('remzskates', 'de', 'Aggressive Skates und Liner, vertrieben zusammen mit Razors.'),
  ('triple8', 'en', 'Protection and helmets.'),
  ('triple8', 'es', 'Protecciones y cascos.'),
  ('triple8', 'da', 'Beskyttelse og hjelme.'),
  ('triple8', 'de', 'Schützer und Helme.'),
  ('187killerpads', 'en', 'Protection for skating.'),
  ('187killerpads', 'es', 'Protecciones para patinar.'),
  ('187killerpads', 'da', 'Beskyttelse til skating.'),
  ('187killerpads', 'de', 'Schützer fürs Skaten.'),
  ('bonesbearings', 'en', 'Bearings and wheels from Santa Barbara, CA.'),
  ('bonesbearings', 'es', 'Rodamientos y ruedas de Santa Bárbara, California.'),
  ('bonesbearings', 'da', 'Kuglelejer og hjul fra Santa Barbara, Californien.'),
  ('bonesbearings', 'de', 'Kugellager und Rollen aus Santa Barbara, Kalifornien.'),
  ('rollerbones', 'en', 'Quad wheels and bearings from Santa Barbara, CA.'),
  ('rollerbones', 'es', 'Ruedas y rodamientos para patines quad de Santa Bárbara, California.'),
  ('rollerbones', 'da', 'Quadhjul og kuglelejer fra Santa Barbara, Californien.'),
  ('rollerbones', 'de', 'Quad-Rollen und Kugellager aus Santa Barbara, Kalifornien.'),
  ('riedellskates', 'en', 'Quad skates, plates and bearings from Red Wing, MN, since 1945.'),
  ('riedellskates', 'es', 'Patines quad, placas y rodamientos de Red Wing, Minnesota, desde 1945.'),
  ('riedellskates', 'da', 'Quadskøjter, plader og kuglelejer fra Red Wing, Minnesota, siden 1945.'),
  ('riedellskates', 'de', 'Quad-Skates, Platten und Kugellager aus Red Wing, Minnesota, seit 1945.'),
  ('moxiskates', 'en', 'Quad skates and parts from Long Beach, CA.'),
  ('moxiskates', 'es', 'Patines quad y piezas de Long Beach, California.'),
  ('moxiskates', 'da', 'Quadskøjter og dele fra Long Beach, Californien.'),
  ('moxiskates', 'de', 'Quad-Skates und Teile aus Long Beach, Kalifornien.'),
  ('impalarollerskates', 'en', 'Quad and inline skates from Melbourne, Australia.'),
  ('impalarollerskates', 'es', 'Patines quad y en línea de Melbourne, Australia.'),
  ('impalarollerskates', 'da', 'Quad- og inlineskøjter fra Melbourne i Australien.'),
  ('impalarollerskates', 'de', 'Quad- und Inline-Skates aus Melbourne, Australien.'),
  ('derbylaces', 'en', 'Laces for quad and inline skates.'),
  ('derbylaces', 'es', 'Cordones para patines quad y en línea.'),
  ('derbylaces', 'da', 'Snørebånd til quad- og inlineskøjter.'),
  ('derbylaces', 'de', 'Schnürsenkel für Quad- und Inline-Skates.'),
  ('suregripskates', 'en', 'Quad skates, plates and parts from California.'),
  ('suregripskates', 'es', 'Patines quad, placas y piezas de California.'),
  ('suregripskates', 'da', 'Quadskøjter, plader og dele fra Californien.'),
  ('suregripskates', 'de', 'Quad-Skates, Platten und Teile aus Kalifornien.'),
  ('bontskates', 'en', 'Quad and inline skates from Australia.'),
  ('bontskates', 'es', 'Patines quad y en línea de Australia.'),
  ('bontskates', 'da', 'Quad- og inlineskøjter fra Australien.'),
  ('bontskates', 'de', 'Quad- und Inline-Skates aus Australien.'),
  ('moonlightroller', 'en', 'Quad skates from Chattanooga, TN.'),
  ('moonlightroller', 'es', 'Patines quad de Chattanooga, Tennessee.'),
  ('moonlightroller', 'da', 'Quadskøjter fra Chattanooga, Tennessee.'),
  ('moonlightroller', 'de', 'Quad-Skates aus Chattanooga, Tennessee.'),
  ('lazoparty', 'en', 'Roller-skating-inspired sneakers and skate apparel from Long Beach, CA.'),
  ('lazoparty', 'es', 'Zapatillas inspiradas en el patinaje y ropa de Long Beach, California.'),
  ('lazoparty', 'da', 'Sneakers inspireret af rulleskøjter og skatetøj fra Long Beach, Californien.'),
  ('lazoparty', 'de', 'Vom Rollschuhlaufen inspirierte Sneaker und Skate-Kleidung aus Long Beach, Kalifornien.'),
  ('oc_ramps', 'en', 'Skate ramps, rails and boxes from California.'),
  ('oc_ramps', 'es', 'Rampas, barandillas y cajones para patinar de California.'),
  ('oc_ramps', 'da', 'Skateramper, rails og bokse fra Californien.'),
  ('oc_ramps', 'de', 'Skate-Rampen, Rails und Boxen aus Kalifornien.'),
  ('keenramps', 'en', 'Flat-pack wooden ramps, rails and boxes from Long Beach, CA.'),
  ('keenramps', 'es', 'Rampas, barandillas y cajones de madera desmontables de Long Beach, California.'),
  ('keenramps', 'da', 'Ramper, rails og bokse i træ til selvsamling fra Long Beach, Californien.'),
  ('keenramps', 'de', 'Zerlegbare Holzrampen, Rails und Boxen aus Long Beach, Kalifornien.'),
  ('skatelite', 'en', 'Ramp surfaces from Tacoma, WA.'),
  ('skatelite', 'es', 'Superficies para rampas de Tacoma, Washington.'),
  ('skatelite', 'da', 'Rampeoverflader fra Tacoma, Washington.'),
  ('skatelite', 'de', 'Rampenbeläge aus Tacoma, Washington.'),
  ('antikskates', 'en', 'Quad skates and Gumball toe stops from Red Wing, MN.'),
  ('antikskates', 'es', 'Patines quad y frenos Gumball de Red Wing, Minnesota.'),
  ('antikskates', 'da', 'Quadskøjter og Gumball-stoppere fra Red Wing, Minnesota.'),
  ('antikskates', 'de', 'Quad-Skates und Gumball-Stopper aus Red Wing, Minnesota.'),
  ('powerdyne', 'en', 'Quad plates and toe stops from Red Wing, MN.'),
  ('powerdyne', 'es', 'Placas y frenos para patines quad de Red Wing, Minnesota.'),
  ('powerdyne', 'da', 'Quadplader og stoppere fra Red Wing, Minnesota.'),
  ('powerdyne', 'de', 'Quad-Platten und Stopper aus Red Wing, Minnesota.'),
  ('radarwheels', 'en', 'Quad wheels from the US.'),
  ('radarwheels', 'es', 'Ruedas para patines quad de EE. UU.'),
  ('radarwheels', 'da', 'Quadhjul fra USA.'),
  ('radarwheels', 'de', 'Quad-Rollen aus den USA.'),
  ('kwikbearings', 'en', 'Skate bearings from Red Wing, MN.'),
  ('kwikbearings', 'es', 'Rodamientos para patines de Red Wing, Minnesota.'),
  ('kwikbearings', 'da', 'Kuglelejer til skøjter fra Red Wing, Minnesota.'),
  ('kwikbearings', 'de', 'Kugellager für Skates aus Red Wing, Minnesota.'),
  ('atomskates', 'en', 'Quad wheels, plates and toe stops from California.'),
  ('atomskates', 'es', 'Ruedas, placas y frenos para patines quad de California.'),
  ('atomskates', 'da', 'Quadhjul, plader og stoppere fra Californien.'),
  ('atomskates', 'de', 'Quad-Rollen, Platten und Stopper aus Kalifornien.'),
  ('rioroller', 'en', 'Recreational and entry-level quad skates and wheels.'),
  ('rioroller', 'es', 'Patines quad y ruedas para empezar y pasear.'),
  ('rioroller', 'da', 'Quadskøjter og hjul til begyndere og fritidsbrug.'),
  ('rioroller', 'de', 'Quad-Skates und Rollen für Einsteiger und Freizeit.'),
  ('chuffedskates', 'en', 'Quad skates, including a park boot.'),
  ('chuffedskates', 'es', 'Patines quad, incluida una bota para park.'),
  ('chuffedskates', 'da', 'Quadskøjter, også en støvle til parken.'),
  ('chuffedskates', 'de', 'Quad-Skates, darunter ein Park-Boot.'),
  ('brunnyhardcore', 'en', 'Slide blocks, plates and trucks for quad park skating.'),
  ('brunnyhardcore', 'es', 'Slide blocks, placas y trucks para quad en el park.'),
  ('brunnyhardcore', 'da', 'Slide blocks, plader og trucks til quad-skating i parken.'),
  ('brunnyhardcore', 'de', 'Slide Blocks, Platten und Trucks für Quad im Park.'),
  ('chicksinbowls', 'en', 'Slide blocks for quad park skating.'),
  ('chicksinbowls', 'es', 'Slide blocks para quad en el park.'),
  ('chicksinbowls', 'da', 'Slide blocks til quad-skating i parken.'),
  ('chicksinbowls', 'de', 'Slide Blocks für Quad im Park.'),
  ('8set_store', 'en', 'Aggressive and urban skates and parts, plus its own gear, in Copenhagen.'),
  ('8set_store', 'es', 'Patines agresivos y urbanos, piezas y material propio, en Copenhague.'),
  ('8set_store', 'da', 'Aggressive og urban-skøjter og dele, plus eget udstyr, i København.'),
  ('8set_store', 'de', 'Aggressive und Urban-Skates und Teile, dazu eigene Ausrüstung, in Kopenhagen.'),
  ('oakcityinlineskateshop', 'en', 'Aggressive and fitness inline skates and parts in North Carolina, mostly online.'),
  ('oakcityinlineskateshop', 'es', 'Patines en línea agresivos y de fitness, y piezas, en Carolina del Norte, sobre todo online.'),
  ('oakcityinlineskateshop', 'da', 'Aggressive inlineskøjter og fitnessskøjter og dele i North Carolina, mest online.'),
  ('oakcityinlineskateshop', 'de', 'Aggressive und Fitness-Inlineskates und Teile in North Carolina, vor allem online.'),
  ('asphaltbeachskateshop', 'en', 'Quad and inline skates and protection in Nashville, TN.'),
  ('asphaltbeachskateshop', 'es', 'Patines quad y en línea y protecciones en Nashville, Tennessee.'),
  ('asphaltbeachskateshop', 'da', 'Quad- og inlineskøjter og beskyttelse i Nashville, Tennessee.'),
  ('asphaltbeachskateshop', 'de', 'Quad- und Inline-Skates und Schützer in Nashville, Tennessee.'),
  ('fritzys_roller_skate_shop', 'en', 'Roller, inline and ice skates, rentals and repairs near the Pacific Beach boardwalk.'),
  ('fritzys_roller_skate_shop', 'es', 'Patines quad, en línea y de hielo, alquiler y reparaciones junto al paseo de Pacific Beach.'),
  ('fritzys_roller_skate_shop', 'da', 'Rulleskøjter, inlineskøjter og skøjter, udlejning og reparationer ved strandpromenaden i Pacific Beach.'),
  ('fritzys_roller_skate_shop', 'de', 'Rollschuhe, Inline- und Schlittschuhe, Verleih und Reparaturen an der Strandpromenade von Pacific Beach.'),
  ('bos_bootsonwheels', 'en', 'Roller and inline skates, parts and custom skates in San Diego.'),
  ('bos_bootsonwheels', 'es', 'Patines quad y en línea, piezas y patines a medida en San Diego.'),
  ('bos_bootsonwheels', 'da', 'Rulle- og inlineskøjter, dele og specialbyggede skøjter i San Diego.'),
  ('bos_bootsonwheels', 'de', 'Rollschuhe und Inline-Skates, Teile und Custom-Skates in San Diego.'),
  ('lowskateacademy', 'en', 'A Copenhagen skate school with lessons, camps and its own skate shop.'),
  ('lowskateacademy', 'es', 'Escuela de patinaje en Copenhague con clases, campamentos y su propia tienda.'),
  ('lowskateacademy', 'da', 'En skateskole i København med undervisning, camps og sin egen skateshop.'),
  ('lowskateacademy', 'de', 'Eine Skateschule in Kopenhagen mit Kursen, Camps und eigenem Skateshop.')
) as v (handle, locale, body)
join public.pages p on p.handle = v.handle
on conflict (page_id, locale) do nothing;
/* Checks ----------------------------------------------------------------------- */
create temp table t_results(step text, ok boolean, detail text);
grant all on t_results to authenticated, anon;

insert into auth.users (id, email, aud, role, instance_id) values
 ('e1000000-0000-4000-8000-0000000000b1','pg-owner@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e1000000-0000-4000-8000-0000000000b2','pg-manager@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e1000000-0000-4000-8000-0000000000b3','pg-staff@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e1000000-0000-4000-8000-0000000000b4','pg-fan@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e1000000-0000-4000-8000-0000000000b5','pg-stranger@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e1000000-0000-4000-8000-0000000000b6','pg-suspended@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('e1000000-0000-4000-8000-0000000000b7','pg-solo@example.invalid','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

insert into profiles (id, username, onboarded_at, home_metro_area_id, disciplines, age_confirmed_at, is_private, suspended_until)
select v.id::uuid, v.username, now(), (select id from metro_areas where name = 'San Diego'), '{inline}', now(), false, v.susp
from (values
 ('e1000000-0000-4000-8000-0000000000b1','pg_owner', null::timestamptz),
 ('e1000000-0000-4000-8000-0000000000b2','pg_manager', null),
 ('e1000000-0000-4000-8000-0000000000b3','pg_staff', null),
 ('e1000000-0000-4000-8000-0000000000b4','pg_fan', null),
 ('e1000000-0000-4000-8000-0000000000b5','pg_stranger', null),
 ('e1000000-0000-4000-8000-0000000000b6','pg_suspended', now() + interval '1 day'),
 ('e1000000-0000-4000-8000-0000000000b7','pg_solo', null)
) as v (id, username, susp);

/* The seed ---------------------------------------------------------------------- */
insert into t_results select 'seed: 68 pages', count(*) = 68, count(*)::text from pages;
insert into t_results select 'seed: four languages for every page', count(*) = 68 * 4, count(*)::text from page_descriptions;
insert into t_results select 'seed: Senate and Valo are archives with their years',
  count(*) = 2, string_agg(handle || ' ' || coalesce(founded_label, '') || '–' || coalesce(ended_label, ''), ', ')
  from pages where state = 'out_of_business' and closed_at is not null and ended_label is not null;
insert into t_results select 'seed: 8SET is a shop and a brand in Copenhagen',
  roles = '{shop,brand}' and metro_area_id = (select id from metro_areas where name = 'Copenhagen'), roles::text
  from pages where handle = '8set_store';
insert into t_results select 'seed: shops have a location type and a clock',
  count(*) = 6, count(*)::text from pages where 'shop' = any (roles) and location_type is not null and timezone is not null;

/* One namespace ------------------------------------------------------------------ */
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
insert into t_results select 'username check refuses a page handle (any case)',
  not username_available('themskates') and not username_available('ThemSkates'), '';
insert into t_results select 'username check refuses "official"',
  not username_available('them_official') and not username_available('OfficialThem'), '';
insert into t_results select 'username check refuses another member''s name in other capitals', not username_available('PG_FAN'), '';
insert into t_results select 'username check still allows ordinary names (dead, bones)',
  username_available('dead') and username_available('bones') and username_available('pg_new_name'), '';
do $$ begin update profiles set username = 'deadwheels' where id = 'e1000000-0000-4000-8000-0000000000b5';
  insert into t_results values ('a member can''t take a page handle as a username', false, 'no error');
exception when others then insert into t_results values ('a member can''t take a page handle as a username', sqlerrm = 'username_reserved', sqlerrm); end $$;
do $$ begin update profiles set username = 'pg_official' where id = 'e1000000-0000-4000-8000-0000000000b5';
  insert into t_results values ('a member can''t use "official" in a username', false, 'no error');
exception when others then insert into t_results values ('a member can''t use "official" in a username', sqlerrm = 'username_not_allowed', sqlerrm); end $$;
reset role;

do $$ begin insert into pages (handle, display_name, roles) values ('pg_fan', 'Fan Wheels', '{brand}');
  insert into t_results values ('a page can''t take a member''s username', false, 'no error');
exception when others then insert into t_results values ('a page can''t take a member''s username', sqlerrm = 'handle_taken', sqlerrm); end $$;
do $$ begin insert into pages (handle, display_name, roles) values ('PG_Fan', 'Fan Wheels', '{brand}');
  insert into t_results values ('a page can''t take a member''s username in other capitals', false, 'no error');
exception when others then insert into t_results values ('a page can''t take a member''s username in other capitals', sqlerrm = 'handle_taken', sqlerrm); end $$;
do $$ begin insert into pages (handle, display_name, roles) values ('THEMSKATES', 'Them again', '{brand}');
  insert into t_results values ('two pages can''t share a handle (any case)', false, 'no error');
exception when others then insert into t_results values ('two pages can''t share a handle (any case)', true, sqlerrm); end $$;

update pages set handle = 'them_skates' where handle = 'themskates';
insert into t_results select 'renaming a handle keeps the old one redirecting',
  count(*) = 1, max(redirect_until)::date::text from page_aliases where handle = 'themskates' and redirect_until > now() + interval '80 days';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
insert into t_results select 'the old handle stays off-limits as a username while it redirects',
  not username_available('themskates') and not username_available('THEMSKATES'), '';
reset role;
do $$ begin insert into pages (handle, display_name, roles) values ('ThemSkates', 'Copycat', '{brand}');
  insert into t_results values ('another page can''t take a redirecting handle', false, 'no error');
exception when others then insert into t_results values ('another page can''t take a redirecting handle', sqlerrm = 'handle_taken', sqlerrm); end $$;
update pages set display_name = 'Them Skates' where handle = 'them_skates';
insert into t_results select 'renaming the display name keeps a Formerly alias',
  exists (select 1 from page_aliases a join pages p on p.id = a.page_id where p.handle = 'them_skates' and a.name = 'Them' and a.handle is null), '';
update pages set display_name = 'Them', handle = 'themskates' where handle = 'them_skates';
insert into t_results select 'a page can take its own old handle back', exists (select 1 from pages where handle = 'themskates'), '';

/* Shapes --------------------------------------------------------------------------- */
do $$ begin update pages set location_type = 'storefront' where handle = 'deadwheels';
  insert into t_results values ('brand-only pages can''t have shop fields', false, 'no error');
exception when others then insert into t_results values ('brand-only pages can''t have shop fields', true, sqlerrm); end $$;
do $$ begin update pages set state = 'closed' where handle = 'deadwheels';
  insert into t_results values ('only shops can be Closed', false, 'no error');
exception when others then insert into t_results values ('only shops can be Closed', true, sqlerrm); end $$;
insert into page_brands_carried (shop_id, brand_id)
select s.id, b.id from pages s, pages b where s.handle = 'fritzys_roller_skate_shop' and b.handle = 'moxiskates';
insert into t_results select 'a shop carries a brand', count(*) = 1, '' from page_brands_carried;
do $$ begin insert into page_brands_carried (shop_id, brand_id)
  select s.id, b.id from pages s, pages b where s.handle = 'moxiskates' and b.handle = 'deadwheels';
  insert into t_results values ('a brand-only page can''t carry brands', false, 'no error');
exception when others then insert into t_results values ('a brand-only page can''t carry brands', sqlerrm = 'not_a_shop', sqlerrm); end $$;
do $$ begin insert into page_links (page_id, position, url) select id, 4, 'instagram.com/deadwheels' from pages where handle = 'deadwheels';
  insert into t_results values ('no more than 3 links', false, 'no error');
exception when others then insert into t_results values ('no more than 3 links', true, sqlerrm); end $$;

/* Teams ----------------------------------------------------------------------------- */
insert into page_members (page_id, user_id, role)
select p.id, v.u::uuid, v.r::page_member_role from pages p, (values
  ('e1000000-0000-4000-8000-0000000000b1', 'owner'),
  ('e1000000-0000-4000-8000-0000000000b2', 'manager'),
  ('e1000000-0000-4000-8000-0000000000b3', 'staff'),
  ('e1000000-0000-4000-8000-0000000000b6', 'staff')) as v (u, r)
where p.handle = '8set_store';
insert into page_members (page_id, user_id, role)
select id, 'e1000000-0000-4000-8000-0000000000b7', 'owner' from pages where handle = 'oakcityinlineskateshop';
update pages set state = 'managed', managed_at = now(), logo_path = 'x/logo.jpg' where handle in ('8set_store', 'oakcityinlineskateshop');
do $$ begin insert into page_members (page_id, user_id, role)
  select id, 'e1000000-0000-4000-8000-0000000000b2', 'owner' from pages where handle = 'deadwheels';
  insert into page_members (page_id, user_id, role)
  select id, 'e1000000-0000-4000-8000-0000000000b3', 'owner' from pages where handle = 'deadwheels';
  insert into t_results values ('a page has one owner', false, 'no error');
exception when others then insert into t_results values ('a page has one owner', true, sqlerrm); end $$;
insert into page_invites (page_id, kind, role, email, invited_by)
select id, 'team', 'staff', 'new-staff@example.invalid', 'e1000000-0000-4000-8000-0000000000b2' from pages where handle = '8set_store';
insert into page_invites (page_id, kind, invitee_id, invited_by)
select id, 'ownership', 'e1000000-0000-4000-8000-0000000000b4', 'e1000000-0000-4000-8000-0000000000b1' from pages where handle = '8set_store';
do $$ begin insert into page_invites (page_id, kind, email) select id, 'ownership', 'x@example.invalid' from pages where handle = '8set_store';
  insert into t_results values ('ownership goes to a member, never an email', false, 'no error');
exception when others then insert into t_results values ('ownership goes to a member, never an email', true, sqlerrm); end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
insert into t_results select 'staff see their team', count(*) = 4, count(*)::text
  from page_members m join pages p on p.id = m.page_id where p.handle = '8set_store';
insert into t_results select 'staff don''t see team invites', count(*) = 0, count(*)::text from page_invites;
insert into t_results select 'staff can act as the page', private.can_act_as_page((select id from pages where handle = '8set_store')), '';
insert into t_results select 'staff can''t act as a manager', not private.can_act_as_page((select id from pages where handle = '8set_store'), 'manager'), '';
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
insert into t_results select 'managers see team invites', count(*) = 2, count(*)::text from page_invites;
insert into t_results select 'managers can act as managers', private.can_act_as_page((select id from pages where handle = '8set_store'), 'manager'), '';
insert into t_results select 'nobody acts for a page they aren''t on', not private.can_act_as_page((select id from pages where handle = 'deadwheels')), '';
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b6","role":"authenticated"}', true);
insert into t_results select 'a suspended member can''t act as the page', not private.can_act_as_page((select id from pages where handle = '8set_store')), '';
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b4","role":"authenticated"}', true);
insert into t_results select 'outsiders don''t see the team', count(*) = 0, count(*)::text from page_members;
insert into t_results select 'the invitee sees their ownership offer', count(*) = 1, count(*)::text from page_invites;
reset role;

update pages set suspended_at = now() where handle = '8set_store';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'nobody acts for a suspended page', not private.can_act_as_page((select id from pages where handle = '8set_store')), '';
reset role;
update pages set suspended_at = null where handle = '8set_store';
update pages set frozen_at = now() where handle = '8set_store';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
insert into t_results select 'nobody acts for a page frozen by a dispute', not private.can_act_as_page((select id from pages where handle = '8set_store')), '';
reset role;
update pages set frozen_at = null where handle = '8set_store';

/* Reading pages ---------------------------------------------------------------------- */
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
insert into t_results select 'members read pages and their lines', count(*) = 4, count(*)::text
  from page_descriptions d join pages p on p.id = d.page_id where p.handle = 'deadwheels';
do $$ begin perform created_by from pages limit 1;
  insert into t_results values ('who created a page stays hidden', false, 'no error');
exception when others then insert into t_results values ('who created a page stays hidden', true, sqlerrm); end $$;
do $$ begin insert into pages (handle, display_name, roles) values ('pg_fakebrand', 'Fake', '{brand}');
  insert into t_results values ('members can''t make pages', false, 'no error');
exception when others then insert into t_results values ('members can''t make pages', true, sqlerrm); end $$;
do $$ begin update page_descriptions set body = 'hacked' where locale = 'en';
  insert into t_results values ('members can''t edit descriptions', false, 'no error');
exception when others then insert into t_results values ('members can''t edit descriptions', true, sqlerrm); end $$;
do $$ begin update pages set state = 'managed' where handle = 'deadwheels';
  insert into t_results values ('members can''t change a page', false, 'no error');
exception when others then insert into t_results values ('members can''t change a page', true, sqlerrm); end $$;
reset role;
set local role anon;
do $$ begin perform 1 from pages limit 1;
  insert into t_results values ('signed-out visitors can''t read pages', false, 'no error');
exception when others then insert into t_results values ('signed-out visitors can''t read pages', true, sqlerrm); end $$;
reset role;

/* Following ----------------------------------------------------------------------------- */
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b4","role":"authenticated"}', true);
insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b4', id from pages where handle in ('deadwheels', '8set_store', 'themskates');
insert into t_results select 'a member follows unofficial and managed pages', count(*) = 3, count(*)::text from page_follows;
do $$ begin insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b4', id from pages where handle = 'senateblading';
  insert into t_results values ('archives can''t be followed', false, 'no error');
exception when others then insert into t_results values ('archives can''t be followed', true, sqlerrm); end $$;
do $$ begin insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b5', id from pages where handle = 'kizerframes';
  insert into t_results values ('you can''t follow for someone else', false, 'no error');
exception when others then insert into t_results values ('you can''t follow for someone else', true, sqlerrm); end $$;
do $$ begin perform page_follower_count((select id from pages where handle = '8set_store'));
  insert into t_results values ('followers don''t get the follower number', false, 'no error');
exception when others then insert into t_results values ('followers don''t get the follower number', sqlerrm = 'not_on_the_team', sqlerrm); end $$;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b5', id from pages where handle = '8set_store';
insert into t_results select 'nobody sees who else follows a page', count(*) = 1, count(*)::text from page_follows;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
insert into t_results select 'the team gets the number, not the list',
  page_follower_count((select id from pages where handle = '8set_store')) = 2 and (select count(*) from page_follows) = 0,
  page_follower_count((select id from pages where handle = '8set_store'))::text;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b6","role":"authenticated"}', true);
do $$ begin insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b6', id from pages where handle = 'deadwheels';
  insert into t_results values ('suspended members can''t follow', false, 'no error');
exception when others then insert into t_results values ('suspended members can''t follow', true, sqlerrm); end $$;
insert into page_mutes (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b6', id from pages where handle = 'deadwheels';
insert into user_page_blocks (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b6', id from pages where handle = 'kizerframes';
insert into t_results select 'suspended members can still mute and block', (select count(*) from page_mutes) = 1 and (select count(*) from user_page_blocks) = 1, '';

/* Muting and blocking ------------------------------------------------------------------------- */
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b4","role":"authenticated"}', true);
insert into page_mutes (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b4', id from pages where handle = 'deadwheels';
insert into t_results select 'muting keeps the follow', (select count(*) from page_mutes) = 1 and (select count(*) from page_follows) = 3, '';
delete from page_mutes;
insert into t_results select 'unmuting', (select count(*) from page_mutes) = 0, '';
do $$ begin insert into page_mutes (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b5', id from pages where handle = 'deadwheels';
  insert into t_results values ('you can''t mute for someone else', false, 'no error');
exception when others then insert into t_results values ('you can''t mute for someone else', true, sqlerrm); end $$;
insert into user_page_blocks (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b4', id from pages where handle = 'themskates';
insert into t_results select 'blocking a page unfollows it', not exists (select 1 from page_follows f join pages p on p.id = f.page_id where p.handle = 'themskates'), '';
do $$ begin insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b4', id from pages where handle = 'themskates';
  insert into t_results values ('you can''t follow a page you blocked', false, 'no error');
exception when others then insert into t_results values ('you can''t follow a page you blocked', true, sqlerrm); end $$;
delete from user_page_blocks;
insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b4', id from pages where handle = 'themskates';
insert into t_results select 'unblocking lets you follow again', (select count(*) from page_follows) = 3, '';
reset role;

insert into page_blocks (page_id, user_id, blocked_by)
select id, 'e1000000-0000-4000-8000-0000000000b5', 'e1000000-0000-4000-8000-0000000000b2' from pages where handle = '8set_store';
insert into t_results select 'a page block ends the skater''s follow',
  not exists (select 1 from page_follows f join pages p on p.id = f.page_id where p.handle = '8set_store' and f.user_id = 'e1000000-0000-4000-8000-0000000000b5'), '';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
do $$ begin insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b5', id from pages where handle = '8set_store';
  insert into t_results values ('a blocked skater can''t follow the page', false, 'no error');
exception when others then insert into t_results values ('a blocked skater can''t follow the page', true, sqlerrm); end $$;
insert into t_results select 'the skater can''t see the block', count(*) = 0, count(*)::text from page_blocks;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b3","role":"authenticated"}', true);
insert into t_results select 'staff can''t see page blocks', count(*) = 0, count(*)::text from page_blocks;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
insert into t_results select 'managers see their page''s blocks', count(*) = 1, count(*)::text from page_blocks;
reset role;
update page_blocks set lifted_at = now();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-0000000000b5","role":"authenticated"}', true);
insert into page_follows (user_id, page_id) select 'e1000000-0000-4000-8000-0000000000b5', id from pages where handle = '8set_store';
insert into t_results select 'a lifted block lets the skater follow again', count(*) = 1, count(*)::text from page_follows;
reset role;

/* Bans end page roles -------------------------------------------------------------------------- */
update profiles set banned_at = now() where id = 'e1000000-0000-4000-8000-0000000000b1';
insert into t_results select 'a ban ends the person''s page roles',
  not exists (select 1 from page_members where user_id = 'e1000000-0000-4000-8000-0000000000b1'), '';
insert into t_results select 'a page with a team left stays managed (Rachel picks the owner)',
  state = 'managed' and logo_path is not null, state::text from pages where handle = '8set_store';
insert into t_results select 'the ban cancels the invites they sent',
  count(*) = 1, count(*)::text from page_invites where cancelled_at is not null;
update profiles set deleted_at = now() where id = 'e1000000-0000-4000-8000-0000000000b7';
insert into t_results select 'a page left with nobody goes back to Unofficial, logo off',
  state = 'unofficial' and logo_path is null, state::text from pages where handle = 'oakcityinlineskateshop';

do $$ begin raise exception 'RESULTS %', (select json_agg(t_results) from t_results); end $$;
