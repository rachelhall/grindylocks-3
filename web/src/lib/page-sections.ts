/**
 * The six sections of a page on the web (brand and shop web tools, Nov 6):
 * Details, Location, Hours and closures, Brands we carry, Team and Inbox, at
 * /manage/<handle>/<section>. Which ones a page has depends on its kind, and
 * which ones a team member can change on their role, following the PRD's
 * permissions. This only decides what's shown: the database checks every
 * action itself.
 */
export type PageSection = "details" | "location" | "hours" | "brands" | "team" | "inbox";
export type TeamRole = "owner" | "manager" | "staff";

type SectionInfo = {
  label: string;
  icon: string;
  /** The lowest role that can use it. Staff see the others with a lock. */
  minRole: TeamRole;
  /** Which kinds of page have it. */
  appliesTo: (roles: string[]) => boolean;
};

const shop = (roles: string[]) => roles.includes("shop");

export const SECTIONS: Record<PageSection, SectionInfo> = {
  details: { label: "Details", icon: "badge", minRole: "manager", appliesTo: () => true },
  // Organizers have a base (an address and pin), without how people visit.
  location: {
    label: "Location",
    icon: "location_on",
    minRole: "manager",
    appliesTo: (roles) => shop(roles) || roles.includes("organizer"),
  },
  hours: { label: "Hours and closures", icon: "schedule", minRole: "staff", appliesTo: shop },
  brands: { label: "Brands we carry", icon: "sell", minRole: "manager", appliesTo: shop },
  team: { label: "Team", icon: "group", minRole: "staff", appliesTo: () => true },
  inbox: { label: "Inbox", icon: "inbox", minRole: "staff", appliesTo: () => true },
};

export const SECTION_ORDER: PageSection[] = ["details", "location", "hours", "brands", "team", "inbox"];

const rank: Record<TeamRole, number> = { staff: 1, manager: 2, owner: 3 };

export const atLeast = (role: TeamRole, min: TeamRole) => rank[role] >= rank[min];

export function isSection(value: string): value is PageSection {
  return (SECTION_ORDER as string[]).includes(value);
}

/** The sections a page has, in order. */
export function sectionsFor(roles: string[]): PageSection[] {
  return SECTION_ORDER.filter((s) => SECTIONS[s].appliesTo(roles));
}

export function canUse(section: PageSection, role: TeamRole): boolean {
  return atLeast(role, SECTIONS[section].minRole);
}

/** Where someone lands on a page: Details for managers and owners, Hours (or Team) for staff. */
export function firstSection(roles: string[], role: TeamRole): PageSection {
  return sectionsFor(roles).find((s) => canUse(s, role)) ?? "team";
}

export const managePath = (handle: string, section: PageSection) => `/manage/${handle}/${section}`;

export const teamRoleLabel: Record<TeamRole, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };

/** "Shop", "Brand", "Organizer", with the city when there is one. */
export function pageKindLine(roles: string[], city: string | null): string {
  const kind = roles.includes("shop") ? "Shop" : roles.includes("brand") ? "Brand" : "Organizer";
  return city ? `${kind} · ${city}` : kind;
}

/** A page that can't be changed: an archive (Closed, Retired, No longer active). */
export function isArchived(state: string): boolean {
  return state === "closed" || state === "out_of_business" || state === "inactive";
}
