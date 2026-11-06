-- Public park and metro area pages on the web (Nov 6). The foundations PR for
-- the web stream: after this, the public pages need no further migration for
-- their first slice.
--
-- What a signed-out visitor can now ask, through four functions in the same
-- pattern as invite_preview() and welcome_metro_areas(): the tables stay
-- closed to signed-out visitors, and the web has no service-role key.
--
--   public_metro_areas()      metro areas that have parks, most parks first
--   public_metro(slug)        one metro area and its parks (the hub page)
--   public_park(slug)         one park's facts, hours, obstacles,
--                             descriptions, photo credits and a post count
--   public_sitemap()          every public page's slug and last-changed time
--
-- Public scope (Rachel, Nov 6): park facts and park photos only, plus a post
-- count for the "join to see posts" teaser. Nothing people-shaped: no
-- regulars, meetups, Here now, posts or usernames.
--
-- Also:
--   - metro_areas.slug, unique, filled for all 11 and set from the name for
--     new metro areas (the seed script inserts name, region, country and
--     timezone only).
--   - The park-media bucket becomes public (Rachel, Nov 6: park photos are
--     official content placed by admins, shown on public pages with their
--     credit). No park has a photo yet, so nothing changes for anyone.
--     Member content (post-media, avatars, meetup-covers) stays private.
--
-- Left out of public_park on purpose (Claude): hours' notes. Most are
-- research notes ("Hours from San Diego Magazine", "Closing time is Rachel's
-- best guess"), which don't belong on a public page.
--
-- Additive: a new column with a trigger, four new functions and one bucket
-- setting. Nothing is replaced or dropped.

-- 1. Metro area slugs -----------------------------------------------------------

alter table public.metro_areas add column slug text;

-- "Málaga" → "malaga", "Los Angeles" → "los-angeles". The project has no
-- unaccent extension, so common Latin accents are folded by hand; Danish
-- æ, ø and å become ae, o and a.
create or replace function private.slugify(value text)
returns text
language sql immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    translate(replace(lower(value), 'æ', 'ae'),
              'áàâäãåçéèêëíìîïñóòôöõøúùûüýÿ',
              'aaaaaaceeeeiiiinoooooouuuuyy'),
    '[^a-z0-9]+', '-', 'g'));
$$;

revoke all on function private.slugify(text) from public, anon, authenticated;

update public.metro_areas set slug = private.slugify(name);

alter table public.metro_areas
  alter column slug set not null,
  add constraint metro_areas_slug_key unique (slug),
  add constraint metro_areas_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

comment on column public.metro_areas.slug is
  'URL name for the public metro area page (grindylocks.com/san-diego). Set from the name on insert; never changes once pages are public.';

create or replace function private.set_metro_area_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := private.slugify(new.name);
  end if;
  return new;
end $$;

create trigger metro_areas_set_slug
  before insert on public.metro_areas
  for each row execute function private.set_metro_area_slug();

revoke all on function private.set_metro_area_slug() from public, anon, authenticated;

-- 2. Shared pieces ------------------------------------------------------------------

-- Posts at a park that any signed-in member could see in its feed: visible
-- and published, by an account that isn't private, banned or deleted (a
-- deleted account's anonymized posts still count, as they still show), or
-- by a page. Only the number ever leaves the database.
create or replace function private.public_post_count(park uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select count(*)::integer
  from posts po
  join profiles a on a.id = po.author_id
  where po.park_id = park
    and po.status = 'visible'
    and po.published_at is not null
    and a.banned_at is null
    and (po.page_id is not null or po.anonymized or (not a.is_private and a.deleted_at is null));
$$;

-- When a park's public page last changed: its own row, its verification, its
-- descriptions or its photos. (parks.updated_at has no trigger, so it alone
-- would go stale.)
create or replace function private.park_last_changed(park uuid)
returns timestamptz
language sql stable security definer
set search_path = public
as $$
  select greatest(
    p.updated_at,
    p.verified_at,
    (select max(d.updated_at) from park_descriptions d where d.park_id = p.id),
    (select max(coalesce(ph.archived_at, ph.created_at)) from park_photos ph where ph.park_id = p.id)
  )
  from parks p
  where p.id = park;
$$;

revoke all on function private.public_post_count(uuid) from public, anon, authenticated;
revoke all on function private.park_last_changed(uuid) from public, anon, authenticated;

-- 3. Metro areas ----------------------------------------------------------------------

create or replace function public.public_metro_areas()
returns table (slug text, name text, region text, country text, park_count integer)
language sql stable security definer
set search_path = public
as $$
  select m.slug, m.name, m.region, m.country, count(p.id)::integer
  from metro_areas m
  join parks p on p.metro_area_id = m.id
  group by m.id
  order by count(p.id) desc, m.name;
$$;

comment on function public.public_metro_areas() is
  'Metro areas that have parks, most parks first, for the signed-out public web pages.';

create or replace function public.public_metro(metro_slug text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', m.slug,
    'name', m.name,
    'region', m.region,
    'country', m.country,
    'timezone', m.timezone,
    'parks', coalesce((
      select jsonb_agg(jsonb_build_object(
          'slug', p.slug,
          'display_name', p.display_name,
          'official_name', p.official_name,
          'city', p.city,
          'status', p.status,
          'park_type', p.park_type,
          'setting', p.setting,
          'night_lighting', p.night_lighting,
          'is_paid', p.is_paid,
          'latitude', p.latitude,
          'longitude', p.longitude,
          'obstacle_count', (
            select count(*) from obstacles o
            where o.park_id = p.id and o.status = 'active' and o.merged_into is null and o.archived_at is null
          )
        ) order by p.display_name)
      from parks p
      where p.metro_area_id = m.id
    ), '[]'::jsonb)
  )
  from metro_areas m
  where m.slug = public_metro.metro_slug
    and exists (select 1 from parks p where p.metro_area_id = m.id);
$$;

comment on function public.public_metro(text) is
  'One metro area and its parks, for the signed-out metro area page. Null for an unknown slug or a metro area with no parks.';

-- 4. Parks ----------------------------------------------------------------------------

create or replace function public.public_park(park_slug text)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', p.slug,
    'display_name', p.display_name,
    'official_name', p.official_name,
    'aliases', to_jsonb(coalesce(p.aliases, '{}')),
    'address', p.address,
    'city', p.city,
    'region', p.region,
    'country', p.country,
    'latitude', p.latitude,
    'longitude', p.longitude,
    'status', p.status,
    'park_type', p.park_type,
    'setting', p.setting,
    'night_lighting', p.night_lighting,
    'surface', p.surface,
    'helmet_required', p.helmet_required,
    'is_paid', p.is_paid,
    'entry_fee', p.entry_fee,
    'verified_at', p.verified_at,
    'updated_at', private.park_last_changed(p.id),
    'metro', jsonb_build_object('slug', m.slug, 'name', m.name, 'timezone', m.timezone),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'season_start_month', s.season_start_month,
          'season_start_day', s.season_start_day,
          'season_end_month', s.season_end_month,
          'season_end_day', s.season_end_day,
          'days', to_jsonb(s.days),
          'start_anchor', s.start_anchor,
          'start_time', s.start_time,
          'end_anchor', s.end_anchor,
          'end_time', s.end_time,
          'disciplines', to_jsonb(s.disciplines)
        ) order by s.season_start_month nulls first, s.days[1], s.start_time nulls first, s.id)
      from park_sessions s
      where s.park_id = p.id
    ), '[]'::jsonb),
    'obstacles', coalesce((
      select jsonb_agg(jsonb_build_object('name', o.name, 'general_type', o.general_type, 'notes', o.notes)
        order by (o.general_type = 'street_plaza'), o.created_at)
      from obstacles o
      where o.park_id = p.id and o.status = 'active' and o.merged_into is null and o.archived_at is null
    ), '[]'::jsonb),
    'descriptions', coalesce((
      select jsonb_agg(jsonb_build_object('locale', d.locale, 'body', d.body) order by d.locale)
      from park_descriptions d
      where d.park_id = p.id
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
          'storage_path', ph.storage_path,
          'width', ph.width,
          'height', ph.height,
          'photographer', ph.photographer,
          'source', ph.source,
          'license', ph.license
        ) order by ph.sort_order, ph.created_at)
      from park_photos ph
      where ph.park_id = p.id and ph.archived_at is null
    ), '[]'::jsonb),
    'post_count', private.public_post_count(p.id)
  )
  from parks p
  join metro_areas m on m.id = p.metro_area_id
  where p.slug = public_park.park_slug;
$$;

comment on function public.public_park(text) is
  'One park for the signed-out park page: facts, hours (without notes), active obstacles, descriptions, active photos with their credits and a post count. No people. Null for an unknown slug.';

-- 5. Sitemap ----------------------------------------------------------------------------

create or replace function public.public_sitemap()
returns table (kind text, slug text, metro_slug text, updated_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  with park_rows as (
    select p.slug, m.slug as metro_slug, private.park_last_changed(p.id) as changed
    from parks p
    join metro_areas m on m.id = p.metro_area_id
  )
  select 'metro'::text, r.metro_slug, r.metro_slug, max(r.changed)
  from park_rows r
  group by r.metro_slug
  union all
  select 'park'::text, r.slug, r.metro_slug, r.changed
  from park_rows r
  order by 1, 2;
$$;

comment on function public.public_sitemap() is
  'Every public page (metro areas with parks, and parks) with its last-changed time, for sitemap.xml.';

revoke all on function public.public_metro_areas() from public;
revoke all on function public.public_metro(text) from public;
revoke all on function public.public_park(text) from public;
revoke all on function public.public_sitemap() from public;
-- Signed-out visitors' fifth set of questions (after invite_preview,
-- page_invite_preview, welcome_metro_areas and request_access).
grant execute on function public.public_metro_areas() to anon, authenticated;
grant execute on function public.public_metro(text) to anon, authenticated;
grant execute on function public.public_park(text) to anon, authenticated;
grant execute on function public.public_sitemap() to anon, authenticated;

-- 6. Park photos go public --------------------------------------------------------------

-- Files are read at /storage/v1/object/public/park-media/<park>/<photo>.jpg.
-- The upload, re-upload and cleanup policies are unchanged, and signed URLs
-- (what the app uses today) keep working.
update storage.buckets set public = true where id = 'park-media';
