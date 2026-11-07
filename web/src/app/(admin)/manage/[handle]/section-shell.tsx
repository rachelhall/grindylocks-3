import { PageStamp } from "@/components/page-card";
import { Icon } from "@/components/ui/icon";

/**
 * The top of every page section (mockups: Web · page details and the rest):
 * the page's name in a label with its stamp, the section title, and one line
 * on what it holds and who can change it. Archived and suspended pages get a
 * notice, since the database refuses their changes.
 */
export function SectionHeader({
  pageName,
  state,
  hasLogo,
  title,
  intro,
  archived,
  suspended,
}: {
  pageName: string;
  state: string;
  hasLogo: boolean;
  title: string;
  intro: string;
  archived: boolean;
  suspended: boolean;
}) {
  return (
    <header className="flex flex-col gap-3 border-b-2 border-gl-border px-6 pt-6 pb-4">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className="type-label text-gl-text-secondary">{pageName}</span>
          <PageStamp state={state} hasLogo={hasLogo} />
        </span>
        <h1 className="type-title">{title}</h1>
        <p className="type-body-sm text-gl-text-secondary">{intro}</p>
      </div>
      {archived && (
        <Notice icon="lock">
          {pageName} is an archive now, so its page can&apos;t be changed. Email support@grindylocks.com if that&apos;s a
          mistake.
        </Notice>
      )}
      {suspended && !archived && (
        <Notice icon="block">
          {pageName} is suspended, so changes are paused. The owner has the details in the app.
        </Notice>
      )}
    </header>
  );
}

export function Notice({ icon, tone = "neutral", children }: { icon: string; tone?: "neutral" | "warning"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "warning" ? "note" : undefined}
      className={
        tone === "warning"
          ? "flex items-start gap-2 border-2 border-gl-warning px-3 py-2 type-body-sm"
          : "flex items-start gap-2 border-2 border-gl-border bg-gl-surface-raised px-3 py-2 type-body-sm"
      }
    >
      <Icon name={icon} size={18} className={tone === "warning" ? "mt-px shrink-0 text-gl-warning" : "mt-px shrink-0"} />
      <span>{children}</span>
    </p>
  );
}

/** A section staff can't use: the lock from the sidebar, said plainly. */
export function Locked({ section }: { section: string }) {
  return (
    <div className="flex max-w-content flex-col gap-2 px-6 py-8">
      <p className="flex items-center gap-2 type-body">
        <Icon name="lock" />
        Managers and the owner can change {section.toLowerCase()}.
      </p>
      <p className="type-body-sm text-gl-text-secondary">
        Staff can change hours and closures, and see the team and the inbox. Ask a manager if something here needs
        fixing.
      </p>
    </div>
  );
}

/** A titled block inside a section's form, divided by a hairline like the boards. */
export function Block({ id, title, aside, children, first }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode; first?: boolean }) {
  return (
    <section aria-labelledby={id} className={first ? "flex flex-col gap-3 py-5" : "flex flex-col gap-3 border-t border-gl-border-subtle py-5"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="type-headline">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Hint({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p id={id} className="type-body-sm text-gl-text-secondary">
      {children}
    </p>
  );
}
