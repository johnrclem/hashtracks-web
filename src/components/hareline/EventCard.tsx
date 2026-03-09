"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  };
  runNumber: number | null;
  title: string | null;
  haresText: string | null;
  startTime: string | null;
  locationName: string | null;
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

/** Display title for events with missing or parenthetical titles. */
function getDisplayTitle(event: HarelineEvent): string {
  const title = event.title?.trim() ?? "";
  if (!title || /^\(.*\)$/.test(title)) {
    return event.runNumber
      ? `${event.kennel.shortName} \u2014 Run #${event.runNumber}`
      : event.kennel.shortName;
  }
  return title;
}

/** Compose an accessible label from event fields. */
function buildAriaLabel(event: HarelineEvent, attendance?: AttendanceData | null): string {
  const parts: string[] = [event.kennel.shortName];
  const title = getDisplayTitle(event);
  if (title && title !== event.kennel.shortName) parts.push(title);
  parts.push(formatDate(event.date));
  if (event.runNumber) parts.push(`Run #${event.runNumber}`);
  if (event.startTime) parts.push(formatTime(event.startTime));
  if (attendance?.status === "INTENDING") parts.push("Going");
  if (attendance?.status === "CONFIRMED") parts.push("Checked in");
  return parts.join(", ");
}

// lg breakpoint (1024px) — matches Tailwind's lg:
const LG_BREAKPOINT = 1024;

interface EventCardProps {
  readonly event: HarelineEvent;
  readonly density: "medium" | "compact";
  readonly onSelect?: (event: HarelineEvent) => void;
  readonly isSelected?: boolean;
  readonly attendance?: AttendanceData | null;
  readonly hideDate?: boolean;
}

export function EventCard({ event, density, onSelect, isSelected, attendance, hideDate }: EventCardProps) {
  const router = useRouter();
  const { preference } = useTimePreference();

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

  const regionColor = getRegionColor(event.kennel.region);

  const goingBadge = (
    <Badge className="bg-blue-100 text-blue-700 border-0 text-xs px-2 py-0.5 font-semibold">
      Going
    </Badge>
  );

  if (density === "compact") {
    return (
      <div
        role="button"
        tabIndex={0}
        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={buildAriaLabel(event, attendance)}
      >
        <div
          className={`flex items-center gap-3 rounded-md border border-l-2 px-3 py-2 text-sm transition-all hover:bg-muted/50 hover:shadow-sm active:bg-muted/70 ${isSelected ? "ring-1 ring-primary/20" : ""
            }`}
          style={{
            borderLeftColor: regionColor,
            backgroundColor: isSelected ? `${regionColor}08` : undefined,
          }}
        >
          {/* Fixed-width columns: date, kennel, run# */}
          {!hideDate && (
            <span className="w-24 shrink-0 font-medium" suppressHydrationWarning>
              {displayDateStr}
            </span>
          )}
          <span className="w-20 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/kennels/${event.kennel.slug}`}
                  className="text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {event.kennel.shortName}
                </Link>
              </TooltipTrigger>
              <TooltipContent>{event.kennel.fullName}</TooltipContent>
            </Tooltip>
          </span>
          <span className="w-12 shrink-0 text-muted-foreground">
            {event.runNumber ? `#${event.runNumber}` : "\u2014"}
          </span>
          {/* Flexible text — absorbs remaining space */}
          <span className="truncate text-muted-foreground">
            {event.haresText || getDisplayTitle(event)}
          </span>
          {/* Right-aligned variable-width items */}
          <RegionBadge region={event.kennel.region} size="sm" />
          {attendance?.status === "INTENDING" && (
            <span className="shrink-0">
              {goingBadge}
            </span>
          )}
          {displayTimeStr && (
            <span className="ml-auto flex items-center gap-1 shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
              {displayTimeStr}
              {tzAbbrev && <span className="text-[10px] font-medium opacity-70" suppressHydrationWarning>{tzAbbrev}</span>}
            </span>
          )}
          {attendance?.status === "CONFIRMED" && (
            <span className="shrink-0">
              <AttendanceBadge level={attendance.participationLevel} size="sm" />
            </span>
          )}
        </div>
      </div>
    );
  }

  // Medium density — plain div instead of Card (which has py-6 baked in)
  const displayTitle = getDisplayTitle(event);

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
        className={`rounded-lg border border-l-[3px] px-3 py-2 shadow-sm transition-all hover:bg-muted/30 hover:shadow-md hover:-translate-y-px active:shadow-sm active:translate-y-0 ${isSelected ? "ring-1 ring-primary/20" : ""
          }`}
        style={{
          borderLeftColor: regionColor,
          backgroundColor: isSelected ? `${regionColor}08` : undefined,
        }}
      >
        <div className="min-w-0 space-y-0.5">
          {/* Line 1: date · kennel · run# · badges | time — metadata row */}
          <div className="flex flex-nowrap items-center gap-1.5 overflow-hidden text-[13px] text-muted-foreground">
            {!hideDate && (
              <>
                <span className="shrink-0 whitespace-nowrap" suppressHydrationWarning>{displayDateStr}</span>
                <span>·</span>
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/kennels/${event.kennel.slug}`}
                  className="font-bold text-foreground hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {event.kennel.shortName}
                </Link>
              </TooltipTrigger>
              <TooltipContent>{event.kennel.fullName}</TooltipContent>
            </Tooltip>
            <RegionBadge region={event.kennel.region} size="sm" />
            {event.runNumber && (
              <>
                <span className="shrink-0">·</span>
                <span className="truncate">#{event.runNumber}</span>
              </>
            )}
            {event.status === "CANCELLED" && (
              <Badge variant="destructive" className="ml-1 text-xs">
                Cancelled
              </Badge>
            )}
            {event.status === "TENTATIVE" && (
              <Badge variant="outline" className="ml-1 text-xs">
                Tentative
              </Badge>
            )}
            {attendance && (
              <span className="ml-1">
                {attendance.status === "INTENDING" ? (
                  goingBadge
                ) : (
                  <AttendanceBadge level={attendance.participationLevel} size="sm" />
                )}
              </span>
            )}
            {displayTimeStr && (
              <span className="ml-auto shrink-0 font-medium text-sm text-foreground/70 flex items-center gap-1" suppressHydrationWarning>
                {displayTimeStr}
                {tzAbbrev && <span className="text-[10px] opacity-70" suppressHydrationWarning>{tzAbbrev}</span>}
              </span>
            )}
          </div>

          {/* Line 2: title (always shown, with fallback) */}
          <p className="truncate text-base font-semibold text-foreground" title={displayTitle}>{displayTitle}</p>

          {/* Line 3 (optional): hares */}
          {event.haresText && (
            <p className="truncate text-[13px] text-muted-foreground/80">
              Hares: {event.haresText}
            </p>
          )}

          {/* Line 4 (optional): location */}
          {event.locationName && (
            <p className="truncate text-[13px] text-muted-foreground/80">
              {event.locationName}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
