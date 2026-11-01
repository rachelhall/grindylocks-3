-- Invites, following and blocking (M3, Nov 1).
--
-- Mostly additive: a column, functions, triggers and an auth hook. Two
-- grants are narrowed, because the old ones were wider than the rules meant:
--   - follows: members could update any column of a follow request sent to
--     them (including who it's from). Now only `status`, and only
--     pending → accepted.
--   - follows: members could set `status` and `created_at` on insert. The
--     status trigger already overrode status; now only the two ids.
--
-- Invites
-- - Every member starts with 5 (profiles.invites_remaining). Making a link
--   takes one; cancelling an unused link gives it back, and so does a link
--   that expires unused (7 days). Expired links are returned lazily, the next
--   time the member makes or lists invites.
-- - Codes are 8 characters from an alphabet without 0/O or 1/I, shown as
--   XXXX-XXXX.
-- - New accounts can only be created with a valid code: the app sends it as
--   user metadata when it asks for a sign-in code, and the
--   before_user_created auth hook checks it and claims it for that email
--   (private.invite_claims). Members can edit their own metadata later, so
--   nothing after sign-up trusts it; the claim is what counts. (Turn the
--   hook on, then sign-ups back on, in the dashboard; see supabase/README.md.)
-- - After the age check creates the profile, the app calls
--   redeem_my_invite(), which finds the claim for the member's email, marks
--   the invite used, makes the new member follow their inviter (a request if
--   the inviter is private) and tells the inviter. The inviter doesn't
--   follow back automatically.
--
-- Following
-- - Following a private account makes a request (existing trigger).
-- - Switching an account from private to public accepts its pending requests.
--
-- Blocking
-- - Existing rules already hide blocked people both ways and end follows.
--   my_blocked_accounts() lists the people you blocked, which the profiles
--   read rule otherwise hides from you.

-- 1. Invites -----------------------------------------------------------------------

alter table public.invites add column returned_at timestamptz;

comment on column public.invites.returned_at is
  'Set when an unused invite expired and went back into the inviter''s count.';

-- Which email signed up with which code. Written only by the sign-up hook.
create table private.invite_claims (
  code       text primary key references public.invites (code),
  email      text not null,
  claimed_at timestamptz not null default now()
);
create index invite_claims_email_idx on private.invite_claims (lower(email));
revoke all on private.invite_claims from public, anon, authenticated;

-- Gives back every expired, unused invite of this member. Returns how many.
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
    returning 1
  )
  select count(*) into n from returned;
  if n > 0 then
    update profiles set invites_remaining = invites_remaining + n where id = member;
  end if;
  return n;
end $$;

-- 8 characters, no 0/O or 1/I, so it can be read out loud or typed.
create or replace function private.new_invite_code()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end $$;

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
  select invites_remaining into left_count from profiles where profiles.id = me;
  if coalesce(left_count, 0) <= 0 then
    raise exception 'no_invites_left';
  end if;

  loop
    new_code := private.new_invite_code();
    exit when not exists (select 1 from invites i where i.code = new_code);
  end loop;

  update profiles set invites_remaining = invites_remaining - 1 where profiles.id = me;
  return query
    insert into invites (code, inviter_id) values (new_code, me)
    returning invites.id, invites.code, invites.expires_at;
end $$;

-- Cancels one of your unused links and gives the invite back.
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
    and cancelled_at is null and returned_at is null and expires_at > now();
  if found then
    update profiles set invites_remaining = invites_remaining + 1 where id = me;
  end if;
end $$;

-- Your invites, newest first, with how many you have left. Expired ones are
-- given back first. state: active, used, expired or cancelled.
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
begin
  if me is null then
    return;
  end if;
  perform private.return_expired_invites(me);
  return query
    select i.id, i.code, i.created_at, i.expires_at, i.used_at,
           case when u.deleted_at is null then u.username::text end,
           case
             when i.used_by is not null then 'used'
             when i.cancelled_at is not null then 'cancelled'
             when i.returned_at is not null or i.expires_at <= now() then 'expired'
             else 'active'
           end,
           (select p.invites_remaining from profiles p where p.id = me)
    from invites i
    left join profiles u on u.id = i.used_by
    where i.inviter_id = me
    order by i.created_at desc
    limit 50;
end $$;

-- How many invites you have left, for the Invites button.
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
  return (select invites_remaining from profiles where id = auth.uid());
end $$;

-- For the "@name invited you" screen, before signing in. Only answers for a
-- valid, unused, unexpired code, and only with the inviter's username.
create or replace function public.invite_preview(code text)
returns table (inviter_username text)
language sql stable security definer
set search_path = public
as $$
  select p.username::text
  from invites i
  join profiles p on p.id = i.inviter_id
  where i.code = upper(regexp_replace(coalesce(invite_preview.code, ''), '[^A-Za-z0-9]', '', 'g'))
    and i.used_by is null and i.cancelled_at is null and i.returned_at is null
    and i.expires_at > now()
    and p.deleted_at is null and p.banned_at is null
    and not exists (select 1 from private.invite_claims c where c.code = i.code);
$$;

-- Called once onboarding has a profile (after the age check). Uses the code
-- the account was created with, so it can't be swapped for another one.
-- Returns the inviter's username, or null when there's nothing to redeem.
create or replace function public.redeem_my_invite()
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_email text;
  joined timestamptz;
  inv invites%rowtype;
begin
  if me is null or not exists (select 1 from profiles where id = me) then
    return null;
  end if;

  -- Already redeemed: answer the same again.
  select * into inv from invites where used_by = me;
  if found then
    return (select username::text from profiles where id = inv.inviter_id);
  end if;

  select lower(email), created_at into my_email, joined from auth.users where id = me;
  if my_email is null then
    return null;
  end if;

  -- The code this email signed up with, made before the account was.
  select i.* into inv
  from private.invite_claims c
  join invites i on i.code = c.code
  where lower(c.email) = my_email and i.used_by is null and i.cancelled_at is null
    and i.created_at <= joined
  order by c.claimed_at desc
  limit 1
  for update of i;
  if not found then
    return null;
  end if;

  -- The hook checked it at sign-up; it may have expired since. Still honour
  -- it, since this account could only be created with it.
  update invites set used_by = me, used_at = now() where id = inv.id;

  if not private.is_banned(inv.inviter_id)
     and not exists (select 1 from blocks
                     where (blocker_id = me and blocked_id = inv.inviter_id)
                        or (blocker_id = inv.inviter_id and blocked_id = me)) then
    insert into follows (follower_id, followee_id) values (me, inv.inviter_id)
    on conflict do nothing;
  end if;

  insert into notifications (recipient_id, kind, actor_id) values (inv.inviter_id, 'invite_used', me);

  return (select username::text from profiles where id = inv.inviter_id);
end $$;

-- 2. The sign-up gate (Authentication → Hooks → Before User Created) -------------

create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text := upper(regexp_replace(coalesce(event->'user'->'user_metadata'->>'invite_code', ''), '[^A-Za-z0-9]', '', 'g'));
  v_email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if v_code = '' or v_email = '' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'invite_required'));
  end if;

  if not exists (
    select 1 from invites i
    join profiles p on p.id = i.inviter_id
    where i.code = v_code
      and i.used_by is null and i.cancelled_at is null and i.returned_at is null
      and i.expires_at > now()
      and p.deleted_at is null and p.banned_at is null
  )
  -- Someone else already signed up with this code but hasn't finished.
  or exists (select 1 from private.invite_claims c where c.code = v_code and lower(c.email) <> v_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'invite_invalid'));
  end if;

  -- Same email asking again (a resent code) keeps its claim.
  insert into private.invite_claims (code, email) values (v_code, v_email)
  on conflict (code) do nothing;

  return '{}'::jsonb;
end $$;

-- 3. Following -----------------------------------------------------------------------

revoke insert, update on public.follows from authenticated;
grant insert (follower_id, followee_id) on public.follows to authenticated;
grant update (status) on public.follows to authenticated;

-- The only change to a follow is accepting a request.
create or replace function private.guard_follow_update()
returns trigger
language plpgsql security invoker
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if not (old.status = 'pending' and new.status = 'accepted') then
    raise exception 'A follow can only go from requested to accepted';
  end if;
  return new;
end $$;

create trigger follows_guard_update
  before update on public.follows
  for each row execute function private.guard_follow_update();

-- Going public accepts everyone waiting.
create or replace function private.accept_requests_when_public()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.is_private and not new.is_private then
    update follows set status = 'accepted' where followee_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

create trigger profiles_accept_requests_when_public
  after update of is_private on public.profiles
  for each row execute function private.accept_requests_when_public();

-- Your pending follow requests, newest first. A function, so a request from
-- someone you've since blocked (or who blocked you) drops out.
create or replace function public.my_follow_requests()
returns table (follower_id uuid, username text, avatar_path text, disciplines public.discipline[], requested_at timestamptz)
language sql stable security invoker
set search_path = public
as $$
  select f.follower_id, p.username::text, p.avatar_path, p.disciplines, f.created_at
  from follows f
  join profiles p on p.id = f.follower_id
  where f.followee_id = auth.uid() and f.status = 'pending'
    and p.deleted_at is null and p.username is not null
  order by f.created_at desc;
$$;

-- 4. Blocking -------------------------------------------------------------------------

-- The people you blocked, for Settings › Blocked accounts. The profiles read
-- rule hides them from you otherwise, so this runs as the owner.
create or replace function public.my_blocked_accounts()
returns table (id uuid, username text, avatar_path text, blocked_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select p.id, coalesce(p.username::text, ''), p.avatar_path, b.created_at
  from blocks b
  join profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

-- 5. Permissions ---------------------------------------------------------------------

revoke all on function private.return_expired_invites(uuid) from public, anon, authenticated;
revoke all on function private.new_invite_code() from public, anon, authenticated;
revoke all on function private.guard_follow_update() from public, anon;
revoke all on function private.accept_requests_when_public() from public, anon, authenticated;
revoke all on function public.create_invite() from public, anon;
revoke all on function public.cancel_invite(uuid) from public, anon;
revoke all on function public.my_invites() from public, anon;
revoke all on function public.my_invite_count() from public, anon;
revoke all on function public.invite_preview(text) from public;
revoke all on function public.redeem_my_invite() from public, anon;
revoke all on function public.before_user_created(jsonb) from public, anon, authenticated;
revoke all on function public.my_follow_requests() from public, anon;
revoke all on function public.my_blocked_accounts() from public, anon;

grant execute on function public.create_invite() to authenticated;
grant execute on function public.cancel_invite(uuid) to authenticated;
grant execute on function public.my_invites() to authenticated;
grant execute on function public.my_invite_count() to authenticated;
-- The one thing a signed-out visitor can ask: whose invite this is.
grant execute on function public.invite_preview(text) to anon, authenticated;
grant execute on function public.redeem_my_invite() to authenticated;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
grant execute on function public.my_follow_requests() to authenticated;
grant execute on function public.my_blocked_accounts() to authenticated;
