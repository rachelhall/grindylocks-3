-- Rolled-back check for 20261104190000_admin_brands_enums and 20261104190100_admin_brands.
-- Runs both migrations and the checks in one transaction, then raises
-- CHECK <ok> of <total>: <failures>, so nothing is kept. Checks run as throwaway
-- members, a throwaway owner and a throwaway city admin made in the transaction.
begin;
-- Brand and shop accounts part A, PR 6 (web admin for brands): the new enum
-- type. Kept in its own migration and applied first, because Postgres can't
-- use a new enum value in the transaction that adds it.

do $$ begin
  -- What a shop fix is about (the Shop-Fix sheet on an unofficial shop).
  -- location_type: storefront, by appointment or online only. location: the
  -- address or pin. closed: closed for good.
  create type public.page_fix_field as enum (
    'hours', 'location_type', 'location', 'brands_carried', 'website', 'closed', 'other'
  );
exception when duplicate_object then null; end $$;
-- Brand and shop accounts part A, PR 6: the web admin for brands.
--
-- Rachel's queue gains claims, suggested brands, product suggestions and
-- reports about pages; Page blocks gets its own page; shop fixes (the
-- Shop-Fix sheet on an unofficial shop) go to the shop's city admin. Every
-- action is a function here, so neither app holds the logic. See the Brand
-- and Shop Accounts PRD › Web admin.
--
-- Additive: new tables, columns, functions and policies. moderation_queue()
-- is dropped and recreated in this migration because its columns change, and
-- the moderation_actions check gains the new actions (as in meetup_changes).
-- decide_page_claim() and private.make_page_owner() are replaced: a
-- posted-code claim needs "Checked it" first, and a claim invite that brings
-- a logo now tells the page's followers, like adding the logo later does.

/* 1. Columns and tables ------------------------------------------------------------- */

alter table public.moderation_actions
  add column if not exists page_id uuid references public.pages (id) on delete set null,
  -- The claim, suggestion, block or fix the action was about.
  add column if not exists subject_id uuid;

alter table public.moderation_actions drop constraint if exists moderation_actions_action_check;
alter table public.moderation_actions add constraint moderation_actions_action_check check (action in (
  'dismiss', 'keep_hidden', 'warn', 'suspend', 'escalate', 'ban',
  'park_info_approved', 'park_info_declined',
  'obstacle_approved', 'obstacle_merged', 'obstacle_declined',
  'park_verified',
  'meetup_hidden', 'meetup_unhidden',
  'claim_approved', 'claim_declined',
  'page_suggestion_approved', 'page_suggestion_merged', 'page_suggestion_declined',
  'product_suggestion_approved', 'product_suggestion_done', 'product_suggestion_declined',
  'page_reports_dismissed', 'page_reports_actioned',
  'page_block_lifted',
  'page_fix_approved', 'page_fix_done', 'page_fix_declined', 'page_fix_escalated'
));

-- How a suggested brand ended: a new page, or pointed at an existing one.
alter table public.page_suggestions
  add column if not exists outcome text check (outcome is null or outcome in ('created', 'merged'));

-- A page made from a suggestion has its factual line in English only until
-- someone adds the other three languages.
alter table public.pages
  add column if not exists needs_translations_at timestamptz;

create table if not exists public.page_fix_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  page_id uuid not null references public.pages (id) on delete cascade,
  field public.page_fix_field not null,
  -- What it should be. location_type holds storefront, by_appointment or
  -- online_only; closed has none; the rest are free text.
  value text check (value is null or char_length(value) between 1 and 300),
  note text check (note is null or char_length(note) between 1 and 300),
  status public.review_status not null default 'open',
  -- A city admin sent it on to Rachel (a fix only she can make by hand).
  escalated_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint page_fix_reports_value check ((field = 'closed') = (value is null))
);

comment on table public.page_fix_reports is
  'Suggest a fix on an unofficial shop (Shop-Fix). The shop''s city admin reviews it, with Rachel as backup.';

create index if not exists page_fix_reports_open_idx on public.page_fix_reports (created_at) where status = 'open';
create index if not exists page_fix_reports_page_idx on public.page_fix_reports (page_id);
create index if not exists page_fix_reports_reporter_idx on public.page_fix_reports (reporter_id, created_at);

alter table public.page_fix_reports enable row level security;
revoke all on public.page_fix_reports from anon, authenticated;
grant select on public.page_fix_reports to authenticated;

/* 2. Helpers -------------------------------------------------------------------------- */

-- Who reviews a shop fix: Rachel, or a city admin for the shop's metro area
-- (not once it's been sent on to Rachel).
create or replace function private.can_review_page_fix(page uuid, escalated boolean default false)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select private.is_owner()
      or (not escalated and exists (
            select 1 from pages p
             where p.id = page and p.metro_area_id is not null
               and private.has_role('city_admin', p.metro_area_id)
          ));
$$;

revoke all on function private.can_review_page_fix(uuid, boolean) from public, anon, authenticated;
grant execute on function private.can_review_page_fix(uuid, boolean) to authenticated;

drop policy if exists "page fixes: your own and reviewers" on public.page_fix_reports;
create policy "page fixes: your own and reviewers" on public.page_fix_reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or private.can_review_page_fix(page_id, escalated_at is not null));

-- The owner-only gate for Rachel's queue functions. Reads say not_found, so
-- nobody learns what exists.
create or replace function private.require_owner()
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not private.is_owner() then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return auth.uid();
end $$;

revoke all on function private.require_owner() from public, anon, authenticated;
grant execute on function private.require_owner() to authenticated;

-- Pages that might be the one a suggestion names: by name, handle or a
-- Formerly name, most alike first.
create or replace function private.page_matches(q text, max_results integer default 3)
returns table (id uuid, display_name text, handle text, roles text[], state text, city text, country text, score real)
language sql stable security definer
set search_path = public, extensions
as $$
  with needle as (select private.fold(coalesce(q, '')) as n),
  scored as (
    select p.id,
           greatest(
             similarity(private.fold(p.display_name), (select n from needle)),
             similarity(private.fold(p.handle::text), regexp_replace((select n from needle), '[^a-z0-9]', '', 'g')),
             coalesce((select max(similarity(private.fold(a.name), (select n from needle)))
                         from page_aliases a where a.page_id = p.id), 0)
           ) as score
      from pages p
  )
  select p.id, p.display_name, p.handle::text, p.roles::text[], p.state::text, p.city, p.country::text, s.score
    from scored s join pages p on p.id = s.id
   where s.score >= 0.45
   order by s.score desc, p.display_name
   limit greatest(coalesce(max_results, 3), 1);
$$;

revoke all on function private.page_matches(text, integer) from public, anon, authenticated;

-- A page's summary for the detail panes.
create or replace function private.page_summary(page uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'handle', p.handle::text,
    'roles', to_jsonb(p.roles::text[]),
    'state', p.state::text,
    'city', p.city,
    'country', p.country::text,
    'website', p.website,
    'has_logo', p.logo_path is not null,
    'frozen', p.frozen_at is not null,
    'suspended', p.suspended_at is not null,
    'followers', (select count(*) from page_follows f where f.page_id = p.id),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('username', u.username::text, 'role', m.role::text) order by m.joined_at)
        from page_members m join profiles u on u.id = m.user_id
       where m.page_id = p.id
    ), '[]'::jsonb)
  )
    from pages p where p.id = page;
$$;

revoke all on function private.page_summary(uuid) from public, anon, authenticated;

-- "Them is now on Grindylocks", once per page ever: when a claimed page gets
-- its first logo. set_page_logo() does the same when the logo comes later.
create or replace function private.tell_page_followers(page uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  update pages set followers_told_at = now()
   where id = page and followers_told_at is null and state = 'managed' and logo_path is not null;
  if not found then
    return;
  end if;
  insert into notifications (recipient_id, kind, page_id)
  select f.user_id, 'page_claimed', page
    from page_follows f
    join profiles pr on pr.id = f.user_id
   where f.page_id = page
     and pr.deleted_at is null and pr.onboarded_at is not null
     and not exists (select 1 from page_members m where m.page_id = page and m.user_id = f.user_id)
     and not exists (select 1 from user_page_blocks b where b.page_id = page and b.user_id = f.user_id);
end $$;

revoke all on function private.tell_page_followers(uuid) from public, anon, authenticated;

/* 3. Claims ------------------------------------------------------------------------------ */

-- As in PR 5, plus: a claim invite that came with a logo makes the page
-- OFFICIAL straight away, so its followers are told then.
create or replace function private.make_page_owner(page uuid, who uuid, by_whom uuid, logo text default null)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  c record;
begin
  update pages
     set state = 'managed',
         managed_at = now(),
         founding_partner_at = coalesce(founding_partner_at, now()),
         logo_path = coalesce(logo, logo_path),
         updated_at = now()
   where id = page;

  insert into page_members (page_id, user_id, role, invited_by)
  values (page, who, 'owner', by_whom)
  on conflict (page_id, user_id) do update set role = 'owner';

  for c in
    update page_claims
       set status = 'declined', decline_reason = 'another_claim_approved', decided_at = now(), decided_by = by_whom
     where page_claims.page_id = page and user_id <> who and status in ('draft', 'pending')
    returning user_id, status
  loop
    perform private.notify_page(c.user_id, 'page_claim_declined', page, null, 'another_claim_approved');
  end loop;

  update page_invites
     set cancelled_at = now()
   where page_invites.page_id = page and kind = 'claim'
     and accepted_at is null and declined_at is null and cancelled_at is null;

  perform private.tell_page_followers(page);
end $$;

revoke all on function private.make_page_owner(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Rachel's "Checked it" on a posted-code claim: she found the code on the
-- brand's own account.
create or replace function public.set_claim_checked(claim uuid, checked boolean)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  perform private.require_owner();
  update page_claims
     set checked_at = case when checked then coalesce(checked_at, now()) end
   where id = claim and proof = 'posted_code' and status = 'pending';
  if not found then
    raise exception 'not_pending' using errcode = '22023';
  end if;
end $$;

-- As in PR 5, plus: a posted-code claim can't be approved until Checked it
-- is ticked, and decisions made in the web admin are logged.
create or replace function public.decide_page_claim(claim uuid, approve boolean, reason text default null)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  c page_claims%rowtype;
  why text := nullif(trim(coalesce(reason, '')), '');
  me uuid := auth.uid();
begin
  if not private.is_rachel() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select * into c from page_claims where id = claim for update;
  if not found or c.status <> 'pending' then
    raise exception using errcode = '22023', message = 'not_pending';
  end if;

  if approve then
    if c.proof = 'posted_code' and c.checked_at is null then
      raise exception using errcode = '22023', message = 'not_checked';
    end if;
    if not exists (select 1 from pages p where p.id = c.page_id and p.state = 'unofficial') then
      raise exception using errcode = '22023', message = 'page_taken';
    end if;
    if not private.is_in_good_standing(c.user_id) then
      raise exception using errcode = '22023', message = 'claimant_unavailable';
    end if;
    update page_claims set status = 'approved', decided_at = now(), decided_by = me where id = c.id;
    perform private.make_page_owner(c.page_id, c.user_id, me);
    perform private.notify_page(c.user_id, 'page_claim_approved', c.page_id);
  else
    if why is null or char_length(why) > 300 then
      raise exception using errcode = '22023', message = 'reason_needed';
    end if;
    update page_claims
       set status = 'declined', decline_reason = why, decided_at = now(), decided_by = me
     where id = c.id;
    perform private.notify_page(c.user_id, 'page_claim_declined', c.page_id, null, why);
  end if;

  if me is not null then
    insert into moderation_actions (actor_id, action, target_user_id, page_id, subject_id, message)
    values (me, case when approve then 'claim_approved' else 'claim_declined' end, c.user_id, c.page_id, c.id,
            case when approve then null else why end);
  end if;
end $$;

-- One claim for the Claims pane: the proof, the role and note, the page and
-- any other claim open on it.
create or replace function public.claim_review_detail(claim uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  c page_claims%rowtype;
begin
  perform private.require_owner();
  select * into c from page_claims where id = claim;
  if not found or c.status <> 'pending' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', c.id,
    'proof', c.proof::text,
    'role_title', c.role_title,
    'note', c.note,
    'email', c.email::text,
    'email_domain_matches', c.email_domain_matches,
    'email_confirmed_at', c.email_confirmed_at,
    'posted_code', c.posted_code,
    'posted_code_expires_at', c.posted_code_expires_at,
    'posted_url', c.posted_url,
    'checked_at', c.checked_at,
    'sent_at', c.sent_at,
    'claimant', (select jsonb_build_object('id', u.id, 'username', u.username::text) from profiles u where u.id = c.user_id),
    'page', private.page_summary(c.page_id),
    'others', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'username', u.username::text, 'proof', o.proof::text,
               'email_domain_matches', o.email_domain_matches, 'sent_at', o.sent_at
             ) order by o.sent_at)
        from page_claims o left join profiles u on u.id = o.user_id
       where o.page_id = c.page_id and o.id <> c.id and o.status = 'pending'
    ), '[]'::jsonb)
  );
end $$;

-- Pages Send claim invite can offer: unofficial, not frozen, nobody on the
-- team. Matches the name or handle; most followed first with nothing typed.
create or replace function public.claimable_pages(q text default null, max_results integer default 20)
returns table (id uuid, display_name text, handle text, roles text[], city text, country text, followers bigint)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.id, p.display_name, p.handle::text, p.roles::text[], p.city, p.country::text,
         (select count(*) from page_follows f where f.page_id = p.id) as followers
    from pages p
   where private.is_owner()
     and p.state = 'unofficial' and p.frozen_at is null
     and not exists (select 1 from page_members m where m.page_id = p.id)
     and (coalesce(q, '') = ''
          or private.fold(p.display_name) like '%' || private.fold(q) || '%'
          or private.fold(p.handle::text) like '%' || private.fold(q) || '%')
   order by (coalesce(q, '') <> '' and private.fold(p.display_name) like private.fold(q) || '%') desc,
            followers desc, p.display_name
   limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

-- Rachel can put a logo in any page's folder before sending a claim invite
-- (the invite carries it to the page when it's accepted).
drop policy if exists "page images: Rachel uploads" on storage.objects;
create policy "page images: Rachel uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'page-images'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and private.is_owner()
  );

/* 4. Suggested brands ------------------------------------------------------------------ */

create or replace function public.page_suggestion_review_detail(suggestion uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  s page_suggestions%rowtype;
  base text;
begin
  perform private.require_owner();
  select * into s from page_suggestions where id = suggestion;
  if not found or s.status <> 'open' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  base := left(regexp_replace(private.fold(s.name), '[^a-z0-9_.]', '', 'g'), 30);
  return jsonb_build_object(
    'id', s.id,
    'role', s.role::text,
    'name', s.name,
    'what', s.what,
    'link', s.link,
    'created_at', s.created_at,
    'suggester', (select u.username::text from profiles u where u.id = s.suggester_id),
    'suggested_handle', case when char_length(base) >= 2 then base end,
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'display_name', m.display_name, 'handle', m.handle, 'roles', to_jsonb(m.roles),
               'state', m.state, 'city', m.city, 'country', m.country
             ) order by m.score desc)
        from private.page_matches(s.name, 5) m
    ), '[]'::jsonb)
  );
end $$;

-- Approve a suggested brand or shop: a new Unofficial page, with its handle
-- reserved (the handle guard refuses taken ones), its English factual line
-- marked as needing translations, and for shops how people visit. Tells the
-- suggester it's live. Errors: handle_taken (23505), invalid_*, not_found.
create or replace function public.approve_page_suggestion(
  suggestion uuid,
  role public.page_role,
  name text,
  handle text,
  line text,
  city text default null,
  country text default null,
  website text default null,
  location_type public.shop_location_type default null,
  address text default null,
  latitude double precision default null,
  longitude double precision default null,
  metro uuid default null
)
returns uuid
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  me uuid := private.require_owner();
  s page_suggestions%rowtype;
  clean_name text := nullif(btrim(coalesce(name, '')), '');
  clean_handle text := nullif(btrim(ltrim(coalesce(handle, ''), '@')), '');
  clean_line text := nullif(btrim(coalesce(line, '')), '');
  clean_country text := upper(nullif(btrim(coalesce(country, '')), ''));
  is_shop boolean := role = 'shop';
  new_id uuid;
begin
  select * into s from page_suggestions where id = suggestion for update;
  if not found or s.status <> 'open' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if clean_name is null or char_length(clean_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if clean_handle is null or clean_handle !~ '^[a-zA-Z0-9_.]{2,30}$' or clean_handle ~* 'official' then
    raise exception 'invalid_handle' using errcode = '22023';
  end if;
  if clean_line is null or char_length(clean_line) > 300 then
    raise exception 'invalid_line' using errcode = '22023';
  end if;
  if clean_country is not null and clean_country !~ '^[A-Z]{2}$' then
    raise exception 'invalid_country' using errcode = '22023';
  end if;
  if (latitude is null) <> (longitude is null)
     or latitude is not null and (latitude not between -90 and 90 or longitude not between -180 and 180) then
    raise exception 'invalid_pin' using errcode = '22023';
  end if;
  if metro is not null and not exists (select 1 from metro_areas m where m.id = metro) then
    raise exception 'invalid_metro' using errcode = '22023';
  end if;
  -- Handles share one namespace with usernames.
  if exists (select 1 from pages p where p.handle operator(extensions.=) clean_handle::citext)
     or exists (select 1 from profiles u where u.username operator(extensions.=) clean_handle::citext) then
    raise exception 'handle_taken' using errcode = '23505';
  end if;

  insert into pages (handle, display_name, roles, state, city, country, metro_area_id, timezone, website,
                     location_type, address, location, show_pin, needs_translations_at, created_by)
  values (
    clean_handle, clean_name, array[role], 'unofficial',
    nullif(btrim(coalesce(city, '')), ''), clean_country, metro,
    (select m.timezone from metro_areas m where m.id = metro),
    nullif(btrim(coalesce(website, '')), ''),
    case when is_shop then coalesce(location_type, 'storefront') end,
    case when is_shop then nullif(btrim(coalesce(address, '')), '') end,
    case when is_shop and latitude is not null
         then st_setsrid(st_makepoint(longitude, latitude), 4326)::geography end,
    -- An unofficial by-appointment shop may be someone's home: no pin.
    not is_shop or coalesce(location_type, 'storefront') <> 'by_appointment',
    now(), me
  )
  returning id into new_id;

  insert into page_descriptions (page_id, locale, body, updated_by) values (new_id, 'en', clean_line, me);

  update page_suggestions
     set status = 'accepted', outcome = 'created', page_id = new_id, reviewed_by = me, reviewed_at = now()
   where id = s.id;

  perform private.notify_page(s.suggester_id, 'suggestion_live', new_id);

  insert into moderation_actions (actor_id, action, target_user_id, page_id, subject_id)
  values (me, 'page_suggestion_approved', s.suggester_id, new_id, s.id);
  return new_id;
end $$;

-- Merge a suggestion into an existing page, or decline it. Neither tells the
-- suggester.
create or replace function public.review_page_suggestion(suggestion uuid, action text, page uuid default null)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := private.require_owner();
  s page_suggestions%rowtype;
begin
  select * into s from page_suggestions where id = suggestion for update;
  if not found or s.status <> 'open' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if action = 'merge' then
    if page is null or not exists (select 1 from pages p where p.id = page) then
      raise exception 'invalid_page' using errcode = '22023';
    end if;
    update page_suggestions
       set status = 'accepted', outcome = 'merged', page_id = page, reviewed_by = me, reviewed_at = now()
     where id = s.id;
  elsif action = 'decline' then
    update page_suggestions set status = 'rejected', reviewed_by = me, reviewed_at = now() where id = s.id;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  insert into moderation_actions (actor_id, action, target_user_id, page_id, subject_id)
  values (me, case when action = 'merge' then 'page_suggestion_merged' else 'page_suggestion_declined' end,
          s.suggester_id, page, s.id);
end $$;

-- Once the Spanish, Danish and German lines are in, the flag comes off.
create or replace function public.set_page_translated(page uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  perform private.require_owner();
  update pages set needs_translations_at = null where id = page;
end $$;

/* 5. Product suggestions -------------------------------------------------------------- */

create or replace function public.product_suggestion_review_detail(suggestion uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  s product_suggestions%rowtype;
begin
  perform private.require_owner();
  select * into s from product_suggestions where id = suggestion;
  if not found or s.status <> 'open' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', s.id,
    'kind', s.kind::text,
    'value', s.value,
    'part_type', s.part_type,
    'note', s.note,
    'created_at', s.created_at,
    'suggester', (select u.username::text from profiles u where u.id = s.suggester_id),
    'page', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'handle', p.handle::text,
                                       'state', p.state::text)
               from pages p where p.id = s.page_id),
    'product', (
      select jsonb_build_object(
        'id', pr.id, 'name', pr.name, 'part_type', pr.part_type, 'family', pr.family,
        'entry_type', pr.entry_type::text, 'edition', pr.edition, 'pro_rider', pr.pro_rider,
        'first_year', pr.first_year, 'status', pr.status::text, 'includes_frame', pr.includes_frame,
        'brand', (select b.display_name from pages b where b.id = pr.page_id),
        'stock_parts', coalesce((
          select jsonb_agg(jsonb_build_object('part_type', sp.part_type, 'name', part.name,
                                              'brand', (select b.display_name from pages b where b.id = part.page_id))
                           order by pt.sort)
            from product_stock_parts sp
            join products part on part.id = sp.part_id
            join part_types pt on pt.key = sp.part_type
           where sp.product_id = pr.id
        ), '[]'::jsonb)
      )
        from products pr where pr.id = s.product_id
    )
  );
end $$;

-- Approve (with an edited value) Missing model, Wrong name, Wrong year or No
-- longer made; Mark done for Stock parts and Something else once they're
-- changed by hand; or Decline. Approving and Mark done tell the suggester
-- it's live; Decline tells nobody.
create or replace function public.review_product_suggestion(
  suggestion uuid,
  action text,
  value text default null,
  part_type text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  me uuid := private.require_owner();
  s product_suggestions%rowtype;
  v text := nullif(btrim(coalesce(value, '')), '');
  pt text;
  product uuid;
  shown text;
  brand_disciplines discipline[];
  part_disciplines discipline[];
begin
  select * into s from product_suggestions where id = suggestion for update;
  if not found or s.status <> 'open' then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  product := s.product_id;

  if action = 'approve' then
    if s.kind not in ('missing_model', 'wrong_name', 'wrong_year', 'no_longer_made') then
      raise exception 'mark_done_instead' using errcode = '22023';
    end if;
    if s.kind = 'missing_model' then
      v := coalesce(v, s.value);
      pt := coalesce(part_type, s.part_type);
      if v is null or char_length(v) > 80 then
        raise exception 'invalid_value' using errcode = '22023';
      end if;
      if pt is null or not exists (select 1 from part_types t where t.key = pt) then
        raise exception 'part_type_required' using errcode = '22023';
      end if;
      -- The brand's own disciplines that this part type is for; else all of
      -- the part type's.
      select t.disciplines into part_disciplines from part_types t where t.key = pt;
      select coalesce(array_agg(distinct d), '{}') into brand_disciplines
        from products p, unnest(p.disciplines) d
       where p.page_id = s.page_id and d = any (part_disciplines);
      insert into products (page_id, part_type, name, entry_type, disciplines, status, sort)
      values (s.page_id, pt, v, 'model',
              case when cardinality(brand_disciplines) > 0 then brand_disciplines else part_disciplines end,
              'unknown',
              coalesce((select max(p.sort) + 1 from products p where p.page_id = s.page_id), 0))
      returning id into product;
    elsif s.kind = 'wrong_name' then
      v := coalesce(v, s.value);
      if v is null or char_length(v) > 80 then
        raise exception 'invalid_value' using errcode = '22023';
      end if;
      update products set name = v, updated_at = now() where id = s.product_id;
    elsif s.kind = 'wrong_year' then
      v := coalesce(v, s.value);
      if v is null or v !~ '^(c\. )?[12][0-9]{3}$' then
        raise exception 'invalid_value' using errcode = '22023';
      end if;
      update products set first_year = v, updated_at = now() where id = s.product_id;
    else
      update products set status = 'discontinued', updated_at = now() where id = s.product_id;
    end if;
    if product is null or not exists (select 1 from products p where p.id = product) then
      raise exception 'product_gone' using errcode = '22023';
    end if;
    update product_suggestions
       set status = 'accepted', reviewed_by = me, reviewed_at = now(), product_id = product
     where id = s.id;
  elsif action = 'done' then
    update product_suggestions set status = 'accepted', reviewed_by = me, reviewed_at = now() where id = s.id;
  elsif action = 'decline' then
    update product_suggestions set status = 'rejected', reviewed_by = me, reviewed_at = now() where id = s.id;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if action in ('approve', 'done') then
    select p.name into shown from products p where p.id = product;
    perform private.notify_page(s.suggester_id, 'suggestion_live', s.page_id, null, coalesce(shown, s.value));
  end if;

  insert into moderation_actions (actor_id, action, target_user_id, page_id, subject_id)
  values (me, case action when 'approve' then 'product_suggestion_approved'
                          when 'done' then 'product_suggestion_done'
                          else 'product_suggestion_declined' end,
          s.suggester_id, s.page_id, s.id);
  return product;
end $$;

-- A brand's catalog in the repo's CSV format (supabase/seed/products), so a
-- fix made here can be copied back before the next import undoes it.
create or replace function public.catalog_export(page uuid)
returns table (
  product_id uuid, part_type text, model text, family text, pro_rider text, edition text, entry_type text,
  partner text, disciplines text, first_year text, status text, includes_frame text, stock_parts text,
  notes text, sources text
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform private.require_owner();
  return query
    select p.id, replace(p.part_type, '_', ' '), p.name, p.family, p.pro_rider, p.edition,
           replace(p.entry_type::text, '_', ' '),
           (select pp.display_name from pages pp where pp.id = p.partner_page_id),
           array_to_string(p.disciplines::text[], '; '),
           p.first_year, p.status::text,
           case when p.includes_frame then 'yes' end,
           (select string_agg(replace(sp.part_type, '_', ' ') || ': ' || b.display_name || ' / ' || part.name, '; '
                              order by t.sort)
              from product_stock_parts sp
              join products part on part.id = sp.part_id
              join pages b on b.id = part.page_id
              join part_types t on t.key = sp.part_type
             where sp.product_id = p.id),
           n.notes, n.sources
      from products p
      left join product_notes n on n.product_id = p.id
     where p.page_id = page
     order by p.sort, p.created_at;
end $$;

/* 6. Reports about a page ---------------------------------------------------------------- */

create or replace function public.page_report_review_detail(page uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform private.require_owner();
  if not exists (select 1 from page_reports r where r.page_id = page and r.status = 'open') then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'page', private.page_summary(page),
    'reports', (
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'reason', r.reason::text, 'details', r.details, 'created_at', r.created_at,
               'reporter', u.username::text
             ) order by r.created_at desc)
        from page_reports r left join profiles u on u.id = r.reporter_id
       where r.page_id = page and r.status = 'open'
    ),
    'earlier', (select count(*) from page_reports r where r.page_id = page and r.status <> 'open'),
    'open_claims', (select count(*) from page_claims c where c.page_id = page and c.status = 'pending')
  );
end $$;

-- Close every open report about a page: dismissed (nothing to do) or
-- actioned (Rachel dealt with it, in a claim, a fix or by hand). Reporters
-- aren't told either way, like dismissing post reports.
create or replace function public.resolve_page_reports(page uuid, actioned boolean)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := private.require_owner();
  ids uuid[];
begin
  with done as (
    update page_reports
       set status = case when actioned then 'actioned'::report_status else 'dismissed'::report_status end,
           resolved_by = me, resolved_at = now()
     where page_id = page and status = 'open'
    returning id
  )
  select array_agg(id) into ids from done;
  if ids is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into moderation_actions (actor_id, action, page_id, report_ids)
  values (me, case when actioned then 'page_reports_actioned' else 'page_reports_dismissed' end, page, ids);
end $$;

/* 7. Page blocks ----------------------------------------------------------------------- */

-- Every block a page made, for Rachel. flagged: the page has more than 5
-- blocks (not lifted) from the last 7 days.
create or replace function public.admin_page_blocks(lifted boolean default false, page uuid default null)
returns table (
  id uuid,
  page_id uuid,
  page_name text,
  page_handle text,
  page_roles text[],
  page_city text,
  page_country text,
  skater text,
  blocked_by text,
  blocked_by_role text,
  created_at timestamptz,
  lifted_at timestamptz,
  lifted_by text,
  week_count integer,
  flagged boolean
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform private.require_owner();
  return query
    with week as (
      select b.page_id, count(*)::integer as n
        from page_blocks b
       where b.lifted_at is null and b.created_at > now() - interval '7 days'
       group by b.page_id
    )
    select b.id, p.id, p.display_name, p.handle::text, p.roles::text[], p.city, p.country::text,
           s.username::text, by_u.username::text, m.role::text,
           b.created_at, b.lifted_at, l.username::text,
           coalesce(w.n, 0), coalesce(w.n, 0) > 5
      from page_blocks b
      join pages p on p.id = b.page_id
      left join profiles s on s.id = b.user_id
      left join profiles by_u on by_u.id = b.blocked_by
      left join page_members m on m.page_id = b.page_id and m.user_id = b.blocked_by
      left join profiles l on l.id = b.lifted_by
      left join week w on w.page_id = b.page_id
     where (case when lifted then b.lifted_at is not null else b.lifted_at is null end)
       and (admin_page_blocks.page is null or b.page_id = admin_page_blocks.page)
     order by (coalesce(w.n, 0) > 5 and b.lifted_at is null) desc,
              case when coalesce(w.n, 0) > 5 then p.display_name end,
              b.created_at desc
     limit 500;
end $$;

-- One block: who, when, and what the skater said to or about the page in the
-- last 30 days (comments on its posts arrive with page posts in PR 8; until
-- then, captions and comments that @mention the page).
create or replace function public.page_block_detail(block uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
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
    ), '[]'::jsonb)
  );
end $$;

-- Lift a block. Nobody is told; the skater can comment on, follow and
-- mention the page again.
create or replace function public.lift_page_block(block uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := private.require_owner();
  b page_blocks%rowtype;
begin
  update page_blocks set lifted_at = now(), lifted_by = me
   where id = block and lifted_at is null
  returning * into b;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into moderation_actions (actor_id, action, target_user_id, page_id, subject_id)
  values (me, 'page_block_lifted', b.user_id, b.page_id, b.id);
end $$;

-- The nav item's badge: how many pages are flagged.
create or replace function public.flagged_page_count()
returns integer
language sql stable security definer
set search_path = public
as $$
  select case when private.is_owner() then (
    select count(*)::integer from (
      select b.page_id from page_blocks b
       where b.lifted_at is null and b.created_at > now() - interval '7 days'
       group by b.page_id having count(*) > 5
    ) f
  ) else 0 end;
$$;

/* 8. Shop fixes ------------------------------------------------------------------------- */

-- Suggest a fix on an unofficial shop. Like a park fix, nothing changes until
-- someone checks it. Up to 10 a day; a repeat of an open fix for the same
-- thing is quietly accepted. Suspended members can't (it's a contribution).
create or replace function public.file_page_fix(page uuid, field public.page_fix_field, value text default null, note text default null)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v text := nullif(btrim(coalesce(value, '')), '');
  n text := nullif(btrim(coalesce(note, '')), '');
begin
  if not private.is_active_member() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from pages p where p.id = page and 'shop' = any (p.roles) and p.state = 'unofficial') then
    raise exception 'not_fixable' using errcode = '22023';
  end if;
  if field = 'closed' then
    v := null;
  elsif v is null then
    raise exception 'value_required' using errcode = '22023';
  elsif field = 'location_type' and v not in ('storefront', 'by_appointment', 'online_only') then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  if v is not null and char_length(v) > 300 or n is not null and char_length(n) > 300 then
    raise exception 'too_long' using errcode = '22023';
  end if;
  if exists (
    select 1 from page_fix_reports r
     where r.reporter_id = me and r.page_id = page and r.field = file_page_fix.field and r.status = 'open'
  ) then
    return;
  end if;
  if (select count(*) from page_fix_reports r
       where r.reporter_id = me and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_fixes' using errcode = '54000';
  end if;
  insert into page_fix_reports (reporter_id, page_id, field, value, note) values (me, page, field, v, n);
end $$;

create or replace function public.page_fix_review_detail(report uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  r page_fix_reports%rowtype;
  p pages%rowtype;
begin
  select * into r from page_fix_reports where id = report;
  if not found or r.status <> 'open' or auth.uid() is null
     or not private.can_review_page_fix(r.page_id, r.escalated_at is not null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into p from pages where id = r.page_id;
  return jsonb_build_object(
    'id', r.id,
    'field', r.field::text,
    'value', r.value,
    'note', r.note,
    'created_at', r.created_at,
    'escalated', r.escalated_at is not null,
    'reporter', (select u.username::text from profiles u where u.id = r.reporter_id),
    'can_escalate', not private.is_owner(),
    'page', private.page_summary(r.page_id),
    'metro', (select m.name from metro_areas m where m.id = p.metro_area_id),
    'current', case r.field
      when 'location_type' then to_jsonb(p.location_type::text)
      when 'location' then jsonb_build_object('address', p.address, 'latitude', p.latitude, 'longitude', p.longitude)
      when 'website' then to_jsonb(p.website)
      when 'closed' then to_jsonb(p.state::text)
      when 'brands_carried' then coalesce((
        select jsonb_agg(b.display_name order by c.position, b.display_name)
          from page_brands_carried c join pages b on b.id = c.brand_id where c.shop_id = p.id
      ), '[]'::jsonb)
      when 'hours' then coalesce((
        select jsonb_agg(jsonb_build_object('days', h.days, 'start', h.start_time, 'end', h.end_time,
                                            'start_anchor', h.start_anchor::text, 'end_anchor', h.end_anchor::text,
                                            'note', h.note)
                         order by h.days[1], h.start_time)
          from page_hours h where h.page_id = p.id
      ), '[]'::jsonb)
      else null end
  );
end $$;

-- approve: Storefront or not, Website and Closed for good are applied here
-- (with an edited value). done: Hours, Address or pin, Brands carried and
-- Something else, once changed by hand. Both tell the reporter it's live.
-- decline tells nobody. escalate (city admins): sends it on to Rachel.
create or replace function public.review_page_fix(report uuid, action text, value text default null)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  r page_fix_reports%rowtype;
  v text := nullif(btrim(coalesce(value, '')), '');
begin
  select * into r from page_fix_reports where id = report for update;
  if not found or me is null or not private.can_review_page_fix(r.page_id, r.escalated_at is not null) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'open' then
    raise exception 'already_reviewed' using errcode = '22023';
  end if;

  if action = 'approve' then
    if r.field = 'location_type' then
      v := coalesce(v, r.value);
      if v not in ('storefront', 'by_appointment', 'online_only') then
        raise exception 'invalid_value' using errcode = '22023';
      end if;
      update pages
         set location_type = v::shop_location_type,
             show_pin = v = 'storefront',
             updated_at = now()
       where id = r.page_id;
    elsif r.field = 'website' then
      v := coalesce(v, r.value);
      if v is null or char_length(v) not between 4 and 200 or v !~ '\.' then
        raise exception 'invalid_value' using errcode = '22023';
      end if;
      update pages set website = v, updated_at = now() where id = r.page_id;
    elsif r.field = 'closed' then
      update pages
         set state = 'closed', closed_at = now(),
             temp_closed_at = null, temp_closed_until = null, temp_closed_note = null,
             updated_at = now()
       where id = r.page_id;
    else
      raise exception 'mark_done_instead' using errcode = '22023';
    end if;
  elsif action = 'escalate' then
    if private.is_owner() then
      raise exception 'invalid_action' using errcode = '22023';
    end if;
    update page_fix_reports set escalated_at = now() where id = r.id;
    insert into moderation_actions (actor_id, action, target_user_id, page_id, subject_id)
    values (me, 'page_fix_escalated', r.reporter_id, r.page_id, r.id);
    return;
  elsif action not in ('done', 'decline') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  update page_fix_reports
     set status = case when action = 'decline' then 'rejected'::review_status else 'accepted'::review_status end,
         reviewed_by = me, reviewed_at = now()
   where id = r.id;

  if action in ('approve', 'done') then
    perform private.notify_page(r.reporter_id, 'suggestion_live', r.page_id, me);
  end if;

  insert into moderation_actions (actor_id, action, target_user_id, page_id, subject_id)
  values (me, case action when 'approve' then 'page_fix_approved' when 'done' then 'page_fix_done'
                          else 'page_fix_declined' end,
          r.reporter_id, r.page_id, r.id);
end $$;

/* 9. The queue --------------------------------------------------------------------------- */

-- As before, with new kinds: claim, page_suggestion, product_suggestion and
-- page_report for Rachel, and shop_fix for the shop's city admin (Rachel as
-- backup; "Sent to you" once escalated). The new columns describe the page.
--   claim: target = proof, reason = their role, label = email or posted code,
--     report_count = claims open on the page, flag = email domain matches.
--   page_suggestion: target = brand or shop, label = the name, reason = what
--     they wrote, page = the closest existing page, flag = there is one.
--   product_suggestion: target = kind, label = the product (or the missing
--     model's name), reason = the suggested value, page = the brand,
--     flag = it can be applied from the queue.
--   page_report: one row per page, like report groups.
--   shop_fix: target = field, label = the suggested value, flag = escalated.
drop function if exists public.moderation_queue(uuid);

create function public.moderation_queue(metro uuid default null)
returns table (
  kind text,
  id uuid,
  target text,
  report_count integer,
  reason text,
  username text,
  label text,
  park_id uuid,
  park_name text,
  park_slug text,
  metro_area_id uuid,
  metro_name text,
  state text,
  waiting_since timestamptz,
  latest_at timestamptz,
  page_id uuid,
  page_name text,
  page_handle text,
  page_roles text[],
  page_place text,
  flag boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  owner boolean := private.is_owner();
begin
  if me is null or (private.role_rank(me) > 3) then
    return;
  end if;

  return query
  with mine as (
    select r.*,
           case when r.post_id is not null then 'post'
                when r.comment_id is not null then 'comment'
                when r.event_id is not null then 'meetup'
                when r.event_comment_id is not null then 'meetup_comment'
                else 'person' end as tkind,
           coalesce(r.post_id, r.comment_id, r.event_id, r.event_comment_id, r.reported_user_id) as tid,
           coalesce(r.post_id, (select c.post_id from comments c where c.id = r.comment_id)) as on_post,
           coalesce(r.event_id, (select c.event_id from event_comments c where c.id = r.event_comment_id)) as on_event
      from reports r
     where r.status in ('open', 'escalated')
       and (r.status = 'open' or owner)
       and private.can_review_report(r)
  ),
  groups as (
    select m.tkind, m.tid, min(m.on_post::text)::uuid as on_post, min(m.on_event::text)::uuid as on_event,
           count(distinct m.reporter_id)::integer as n,
           mode() within group (order by m.reason) as top_reason,
           min(m.created_at) as first_at, max(m.created_at) as last_at,
           bool_or(m.status = 'escalated') as escalated,
           bool_or(m.reason in ('harassment', 'involves_minor')) as owner_only,
           min(m.reported_user_id::text)::uuid as person
      from mine m
     group by m.tkind, m.tid
  ),
  report_rows as (
    select 'report'::text as k, g.tid, g.tkind, g.n, g.top_reason::text,
           u.username::text as uname,
           case when ev.id is not null then coalesce(ev.title, ev.note)::text end as lbl,
           pk.id as pid, pk.display_name::text as pname, pk.slug::text as pslug,
           coalesce(po.metro_area_id, pk.metro_area_id, u.home_metro_area_id) as mid,
           case
             when owner and (g.escalated or g.owner_only or g.tkind = 'person') then 'sent_to_you'
             when po.status = 'auto_hidden' and g.tkind = 'post' then 'auto_hidden'
             when po.status = 'hidden' and g.tkind = 'post' then 'hidden'
             when ev.hidden_at is not null and g.tkind = 'meetup' then 'hidden'
             else 'open'
           end as st,
           g.first_at, g.last_at,
           null::uuid as pgid, null::text as pgname, null::text as pghandle, null::text[] as pgroles,
           null::text as pgplace, null::boolean as flg
      from groups g
      left join posts po on po.id = g.on_post
      left join events ev on ev.id = g.on_event
      left join parks pk on pk.id = coalesce(po.park_id, ev.park_id)
      left join profiles u on u.id = g.person
  ),
  info_rows as (
    select 'park_info'::text, r.id, r.field::text, 1, null::text,
           u.username::text, ob.name::text,
           pk.id, pk.display_name::text, pk.slug::text, pk.metro_area_id,
           'open'::text, r.created_at, r.created_at,
           null::uuid, null::text, null::text, null::text[], null::text, null::boolean
      from park_info_reports r
      join parks pk on pk.id = r.park_id
      left join profiles u on u.id = r.reporter_id
      left join obstacles ob on ob.id = r.obstacle_id
     where r.status = 'open' and private.can_contribute_park(r.park_id)
  ),
  obstacle_rows as (
    select 'obstacle'::text, o.id, o.general_type::text, 1, null::text,
           u.username::text, o.name::text,
           pk.id, pk.display_name::text, pk.slug::text, pk.metro_area_id,
           'open'::text, o.created_at, o.created_at,
           null::uuid, null::text, null::text, null::text[], null::text, null::boolean
      from obstacles o
      join parks pk on pk.id = o.park_id
      left join profiles u on u.id = o.suggested_by
     where o.status = 'pending' and private.can_contribute_park(o.park_id)
  ),
  claim_rows as (
    select 'claim'::text, c.id, c.proof::text,
           (select count(*)::integer from page_claims o where o.page_id = c.page_id and o.status = 'pending'),
           c.role_title, u.username::text, coalesce(c.email::text, c.posted_code),
           null::uuid, null::text, null::text, p.metro_area_id,
           'open'::text, c.sent_at, c.sent_at,
           p.id, p.display_name, p.handle::text, p.roles::text[], coalesce(p.city, p.country::text),
           c.email_domain_matches
      from page_claims c
      join pages p on p.id = c.page_id
      left join profiles u on u.id = c.user_id
     where owner and c.status = 'pending'
  ),
  suggestion_rows as (
    select 'page_suggestion'::text, s.id, s.role::text, 1, s.what,
           u.username::text, s.name,
           null::uuid, null::text, null::text, null::uuid,
           'open'::text, s.created_at, s.created_at,
           m.id, m.display_name, m.handle, m.roles, coalesce(m.city, m.country), m.id is not null
      from page_suggestions s
      left join profiles u on u.id = s.suggester_id
      left join lateral (select * from private.page_matches(s.name, 1)) m on true
     where owner and s.status = 'open'
  ),
  product_rows as (
    select 'product_suggestion'::text, s.id, s.kind::text, 1, s.value,
           u.username::text, coalesce(pr.name, s.value),
           null::uuid, null::text, null::text, null::uuid,
           'open'::text, s.created_at, s.created_at,
           p.id, p.display_name, p.handle::text, p.roles::text[], coalesce(p.city, p.country::text),
           s.kind in ('missing_model', 'wrong_name', 'wrong_year', 'no_longer_made')
      from product_suggestions s
      join pages p on p.id = s.page_id
      left join products pr on pr.id = s.product_id
      left join profiles u on u.id = s.suggester_id
     where owner and s.status = 'open'
  ),
  page_report_rows as (
    select 'page_report'::text, p.id, 'page'::text,
           count(distinct r.reporter_id)::integer,
           (mode() within group (order by r.reason))::text,
           null::text, null::text,
           null::uuid, null::text, null::text, p.metro_area_id,
           'sent_to_you'::text, min(r.created_at), max(r.created_at),
           p.id, p.display_name, p.handle::text, p.roles::text[], coalesce(p.city, p.country::text), null::boolean
      from page_reports r
      join pages p on p.id = r.page_id
     where owner and r.status = 'open'
     group by p.id
  ),
  fix_rows as (
    select 'shop_fix'::text, r.id, r.field::text, 1, r.note,
           u.username::text, r.value,
           null::uuid, null::text, null::text, p.metro_area_id,
           case when r.escalated_at is not null and owner then 'sent_to_you' else 'open' end,
           r.created_at, coalesce(r.escalated_at, r.created_at),
           p.id, p.display_name, p.handle::text, p.roles::text[], coalesce(p.city, p.country::text),
           r.escalated_at is not null
      from page_fix_reports r
      join pages p on p.id = r.page_id
      left join profiles u on u.id = r.reporter_id
     where r.status = 'open' and private.can_review_page_fix(r.page_id, r.escalated_at is not null)
  ),
  everything as (
    select * from report_rows
    union all select * from info_rows
    union all select * from obstacle_rows
    union all select * from claim_rows
    union all select * from suggestion_rows
    union all select * from product_rows
    union all select * from page_report_rows
    union all select * from fix_rows
  )
  select e.k, e.tid, e.tkind, e.n, e.top_reason, e.uname, e.lbl,
         e.pid, e.pname, e.pslug, e.mid, ma.name::text, e.st, e.first_at, e.last_at,
         e.pgid, e.pgname, e.pghandle, e.pgroles, e.pgplace, e.flg
    from everything e
    left join metro_areas ma on ma.id = e.mid
   where metro is null or e.mid = metro
   order by e.last_at desc
   limit 500;
end;
$$;

/* 10. Grants ---------------------------------------------------------------------------- */

do $$
declare f text;
begin
  foreach f in array array[
    'public.moderation_queue(uuid)',
    'public.set_claim_checked(uuid, boolean)',
    'public.claim_review_detail(uuid)',
    'public.claimable_pages(text, integer)',
    'public.page_suggestion_review_detail(uuid)',
    'public.approve_page_suggestion(uuid, public.page_role, text, text, text, text, text, text, public.shop_location_type, text, double precision, double precision, uuid)',
    'public.review_page_suggestion(uuid, text, uuid)',
    'public.set_page_translated(uuid)',
    'public.product_suggestion_review_detail(uuid)',
    'public.review_product_suggestion(uuid, text, text, text)',
    'public.catalog_export(uuid)',
    'public.page_report_review_detail(uuid)',
    'public.resolve_page_reports(uuid, boolean)',
    'public.admin_page_blocks(boolean, uuid)',
    'public.page_block_detail(uuid)',
    'public.lift_page_block(uuid)',
    'public.flagged_page_count()',
    'public.file_page_fix(uuid, public.page_fix_field, text, text)',
    'public.page_fix_review_detail(uuid)',
    'public.review_page_fix(uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
declare
  r text := '';
  ok int := 0; total int := 0;
  bones uuid := (select id from public.pages where handle = 'bonesbearings');
  them uuid := (select id from public.pages where handle = 'themskates');
  eightset uuid := (select id from public.pages where handle = '8set_store');
  bos uuid := (select id from public.pages where handle = 'bos_bootsonwheels');
  bos_metro uuid := (select metro_area_id from public.pages where handle = 'bos_bootsonwheels');
  p909 uuid := (select id from public.products where page_id = (select id from public.pages where handle = 'themskates')
                  and name = '909' and entry_type = 'model' and part_type = 'boot');
  m uuid := gen_random_uuid();    -- an ordinary member: suggests, reports, fixes
  x uuid := gen_random_uuid();    -- claims Bones with a posted code
  y uuid := gen_random_uuid();    -- also claims Bones
  o uuid := gen_random_uuid();    -- a throwaway owner (Rachel's role)
  ca uuid := gen_random_uuid();   -- city admin for Bo's metro area
  b1 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  u uuid;
  claim_x uuid; claim_y uuid;
  sugg uuid; sugg2 uuid; sugg3 uuid; newpage uuid;
  ps uuid; ps2 uuid; ps3 uuid; prod uuid;
  fix1 uuid; fix2 uuid; fix3 uuid;
  blk uuid;
  n int; n2 int; j jsonb; flag boolean; txt text;
begin
  foreach u in array array[m, x, y, o, ca, b1, b2] loop
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'admin-brands-check-' || u || '@example.com', now(), now(), '{}'::jsonb);
    insert into public.profiles (id) values (u) on conflict (id) do nothing;
    update public.profiles set onboarded_at = now(), age_confirmed_at = now(), disciplines = '{inline}',
      home_metro_area_id = bos_metro, username = 'abcheck' || left(replace(u::text, '-', ''), 8) where id = u;
  end loop;
  insert into public.role_assignments (user_id, role, accepted_at) values (o, 'owner', now());
  insert into public.role_assignments (user_id, role, metro_area_id, accepted_at) values (ca, 'city_admin', bos_metro, now());
  insert into public.page_follows (user_id, page_id) values (m, eightset);

  /* Members see none of it ------------------------------------------------------------ */
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into n from public.moderation_queue();
  if n = 0 then ok := ok + 1; else r := r || 'FAIL member queue has ' || n || '; '; end if;

  /* Claims ----------------------------------------------------------------------------- */
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  select c.claim_id into claim_x from public.start_page_claim(bones, 'Owner', 'posted_code') c;
  perform public.send_page_claim(claim_x, null, 'https://instagram.com/p/check1');
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  select c.claim_id into claim_y from public.start_page_claim(bones, 'Team manager', 'posted_code') c;
  perform public.send_page_claim(claim_y, null, 'https://instagram.com/p/check2');

  total := total + 1;
  begin
    perform public.claim_review_detail(claim_x);
    r := r || 'FAIL member read a claim; ';
  exception when no_data_found then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.set_claim_checked(claim_x, true);
    r := r || 'FAIL member checked a claim; ';
  exception when no_data_found then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.decide_page_claim(claim_x, true);
    r := r || 'FAIL member decided a claim; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);

  total := total + 1;
  select count(*), max(q.report_count) into n, n2 from public.moderation_queue() q where q.kind = 'claim' and q.page_id = bones;
  if n = 2 and n2 = 2 then ok := ok + 1; else r := r || 'FAIL owner claim rows ' || n || '/' || n2 || '; '; end if;

  total := total + 1;
  j := public.claim_review_detail(claim_x);
  if jsonb_array_length(j -> 'others') = 1 and j #>> '{page,handle}' = 'bonesbearings' and j ->> 'proof' = 'posted_code'
  then ok := ok + 1; else r := r || 'FAIL claim detail; '; end if;

  total := total + 1;
  begin
    perform public.decide_page_claim(claim_x, true);
    r := r || 'FAIL approved without Checked it; ';
  exception when invalid_parameter_value then
    if sqlerrm = 'not_checked' then ok := ok + 1; else r := r || 'FAIL unchecked gave ' || sqlerrm || '; '; end if;
  end;

  perform public.set_claim_checked(claim_x, true);
  perform public.decide_page_claim(claim_x, true);

  execute 'reset role';
  total := total + 1;
  if (select state from public.pages where id = bones) = 'managed'
     and (select status from public.page_claims where id = claim_y) = 'declined'
     and exists (select 1 from public.moderation_actions a where a.subject_id = claim_x and a.action = 'claim_approved' and a.actor_id = o)
  then ok := ok + 1; else r := r || 'FAIL approve effects; '; end if;
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into n from public.claimable_pages('bones');
  select count(*) into n2 from public.claimable_pages('them');
  if n = 0 and n2 >= 1 then ok := ok + 1; else r := r || 'FAIL claimable ' || n || '/' || n2 || '; '; end if;

  -- A claim invite that brings a logo tells followers when it's accepted.
  execute 'reset role';
  perform private.make_page_owner(eightset, x, o, eightset::text || '/logo.png');
  total := total + 1;
  if exists (select 1 from public.notifications where recipient_id = m and kind = 'page_claimed' and page_id = eightset)
     and (select followers_told_at from public.pages where id = eightset) is not null
  then ok := ok + 1; else r := r || 'FAIL claim invite logo did not tell followers; '; end if;
  execute 'set local role authenticated';

  /* Suggested brands ---------------------------------------------------------------- */
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  sugg := public.suggest_page('brand', 'them skates', 'Frames and skates');
  sugg2 := public.suggest_page('shop', 'Rollbox Check', 'Inline and quad shop', 'rollbox.example');
  sugg3 := public.suggest_page('brand', 'Another Check Brand');

  total := total + 1;
  begin
    perform public.approve_page_suggestion(sugg2, 'shop', 'Rollbox', 'rollboxcheck', 'A line.');
    r := r || 'FAIL member approved a suggestion; ';
  exception when no_data_found then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);

  total := total + 1;
  select q.flag, q.page_handle into flag, txt from public.moderation_queue() q where q.kind = 'page_suggestion' and q.id = sugg;
  if flag and txt = 'themskates' then ok := ok + 1; else r := r || 'FAIL suggestion match ' || coalesce(txt, 'none') || '; '; end if;

  total := total + 1;
  j := public.page_suggestion_review_detail(sugg2);
  if j ->> 'suggested_handle' = 'rollboxcheck' and jsonb_array_length(j -> 'matches') = 0
  then ok := ok + 1; else r := r || 'FAIL suggestion detail ' || coalesce(j ->> 'suggested_handle', 'null') || '; '; end if;

  perform public.review_page_suggestion(sugg, 'merge', them);

  newpage := public.approve_page_suggestion(sugg2, 'shop', 'Rollbox', 'rollboxcheck', 'Inline and quad shop in Malmö.',
                                            'Malmö', 'se', 'rollbox.example', 'by_appointment', 'Somewhere 1',
                                            55.6, 13.0, null);

  total := total + 1;
  begin
    perform public.approve_page_suggestion(sugg3, 'brand', 'Another', 'themskates', 'A line.');
    r := r || 'FAIL took a page handle; ';
  exception when unique_violation then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.approve_page_suggestion(sugg3, 'brand', 'Another', 'anotherofficial', 'A line.');
    r := r || 'FAIL handle with official; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  execute 'reset role';
  total := total + 1;
  if (select state from public.pages where id = newpage) = 'unofficial'
     and (select country from public.pages where id = newpage) = 'SE'
     and not (select show_pin from public.pages where id = newpage)
     and (select needs_translations_at from public.pages where id = newpage) is not null
     and exists (select 1 from public.page_descriptions d where d.page_id = newpage and d.locale = 'en')
     and (select outcome from public.page_suggestions where id = sugg2) = 'created'
     and (select outcome from public.page_suggestions where id = sugg) = 'merged'
  then ok := ok + 1; else r := r || 'FAIL approved page; '; end if;

  total := total + 1;
  select count(*) into n from public.notifications where recipient_id = m and kind = 'suggestion_live';
  if n = 1 then ok := ok + 1; else r := r || 'FAIL suggestion notices ' || n || ' (merge should tell nobody); '; end if;
  execute 'set local role authenticated';

  /* Product suggestions ------------------------------------------------------------- */
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  ps := public.suggest_product(them, 'wrong_year', p909, '2017', null, 'Launch post');
  ps2 := public.suggest_product(them, 'missing_model', null, 'Check Wheel', null, null);
  ps3 := public.suggest_product(them, 'stock_parts', p909, 'New frame', null, null);

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);

  total := total + 1;
  select q.flag, q.label into flag, txt from public.moderation_queue() q where q.kind = 'product_suggestion' and q.id = ps;
  if flag and txt = '909' then ok := ok + 1; else r := r || 'FAIL product row; '; end if;

  total := total + 1;
  j := public.product_suggestion_review_detail(ps3);
  if j #>> '{product,name}' = '909' and jsonb_array_length(j #> '{product,stock_parts}') >= 1
  then ok := ok + 1; else r := r || 'FAIL product detail; '; end if;

  perform public.review_product_suggestion(ps, 'approve', '2018');

  total := total + 1;
  begin
    perform public.review_product_suggestion(ps2, 'approve');
    r := r || 'FAIL missing model without part type; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  prod := public.review_product_suggestion(ps2, 'approve', null, 'wheels');

  total := total + 1;
  begin
    perform public.review_product_suggestion(ps3, 'approve');
    r := r || 'FAIL applied stock parts; ';
  exception when invalid_parameter_value then ok := ok + 1; end;
  perform public.review_product_suggestion(ps3, 'done');

  execute 'reset role';
  total := total + 1;
  if (select first_year from public.products where id = p909) = '2018'
     and exists (select 1 from public.products p where p.id = prod and p.name = 'Check Wheel' and p.page_id = them
                   and p.disciplines <@ array['inline', 'quad', 'skateboard']::public.discipline[])
     and (select status from public.product_suggestions where id = ps3) = 'accepted'
     and exists (select 1 from public.notifications where recipient_id = m and kind = 'suggestion_live' and message = '909')
  then ok := ok + 1; else r := r || 'FAIL product effects; '; end if;
  execute 'set local role authenticated';

  total := total + 1;
  select count(*) into n from public.catalog_export(them) e where e.model = '909' and e.stock_parts like 'frame: %';
  if n = 1 then ok := ok + 1; else r := r || 'FAIL export 909 rows ' || n || '; '; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform * from public.catalog_export(them);
    r := r || 'FAIL member exported; ';
  exception when no_data_found then ok := ok + 1; end;

  /* Reports about a page --------------------------------------------------------------- */
  perform public.file_page_report(newpage, 'wrong_info', 'Not in Malmö');
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);

  total := total + 1;
  select count(*) into n from public.moderation_queue() q where q.kind = 'page_report' and q.id = newpage and q.state = 'sent_to_you';
  if n = 1 then ok := ok + 1; else r := r || 'FAIL page report row; '; end if;

  total := total + 1;
  j := public.page_report_review_detail(newpage);
  if jsonb_array_length(j -> 'reports') = 1 then ok := ok + 1; else r := r || 'FAIL page report detail; '; end if;

  perform public.resolve_page_reports(newpage, false);
  total := total + 1;
  select count(*) into n from public.moderation_queue() q where q.kind = 'page_report' and q.id = newpage;
  if n = 0 then ok := ok + 1; else r := r || 'FAIL page report still queued; '; end if;

  /* Page blocks ---------------------------------------------------------------------- */
  execute 'reset role';
  foreach u in array array[m, y, ca, b1, b2, o] loop
    insert into public.page_blocks (page_id, user_id, blocked_by) values (bos, u, x);
  end loop;
  execute 'set local role authenticated';

  total := total + 1;
  select count(*), bool_and(q.flagged), max(q.week_count) into n, flag, n2 from public.admin_page_blocks(false, bos) q;
  if n = 6 and flag and n2 = 6 then ok := ok + 1; else r := r || 'FAIL blocks ' || n || '/' || n2 || '; '; end if;

  total := total + 1;
  if public.flagged_page_count() >= 1 then ok := ok + 1; else r := r || 'FAIL flagged count; '; end if;

  select q.id into blk from public.admin_page_blocks(false, bos) q where q.skater = (select username::text from public.profiles where id = m);
  total := total + 1;
  j := public.page_block_detail(blk);
  if (j #>> '{week,count}')::int = 6 then ok := ok + 1; else r := r || 'FAIL block detail; '; end if;

  perform public.lift_page_block(blk);
  total := total + 1;
  select count(*) into n from public.admin_page_blocks(true, bos);
  select count(*) into n2 from public.admin_page_blocks(false, bos) q where q.flagged;
  if n = 1 and n2 = 0 then ok := ok + 1; else r := r || 'FAIL lift ' || n || '/' || n2 || '; '; end if;

  total := total + 1;
  begin
    perform public.lift_page_block(blk);
    r := r || 'FAIL lifted twice; ';
  exception when no_data_found then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  total := total + 1;
  begin
    perform * from public.admin_page_blocks();
    r := r || 'FAIL member read page blocks; ';
  exception when no_data_found then ok := ok + 1; end;
  total := total + 1;
  if public.flagged_page_count() = 0 then ok := ok + 1; else r := r || 'FAIL member flagged count; '; end if;

  /* Shop fixes ------------------------------------------------------------------------ */
  perform public.file_page_fix(bos, 'location_type', 'by_appointment', 'They asked me to book');
  perform public.file_page_fix(bos, 'location_type', 'online_only');   -- a repeat while open: no-op
  perform public.file_page_fix(bos, 'hours', 'Closed Mondays now');
  perform public.file_page_fix(bos, 'closed', 'ignored');

  total := total + 1;
  begin
    perform public.file_page_fix(them, 'website', 'them.example');
    r := r || 'FAIL fix on a brand; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.file_page_fix(bos, 'website', null);
    r := r || 'FAIL fix with no value; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  execute 'reset role';
  select id into fix1 from public.page_fix_reports where reporter_id = m and field = 'location_type';
  select id into fix2 from public.page_fix_reports where reporter_id = m and field = 'hours';
  select id into fix3 from public.page_fix_reports where reporter_id = m and field = 'closed';
  total := total + 1;
  select count(*) into n from public.page_fix_reports where reporter_id = m;
  if n = 3 and (select value from public.page_fix_reports where id = fix3) is null
  then ok := ok + 1; else r := r || 'FAIL fixes filed ' || n || '; '; end if;
  select count(*) into n2 from public.notifications where recipient_id = m and kind = 'suggestion_live';
  execute 'set local role authenticated';

  total := total + 1;
  begin
    perform public.review_page_fix(fix1, 'approve');
    r := r || 'FAIL member reviewed a fix; ';
  exception when no_data_found then ok := ok + 1; end;

  perform set_config('request.jwt.claims', json_build_object('sub', ca, 'role', 'authenticated')::text, true);

  total := total + 1;
  select count(*) into n from public.moderation_queue() q where q.kind = 'shop_fix' and q.page_id = bos;
  if n = 3 then ok := ok + 1; else r := r || 'FAIL city admin fix rows ' || n || '; '; end if;

  total := total + 1;
  select count(*) into n from public.moderation_queue() q where q.kind in ('claim', 'page_suggestion', 'product_suggestion', 'page_report');
  if n = 0 then ok := ok + 1; else r := r || 'FAIL city admin sees Rachel''s rows; '; end if;

  total := total + 1;
  j := public.page_fix_review_detail(fix1);
  if j ->> 'current' = 'storefront' and (j ->> 'can_escalate')::boolean then ok := ok + 1; else r := r || 'FAIL fix detail; '; end if;

  perform public.review_page_fix(fix1, 'approve');

  total := total + 1;
  begin
    perform public.review_page_fix(fix2, 'approve');
    r := r || 'FAIL applied hours; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  perform public.review_page_fix(fix2, 'escalate');
  total := total + 1;
  begin
    perform public.page_fix_review_detail(fix2);
    r := r || 'FAIL city admin still sees an escalated fix; ';
  exception when no_data_found then ok := ok + 1; end;

  perform public.review_page_fix(fix3, 'decline');

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  total := total + 1;
  select q.state into txt from public.moderation_queue() q where q.kind = 'shop_fix' and q.id = fix2;
  if txt = 'sent_to_you' then ok := ok + 1; else r := r || 'FAIL escalated state ' || coalesce(txt, 'none') || '; '; end if;
  perform public.review_page_fix(fix2, 'done');

  execute 'reset role';
  total := total + 1;
  if (select location_type from public.pages where id = bos) = 'by_appointment'
     and not (select show_pin from public.pages where id = bos)
     and (select state from public.pages where id = bos) = 'unofficial'
     and (select status from public.page_fix_reports where id = fix2) = 'accepted'
     and (select status from public.page_fix_reports where id = fix3) = 'rejected'
     and (select count(*) from public.notifications where recipient_id = m and kind = 'suggestion_live') = n2 + 2
  then ok := ok + 1; else r := r || 'FAIL fix effects; '; end if;

  raise exception 'CHECK % of %: %', ok, total, r;
end $$;
rollback;
