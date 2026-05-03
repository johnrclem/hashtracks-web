"use client";

import { useCallback, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { daysBetween } from "@/lib/travel/format";
import { MAX_STOPS_PER_TRIP } from "@/lib/travel/limits";
import { capture } from "@/lib/analytics";
import { resolveRefCode } from "@/lib/travel/iata";
import {
  saveDraftSearch,
  updateDraftSearch,
  updateTravelSearch,
} from "@/app/travel/actions";
import { AUTH_COPY } from "@/lib/travel/copy";
import { CompactPill } from "./CompactPill";
import { GhostLegRow } from "./GhostLegRow";
import { LegRow } from "./LegRow";
import { SignInToAddLegRow } from "./SignInToAddLegRow";
import { SubmitBarSummary } from "./SubmitBarSummary";
import {
  legReadyToSubmit,
  legToDestParams,
  makeEmptyLeg,
  makeLegFromInitial,
} from "./helpers";
import type { LegState, TravelSearchFormProps } from "./types";

export function TravelSearchForm({
  variant,
  initialValues,
  initialLegs,
  savedTripId,
  isAuthenticated = false,
}: Readonly<TravelSearchFormProps>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEditingSaved = Boolean(savedTripId);
  // Deterministic per-leg ids. useId() is stable across SSR/hydration
  // and the counter ref increments only on the client after mount, so
  // the initial leg's key matches on both sides and subsequent adds
  // produce unique, collision-free keys without crypto/randomness.
  const baseLegId = useId();
  // Counter starts after the initial-leg seed so addLeg can't collide.
  // The initial seed uses ids 0..n-1 based on initialLegs length. `||`
  // (not `??`) guards against `initialLegs = []` — an empty array would
  // seed the counter at 0, but the useState initializer below falls
  // back to one leg (id -leg-0), so the next addLeg would collide.
  const initialLegSeeds = initialLegs?.length || 1;
  const legCounter = useRef(initialLegSeeds);
  const makeLegId = useCallback(
    () => `${baseLegId}-leg-${legCounter.current++}`,
    [baseLegId],
  );
  const [legs, setLegs] = useState<LegState[]>(() => {
    if (initialLegs && initialLegs.length > 0) {
      return initialLegs.map((leg, i) =>
        makeLegFromInitial(`${baseLegId}-leg-${i}`, leg),
      );
    }
    return [makeLegFromInitial(`${baseLegId}-leg-0`, initialValues)];
  });
  const [isExpanded, setIsExpanded] = useState(variant === "hero");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  /**
   * Multi-leg itineraries persist as DRAFT TravelSearches so the URL
   * can stay `?savedTripId=<id>` (plan: stateless multi-leg URLs were
   * rejected as fragile). Once we've created a draft on the first
   * leg-2 add, subsequent edits `updateDraftSearch` the same row —
   * this prevents duplicate draft accretion on re-submit / retry.
   */
  const [draftId, setDraftId] = useState<string | null>(null);

  const updateLeg = useCallback((index: number, patch: Partial<LegState>) => {
    setLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)));
  }, []);

  /**
   * Create or update the draft so the URL can route through
   * `?savedTripId=<id>`. Idempotent on resubmit: once we have a
   * draftId, repeat calls update-in-place instead of inserting new
   * rows (Codex #868 flagged unbounded draft creation).
   */
  const persistDraft = useCallback(
    async (nextLegs: LegState[]): Promise<string | null> => {
      const destinations = nextLegs.map(legToDestParams);
      if (draftId) {
        const result = await updateDraftSearch(draftId, { destinations });
        if ("error" in result) {
          setSubmitError(result.error ?? "Could not update trip draft");
          return null;
        }
        return result.id;
      }
      const result = await saveDraftSearch({ destinations });
      if ("error" in result) {
        setSubmitError(result.error ?? "Could not save trip draft");
        return null;
      }
      setDraftId(result.id);
      return result.id;
    },
    [draftId],
  );

  const addLeg = useCallback(async () => {
    // Multi-leg adds require auth — drafts live server-side. Anonymous
    // users hitting the ghost row see the SignInToAddLegRow instead,
    // so this callback should never fire anonymously. Defensive guard
    // preserves the invariant if a future refactor exposes the path.
    if (!isAuthenticated) {
      setSubmitError(AUTH_COPY.signInToPlanMultiCity);
      return;
    }
    setSubmitError(null);
    // Compute `nextLegs` in a stable closure over the current `legs`
    // value, not inside the setLegs updater. React strict-mode invokes
    // functional updaters twice; side effects (capture, persistDraft)
    // must not piggyback on the updater body.
    if (legs.length >= MAX_STOPS_PER_TRIP) return;
    const next = makeEmptyLeg(makeLegId());
    const prevLeg = legs.at(-1);
    if (prevLeg?.endDate) next.startDate = prevLeg.endDate;
    const nextLegs = [...legs, next];
    setLegs(nextLegs);
    capture("travel_leg_added", { legCount: nextLegs.length });
    // Skip draft auto-save when editing an existing saved trip —
    // those changes persist via Search → updateTravelSearch, not by
    // inserting a sibling draft.
    if (!isEditingSaved && nextLegs.every(legReadyToSubmit)) {
      await persistDraft(nextLegs);
    }
  }, [isAuthenticated, isEditingSaved, legs, makeLegId, persistDraft]);

  const removeLeg = useCallback(async (index: number) => {
    if (legs.length <= 1) return;
    const nextLegs = legs.filter((_, i) => i !== index);
    setLegs(nextLegs);
    capture("travel_leg_removed", { legCount: nextLegs.length });
    if (
      !isEditingSaved &&
      nextLegs.length > 1 &&
      draftId &&
      nextLegs.every(legReadyToSubmit)
    ) {
      const result = await updateDraftSearch(draftId, {
        destinations: nextLegs.map(legToDestParams),
      });
      if ("error" in result) {
        setSubmitError(result.error ?? "Could not update draft");
      }
    }
    // If remove leaves 1 leg, the draft is orphaned; cron GC sweeps
    // drafts older than a week. Not worth deleting eagerly — the user
    // might re-add another leg.
  }, [draftId, isEditingSaved, legs]);

  const canSubmit = legs.every(legReadyToSubmit);

  const submitMultiLeg = useCallback(async () => {
    const id = await persistDraft(legs);
    if (!id) return;
    router.push(`/travel?savedTripId=${encodeURIComponent(id)}`);
    if (variant === "compact") setIsExpanded(false);
  }, [legs, router, variant, persistDraft]);

  const submitEditSaved = useCallback(async () => {
    if (!savedTripId) return;
    const result = await updateTravelSearch(savedTripId, {
      destinations: legs.map(legToDestParams),
    });
    if ("error" in result) {
      setSubmitError(result.error ?? "Could not update trip");
      return;
    }
    // Stay on the same ?savedTripId= URL — the saved row was updated
    // in place. router.refresh() re-runs SavedTripPage's server
    // fetches so the hero + results re-render with the new legs.
    router.refresh();
    if (variant === "compact") setIsExpanded(false);
  }, [savedTripId, legs, router, variant]);

  const submitSingleLeg = useCallback((leg: LegState) => {
    const params = new URLSearchParams({
      lat: leg.latitude.toString(),
      lng: leg.longitude.toString(),
      from: leg.startDate,
      to: leg.endDate,
      r: leg.radiusKm.toString(),
      q: leg.destination,
    });
    if (leg.timezone) params.set("tz", leg.timezone);
    // placeId round-trip lets SSR saved-trip lookup prefer placeId identity
    // over coord equality — same place geocoded vs. picked from autocomplete
    // can produce coords that drift by ~0.0001°.
    if (leg.placeId) params.set("pid", leg.placeId);
    router.push(`/travel?${params.toString()}`);
    if (variant === "compact") setIsExpanded(false);
  }, [router, variant]);

  const handleSubmit = useCallback(() => {
    setSubmitError(null);
    if (!canSubmit) {
      // Boarding-pass aesthetic: REQUIRED stamps light up on attempt.
      setHasAttemptedSubmit(true);
      return;
    }
    const lastLeg = legs.at(-1)!;
    capture("travel_search_submitted", {
      destination: legs[0].destination,
      radiusKm: legs[0].radiusKm,
      dateRangeDays: daysBetween(legs[0].startDate, lastLeg.endDate),
      legCount: legs.length,
    });
    startTransition(async () => {
      if (isEditingSaved) {
        await submitEditSaved();
      } else if (legs.length === 1) {
        submitSingleLeg(legs[0]);
      } else {
        await submitMultiLeg();
      }
    });
  }, [canSubmit, legs, submitMultiLeg, submitSingleLeg, submitEditSaved, isEditingSaved]);

  if (variant === "compact" && !isExpanded) {
    return <CompactPill legs={legs} onExpand={() => setIsExpanded(true)} />;
  }

  const canAddLeg = legs.length < MAX_STOPS_PER_TRIP;
  const isMultiLeg = legs.length > 1;

  return (
    <div className="travel-animate">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        role="search"
        aria-label="Travel search"
        className="flex flex-col gap-3"
      >
        {legs.map((leg, i) => (
          <LegRow
            key={leg.id}
            leg={leg}
            legIndex={i}
            isOnlyLeg={legs.length === 1}
            autoFocus={variant === "hero" && i === 0 && legs.length === 1}
            showRequiredStamps={hasAttemptedSubmit}
            updateLeg={updateLeg}
            removeLeg={legs.length > 1 ? removeLeg : undefined}
          />
        ))}

        {canAddLeg && (
          isAuthenticated ? (
            <GhostLegRow nextIndex={legs.length + 1} onClick={addLeg} />
          ) : (
            <SignInToAddLegRow
              nextIndex={legs.length + 1}
              legs={legs}
            />
          )
        )}

        {submitError && (
          <p
            role="alert"
            className="rounded-md border border-red-600/40 bg-red-600/5 px-4 py-2 font-mono text-xs text-red-600 dark:text-red-400"
          >
            {submitError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-[1.5px] border-foreground bg-foreground px-5 py-3 text-background">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em]">
            <SubmitBarSummary legs={legs} />
          </span>
          <Button
            type="submit"
            disabled={isPending}
            variant="secondary"
            className="gap-2 rounded-md border border-background/20 bg-background text-foreground hover:bg-background/90"
          >
            {isPending ? "Searching…" : "Search"}
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </form>

      {/* ISSUED microlabel — cosmetic, aria-hidden. Hero single-leg only. */}
      {variant === "hero" && !isMultiLeg && (
        <div
          className="mt-2 flex justify-between px-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40"
          aria-hidden="true"
        >
          <span suppressHydrationWarning>
            ISSUED {new Date().toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "2-digit" }).toUpperCase()} · HASHTRACKS
          </span>
          <span>REF HT-{resolveRefCode(legs[0].destination)}</span>
        </div>
      )}

      {variant === "compact" && isExpanded && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Collapse
          </button>
        </div>
      )}
    </div>
  );
}
