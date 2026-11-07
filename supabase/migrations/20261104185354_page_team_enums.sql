-- Brand and shop accounts part A, PR 7a (running a page): the new enum value.
-- Kept in its own migration and applied first, because Postgres can't use a
-- new enum value in the transaction that adds it.

-- Someone @mentioned a page you're on. Only for team members who switched on
-- that page's inbox push (off by default); it never shows in the bell, since
-- mentions of a page go to the page's inbox.
alter type public.notification_kind add value if not exists 'page_mention';
