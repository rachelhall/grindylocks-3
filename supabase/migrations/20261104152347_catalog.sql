-- Brand and shop accounts, part A, PR 4: the product catalog.
-- PRD: Grindylocks — Brand and Shop Accounts PRD (Products). Mockups: the Brand
-- accounts (v2) page, "brand pages & products" row (Brand-Products,
-- Brand-Products-Bones, Brand-Products-Past, Brand-Product-Sheet, Brand-Suggest).
--
--   part_types            the kinds of part (boot, frame, plate, trucks, wheels…),
--                         each for one or more disciplines: boot is inline and
--                         quad, frame inline, plate and toe stop quad, trucks quad
--                         and skateboard, wheels and bearings every board.
--   products              brand → model, with pro models, collabs and special
--                         editions as their own entries built on a model (base_id).
--                         The id is the stable product ID the per-brand CSVs carry,
--                         so it survives renames, merges and splits.
--   product_notes         notes and sources, internal (Rachel only).
--   product_stock_parts   what a model comes with (909 → Them Street frame, Them
--                         wheels, Them liner). A pro model inherits its model's
--                         stock parts, part type by part type, unless it lists its
--                         own for that part type.
--   product_suggestions   Suggest a change. Rachel's Product suggestions queue
--                         comes with PR 6; until then they're read in Supabase.
--   catalog_entries       (view) a product with its page, partner page and the
--                         "includes frame" flag it inherits from its model.
--   product_stock_setup   (view) each product's stock parts, inheritance applied.
--
-- Who can see what: every signed-in member reads the catalog (read-only in the
-- app for everyone in part A, brand teams included). Notes and sources are
-- Rachel's. Suggestions: your own, and Rachel.
-- Writes: only suggest_product() for members. Rachel changes the catalog with
-- the per-brand CSV import (supabase/seed/products), or in Supabase.
--
-- Additive: new tables, views, functions and triggers. Nothing existing changes.

/* 1. Part types ---------------------------------------------------------------- */

create table if not exists public.part_types (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  disciplines public.discipline[] not null check (cardinality(disciplines) >= 1),
  sort smallint not null
);

comment on table public.part_types is
  'Kinds of part, each for one or more disciplines. Labels live in the app''s translations (catalog.partTypes).';

insert into public.part_types (key, disciplines, sort) values
  ('boot',         '{inline,quad}',            10),
  ('frame',        '{inline}',                 20),
  ('plate',        '{quad}',                   30),
  ('trucks',       '{quad,skateboard}',        40),
  ('deck',         '{skateboard}',             45),
  ('wheels',       '{inline,quad,skateboard}', 50),
  ('bearings',     '{inline,quad,skateboard}', 60),
  ('liner',        '{inline}',                 70),
  ('soulplate',    '{inline}',                 80),
  ('toe_stop',     '{quad}',                   90),
  ('slide_blocks', '{quad}',                   100),
  ('laces',        '{inline,quad}',            110)
on conflict (key) do nothing;

/* 2. Products ------------------------------------------------------------------- */

create table if not exists public.products (
  -- The stable product ID: the per-brand CSVs carry it, and the import
  -- updates the row it names.
  id uuid primary key default gen_random_uuid(),
  -- The brand (or shop, for its merch) that sells it.
  page_id uuid not null references public.pages (id) on delete restrict,
  part_type text not null references public.part_types (key),
  -- The model's name. Pro models, collabs and special editions keep their
  -- model's name here and add the rider or edition.
  name text not null check (char_length(trim(name)) between 1 and 80),
  -- Groups related models for history (Aeon, Fluid, Movie Line).
  family text check (family is null or char_length(family) between 1 and 60),
  pro_rider text check (pro_rider is null or char_length(pro_rider) between 1 and 80),
  -- A collab's partner or edition name (Brain Dead, Allstar), or a pro sequel (II, V2, Storm).
  edition text check (edition is null or char_length(edition) between 1 and 60),
  entry_type public.product_entry_type not null default 'model',
  -- The model a pro model, collab or special edition builds on, when the
  -- catalog has it. Its stock parts and "includes frame" carry over.
  base_id uuid references public.products (id) on delete set null,
  -- A collab's other brand, so it also shows in that page's Collabs group.
  partner_page_id uuid references public.pages (id) on delete set null,
  disciplines public.discipline[] not null default '{inline}' check (cardinality(disciplines) >= 1),
  -- Text, since years are often approximate: "2019" or "c. 2019".
  first_year text check (first_year is null or first_year ~ '^(c\. )?[12][0-9]{3}$'),
  status public.product_status not null default 'unknown',
  -- A unibody boot (USD Aeon): the gear closet never asks for a frame.
  includes_frame boolean not null default false,
  -- Order within the brand's list (the CSV's row order).
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_base_not_self check (base_id is null or base_id <> id),
  constraint products_model_has_no_base check (entry_type <> 'model' or base_id is null),
  constraint products_pro_has_rider check (entry_type <> 'pro' or pro_rider is not null),
  constraint products_partner_not_self check (partner_page_id is null or partner_page_id <> page_id),
  constraint products_includes_frame_boot check (not includes_frame or part_type = 'boot')
);

comment on table public.products is
  'The product catalog: brand → model, plus pro models, collabs and special editions. Read-only in the app; maintained from the per-brand CSVs.';

create index if not exists products_page_idx on public.products (page_id, sort);
create index if not exists products_partner_idx on public.products (partner_page_id) where partner_page_id is not null;
create index if not exists products_base_idx on public.products (base_id) where base_id is not null;

create table if not exists public.product_notes (
  product_id uuid primary key references public.products (id) on delete cascade,
  notes text,
  sources text
);

comment on table public.product_notes is
  'Lineage notes and sources behind each product. Internal: Rachel only (a public history view is under Future versions).';

create table if not exists public.product_stock_parts (
  product_id uuid not null references public.products (id) on delete cascade,
  part_type text not null references public.part_types (key),
  part_id uuid not null references public.products (id) on delete cascade,
  primary key (product_id, part_type)
);

comment on table public.product_stock_parts is
  'What a model comes with, one part per part type. Pro models inherit their model''s, part type by part type.';

create index if not exists product_stock_parts_part_idx on public.product_stock_parts (part_id);

/* 3. Keeping the catalog consistent ---------------------------------------------- */

create or replace function private.check_product()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed public.discipline[];
  base record;
begin
  -- A product is only for disciplines its part type is for (a frame can't be quad).
  select pt.disciplines into allowed from public.part_types pt where pt.key = new.part_type;
  if not (new.disciplines <@ allowed) then
    raise exception 'product % (%): % is for % only', new.name, new.part_type, new.part_type, allowed
      using errcode = '23514';
  end if;
  -- A pro model, collab or special edition builds on a model of the same brand and part.
  if new.base_id is not null then
    select p.page_id, p.part_type, p.entry_type into base from public.products p where p.id = new.base_id;
    if base.page_id <> new.page_id or base.part_type <> new.part_type or base.entry_type <> 'model' then
      raise exception 'product %: its base must be a model of the same brand and part', new.name
        using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_check on public.products;
create trigger products_check
  before insert or update on public.products
  for each row execute function private.check_product();

create or replace function private.check_stock_part()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select p.part_type from public.products p where p.id = new.part_id) is distinct from new.part_type then
    raise exception 'stock part: the part must be a %', new.part_type using errcode = '23514';
  end if;
  if (select p.part_type from public.products p where p.id = new.product_id) = new.part_type then
    raise exception 'stock part: a % can''t come with another %', new.part_type, new.part_type using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists product_stock_parts_check on public.product_stock_parts;
create trigger product_stock_parts_check
  before insert or update on public.product_stock_parts
  for each row execute function private.check_stock_part();

/* 4. Reading the catalog -------------------------------------------------------------- */

-- A product as the app shows it: its page, its partner page, and "includes
-- frame" carried over from its model. Runs with the reader's rights.
create or replace view public.catalog_entries
with (security_invoker = true) as
select
  p.id,
  p.page_id,
  pg.handle::text as page_handle,
  pg.display_name as page_name,
  p.part_type,
  p.name,
  p.family,
  p.pro_rider,
  p.edition,
  p.entry_type,
  p.base_id,
  p.partner_page_id,
  pp.handle::text as partner_handle,
  pp.display_name as partner_name,
  p.disciplines,
  p.first_year,
  p.status,
  (p.includes_frame or coalesce(b.includes_frame, false)) as includes_frame,
  p.sort
from public.products p
join public.pages pg on pg.id = p.page_id
left join public.pages pp on pp.id = p.partner_page_id
left join public.products b on b.id = p.base_id;

comment on view public.catalog_entries is
  'Products with their page and partner page, and "includes frame" inherited from the model.';

-- Each product's stock parts: its own, plus its model's for any part type it
-- doesn't list itself.
create or replace view public.product_stock_setup
with (security_invoker = true) as
with effective as (
  select s.product_id, s.part_type, s.part_id
  from public.product_stock_parts s
  union all
  select p.id, s.part_type, s.part_id
  from public.products p
  join public.product_stock_parts s on s.product_id = p.base_id
  where not exists (
    select 1 from public.product_stock_parts o where o.product_id = p.id and o.part_type = s.part_type
  )
)
select
  e.product_id,
  e.part_type,
  e.part_id,
  part.name as part_name,
  part.page_id as part_page_id,
  pg.display_name as part_page_name,
  pt.sort as part_type_sort
from effective e
join public.products part on part.id = e.part_id
join public.pages pg on pg.id = part.page_id
join public.part_types pt on pt.key = e.part_type;

comment on view public.product_stock_setup is
  'Each product''s stock parts, with pro models inheriting their model''s part type by part type.';

/* 5. Access ------------------------------------------------------------------------- */

alter table public.part_types enable row level security;
alter table public.products enable row level security;
alter table public.product_notes enable row level security;
alter table public.product_stock_parts enable row level security;

revoke all on public.part_types, public.products, public.product_notes, public.product_stock_parts
  from anon, authenticated;
grant select on public.part_types, public.products, public.product_notes, public.product_stock_parts
  to authenticated;
revoke all on public.catalog_entries, public.product_stock_setup from anon, authenticated;
grant select on public.catalog_entries, public.product_stock_setup to authenticated;

drop policy if exists "part types: members read" on public.part_types;
create policy "part types: members read" on public.part_types
  for select to authenticated using (true);

drop policy if exists "products: members read" on public.products;
create policy "products: members read" on public.products
  for select to authenticated using (true);

drop policy if exists "stock parts: members read" on public.product_stock_parts;
create policy "stock parts: members read" on public.product_stock_parts
  for select to authenticated using (true);

drop policy if exists "product notes: Rachel" on public.product_notes;
create policy "product notes: Rachel" on public.product_notes
  for select to authenticated using (private.is_owner());

/* 6. Suggest a change ----------------------------------------------------------------- */

create table if not exists public.product_suggestions (
  id uuid primary key default gen_random_uuid(),
  suggester_id uuid references public.profiles (id) on delete set null,
  -- The Products tab it came from.
  page_id uuid not null references public.pages (id) on delete cascade,
  kind public.product_suggestion_kind not null,
  -- The product it's about. Missing model has none.
  product_id uuid references public.products (id) on delete set null,
  -- The suggested name (Missing model, Wrong name), year (Wrong year), stock
  -- parts, or what's wrong (Something else). No longer made has none.
  value text check (value is null or char_length(value) between 1 and 200),
  -- Missing model: which part it is, if the suggester said.
  part_type text references public.part_types (key),
  -- "Where did you see it?": a link or a note.
  note text check (note is null or char_length(note) between 1 and 300),
  status public.review_status not null default 'open',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint product_suggestions_needs_product check (
    kind in ('missing_model', 'something_else') or product_id is not null
  )
);

comment on table public.product_suggestions is
  'Suggest a change on a Products tab. Rachel reviews them in the web admin''s Product suggestions queue (PR 6).';

create index if not exists product_suggestions_open_idx on public.product_suggestions (created_at) where status = 'open';
create index if not exists product_suggestions_suggester_idx on public.product_suggestions (suggester_id, created_at);

alter table public.product_suggestions enable row level security;
revoke all on public.product_suggestions from anon, authenticated;
grant select on public.product_suggestions to authenticated;
grant update (status, reviewed_by, reviewed_at) on public.product_suggestions to authenticated;

drop policy if exists "product suggestions: your own and Rachel" on public.product_suggestions;
create policy "product suggestions: your own and Rachel" on public.product_suggestions
  for select to authenticated
  using (suggester_id = (select auth.uid()) or private.is_owner());

drop policy if exists "product suggestions: Rachel reviews" on public.product_suggestions;
create policy "product suggestions: Rachel reviews" on public.product_suggestions
  for update to authenticated
  using (private.is_owner()) with check (private.is_owner());

-- Suggest a change. Up to 10 a day per person, and suspended members can't,
-- as with suggesting a page.
create or replace function public.suggest_product(
  page uuid,
  kind public.product_suggestion_kind,
  product uuid default null,
  value text default null,
  part_type text default null,
  note text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean_value text := nullif(btrim(coalesce(value, '')), '');
  clean_note text := nullif(btrim(coalesce(note, '')), '');
  new_id uuid;
begin
  if not private.is_active_member() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pages p where p.id = page) then
    raise exception 'no_such_page' using errcode = '22023';
  end if;
  if product is not null and not exists (
    select 1 from public.products p where p.id = product and (p.page_id = page or p.partner_page_id = page)
  ) then
    raise exception 'no_such_product' using errcode = '22023';
  end if;
  if kind not in ('missing_model', 'something_else') and product is null then
    raise exception 'product_required' using errcode = '22023';
  end if;
  if kind in ('missing_model', 'wrong_name', 'wrong_year', 'stock_parts', 'something_else') and clean_value is null then
    raise exception 'value_required' using errcode = '22023';
  end if;
  if clean_value is not null and char_length(clean_value) > 200
     or clean_note is not null and char_length(clean_note) > 300 then
    raise exception 'too_long' using errcode = '22023';
  end if;
  if part_type is not null and not exists (select 1 from public.part_types pt where pt.key = part_type) then
    raise exception 'no_such_part_type' using errcode = '22023';
  end if;
  if (select count(*) from public.product_suggestions s
       where s.suggester_id = me and s.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_suggestions' using errcode = '54000';
  end if;
  insert into public.product_suggestions (suggester_id, page_id, kind, product_id, value, part_type, note)
  values (
    me, page, kind, product,
    case when kind = 'no_longer_made' then null else clean_value end,
    case when kind = 'missing_model' then part_type end,
    clean_note
  )
  returning id into new_id;
  return new_id;
end $$;

revoke all on function public.suggest_product(uuid, public.product_suggestion_kind, uuid, text, text, text) from public, anon;
grant execute on function public.suggest_product(uuid, public.product_suggestion_kind, uuid, text, text, text) to authenticated;
