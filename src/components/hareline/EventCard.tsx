"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";

export type HarelineEvent = {
  id: string;
  date: string; // ISO string
  kennelId: string;
  kennel: {
    id: string;
    shortName: string;
    fullName: string;
    slug: string;
    region: string;
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

interface EventCardProps {
  event: HarelineEvent;
  density: "medium" | "compact";
}

export function EventCard({ event, density }: EventCardProps) {
  if (density === "compact") {
    return (
      <Link href={`/hareline/${event.id}`} className="block">
        <div className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50">
          <span className="w-24 shrink-0 font-medium">
            {formatDate(event.date)}
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
          {event.runNumber && (
            <span className="w-12 shrink-0 text-muted-foreground">
              #{event.runNumber}
            </span>
          )}
          <span className="truncate text-muted-foreground">
            {event.haresText || event.title || ""}
          </span>
          {event.startTime && (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatTime(event.startTime)}
            </span>
          )}
        </div>
      </Link>
    );
  }

  return (
    <Link href={`/hareline/${event.id}`} className="block">
      <Card className="transition-colors hover:border-foreground/20">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{formatDate(event.date)}</span>
                <Badge variant="secondary" className="text-xs">
                  {getDayOfWeek(event.date)}
                </Badge>
                {event.startTime && (
                  <span className="text-xs text-muted-foreground">
                    {formatTime(event.startTime)}
                  </span>
                )}
                {event.status === "CANCELLED" && (
                  <Badge variant="destructive" className="text-xs">
                    Cancelled
                  </Badge>
                )}
                {event.status === "TENTATIVE" && (
                  <Badge variant="outline" className="text-xs">
                    Tentative
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/kennels/${event.kennel.slug}`}
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {event.kennel.shortName}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>{event.kennel.fullName}</TooltipContent>
                </Tooltip>
                <Badge variant="outline" className="text-xs">
                  {event.kennel.region}
                </Badge>
                {event.runNumber && (
                  <span className="text-sm text-muted-foreground">
                    Run #{event.runNumber}
                  </span>
                )}
              </div>

              {event.title && (
                <p className="text-sm text-muted-foreground">{event.title}</p>
              )}

              {event.haresText && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Hares: </span>
                  {event.haresText}
                </p>
              )}

              {event.locationName && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Location: </span>
                  <a
                    href={
                      event.locationAddress && /^https?:\/\//.test(event.locationAddress)
                        ? event.locationAddress
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.locationName)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {event.locationName}
                  </a>
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
