"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Clock, Footprints, Tent, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { formatTime, formatDateRange } from "@/lib/format";
import { AttendanceBadge } from "@/components/logbook/AttendanceBadge";
import type { AttendanceData } from "@/components/logbook/CheckInButton";
import { RegionBadge } from "./RegionBadge";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { getRegionColor } from "@/lib/region";
import { composeUtcStart, formatTimeInZone, getTimezoneAbbreviation, getBrowserTimezone } from "@/lib/timezone";
import { useUnitsPreference } from "@/components/providers/units-preference-provider";
import type { DailyWeather } from "@/lib/weather";
import { getConditionEmoji, cToF } from "@/lib/weather-display";
import { getDisplayTitle, getLocationDisplay } from "@/lib/event-display";
import { ShiggyLevelFlames, TrailLengthLine, formatTrailLength } from "./TrailDifficulty";

/**
 * Event shape consumed by EventCard (list rendering) and EventDetailPanel
 * (expanded panel). The initial Hareline list payload only populates the
 * "slim" fields above `status`; the heavy fields below (description,
 * sourceUrl, full address, eventLinks) are filled in on demand via
 * `getEventDetail` when the user opens the detail panel.
 *
 * Keeping the heavy fields optional (instead of always nullable) lets the
 * list and detail views share a single type, and the detail panel can tell
 * "not yet loaded" (undefined) apart from "loaded and empty" (null).
 */
/** Kennel shape consumed by EventCard for both primary and co-host display. */
export type HarelineEventKennel = {
  id: string;
  shortName: string;
  fullName: string;
  slug: string;
  region: string;
  country: string;
};

export type HarelineEvent = {
  id: string;
  date: string; // ISO string
  dateUtc: Date | null;
  timezone: string | null;
  kennelId: string;
  /** Primary kennel (the one Event.kennelId points at). */
  kennel: HarelineEventKennel | null;
  /**
   * Co-host kennels (#1023 step 5). Empty/undefined for the common
   * single-kennel case; EventCard's conjunction component is conditional
   * on this so single-kennel rendering is byte-identical to pre-#1023.
   */
  coHosts?: HarelineEventKennel[];
  runNumber: number | null;
  title: string | null;
  /**
   * Shared-sheet sub-event badge label (#1624). Surfaces when a shared
   * Google Sheet row uses host-prefix syntax in its Group column, e.g.
   * "MH3 - Bayern Nash Hash" → eventLabel: "Bayern Nash Hash". Renders as
   * a small chip next to the run number on the event card.
   */
  eventLabel?: string | null;
  haresText: string | null;
  startTime: string | null;
  locationName: string | null;
  locationCity: string | null;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
  /** #890 — verbatim trail-length string from the source. */
  trailLengthText?: string | null;
  trailLengthMinMiles?: number | null;
  trailLengthMaxMiles?: number | null;
  /** #890 — Shiggy Level (1–5). UI label is always "Shiggy Level". */
  difficulty?: number | null;
  /** #1316 — trail layout description ("A to A", "A to B", "Live Hare"). */
  trailType?: string | null;
  /** #1316 — dogs welcome at trail. null = source didn't say. */
  dogFriendly?: boolean | null;
  /** #1316 — pre-event meetup venue/time, free-form. Heavy field; render only on detail. */
  prelube?: string | null;
  /** #1316 — explicit `cost` column (free-form). Used to be smashed into `description`. */
  cost?: string | null;
  // Heavy / on-demand fields — undefined until `getEventDetail` resolves.
  locationStreet?: string | null;
  locationAddress?: string | null;
  description?: string | null;
  sourceUrl?: string | null;
  eventLinks?: { id: string; url: string; label: string }[];
  /**
   * Multi-day series fields (#1560).
   *  - `isSeriesParent` flips on when `linkMultiDaySeries` made this Event
   *    the umbrella for a multi-trail weekend; `childEvents` carries the
   *    per-day trails ordered by date.
   *  - `endDate` carries the inclusive last day of either a series parent
   *    or a standalone date-range event (one-registration venue weekend,
   *    no children — MadisonH3 case). Either signal opts a card into the
   *    multi-day visual treatment; the absence of children differentiates
   *    "weekend with N trails" from "weekend at one venue".
   *  - `parentEventId` is set on child Events; the hareline + kennel page
   *    listings filter `parentEventId: null` so children only render
   *    inside their parent's expanded view, never as top-level cards.
   */
  isSeriesParent?: boolean | null;
  parentEventId?: string | null;
  /**
   * Slim parent record for children, used by the back-link copy
   * (`"Part of {parentEvent.title}"` — PR E.5). The hareline list query
   * + the umbrella detail page both `select` `parentEvent: { id, title }`
   * when present. Undefined on non-children.
   */
  parentEvent?: { id: string; title: string | null } | null;
  endDate?: string | null; // ISO; null = single-day
  childEvents?: HarelineSeriesChild[];
};

/**
 * Slim shape for children rendered inside a series parent's expanded
 * timeline (#1560). Only the fields the timeline row reads — heavy
 * details (location, weather, eventLinks, etc.) stream lazily through
 * `getEventDetail` when the user opens a specific child.
 */
export type HarelineSeriesChild = {
  id: string;
  date: string;
  dateUtc: Date | null;
  timezone: string | null;
  title: string | null;
  haresText: string | null;
  startTime: string | null;
  status: string;
  locationName: string | null;
  runNumber: number | null;
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

/**
 * Compute the display string for the event-card date chip.
 *
 * Always formats `event.date` as UTC. `event.date` is stored as UTC noon of
 * the kennel-local day (PRD F.4), so UTC formatting yields the correct
 * kennel-local day regardless of viewer or kennel timezone. This matches
 * `buildAriaLabel`'s date emission and avoids the trap where merge.ts
 * falls back to `dateUtc = event.date` (UTC noon) for startTime-less events
 * and `formatDateInZone(dateUtc, kennelTZ)` rolls forward a day for kennels
 * east of UTC (#1510, #1517, #1522).
 *
 * Exported as a single source of truth so the regression test exercises the
 * same code the chip renders.
 */
export function computeChipDate(event: { date: string }): string {
  return formatDate(event.date);
}

/**
 * Compute the display string + timezone abbreviation for the event-card time.
 *
 * #1654 — when an event has both a `startTime` and a `timezone`, the canonical
 * render anchor is `composeUtcStart(date, startTime, timezone)`, NOT the
 * stored `event.dateUtc`. The merge pipeline can leave `dateUtc` stale at
 * noon-UTC when a lower-trust source backfills `startTime` after a
 * higher-trust primary created the row without one (SeaMon Trail #556 — card
 * showed 5:00 AM PDT while the detail panel showed 5:30 PM PDT). The
 * companion `merge.ts` fix keeps the stored value consistent going forward;
 * this helper makes the renderer resilient to any historical row in the same
 * shape and is the same derivation the detail panel's `EventTimeDisplay`
 * already does.
 *
 * Fallback order:
 *   1. composed UTC from `date + startTime + timezone` (the canonical anchor)
 *   2. stored `dateUtc` paired with `startTime` (pre-#1654 behavior, used when
 *      timezone is missing on the row)
 *   3. raw `HH:MM` string formatted via `formatTime` (no tz abbreviation)
 *
 * Exported so the regression test exercises the same derivation the card
 * renders.
 */
export function computeDisplayTime(
  event: { date: string; startTime: string | null; timezone: string | null; dateUtc: Date | null },
  displayTz: string,
): { displayTimeStr: string | null; tzAbbrev: string } {
  const composedAnchor =
    event.startTime && event.timezone
      ? composeUtcStart(new Date(event.date), event.startTime, event.timezone)
      : null;
  const timeAnchor = composedAnchor ?? (event.startTime ? event.dateUtc : null);
  let displayTimeStr: string | null = null;
  if (timeAnchor) {
    displayTimeStr = formatTimeInZone(timeAnchor, displayTz);
  } else if (event.startTime) {
    displayTimeStr = formatTime(event.startTime);
  }
  const tzAbbrev = timeAnchor ? getTimezoneAbbreviation(timeAnchor, displayTz) : "";
  return { displayTimeStr, tzAbbrev };
}

/**
 * Render a co-host kennel link with its own region-color underline accent
 * and a tooltip showing the kennel's fullName + "co-host" annotation.
 * Visually equal-class to the primary anchor but with `font-bold` (vs the
 * primary's `font-extrabold`) so the primary still wins the eye.
 */
function CoHostKennelLink({
  kennel,
  size,
}: {
  readonly kennel: HarelineEventKennel;
  readonly size: "compact" | "medium";
}) {
  const color = getRegionColor(kennel.region);
  const fontSize = size === "medium" ? "text-base" : "text-sm";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/kennels/${kennel.slug}`}
          className={`${fontSize} font-bold tracking-tight text-foreground/90 hover:underline decoration-2 underline-offset-3 truncate`}
          style={{ textDecorationColor: color }}
          onClick={(e) => e.stopPropagation()}
          title={`${kennel.fullName} (co-host)`}
        >
          {kennel.shortName}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{kennel.fullName} <span className="opacity-60">· co-host</span></TooltipContent>
    </Tooltip>
  );
}

/**
 * Render `× <co-host>` (or `× <co-host> +N more` for 3+ kennels) — the
 * typographic conjunction idiom for multi-kennel co-hosted events
 * (#1023 step 5). The × glyph is decorative and aria-hidden; aria-label
 * uses "with" instead.
 */
function CoHostConjunction({
  coHosts,
  size,
}: {
  readonly coHosts: readonly HarelineEventKennel[];
  readonly size: "compact" | "medium";
}) {
  if (coHosts.length === 0) return null;
  const [first, ...rest] = coHosts;
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground/40 font-light px-0.5 select-none">×</span>
      <CoHostKennelLink kennel={first} size={size} />
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] font-mono text-muted-foreground/60 cursor-help">
              +{rest.length}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Also co-hosted by:{" "}
            {rest.map((k) => k.shortName).join(", ")}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

/** Compose an accessible label from event fields. */
function buildAriaLabel(event: HarelineEvent, attendance?: AttendanceData | null): string {
  const parts: string[] = [];
  if (event.kennel?.shortName) {
    const coHostNames = event.coHosts?.map((k) => k.shortName) ?? [];
    parts.push(
      coHostNames.length > 0
        ? `${event.kennel.shortName} with ${coHostNames.join(" and ")}`
        : event.kennel.shortName,
    );
  }
  const { title, isFallback } = getDisplayTitle({ ...event, kennel: event.kennel ?? { shortName: "", fullName: "" } });
  if (!isFallback) parts.push(title);
  // Route through `computeChipDate` so chip + aria-label can never drift
  // (per claude[bot] PR #1566 review).
  parts.push(computeChipDate(event));
  if (event.runNumber) parts.push(`Run #${event.runNumber}`);
  if (event.startTime) parts.push(formatTime(event.startTime));
  // #1316 — surface card-visible structured fields to screen readers.
  if (event.trailType) parts.push(`Trail type ${event.trailType}`);
  if (event.dogFriendly === true) parts.push("dog friendly");
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

  // See `computeChipDate` above for why we always format `event.date` as UTC
  // and intentionally don't use `event.dateUtc` here (#1510, #1517, #1522).
  // Time formatting below still uses `displayTz`. (#1502)
  const displayDateStr = computeChipDate(event);

  // #1560 series rendering — `isSeriesParent` carries N child trails (Bay 2
  // Blackout-style); `endDate` alone signals a date-range standalone (one
  // registration covers a venue weekend, no children). Both opt into the
  // date-range chip + tent glyph; only the former expands.
  //
  // `event.date` and `event.endDate` are both serialized via `toISOString()`
  // so we extract YYYY-MM-DD from each before comparing — pre-Codex-review
  // this compared `endDate` (ISO) to `event.date.split("T")[0]` (YYYY-MM-DD)
  // and never matched, so the same-day suppression guard was silently
  // unreachable.
  const isSeriesParent = event.isSeriesParent === true;
  const endDay = event.endDate ? event.endDate.split("T")[0] : null;
  const startDay = event.date.split("T")[0];
  const hasDateRange = !!endDay && endDay !== startDay;
  const isMultiDay = isSeriesParent || hasDateRange;
  const childCount = event.childEvents?.length ?? 0;
  const rangeDisplay = isMultiDay ? formatDateRange(event.date, event.endDate) : displayDateStr;
  const [seriesExpanded, setSeriesExpanded] = useState(false);

  const { displayTimeStr, tzAbbrev } = computeDisplayTime(event, displayTz);

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

          {/* Fixed-width columns: date, kennel, run#
              #1560 — multi-day events show the inclusive date range in place
              of the single-day chip. Widening the column when a range is
              present keeps the rest of the row from reflowing. */}
          {!hideDate && (
            <span
              className={`relative shrink-0 font-medium text-muted-foreground ${isMultiDay ? "w-32" : "w-24"}`}
              suppressHydrationWarning
            >
              {isMultiDay && (
                <Tent
                  className="inline-block size-3 mr-1 -mt-px"
                  style={{ color: regionColor, opacity: 0.7 }}
                  aria-hidden="true"
                />
              )}
              {rangeDisplay}
              {isSeriesParent && childCount > 0 && (
                <span className="ml-1 font-mono text-[10px] text-muted-foreground/70" aria-label={`${childCount} trails`}>
                  · {childCount}t
                </span>
              )}
            </span>
          )}

          <span className={`relative shrink-0 flex items-baseline gap-1 truncate ${
            event.coHosts && event.coHosts.length > 0 ? "max-w-[180px]" : "w-20"
          }`}>
            {event.kennel ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/kennels/${event.kennel.slug}`}
                      className="font-extrabold tracking-tight text-foreground hover:underline decoration-2 underline-offset-2 truncate block"
                      style={{ textDecorationColor: regionColor }}
                      onClick={(e) => e.stopPropagation()}
                      title={event.kennel.fullName}
                    >
                      {event.kennel.shortName}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>{event.kennel.fullName}</TooltipContent>
                </Tooltip>
                {event.coHosts && event.coHosts.length > 0 && (
                  <CoHostConjunction coHosts={event.coHosts} size="compact" />
                )}
              </>
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
            {/* #1624 — shared-sheet sub-event badge (e.g. "Bayern Nash Hash") */}
            {event.eventLabel && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
                {event.eventLabel}
              </Badge>
            )}

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
  const trailLengthDisplay = formatTrailLength(event);
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
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link
                        href={`/kennels/${event.kennel.slug}`}
                        className="text-base font-extrabold tracking-tight text-foreground hover:underline decoration-2 underline-offset-3"
                        style={{ textDecorationColor: regionColor }}
                        onClick={(e) => e.stopPropagation()}
                        title={event.kennel.fullName}
                      >
                        {event.kennel.shortName}
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent>{event.kennel.fullName}</TooltipContent>
                  </Tooltip>
                  {event.coHosts && event.coHosts.length > 0 && (
                    <CoHostConjunction coHosts={event.coHosts} size="medium" />
                  )}
                </>
              ) : null}

              {event.kennel && <RegionBadge region={event.kennel.region} size="sm" />}

              {event.runNumber && (
                <span className="text-xs font-mono text-muted-foreground/50 tabular-nums">
                  #{event.runNumber}
                </span>
              )}

              {!hideDate && (
                <span className="text-xs text-muted-foreground/50 hidden sm:inline" suppressHydrationWarning>
                  {isMultiDay && (
                    <Tent
                      className="inline-block size-3 mr-1 -mt-px align-middle"
                      style={{ color: regionColor, opacity: 0.7 }}
                      aria-hidden="true"
                    />
                  )}
                  {rangeDisplay}
                </span>
              )}

              {/* #1560 — series-parent "+ N trails" badge. Sibling to the
                  existing tentative/cancelled badges so it inherits flex-wrap
                  behavior. Hidden when childCount is 0 (Madison-style
                  date-range standalone). */}
              {isSeriesParent && childCount > 0 && (
                <Badge
                  className="text-[10px] px-1.5 py-0 font-mono uppercase tracking-wider border-0"
                  style={{ backgroundColor: `${regionColor}1a`, color: regionColor }}
                  aria-label={`${childCount} trails in this series`}
                >
                  + {childCount} trails
                </Badge>
              )}
              {hasDateRange && !isSeriesParent && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 text-muted-foreground border-dashed"
                  aria-label="Multi-day weekend event"
                >
                  Weekend
                </Badge>
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

              {/* #1624 — shared-sheet sub-event badge (e.g. "Bayern Nash Hash") */}
              {event.eventLabel && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium">
                  {event.eventLabel}
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

            {/* #890 — trail length + Shiggy Level. Inline alongside
                location/hares so hashers can size up "how far / how hard"
                without expanding the detail panel. Region-color flame tint
                ties difficulty to kennel identity (same color used by the
                kennel-name underline + left border + time pill). */}
            {trailLengthDisplay && (locationDisplay || event.haresText) && (
              <span className="text-muted-foreground/30" aria-hidden="true">&middot;</span>
            )}
            {trailLengthDisplay && (
              <TrailLengthLine
                text={trailLengthDisplay}
                color={regionColor}
                size="sm"
                className="shrink-0 max-w-[140px]"
              />
            )}
            {event.difficulty != null && (trailLengthDisplay || locationDisplay || event.haresText) && (
              <span className="text-muted-foreground/30" aria-hidden="true">&middot;</span>
            )}
            {event.difficulty != null && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ShiggyLevelFlames
                    level={event.difficulty}
                    color={regionColor}
                    size="sm"
                    className="shrink-0"
                  />
                </TooltipTrigger>
                <TooltipContent>Shiggy Level {event.difficulty}/5</TooltipContent>
              </Tooltip>
            )}

            {/* #1316 — trail type as a compact text chip; dog-friendly as 🐕
                only when explicitly Yes (false / null stay off the card). */}
            {event.trailType && (locationDisplay || event.haresText || trailLengthDisplay || event.difficulty != null) && (
              <span className="text-muted-foreground/30" aria-hidden="true">&middot;</span>
            )}
            {event.trailType && (
              <span
                className="shrink-0 rounded-sm px-1 py-px text-[10px] font-medium uppercase tracking-wide"
                style={{ backgroundColor: `${regionColor}1a`, color: regionColor }}
              >
                {event.trailType}
              </span>
            )}
            {event.dogFriendly === true && event.trailType && (
              <span className="text-muted-foreground/30" aria-hidden="true">&middot;</span>
            )}
            {event.dogFriendly === true && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 text-[11px]" aria-label="Dog-friendly trail">🐕</span>
                </TooltipTrigger>
                <TooltipContent>Dog-friendly</TooltipContent>
              </Tooltip>
            )}

            {weather && (locationDisplay || event.haresText || trailLengthDisplay || event.difficulty != null || event.trailType || event.dogFriendly === true) && (
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

          {/* #1560 \u2014 series children expansion. Renders below the metadata
              strip so the card's primary scan rhythm is untouched until the
              user expands. Children are listed as compact rows tied to the
              parent's region color via a timeline rail. */}
          {isSeriesParent && childCount > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSeriesExpanded((v) => !v);
                }}
                aria-expanded={seriesExpanded}
                aria-controls={`series-${event.id}-children`}
                className="flex items-center gap-1 text-xs font-mono text-muted-foreground/80 hover:text-foreground transition-colors"
              >
                {(() => {
                  if (seriesExpanded) return "Hide trails";
                  const trailWord = childCount === 1 ? "trail" : "trails";
                  return `Show ${childCount} ${trailWord}`;
                })()}
                <ChevronDown
                  className={`size-3 transition-transform ${seriesExpanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {seriesExpanded && (
                <ol
                  id={`series-${event.id}-children`}
                  className="mt-2 flex flex-col border-l-2 ml-1.5 pl-3 space-y-1"
                  style={{ borderColor: regionColor }}
                >
                  {event.childEvents!.map((child) => (
                    <SeriesChildRow
                      key={child.id}
                      child={child}
                      regionColor={regionColor}
                      displayTz={displayTz}
                    />
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Time to render in a series child row. Same recompose-from-source guard as
 * the top-level card (#1654): when startTime + timezone are both present, the
 * canonical anchor is `composeUtcStart(date, startTime, timezone)` — not the
 * stored `dateUtc`, which can drift out of sync after a lower-trust
 * startTime enrichment lands. Falls back to `dateUtc` when timezone is
 * missing, then to the raw HH:MM string, then `null`.
 */
export function computeChildTime(child: HarelineSeriesChild, displayTz: string): string | null {
  if (child.startTime && child.timezone) {
    const composed = composeUtcStart(new Date(child.date), child.startTime, child.timezone);
    if (composed) return formatTimeInZone(composed, displayTz);
  }
  if (child.dateUtc && child.startTime) return formatTimeInZone(child.dateUtc, displayTz);
  if (child.startTime) return formatTime(child.startTime);
  return null;
}

/** One row in the expanded series children list (#1560). Compact: day chip
 *  + time + title + hares. Click navigates to the child's detail page.
 *  Stops propagation so the parent card's onClick doesn't also fire. */
function SeriesChildRow({
  child,
  regionColor,
  displayTz,
}: {
  readonly child: HarelineSeriesChild;
  readonly regionColor: string;
  readonly displayTz: string;
}) {
  const router = useRouter();
  const childTime = computeChildTime(child, displayTz);
  const childDate = new Date(child.date);
  const dayChip = childDate.toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
  const isChildCancelled = child.status === "CANCELLED";
  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className="absolute -left-[14px] top-1.5 size-2 rounded-full"
        style={{ backgroundColor: isChildCancelled ? "#9ca3af" : regionColor }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          router.push(`/hareline/${child.id}`);
        }}
        className={`group/child flex items-baseline gap-2 text-xs w-full text-left hover:text-foreground transition-colors ${
          isChildCancelled ? "opacity-50" : ""
        }`}
      >
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80 w-12 shrink-0">
          {dayChip}
        </span>
        {childTime && (
          <span className="font-mono tabular-nums text-muted-foreground/70 w-12 shrink-0" suppressHydrationWarning>
            {childTime}
          </span>
        )}
        <span className={`truncate font-medium ${isChildCancelled ? "line-through" : ""}`}>
          {child.title ?? "Trail"}
        </span>
        {child.haresText && (
          <span className="hidden sm:inline text-muted-foreground/60 truncate">
            ({child.haresText})
          </span>
        )}
      </button>
    </li>
  );
}
