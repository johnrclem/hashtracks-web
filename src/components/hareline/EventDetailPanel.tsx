"use client";

import Link from "next/link";
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
import { CheckInButton } from "@/components/logbook/CheckInButton";
import type { AttendanceData } from "@/components/logbook/CheckInButton";
import { CalendarExportButton } from "./CalendarExportButton";

interface EventDetailPanelProps {
  event: HarelineEvent | null;
  attendance?: AttendanceData | null;
  isAuthenticated?: boolean;
  onDismiss?: () => void;
}

export function EventDetailPanel({ event, attendance, isAuthenticated, onDismiss }: EventDetailPanelProps) {
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

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-lg font-bold">{formatDateLong(event.date)}</h2>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Close detail panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
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
            <Badge variant="outline" className="text-xs">
              {event.kennel.region}
            </Badge>
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
          {event.startTime && (
            <div>
              <dt className="font-medium text-muted-foreground">Start Time</dt>
              <dd>{formatTime(event.startTime)}</dd>
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

        {/* Description */}
        {event.description && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">
              Description
            </h4>
            <p className="whitespace-pre-wrap text-sm">{event.description}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2">
          <CalendarExportButton event={event} />
          {event.sourceUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">
                View Source
              </a>
            </Button>
          )}
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
      </CardContent>
    </Card>
  );
}
