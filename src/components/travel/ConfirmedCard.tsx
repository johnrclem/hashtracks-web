"use client";

import Link from "next/link";
import { BadgeCheck, ExternalLink, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getConditionEmoji, cToF } from "@/lib/weather-display";
import { getKennelInitials } from "@/lib/travel/format";
import { getDisplayTitle, getLocationDisplay } from "@/lib/event-display";
import { AttendanceBadge } from "@/components/logbook/AttendanceBadge";
import {
  composeUtcStart,
  formatTimeInZone,
  getTimezoneAbbreviation,
} from "@/lib/timezone";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";

interface ConfirmedCardProps {
  result: {
    eventId: string;
    kennelSlug: string;
    kennelName: string;
    kennelFullName: string;
    kennelRegion: string;
    kennelPinColor: string | null;
    date: string;
    startTime: string | null;
    title: string | null;
    runNumber: number | null;
    haresText: string | null;
    locationName: string | null;
    locationCity: string | null;
    timezone: string | null;
    distanceKm: number;
    sourceLinks: { url: string; label: string; type: string }[];
    weather: {
      highTempC: number;
      lowTempC: number;
      condition: string;
      conditionType: string;
      precipProbability: number;
    } | null;
    attendance: { status: string; participationLevel: string } | null;
  };
}

const RSVP_INTENDING_COLOR = "#3b82f6"; // blue-500 — matches hareline's EventCard

export function ConfirmedCard({ result }: ConfirmedCardProps) {
  const { tempUnit } = useUnitsPreference();

  const dateFormatted = new Date(result.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  // Compose an absolute Date so we can format time + derive the tz abbrev in
  // the destination's timezone. Falls back to raw startTime if tz is missing.
  const absoluteStart =
    result.startTime && result.timezone
      ? composeUtcStart(new Date(result.date), result.startTime, result.timezone)
      : null;

  const displayedTime =
    absoluteStart && result.timezone
      ? formatTimeInZone(absoluteStart, result.timezone)
      : result.startTime;

  const tzAbbrev =
    absoluteStart && result.timezone
      ? getTimezoneAbbreviation(absoluteStart, result.timezone)
      : "";

  const { title: headline } = getDisplayTitle({
    title: result.title,
    runNumber: result.runNumber,
    kennel: { shortName: result.kennelName, fullName: result.kennelFullName },
  });

  const locationLine = getLocationDisplay({
    locationName: result.locationName,
    locationCity: result.locationCity,
  });

  const initials = getKennelInitials(result.kennelName);

  return (
    <div
      className="
        travel-tier-confirmed
        group relative overflow-hidden rounded-xl border border-border
        bg-card transition-all duration-200
        hover:-translate-y-0.5 hover:border-[var(--tier-accent-border)] hover:shadow-lg
      "
    >
      <div className="h-0.5 bg-[var(--tier-accent)]" />

      <div className="flex gap-4 p-4">
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/hareline/${result.eventId}`}
                      title={result.kennelFullName || undefined}
                      className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
                    >
                      {headline}
                    </Link>
                  </TooltipTrigger>
                  {result.kennelFullName && (
                    <TooltipContent>{result.kennelFullName}</TooltipContent>
                  )}
                </Tooltip>
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{dateFormatted}</span>
                {displayedTime && (
                  <>
                    <span>·</span>
                    <span>
                      {displayedTime}
                      {tzAbbrev && (
                        <span className="ml-1 font-mono text-xs text-muted-foreground/60">
                          {tzAbbrev}
                        </span>
                      )}
                    </span>
                  </>
                )}
                <span>·</span>
                <span className="font-mono text-xs">
                  {result.distanceKm < 1
                    ? "<1 km"
                    : `${result.distanceKm.toFixed(1)} km`}
                </span>
              </div>

              {locationLine && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/70">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{locationLine}</span>
                </div>
              )}
              {result.haresText && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/60">
                  <Users className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">Hares: {result.haresText}</span>
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center gap-2">
              {result.weather && <WeatherPill weather={result.weather} tempUnit={tempUnit} />}
              {result.attendance?.status === "INTENDING" && (
                <span className="flex items-center gap-1">
                  <span
                    className="h-2 w-2 animate-pulse rounded-full"
                    style={{ backgroundColor: RSVP_INTENDING_COLOR }}
                  />
                  <Badge className="border-0 bg-blue-500/15 px-1.5 py-0 text-[10px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    Going
                  </Badge>
                </span>
              )}
              {result.attendance?.status === "CONFIRMED" && (
                <AttendanceBadge level={result.attendance.participationLevel} size="sm" />
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

      {result.sourceLinks.length > 0 && (
        <div className="flex gap-2 border-t border-border/50 px-4 py-2">
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
  );
}

function WeatherPill({
  weather,
  tempUnit,
}: {
  weather: {
    highTempC: number;
    conditionType: string;
    precipProbability: number;
  };
  tempUnit: "IMPERIAL" | "METRIC";
}) {
  const emoji = getConditionEmoji(weather.conditionType);
  const temp =
    tempUnit === "IMPERIAL" ? cToF(weather.highTempC) : Math.round(weather.highTempC);
  const unit = tempUnit === "IMPERIAL" ? "°F" : "°C";
  const showPrecip = weather.precipProbability >= 20;

  return (
    <span
      className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
      suppressHydrationWarning
    >
      {emoji} {temp}
      {unit}
      {showPrecip && (
        <span className="ml-1.5 text-muted-foreground/70">
          {weather.precipProbability}%
        </span>
      )}
    </span>
  );
}
