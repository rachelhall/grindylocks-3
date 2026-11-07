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
