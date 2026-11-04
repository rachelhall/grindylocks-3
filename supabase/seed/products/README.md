# Product catalog seed

One CSV per brand, named by the brand page's handle (`themskates.csv`). They
started as the tables in the project docs "Grindylocks — Gear Seed Data"
(inline) and "Grindylocks — Quad Gear Seed Data" (quads), split on Nov 4,
2026 with a product ID added to every row. **From now on these CSVs are the
source**: the docs keep the research notes, but corrections go here.

The plan: send each brand its CSV, they correct it and send it back, and the
import applies their changes.

## Columns

| Column | What goes in it |
| --- | --- |
| `product_id` | The stable product ID. **Brands leave it alone.** Blank on a new row: the script fills it in. |
| `part_type` | boot, frame, plate, trucks, deck, wheels, bearings, liner, soulplate, toe stop, slide blocks, laces |
| `model` | The model's name. Pro models, collabs and special editions repeat their model's name. |
| `family` | Groups related models (Aeon, Fluid). Blank when a model stands alone. |
| `pro_rider` | Pro models only. Text; it links to a profile only once the rider confirms it (part B). |
| `edition` | A collab's or special edition's name (Brain Dead, Allstar), or a pro sequel (II, V2, Storm). |
| `entry_type` | model, pro, collab or special edition |
| `partner` | A collab's other brand, by page name or handle, so it shows on that page too. |
| `disciplines` | `inline`, `quad`, `skateboard`, separated by `;`. Blank means inline. Must fit the part type (a frame is inline only). |
| `first_year` | `2019` or `c. 2019`, or blank |
| `status` | current, discontinued or unknown |
| `includes_frame` | `yes` on a unibody boot (USD Aeon), so the gear closet never asks for a frame |
| `stock_parts` | What a model comes with: `frame: Them / Street; wheels: Them / Them wheels`. Each is brand / model of that part type. Pro models inherit their model's unless they list their own for a part type. |
| `notes`, `sources` | Internal: only Rachel can read them. |

A pro model, collab or special edition sits under the brand's model with the
same part type and name. If the catalog has no such model (UnderCover's Movie
Line pro wheels), they're grouped under the name instead.

## Importing

Unlike the park and page seeds, which are insert-only, this import
**updates**: every row overwrites the product with its `product_id`, its
notes, and its stock parts. Products that aren't in a CSV are left alone;
removing one is Rachel's call, in Supabase. Moving a row to another brand's
CSV moves the product (a split, like Seba → FR), and its ID stays the same,
so nobody's setups break.

```sh
cd ~/Documents/github/grindylocks && mkdir -p cli-output && python3 supabase/seed/products/build_products_seed.py --check 2>&1 | tee cli-output/products-check.log
```

Then write the migration for the brands that changed (the script gives new
rows their IDs and writes them back, so commit the CSVs with it):

```sh
cd ~/Documents/github/grindylocks && mkdir -p cli-output && python3 supabase/seed/products/build_products_seed.py themskates > supabase/migrations/<timestamp>_catalog_themskates.sql 2> cli-output/products-build.log
```

Try it in a rolled-back transaction, then apply it with the migration tool.
With no brand names it writes every brand; that's about 180 KB, too big for
the migration tool in one go, so the first load was split into seven
migrations by brand (`catalog_seed_1` to `_7`).

**Fixes made in Supabase** (or, from PR 6, by approving a product suggestion)
aren't in the CSVs, so the next import of that brand would undo them. Until
there's an export, make the same fix in the CSV.
