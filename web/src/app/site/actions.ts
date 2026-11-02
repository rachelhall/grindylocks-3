"use server";

import type { Database } from "@/lib/database.types";
import { createPublicClient } from "@/lib/supabase/public";

type Discipline = Database["public"]["Enums"]["discipline"];

/** The v1 disciplines the form offers. */
const DISCIPLINES: readonly Discipline[] = ["inline", "quad", "skateboard"];

export type RequestState = {
  sent: boolean;
  error?: string;
  /** What was typed, so a failed try keeps it. */
  email: string;
  city: string;
  disciplines: Discipline[];
};

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

/**
 * Adds an invite request through `request_access()`, the database's only way
 * in for signed-out visitors. A repeat email quietly succeeds, so the form
 * can't be used to find out who's already asked.
 */
export async function requestAccess(_prev: RequestState, form: FormData): Promise<RequestState> {
  const email = String(form.get("email") ?? "").trim();
  const city = String(form.get("city") ?? "").trim();
  const disciplines = form
    .getAll("disciplines")
    .map(String)
    .filter((d): d is Discipline => (DISCIPLINES as readonly string[]).includes(d));
  const typed = { email, city, disciplines };

  // A field people never see. Bots that fill every input get a cheerful
  // "sent" and nothing is saved.
  if (String(form.get("website") ?? "") !== "") return { sent: true, ...typed };

  if (!isEmail(email)) {
    return { sent: false, error: "Enter an email address, like you@example.com.", ...typed };
  }
  if (city.length > 100) {
    return { sent: false, error: "Keep the city under 100 characters.", ...typed };
  }

  const { error } = await createPublicClient().rpc("request_access", {
    email,
    home_city: city || undefined,
    disciplines,
  });

  if (error) {
    switch (error.message) {
      case "invalid_email":
        return { sent: false, error: "Enter an email address, like you@example.com.", ...typed };
      case "city_too_long":
        return { sent: false, error: "Keep the city under 100 characters.", ...typed };
      case "too_many_requests":
        return { sent: false, error: "Lots of requests right now. Try again in an hour.", ...typed };
    }
    console.error("request_access failed", error);
    return { sent: false, error: "Something went wrong. Try again.", ...typed };
  }

  return { sent: true, ...typed };
}
