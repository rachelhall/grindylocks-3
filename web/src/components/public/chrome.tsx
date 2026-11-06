import Link from "next/link";
import type { ReactNode } from "react";

import { PRIVACY_PATH, SUPPORT_EMAIL } from "@/lib/contact";

/**
 * The frame around the public park pages (Nov 6; Mockups canvas › Marketing
 * site › Public pages (web)): an ink top bar with the wordmark and Request
 * access, and the ink footer. Ink stays printed in both themes, like the
 * homepage; the paper sections follow the device theme.
 */

/** Side gutter: 16px on phones, growing to 48px. Same as the homepage. */
export const WRAP = "mx-auto w-full max-w-[1200px] px-[clamp(16px,4vw,48px)]";

export function TopBar() {
  return (
    <header className="bg-gl-ink text-gl-paper [--gl-focus:var(--gl-brand-paper)]">
      <div className={`${WRAP} flex items-center justify-between gap-3 py-3.5`}>
        <Link href="/" className="flex items-center gap-2.5 text-gl-paper no-underline">
          <span className="font-display text-lg leading-7 uppercase [text-shadow:2px_2px_0_var(--gl-brand-pink)] sm:text-xl md:text-2xl">
            Grindylocks
          </span>
          <span className="-rotate-3 bg-gl-pink px-2 py-0.5 type-label text-gl-ink">Beta</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-2">
          <Link
            href="/parks"
            className="hidden h-12 items-center px-3 text-[15px] font-bold text-gl-paper no-underline sm:flex"
          >
            Parks
          </Link>
          <a
            href="#request"
            className="flex h-12 items-center border-2 border-gl-pink bg-gl-pink px-3 text-[15px] font-bold whitespace-nowrap text-gl-ink no-underline transition-shadow duration-100 hover:shadow-[3px_3px_0_var(--gl-brand-paper)] sm:px-3.5"
          >
            Request access
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="bg-gl-ink text-gl-paper/75 [--gl-focus:var(--gl-brand-paper)]">
      <div className={`${WRAP} flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-7`}>
        <span className="font-display text-lg leading-5 text-gl-paper uppercase">Grindylocks</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1 type-body-sm">
          <Link href="/parks" className="text-gl-paper underline underline-offset-4">
            All parks
          </Link>
          <Link href={PRIVACY_PATH} className="text-gl-paper underline underline-offset-4">
            Privacy policy
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-gl-paper underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>
        </nav>
        <span className="type-caption">© 2026 Grindylocks · Beta · Map data © OpenStreetMap contributors</span>
      </div>
    </footer>
  );
}

/** Ink header with the park header's halftone (or a photocopied photo), tape and a pink-offset title. */
export function InkHeader({
  breadcrumb,
  tape,
  title,
  lead,
  photo,
  big = false,
}: {
  breadcrumb: { href?: string; label: string }[];
  tape: string;
  title: string;
  lead?: ReactNode;
  photo?: string | null;
  big?: boolean;
}) {
  return (
    <section className="grain relative flex overflow-hidden bg-gl-ink text-gl-paper [--gl-focus:var(--gl-brand-paper)]">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a public Storage URL, already sized on upload
        <img src={photo} alt="" className="xerox absolute inset-0 size-full object-cover" />
      ) : null}
      <div aria-hidden="true" className="halftone-header absolute inset-0" />
      <div className={`${WRAP} relative flex flex-col justify-between gap-6 pt-5 pb-7 ${big ? "min-h-[300px] md:min-h-[360px]" : ""}`}>
        <nav aria-label="Breadcrumb" className="type-body-sm">
          <ol className="m-0 flex flex-wrap gap-1.5 p-0">
            {breadcrumb.map((b, i) => (
              <li key={b.label} className="flex list-none gap-1.5">
                {i > 0 ? <span aria-hidden="true">/</span> : null}
                {b.href ? (
                  <Link href={b.href} className="text-gl-paper underline underline-offset-4">
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page">{b.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex flex-col items-start gap-3">
          <span className="-rotate-2 bg-gl-pink px-2 py-1 type-label text-gl-ink uppercase">{tape}</span>
          <h1 className="font-display text-[clamp(40px,7vw,88px)] leading-[0.95] tracking-[-0.01em] text-gl-paper uppercase [text-shadow:3px_3px_0_var(--gl-brand-pink)]">
            {title}
          </h1>
          {lead ? <div className="max-w-[640px] type-body text-gl-paper md:text-lg">{lead}</div> : null}
        </div>
      </div>
    </section>
  );
}

/** The request card beside or under the page, with the city filled in. */
export function RequestCard({ children, title = "Get on Grindylocks" }: { children: ReactNode; title?: string }) {
  return (
    <section id="request" aria-labelledby="request-title" className="flex scroll-mt-4 flex-col gap-3.5 border-2 border-gl-border bg-gl-surface-raised p-5 md:p-6">
      <h2 id="request-title" className="type-title">
        {title}
      </h2>
      <p className="type-body-sm text-gl-text-secondary">
        Grindylocks is an invite-only beta for skaters. Leave your email and we&apos;ll send an invite link when there&apos;s a
        spot in your city.
      </p>
      {children}
    </section>
  );
}

export function SectionTitle({ id, children, count }: { id?: string; children: ReactNode; count?: number }) {
  return (
    <h2 id={id} className="type-title">
      {children}
      {count !== undefined ? <span className="text-gl-text-secondary"> {count}</span> : null}
    </h2>
  );
}
