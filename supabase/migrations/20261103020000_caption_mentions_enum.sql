-- v2, caption mentions (Nov 2): the notification kind for being @mentioned
-- in a post's caption. On its own because a new enum value can't be used in
-- the same transaction that adds it; 20261103030000_caption_mentions uses it.

alter type public.notification_kind add value if not exists 'caption_mention';
