import type { Metadata } from "next";

import { getAdmin } from "@/lib/admin";
import {
  fetchAreas,
  fetchObstacleDetail,
  fetchParkInfoDetail,
  fetchQueue,
  fetchReportDetail,
  parseItemKey,
} from "@/lib/queue";

import { ObstacleDetailPane } from "./obstacle-detail";
import { ParkInfoDetailPane } from "./park-info-detail";
import { QueueView, type QueueTab } from "./queue-view";
import { ReportDetailPane } from "./report-detail";

export const metadata: Metadata = { title: "Queue" };

const TABS: QueueTab[] = ["all", "reports", "park-info", "obstacles"];

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
  const tab: QueueTab = TABS.includes(tabParam as QueueTab) ? (tabParam as QueueTab) : "all";
  const area = one(params.area) ?? null;
  const itemParam = one(params.item);
  const item = parseItemKey(itemParam);

  const admin = (await getAdmin())!;
  const [items, areas, detail] = await Promise.all([
    fetchQueue(area && /^[0-9a-f-]{36}$/i.test(area) ? area : null),
    fetchAreas(admin),
    item?.kind === "report"
      ? fetchReportDetail(item.target, item.id).then((d) => d && <ReportDetailPane key={itemParam} detail={d} />)
      : item?.kind === "park_info"
        ? fetchParkInfoDetail(item.id).then((d) => d && <ParkInfoDetailPane key={itemParam} detail={d} />)
        : item?.kind === "obstacle"
          ? fetchObstacleDetail(item.id).then((d) => d && <ObstacleDetailPane key={itemParam} detail={d} />)
          : Promise.resolve(null),
  ]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 px-6 pt-6">
        <h1 className="type-title">Queue</h1>
        <p className="type-body-sm text-gl-text-secondary">
          Reports, park info reports and suggested obstacles for your parks.
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
      />
    </main>
  );
}
