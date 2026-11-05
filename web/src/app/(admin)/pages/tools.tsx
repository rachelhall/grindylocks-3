"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { pageType } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { PageDetail } from "@/lib/pages-admin";
import { cn } from "@/lib/utils";

import {
  checkHandle,
  closePage,
  findPages,
  liftSuspension,
  type MergeOption,
  type MergePreview,
  mergePages,
  previewMerge,
  renamePage,
  reopenPage,
  splitPage,
  suspendPage,
  transferPage,
} from "./actions";

export type Tool = "rename" | "transfer" | "split" | "suspend" | "merge" | "close" | "lift" | "reopen";

const field = "h-control w-full min-w-0 border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm text-gl-text placeholder:text-gl-text-secondary focus-ring";
const label = "type-label text-gl-text-secondary";

function Err({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="type-body-sm text-gl-danger">
      {error}
    </p>
  );
}

function Note({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div role="note" className="flex items-start gap-2.5 border-2 border-gl-border p-3 type-body-sm">
      <Icon name={icon} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 border-t-2 border-gl-border pt-4">{children}</div>;
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 type-body-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-px size-[18px] shrink-0 accent-gl-accent focus-ring" />
      <span>{children}</span>
    </label>
  );
}

function Radio({
  name,
  checked,
  onChange,
  children,
  className,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-2.5 border-2 border-gl-border px-3 py-2 type-body-sm",
        checked && "bg-gl-accent-subtle text-gl-on-accent-subtle",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-gl-focus",
        className,
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-[18px] shrink-0 accent-gl-text" />
      {children}
    </label>
  );
}

const HANDLE = /^[a-zA-Z0-9_.]{2,30}$/;
const verdictText: Record<string, string> = {
  ok: "Free. Not a username, page handle or held handle.",
  invalid: "Letters, numbers, dots and underscores, 2 to 30.",
  official: "Can't contain \"official\".",
  username: "A member has this as their username.",
  page: "Another page has this handle.",
  held: "Held: a member's old username, or another page's old handle still redirecting.",
  error: "Couldn't check it. Try again.",
};

/** A live handle check, a beat after typing stops. */
function useHandleCheck(handle: string, page: string | null, skip: boolean) {
  const h = handle.trim().replace(/^@+/, "");
  const [result, setResult] = useState<{ h: string; verdict: string } | null>(null);
  const wanted = !skip && HANDLE.test(h);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const timer = setTimeout(async () => {
      const verdict = await checkHandle(h, page);
      if (live) setResult({ h, verdict });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [h, page, wanted]);
  if (skip || !h) return null;
  if (!HANDLE.test(h)) return "invalid";
  return result?.h === h ? result.verdict : null;
}

function HandleVerdict({ verdict, id }: { verdict: string | null; id: string }) {
  if (!verdict) return null;
  const ok = verdict === "ok";
  return (
    <span id={id} className={cn("flex items-center gap-1 type-body-sm", ok ? "text-gl-text" : "text-gl-danger")}>
      <Icon name={ok ? "check_circle" : "error"} size={18} />
      {verdictText[verdict] ?? verdictText.error}
    </span>
  );
}

function in90Days(): string {
  return new Date(Date.now() + 90 * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Every page tool's dialog; `tool` picks the open one. */
export function ToolDialogs({
  page,
  tool,
  onClose,
  onDone,
}: {
  page: PageDetail;
  tool: Tool | null;
  onClose: () => void;
  onDone: (message: string, gone?: true | string) => void;
}) {
  const done = (message: string, gone?: true | string) => {
    onClose();
    onDone(message, gone);
  };
  return (
    <>
      {tool === "suspend" && <SuspendDialog page={page} onClose={onClose} onDone={done} />}
      {tool === "lift" && <LiftDialog page={page} onClose={onClose} onDone={done} />}
      {tool === "transfer" && <TransferDialog page={page} onClose={onClose} onDone={done} />}
      {tool === "rename" && <RenameDialog page={page} onClose={onClose} onDone={done} />}
      {tool === "merge" && <MergeDialog page={page} onClose={onClose} onDone={done} />}
      {tool === "split" && <SplitDialog page={page} onClose={onClose} onDone={done} />}
      {tool === "close" && <CloseDialog page={page} onClose={onClose} onDone={done} />}
      {tool === "reopen" && <ReopenDialog page={page} onClose={onClose} onDone={done} />}
    </>
  );
}

type DialogProps = { page: PageDetail; onClose: () => void; onDone: (message: string, gone?: true | string) => void };

/* Suspend (Admin-Page-Suspend) ------------------------------------------------------------ */

function SuspendDialog({ page, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState("");
  const [hide, setHide] = useState(false);
  const [cancelMeetups, setCancelMeetups] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const team = page.team.length;

  const submit = () =>
    start(async () => {
      const r = await suspendPage(page.id, reason, hide, cancelMeetups);
      if (!r.ok) return setError(r.error);
      onDone(
        `${page.name} is suspended.${r.value ? ` ${r.value} ${r.value === 1 ? "post" : "posts"} hidden.` : ""}${
          cancelMeetups ? " Its upcoming meetups are cancelled." : ""
        } The team is told.`,
      );
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={`Suspend ${page.name}?`}
      description={`The page goes read-only until you lift it: nobody can post, comment or host meetups as ${page.name}, and Edit page and Team are locked. Its posts stay up unless you hide them, and followers aren't told. The team's own accounts carry on as usual.`}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sus-why" className={label}>
          Reason the team sees
        </label>
        <textarea
          id="sus-why"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="resize-y border-2 border-gl-border bg-gl-surface-sunk px-2.5 py-2 type-body-sm text-gl-text focus-ring"
        />
      </div>
      <fieldset className="flex flex-col gap-2.5">
        <legend className={cn(label, "pb-2")}>Also</legend>
        <Check checked={hide} onChange={setHide}>
          Hide {page.name}&apos;s posts from the last 7 days ({page.recentPosts})
        </Check>
        <Check checked={cancelMeetups} onChange={setCancelMeetups}>
          Cancel {page.name}&apos;s upcoming meetups (people going are told &ldquo;It&apos;s no longer happening&rdquo;)
        </Check>
      </fieldset>
      <Note icon="notifications">
        {team === 1 ? "The 1 team member gets" : `All ${team} team members get`} a notice in their bell, and it&apos;s pinned in the page&apos;s
        inbox. Lift suspension is in the page&apos;s pane.
      </Note>
      <Err error={error} />
      <Footer>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger-solid" disabled={pending || !reason.trim()} onClick={submit}>
          Suspend {page.name}
        </Button>
      </Footer>
    </Dialog>
  );
}

function LiftDialog({ page, onClose, onDone }: DialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await liftSuspension(page.id);
      if (!r.ok) return setError(r.error);
      onDone(`${page.name}'s suspension is lifted.${r.value ? ` ${r.value} hidden ${r.value === 1 ? "post is" : "posts are"} back.` : ""} The team is told.`);
    });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={`Lift ${page.name}'s suspension?`}
      description="The team can post, comment and edit the page again, and posts the suspension hid come back. The team is told in their bell."
    >
      <Err error={error} />
      <Footer>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={pending} onClick={submit}>
          Lift suspension
        </Button>
      </Footer>
    </Dialog>
  );
}

/* Transfer ownership (Admin-Page-Transfer) ------------------------------------------------- */

function TransferDialog({ page, onClose, onDone }: DialogProps) {
  const owner = page.team.find((m) => m.role === "owner") ?? null;
  const candidates = page.team.filter((m) => m.role !== "owner" && m.available);
  // The longest-serving manager is suggested (the list comes owner, managers, staff, longest first).
  const suggested = candidates.find((m) => m.role === "manager") ?? null;
  const [pick, setPick] = useState<string>(suggested?.userId ?? candidates[0]?.userId ?? "other");
  const [username, setUsername] = useState("");
  const [stays, setStays] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const picked = candidates.find((m) => m.userId === pick);
  const newName = picked ? `@${picked.username ?? "deleted user"}` : username.trim() ? `@${username.trim().replace(/^@+/, "")}` : "them";

  const submit = () =>
    start(async () => {
      const r = await transferPage({
        page: page.id,
        newOwner: picked?.userId ?? null,
        username: picked ? null : username.trim().replace(/^@+/, ""),
        oldOwnerStays: stays,
        note,
      });
      if (!r.ok) return setError(r.error);
      onDone(`${newName} owns ${page.name} now. Both are told.`);
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={`Transfer ${page.name}`}
      description="Takes effect at once, with no Accept step. For when the owner is gone, asks you to, or a dispute is settled. Owners can still hand over from Team themselves."
      className="w-[min(560px,calc(100vw-32px))]"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className={cn(label, "pb-2")}>New owner</legend>
        {candidates.map((m) => (
          <Radio key={m.userId} name="owner" checked={pick === m.userId} onChange={() => setPick(m.userId)}>
            <span className="flex flex-col">
              <strong>@{m.username ?? "deleted user"}</strong>
              <span className="text-gl-text-secondary">
                {m.role === "manager" ? "Manager" : "Staff"} since {new Date(m.joinedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {m.userId === suggested?.userId ? " · longest-serving manager" : ""}
              </span>
            </span>
            {m.userId === suggested?.userId && (
              <span className="ml-auto border-2 border-gl-border px-1.5 text-[11px] font-bold tracking-[0.08em]">SUGGESTED</span>
            )}
          </Radio>
        ))}
        <Radio name="owner" checked={pick === "other"} onChange={() => setPick("other")} className="flex-wrap">
          <span>Someone not on the team, by username</span>
          {pick === "other" && (
            <input
              aria-label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="@username"
              className={cn(field, "basis-full")}
            />
          )}
        </Radio>
        <p className="type-caption text-gl-text-secondary">
          Suspended and banned members aren&apos;t listed. For a page with nobody on it, use Send claim invite.
        </p>
      </fieldset>

      {owner && (
        <fieldset className="flex flex-col gap-2">
          <legend className={cn(label, "pb-2")}>@{owner.username ?? "deleted user"}, the owner now</legend>
          <div className="flex flex-wrap gap-2">
            <Radio name="old" checked={stays} onChange={() => setStays(true)} className="min-h-control font-semibold">
              Stays as manager
            </Radio>
            <Radio name="old" checked={!stays} onChange={() => setStays(false)} className="min-h-control font-semibold">
              Leaves the team
            </Radio>
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tr-note" className={label}>
          Note for the history <span className="normal-case tracking-normal">(optional)</span>
        </label>
        <input id="tr-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
      </div>

      {page.frozen && (
        <p className="type-body-sm">
          This page is frozen by a dispute. Transferring settles it: other open claims are declined, &ldquo;This is our brand&rdquo; reports
          close, and the page unfreezes.
        </p>
      )}
      <p className="type-body-sm text-gl-text-secondary">Both are told in their bell. A pending hand-over from Team is cancelled.</p>
      <Err error={error} />
      <Footer>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={pending || (!picked && !username.trim())} onClick={submit}>
          Make {newName} owner
        </Button>
      </Footer>
    </Dialog>
  );
}

/* Rename or change handle (Admin-Page-Rename) ---------------------------------------------- */

function RenameDialog({ page, onClose, onDone }: DialogProps) {
  const [name, setName] = useState(page.name);
  const [handle, setHandle] = useState(page.handle);
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const clean = handle.trim().replace(/^@+/, "");
  const handleChanged = clean.toLowerCase() !== page.handle.toLowerCase();
  const nameChanged = name.trim() !== page.name;
  const verdict = useHandleCheck(handle, page.id, !handleChanged);
  const ready = (nameChanged || clean !== page.handle) && name.trim() && (!handleChanged || verdict === "ok");

  const submit = () =>
    start(async () => {
      const r = await renamePage(page.id, name.trim(), clean, keep);
      if (!r.ok) return setError(r.error);
      onDone(`${page.name} is now ${name.trim()} (@${clean}). The team is told.`);
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={`Rename ${page.name}`}
      description="Followers, posts, products and the team stay. Change one or both."
      className="w-[min(540px,calc(100vw-32px))]"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="rn-name" className={label}>
          Display name
        </label>
        <input id="rn-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        {nameChanged && (
          <div className="mt-1">
            <Check checked={keep} onChange={setKeep}>
              Keep &ldquo;{page.name}&rdquo; as a Formerly name, so Search still finds it
            </Check>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="rn-handle" className={label}>
          Handle
        </label>
        <div className="flex h-control items-center border-2 border-gl-border bg-gl-surface-sunk focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gl-focus">
          <span aria-hidden="true" className="pr-0.5 pl-2.5 type-body-sm text-gl-text-secondary">
            @
          </span>
          <input
            id="rn-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            aria-describedby="rn-verdict"
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent pr-2.5 type-body-sm text-gl-text outline-none"
          />
        </div>
        <HandleVerdict verdict={verdict} id="rn-verdict" />
        <span className="type-caption text-gl-text-secondary">Letters, numbers, dots and underscores. Can&apos;t contain &ldquo;official&rdquo;.</span>
      </div>
      {handleChanged && (
        <Note icon="alt_route">
          <strong>@{page.handle}</strong> keeps working until <strong>{in90Days()}</strong> (90 days): links and @mentions open the page, and nobody
          can take it. After that it&apos;s free again.
        </Note>
      )}
      <p className="type-body-sm text-gl-text-secondary">The team is told in their bell. Followers aren&apos;t told.</p>
      <Err error={error} />
      <Footer>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={pending || !ready} onClick={submit}>
          {nameChanged && handleChanged ? "Save name and handle" : handleChanged ? "Save handle" : "Save name"}
        </Button>
      </Footer>
    </Dialog>
  );
}

/* Merge (Admin-Page-Merge) ------------------------------------------------------------------ */

function MergeDialog({ page, onClose, onDone }: DialogProps) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<MergeOption[]>([]);
  const [target, setTarget] = useState<MergeOption | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; preview: MergePreview } | null>(null);
  const preview = target && loaded?.id === target.id ? loaded.preview : null;
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (target) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await findPages(q || page.name.split(/\s+/)[0], page.id);
      if (live) setOptions(found);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, target, page.id, page.name]);

  useEffect(() => {
    if (!target) return;
    let live = true;
    previewMerge(page.id, target.id).then((r) => {
      if (!live) return;
      if (r.ok) setLoaded({ id: target.id, preview: r.value });
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [target, page.id]);

  const submit = () =>
    start(async () => {
      if (!target) return;
      const r = await mergePages(page.id, target.id, confirm);
      if (!r.ok) return setError(r.error);
      onDone(`${page.name} was merged into ${target.name}.`, target.id);
    });

  const added = preview ? preview.followers - preview.followersBoth : 0;
  const pointing = preview ? preview.mentions + preview.carriedBy + preview.collabs : 0;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title="Merge a duplicate"
      description="Only for duplicates or a true rebrand into one page. A brand that's still selling under its own name keeps its page."
      className="w-[min(620px,calc(100vw-32px))]"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-[1_1_200px] flex-col gap-0.5 border-2 border-gl-border p-3">
          <span className={label}>Merge, then delete</span>
          <span className="type-body font-bold">{page.name}</span>
          <span className="type-body-sm text-gl-text-secondary">
            @{page.handle} · {page.state === "managed" ? "Managed" : page.state === "unofficial" ? "Unofficial" : page.state.replaceAll("_", " ")}
          </span>
        </div>
        <Icon name="arrow_forward" size={28} />
        <div className="flex flex-[1_1_200px] flex-col gap-1.5">
          <label htmlFor="mg-into" className={label}>
            Into
          </label>
          {target ? (
            <div className="flex min-h-12 items-center gap-2 border-2 border-gl-border bg-gl-surface-sunk px-2.5">
              <span className="flex min-w-0 flex-1 flex-col type-body-sm">
                <strong>{target.name}</strong>
                <span className="text-gl-text-secondary">@{target.handle}</span>
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Pick another page"
                onClick={() => {
                  setTarget(null);
                  setConfirm("");
                  setError(null);
                }}
              >
                <Icon name="close" />
              </Button>
            </div>
          ) : (
            <input id="mg-into" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages" autoComplete="off" className={field} />
          )}
        </div>
      </div>

      {!target && (
        <ul className="flex max-h-56 flex-col overflow-y-auto border-2 border-gl-border" aria-label="Pages">
          {options.length ? (
            options.map((o) => (
              <li key={o.id} className="border-b border-gl-border-subtle last:border-b-0">
                <button
                  type="button"
                  onClick={() => setTarget(o)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left type-body-sm hover:bg-gl-surface-raised focus-ring"
                >
                  <strong>{o.name}</strong>
                  <span className="text-gl-text-secondary">{[`@${o.handle}`, pageType(o.roles), o.place].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 type-body-sm text-gl-text-secondary">No pages match.</li>
          )}
        </ul>
      )}

      {target && (
        <section className="flex flex-col gap-2">
          <h3 className={label}>What happens</h3>
          {preview ? (
            <>
              {preview.unhandled.length > 0 && (
                <p role="alert" className="type-body-sm text-gl-danger">
                  Merging is off: {preview.unhandled.join(", ")} isn&apos;t handled yet.
                </p>
              )}
              <ul className="flex flex-col border-t border-gl-border-subtle type-body-sm">
                {[
                  [`Followers combine; ${preview.followersBoth} already follow ${target.name}`, `+${added}`],
                  [`@mentions, gear links and brands-carried lists point to ${target.name}`, String(pointing)],
                  [`Posts move to ${target.name}`, String(preview.posts)],
                  [
                    `Products move${preview.clashes ? `; ${preview.clashes} ${preview.clashes === 1 ? "has" : "have"} the same name as one on ${target.name} and ${preview.clashes === 1 ? "is" : "are"} flagged in Product suggestions` : ""}`,
                    String(preview.products),
                  ],
                  [`"${page.name}" and @${page.handle} become Formerly names; the handle redirects for 90 days`, null],
                  [
                    `Open claims, reports and blocks on ${page.name} are closed${
                      preview.openClaims + preview.openReports + preview.activeBlocks
                        ? ` (${preview.openClaims} claims, ${preview.openReports} reports, ${preview.activeBlocks} blocks)`
                        : ""
                    }. ${target.name}'s team and description stay as they are`,
                    null,
                  ],
                ].map(([text, n], i) => (
                  <li key={i} className="flex justify-between gap-3 border-b border-gl-border-subtle py-2">
                    <span>{text}</span>
                    {n === null ? <Icon name="check" size={18} /> : <strong className="whitespace-nowrap tabular-nums">{n}</strong>}
                  </li>
                ))}
              </ul>
              <p className="type-caption text-gl-text-secondary">
                {preview.sourceTeam
                  ? `Nobody else is notified. ${page.name}'s ${preview.sourceTeam === 1 ? "team member is" : `${preview.sourceTeam} team members are`} told and taken off.`
                  : "Nobody is notified."}
              </p>
            </>
          ) : (
            <p className="type-body-sm text-gl-text-secondary">Working it out…</p>
          )}
        </section>
      )}

      {target && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mg-confirm" className={label}>
            Type {target.handle} to confirm. This can&apos;t be undone.
          </label>
          <input id="mg-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className={field} />
        </div>
      )}
      <Err error={error} />
      <Footer>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger-solid"
          disabled={
            pending ||
            !target ||
            !preview ||
            preview.unhandled.length > 0 ||
            confirm.trim().replace(/^@+/, "").toLowerCase() !== target.handle.toLowerCase()
          }
          onClick={submit}
        >
          {target ? `Merge into ${target.name}` : "Merge"}
        </Button>
      </Footer>
    </Dialog>
  );
}

/* Split (Admin-Page-Split) --------------------------------------------------------------------- */

const PART: Record<string, string> = {
  boot: "Boot",
  frame: "Frame",
  plate: "Plate",
  trucks: "Trucks",
  deck: "Deck",
  wheels: "Wheels",
  bearings: "Bearings",
  liner: "Liner",
  soulplate: "Soulplate",
  toe_stop: "Toe stop",
  slide_blocks: "Slide blocks",
  laces: "Laces",
};

function countries(): { code: string; name: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    names = null;
  }
  const codes: string[] = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) codes.push(String.fromCharCode(a, b));
  return codes
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .filter((c) => c.name !== c.code)
    .sort((x, y) => x.name.localeCompare(y.name));
}

function SplitDialog({ page, onClose, onDone }: DialogProps) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<"brand" | "shop">("brand");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState(page.country ?? "");
  const [line, setLine] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const verdict = useHandleCheck(handle, null, false);
  const allCountries = useMemo(() => countries(), []);
  const groups = page.productGroups;
  const moving = [...picked].reduce((n, i) => n + groups[i].count, 0);
  const total = groups.reduce((n, g) => n + g.count, 0);
  const shownName = name.trim() || "the new page";

  const submit = () =>
    start(async () => {
      const r = await splitPage({
        page: page.id,
        name: name.trim(),
        handle: handle.trim().replace(/^@+/, ""),
        role,
        line: line.trim(),
        city,
        country,
        products: [...picked].flatMap((i) => groups[i].ids),
      });
      if (!r.ok) return setError(r.error);
      onDone(`${name.trim()} has its own page, with ${moving} products. ${page.name}'s followers get one notice.`, r.value);
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={`Split off from ${page.name}`}
      description="Makes a new Unofficial page and moves the products you pick. Product IDs stay the same, so nobody's gear links break."
      className="w-[min(640px,calc(100vw-32px))]"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sp-name" className={label}>
            New page name
          </label>
          <input id="sp-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sp-handle" className={label}>
            Handle
          </label>
          <input
            id="sp-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@"
            aria-describedby="sp-verdict"
            autoComplete="off"
            className={field}
          />
          <HandleVerdict verdict={verdict} id="sp-verdict" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sp-type" className={label}>
            Type
          </label>
          <select id="sp-type" value={role} onChange={(e) => setRole(e.target.value as "brand" | "shop")} className={field}>
            <option value="brand">Brand</option>
            <option value="shop">Shop</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sp-country" className={label}>
            Country
          </label>
          <select id="sp-country" value={country} onChange={(e) => setCountry(e.target.value)} className={field}>
            <option value="">Not known</option>
            {allCountries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="sp-city" className={label}>
            City <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <input id="sp-city" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} className={field} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sp-line" className={label}>
          Factual line, English
        </label>
        <input id="sp-line" maxLength={300} value={line} onChange={(e) => setLine(e.target.value)} className={field} />
        <span className="type-caption text-gl-text-secondary">Flagged Needs translations until Spanish, Danish and German are added.</span>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className={cn(label, "pb-2")}>
          Products to move · {moving} of {total}
        </legend>
        <div className="flex max-h-64 flex-col overflow-y-auto border-2 border-gl-border">
          {groups.map((g, i) => (
            <label key={`${g.partType}:${g.label}`} className="flex min-h-11 items-center gap-2.5 border-b border-gl-border-subtle px-3 type-body-sm last:border-b-0">
              <input
                type="checkbox"
                checked={picked.has(i)}
                onChange={(e) =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
                className="size-[18px] shrink-0 accent-gl-accent focus-ring"
              />
              <strong>{g.label}</strong>
              <span className="text-gl-text-secondary">
                {PART[g.partType] ?? g.partType} · {g.count} {g.count === 1 ? "entry" : "entries"}
              </span>
            </label>
          ))}
        </div>
        <span className="type-caption text-gl-text-secondary">
          Grouped by family; a family moves with its pro models and editions. Stock parts keep pointing where they did.
        </span>
      </fieldset>

      <Note icon="notifications">
        {page.name}&apos;s {page.followers} {page.followers === 1 ? "follower isn't" : "followers aren't"} moved over. They get one notice, &ldquo;
        {shownName} has its own page&rdquo;, with a Follow button. {page.name} keeps its own followers and posts.
      </Note>
      <Err error={error} />
      <Footer>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={pending || !name.trim() || !line.trim() || verdict !== "ok" || moving === 0}
          onClick={submit}
        >
          Create {name.trim() || "page"}, move {moving} products
        </Button>
      </Footer>
    </Dialog>
  );
}

/* Closed for good (Admin-Page-Close) and Reopen ----------------------------------------------- */

const YEAR = /^[12][0-9]{3}$/;

function CloseDialog({ page, onClose, onDone }: DialogProps) {
  const shop = page.roles.includes("shop");
  const [from, setFrom] = useState(page.foundedLabel?.replace(/^c\.\s*/i, "") ?? "");
  const [to, setTo] = useState(String(new Date().getUTCFullYear()));
  const [approx, setApprox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fromLabel = page.foundedLabel && /^c\./i.test(page.foundedLabel) && from === page.foundedLabel.replace(/^c\.\s*/i, "") ? page.foundedLabel : from;
  const toLabel = to ? `${approx ? "c. " : ""}${to}` : "";
  const valid = shop || ((!from || YEAR.test(from)) && (!to || YEAR.test(to)));
  const tape = ["BRAND", (page.city ?? page.country ?? "").toUpperCase(), [fromLabel, toLabel].filter(Boolean).join("–").toUpperCase()]
    .filter(Boolean)
    .join(" · ");
  const sentence = shop
    ? `This shop closed in ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`
    : to
      ? approx
        ? `${page.name} stopped making gear around ${to}.`
        : `${page.name} stopped making gear in ${to}.`
      : `${page.name} doesn't make gear any more.`;

  const submit = () =>
    start(async () => {
      const r = await closePage(page.id, shop ? "" : fromLabel, shop ? "" : toLabel);
      if (!r.ok) return setError(r.error);
      onDone(`${page.name} is ${r.value === "closed" ? "Closed" : "Retired"} now. ${page.team.length ? "The team is told." : ""}`);
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={shop ? `${page.name} closed for good?` : `${page.name} stopped making gear?`}
      description={`The page becomes a read-only archive labelled ${shop ? "CLOSED" : "RETIRED"}.`}
      className="w-[min(560px,calc(100vw-32px))]"
    >
      {!shop && (
        <fieldset className="flex flex-col gap-2">
          <legend className={cn(label, "pb-2")}>Years on the tape</legend>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex w-28 flex-col gap-1.5">
              <label htmlFor="cl-from" className="type-caption text-gl-text-secondary">
                From
              </label>
              <input id="cl-from" inputMode="numeric" maxLength={4} value={from} onChange={(e) => setFrom(e.target.value.trim())} className={field} />
            </div>
            <span className="pb-2">–</span>
            <div className="flex w-28 flex-col gap-1.5">
              <label htmlFor="cl-to" className="type-caption text-gl-text-secondary">
                To
              </label>
              <input id="cl-to" inputMode="numeric" maxLength={4} value={to} onChange={(e) => setTo(e.target.value.trim())} className={field} />
            </div>
            <div className="pb-2">
              <Check checked={approx} onChange={setApprox}>
                Approximate end (c.)
              </Check>
            </div>
          </div>
          <span className="type-caption text-gl-text-secondary">Reads {tape}</span>
        </fieldset>
      )}
      <section className="flex flex-col gap-1.5">
        <h3 className={label}>Archive note</h3>
        <p className="border-2 border-gl-border-subtle bg-gl-surface-sunk p-3 type-body-sm">{sentence}</p>
        <span className="type-caption text-gl-text-secondary">The app writes this from the {shop ? "date" : "years"}, in all four languages.</span>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className={label}>What changes</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 type-body-sm">
          <li>No Follow button. Followers stay and aren&apos;t told.</li>
          {!shop && <li>All its gear shows, with no Show past gear toggle.</li>}
          <li>No new posts, comments or meetups as the page; past posts stay.</li>
          <li>Its upcoming meetups are cancelled, and people going are told &ldquo;{page.name} has closed&rdquo;.</li>
          {page.state === "managed" && <li>A managed page loses its logo and OFFICIAL; its team stays, read-only, and is told.</li>}
          {shop && <li>The shop leaves the map, Near you and brands-carried lists.</li>}
          <li>You can reopen it from the page&apos;s pane.{shop ? " A shop can still be removed completely on request." : ""}</li>
        </ul>
      </section>
      <Err error={error ?? (valid ? null : "Years look like 2014.")} />
      <Footer>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger-solid" disabled={pending || !valid} onClick={submit}>
          {shop ? "Mark Closed" : "Mark Retired"}
        </Button>
      </Footer>
    </Dialog>
  );
}

function ReopenDialog({ page, onClose, onDone }: DialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const owner = page.team.some((m) => m.role === "owner");
  const submit = () =>
    start(async () => {
      const r = await reopenPage(page.id);
      if (!r.ok) return setError(r.error);
      onDone(`${page.name} is open again, as ${r.value === "managed" ? "a managed page" : r.value === "name_only" ? "name only" : "Unofficial"}.`);
    });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={`Reopen ${page.name}?`}
      description={
        owner
          ? "It goes back to managed with its team, and OFFICIAL again if it kept its logo. The team is told."
          : "Nobody owns it, so it goes back to Unofficial and can be claimed again."
      }
    >
      <Err error={error} />
      <Footer>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={pending} onClick={submit}>
          Reopen
        </Button>
      </Footer>
    </Dialog>
  );
}
