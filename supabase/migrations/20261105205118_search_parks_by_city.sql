-- Search tab "Places" (Nov 5): park search also matches on the park's city,
-- so typing "Copenhagen" lists Copenhagen's parks under the Places result.
--
-- Parks matched only by city rank after name, official-name and alias
-- matches (rank 3), and carry no matched_alias: the result's detail line
-- already shows the city. Same signature and return type, so existing grants
-- and the generated types stay as they are.

create or replace function public.search_directory(q text, max_results integer default 30)
returns table (
  kind text,
  id uuid,
  name text,
  detail text,
  country text,
  metro_area_id uuid,
  park_count integer,
  slug text,
  status public.park_status,
  park_type public.park_type,
  matched_alias text
)
language sql stable
security invoker
set search_path = ''
as $$
  with needle as (select private.fold(trim(q)) as n),
  metros as (
    select m.id, m.name, m.region, m.country,
           (select count(*) from public.parks p where p.metro_area_id = m.id)::integer as park_count,
           case
             when private.fold(m.name) like (select n from needle) || '%' then 0
             when private.fold(m.name) like '%' || (select n from needle) || '%' then 1
             else 2
           end as rank
    from public.metro_areas m
    where length((select n from needle)) >= 2
      and (
        private.fold(m.name) like '%' || (select n from needle) || '%'
        or exists (
          select 1 from public.parks p
          where p.metro_area_id = m.id and private.fold(p.city) like '%' || (select n from needle) || '%'
        )
      )
  ),
  parks as (
    select p.id, p.display_name, p.city, p.metro_area_id, p.slug, p.status, p.park_type,
           case
             when private.fold(p.display_name) like '%' || (select n from needle) || '%' then null
             when private.fold(p.official_name) like '%' || (select n from needle) || '%' then p.official_name
             else (select a from unnest(p.aliases) a
                   where private.fold(a) like '%' || (select n from needle) || '%' limit 1)
           end as matched_alias,
           case
             when private.fold(p.display_name) like (select n from needle) || '%' then 0
             when private.fold(p.display_name) like '%' || (select n from needle) || '%' then 1
             when private.fold(p.official_name) like '%' || (select n from needle) || '%'
               or exists (select 1 from unnest(p.aliases) a where private.fold(a) like '%' || (select n from needle) || '%')
               then 2
             else 3
           end as rank
    from public.parks p
    where length((select n from needle)) >= 2
      and (
        private.fold(p.display_name) like '%' || (select n from needle) || '%'
        or private.fold(p.official_name) like '%' || (select n from needle) || '%'
        or exists (select 1 from unnest(p.aliases) a where private.fold(a) like '%' || (select n from needle) || '%')
        or private.fold(p.city) like '%' || (select n from needle) || '%'
      )
  )
  (select 'metro'::text, id, name, region, country::text, id, park_count,
          null::text, null::public.park_status, null::public.park_type, null::text
   from metros order by rank, name limit 10)
  union all
  (select 'park'::text, id, display_name, city, null::text, metro_area_id, null::integer,
          slug, status, park_type, matched_alias
   from parks order by rank, display_name limit greatest(max_results, 1));
$$;
