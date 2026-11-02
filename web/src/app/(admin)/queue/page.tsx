import type { Metadata } from "next";

import { QueueTabs } from "./queue-tabs";

export const metadata: Metadata = { title: "Queue" };

/**
 * The admin queue, as an empty shell for now (mockup: Admin · queue). The
 * list, detail pane, area filter and keyboard shortcuts arrive with the M5
 * moderation functions in the next PR.
 */
export default function QueuePage() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="flex flex-col gap-1 px-6 pt-6">
        <h1 className="type-title">Queue</h1>
        <p className="type-body-sm text-gl-text-secondary">
          Reports, park info reports and suggested obstacles for your parks.
        </p>
      </header>
      <QueueTabs />
    </main>
  );
}
