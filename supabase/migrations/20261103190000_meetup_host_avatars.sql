-- Meetups (v2), part 4b: the hosts on a meetup card carry their profile
-- photo, so the Home card's header shows the host's photo like a post card.
--
-- Replaces public.host_list(events) from `meetups_everywhere` with the same
-- rows plus avatar_path. Nothing else changes.

create or replace function public.host_list(public.events)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'avatar_path', p.avatar_path, 'role', h.role)
                            order by h.role = 'host' desc, h.accepted_at), '[]'::jsonb)
    from event_hosts h
    join profiles p on p.id = h.user_id and p.deleted_at is null
   where h.series_id = $1.series_id and (h.role = 'host' or h.accepted_at is not null);
$$;
