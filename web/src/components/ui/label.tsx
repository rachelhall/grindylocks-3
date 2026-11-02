import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** A field label in the `label` type style (uppercase, text-secondary). */
function Label({ className, ...props }: ComponentProps<"label">) {
  return <label data-slot="label" className={cn("type-label text-gl-text-secondary", className)} {...props} />;
}

export { Label };
