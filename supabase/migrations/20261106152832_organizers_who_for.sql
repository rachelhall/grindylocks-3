-- Organizers and "Who it's for" (a part A follow-up, from the Blading Camp
-- spike). PRDs: Grindylocks — Brand and Shop Accounts PRD (Organizer pages)
-- and Grindylocks — Meetups PRD (Pages as hosts › Next). Mockups: the
-- "Organizers and Who it's for (PR 9)" row of the Brand accounts (v2) page
-- (Org-Page, Org-Edit, Org-Inactive, Org-Meetup, WhoFor-Compose,
-- WhoFor-Sheet, WhoFor-Cards), approved Nov 6.
--
--  1. "Who it's for": an optional line (up to 60 characters) on series and
--     dates, for any host, people included. Information only: nothing
--     filters on it or enforces it. create_meetup() takes who_for;
--     update_meetup() takes it in changes; repeats copy it to new dates.
--  2. Organizer pages: the base. An organizer can keep an address and pin
--     (set_page_location(), as a shop does), only for a fixed place like a
--     camp house or a school. It's the page's own place for its meetups
--     (Your base in the app) when set. An organizer with a base reaches Near
--     you like a shop; one without a base doesn't.
--  3. No longer active: Close for good on an organizer (the owner's
--     button, or Rachel's tool) archives it as 'inactive', with years on its
--     tape, like Retired. Reopen brings it back.
--  4. Two fixes found on the way: the owner's Close for good now cancels the
--     page's upcoming meetups as Rachel's tool does (PR 9 only patched hers),
--     and no archived page can post or host (a Retired brand could, since
--     only closed_at was checked).
--
-- Additive: two columns, one function, a reworked check and patched functions.

-- Finds a piece of a function's source and replaces it, and stops the
-- migration if it isn't found the expected number of times.
create or replace function pg_temp.patch(def text, pattern text, replacement text, label text, expected integer default 1)
returns text
language plpgsql
as $$
declare
  n integer := (select count(*) from regexp_matches(def, pattern, 'g'));
begin
  if n <> expected then
    raise exception 'patch %: expected % match(es), found %', label, expected, n;
  end if;
  return regexp_replace(def, pattern, replacement, 'g');
end $$;

/* 1. Who it's for ---------------------------------------------------------------------- */

alter table public.event_series
  add column if not exists who_for text check (who_for is null or char_length(who_for) between 1 and 60);
alter table public.events
  add column if not exists who_for text check (who_for is null or char_length(who_for) between 1 and 60);

comment on column public.events.who_for is
  'Who it''s for: a line under the title (Beginners welcome). Information, not a rule.';

-- One line: whitespace and line breaks fold to single spaces; empty is none.
create or replace function private.clean_who_for(t text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')), '');
begin
  if char_length(v) > 60 then
    raise exception 'Keep who it''s for to 60 characters' using errcode = '22023';
  end if;
  return v;
end $$;

do $$
declare
  old_fn regprocedure := 'public.create_meetup'::regproc::oid::regprocedure;
  def text := pg_get_functiondef(old_fn);
begin
  def := pg_temp.patch(def,
    'days jsonb DEFAULT NULL::jsonb\)\s*RETURNS uuid',
    'days jsonb DEFAULT NULL::jsonb, who_for text DEFAULT NULL::text)
 RETURNS uuid',
    'create_meetup: parameter');
  def := pg_temp.patch(def,
    'capacity, ticket_url, adults_only, multi_day\)\s*values',
    'capacity, ticket_url, adults_only, multi_day, who_for)
values',
    'create_meetup: series columns');
  def := pg_temp.patch(def,
    'link, coalesce\(create_meetup\.adults_only, false\), several',
    'link, coalesce(create_meetup.adults_only, false), several, private.clean_who_for(create_meetup.who_for)',
    'create_meetup: series values');
  def := pg_temp.patch(def,
    'capacity, ticket_url, adults_only, multi_day\)\s*select s,',
    'capacity, ticket_url, adults_only, multi_day, who_for)
select s,',
    'create_meetup: date columns');
  def := pg_temp.patch(def,
    'x\.capacity, x\.ticket_url, x\.adults_only, x\.multi_day',
    'x.capacity, x.ticket_url, x.adults_only, x.multi_day, x.who_for',
    'create_meetup: date values');
  execute def;
  -- The new parameter makes a new function; drop the old one so a call
  -- without who_for isn't ambiguous.
  execute format('drop function %s', old_fn);
end $$;

revoke all on function public.create_meetup(uuid, timestamptz, timestamptz, text, text, public.meetup_visibility,
  public.discipline[], text, smallint[], date, jsonb, uuid[], uuid, public.meetup_place, text, double precision,
  double precision, integer, text, boolean, jsonb, text) from public, anon;
grant execute on function public.create_meetup(uuid, timestamptz, timestamptz, text, text, public.meetup_visibility,
  public.discipline[], text, smallint[], date, jsonb, uuid[], uuid, public.meetup_place, text, double precision,
  double precision, integer, text, boolean, jsonb, text) to authenticated;

do $$
declare
  def text := pg_get_functiondef('public.update_meetup(uuid, text, jsonb)'::regprocedure);
begin
  def := pg_temp.patch(def,
    'new_adults boolean;',
    'new_adults boolean;
new_who text;',
    'update_meetup: declare');
  def := pg_temp.patch(def,
    'new_adults := coalesce\(\(changes->>''adults_only''\)::boolean, e\.adults_only\);',
    'new_adults := coalesce((changes->>''adults_only'')::boolean, e.adults_only);
new_who := case when changes ? ''who_for'' then private.clean_who_for(changes->>''who_for'') else e.who_for end;',
    'update_meetup: value');
  def := pg_temp.patch(def,
    'adults_only = new_adults,',
    'adults_only = new_adults, who_for = new_who,',
    'update_meetup: updates', 4);
  execute def;

  def := pg_get_functiondef('private.generate_meetup_dates(uuid)'::regprocedure);
  def := pg_temp.patch(def,
    'capacity, ticket_url, adults_only\)\s*values',
    'capacity, ticket_url, adults_only, who_for)
values',
    'generate_meetup_dates: columns');
  def := pg_temp.patch(def,
    's\.capacity, s\.ticket_url, s\.adults_only\)',
    's.capacity, s.ticket_url, s.adults_only, s.who_for)',
    'generate_meetup_dates: values');
  execute def;
end $$;

/* 2. Organizers and their base --------------------------------------------------------- */

-- Address and pin: shops, and organizers with a fixed base. Location type,
-- Closed for a while and hours stay shops only.
alter table public.pages drop constraint if exists pages_shop_fields;
alter table public.pages add constraint pages_shop_fields check (
  'shop' = any (roles)
  or (location_type is null and temp_closed_at is null
      and ('organizer' = any (roles) or (address is null and location is null)))
);

-- No longer active is an organizer's archive.
alter table public.pages drop constraint if exists pages_inactive_is_an_organizer;
alter table public.pages add constraint pages_inactive_is_an_organizer
  check (state <> 'inactive' or 'organizer' = any (roles));

do $$
declare
  def text;
begin
  -- Organizers can set (or clear) a base. Errors unchanged (not_a_shop for
  -- a brand).
  def := pg_get_functiondef('public.set_page_location(uuid, text, double precision, double precision)'::regprocedure);
  def := pg_temp.patch(def,
    'where p\.id = page and ''shop'' = any \(p\.roles\)\)',
    'where p.id = page and (''shop'' = any (p.roles) or ''organizer'' = any (p.roles)))',
    'set_page_location: organizers');
  execute def;

  -- A meetup at the page's own place: a shop's storefront (or a
  -- by-appointment shop that shows its pin), or an organizer's base.
  def := pg_get_functiondef('private.resolve_meetup_place(uuid, public.meetup_place, uuid, text, double precision, double precision)'::regprocedure);
  def := pg_temp.patch(def,
    'if p\.latitude is null\s*or p\.location_type is null\s*or not \(p\.location_type = ''storefront'' or \(p\.location_type = ''by_appointment'' and p\.show_pin\)\) then',
    'if p.latitude is null
   or (case when ''shop'' = any (p.roles)
            then p.location_type is null
                 or not (p.location_type = ''storefront'' or (p.location_type = ''by_appointment'' and p.show_pin))
            else not (''organizer'' = any (p.roles)) end) then',
    'resolve_meetup_place: base');
  execute def;

  -- Near you: managed shops, and managed organizers with a base.
  def := pg_get_functiondef('private.page_reaches_near_you(uuid)'::regprocedure);
  def := pg_temp.patch(def,
    '''shop'' = any \(p\.roles\) and p\.state = ''managed''',
    '(''shop'' = any (p.roles) or (''organizer'' = any (p.roles) and p.location is not null)) and p.state = ''managed''',
    'page_reaches_near_you: organizers');
  execute def;

  -- No archive posts, comments or hosts as the page (Retired brands keep
  -- closed_at empty, so the state is checked too).
  def := pg_get_functiondef('private.can_post_as_page(uuid)'::regprocedure);
  def := pg_temp.patch(def,
    'p\.logo_path is not null and p\.closed_at is null',
    'p.logo_path is not null and p.closed_at is null
                    and p.state in (''unofficial'', ''managed'')',
    'can_post_as_page: archives');
  execute def;
end $$;

/* 3. No longer active ------------------------------------------------------------------ */

-- The owner's Close for good (Edit page): a shop becomes Closed, a brand
-- Retired, an organizer No longer active (years on its tape: the end
-- defaults to this year). Upcoming meetups are cancelled and the series
-- ended, as Rachel's tool does. Open invites are cancelled.
-- Errors: not_allowed, already_closed.
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
  if p.state in ('closed', 'out_of_business', 'inactive') then
    raise exception using errcode = '22023', message = 'already_closed';
  end if;
  next_state := case when 'shop' = any (p.roles) then 'closed'
                     when 'brand' = any (p.roles) then 'out_of_business'
                     else 'inactive' end;

  update pages
     set state = next_state,
         closed_at = case when next_state in ('closed', 'inactive') then now() else closed_at end,
         ended_label = case when next_state in ('out_of_business', 'inactive')
                            then coalesce(ended_label, extract(year from now())::int::text) else ended_label end,
         temp_closed_at = null, temp_closed_until = null, temp_closed_note = null,
         updated_at = now()
   where id = page;

  update page_invites i set cancelled_at = now()
   where i.page_id = page and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null;

  perform private.cancel_page_meetups(page, 'page_closed');
  return next_state::text;
end $$;

do $$
declare
  def text := pg_get_functiondef('public.admin_close_page(uuid, text, text)'::regprocedure);
begin
  def := pg_temp.patch(def,
    'if p\.state in \(''closed'', ''out_of_business''\) then',
    'if p.state in (''closed'', ''out_of_business'', ''inactive'') then',
    'admin_close_page: already closed');
  def := pg_temp.patch(def,
    'next_state := case when ''shop'' = any \(p\.roles\) then ''closed'' else ''out_of_business'' end;',
    'next_state := case when ''shop'' = any (p.roles) then ''closed''
                   when ''brand'' = any (p.roles) then ''out_of_business''
                   else ''inactive'' end;',
    'admin_close_page: state');
  def := pg_temp.patch(def,
    'closed_at = case when next_state = ''closed'' then',
    'closed_at = case when next_state in (''closed'', ''inactive'') then',
    'admin_close_page: closed_at');
  def := pg_temp.patch(def,
    'when next_state = ''out_of_business''',
    'when next_state in (''out_of_business'', ''inactive'')',
    'admin_close_page: years', 2);
  execute def;

  def := pg_get_functiondef('public.reopen_page(uuid)'::regprocedure);
  def := pg_temp.patch(def,
    'if p\.state not in \(''closed'', ''out_of_business''\) then',
    'if p.state not in (''closed'', ''out_of_business'', ''inactive'') then',
    'reopen_page: archives');
  execute def;
end $$;
