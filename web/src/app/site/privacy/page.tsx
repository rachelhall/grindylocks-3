import type { Metadata } from "next";
import Link from "next/link";

import { SUPPORT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: { absolute: "Privacy policy · Grindylocks" },
  description: "What Grindylocks collects, why, who helps run it, and how to get a copy of your data or delete your account.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://grindylocks.com/privacy" },
};

/** The date at the top; change it whenever the policy changes. */
const UPDATED = "November 2, 2026";

/** Side gutter matches the homepage; text stays at a readable measure. */
const WRAP = "mx-auto w-full max-w-[760px] px-[clamp(16px,5vw,48px)]";

function Mail() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-gl-accent-text underline underline-offset-4">
      {SUPPORT_EMAIL}
    </a>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="type-title">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="m-0 flex list-disc flex-col gap-2 pl-5 type-body">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * grindylocks.com/privacy: the privacy policy for the app and the website.
 * Served at /privacy on grindylocks.com and at /site/privacy on the admin's
 * hosts (src/proxy.ts). The app's Settings links here (appConfig.privacyPolicyUrl).
 *
 * Plain language on purpose. When the app starts collecting something new,
 * or adds a service that handles people's data, update this page first.
 */
export default function PrivacyPage() {
  return (
    <div className="bg-gl-surface text-gl-text">
      <header className="grain relative overflow-hidden bg-gl-ink text-gl-paper [--gl-focus:var(--gl-brand-paper)]">
        <div aria-hidden="true" className="halftone absolute inset-0" />
        <div className={`${WRAP} relative flex flex-col gap-4 py-[clamp(40px,7vw,80px)]`}>
          <Link href="/" className="self-start font-display text-lg leading-5 uppercase text-gl-paper">
            Grindylocks
          </Link>
          <h1 className="font-display text-[clamp(36px,7vw,64px)] leading-none uppercase">Privacy policy</h1>
          <p className="type-body text-gl-paper/75">Last updated {UPDATED}</p>
        </div>
      </header>

      <main className={`${WRAP} flex flex-col gap-10 py-[clamp(40px,7vw,80px)]`}>
        <p className="type-body">
          Grindylocks is a skatepark directory and clip feed for bladers, quad skaters and skateboarders, made by
          Rachel Hall in San Diego. It&apos;s a small, invite-only beta. This page explains what the app and
          grindylocks.com collect, why, who helps run them, and what you can do about it. Questions go to <Mail />,
          and a real person reads every email.
        </p>

        <Section title="The short version">
          <List
            items={[
              "No ads, no selling or renting your data, and no ad or analytics trackers.",
              "We keep what you post and what you tell us in your profile, so the app can show it to other members.",
              "Your location stays on your phone. We use it to show parks near you and never save it.",
              "Crash reports don't carry your name, email or anything you posted.",
              "You can get a copy of your data or delete your account from Settings at any time.",
            ]}
          />
        </Section>

        <Section title="What we collect">
          <h3 className="type-body font-semibold">When you sign up</h3>
          <List
            items={[
              "Your email address, to send sign-in codes and the occasional account email. It's never shown to other members.",
              "That you said you're 16 or older. We don't ask for or save your birthday.",
              "Your profile: username, photo, bio, disciplines, home city and home park, and your settings (like a private account or leaving regulars lists).",
              "Who invited you, and the invites you send.",
            ]}
          />
          <h3 className="type-body font-semibold">When you use the app</h3>
          <List
            items={[
              "What you post: photos, clips, captions, and the park, obstacle, people and filmer you tag.",
              "Comments, likes, follows, blocks and saved parks. Like counts are hidden from everyone, including you.",
              "Park fixes, obstacle suggestions and park photos you send, and reports you make about posts, comments or people.",
              "Notifications, and a push token for your phone if you turn on push notifications.",
              "When you were last active, so regulars lists and “someone new nearby” stay current.",
            ]}
          />
          <h3 className="type-body font-semibold">From your phone</h3>
          <List
            items={[
              "Your location, only while the app is open and only if you allow it. It's used on your phone to center the map and find parks near you. It isn't sent to us or saved.",
              "Photos and clips you pick from your library to post. The app can't see the rest of your library.",
              "Crash reports and basic performance data (device model, system version, app version and what went wrong), so we can fix bugs. They don't include your name, email, posts or location.",
            ]}
          />
          <h3 className="type-body font-semibold">On grindylocks.com</h3>
          <List
            items={[
              "If you request access: your email, city and disciplines, so we can send an invite when there's a spot near you.",
              "No cookies or trackers on the public pages. The admin site uses a sign-in cookie for role holders only.",
            ]}
          />
        </Section>

        <Section title="Who sees what">
          <List
            items={[
              "Grindylocks is members-only: you have to sign in to see anything in the app.",
              "Your profile and posts are visible to other members. With a private account, only people you approve see your posts.",
              "A post tagged at a park shows on that park's page. Regulars lists show people whose home park it is or who post there a lot; you can leave them in Settings, and private accounts never appear in them.",
              "People you block can't see your profile, posts or comments, and you can't see theirs.",
              "Park and city admins review reports and park fixes for their area. The people you report aren't told who reported them.",
            ]}
          />
        </Section>

        <Section title="Services that help run Grindylocks">
          <p className="type-body">
            These companies store or process data for us, only to run the app and the website. Your data may be
            stored and processed in the United States.
          </p>
          <List
            items={[
              "Supabase: the database, sign-in and photo storage (US).",
              "Cloudflare Stream: storing and playing clips.",
              "Resend: sending sign-in codes and account emails.",
              "Expo, Apple and Google: delivering push notifications and app updates.",
              "Sentry: crash reports.",
              "Vercel: hosting grindylocks.com and the admin site.",
            ]}
          />
          <p className="type-body">
            We share data with anyone else only if the law requires it, or to protect someone&apos;s safety.
          </p>
        </Section>

        <Section title="Your choices">
          <List
            items={[
              "Get a copy of your data: Settings › Help and legal › Get a copy of my data. We email it to you as one file.",
              "Delete your account: Settings › Delete account. Your profile, follows and saved parks are deleted. You choose whether your posts are deleted too or stay up as “deleted user”, so clips you filmed with others aren't lost.",
              "Change or delete a post or comment at any time.",
              "Turn push notifications on or off by type in Settings, or all of them in your phone's settings.",
              "Make your account private, or leave regulars lists, in Settings.",
              <>
                For anything else, including correcting something or asking what we hold, email <Mail />.
              </>,
            ]}
          />
        </Section>

        <Section title="How long we keep it">
          <p className="type-body">
            We keep your data while your account is open. When you delete your account, it&apos;s removed as
            described above. Records of reports and moderation decisions can be kept longer when they&apos;re needed
            to keep the community safe. Invite requests from grindylocks.com are kept until we send an invite or you
            ask us to remove yours.
          </p>
        </Section>

        <Section title="Age">
          <p className="type-body">
            Grindylocks is for people 16 and older. If you think someone under 16 has an account, report them in the
            app or email <Mail />, and we&apos;ll remove the account.
          </p>
        </Section>

        <Section title="Changes">
          <p className="type-body">
            If this policy changes, we&apos;ll update the date at the top. For bigger changes, we&apos;ll tell
            members in the app before they take effect.
          </p>
        </Section>
      </main>

      <footer className="bg-gl-ink text-gl-paper/75 [--gl-focus:var(--gl-brand-paper)]">
        <div className={`${WRAP} flex flex-wrap items-center justify-between gap-4 py-8`}>
          <Link href="/" className="font-display text-lg leading-5 uppercase text-gl-paper">
            Grindylocks
          </Link>
          <span className="type-caption">© 2026 Grindylocks · Beta</span>
        </div>
      </footer>
    </div>
  );
}
