import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      date: true,
      kennel: { select: { shortName: true } },
    },
  });
  if (!event) return { title: "Event · HashTracks" };
  const dateStr = event.date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return { title: `${dateStr} · ${event.kennel.shortName} · HashTracks` };
}
import { getOrCreateUser, getMismanUser } from "@/lib/auth";
import { getStravaConnection } from "@/app/strava/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { CheckInButton } from "@/components/logbook/CheckInButton";
import { CalendarExportButton } from "@/components/hareline/CalendarExportButton";
import { EventLocationMap } from "@/components/hareline/EventLocationMap";
import { EventWeatherCard } from "@/components/hareline/EventWeatherCard";
import { EventTimeDisplay } from "@/components/hareline/EventTimeDisplay";
import { SourcesDropdown } from "@/components/hareline/SourcesDropdown";
import { getEventDayWeather } from "@/lib/weather";
import { REGION_DATA_SELECT } from "@/lib/types/region";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { InfoPopover } from "@/components/ui/info-popover";

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      kennel: {
        select: { shortName: true, fullName: true, slug: true, regionRef: { select: REGION_DATA_SELECT } },
      },
      hares: {
        select: {
          id: true,
          hareName: true,
          userId: true,
          role: true,
          sourceType: true,
          user: { select: { hashName: true } },
        },
        orderBy: { hareName: "asc" },
      },
      eventLinks: {
        select: { id: true, url: true, label: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!event) notFound();

  // Query current user + their attendance for this event
  const user = await getOrCreateUser();
  let attendance: { id: string; participationLevel: string; status: string; stravaUrl: string | null; notes: string | null } | null = null;

  if (user) {
    const record = await prisma.attendance.findUnique({
      where: { userId_eventId: { userId: user.id, eventId } },
      select: { id: true, participationLevel: true, status: true, stravaUrl: true, notes: true },
    });
    if (record) {
      attendance = { ...record, participationLevel: record.participationLevel as string, status: record.status as string };
    }
  }

  const [confirmedCount, goingCount, stravaResult, mismanUser] = await Promise.all([
    prisma.attendance.count({ where: { eventId, status: "CONFIRMED" } }),
    prisma.attendance.count({ where: { eventId, status: "INTENDING" } }),
    user ? getStravaConnection() : Promise.resolve(null),
    user ? getMismanUser(event.kennelId) : Promise.resolve(null),
  ]);

  const stravaConnected = stravaResult?.success ? stravaResult.connected : false;
  const isMisman = !!mismanUser;

  // Fetch weather forecast for upcoming events (0–10 days out).
  // Compare at the calendar-day level (midnight UTC) to avoid off-by-one from UTC noon storage.
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const eventDay = new Date(event.date);
  eventDay.setUTCHours(0, 0, 0, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysUntil = Math.round((eventDay.getTime() - today.getTime()) / MS_PER_DAY);
  const weatherLat = event.latitude ?? event.kennel.regionRef.centroidLat ?? null;
  const weatherLng = event.longitude ?? event.kennel.regionRef.centroidLng ?? null;
  const weather =
    daysUntil >= 0 && daysUntil <= 10 && weatherLat != null && weatherLng != null
      ? await getEventDayWeather(weatherLat, weatherLng, event.date).catch(() => null)
      : null;

  const dateFormatted = event.date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const hasLocation =
    (event.latitude != null && event.longitude != null) || !!event.locationName;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/hareline" className="hover:text-foreground">
          Hareline
        </Link>
        <span>/</span>
        <span className="text-foreground">Event Detail</span>
      </nav>

      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{dateFormatted}</h1>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/kennels/${event.kennel.slug}`}
            className="text-lg font-medium text-primary hover:underline"
          >
            {event.kennel.fullName}
          </Link>
          <InfoPopover title="Data source">
            Event details are pulled from public sources. Always confirm with your kennel.
          </InfoPopover>
          <RegionBadge regionData={event.kennel.regionRef} />
          {event.status === "CANCELLED" && (
            <Badge variant="destructive">Cancelled</Badge>
          )}
          {event.status === "TENTATIVE" && (
            <Badge variant="outline">Tentative</Badge>
          )}
        </div>
      </div>

      {/* Event title */}
      {event.title && (
        <h2 className="text-xl font-semibold">{event.title}</h2>
      )}

      {/* Check-in */}
      <div className="flex items-center gap-3">
        <CheckInButton
          eventId={event.id}
          eventDate={event.date.toISOString()}
          isAuthenticated={!!user}
          attendance={attendance}
          stravaConnected={stravaConnected}
        />
        {(confirmedCount > 0 || goingCount > 0) && (
          <span className="text-sm text-muted-foreground">
            {confirmedCount > 0 && `${confirmedCount} checked in`}
            {confirmedCount > 0 && goingCount > 0 && " · "}
            {goingCount > 0 && `${goingCount} going`}
          </span>
        )}
      </div>

      {/* Side-by-side: detail fields + description (left) | map (right) */}
      <div className={`grid grid-cols-1 gap-6 ${hasLocation ? "md:grid-cols-[3fr_2fr]" : ""}`}>
            {/* Left column: detail fields + description */}
            <div className="space-y-4">
              <dl className="grid gap-4 sm:grid-cols-2">
                {event.runNumber && (
                  <DetailItem label="Run Number" value={`#${event.runNumber}`} />
                )}
                {event.startTime && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Start Time</dt>
                    <dd className="mt-0.5">
                      <EventTimeDisplay
                        startTime={event.startTime}
                        date={event.date.toISOString()}
                        timezone={event.timezone}
                      />
                    </dd>
                  </div>
                )}
                {event.hares.length > 0 ? (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Hares</dt>
                    <dd className="mt-0.5 flex flex-wrap gap-1">
                      {event.hares.map((hare) => (
                        <span key={hare.id} className="inline-flex items-center">
                          {hare.userId ? (
                            <Link
                              href={`/hashers/${hare.userId}`}
                              className="text-primary hover:underline"
                            >
                              {hare.hareName}
                            </Link>
                          ) : (
                            <span>{hare.hareName}</span>
                          )}
                          {hare.role !== "HARE" && (
                            <span className="ml-0.5 text-xs text-muted-foreground">
                              ({hare.role === "CO_HARE" ? "Co-Hare" : "Live"})
                            </span>
                          )}
                        </span>
                      ))}
                    </dd>
                  </div>
                ) : event.haresText ? (
                  <DetailItem label="Hares" value={event.haresText} />
                ) : null}
                {event.locationName && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Location</dt>
                    <dd className="mt-0.5">
                      <a
                        href={
                          event.locationAddress && /^https?:\/\//.test(event.locationAddress)
                            ? event.locationAddress
                            : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationName)}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {event.locationName}
                      </a>
                    </dd>
                  </div>
                )}
                {weather && (
                  <div className="sm:col-span-2">
                    <EventWeatherCard weather={weather} />
                  </div>
                )}
              </dl>
              {event.description && (
                <div>
                  <h2 className="mb-1 text-sm font-medium text-muted-foreground">
                    Description
                  </h2>
                  <p className="whitespace-pre-wrap">{event.description}</p>
                </div>
              )}
            </div>

            {/* Right column: map */}
            {hasLocation && (
              <EventLocationMap
                lat={event.latitude ?? undefined}
                lng={event.longitude ?? undefined}
                locationName={event.locationName ?? undefined}
                locationAddress={event.locationAddress ?? undefined}
                imgClassName="h-64 md:h-full md:min-h-64"
              />
            )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isMisman && (
          <Button size="sm" asChild>
            <Link href={`/misman/${event.kennel.slug}/attendance/${event.id}`}>
              Take Attendance
            </Link>
          </Button>
        )}
        <CalendarExportButton event={{ ...event, date: event.date.toISOString(), kennel: event.kennel }} />
        <SourcesDropdown sourceUrl={event.sourceUrl} eventLinks={event.eventLinks} />
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
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
