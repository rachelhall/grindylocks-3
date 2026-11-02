"use server";

import { type AuthError, isAuthApiError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { fetchAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

export type SignInState = {
  step: "email" | "code";
  email: string;
  error?: string;
  notice?: string;
};

const NOT_ADMIN = "This account isn't an admin here. Everything else happens in the app.";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Plain-language versions of Supabase Auth errors, matching the app's copy. */
function message(error: AuthError, fallback = "Something went wrong. Try again.") {
  const code = isAuthApiError(error) ? error.code : undefined;
  switch (code) {
    // Sign-ups are off for this client, so an unknown address fails.
    case "otp_disabled":
    case "signup_disabled":
    case "user_not_found":
      return "There's no Grindylocks account with that email. Use the email you sign in to the app with.";
    case "otp_expired":
      return "That code is wrong or has expired. Check the email, or send a new code.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many tries. Wait a minute, then try again.";
  }
  if (error.status === 429) return "Too many tries. Wait a minute, then try again.";
  if (error.name === "AuthRetryableFetchError") return "Couldn't reach Grindylocks. Check your connection and try again.";
  return fallback;
}

/**
 * Step 1: email a sign-in code. shouldCreateUser is false, so the web admin
 * can never create an account: only existing members get a code.
 */
async function sendCode(form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!isEmail(email)) return { step: "email", email, error: "Enter an email address, like you@example.com." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) return { step: "email", email, error: message(error) };

  return { step: "code", email, notice: form.get("intent") === "resend" ? "New code sent." : undefined };
}

/**
 * Step 2: check the code, then let only role holders in. Anyone else is
 * signed straight back out, so a member's session never lingers here.
 */
async function verifyCode(form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("code") ?? "").replace(/\D/g, "");
  // Supabase codes are 6 digits by default; the length is a project setting.
  if (!/^\d{6,10}$/.test(token)) return { step: "code", email, error: "Enter the code from the email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    return { step: "code", email, error: message(error, "That code is wrong or has expired. Check the email, or send a new code.") };
  }

  const admin = await fetchAdmin(supabase);
  if (!admin) {
    await supabase.auth.signOut({ scope: "local" });
    return { step: "email", email, error: NOT_ADMIN };
  }

  redirect("/queue");
}

/**
 * The sign-in form's one action. `intent` says which button was pressed:
 * send (or resend) a code, check a code, or go back to the email step.
 */
export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  switch (form.get("intent")) {
    case "verify":
      return verifyCode(form);
    case "restart":
      return { step: "email", email: String(form.get("email") ?? "") };
    default:
      return sendCode(form);
  }
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in");
}
