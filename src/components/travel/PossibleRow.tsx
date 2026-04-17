import { ExternalLink } from "lucide-react";
import { KennelNameTooltip } from "@/components/shared/KennelNameTooltip";
import { formatDistanceShort, formatDateCompact } from "@/lib/travel/format";

export interface PossibleRowData {
  kennelId: string;
  kennelName: string;
  kennelFullName: string;
  distanceKm: number;
  explanation: string;
  sourceLinks: { url: string; label: string; type: string }[];
  /** Most recent confirmed event in the last 12 weeks, or null/undefined. */
  lastConfirmedAt?: string | null;
}

/**
 * Single-row rendering for a "possible" trail result.
 * Used both in the collapsed PossibleSection and inline within distance tiers
 * when the "Include possible" filter toggle is on.
 */
export function PossibleRow({ result }: { result: PossibleRowData }) {
  // Skip links that render as blank "— check their  closer to your trip" —
  // buildSourceLinks trims labels at the source, but defense-in-depth in case
  // a future caller bypasses that helper.
  const primaryLink = result.sourceLinks.find((l) => l.label.trim());
  const cadence = result.explanation.split("—")[0]?.trim() || "Timing varies";

  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <div className="text-sm font-medium text-muted-foreground">
        <KennelNameTooltip fullName={result.kennelFullName}>
          <span
            title={result.kennelFullName || undefined}
            className={result.kennelFullName ? "cursor-help" : undefined}
          >
            {result.kennelName}
          </span>
        </KennelNameTooltip>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground/70">
        <span>{cadence}</span>
        <span>·</span>
        <span>{formatDistanceShort(result.distanceKm)}</span>
        {result.lastConfirmedAt && (
          <>
            <span>·</span>
            <span>Last posted {formatDateCompact(result.lastConfirmedAt)}</span>
          </>
        )}
      </div>
      {primaryLink && (
        <div className="mt-1.5 text-xs italic text-muted-foreground/60">
          — check their{" "}
          <a
            href={primaryLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            {primaryLink.label}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>{" "}
          closer to your trip.
        </div>
      )}
    </div>
  );
}
