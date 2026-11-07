import { cn } from "@/lib/utils";

/**
 * "Grindylocks" in Archivo Black with the tilted pink ADMIN tape, like the
 * park header's tape. `large` is the sign-in screen's brand moment. People
 * who only run pages see PAGES on the tape (`tape`, Nov 6).
 */
export function Wordmark({
  large = false,
  tape = "Admin",
  className,
}: {
  large?: boolean;
  tape?: string;
  className?: string;
}) {
  return (
    // Spans only, so it can sit inside a heading.
    <span className={cn("flex flex-col items-start", large ? "gap-2.5" : "gap-1.5", className)}>
      <span className={large ? "type-display-xl text-gl-pink" : "type-title"}>Grindylocks</span>
      <span className="-rotate-3 bg-gl-pink px-2 py-0.5 type-label text-gl-ink">{tape}</span>
    </span>
  );
}
