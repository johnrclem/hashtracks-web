"use client";

import { OwnPageLink } from "@/components/kennels/OwnPageLink";
import {
  formatStatusLine,
  getStatusLine,
  ownPageFor,
  toKennelEvidence,
  type SerializedKennelEvidence,
} from "@/lib/kennel-status";

const LISTING_WORDS = "Half-Mind listing";

interface KennelStatusLineProps {
  evidence: SerializedKennelEvidence;
  /** The kennel's own page (kennelOwnPageUrl); null hides the "check their page" link. */
  ownPageUrl: string | null;
  /** Used for the click-out analytics event. */
  kennelSlug: string;
  surface?: "card" | "kennel-page" | "travel";
  /** Link the kennel's own page on dated lines too, not only when we have never seen a run. */
  showOwnPage?: boolean;
  /** The kennel's Half-Mind listing page; links "Half-Mind listing" on a Half-Mind check line. */
  listingUrl?: string | null;
}

/**
 * One quiet line of dated evidence under a kennel's name. Renders nothing for
 * a running kennel. When we have never seen a run, points to the kennel's own
 * page. The link sits above a card's stretched link (`relative z-10`) and
 * stops propagation so it never triggers the card's navigation.
 */
export function KennelStatusLine({
  evidence,
  ownPageUrl,
  kennelSlug,
  surface = "card",
  showOwnPage = false,
  listingUrl = null,
}: Readonly<KennelStatusLineProps>) {
  const now = new Date();
  const line = getStatusLine(toKennelEvidence(evidence), now);
  if (!line) return null;

  const ownPage = ownPageFor(line, ownPageUrl, showOwnPage);
  const text = formatStatusLine(line, now);
  const linkedListing =
    line.kind === "checked" && line.via === "HALF_MIND" && listingUrl && text.startsWith(LISTING_WORDS)
      ? listingUrl
      : null;

  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      {linkedListing ? (
        <>
          <a
            href={linkedListing}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 underline underline-offset-2 hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            {LISTING_WORDS}
          </a>
          {text.slice(LISTING_WORDS.length)}
        </>
      ) : (
        text
      )}
      {ownPage && (
        <>
          {" · "}
          <OwnPageLink href={ownPage} kennelSlug={kennelSlug} surface={surface} aboveCardLink>
            check their page ↗
          </OwnPageLink>
        </>
      )}
    </p>
  );
}
