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
