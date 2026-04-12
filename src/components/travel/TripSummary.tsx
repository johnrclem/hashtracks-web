"use client";

import { Heart, Share2, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateCompact, daysBetween } from "@/lib/travel/format";

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
  const startFormatted = formatDateCompact(startDate);
  const endFormatted = formatDateCompact(endDate);
  const days = daysBetween(startDate, endDate);
  const tzAbbrev = timezone?.split("/").pop()?.replace(/_/g, " ");

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

      <div className="mt-4 flex items-center gap-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <span>{startFormatted} → {endFormatted}</span>
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

