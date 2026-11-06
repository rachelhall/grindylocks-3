import type { Metadata } from "next";
import Link from "next/link";

import { Footer, InkHeader, RequestCard, TopBar, WRAP } from "@/components/public/chrome";
import { Icon } from "@/components/ui/icon";
import { SITE_ORIGIN } from "@/lib/hosts";
import { plural } from "@/lib/park-format";
import { getMetroAreas } from "@/lib/public-parks";

import { RequestForm } from "../request-form";

export const metadata: Metadata = {
  title: { absolute: "Skateparks by city · Grindylocks" },
  description: "Skateparks, DIY spots and pump tracks by city, with hours, lights, fees and every obstacle.",
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_ORIGIN}/parks`, languages: { en: `${SITE_ORIGIN}/parks`, "x-default": `${SITE_ORIGIN}/parks` } },
};

/**
 * Every city with parks, most parks first: the way into the metro area pages
 * from the top bar, footers and breadcrumbs. Served at grindylocks.com/parks.
 * It follows the metro area page's look; it had no board of its own.
 */
export default async function ParksPage() {
  const metros = await getMetroAreas();
  const total = metros.reduce((n, m) => n + m.parkCount, 0);
  return (
    <div className="bg-gl-surface text-gl-text">
      <TopBar />
      <InkHeader
        breadcrumb={[{ label: "Parks" }]}
        tape={`${plural(metros.length, "city", "cities")}`}
        title="Skateparks by city"
        lead={`${plural(total, "park")}, with hours, lights, fees and the obstacles at each one.`}
      />
      <main className={`${WRAP} pt-10 pb-16`}>
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
            {metros.map((m) => (
              <li key={m.slug}>
                <Link
                  href={`/parks/${m.slug}`}
                  className="flex min-h-16 items-center gap-4 bg-gl-surface-raised px-3.5 py-2.5 text-gl-text no-underline hover:outline-2 hover:-outline-offset-2 hover:outline-gl-border"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-lg leading-6 font-bold">{m.name}</span>
                    <span className="type-body-sm text-gl-text-secondary">
                      {[m.region, m.country === "US" ? null : m.country].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="type-label whitespace-nowrap text-gl-text-secondary uppercase">{plural(m.parkCount, "park")}</span>
                  <Icon name="chevron_right" size={22} />
                </Link>
              </li>
            ))}
          </ul>
          <aside className="lg:sticky lg:top-6">
            <RequestCard>
              <RequestForm />
            </RequestCard>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
}
