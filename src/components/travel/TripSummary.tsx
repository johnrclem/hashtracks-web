"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { formatDateCompact, daysBetween, cityToIata } from "@/lib/travel/format";
import { buildMultiEventIcs } from "@/lib/calendar";
import { capture } from "@/lib/analytics";
import { stashSaveIntent } from "@/lib/travel/save-intent";
import {
  deleteTravelSearch,
  restoreTravelSearch,
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

/** Per-leg shape used when rendering the multi-stop ITINERARY hero. */
export interface TripSummaryLeg {
  label: string;
  startDate: string;
  endDate: string;
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
  /**
   * Which projection tier the search fell into:
   *   "all"  — within 180d, all projection tiers render (default)
   *   "high" — 181–365d, only HIGH-confidence Likely; explain via banner
   *   "none" — past 365d, confirmed events only; explain via banner
   */
  horizonTier?: "all" | "high" | "none";
  confirmedEvents: ExportableConfirmedEvent[];
  /**
   * Position-ordered legs for multi-stop trips. Omit or pass a single
   * entry to render today's single-city hero (zero regression). When
   * length > 1 the ITINERARY route-stamp hero replaces the headline.
   */
  legs?: TripSummaryLeg[];
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
  horizonTier,
  confirmedEvents,
  legs,
}: Readonly<TripSummaryProps>) {
  const legCount = legs?.length ?? 0;
  const isMultiStop = legCount > 1;
  const router = useRouter();
  const [isSaving, startSave] = useTransition();
  const [isMutating, startMutation] = useTransition();
  const [savedId, setSavedId] = useState<string | null>(initialSavedId);
  // Tracks the active Undo toast so we can dismiss it if the user navigates
  // to a different search before clicking Undo (stale closure guard).
  const undoToastIdRef = useRef<string | number | null>(null);

  // Fire once per page view when this is a multi-stop hero. Depend on
  // legCount (a number) rather than `legs` (a fresh array reference
  // every render) so same-trip re-renders don't re-capture.
  useEffect(() => {
    if (legCount > 1) {
      capture("travel_multi_stop_hero_viewed", { legCount });
    }
  }, [legCount]);

  // Sync on prop change — initialSavedId can change as URL params change.
  // Also dismiss any pending Undo toast: an Undo from trip A must not
  // restore trip A's id onto trip B's card after navigation.
  useEffect(() => {
    setSavedId(initialSavedId);
    if (undoToastIdRef.current != null) {
      toast.dismiss(undoToastIdRef.current);
      undoToastIdRef.current = null;
    }
  }, [initialSavedId]);

  const startFormatted = formatDateCompact(startDate, { withWeekday: true });
  const endFormatted = formatDateCompact(endDate, { withWeekday: true });
  const days = daysBetween(startDate, endDate);
  const totalCount = confirmedCount + likelyCount + possibleCount;
  // broaderExpanded wins visually over radiusSnapped when both fire.
  // Suppressed on no_coverage: the EmptyStates copy takes over and a
  // revision badge would misleadingly imply we found something out there.
  const radiusSnapped =
    !noCoverage && requestedRadiusKm != null && requestedRadiusKm !== radiusKm;
  const broaderExpanded =
    !noCoverage && effectiveRadiusKm != null && effectiveRadiusKm > radiusKm;
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
    // Capture the id being archived so Undo restores the exact same row
    // (preserves original id, createdAt, lastViewedAt, and the persisted
    // radius — critical for legacy trips whose radius isn't on the tier
    // enum). setSavedId(null) fires immediately on success but this
    // closure keeps a reference for the toast action.
    const archivedId = savedId;
    startMutation(async () => {
      const result = await deleteTravelSearch(archivedId);
      if ("success" in result && result.success) {
        setSavedId(null);
        capture("travel_saved_search_removed", {});
        undoToastIdRef.current = toast.success("Removed from saved trips", {
          action: {
            label: "Undo",
            // Direct async (no startMutation wrapper): Sonner's action
            // button renders through its own portal, so the click is a
            // native DOM event rather than a React synthetic event. Async
            // transitions kicked off from that boundary don't schedule
            // reliably — the QA symptom was the server action appearing
            // to no-op silently. Going straight to the action keeps the
            // control path obvious and the restore deterministic.
            onClick: async () => {
              const toastId = undoToastIdRef.current;
              try {
                const undo = await restoreTravelSearch(archivedId);
                // Guard: user navigated to a different search while the
                // restore was in flight — don't clobber the new trip's state.
                if (undoToastIdRef.current !== toastId) return;
                if (toastId != null) toast.dismiss(toastId);
                if ("success" in undo && undo.success) {
                  setSavedId(archivedId);
                  capture("travel_saved_search_restored", {});
                } else {
                  toast.error("Couldn't undo — save the trip again to preserve it.", {
                    description: "error" in undo ? undo.error : undefined,
                  });
                }
              } catch {
                if (undoToastIdRef.current !== toastId) return;
                if (toastId != null) toast.dismiss(toastId);
                toast.error("Couldn't undo — save the trip again to preserve it.");
              }
            },
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

      {legs && legs.length > 1 ? (
        <ItineraryHero legs={legs} />
      ) : (
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl lg:text-5xl">
          {destination}
        </h1>
      )}

      <span
        className="mt-4 block h-0.5 w-28 rounded-full bg-gradient-to-r from-emerald-500 to-sky-500"
        aria-hidden="true"
      />

      {!isMultiStop && totalCount > 0 && (
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

      {horizonTier === "high" && (
        <p className="mt-2 max-w-xl text-sm italic leading-relaxed text-muted-foreground/70">
          Past the 6-month mark — showing only kennels with fixed schedules
          (weekly / fortnightly / monthly patterns). Kennels with looser
          cadences reappear on shorter searches.
        </p>
      )}

      {horizonTier === "none" && (
        <p className="mt-2 max-w-xl text-sm italic leading-relaxed text-muted-foreground/70">
          Past the 1-year mark — showing posted events only. Projected
          trails resume on searches within the next 12 months.
        </p>
      )}

      {!isMultiStop && (
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
      )}

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
}: Readonly<{
  isSaving: boolean;
  noCoverage: boolean;
  onSave: () => void;
}>) {
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

function SavedBadge({
  isMutating,
  onRemove,
}: Readonly<{
  isMutating: boolean;
  onRemove: () => void;
}>) {
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

/**
 * Multi-stop boarding-pass hero: ◆ ITINERARY margin label, the route
 * stamp (LHR → CDG → BER) as the display headline, a city subhead
 * (LONDON · PARIS · BERLIN), and a stat line spanning the trip
 * window. Mirrors `MultiStopHeader` in SavedTripCard.tsx at page
 * scale.
 */
function ItineraryHero({ legs }: Readonly<{ legs: TripSummaryLeg[] }>) {
  const iataCodes = legs.map((leg) => cityToIata(leg.label));
  const cityNames = legs.map((leg) => {
    const first = leg.label.split(",")[0]?.trim() ?? leg.label;
    return first.toUpperCase();
  });
  const firstStart = legs[0].startDate;
  const lastEnd = legs.at(-1)!.endDate;
  const totalDays = daysBetween(firstStart, lastEnd);

  return (
    <div>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-red-600 dark:text-red-400">
        ◆ Itinerary
      </p>
      <h1 className="mt-1 font-display text-3xl font-medium tracking-tight tabular-nums sm:text-4xl lg:text-5xl">
        {iataCodes.map((code, i) => (
          <span key={`${i}-${code}`}>
            {i > 0 && (
              <span className="px-2 text-muted-foreground/50" aria-hidden="true">
                →
              </span>
            )}
            {code}
          </span>
        ))}
      </h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {cityNames.join(" · ")}
      </p>
      <p className="mt-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {formatDateCompact(firstStart, { withWeekday: true })}
        {" → "}
        {formatDateCompact(lastEnd, { withWeekday: true })}
        {" · "}
        {totalDays} night{totalDays === 1 ? "" : "s"}
        {" · "}
        {legs.length} legs
      </p>
    </div>
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
