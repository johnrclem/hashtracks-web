import { ExternalLink } from "lucide-react";

export interface PossibleRowData {
  kennelId: string;
  kennelName: string;
  distanceKm: number;
  explanation: string;
  sourceLinks: { url: string; label: string; type: string }[];
}

/**
 * Single-row rendering for a "possible" trail result.
 * Used both in the collapsed PossibleSection and inline within distance tiers
 * when the "Include possible" filter toggle is on.
 */
export function PossibleRow({ result }: { result: PossibleRowData }) {
  const primaryLink = result.sourceLinks[0];
  const cadence = result.explanation.split("—")[0]?.trim() || "Timing varies";

  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <div className="text-sm font-medium text-muted-foreground">
        {result.kennelName}
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground/70">
        <span>{cadence}</span>
        <span>·</span>
        <span>{result.distanceKm.toFixed(1)} km</span>
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
