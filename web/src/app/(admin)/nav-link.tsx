"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * A sidebar item: the current one is an accent fill, others get surface-raised
 * on hover. `badge` is a count shown on the right (hidden when zero).
 */
export function NavLink({
  href,
  icon,
  badge,
  badgeLabel,
  children,
}: {
  href: string;
  icon: string;
  badge?: number;
  /** What the count means, for screen readers ("9 not invited"). */
  badgeLabel?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex h-control items-center gap-2.5 px-3 type-body-sm font-semibold focus-ring",
        current ? "bg-gl-accent text-gl-on-accent" : "text-gl-text hover:bg-gl-surface-raised",
      )}
    >
      <Icon name={icon} />
      {children}
      {!!badge && (
        <span className="ml-auto bg-gl-text px-[7px] py-0.5 text-xs leading-4 font-bold text-gl-surface tabular-nums">
          {badge}
          {badgeLabel && <span className="sr-only"> {badgeLabel}</span>}
        </span>
      )}
    </Link>
  );
}
