"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** A sidebar item: the current one is an accent fill, others get surface-raised on hover. */
export function NavLink({ href, icon, children }: { href: string; icon: string; children: React.ReactNode }) {
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
    </Link>
  );
}
