/**
 * The product catalog, app side (part A, PR 4).
 *
 * The rules live in the database (migration `catalog`):
 * - Every signed-in member reads the catalog; nobody edits it in the app
 *   (Rachel maintains it from the per-brand CSVs in supabase/seed/products).
 * - `catalog_entries` is a product with its page and partner page, and
 *   "includes frame" carried over from its model.
 * - `product_stock_setup` is each product's stock parts, with pro models
 *   inheriting their model's part type by part type.
 * - Suggest a change goes to Rachel's Product suggestions queue
 *   (suggest_product); until the web admin has it (PR 6) it's read in Supabase.
 *
 * `buildCatalog` turns a page's entries into the Products tab's groups (the
 * Brand-Products, Brand-Products-Past and Brand-Products-Bones mockups).
 */
import { useMutation, useQuery } from '@tanstack/react-query';

import type { Database } from './database.types';
import { fresh, keys } from './query';
import { supabase } from './supabase';

type Enums = Database['public']['Enums'];
export type Discipline = Enums['discipline'];
export type EntryType = Enums['product_entry_type'];
export type ProductStatus = Enums['product_status'];
export type SuggestionKind = Enums['product_suggestion_kind'];

/** Part types in the order the Products tab shows them (public.part_types.sort). */
export const PART_TYPES = [
  'boot',
  'frame',
  'plate',
  'trucks',
  'deck',
  'wheels',
  'bearings',
  'liner',
  'soulplate',
  'toe_stop',
  'slide_blocks',
  'laces',
] as const;
export type PartType = (typeof PART_TYPES)[number];

const DISCIPLINE_ORDER: Discipline[] = ['inline', 'quad', 'skateboard', 'bmx', 'scooter'];

export type CatalogEntry = {
  id: string;
  pageId: string;
  pageHandle: string;
  pageName: string;
  partType: PartType;
  name: string;
  family: string | null;
  proRider: string | null;
  edition: string | null;
  entryType: EntryType;
  baseId: string | null;
  partnerPageId: string | null;
  partnerHandle: string | null;
  partnerName: string | null;
  disciplines: Discipline[];
  firstYear: string | null;
  status: ProductStatus;
  includesFrame: boolean;
  sort: number;
};

export type StockPart = { partType: PartType; id: string; name: string; pageId: string; pageName: string };

const ENTRY_COLUMNS =
  'id, page_id, page_handle, page_name, part_type, name, family, pro_rider, edition, entry_type, base_id, partner_page_id, partner_handle, partner_name, disciplines, first_year, status, includes_frame, sort';

type EntryRow = Database['public']['Views']['catalog_entries']['Row'];

function toEntry(r: EntryRow): CatalogEntry {
  return {
    id: r.id!,
    pageId: r.page_id!,
    pageHandle: r.page_handle!,
    pageName: r.page_name!,
    partType: r.part_type as PartType,
    name: r.name!,
    family: r.family,
    proRider: r.pro_rider,
    edition: r.edition,
    entryType: r.entry_type!,
    baseId: r.base_id,
    partnerPageId: r.partner_page_id,
    partnerHandle: r.partner_handle,
    partnerName: r.partner_name,
    disciplines: sortDisciplines(r.disciplines ?? []),
    firstYear: r.first_year,
    status: r.status!,
    includesFrame: Boolean(r.includes_frame),
    sort: r.sort ?? 0,
  };
}

/** A page's products, plus collabs another brand sells with it. */
export async function fetchPageCatalog(pageId: string): Promise<CatalogEntry[]> {
  const { data, error } = await supabase
    .from('catalog_entries')
    .select(ENTRY_COLUMNS)
    .or(`page_id.eq.${pageId},partner_page_id.eq.${pageId}`)
    .order('sort');
  if (error) throw error;
  return (data ?? []).map(toEntry);
}

export function usePageCatalog(pageId: string | undefined) {
  return useQuery({
    queryKey: keys.pageCatalog(pageId ?? ''),
    queryFn: () => fetchPageCatalog(pageId!),
    enabled: Boolean(pageId),
    staleTime: fresh.parks,
  });
}

export type ProductDetail = {
  entry: CatalogEntry;
  /** Pro models, collabs and special editions built on it. */
  children: CatalogEntry[];
  stock: StockPart[];
};

/** One product for its sheet: itself, what's built on it, and its stock setup. */
export async function fetchProduct(id: string): Promise<ProductDetail | null> {
  const [entries, stock] = await Promise.all([
    supabase.from('catalog_entries').select(ENTRY_COLUMNS).or(`id.eq.${id},base_id.eq.${id}`).order('sort'),
    supabase
      .from('product_stock_setup')
      .select('part_type, part_id, part_name, part_page_id, part_page_name, part_type_sort')
      .eq('product_id', id)
      .order('part_type_sort'),
  ]);
  if (entries.error) throw entries.error;
  if (stock.error) throw stock.error;
  const all = (entries.data ?? []).map(toEntry);
  const entry = all.find((e) => e.id === id);
  if (!entry) return null;
  return {
    entry,
    children: all.filter((e) => e.baseId === id),
    stock: (stock.data ?? []).map((s) => ({
      partType: s.part_type as PartType,
      id: s.part_id!,
      name: s.part_name!,
      pageId: s.part_page_id!,
      pageName: s.part_page_name!,
    })),
  };
}

export function useProduct(id: string | null) {
  return useQuery({
    queryKey: keys.product(id ?? ''),
    queryFn: () => fetchProduct(id!),
    enabled: Boolean(id),
    staleTime: fresh.parks,
  });
}

export function useSuggestProduct() {
  return useMutation({
    mutationFn: async (s: {
      pageId: string;
      kind: SuggestionKind;
      productId?: string | null;
      value?: string;
      partType?: PartType | null;
      note?: string;
    }) => {
      const { error } = await supabase.rpc('suggest_product', {
        page: s.pageId,
        kind: s.kind,
        product: s.productId ?? undefined,
        value: s.value?.trim() || undefined,
        part_type: s.partType ?? undefined,
        note: s.note?.trim() || undefined,
      });
      if (error) throw error;
    },
  });
}

/* The Products tab ----------------------------------------------------------------------- */

export const sortDisciplines = (ds: Discipline[]) =>
  [...new Set(ds)].sort((a, b) => DISCIPLINE_ORDER.indexOf(a) - DISCIPLINE_ORDER.indexOf(b));

const isPast = (e: CatalogEntry) => e.status === 'discontinued';

/**
 * A row in a group: a model with what's built on it; a heading for pro models
 * whose model isn't in the catalog (UnderCover's Movie Line); or a lone one
 * (a GAWDS pro skate named for its rider).
 */
export type CatalogUnit =
  | { kind: 'model'; entry: CatalogEntry; children: CatalogEntry[]; family: string | null; sort: number }
  | { kind: 'heading'; name: string; children: CatalogEntry[]; family: string | null; sort: number }
  | { kind: 'single'; entry: CatalogEntry; family: string | null; sort: number };

/** A family header appears only when it has two or more models. */
export type CatalogBlock = { family: string | null; units: CatalogUnit[] };

export type CatalogGroup = {
  partType: PartType;
  /** Set when the group isn't for every discipline the brand covers (WHEELS · SKATEBOARD). */
  disciplines: Discipline[] | null;
  blocks: CatalogBlock[];
};

export type CatalogView = {
  groups: CatalogGroup[];
  /** Made with this page, sold by another brand. */
  collabs: CatalogEntry[];
  /** Discontinued entries in the catalog (0 on archives, which show everything). */
  pastCount: number;
  /** How many are hidden right now. */
  hiddenCount: number;
  /** Part types the page has, for Suggest a change. */
  partTypes: PartType[];
  empty: boolean;
};

/**
 * Groups a page's entries for the Products tab: by part type, then family,
 * with pro models, collabs and special editions under their model. Past gear
 * is left out unless `showPast` (archives always show everything); a past
 * model still shows when something built on it is current.
 */
export function buildCatalog(entries: CatalogEntry[], pageId: string, opts: { showPast: boolean; archive: boolean }): CatalogView {
  const showAll = opts.archive || opts.showPast;
  const visible = (e: CatalogEntry) => showAll || !isPast(e);
  const own = entries.filter((e) => e.pageId === pageId);
  const others = entries.filter((e) => e.pageId !== pageId);

  const brandDisciplines = sortDisciplines(own.flatMap((e) => e.disciplines));
  let shown = 0;
  const pastCount = opts.archive ? 0 : entries.filter(isPast).length;

  const groups: CatalogGroup[] = [];
  for (const partType of PART_TYPES) {
    const inGroup = own.filter((e) => e.partType === partType).sort((a, b) => a.sort - b.sort);
    if (inGroup.length === 0) continue;

    const ids = new Set(inGroup.map((e) => e.id));
    const units: CatalogUnit[] = [];
    const childrenOf = new Map<string, CatalogEntry[]>();
    const orphans = new Map<string, CatalogEntry[]>();
    for (const e of inGroup) {
      if (e.entryType === 'model') continue;
      if (e.baseId && ids.has(e.baseId)) {
        childrenOf.set(e.baseId, [...(childrenOf.get(e.baseId) ?? []), e]);
      } else {
        const key = e.name.toLowerCase();
        orphans.set(key, [...(orphans.get(key) ?? []), e]);
      }
    }
    for (const e of inGroup) {
      if (e.entryType !== 'model') continue;
      const children = (childrenOf.get(e.id) ?? []).filter(visible);
      if (!visible(e) && children.length === 0) continue;
      shown += 1 + children.length;
      units.push({ kind: 'model', entry: e, children, family: e.family, sort: e.sort });
    }
    for (const group of orphans.values()) {
      const children = group.filter(visible);
      if (children.length === 0) continue;
      shown += children.length;
      const first = children[0];
      units.push(
        group.length === 1
          ? { kind: 'single', entry: first, family: first.family, sort: first.sort }
          : { kind: 'heading', name: first.name, children, family: first.family, sort: first.sort },
      );
    }
    if (units.length === 0) continue;
    units.sort((a, b) => a.sort - b.sort);

    // Families: a header only for two or more models, gathered where the first one sits.
    const familyCount = new Map<string, number>();
    for (const u of units) if (u.family) familyCount.set(u.family, (familyCount.get(u.family) ?? 0) + 1);
    const blocks: CatalogBlock[] = [];
    const familyBlock = new Map<string, CatalogBlock>();
    for (const u of units) {
      if (u.family && (familyCount.get(u.family) ?? 0) >= 2) {
        const existing = familyBlock.get(u.family);
        if (existing) existing.units.push(u);
        else {
          const block = { family: u.family, units: [u] };
          familyBlock.set(u.family, block);
          blocks.push(block);
        }
      } else {
        const last = blocks[blocks.length - 1];
        if (last && last.family === null) last.units.push(u);
        else blocks.push({ family: null, units: [u] });
      }
    }

    const groupDisciplines = sortDisciplines(inGroup.flatMap((e) => e.disciplines));
    const coversAll = brandDisciplines.every((d) => groupDisciplines.includes(d));
    groups.push({ partType, disciplines: coversAll ? null : groupDisciplines, blocks });
  }

  const collabs = others.filter(visible).sort((a, b) => a.pageName.localeCompare(b.pageName) || a.sort - b.sort);
  shown += collabs.length;

  return {
    groups,
    collabs,
    pastCount,
    hiddenCount: opts.archive ? 0 : entries.length - shown,
    partTypes: PART_TYPES.filter((p) => own.some((e) => e.partType === p)),
    empty: entries.length === 0,
  };
}

/**
 * The words for an entry built on a model: the rider and edition for a pro
 * model ("Chris Farmer II"), the edition for a collab or special edition.
 * An edition that's only the partner's name isn't repeated.
 */
export function entryLabel(e: CatalogEntry): string {
  const edition = e.edition && e.edition !== e.partnerName ? e.edition : null;
  if (e.entryType === 'pro') return [e.proRider, edition].filter(Boolean).join(' ');
  if (e.entryType === 'collab') return e.edition ?? e.partnerName ?? e.name;
  return [e.proRider, e.edition].filter(Boolean).join(' ') || e.name;
}
