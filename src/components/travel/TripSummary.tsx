"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Heart,
  Share2,
  Calendar as CalendarIcon,
  BadgeCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  /** What the user typed in the URL before the closed-tier snap; triggers the RADIUS ADJUSTED badge when it differs from radiusKm. */
  requestedRadiusKm?: number;
  /** Effective radius after the broader-region fallback; triggers the ROUTING REVISED badge when larger than radiusKm. */
  effectiveRadiusKm?: number;
  timezone?: string;
  isAuthenticated: boolean;
  initialSavedId: string | null;
  confirmedCount: number;
  likelyCount: number;
  possibleCount: number;
  /** True when the result is a coverage gap; disables Save. */
  noCoverage?: boolean;
  confirmedEvents: ExportableConfirmedEvent[];
}

export function TripSummary({
  destination,
  startDate,
  endDate,
  latitude,
  longitude,
  radiusKm,
  requestedRadiusKm,
  effectiveRadiusKm,
  timezone,
  isAuthenticated,
  initialSavedId,
  confirmedCount,
  likelyCount,
  possibleCount,
  noCoverage,
  confirmedEvents,
}: Readonly<TripSummaryProps>) {
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [isMutating, startMutation] = useTransition();
  const [savedId, setSavedId] = useState<string | null>(initialSavedId);

  // SSR re-runs findExistingSavedSearch on URL change and passes a new
  // initialSavedId, but useState's initializer only fires on mount. Without
  // this sync the chip stays "Saved" after the user edits dates, surfacing
  // a stale match-state to a chip that's now lying about which trip it's
  // tied to.
  useEffect(() => {
    setSavedId(initialSavedId);
  }, [initialSavedId]);

  const startFormatted = formatDateCompact(startDate, { withWeekday: true });
  const endFormatted = formatDateCompact(endDate, { withWeekday: true });
  const days = daysBetween(startDate, endDate);
  const totalCount = confirmedCount + likelyCount + possibleCount;
  // Two distinct revisions: the requested radius was clamped to the closed
  // tier enum (snap-down), and/or the broader-region fallback expanded
  // beyond the input radius (expand-up). Per design, ROUTING REVISED wins
  // visually when both fire because the broader-region change is the more
  // user-impactful one.
  const radiusSnapped =
    requestedRadiusKm != null && requestedRadiusKm !== radiusKm;
  const broaderExpanded =
    effectiveRadiusKm != null && effectiveRadiusKm > radiusKm;
  const radiusToShow = effectiveRadiusKm ?? radiusKm;
  const showProjectionGapHint =
    confirmedCount > 0 && likelyCount === 0 && possibleCount === 0;

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

  const handleRemove = () => {
    if (!savedId) return;
    startMutation(async () => {
      const result = await deleteTravelSearch(savedId);
      if ("success" in result && result.success) {
        setSavedId(null);
        capture("travel_saved_search_removed", {});
        // Undo re-saves with current params — creates a fresh TravelSearch
        // row (new id, new createdAt) since the soft-deleted row isn't
        // restored. Dashboards sort by lastViewedAt, so the new row lands
        // where users expect it. Trade-off accepted vs adding a dedicated
        // restoreTravelSearch action just for this affordance.
        toast.success("Removed from saved trips", {
          action: {
            label: "Undo",
            onClick: handleSave,
          },
        });
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
      {broaderExpanded ? (
        <p
          className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400"
          aria-label="Search radius was automatically expanded to find results"
        >
          ◆ Routing revised
        </p>
      ) : radiusSnapped ? (
        <p
          className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber-600 dark:text-amber-400"
          aria-label="Requested radius was adjusted to the nearest supported tier"
        >
          ◇ Radius adjusted
        </p>
      ) : null}

      <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-5xl">
        {destination}
      </h1>

      <span
        className="mt-4 block h-0.5 w-28 rounded-full bg-gradient-to-r from-emerald-500 to-sky-500"
        aria-hidden="true"
      />

      {totalCount > 0 && (
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
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
          {" "}within a {radiusToShow} km radius, over {days} day
          {days !== 1 ? "s" : ""}.
        </p>
      )}

      {showProjectionGapHint && (
        <p className="mt-2 max-w-xl text-sm italic leading-relaxed text-muted-foreground/70">
          No schedule patterns indexed for these kennels yet — only posted
          events shown.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        <span>{startFormatted} → {endFormatted}</span>
        <span>·</span>
        <span>{days} night{days !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span>
          {radiusSnapped && (
            <>
              <s className="opacity-50">{requestedRadiusKm} km</s>
              {" → "}
            </>
          )}
          {broaderExpanded ? (
            <>
              <s className="opacity-50">{radiusKm} km</s>
              {" → "}
              {effectiveRadiusKm} km
            </>
          ) : (
            <>{radiusKm} km</>
          )}
        </span>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {savedId ? (
          <SavedBadge isMutating={isMutating} onRemove={handleRemove} />
        ) : (
          <SaveButton
            isSaving={isSaving}
            noCoverage={noCoverage === true}
            onSave={handleSave}
          />
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

function SaveButton({
  isSaving,
  noCoverage,
  onSave,
}: {
  isSaving: boolean;
  noCoverage: boolean;
  onSave: () => void;
}) {
  const button = (
    <Button
      variant="default"
      size="sm"
      className="gap-2"
      onClick={onSave}
      disabled={isSaving || noCoverage}
    >
      <Heart className="h-4 w-4" />
      {isSaving ? "Saving…" : "Save Trip"}
    </Button>
  );

  if (!noCoverage) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-center">
          Nothing to save yet. Suggest a kennel here and we&apos;ll add coverage.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Single-toggle Saved state. Click unsaves with a sonner Undo affordance —
 * one affordance, one decision, mirroring Spotify/Twitter's heart pattern.
 * Trip-management (rename, edit dates, etc.) lives on /travel/saved; this
 * chip is purely a save-state indicator on the results page.
 */
function SavedBadge({
  isMutating,
  onRemove,
}: {
  isMutating: boolean;
  onRemove: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onRemove}
      disabled={isMutating}
      aria-label="Remove from saved trips"
      className="
        gap-2 border-emerald-500/40 bg-emerald-500/5 text-emerald-700
        hover:bg-emerald-500/10 hover:text-emerald-700
        dark:text-emerald-300 dark:hover:text-emerald-300
        disabled:opacity-50
      "
    >
      <BadgeCheck className="h-4 w-4" />
      Saved
    </Button>
  );
}

function slugifyForFilename(s: string): string {
  // Two anchored single-direction trims instead of `/^-+|-+$/g` — SonarCloud
  // flagged the alternation as super-linear-backtracking-prone (a low-risk
  // ReDoS hotspot since input is the user's destination string, but worth
  // closing). The replacement preserves the same output for all inputs.
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 60)
    || "travel-trip";
}
