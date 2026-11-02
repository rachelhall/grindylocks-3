-- Rolled-back check for 20261102140000_access_requests.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true.
begin;

-- Access requests from grindylocks.com (Nov 2).
--
-- The marketing page has a "Request access" form: email, home city and what
-- you skate. It's the third thing a signed-out visitor can do, after
-- invite_preview() and welcome_metro_areas(), and it can only write: nobody
-- signed out can read a request back, or tell whether an email is already on
-- the list. Rachel (owner) reads them, and marks one invited once she's sent
-- an invite link.
--
-- Additive: one new table and one new function. Nothing is replaced or dropped.

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null
    check (char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  home_city text check (home_city is null or char_length(home_city) between 1 and 100),
  disciplines discipline[] not null default '{}',
  created_at timestamptz not null default now(),
  invited_at timestamptz
);

comment on table public.access_requests is
  'Requests for an invite from the grindylocks.com form. Written only through request_access(); read by the owner.';

-- One request per email, whatever its case.
create unique index access_requests_email_key on public.access_requests (lower(email));
create index access_requests_created_at_idx on public.access_requests (created_at desc);

alter table public.access_requests enable row level security;

revoke all on public.access_requests from anon, authenticated;
grant select on public.access_requests to authenticated;
grant update (invited_at) on public.access_requests to authenticated;

create policy "Owner reads access requests"
  on public.access_requests for select to authenticated
  using (private.has_role('owner'));

create policy "Owner marks access requests invited"
  on public.access_requests for update to authenticated
  using (private.has_role('owner'))
  with check (private.has_role('owner'));

-- The form's only way in. Quietly succeeds for an email that's already on the
-- list, so the form can't be used to check who has asked.
create or replace function public.request_access(
  email text,
  home_city text default null,
  disciplines discipline[] default '{}'
)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  clean_email text := lower(btrim(coalesce(request_access.email, '')));
  clean_city text := nullif(btrim(coalesce(request_access.home_city, '')), '');
begin
  if clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(clean_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if clean_city is not null and char_length(clean_city) > 100 then
    raise exception 'city_too_long' using errcode = '22023';
  end if;

  -- A ceiling on the whole form, so a script can't fill the table.
  if (select count(*) from access_requests where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'too_many_requests' using errcode = '53400';
  end if;

  insert into access_requests (email, home_city, disciplines)
  values (
    clean_email,
    clean_city,
    coalesce((select array_agg(distinct d) from unnest(request_access.disciplines) d where d is not null), '{}')
  )
  on conflict (lower(email)) do nothing;
end;
$$;

comment on function public.request_access(text, text, discipline[]) is
  'Adds an invite request from the grindylocks.com form. Signed-out visitors can call it; nobody but the owner can read requests.';

revoke all on function public.request_access(text, text, discipline[]) from public;
grant execute on function public.request_access(text, text, discipline[]) to anon, authenticated;


create temp table results (check_name text, ok boolean, detail text) on commit drop;
grant all on results to anon, authenticated;

-- Signed out.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select public.request_access('  Check.Person@Example.com ', ' San Diego ', array['inline','quad','inline']::discipline[]);
insert into results values ('anon can request access', true, null);

select public.request_access('check.person@example.COM', 'Elsewhere', '{}');
insert into results values ('a repeat email quietly succeeds', true, null);

do $$
begin
  begin
    perform public.request_access('not-an-email', null, '{}');
    insert into results values ('a bad email is refused', false, 'accepted');
  exception when others then
    insert into results values ('a bad email is refused', sqlerrm = 'invalid_email', sqlerrm);
  end;
  begin
    perform public.request_access('long@example.com', repeat('x', 101), '{}');
    insert into results values ('a long city is refused', false, 'accepted');
  exception when others then
    insert into results values ('a long city is refused', sqlerrm = 'city_too_long', sqlerrm);
  end;
end $$;

do $$
declare n bigint;
begin
  begin
    select count(*) into n from public.access_requests;
    insert into results values ('anon cannot read requests', n = 0, n::text || ' rows');
  exception when insufficient_privilege then
    insert into results values ('anon cannot read requests', true, 'refused');
  end;
  begin
    insert into public.access_requests (email) values ('direct@example.com');
    insert into results values ('anon cannot insert directly', false, 'inserted');
  exception when insufficient_privilege then
    insert into results values ('anon cannot insert directly', true, 'refused');
  end;
end $$;

-- A signed-in member without a role.
reset role;
do $$
declare member uuid;
begin
  select p.id into member from profiles p
  where not exists (select 1 from role_assignments r where r.user_id = p.id and r.ended_at is null)
  limit 1;
  -- No such member yet (Nov 2: Rachel is the only account): a made-up ID
  -- behaves the same, since it holds no role.
  member := coalesce(member, gen_random_uuid());
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;
insert into results
select 'a member sees no requests', count(*) = 0, count(*)::text || ' rows' from public.access_requests;

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
insert into results
select 'owner sees one row for the repeated email', count(*) = 1, count(*)::text || ' rows'
from public.access_requests where lower(email) = 'check.person@example.com';
insert into results
select 'email trimmed and lowercased, city trimmed, disciplines deduped',
  email = 'check.person@example.com' and home_city = 'San Diego' and disciplines = array['inline','quad']::discipline[],
  email || ' / ' || home_city || ' / ' || disciplines::text
from public.access_requests where lower(email) = 'check.person@example.com';
update public.access_requests set invited_at = now() where lower(email) = 'check.person@example.com';
insert into results
select 'owner can mark invited', invited_at is not null, null
from public.access_requests where lower(email) = 'check.person@example.com';

reset role;
do $$
declare r text;
begin
  select json_agg(results)::text into r from results;
  raise exception 'RESULTS %', r;
end $$;
