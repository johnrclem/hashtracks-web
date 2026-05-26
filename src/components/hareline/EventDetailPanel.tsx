"use client";

import Link from "next/link";
import { ExternalLink, Tent, ArrowUpLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { formatTime, formatDateLong, formatDateRange, getLabelForUrl, stripMarkdown, stripUrlsFromText } from "@/lib/format";
import { getFullLocationDisplay } from "@/lib/event-display";
import type { HarelineEvent } from "./EventCard";
import { SeriesChildTimeline } from "./SeriesChildTimeline";
import { ShiggyLevelFlames, TrailLengthLine, formatTrailLength } from "./TrailDifficulty";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { formatTimeInZone, getTimezoneAbbreviation, getBrowserTimezone } from "@/lib/timezone";
import { CheckInButton } from "@/components/logbook/CheckInButton";
import type { AttendanceData } from "@/components/logbook/CheckInButton";
import { CalendarExportButton } from "./CalendarExportButton";
import { EventLocationMap } from "./EventLocationMap";
import { getRegionColor } from "@/lib/region";

/**
 * Compute the long-form display string for the detail-panel heading.
 *
 * Always formats `event.date` as UTC via `formatDateLong`. `event.date` is
 * stored as UTC noon of the kennel-local day (PRD F.4), so UTC formatting
 * yields the correct kennel-local day. We intentionally do NOT format
 * `event.dateUtc` in the kennel's TZ — merge.ts falls back to
 * `dateUtc = event.date` (UTC noon) when an event lacks a `startTime`, and
 * `formatDateInZone(UTC-noon, Pacific/Auckland)` rolls the heading forward
 * a day for kennels east of UTC (#1510, #1517, #1522).
 *
 * Exported so the regression test exercises the same code the heading renders.
 */
export function computeHeadingDate(event: { date: string }): string {
  return formatDateLong(event.date);
}

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

  // See `computeHeadingDate` above for why we always format `event.date` as
  // UTC and intentionally don't use `event.dateUtc` here (#1510, #1517,
  // #1522). Time line below still uses `displayTz`. (#1502)
  const displayDateStr = computeHeadingDate(event);

  const displayTimeStr = (event.dateUtc && event.startTime)
    ? formatTimeInZone(event.dateUtc, displayTz)
    : (event.startTime ? formatTime(event.startTime) : null);

  const tzAbbrev = (event.dateUtc && event.startTime)
    ? getTimezoneAbbreviation(event.dateUtc, displayTz)
    : "";

  const regionColor = event.kennel?.region ? getRegionColor(event.kennel.region) : "#6b7280";
  const trailLengthDisplay = formatTrailLength(event);

  // #1560 — multi-day series / date-range standalone signals. Both `date`
  // and `endDate` are serialized as full ISO strings, so we extract
  // YYYY-MM-DD from each before comparing (Codex P1 review — the older
  // form compared ISO to YYYY-MM-DD and the suppression guard never fired).
  const isSeriesParent = event.isSeriesParent === true;
  const endDay = event.endDate ? event.endDate.split("T")[0] : null;
  const startDay = event.date.split("T")[0];
  const hasDateRange = !!endDay && endDay !== startDay;
  const isMultiDay = isSeriesParent || hasDateRange;
  const childCount = event.childEvents?.length ?? 0;
  const isChildOfSeries = !!event.parentEventId;
  // Heading: range for parents/date-range events, single date for children + singles.
  const headingDateStr = isMultiDay ? formatDateRange(event.date, event.endDate) : displayDateStr;

  return (
    <Card className="flex max-h-[calc(100vh-4rem)] flex-col overflow-hidden border-t-[3px]" style={{ borderTopColor: regionColor }}>
      {/* Scrollable content */}
      <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {/* #1560 — child detail panel: back-link to parent series. PR E.5
            — uses `parentEvent.title` when populated so the user knows
            which umbrella weekend this child belongs to; falls back to
            the generic copy when the query didn't include `parentEvent`. */}
        {isChildOfSeries && event.parentEventId && (
          <Link
            href={`/hareline/${event.parentEventId}`}
            className="flex items-center gap-2 px-2 py-1.5 -mx-1 mb-2 border-l-[3px] text-xs text-muted-foreground hover:text-foreground transition-colors"
            style={{ borderColor: regionColor }}
          >
            <ArrowUpLeft className="size-3" aria-hidden="true" />
            <span>Part of {event.parentEvent?.title ?? "a multi-day series"}</span>
          </Link>
        )}

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {isMultiDay && (
                <Tent
                  className="size-4 shrink-0"
                  style={{ color: regionColor }}
                  aria-hidden="true"
                />
              )}
              <h2 className="text-lg font-bold" suppressHydrationWarning>{headingDateStr}</h2>
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
            {event.kennel ? (
              <Link
                href={`/kennels/${event.kennel.slug}`}
                className="font-medium text-primary hover:underline"
              >
                {event.kennel.fullName}
              </Link>
            ) : null}
            {event.kennel && (
              <Badge variant="outline" className="text-xs">
                {event.kennel.region}
              </Badge>
            )}
            {event.status === "CANCELLED" && (
              <Badge variant="destructive">Cancelled</Badge>
            )}
            {event.status === "TENTATIVE" && (
              <Badge variant="outline">Tentative</Badge>
            )}
            {/* #1560 — series-parent + standalone date-range badges */}
            {isSeriesParent && childCount > 0 && (
              <Badge
                className="text-[10px] px-1.5 py-0 font-mono uppercase tracking-wider border-0"
                style={{ backgroundColor: `${regionColor}1a`, color: regionColor }}
              >
                + {childCount} trails
              </Badge>
            )}
            {hasDateRange && !isSeriesParent && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-dashed">
                Weekend
              </Badge>
            )}
          </div>
        </div>

        {/* Title */}
        {event.title && (
          <h3 className="text-base font-semibold">{event.title}</h3>
        )}

        {/* #1560 — series children mini-timeline. Renders right after the
            title so the umbrella's description (further down) sits below
            the at-a-glance schedule. Shared with the full umbrella detail
            page (`/hareline/[eventId]`) via `SeriesChildTimeline` — PR E.4. */}
        {isSeriesParent && childCount > 0 && (
          <SeriesChildTimeline
            childEvents={event.childEvents!}
            parentRegionColor={regionColor}
          />
        )}

        {/* Check-in */}
        <div className="flex items-center gap-2">
          <CheckInButton
            eventId={event.id}
            eventDate={event.date}
            isAuthenticated={!!isAuthenticated}
            attendance={attendance ?? null}
            eventContext={event.kennel ? {
              kennelShortName: event.kennel.shortName,
              runNumber: event.runNumber,
              date: event.date,
            } : undefined}
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
          {/* #890 — Trail length + Shiggy Level. Same Route/Flame icons
              and region tint as the card so the iconography users learn
              there carries through to the detail surface unchanged. */}
          {trailLengthDisplay && (
            <div>
              <dt className="font-medium text-muted-foreground">Trail Length</dt>
              <dd className="mt-0.5">
                <TrailLengthLine
                  text={trailLengthDisplay}
                  color={regionColor}
                  size="md"
                />
              </dd>
            </div>
          )}
          {event.difficulty != null && (
            <div>
              <dt className="font-medium text-muted-foreground">Shiggy Level</dt>
              <dd className="mt-0.5 flex items-center gap-2">
                <ShiggyLevelFlames level={event.difficulty} color={regionColor} size="md" />
                <span className="tabular-nums text-muted-foreground/70">
                  {event.difficulty}/5
                </span>
              </dd>
            </div>
          )}
          {/* #1316 — first-class trail type / dog-friendly / pre-lube fields.
              Used to be smashed into description as "Hash Cash: 5 | Trail: A to A | …" */}
          {event.cost && (
            <div>
              <dt className="font-medium text-muted-foreground">Hash Cash</dt>
              <dd>{event.cost}</dd>
            </div>
          )}
          {event.trailType && (
            <div>
              <dt className="font-medium text-muted-foreground">Trail Type</dt>
              <dd>{event.trailType}</dd>
            </div>
          )}
          {event.dogFriendly != null && (
            <div>
              <dt className="font-medium text-muted-foreground">Dog Friendly</dt>
              <dd>{event.dogFriendly ? "Yes 🐕" : "No"}</dd>
            </div>
          )}
          {event.prelube && (
            <div>
              <dt className="font-medium text-muted-foreground">Pre-lube</dt>
              <dd>{event.prelube}</dd>
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
                    {getFullLocationDisplay(event) ?? stripUrlsFromText(event.locationName)}
                  </a>
                ) : (
                  getFullLocationDisplay(event) ?? stripUrlsFromText(event.locationName)
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
            regionHint={event.kennel?.region ?? undefined}
          />
        )}

        {/* Description */}
        {event.description && (
          <div>
            <h4 className="mb-1 text-sm font-medium text-muted-foreground">
              Description
            </h4>
            <p className="whitespace-pre-wrap text-sm">{stripMarkdown(event.description)}</p>
          </div>
        )}
      </CardContent>

      {/* Pinned action footer */}
      <div className="flex flex-wrap gap-2 border-t px-5 py-3">
        <CalendarExportButton event={{ ...event, kennel: event.kennel ?? { shortName: "" } }} />
        {event.sourceUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">
              {getLabelForUrl(event.sourceUrl)}
            </a>
          </Button>
        )}
        {event.eventLinks?.map((link) => (
          <Button key={link.id} variant="outline" size="sm" asChild>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              {getLabelForUrl(link.url, link.label)}
            </a>
          </Button>
        ))}
        {event.kennel && (
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
        )}
      </div>
    </Card>
  );
}
