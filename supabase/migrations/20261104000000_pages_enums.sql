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
