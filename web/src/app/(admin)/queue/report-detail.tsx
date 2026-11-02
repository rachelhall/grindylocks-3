"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { ReportDetail, Slide } from "@/lib/queue";
import { reasonLabel } from "@/lib/queue-labels";
import { cn } from "@/lib/utils";

import { moderate, type Decision } from "./actions";
import { Checkbox, ErrorLine, PaneHeader, PaneSection, shortDate, TextArea, useShortcuts } from "./pane";
import { StateChip, useQueue } from "./queue-view";

const DAYS = [1, 7, 30] as const;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function headline(d: ReportDetail): string {
  const n = d.reports.length;
  const reasons = [...new Set(d.reports.map((r) => r.reason))];
  const reason = reasons.length === 1 ? ` for ${(reasonLabel[reasons[0]] ?? reasons[0]).toLowerCase()}` : "";
  const times = n > 1 ? ` ${n} times` : "";
  const who = d.person?.username ? `@${d.person.username}` : "This person";
  if (d.target === "person") return `${who} reported${times}${reason}`;
  return `${d.target === "comment" ? "Comment" : "Post"} reported${times}${reason}`;
}

function state(d: ReportDetail): string {
  const ownersOnly =
    d.target === "person" ||
    d.reports.some((r) => r.status === "escalated" || r.reason === "harassment" || r.reason === "involves_minor");
  if (d.canBan && ownersOnly) return "sent_to_you";
  if (d.post?.status === "auto_hidden" && d.target === "post") return "auto_hidden";
  if (d.post?.status === "hidden" && d.target === "post") return "hidden";
  return "open";
}

function history(p: NonNullable<ReportDetail["person"]>): string {
  const parts = [`Joined ${shortDate(p.joinedAt)}`];
  if (p.invitedBy) parts.push(`invited by @${p.invitedBy}`);
  parts.push(plural(p.postCount, "post"));
  if (p.earlierReports === 0) parts.push("no earlier reports");
  else if (p.earlierDismissed === p.earlierReports)
    parts.push(`${plural(p.earlierReports, "earlier report")}, ${p.earlierReports === 1 ? "dismissed" : p.earlierReports === 2 ? "both dismissed" : "all dismissed"}`);
  else parts.push(`${plural(p.earlierReports, "earlier report")}, ${p.earlierDismissed} dismissed`);
  parts.push(p.warnings ? plural(p.warnings, "warning") : "no warnings");
  if (p.suspensions) parts.push(plural(p.suspensions, "suspension"));
  return parts.join(" · ");
}

type Open = Decision | null;

/**
 * A group of reports about one post, comment or person (mockups: Admin ·
 * queue, reported post; Admin · suspend, confirm). Every action opens a
 * confirmation first. City and park admins see Escalate where the owner sees
 * Ban, and escalate rather than warn or suspend someone who holds a role.
 */
export function ReportDetailPane({ detail: d }: { detail: ReportDetail }) {
  const { done } = useQueue();
  const [open, setOpen] = useState<Open>(null);
  const [message, setMessage] = useState("");
  const [days, setDays] = useState<(typeof DAYS)[number]>(7);
  const [hide, setHide] = useState(d.post?.status !== "visible");
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const st = state(d);
  const who = d.person?.username ? `@${d.person.username}` : "this person";
  const hasContent = d.target !== "person";
  const thing = d.target === "comment" ? "comment" : "post";
  const roleHolder = !d.canBan && !!d.person?.holdsRole;

  function start(decision: Decision) {
    if (roleHolder && (decision === "warn" || decision === "suspend")) return;
    if (!hasContent && decision === "keep_hidden") return;
    setError(null);
    setMessage("");
    setConfirmName("");
    setOpen(decision);
  }

  useShortcuts({
    d: () => start("dismiss"),
    h: hasContent ? () => start("keep_hidden") : null,
    e: d.canEscalate ? () => start("escalate") : null,
  });

  function submit() {
    if (!open) return;
    const decision = open;
    startTransition(async () => {
      const result = await moderate({
        target: d.target,
        id: d.id,
        decision,
        message,
        days: decision === "suspend" ? days : undefined,
        hide: decision === "warn" || decision === "suspend" ? hide && hasContent : undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(null);
      const words: Record<Decision, string> = {
        dismiss: "Reports dismissed.",
        keep_hidden: d.target === "comment" ? "Comment removed." : "Post kept hidden.",
        warn: `Warning sent to ${who}.`,
        suspend: `${who} suspended for ${plural(days, "day")}.`,
        escalate: "Sent to Rachel.",
        ban: `${who} banned.`,
      };
      done(words[decision]);
    });
  }

  const dialog: Record<Decision, { title: string; description: string; confirm: string; danger: boolean }> = {
    dismiss: {
      title: "Dismiss these reports?",
      description:
        d.target === "post" && d.post?.status !== "visible"
          ? "The post comes back for everyone. Nobody is told."
          : "Nothing changes for anyone, and nobody is told.",
      confirm: "Dismiss",
      danger: false,
    },
    keep_hidden: {
      title: d.target === "comment" ? "Remove this comment?" : "Keep this post hidden?",
      description: `${who} is told their ${thing} was taken down, with your note if you write one.`,
      confirm: d.target === "comment" ? "Remove comment" : "Keep hidden",
      danger: true,
    },
    warn: {
      title: `Warn ${who}?`,
      description: "They see your message in their notifications. Nothing else changes for them.",
      confirm: "Send warning",
      danger: false,
    },
    suspend: {
      title: `Suspend ${who}?`,
      description:
        "While suspended they can sign in and look around, but can't post, comment, like or follow. Their posts stay up unless you hide them.",
      confirm: `Suspend for ${plural(days, "day")}`,
      danger: true,
    },
    escalate: {
      title: "Send this to Rachel?",
      description: "It leaves your queue and goes to the owner, who decides. Nobody else is told.",
      confirm: "Escalate",
      danger: false,
    },
    ban: {
      title: `Ban ${who} permanently?`,
      description:
        "They can't post, comment, like or follow again. Every role they hold ends, their unused invites are cancelled and all their posts are hidden.",
      confirm: "Ban permanently",
      danger: true,
    },
  };

  const needsMessage = open === "warn" || open === "suspend";
  const banName = d.person?.username ?? "";
  const canSubmit =
    !pending && (!needsMessage || message.trim().length > 0) && (open !== "ban" || confirmName.trim() === banName);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PaneHeader
        chip={<StateChip state={st} />}
        title={headline(d)}
        sub={
          st === "auto_hidden"
            ? `Hidden automatically after the third report, ${d.reports.at(-1)?.ago ?? ""} ago.`
            : d.person?.suspendedUntil
              ? `${who} is suspended until ${shortDate(d.person.suspendedUntil)}.`
              : undefined
        }
      />

      {d.post && d.target === "post" && (
        <article className="flex flex-col gap-3 border-2 border-gl-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="type-body-sm font-semibold">{d.post.author ? `@${d.post.author}` : "deleted user"}</span>
              <span className="type-caption text-gl-text-secondary">
                {d.post.park ? `${d.post.park.name} · ` : ""}
                {shortDate(d.post.createdAt)}
              </span>
            </div>
            <a href={`grindylocks://post/${d.post.id}`} className="type-body-sm font-semibold text-gl-accent-text underline focus-ring">
              Open in app
            </a>
          </div>
          {d.post.slides.length > 0 && <Slides slides={d.post.slides} />}
          {d.post.caption && <p className="type-body whitespace-pre-wrap">{d.post.caption}</p>}
        </article>
      )}

      {d.comment && (
        <article className="flex flex-col gap-2 border-2 border-gl-border p-4">
          <span className="type-body-sm font-semibold">
            {d.comment.author ? `@${d.comment.author}` : "deleted user"}{" "}
            <span className="font-normal text-gl-text-secondary">
              commented {shortDate(d.comment.createdAt)}
              {d.post?.park ? ` on a post at ${d.post.park.name}` : ""}
            </span>
          </span>
          {d.comment.deleted ? (
            <p className="type-body text-gl-text-secondary">The commenter already deleted this comment.</p>
          ) : (
            <p className="type-body whitespace-pre-wrap">{d.comment.body}</p>
          )}
          {d.post && (
            <a href={`grindylocks://post/${d.post.id}`} className="self-start type-body-sm font-semibold text-gl-accent-text underline focus-ring">
              Open the post in the app
            </a>
          )}
        </article>
      )}

      <PaneSection title="Reports">
        <ul className="flex flex-col">
          {d.reports.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 border-t border-gl-border-subtle py-2 type-body-sm last:border-b">
              <span>
                <span className="font-semibold">{reasonLabel[r.reason] ?? r.reason}</span>
                {" · "}
                {r.reporter ? `@${r.reporter}` : "deleted user"}
                {r.details && <span className="text-gl-text-secondary"> · &ldquo;{r.details}&rdquo;</span>}
                {r.status === "escalated" && <span className="text-gl-text-secondary"> · escalated</span>}
              </span>
              <span className="shrink-0 tabular-nums text-gl-text-secondary">{r.ago}</span>
            </li>
          ))}
        </ul>
      </PaneSection>

      {d.person && (
        <PaneSection title={`About ${d.person.username ? `@${d.person.username}` : "this person"}`}>
          <p className="type-body-sm">
            {d.person.deleted ? "Deleted their account." : history(d.person)}
            {d.person.holdsRole && <span className="font-semibold"> · holds a role</span>}
          </p>
        </PaneSection>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => start("dismiss")}>
            {d.target === "post" && d.post?.status !== "visible" ? "Dismiss and restore" : "Dismiss"}
          </Button>
          {hasContent && (
            <Button variant="danger" onClick={() => start("keep_hidden")}>
              {d.target === "comment" ? "Remove comment" : d.post?.status === "visible" ? "Hide post" : "Keep hidden"}
            </Button>
          )}
          <Button variant="outline" disabled={roleHolder} onClick={() => start("warn")}>
            Warn
          </Button>
          <Button variant="danger" disabled={roleHolder} onClick={() => start("suspend")}>
            Suspend…
          </Button>
          {d.canBan ? (
            <Button variant="danger" onClick={() => start("ban")}>
              Ban permanently…
            </Button>
          ) : (
            <Button variant="outline" onClick={() => start("escalate")}>
              <Icon name="arrow_upward" />
              Escalate to Rachel
            </Button>
          )}
        </div>
        <p className="type-caption text-gl-text-secondary">
          {roleHolder
            ? `${who} holds a role, so warnings and suspensions go through Rachel: escalate instead.`
            : `Dismissing ${d.target === "post" && d.post?.status !== "visible" ? "brings the post back and " : ""}tells nobody. ${
                hasContent ? `Keeping it hidden lets ${who} know their ${thing} was taken down.` : ""
              }`}
        </p>
      </div>

      <Dialog
        open={open !== null}
        onOpenChange={(o) => !o && !pending && setOpen(null)}
        title={open ? dialog[open].title : ""}
        description={open ? dialog[open].description : undefined}
      >
        {open === "suspend" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 type-label text-gl-text-secondary">For</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((n) => (
                <label
                  key={n}
                  className={cn(
                    "flex h-control items-center gap-2 border-2 px-3 type-body-sm font-semibold",
                    days === n ? "border-gl-border bg-gl-accent-subtle text-gl-on-accent-subtle" : "border-gl-border-subtle",
                  )}
                >
                  <input
                    type="radio"
                    name="days"
                    checked={days === n}
                    onChange={() => setDays(n)}
                    className="accent-gl-accent focus-ring"
                  />
                  {plural(n, "day")}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {open && open !== "dismiss" && open !== "escalate" && (
          <TextArea
            id="mod-message"
            label={open === "keep_hidden" ? "Note they'll see" : open === "ban" ? "Reason, for the log" : "Reason they'll see"}
            required={needsMessage}
            value={message}
            onChange={setMessage}
          />
        )}
        {(open === "warn" || open === "suspend") && hasContent && (
          <Checkbox id="mod-hide" label={`Also keep the reported ${thing} hidden`} checked={hide} onChange={setHide} />
        )}
        {open === "ban" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ban-name" className="type-label text-gl-text-secondary">
              Type {banName} to confirm
            </label>
            <input
              id="ban-name"
              autoComplete="off"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="h-control border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm text-gl-text focus-ring"
            />
          </div>
        )}
        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setOpen(null)}>
            Cancel
          </Button>
          <Button
            variant={open && dialog[open].danger ? "danger-solid" : "primary"}
            disabled={!canSubmit}
            onClick={submit}
          >
            {open ? dialog[open].confirm : ""}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Slides({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden bg-gl-surface-sunk">
        {slide.imageUrl ? (
          // Signed, short-lived URLs from private storage: next/image can't cache them.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slide.imageUrl} alt="" className="size-full object-contain" />
        ) : (
          <span className="flex items-center gap-1.5 type-body-sm text-gl-text-secondary">
            <Icon name={slide.kind === "video" ? "play_arrow" : "image"} />
            {slide.kind === "video" ? "Clip" : "Photo unavailable"}
          </span>
        )}
        {slide.kind === "video" && slide.durationS != null && (
          <span className="absolute top-2 left-2 bg-gl-text px-1.5 py-0.5 text-xs font-semibold text-gl-surface tabular-nums">
            {Math.floor(slide.durationS / 60)}:{String(Math.round(slide.durationS % 60)).padStart(2, "0")}
          </span>
        )}
      </div>
      {slides.length > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="icon" aria-label="Previous slide" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            <Icon name="chevron_left" />
          </Button>
          <span className="type-caption tabular-nums">
            {index + 1} / {slides.length}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next slide"
            disabled={index === slides.length - 1}
            onClick={() => setIndex(index + 1)}
          >
            <Icon name="chevron_right" />
          </Button>
        </div>
      )}
    </div>
  );
}
