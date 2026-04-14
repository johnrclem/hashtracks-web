"use client";

import { Heart, Share2, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateCompact, daysBetween } from "@/lib/travel/format";
import { getTimezoneAbbreviation } from "@/lib/timezone";

interface TripSummaryProps {
  destination: string;
  startDate: string;
  endDate: string;
  timezone?: string;
  confirmedCount: number;
  likelyCount: number;
  possibleCount: number;
}

export function TripSummary({
  destination,
  startDate,
  endDate,
  timezone,
  confirmedCount,
  likelyCount,
  possibleCount,
}: TripSummaryProps) {
  const startFormatted = formatDateCompact(startDate, { withWeekday: true });
  const endFormatted = formatDateCompact(endDate, { withWeekday: true });
  const days = daysBetween(startDate, endDate);
  // Real "EDT" / "PST" abbreviation, derived from the destination's IANA tz
  // at the trip start date so DST is handled correctly. Previous impl just
  // pulled the IANA city segment ("New_York") which produced misleading
  // text like "NEW YORK" for a Boston search.
  const tzAbbrev = timezone
    ? getTimezoneAbbreviation(new Date(startDate + "T12:00:00Z"), timezone)
    : "";

  const handleShare = () => {
    void navigator.clipboard.writeText(window.location.href);
    // TODO: toast notification
  };

  return (
    <section className="mt-8 border-b border-border pb-8">
      <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-5xl">
        {destination}
      </h1>

      {/* Pin-color accent rule */}
      <span className="mt-4 block h-0.5 w-28 rounded-full bg-gradient-to-r from-emerald-500 to-sky-500" aria-hidden="true" />

      <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
        {confirmedCount + likelyCount + possibleCount === 0 ? (
          "Searching for trails during your stay…"
        ) : (
          <>
            You&apos;ll catch{" "}
            <strong className="font-display font-semibold text-foreground">
              {confirmedCount} confirmed trail{confirmedCount !== 1 ? "s" : ""}
            </strong>
            {likelyCount > 0 && (
              <>
                {" "}and{" "}
                <strong className="font-display font-semibold text-foreground">
                  {likelyCount} likely
                </strong>
              </>
            )}
            {" "}over {days} day{days !== 1 ? "s" : ""}.
          </>
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <span>{startFormatted} → {endFormatted}</span>
        <span>·</span>
        <span>{days} night{days !== 1 ? "s" : ""}</span>
        {tzAbbrev && (
          <>
            <span>·</span>
            <span>{tzAbbrev}</span>
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="default" size="sm" className="gap-2">
          <Heart className="h-4 w-4" />
          Save Trip
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleShare}>
          <Share2 className="h-4 w-4" />
          Share
        </Button>
        <Button variant="outline" size="sm" className="gap-2" disabled={confirmedCount === 0}>
          <CalendarIcon className="h-4 w-4" />
          Export Calendar
        </Button>
      </div>
    </section>
  );
}

