-- Brand and shop accounts part A, PR 6b: Rachel's page tools (enums).
--
-- page_split: "FR Skates has its own page", once, to the followers of the
-- page it was split from, with a Follow button in the bell. No push.
-- Kept in its own migration: a new enum value can't be used in the
-- transaction that adds it.
--
-- Also the moderation log's new actions (a check, not an enum), so the
-- page_tools migration and its check can log from the start:
--   page_suspended, page_suspension_lifted, page_transferred, page_renamed,
--   page_merged, page_split, page_closed, page_reopened.

alter type public.notification_kind add value if not exists 'page_split';

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
  'page_fix_approved', 'page_fix_done', 'page_fix_declined', 'page_fix_escalated',
  'page_suspended', 'page_suspension_lifted', 'page_transferred', 'page_renamed',
  'page_merged', 'page_split', 'page_closed', 'page_reopened'
));
