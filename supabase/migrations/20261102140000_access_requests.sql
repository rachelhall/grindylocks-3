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
