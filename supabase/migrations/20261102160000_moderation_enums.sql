-- New enum values for M5 roles and safety (Nov 2).
--
-- Postgres won't let a transaction use an enum value it just added, so these
-- live in their own migration, applied before `moderation` (which uses them).
--
-- - report_reason 'wrong_park': the "Not at this park" report reason
--   (brief, Nov 2: Spam, Harassment, Not at this park, Something else).
-- - notification_kind: what members are told about moderation.
--     post_removed     a moderator kept your post hidden
--     comment_removed  a moderator removed your comment
--     warning          a moderator warned you
--     suspension       you're suspended until a date
--     role_vacated     (to the next role up) someone's role at your park or
--                      city ended because they deleted their account
--
-- Additive: new enum values only.

alter type public.report_reason add value if not exists 'wrong_park';

alter type public.notification_kind add value if not exists 'post_removed';
alter type public.notification_kind add value if not exists 'comment_removed';
alter type public.notification_kind add value if not exists 'warning';
alter type public.notification_kind add value if not exists 'suspension';
alter type public.notification_kind add value if not exists 'role_vacated';
