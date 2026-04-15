"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Heart,
  Share2,
  Calendar as CalendarIcon,
  BadgeCheck,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateCompact, daysBetween } from "@/lib/travel/format";
import { buildIcsContent } from "@/lib/calendar";
import { capture } from "@/lib/analytics";
import { saveTravelSearch } from "@/app/travel/actions";

/** Minimal shape required to build a VEVENT from a confirmed search result. */
export interface ExportableConfirmedEvent {
  date: string;
  startTime: string | null;
  timezone: string | null;
  title: string | null;
  runNumber: number | null;
  haresText: string | null;
  locationName: string | null;
  sourceUrl: string | null;
  kennelName: string;
}

interface TripSummaryProps {
  destination: string;
  startDate: string;
  endDate: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  timezone?: string;
  isAuthenticated: boolean;
  confirmedCount: number;
  likelyCount: number;
  possibleCount: number;
  /** Confirmed events in the current result set — used for Export Calendar .ics generation. */
  confirmedEvents: ExportableConfirmedEvent[];
}

export function TripSummary({
  destination,
  startDate,
  endDate,
  latitude,
  longitude,
  radiusKm,
  timezone,
  isAuthenticated,
  confirmedCount,
  likelyCount,
  possibleCount,
  confirmedEvents,
}: TripSummaryProps) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [savedId, setSavedId] = useState<string | null>(null);

  const startFormatted = formatDateCompact(startDate, { withWeekday: true });
  const endFormatted = formatDateCompact(endDate, { withWeekday: true });
  const days = daysBetween(startDate, endDate);

  const handleSave = () => {
    capture("travel_save_clicked", { isAuthenticated });
    if (!isAuthenticated) {
      capture("travel_auth_prompt_shown", {});
      // Preserve the current search URL + signal auto-save to run post-auth.
      // The /travel page detects `saved=1` on mount and invokes
      // saveTravelSearch itself, so Clerk's redirect back to this URL
      // completes the round-trip without the user clicking Save again.
      const here = new URL(window.location.href);
      here.searchParams.set("saved", "1");
      const redirectUrl = here.pathname + here.search;
      router.push(
        `/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`,
      );
      return;
    }

    startSave(async () => {
      const result = await saveTravelSearch({
        label: destination,
        latitude,
        longitude,
        radiusKm,
        startDate,
        endDate,
        timezone,
      });
      if ("success" in result && result.success) {
        setSavedId(result.id);
        capture("travel_saved_search_created", {
          destination,
          dateRangeDays: daysBetween(startDate, endDate),
        });
        toast.success("Saved to your trips", {
          description: "View all your saved trips any time.",
        });
      } else {
        toast.error("Couldn't save this trip", {
          description: "error" in result ? result.error : "Please try again.",
        });
      }
    });
  };

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      capture("travel_share_clicked", { destination });
      toast.success("Link copied", {
        description: "Share it with your hasher friends.",
      });
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const handleExport = () => {
    if (confirmedEvents.length === 0) return;
    const ics = buildMultiEventIcs(confirmedEvents);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugifyForFilename(destination)}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    capture("travel_calendar_exported", {
      destination,
      eventCount: confirmedEvents.length,
    });
  };

  return (
    <section className="mt-8 border-b border-border pb-8">
      <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-5xl">
        {destination}
      </h1>

      <span
        className="mt-4 block h-0.5 w-28 rounded-full bg-gradient-to-r from-emerald-500 to-sky-500"
        aria-hidden="true"
      />

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
                {" "}
                and{" "}
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
        {destination && (
          <>
            <span>·</span>
            <span>{destination}</span>
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {savedId ? (
          <Button asChild variant="default" size="sm" className="gap-2">
            <Link href="/travel/saved">
              <BadgeCheck className="h-4 w-4" />
              Saved — view all trips
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            className="gap-2"
            onClick={handleSave}
            disabled={isSaving}
          >
            <Heart className="h-4 w-4" />
            {isSaving ? "Saving…" : "Save Trip"}
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-2" onClick={handleShare}>
          <Share2 className="h-4 w-4" />
          Share
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={confirmedCount === 0}
          onClick={handleExport}
        >
          <CalendarIcon className="h-4 w-4" />
          Export Calendar
        </Button>
      </div>
    </section>
  );
}

/**
 * Combine N events into a single VCALENDAR. `buildIcsContent` from
 * `src/lib/calendar.ts` already emits a complete VCALENDAR wrapping ONE
 * VEVENT; we extract the VEVENT blocks and fuse them into a single
 * calendar so users get one file with all their confirmed trails.
 */
function buildMultiEventIcs(events: ExportableConfirmedEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HashTracks//Travel//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events) {
    const single = buildIcsContent({
      title: e.title,
      date: e.date,
      startTime: e.startTime,
      timezone: e.timezone,
      haresText: e.haresText,
      locationName: e.locationName,
      sourceUrl: e.sourceUrl,
      kennel: { shortName: e.kennelName },
      runNumber: e.runNumber,
    });
    // Extract the inner VEVENT block. buildIcsContent wraps one VEVENT in
    // its own VCALENDAR — strip the envelope so we can fuse multiples.
    const match = /BEGIN:VEVENT[\s\S]*?END:VEVENT/.exec(single);
    if (match) lines.push(match[0]);
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function slugifyForFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    || "travel-trip";
}
