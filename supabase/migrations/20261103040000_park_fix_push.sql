-- M5 follow-up (Nov 2): "Your fix is live" pushes.
--
-- Park fixes going live were queued for push (enqueue_push_notification has
-- listed park_report_accepted since the push migration), but push_claim()
-- never returned the park, so push-send had nothing to say and dropped
-- them. This returns the park's name and slug for that kind, so the push
-- reads like the bell row ("Your fix to <park> is live. Thanks.") and
-- tapping it opens the park.
--
-- Adding park_slug changes push_claim()'s columns, which create or replace
-- can't do, so it's dropped and created again with the same grants. It's
-- otherwise the version from 20261103030000_caption_mentions. Only the
-- push-send Edge Function calls it, and the new push-send reads park_slug.

drop function public.push_claim(integer);

create function public.push_claim(max_rows integer default 100)
returns table (
  outbox_id bigint,
  send boolean,
  kind text,
  actor_username text,
  comment_body text,
  post_id uuid,
  park_name text,
  park_slug text,
  metro_name text,
  devices jsonb
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select o.id
      from private.push_outbox o
     where o.sent_at is null
       and o.attempts < 3
       and o.created_at > now() - interval '1 day'
       and (o.claimed_at is null or o.claimed_at < now() - interval '2 minutes')
     order by o.id
     limit greatest(1, least(max_rows, 500))
     for update skip locked
  ),
  claimed as (
    update private.push_outbox o
       set claimed_at = now(), attempts = o.attempts + 1
      from picked
     where o.id = picked.id
    returning o.*
  ),
  -- Notifications: the same reply / mention / comment split as the bell.
  from_notifications as (
    select cl.id as oid,
           cl.recipient_id as rid,
           case
             when n.kind <> 'comment' then n.kind::text
             when c.reply_to_user_id = cl.recipient_id
               or (select pc.author_id from comments pc where pc.id = c.parent_id) = cl.recipient_id then 'reply'
             when p.author_id = cl.recipient_id then 'comment'
             else 'mention'
           end as k,
           n.actor_id as aid,
           a.username::text as uname,
           case when n.kind = 'caption_mention' then p.caption else c.body end as cbody,
           n.post_id as pid,
           fx.display_name::text as pk,
           fx.slug::text as pslug,
           null::text as metro,
           (n.id is not null
             and (n.comment_id is null or (c.id is not null and c.deleted_at is null))
             and (n.post_id is null or private.can_see_post_as(n.post_id, cl.recipient_id))
             and (a.id is null or a.deleted_at is null)) as ok
      from claimed cl
      left join notifications n on n.id = cl.notification_id
      left join comments c on c.id = n.comment_id
      left join posts p on p.id = n.post_id
      left join profiles a on a.id = n.actor_id
      -- A park fix going live names the park.
      left join parks fx on fx.id = n.park_id and n.kind = 'park_report_accepted'
     where cl.notification_id is not null
  ),
  from_announcements as (
    select cl.id,
           cl.recipient_id,
           case when an.kind = 'visiting' then 'visiting' else 'someone_new' end,
           an.user_id,
           u.username::text,
           null::text,
           null::uuid,
           pk.display_name::text,
           pk.slug::text,
           ma.name::text,
           (an.id is not null
             and u.deleted_at is null
             and u.banned_at is null
             and r.home_metro_area_id = an.metro_area_id)
      from claimed cl
      left join announcements an on an.id = cl.announcement_id
      left join profiles u on u.id = an.user_id
      left join profiles r on r.id = cl.recipient_id
      left join parks pk on pk.id = an.park_id
      left join metro_areas ma on ma.id = an.metro_area_id
     where cl.announcement_id is not null
  ),
  everything as (
    select * from from_notifications
    union all
    select * from from_announcements
  )
  select e.oid,
         (e.ok
           and r.deleted_at is null
           and (e.aid is null or not exists (
                 select 1 from blocks b
                  where (b.blocker_id = e.rid and b.blocked_id = e.aid)
                     or (b.blocker_id = e.aid and b.blocked_id = e.rid)))
           and case e.k
                 when 'comment' then coalesce(s.comments, true)
                 when 'reply' then coalesce(s.comments, true)
                 when 'mention' then coalesce(s.mentions, true)
                 when 'caption_mention' then coalesce(s.mentions, true)
                 when 'tag' then coalesce(s.tags, true)
                 when 'filmer_credit' then coalesce(s.filmer_credits, true)
                 when 'invite_used' then coalesce(s.invites, true)
                 when 'someone_new' then coalesce(s.someone_new, true)
                 when 'visiting' then coalesce(s.someone_new, true)
                 when 'park_report_accepted' then coalesce(s.park_fixes, true)
                 else false
               end
           and dv.list is not null),
         e.k,
         e.uname,
         left(e.cbody, 140),
         e.pid,
         e.pk,
         e.pslug,
         e.metro,
         coalesce(dv.list, '[]'::jsonb)
    from everything e
    join profiles r on r.id = e.rid
    left join private.push_settings s on s.user_id = e.rid
    left join lateral (
      select jsonb_agg(jsonb_build_object('token', d.token, 'language', d.language)) as list
        from private.push_devices d
       where d.user_id = e.rid
    ) dv on true
   order by e.oid;
end $$;

revoke all on function public.push_claim(integer) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;
