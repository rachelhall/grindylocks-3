-- Brand and shop accounts part A, PR 9: pages as meetup hosts (enums).
-- New enum values can't be used in the same transaction they're added in,
-- so they come in their own migration before 20261105164207_page_meetups.

-- Cancelled by the page tools: Close for good ("8SET has closed") and
-- Suspend with "cancel upcoming meetups" ("It's no longer happening", since
-- skaters aren't told about a suspension). Hosts can't pick either.
alter type public.meetup_cancel_reason add value if not exists 'page_closed';
alter type public.meetup_cancel_reason add value if not exists 'page_suspended';

-- Where a meetup happens: a park (people and pages), the host page's own
-- location (a storefront), or an address with a pin (pages only).
do $$ begin
  create type public.meetup_place as enum ('park', 'page', 'address');
exception when duplicate_object then null; end $$;
