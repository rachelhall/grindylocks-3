import { cn } from "@/lib/utils";

/**
 * A Material Symbols Sharp icon (weight 600), the app's set. Replaces the
 * Lucide icons shadcn components ship with. Decorative by default: give the
 * button or link around it an accessible name (and a tooltip if icon-only).
 */
export function Icon({ name, className, size = 20 }: { name: string; className?: string; size?: number }) {
  return (
    <span aria-hidden="true" className={cn("material-symbols-sharp", className)} style={{ fontSize: size }}>
      {name}
    </span>
  );
}
