import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getOrCreateUser, getAdminUser, getMismanUserForEvent } from "@/lib/auth";
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
import { REGION_CENTROIDS } from "@/lib/geo";
import { InfoPopover } from "@/components/ui/info-popover";
import { RestoreEventButton } from "@/components/admin/RestoreEventButton";
import { stripMarkdown, stripUrlsFromText, formatRelativeTime } from "@/lib/format";
import { getFullLocationDisplay } from "@/lib/event-display";
import { buildEventJsonLd, safeJsonLd } from "@/lib/seo";
import { getCanonicalSiteUrl } from "@/lib/site-url";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      kennel: { select: { shortName: true, fullName: true } },
      hares: { select: { hareName: true }, take: 5 },
    },
  });
  if (!event) return { title: "Event · HashTracks" };
  const dateStr = event.date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const title = `${dateStr} · ${event.kennel.shortName} · HashTracks`;

  const parts: string[] = [`${event.kennel.fullName ?? event.kennel.shortName} — ${dateStr}`];
  if (event.runNumber) parts[0] += ` · Run #${event.runNumber}`;
  if (event.title) parts.push(event.title);
  if (event.locationName) parts.push(event.locationName);
  if (event.hares.length > 0) {
    const names = event.hares.map((h) => h.hareName).join(", ");
    parts.push(`Hares: ${names}`);
  } else if (event.haresText) {
    parts.push(`Hares: ${event.haresText}`);
  }
  const raw = parts.join(". ");
  const description = raw.length > 200
    ? raw.slice(0, raw.lastIndexOf(" ", 200)) + "..."
    : raw;

  const baseUrl = getCanonicalSiteUrl();
  return {
    title,
    description,
    alternates: { canonical: `${baseUrl}/hareline/${eventId}` },
    openGraph: { title, description },
  };
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ from?: string; slug?: string }>;
}) {
  const { eventId } = await params;
  const { from, slug: fromSlug } = await searchParams;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      kennel: {
        select: { shortName: true, fullName: true, slug: true, region: true },
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

  const [confirmedCount, goingCount, stravaResult, mismanUser, adminUser] = await Promise.all([
    prisma.attendance.count({ where: { eventId, status: "CONFIRMED" } }),
    prisma.attendance.count({ where: { eventId, status: "INTENDING" } }),
    user ? getStravaConnection() : Promise.resolve(null),
    // #1023 step 5: scan all kennels on the event so secondary co-host
    // mismans get the misman UI, not just the primary kennel's misman.
    user ? getMismanUserForEvent(event.id) : Promise.resolve(null),
    event.status === "CANCELLED" ? getAdminUser() : Promise.resolve(null),
  ]);

  const stravaConnected = stravaResult?.success ? stravaResult.connected : false;
  const isMisman = !!mismanUser;
  const isAdmin = !!adminUser;

  // Fetch weather forecast for upcoming events (0–10 days out).
  // Compare at the calendar-day level (midnight UTC) to avoid off-by-one from UTC noon storage.
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const eventDay = new Date(event.date);
  eventDay.setUTCHours(0, 0, 0, 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysUntil = Math.round((eventDay.getTime() - today.getTime()) / MS_PER_DAY);
  const weatherLat = event.latitude ?? REGION_CENTROIDS[event.kennel.region]?.lat ?? null;
  const weatherLng = event.longitude ?? REGION_CENTROIDS[event.kennel.region]?.lng ?? null;
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

  const breadcrumbDate = event.date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  const hasLocation =
    (event.latitude != null && event.longitude != null) || !!event.locationName;

  function getAttendancePrompt(eventDate: Date, status: string | null): string {
    // Compare at UTC noon to match date storage convention (Appendix F.4)
    const now = new Date();
    const todayNoon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
    const isPast = eventDate.getTime() < todayNoon;
    if (isPast) {
      if (status === "CONFIRMED") return "You attended this run.";
      if (status === "INTENDING") return "Confirm your attendance after the run.";
      return "Log that you were at this run.";
    }
    if (status === "INTENDING") return "You\u2019ve RSVP\u2019d for this run.";
    return "Let others know you plan to attend.";
  }

  const baseUrl = getCanonicalSiteUrl();
  const eventJsonLd = buildEventJsonLd(
    {
      id: event.id,
      date: event.date,
      startTime: event.startTime,
      timezone: event.timezone,
      title: event.title,
      description: event.description,
      locationName: event.locationName,
      locationStreet: event.locationStreet,
      latitude: event.latitude,
      longitude: event.longitude,
      status: event.status,
    },
    {
      shortName: event.kennel.shortName,
      fullName: event.kennel.fullName ?? event.kennel.shortName,
      slug: event.kennel.slug,
      region: event.kennel.region,
    },
    baseUrl,
  );

  return (
    <div className="space-y-6">
      {/* JSON-LD for Google Event rich result. safeJsonLd() escapes </script>
          sequences to prevent XSS from DB-sourced strings — see src/lib/seo.ts. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(eventJsonLd) }}
      />
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        {from === "logbook" ? (
          <Link href="/logbook" className="hover:text-foreground">My Logbook</Link>
        ) : from === "kennel" && fromSlug ? (
          <Link href={`/kennels/${fromSlug}`} className="hover:text-foreground">{event.kennel.shortName}</Link>
        ) : (
          <Link href="/hareline" className="hover:text-foreground">Hareline</Link>
        )}
        <span>/</span>
        <span className="text-foreground">{event.kennel.shortName} — {breadcrumbDate}</span>
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
          <Badge>{event.kennel.region}</Badge>
          {event.status === "CANCELLED" && (
            <Badge variant="destructive">Cancelled</Badge>
          )}
          {event.status === "TENTATIVE" && (
            <Badge variant="outline">Tentative</Badge>
          )}
          {(event.status === "CANCELLED" || event.status === "TENTATIVE") && (
            <span className="text-xs text-muted-foreground">·</span>
          )}
          <span className={`text-xs ${Date.now() - event.updatedAt.getTime() >= 7 * 86_400_000 ? "text-amber-500" : "text-muted-foreground"}`}>
            Updated {formatRelativeTime(event.updatedAt)}
          </span>
        </div>
      </div>

      {/* Event title */}
      {event.title && (
        <h2 className="text-xl font-semibold">{event.title}</h2>
      )}

      {/* Check-in */}
      <div>
        <div className="flex items-center gap-3">
          <CheckInButton
            eventId={event.id}
            eventDate={event.date.toISOString()}
            isAuthenticated={!!user}
            attendance={attendance}
            stravaConnected={stravaConnected}
            eventContext={{
              kennelShortName: event.kennel.shortName,
              runNumber: event.runNumber,
              date: event.date.toISOString(),
            }}
          />
          {(confirmedCount > 0 || goingCount > 0) && (
            <div className="flex items-center gap-1.5">
              {confirmedCount > 0 && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {confirmedCount} checked in
                </Badge>
              )}
              {goingCount > 0 && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {goingCount} going
                </Badge>
              )}
            </div>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {getAttendancePrompt(event.date, attendance?.status ?? null)}
        </p>
      </div>

      {/* Side-by-side: detail fields + description (left) | map (right) */}
      <div className={`grid grid-cols-1 gap-0 ${hasLocation ? "md:grid-cols-[3fr_2fr] rounded-xl border overflow-hidden" : ""}`}>
            {/* Left column: detail fields + description */}
            <div className={`space-y-4 ${hasLocation ? "p-5 md:p-6" : ""}`}>
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
                        {getFullLocationDisplay(event) ?? stripUrlsFromText(event.locationName)}
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
                  <p className="whitespace-pre-wrap">{stripMarkdown(event.description)}</p>
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
                regionHint={event.kennel.region}
                imgClassName="h-64 md:h-full md:min-h-64 md:rounded-none"
              />
            )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isMisman && (
          <Button variant="outline" size="sm" asChild>
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
        {isAdmin && event.status === "CANCELLED" && (
          <RestoreEventButton eventId={event.id} />
        )}
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
