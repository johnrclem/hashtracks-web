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

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function getDayOfWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export { formatDate, formatDateLong, getDayOfWeek };

// lg breakpoint (1024px) — matches Tailwind's lg:
const LG_BREAKPOINT = 1024;

interface EventCardProps {
  event: HarelineEvent;
  density: "medium" | "compact";
  onSelect?: (event: HarelineEvent) => void;
  isSelected?: boolean;
  attendance?: AttendanceData | null;
}

export function EventCard({ event, density, onSelect, isSelected, attendance }: EventCardProps) {
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

  if (density === "compact") {
    return (
      <div className="cursor-pointer" onClick={handleClick}>
        <div
          className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50 ${isSelected ? "border-primary bg-primary/5" : ""
            }`}
        >
          <span className="w-24 shrink-0 font-medium">
            {displayDateStr}
          </span>
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
          <RegionBadge region={event.kennel.region} size="sm" />
          {event.runNumber && (
            <span className="w-12 shrink-0 text-muted-foreground">
              #{event.runNumber}
            </span>
          )}
          <span className="truncate text-muted-foreground">
            {event.haresText || event.title || ""}
          </span>
          {displayTimeStr && (
            <span className="ml-auto flex items-center gap-1 shrink-0 text-xs text-muted-foreground">
              {displayTimeStr}
              {tzAbbrev && <span className="text-[10px] font-medium opacity-70">{tzAbbrev}</span>}
            </span>
          )}
          {attendance && (
            <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
              {attendance.status === "INTENDING" ? (
                <Badge variant="outline" className="border-blue-300 text-blue-700 text-[10px] px-1.5 py-0">Going</Badge>
              ) : (
                <AttendanceBadge level={attendance.participationLevel} size="sm" />
              )}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Medium density — plain div instead of Card (which has py-6 baked in)
  return (
    <div className="cursor-pointer" onClick={handleClick}>
      <div
        className={`rounded-lg border px-3 py-2 shadow-sm transition-colors hover:border-foreground/20 ${isSelected ? "border-primary bg-primary/5" : ""
          }`}
      >
        <div className="min-w-0 space-y-0.5">
          {/* Line 1: date · kennel · run# · time — all on one line */}
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-medium">{displayDateStr}</span>
            <span className="text-muted-foreground">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/kennels/${event.kennel.slug}`}
                  className="font-medium text-primary hover:underline"
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
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  Run #{event.runNumber}
                </span>
              </>
            )}
            {displayTimeStr && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {displayTimeStr}
                  {tzAbbrev && <span className="text-xs font-medium opacity-70">{tzAbbrev}</span>}
                </span>
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
              <span className="ml-1" onClick={(e) => e.stopPropagation()}>
                {attendance.status === "INTENDING" ? (
                  <Badge variant="outline" className="border-blue-300 text-blue-700 text-[10px] px-1.5 py-0">Going</Badge>
                ) : (
                  <AttendanceBadge level={attendance.participationLevel} size="sm" />
                )}
              </span>
            )}
          </div>

          {/* Line 2 (optional): title */}
          {event.title && (
            <p className="truncate text-sm">{event.title}</p>
          )}

          {/* Line 3 (optional): hares */}
          {event.haresText && (
            <p className="truncate text-sm text-muted-foreground">
              Hares: {event.haresText}
            </p>
          )}

          {/* Line 4 (optional): location */}
          {event.locationName && (
            <p className="truncate text-sm text-muted-foreground">
              {event.locationName}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
