import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Footer, InkHeader, RequestCard, SectionTitle, TopBar, WRAP } from "@/components/public/chrome";
import { OpenNow } from "@/components/public/open-now";
import { StaticMap } from "@/components/public/static-map";
import { Icon } from "@/components/ui/icon";
import { env } from "@/lib/env";
import { SITE_ORIGIN } from "@/lib/hosts";
import {
  asSessionRows,
  clockLocale,
  directionsUrl,
  disciplines,
  entryLabel,
  hoursLines,
  lightsLabel,
  metroRowMeta,
  OBSTACLE_TYPES,
  PARK_TYPE,
  plural,
  SETTING,
} from "@/lib/park-format";
import { description, getMetro, getPark, getSitemap, photoUrl, type PublicPark } from "@/lib/public-parks";

import { RequestForm } from "../../request-form";

/**
 * A park's public page (Nov 6; Mockups canvas › Marketing site › Public
 * pages (web) › Public · park page). Served at grindylocks.com/park/<slug>.
 *
 * Park facts and photos only, plus a "join to see posts" teaser with the post
 * count. Nothing people-shaped: no regulars, meetups, Here now or posts.
 * Built ahead for every park and refreshed about hourly.
 */

export async function generateStaticParams() {
  const rows = await getSitemap();
  return rows.filter((r) => r.kind === "park").map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: PageProps<"/site/park/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const park = await getPark(slug);
  if (!park) return { title: { absolute: "Park not found · Grindylocks" }, robots: { index: false } };
  const url = `${SITE_ORIGIN}/park/${park.slug}`;
  const title = `${park.display_name} · ${PARK_TYPE[park.park_type]} in ${park.city ?? park.metro.name}`;
  const desc =
    description(park) ??
    `${park.official_name ?? park.display_name}: hours, lights, fees and obstacles, on Grindylocks.`;
  return {
    title: { absolute: `${title} · Grindylocks` },
    description: desc,
    robots: { index: true, follow: true },
    alternates: { canonical: url, languages: { en: url, "x-default": url } },
    openGraph: {
      title,
      description: desc,
      url,
      siteName: "Grindylocks",
      type: "website",
      images: [{ url: `${SITE_ORIGIN}/park/${park.slug}/share-image`, width: 1200, height: 630, alt: `${park.display_name}, ${park.metro.name}` }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default function ParkPage(props: PageProps<"/site/park/[slug]">) {
  return (
    <div className="bg-gl-surface text-gl-text">
      <TopBar />
      <Suspense fallback={<div className="min-h-[60vh] bg-gl-ink" />}>
        <Park params={props.params} />
      </Suspense>
      <Footer />
    </div>
  );
}

async function Park({ params }: Pick<PageProps<"/site/park/[slug]">, "params">) {
  const { slug } = await params;
  const park = await getPark(slug);
  if (!park) notFound();
  const metro = await getMetro(park.metro.slug);

  const desc = description(park);
  const photo = park.photos[0] ? photoUrl(env.supabaseUrl, park.photos[0].storage_path) : null;
  const hours = hoursLines(park);
  const who = disciplines(park);
  const locale = clockLocale(park.country);
  const hasPin = park.latitude !== null && park.longitude !== null;
  const nearby = nearbyParks(park, metro?.parks ?? []);
  const metroHref = `/parks/${park.metro.slug}`;

  return (
    <>
      <script
        type="application/ld+json"
        // JSON-LD for search engines; built from our own data, never user HTML.
        dangerouslySetInnerHTML={{ __html: jsonLd(park, desc, photo).replace(/</g, "\\u003c") }}
      />
      <InkHeader
        big
        photo={photo}
        breadcrumb={[
          { href: "/parks", label: "Parks" },
          { href: metroHref, label: park.metro.name },
          { label: park.display_name },
        ]}
        tape={`${park.metro.name} · ${PARK_TYPE[park.park_type]}`}
        title={park.display_name}
      />

      <main className={`${WRAP} pt-8 pb-16`}>
        <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-x-10">
          <div className="contents lg:flex lg:flex-col lg:gap-7">
            {/* Summary */}
            <div className="order-1 flex flex-col gap-3 lg:order-none">
              <p className="type-body-sm text-gl-text-secondary">
                {[park.official_name !== park.display_name ? park.official_name : null, park.address].filter(Boolean).join(" · ")}
              </p>
              <div className="flex min-h-7 flex-wrap gap-2">
                <OpenNow
                  status={park.status}
                  sessions={asSessionRows(park.sessions)}
                  latitude={park.latitude}
                  longitude={park.longitude}
                  timeZone={park.metro.timezone}
                  locale={locale}
                />
                <span className="border-2 border-gl-text-secondary px-2 py-1 type-label text-gl-text-secondary uppercase">
                  {park.verified_at ? `Verified ${formatDate(park.verified_at)}` : "Not verified yet"}
                </span>
              </div>
              {hasPin ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href={directionsUrl(park.latitude!, park.longitude!)}
                    className="flex h-12 items-center gap-2 border-2 border-gl-border px-4 text-[15px] font-bold text-gl-text no-underline hover:bg-gl-text hover:text-gl-surface"
                  >
                    <Icon name="directions" />
                    Directions
                  </a>
                </div>
              ) : null}
            </div>

            {/* Facts */}
            <section aria-label="Park facts" className="order-2 flex flex-col gap-4 lg:order-none">
              <dl className="m-0 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Fact label="Hours">
                  {hours.length === 0 ? (
                    "Hours not listed"
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {hours.map((h, i) => (
                        <li key={i}>
                          {h.season ? <span className="block type-caption text-gl-text-secondary">{h.season}</span> : null}
                          {h.days} {h.time}
                        </li>
                      ))}
                    </ul>
                  )}
                </Fact>
                <Fact label="Lights">{lightsLabel(park.night_lighting)}</Fact>
                <Fact label="Surface">{park.surface ? capitalise(park.surface) : "Not known"}</Fact>
                <Fact label="Entry">
                  {[entryLabel(park), park.setting ? SETTING[park.setting] : null].filter(Boolean).join(" · ")}
                </Fact>
                {who.length ? (
                  <Fact label="Who can skate" wide>
                    <span className="flex flex-wrap gap-1.5">
                      {who.map((d) => (
                        <span key={d} className="bg-gl-surface px-2.5 py-1 type-body-sm font-semibold">
                          {d}
                        </span>
                      ))}
                    </span>
                  </Fact>
                ) : null}
              </dl>
              {park.helmet_required ? <p className="type-body-sm font-semibold">Helmets required here.</p> : null}
              {desc ? <p className="max-w-[680px] text-[17px] leading-[26px]">{desc}</p> : null}
            </section>

            {/* Obstacles */}
            <section aria-labelledby="obstacles-title" className="order-3 flex flex-col gap-2.5 lg:order-none">
              <SectionTitle id="obstacles-title" count={park.obstacles.length}>
                Obstacles
              </SectionTitle>
              {park.obstacles.length === 0 ? (
                <p className="type-body-sm text-gl-text-secondary">No obstacles listed yet.</p>
              ) : (
                <ul className="m-0 grid list-none gap-1.5 p-0 md:grid-cols-2">
                  {park.obstacles.map((o, i) => (
                    <li key={i} className="flex min-h-13 items-center justify-between gap-3 bg-gl-surface-raised px-3 py-2">
                      <span className="flex flex-col">
                        <span className="type-body font-semibold">{o.name}</span>
                        {o.notes ? <span className="type-caption text-gl-text-secondary">{o.notes}</span> : null}
                      </span>
                      <span className="shrink-0 type-label text-gl-text-secondary uppercase">{OBSTACLE_TYPES[o.general_type]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Posts teaser */}
            <PostsTeaser park={park} className="order-5 lg:order-none" />

            {/* More parks */}
            {nearby.length ? (
              <section aria-labelledby="more-title" className="order-7 flex flex-col gap-2.5 lg:order-none">
                <SectionTitle id="more-title">More parks in {park.metro.name}</SectionTitle>
                <ul className="m-0 grid list-none gap-1.5 p-0 md:grid-cols-2">
                  {nearby.map((p) => (
                    <li key={p.slug}>
                      <Link
                        href={`/park/${p.slug}`}
                        className="flex min-h-14 items-center justify-between gap-3 bg-gl-surface-raised px-3 py-2 text-gl-text no-underline hover:outline-2 hover:-outline-offset-2 hover:outline-gl-border"
                      >
                        <span className="flex flex-col">
                          <span className="type-body font-bold">{p.display_name}</span>
                          <span className="type-caption text-gl-text-secondary">{[p.city, metroRowMeta(p)].filter(Boolean).join(" · ")}</span>
                        </span>
                        <Icon name="chevron_right" size={22} />
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link href={metroHref} className="type-body-sm font-bold text-gl-accent-text underline underline-offset-4">
                  All {metro ? plural(metro.parks.length, "park") : "parks"} in {park.metro.name}
                </Link>
              </section>
            ) : null}

            {/* Credits and corrections */}
            <div className="order-8 flex flex-col gap-1 type-caption text-gl-text-secondary lg:order-none">
              {park.photos[0] ? (
                <span>
                  Photo by {park.photos[0].photographer || "a park contributor"} · {park.photos[0].source} · {park.photos[0].license}
                </span>
              ) : null}
              <span>
                {park.verified_at ? `Last verified ${formatDate(park.verified_at)}.` : "Not verified yet."} Spot something wrong?{" "}
                <a href="mailto:support@grindylocks.com" className="text-gl-accent-text underline underline-offset-4">
                  support@grindylocks.com
                </a>
              </span>
              <span>Location © OpenStreetMap contributors</span>
            </div>
          </div>

          <aside className="contents lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:flex lg:flex-col lg:gap-4">
            {hasPin ? (
              <section aria-label="Map" className="order-4 flex flex-col gap-2 lg:order-none">
                <StaticMap
                  points={[{ latitude: park.latitude!, longitude: park.longitude! }]}
                  width={380}
                  height={260}
                  maxZoom={15}
                  label={`Map showing ${park.display_name}${park.address ? `, ${park.address}` : ""}`}
                />
                {park.address ? <span className="type-body-sm text-gl-text-secondary">{park.address}</span> : null}
              </section>
            ) : null}
            <div className="order-6 lg:order-none">
              <RequestCard>
                <RequestForm defaultCity={park.metro.name} />
              </RequestCard>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function Fact({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 bg-gl-surface-raised p-3 ${wide ? "col-span-full" : ""}`}>
      <dt className="type-label text-gl-text-secondary uppercase">{label}</dt>
      <dd className="m-0 text-[15px] leading-5 font-semibold">{children}</dd>
    </div>
  );
}

function PostsTeaser({ park, className }: { park: PublicPark; className?: string }) {
  const n = park.post_count;
  return (
    <section
      aria-labelledby="posts-title"
      className={`relative flex flex-col gap-4 overflow-hidden bg-gl-ink p-5 text-gl-paper md:p-7 [--gl-focus:var(--gl-brand-paper)] ${className ?? ""}`}
    >
      <div aria-hidden="true" className="halftone-header absolute inset-0 opacity-60" />
      {n > 0 ? (
        <div aria-hidden="true" className="relative grid grid-cols-2 items-end gap-2 md:grid-cols-4">
          {[150, 110, 130, 170].map((h, i) => (
            <span key={i} className={`halftone-tile block border-2 border-gl-paper bg-[#1C1C1C] ${i > 1 ? "hidden md:block" : ""}`} style={{ height: h }} />
          ))}
        </div>
      ) : null}
      <div className="relative flex flex-col items-start gap-2.5">
        <span className="-rotate-2 bg-gl-paper px-2 py-0.5 type-label text-gl-ink">MEMBERS ONLY</span>
        <h2 id="posts-title" className="font-display text-[26px] leading-none text-gl-paper uppercase [text-shadow:2px_2px_0_var(--gl-brand-pink)] md:text-[30px]">
          {n > 0 ? `${plural(n, "post")} from ${park.display_name}` : "No posts here yet"}
        </h2>
        <p className="max-w-[520px] type-body-sm text-gl-paper">
          {n > 0
            ? `Clips and photos tagged at ${park.display_name} are for members. Grindylocks is invite-only while it's in beta.`
            : `Members tag their clips and photos to ${park.display_name}, and they show up here in the app. Grindylocks is invite-only while it's in beta.`}
        </p>
        <a
          href="#request"
          className="flex h-12 items-center border-2 border-gl-pink bg-gl-pink px-4 text-[15px] font-bold text-gl-ink no-underline transition-shadow duration-100 hover:shadow-[3px_3px_0_var(--gl-brand-paper)]"
        >
          Join to see posts
        </a>
      </div>
    </section>
  );
}

/** Up to four other parks in the metro area, nearest first. */
function nearbyParks(park: PublicPark, parks: NonNullable<Awaited<ReturnType<typeof getMetro>>>["parks"]) {
  const others = parks.filter((p) => p.slug !== park.slug);
  if (park.latitude === null || park.longitude === null) return others.slice(0, 4);
  const d = (p: (typeof others)[number]) =>
    p.latitude === null || p.longitude === null
      ? Infinity
      : (p.latitude - park.latitude!) ** 2 + ((p.longitude - park.longitude!) * Math.cos((park.latitude! * Math.PI) / 180)) ** 2;
  return [...others].sort((a, b) => d(a) - d(b)).slice(0, 4);
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
}

const SCHEMA_DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** schema.org SportsActivityLocation: name, address, geo, hours, free or paid. */
function jsonLd(park: PublicPark, desc: string | null, photo: string | null) {
  // Only clock times can be written as opening hours; sunrise and sunset can't.
  const opening = park.sessions
    .filter((s) => s.start_anchor !== "sunrise" && s.start_anchor !== "sunset" && s.end_anchor !== "sunrise" && s.end_anchor !== "sunset")
    .filter((s) => s.start_time && s.end_time)
    .map((s) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: s.days.map((d) => SCHEMA_DAYS[d]),
      opens: s.start_time!.slice(0, 5),
      closes: s.end_time!.slice(0, 5),
      ...(s.season_start_month && s.season_end_month
        ? {
            validFrom: `--${String(s.season_start_month).padStart(2, "0")}-${String(s.season_start_day ?? 1).padStart(2, "0")}`,
            validThrough: `--${String(s.season_end_month).padStart(2, "0")}-${String(s.season_end_day ?? 31).padStart(2, "0")}`,
          }
        : {}),
    }));
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: park.official_name ?? park.display_name,
    alternateName: [park.display_name, ...park.aliases].filter((n) => n && n !== park.official_name),
    url: `${SITE_ORIGIN}/park/${park.slug}`,
    ...(desc ? { description: desc } : {}),
    ...(photo ? { image: photo } : {}),
    address: {
      "@type": "PostalAddress",
      ...(park.address ? { streetAddress: park.address } : {}),
      ...(park.city ? { addressLocality: park.city } : {}),
      ...(park.region ? { addressRegion: park.region } : {}),
      addressCountry: park.country,
    },
    ...(park.latitude !== null && park.longitude !== null
      ? { geo: { "@type": "GeoCoordinates", latitude: park.latitude, longitude: park.longitude } }
      : {}),
    ...(park.is_paid !== null ? { isAccessibleForFree: !park.is_paid } : {}),
    ...(opening.length ? { openingHoursSpecification: opening } : {}),
  });
}
