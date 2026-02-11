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
    },
  });

  if (!event) notFound();

  // Query current user + their attendance for this event
  const user = await getOrCreateUser();
  let attendance: { id: string; participationLevel: string; stravaUrl: string | null; notes: string | null } | null = null;

  if (user) {
    const record = await prisma.attendance.findUnique({
      where: { userId_eventId: { userId: user.id, eventId } },
      select: { id: true, participationLevel: true, stravaUrl: true, notes: true },
    });
    if (record) {
      attendance = { ...record, participationLevel: record.participationLevel as string };
    }
  }

  const attendanceCount = await prisma.attendance.count({
    where: { eventId },
  });

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
        {attendanceCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {attendanceCount} {attendanceCount === 1 ? "hasher" : "hashers"} checked in
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
        {event.haresText && (
          <DetailItem label="Hares" value={event.haresText} />
        )}
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
