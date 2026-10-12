import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { KeyProvider } from "@/components/kit/KeyProvider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Harmonic: DJ set architect",
  description:
    "Turn a crate of tracks into a harmonically mixed set that follows a planned energy arc. Camelot wheel, seeded set optimizer, CSV import, and Claude Opus 5.5 for arcs from a description.",
};

/**
 * Runs before first paint. Harmonic is a booth tool, so it opens dark unless the
 * visitor has chosen the light theme before.
 */
const THEME_INIT_SCRIPT = `(function(){var t="dark";try{if(localStorage.getItem("theme")==="light")t="light"}catch(e){}document.documentElement.dataset.theme=t})()`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
        >
          Skip to content
        </a>
        <KeyProvider>{children}</KeyProvider>
      </body>
    </html>
  );
}
