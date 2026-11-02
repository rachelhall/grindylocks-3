import { Input as BaseInput } from "@base-ui/react/input";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's Input on Base UI, restyled to design/web.md: surface-sunk fill,
 * ink outline at stroke-rule, text-secondary placeholder (text-muted fails on
 * surface-sunk), 40px tall.
 */
function Input({ className, ...props }: ComponentProps<typeof BaseInput>) {
  return (
    <BaseInput
      data-slot="input"
      className={cn(
        "h-control w-full min-w-0 border-2 border-gl-border bg-gl-surface-sunk px-2.5 type-body text-gl-text",
        "placeholder:text-gl-text-secondary focus-ring",
        "aria-invalid:border-gl-danger",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
