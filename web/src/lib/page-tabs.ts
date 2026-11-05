/*
 * The Pages list's rows and tabs (PR 6b), shared by the server page and the
 * client list (lib/pages-admin.ts is server-only).
 */

export type PageTab = "all" | "managed" | "unofficial" | "suspended" | "archived";
export const PAGE_TABS: PageTab[] = ["all", "managed", "unofficial", "suspended", "archived"];

export type PageRow = {
  id: string;
  name: string;
  handle: string;
  roles: string[];
  state: string;
  place: string | null;
  hasLogo: boolean;
  suspendedAt: string | null;
  frozen: boolean;
  foundedLabel: string | null;
  endedLabel: string | null;
  closedAt: string | null;
  teamCount: number;
  owner: string | null;
  followers: number;
  openClaims: number;
  /** The old name the search matched, when it wasn't the name or handle. */
  matchedAlias: string | null;
};

export function inTab(p: PageRow, tab: PageTab): boolean {
  switch (tab) {
    case "managed":
      return p.state === "managed";
    case "unofficial":
      return p.state === "unofficial" || p.state === "name_only";
    case "suspended":
      return !!p.suspendedAt;
    case "archived":
      return p.state === "out_of_business" || p.state === "closed";
    default:
      return true;
  }
}
