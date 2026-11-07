import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getMyPage } from "@/lib/admin";
import { canUse, isArchived, isSection, managePath, SECTIONS, sectionsFor } from "@/lib/page-sections";
import { fetchInbox, fetchInboxContext, fetchManagedPage, fetchMetroParkPoints, fetchTeam } from "@/lib/page-tools";

import { BrandsSection } from "../brands-section";
import { DetailsSection } from "../details-section";
import { HoursSection } from "../hours-section";
import { InboxSection } from "../inbox-section";
import { LocationSection } from "../location-section";
import { Locked, SectionHeader } from "../section-shell";
import { TeamSection } from "../team-section";

export const metadata: Metadata = { title: "Your page" };

const intro: Record<string, (name: string) => string> = {
  details: () => "Logo, description and links. Managers and the owner can change these.",
  location: (name) => `How people visit ${name}, the address and the map pin.`,
  hours: () => "Everyone on the team can change these.",
  brands: (name) => `Shown on ${name}'s page in this order. Managers and the owner can change these.`,
  team: (name) => `Who can post and run ${name}. Only the team sees this.`,
  inbox: (name) => `Comments on ${name}'s posts and mentions of ${name}. Everyone on the team sees the same inbox.`,
};

/**
 * One section of a page the signed-in person is on the team of (mockups:
 * Web · page details, logo, location, hours, brands, team, inbox). The page
 * is looked up from the person's own pages, so a handle they aren't on the
 * team of is "not found". Sections their role can't use show a lock; the
 * database checks every action again.
 */
export default async function SectionPage({ params, searchParams }: PageProps<"/manage/[handle]/[section]">) {
  const { handle, section } = await params;
  const mine = await getMyPage(handle);
  if (!mine || !isSection(section)) notFound();
  // The handle's own capitals, so the sidebar marks the right item.
  if (handle !== mine.handle) redirect(managePath(mine.handle, section));
  if (!sectionsFor(mine.roles).includes(section)) notFound();

  const page = await fetchManagedPage(mine.id);
  if (!page) notFound();

  const header = (
    <SectionHeader
      pageName={page.name}
      state={page.state}
      hasLogo={Boolean(page.logoPath)}
      title={SECTIONS[section].label}
      intro={section === "hours" && page.timeZone ? `${intro.hours(page.name)} Times are ${cityOf(page)} time.` : intro[section](page.name)}
      archived={isArchived(page.state)}
      suspended={page.suspended}
    />
  );

  if (!canUse(section, mine.role)) {
    return (
      <>
        {header}
        <Locked section={SECTIONS[section].label} />
      </>
    );
  }

  switch (section) {
    case "details":
      return (
        <>
          {header}
          <DetailsSection page={page} />
        </>
      );
    case "location": {
      const parks = page.metro ? await fetchMetroParkPoints(page.metro.id) : [];
      return (
        <>
          {header}
          <LocationSection page={page} metroParks={parks} />
        </>
      );
    }
    case "hours":
      return (
        <>
          {header}
          <HoursSection page={page} />
        </>
      );
    case "brands":
      return (
        <>
          {header}
          <BrandsSection page={page} />
        </>
      );
    case "team": {
      const data = await fetchTeam(page.id, true);
      return (
        <>
          {header}
          <TeamSection page={page} myRole={mine.role} {...data} />
        </>
      );
    }
    case "inbox": {
      const inbox = await fetchInbox(page.id);
      const openId = one((await searchParams).item) ?? null;
      const open = inbox.items.find((i) => i.id === openId);
      const context = open ? await fetchInboxContext(page, open) : null;
      return (
        <>
          {header}
          <InboxSection page={page} items={inbox.items} followers={inbox.followers} openId={open ? openId : null} context={context} />
        </>
      );
    }
  }
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function cityOf(page: { metro: { name: string } | null; city: string | null; timeZone: string | null }) {
  return page.metro?.name ?? page.city ?? page.timeZone?.split("/").pop()?.replace(/_/g, " ") ?? "local";
}
