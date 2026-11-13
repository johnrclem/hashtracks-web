"use client";

import { capture } from "@/lib/analytics";
import { safeUrl } from "@/lib/safe-url";
import {
  formatStatusLine,
  getStatusLine,
  toKennelEvidence,
  type SerializedKennelEvidence,
} from "@/lib/kennel-status";

interface KennelStatusLineProps {
  evidence: SerializedKennelEvidence;
  website: string | null;
  facebookUrl: string | null;
  /** Used for the click-out analytics event. */
  kennelSlug: string;
  surface?: "card" | "kennel-page";
  /** False hides the "check their page" link (e.g. when a nearby sentence already has it). */
  showOwnPageLink?: boolean;
}

/** The kennel's own page: its website, else Facebook; http(s) only. */
export function kennelOwnPageUrl(website: string | null, facebookUrl: string | null): string | null {
  return safeUrl(website) ?? safeUrl(facebookUrl);
}

/**
 * One quiet line of dated evidence under a kennel's name. Renders nothing for
 * a running kennel. When we have never seen a run, points to the kennel's own
 * page. The link sits above a card's stretched link (`relative z-10`) and
 * stops propagation so it never triggers the card's navigation.
 */
export function KennelStatusLine({
  evidence,
  website,
  facebookUrl,
  kennelSlug,
  surface = "card",
  showOwnPageLink = true,
}: Readonly<KennelStatusLineProps>) {
  const now = new Date();
  const line = getStatusLine(toKennelEvidence(evidence), now);
  if (!line) return null;

  const ownPage =
    showOwnPageLink && line.kind === "never" ? kennelOwnPageUrl(website, facebookUrl) : null;

  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      {formatStatusLine(line, now)}
      {ownPage && (
        <>
          {" · "}
          <a
            href={ownPage}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 underline underline-offset-2 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              capture("kennel_own_page_clicked", { kennelSlug, surface });
            }}
          >
            check their page ↗
          </a>
        </>
      )}
    </p>
  );
}
