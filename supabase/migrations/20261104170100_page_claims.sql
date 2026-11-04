-- Brand and shop accounts, part A, PR 5: claiming and invites.
-- PRD: Grindylocks — Brand and Shop Accounts PRD (Claiming and getting
-- people in, Teams, Notifications, Handles). Mockups: the Brand accounts
-- (v2) page, "claims, invites & page onboarding" row.
--
--  1. Columns: notifications point at a page; page invites get a code (for
--     emailed invites), who accepted, and a logo for claim invites; page
--     members get their own inbox push switch (off); pages remember when
--     their followers were told they're here; push settings get Teams and
--     claims, and Pages you follow joining.
--  2. page_claims: Claim this page, with a work email confirmed by a code or
--     a GRIND-XXXX code posted on the brand's Instagram or website (valid 7
--     days). Only the claimant and Rachel see a claim. Rachel decides with
--     decide_page_claim() (from the SQL editor until the web admin's Claims
--     queue, PR 6). Approving makes the claimant the owner; the page stays
--     UNOFFICIAL until it has a logo.
--  3. Emails (claim codes, team invites, claim invites) go through an
--     outbox, sent by the page-email-send Edge Function (Resend), pinged by
--     the database like push-send. The plain code lives in the outbox row
--     only until it's sent.
--  4. Invites: Rachel's claim invite (send_claim_invite(), the main path;
--     the person becomes owner with no claim to wait on) and team invites
--     (invite_to_page(), by username or email, at most 10 open per page;
--     emailed ones don't use anyone's personal invites). Emailed invites
--     carry an invite code: the sign-up hook lets a new account through with
--     it when the email matches, and onboarding accepts it
--     (redeem_my_page_invite()). Members answer invites from the Page
--     invites box (my_page_invites(), answer_page_invite()); existing
--     members sign in with the invited email and find it there.
--  5. Logos: a public page-images bucket. Managers and owners upload to the
--     page's folder and set it with set_page_logo(). The first logo on a
--     claimed page tells its followers it's here, once.
--  6. Notifications and pushes: claim approved or declined, team invites,
--     team changes (written in PR 7), a page you follow joining, and a
--     suggestion going live (written in PR 6). The bell reads them with
--     my_page_notifications() beside my_notifications(). Pushes: team
--     invites, claims and team changes under Teams and claims; a page you
--     follow joining under Pages you follow joining (on by default, since it
--     fires once per page); suggestions under Fixes and suggestions.
--  7. Your pages (my_pages()) with your role and each page inbox's push
--     switch, for Settings › Push notifications (Inboxes of pages you
--     manage). The inbox itself comes in PR 7.
--
-- Replaced, same signatures: public.before_user_created(),
-- public.notifications_unread(), public.set_push_setting(),
-- private.enqueue_push_notification(). Dropped and created again with new
-- columns (same grants): public.my_push_settings(), public.push_claim().
-- push-send is redeployed with this migration, since push_claim()'s columns
-- change.
--
-- Additive otherwise: columns, tables, a bucket, functions and triggers.

/* 1. Columns -------------------------------------------------------------------- */

alter table public.notifications
  add column if not exists page_id uuid references public.pages (id) on delete cascade;

create index if not exists notifications_page_idx on public.notifications (page_id) where page_id is not null;

alter table public.page_invites
  add column if not exists code text unique check (code is null or code ~ '^[A-Z0-9]{8}$'),
  add column if not exists accepted_by uuid references public.profiles (id) on delete set null,
  -- Claim invites: the logo Rachel attached, set on the page when it's accepted.
  add column if not exists logo_path text;

-- Claim invites go by email (the invitee may not have an account yet), like
-- emailed team invites. Ownership hand-overs stay member to member.
alter table public.page_invites drop constraint if exists page_invites_check2;
alter table public.page_invites drop constraint if exists page_invites_kind_target;
alter table public.page_invites add constraint page_invites_kind_target check (
  (kind = 'team')
  or (kind = 'ownership' and invitee_id is not null)
  or (kind = 'claim' and email is not null)
);
-- Emailed invites carry a code; member invites don't need one.
alter table public.page_invites drop constraint if exists page_invites_email_code;
alter table public.page_invites add constraint page_invites_email_code check (email is null or code is not null) not valid;

create index if not exists page_invites_accepted_by_idx on public.page_invites (accepted_by) where accepted_by is not null;

alter table public.page_members
  add column if not exists inbox_push boolean not null default false;

alter table public.pages
  add column if not exists followers_told_at timestamptz;

alter table private.push_settings
  add column if not exists teams_claims boolean not null default true,
  add column if not exists pages_joining boolean not null default true;

/* 2. Claims ----------------------------------------------------------------------- */

create table if not exists public.page_claims (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_title text not null check (char_length(trim(role_title)) between 1 and 60),
  proof public.page_claim_proof not null,
  -- Work email: confirmed with a 6-digit code (kept hashed, 30 minutes).
  email extensions.citext check (email is null or char_length(email::text) between 3 and 254),
  email_domain_matches boolean,
  email_code_hash text,
  email_code_expires_at timestamptz,
  email_code_attempts smallint not null default 0,
  email_code_sends smallint not null default 0,
  email_code_sent_at timestamptz,
  email_confirmed_at timestamptz,
  -- Posted code: GRIND-XXXX, valid 7 days, and where it was posted.
  posted_code text check (posted_code is null or posted_code ~ '^GRIND-[A-Z0-9]{4}$'),
  posted_code_expires_at timestamptz,
  posted_url text check (posted_url is null or char_length(posted_url) between 4 and 300),
  note text check (note is null or char_length(note) between 1 and 500),
  status public.page_claim_status not null default 'draft',
  sent_at timestamptz,
  -- Rachel's "Checked it" on a posted code (the Claims queue, PR 6).
  checked_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  -- What the claimant sees when declined. 'another_claim_approved' when
  -- someone else's claim (or claim invite) for the page went through.
  decline_reason text check (decline_reason is null or char_length(decline_reason) between 1 and 300),
  created_at timestamptz not null default now(),
  check ((proof = 'email') = (email is not null)),
  check ((proof = 'posted_code') = (posted_code is not null))
);

comment on table public.page_claims is
  'Claim this page: the claimant''s proof (work email or posted code) and Rachel''s decision. See the Brand and Shop Accounts PRD.';

create index if not exists page_claims_page_idx on public.page_claims (page_id, created_at desc);
create index if not exists page_claims_user_idx on public.page_claims (user_id, created_at desc);
create index if not exists page_claims_pending_idx on public.page_claims (sent_at) where status = 'pending';
-- One open claim per person per page.
create unique index if not exists page_claims_one_open on public.page_claims (page_id, user_id)
  where status in ('draft', 'pending');

alter table public.page_claims enable row level security;
revoke all on public.page_claims from anon, authenticated;

-- The claimant and Rachel read; the code hash stays out. Writes go through
-- the functions below.
grant select (id, page_id, user_id, role_title, proof, email, email_domain_matches, email_code_expires_at,
  email_code_sent_at, email_confirmed_at, posted_code, posted_code_expires_at, posted_url, note, status, sent_at,
  checked_at, decided_at, decline_reason, created_at)
  on public.page_claims to authenticated;

create policy "page claims: the claimant and Rachel" on public.page_claims
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_owner());

/* 3. The email outbox ----------------------------------------------------------- */

create table if not exists private.page_emails (
  id bigserial primary key,
  kind text not null check (kind in ('claim_code', 'team_invite', 'claim_invite')),
  to_email text not null,
  language text not null default 'en' check (language in ('en', 'es', 'da', 'de')),
  page_id uuid not null references public.pages (id) on delete cascade,
  claim_id uuid references public.page_claims (id) on delete cascade,
  invite_id uuid references public.page_invites (id) on delete cascade,
  -- The plain code, only until the email is sent.
  code text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts smallint not null default 0,
  sent_at timestamptz
);

create index if not exists page_emails_waiting_idx on private.page_emails (id) where sent_at is null;
revoke all on private.page_emails from public, anon, authenticated;
revoke all on sequence private.page_emails_id_seq from public, anon, authenticated;

-- One ping per statement that adds emails, like the push outbox. The URL is
-- push-send's, with the function name swapped. Failures are swallowed: the
-- email waits for the next ping.
create or replace function private.ping_page_email_send()
returns trigger
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  url text;
begin
  select replace(c.send_url, '/push-send', '/page-email-send') into url from private.push_config c;
  if url is not null then
    perform net.http_post(
      url := url,
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000
    );
  end if;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists page_emails_ping on private.page_emails;
create trigger page_emails_ping
  after insert on private.page_emails
  for each statement execute function private.ping_page_email_send();

revoke all on function private.ping_page_email_send() from public, anon, authenticated;

-- What page-email-send needs to write each email. Rows that shouldn't go
-- out any more (the claim was sent or withdrawn, the invite answered or
-- cancelled) come back with send = false and are marked done too.
create or replace function public.page_email_claim(max_rows integer default 20)
returns table (
  email_id bigint,
  send boolean,
  kind text,
  to_email text,
  language text,
  code text,
  page_name text,
  page_handle text,
  page_kind text,
  page_place text,
  inviter_username text,
  role text,
  expires_at timestamptz
)
language plpgsql volatile security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select e.id from private.page_emails e
     where e.sent_at is null and e.attempts < 3
       and e.created_at > now() - interval '1 day'
       and (e.claimed_at is null or e.claimed_at < now() - interval '2 minutes')
     order by e.id
     limit greatest(1, least(max_rows, 100))
     for update skip locked
  ),
  claimed as (
    update private.page_emails e
       set claimed_at = now(), attempts = e.attempts + 1
      from picked where e.id = picked.id
    returning e.*
  )
  select cl.id,
         (cl.code is not null
           and case cl.kind
                 when 'claim_code' then pc.status = 'draft' and pc.email_code_expires_at > now()
                 else pi.id is not null and pi.accepted_at is null and pi.declined_at is null
                      and pi.cancelled_at is null and pi.expires_at > now()
               end),
         cl.kind,
         cl.to_email,
         cl.language,
         cl.code,
         p.display_name,
         p.handle::text,
         case when 'shop' = any (p.roles) then 'shop' else 'brand' end,
         coalesce(p.city, p.country::text),
         u.username::text,
         pi.role::text,
         coalesce(pc.email_code_expires_at, pi.expires_at)
    from claimed cl
    join pages p on p.id = cl.page_id
    left join page_claims pc on pc.id = cl.claim_id
    left join page_invites pi on pi.id = cl.invite_id
    left join profiles u on u.id = pi.invited_by and u.deleted_at is null
   order by cl.id;
end $$;

-- Marks emails done and forgets their codes.
create or replace function public.page_email_done(ids bigint[])
returns void
language sql volatile security definer
set search_path = public
as $$
  update private.page_emails set sent_at = now(), code = null where id = any (ids);
$$;

revoke all on function public.page_email_claim(integer) from public, anon, authenticated;
revoke all on function public.page_email_done(bigint[]) from public, anon, authenticated;
grant execute on function public.page_email_claim(integer) to service_role;
grant execute on function public.page_email_done(bigint[]) to service_role;

/* Helpers ------------------------------------------------------------------------- */

-- "https://www.deadwheels.com/shop" → "deadwheels.com".
create or replace function private.url_host(url text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(regexp_replace(lower(trim(coalesce(url, ''))), '^[a-z][a-z0-9+.-]*://', ''), '^www\.|[/:?#].*$', '', 'g'),
    '');
$$;

-- Whether an email's domain matches the page's website or one of its links
-- (social sites don't count). A subdomain either way matches.
create or replace function private.email_matches_page(address text, page uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  with d as (select lower(split_part(trim(address), '@', 2)) as domain),
  hosts as (
    select private.url_host(p.website) as host from public.pages p where p.id = page
    union
    select private.url_host(l.url) from public.page_links l where l.page_id = page
  )
  select exists (
    select 1 from hosts h, d
     where h.host is not null and d.domain <> ''
       and h.host not in ('instagram.com', 'facebook.com', 'youtube.com', 'tiktok.com', 'x.com', 'twitter.com',
                          'linktr.ee', 'vimeo.com', 'gmail.com')
       and (d.domain = h.host or d.domain like '%.' || h.host or h.host like '%.' || d.domain)
  );
$$;

-- An 8-character invite code no personal or page invite has used.
create or replace function private.new_page_invite_code()
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  c text;
begin
  loop
    c := private.new_invite_code();
    exit when not exists (select 1 from public.invites i where i.code = c)
          and not exists (select 1 from public.page_invites i where i.code = c);
  end loop;
  return c;
end $$;

-- GRIND-XXXX, from the invite alphabet (no 0/O or 1/I).
create or replace function private.new_claim_code()
returns text
language sql volatile
set search_path = ''
as $$
  select 'GRIND-' || left(private.new_invite_code(), 4);
$$;

-- The caller isn't banned, deleted or suspended. Unlike is_active_member(),
-- someone still in onboarding counts, so a new owner can answer invites and
-- add the logo before they've finished.
create or replace function private.is_in_good_standing(who uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = who and p.deleted_at is null and p.banned_at is null
       and (p.suspended_until is null or p.suspended_until < now())
  );
$$;

-- Managers and owners of a managed page that isn't suspended or frozen, in
-- good standing (onboarding included): who may change the logo.
create or replace function private.can_manage_page_media(page uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_in_good_standing()
    and exists (
      select 1 from public.page_members m join public.pages p on p.id = m.page_id
       where m.page_id = page and m.user_id = (select auth.uid())
         and m.role in ('owner', 'manager')
         and p.state = 'managed' and p.suspended_at is null and p.frozen_at is null
    );
$$;

-- Rachel: the owner role in the app, or the SQL editor (a session with no
-- API request behind it), until the web admin's page tools arrive (PR 6).
create or replace function private.is_rachel()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_owner() or coalesce(current_setting('request.jwt.claims', true), '') = '';
$$;

-- One notification about a page, unless it's to a deleted account or to
-- someone the actor blocked (or who blocked them).
create or replace function private.notify_page(
  recipient uuid,
  what public.notification_kind,
  page uuid,
  actor uuid default null,
  msg text default null
)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if recipient is null or recipient is not distinct from actor then
    return;
  end if;
  if not exists (select 1 from profiles where id = recipient and deleted_at is null) then
    return;
  end if;
  if actor is not null and exists (
    select 1 from blocks
     where (blocker_id = recipient and blocked_id = actor) or (blocker_id = actor and blocked_id = recipient)
  ) then
    return;
  end if;
  insert into notifications (recipient_id, kind, actor_id, page_id, message)
  values (recipient, what, actor, page, msg);
end $$;

revoke all on function private.url_host(text) from public, anon, authenticated;
revoke all on function private.email_matches_page(text, uuid) from public, anon, authenticated;
revoke all on function private.new_page_invite_code() from public, anon, authenticated;
revoke all on function private.new_claim_code() from public, anon, authenticated;
revoke all on function private.is_in_good_standing(uuid) from public, anon, authenticated;
revoke all on function private.can_manage_page_media(uuid) from public, anon, authenticated;
revoke all on function private.is_rachel() from public, anon, authenticated;
revoke all on function private.notify_page(uuid, public.notification_kind, uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.can_manage_page_media(uuid) to authenticated;

-- The page becomes managed with this person as owner: used by approving a
-- claim and by accepting a claim invite. Other open claims on the page are
-- declined (and told), and other claim invites cancelled. Pages claimed
-- during the free period are founding partners.
create or replace function private.make_page_owner(page uuid, who uuid, by_whom uuid, logo text default null)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  c record;
begin
  update pages
     set state = 'managed',
         managed_at = now(),
         founding_partner_at = coalesce(founding_partner_at, now()),
         logo_path = coalesce(logo, logo_path),
         updated_at = now()
   where id = page;

  insert into page_members (page_id, user_id, role, invited_by)
  values (page, who, 'owner', by_whom)
  on conflict (page_id, user_id) do update set role = 'owner';

  for c in
    update page_claims
       set status = 'declined', decline_reason = 'another_claim_approved', decided_at = now(), decided_by = by_whom
     where page_claims.page_id = page and user_id <> who and status in ('draft', 'pending')
    returning user_id, status
  loop
    perform private.notify_page(c.user_id, 'page_claim_declined', page, null, 'another_claim_approved');
  end loop;

  update page_invites
     set cancelled_at = now()
   where page_invites.page_id = page and kind = 'claim'
     and accepted_at is null and declined_at is null and cancelled_at is null;
end $$;

revoke all on function private.make_page_owner(uuid, uuid, uuid, text) from public, anon, authenticated;

/* Claiming a page ------------------------------------------------------------------ */

-- Sends (or sends again) a claim's 6-digit email code: a new code each time,
-- valid 30 minutes, kept hashed on the claim.
create or replace function private.send_claim_code(claim uuid, lang text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  c page_claims%rowtype;
  plain text := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
begin
  update page_claims
     set email_code_hash = encode(extensions.digest(id::text || ':' || plain, 'sha256'), 'hex'),
         email_code_expires_at = now() + interval '30 minutes',
         email_code_attempts = 0,
         email_code_sends = email_code_sends + 1,
         email_code_sent_at = now()
   where id = claim
  returning * into c;

  insert into private.page_emails (kind, to_email, language, page_id, claim_id, code)
  values ('claim_code', c.email::text, case when lang in ('en', 'es', 'da', 'de') then lang else 'en' end,
          c.page_id, c.id, plain);
end $$;

revoke all on function private.send_claim_code(uuid, text) from public, anon, authenticated;

-- Starts a claim, or picks up your draft for the page. A work email gets a
-- code (step 2 confirms it); a posted code is made, or kept if the draft
-- already has one that's still valid. Errors: not_allowed, not_claimable,
-- claim_pending, too_many_claims, invalid_email, invalid_role.
create or replace function public.start_page_claim(
  page uuid,
  role_title text,
  proof public.page_claim_proof,
  email text default null,
  note text default null,
  language text default 'en'
)
returns table (claim_id uuid, posted_code text, posted_code_expires_at timestamptz, domain_matches boolean)
language plpgsql volatile security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  address text := lower(trim(coalesce(start_page_claim.email, '')));
  draft page_claims%rowtype;
  matches boolean;
  title text := trim(coalesce(role_title, ''));
  why text := nullif(trim(coalesce(note, '')), '');
begin
  if me is null or not private.is_active_member() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if not exists (select 1 from pages p where p.id = page and p.state = 'unofficial' and p.frozen_at is null) then
    raise exception using errcode = '22023', message = 'not_claimable';
  end if;
  if char_length(title) not between 1 and 60 then
    raise exception using errcode = '22023', message = 'invalid_role';
  end if;
  if proof = 'email' and address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = '22023', message = 'invalid_email';
  end if;

  -- One at a time per member.
  perform 1 from profiles where id = me for update;

  if exists (select 1 from page_claims c where c.page_id = page and c.user_id = me and c.status = 'pending') then
    raise exception using errcode = '22023', message = 'claim_pending';
  end if;

  select * into draft from page_claims c where c.page_id = page and c.user_id = me and c.status = 'draft';

  if not found and (select count(*) from page_claims c where c.user_id = me and c.created_at > now() - interval '1 day') >= 5 then
    raise exception using errcode = '22023', message = 'too_many_claims';
  end if;

  matches := case when proof = 'email' then private.email_matches_page(address, page) end;

  if draft.id is null then
    insert into page_claims (page_id, user_id, role_title, proof, email, email_domain_matches, posted_code,
                             posted_code_expires_at, note)
    values (page, me, left(title, 60), proof,
            case when proof = 'email' then address end, matches,
            case when proof = 'posted_code' then private.new_claim_code() end,
            case when proof = 'posted_code' then now() + interval '7 days' end,
            left(why, 500))
    returning * into draft;
  else
    update page_claims c
       set role_title = left(title, 60),
           proof = start_page_claim.proof,
           email = case when start_page_claim.proof = 'email' then address end,
           email_domain_matches = matches,
           email_confirmed_at = null,
           -- A changed email needs a new code.
           email_code_hash = case when c.email::text = address then c.email_code_hash end,
           email_code_expires_at = case when c.email::text = address then c.email_code_expires_at end,
           posted_code = case
             when start_page_claim.proof <> 'posted_code' then null
             when c.posted_code is not null and c.posted_code_expires_at > now() then c.posted_code
             else private.new_claim_code() end,
           posted_code_expires_at = case
             when start_page_claim.proof <> 'posted_code' then null
             when c.posted_code is not null and c.posted_code_expires_at > now() then c.posted_code_expires_at
             else now() + interval '7 days' end,
           note = left(why, 500)
     where c.id = draft.id
    returning * into draft;
  end if;

  -- Send the email code unless one for this address went out in the last
  -- minute (going back and forth between the steps).
  if proof = 'email' and (draft.email_code_hash is null or draft.email_code_sent_at < now() - interval '1 minute') then
    if draft.email_code_sends >= 5 then
      raise exception using errcode = '22023', message = 'too_many_codes';
    end if;
    perform private.send_claim_code(draft.id, language);
  end if;

  return query select draft.id, draft.posted_code, draft.posted_code_expires_at, matches;
end $$;

-- Sends the email code again (at most once a minute, 5 times a claim).
-- Returns 'sent', 'wait' or 'too_many_codes'.
create or replace function public.resend_page_claim_code(claim uuid, language text default 'en')
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  c page_claims%rowtype;
begin
  select * into c from page_claims where id = claim and user_id = auth.uid() and status = 'draft' and proof = 'email'
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'not_found';
  end if;
  if c.email_code_sent_at > now() - interval '1 minute' then
    return 'wait';
  end if;
  if c.email_code_sends >= 5 then
    return 'too_many_codes';
  end if;
  perform private.send_claim_code(c.id, language);
  return 'sent';
end $$;

-- Sends the claim to Rachel: with the email code (work email) or the link to
-- where the code is (or will be) posted. Returns 'pending', or for an email
-- claim 'wrong_code', 'code_expired' or 'too_many_tries' (5 wrong codes;
-- send a new one). A posted code past its 7 days returns 'code_expired'.
create or replace function public.send_page_claim(claim uuid, email_code text default null, posted_url text default null)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  c page_claims%rowtype;
  link text := nullif(trim(coalesce(posted_url, '')), '');
begin
  if not private.is_active_member() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select * into c from page_claims where id = claim and user_id = auth.uid() and status = 'draft' for update;
  if not found then
    raise exception using errcode = '22023', message = 'not_found';
  end if;
  if not exists (select 1 from pages p where p.id = c.page_id and p.state = 'unofficial' and p.frozen_at is null) then
    raise exception using errcode = '22023', message = 'not_claimable';
  end if;

  if c.proof = 'email' then
    if c.email_code_attempts >= 5 then
      return 'too_many_tries';
    end if;
    if c.email_code_hash is null or c.email_code_expires_at <= now() then
      return 'code_expired';
    end if;
    if encode(extensions.digest(c.id::text || ':' || regexp_replace(coalesce(email_code, ''), '\D', '', 'g'), 'sha256'), 'hex')
       <> c.email_code_hash then
      update page_claims set email_code_attempts = email_code_attempts + 1 where id = c.id;
      return 'wrong_code';
    end if;
    update page_claims
       set status = 'pending', sent_at = now(), email_confirmed_at = now(), email_code_hash = null
     where id = c.id;
  else
    if c.posted_code_expires_at <= now() then
      return 'code_expired';
    end if;
    if link is null or char_length(link) not between 4 and 300 then
      raise exception using errcode = '22023', message = 'invalid_link';
    end if;
    update page_claims set status = 'pending', sent_at = now(), posted_url = link where id = c.id;
  end if;
  return 'pending';
end $$;

-- Withdraws your draft or pending claim.
create or replace function public.withdraw_page_claim(claim uuid)
returns void
language sql volatile security definer
set search_path = public
as $$
  update page_claims set status = 'withdrawn', email_code_hash = null
   where id = claim and user_id = auth.uid() and status in ('draft', 'pending');
$$;

-- Rachel decides a pending claim (the web admin's Claims queue in PR 6; the
-- SQL editor until then):
--   select decide_page_claim('<claim id>', true);
--   select decide_page_claim('<claim id>', false, 'We couldn''t match your email to the brand''s website.');
-- Approving makes the claimant the owner; declining needs the reason they'll
-- see. Either way they're told.
create or replace function public.decide_page_claim(claim uuid, approve boolean, reason text default null)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  c page_claims%rowtype;
  why text := nullif(trim(coalesce(reason, '')), '');
begin
  if not private.is_rachel() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select * into c from page_claims where id = claim for update;
  if not found or c.status <> 'pending' then
    raise exception using errcode = '22023', message = 'not_pending';
  end if;

  if approve then
    if not exists (select 1 from pages p where p.id = c.page_id and p.state = 'unofficial') then
      raise exception using errcode = '22023', message = 'page_taken';
    end if;
    if not private.is_in_good_standing(c.user_id) then
      raise exception using errcode = '22023', message = 'claimant_unavailable';
    end if;
    update page_claims set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = c.id;
    perform private.make_page_owner(c.page_id, c.user_id, auth.uid());
    perform private.notify_page(c.user_id, 'page_claim_approved', c.page_id);
  else
    if why is null or char_length(why) > 300 then
      raise exception using errcode = '22023', message = 'reason_needed';
    end if;
    update page_claims
       set status = 'declined', decline_reason = why, decided_at = now(), decided_by = auth.uid()
     where id = c.id;
    perform private.notify_page(c.user_id, 'page_claim_declined', c.page_id, null, why);
  end if;
end $$;

-- A claim ends when its claimant is banned or deletes their account.
create or replace function private.withdraw_claims_on_leave()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (new.banned_at is not null and old.banned_at is null)
     or (new.deleted_at is not null and old.deleted_at is null) then
    update public.page_claims set status = 'withdrawn', email_code_hash = null
     where user_id = new.id and status in ('draft', 'pending');
  end if;
  return new;
end $$;

drop trigger if exists profiles_withdraw_claims on public.profiles;
create trigger profiles_withdraw_claims
  after update of banned_at, deleted_at on public.profiles
  for each row execute function private.withdraw_claims_on_leave();

revoke all on function private.withdraw_claims_on_leave() from public, anon, authenticated;

/* Invites ------------------------------------------------------------------------------ */

-- Rachel's claim invite, the main path: the person gets an email with an
-- invite code; signing up (or in) with that email makes them the owner, with
-- no claim to wait on. A logo can come along (a path in page-images);
-- without one, the owner is asked for it as the last step of signing up.
-- From the SQL editor until the web admin's Send claim invite (PR 6):
--   select * from send_claim_invite('<page id>', 'scott@8set.dk');
create or replace function public.send_claim_invite(page uuid, email text, logo text default null, language text default 'en')
returns table (invite_id uuid, code text)
language plpgsql volatile security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  address text := lower(trim(coalesce(email, '')));
  inv page_invites%rowtype;
begin
  if not private.is_rachel() then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if not exists (select 1 from pages p where p.id = page and p.state = 'unofficial' and p.frozen_at is null) then
    raise exception using errcode = '22023', message = 'not_claimable';
  end if;
  if address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = '22023', message = 'invalid_email';
  end if;

  insert into page_invites (page_id, kind, email, code, invited_by, logo_path)
  values (page, 'claim', address, private.new_page_invite_code(), auth.uid(), nullif(trim(coalesce(logo, '')), ''))
  returning * into inv;

  insert into private.page_emails (kind, to_email, language, page_id, invite_id, code)
  values ('claim_invite', address, case when language in ('en', 'es', 'da', 'de') then language else 'en' end,
          page, inv.id, inv.code);

  return query select inv.id, inv.code;
end $$;

-- A team invite from an owner or manager: by username (a member) or email
-- (works as a sign-up invite tied to the page, and doesn't use anyone's
-- personal invites). At most 10 open per page. An open invite to the same
-- person is returned rather than doubled. Errors: not_allowed, invalid_role,
-- too_many_invites, not_found (no such member, or blocked either way),
-- already_on_team, invalid_email.
create or replace function public.invite_to_page(page uuid, who text, role public.page_member_role, language text default 'en')
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target text := trim(coalesce(who, ''));
  address text;
  member uuid;
  existing uuid;
  inv page_invites%rowtype;
  account uuid;
begin
  if not private.can_act_as_page(page, 'manager') then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if role not in ('staff', 'manager') then
    raise exception using errcode = '22023', message = 'invalid_role';
  end if;

  -- One at a time per page, so two taps can't pass the cap together.
  perform 1 from pages p where p.id = page for update;

  if position('@' in target) > 1 then
    address := lower(target);
    if address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception using errcode = '22023', message = 'invalid_email';
    end if;
  else
    select p.id into member from profiles p
     where p.username operator(extensions.=) ltrim(target, '@')::extensions.citext
       and p.deleted_at is null and p.banned_at is null and p.onboarded_at is not null
       and not private.blocked_between(p.id);
    if member is null then
      raise exception using errcode = '22023', message = 'not_found';
    end if;
    if exists (select 1 from page_members m where m.page_id = page and m.user_id = member) then
      raise exception using errcode = '22023', message = 'already_on_team';
    end if;
  end if;

  select i.id into existing from page_invites i
   where i.page_id = page and i.kind = 'team'
     and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null and i.expires_at > now()
     and (i.invitee_id = member or lower(i.email::text) = address);
  if existing is not null then
    return existing;
  end if;

  if (select count(*) from page_invites i
       where i.page_id = page and i.kind = 'team'
         and i.accepted_at is null and i.declined_at is null and i.cancelled_at is null and i.expires_at > now()) >= 10 then
    raise exception using errcode = '22023', message = 'too_many_invites';
  end if;

  insert into page_invites (page_id, kind, role, invitee_id, email, code, invited_by)
  values (page, 'team', role, member, address, case when address is not null then private.new_page_invite_code() end, me)
  returning * into inv;

  if address is not null then
    insert into private.page_emails (kind, to_email, language, page_id, invite_id, code)
    values ('team_invite', address, case when language in ('en', 'es', 'da', 'de') then language else 'en' end,
            page, inv.id, inv.code);
    -- Someone already on Grindylocks with that email also gets the push.
    select u.id into account from auth.users u where lower(u.email) = address;
    if account is not null and exists (select 1 from profiles p where p.id = account and p.onboarded_at is not null) then
      perform private.notify_page(account, 'page_invite', page, me, 'team:' || role::text);
    end if;
  else
    perform private.notify_page(member, 'page_invite', page, me, 'team:' || role::text);
  end if;

  return inv.id;
end $$;

-- Cancels an open invite: the page's managers and owner, or Rachel.
create or replace function public.cancel_page_invite(invite uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  inv page_invites%rowtype;
begin
  select * into inv from page_invites where id = invite for update;
  if not found then
    return;
  end if;
  if not (private.is_rachel() or private.can_act_as_page(inv.page_id, 'manager')) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  update page_invites set cancelled_at = now()
   where id = invite and accepted_at is null and declined_at is null and cancelled_at is null;
  -- Its push and bell row go with it.
  delete from notifications n
   where n.kind = 'page_invite' and n.page_id = inv.page_id
     and n.recipient_id in (select inv.invitee_id union select u.id from auth.users u where lower(u.email) = lower(inv.email::text));
end $$;

-- Whether an invite is still open: not answered, cancelled or expired, and
-- the page is in the state the invite needs (a claim invite: still
-- unofficial; a team or ownership invite: managed and not suspended).
create or replace function private.page_invite_open(inv public.page_invites)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select inv.accepted_at is null and inv.declined_at is null and inv.cancelled_at is null and inv.expires_at > now()
     and exists (
       select 1 from pages p
        where p.id = inv.page_id and p.frozen_at is null
          and case when inv.kind = 'claim' then p.state = 'unofficial'
                   else p.state = 'managed' and p.suspended_at is null end
     );
$$;

revoke all on function private.page_invite_open(public.page_invites) from public, anon, authenticated;

-- For the invite screen, before signing in: what an invite code is for.
-- Only answers for an open emailed invite.
create or replace function public.page_invite_preview(code text)
returns table (
  kind text,
  role text,
  page_handle text,
  page_name text,
  page_roles text[],
  page_state text,
  page_logo_path text,
  page_city text,
  page_country text,
  inviter_username text,
  email text,
  expires_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select i.kind::text, i.role::text, p.handle::text, p.display_name, p.roles::text[], p.state::text,
         case when p.state = 'managed' then p.logo_path end,
         p.city, p.country::text,
         case when i.kind = 'team' and u.deleted_at is null then u.username::text end,
         i.email::text, i.expires_at
    from page_invites i
    join pages p on p.id = i.page_id
    left join profiles u on u.id = i.invited_by
   where i.code = upper(regexp_replace(coalesce(page_invite_preview.code, ''), '[^A-Za-z0-9]', '', 'g'))
     and i.email is not null
     and private.page_invite_open(i);
$$;

-- Your open page invites, for the Page invites box: to you as a member, or
-- to your account's email.
create or replace function public.my_page_invites()
returns table (
  id uuid,
  kind text,
  role text,
  created_at timestamptz,
  expires_at timestamptz,
  page_id uuid,
  page_handle text,
  page_name text,
  page_roles text[],
  page_state text,
  page_logo_path text,
  page_city text,
  page_country text,
  inviter_username text,
  inviter_avatar_path text,
  my_role text
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  my_email text;
begin
  if me is null then
    return;
  end if;
  select lower(u.email) into my_email from auth.users u where u.id = me;
  return query
    select i.id, i.kind::text, i.role::text, i.created_at, i.expires_at,
           p.id, p.handle::text, p.display_name, p.roles::text[], p.state::text,
           case when p.state = 'managed' then p.logo_path end,
           p.city, p.country::text,
           case when u.deleted_at is null then u.username::text end,
           case when u.deleted_at is null then u.avatar_path end,
           (select m.role::text from page_members m where m.page_id = p.id and m.user_id = me)
      from page_invites i
      join pages p on p.id = i.page_id
      left join profiles u on u.id = i.invited_by
     where (i.invitee_id = me or (i.invitee_id is null and lower(i.email::text) = my_email))
       and private.page_invite_open(i)
       and (u.id is null or not private.blocked_between(u.id))
     order by i.created_at desc;
end $$;

-- Takes an invite: team (join at its role, or move up to it), ownership
-- (the old owner becomes a manager) or claim (the page becomes managed with
-- you as owner).
create or replace function private.accept_page_invite(inv public.page_invites, who uuid)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  had public.page_member_role;
begin
  if inv.kind = 'claim' then
    if exists (select 1 from page_members m where m.page_id = inv.page_id) then
      raise exception using errcode = '22023', message = 'invite_closed';
    end if;
    perform private.make_page_owner(inv.page_id, who, inv.invited_by, inv.logo_path);
  elsif inv.kind = 'ownership' then
    update page_members set role = 'manager' where page_id = inv.page_id and role = 'owner' and user_id <> who;
    insert into page_members (page_id, user_id, role, invited_by)
    values (inv.page_id, who, 'owner', inv.invited_by)
    on conflict (page_id, user_id) do update set role = 'owner';
  else
    select m.role into had from page_members m where m.page_id = inv.page_id and m.user_id = who;
    if had is null then
      insert into page_members (page_id, user_id, role, invited_by) values (inv.page_id, who, inv.role, inv.invited_by);
    elsif private.page_role_rank(had) < private.page_role_rank(inv.role) then
      update page_members set role = inv.role where page_id = inv.page_id and user_id = who;
    end if;
  end if;

  update page_invites set accepted_at = now(), accepted_by = who where id = inv.id;
  -- Its bell row has done its job.
  delete from notifications n where n.recipient_id = who and n.kind = 'page_invite' and n.page_id = inv.page_id;
end $$;

revoke all on function private.accept_page_invite(public.page_invites, uuid) from public, anon, authenticated;

-- Accept or decline from the Page invites box. Returns the page's handle.
-- Declining an ownership hand-over sends it to Rachel to pick the new owner
-- (her page tools, PR 6). Errors: not_found, invite_closed, suspended.
create or replace function public.answer_page_invite(invite uuid, accept boolean)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_email text;
  inv page_invites%rowtype;
begin
  if me is null or not exists (select 1 from profiles p where p.id = me and p.deleted_at is null and p.banned_at is null) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  select lower(u.email) into my_email from auth.users u where u.id = me;
  select * into inv from page_invites i
   where i.id = invite and (i.invitee_id = me or (i.invitee_id is null and lower(i.email::text) = my_email))
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'not_found';
  end if;
  if not private.page_invite_open(inv) then
    raise exception using errcode = '22023', message = 'invite_closed';
  end if;

  if accept then
    if not private.is_in_good_standing(me) then
      raise exception using errcode = '42501', message = 'suspended';
    end if;
    perform private.accept_page_invite(inv, me);
  else
    update page_invites set declined_at = now() where id = inv.id;
    delete from notifications n where n.recipient_id = me and n.kind = 'page_invite' and n.page_id = inv.page_id;
  end if;
  return (select p.handle::text from pages p where p.id = inv.page_id);
end $$;

-- Called once onboarding has a profile (after the age check), like
-- redeem_my_invite(): if the account was created with an emailed page
-- invite's code, takes that invite. Returns the page's handle, or null.
create or replace function public.redeem_my_page_invite()
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_email text;
  my_code text;
  inv page_invites%rowtype;
begin
  if me is null or not exists (select 1 from profiles p where p.id = me and p.deleted_at is null and p.banned_at is null) then
    return null;
  end if;
  select lower(u.email),
         upper(regexp_replace(coalesce(u.raw_user_meta_data->>'invite_code', ''), '[^A-Za-z0-9]', '', 'g'))
    into my_email, my_code
    from auth.users u where u.id = me;
  if coalesce(my_code, '') = '' then
    return null;
  end if;

  select * into inv from page_invites i where i.code = my_code and lower(i.email::text) = my_email for update;
  if not found then
    return null;
  end if;
  if inv.accepted_by = me then
    return (select p.handle::text from pages p where p.id = inv.page_id);
  end if;
  if not private.page_invite_open(inv) or not private.is_in_good_standing(me) then
    return null;
  end if;
  perform private.accept_page_invite(inv, me);
  return (select p.handle::text from pages p where p.id = inv.page_id);
end $$;

-- For onboarding through a page: the page the account was created to join,
-- your role there, and whether the owner still has to add the logo.
create or replace function public.my_page_onboarding()
returns table (
  page_id uuid,
  handle text,
  display_name text,
  roles text[],
  role text,
  city text,
  metro_area_id uuid,
  needs_logo boolean
)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.handle::text, p.display_name, p.roles::text[], m.role::text, p.city,
         case when 'shop' = any (p.roles) then p.metro_area_id end,
         m.role = 'owner' and p.state = 'managed' and p.logo_path is null
    from auth.users u
    join page_invites i
      on i.accepted_by = u.id
     and i.code = upper(regexp_replace(coalesce(u.raw_user_meta_data->>'invite_code', ''), '[^A-Za-z0-9]', '', 'g'))
    join pages p on p.id = i.page_id
    join page_members m on m.page_id = p.id and m.user_id = u.id
   where u.id = auth.uid()
   limit 1;
$$;

/* The sign-up gate learns page invite codes ----------------------------------------- */

-- An emailed page invite lets its own email address create an account, like
-- a personal invite but without using anyone's invites. Everything else is
-- as before.
create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
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

  if exists (
    select 1 from page_invites i
     where i.code = v_code and lower(i.email::text) = v_email
       and private.page_invite_open(i)
  ) then
    return '{}'::jsonb;
  end if;

  if not exists (
    select 1 from invites i
    join profiles p on p.id = i.inviter_id
    where i.code = v_code
      and i.used_by is null and i.cancelled_at is null and i.returned_at is null
      and i.expires_at > now()
      and p.deleted_at is null and p.banned_at is null
  )
  or exists (select 1 from private.invite_claims c where c.code = v_code and lower(c.email) <> v_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'invite_invalid'));
  end if;
  insert into private.invite_claims (code, email) values (v_code, v_email)
  on conflict (code) do nothing;
  return '{}'::jsonb;
end $$;

revoke all on function public.before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;

/* 5. Logos -------------------------------------------------------------------------- */

-- Public, like the brand's own artwork on its website: logos and (later)
-- header photos, in a folder per page.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('page-images', 'page-images', true, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Whether the caller may write to a folder of page-images (the folder is the
-- page's id).
create or replace function private.can_write_page_folder(folder text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if folder is null or folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_manage_page_media(folder::uuid);
end $$;

revoke all on function private.can_write_page_folder(text) from public, anon, authenticated;
grant execute on function private.can_write_page_folder(text) to authenticated;

drop policy if exists "page images: managers upload" on storage.objects;
create policy "page images: managers upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'page-images' and private.can_write_page_folder((storage.foldername(name))[1]));

drop policy if exists "page images: managers remove" on storage.objects;
create policy "page images: managers remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'page-images' and private.can_write_page_folder((storage.foldername(name))[1]));

-- Sets the logo to an image already uploaded to the page's folder. The first
-- logo on a claimed page makes it OFFICIAL, so that's when its followers
-- hear it's here ("Them is now on Grindylocks"), once per page.
create or replace function public.set_page_logo(page uuid, path text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  p pages%rowtype;
begin
  if not private.can_manage_page_media(page) then
    raise exception using errcode = '42501', message = 'not_allowed';
  end if;
  if path is null or path not like page::text || '/%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'page-images' and o.name = path) then
    raise exception using errcode = '22023', message = 'invalid_logo';
  end if;

  update pages set logo_path = path, updated_at = now() where id = page returning * into p;

  if p.followers_told_at is null then
    update pages set followers_told_at = now() where id = page;
    insert into notifications (recipient_id, kind, page_id)
    select f.user_id, 'page_claimed', page
      from page_follows f
      join profiles pr on pr.id = f.user_id
     where f.page_id = page
       and pr.deleted_at is null and pr.onboarded_at is not null
       and not exists (select 1 from page_members m where m.page_id = page and m.user_id = f.user_id)
       and not exists (select 1 from user_page_blocks b where b.page_id = page and b.user_id = f.user_id);
  end if;
end $$;

/* 6. The bell ---------------------------------------------------------------------- */

-- Page notifications for the bell, beside my_notifications(): claims
-- decided, team changes, a followed page joining, and suggestions going
-- live. Team invites aren't here: they're in my_page_invites().
create or replace function public.my_page_notifications()
returns table (
  id text,
  kind text,
  created_at timestamptz,
  unread boolean,
  page_id uuid,
  page_handle text,
  page_name text,
  page_roles text[],
  page_state text,
  page_logo_path text,
  actor_username text,
  actor_avatar_path text,
  message text
)
language plpgsql stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  seen timestamptz;
begin
  if me is null then
    return;
  end if;
  select ns.seen_at into seen from private.notifications_seen ns where ns.user_id = me;
  return query
    select 'p:' || n.id::text, n.kind::text, n.created_at, seen is null or n.created_at > seen,
           p.id, p.handle::text, p.display_name, p.roles::text[], p.state::text,
           case when p.state = 'managed' then p.logo_path end,
           case when a.deleted_at is null then a.username::text end,
           case when a.deleted_at is null then a.avatar_path end,
           n.message
      from notifications n
      join pages p on p.id = n.page_id
      left join profiles a on a.id = n.actor_id
     where n.recipient_id = me
       and n.kind in ('page_claim_approved', 'page_claim_declined', 'page_team_change', 'page_claimed', 'suggestion_live')
       -- A page you blocked doesn't come back through the bell.
       and (n.kind <> 'page_claimed' or not exists (
             select 1 from user_page_blocks b where b.page_id = p.id and b.user_id = me))
     order by n.created_at desc
     limit 50;
end $$;

-- The dot: as before, plus page notifications and page invites since you
-- last looked.
create or replace function public.notifications_unread()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.my_notifications() n where n.unread)
      or exists (select 1 from public.my_page_notifications() n where n.unread)
      or exists (
           select 1 from public.my_page_invites() i
            where i.created_at > coalesce((select seen_at from private.notifications_seen where user_id = auth.uid()), '-infinity')
         )
      or exists (
           select 1 from follows f
            where f.followee_id = auth.uid() and f.status = 'pending'
              and f.created_at > coalesce((select seen_at from private.notifications_seen where user_id = auth.uid()), '-infinity')
         );
$$;

/* 7. Your pages and their inboxes' push switch ------------------------------------- */

-- The pages you're on, with your role and whether your phone buzzes for the
-- page's inbox (off by default, per person).
create or replace function public.my_pages()
returns table (
  page_id uuid,
  handle text,
  display_name text,
  roles text[],
  state text,
  logo_path text,
  role text,
  inbox_push boolean
)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.handle::text, p.display_name, p.roles::text[], p.state::text,
         case when p.state = 'managed' then p.logo_path end,
         m.role::text, m.inbox_push
    from page_members m
    join pages p on p.id = m.page_id
   where m.user_id = auth.uid()
   order by p.display_name;
$$;

create or replace function public.set_page_inbox_push(page uuid, enabled boolean)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if enabled is null then
    raise exception 'on or off' using errcode = '22023';
  end if;
  update page_members set inbox_push = enabled where page_id = page and user_id = auth.uid();
  if not found then
    raise exception using errcode = '42501', message = 'not_on_the_team';
  end if;
end $$;

/* Push ------------------------------------------------------------------------------- */

create or replace function private.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind in ('comment', 'tag', 'filmer_credit', 'invite_used', 'park_report_accepted', 'caption_mention',
                  'meetup_changed', 'meetup_cancelled', 'meetup_reminder', 'meetup_comment',
                  'page_invite', 'page_claim_approved', 'page_claim_declined', 'page_team_change',
                  'page_claimed', 'suggestion_live')
     and exists (select 1 from private.push_devices d where d.user_id = new.recipient_id) then
    insert into private.push_outbox (recipient_id, notification_id) values (new.recipient_id, new.id);
  end if;
  return null;
end $$;

drop function if exists public.my_push_settings();

create function public.my_push_settings()
returns table (
  comments boolean,
  mentions boolean,
  tags boolean,
  filmer_credits boolean,
  invites boolean,
  someone_new boolean,
  park_fixes boolean,
  meetups boolean,
  teams_claims boolean,
  pages_joining boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(s.comments, true), coalesce(s.mentions, true), coalesce(s.tags, true),
         coalesce(s.filmer_credits, true), coalesce(s.invites, true), coalesce(s.someone_new, true),
         coalesce(s.park_fixes, true), coalesce(s.meetups, true),
         coalesce(s.teams_claims, true), coalesce(s.pages_joining, true)
    from (select auth.uid() as me) m
    left join private.push_settings s on s.user_id = m.me
   where m.me is not null;
$$;

create or replace function public.set_push_setting(setting text, enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if enabled is null then
    raise exception 'on or off' using errcode = '22023';
  end if;
  insert into private.push_settings (user_id) values (me) on conflict (user_id) do nothing;
  case setting
    when 'comments' then update private.push_settings set comments = enabled, updated_at = now() where user_id = me;
    when 'mentions' then update private.push_settings set mentions = enabled, updated_at = now() where user_id = me;
    when 'tags' then update private.push_settings set tags = enabled, updated_at = now() where user_id = me;
    when 'filmer_credits' then update private.push_settings set filmer_credits = enabled, updated_at = now() where user_id = me;
    when 'invites' then update private.push_settings set invites = enabled, updated_at = now() where user_id = me;
    when 'someone_new' then update private.push_settings set someone_new = enabled, updated_at = now() where user_id = me;
    when 'park_fixes' then update private.push_settings set park_fixes = enabled, updated_at = now() where user_id = me;
    when 'meetups' then update private.push_settings set meetups = enabled, updated_at = now() where user_id = me;
    when 'teams_claims' then update private.push_settings set teams_claims = enabled, updated_at = now() where user_id = me;
    when 'pages_joining' then update private.push_settings set pages_joining = enabled, updated_at = now() where user_id = me;
    else raise exception 'unknown setting %', setting using errcode = '22023';
  end case;
end $$;

drop function if exists public.push_claim(integer);

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
  devices jsonb,
  event_id uuid,
  event_starts_at timestamptz,
  event_timezone text,
  event_title text,
  detail text,
  page_handle text,
  page_name text
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
             when n.kind = 'comment' then
               case
                 when c.reply_to_user_id = cl.recipient_id
                   or (select pc.author_id from comments pc where pc.id = c.parent_id) = cl.recipient_id then 'reply'
                 when p.author_id = cl.recipient_id then 'comment'
                 else 'mention'
               end
             when n.kind = 'meetup_comment' then
               case
                 when ec.reply_to_user_id = cl.recipient_id
                   or (select k.author_id from event_comments k where k.id = ec.parent_id) = cl.recipient_id then 'meetup_reply'
                 when private.hosts_series(ev.series_id, cl.recipient_id) then 'meetup_comment'
                 else 'meetup_mention'
               end
             else n.kind::text
           end as k,
           n.actor_id as aid,
           a.username::text as uname,
           case when n.kind = 'caption_mention' then p.caption
                when n.kind = 'meetup_comment' then ec.body
                else c.body end as cbody,
           n.post_id as pid,
           coalesce(fx.display_name, evp.display_name)::text as pk,
           coalesce(fx.slug, evp.slug)::text as pslug,
           null::text as metro,
           (n.id is not null
             and (n.comment_id is null or (c.id is not null and c.deleted_at is null))
             and (n.post_id is null or private.can_see_post_as(n.post_id, cl.recipient_id))
             and (n.event_id is null or private.can_see_event_as(n.event_id, cl.recipient_id))
             and (n.event_comment_id is null or (ec.id is not null and ec.deleted_at is null))
             and (n.kind <> 'meetup_reminder' or (ev.status = 'scheduled' and ev.starts_at > now()))
             and (a.id is null or a.deleted_at is null)
             -- Page notices need their page.
             and (n.kind::text not like 'page%' and n.kind <> 'suggestion_live' or pg.id is not null)) as ok,
           ev.id as eid,
           ev.starts_at as estart,
           case when ev.id is not null then private.park_tz(ev.park_id) end as etz,
           coalesce(ev.title, ev.note)::text as etitle,
           case when n.kind in ('meetup_changed', 'meetup_cancelled', 'page_claim_declined', 'page_team_change', 'suggestion_live',
                                'page_invite')
                then n.message end as edetail,
           pg.handle::text as phandle,
           pg.display_name::text as pname
      from claimed cl
      left join notifications n on n.id = cl.notification_id
      left join comments c on c.id = n.comment_id
      left join posts p on p.id = n.post_id
      left join profiles a on a.id = n.actor_id
      -- A park fix going live names the park.
      left join parks fx on fx.id = n.park_id and n.kind = 'park_report_accepted'
      left join event_comments ec on ec.id = n.event_comment_id
      left join events ev on ev.id = n.event_id
      left join parks evp on evp.id = ev.park_id
      left join pages pg on pg.id = n.page_id
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
             and r.home_metro_area_id = an.metro_area_id),
           null::uuid,
           null::timestamptz,
           null::text,
           null::text,
           null::text,
           null::text,
           null::text
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
                 when 'meetup_changed' then coalesce(s.meetups, true)
                 when 'meetup_cancelled' then coalesce(s.meetups, true)
                 when 'meetup_reminder' then coalesce(s.meetups, true)
                 when 'meetup_comment' then coalesce(s.comments, true)
                 when 'meetup_reply' then coalesce(s.comments, true)
                 when 'meetup_mention' then coalesce(s.mentions, true)
                 when 'page_invite' then coalesce(s.teams_claims, true)
                 when 'page_claim_approved' then coalesce(s.teams_claims, true)
                 when 'page_claim_declined' then coalesce(s.teams_claims, true)
                 when 'page_team_change' then coalesce(s.teams_claims, true)
                 when 'page_claimed' then coalesce(s.pages_joining, true)
                 when 'suggestion_live' then coalesce(s.park_fixes, true)
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
         coalesce(dv.list, '[]'::jsonb),
         e.eid,
         e.estart,
         e.etz,
         left(e.etitle, 80),
         left(e.edetail, 140),
         e.phandle,
         e.pname
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

/* Grants ------------------------------------------------------------------------- */

revoke all on function public.push_claim(integer) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;

revoke all on function public.page_invite_preview(text) from public;
grant execute on function public.page_invite_preview(text) to anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.start_page_claim(uuid, text, public.page_claim_proof, text, text, text)',
    'public.resend_page_claim_code(uuid, text)',
    'public.send_page_claim(uuid, text, text)',
    'public.withdraw_page_claim(uuid)',
    'public.decide_page_claim(uuid, boolean, text)',
    'public.send_claim_invite(uuid, text, text, text)',
    'public.invite_to_page(uuid, text, public.page_member_role, text)',
    'public.cancel_page_invite(uuid)',
    'public.my_page_invites()',
    'public.answer_page_invite(uuid, boolean)',
    'public.redeem_my_page_invite()',
    'public.my_page_onboarding()',
    'public.set_page_logo(uuid, text)',
    'public.my_page_notifications()',
    'public.notifications_unread()',
    'public.my_pages()',
    'public.set_page_inbox_push(uuid, boolean)',
    'public.my_push_settings()',
    'public.set_push_setting(text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
