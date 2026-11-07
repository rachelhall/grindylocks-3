import { PageTile } from "@/components/page-card";
import { pageImageUrl } from "@/lib/page-images";
import { cn } from "@/lib/utils";

/**
 * A page's logo in a square outlined frame, or the ink first-letter tile
 * when it has none. Logos keep their transparency, so the frame shows the
 * raised paper behind them.
 */
export function PageLogo({ name, path, className }: { name: string; path: string | null; className?: string }) {
  const url = pageImageUrl(path);
  if (!url) return <PageTile name={name} className={className} />;
  return (
    // Plain <img>: logos are already 512 px PNGs on Supabase's public bucket.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className={cn("size-9 shrink-0 border-2 border-gl-border bg-gl-surface-raised object-contain", className)}
    />
  );
}
