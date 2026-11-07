-- Dismiss and delete access requests (Nov 4).
--
-- The web admin's Requests page gets a Dismissed tab: dismissing a request
-- takes it out of Not invited, the Requests count and By city, and Restore
-- puts it back. Because there's one request per email, a dismissed email that
-- asks again stays dismissed (request_access() quietly does nothing).
--
-- Delete is for tests and junk: it removes the row for good, so that email can
-- ask again. Owner only, like everything else on this table.
--
-- Additive: one new column, one new grant and one new policy. Nothing is
-- replaced or dropped.

alter table public.access_requests add column dismissed_at timestamptz;

comment on column public.access_requests.dismissed_at is
  'When the owner dismissed this request; null while it is not dismissed. Dismissed requests stay out of the Requests count.';

grant update (dismissed_at) on public.access_requests to authenticated;
grant delete on public.access_requests to authenticated;

-- The existing update policy ("Owner marks access requests invited") already
-- limits updates to the owner, and the column grants limit them to
-- invited_at and dismissed_at.
create policy "Owner deletes access requests"
  on public.access_requests for delete to authenticated
  using (private.has_role('owner'));
