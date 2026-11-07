-- Rolled-back check for 20261107155616_sponsorships.sql (after
-- 20261107152646_sponsorships_enums is applied). Paste the migration where
-- marked, then run: everything happens in one transaction that ends by
-- raising CHECK <ok> of <total>: <failures>, so nothing is kept.
begin;

-- <the migration goes here>

create function pg_temp.try(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

create temp table t_results (n serial, step text, ok boolean, detail text);
create function pg_temp.chk(step text, ok boolean, detail text default '') returns void language sql as $$
  insert into t_results (step, ok, detail) values (step, coalesce(ok, false), detail);
$$;
create function pg_temp.as_(who uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
$$;

do $$
declare
  a  uuid := 'f5000000-0000-4000-8000-0000000000a1'; -- Rachel (owner role), for the merge
  o  uuid := 'f5000000-0000-4000-8000-0000000000a2'; -- Them's owner
  m  uuid := 'f5000000-0000-4000-8000-0000000000a3'; -- Them's manager
  st uuid := 'f5000000-0000-4000-8000-0000000000a4'; -- Them's staff
  r  uuid := 'f5000000-0000-4000-8000-0000000000a5'; -- a rider
  k  uuid := 'f5000000-0000-4000-8000-0000000000a6'; -- kaito.rolls, whose pro model is on Them
  p2 uuid := 'f5000000-0000-4000-8000-0000000000a7'; -- a private rider
  x  uuid := 'f5000000-0000-4000-8000-0000000000a8'; -- anyone else
  nb uuid := 'f5000000-0000-4000-8000-0000000000a9'; -- hasn't finished onboarding
  c  uuid := 'f5000000-0000-4000-8000-0000000000b1'; -- rider for the block and merge steps
  u  uuid;
  metro uuid := (select id from metro_areas where name = 'San Diego');
  them uuid := (select id from pages where handle = 'themskates');
  dupe uuid;
  org uuid;
  base_model uuid;
  pro_model uuid;
  sid uuid;
  sid2 uuid;
  res text;
  n integer;
  j jsonb;
begin
  foreach u in array array[a, o, m, st, r, k, p2, x, nb, c] loop
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'spon-check-' || u || '@example.com', now(), now(), '{}'::jsonb);
    insert into profiles (id) values (u) on conflict (id) do nothing;
    update profiles set onboarded_at = now(), age_confirmed_at = now(), disciplines = '{inline}', home_metro_area_id = metro,
      username = 'sponcheck' || right(replace(u::text, '-', ''), 4) where id = u;
  end loop;
  update profiles set username = 'kaito.rolls' where id = k;
  update profiles set is_private = true where id = p2;
  update profiles set onboarded_at = null where id = nb;
  insert into role_assignments (user_id, role, accepted_at) values (a, 'owner', now());
  insert into private.push_devices (user_id, token, platform, language) values (r, 'ExponentPushToken[spon-check]', 'ios', 'en');

  perform private.make_page_owner(them, o, null);
  update pages set logo_path = them || '/logo.png' where id = them;
  insert into page_members (page_id, user_id, role, joined_at) values (them, m, 'manager', now()), (them, st, 'staff', now());
  insert into products (page_id, part_type, name, family, entry_type, disciplines, status, sort)
  values (them, 'boot', 'SponCheck', 'SponCheck', 'model', '{inline}', 'current', 9990) returning id into base_model;
  insert into products (page_id, part_type, name, family, entry_type, base_id, pro_rider, disciplines, status, sort, first_year)
  values (them, 'boot', 'SponCheck', 'SponCheck', 'pro', base_model, 'Kaito', '{inline}', 'current', 9991, '2026') returning id into pro_model;

  /* 1. Names, merges and types ------------------------------------------------------------ */
  perform pg_temp.chk('Kaito matches kaito.rolls', private.pro_name_matches('Kaito', 'kaito.rolls'));
  perform pg_temp.chk('Chris Farmer matches chris_farmer and farmerchris',
    private.pro_name_matches('Chris Farmer', 'chris_farmer') and private.pro_name_matches('Chris Farmer', 'farmerchris'));
  perform pg_temp.chk('Chris Farmer doesn''t match chrisf', not private.pro_name_matches('Chris Farmer', 'chrisf'));
  perform pg_temp.chk('accents fold: Ståle Sandbech matches stalesandbech', private.pro_name_matches('Ståle Sandbech', 'stalesandbech'));
  perform pg_temp.chk('no rider text matches nobody', not private.pro_name_matches('', 'kaito') and not private.pro_name_matches(null, 'kaito'));
  select string_agg(x1, ', ') into res from private.unhandled_page_references() x1;
  perform pg_temp.chk('every reference to pages is handled by a merge', res is null, coalesce(res, ''));
  perform pg_temp.chk('merge_pages() calls the sponsorship merge',
    position('merge_page_sponsorships' in pg_get_functiondef('public.merge_pages(uuid,uuid,text)'::regprocedure)) > 0);
  perform pg_temp.chk('the app can call the reads and writes, signed-out visitors can''t',
    has_function_privilege('authenticated', 'public.send_sponsorship(uuid,uuid,public.sponsorship_level)', 'execute')
    and has_function_privilege('authenticated', 'public.rider_sponsors(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.rider_sponsors(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.send_sponsorship(uuid,uuid,public.sponsorship_level)', 'execute'));
  perform pg_temp.chk('the tables are closed to direct reads',
    not has_table_privilege('authenticated', 'public.sponsorships', 'select')
    and not has_table_privilege('authenticated', 'public.product_riders', 'select'));
  perform pg_temp.chk('the expiry job is scheduled', exists (select 1 from cron.job where jobname = 'sponsorship-invites-expire'));

  /* 2. Sending --------------------------------------------------------------------------- */
  perform pg_temp.as_(st);
  res := pg_temp.try(format('select public.send_sponsorship(%L, %L, %L)', them, r, 'am'));
  perform pg_temp.chk('staff can''t send', res = 'not_allowed', res);
  perform pg_temp.as_(m);
  sid := public.send_sponsorship(them, r, 'am');
  perform pg_temp.chk('a manager sends', sid is not null and (select status from sponsorships where id = sid) = 'pending'
    and (select expires_at from sponsorships where id = sid) between now() + interval '29 days' and now() + interval '31 days');
  perform pg_temp.chk('the rider gets one invite row, from the page',
    (select count(*) from notifications where recipient_id = r and kind = 'sponsorship_invite' and page_id = them
       and actor_id is null and message = 'am') = 1);
  perform pg_temp.chk('the invite pushes',
    exists (select 1 from private.push_outbox ob join notifications nn on nn.id = ob.notification_id
             where nn.recipient_id = r and nn.kind = 'sponsorship_invite'));
  res := pg_temp.try(format('select public.send_sponsorship(%L, %L, %L)', them, r, 'pro'));
  perform pg_temp.chk('one open invite per page and rider', res = 'already_invited', res);
  res := pg_temp.try(format('select public.send_sponsorship(%L, %L, %L)', them, m, 'pro'));
  perform pg_temp.chk('not to yourself', res = 'not_yourself', res);
  res := pg_temp.try(format('select public.send_sponsorship(%L, %L, %L)', them, nb, 'pro'));
  perform pg_temp.chk('only members who finished onboarding', res = 'not_found', res);

  /* 3. The rider's invites --------------------------------------------------------------- */
  perform pg_temp.as_(r);
  select count(*) into n from public.my_sponsorship_invites() i where i.level = 'am'
    and i.sent_by_username = (select username::text from profiles where id = m) and i.pro_models = '[]'::jsonb;
  perform pg_temp.chk('Page invites lists it with who sent it', n = 1);
  perform pg_temp.as_(x);
  perform pg_temp.chk('nobody else sees it', not exists (select 1 from public.my_sponsorship_invites()));

  perform pg_temp.as_(m);
  sid2 := public.send_sponsorship(them, k, 'pro');
  perform pg_temp.as_(k);
  select i.pro_models into j from public.my_sponsorship_invites() i where i.id = sid2;
  perform pg_temp.chk('Is this your pro model? offers the matching model', jsonb_array_length(j) = 1 and j -> 0 ->> 'id' = pro_model::text, j::text);

  /* 4. Accepting ------------------------------------------------------------------------- */
  res := pg_temp.try(format('select public.answer_sponsorship(%L, true, %L::uuid[])', sid2, array[base_model]));
  perform pg_temp.chk('a model that isn''t theirs is refused', res = 'not_a_match', res);
  perform public.answer_sponsorship(sid2, true, array[pro_model]);
  perform pg_temp.chk('accepting makes it active', (select status = 'active' and accepted_at is not null from sponsorships where id = sid2));
  perform pg_temp.chk('the pro model is linked', exists (select 1 from product_riders where product_id = pro_model and rider_id = k and sponsorship_id = sid2));
  perform pg_temp.chk('the invite row leaves the bell', not exists (select 1 from notifications where recipient_id = k and kind = 'sponsorship_invite'));
  perform pg_temp.chk('the managers and owner are told, staff aren''t',
    (select count(*) from notifications where kind = 'sponsorship_accepted' and page_id = them and actor_id = k and recipient_id in (o, m)) = 2
    and not exists (select 1 from notifications where kind = 'sponsorship_accepted' and recipient_id = st));
  perform pg_temp.chk('the rider gets their own row, from the page',
    exists (select 1 from notifications where kind = 'sponsorship_accepted' and recipient_id = k and actor_id is null and page_id = them and message = 'pro'));
  perform pg_temp.chk('accepts don''t push',
    not exists (select 1 from private.push_outbox ob join notifications nn on nn.id = ob.notification_id where nn.kind = 'sponsorship_accepted'));
  res := pg_temp.try(format('select public.answer_sponsorship(%L, true)', sid2));
  perform pg_temp.chk('an answered invite can''t be answered again', res = 'invite_closed', res);

  /* 5. Where it shows -------------------------------------------------------------------- */
  perform pg_temp.as_(x);
  perform pg_temp.chk('Rides for shows the badge to others, without the id',
    (select count(*) from public.rider_sponsors(k) s where s.page_id = them and s.level = 'pro' and s.sponsorship_id is null) = 1);
  perform pg_temp.chk('Team riders lists them', exists (select 1 from public.page_team_riders(them) t where t.user_id = k and t.level = 'pro'));
  perform pg_temp.chk('the pro model''s rider is linked', exists (select 1 from public.pro_model_riders(them, null) q where q.product_id = pro_model and q.user_id = k));
  perform pg_temp.as_(k);
  perform pg_temp.chk('the rider gets the id for End', (select s.sponsorship_id from public.rider_sponsors(k) s) = sid2);
  perform pg_temp.as_(st);
  res := pg_temp.try(format('select * from public.page_sponsorships(%L)', them));
  perform pg_temp.chk('staff don''t get the team''s view', res = 'not_allowed', res);
  perform pg_temp.as_(m);
  perform pg_temp.chk('the team''s view: a rider and one waiting with its expiry',
    (select count(*) from public.page_sponsorships(them) v where v.section = 'rider' and v.user_id = k) = 1
    and (select count(*) from public.page_sponsorships(them) v where v.section = 'waiting' and v.user_id = r and v.expires_at is not null) = 1);

  /* 6. Declining ------------------------------------------------------------------------- */
  perform pg_temp.as_(r);
  perform public.answer_sponsorship(sid, false);
  perform pg_temp.chk('a decline closes it and tells nobody',
    (select status from sponsorships where id = sid) = 'declined'
    and not exists (select 1 from notifications where kind = 'sponsorship_invite' and recipient_id = r)
    and not exists (select 1 from notifications where page_id = them and recipient_id in (o, m) and actor_id = r));

  /* 7. Levels ---------------------------------------------------------------------------- */
  perform pg_temp.as_(m);
  perform public.set_sponsorship_level(sid2, 'am');
  perform pg_temp.chk('moving down is bell only',
    exists (select 1 from notifications where recipient_id = k and kind = 'sponsorship_level' and message = 'down:am')
    and not exists (select 1 from private.push_outbox ob join notifications nn on nn.id = ob.notification_id
                     where nn.recipient_id = k and nn.kind = 'sponsorship_level'));
  perform public.set_sponsorship_level(sid2, 'pro');
  perform pg_temp.chk('moving up is told as up', exists (select 1 from notifications where recipient_id = k and kind = 'sponsorship_level' and message = 'up:pro'));
  res := pg_temp.try(format('select public.set_sponsorship_levels(%L, %L::jsonb)', them, '[{"level":"pro","enabled":false}]'));
  perform pg_temp.chk('a level with riders can''t be switched off', res = 'level_in_use', res);
  res := pg_temp.try(format('select public.set_sponsorship_levels(%L, %L::jsonb)', them, '[{"level":"flow","name":"Seventeen letters"}]'));
  perform pg_temp.chk('names are 16 characters at most', res = 'name_too_long', res);
  perform public.set_sponsorship_levels(them, '[{"level":"flow","name":"  Shop team "}]');
  perform pg_temp.chk('a level is renamed (trimmed)', (select l.name from public.page_sponsorship_levels(them) l where l.level = 'flow') = 'Shop team');
  perform pg_temp.as_(x);
  perform pg_temp.chk('a level without its own name comes back as null (the app uses the usual one)',
    (select t.level_name from public.page_team_riders(them) t where t.user_id = k) is null);
  perform pg_temp.as_(m);
  sid := public.send_sponsorship(them, r, 'flow');
  perform public.set_sponsorship_levels(them, '[{"level":"flow","enabled":false}]');
  perform pg_temp.chk('switching a level off cancels invites waiting at it',
    (select status = 'cancelled' and closed_reason = 'level_off' from sponsorships where id = sid)
    and not exists (select 1 from notifications where kind = 'sponsorship_invite' and recipient_id = r));
  res := pg_temp.try(format('select public.send_sponsorship(%L, %L, %L)', them, r, 'flow'));
  perform pg_temp.chk('an off level can''t be sent', res = 'level_off', res);
  res := pg_temp.try(format('select public.set_sponsorship_levels(%L, %L::jsonb)', them,
    '[{"level":"am","enabled":false},{"level":"ambassador","enabled":false},{"level":"pro","enabled":false}]'));
  perform pg_temp.chk('at least one level stays on (or riders block it)', res in ('no_levels', 'level_in_use'), res);
  perform public.set_sponsorship_levels(them, '[{"level":"flow","enabled":true,"name":""}]');
  perform pg_temp.chk('an empty name goes back to the usual one', (select l.name is null and l.enabled from public.page_sponsorship_levels(them) l where l.level = 'flow'));
  perform pg_temp.as_(st);
  res := pg_temp.try(format('select public.set_sponsorship_levels(%L, %L::jsonb)', them, '[{"level":"am","name":"x"}]'));
  perform pg_temp.chk('staff can''t change levels', res = 'not_allowed', res);
  perform pg_temp.chk('staff can read them', (select count(*) from public.page_sponsorship_levels(them)) = 4);

  /* 8. Ending ---------------------------------------------------------------------------- */
  perform pg_temp.as_(k);
  perform public.end_sponsorship(sid2);
  perform pg_temp.chk('the rider ends it',
    (select status = 'ended' and closed_reason = 'rider' and ended_by = k from sponsorships where id = sid2)
    and (select count(*) from notifications where kind = 'sponsorship_ended' and actor_id = k and recipient_id in (o, m) and message = 'rider') = 2);
  perform pg_temp.chk('no trace on the profile', not exists (select 1 from public.rider_sponsors(k)));
  perform pg_temp.chk('the pro model stays linked', exists (select 1 from product_riders where product_id = pro_model and rider_id = k));
  perform pg_temp.as_(m);
  perform pg_temp.chk('Former riders keeps them, team only',
    exists (select 1 from public.page_sponsorships(them) v where v.section = 'former' and v.user_id = k and v.ended_by_rider));
  sid2 := public.send_sponsorship(them, k, 'am');
  perform pg_temp.as_(k);
  perform pg_temp.chk('a pro model already linked isn''t offered again',
    (select i.pro_models from public.my_sponsorship_invites() i where i.id = sid2) = '[]'::jsonb);
  perform public.answer_sponsorship(sid2, true);
  perform pg_temp.as_(m);
  perform pg_temp.chk('riding again leaves Former riders',
    not exists (select 1 from public.page_sponsorships(them) v where v.section = 'former' and v.user_id = k));
  perform public.end_sponsorship(sid2);
  perform pg_temp.chk('the page ends it and only the rider is told',
    (select status = 'ended' and closed_reason = 'page' from sponsorships where id = sid2)
    and exists (select 1 from notifications where kind = 'sponsorship_ended' and recipient_id = k and message = 'page' and page_id = them));
  perform pg_temp.as_(x);
  res := pg_temp.try(format('select public.end_sponsorship(%L)', sid2));
  perform pg_temp.chk('nobody else can end one', res = 'not_allowed', res);
  perform pg_temp.as_(k);
  perform public.unlink_pro_model(pro_model);
  perform pg_temp.chk('the rider can unlink a pro model', not exists (select 1 from product_riders where rider_id = k));

  /* 9. Private accounts and blocks ------------------------------------------------------- */
  perform pg_temp.as_(m);
  sid := public.send_sponsorship(them, p2, 'am');
  perform pg_temp.as_(p2);
  perform public.answer_sponsorship(sid, true);
  perform pg_temp.as_(x);
  perform pg_temp.chk('a private account''s badge is public', exists (select 1 from public.rider_sponsors(p2)));
  insert into blocks (blocker_id, blocked_id) values (p2, x);
  perform pg_temp.chk('…but not to people they blocked', not exists (select 1 from public.rider_sponsors(p2))
    and not exists (select 1 from public.page_team_riders(them) t where t.user_id = p2));
  insert into user_page_blocks (user_id, page_id) values (p2, them);
  perform pg_temp.chk('the rider blocking the page ends it quietly',
    (select status = 'ended' and closed_reason = 'block' from sponsorships where id = sid)
    and not exists (select 1 from notifications where kind = 'sponsorship_ended' and (recipient_id = p2 or actor_id = p2)));
  perform pg_temp.as_(m);
  res := pg_temp.try(format('select public.send_sponsorship(%L, %L, %L)', them, p2, 'am'));
  perform pg_temp.chk('no new invites after a block', res = 'blocked', res);
  sid := public.send_sponsorship(them, c, 'am');
  perform public.block_from_page(them, c);
  perform pg_temp.chk('the page blocking a rider closes the invite quietly',
    (select status = 'cancelled' and closed_reason = 'block' from sponsorships where id = sid)
    and not exists (select 1 from notifications where kind = 'sponsorship_invite' and recipient_id = c));
  update page_blocks set lifted_at = now() where page_id = them and user_id = c;

  /* 10. Expiry --------------------------------------------------------------------------- */
  sid := public.send_sponsorship(them, r, 'am');
  update sponsorships set expires_at = now() - interval '1 minute' where id = sid;
  perform pg_temp.as_(r);
  perform pg_temp.chk('an expired invite leaves Page invites', not exists (select 1 from public.my_sponsorship_invites()));
  res := pg_temp.try(format('select public.answer_sponsorship(%L, true)', sid));
  perform pg_temp.chk('and can''t be accepted', res = 'invite_closed', res);
  perform private.expire_sponsorship_invites();
  perform pg_temp.chk('the daily job marks it expired and clears the bell',
    (select status from sponsorships where id = sid) = 'expired'
    and not exists (select 1 from notifications where kind = 'sponsorship_invite' and recipient_id = r));
  perform pg_temp.as_(m);
  sid := public.send_sponsorship(them, r, 'am');
  perform pg_temp.chk('a new invite can follow an expired one', (select status from sponsorships where id = sid) = 'pending');

  /* 11. Page states ---------------------------------------------------------------------- */
  sid2 := public.send_sponsorship(them, k, 'am');
  perform pg_temp.as_(k);
  perform public.answer_sponsorship(sid2, true);
  update pages set suspended_at = now(), suspended_reason = 'check' where id = them;
  perform pg_temp.chk('a suspended page keeps its riders, and its waiting invites close',
    (select status from sponsorships where id = sid2) = 'active'
    and (select status = 'cancelled' and closed_reason = 'page_changed' from sponsorships where id = sid));
  perform pg_temp.as_(m);
  res := pg_temp.try(format('select public.send_sponsorship(%L, %L, %L)', them, r, 'am'));
  perform pg_temp.chk('a suspended page can''t send', res = 'not_allowed', res);
  res := pg_temp.try(format('select public.set_sponsorship_level(%L, %L)', sid2, 'pro'));
  perform pg_temp.chk('…or change levels', res = 'not_allowed', res);
  update pages set suspended_at = null, suspended_reason = null where id = them;
  update pages set logo_path = null where id = them;
  res := pg_temp.try(format('select public.send_sponsorship(%L, %L, %L)', them, r, 'am'));
  perform pg_temp.chk('a page without a logo can''t send', res = 'not_allowed', res);
  update pages set logo_path = them || '/logo.png' where id = them;
  update pages set state = 'out_of_business', ended_label = '2026' where id = them;
  perform pg_temp.chk('a Retired archive keeps its riders', (select status from sponsorships where id = sid2) = 'active');
  update pages set state = 'managed', ended_label = null where id = them;

  /* 12. Bans and deleted accounts -------------------------------------------------------- */
  sid := public.send_sponsorship(them, r, 'am');
  insert into product_riders (product_id, rider_id) values (pro_model, k);
  update profiles set banned_at = now() where id = k;
  perform pg_temp.chk('a ban ends the sponsorship quietly and unlinks pro models',
    (select status = 'ended' and closed_reason = 'account' from sponsorships where id = sid2)
    and not exists (select 1 from product_riders where rider_id = k)
    -- (the two rows from when k ended one themselves in step 8, and no more)
    and (select count(*) from notifications where kind = 'sponsorship_ended' and actor_id = k) = 2);
  update profiles set deleted_at = now() where id = m;
  perform pg_temp.chk('invites a deleted member sent are closed', (select status = 'cancelled' and closed_reason = 'account' from sponsorships where id = sid));
  update profiles set deleted_at = null where id = m;
  insert into page_members (page_id, user_id, role, joined_at) values (them, m, 'manager', now()) on conflict do nothing;

  /* 13. Merges --------------------------------------------------------------------------- */
  -- A duplicate of Them with its own team; c rides for both, r for the duplicate
  -- only, x has a waiting invite from it.
  perform pg_temp.as_(a);
  insert into pages (handle, display_name, roles, state, main_language, country, logo_path, managed_at)
  values ('sponcheckdupe', 'Them Dupe', '{brand}', 'managed', 'en', 'US', 'dupe/logo.png', now()) returning id into dupe;
  insert into page_members (page_id, user_id, role, joined_at) values (dupe, o, 'owner', now());
  insert into sponsorships (page_id, rider_id, level, status, accepted_at) values (them, c, 'pro', 'active', now()),
    (dupe, c, 'flow', 'active', now()), (dupe, r, 'ambassador', 'active', now());
  insert into sponsorships (page_id, rider_id, level) values (dupe, x, 'am');
  insert into page_sponsorship_levels (page_id, level, enabled) values (them, 'ambassador', false)
    on conflict (page_id, level) do update set enabled = false;
  insert into page_sponsorship_levels (page_id, level, name) values (dupe, 'pro', 'Dupe pros');
  j := public.merge_pages(dupe, them, 'themskates');
  perform pg_temp.chk('a rider on both keeps the target''s sponsorship',
    (select count(*) from sponsorships where page_id = them and rider_id = c and status = 'active') = 1
    and (select level from sponsorships where page_id = them and rider_id = c and status = 'active') = 'pro'
    and exists (select 1 from sponsorships where page_id = them and rider_id = c and status = 'ended' and closed_reason = 'merged'));
  perform pg_temp.chk('the duplicate''s other riders move over',
    exists (select 1 from sponsorships where page_id = them and rider_id = r and status = 'active' and level = 'ambassador'));
  perform pg_temp.chk('…with their level switched back on', (select enabled from page_sponsorship_levels where page_id = them and level = 'ambassador'));
  perform pg_temp.chk('the duplicate''s waiting invites close',
    (select status = 'cancelled' and closed_reason = 'merged' from sponsorships where rider_id = x));
  perform pg_temp.chk('nothing is left on the duplicate',
    not exists (select 1 from sponsorships where page_id = dupe) and not exists (select 1 from page_sponsorship_levels where page_id = dupe));

  /* 14. Pushes --------------------------------------------------------------------------- */
  perform pg_temp.as_(r);
  perform public.set_push_setting('sponsorships', false);
  perform pg_temp.chk('the Sponsorships push switch', (select s.sponsorships from public.my_push_settings() s) = false);
  perform public.set_push_setting('sponsorships', true);
  -- An organizer that closed: its cancelled meetups push "… is no longer active".
  insert into pages (handle, display_name, roles, state, main_language, country)
  values ('sponcheckorg', 'Rolling School', '{organizer}', 'inactive', 'en', 'US') returning id into org;
  update private.push_outbox set sent_at = now() where sent_at is null;
  insert into page_sponsorship_levels (page_id, level, name) values (them, 'pro', 'Team pro')
    on conflict (page_id, level) do update set name = 'Team pro';
  insert into notifications (recipient_id, kind, page_id, message) values
    (r, 'sponsorship_level', them, 'up:pro'),
    (r, 'sponsorship_invite', them, 'am'),
    (r, 'meetup_cancelled', org, 'page_closed:series'),
    (r, 'meetup_cancelled', them, 'page_closed:date');
  create temp table t_claimed as select * from public.push_claim(500);
  perform pg_temp.chk('a level push carries the page''s name for it',
    exists (select 1 from t_claimed where kind = 'sponsorship_level' and detail = 'up:pro' || chr(9) || 'Team pro' and send and page_name is not null));
  perform pg_temp.chk('an invite push carries its level', exists (select 1 from t_claimed where kind = 'sponsorship_invite' and detail = 'am' and send));
  perform pg_temp.chk('a closed organizer''s meetups say no longer active',
    exists (select 1 from t_claimed where kind = 'meetup_cancelled' and detail = 'page_inactive:series')
    and exists (select 1 from t_claimed where kind = 'meetup_cancelled' and detail = 'page_closed:date'));
end $$;

do $$
declare n_ok int; n_total int; fails text;
begin
  select count(*) filter (where t.ok), count(*),
         string_agg(case when not t.ok then t.n || '. ' || t.step || coalesce(' (' || nullif(t.detail, '') || ')', '') end, '; ' order by t.n)
    into n_ok, n_total, fails from t_results t;
  raise exception 'CHECK % of %: %', n_ok, n_total, coalesce(fails, 'all passed');
end $$;
rollback;
