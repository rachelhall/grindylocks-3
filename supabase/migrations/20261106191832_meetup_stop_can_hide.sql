-- More parks on a meetup (PR 9b), for the app's ⋯ menu: meetup_stops() also
-- says, per stop, whether you moderate that park (so the menu can offer
-- "Hide at Linda Vista"). hide_meetup(..., at_park) still checks it.

create or replace function public.meetup_stops(public.events)
returns jsonb
language sql
stable security definer
set search_path = public
as $$
select coalesce(jsonb_agg(jsonb_build_object(
         'id', k.id, 'slug', k.slug, 'display_name', k.display_name,
         'position', p.position, 'hidden', p.hidden_at is not null,
         'can_hide', private.can_moderate_park(p.park_id)) order by p.position), '[]'::jsonb)
  from event_parks p
  join parks k on k.id = p.park_id
 where p.event_id = $1.id
   and (p.hidden_at is null or private.hosts_series($1.series_id) or private.can_moderate_park(p.park_id));
$$;

revoke all on function public.meetup_stops(public.events) from public, anon;
grant execute on function public.meetup_stops(public.events) to authenticated;
