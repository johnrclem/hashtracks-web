"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Clock, Footprints } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";
import { AttendanceBadge } from "@/components/logbook/AttendanceBadge";
import type { AttendanceData } from "@/components/logbook/CheckInButton";
import { RegionBadge } from "./RegionBadge";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { getRegionColor } from "@/lib/region";
import { formatTimeInZone, formatDateInZone, getTimezoneAbbreviation, getBrowserTimezone } from "@/lib/timezone";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";
import type { DailyWeather } from "@/lib/weather";
import { getConditionEmoji, cToF } from "@/lib/weather-display";
import { getDisplayTitle, getLocationDisplay } from "@/lib/event-display";

export type HarelineEvent = {
  id: string;
  date: string; // ISO string
  dateUtc: Date | null;
  timezone: string | null;
  kennelId: string;
  kennel: {
    id: string;
    shortName: string;
    fullName: string;
    slug: string;
    region: string;
    country: string;
  } | null;
  runNumber: number | null;
  title: string | null;
  haresText: string | null;
  startTime: string | null;
  locationName: string | null;
  locationCity: string | null;
  locationAddress: string | null;
  description: string | null;
  sourceUrl: string | null;
  status: string;
  eventLinks?: { id: string; url: string; label: string }[];
  latitude?: number | null;
  longitude?: number | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export { formatDate };

/** Compose an accessible label from event fields. */
function buildAriaLabel(event: HarelineEvent, attendance?: AttendanceData | null): string {
  const parts: string[] = [];
  if (event.kennel?.shortName) parts.push(event.kennel.shortName);
  const { title, isFallback } = getDisplayTitle({ ...event, kennel: event.kennel ?? { shortName: "", fullName: "" } });
  if (!isFallback) parts.push(title);
  parts.push(formatDate(event.date));
  if (event.runNumber) parts.push(`Run #${event.runNumber}`);
  if (event.startTime) parts.push(formatTime(event.startTime));
  if (attendance?.status === "INTENDING") parts.push("Going");
  if (attendance?.status === "CONFIRMED") parts.push("Checked in");
  return parts.join(", ");
}

// lg breakpoint (1024px) — matches Tailwind's lg:
const LG_BREAKPOINT = 1024;

// RSVP indicator colors
const RSVP_INTENDING_COLOR = "#3b82f6"; // blue-500
const RSVP_CONFIRMED_COLOR = "#16a34a"; // green-600

interface EventCardProps {
  readonly event: HarelineEvent;
  readonly density: "medium" | "compact";
  readonly onSelect?: (event: HarelineEvent) => void;
  readonly isSelected?: boolean;
  readonly attendance?: AttendanceData | null;
  readonly hideDate?: boolean;
  readonly weather?: DailyWeather | null;
}

export function EventCard({ event, density, onSelect, isSelected, attendance, hideDate, weather }: EventCardProps) {
  const router = useRouter();
  const { preference } = useTimePreference();
  const { tempUnit } = useUnitsPreference();

  // Compute display timezone and time
  const isUserLocal = preference === "USER_LOCAL";
  const displayTz = isUserLocal ? getBrowserTimezone() : (event.timezone ?? "America/New_York");

  // Choose standard date parsing if there's no reliable UTC timestamp, otherwise compute timezone
  const displayDateStr = event.dateUtc
    ? formatDateInZone(event.dateUtc, displayTz)
    : formatDate(event.date);

  const displayTimeStr = (event.dateUtc && event.startTime)
    ? formatTimeInZone(event.dateUtc, displayTz)
    : (event.startTime ? formatTime(event.startTime) : null);

  const tzAbbrev = (event.dateUtc && event.startTime)
    ? getTimezoneAbbreviation(event.dateUtc, displayTz)
    : "";

  function handleClick() {
    // On desktop (lg+), select the event for the detail panel
    if (onSelect && typeof window !== "undefined" && window.innerWidth >= LG_BREAKPOINT) {
      onSelect(event);
      return;
    }
    // On mobile (<lg), navigate to the detail page
    router.push(`/hareline/${event.id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  const regionColor = event.kennel?.region ? getRegionColor(event.kennel.region) : "#6b7280";

  // Weather display
  const weatherEmoji = weather ? getConditionEmoji(weather.conditionType) : null;
  const weatherTemp = weather
    ? (tempUnit === "IMPERIAL" ? `${cToF(weather.highTempC)}\u00B0` : `${Math.round(weather.highTempC)}\u00B0`)
    : null;

  const isCancelled = event.status === "CANCELLED";
  const hasRsvp = attendance?.status === "INTENDING" || attendance?.status === "CONFIRMED";

  // ── Compact density ──
  if (density === "compact") {
    return (
      <div
        role="button"
        tabIndex={0}
        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={buildAriaLabel(event, attendance)}
      >
        <div
          className={`group relative flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-all duration-200 hover:shadow-md active:scale-[0.995] ${
            isSelected
              ? "ring-2 shadow-sm"
              : "hover:border-transparent"
          } ${isCancelled ? "opacity-50" : ""}`}
          style={{
            borderLeftWidth: "4px",
            borderLeftColor: regionColor,
            backgroundColor: isSelected ? `${regionColor}08` : undefined,
            ...(isSelected ? { "--tw-ring-color": `${regionColor}40` } as React.CSSProperties : {}),
          }}
        >
          {/* Hover wash — region color tint */}
          <div
            className="absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200 group-hover:opacity-100 pointer-events-none"
            style={{ backgroundColor: `${regionColor}06` }}
          />

          {/* Fixed-width columns: date, kennel, run# */}
          {!hideDate && (
            <span className="relative w-24 shrink-0 font-medium text-muted-foreground" suppressHydrationWarning>
              {displayDateStr}
            </span>
          )}

          <span className="relative w-20 shrink-0 truncate">
            {event.kennel ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/kennels/${event.kennel.slug}`}
                    className="font-extrabold tracking-tight text-foreground hover:underline decoration-2 underline-offset-2 truncate block"
                    style={{ textDecorationColor: regionColor }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {event.kennel.shortName}
                  </Link>
                </TooltipTrigger>
                <TooltipContent>{event.kennel.fullName}</TooltipContent>
              </Tooltip>
            ) : null}
          </span>

          <span className="relative w-14 shrink-0 font-mono text-xs text-muted-foreground/60">
            {event.runNumber ? `#${event.runNumber}` : ""}
          </span>

          {/* Flexible text — absorbs remaining space */}
          <span className={`relative truncate text-muted-foreground ${isCancelled ? "line-through" : ""}`}>
            {(() => {
              const { title, isFallback } = getDisplayTitle({ ...event, kennel: event.kennel ?? { shortName: "", fullName: "" } });
              return isFallback ? (event.haresText || title) : title;
            })()}
          </span>

          {/* Right cluster */}
          <div className="relative ml-auto flex items-center gap-2 shrink-0">
            {weather && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs" suppressHydrationWarning>
                    {weatherEmoji}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{weather.condition} {weatherTemp}</TooltipContent>
              </Tooltip>
            )}

            {attendance?.status === "INTENDING" && (
              <span className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{ backgroundColor: RSVP_INTENDING_COLOR }}
                />
                <Badge className="border-0 bg-blue-500/15 text-blue-700 text-[10px] px-1.5 py-0 font-bold dark:bg-blue-500/20 dark:text-blue-300">
                  Going
                </Badge>
              </span>
            )}

            {attendance?.status === "CONFIRMED" && (
              <AttendanceBadge level={attendance.participationLevel} size="sm" />
            )}

            {displayTimeStr && (
              <span className="flex items-center gap-1 text-xs font-semibold tabular-nums text-foreground/70" suppressHydrationWarning>
                {displayTimeStr}
                {tzAbbrev && <span className="text-[10px] font-medium opacity-60" suppressHydrationWarning>{tzAbbrev}</span>}
              </span>
            )}

            {event.kennel && <RegionBadge region={event.kennel.region} size="sm" />}
          </div>
        </div>
      </div>
    );
  }

  // ── Medium density ──
  const locationDisplay = getLocationDisplay(event);
  const { title: displayTitle } = getDisplayTitle({ ...event, kennel: event.kennel ?? { shortName: "", fullName: "" } });

  return (
    <div
      role="button"
      tabIndex={0}
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={buildAriaLabel(event, attendance)}
    >
      <div
        className={`group relative overflow-hidden rounded-xl border transition-all duration-250 ease-out ${
          isSelected
            ? "ring-2 shadow-lg"
            : "shadow-sm hover:shadow-xl hover:-translate-y-1"
        } active:shadow-sm active:translate-y-0 ${
          isCancelled ? "opacity-50 grayscale-[30%]" : ""
        }`}
        style={{
          backgroundColor: isSelected ? `${regionColor}0a` : undefined,
          ...(isSelected ? { "--tw-ring-color": `${regionColor}40` } as React.CSSProperties : {}),
        }}
      >
        {/* Region accent — top bar that thickens on hover */}
        <div
          className="h-[3px] transition-all duration-300 group-hover:h-[5px]"
          style={{ backgroundColor: regionColor }}
        />

        {/* Region color gradient wash — diagonal for depth */}
        <div
          className="absolute inset-0 opacity-[0.06] transition-opacity duration-300 group-hover:opacity-[0.12] pointer-events-none"
          style={{
            background: `linear-gradient(145deg, ${regionColor} 0%, transparent 50%)`,
          }}
        />

        {/* RSVP indicator — vivid left edge glow for "Going" or "Checked in" */}
        {hasRsvp && (
          <div
            className="absolute inset-y-0 left-0 w-1 pointer-events-none"
            style={{
              backgroundColor: attendance?.status === "INTENDING" ? RSVP_INTENDING_COLOR : RSVP_CONFIRMED_COLOR,
              boxShadow: `0 0 8px ${attendance?.status === "INTENDING" ? `${RSVP_INTENDING_COLOR}80` : `${RSVP_CONFIRMED_COLOR}80`}`,
            }}
          />
        )}

        <div className="relative px-3.5 py-2.5 sm:px-4">
          {/* Row 1: Kennel name (anchor) + metadata cluster | Time pill */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              {/* Kennel name — the bold visual anchor */}
              {event.kennel ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/kennels/${event.kennel.slug}`}
                      className="text-base font-extrabold tracking-tight text-foreground hover:underline decoration-2 underline-offset-3"
                      style={{ textDecorationColor: regionColor }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {event.kennel.shortName}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>{event.kennel.fullName}</TooltipContent>
                </Tooltip>
              ) : null}

              {event.kennel && <RegionBadge region={event.kennel.region} size="sm" />}

              {event.runNumber && (
                <span className="text-xs font-mono text-muted-foreground/50 tabular-nums">
                  #{event.runNumber}
                </span>
              )}

              {!hideDate && (
                <span className="text-xs text-muted-foreground/50 hidden sm:inline" suppressHydrationWarning>
                  {displayDateStr}
                </span>
              )}

              {/* Status badges */}
              {isCancelled && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 font-bold uppercase tracking-wider">
                  Cancelled
                </Badge>
              )}
              {event.status === "TENTATIVE" && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-dashed">
                  Tentative
                </Badge>
              )}

              {/* RSVP badges — elevated prominence */}
              {attendance?.status === "INTENDING" && (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full animate-pulse shadow-sm"
                    style={{ backgroundColor: RSVP_INTENDING_COLOR, boxShadow: `0 0 6px ${RSVP_INTENDING_COLOR}60` }}
                  />
                  <Badge className="border-0 bg-blue-500 text-white text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider shadow-sm dark:bg-blue-600">
                    Going
                  </Badge>
                </span>
              )}
              {attendance?.status === "CONFIRMED" && (
                <AttendanceBadge level={attendance.participationLevel} size="sm" />
              )}
            </div>

            {/* Time — right-aligned in its own container for prominence */}
            {displayTimeStr && (
              <span
                className="shrink-0 flex items-center gap-1.5 rounded-md px-2 py-0.5 -mt-0.5 transition-colors duration-200"
                style={{ backgroundColor: `${regionColor}0c` }}
                suppressHydrationWarning
              >
                <Clock className="h-3 w-3 text-muted-foreground/40" />
                <span className="text-sm font-bold tabular-nums text-foreground/85">{displayTimeStr}</span>
                {tzAbbrev && (
                  <span className="text-[10px] text-muted-foreground/40 font-semibold" suppressHydrationWarning>
                    {tzAbbrev}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Row 2: Title — with subtle region color influence */}
          <p
            className={`mt-1 truncate text-[13.5px] leading-snug ${
              isCancelled
                ? "line-through text-muted-foreground/60"
                : "text-foreground/80 font-medium"
            }`}
            title={displayTitle}
          >
            {displayTitle}
          </p>

          {/* Row 3: Metadata strip — location, hares, weather */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground/60">
            {locationDisplay && (
              <span className="flex items-center gap-1 truncate max-w-[55%]">
                <MapPin className="h-3 w-3 shrink-0" style={{ color: `${regionColor}90` }} />
                <span className="truncate">{locationDisplay}</span>
              </span>
            )}

            {event.haresText && locationDisplay && (
              <span className="text-muted-foreground/30" aria-hidden="true">&middot;</span>
            )}

            {event.haresText && (
              <span className="flex items-center gap-1 truncate max-w-[40%]">
                <Footprints className="h-3 w-3 shrink-0 opacity-50" />
                <span className="truncate">{event.haresText}</span>
              </span>
            )}

            {weather && (locationDisplay || event.haresText) && (
              <span className="text-muted-foreground/30" aria-hidden="true">&middot;</span>
            )}

            {weather && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 shrink-0 rounded-full bg-muted/50 px-1.5 py-0.5 -my-0.5" suppressHydrationWarning>
                    <span className="text-[11px]">{weatherEmoji}</span>
                    <span className="font-semibold text-foreground/60">{weatherTemp}</span>
                    {weather.precipProbability >= 20 && (
                      <span className="text-blue-500/80 dark:text-blue-400/80 font-medium">
                        {weather.precipProbability}%
                      </span>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {weather.condition}
                  {weather.precipProbability >= 20 ? ` \u00B7 ${weather.precipProbability}% chance of rain` : ""}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
