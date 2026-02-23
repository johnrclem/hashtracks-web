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
import { getOrCreateUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";
import { CheckInButton } from "@/components/logbook/CheckInButton";
import { CalendarExportButton } from "@/components/hareline/CalendarExportButton";
import { EventLocationMap } from "@/components/hareline/EventLocationMap";

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

  const [confirmedCount, goingCount] = await Promise.all([
    prisma.attendance.count({ where: { eventId, status: "CONFIRMED" } }),
    prisma.attendance.count({ where: { eventId, status: "INTENDING" } }),
  ]);

  const dateFormatted = event.date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

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
          <Badge>{event.kennel.region}</Badge>
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
        />
        {(confirmedCount > 0 || goingCount > 0) && (
          <span className="text-sm text-muted-foreground">
            {confirmedCount > 0 && `${confirmedCount} checked in`}
            {confirmedCount > 0 && goingCount > 0 && " · "}
            {goingCount > 0 && `${goingCount} going`}
          </span>
        )}
      </div>

      {/* Details grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {event.runNumber && (
          <DetailItem label="Run Number" value={`#${event.runNumber}`} />
        )}
        {event.startTime && (
          <DetailItem label="Start Time" value={formatTime(event.startTime)} />
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
      </div>

      {event.latitude && event.longitude && (
        <EventLocationMap
          lat={event.latitude}
          lng={event.longitude}
          locationName={event.locationName}
          locationAddress={event.locationAddress}
        />
      )}

      {event.description && (
        <div>
          <h2 className="mb-1 text-sm font-medium text-muted-foreground">
            Description
          </h2>
          <p className="whitespace-pre-wrap">{event.description}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <CalendarExportButton event={{ ...event, date: event.date.toISOString(), kennel: event.kennel }} />
        {event.sourceUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer">
              View Original Source
            </a>
          </Button>
        )}
        {event.eventLinks.map((link) => (
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
