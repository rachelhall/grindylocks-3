import type { Metadata } from "next";

import { RequestForm } from "./request-form";

export const metadata: Metadata = {
  title: { absolute: "Grindylocks · skatepark directory and clip feed (beta)" },
  description:
    "Find parks, post clips, meet the locals. Grindylocks is in an invite-only beta in San Diego, Nashville, Copenhagen, Atlanta, Clemson and Asheville.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "Grindylocks (beta)",
    description: "Find parks, post clips, meet the locals. Invite-only beta in six cities.",
    url: "https://grindylocks.com",
    siteName: "Grindylocks",
    type: "website",
  },
};

/** The beta cities, as on the app's welcome screen (Roadmap › Who it's for). */
const CITIES = [
  { name: "San Diego", tape: "pink", tilt: "-rotate-3" },
  { name: "Nashville", tape: "paper", tilt: "rotate-2" },
  { name: "Copenhagen", tape: "paper", tilt: "rotate-1" },
  { name: "Atlanta", tape: "pink", tilt: "-rotate-2" },
  { name: "Clemson", tape: "pink", tilt: "rotate-2" },
  { name: "Asheville", tape: "paper", tilt: "-rotate-[1.5deg]" },
] as const;

const FEATURES = [
  {
    title: "Park pages",
    body: "Hours and discipline sessions, whether it's open now, lights, fees, helmet rules, surface and every obstacle, checked by local admins with a last-verified date.",
  },
  {
    title: "Tagged clips",
    body: "Post photos and clips up to 60 seconds. Tag the park, the obstacle, who's skating and who filmed, so every ledge and bowl gets its own feed.",
  },
  {
    title: "Profiles & regulars",
    body: "Your disciplines, home park and clips you're in or filmed. See who skates your park, and say hi when someone new lands in town.",
  },
] as const;

/** Side gutter: 16px on phones, growing to 48px. */
const WRAP = "mx-auto w-full max-w-[1200px] px-[clamp(16px,5vw,48px)]";

/**
 * grindylocks.com: what the app is, that it's a beta, and a form to ask for
 * an invite. Served at `/` on grindylocks.com (src/proxy.ts) and at `/site`
 * on the admin's hosts. Mockup: Marketing site › grindylocks.com · home (beta).
 *
 * Ink and pink stay printed in both themes (hero, beta band, cities, footer);
 * the paper sections follow the device theme like the rest of the system.
 */
export default function SitePage() {
  return (
    <div className="bg-gl-surface text-gl-text">
      {/* Hero, on ink. Focus rings turn paper here. */}
      <div className="grain relative overflow-hidden bg-gl-ink text-gl-paper [--gl-focus:var(--gl-brand-paper)]">
        <div aria-hidden="true" className="halftone absolute inset-0" />

        <header className={`${WRAP} relative flex flex-wrap items-center justify-between gap-4 py-5`}>
          <a href="#top" className="flex items-center gap-3 text-gl-paper no-underline">
            <span className="font-display text-2xl leading-7 uppercase [text-shadow:2px_2px_0_var(--gl-brand-pink)]">
              Grindylocks
            </span>
            <span className="-rotate-3 bg-gl-pink px-2 py-0.5 type-label text-gl-ink">Beta</span>
          </a>
          <nav aria-label="Main" className="flex items-center gap-2">
            <a
              href="#request"
              className="flex h-control items-center px-3 text-[15px] font-bold text-gl-paper underline decoration-gl-pink decoration-2 underline-offset-4"
            >
              Request access
            </a>
            <a
              href="/sign-in"
              className="flex h-control items-center border-2 border-gl-paper px-4 text-[15px] font-bold text-gl-paper no-underline transition-colors duration-100 hover:bg-gl-paper hover:text-gl-ink"
            >
              Admin log in
            </a>
          </nav>
        </header>

        <section
          id="top"
          className={`${WRAP} relative flex flex-col items-start gap-6 pt-[clamp(40px,8vw,96px)] pb-[clamp(48px,8vw,96px)]`}
        >
          <span className="-rotate-2 bg-gl-paper px-2.5 py-1 type-label tracking-[0.08em] text-gl-ink">
            Invite-only beta · 6 cities
          </span>
          <h1 className="max-w-[900px] font-display text-[clamp(40px,7vw,88px)] leading-[0.95] tracking-[-0.02em] uppercase [text-shadow:4px_4px_0_var(--gl-brand-pink)]">
            Find parks. Post clips. Meet the locals.
          </h1>
          <p className="max-w-[620px] text-xl leading-[30px]">
            Grindylocks is a skatepark directory and clip feed, built for bladers first, with quad skaters and
            skateboarders along for the ride.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href="#request"
              className="flex h-14 items-center border-2 border-gl-pink bg-gl-pink px-6 text-[17px] font-bold text-gl-ink no-underline hover:shadow-[3px_3px_0_var(--gl-brand-paper)] active:shadow-none"
            >
              Request access
            </a>
            {/* Not a link until the App Store listing exists. */}
            <div className="flex h-14 flex-col justify-center border-2 border-gl-paper/30 px-5 text-gl-paper/75">
              <span className="text-[11px] leading-[14px] font-semibold tracking-[0.08em]">COMING SOON TO THE</span>
              <span className="text-lg leading-[22px] font-bold">App Store</span>
            </div>
          </div>
        </section>
      </div>

      {/* The beta, said plainly. Pink with ink in both themes. */}
      <section aria-label="Beta notice" className="border-y-2 border-gl-ink bg-gl-pink text-gl-ink">
        <div className={`${WRAP} flex flex-wrap items-center gap-x-6 gap-y-3 py-5`}>
          <h2 className="font-display text-[22px] leading-6 uppercase">Heads up: it&apos;s a beta</h2>
          <p className="flex-[1_1_420px] type-body">
            Sign-up is invite-only while we test with a small crew of skaters. Things will break and change. Testers
            install through TestFlight for now; the App Store listing comes later.
          </p>
        </div>
      </section>

      <section className={`${WRAP} flex flex-col gap-8 pt-[clamp(48px,8vw,96px)] pb-8`}>
        <div className="flex flex-col gap-2">
          <span className="type-label tracking-[0.08em] text-gl-text-secondary">What&apos;s in the beta</span>
          <h2 className="font-display text-[clamp(28px,4vw,40px)] leading-none uppercase">Three things, done properly</h2>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          {FEATURES.map((f, i) => (
            <article key={f.title} className="flex flex-col gap-3 border-2 border-gl-border bg-gl-surface-raised p-6">
              <span className="self-start bg-gl-accent px-2 py-0.5 type-label text-gl-on-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="type-title">{f.title}</h3>
              <p className="type-body text-gl-text-secondary">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={`${WRAP} pt-8 pb-[clamp(48px,8vw,96px)]`}>
        <div className="flex flex-wrap items-center gap-x-12 gap-y-6 border-2 border-gl-border bg-gl-ink p-[clamp(24px,4vw,40px)] text-gl-paper">
          <div className="flex flex-[1_1_280px] flex-col gap-2">
            <span className="type-label tracking-[0.08em] text-gl-paper/75">Beta cities</span>
            <h2 className="font-display text-[28px] leading-[30px] uppercase">Skating now in</h2>
            <p className="type-body-sm text-gl-paper/75">
              Not on the list? Request access anyway; it helps us pick the next city.
            </p>
          </div>
          <ul className="m-0 flex flex-[2_1_420px] list-none flex-wrap items-center gap-x-2.5 gap-y-3.5 p-0">
            {CITIES.map((c) => (
              <li
                key={c.name}
                className={`${c.tilt} px-3 py-1.5 font-display text-xl leading-6 whitespace-nowrap uppercase text-gl-ink ${
                  c.tape === "pink" ? "bg-gl-pink" : "bg-gl-paper"
                }`}
              >
                {c.name}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="request" className="scroll-mt-4 border-t-2 border-gl-border bg-gl-surface-sunk">
        <div className={`${WRAP} flex flex-wrap items-start gap-x-16 gap-y-8 py-[clamp(48px,8vw,96px)]`}>
          <div className="flex flex-[1_1_320px] flex-col gap-3">
            <span className="type-label tracking-[0.08em] text-gl-text-secondary">Get an invite</span>
            <h2 className="font-display text-[clamp(32px,5vw,48px)] leading-none uppercase">Request access</h2>
            <p className="type-body text-gl-text-secondary">
              We&apos;re letting skaters in a few at a time, city by city. Leave your email and we&apos;ll send an
              invite link when there&apos;s a spot near you.
            </p>
            <p className="type-body-sm text-gl-text-secondary">
              Know someone already on Grindylocks? Ask them for an invite link; it&apos;s quicker.
            </p>
          </div>
          <div className="relative flex-[1_1_400px] border-2 border-gl-border bg-gl-surface-raised p-6">
            <RequestForm />
          </div>
        </div>
      </section>

      <footer className="bg-gl-ink text-gl-paper/75 [--gl-focus:var(--gl-brand-paper)]">
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-4 py-8`}>
          <span className="font-display text-lg leading-5 uppercase text-gl-paper">Grindylocks</span>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1 type-body-sm">
            <a href="/sign-in" className="text-gl-paper underline underline-offset-4">
              Admin log in
            </a>
          </nav>
          <span className="type-caption">© 2026 Grindylocks · Beta</span>
        </div>
      </footer>
    </div>
  );
}
