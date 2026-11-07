"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { atLeast, type TeamRole } from "@/lib/page-sections";
import { MAX_OPEN_INVITES } from "@/lib/page-fields";
import type { BlockedPerson, ManagedPage, TeamInvite, TeamMember } from "@/lib/page-tools";

import { cancelInvite, inviteToTeam, offerOwnership, removeMember, type Result, setMemberRole, unblock } from "./actions";
import { Block, Hint } from "./section-shell";

type Confirm =
  | { kind: "remove"; member: TeamMember }
  | { kind: "transfer" }
  | null;

/**
 * Team (mockup: Web · page team): invite by username or email with a role;
 * the team with role selects and Remove; waiting invites with Cancel; the
 * Blocked list with Unblock; and the owner's Transfer ownership (the new
 * owner accepts in the app). Who can do what follows the PRD's permissions:
 * managers invite and move staff up, only the owner moves a manager down or
 * removes one. The database checks each action again.
 */
export function TeamSection({
  page,
  myRole,
  members,
  invites,
  blocked,
}: {
  page: ManagedPage;
  myRole: TeamRole;
  members: TeamMember[];
  invites: TeamInvite[];
  blocked: BlockedPerson[];
}) {
  const router = useRouter();
  const [who, setWho] = useState("");
  const [role, setRole] = useState<"staff" | "manager">("staff");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [newOwner, setNewOwner] = useState<string>("");
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const manager = atLeast(myRole, "manager");
  const owner = myRole === "owner";
  const teamInvites = invites.filter((i) => i.kind === "team");
  const handover = invites.find((i) => i.kind === "ownership");
  const openLeft = Math.max(0, MAX_OPEN_INVITES - teamInvites.length);

  function run(action: () => Promise<Result>, done: string, after?: () => void) {
    setStatus(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setStatus({ error: true, text: result.error });
      setStatus({ error: false, text: done });
      after?.();
      router.refresh();
    });
  }

  function invite() {
    const target = who.trim();
    run(() => inviteToTeam(page.handle, target, role), `Invite sent to ${target.includes("@") && !target.startsWith("@") ? target : `@${target.replace(/^@/, "")}`}.`, () => setWho(""));
  }

  /** What this person may do to a member: change their role, remove them. */
  function rights(m: TeamMember) {
    if (m.isMe || m.role === "owner") return { role: false, remove: false };
    if (owner) return { role: true, remove: true };
    // Managers move staff up and remove staff; managers are the owner's to change.
    return { role: manager && m.role === "staff", remove: manager && m.role === "staff" };
  }

  return (
    <div className="flex max-w-[860px] flex-col px-6 pb-6">
      {status && (
        <p role={status.error ? "alert" : "status"} className={status.error ? "pt-4 type-body-sm text-gl-danger" : "pt-4 type-body-sm"}>
          {status.text}
        </p>
      )}

      {manager && (
        <Block id="invite-h" title="Invite someone" aside={<span className="type-body-sm text-gl-text-secondary">{openLeft} more invites can be open</span>} first>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              invite();
            }}
          >
            <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
              <label htmlFor="invite-who" className="type-label text-gl-text-secondary">
                Username or email
              </label>
              <Input id="invite-who" value={who} onChange={(e) => setWho(e.target.value)} autoComplete="off" className="type-body-sm" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-role" className="type-label text-gl-text-secondary">
                Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "staff" | "manager")}
                className="h-control border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm focus-ring"
              >
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <Button type="submit" disabled={pending || !who.trim() || openLeft === 0}>
              Send invite
            </Button>
          </form>
          <Hint>
            Someone not on Grindylocks gets an email invite to join with {page.name}. It doesn&apos;t use anyone&apos;s own
            invites. Staff post, comment, host meetups and change hours; managers also edit the page and the team.
          </Hint>
        </Block>
      )}

      <Block id="team-h" title={`On the team · ${members.length}`} first={!manager}>
        <table className="w-full border-collapse type-body-sm">
          <thead>
            <tr className="border-b-2 border-gl-border text-left">
              <th scope="col" className="h-control type-label text-gl-text-secondary">
                Member
              </th>
              <th scope="col" className="type-label text-gl-text-secondary">
                Role
              </th>
              <th scope="col" className="text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const can = rights(m);
              const name = m.username ? `@${m.username}` : "Deleted account";
              return (
                <tr key={m.userId} className="h-row border-t border-gl-border-subtle">
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center bg-gl-text font-display text-sm text-gl-accent">
                        {(m.username ?? "?").slice(0, 2).toUpperCase()}
                      </span>
                      <span className="flex flex-col">
                        <span className="font-semibold">{name}</span>
                        <span className="type-caption text-gl-text-secondary">Since {shortDay(m.joinedAt)}</span>
                      </span>
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {m.role === "owner" ? (
                      <span className="inline-block border-2 border-gl-border px-1.5 py-px text-[11px] leading-[14px] font-bold tracking-[0.08em]">OWNER</span>
                    ) : can.role ? (
                      <>
                        <label htmlFor={`role-${m.userId}`} className="sr-only">
                          Role for {m.username}
                        </label>
                        <select
                          id={`role-${m.userId}`}
                          value={m.role}
                          disabled={pending}
                          onChange={(e) => {
                            const next = e.target.value as "staff" | "manager";
                            run(() => setMemberRole(page.handle, m.userId, next), `${name} is ${next === "manager" ? "a manager" : "staff"} now.`);
                          }}
                          className="h-control border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm focus-ring"
                        >
                          <option value="manager">Manager</option>
                          <option value="staff">Staff</option>
                        </select>
                      </>
                    ) : (
                      <span>{m.role === "manager" ? "Manager" : "Staff"}</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {m.isMe ? (
                      <span className="type-body-sm text-gl-text-secondary">You</span>
                    ) : (
                      can.remove && (
                        <Button variant="danger" disabled={pending} onClick={() => setConfirm({ kind: "remove", member: m })}>
                          Remove
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Block>

      {manager && (teamInvites.length > 0 || handover) && (
        <Block id="waiting-h" title={`Waiting · ${teamInvites.length + (handover ? 1 : 0)}`}>
          <ul className="flex flex-col">
            {handover && (
              <li className="flex min-h-row flex-wrap items-center gap-3 border-t border-gl-border-subtle py-2 first:border-t-0">
                <Icon name="key" />
                <span className="flex flex-1 flex-col">
                  <span className="font-semibold">@{handover.username}</span>
                  <span className="type-caption text-gl-text-secondary">Ownership · waiting for them to accept in the app</span>
                </span>
                {owner && (
                  <Button variant="outline" disabled={pending} onClick={() => run(() => cancelInvite(page.handle, handover.id), "Hand-over cancelled.")}>
                    Cancel hand-over
                  </Button>
                )}
              </li>
            )}
            {teamInvites.map((i) => (
              <li key={i.id} className="flex min-h-row flex-wrap items-center gap-3 border-t border-gl-border-subtle py-2 first:border-t-0">
                <Icon name={i.email ? "mail" : "person_add"} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{i.email ?? `@${i.username}`}</span>
                  <span className="type-caption text-gl-text-secondary">
                    {i.role === "manager" ? "Manager" : "Staff"} · {i.email ? `email invite · expires ${until(i.expiresAt)}` : `invited ${ago(i.createdAt)}`}
                  </span>
                </span>
                <Button variant="outline" disabled={pending} onClick={() => run(() => cancelInvite(page.handle, i.id), "Invite cancelled.")}>
                  Cancel invite
                </Button>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {manager && (
        <Block id="blocked-h" title={`Blocked by ${page.name} · ${blocked.length}`}>
          {blocked.length > 0 && (
            <ul className="flex flex-col">
              {blocked.map((b) => (
                <li key={b.userId} className="flex min-h-row flex-wrap items-center gap-3 border-t border-gl-border-subtle py-2 first:border-t-0">
                  <span className="flex flex-1 flex-col">
                    <span className="font-semibold">{b.username ? `@${b.username}` : "Deleted account"}</span>
                    <span className="type-caption text-gl-text-secondary">
                      Blocked{b.blockedBy ? ` by @${b.blockedBy}` : ""} · {shortDay(b.blockedAt)}
                    </span>
                  </span>
                  <Button variant="outline" disabled={pending} onClick={() => run(() => unblock(page.handle, b.userId), `${b.username ? `@${b.username}` : "They"} can follow and comment again.`)}>
                    Unblock
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Hint>Block someone from a row in the Inbox in the app. They aren&apos;t told either way.</Hint>
        </Block>
      )}

      {owner && (
        <Block id="owner-h" title="Owner only">
          <Button variant="outline" className="self-start" disabled={pending || members.length < 2} onClick={() => setConfirm({ kind: "transfer" })}>
            Transfer ownership…
          </Button>
          <Hint>
            The new owner has to accept. Only the owner can remove a manager. Keep at least two people on the team so{" "}
            {page.name} can&apos;t get locked out.
          </Hint>
        </Block>
      )}

      {!manager && (
        <Hint>
          Managers and the owner invite people and change roles. Ask one of them if someone should join or leave.
        </Hint>
      )}

      <Dialog
        open={confirm?.kind === "remove"}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title={confirm?.kind === "remove" ? `Remove @${confirm.member.username ?? "them"}?` : "Remove"}
        description={`They can't post or comment as ${page.name} any more, and they're told in the app.`}
      >
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
            Keep them
          </Button>
          <Button
            variant="danger-solid"
            disabled={pending}
            onClick={() => {
              if (confirm?.kind !== "remove") return;
              const m = confirm.member;
              run(() => removeMember(page.handle, m.userId), `@${m.username ?? "They"} removed from the team.`, () => setConfirm(null));
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirm?.kind === "transfer"}
        onOpenChange={(o) => !o && !pending && setConfirm(null)}
        title="Transfer ownership"
        description={`Pick who should own ${page.name}. They accept in the app; until then nothing changes. Once they do, you become a manager.`}
      >
        <label htmlFor="new-owner" className="type-label text-gl-text-secondary">
          New owner
        </label>
        <select
          id="new-owner"
          value={newOwner}
          onChange={(e) => setNewOwner(e.target.value)}
          className="h-control border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm focus-ring"
        >
          <option value="">Pick someone on the team</option>
          {members
            .filter((m) => !m.isMe && m.username)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                @{m.username} · {m.role === "manager" ? "Manager" : "Staff"}
              </option>
            ))}
        </select>
        {status?.error && confirm?.kind === "transfer" && (
          <p role="alert" className="type-body-sm text-gl-danger">
            {status.text}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setConfirm(null)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || !newOwner}
            onClick={() => {
              const m = members.find((x) => x.userId === newOwner);
              run(() => offerOwnership(page.handle, newOwner), `Hand-over sent. @${m?.username} accepts it in the app.`, () => {
                setConfirm(null);
                setNewOwner("");
              });
            }}
          >
            Send hand-over
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function until(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}
