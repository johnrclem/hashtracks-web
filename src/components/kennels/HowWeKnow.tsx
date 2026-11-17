"use client";

import { KennelStatusLine } from "@/components/kennels/KennelStatusLine";
import { OwnPageLink } from "@/components/kennels/OwnPageLink";
import { formatDateMedium } from "@/lib/format";
import { safeUrl } from "@/lib/safe-url";
import { confirmedLabel } from "@/lib/kennel-how-we-know-label";
import type { ConfirmationVia, SerializedKennelEvidence } from "@/lib/kennel-status";

export type SerializedEvidenceItem =
  | { kind: "last-run" | "next-posted" | "stopped"; date: string; detail: string | null; url: string | null }
  | { kind: "confirmed"; via: ConfirmationVia; date: string; detail: string | null; url: string | null };

export type SerializedCoverage =
  | { level: "full"; sourceNames: string[] }
  | { level: "schedule" }
  | { level: "listing" }
  | { level: "none" };

interface HowWeKnowProps {
  evidence: SerializedKennelEvidence;
  coverage: SerializedCoverage;
  items: SerializedEvidenceItem[];
  /** The kennel's own page (kennelOwnPageUrl); null = no link. */
  ownPageUrl: string | null;
  kennelSlug: string;
  /** The kennel's Half-Mind listing page, when it has one. */
  listingUrl?: string | null;
  /** Half-Mind-only kennel: its status line links the own page on every state. */
  listingOnly?: boolean;
}

const KIND_LABEL = {
  "last-run": "Last run seen",
  "next-posted": "Next run posted",
  stopped: "Stopped",
} as const;

function itemLabel(item: SerializedEvidenceItem): string {
  return item.kind === "confirmed" ? confirmedLabel(item.via) : KIND_LABEL[item.kind];
}

function formatSources(names: string[]): string {
  return new Intl.ListFormat("en-US", { style: "long", type: "conjunction" }).format(names);
}

/** Dated evidence behind a kennel's status, plus what our feeds cover. */
export function HowWeKnow({
  evidence,
  coverage,
  items,
  ownPageUrl: ownPage,
  kennelSlug,
  listingUrl = null,
  listingOnly = false,
}: Readonly<HowWeKnowProps>) {
  // The coverage sentence carries the link when we don't get their runs; the
  // status line above it then drops its own copy so the link shows once.
  const coverageHasLink = coverage.level === "none" && ownPage !== null;

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4">
      <h2 className="text-sm font-semibold">How we know</h2>
      <KennelStatusLine
        evidence={evidence}
        ownPageUrl={coverageHasLink ? null : ownPage}
        kennelSlug={kennelSlug}
        surface="kennel-page"
        listingUrl={listingUrl}
        listingOnly={listingOnly}
      />
      {items.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((item) => {
            const itemUrl = safeUrl(item.url);
            return (
              <li key={`${item.kind}-${item.date}`}>
                <span className="text-muted-foreground">{formatDateMedium(item.date)}</span>
                {" · "}
                {itemLabel(item)}
                {item.detail && <span className="text-muted-foreground">{` · ${item.detail}`}</span>}
                {itemUrl && (
                  <>
                    {" "}
                    <a
                      href={itemUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      link ↗
                    </a>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {coverage.level === "full" && `We get their runs from ${formatSources(coverage.sourceNames)}.`}
        {coverage.level === "schedule" &&
          "We only know their usual schedule. Check their page for actual runs."}
        {coverage.level === "listing" && (
          <>
            We only know their{" "}
            {listingUrl ? (
              <a
                href={listingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Half-Mind listing
              </a>
            ) : (
              "Half-Mind listing"
            )}
            .
          </>
        )}
        {coverage.level === "none" && (
          <>
            We don&apos;t get their runs.
            {ownPage && (
              <>
                {" "}
                <OwnPageLink href={ownPage} kennelSlug={kennelSlug} surface="kennel-page">
                  Check their page ↗
                </OwnPageLink>
              </>
            )}
          </>
        )}
      </p>
    </section>
  );
}
