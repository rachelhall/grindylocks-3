"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { requestAccess, type RequestState } from "./actions";

const EMPTY: RequestState = { sent: false, email: "", city: "", disciplines: [] };

const DISCIPLINES = [
  { value: "inline", label: "Inline" },
  { value: "quad", label: "Quad" },
  { value: "skateboard", label: "Skateboard" },
] as const;

/**
 * The request form, then "you're on the list". "Send another request"
 * remounts the form with a fresh key, which clears it.
 */
export function RequestForm() {
  const [round, setRound] = useState(0);
  return <RequestFormRound key={round} onAgain={() => setRound((n) => n + 1)} />;
}

function RequestFormRound({ onAgain }: { onAgain: () => void }) {
  const [state, action, pending] = useActionState(requestAccess, EMPTY);

  if (state.sent) {
    return (
      <div role="status" className="flex flex-col items-start gap-3">
        <span className="-rotate-2 bg-gl-accent px-2 py-0.5 type-label text-gl-on-accent">You&apos;re on the list</span>
        <h3 className="type-title">Thanks, we got it</h3>
        <p className="type-body text-gl-text-secondary">
          We&apos;ll email you an invite link when there&apos;s a spot in your city. No newsletter, no spam.
        </p>
        <Button variant="link" type="button" onClick={onAgain} className="h-control">
          Send another request
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="req-email">Email</Label>
        <Input
          id="req-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          defaultValue={state.email}
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "req-error" : undefined}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="req-city">Home city</Label>
        <Input
          id="req-city"
          name="city"
          type="text"
          autoComplete="address-level2"
          placeholder="San Diego"
          maxLength={100}
          defaultValue={state.city}
        />
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="pb-1.5 type-label text-gl-text-secondary">What you skate</legend>
        <div className="flex flex-wrap gap-2">
          {DISCIPLINES.map((d) => (
            <label
              key={d.value}
              className="flex h-control cursor-pointer items-center gap-2 border-2 border-gl-border px-3 type-body-sm font-semibold has-checked:bg-gl-accent-subtle has-checked:text-gl-on-accent-subtle has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-gl-focus"
            >
              <input
                type="checkbox"
                name="disciplines"
                value={d.value}
                defaultChecked={state.disciplines.includes(d.value)}
                className="size-[18px] accent-gl-accent outline-none"
              />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Hidden from people; bots tend to fill it in. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="req-website">Website</label>
        <input id="req-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {state.error ? (
        <p id="req-error" role="alert" className="type-body-sm font-semibold text-gl-danger">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="h-12 w-full type-body font-bold">
        {pending ? "Sending…" : "Request an invite"}
      </Button>
      <p className="type-caption text-gl-text-secondary">
        Grindylocks is for skaters 16 and older. We only use your email to send your invite.
      </p>
    </form>
  );
}
