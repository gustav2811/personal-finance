import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Common Orbit",
  description: "A private observatory for household usage and money.",
};

const DIRECTION_CONTRACT = `<!--
THESIS: Common Orbit turns household data into a private sky, not a generic admin dashboard.
OWN-WORLD: Deep graphite, vellum-white type, mint and amber signals, star-chart ticks, orbital traces, and precise source labels.
STORY: The visitor scans the current household cross-check, sees how energy becomes money, then follows any signal into its source.
FIRST VIEWPORT: A yearly energy constellation owns the left two-thirds; a current-facts rail holds the right third; a source timeline anchors the bottom edge.
FORM: Household Observatory, own-world candidate one, code-led, seed d12fbd0e.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div
          aria-hidden="true"
          hidden
          dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }}
        />
        {children}
      </body>
    </html>
  );
}
