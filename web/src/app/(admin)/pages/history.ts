import type { HistoryEntry } from "@/lib/pages-admin";

const at = (name: string | null | undefined) => (name ? `@${name}` : "a deleted user");
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

/** One History line in plain words. */
export function historyLine(h: HistoryEntry): string {
  const s = h.snapshot ?? {};
  switch (h.action) {
    case "seeded":
      return `Seeded as Unofficial, handle @${h.message} reserved`;
    case "created":
      return `Created as Unofficial by ${at(h.by)}, handle @${h.message}`;
    case "claim_sent":
      return `${at(h.who)} sent a claim (${h.message === "posted_code" ? "posted code" : "work email"})`;
    case "claim_approved":
      return `Claim approved${h.by ? ` by ${at(h.by)}` : ""}; ${at(h.who)} owner`;
    case "claim_declined":
      return h.message === "another_claim_approved"
        ? `${at(h.who)}'s claim closed: someone else got the page`
        : `${at(h.who)}'s claim declined${h.message ? `: "${h.message}"` : ""}`;
    case "claim_withdrawn":
      return `${at(h.who)} withdrew their claim`;
    case "claim_invite_sent":
      return `Claim invite sent to ${h.who ?? "an email"}`;
    case "claim_invite_accepted":
      return `${at(h.who)} accepted the claim invite; owner`;
    case "handed_over":
      return `${at(h.by)} handed ownership to ${at(h.who)}`;
    case "went_official":
      return "Logo added; the page went OFFICIAL";
    case "page_suspended": {
      const hidden = Array.isArray(s.hidden_posts) ? s.hidden_posts.length : 0;
      return `Suspended by ${at(h.by)}${h.message ? `: "${h.message}"` : ""}${hidden ? ` (${hidden} ${hidden === 1 ? "post" : "posts"} hidden)` : ""}`;
    }
    case "page_suspension_lifted": {
      const back = num(s.restored_posts);
      return `Suspension lifted by ${at(h.by)}${back ? ` (${back} ${back === 1 ? "post" : "posts"} back)` : ""}`;
    }
    case "page_transferred": {
      const from = str(s.from);
      const stays = s.old_owner_stays === true;
      return [
        `${at(h.by)} made ${at(h.who)} owner`,
        from ? `; @${from} ${stays ? "stays as manager" : "left the team"}` : "",
        s.dispute_closed === true ? "; dispute closed" : "",
        h.message ? ` · "${h.message}"` : "",
      ].join("");
    }
    case "page_renamed":
      return `Renamed from ${str(s.from_name)} (@${str(s.from_handle)}) to ${str(s.to_name)} (@${str(s.to_handle)})${
        s.from_name !== s.to_name && s.formerly === false ? "; old name not kept as Formerly" : ""
      }`;
    case "page_merged":
      return `${str(s.source_name)} (@${str(s.source_handle)}) merged in by ${at(h.by)}: +${num(s.followers_added)} followers, ${num(
        s.products,
      )} products`;
    case "page_split":
      return h.splitFrom
        ? `Split off from ${str(s.from_name)} by ${at(h.by)}, with ${num(s.products)} products`
        : `${at(h.by)} split off ${str(s.new_name)} (@${str(s.new_handle)}) with ${num(s.products)} products; ${num(
            s.followers_told,
          )} followers told`;
    case "page_closed":
      return s.to_state === "closed"
        ? `Marked Closed by ${at(h.by)}`
        : `Marked Retired by ${at(h.by)}${s.founded || s.ended ? ` (${[str(s.founded), str(s.ended)].filter(Boolean).join("–")})` : ""}`;
    case "page_reopened":
      return `Reopened by ${at(h.by)} as ${s.to_state === "managed" ? "managed" : s.to_state === "name_only" ? "name only" : "Unofficial"}`;
    case "page_reports_dismissed":
      return `Reports about the page dismissed by ${at(h.by)}`;
    case "page_reports_actioned":
      return `Reports about the page actioned by ${at(h.by)}`;
    case "page_block_lifted":
      return `${at(h.by)} lifted the page's block on ${at(h.who)}`;
    case "page_suggestion_approved":
      return `Made from ${at(h.who)}'s suggestion`;
    case "page_suggestion_merged":
      return `A suggestion from ${at(h.who)} pointed here`;
    case "product_suggestion_approved":
    case "product_suggestion_done":
      return `A product suggestion from ${at(h.who)} went live`;
    case "product_suggestion_declined":
      return `A product suggestion from ${at(h.who)} was declined`;
    case "page_fix_approved":
    case "page_fix_done":
      return `A shop fix from ${at(h.who)} went live`;
    case "page_fix_declined":
      return `A shop fix from ${at(h.who)} was declined`;
    case "page_fix_escalated":
      return `A shop fix was sent on to you by ${at(h.by)}`;
    default:
      return h.action.replaceAll("_", " ");
  }
}
