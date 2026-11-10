"use client";

import Link from "next/link";
import { capture } from "@/lib/analytics";

/** Half-Mind's kennel finder: city search with radius, including kennels HashTracks doesn't track yet. */
const HALF_MIND_FINDER_URL = "https://half-mind.com/app/";

/**
 * "We may not track every kennel here" line for empty Travel results, so a
 * visitor can tell "nothing is on" apart from "we don't cover it yet".
 */
export function CoverageNote({ place }: Readonly<{ place?: string }>) {
  return (
    <p className="mt-6 text-sm text-muted-foreground">
      We may not track every kennel near {place || "here"}. Check{" "}
      <a
        href={HALF_MIND_FINDER_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Half-Mind&apos;s kennel directory
      </a>
      , or{" "}
      <Link
        href="/suggest"
        onClick={() => capture("suggest_kennel", { entryPoint: "travel_coverage_note" })}
        className="underline underline-offset-2 hover:text-foreground"
      >
        tell us about one
      </Link>
      .
    </p>
  );
}
