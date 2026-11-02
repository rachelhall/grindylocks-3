"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { signIn, type SignInState, signOut } from "./actions";

const RESEND_SECONDS = 60;

/**
 * Email, then the code from the email, the same flow as the app. Every step
 * runs on the server (actions.ts), so the session cookies are set there and
 * only role holders get past the code.
 */
export function SignInForm() {
  const reason = useSearchParams().get("reason");
  const [state, action, pending] = useActionState(signIn, { step: "email", email: "" } satisfies SignInState);

  // The queue sends signed-in members who aren't admins back here.
  if (reason === "not-admin" && state.step === "email" && !state.email) {
    return (
      <Card title="Not an admin" body="This account isn't an admin here. Everything else happens in the app.">
        <form action={signOut}>
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </Card>
    );
  }

  if (state.step === "code") {
    // A fresh key restarts the resend countdown whenever a code goes out.
    return <CodeStep key={state.notice ?? "first"} state={state} action={action} pending={pending} />;
  }

  return (
    <Card
      title="Sign in"
      body="For park admins and city admins. Use the email you sign in to the app with, and we'll send you a code."
    >
      <form action={action} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            defaultValue={state.email}
            required
            autoFocus
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "email-error" : undefined}
          />
          {state.error ? <FieldError id="email-error">{state.error}</FieldError> : null}
        </div>
        <Button type="submit" name="intent" value="send" disabled={pending} className="w-full">
          {pending ? "Sending…" : "Send code"}
        </Button>
      </form>
    </Card>
  );
}

function CodeStep({
  state,
  action,
  pending,
}: {
  state: SignInState;
  action: (form: FormData) => void;
  pending: boolean;
}) {
  const [wait, setWait] = useState(RESEND_SECONDS);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const { email, error, notice } = state;
  return (
    <Card title="Check your email" body={`We sent a code to ${email}. Enter it here to sign in.`}>
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="email" value={email} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            required
            autoFocus
            className="tabular-nums tracking-[0.2em]"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "code-error" : notice ? "code-notice" : undefined}
          />
          {error ? <FieldError id="code-error">{error}</FieldError> : null}
          {!error && notice ? (
            <p id="code-notice" role="status" className="type-body-sm text-gl-text-secondary">
              {notice}
            </p>
          ) : null}
        </div>
        <Button type="submit" name="intent" value="verify" disabled={pending} className="w-full">
          {pending ? "Checking…" : "Sign in"}
        </Button>
        {/* formNoValidate: these two don't need a code typed in. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Button type="submit" name="intent" value="resend" variant="link" formNoValidate disabled={wait > 0 || pending}>
            {wait > 0 ? `Send a new code in ${wait} s` : "Send a new code"}
          </Button>
          <Button type="submit" name="intent" value="restart" variant="link" formNoValidate disabled={pending}>
            Use a different email
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Card({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby="sign-in-title"
      className="flex flex-col gap-4 border-2 border-gl-paper bg-gl-surface p-6 text-gl-text [--gl-focus:var(--gl-text)]"
    >
      <div className="flex flex-col gap-1">
        <h2 id="sign-in-title" className="type-headline">
          {title}
        </h2>
        <p className="type-body-sm text-gl-text-secondary">{body}</p>
      </div>
      {children}
    </section>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="type-body-sm text-gl-danger">
      {children}
    </p>
  );
}
