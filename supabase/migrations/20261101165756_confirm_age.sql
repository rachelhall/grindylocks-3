-- The age check (16+) is recorded by the server, never by the app directly.
-- Creates the caller's profile row if it doesn't exist yet. Only the fact
-- and the time are stored, never a birthdate.
create or replace function public.confirm_age()
returns void
language sql
security definer
set search_path = public
as $$
  insert into profiles (id, age_confirmed_at)
  values (auth.uid(), now())
  on conflict (id) do update
    set age_confirmed_at = coalesce(profiles.age_confirmed_at, excluded.age_confirmed_at);
$$;

revoke all on function public.confirm_age() from public, anon;
grant execute on function public.confirm_age() to authenticated;

-- Members can no longer write the age stamp themselves.
revoke insert (age_confirmed_at), update (age_confirmed_at) on public.profiles from authenticated;;
