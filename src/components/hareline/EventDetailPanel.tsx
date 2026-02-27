"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";
import { formatDateLong, type HarelineEvent } from "./EventCard";
import { RegionBadge } from "./RegionBadge";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { formatTimeInZone, formatDateInZone, getTimezoneAbbreviation, getBrowserTimezone } from "@/lib/timezone";
import { CheckInButton } from "@/components/logbook/CheckInButton";
import type { AttendanceData } from "@/components/logbook/CheckInButton";
import { CalendarExportButton } from "./CalendarExportButton";
import { EventLocationMap } from "./EventLocationMap";

interface EventDetailPanelProps {
  event: HarelineEvent | null;
  attendance?: AttendanceData | null;
  isAuthenticated?: boolean;
  onDismiss?: () => void;
}

export function EventDetailPanel({ event, attendance, isAuthenticated, onDismiss }: EventDetailPanelProps) {
  const { preference } = useTimePreference();

  if (!event) {
    return (
      <Card>
        <CardContent className="flex min-h-[200px] items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">
            Select an event to see details
          </p>
        </CardContent>
      </Card>
    );
  }

  const mapsUrl = event.locationAddress && /^https?:\/\//.test(event.locationAddress)
    ? event.locationAddress
    : event.locationName
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationName)}`
      : null;

  // Compute display timezone and time
  const isUserLocal = preference === "USER_LOCAL";
  const displayTz = isUserLocal ? getBrowserTimezone() : (event.timezone ?? "America/New_York");

  const displayDateStr = event.dateUtc
    ? formatDateInZone(event.dateUtc, displayTz, "EEEE, MMMM d, yyyy")
    : formatDateLong(event.date);

  const displayTimeStr = (event.dateUtc && event.startTime)
    ? formatTimeInZone(event.dateUtc, displayTz)
    : (event.startTime ? formatTime(event.startTime) : null);

  const tzAbbrev = (event.dateUtc && event.startTime)
    ? getTimezoneAbbreviation(event.dateUtc, displayTz)
    : "";

  return (
    <Card className="flex max-h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* Scrollable content */}
      <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <h2 className="text-lg font-bold" suppressHydrationWarning>{displayDateStr}</h2>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/hareline/${event.id}`}
                    className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="View full event page"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>View event page</TooltipContent>
              </Tooltip>
            </div>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Close detail panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/kennels/${event.kennel.slug}`}
              className="font-medium text-primary hover:underline"
            >
              {event.kennel.fullName}
            </Link>
            <RegionBadge regionData={event.kennel.regionData} size="sm" />
            {event.status === "CANCELLED" && (
              <Badge variant="destructive">Cancelled</Badge>
            )}
            {event.status === "TENTATIVE" && (
              <Badge variant="outline">Tentative</Badge>
            )}
          </div>
        </div>

        {/* Title */}
        {event.title && (
          <h3 className="text-base font-semibold">{event.title}</h3>
        )}

        {/* Check-in */}
        <div className="flex items-center gap-2">
          <CheckInButton
            eventId={event.id}
            eventDate={event.date}
            isAuthenticated={!!isAuthenticated}
            attendance={attendance ?? null}
          />
        </div>

        {/* Detail fields */}
        <dl className="space-y-2 text-sm">
          {event.runNumber && (
            <div>
              <dt className="font-medium text-muted-foreground">Run Number</dt>
              <dd>#{event.runNumber}</dd>
            </div>
          )}
          {displayTimeStr && (
            <div>
              <dt className="font-medium text-muted-foreground">Start Time</dt>
              <dd className="flex items-center gap-1" suppressHydrationWarning>
                {displayTimeStr}
                {tzAbbrev && <span className="text-xs font-medium opacity-70" suppressHydrationWarning>{tzAbbrev}</span>}
              </dd>
            </div>
          )}
          {event.haresText && (
            <div>
              <dt className="font-medium text-muted-foreground">Hares</dt>
              <dd>{event.haresText}</dd>
            </div>
          )}
          {event.locationName && (
            <div>
              <dt className="font-medium text-muted-foreground">Location</dt>
              <dd>
                {mapsUrl ? (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {event.locationName}
                  </a>
                ) : (
                  event.locationName
                )}
              </dd>
            </div>
          )}
        </dl>

        {((event.latitude != null && event.longitude != null) || event.locationName) && (
          <EventLocationMap
            lat={event.latitude ?? undefined}
            lng={event.longitude ?? undefined}
            locationName={event.locationName ?? undefined}
            locationAddress={event.locationAddress ?? undefined}
          />
        )}

        {/* Description */}
        {event.description && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">
              Description
            </h4>
            <p className="whitespace-pre-wrap text-sm">{event.description}</p>
          </div>
        )}
      </CardContent>

      {/* Pinned action footer */}
      <div className="flex flex-wrap gap-2 border-t px-5 py-3">
        <CalendarExportButton event={event} />
        {event.sourceUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">
              View Source
            </a>
          </Button>
        )}
        {event.eventLinks?.map((link) => (
          <Button key={link.id} variant="outline" size="sm" asChild>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              {link.label}
            </a>
          </Button>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/kennels/${event.kennel.slug}`}>
                View {event.kennel.shortName}
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{event.kennel.fullName}</TooltipContent>
        </Tooltip>
      </div>
    </Card>
  );
}
