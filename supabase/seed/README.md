# Park seed data

The CSVs here are the source for parks loaded by hand, city by city. They're a
copy of the tables in the project doc "Grindylocks — Park Seed Data", which
keeps the research notes; keep the two in step when adding a city.

| File | One row per |
| --- | --- |
| `metro_areas.csv` | metro area (name, region, country, IANA timezone) |
| `parks.csv` | park |
| `obstacles.csv` | obstacle, linked by `park_id` |
| `sessions.csv` | block of opening hours and allowed disciplines |

Column meanings are under "Park data model" in the Project Brief. Rules the
check enforces: every session that allows inline also allows quad, obstacle
types come from the fixed list, and every park's metro area is in
`metro_areas.csv`.

## Loading a new city

`build_seed.py` is **insert-only**: parks whose slug is already in the database
are skipped, with their obstacles and hours. It never updates or deletes, so
it's safe with real posts and member edits. Fix an existing park in the app or
the web admin, or with a migration.

1. Add the rows to the CSVs (and the metro area, if it's new).
2. Find pins on OpenStreetMap (the script refuses parks with no pin, since it
   can't add one later):

   ```sh
   cd ~/Documents/github/grindylocks && mkdir -p cli-output && python3 supabase/seed/find_pins.py --bbox <south>,<west>,<north>,<east> 2>&1 | tee cli-output/find-pins.log
   ```

3. Check the CSVs, then write the load as a migration so it's in the
   migration history:

   ```sh
   python3 supabase/seed/build_seed.py --check
   python3 supabase/seed/build_seed.py --metro Asheville > supabase/migrations/<timestamp>_seed_asheville.sql
   ```

4. Try it in a rolled-back transaction, then apply it with the migration tool.
5. Rename the file to the version it was applied under (the tool stamps its own
   time; check with `list_migrations`), so the repo matches production. See
   "Migrations" in `AGENTS.md`.

The first 50 parks (10 metro areas) were loaded on Oct 31, 2026 by an earlier,
re-runnable version of this script, before the repo existed.
