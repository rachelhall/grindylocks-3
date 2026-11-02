-- Rolled-back check for 20261102150000_admin_seen.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
begin;

-- When an admin last opened a web admin page (Nov 2).
--
-- The web admin's Requests page tags requests that came in since the owner
-- last opened it as NEW. This keeps that "last opened" time, one row per
-- person and page. Only `access_requests` for now; other pages can be added
-- to the check later. Each person reads and writes only their own rows.
--
-- Additive: one new table and one new function. Nothing is replaced or dropped.

create table public.admin_seen (
  user_id uuid not null references public.profiles (id) on delete cascade,
  page text not null check (page in ('access_requests')),
  seen_at timestamptz not null default now(),
  primary key (user_id, page)
);

comment on table public.admin_seen is
  'When each admin last opened a web admin page, for NEW labels. Written through mark_admin_page_seen().';

alter table public.admin_seen enable row level security;

revoke all on public.admin_seen from anon, authenticated;
grant select on public.admin_seen to authenticated;

create policy "Admins read their own seen times"
  on public.admin_seen for select to authenticated
  using (user_id = (select auth.uid()));

-- Sets the signed-in person's "last opened" time for a page to now.
-- Security definer so the table needs no insert or update grants; it only
-- ever touches the caller's own row.
create or replace function public.mark_admin_page_seen(page text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  insert into admin_seen (user_id, page, seen_at)
  values (me, mark_admin_page_seen.page, now())
  on conflict (user_id, page) do update set seen_at = excluded.seen_at;
end;
$$;

comment on function public.mark_admin_page_seen(text) is
  'Records that the signed-in person just opened a web admin page (only access_requests for now).';

revoke all on function public.mark_admin_page_seen(text) from public;
grant execute on function public.mark_admin_page_seen(text) to authenticated;


create temp table results (check_name text, ok boolean, detail text) on commit drop;
grant all on results to anon, authenticated;

-- Signed out.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform public.mark_admin_page_seen('access_requests');
    insert into results values ('anon cannot mark a page seen', false, 'accepted');
  exception when insufficient_privilege then
    insert into results values ('anon cannot mark a page seen', true, 'refused');
  end;
end $$;

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

select public.mark_admin_page_seen('access_requests');
insert into results
select 'owner marks Requests seen and reads it back', count(*) = 1 and max(seen_at) is not null, count(*)::text || ' rows'
from public.admin_seen where page = 'access_requests';

select public.mark_admin_page_seen('access_requests');
insert into results
select 'marking again keeps one row', count(*) = 1, count(*)::text || ' rows'
from public.admin_seen where page = 'access_requests';

do $$
begin
  begin
    perform public.mark_admin_page_seen('somewhere_else');
    insert into results values ('an unknown page is refused', false, 'accepted');
  exception when check_violation then
    insert into results values ('an unknown page is refused', true, 'refused');
  end;
  begin
    insert into public.admin_seen (user_id, page) values (auth.uid(), 'access_requests');
    insert into results values ('no direct inserts', false, 'inserted');
  exception when insufficient_privilege then
    insert into results values ('no direct inserts', true, 'refused');
  end;
end $$;

-- Someone else: can't see the owner's row.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into results
select 'others see no one else''s seen times', count(*) = 0, count(*)::text || ' rows' from public.admin_seen;

reset role;
do $$
declare r text;
begin
  select json_agg(results)::text into r from results;
  raise exception 'RESULTS %', r;
end $$;
