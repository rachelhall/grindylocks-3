"use server";

import { refresh } from "next/cache";

import { isOwner } from "@/lib/access-requests";
import { getAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const MAX_IDS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marks requests invited (or takes that back). Nothing is sent: Rachel sends
 * the invite link from the app first. The update runs with her own session,
 * so the table's access rules (owner only, invited_at only) still decide.
 */
export async function setInvited(ids: string[], invited: boolean): Promise<ActionResult> {
  if (!isOwner(await getAdmin())) return { ok: false, error: "Only the owner can change requests." };

  const clean = [...new Set(ids)].filter((id) => UUID.test(id));
  if (!clean.length || clean.length > MAX_IDS) return { ok: false, error: "Pick at least one request." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("access_requests")
    .update({ invited_at: invited ? new Date().toISOString() : null })
    .in("id", clean);

  if (error) {
    console.error("setInvited failed", error);
    return { ok: false, error: "Couldn't save that. Try again." };
  }

  refresh();
  return { ok: true };
}

/**
 * Dismisses requests (or restores them). A dismissed request leaves Not
 * invited, the sidebar count and By city. Because there's one request per
 * email, a dismissed email that asks again stays dismissed.
 */
export async function setDismissed(ids: string[], dismissed: boolean): Promise<ActionResult> {
  if (!isOwner(await getAdmin())) return { ok: false, error: "Only the owner can change requests." };

  const clean = cleanIds(ids);
  if (!clean) return { ok: false, error: "Pick at least one request." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("access_requests")
    .update({ dismissed_at: dismissed ? new Date().toISOString() : null })
    .in("id", clean);

  if (error) {
    console.error("setDismissed failed", error);
    return { ok: false, error: "Couldn't save that. Try again." };
  }

  refresh();
  return { ok: true };
}

/**
 * Deletes requests for good: for tests and junk. There's no undo, and the
 * email can ask again from grindylocks.com. The table's access rules allow
 * it for the owner only.
 */
export async function deleteRequests(ids: string[]): Promise<ActionResult> {
  if (!isOwner(await getAdmin())) return { ok: false, error: "Only the owner can delete requests." };

  const clean = cleanIds(ids);
  if (!clean) return { ok: false, error: "Pick at least one request." };

  const supabase = await createClient();
  const { error } = await supabase.from("access_requests").delete().in("id", clean);

  if (error) {
    console.error("deleteRequests failed", error);
    return { ok: false, error: "Couldn't delete that. Try again." };
  }

  refresh();
  return { ok: true };
}

function cleanIds(ids: string[]): string[] | null {
  const clean = [...new Set(ids)].filter((id) => UUID.test(id));
  return clean.length && clean.length <= MAX_IDS ? clean : null;
}

/**
 * Records that the owner opened the Requests page, so next time only newer
 * requests are tagged NEW. Called once the page has shown, and doesn't
 * refresh it, so this visit's NEW tags stay put.
 */
export async function markRequestsSeen(): Promise<void> {
  if (!isOwner(await getAdmin())) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_admin_page_seen", { page: "access_requests" });
  if (error) console.error("mark_admin_page_seen failed", error);
}
