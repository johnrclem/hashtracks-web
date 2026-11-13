"use client";

import { KennelStatusLine } from "@/components/kennels/KennelStatusLine";
import { OwnPageLink } from "@/components/kennels/OwnPageLink";
import { formatDateMedium } from "@/lib/format";
import { safeUrl } from "@/lib/safe-url";
import type { SerializedKennelEvidence } from "@/lib/kennel-status";

export type SerializedEvidenceItem = {
  kind: "last-run" | "next-posted" | "confirmed" | "stopped";
  date: string;
  detail: string | null;
  url: string | null;
};

export type SerializedCoverage =
  | { level: "full"; sourceNames: string[] }
  | { level: "schedule" }
  | { level: "none" };

interface HowWeKnowProps {
  evidence: SerializedKennelEvidence;
  coverage: SerializedCoverage;
  items: SerializedEvidenceItem[];
  /** The kennel's own page (kennelOwnPageUrl); null = no link. */
  ownPageUrl: string | null;
  kennelSlug: string;
}

const KIND_LABEL: Record<SerializedEvidenceItem["kind"], string> = {
  "last-run": "Last run seen",
  "next-posted": "Next run posted",
  confirmed: "Checked running",
  stopped: "Stopped",
};

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
      />
      {items.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((item) => {
            const itemUrl = safeUrl(item.url);
            return (
              <li key={`${item.kind}-${item.date}`}>
                <span className="text-muted-foreground">{formatDateMedium(item.date)}</span>
                {" · "}
                {KIND_LABEL[item.kind]}
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
