"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { InfoNote, PageCard, WarningNote } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { ClaimDetail } from "@/lib/brands";

import { decideClaim, setClaimChecked } from "./actions";
import { Checkbox, ErrorLine, PaneHeader, PaneSection, shortDate, TextArea, useShortcuts } from "./pane";
import { StateChip, useQueue } from "./queue-view";

function daysLeft(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "Expired";
  return days === 1 ? "Valid 1 more day" : `Valid ${days} more days`;
}

/**
 * One claim (mockups: Admin · claims, posted code): the proof, the role and
 * note, the page, a warning when another claim is open on it, then Approve as
 * owner or Decline with a reason the claimant sees. On a posted code, Approve
 * stays off until Checked it is ticked.
 */
export function ClaimDetailPane({ detail: d }: { detail: ClaimDetail }) {
  const { done } = useQueue();
  const pathname = usePathname();
  const params = useSearchParams();
  const [checked, setChecked] = useState(d.checked);
  const [confirm, setConfirm] = useState<"approve" | "decline" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const who = d.claimant ? `@${d.claimant}` : "the claimant";
  const canApprove = d.proof === "email" || checked;

  useShortcuts({
    a: canApprove ? () => setConfirm("approve") : null,
    x: () => setConfirm("decline"),
  });

  function linkTo(claimId: string) {
    const p = new URLSearchParams(params);
    p.set("item", `claim:${claimId}`);
    return `${pathname}?${p}`;
  }

  function toggleChecked(next: boolean) {
    setChecked(next);
    setError(null);
    startTransition(async () => {
      const result = await setClaimChecked({ id: d.id, checked: next });
      if (!result.ok) {
        setChecked(!next);
        setError(result.error);
      }
    });
  }

  function submit() {
    const approve = confirm === "approve";
    startTransition(async () => {
      const result = await decideClaim({ id: d.id, approve, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      done(approve ? `${who} now owns ${d.page.name}. They're told in the app.` : `Claim declined. ${who} sees your reason.`);
    });
  }

  const other = d.others[0];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PaneHeader
        chip={<StateChip state="open" />}
        title={`Claim for ${d.page.name}`}
        sub={`By ${who}, ${d.ago} ago`}
      />

      {other && (
        <WarningNote>
          {d.others.length === 1 ? "Another claim is open on this page: " : `${d.others.length} other claims are open on this page, the first: `}
          @{other.username ?? "deleted user"},{" "}
          {other.proof === "email"
            ? `work email${other.domainMatches ? " with a matching domain" : ""}`
            : "posted code"}
          , {other.ago} ago.{" "}
          <Link href={linkTo(other.id)} scroll={false} className="font-semibold underline focus-ring">
            Open it
          </Link>
          . Approving one declines the others, and they&apos;re told someone else runs the page now.
        </WarningNote>
      )}

      {d.proof === "email" ? (
        <PaneSection title="Proof · work email">
          <p className="type-body font-semibold break-all">{d.email}</p>
          <div className="flex flex-wrap gap-2">
            <ProofChip ok={!!d.emailConfirmedAt} label={d.emailConfirmedAt ? "Code confirmed" : "Code not confirmed"} />
            <ProofChip
              ok={!!d.domainMatches}
              label={d.domainMatches ? `Matches ${d.page.website?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? "the website"}` : "Domain doesn't match"}
            />
          </div>
          <p className="type-caption text-gl-text-secondary">
            Compared with the website and links on the page.
            {d.emailConfirmedAt && ` Confirmed ${shortDate(d.emailConfirmedAt)}.`}
          </p>
        </PaneSection>
      ) : (
        <PaneSection title="Proof · posted code">
          <p className="font-mono type-headline">{d.postedCode}</p>
          <p className="type-body-sm text-gl-text-secondary">{daysLeft(d.postedCodeExpiresAt)}</p>
          {d.postedUrl && (
            <a
              href={/^https?:\/\//.test(d.postedUrl) ? d.postedUrl : `https://${d.postedUrl}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 type-body-sm font-semibold break-all text-gl-accent-text underline focus-ring"
            >
              <Icon name="link" size={18} />
              {d.postedUrl.replace(/^https?:\/\//, "")}
              <Icon name="open_in_new" size={16} />
            </a>
          )}
          <Checkbox
            id="checked"
            label={`Checked it: the code is on ${d.page.name}'s own account`}
            checked={checked}
            onChange={toggleChecked}
          />
        </PaneSection>
      )}

      <PaneSection title="Role and note">
        <p className="type-body font-semibold">{d.roleTitle}</p>
        <p className="type-body whitespace-pre-wrap">{d.note ? `“${d.note}”` : <span className="text-gl-text-secondary">No note.</span>}</p>
      </PaneSection>

      <PaneSection title="The page">
        <PageCard page={d.page} />
      </PaneSection>

      <div className="flex flex-col gap-3 border-t-2 border-gl-border pt-4">
        <ErrorLine error={confirm ? null : error} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canApprove || pending} onClick={() => setConfirm("approve")}>
            Approve as owner
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => setConfirm("decline")}>
            Decline…
          </Button>
        </div>
        <p className="type-caption text-gl-text-secondary">
          {canApprove
            ? `Approving makes ${who} the owner and tells them in the app. The page stays UNOFFICIAL until they add a logo. Declining asks for a reason they'll see.`
            : "Tick Checked it first."}
        </p>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title={confirm === "approve" ? `Make ${who} the owner of ${d.page.name}?` : `Decline ${who}'s claim?`}
        description={
          confirm === "approve"
            ? `They're told in the app and asked for the logo.${d.others.length ? " The other open claims on this page are declined, and those people are told." : ""}`
            : "They can claim again with other proof."
        }
      >
        {confirm === "decline" && (
          <TextArea
            id="reason"
            label={`The reason ${who} sees`}
            value={reason}
            onChange={setReason}
            required
            hint="Plain and kind: say what would work instead."
          />
        )}
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant={confirm === "approve" ? "primary" : "danger-solid"}
            disabled={pending || (confirm === "decline" && !reason.trim())}
            onClick={submit}
          >
            {confirm === "approve" ? "Approve as owner" : "Decline claim"}
          </Button>
        </div>
      </Dialog>

      {d.proof === "posted_code" && !checked && (
        <InfoNote icon="travel_explore">Open the link and find {d.postedCode} on the brand&apos;s own Instagram or website before approving.</InfoNote>
      )}
    </div>
  );
}

function ProofChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center gap-1 border-2 border-gl-border bg-gl-accent-subtle px-1.5 py-px text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-gl-on-accent-subtle uppercase"
          : "inline-flex items-center gap-1 border-2 border-gl-warning px-1.5 py-px text-[11px] leading-[14px] font-semibold tracking-[0.06em] uppercase"
      }
    >
      <Icon name={ok ? "check" : "warning"} size={14} className={ok ? undefined : "text-gl-warning"} />
      {label}
    </span>
  );
}
