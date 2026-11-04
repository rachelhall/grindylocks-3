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
