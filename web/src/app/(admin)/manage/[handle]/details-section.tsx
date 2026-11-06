"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageStamp } from "@/components/page-card";
import { PageLogo } from "@/components/page-logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { pageKindLine } from "@/lib/page-sections";
import { languageName, MAX_DESCRIPTION, MAX_PAGE_LINKS, PAGE_LANGUAGES } from "@/lib/page-fields";
import type { ManagedPage, PageLanguage } from "@/lib/page-tools";
import { cn } from "@/lib/utils";

import { saveDetails } from "./actions";
import { LogoDialog } from "./logo-dialog";
import { SaveBar } from "./save-bar";
import { Block, Hint } from "./section-shell";

type Texts = Partial<Record<PageLanguage, string>>;

/**
 * Details (mockup: Web · page details): logo, name and handle (read-only:
 * support changes them), the description in each language with a main
 * language, up to three links, and a preview of the page and its Search row.
 * Saves through update_page_details and set_page_description, as the app's
 * Edit page does.
 */
export function DetailsSection({ page }: { page: ManagedPage }) {
  const router = useRouter();
  const [logoOpen, setLogoOpen] = useState(false);
  const [main, setMain] = useState<PageLanguage>(page.mainLanguage);
  const [texts, setTexts] = useState<Texts>(page.descriptions);
  const [shown, setShown] = useState<PageLanguage[]>(() => startingLanguages(page));
  const [tab, setTab] = useState<PageLanguage>(page.mainLanguage);
  const [links, setLinks] = useState<string[]>(page.links);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const changedLanguages = PAGE_LANGUAGES.filter((l) => (texts[l] ?? "").trim() !== (page.descriptions[l] ?? "").trim());
  const linksChanged = clean(links).join("\n") !== page.links.join("\n");
  const changes = [
    ...changedLanguages.map((l) => `description (${languageName[l]})`),
    ...(main !== page.mainLanguage ? ["main language"] : []),
    ...(linksChanged ? ["links"] : []),
  ];

  function discard() {
    setMain(page.mainLanguage);
    setTexts(page.descriptions);
    setShown(startingLanguages(page));
    setTab(page.mainLanguage);
    setLinks(page.links);
    setError(null);
  }

  function save() {
    setError(null);
    if (!(texts[main] ?? "").trim()) return setError(`Write the ${languageName[main]} description, or pick another main language.`);
    startTransition(async () => {
      const result = await saveDetails(page.handle, {
        mainLanguage: main,
        links: clean(links),
        descriptions: changedLanguages.map((l) => ({ locale: l, body: texts[l] ?? "" })),
      });
      if (!result.ok) return setError(result.error);
      setSaved("Saved. The app shows it the next time the page opens.");
      router.refresh();
    });
  }

  const missing = PAGE_LANGUAGES.filter((l) => !shown.includes(l));
  const body = texts[tab] ?? "";
  const previewText = (texts.en ?? "").trim() || (texts[main] ?? "").trim();

  return (
    <>
      <div className="flex flex-wrap items-start gap-10 px-6 pb-6">
        <form className="flex max-w-[720px] min-w-0 flex-[999_1_480px] flex-col" onSubmit={(e) => e.preventDefault()}>
          <Block id="logo-h" title="Logo" first>
            <div className="flex flex-wrap items-center gap-4">
              <PageLogo name={page.name} path={page.logoPath} className="size-24 text-3xl" />
              <div className="flex flex-col items-start gap-2">
                <Button variant="outline" onClick={() => setLogoOpen(true)}>
                  <Icon name="image" />
                  Change logo
                </Button>
                <Hint>PNG, JPEG or WebP. It becomes a 512 px square PNG, and a transparent background stays transparent.</Hint>
              </div>
            </div>
          </Block>

          <Block id="name-h" title="Name and handle">
            <div className="flex flex-wrap gap-6 type-body">
              <span>
                <span className="block type-label text-gl-text-secondary">Name</span>
                <strong>{page.name}</strong>
              </span>
              <span>
                <span className="block type-label text-gl-text-secondary">Handle</span>
                <strong>@{page.handle}</strong>
              </span>
            </div>
            <Hint>
              To change either, <a href="mailto:support@grindylocks.com" className="text-gl-accent-text underline">email support@grindylocks.com</a>.
              An old handle keeps working for 90 days.
            </Hint>
          </Block>

          <Block id="desc-h" title="Description">
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="Languages" className="flex flex-wrap border-2 border-gl-border">
                {[main, ...shown.filter((x) => x !== main)].map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="tab"
                    aria-selected={tab === l}
                    onClick={() => setTab(l)}
                    className={cn(
                      "h-[36px] border-r-2 border-gl-border px-4 type-body-sm font-semibold last:border-r-0 focus-ring",
                      tab === l ? "bg-gl-text font-bold text-gl-surface" : "bg-gl-surface text-gl-text hover:bg-gl-surface-raised",
                    )}
                  >
                    {languageName[l]}
                    {l === main && " · main"}
                  </button>
                ))}
              </div>
              {missing.length > 0 && (
                <label className="relative">
                  <span className="sr-only">Add a language</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const l = e.target.value as PageLanguage;
                      if (!l) return;
                      setShown((s) => PAGE_LANGUAGES.filter((x) => s.includes(x) || x === l));
                      setTab(l);
                    }}
                    className="h-control border-2 border-dashed border-gl-text-secondary bg-transparent px-3 type-body-sm font-semibold focus-ring"
                  >
                    <option value="">+ Add a language</option>
                    {missing.map((l) => (
                      <option key={l} value={l}>
                        {languageName[l]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <label htmlFor="desc" className="type-label text-gl-text-secondary">
              Description in {languageName[tab]}
            </label>
            <textarea
              id="desc"
              rows={4}
              maxLength={MAX_DESCRIPTION}
              value={body}
              onChange={(e) => setTexts((t) => ({ ...t, [tab]: e.target.value }))}
              className="resize-y border-2 border-gl-border bg-gl-surface-sunk px-2.5 py-2 type-body text-gl-text focus-ring"
            />
            <div className="flex flex-wrap justify-between gap-3">
              <Hint>People see their own language if you&apos;ve added it, otherwise {languageName[main]}.</Hint>
              <span className="type-body-sm text-gl-text-secondary tabular-nums">
                {body.length} / {MAX_DESCRIPTION}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="main" className="type-body-sm font-semibold">
                Main language
              </label>
              <select
                id="main"
                value={main}
                onChange={(e) => setMain(e.target.value as PageLanguage)}
                className="h-control min-w-40 border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body-sm focus-ring"
              >
                {shown.map((l) => (
                  <option key={l} value={l}>
                    {languageName[l]}
                  </option>
                ))}
              </select>
              {tab !== main && (
                <Button
                  variant="danger"
                  className="ml-auto"
                  onClick={() => {
                    setTexts((t) => ({ ...t, [tab]: "" }));
                    setShown((s) => s.filter((x) => x !== tab));
                    setTab(main);
                  }}
                >
                  Remove {languageName[tab]}
                </Button>
              )}
            </div>
          </Block>

          <Block id="links-h" title="Links">
            <Hint>Up to {MAX_PAGE_LINKS}. Instagram is fine here.</Hint>
            <div className="flex flex-col gap-2">
              {links.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <label htmlFor={`link-${i}`} className="sr-only">
                    Link {i + 1}
                  </label>
                  <Input
                    id={`link-${i}`}
                    value={link}
                    inputMode="url"
                    placeholder="8setstore.com"
                    onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))}
                    className="type-body-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Remove link ${i + 1}`}
                    title={`Remove link ${i + 1}`}
                    onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <Icon name="close" />
                  </Button>
                </div>
              ))}
              {links.length < MAX_PAGE_LINKS && (
                <button
                  type="button"
                  onClick={() => setLinks((ls) => [...ls, ""])}
                  className="inline-flex h-control items-center gap-1.5 self-start border-2 border-dashed border-gl-text-secondary px-3 type-body-sm font-semibold focus-ring hover:bg-gl-surface-raised"
                >
                  <Icon name="add" size={18} />
                  Add a link · {MAX_PAGE_LINKS - links.length} left
                </button>
              )}
            </div>
          </Block>
        </form>

        <aside aria-label="How it looks" className="flex max-w-[400px] min-w-0 flex-[1_1_340px] flex-col gap-3 pt-5">
          <span className="type-label text-gl-text-secondary">How it looks in the app</span>
          <div className="flex flex-col border-2 border-gl-border">
            <div
              className="relative h-[150px] bg-gl-ink"
              style={{ backgroundImage: "radial-gradient(var(--gl-brand-pink) 1.2px, transparent 1.4px)", backgroundSize: "7px 7px" }}
            >
              <span className="absolute top-4 left-4 -rotate-3 bg-gl-pink px-1.5 py-0.5 text-[11px] leading-[14px] font-bold tracking-[0.08em] text-gl-ink uppercase">
                {pageKindLine(page.roles, page.city)}
              </span>
              <PageLogo name={page.name} path={page.logoPath} className="absolute -bottom-7 left-4 size-16 text-2xl" />
            </div>
            <div className="flex flex-col gap-1.5 px-4 pt-9 pb-4">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-display text-2xl leading-[26px] uppercase [text-shadow:2px_2px_0_var(--gl-brand-pink)]">{page.name}</span>
                <PageStamp state={page.state} hasLogo={Boolean(page.logoPath)} />
              </span>
              <span className="type-body-sm text-gl-text-secondary">@{page.handle}</span>
              {previewText && <p className="mt-1 type-body-sm">{previewText}</p>}
              {clean(links).length > 0 && (
                <span className="type-body-sm font-semibold text-gl-accent-text">{clean(links).map(shortLink).join(" · ")}</span>
              )}
            </div>
          </div>
          <span className="pt-2 type-label text-gl-text-secondary">In Search and the @ list</span>
          <div className="flex items-center gap-2.5 border-2 border-gl-border bg-gl-surface-raised px-3 py-2.5">
            <PageLogo name={page.name} path={page.logoPath} className="size-10" />
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 type-body font-bold">
                <span className="truncate">{page.name}</span>
                <PageStamp state={page.state} hasLogo={Boolean(page.logoPath)} />
              </span>
              <span className="type-body-sm text-gl-text-secondary">{pageKindLine(page.roles, null)} · @{page.handle}</span>
            </span>
          </div>
          <Hint>
            English readers see this.
            {main !== "en" && ` ${languageName[main]} readers see the ${languageName[main]} description.`}
          </Hint>
        </aside>
      </div>
      <SaveBar
        changes={changes}
        pending={pending}
        error={error}
        saved={saved && !changes.length ? saved : null}
        onDiscard={discard}
        onSave={save}
      />
      <LogoDialog handle={page.handle} pageName={page.name} open={logoOpen} onOpenChange={setLogoOpen} />
    </>
  );
}

function startingLanguages(page: ManagedPage): PageLanguage[] {
  return PAGE_LANGUAGES.filter((l) => l === page.mainLanguage || (page.descriptions[l] ?? "").trim());
}

function clean(links: string[]) {
  return links.map((l) => l.trim()).filter(Boolean);
}

function shortLink(url: string) {
  const bare = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  const ig = bare.match(/^instagram\.com\/([^/?#]+)/i);
  return ig ? `@${ig[1]}` : bare;
}
