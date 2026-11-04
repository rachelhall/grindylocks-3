-- Rolled-back check for 20261104140000_access_requests_dismiss.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
begin;

alter table public.access_requests add column dismissed_at timestamptz;

comment on column public.access_requests.dismissed_at is
  'When the owner dismissed this request; null while it is not dismissed. Dismissed requests stay out of the Requests count.';

grant update (dismissed_at) on public.access_requests to authenticated;
grant delete on public.access_requests to authenticated;

create policy "Owner deletes access requests"
  on public.access_requests for delete to authenticated
  using (private.has_role('owner'));


create temp table results (check_name text, ok boolean, detail text) on commit drop;
grant all on results to anon, authenticated;

-- Two requests from the form, signed out.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public.request_access('dismiss-check-1@example.com', 'Testville', '{inline}');
select public.request_access('dismiss-check-2@example.com', null, '{quad}');

do $$
begin
  begin
    delete from public.access_requests where email like 'dismiss-check-%';
    insert into results values ('anon cannot delete', false, 'deleted');
  exception when insufficient_privilege then
    insert into results values ('anon cannot delete', true, 'refused');
  end;
end $$;

-- Someone signed in who isn't the owner: sees nothing, so changes nothing.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;

with d as (delete from public.access_requests where email like 'dismiss-check-%' returning 1)
insert into results select 'a non-owner deletes nothing', count(*) = 0, count(*)::text || ' rows' from d;
with u as (update public.access_requests set dismissed_at = now() where email like 'dismiss-check-%' returning 1)
insert into results select 'a non-owner dismisses nothing', count(*) = 0, count(*)::text || ' rows' from u;

-- The owner.
reset role;
do $$
declare owner_id uuid;
begin
  select user_id into owner_id from role_assignments
  where role = 'owner' and accepted_at is not null and ended_at is null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

with u as (update public.access_requests set dismissed_at = now() where email = 'dismiss-check-1@example.com' returning 1)
insert into results select 'the owner dismisses', count(*) = 1, count(*)::text || ' rows' from u;

do $$
begin
  begin
    update public.access_requests set email = 'changed@example.com' where email = 'dismiss-check-1@example.com';
    insert into results values ('the owner still cannot change the email', false, 'changed');
  exception when insufficient_privilege then
    insert into results values ('the owner still cannot change the email', true, 'refused');
  end;
end $$;

-- Asking again keeps it dismissed.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public.request_access('Dismiss-Check-1@example.com', 'Elsewhere', '{skateboard}');
reset role;
insert into results
select 'a dismissed email that asks again stays dismissed, unchanged',
  count(*) = 1 and bool_and(dismissed_at is not null and home_city = 'Testville'),
  count(*)::text || ' rows'
from public.access_requests where lower(email) = 'dismiss-check-1@example.com';

-- Restore, then delete.
do $$
declare owner_id uuid;
begin
  select user_id into owner_id from role_assignments
  where role = 'owner' and accepted_at is not null and ended_at is null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

with u as (update public.access_requests set dismissed_at = null where email = 'dismiss-check-1@example.com' returning dismissed_at)
insert into results select 'the owner restores', count(*) = 1 and bool_and(dismissed_at is null), count(*)::text || ' rows' from u;

with d as (delete from public.access_requests where email like 'dismiss-check-%' returning 1)
insert into results select 'the owner deletes', count(*) = 2, count(*)::text || ' rows' from d;

-- A deleted email can ask again.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public.request_access('dismiss-check-2@example.com', null, '{quad}');
reset role;
insert into results
select 'a deleted email can ask again', count(*) = 1 and bool_and(dismissed_at is null), count(*)::text || ' rows'
from public.access_requests where email = 'dismiss-check-2@example.com';

do $$
declare r text;
begin
  select json_agg(results)::text into r from results;
  raise exception 'RESULTS %', r;
end $$;
