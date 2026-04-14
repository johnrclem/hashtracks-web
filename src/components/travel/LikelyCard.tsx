import Link from "next/link";
import { SignalHigh, SignalMedium, ExternalLink, Info, MapPin } from "lucide-react";
import { formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getKennelInitials } from "@/lib/travel/format";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { EvidenceTimeline } from "./EvidenceTimeline";

interface LikelyCardProps {
  result: {
    kennelId: string;
    kennelSlug: string;
    kennelName: string;
    kennelFullName: string;
    kennelRegion: string;
    kennelPinColor: string | null;
    date: string;
    startTime: string | null;
    confidence: "high" | "medium";
    distanceKm: number;
    explanation: string;
    evidenceWindow: string;
    evidenceTimeline: { weeks: boolean[]; totalEvents: number };
    sourceLinks: { url: string; label: string; type: string }[];
  };
}

export function LikelyCard({ result }: LikelyCardProps) {
  const dateFormatted = new Date(result.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const tierClass =
    result.confidence === "high" ? "travel-tier-high" : "travel-tier-medium";

  const SignalIcon = result.confidence === "high" ? SignalHigh : SignalMedium;
  const confidenceLabel =
    result.confidence === "high" ? "High confidence" : "Medium confidence";

  const initials = getKennelInitials(result.kennelName);

  return (
    <div
      className={`
        ${tierClass}
        group relative overflow-hidden rounded-xl border border-border
        bg-card transition-all duration-200
        hover:-translate-y-0.5 hover:border-[var(--tier-accent-border)] hover:shadow-lg
      `}
    >
      {/* Tier accent top border */}
      <div className="h-0.5 bg-[var(--tier-accent)]" />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3">
            {/* Kennel insignia */}
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full font-display text-xs font-semibold text-white transition-transform group-hover:rotate-3"
              style={{ backgroundColor: result.kennelPinColor ?? "oklch(0.56 0.165 235)" }}
            >
              {initials}
            </div>
            <div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/kennels/${result.kennelSlug}`}
                    title={result.kennelFullName || undefined}
                    className="font-display text-base font-medium hover:underline"
                  >
                    {result.kennelName}
                  </Link>
                </TooltipTrigger>
                {result.kennelFullName && (
                  <TooltipContent>{result.kennelFullName}</TooltipContent>
                )}
              </Tooltip>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>Expected {dateFormatted}</span>
                {result.startTime && (
                  <>
                    <span>·</span>
                    <span>{formatTime(result.startTime)}</span>
                  </>
                )}
                <span>·</span>
                <span className="font-mono text-xs">
                  {result.distanceKm.toFixed(1)} km
                </span>
              </div>
              {/* Region hint — projected trails don't have specific locations */}
              {result.kennelRegion && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground/60">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span>{result.kennelRegion} area</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <ConfidenceMeter confidence={result.confidence} />
            <Badge
              variant="outline"
              className="gap-1 border-[var(--tier-accent-border)] bg-[var(--tier-accent-bg)] text-[var(--tier-accent)]"
            >
              <SignalIcon className="h-3 w-3" />
              {confidenceLabel}
            </Badge>
          </div>
        </div>

        {/* Evidence timeline */}
        <div className="mt-4">
          <EvidenceTimeline
            timeline={result.evidenceTimeline}
            accentClass={
              result.confidence === "high"
                ? "border-sky-500 dark:border-sky-400"
                : "border-amber-500 dark:border-amber-400"
            }
          />
        </div>

        {/* Explanation box */}
        <div
          className="mt-3 rounded-lg border-l-2 border-[var(--tier-accent)] bg-muted/50 p-3"
        >
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                Why am I seeing this?
              </span>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {result.explanation}
                {result.evidenceWindow && (
                  <span className="italic"> — {result.evidenceWindow}</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Source links */}
        {result.sourceLinks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {result.sourceLinks.slice(0, 3).map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
              >
                <ExternalLink className="h-3 w-3" />
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
