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
  ChevronDown,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateCompact, daysBetween } from "@/lib/travel/format";
import { buildMultiEventIcs } from "@/lib/calendar";
import { capture } from "@/lib/analytics";
import { stashSaveIntent } from "@/lib/travel/save-intent";
import {
  deleteTravelSearch,
  saveTravelSearch,
} from "@/app/travel/actions";

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
  /** SSR-computed: id of an existing saved trip matching these params, or null. */
  initialSavedId: string | null;
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
  initialSavedId,
  confirmedCount,
  likelyCount,
  possibleCount,
  confirmedEvents,
}: TripSummaryProps) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [isMutating, startMutation] = useTransition();
  const [savedId, setSavedId] = useState<string | null>(initialSavedId);

  const startFormatted = formatDateCompact(startDate, { withWeekday: true });
  const endFormatted = formatDateCompact(endDate, { withWeekday: true });
  const days = daysBetween(startDate, endDate);

  const handleSave = () => {
    capture("travel_save_clicked", { isAuthenticated });
    if (!isAuthenticated) {
      capture("travel_auth_prompt_shown", {});
      // Stash the save intent in sessionStorage so TravelAutoSave can
      // verify on return — a bare ?saved=1 in a crafted or shared URL
      // without a matching intent must NOT trigger a write.
      stashSaveIntent({
        label: destination,
        latitude,
        longitude,
        radiusKm,
        startDate,
        endDate,
        timezone,
      });
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

  const handleUpdate = () => {
    if (!savedId) return;
    startMutation(async () => {
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
        // saveTravelSearch allows duplicates (v1 scope), so a new id comes
        // back. Track that id as the "current" saved record for this trip.
        setSavedId(result.id);
        capture("travel_saved_search_updated", {});
        toast.success("Trip updated", {
          description: "This trip is saved with the latest search params.",
        });
      } else {
        toast.error("Couldn't update this trip", {
          description: "error" in result ? result.error : "Please try again.",
        });
      }
    });
  };

  const handleRemove = () => {
    if (!savedId) return;
    startMutation(async () => {
      const result = await deleteTravelSearch(savedId);
      if ("success" in result && result.success) {
        setSavedId(null);
        capture("travel_saved_search_removed", {});
        toast.success("Removed from saved trips");
      } else {
        toast.error("Couldn't remove this trip", {
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
    const ics = buildMultiEventIcs(
      confirmedEvents.map((e) => ({
        title: e.title,
        date: e.date,
        startTime: e.startTime,
        timezone: e.timezone,
        haresText: e.haresText,
        locationName: e.locationName,
        sourceUrl: e.sourceUrl,
        kennel: { shortName: e.kennelName },
        runNumber: e.runNumber,
      })),
    );
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
          <SavedStateButton
            isMutating={isMutating}
            onUpdate={handleUpdate}
            onRemove={handleRemove}
          />
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
 * Split button for the Saved state: outlined-badge primary reads as status,
 * chevron trigger reveals Update/Remove actions. Distinct from the filled
 * primary "Save Trip" CTA so a user scanning the card can tell at a glance
 * whether this trip is already saved.
 */
function SavedStateButton({
  isMutating,
  onUpdate,
  onRemove,
}: {
  isMutating: boolean;
  onUpdate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="inline-flex items-stretch rounded-md border border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300">
      <Link
        href="/travel/saved"
        className="
          inline-flex items-center gap-2 rounded-l-md pl-3 pr-2.5
          text-sm font-medium transition-colors
          hover:bg-emerald-500/10
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10
        "
      >
        <BadgeCheck className="h-4 w-4" />
        <span>
          Saved <span className="text-muted-foreground/60">·</span> Your trips
        </span>
        <ArrowRight className="h-3 w-3" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Saved trip actions"
            disabled={isMutating}
            className="
              flex items-center justify-center rounded-r-md border-l border-emerald-500/30
              px-2 transition-colors hover:bg-emerald-500/10
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-10
              disabled:opacity-50
            "
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onUpdate} disabled={isMutating}>
            <RefreshCw className="h-3.5 w-3.5" />
            Update with current params
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onRemove}
            disabled={isMutating}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove from saved
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function slugifyForFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    || "travel-trip";
}
