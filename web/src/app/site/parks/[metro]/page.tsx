import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Footer, InkHeader, RequestCard, SectionTitle, TopBar, WRAP } from "@/components/public/chrome";
import { StaticMap } from "@/components/public/static-map";
import { Icon } from "@/components/ui/icon";
import { SITE_ORIGIN } from "@/lib/hosts";
import { metroRowMeta, plural } from "@/lib/park-format";
import { getMetro, getMetroAreas, type PublicMetro, type PublicMetroPark } from "@/lib/public-parks";

import { RequestForm } from "../../request-form";

/**
 * A metro area's hub page (Nov 6; Mockups canvas › Marketing site › Public
 * pages (web) › Public · metro area page): "Skateparks in San Diego", every
 * park grouped by city with a map. Served at grindylocks.com/parks/<metro>.
 */

export async function generateStaticParams() {
  return (await getMetroAreas()).map((m) => ({ metro: m.slug }));
}

export async function generateMetadata({ params }: PageProps<"/site/parks/[metro]">): Promise<Metadata> {
  const { metro: slug } = await params;
  const metro = await getMetro(slug);
  if (!metro) return { title: { absolute: "City not found · Grindylocks" }, robots: { index: false } };
  const url = `${SITE_ORIGIN}/parks/${metro.slug}`;
  const title = `Skateparks in ${metro.name}`;
  const desc = `${plural(metro.parks.length, "skatepark")} in and around ${metro.name}, with hours, lights, fees and the obstacles at each one.`;
  return {
    title: { absolute: `${title} · Grindylocks` },
    description: desc,
    robots: { index: true, follow: true },
    alternates: { canonical: url, languages: { en: url, "x-default": url } },
    openGraph: { title, description: desc, url, siteName: "Grindylocks", type: "website" },
  };
}

export default function MetroPage(props: PageProps<"/site/parks/[metro]">) {
  return (
    <div className="bg-gl-surface text-gl-text">
      <TopBar />
      <Suspense fallback={<div className="min-h-[60vh] bg-gl-ink" />}>
        <Metro params={props.params} />
      </Suspense>
      <Footer />
    </div>
  );
}

async function Metro({ params }: Pick<PageProps<"/site/parks/[metro]">, "params">) {
  const { metro: slug } = await params;
  const [metro, all] = await Promise.all([getMetro(slug), getMetroAreas()]);
  if (!metro) notFound();
  const others = all.filter((m) => m.slug !== metro.slug);
  const groups = byCity(metro);
  const pins = metro.parks
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p) => ({ latitude: p.latitude!, longitude: p.longitude! }));
  const where = [metro.region, metro.country === "US" ? null : metro.country].filter(Boolean).join(" · ");

  return (
    <>
      <InkHeader
        breadcrumb={[{ href: "/parks", label: "Parks" }, { label: metro.name }]}
        tape={where ? `${metro.name} · ${where}` : metro.name}
        title={`Skateparks in ${metro.name}`}
        lead={`${plural(metro.parks.length, "park")}, with hours, lights, fees and the obstacles at each one.`}
      />
      <main className={`${WRAP} flex flex-col gap-12 pt-10 pb-16`}>
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          {pins.length ? (
            <details className="border-2 border-gl-border bg-gl-surface-raised lg:hidden">
              <summary className="flex h-12 cursor-pointer items-center gap-2 px-3.5 text-[15px] font-bold">
                <Icon name="map" />
                Show the map
              </summary>
              <div className="px-3 pb-3">
                <StaticMap points={pins} width={360} height={480} maxZoom={14} label={`Map of ${plural(pins.length, "park")} in ${metro.name}`} />
              </div>
            </details>
          ) : null}

          <div className="flex flex-col gap-7">
            {groups.map((g) => (
              <section key={g.city} aria-labelledby={`city-${slugify(g.city)}`} className="flex flex-col gap-2">
                <h2 id={`city-${slugify(g.city)}`} className="flex items-baseline gap-2.5 type-title">
                  {g.city}
                  <span className="font-sans type-body-sm font-semibold text-gl-text-secondary normal-case">{plural(g.parks.length, "park")}</span>
                </h2>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {g.parks.map((p) => (
                    <li key={p.slug}>
                      <Link
                        href={`/park/${p.slug}`}
                        className="flex min-h-16 items-center gap-4 bg-gl-surface-raised px-3.5 py-2.5 text-gl-text no-underline hover:outline-2 hover:-outline-offset-2 hover:outline-gl-border"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-lg leading-6 font-bold">{p.display_name}</span>
                          <span className="type-body-sm text-gl-text-secondary">{metroRowMeta(p)}</span>
                        </span>
                        <span className="type-label whitespace-nowrap text-gl-text-secondary uppercase">
                          {plural(p.obstacle_count, "obstacle")}
                        </span>
                        <Icon name="chevron_right" size={22} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
            {pins.length ? (
              <div className="hidden lg:block">
                <StaticMap points={pins} width={400} height={520} maxZoom={14} label={`Map of ${plural(pins.length, "park")} in ${metro.name}`} />
              </div>
            ) : null}
            <RequestCard>
              <RequestForm defaultCity={metro.name} />
            </RequestCard>
          </aside>
        </div>

        {others.length ? (
          <section aria-labelledby="more-cities" className="flex flex-col gap-3.5">
            <SectionTitle id="more-cities">More cities</SectionTitle>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {others.map((m) => (
                <li key={m.slug}>
                  <Link
                    href={`/parks/${m.slug}`}
                    className="flex h-12 items-center gap-2 border-2 border-gl-border px-3.5 text-[15px] font-bold text-gl-text no-underline hover:bg-gl-text hover:text-gl-surface"
                  >
                    {m.name} <span className="font-normal opacity-75">{plural(m.parkCount, "park")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}

/** The metro area's own city first, then the others A–Z; parks A–Z within each. */
function byCity(metro: PublicMetro) {
  const map = new Map<string, PublicMetroPark[]>();
  for (const p of metro.parks) {
    const city = p.city ?? metro.name;
    map.set(city, [...(map.get(city) ?? []), p]);
  }
  return [...map.entries()]
    .map(([city, parks]) => ({ city, parks }))
    .sort((a, b) => Number(b.city === metro.name) - Number(a.city === metro.name) || a.city.localeCompare(b.city));
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
