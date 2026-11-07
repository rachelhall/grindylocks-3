-- Grindylocks — initial schema (draft 1, Oct 31, 2026)
-- Covers parks, people, roles, posts, moderation. Row-level security is
-- switched on for every table here (default deny); policies come in 0002.

create extension if not exists postgis with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- bmx and scooter are here for park session data; v1 signup offers
-- inline, quad and skateboard only (see profiles check below).
create type discipline as enum ('inline', 'quad', 'skateboard', 'bmx', 'scooter');

create type park_status as enum ('open', 'temporarily_closed', 'seasonal_closure', 'coming_soon');
create type park_type as enum ('skatepark', 'pump_track', 'diy');
create type park_setting as enum ('indoor', 'outdoor', 'covered_outdoor');

-- The 28 reviewed types plus street_plaza, a placeholder for seed rows that
-- admins will split into real obstacles. Hidden from the posting picker.
create type obstacle_type as enum (
  'rail', 'ledge', 'hubba', 'manual_pad', 'stairs', 'gap', 'bank', 'pyramid',
  'fun_box', 'box', 'hip', 'quarter_pipe', 'kicker', 'mini_ramp', 'half_pipe',
  'vert_ramp', 'spine', 'bump', 'volcano', 'bowl', 'pool', 'snake_run', 'ditch',
  'full_pipe', 'pump_track', 'pole_jam', 'rainbow_bench', 'other',
  'street_plaza'
);
create type obstacle_status as enum ('pending', 'active', 'archived');

create type time_anchor as enum ('clock', 'sunrise', 'sunset');
create type text_source as enum ('author', 'machine');

create type role_name as enum ('owner', 'city_admin', 'park_admin', 'park_contributor');
create type follow_status as enum ('pending', 'accepted');

create type post_status as enum ('visible', 'auto_hidden', 'hidden', 'deleted');
create type media_kind as enum ('photo', 'video');
create type upload_status as enum ('uploading', 'processing', 'ready', 'failed');

create type report_reason as enum ('harassment', 'involves_minor', 'spam', 'inappropriate', 'other');
create type report_status as enum ('open', 'dismissed', 'actioned', 'escalated');
create type report_action as enum ('dismiss', 'hide_post', 'warn', 'suspend', 'escalate', 'ban');

create type park_field as enum (
  'hours', 'status', 'lighting', 'location', 'fees', 'disciplines',
  'helmet_rule', 'description', 'obstacle', 'other'
);
create type review_status as enum ('open', 'accepted', 'rejected');

create type notification_kind as enum (
  'comment', 'tag', 'filmer_credit', 'invite_used', 'park_report_accepted', 'role_invite'
);
create type announcement_kind as enum ('joined', 'visiting');

create table metro_areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  region     text,
  country    char(2) not null,
  created_at timestamptz not null default now(),
  unique (name, country)
);

create table parks (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  display_name    text not null,
  official_name   text,
  aliases         text[] not null default '{}',
  address         text,
  city            text not null,
  metro_area_id   uuid not null references metro_areas (id),
  region          text,
  country         char(2) not null,
  location        extensions.geography (point, 4326),
  status          park_status not null default 'open',
  park_type       park_type not null default 'skatepark',
  setting         park_setting,
  night_lighting  boolean,
  surface         text,
  size_m2         integer check (size_m2 > 0),
  helmet_required boolean,
  is_paid         boolean not null default false,
  entry_fee       text,
  verified_at     timestamptz,
  verified_by     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index parks_location_idx on parks using gist (location);
create index parks_metro_idx on parks (metro_area_id);
create index parks_display_name_trgm on parks using gin (display_name extensions.gin_trgm_ops);
create index parks_official_name_trgm on parks using gin (official_name extensions.gin_trgm_ops);

create table park_descriptions (
  park_id    uuid not null references parks (id) on delete cascade,
  locale     text not null check (locale in ('en', 'es', 'da', 'de')),
  body       text not null,
  source     text_source not null default 'author',
  author_id  uuid,
  updated_at timestamptz not null default now(),
  primary key (park_id, locale)
);

create table park_admin_notes (
  park_id    uuid primary key references parks (id) on delete cascade,
  sources    text[] not null default '{}',
  notes      text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table obstacles (
  id           uuid primary key default gen_random_uuid(),
  park_id      uuid not null references parks (id),
  name         text not null,
  general_type obstacle_type not null,
  notes        text,
  height_cm    integer check (height_cm > 0),
  depth_cm     integer check (depth_cm > 0),
  status       obstacle_status not null default 'active',
  suggested_by uuid,
  approved_by  uuid,
  merged_into  uuid references obstacles (id),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index obstacles_park_idx on obstacles (park_id) where status <> 'archived';

create table park_sessions (
  id                 uuid primary key default gen_random_uuid(),
  park_id            uuid not null references parks (id) on delete cascade,
  season_start_month smallint check (season_start_month between 1 and 12),
  season_start_day   smallint check (season_start_day between 1 and 31),
  season_end_month   smallint check (season_end_month between 1 and 12),
  season_end_day     smallint check (season_end_day between 1 and 31),
  days               smallint[] not null default '{1,2,3,4,5,6,7}'
                     check (days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(days) > 0),
  start_anchor       time_anchor,
  start_time         time,
  end_anchor         time_anchor,
  end_time           time,
  disciplines        discipline[] not null,
  note               text,
  check ((season_start_month is null) = (season_end_month is null)),
  check ((start_anchor = 'clock') = (start_time is not null) or start_anchor is null and start_time is null),
  check ((end_anchor = 'clock') = (end_time is not null) or end_anchor is null and end_time is null)
);
create index park_sessions_park_idx on park_sessions (park_id);

create table profiles (
  id                  uuid primary key,
  username            extensions.citext unique
                      check (username ~ '^[a-zA-Z0-9_.]{2,30}$'),
  avatar_path         text,
  disciplines         discipline[] not null default '{}'
                      check (disciplines <@ '{inline,quad,skateboard}'::discipline[]),
  home_metro_area_id  uuid references metro_areas (id),
  home_park_id        uuid references parks (id),
  is_private          boolean not null default false,
  hide_from_regulars  boolean not null default false,
  open_to_meetup      boolean not null default false,
  invites_remaining   smallint not null default 5 check (invites_remaining >= 0),
  age_confirmed_at    timestamptz,
  onboarded_at        timestamptz,
  joined_at           timestamptz not null default now(),
  last_active_at      timestamptz not null default now(),
  suspended_until     timestamptz,
  banned_at           timestamptz,
  deleted_at          timestamptz,
  check (
    onboarded_at is null or deleted_at is not null or (
      username is not null and cardinality(disciplines) > 0
      and home_metro_area_id is not null and age_confirmed_at is not null
    )
  )
);
comment on column profiles.age_confirmed_at is 'Confirmed 16 or older at signup; no birthdate stored.';
comment on table profiles is 'id equals auth.users.id while the account exists. No FK, so the row survives deletion as a "deleted user" tombstone.';
create index profiles_home_metro_idx on profiles (home_metro_area_id);
create index profiles_home_park_idx on profiles (home_park_id);

alter table parks             add foreign key (verified_by)  references profiles (id);
alter table park_descriptions add foreign key (author_id)    references profiles (id);
alter table park_admin_notes  add foreign key (updated_by)   references profiles (id);
alter table obstacles         add foreign key (suggested_by) references profiles (id);
alter table obstacles         add foreign key (approved_by)  references profiles (id);

create table follows (
  follower_id uuid not null references profiles (id),
  followee_id uuid not null references profiles (id),
  status      follow_status not null default 'accepted',
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id);

create table blocks (
  blocker_id uuid not null references profiles (id),
  blocked_id uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table invites (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  inviter_id   uuid not null references profiles (id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  used_by      uuid unique references profiles (id),
  used_at      timestamptz,
  cancelled_at timestamptz
);

create table saved_parks (
  user_id    uuid not null references profiles (id),
  park_id    uuid not null references parks (id),
  created_at timestamptz not null default now(),
  primary key (user_id, park_id)
);

create table announcements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id),
  kind          announcement_kind not null,
  metro_area_id uuid not null references metro_areas (id),
  park_id       uuid references parks (id),
  created_at    timestamptz not null default now()
);
create index announcements_metro_idx on announcements (metro_area_id, created_at desc);

create table role_assignments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id),
  role          role_name not null,
  metro_area_id uuid references metro_areas (id),
  park_id       uuid references parks (id),
  granted_by    uuid references profiles (id),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  badge_hidden  boolean not null default false,
  ended_at      timestamptz,
  ended_reason  text,
  check (
    (role = 'owner' and metro_area_id is null and park_id is null) or
    (role = 'city_admin' and metro_area_id is not null and park_id is null) or
    (role in ('park_admin', 'park_contributor') and park_id is not null and metro_area_id is null)
  )
);
create unique index role_assignments_active_uniq
  on role_assignments (user_id, role, coalesce(metro_area_id, park_id))
  where ended_at is null;

create table role_change_log (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references role_assignments (id),
  actor_id      uuid references profiles (id),
  action        text not null check (action in
                ('invited', 'accepted', 'declined', 'removed', 'downgraded', 'expired', 'ended_by_deletion')),
  details       jsonb,
  created_at    timestamptz not null default now()
);

create table posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references profiles (id),
  caption       text,
  park_id       uuid references parks (id),
  metro_area_id uuid not null references metro_areas (id),
  status        post_status not null default 'visible',
  anonymized    boolean not null default false,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);
create index posts_author_idx on posts (author_id, created_at desc);
create index posts_park_idx on posts (park_id, created_at desc) where status = 'visible';
create index posts_metro_idx on posts (metro_area_id, created_at desc) where status = 'visible';

create table post_slides (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references posts (id) on delete cascade,
  position        smallint not null check (position between 0 and 9),
  kind            media_kind not null,
  storage_path    text,
  stream_video_id text,
  width           integer not null check (width > 0),
  height          integer not null check (height > 0),
  duration_s      numeric(5, 2) check (duration_s > 0 and duration_s <= 60),
  upload_status   upload_status not null default 'uploading',
  obstacle_id     uuid references obstacles (id),
  obstacle_type   obstacle_type,
  filmer_id       uuid references profiles (id),
  unique (post_id, position),
  check ((kind = 'photo' and storage_path is not null and stream_video_id is null and duration_s is null)
      or (kind = 'video' and stream_video_id is not null and storage_path is null)),
  check (obstacle_id is null or obstacle_type is null)
);
create index post_slides_obstacle_idx on post_slides (obstacle_id);
create index post_slides_filmer_idx on post_slides (filmer_id);

create table slide_people_tags (
  slide_id   uuid not null references post_slides (id) on delete cascade,
  user_id    uuid not null references profiles (id),
  tagged_by  uuid references profiles (id),
  created_at timestamptz not null default now(),
  primary key (slide_id, user_id)
);
create index slide_people_tags_user_idx on slide_people_tags (user_id);

create table likes (
  post_id    uuid not null references posts (id) on delete cascade,
  user_id    uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table comments (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references posts (id) on delete cascade,
  author_id        uuid not null references profiles (id),
  parent_id        uuid references comments (id),
  reply_to_user_id uuid references profiles (id),
  body             text not null check (length(body) between 1 and 2200),
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index comments_post_idx on comments (post_id, created_at);

create function comments_one_level() returns trigger language plpgsql
set search_path = public as $$
begin
  if new.parent_id is not null and exists (
    select 1 from comments where id = new.parent_id and parent_id is not null
  ) then
    raise exception 'Replies are one level deep; reply to the top-level comment';
  end if;
  return new;
end $$;
create trigger comments_one_level before insert or update of parent_id on comments
  for each row execute function comments_one_level();

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles (id),
  kind         notification_kind not null,
  actor_id     uuid references profiles (id),
  post_id      uuid references posts (id) on delete cascade,
  comment_id   uuid references comments (id) on delete cascade,
  park_id      uuid references parks (id),
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index notifications_recipient_idx on notifications (recipient_id, created_at desc);

create table reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references profiles (id),
  post_id           uuid references posts (id),
  comment_id        uuid references comments (id),
  reported_user_id  uuid references profiles (id),
  reason            report_reason not null,
  details           text,
  status            report_status not null default 'open',
  action            report_action,
  resolved_by       uuid references profiles (id),
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id, reported_user_id) >= 1)
);
create unique index reports_one_per_reporter_post on reports (reporter_id, post_id) where post_id is not null;

create function reports_auto_hide() returns trigger language plpgsql
set search_path = public as $$
begin
  if new.post_id is not null and (
    select count(distinct reporter_id) from reports
    where post_id = new.post_id and status = 'open'
  ) >= 3 then
    update posts set status = 'auto_hidden' where id = new.post_id and status = 'visible';
  end if;
  return new;
end $$;
create trigger reports_auto_hide after insert on reports
  for each row execute function reports_auto_hide();

create table park_info_reports (
  id              uuid primary key default gen_random_uuid(),
  park_id         uuid not null references parks (id),
  reporter_id     uuid not null references profiles (id),
  field           park_field not null,
  obstacle_id     uuid references obstacles (id),
  suggested_value jsonb,
  note            text,
  photo_path      text,
  status          review_status not null default 'open',
  reviewed_by     uuid references profiles (id),
  reviewed_at     timestamptz,
  applied_value   jsonb,
  created_at      timestamptz not null default now(),
  check (field <> 'obstacle' or obstacle_id is not null),
  check (field <> 'other' or note is not null)
);
create index park_info_reports_open_idx on park_info_reports (park_id) where status = 'open';

create table park_edits (
  id               uuid primary key default gen_random_uuid(),
  park_id          uuid not null references parks (id),
  obstacle_id      uuid references obstacles (id),
  editor_id        uuid references profiles (id),
  field            text not null,
  old_value        jsonb,
  new_value        jsonb,
  info_report_id   uuid references park_info_reports (id),
  reverts_edit_id  uuid references park_edits (id),
  created_at       timestamptz not null default now()
);
create index park_edits_park_idx on park_edits (park_id, created_at desc);

create view park_regulars with (security_invoker = true) as
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
  and pr.deleted_at is null and pr.banned_at is null;

alter table metro_areas        enable row level security;
alter table parks              enable row level security;
alter table park_descriptions  enable row level security;
alter table park_admin_notes   enable row level security;
alter table obstacles          enable row level security;
alter table park_sessions      enable row level security;
alter table profiles           enable row level security;
alter table follows            enable row level security;
alter table blocks             enable row level security;
alter table invites            enable row level security;
alter table saved_parks        enable row level security;
alter table announcements      enable row level security;
alter table role_assignments   enable row level security;
alter table role_change_log    enable row level security;
alter table posts              enable row level security;
alter table post_slides        enable row level security;
alter table slide_people_tags  enable row level security;
alter table likes              enable row level security;
alter table comments           enable row level security;
alter table notifications      enable row level security;
alter table reports            enable row level security;
alter table park_info_reports  enable row level security;
alter table park_edits         enable row level security;;
