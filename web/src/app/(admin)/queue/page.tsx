import type { Metadata } from "next";

import { isOwner } from "@/lib/access-requests";
import { getAdmin } from "@/lib/admin";
import {
  fetchClaimDetail,
  fetchImpersonatedPages,
  fetchPageFixDetail,
  fetchPageReportDetail,
  fetchPageSuggestionDetail,
  fetchProductSuggestionDetail,
} from "@/lib/brands";
import {
  fetchAreas,
  fetchObstacleDetail,
  fetchParkInfoDetail,
  fetchQueue,
  fetchReportDetail,
  parseItemKey,
} from "@/lib/queue";
import { TAB_VALUES, type QueueTab } from "@/lib/queue-labels";

import { ClaimDetailPane } from "./claim-detail";
import { ClaimInviteButton } from "./claim-invite";
import { ObstacleDetailPane } from "./obstacle-detail";
import { PageReportDetailPane } from "./page-report-detail";
import { PageSuggestionDetailPane } from "./page-suggestion-detail";
import { ParkInfoDetailPane } from "./park-info-detail";
import { ProductSuggestionDetailPane } from "./product-suggestion-detail";
import { QueueView } from "./queue-view";
import { ReportDetailPane } from "./report-detail";
import { ShopFixDetailPane } from "./shop-fix-detail";

export const metadata: Metadata = { title: "Queue" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The admin queue (mockups: Admin · queue, park info report, suggested
 * obstacle, suspend). The URL holds the state, so a row can be linked and the
 * back button works: ?tab=, ?area= (a metro area) and ?item= (the open row).
 * Everything comes from the moderation functions with the admin's own
 * session; the database decides what's in scope.
 */
export default async function QueuePage({ searchParams }: PageProps<"/queue">) {
  const params = await searchParams;
  const tabParam = one(params.tab);
  const tab: QueueTab = TAB_VALUES.includes(tabParam as QueueTab) ? (tabParam as QueueTab) : "all";
  const area = one(params.area) ?? null;
  const itemParam = one(params.item);
  const item = parseItemKey(itemParam);

  const admin = (await getAdmin())!;
  const owner = isOwner(admin);

  async function paneFor(): Promise<React.ReactNode> {
    if (!item) return null;
    switch (item.kind) {
      case "report": {
        const d = await fetchReportDetail(item.target, item.id);
        if (!d) return null;
        const copies =
          owner && item.target === "person" && d.reports.some((r) => r.reason === "impersonation")
            ? Object.fromEntries(await fetchImpersonatedPages(d.reports.filter((r) => r.reason === "impersonation").map((r) => r.id)))
            : undefined;
        return <ReportDetailPane key={itemParam} detail={d} impersonated={copies} />;
      }
      case "park_info":
        return fetchParkInfoDetail(item.id).then((d) => d && <ParkInfoDetailPane key={itemParam} detail={d} />);
      case "obstacle":
        return fetchObstacleDetail(item.id).then((d) => d && <ObstacleDetailPane key={itemParam} detail={d} />);
      case "claim":
        return fetchClaimDetail(item.id).then((d) => d && <ClaimDetailPane key={itemParam} detail={d} />);
      case "page_suggestion":
        return fetchPageSuggestionDetail(item.id).then((d) => d && <PageSuggestionDetailPane key={itemParam} detail={d} />);
      case "product_suggestion":
        return fetchProductSuggestionDetail(item.id).then((d) => d && <ProductSuggestionDetailPane key={itemParam} detail={d} />);
      case "page_report":
        return fetchPageReportDetail(item.id).then((d) => d && <PageReportDetailPane key={itemParam} detail={d} />);
      case "shop_fix":
        return fetchPageFixDetail(item.id).then((d) => d && <ShopFixDetailPane key={itemParam} detail={d} />);
    }
  }

  const [items, areas, detail] = await Promise.all([
    fetchQueue(area && /^[0-9a-f-]{36}$/i.test(area) ? area : null),
    fetchAreas(admin),
    paneFor(),
  ]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 px-6 pt-6">
        <h1 className="type-title">Queue</h1>
        <p className="type-body-sm text-gl-text-secondary">
          {owner
            ? "Reports, park and shop info, suggestions and claims for your areas."
            : "Reports, park and shop info and suggested obstacles for your areas."}
        </p>
      </header>
      <QueueView
        items={items}
        areas={areas}
        area={area}
        tab={tab}
        openKey={itemParam && item ? itemParam : null}
        detailMissing={!!item && !detail}
        detail={detail}
        owner={owner}
        headerAction={owner && tab === "claims" ? <ClaimInviteButton /> : undefined}
      />
    </main>
  );
}
