#!/usr/bin/env python3
"""Turns the per-brand product CSVs into a SQL migration that adds or updates
the catalog, matched by product ID.

Usage (from the repo root):
  python3 supabase/seed/products/build_products_seed.py --check
  python3 supabase/seed/products/build_products_seed.py > supabase/migrations/<timestamp>_catalog_seed.sql
  python3 supabase/seed/products/build_products_seed.py themskates usdskates > …   (only those brands)

Unlike the park and page seeds (insert-only), this one updates: a brand's
CSV is meant to correct things (renames, out of production), so each row
overwrites the product with its product_id. Rows without an ID are new: the
script gives them one and writes it back into the CSV, so commit the CSV
with the migration. Products missing from a CSV are left alone (removing one
is Rachel's call, in Supabase).

A product's stock parts are replaced by what its row lists, and its notes
and sources by its row's.
"""
import csv, glob, os, re, sys, uuid

here = os.path.dirname(os.path.abspath(__file__))
pages_csv = os.path.join(here, "..", "pages", "pages.csv")

COLS = ["product_id", "part_type", "model", "family", "pro_rider", "edition", "entry_type", "partner",
        "disciplines", "first_year", "status", "includes_frame", "stock_parts", "notes", "sources"]
# Keep in step with public.part_types.
PART_TYPES = {
    "boot": {"inline", "quad"}, "frame": {"inline"}, "plate": {"quad"}, "trucks": {"quad", "skateboard"},
    "deck": {"skateboard"}, "wheels": {"inline", "quad", "skateboard"}, "bearings": {"inline", "quad", "skateboard"},
    "liner": {"inline"}, "soulplate": {"inline"}, "toe_stop": {"quad"}, "slide_blocks": {"quad"},
    "laces": {"inline", "quad"},
}
ENTRY_TYPES = {"model": "model", "pro": "pro", "collab": "collab", "special edition": "special_edition"}
STATUSES = {"current", "discontinued", "unknown"}
YEAR = re.compile(r"^(c\. )?[12][0-9]{3}$")


def part_key(s):
    return s.strip().lower().replace(" ", "_")


def q(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def fail(msg):
    sys.stderr.write("error: " + msg + "\n")
    sys.exit(1)


def main():
    args = sys.argv[1:]
    check_only = "--check" in args
    only = {a for a in args if not a.startswith("--")}

    pages = list(csv.DictReader(open(pages_csv, encoding="utf-8")))
    handle_by_name = {p["display_name"].lower(): p["handle"] for p in pages}
    handles = {p["handle"] for p in pages}

    files = sorted(glob.glob(os.path.join(here, "*.csv")))
    products = []  # every product in every file, for references across brands
    seen_ids = {}
    for path in files:
        handle = os.path.splitext(os.path.basename(path))[0]
        if handle not in handles:
            fail(f"{os.path.basename(path)}: no page with the handle {handle}")
        rows = list(csv.DictReader(open(path, encoding="utf-8")))
        cols = list(rows[0].keys()) if rows else COLS
        if cols != COLS:
            fail(f"{handle}.csv: columns should be {','.join(COLS)}")
        changed = False
        for i, r in enumerate(rows):
            where = f"{handle}.csv row {i + 2}"
            if not r["product_id"].strip():
                if check_only:
                    fail(f"{where}: no product_id (run without --check to give it one)")
                r["product_id"] = str(uuid.uuid4())
                changed = True
            pid = r["product_id"].strip()
            try:
                uuid.UUID(pid)
            except ValueError:
                fail(f"{where}: product_id {pid} isn't a valid ID")
            if pid in seen_ids:
                fail(f"{where}: product_id also used at {seen_ids[pid]}")
            seen_ids[pid] = where
            products.append({"handle": handle, "where": where, "row": r, "sort": (i + 1) * 10})
        if changed:
            with open(path, "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=COLS, lineterminator="\n")
                w.writeheader()
                w.writerows(rows)
            sys.stderr.write(f"gave new rows in {handle}.csv a product_id; commit the CSV\n")

    # Models, by brand, part type and name, for bases and stock parts.
    models = {}
    for p in products:
        r = p["row"]
        if r["entry_type"].strip() == "model":
            key = (p["handle"], part_key(r["part_type"]), r["model"].strip().lower())
            if key in models:
                fail(f"{p['where']}: same model as {models[key]['where']}")
            models[key] = p

    out_rows, stock_rows = [], []
    scope = set()  # the products this run writes
    for p in products:
        r, where = p["row"], p["where"]
        part = part_key(r["part_type"])
        if part not in PART_TYPES:
            fail(f"{where}: part_type {r['part_type']} isn't one of {', '.join(sorted(PART_TYPES))}")
        entry = ENTRY_TYPES.get(r["entry_type"].strip())
        if not entry:
            fail(f"{where}: entry_type {r['entry_type']} isn't model, pro, collab or special edition")
        model = r["model"].strip()
        if not model or len(model) > 80:
            fail(f"{where}: model name missing or too long")
        if entry == "pro" and not r["pro_rider"].strip():
            fail(f"{where}: a pro model needs pro_rider")
        status = r["status"].strip()
        if status not in STATUSES:
            fail(f"{where}: status {status} isn't current, discontinued or unknown")
        year = r["first_year"].strip()
        if year and not YEAR.match(year):
            fail(f"{where}: first_year {year} should look like 2019 or c. 2019")
        disciplines = [d.strip().lower() for d in r["disciplines"].split(";") if d.strip()] or ["inline"]
        bad = [d for d in disciplines if d not in PART_TYPES[part]]
        if bad:
            fail(f"{where}: a {r['part_type']} isn't for {', '.join(bad)}")
        includes_frame = r["includes_frame"].strip().lower() in ("yes", "true", "y", "1")
        if includes_frame and part != "boot":
            fail(f"{where}: only a boot can include its frame")
        partner = None
        if r["partner"].strip():
            partner = handle_by_name.get(r["partner"].strip().lower()) or (
                r["partner"].strip() if r["partner"].strip() in handles else None)
            if not partner:
                fail(f"{where}: partner {r['partner']} isn't a page (use its name or handle)")
            if partner == p["handle"]:
                fail(f"{where}: a brand can't be its own partner")
        for item in [s for s in r["stock_parts"].split(";") if s.strip()]:
            m = re.match(r"^\s*([a-z _]+):\s*(.+?)\s*/\s*(.+?)\s*$", item, re.I)
            if not m:
                fail(f"{where}: stock part '{item.strip()}' should look like 'frame: Them / Street'")
            sp_type, sp_brand, sp_model = part_key(m.group(1)), m.group(2), m.group(3)
            if sp_type not in PART_TYPES or sp_type == part:
                fail(f"{where}: stock part type {m.group(1)} doesn't fit a {r['part_type']}")
            sp_handle = handle_by_name.get(sp_brand.lower()) or (sp_brand if sp_brand in handles else None)
            target = models.get((sp_handle, sp_type, sp_model.lower()))
            if not target:
                fail(f"{where}: no {sp_type} model {sp_brand} / {sp_model} to use as a stock part")
            stock_rows.append((r["product_id"], sp_type, target["row"]["product_id"]))
        if only and p["handle"] not in only:
            continue
        scope.add(r["product_id"])
        out_rows.append("  (" + ", ".join([
            q(r["product_id"]), q(p["handle"]), q(part), q(model), q(r["family"].strip()), q(r["pro_rider"].strip()),
            q(r["edition"].strip()), q(entry), q(partner), q("{" + ",".join(disciplines) + "}"), q(year), q(status),
            "true" if includes_frame else "false", str(p["sort"]), q(r["notes"].strip()), q(r["sources"].strip()),
        ]) + ")")

    if check_only:
        sys.stderr.write(f"ok: {len(products)} products in {len(files)} brand files, "
                         f"{len(stock_rows)} stock parts\n")
        return

    stock_rows = [s for s in stock_rows if s[0] in scope]

    out = []
    w = out.append
    w("-- Brand and shop accounts, part A, PR 4: the product catalog's seed.")
    w("-- Generated by supabase/seed/products/build_products_seed.py from the per-brand")
    w("-- CSVs in supabase/seed/products/; edit those and regenerate rather than editing")
    w("-- this file.")
    w(f"-- {len(out_rows)} products from {len(only) if only else len(files)} brands. Adds or updates by product ID,")
    w("-- so a re-run applies the CSVs' corrections; products not in a CSV are left alone.")
    w("")
    w("create temp table catalog_seed on commit drop as")
    w("select v.id::uuid as id, v.handle, v.part_type, v.name, v.family, v.pro_rider, v.edition,")
    w("  v.entry_type::public.product_entry_type as entry_type, v.partner,")
    w("  v.disciplines::public.discipline[] as disciplines, v.first_year,")
    w("  v.status::public.product_status as status, v.includes_frame, v.sort, v.notes, v.sources")
    w("from (values")
    w(",\n".join(out_rows))
    w(") as v (id, handle, part_type, name, family, pro_rider, edition, entry_type, partner, disciplines,")
    w("        first_year, status, includes_frame, sort, notes, sources);")
    w("")
    w("insert into public.products (id, page_id, part_type, name, family, pro_rider, edition, entry_type,")
    w("  partner_page_id, disciplines, first_year, status, includes_frame, sort)")
    w("select v.id, p.id, v.part_type, v.name, v.family, v.pro_rider, v.edition, v.entry_type, pp.id,")
    w("  v.disciplines, v.first_year, v.status, v.includes_frame, v.sort")
    w("from catalog_seed v")
    w("join public.pages p on p.handle = v.handle")
    w("left join public.pages pp on pp.handle = v.partner")
    w("on conflict (id) do update set")
    w("  page_id = excluded.page_id, part_type = excluded.part_type, name = excluded.name,")
    w("  family = excluded.family, pro_rider = excluded.pro_rider, edition = excluded.edition,")
    w("  entry_type = excluded.entry_type, partner_page_id = excluded.partner_page_id,")
    w("  disciplines = excluded.disciplines, first_year = excluded.first_year, status = excluded.status,")
    w("  includes_frame = excluded.includes_frame, sort = excluded.sort,")
    w("  base_id = null;")
    w("")
    w("-- Which model each pro model, collab and special edition builds on: the brand's")
    w("-- model with the same part type and name, if the catalog has it.")
    w("update public.products pr set base_id = b.id")
    w("from catalog_seed v, public.products b")
    w("where pr.id = v.id and pr.entry_type <> 'model'")
    w("  and b.page_id = pr.page_id and b.part_type = pr.part_type and b.entry_type = 'model'")
    w("  and lower(b.name) = lower(pr.name);")
    w("")
    w("insert into public.product_notes (product_id, notes, sources)")
    w("select v.id, v.notes, v.sources from catalog_seed v")
    w("on conflict (product_id) do update set notes = excluded.notes, sources = excluded.sources;")
    w("")
    w("-- Stock parts: replaced by what each product's row lists.")
    w("delete from public.product_stock_parts s using catalog_seed v where s.product_id = v.id;")
    if stock_rows:
        w("insert into public.product_stock_parts (product_id, part_type, part_id)")
        w("values")
        w(",\n".join(f"  ({q(a)}::uuid, {q(t)}, {q(b)}::uuid)" for a, t, b in stock_rows) + ";")
    sys.stdout.write("\n".join(out) + "\n")


main()
