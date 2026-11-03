-- Reviewer sign-in (Nov 3).
--
-- App Review needs a way in, and Grindylocks has no passwords: sign-in is a
-- 6-digit code emailed to the member. The review-sign-in Edge Function lets
-- one demo address (the REVIEW_EMAIL secret) sign in with a fixed code (the
-- REVIEW_CODE secret) instead. Nothing here changes how anyone else signs in.
--
-- This migration only adds the lockout: after 10 wrong codes in an hour the
-- function stops checking codes until the hour has passed, so the fixed code
-- can't be guessed by trying them all. Only the function (secret key) can
-- read or write it.

create table private.review_sign_in_failures (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);

comment on table private.review_sign_in_failures is
  'Wrong codes sent to the review-sign-in Edge Function. Kept for a day.';

revoke all on private.review_sign_in_failures from public, anon, authenticated;

-- True while there have been 10 or more wrong codes in the last hour.
create or replace function public.review_sign_in_locked()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select count(*) >= 10
  from private.review_sign_in_failures
  where at > now() - interval '1 hour';
$$;

-- Records a wrong code, and clears out ones older than a day.
create or replace function public.review_sign_in_failed()
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  delete from private.review_sign_in_failures where at < now() - interval '1 day';
  insert into private.review_sign_in_failures default values;
end $$;

revoke all on function public.review_sign_in_locked() from public, anon, authenticated;
revoke all on function public.review_sign_in_failed() from public, anon, authenticated;
grant execute on function public.review_sign_in_locked() to service_role;
grant execute on function public.review_sign_in_failed() to service_role;
