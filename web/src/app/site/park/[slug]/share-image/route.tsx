import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { PARK_TYPE, plural } from "@/lib/park-format";
import { getPark } from "@/lib/public-parks";

/**
 * A park's share image, 1200×630, in the park header's look: ink, the pink
 * halftone fading in from the bottom right, a tilted pink tape and the name
 * in Archivo Black with a pink offset (Mockups canvas › Public · share
 * image). Linked from the park page's og:image at
 * grindylocks.com/park/<slug>/share-image.
 *
 * Always the halftone version for now: the photocopy filter the header puts
 * on photos can't be drawn here, and no park has a photo yet.
 */

const archivoBlack = readFile(join(process.cwd(), "assets/ArchivoBlack-Regular.ttf"));

const INK = "#111111";
const PAPER = "#F2EFE6";
const PINK = "#FF48B0";

/** The halftone as an SVG pattern, fading in towards the bottom right like the header. */
const HALFTONE = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <pattern id="d" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="2.8" fill="${PINK}"/></pattern>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0.3" stop-color="#fff" stop-opacity="0"/><stop offset="0.95" stop-color="#fff" stop-opacity="1"/></linearGradient>
      <mask id="m"><rect width="1200" height="630" fill="url(#g)"/></mask>
    </defs>
    <rect width="1200" height="630" fill="url(#d)" mask="url(#m)"/>
  </svg>`,
).toString("base64")}`;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const park = await getPark(slug);
  if (!park) return new Response("Not found", { status: 404 });

  const facts = [
    PARK_TYPE[park.park_type],
    park.night_lighting ? "Lit" : null,
    park.is_paid === false ? "Free" : park.is_paid ? "Paid" : null,
    plural(park.obstacles.length, "obstacle"),
  ].filter(Boolean);
  const name = park.display_name;
  const size = name.length > 16 ? 96 : name.length > 11 ? 112 : 128;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          gap: 24,
          padding: "56px 64px",
          backgroundColor: INK,
          backgroundImage: `url(${HALFTONE})`,
          backgroundSize: "1200px 630px",
        }}
      >
        <div style={{ display: "flex" }}>
          <div
            style={{
              background: PINK,
              color: INK,
              fontSize: 24,
              padding: "6px 14px",
              textTransform: "uppercase",
              transform: "rotate(-2deg)",
            }}
          >
            {`${park.metro.name} · ${PARK_TYPE[park.park_type]}`}
          </div>
        </div>
        <div
          style={{
            fontSize: size,
            lineHeight: 0.92,
            color: PAPER,
            textTransform: "uppercase",
            textShadow: `6px 6px 0 ${PINK}`,
            display: "flex",
            flexWrap: "wrap",
          }}
        >
          {name}
        </div>
        <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
          <div style={{ fontSize: 28, color: PAPER }}>{facts.join(" · ")}</div>
          <div style={{ fontSize: 30, color: PAPER, textTransform: "uppercase", textShadow: `3px 3px 0 ${PINK}` }}>Grindylocks</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "Archivo Black", data: await archivoBlack, weight: 400, style: "normal" }],
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
    },
  );
}
