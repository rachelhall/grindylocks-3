import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isOwner } from "@/lib/access-requests";
import { getAdmin } from "@/lib/admin";
import { fetchBlockingPages, fetchPageBlockDetail, fetchPageBlocks } from "@/lib/brands";

import { BlocksView } from "./blocks-view";

export const metadata: Metadata = { title: "Page blocks" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Page blocks (mockup: Admin · page blocks): every skater a brand or shop
 * page has blocked, so brands can't quietly block people for fair feedback.
 * Owner only. The URL holds the state: ?view=lifted, ?page= (one page) and
 * ?block= (the open row). Pages with more than 5 blocks in 7 days are pinned
 * at the top in a pink band. Nothing goes into the queue.
 */
export default async function PageBlocksPage({ searchParams }: PageProps<"/page-blocks">) {
  const admin = await getAdmin();
  if (!isOwner(admin)) notFound();

  const params = await searchParams;
  const lifted = one(params.view) === "lifted";
  const pageParam = one(params.page);
  const page = pageParam && UUID.test(pageParam) ? pageParam : null;
  const blockParam = one(params.block);
  const block = blockParam && UUID.test(blockParam) ? blockParam : null;

  const [blocks, liftedCount, activeCount, pages, detail] = await Promise.all([
    fetchPageBlocks(lifted, page),
    lifted ? null : fetchPageBlocks(true, page).then((b) => b.length),
    lifted ? fetchPageBlocks(false, page).then((b) => b.length) : null,
    fetchBlockingPages(),
    block ? fetchPageBlockDetail(block) : null,
  ]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 px-6 pt-6">
        <h1 className="type-title">Page blocks</h1>
        <p className="type-body-sm text-gl-text-secondary">
          Every skater a brand or shop page has blocked. Only you can see this page, and nobody is told when you look or lift one.
        </p>
      </header>
      <BlocksView
        blocks={blocks}
        counts={{ all: lifted ? activeCount! : blocks.length, lifted: lifted ? blocks.length : liftedCount! }}
        lifted={lifted}
        page={page}
        pages={pages}
        openId={block}
        detail={detail}
        detailMissing={!!block && !detail}
      />
    </main>
  );
}
