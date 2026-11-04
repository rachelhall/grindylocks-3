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
