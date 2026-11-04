"use server";

import { refresh } from "next/cache";

import { isOwner } from "@/lib/access-requests";
import { getAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lifts a page's block on a skater. Nobody is told. */
export async function liftBlock(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isOwner(await getAdmin())) return { ok: false, error: "Only the owner can lift page blocks." };
  if (!UUID.test(id)) return { ok: false, error: "This block isn't here any more." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("lift_page_block", { block: id });
  if (error) {
    if (error.code === "P0002") return { ok: false, error: "This block was already lifted." };
    console.error("lift_page_block failed", error);
    return { ok: false, error: "Couldn't lift it. Try again." };
  }
  refresh();
  return { ok: true };
}
