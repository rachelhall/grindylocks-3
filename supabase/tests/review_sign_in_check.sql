-- Checks for migration review_sign_in. Applies it and runs the checks in one
-- transaction, then ends with an error carrying the results (RESULTS [...]),
-- so nothing is kept. Every row should say "ok": true.
begin;
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

create temp table r(step text, ok boolean) on commit drop;
insert into r select 'starts unlocked', not public.review_sign_in_locked();
select public.review_sign_in_failed() from generate_series(1,9);
insert into r select 'unlocked after 9', not public.review_sign_in_locked();
select public.review_sign_in_failed();
insert into r select 'locked after 10', public.review_sign_in_locked();
insert into r select 'anon cannot run', not has_function_privilege('anon','public.review_sign_in_failed()','execute');
insert into r select 'authenticated cannot run', not has_function_privilege('authenticated','public.review_sign_in_locked()','execute');
insert into r select 'service_role can run', has_function_privilege('service_role','public.review_sign_in_locked()','execute');
insert into r select 'table hidden from authenticated', not has_table_privilege('authenticated','private.review_sign_in_failures','select');
do $$ begin raise exception 'RESULTS %', (select json_agg(r) from r); end $$;
