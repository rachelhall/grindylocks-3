-- Sponsorships (brand and shop accounts, part B), PR 1: the new types and
-- notification kinds. Kept in their own migration and applied first, because
-- Postgres can't use a new enum value in the transaction that adds it.
-- PRD: Grindylocks — Brand and Shop Accounts PRD (Sponsorships). Mockups: the
-- two Sponsorships (part B) rows on the Brand accounts (v2) page.

-- The four levels, in rank order (moving to a later one is moving up). A page
-- switches each on or off and can rename it; it can't add levels.
do $$ begin
  create type public.sponsorship_level as enum ('flow', 'am', 'pro', 'ambassador');
exception when duplicate_object then null; end $$;

-- pending: sent, waiting in the rider's Page invites (30 days).
-- active: accepted; the badge shows and the rider is on Team riders.
-- declined, cancelled (by the team, or by a block, ban or page change),
-- expired: an invite that never became a sponsorship.
-- ended: a sponsorship that was active; the team keeps it under Former riders.
do $$ begin
  create type public.sponsorship_status as enum ('pending', 'active', 'declined', 'cancelled', 'expired', 'ended');
exception when duplicate_object then null; end $$;

-- sponsorship_invite: a page invited you (Page invites box; pushes).
-- sponsorship_accepted: told to the team's managers and owners (bell only).
-- sponsorship_level: your level changed (message up:<level> pushes, down:<level> is bell only).
-- sponsorship_ended: the other side ended it (bell only).
alter type public.notification_kind add value if not exists 'sponsorship_invite';
alter type public.notification_kind add value if not exists 'sponsorship_accepted';
alter type public.notification_kind add value if not exists 'sponsorship_level';
alter type public.notification_kind add value if not exists 'sponsorship_ended';
