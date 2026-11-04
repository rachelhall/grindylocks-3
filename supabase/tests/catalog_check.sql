-- Rolled-back check for 20261104150000_catalog_enums and 20261104150100_catalog.
-- Runs both migrations, a few test products and the checks in one transaction,
-- then raises CHECK <ok> of <total>: <failures>, so nothing is kept. Member
-- checks run as a throwaway ordinary member made in the transaction.
-- The generated seed migrations (catalog_seed_1 to _7) are checked after
-- applying by counting products per brand against the CSVs.
begin;

-- Brand and shop accounts, part A, PR 4: the product catalog's enums.
-- In their own migration, like the other part A enums.

do $$ begin
  -- A model, or something built on one: a rider's pro model, a collab with
  -- another brand, or a special edition. (Gear Seed Data, entry_type.)
  create type public.product_entry_type as enum ('model', 'pro', 'collab', 'special_edition');
exception when duplicate_object then null; end $$;

do $$ begin
  -- current: in shops now; discontinued: confirmed gone; unknown: not checked.
  create type public.product_status as enum ('current', 'discontinued', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  -- What Suggest a change offers (Brand-Suggest mockup).
  create type public.product_suggestion_kind as enum (
    'missing_model', 'wrong_name', 'wrong_year', 'no_longer_made', 'stock_parts', 'something_else'
  );
exception when duplicate_object then null; end $$;

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

-- Test data (as postgres): Them 909 with a pro, a frame, a liner and stock parts; a unibody USD Aeon with a pro.
insert into public.products (id, page_id, part_type, name, entry_type, status, first_year, sort) values
  ('00000000-0000-0000-0000-000000000901', (select id from public.pages where handle = 'themskates'), 'boot', '909', 'model', 'current', 'c. 2019', 10),
  ('00000000-0000-0000-0000-000000000902', (select id from public.pages where handle = 'themskates'), 'frame', 'Street', 'model', 'current', null, 20),
  ('00000000-0000-0000-0000-000000000903', (select id from public.pages where handle = 'themskates'), 'liner', 'Them liner', 'model', 'current', '2018', 30);
insert into public.products (id, page_id, part_type, name, entry_type, pro_rider, status, base_id, sort) values
  ('00000000-0000-0000-0000-000000000904', (select id from public.pages where handle = 'themskates'), 'boot', '909', 'pro', 'Danny Beer', 'unknown', '00000000-0000-0000-0000-000000000901', 40);
insert into public.products (id, page_id, part_type, name, entry_type, edition, partner_page_id, status, sort) values
  ('00000000-0000-0000-0000-000000000905', (select id from public.pages where handle = 'intuitionliners'), 'liner', 'BaceThem', 'collab', 'Them', (select id from public.pages where handle = 'themskates'), 'current', 10);
insert into public.products (id, page_id, part_type, name, entry_type, status, includes_frame, sort) values
  ('00000000-0000-0000-0000-000000000906', (select id from public.pages where handle = 'usdskates'), 'boot', 'Aeon 60', 'model', 'current', true, 10);
insert into public.products (id, page_id, part_type, name, entry_type, pro_rider, status, base_id, sort) values
  ('00000000-0000-0000-0000-000000000907', (select id from public.pages where handle = 'usdskates'), 'boot', 'Aeon 60', 'pro', 'Nick Lomax', 'unknown', '00000000-0000-0000-0000-000000000906', 20);
insert into public.product_stock_parts values
  ('00000000-0000-0000-0000-000000000901', 'frame', '00000000-0000-0000-0000-000000000902'),
  ('00000000-0000-0000-0000-000000000901', 'liner', '00000000-0000-0000-0000-000000000903');
insert into public.product_notes values ('00000000-0000-0000-0000-000000000901', 'secret lineage', 'x.com');

do $$
declare
  r text := '';
  ok int := 0; total int := 0;
  member uuid;
  n int;
  sid uuid;
  procedure_ok boolean;
begin
  -- Constraint checks, as postgres.
  total := total + 1;
  begin
    insert into public.products (page_id, part_type, name, disciplines) values ((select id from public.pages where handle = 'themskates'), 'frame', 'Bad', '{quad}');
    r := r || 'FAIL quad frame allowed; ';
  exception when check_violation then ok := ok + 1; end;
  total := total + 1;
  begin
    insert into public.products (page_id, part_type, name, entry_type, pro_rider, base_id) values ((select id from public.pages where handle = 'usdskates'), 'boot', 'X', 'pro', 'Y', '00000000-0000-0000-0000-000000000901');
    r := r || 'FAIL cross-brand base allowed; ';
  exception when check_violation then ok := ok + 1; end;
  total := total + 1;
  begin
    insert into public.product_stock_parts values ('00000000-0000-0000-0000-000000000901', 'wheels', '00000000-0000-0000-0000-000000000902');
    r := r || 'FAIL wrong stock part type allowed; ';
  exception when check_violation then ok := ok + 1; end;
  total := total + 1;
  begin
    insert into public.products (page_id, part_type, name, entry_type) values ((select id from public.pages where handle = 'themskates'), 'boot', 'NoRider', 'pro');
    r := r || 'FAIL pro without rider; ';
  exception when check_violation then ok := ok + 1; end;
  total := total + 1;
  begin
    insert into public.products (page_id, part_type, name, includes_frame) values ((select id from public.pages where handle = 'themskates'), 'wheels', 'W', true);
    r := r || 'FAIL includes_frame on wheels; ';
  exception when check_violation then ok := ok + 1; end;

  -- A throwaway ordinary member, made in this transaction (it rolls back).
  member := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (member, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'catalog-check-' || member || '@example.com', now(), now());
  insert into public.profiles (id) values (member) on conflict (id) do nothing;
  update public.profiles set onboarded_at = now(), age_confirmed_at = now(), disciplines = '{inline}',
    home_metro_area_id = (select id from public.metro_areas limit 1),
    username = 'catalogcheck' || left(replace(member::text, '-', ''), 8) where id = member;
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  total := total + 1;
  if not private.is_owner() then ok := ok + 1; else r := r || 'FAIL member is owner; '; end if;

  total := total + 1;
  select count(*) into n from public.catalog_entries where id::text like '00000000-0000-0000-0000-00000000090%';
  if n = 7 then ok := ok + 1; else r := r || 'FAIL catalog_entries ' || n || '; '; end if;

  total := total + 1;
  select count(*) into n from public.catalog_entries where id = '00000000-0000-0000-0000-000000000907' and includes_frame;
  if n = 1 then ok := ok + 1; else r := r || 'FAIL pro does not inherit includes_frame; '; end if;

  total := total + 1;
  select count(*) into n from public.catalog_entries where id = '00000000-0000-0000-0000-000000000905' and partner_handle = 'themskates' and page_handle = 'intuitionliners';
  if n = 1 then ok := ok + 1; else r := r || 'FAIL collab partner; '; end if;

  total := total + 1;
  select count(*) into n from public.product_stock_setup where product_id = '00000000-0000-0000-0000-000000000904';
  if n = 2 then ok := ok + 1; else r := r || 'FAIL pro inherits stock parts: ' || n || '; '; end if;

  total := total + 1;
  select count(*) into n from public.product_stock_setup where product_id = '00000000-0000-0000-0000-000000000901' and part_name = 'Street' and part_page_name = 'Them';
  if n = 1 then ok := ok + 1; else r := r || 'FAIL stock part name; '; end if;

  total := total + 1;
  select count(*) into n from public.part_types;
  if n = 12 then ok := ok + 1; else r := r || 'FAIL part types; '; end if;

  total := total + 1;
  select count(*) into n from public.product_notes;
  if n = 0 then ok := ok + 1; else r := r || 'FAIL member reads notes; '; end if;

  total := total + 1;
  begin
    insert into public.products (page_id, part_type, name) values ((select id from public.pages where handle = 'themskates'), 'boot', 'Hack');
    r := r || 'FAIL member inserted product; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    update public.products set name = 'Hacked' where id = '00000000-0000-0000-0000-000000000901';
    r := r || 'FAIL member updated product; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  begin
    delete from public.product_stock_parts where product_id = '00000000-0000-0000-0000-000000000901';
    r := r || 'FAIL member deleted stock parts; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  -- Suggest a change.
  total := total + 1;
  sid := public.suggest_product((select id from public.pages where handle = 'themskates'), 'missing_model', null, ' 910 ', 'boot', 'saw it on IG');
  select count(*) into n from public.product_suggestions where id = sid and value = '910' and part_type = 'boot' and suggester_id = member;
  if n = 1 then ok := ok + 1; else r := r || 'FAIL suggestion stored; '; end if;

  total := total + 1;
  sid := public.suggest_product((select id from public.pages where handle = 'themskates'), 'no_longer_made', '00000000-0000-0000-0000-000000000904', 'ignored', 'boot');
  select count(*) into n from public.product_suggestions where id = sid and value is null and part_type is null;
  if n = 1 then ok := ok + 1; else r := r || 'FAIL no_longer_made cleaned; '; end if;

  total := total + 1;
  -- A partner page can take suggestions on a collab it's part of.
  sid := public.suggest_product((select id from public.pages where handle = 'themskates'), 'wrong_year', '00000000-0000-0000-0000-000000000905', '2023');
  if sid is not null then ok := ok + 1; end if;

  total := total + 1;
  begin
    perform public.suggest_product((select id from public.pages where handle = 'themskates'), 'wrong_name', null, 'X');
    r := r || 'FAIL wrong_name without product; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.suggest_product((select id from public.pages where handle = 'bonesbearings'), 'wrong_name', '00000000-0000-0000-0000-000000000901', 'X');
    r := r || 'FAIL product from another page; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    perform public.suggest_product((select id from public.pages where handle = 'themskates'), 'wrong_year', '00000000-0000-0000-0000-000000000901', '  ');
    r := r || 'FAIL empty value; ';
  exception when invalid_parameter_value then ok := ok + 1; end;

  total := total + 1;
  begin
    update public.product_suggestions set status = 'accepted';
    get diagnostics n = row_count;
    if n = 0 then ok := ok + 1; else r := r || 'FAIL member reviewed suggestion; '; end if;
  exception when insufficient_privilege then ok := ok + 1; end;

  total := total + 1;
  for n in 1..7 loop
    perform public.suggest_product((select id from public.pages where handle = 'themskates'), 'something_else', null, 'x' || n);
  end loop;
  begin
    perform public.suggest_product((select id from public.pages where handle = 'themskates'), 'something_else', null, 'eleventh');
    r := r || 'FAIL 11th suggestion allowed; ';
  exception when program_limit_exceeded then ok := ok + 1; end;

  -- Another member can't see these suggestions.
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into n from public.product_suggestions;
  if n = 0 then ok := ok + 1; else r := r || 'FAIL others see suggestions; '; end if;

  total := total + 1;
  begin
    perform public.suggest_product((select id from public.pages where handle = 'themskates'), 'missing_model', null, 'X');
    r := r || 'FAIL non-member suggested; ';
  exception when insufficient_privilege then ok := ok + 1; end;

  raise exception 'CHECK % of %: %', ok, total, r;
end $$;
