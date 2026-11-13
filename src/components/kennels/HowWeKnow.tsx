"use client";

import { capture } from "@/lib/analytics";
import { KennelStatusLine } from "@/components/kennels/KennelStatusLine";
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
  website: string | null;
  facebookUrl: string | null;
  kennelSlug: string;
}

const KIND_LABEL: Record<SerializedEvidenceItem["kind"], string> = {
  "last-run": "Last run seen",
  "next-posted": "Next run posted",
  confirmed: "Checked running",
  stopped: "Stopped",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

function formatSources(names: string[]): string {
  return new Intl.ListFormat("en-US", { style: "long", type: "conjunction" }).format(names);
}

/** Dated evidence behind a kennel's status, plus what our feeds cover. */
export function HowWeKnow({
  evidence,
  coverage,
  items,
  website,
  facebookUrl,
  kennelSlug,
}: Readonly<HowWeKnowProps>) {
  const ownPage = website ?? facebookUrl;

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4">
      <h2 className="text-sm font-semibold">How we know</h2>
      <KennelStatusLine
        evidence={evidence}
        website={website}
        facebookUrl={facebookUrl}
        kennelSlug={kennelSlug}
        surface="kennel-page"
      />
      {items.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((item) => (
            <li key={`${item.kind}-${item.date}`}>
              <span className="text-muted-foreground">{formatDate(item.date)}</span>
              {" · "}
              {KIND_LABEL[item.kind]}
              {item.detail && <span className="text-muted-foreground">{` · ${item.detail}`}</span>}
              {item.url && (
                <>
                  {" "}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    link ↗
                  </a>
                </>
              )}
            </li>
          ))}
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
                <a
                  href={ownPage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() =>
                    capture("kennel_own_page_clicked", { kennelSlug, surface: "kennel-page" })
                  }
                >
                  Check their page ↗
                </a>
              </>
            )}
          </>
        )}
      </p>
    </section>
  );
}
