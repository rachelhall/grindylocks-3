import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about the type-* utilities from globals.css, so
// cn("type-body", "type-label") keeps the last one, like any font size.
const twMerge = extendTailwindMerge<"type-style">({
  extend: {
    classGroups: {
      "type-style": [
        { type: ["display-xl", "display", "title", "headline", "body", "body-sm", "label", "caption"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
