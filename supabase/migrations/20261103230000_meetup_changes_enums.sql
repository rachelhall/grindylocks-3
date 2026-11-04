-- Meetups (v2), PR 5: the new notification kinds. In their own migration
-- because Postgres won't use a new enum value in the transaction that adds
-- it; 20261103230100_meetup_changes uses them.
--
--   meetup_changed    a date's day, time or park changed (push, Meetups switch)
--   meetup_cancelled  a date, or the rest of a series, was cancelled (push)
--   meetup_reminder   the 1-hour Remind me (push and bell)
--   meetup_going      someone said they're going; the hosts' grouped bell row
--                     (no push)
--   co_host_invite    you're invited to co-host (bell only)
--   meetup_comment    a comment on a meetup: shown to hosts as a comment, to
--                     the person replied to as a reply and to anyone
--                     @mentioned as a mention, like post comments (push under
--                     the Comments and Mentions switches)
--   meetup_hidden     park admins hid a date (bell only, to its hosts)
--
-- Additive: enum values only.

alter type public.notification_kind add value if not exists 'meetup_changed';
alter type public.notification_kind add value if not exists 'meetup_cancelled';
alter type public.notification_kind add value if not exists 'meetup_reminder';
alter type public.notification_kind add value if not exists 'meetup_going';
alter type public.notification_kind add value if not exists 'co_host_invite';
alter type public.notification_kind add value if not exists 'meetup_comment';
alter type public.notification_kind add value if not exists 'meetup_hidden';
