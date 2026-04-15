"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Facebook,
  Instagram,
  Globe,
  MapPin,
  Users,
  CornerDownRight,
} from "lucide-react";
import { getConditionEmoji, cToF } from "@/lib/weather-display";
import { formatDistanceWithWalk } from "@/lib/travel/format";
import { capture } from "@/lib/analytics";
import { getDisplayTitle, getFullLocationDisplay } from "@/lib/event-display";
import { AttendanceBadge } from "@/components/logbook/AttendanceBadge";
import { KennelNameTooltip } from "@/components/shared/KennelNameTooltip";
import { GoingBadge } from "@/components/shared/GoingBadge";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SourceLink as SearchSourceLink } from "@/lib/travel/search";
import {
  composeUtcStart,
  formatTimeInZone,
  getTimezoneAbbreviation,
} from "@/lib/timezone";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";

type SourceLinkType = SearchSourceLink["type"];

interface SourceLink {
  url: string;
  label: string;
  type: SourceLinkType;
}

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
    locationStreet: string | null;
    locationCity: string | null;
    timezone: string | null;
    distanceKm: number;
    sourceLinks: SourceLink[];
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

export function ConfirmedCard({ result }: ConfirmedCardProps) {
  const router = useRouter();
  const { tempUnit } = useUnitsPreference();

  const dateFormatted = new Date(result.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

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

  const locationLine = getFullLocationDisplay({
    locationName: result.locationName,
    locationStreet: result.locationStreet,
    locationCity: result.locationCity,
  });

  const distanceLabel = formatDistanceWithWalk(result.distanceKm);

  const href = `/hareline/${result.eventId}`;

  const fireResultClick = () =>
    capture("travel_result_clicked", {
      resultType: "confirmed",
      kennelSlug: result.kennelSlug,
    });

  const handleCardClick = () => {
    fireResultClick();
    router.push(href);
  };
  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fireResultClick();
      router.push(href);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      aria-label={`${headline} — ${dateFormatted}${displayedTime ? ` at ${displayedTime}` : ""}`}
      className="
        travel-tier-confirmed
        group relative cursor-pointer overflow-hidden rounded-xl
        border border-border border-l-4 border-l-[var(--tier-accent)]
        bg-card transition-all duration-200
        hover:-translate-y-0.5 hover:border-[var(--tier-accent-border)] hover:shadow-lg
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
      "
    >
      <div className="flex flex-col gap-1.5 p-4">
        {/* Row 1: primary — event title + RSVP / weather cluster */}
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate font-display text-base font-medium">
            <Link
              href={href}
              onClick={(e) => e.stopPropagation()}
              className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
            >
              {headline}
            </Link>
          </h3>
          <div className="flex flex-shrink-0 items-center gap-2">
            {result.weather && <WeatherPill weather={result.weather} tempUnit={tempUnit} />}
            {result.attendance?.status === "INTENDING" && <GoingBadge />}
            {result.attendance?.status === "CONFIRMED" && (
              <AttendanceBadge level={result.attendance.participationLevel} size="sm" />
            )}
          </div>
        </div>

        {/* Row 2: attribution (kennel · region · run#) + source icons */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/80">
          <div className="flex min-w-0 items-center gap-1.5">
            <CornerDownRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/40" />
            <KennelNameTooltip fullName={result.kennelFullName}>
              <Link
                href={`/kennels/${result.kennelSlug}`}
                onClick={(e) => e.stopPropagation()}
                title={result.kennelFullName || undefined}
                className="truncate font-medium hover:underline"
              >
                {result.kennelName}
              </Link>
            </KennelNameTooltip>
            {result.kennelRegion && (
              <RegionBadge region={result.kennelRegion} size="sm" />
            )}
            {result.runNumber && (
              <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/50">
                #{result.runNumber}
              </span>
            )}
          </div>
          {result.sourceLinks.length > 0 && (
            <SourceLinkIcons
              links={result.sourceLinks.slice(0, 4)}
              kennelSlug={result.kennelSlug}
            />
          )}
        </div>

        {/* Row 3: date + time + tz + distance + walk-time */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
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
          <span className="font-mono text-xs">{distanceLabel}</span>
        </div>

        {/* Row 4: location */}
        {locationLine && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
            <MapPin className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{locationLine}</span>
          </div>
        )}

        {/* Row 5: hares */}
        {result.haresText && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Users className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">Hares: {result.haresText}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Icon for a source link based on its type; falls back to a generic link. */
function iconForSourceType(type: SourceLinkType) {
  switch (type) {
    case "facebook":
      return Facebook;
    case "instagram":
      return Instagram;
    case "website":
      return Globe;
    case "hashrego":
    case "meetup":
    case "other":
    default:
      return ExternalLink;
  }
}

function SourceLinkIcons({
  links,
  kennelSlug,
}: {
  links: SourceLink[];
  kennelSlug: string;
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5">
      {links.map((link) => {
        const Icon = iconForSourceType(link.type);
        return (
          <Tooltip key={link.url}>
            <TooltipTrigger asChild>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  capture("travel_source_link_clicked", {
                    kennelSlug,
                    linkType: link.type,
                  });
                }}
                aria-label={link.label}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="h-3 w-3" />
              </a>
            </TooltipTrigger>
            <TooltipContent>{link.label}</TooltipContent>
          </Tooltip>
        );
      })}
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
