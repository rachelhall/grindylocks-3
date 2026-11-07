-- Grindylocks — access rules (draft 1, Oct 31, 2026)
-- The app is sign-in only: every policy is for the `authenticated` role, and
-- signed-out (`anon`) requests see nothing.
-- Not covered here (each comes with its milestone, as security-definer RPCs):
--   invite redemption and invite counts (M3), appointing roles (M5),
--   notification fan-out, park edit history logging and park info approvals (M5).

do $$ begin
  if exists (select 1 from pg_proc where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

create index if not exists comments_parent_idx          on comments (parent_id);
create index if not exists comments_author_idx          on comments (author_id);
create index if not exists likes_user_idx               on likes (user_id);
create index if not exists saved_parks_park_idx         on saved_parks (park_id);
create index if not exists invites_inviter_idx          on invites (inviter_id);
create index if not exists blocks_blocked_idx           on blocks (blocked_id);
create index if not exists announcements_user_idx       on announcements (user_id);
create index if not exists notifications_post_idx       on notifications (post_id);
create index if not exists reports_post_idx             on reports (post_id);
create index if not exists role_assignments_park_idx    on role_assignments (park_id);
create index if not exists role_assignments_metro_idx   on role_assignments (metro_area_id);

create schema if not exists private;
grant usage on schema private to authenticated;

create function private.has_role(r role_name, metro uuid default null, park uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from role_assignments
    where user_id = auth.uid() and role = r and accepted_at is not null and ended_at is null
      and (metro is null or metro_area_id = metro)
      and (park is null or park_id = park)
  );
$$;

create function private.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select private.has_role('owner');
$$;

create function private.can_moderate_park(park uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_owner()
      or exists (select 1 from parks p where p.id = park and private.has_role('city_admin', p.metro_area_id))
      or private.has_role('park_admin', null, park);
$$;

create function private.can_contribute_park(park uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.can_moderate_park(park) or private.has_role('park_contributor', null, park);
$$;

create function private.can_moderate_metro(metro uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.is_owner() or private.has_role('city_admin', metro);
$$;

create function private.can_moderate_post(post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from posts p where p.id = post and (
      (p.park_id is not null and private.can_moderate_park(p.park_id))
      or private.can_moderate_metro(p.metro_area_id)
    )
  );
$$;

create function private.blocked_between(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from blocks
    where (blocker_id = auth.uid() and blocked_id = other)
       or (blocker_id = other and blocked_id = auth.uid())
  );
$$;

create function private.can_see_content_of(author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select author = auth.uid() or (
    not private.blocked_between(author)
    and (
      not coalesce((select is_private from profiles where id = author), false)
      or exists (select 1 from follows where follower_id = auth.uid() and followee_id = author and status = 'accepted')
    )
  );
$$;

create function private.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and onboarded_at is not null and deleted_at is null and banned_at is null
      and (suspended_until is null or suspended_until < now())
  );
$$;

create function private.can_see_post(post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from posts p where p.id = post and (
      p.author_id = auth.uid()
      or (p.status = 'visible' and private.can_see_content_of(p.author_id))
      or private.can_moderate_post(p.id)
    )
  );
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

alter function reports_auto_hide() security definer;

create policy "members read metro areas" on metro_areas for select to authenticated using (true);
create policy "owner manages metro areas" on metro_areas for all to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "city admins rename their metro" on metro_areas for update to authenticated
  using (private.can_moderate_metro(id)) with check (private.can_moderate_metro(id));

create policy "members read parks" on parks for select to authenticated using (true);
create policy "city admins add parks" on parks for insert to authenticated
  with check (private.can_moderate_metro(metro_area_id));
create policy "contributors edit parks" on parks for update to authenticated
  using (private.can_contribute_park(id)) with check (private.can_contribute_park(id));

create function private.guard_park_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not private.can_moderate_park(old.id) and (
       new.slug is distinct from old.slug
    or new.display_name is distinct from old.display_name
    or new.official_name is distinct from old.official_name
    or new.status is distinct from old.status
    or new.metro_area_id is distinct from old.metro_area_id
    or new.verified_at is distinct from old.verified_at
    or new.verified_by is distinct from old.verified_by
  ) then
    raise exception 'Only park admins can rename a park, change its status or verify it';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger parks_guard_fields before update on parks
  for each row execute function private.guard_park_fields();

create policy "members read descriptions" on park_descriptions for select to authenticated using (true);
create policy "contributors write descriptions" on park_descriptions for all to authenticated
  using (private.can_contribute_park(park_id)) with check (private.can_contribute_park(park_id));

create policy "moderators read admin notes" on park_admin_notes for select to authenticated
  using (private.can_moderate_park(park_id));
create policy "moderators write admin notes" on park_admin_notes for all to authenticated
  using (private.can_moderate_park(park_id)) with check (private.can_moderate_park(park_id));

create policy "members read hours" on park_sessions for select to authenticated using (true);
create policy "contributors write hours" on park_sessions for all to authenticated
  using (private.can_contribute_park(park_id)) with check (private.can_contribute_park(park_id));

create policy "members read obstacles" on obstacles for select to authenticated
  using (status = 'active' or suggested_by = (select auth.uid()) or private.can_contribute_park(park_id));
create policy "members suggest obstacles" on obstacles for insert to authenticated
  with check (
    (status = 'pending' and suggested_by = (select auth.uid()) and private.is_active_member())
    or private.can_contribute_park(park_id)
  );
create policy "contributors edit obstacles" on obstacles for update to authenticated
  using (private.can_contribute_park(park_id)) with check (private.can_contribute_park(park_id));

create function private.guard_obstacle_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not private.can_moderate_park(old.park_id) and (
       (new.status = 'archived' and old.status <> 'archived')
    or new.merged_into is distinct from old.merged_into
    or new.park_id is distinct from old.park_id
  ) then
    raise exception 'Only park admins can archive or merge obstacles';
  end if;
  if new.status = 'archived' and old.status <> 'archived' then
    new.archived_at := now();
  end if;
  return new;
end $$;
create trigger obstacles_guard_fields before update on obstacles
  for each row execute function private.guard_obstacle_fields();

create policy "members read profiles" on profiles for select to authenticated
  using (id = (select auth.uid()) or not private.blocked_between(id));
create policy "create own profile" on profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "edit own profile" on profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

revoke select, insert, update on profiles from anon, authenticated;
grant select (id, username, avatar_path, disciplines, home_metro_area_id, home_park_id, is_private,
              hide_from_regulars, open_to_meetup, onboarded_at, joined_at, last_active_at, deleted_at)
  on profiles to authenticated;
grant insert (id, username, avatar_path, disciplines, home_metro_area_id, home_park_id, is_private,
              hide_from_regulars, open_to_meetup, age_confirmed_at, onboarded_at)
  on profiles to authenticated;
grant update (username, avatar_path, disciplines, home_metro_area_id, home_park_id, is_private,
              hide_from_regulars, open_to_meetup, age_confirmed_at, onboarded_at, last_active_at)
  on profiles to authenticated;

create function public.my_account()
returns table (invites_remaining smallint, age_confirmed_at timestamptz, suspended_until timestamptz, banned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select invites_remaining, age_confirmed_at, suspended_until, banned_at from profiles where id = auth.uid();
$$;
revoke execute on function public.my_account() from public, anon;
grant execute on function public.my_account() to authenticated;

create policy "read follows" on follows for select to authenticated
  using (
    follower_id = (select auth.uid()) or followee_id = (select auth.uid())
    or (status = 'accepted' and private.can_see_content_of(followee_id) and not private.blocked_between(follower_id))
  );
create policy "follow someone" on follows for insert to authenticated
  with check (follower_id = (select auth.uid()) and private.is_active_member() and not private.blocked_between(followee_id));
create policy "accept a follow request" on follows for update to authenticated
  using (followee_id = (select auth.uid())) with check (followee_id = (select auth.uid()));
create policy "unfollow or remove a follower" on follows for delete to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

create function private.set_follow_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.status := case when (select is_private from profiles where id = new.followee_id) then 'pending' else 'accepted' end;
  return new;
end $$;
create trigger follows_set_status before insert on follows
  for each row execute function private.set_follow_status();

create policy "manage own blocks" on blocks for all to authenticated
  using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));

create function private.unfollow_on_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id)
     or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;
create trigger blocks_unfollow after insert on blocks
  for each row execute function private.unfollow_on_block();

create policy "read own invites" on invites for select to authenticated
  using (inviter_id = (select auth.uid()) or used_by = (select auth.uid()));

create policy "manage own saved parks" on saved_parks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "read announcements" on announcements for select to authenticated
  using (user_id = (select auth.uid()) or not private.blocked_between(user_id));
create policy "announce yourself" on announcements for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_active_member());
create policy "remove own announcement" on announcements for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "read roles" on role_assignments for select to authenticated
  using (
    user_id = (select auth.uid())
    or (accepted_at is not null and ended_at is null and not badge_hidden)
    or private.is_owner()
    or (metro_area_id is not null and private.can_moderate_metro(metro_area_id))
    or (park_id is not null and private.can_moderate_park(park_id))
  );
create policy "accept or hide own role" on role_assignments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on role_assignments from authenticated;
grant update (accepted_at, badge_hidden) on role_assignments to authenticated;

create policy "owner reads role log" on role_change_log for select to authenticated
  using (private.is_owner() or actor_id = (select auth.uid()));

create policy "read posts" on posts for select to authenticated
  using (
    author_id = (select auth.uid())
    or (status = 'visible' and private.can_see_content_of(author_id))
    or private.can_moderate_post(id)
  );
create policy "publish posts" on posts for insert to authenticated
  with check (author_id = (select auth.uid()) and status = 'visible' and private.is_active_member());
create policy "edit own posts or moderate" on posts for update to authenticated
  using (author_id = (select auth.uid()) or private.can_moderate_post(id))
  with check (author_id = (select auth.uid()) or private.can_moderate_post(id));

create function private.guard_post_fields() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_author boolean := old.author_id = auth.uid();
  is_mod boolean := private.can_moderate_post(old.id);
begin
  if new.author_id is distinct from old.author_id or new.created_at is distinct from old.created_at then
    raise exception 'A post''s author and date can''t change';
  end if;
  if new.status is distinct from old.status then
    if not (is_mod or (is_author and new.status = 'deleted')) then
      raise exception 'Only moderators can hide or restore a post';
    end if;
  end if;
  if not is_author and (new.caption is distinct from old.caption or new.park_id is distinct from old.park_id
                        or new.metro_area_id is distinct from old.metro_area_id) then
    raise exception 'Only the author can edit a post';
  end if;
  if is_author and (new.caption is distinct from old.caption or new.park_id is distinct from old.park_id) then
    new.edited_at := now();
  end if;
  return new;
end $$;
create trigger posts_guard_fields before update on posts
  for each row execute function private.guard_post_fields();

create policy "read slides" on post_slides for select to authenticated
  using (private.can_see_post(post_id));
create policy "author manages slides" on post_slides for all to authenticated
  using (exists (select 1 from posts p where p.id = post_id and p.author_id = (select auth.uid())))
  with check (exists (select 1 from posts p where p.id = post_id and p.author_id = (select auth.uid())));

create policy "read people tags" on slide_people_tags for select to authenticated
  using (exists (select 1 from post_slides s where s.id = slide_id and private.can_see_post(s.post_id)));
create policy "author tags people" on slide_people_tags for insert to authenticated
  with check (
    tagged_by = (select auth.uid())
    and exists (select 1 from post_slides s join posts p on p.id = s.post_id
                where s.id = slide_id and p.author_id = (select auth.uid()))
    and not private.blocked_between(user_id)
  );
create policy "author or tagged person removes a tag" on slide_people_tags for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from post_slides s join posts p on p.id = s.post_id
               where s.id = slide_id and p.author_id = (select auth.uid()))
  );

create policy "read own likes" on likes for select to authenticated
  using (user_id = (select auth.uid()) or private.is_owner());
create policy "like a post" on likes for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_active_member() and private.can_see_post(post_id));
create policy "unlike a post" on likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "read comments" on comments for select to authenticated
  using (private.can_see_post(post_id) and (author_id = (select auth.uid()) or not private.blocked_between(author_id)));
create policy "comment on a post" on comments for insert to authenticated
  with check (author_id = (select auth.uid()) and private.is_active_member() and private.can_see_post(post_id)
              and not private.blocked_between((select author_id from posts where id = post_id)));
create policy "edit or remove comments" on comments for update to authenticated
  using (author_id = (select auth.uid())
         or exists (select 1 from posts p where p.id = post_id and p.author_id = (select auth.uid()))
         or private.can_moderate_post(post_id))
  with check (true);
revoke update on comments from authenticated;
grant update (body, deleted_at) on comments to authenticated;

create function private.guard_comment_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.body is distinct from old.body and old.author_id <> auth.uid() then
    raise exception 'Only the commenter can edit a comment';
  end if;
  if old.deleted_at is not null and new.deleted_at is null and not private.can_moderate_post(old.post_id) then
    raise exception 'Deleted comments can''t be restored';
  end if;
  return new;
end $$;
create trigger comments_guard_fields before update on comments
  for each row execute function private.guard_comment_fields();

create policy "read own notifications" on notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy "mark notifications read" on notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
revoke update on notifications from authenticated;
grant update (read_at) on notifications to authenticated;

create policy "file a report" on reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open' and action is null);
create policy "read reports" on reports for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or private.is_owner()
    or (reason not in ('harassment', 'involves_minor') and post_id is not null and private.can_moderate_post(post_id))
    or (reason not in ('harassment', 'involves_minor') and comment_id is not null
        and private.can_moderate_post((select c.post_id from comments c where c.id = comment_id)))
  );
create policy "resolve reports" on reports for update to authenticated
  using (
    private.is_owner()
    or (reason not in ('harassment', 'involves_minor') and post_id is not null and private.can_moderate_post(post_id))
    or (reason not in ('harassment', 'involves_minor') and comment_id is not null
        and private.can_moderate_post((select c.post_id from comments c where c.id = comment_id)))
  )
  with check (action is distinct from 'ban' or private.is_owner());
revoke update on reports from authenticated;
grant update (status, action, resolved_by, resolved_at) on reports to authenticated;

create policy "file a park info report" on park_info_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open' and private.is_active_member());
create policy "read park info reports" on park_info_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or private.can_contribute_park(park_id));
create policy "review park info reports" on park_info_reports for update to authenticated
  using (private.can_contribute_park(park_id)) with check (private.can_contribute_park(park_id));
revoke update on park_info_reports from authenticated;
grant update (status, reviewed_by, reviewed_at, applied_value) on park_info_reports to authenticated;

create policy "read park edit history" on park_edits for select to authenticated
  using (private.can_contribute_park(park_id));
create policy "log park edits" on park_edits for insert to authenticated
  with check (editor_id = (select auth.uid()) and private.can_contribute_park(park_id));

create function private.is_banned(person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select banned_at is not null from profiles where id = person), false);
$$;
grant execute on function private.is_banned(uuid) to authenticated;

create or replace view park_regulars with (security_invoker = true) as
with candidates as (
  select park_id, author_id as user_id
  from posts
  where park_id is not null and status = 'visible'
  group by park_id, author_id
  having count(*) > 5
  union
  select home_park_id, id from profiles where home_park_id is not null
)
select c.park_id, c.user_id, pr.last_active_at
from candidates c
join profiles pr on pr.id = c.user_id
where not pr.is_private and not pr.hide_from_regulars
  and pr.deleted_at is null and not private.is_banned(c.user_id);

revoke all on all tables in schema public from anon;;
