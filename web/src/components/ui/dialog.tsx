"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * shadcn's Dialog on Base UI, restyled to design/web.md: surface-raised,
 * outlined in border, over the overlay. No shadow, no radius. Controlled:
 * pass `open` and `onOpenChange`.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-gl-overlay" />
        <BaseDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto",
            "border-2 border-gl-border bg-gl-surface-raised p-6 text-gl-text focus-ring",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <BaseDialog.Title className="type-headline">{title}</BaseDialog.Title>
            <BaseDialog.Close
              render={<Button variant="outline" size="icon" aria-label="Close" title="Close" />}
            >
              <Icon name="close" />
            </BaseDialog.Close>
          </div>
          {description && (
            <BaseDialog.Description className="type-body-sm text-gl-text-secondary">{description}</BaseDialog.Description>
          )}
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
