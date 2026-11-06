"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { PageStamp, PageTile, pageType } from "@/components/page-card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { LOGO_TYPES, toLogoPng } from "@/lib/logo-png";
import { cn } from "@/lib/utils";

import { type ClaimablePageOption, findClaimablePages, sendClaimInvite } from "./actions";
import { ErrorLine, inputClass } from "./pane";
import { useQueue } from "./queue-view";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function expiryLabel(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return `In 7 days · ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * Send claim invite (mockup: Admin · claim invite), from the Claims tab's
 * header. For someone Rachel has already checked after outreach: opening the
 * invite makes them the page's owner, with no claim to review.
 */
export function ClaimInviteButton() {
  const { done } = useQueue();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ClaimablePageOption[]>([]);
  const [picked, setPicked] = useState<ClaimablePageOption | null>(null);
  const [email, setEmail] = useState("");
  const [logo, setLogo] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await findClaimablePages(q);
      if (live) setOptions(found);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, open]);

  useEffect(() => () => {
    if (logo) URL.revokeObjectURL(logo.url);
  }, [logo]);

  function reset() {
    setQ("");
    setPicked(null);
    setEmail("");
    setLogo(null);
    setError(null);
  }

  async function pickLogo(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!LOGO_TYPES.test(file.type)) {
      setError("Use a PNG (best, keeps transparency), JPEG or WebP.");
      return;
    }
    try {
      const blob = await toLogoPng(file);
      setLogo({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setError("Couldn't read that image. Try another file.");
    }
  }

  function send() {
    if (!picked) return setError("Pick a page.");
    if (!EMAIL.test(email.trim())) return setError("That doesn't look like an email address.");
    const form = new FormData();
    form.set("page", picked.id);
    form.set("email", email.trim());
    if (logo) form.set("logo", new File([logo.blob], "logo.png", { type: "image/png" }));
    startTransition(async () => {
      const result = await sendClaimInvite(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const name = picked.name;
      const to = email.trim();
      setOpen(false);
      reset();
      done(`Claim invite for ${name} sent to ${to}.`);
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Icon name="send" />
        Send claim invite
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return;
          setOpen(o);
          if (!o) reset();
        }}
        title="Send claim invite"
        description="For someone you've already checked, after outreach. Opening it makes them the page's owner, with no claim to review."
        className="w-[min(560px,calc(100vw-32px))]"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-page" className="type-label text-gl-text-secondary">
            Page
          </label>
          {picked ? (
            <div className="flex items-center gap-3 border-2 border-gl-border bg-gl-surface p-2.5">
              <PageTile name={picked.name} />
              <div className="flex min-w-0 flex-col">
                <span className="type-body-sm font-semibold">{picked.name}</span>
                <span className="type-caption text-gl-text-secondary">
                  {[pageType(picked.roles), picked.place, `@${picked.handle}`, `${picked.followers} followers`].filter(Boolean).join(" · ")}
                </span>
              </div>
              <span className="ml-auto flex items-center gap-2">
                <PageStamp state="unofficial" hasLogo={false} />
                <Button variant="outline" size="icon" aria-label="Pick another page" title="Pick another page" onClick={() => setPicked(null)}>
                  <Icon name="close" />
                </Button>
              </span>
            </div>
          ) : (
            <>
              <div className="relative">
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-gl-text-secondary" />
                <input
                  id="invite-page"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name or handle"
                  autoComplete="off"
                  className={cn(inputClass, "w-full pl-9")}
                />
              </div>
              <ul role="listbox" aria-label="Pages without an owner" className="max-h-56 overflow-y-auto border-2 border-gl-border bg-gl-surface">
                {options.length ? (
                  options.map((p) => (
                    <li key={p.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        onClick={() => setPicked(p)}
                        className="flex w-full items-center gap-3 border-b border-gl-border-subtle p-2.5 text-left last:border-b-0 hover:bg-gl-surface-raised focus-ring"
                      >
                        <PageTile name={p.name} className="size-8 text-sm" />
                        <span className="flex min-w-0 flex-col">
                          <span className="type-body-sm font-semibold">{p.name}</span>
                          <span className="type-caption text-gl-text-secondary">
                            {[pageType(p.roles), p.place, `@${p.handle}`, `${p.followers} followers`].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="p-2.5 type-body-sm text-gl-text-secondary">No page without an owner matches.</li>
                )}
              </ul>
            </>
          )}
          <p className="type-caption text-gl-text-secondary">Only pages without an owner are listed.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-email" className="type-label text-gl-text-secondary">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            className={inputClass}
          />
          <p className="type-caption text-gl-text-secondary">
            If this email already has an account, they sign in with it and become owner. If not, the invite creates the account.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="type-label text-gl-text-secondary">
            Logo <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <div className="flex items-center gap-3">
            {logo && (
              // A local preview of the resized logo.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.url} alt="Logo preview" className="size-16 border-2 border-gl-border bg-gl-surface object-contain" />
            )}
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" />
              {logo ? "Change logo" : "Add the logo they sent"}
            </Button>
            {logo && (
              <Button variant="outline" onClick={() => setLogo(null)}>
                Remove
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                void pickLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <p className="type-caption text-gl-text-secondary">
            Square PNG works best; it&apos;s saved as a 512 px PNG. Without one, they&apos;re asked for it as the last step of signing up. The page stays UNOFFICIAL until it has a logo.
          </p>
        </div>

        <p className="flex items-center justify-between border-t border-gl-border-subtle pt-3 type-body-sm">
          <span className="text-gl-text-secondary">Expires</span>
          <span className="font-semibold">{expiryLabel()}</span>
        </p>

        <ErrorLine error={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !picked || !email.trim()} onClick={send}>
            Send invite
          </Button>
        </div>
      </Dialog>
    </>
  );
}
