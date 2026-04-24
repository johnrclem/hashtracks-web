"use client";

import { memo, useCallback, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Calendar, Compass, Search, Pencil, Plus, X, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateCompact, formatNights, daysBetween } from "@/lib/travel/format";
import { RADIUS_TIERS, snapRadiusToTier, MAX_STOPS_PER_TRIP } from "@/lib/travel/limits";
import { capture } from "@/lib/analytics";
import { resolveRefCode } from "@/lib/travel/iata";
import { saveDraftSearch, updateDraftSearch, updateTravelSearch } from "@/app/travel/actions";
import { sanitizeRedirectPath } from "@/lib/travel/url";
import { AUTH_COPY } from "@/lib/travel/copy";
import { DestinationInput } from "./DestinationInput";

interface InitialLegValues {
  destination: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  radiusKm: number;
  timezone?: string;
}

interface TravelSearchFormProps {
  variant: "hero" | "compact";
  initialValues?: InitialLegValues;
  /** Position-ordered legs for hydrating a saved multi-stop trip. When
   *  provided, overrides `initialValues` and seeds one LegState per
   *  entry. Omit for the single-leg (or blank) default path. */
  initialLegs?: InitialLegValues[];
  /** When set, the form is editing an existing saved trip: submit
   *  updates that row in place via `updateTravelSearch` instead of
   *  creating a new draft + navigating away. Adding/removing legs
   *  during an edit session still updates the same row. */
  savedTripId?: string;
  /** Multi-leg adds require auth (drafts persist server-side). When
   *  `false`, the ghost-leg row renders as a sign-in gate instead of
   *  expanding. Single-leg flow stays anonymous. */
  isAuthenticated?: boolean;
}

const RADIUS_META: Record<(typeof RADIUS_TIERS)[number], { label: string; description: string }> = {
  10: { label: "Close", description: "~6 mi" },
  25: { label: "Metro", description: "~15 mi" },
  50: { label: "Region", description: "~30 mi" },
  100: { label: "Far", description: "~60 mi" },
};
const RADIUS_OPTIONS = RADIUS_TIERS.map((value) => ({ value, ...RADIUS_META[value] }));

interface LegState {
  id: string;
  destination: string;
  latitude: number;
  longitude: number;
  timezone: string;
  startDate: string;
  endDate: string;
  radiusKm: number;
  /** DestinationInput reported resolved coords — (0, 0) is a valid equatorial destination so this is not just `latitude !== 0`. */
  coordsResolved: boolean;
}

function makeEmptyLeg(id: string): LegState {
  return {
    id,
    destination: "",
    latitude: 0,
    longitude: 0,
    timezone: "",
    startDate: "",
    endDate: "",
    radiusKm: 50,
    coordsResolved: false,
  };
}

function makeLegFromInitial(
  id: string,
  initial: InitialLegValues | undefined,
): LegState {
  if (!initial) return makeEmptyLeg(id);
  return {
    id,
    destination: initial.destination,
    latitude: initial.latitude,
    longitude: initial.longitude,
    timezone: initial.timezone ?? "",
    startDate: initial.startDate,
    endDate: initial.endDate,
    radiusKm: snapRadiusToTier(initial.radiusKm),
    // Types mark latitude/longitude as required numbers; any LegState we
    // build from initialValues is coord-resolved by construction.
    coordsResolved: true,
  };
}

/** Convert a LegState into the SaveDestinationParams shape the
 *  server action accepts. */
function legToDestParams(leg: LegState) {
  return {
    label: leg.destination,
    latitude: leg.latitude,
    longitude: leg.longitude,
    radiusKm: leg.radiusKm,
    startDate: leg.startDate,
    endDate: leg.endDate,
    timezone: leg.timezone || undefined,
  };
}

function legDatesValid(leg: LegState): boolean {
  return Boolean(leg.startDate && leg.endDate && leg.startDate <= leg.endDate);
}

function legReadyToSubmit(leg: LegState): boolean {
  return Boolean(leg.destination && leg.coordsResolved && legDatesValid(leg));
}

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

function SubmitBarSummary({ legs }: Readonly<{ legs: LegState[] }>) {
  if (legs.length === 1) {
    const leg = legs[0];
    if (!leg.startDate || !leg.endDate) return <>Ready when you are</>;
    return (
      <>
        {formatDateCompact(leg.startDate)} → {formatDateCompact(leg.endDate)} · {formatNights(leg.startDate, leg.endDate)}
      </>
    );
  }
  const firstStart = legs[0].startDate;
  const lastEnd = legs.at(-1)!.endDate;
  if (!firstStart || !lastEnd) return <>{legs.length} legs · pending dates</>;
  return (
    <>
      {legs.length} legs · {formatDateCompact(firstStart)} → {formatDateCompact(lastEnd)} · {formatNights(firstStart, lastEnd)}
    </>
  );
}

interface LegRowProps {
  leg: LegState;
  legIndex: number;
  isOnlyLeg: boolean;
  autoFocus: boolean;
  showRequiredStamps: boolean;
  updateLeg: (index: number, patch: Partial<LegState>) => void;
  removeLeg?: (index: number) => void;
}

/**
 * One boarding-pass row per leg. Memoized so typing into one leg's
 * date input doesn't re-render other legs — `updateLeg` / `removeLeg`
 * come from the parent as stable `useCallback` references that take
 * the leg index as an argument, so the row can bind per-row closures
 * without breaking referential equality.
 */
const LegRow = memo(function LegRow({
  leg,
  legIndex,
  isOnlyLeg,
  autoFocus,
  showRequiredStamps,
  updateLeg,
  removeLeg,
}: Readonly<LegRowProps>) {
  const legLabel = `LEG ${String(legIndex + 1).padStart(2, "0")}`;
  const destInvalid = showRequiredStamps && (!leg.destination || !leg.coordsResolved);
  const datesInvalid = showRequiredStamps && !legDatesValid(leg);

  const onDestinationChange = useCallback(
    (place: { label: string; latitude: number; longitude: number; timezone?: string }) => {
      updateLeg(legIndex, {
        destination: place.label,
        latitude: place.latitude,
        longitude: place.longitude,
        coordsResolved: true,
        timezone: place.timezone ?? "",
      });
    },
    [updateLeg, legIndex],
  );
  const onDestinationClear = useCallback(() => {
    updateLeg(legIndex, {
      destination: "",
      latitude: 0,
      longitude: 0,
      coordsResolved: false,
      timezone: "",
    });
  }, [updateLeg, legIndex]);
  const onStartDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => updateLeg(legIndex, { startDate: e.target.value }),
    [updateLeg, legIndex],
  );
  const onEndDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => updateLeg(legIndex, { endDate: e.target.value }),
    [updateLeg, legIndex],
  );
  const onRadiusChange = useCallback(
    (value: number) => updateLeg(legIndex, { radiusKm: value }),
    [updateLeg, legIndex],
  );
  const onRemoveClick = useCallback(
    () => removeLeg?.(legIndex),
    [removeLeg, legIndex],
  );

  return (
    <div className="travel-animate">
      <div className="mb-2 grid grid-cols-3 gap-0 px-1 md:grid-cols-[auto_2.4fr_1.4fr_1fr_auto]">
        <div className="hidden items-center justify-center text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 md:flex">
          &nbsp;
        </div>
        <div className="flex items-center gap-2 pl-5 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
          <MapPin className="h-3 w-3" />
          Destination
          {destInvalid && <BoardingStamp label="Required" variant="required" />}
        </div>
        <div className="hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 md:flex">
          <Calendar className="h-3 w-3" />
          Dates
          {datesInvalid && <BoardingStamp label="Required" variant="required" />}
        </div>
        <div className="hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 md:flex">
          <Compass className="h-3 w-3" />
          Radius
        </div>
        <div />
      </div>
      <div
        className={`
          travel-grain relative rounded-xl border-[1.5px] border-border
          bg-card shadow-lg transition-all duration-300
          focus-within:border-ring focus-within:shadow-xl
          ${isOnlyLeg ? "md:-rotate-[0.5deg] md:focus-within:rotate-0" : ""}
        `}
        style={{ "--travel-grain-opacity": "0.04" } as React.CSSProperties}
      >
        <div className="grid grid-cols-1 md:grid-cols-[auto_2.4fr_1.4fr_1fr_auto]">
          <div className="flex items-start justify-center border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <BoardingStamp label={legLabel} variant="leg" />
          </div>

          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Leg {legIndex + 1} destination</legend>
            <DestinationInput
              value={leg.destination}
              autoFocus={autoFocus}
              onChange={onDestinationChange}
              onClear={onDestinationClear}
            />
            {leg.timezone && (
              <p className="mt-1 text-xs text-muted-foreground">
                {leg.destination.split(",").at(-1)?.trim()} · {leg.timezone.split("/").at(-1)?.replaceAll("_", " ")}
              </p>
            )}
          </fieldset>

          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Leg {legIndex + 1} dates</legend>
            <div className="flex gap-2">
              <input
                type="date"
                value={leg.startDate}
                onChange={onStartDateChange}
                aria-label={`Leg ${legIndex + 1} start date`}
                className="w-full bg-transparent font-mono text-sm focus:outline-none"
              />
              <span className="text-muted-foreground">→</span>
              <input
                type="date"
                value={leg.endDate}
                onChange={onEndDateChange}
                aria-label={`Leg ${legIndex + 1} end date`}
                className="w-full bg-transparent font-mono text-sm focus:outline-none"
              />
            </div>
            {legDatesValid(leg) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNights(leg.startDate, leg.endDate)}
              </p>
            )}
          </fieldset>

          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Leg {legIndex + 1} radius</legend>
            <RadiusPicker value={leg.radiusKm} onChange={onRadiusChange} />
            <p className="mt-1.5 font-mono text-xs text-muted-foreground">
              {leg.radiusKm} km · ~{Math.round(leg.radiusKm * 0.621)} mi
            </p>
          </fieldset>

          <div className="flex items-start justify-center p-5">
            {removeLeg && (
              <button
                type="button"
                onClick={onRemoveClick}
                aria-label={`Remove leg ${legIndex + 1}`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-600/10 hover:text-red-600 dark:hover:text-red-400"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function RadiusPicker({ value, onChange }: Readonly<{ value: number; onChange: (v: number) => void }>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RADIUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`
            rounded-md px-2.5 py-1 text-xs font-medium transition-colors
            ${
              value === opt.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Faded dashed-border row below the last committed leg. Tapping
 * unfolds a fresh leg. Mirrors the boarding-pass "pending segment"
 * metaphor — visible promise of future content without cluttering
 * the primary ticket.
 */
function GhostLegRow({
  nextIndex,
  onClick,
}: Readonly<{
  nextIndex: number;
  onClick: () => Promise<void>;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        group flex w-full items-center gap-4 rounded-xl border-[1.5px]
        border-dashed border-muted-foreground/40 bg-card/40 p-5 text-left
        transition-all duration-200
        hover:border-muted-foreground/70 hover:bg-card
      "
    >
      <BoardingStamp label={`LEG ${String(nextIndex).padStart(2, "0")}`} variant="ghost" />
      <span className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground/70 group-hover:text-foreground">
        <Plus className="h-3.5 w-3.5" />
        Add next stop
      </span>
      <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50">
        Where next?
      </span>
    </button>
  );
}

/**
 * Ghost-leg variant rendered for anonymous users. Tapping navigates
 * to sign-in with a redirect back to the current form, so the user
 * returns to the same editing state post-auth. Multi-leg planning is
 * intentionally auth-only (drafts persist server-side via `saveDraftSearch`).
 */
function SignInToAddLegRow({
  nextIndex,
  legs,
}: Readonly<{
  nextIndex: number;
  legs: LegState[];
}>) {
  // Preserve the in-progress leg-1 params so the user lands back on
  // /travel with the same destination after signing in. Multi-leg
  // continuation post-signin happens via the form — not via URL —
  // because the URL doesn't carry leg-N state pre-draft-save.
  const returnTo = (() => {
    if (legs.length === 0 || !legs[0].destination) return "/travel";
    const leg = legs[0];
    const p = new URLSearchParams({
      lat: String(leg.latitude),
      lng: String(leg.longitude),
      from: leg.startDate,
      to: leg.endDate,
      r: String(leg.radiusKm),
      q: leg.destination,
    });
    if (leg.timezone) p.set("tz", leg.timezone);
    return `/travel?${p.toString()}`;
  })();
  // SECURITY: only allow same-origin redirects. `sanitizeRedirectPath`
  // rejects absolute and protocol-relative URLs so an attacker-crafted
  // returnTo can't redirect past auth to an arbitrary host.
  const safeReturnTo = sanitizeRedirectPath(returnTo, "/travel");
  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(safeReturnTo)}`;

  return (
    <a
      href={signInHref}
      onClick={() => capture("travel_auth_prompt_clicked", {})}
      className={`
        group flex w-full items-center gap-4 rounded-xl border-[1.5px]
        border-dashed border-muted-foreground/40 bg-card/40 p-5 text-left
        transition-all duration-200
        hover:border-muted-foreground/70 hover:bg-card
      `}
      aria-label={`${AUTH_COPY.signInToAddLeg} ${nextIndex}`}
    >
      <BoardingStamp label={`LEG ${String(nextIndex).padStart(2, "0")}`} variant="ghost" />
      <span className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground/70 group-hover:text-foreground">
        <Lock className="h-3.5 w-3.5" />
        {AUTH_COPY.signInToAddLeg}
      </span>
      <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50">
        {AUTH_COPY.multiCityIsFree}
      </span>
    </a>
  );
}

function CompactPill({ legs, onExpand }: Readonly<{ legs: LegState[]; onExpand: () => void }>) {
  const isMulti = legs.length > 1;
  const firstStart = legs[0].startDate;
  const lastEnd = legs.at(-1)!.endDate;
  const summary =
    firstStart && lastEnd
      ? `${formatDateCompact(firstStart, { withWeekday: true })} → ${formatDateCompact(lastEnd, { withWeekday: true })}`
      : "Dates";

  return (
    <button
      type="button"
      onClick={onExpand}
      className="
        flex w-full items-center gap-3 rounded-full border border-border
        bg-card px-6 py-3 text-left transition-colors hover:bg-accent
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
      "
      aria-label="Edit travel search"
    >
      <MapPin className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">
        {isMulti ? `${legs.length} legs` : legs[0].destination || "Search"}
      </span>
      <span className="text-muted-foreground">·</span>
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <span className="font-mono text-sm text-muted-foreground">{summary}</span>
      {!isMulti && (
        <>
          <span className="text-muted-foreground">·</span>
          <Compass className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm text-muted-foreground">{legs[0].radiusKm} km</span>
        </>
      )}
      <span className="ml-auto flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <Pencil className="h-3 w-3" />
        Edit
      </span>
    </button>
  );
}

type BoardingStampVariant = "leg" | "ghost" | "required";

/**
 * Rotated monospace badge used as the boarding-pass rubber-stamp
 * vocabulary. `leg` — solid red LEG NN marker; `ghost` — dashed
 * muted marker on pending slots; `required` — red, with the
 * travel-stamp-required fade-in animation for submit-refusal.
 */
function BoardingStamp({
  label,
  variant,
}: Readonly<{
  label: string;
  variant: BoardingStampVariant;
}>) {
  const baseClasses = "inline-flex -rotate-[1.5deg] items-center justify-center rounded-sm border-[1.5px] px-1.5 py-[1px] font-mono text-[10px] font-bold uppercase tracking-wider";
  const variantClasses: Record<BoardingStampVariant, string> = {
    leg: "border-red-600/70 text-red-600 dark:border-red-400/70 dark:text-red-400",
    ghost: "border-dashed border-muted-foreground/50 text-muted-foreground",
    required: "travel-stamp-required border-red-600/60 text-red-600 ml-2 text-[9px]",
  };
  return (
    <span
      role={variant === "required" ? "status" : undefined}
      aria-live={variant === "required" ? "polite" : undefined}
      className={`${baseClasses} ${variantClasses[variant]}`}
    >
      {label}
    </span>
  );
}
