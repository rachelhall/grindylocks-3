import type { Metadata } from "next";
import { Archivo, Archivo_Black } from "next/font/google";

import "./globals.css";

// The app's families, self-hosted by next/font. globals.css points the
// --gl-font-* tokens at these variables.
const archivo = Archivo({ subsets: ["latin", "latin-ext"], variable: "--font-archivo" });
const archivoBlack = Archivo_Black({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-archivo-black" });

export const metadata: Metadata = {
  title: { default: "Grindylocks Admin", template: "%s · Grindylocks Admin" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${archivoBlack.variable}`}>
      <head>
        {/* Material Symbols isn't in next/font's catalogue, so it loads from
            Google Fonts: Sharp, weight 600 only, like the app. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* display=block hides icon names until the font loads (Google's advice for icon fonts). */}
        {/* eslint-disable-next-line @next/next/google-font-display, @next/next/no-page-custom-font -- root layout, so every page gets it */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Sharp:opsz,wght,FILL,GRAD@24,600,0,0&display=block"
        />
      </head>
      <body className="min-h-dvh bg-gl-surface text-gl-text">{children}</body>
    </html>
  );
}
