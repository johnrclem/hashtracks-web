import Link from "next/link";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { getConditionEmoji } from "@/lib/weather-display";
import { getKennelInitials } from "@/lib/travel/format";

interface ConfirmedCardProps {
  result: {
    eventId: string;
    kennelSlug: string;
    kennelName: string;
    kennelRegion: string;
    kennelPinColor: string | null;
    date: string;
    startTime: string | null;
    title: string | null;
    runNumber: number | null;
    haresText: string | null;
    locationName: string | null;
    distanceKm: number;
    sourceLinks: { url: string; label: string; type: string }[];
    weather: { highTempC: number; conditionType: string } | null;
  };
}

export function ConfirmedCard({ result }: ConfirmedCardProps) {
  const dateFormatted = new Date(result.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const initials = getKennelInitials(result.kennelName);

  return (
    <Link
      href={`/hareline/${result.eventId}`}
      className="
        travel-tier-confirmed
        group relative block overflow-hidden rounded-xl border border-border
        bg-card transition-all duration-200
        hover:-translate-y-0.5 hover:border-[var(--tier-accent-border)] hover:shadow-lg
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
      "
    >
      {/* Tier accent top border */}
      <div className="h-0.5 bg-[var(--tier-accent)]" />

      <div className="flex gap-4 p-4">
        {/* Kennel insignia */}
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full font-display text-xs font-semibold text-white transition-transform group-hover:rotate-3"
          style={{ backgroundColor: result.kennelPinColor ?? "oklch(0.55 0.16 163)" }}
        >
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-display text-base font-medium">
                {result.kennelName}
                {result.runNumber ? ` · Run #${result.runNumber}` : ""}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{dateFormatted}</span>
                {result.startTime && (
                  <>
                    <span>·</span>
                    <span>{formatTime(result.startTime)}</span>
                  </>
                )}
                <span>·</span>
                <span className="font-mono text-xs">
                  {result.distanceKm < 1
                    ? "<1 km"
                    : `${result.distanceKm.toFixed(1)} km`}
                </span>
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              {result.weather && (
                <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {getConditionEmoji(result.weather.conditionType)} {Math.round(result.weather.highTempC)}°
                </span>
              )}
              <Badge
                variant="outline"
                className="gap-1 border-[var(--tier-accent-border)] bg-[var(--tier-accent-bg)] text-[var(--tier-accent)]"
              >
                <BadgeCheck className="h-3 w-3" />
                Confirmed
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Source links — visible on hover/focus */}
      {result.sourceLinks.length > 0 && (
        <div className="flex gap-2 border-t border-border/50 px-4 py-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
    </Link>
  );
}
