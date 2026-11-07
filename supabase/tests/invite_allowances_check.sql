-- Rolled-back check for 20261103003556_invite_allowances.sql.
-- Runs the migration and the checks in one transaction, then raises an
-- exception carrying the results (RESULTS [...]), so nothing is kept.
-- Every row should have ok = true. Test people are made up (zz_inv_*).
begin;

-- Invite allowances by role (Nov 2).
--
-- How many invites a member has now depends on their role, instead of a
-- stored count that started at 5:
--   - owner and city admins: unlimited
--   - park admins and park contributors: 10
--   - everyone else: 5
-- (Only roles that are accepted and haven't ended count.)
--
-- An invite counts against the allowance while it's waiting to be used, once
-- someone signed up with it, or once it's used. Cancelling an unused link or
-- letting it expire unused gives it back, as before. Because the number is
-- worked out each time, a change of role changes it at once, either way.
--
-- my_invites() and my_invite_count() keep their shapes; the count is null
-- for unlimited. profiles.invites_remaining is no longer read or written
-- (migrations are additive, so the column stays).

-- 1. The allowance -------------------------------------------------------------------

-- How many invites a member may have out: null means unlimited.
create or replace function private.invite_allowance(member uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from role_assignments r
      where r.user_id = member and r.accepted_at is not null and r.ended_at is null
        and r.role in ('owner', 'city_admin')
    ) then null
    when exists (
      select 1 from role_assignments r
      where r.user_id = member and r.accepted_at is not null and r.ended_at is null
        and r.role in ('park_admin', 'park_contributor')
    ) then 10
    else 5
  end;
$$;

-- Invites that count against the allowance: not cancelled, and used, claimed
-- at sign-up, or still waiting.
create or replace function private.invites_in_use(member uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select count(*)::integer
  from invites i
  where i.inviter_id = member
    and i.cancelled_at is null
    and (
      i.used_by is not null
      or exists (select 1 from private.invite_claims c where c.code = i.code)
      or (i.returned_at is null and i.expires_at > now())
    );
$$;

-- Invites left: null for unlimited, never below 0.
create or replace function private.invites_left(member uuid)
returns smallint
language sql stable security definer
set search_path = public
as $$
  select case
    when private.invite_allowance(member) is null then null
    else greatest(private.invite_allowance(member) - private.invites_in_use(member), 0)::smallint
  end;
$$;

revoke all on function private.invite_allowance(uuid) from public, anon, authenticated;
revoke all on function private.invites_in_use(uuid) from public, anon, authenticated;
revoke all on function private.invites_left(uuid) from public, anon, authenticated;

-- 2. Expired links just get marked; there's no stored count to give back to --------

create or replace function private.return_expired_invites(member uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  n integer;
begin
  with returned as (
    update invites
    set returned_at = now()
    where inviter_id = member and used_by is null and cancelled_at is null
      and returned_at is null and expires_at <= now()
      and not exists (select 1 from private.invite_claims c where c.code = invites.code)
    returning 1
  )
  select count(*) into n from returned;
  return n;
end $$;

-- 3. Making, cancelling and listing invites ------------------------------------------

-- Makes a new invite link: id, code and expiry. Fails with 'no_invites_left'.
create or replace function public.create_invite()
returns table (id uuid, code text, expires_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  left_count smallint;
  new_code text;
begin
  if me is null or not private.is_active_member() then
    raise exception 'not_allowed';
  end if;

  -- One at a time per member, so two taps can't spend the same invite.
  perform 1 from profiles where profiles.id = me for update;
  perform private.return_expired_invites(me);
  left_count := private.invites_left(me);
  if left_count is not null and left_count <= 0 then
    raise exception 'no_invites_left';
  end if;

  loop
    new_code := private.new_invite_code();
    exit when not exists (select 1 from invites i where i.code = new_code);
  end loop;

  return query
    insert into invites (code, inviter_id) values (new_code, me)
    returning invites.id, invites.code, invites.expires_at;
end $$;

-- Cancels one of your unused links; the invite counts as yours again.
create or replace function public.cancel_invite(invite uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  update invites
  set cancelled_at = now()
  where id = invite and inviter_id = me and used_by is null
    and cancelled_at is null and returned_at is null and expires_at > now()
    and not exists (select 1 from private.invite_claims c where c.code = invites.code);
end $$;

-- Your invites, newest first, with how many you have left (null: unlimited).
-- state: active, used, expired or cancelled.
create or replace function public.my_invites()
returns table (
  id uuid,
  code text,
  created_at timestamptz,
  expires_at timestamptz,
  used_at timestamptz,
  used_by_username text,
  state text,
  invites_remaining smallint
)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  left_count smallint;
begin
  if me is null then
    return;
  end if;
  perform private.return_expired_invites(me);
  left_count := private.invites_left(me);
  return query
    select i.id, i.code, i.created_at, i.expires_at, i.used_at,
           case when u.deleted_at is null then u.username::text end,
           case
             when i.used_by is not null then 'used'
             when i.cancelled_at is not null then 'cancelled'
             when i.returned_at is not null or i.expires_at <= now() then 'expired'
             else 'active'
           end,
           left_count
    from invites i
    left join profiles u on u.id = i.used_by
    where i.inviter_id = me
    order by i.created_at desc
    limit 50;
end $$;

-- How many invites you have left, for the Invites button. Null: unlimited.
create or replace function public.my_invite_count()
returns smallint
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return 0;
  end if;
  perform private.return_expired_invites(auth.uid());
  return private.invites_left(auth.uid());
end $$;

comment on column public.profiles.invites_remaining is
  'Unused since Nov 2, 2026: invites left now come from private.invites_left(), by role.';

create temp table results (check_name text, ok boolean, detail text) on commit drop;
create temp table ids (name text primary key, id uuid) on commit drop;
grant all on results, ids to authenticated;

create function pg_temp.id(n text) returns uuid language sql stable as $$ select id from ids where name = n $$;
grant execute on function pg_temp.id(text) to authenticated;
create function pg_temp.who(n text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', (select id from ids where name = n), 'role', 'authenticated')::text, true)
$$;
create function pg_temp.check(name text, ok boolean, detail text default '') returns void language sql as $$
  insert into results values (name, coalesce(ok, false), detail)
$$;
grant execute on function pg_temp.check(text, boolean, text) to authenticated;
create function pg_temp.make(n integer) returns integer language plpgsql as $$
declare made integer := 0;
begin
  for i in 1..n loop
    begin
      perform public.create_invite();
      made := made + 1;
    exception when others then
      if sqlerrm <> 'no_invites_left' then raise; end if;
    end;
  end loop;
  return made;
end $$;
grant execute on function pg_temp.make(integer) to authenticated;

do $$
declare
  n text; park_p uuid; metro_m uuid;
begin
  select id, metro_area_id into park_p, metro_m from parks order by slug limit 1;
  foreach n in array array['mem', 'con', 'padm', 'city', 'own', 'gone'] loop
    insert into ids values (n, gen_random_uuid());
    insert into profiles (id, username, onboarded_at, age_confirmed_at, home_metro_area_id, disciplines)
    values ((select id from ids where name = n), 'zz_inv_' || n, now(), now(), metro_m, '{inline}');
  end loop;
  insert into role_assignments (user_id, role, park_id, accepted_at) values
    ((select id from ids where name = 'con'), 'park_contributor', park_p, now()),
    ((select id from ids where name = 'padm'), 'park_admin', park_p, now());
  insert into role_assignments (user_id, role, metro_area_id, accepted_at) values
    ((select id from ids where name = 'city'), 'city_admin', metro_m, now());
  insert into role_assignments (user_id, role, accepted_at) values
    ((select id from ids where name = 'own'), 'owner', now());
  -- A contributor whose role ended: back to 5.
  insert into role_assignments (user_id, role, park_id, accepted_at, ended_at) values
    ((select id from ids where name = 'gone'), 'park_contributor', park_p, now() - interval '1 day', now());
end $$;

/* Allowances ------------------------------------------------------------------------- */

select pg_temp.who('mem'); set local role authenticated;
select pg_temp.check('member starts with 5', public.my_invite_count() = 5, public.my_invite_count()::text);
select pg_temp.check('member can make 5, not 6', pg_temp.make(6) = 5);
select pg_temp.check('member then has 0', public.my_invite_count() = 0);
select pg_temp.check('my_invites shows 0 on every row', (select bool_and(invites_remaining = 0) and count(*) = 5 from public.my_invites()));
select public.cancel_invite((select id from public.my_invites() limit 1));
select pg_temp.check('cancelling gives one back', public.my_invite_count() = 1);
reset role;

-- An unused invite that expired comes back; a used one doesn't.
update invites set expires_at = now() - interval '1 minute'
 where id = (select id from invites where inviter_id = pg_temp.id('mem') and cancelled_at is null order by created_at limit 1);
update invites set used_by = pg_temp.id('gone'), used_at = now()
 where id = (select id from invites where inviter_id = pg_temp.id('mem') and cancelled_at is null and expires_at > now() order by created_at limit 1);
select pg_temp.who('mem'); set local role authenticated;
select pg_temp.check('expired unused comes back, used stays spent', public.my_invite_count() = 2, public.my_invite_count()::text);
select pg_temp.check('expired shows as expired', exists (select 1 from public.my_invites() where state = 'expired'));
reset role;

-- A claimed (signed up, not yet redeemed) invite stays spent even after it expires.
insert into private.invite_claims (code, email)
select code, 'zz_inv_claim@example.com' from invites
 where inviter_id = pg_temp.id('mem') and cancelled_at is null and used_by is null and expires_at > now()
 order by created_at limit 1;
update invites set expires_at = now() - interval '1 minute'
 where code in (select code from private.invite_claims where email = 'zz_inv_claim@example.com');
select pg_temp.who('mem'); set local role authenticated;
select pg_temp.check('a claimed invite stays spent after expiry', public.my_invite_count() = 2, public.my_invite_count()::text);
reset role;
select public.cancel_invite(i.id) from invites i
 where i.code in (select code from private.invite_claims where email = 'zz_inv_claim@example.com');
select pg_temp.check('a claimed invite can''t be cancelled',
  exists (select 1 from invites i where i.code in (select code from private.invite_claims where email = 'zz_inv_claim@example.com')
          and i.cancelled_at is null));
reset role;

select pg_temp.who('con'); set local role authenticated;
select pg_temp.check('contributor has 10', public.my_invite_count() = 10);
select pg_temp.check('contributor can make 10, not 11', pg_temp.make(11) = 10);
reset role;

select pg_temp.who('padm'); set local role authenticated;
select pg_temp.check('park admin has 10', public.my_invite_count() = 10);
reset role;

select pg_temp.who('gone'); set local role authenticated;
select pg_temp.check('an ended role counts for nothing (5)', public.my_invite_count() = 5);
reset role;

select pg_temp.who('city'); set local role authenticated;
select pg_temp.check('city admin is unlimited (null)', public.my_invite_count() is null);
select pg_temp.check('city admin can make 12', pg_temp.make(12) = 12);
select pg_temp.check('my_invites says unlimited (null)', (select bool_and(invites_remaining is null) and count(*) = 12 from public.my_invites()));
reset role;

select pg_temp.who('own'); set local role authenticated;
select pg_temp.check('owner is unlimited', public.my_invite_count() is null and pg_temp.make(7) = 7);
reset role;

-- Losing the city admin role drops to 5, with 12 already out: 0 left.
update role_assignments set ended_at = now() where user_id = pg_temp.id('city');
select pg_temp.who('city'); set local role authenticated;
select pg_temp.check('a former city admin with 12 out has 0 left', public.my_invite_count() = 0);
reset role;

select pg_temp.check('helpers aren''t callable by members',
  not has_function_privilege('authenticated', 'private.invites_left(uuid)', 'execute'));

/* Results ----------------------------------------------------------------------------- */

do $$
declare r text;
begin
  select json_agg(results)::text into r from results;
  raise exception 'RESULTS %', r;
end $$;
