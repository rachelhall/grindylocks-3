import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isOwner } from "@/lib/access-requests";
import { getAdmin } from "@/lib/admin";
import { fetchAdminPageDetail, fetchAdminPages, PAGE_TABS, type PageTab } from "@/lib/pages-admin";

import { PagesView } from "./pages-view";

export const metadata: Metadata = { title: "Pages" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Pages (mockup: Admin-Pages): every brand and shop page, for Rachel only,
 * with her page tools in the pane. The URL holds the state: ?q= (search by
 * name, handle and old names), ?type=brand|shop, ?tab= and ?page= (the open
 * row).
 */
export default async function PagesPage({ searchParams }: PageProps<"/pages">) {
  const admin = await getAdmin();
  if (!isOwner(admin)) notFound();

  const params = await searchParams;
  const q = (one(params.q) ?? "").slice(0, 60);
  const typeParam = one(params.type);
  const kind = typeParam === "brand" || typeParam === "shop" ? typeParam : null;
  const tabParam = one(params.tab) as PageTab | undefined;
  const tab: PageTab = tabParam && PAGE_TABS.includes(tabParam) ? tabParam : "all";
  const pageParam = one(params.page);
  const open = pageParam && UUID.test(pageParam) ? pageParam : null;

  const [pages, detail] = await Promise.all([fetchAdminPages(q, kind), open ? fetchAdminPageDetail(open) : null]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 px-6 pt-6">
        <h1 className="type-title">Pages</h1>
        <p className="type-body-sm text-gl-text-secondary">Every brand and shop page. Only you see this.</p>
      </header>
      <PagesView
        pages={pages}
        q={q}
        kind={kind}
        tab={tab}
        openId={open}
        detail={detail}
        detailMissing={!!open && !detail}
      />
    </main>
  );
}
