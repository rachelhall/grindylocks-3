import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn's Button on Base UI, restyled to design/web.md:
 * - primary: accent fill, ink outline, a 2px printed offset on hover that
 *   goes away when pressed. At most one per screen or pane.
 * - outline: surface fill that inverts on hover.
 * - danger: outlined in `danger` for moderation and destructive actions;
 *   danger-solid is the confirm button inside their dialogs.
 * Controls are 40px (control-web) tall at a desk.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap select-none",
    "h-control border-2 px-3.5 type-body-sm font-semibold",
    "transition-[background-color,color,box-shadow] duration-100",
    "focus-ring",
    "data-disabled:cursor-not-allowed data-disabled:opacity-50",
    "[&_.material-symbols-sharp]:text-[20px]",
  ],
  {
    variants: {
      variant: {
        primary: [
          "border-gl-border bg-gl-accent text-gl-on-accent",
          "hover:not-data-disabled:shadow-[2px_2px_0_var(--gl-border)] active:not-data-disabled:shadow-none",
        ],
        outline: [
          "border-gl-border bg-gl-surface text-gl-text",
          "hover:not-data-disabled:bg-gl-text hover:not-data-disabled:text-gl-surface",
        ],
        danger: [
          "border-gl-danger bg-gl-surface text-gl-danger",
          "hover:not-data-disabled:bg-gl-danger hover:not-data-disabled:text-gl-on-danger",
        ],
        "danger-solid": "border-gl-danger bg-gl-danger text-gl-on-danger",
        link: "h-auto border-0 px-0 text-gl-accent-text underline underline-offset-4 hover:no-underline",
      },
      size: {
        default: "",
        icon: "w-control px-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

type ButtonProps = ComponentProps<typeof BaseButton> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <BaseButton data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { Button, buttonVariants };
