"""Build SQL that loads new parks from the seed CSVs.

Insert-only: a park whose slug is already in the database is skipped, along
with its description, sources, obstacles and hours. Nothing that's already
there is updated or deleted, so the script is safe to run against a database
with real posts and member edits. To change an existing park, use the app,
the web admin or a migration, not this script.

Usage:
  python3 supabase/seed/build_seed.py --metro Asheville > out.sql
  python3 supabase/seed/build_seed.py --check            # validate the CSVs only

Options:
  --metro NAME          only parks in this metro area (repeatable)
  --park SLUG           only this park (repeatable)
  --allow-missing-pins  load parks with no coordinates (they won't show on the
                        map, and this script can't add pins later)
  --no-postgis          leave location null (for a plain local Postgres)
  --check               validate the CSVs and exit without printing SQL

For a load into the hosted project, write the output as a migration so it's in
the migration history, e.g.
  supabase/migrations/<timestamp>_seed_<metro>.sql
"""
import argparse
import csv
import sys
from pathlib import Path

HERE = Path(__file__).parent

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DISCIPLINES = {"inline", "quad", "skateboard", "bmx", "scooter"}
OBSTACLE_TYPES = {
    "rail", "ledge", "hubba", "manual pad", "stairs", "gap", "bank", "pyramid", "fun box", "box",
    "hip", "quarter pipe", "kicker", "mini ramp", "half pipe", "vert ramp", "spine", "bump",
    "volcano", "bowl", "pool", "snake run", "ditch", "full pipe", "pump track", "pole jam",
    "rainbow bench", "other", "street plaza",
}
STATUSES = {"open", "temporarily_closed", "seasonal_closure", "coming_soon"}
PARK_TYPES = {"skatepark", "pump track", "diy"}
SETTINGS = {"indoor", "outdoor", "covered-outdoor"}


def q(v):
    """SQL literal or NULL."""
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def arr(items, cast):
    if not items:
        return f"'{{}}'::{cast}"
    inner = ",".join('"' + i.replace('"', '\\"').replace("'", "''") + '"' for i in items)
    return f"'{{{inner}}}'::{cast}"


def split_list(s):
    return [x.strip() for x in s.split(";") if x.strip()]


def days(s):
    s = s.strip().lower()
    if s == "daily":
        return list(range(1, 8))
    if "-" in s:
        a, b = s.split("-")
        return list(range(DAYS.index(a) + 1, DAYS.index(b) + 2))
    return [DAYS.index(s) + 1]


def anchor(t):
    t = t.strip()
    if not t:
        return "null", "null"
    if t in ("sunrise", "sunset"):
        return q(t), "null"
    return "'clock'", q(t)


def read(name):
    with open(HERE / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def validate(metros, parks, obstacles, sessions):
    errors = []
    metro_keys = {(m["name"], m["country"]) for m in metros}
    slugs = set()
    for p in parks:
        s = p["park_id"]
        if s in slugs:
            errors.append(f"parks.csv: duplicate park_id {s}")
        slugs.add(s)
        if (p["metro_area"], p["country"]) not in metro_keys:
            errors.append(f"parks.csv: {s}: metro area {p['metro_area']} ({p['country']}) "
                          "isn't in metro_areas.csv")
        if p["status"] not in STATUSES:
            errors.append(f"parks.csv: {s}: unknown status {p['status']!r}")
        if p["park_type"] not in PARK_TYPES:
            errors.append(f"parks.csv: {s}: unknown park_type {p['park_type']!r}")
        if p["setting"] not in SETTINGS:
            errors.append(f"parks.csv: {s}: unknown setting {p['setting']!r}")
        if p["night_lighting"] not in ("yes", "no", ""):
            errors.append(f"parks.csv: {s}: night_lighting must be yes, no or blank")
        if p["is_paid"] not in ("true", "false"):
            errors.append(f"parks.csv: {s}: is_paid must be true or false")
        if bool(p["latitude"]) != bool(p["longitude"]):
            errors.append(f"parks.csv: {s}: latitude and longitude go together")
        for f in ("latitude", "longitude", "size_m2"):
            if p[f]:
                try:
                    float(p[f])
                except ValueError:
                    errors.append(f"parks.csv: {s}: {f} isn't a number")
    for o in obstacles:
        if o["park_id"] not in slugs:
            errors.append(f"obstacles.csv: unknown park {o['park_id']}")
        if o["general_type"] not in OBSTACLE_TYPES:
            errors.append(f"obstacles.csv: {o['park_id']}: unknown type {o['general_type']!r}")
    for r in sessions:
        if r["park_id"] not in slugs:
            errors.append(f"sessions.csv: unknown park {r['park_id']}")
        bad = {d.strip() for d in r["disciplines"].split(";")} - DISCIPLINES
        if bad:
            errors.append(f"sessions.csv: {r['park_id']}: unknown disciplines {sorted(bad)}")
        disc = {d.strip() for d in r["disciplines"].split(";")}
        if "inline" in disc and "quad" not in disc:
            errors.append(f"sessions.csv: {r['park_id']}: allows inline but not quad")
        try:
            days(r["days"])
        except (ValueError, IndexError):
            errors.append(f"sessions.csv: {r['park_id']}: can't read days {r['days']!r}")
    return errors


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--metro", action="append", default=[])
    ap.add_argument("--park", action="append", default=[])
    ap.add_argument("--allow-missing-pins", action="store_true")
    ap.add_argument("--no-postgis", action="store_true")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    metros = read("metro_areas.csv")
    parks = read("parks.csv")
    obstacles = read("obstacles.csv")
    sessions = read("sessions.csv")

    errors = validate(metros, parks, obstacles, sessions)
    if errors:
        sys.exit("Seed CSVs have problems:\n  " + "\n  ".join(errors))
    if args.check:
        print(f"OK: {len(metros)} metro areas, {len(parks)} parks, {len(obstacles)} obstacles, "
              f"{len(sessions)} session rows", file=sys.stderr)
        return

    if args.metro:
        known = {m["name"] for m in metros}
        for m in args.metro:
            if m not in known:
                sys.exit(f"Unknown metro area {m!r}")
        parks = [p for p in parks if p["metro_area"] in args.metro]
    if args.park:
        missing = set(args.park) - {p["park_id"] for p in parks}
        if missing:
            sys.exit(f"Not found (or outside --metro): {', '.join(sorted(missing))}")
        parks = [p for p in parks if p["park_id"] in args.park]
    if not parks:
        sys.exit("No parks selected")

    no_pin = [p["park_id"] for p in parks if not p["latitude"]]
    if no_pin and not args.allow_missing_pins:
        sys.exit("These parks have no coordinates, and this script can't add pins later: "
                 + ", ".join(no_pin) + "\nAdd pins to parks.csv, or pass --allow-missing-pins.")

    slugs = {p["park_id"] for p in parks}
    obstacles = [o for o in obstacles if o["park_id"] in slugs]
    sessions = [s for s in sessions if s["park_id"] in slugs]
    used_metros = {(p["metro_area"], p["country"]) for p in parks}
    metros = [m for m in metros if (m["name"], m["country"]) in used_metros]

    out = []
    w = out.append
    w("-- Generated by supabase/seed/build_seed.py. Insert-only: parks already in the")
    w("-- database (by slug) are skipped, with their obstacles and hours.")
    w(f"-- Parks in this file: {', '.join(sorted(slugs))}")
    w("")

    w("insert into public.metro_areas (name, region, country, timezone) values")
    w(",\n".join(f"  ({q(m['name'])}, {q(m['region'])}, {q(m['country'])}, {q(m['timezone'])})"
                 for m in metros))
    w("on conflict (name, country) do nothing;")
    w("")

    park_rows = []
    for p in parks:
        lighting = {"yes": "true", "no": "false", "": "null"}[p["night_lighting"]]
        helmet = "true" if p["helmet_required"] == "true" else "null"
        fee = None if p["entry_fee"].strip().lower() == "free" else p["entry_fee"]
        park_rows.append(
            f"  ({q(p['park_id'])}, {q(p['display_name'])}, {q(p['official_name'])}, "
            f"{arr(split_list(p['aliases']), 'text[]')},\n   {q(p['address'])}, {q(p['city'])}, "
            f"{q(p['metro_area'])}, {q(p['region'])}, {q(p['country'])}, "
            f"{p['latitude'] or 'null'}::float8, {p['longitude'] or 'null'}::float8,\n   "
            f"{q(p['status'])}, {q(p['park_type'].replace(' ', '_'))}, {q(p['setting'].replace('-', '_'))}, "
            f"{lighting}::bool, {q(p['surface'])}, {p['size_m2'] or 'null'}::int, {helmet}::bool, "
            f"{p['is_paid']}, {q(fee)},\n   {q(p['description'])}, "
            f"{arr(split_list(p['sources']), 'text[]')})")
    w("create temp table seed_parks as")
    w("select v.* from (values")
    w(",\n".join(park_rows))
    w(""") as v(slug, display_name, official_name, aliases, address, city, metro, region, country,
  lat, lng, status, park_type, setting, lighting, surface, size_m2, helmet, is_paid, fee,
  description, sources)
where not exists (select 1 from public.parks p where p.slug = v.slug);
""")

    w("""do $$
declare
  n int := (select count(*) from seed_parks);
begin
  raise notice 'Seeding % new park(s): %', n,
    coalesce((select string_agg(slug, ', ' order by slug) from seed_parks), 'none');
end $$;
""")

    loc = ("null" if args.no_postgis else
           "case when v.lat is null then null else extensions.st_setsrid("
           "extensions.st_makepoint(v.lng, v.lat), 4326)::extensions.geography end")
    w(f"""insert into public.parks (slug, display_name, official_name, aliases, address, city,
  metro_area_id, region, country, location, status, park_type, setting, night_lighting, surface,
  size_m2, helmet_required, is_paid, entry_fee)
select v.slug, v.display_name, v.official_name, v.aliases, v.address, v.city, m.id, v.region,
  v.country, {loc}, v.status::park_status, v.park_type::park_type, v.setting::park_setting,
  v.lighting, v.surface, v.size_m2, v.helmet, v.is_paid, v.fee
from seed_parks v
join public.metro_areas m on m.name = v.metro and m.country = v.country;

insert into public.park_descriptions (park_id, locale, body, source)
select p.id, 'en', v.description, 'author'
from seed_parks v join public.parks p on p.slug = v.slug
where v.description is not null;

insert into public.park_admin_notes (park_id, sources)
select p.id, v.sources from seed_parks v join public.parks p on p.slug = v.slug;
""")

    if obstacles:
        w("insert into public.obstacles (park_id, name, general_type, notes)")
        w("select p.id, v.name, v.type::obstacle_type, v.notes from (values")
        w(",\n".join(f"  ({q(o['park_id'])}, {q(o['obstacle_name'])}, "
                     f"{q(o['general_type'].replace(' ', '_'))}, {q(o['notes'])})" for o in obstacles))
        w(") as v(slug, name, type, notes)")
        w("join seed_parks s on s.slug = v.slug")
        w("join public.parks p on p.slug = v.slug;")
        w("")

    if sessions:
        rows = []
        for s in sessions:
            ss = s["season_start"].split("-") if s["season_start"] else [None, None]
            se = s["season_end"].split("-") if s["season_end"] else [None, None]
            sa, st = anchor(s["start"])
            ea, et = anchor(s["end"])
            disc = sorted({d.strip() for d in s["disciplines"].split(";")})
            day_arr = "'{" + ",".join(map(str, days(s["days"]))) + "}'::smallint[]"
            rows.append(
                f"  ({q(s['park_id'])}, {ss[0] and int(ss[0]) or 'null'}, {ss[1] and int(ss[1]) or 'null'}, "
                f"{se[0] and int(se[0]) or 'null'}, {se[1] and int(se[1]) or 'null'}, {day_arr}, "
                f"{sa}::time_anchor, {st}::time, {ea}::time_anchor, {et}::time, "
                f"{arr(disc, 'discipline[]')}, {q(s['note'])})")
        w("""insert into public.park_sessions (park_id, season_start_month, season_start_day,
  season_end_month, season_end_day, days, start_anchor, start_time, end_anchor, end_time,
  disciplines, note)
select p.id, v.ssm::smallint, v.ssd::smallint, v.sem::smallint, v.sed::smallint, v.days, v.sa,
  v.st, v.ea, v.et, v.disc, v.note
from (values""")
        w(",\n".join(rows))
        w(""") as v(slug, ssm, ssd, sem, sed, days, sa, st, ea, et, disc, note)
join seed_parks s on s.slug = v.slug
join public.parks p on p.slug = v.slug;""")

    w("")
    w("drop table seed_parks;")
    print("\n".join(out))


if __name__ == "__main__":
    main()
