-- Search tab, people half (Nov 1).
--
-- search_people(): find members by username for the Search tab.
-- - Case-insensitive; prefix matches first, then "contains", then A to Z.
-- - A leading "@" is ignored. Only username characters (letters, numbers,
--   dots, underscores) are matched; "_" is escaped so it isn't a LIKE
--   wildcard.
-- - Never returns: people blocked either way (the profiles read rule already
--   hides them; checked again here), banned members, deleted accounts
--   (tombstone rows) and people who haven't finished onboarding.
-- - Returns only fields other members may already read, plus display helpers:
--   the home park's display name, the home metro area's name, and whether the
--   viewer follows them (accepted) or has asked to (pending).
--
-- Security invoker, so the profiles, follows, parks and metro areas read
-- rules all apply. Banned status isn't readable by members, so it goes
-- through private.is_banned(), which already exists for the access rules.
-- Additive only: nothing existing is changed.

create or replace function public.search_people(q text, max_results integer default 20)
returns table (
  id uuid,
  username text,
  disciplines public.discipline[],
  is_private boolean,
  home_park_name text,
  home_metro_name text,
  follow_status public.follow_status
)
language sql stable
security invoker
set search_path = ''
as $$
  with needle as (
    select replace(replace(replace(
             lower(regexp_replace(trim(coalesce(q, '')), '^@+', '')),
             '\', '\\'), '%', '\%'), '_', '\_') as n
  )
  select pr.id,
         pr.username,
         pr.disciplines,
         pr.is_private,
         hp.display_name,
         hm.name,
         f.status
  from public.profiles pr
  left join public.parks hp on hp.id = pr.home_park_id
  left join public.metro_areas hm on hm.id = pr.home_metro_area_id
  left join public.follows f
    on f.follower_id = (select auth.uid()) and f.followee_id = pr.id
  where length((select n from needle)) >= 2
    and pr.username is not null
    and pr.onboarded_at is not null
    and pr.deleted_at is null
    and lower(pr.username) like '%' || (select n from needle) || '%'
    and not private.blocked_between(pr.id)
    and not private.is_banned(pr.id)
  order by
    (lower(pr.username) like (select n from needle) || '%') desc,
    length(pr.username),
    lower(pr.username)
  limit least(greatest(coalesce(max_results, 20), 1), 50);
$$;

comment on function public.search_people(text, integer) is
  'Search tab: members by username, prefix matches first. Hides blocked (both ways), banned, deleted and not-yet-onboarded accounts.';

-- Sign-in only, like everything else.
revoke all on function public.search_people(text, integer) from public, anon;
grant execute on function public.search_people(text, integer) to authenticated;
