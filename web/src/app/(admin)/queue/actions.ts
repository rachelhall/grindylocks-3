"use server";

import { refresh } from "next/cache";

import { getAdmin } from "@/lib/admin";
import type { Database, Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

type ObstacleType = Database["public"]["Enums"]["obstacle_type"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The database's error codes, in words. Every action is a Postgres function
 * that checks the admin's role and scope itself; these only decide what the
 * admin reads when one says no.
 */
const messages: Record<string, string> = {
  nothing_to_review: "Someone already handled this. The queue is up to date now.",
  already_reviewed: "Someone already handled this. The queue is up to date now.",
  not_found: "This isn't in your queue any more.",
  message_required: "Write what they'll see.",
  message_too_long: "Keep the message under 500 characters.",
  suspend_1_7_or_30_days: "Pick 1, 7 or 30 days.",
  owner_only: "Only the owner can ban.",
  escalate_role_holders: "This person holds a role. Escalate it to Rachel instead.",
  not_on_yourself: "You can't act on your own account.",
  not_on_the_owner: "The owner can't be banned.",
  already_with_the_owner: "It's already with you.",
  nothing_to_hide: "There's no post or comment to hide on a person report.",
  not_allowed: "You can't do that for this park.",
  park_admins_merge: "Only park and city admins can merge obstacles.",
  park_admins_decline: "Only park and city admins can decline obstacles.",
  pick_an_obstacle_at_this_park: "Pick an obstacle this park already has.",
  name_too_long: "Keep the name under 60 characters.",
  street_plaza_is_a_placeholder: "Street plaza is a placeholder area, not an obstacle type.",
  bad_days: "Pick at least one day.",
  bad_disciplines: "Pick at least one discipline.",
  bad_description: "The description needs 1 to 2,000 characters.",
  bad_coordinates: "Those coordinates aren't on the map.",
};

function fail(error: { message: string; code?: string }, what: string): ActionResult {
  const known = messages[error.message];
  if (!known) console.error(`${what} failed`, error);
  return { ok: false, error: known ?? "Couldn't save that. Try again." };
}

async function ready(id: string): Promise<ActionResult | null> {
  if (!(await getAdmin())) return { ok: false, error: "Sign in again to do that." };
  if (!UUID.test(id)) return { ok: false, error: "This isn't in your queue any more." };
  return null;
}

export type Decision = "dismiss" | "keep_hidden" | "warn" | "suspend" | "escalate" | "ban";

/** Acts on every open report about one post, comment or person. */
export async function moderate(input: {
  target: "post" | "comment" | "person" | "meetup" | "meetup_comment";
  id: string;
  decision: Decision;
  message?: string;
  days?: 1 | 7 | 30;
  hide?: boolean;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;

  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_reports", {
    target_kind: input.target,
    target: input.id,
    decision: input.decision,
    message: input.message?.trim() || undefined,
    days: input.days,
    hide: input.hide ?? false,
  });
  if (error) return fail(error, "moderate_reports");
  refresh();
  return { ok: true };
}

/** Approves (and applies) or declines a park info report. */
export async function reviewParkInfo(input: {
  id: string;
  approve: boolean;
  value?: Json | null;
  markVerified?: boolean;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_park_info", {
    report: input.id,
    approve: input.approve,
    value: input.value ?? undefined,
    mark_verified: input.markVerified ?? false,
  });
  if (error) return fail(error, "review_park_info");
  refresh();
  return { ok: true };
}

/** Approves, merges or declines a suggested obstacle. */
export async function reviewObstacle(input: {
  id: string;
  decision: "approve" | "merge" | "decline";
  name?: string;
  generalType?: ObstacleType;
  mergeInto?: string;
}): Promise<ActionResult> {
  const notReady = await ready(input.id);
  if (notReady) return notReady;
  if (input.mergeInto && !UUID.test(input.mergeInto)) return { ok: false, error: "Pick an obstacle this park already has." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_obstacle", {
    obstacle: input.id,
    decision: input.decision,
    name: input.name?.trim() || undefined,
    general_type: input.generalType,
    merge_into: input.mergeInto,
  });
  if (error) return fail(error, "review_obstacle");
  refresh();
  return { ok: true };
}
