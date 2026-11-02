import type { Metadata } from "next";
import { Suspense } from "react";

import { Wordmark } from "@/components/wordmark";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The admin's one brand moment (design/web.md): the wordmark in `display`
 * on ink, with the form on a paper card. Mockup: Admin · sign in.
 */
export default function SignInPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gl-ink px-4 py-12 text-gl-paper [--gl-focus:var(--gl-brand-paper)]">
      <main className="flex w-full max-w-[440px] flex-col gap-8">
        <h1>
          <Wordmark large />
        </h1>
        <Suspense fallback={<CardFrame />}>
          <SignInForm />
        </Suspense>
        <p className="type-body-sm text-gl-paper/75">Not an admin? Everything else happens in the app.</p>
      </main>
    </div>
  );
}

function CardFrame() {
  return <div className="h-[226px] border-2 border-gl-paper bg-gl-surface" />;
}
