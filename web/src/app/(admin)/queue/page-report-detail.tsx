"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { InfoNote, PageCard } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PageReportDetail } from "@/lib/brands";
import { reasonLabel } from "@/lib/queue-labels";

import { resolvePageReports } from "./actions";
import { ErrorLine, PaneHeader, PaneSection, useShortcuts } from "./pane";
import { StateChip, useQueue } from "./queue-view";

/** What each page report reason usually asks of Rachel. */
const nextStep: Record<string, string> = {
  impersonation: "Compare it with the real brand. A copycat profile is reported on the profile instead; this is about the page itself.",
  our_page: "Someone says this is their brand or shop. Ask them to claim it with an email on the brand's own domain, or send a claim invite.",
  wrong_info: "Fix the name, location, hours or links in Supabase (products go through Suggest a change), then mark it handled.",
};

/**
 * Reports about a brand or shop page itself (Rachel only; no mockup, built
 * on the report pane's pattern): the page, every open report about it, and
 * Dismiss or Mark handled. Reporters aren't told either way.
 */
export function PageReportDetailPane({ detail: d }: { detail: PageReportDetail }) {
  const { done } = useQueue();
  const [confirm, setConfirm] = useState<"dismiss" | "handled" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useShortcuts({ d: () => setConfirm("dismiss") });

  const reasons = [...new Set(d.reports.map((r) => r.reason))];
  const n = d.reports.length;

  function submit() {
    const actioned = confirm === "handled";
    startTransition(async () => {
      const result = await resolvePageReports({ pageId: d.page.id, actioned });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirm(null);
      done(actioned ? "Marked handled. Reporters aren't told." : "Reports dismissed. Nobody is told.");
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PaneHeader
        chip={<StateChip state="sent_to_you" />}
        title={`${d.page.name} reported${n > 1 ? ` ${n} times` : ""}`}
        sub={`Reports about the page itself · ${d.earlier ? `${d.earlier} earlier, closed` : "none before"}`}
      />

      {reasons.map((r) =>
        nextStep[r] ? (
          <InfoNote key={r} icon="lightbulb">
            <span className="font-semibold">{reasonLabel[r] ?? r}:</span> {nextStep[r]}
            {r === "our_page" && d.openClaims > 0 && (
              <>
                {" "}
                {d.openClaims === 1 ? "A claim is" : `${d.openClaims} claims are`} open on this page:{" "}
                <Link href="/queue?tab=claims" className="font-semibold underline focus-ring">
                  see Claims
                </Link>
                .
              </>
            )}
          </InfoNote>
        ) : null,
      )}

      <PaneSection title={n === 1 ? "The report" : `The ${n} reports`}>
        <ul className="flex flex-col border-2 border-gl-border">
          {d.reports.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 border-t border-gl-border-subtle p-3 first:border-t-0">
              <span className="flex justify-between gap-4 type-body-sm">
                <span className="font-semibold">{reasonLabel[r.reason] ?? r.reason}</span>
                <span className="text-gl-text-secondary tabular-nums">{r.ago}</span>
              </span>
              <span className="type-body-sm text-gl-text-secondary">From {r.reporter ? `@${r.reporter}` : "a deleted user"}</span>
              {r.details && <p className="type-body whitespace-pre-wrap">&ldquo;{r.details}&rdquo;</p>}
            </li>
          ))}
        </ul>
      </PaneSection>

      <PaneSection title="The page">
        <PageCard page={d.page} />
      </PaneSection>

      <div className="flex flex-col gap-3 border-t-2 border-gl-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setConfirm("handled")}>Mark handled</Button>
          <Button variant="outline" onClick={() => setConfirm("dismiss")}>
            Dismiss
          </Button>
        </div>
        <p className="type-caption text-gl-text-secondary">
          Mark handled once you&apos;ve dealt with it (a claim, a fix, or by hand). Dismiss when there&apos;s nothing to do. Reporters aren&apos;t
          told either way. Suspending, renaming or merging a page comes with the page tools.
        </p>
      </div>

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title={confirm === "handled" ? `Mark ${n === 1 ? "this report" : `all ${n} reports`} handled?` : `Dismiss ${n === 1 ? "this report" : `all ${n} reports`}?`}
        description="The page doesn't change, and nobody is told."
      >
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={submit}>
            {confirm === "handled" ? "Mark handled" : "Dismiss"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
