-- Brand and shop accounts part A, PR 8b: commenting as a page (enums).
--
-- page_comment: a comment on one of a page's posts, or a reply to one of its
-- comments, pushed to team members who switched the page's inbox push on.
-- Like page_mention, it never shows in anyone's bell.
-- Kept in its own migration: a new enum value can't be used in the
-- transaction that adds it.

alter type public.notification_kind add value if not exists 'page_comment';
