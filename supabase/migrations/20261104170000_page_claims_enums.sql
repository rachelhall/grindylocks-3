-- Brand and shop accounts, part A, PR 5: the new enum types and values for
-- claiming and invites. Kept in their own migration and applied first,
-- because Postgres can't use a new enum value in the transaction that adds it.

-- A claim invite from Rachel: an emailed invite that makes the person the
-- page's owner, with no claim to wait on.
alter type public.page_invite_kind add value if not exists 'claim';

do $$ begin
  -- How a claimant proves they work there: a work email confirmed with a
  -- code, or a GRIND-XXXX code posted on the brand's Instagram or website.
  create type public.page_claim_proof as enum ('email', 'posted_code');
exception when duplicate_object then null; end $$;

do $$ begin
  -- draft: started, the email code isn't confirmed yet (or the posted-code
  -- claim isn't sent). pending: sent, waiting for Rachel. approved,
  -- declined (with Rachel's reason), withdrawn by the claimant.
  create type public.page_claim_status as enum ('draft', 'pending', 'approved', 'declined', 'withdrawn');
exception when duplicate_object then null; end $$;

-- People notifications for pages (PRD › Notifications).
--   page_invite          a team invite or ownership hand-over (push only; the
--                        bell shows it in the Page invites box).
--   page_claim_approved  your claim was approved.
--   page_claim_declined  your claim wasn't, with Rachel's reason.
--   page_team_change     your role changed, you were removed, or the page's
--                        ownership was transferred to you (the message says
--                        which). Written by the team functions (PR 7).
--   page_claimed         a page you follow is now on Grindylocks.
--   suggestion_live      your suggested brand or product suggestion is live
--                        (written by the web admin's queues, PR 6).
alter type public.notification_kind add value if not exists 'page_invite';
alter type public.notification_kind add value if not exists 'page_claim_approved';
alter type public.notification_kind add value if not exists 'page_claim_declined';
alter type public.notification_kind add value if not exists 'page_team_change';
alter type public.notification_kind add value if not exists 'page_claimed';
alter type public.notification_kind add value if not exists 'suggestion_live';
