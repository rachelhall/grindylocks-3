import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Tailwind v4 through Turbopack's CSS loader (Next 16's default setup).
  turbopack: {
    // web/ is its own npm project inside the app's repo: build from here, not
    // from the repo root's lockfile.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The admin is for a handful of signed-in role holders; keep it out of
  // search. The marketing page on grindylocks.com is the one public page.
  async headers() {
    return [
      {
        source: "/:path*",
        missing: [{ type: "host", value: "(www\\.)?grindylocks\\.com" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
