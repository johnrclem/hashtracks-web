"use client";

import { OwnPageLink } from "@/components/kennels/OwnPageLink";
import {
  formatStatusLine,
  getStatusLine,
  toKennelEvidence,
  type SerializedKennelEvidence,
} from "@/lib/kennel-status";

interface KennelStatusLineProps {
  evidence: SerializedKennelEvidence;
  /** The kennel's own page (kennelOwnPageUrl); null hides the "check their page" link. */
  ownPageUrl: string | null;
  /** Used for the click-out analytics event. */
  kennelSlug: string;
  surface?: "card" | "kennel-page";
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
}: Readonly<KennelStatusLineProps>) {
  const now = new Date();
  const line = getStatusLine(toKennelEvidence(evidence), now);
  if (!line) return null;

  const ownPage = line.kind === "never" ? ownPageUrl : null;

  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      {formatStatusLine(line, now)}
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
