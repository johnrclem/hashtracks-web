/**
 * Travel Mode Search Service
 *
 * Orchestrates the full search flow: find nearby kennels, query confirmed events,
 * project likely/possible trails from schedule rules, deduplicate, rank, and
 * assemble the response for the UI.
 *
 * See docs/Requirements/travel_mode_prd_v5.md §4, §10–12, §14.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { MAX_RADIUS_KM } from "@/lib/travel/limits";
import { CANONICAL_EVENT_WHERE } from "@/lib/event-filters";
import { haversineDistance } from "@/lib/geo";
import { parseUtcNoonDate } from "@/lib/date";
import { safeUrl } from "@/lib/safe-url";
import { getWeatherForEvents, type DailyWeather } from "@/lib/weather";
import {
  projectTrails,
  scoreConfidence,
  deduplicateAgainstConfirmed,
  buildEvidenceTimeline,
  clampToProjectionHorizon,
  projectionHorizonForStart,
  filterProjectionsByHorizon,
  CONFIRMED_EVENT_HORIZON_DAYS,
  DAY_MS,
  type ProjectedTrail,
  type ProjectionHorizonTier,
  type ScheduleRuleInput,
  type KennelContext,
  type EvidenceTimeline,
} from "./projections";
import type { DistanceTier } from "./filters";

export type { DistanceTier };

// ============================================================================
// Types
// ============================================================================

/**
 * Per-stop params for a single destination in a multi-stop trip. 1..3 stops
 * per search (the cap is enforced at the save boundary in actions.ts — here
 * we accept whatever the caller passes and fan out over all of them).
 */
export interface DestinationParams {
  latitude: number;
  longitude: number;
  radiusKm: number;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  timezone?: string;
  /** User-visible label (city name). Used to tag result rows for UI grouping. */
  label?: string;
}

export interface TravelSearchParams {
  destinations: DestinationParams[];
  filters?: {
    confidence?: ("high" | "medium" | "low")[];
    distanceTier?: DistanceTier[];
  };
  /**
   * Skip the weather batch entirely. The `/travel/saved` dashboard needs
   * only the counts for its summary badges; fetching weather for N saved
   * trips × up to 15 upstream calls each is unbounded dashboard-time cost
   * that never renders a pill.
   */
  skipWeather?: boolean;
}

export interface SourceLink {
  url: string;
  label: string;
  type: "website" | "facebook" | "hashrego" | "instagram" | "meetup" | "other";
}

/**
 * Multi-stop tag carried on every result row. `destinationIndex` is the
 * stop's 0-indexed position in the input `destinations` array; PR 3's UI
 * uses it to group rows into LEG sub-bands on overlap days. A row with
 * `destinationIndex: 1` means "this event is in range of stop #2."
 *
 * Single-stop searches produce rows all tagged `{ destinationIndex: 0 }`,
 * which existing consumers can safely ignore.
 */
interface DestinationTag {
  destinationIndex: number;
  destinationLabel: string | null;
}

export interface ConfirmedResult extends DestinationTag {
  type: "confirmed";
  eventId: string;
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelFullName: string;
  kennelRegion: string;
  kennelPinColor: string | null;
  date: Date;
  startTime: string | null;
  title: string | null;
  runNumber: number | null;
  haresText: string | null;
  locationName: string | null;
  locationStreet: string | null;
  locationCity: string | null;
  timezone: string | null;
  sourceUrl: string | null;
  distanceKm: number;
  distanceTier: DistanceTier;
  sourceLinks: SourceLink[];
  weather: DailyWeather | null;
}

export interface LikelyResult extends DestinationTag {
  type: "likely";
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelFullName: string;
  kennelRegion: string;
  kennelPinColor: string | null;
  date: Date;
  startTime: string | null;
  confidence: "high" | "medium";
  distanceKm: number;
  distanceTier: DistanceTier;
  explanation: string;
  evidenceWindow: string;
  evidenceTimeline: EvidenceTimeline;
  sourceLinks: SourceLink[];
}

export interface PossibleResult extends DestinationTag {
  type: "possible";
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelFullName: string;
  kennelRegion: string;
  date: Date | null;
  confidence: "low";
  distanceKm: number;
  distanceTier: DistanceTier;
  explanation: string;
  sourceLinks: SourceLink[];
  /** Most recent confirmed event in the 12-week evidence window, or null. */
  lastConfirmedAt: Date | null;
}

export type EmptyStateKind =
  | "none"
  | "no_confirmed"
  | "no_nearby"
  | "no_coverage"
  | "out_of_horizon";

/**
 * Per-stop summary. Every stop gets one of these, even if it had zero
 * results, so the UI can render per-stop hints ("Paris: out of horizon")
 * without collapsing to a single aggregate message.
 *
 * Broader-pass results live here, scoped to this stop only — a stop whose
 * primary radius was dormant triggers its own broader fallback without
 * affecting other stops.
 */
export interface DestinationResult {
  index: number;
  label: string | null;
  startDate: Date;
  endDate: Date;
  horizonTier: ProjectionHorizonTier;
  radiusKm: number;
  kennelsSearched: number;
  emptyState: EmptyStateKind;
  /** Only set when this stop's broader-radius fallback actually fired. */
  broaderRadiusKm?: number;
  /** Broader-pass results for this stop, or undefined when no fallback ran. */
  broaderResults?: {
    confirmed: ConfirmedResult[];
    likely: LikelyResult[];
    possible: PossibleResult[];
  };
}

export interface TravelSearchResults {
  /** Flattened primary-pass results across all stops, each tagged with destinationIndex. */
  confirmed: ConfirmedResult[];
  likely: LikelyResult[];
  possible: PossibleResult[];
  /** Per-stop breakdown — horizon, empty-state, broader-pass details. */
  destinations: DestinationResult[];
  /**
   * Aggregate empty state for the full-page banner. Rule:
   *   - Every stop `no_coverage` → `no_coverage`
   *   - Every stop `out_of_horizon` → `out_of_horizon`
   *   - Every stop empty with at least one `no_nearby` → `no_nearby`
   *   - Every stop's confirmed empty but some likely/possible anywhere → `no_confirmed`
   *   - Any stop has confirmed results → `none`
   * Per-stop empty states still live on `destinations[i].emptyState` for
   * local hints; this field only drives the full-page banner.
   */
  emptyState: EmptyStateKind;
  meta: {
    /** Sum of kennels searched across all stops. */
    kennelsSearched: number;
    /** Worst-case horizon tier across stops (none > high > all). */
    horizonTier: ProjectionHorizonTier;
  };
}

// ============================================================================
// Constants
// ============================================================================

const TWELVE_WEEKS_MS = 12 * 7 * DAY_MS;

/**
 * Safety-net row cap for the confirmed-event query. A traveler viewing
 * ~50 kennels × ~7 days averages well under 100 rows; hitting this cap
 * means the caller passed a pathologically wide window and we prefer
 * truncation over a function timeout or RSC serialization blow-up.
 */
const CONFIRMED_EVENT_ROW_CAP = 500;

// ============================================================================
// Internal types
// ============================================================================

interface NearbyKennel {
  id: string;
  slug: string;
  shortName: string;
  fullName: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  lastEventDate: Date | null;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  website: string | null;
  facebookUrl: string | null;
  instagramHandle: string | null;
  distanceKm: number;
  regionRef: { pinColor: string; centroidLat: number | null; centroidLng: number | null } | null;
}

// ============================================================================
// Sort comparator
// ============================================================================

/**
 * Comparator: date asc → startTime asc → distance asc.
 *
 * The startTime tiebreaker matters within a tier on the same date — a
 * traveler scanning Friday's "Nearby" section expects 6:15 PM before 7:30
 * PM. "HH:MM" strings lex-sort correctly. Nulls sort LAST via the "99:99"
 * sentinel — empty string would sort BEFORE "00:00" and bubble untimed
 * events to the top of the day, which is the opposite of what we want.
 *
 * Exported so the test suite can lock the contract independently of the
 * full search flow (which requires a heavy Prisma mock).
 */
const timeKey = (t: string | null) => t ?? "99:99";

export function byDateTimeDistance<T extends { date: Date; startTime: string | null; distanceKm: number }>(
  a: T,
  b: T,
): number {
  return (
    a.date.getTime() - b.date.getTime() ||
    timeKey(a.startTime).localeCompare(timeKey(b.startTime)) ||
    a.distanceKm - b.distanceKm
  );
}

// ============================================================================
// Main search function
// ============================================================================

/**
 * Orchestrator. Fans out over `params.destinations`, runs each stop's
 * pipeline in parallel, tags every row with `destinationIndex` +
 * `destinationLabel`, and returns both a flattened top-level result set
 * and a per-stop breakdown for per-destination UI hints.
 *
 * `fetchAllVisibleKennels` runs once at the top; per-stop kennel filtering
 * is in-memory so no DB query amplification beyond the per-stop pipeline.
 */
export async function executeTravelSearch(
  prisma: PrismaClient,
  params: TravelSearchParams,
): Promise<TravelSearchResults> {
  if (params.destinations.length === 0) {
    throw new Error("executeTravelSearch requires at least one destination");
  }

  const now = new Date();
  const allKennels = await fetchAllVisibleKennels(prisma);

  const perStop = await Promise.all(
    params.destinations.map((d, i) =>
      runStopSearch(prisma, d, i, {
        allKennels,
        filters: params.filters,
        now,
      }),
    ),
  );

  // Aggregate. Each stop returns `{ destination, primaryRows }` — its
  // primary-pass rows already tagged with destinationIndex. broaderResults
  // live on destination (not hoisted top-level) so per-stop fallbacks
  // don't mix.
  const confirmed: ConfirmedResult[] = [];
  const likely: LikelyResult[] = [];
  const possible: PossibleResult[] = [];
  const destinations: DestinationResult[] = [];
  let kennelsSearched = 0;

  const weatherInputs: WeatherInput[] = [];
  for (const stop of perStop) {
    confirmed.push(...stop.primaryRows.confirmed);
    likely.push(...stop.primaryRows.likely);
    possible.push(...stop.primaryRows.possible);
    destinations.push(stop.destination);
    kennelsSearched += stop.destination.kennelsSearched;
    weatherInputs.push(...stop.weatherInputs);
  }

  // Single weather batch across all stops. `getWeatherForEvents` dedupes by
  // location key internally, so two stops sharing a metro share an upstream
  // call, and the MAX_WEATHER_API_CALLS (15) cap applies to the entire
  // search instead of N× that for N stops.
  if (!params.skipWeather) {
    const weatherRecord = await loadConfirmedWeather(weatherInputs);
    for (const row of confirmed) {
      row.weather = weatherRecord[row.eventId] ?? null;
    }
    for (const dest of destinations) {
      if (dest.broaderResults) {
        for (const row of dest.broaderResults.confirmed) {
          row.weather = weatherRecord[row.eventId] ?? null;
        }
      }
    }
  }

  confirmed.sort(byDateTimeDistance);
  likely.sort(byDateTimeDistance);
  possible.sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    confirmed,
    likely,
    possible,
    destinations,
    emptyState: aggregateEmptyState(destinations),
    meta: {
      kennelsSearched,
      horizonTier: worstHorizonTier(destinations.map((d) => d.horizonTier)),
    },
  };
}

// ============================================================================
// Per-stop pipeline
// ============================================================================

interface StopContext {
  allKennels: VisibleKennel[];
  filters: TravelSearchParams["filters"];
  now: Date;
}

interface WeatherInput {
  id: string;
  date: Date;
  latitude: number | null;
  longitude: number | null;
  kennel: { region: string };
}

interface StopOutcome {
  destination: DestinationResult;
  /** Rows from the primary pass, already tagged with destinationIndex. */
  primaryRows: {
    confirmed: ConfirmedResult[];
    likely: LikelyResult[];
    possible: PossibleResult[];
  };
  /**
   * Weather batch inputs for every confirmed row the stop produced (primary
   * + broader). Hoisted so the orchestrator can batch weather once across
   * all stops — multi-stop searches sharing a metro then share the upstream
   * Google Weather call instead of blowing through the per-stop 15-call cap.
   */
  weatherInputs: WeatherInput[];
}

async function runStopSearch(
  prisma: PrismaClient,
  stop: DestinationParams,
  index: number,
  ctx: StopContext,
): Promise<StopOutcome> {
  const { latitude, longitude, label } = stop;
  const destinationLabel = label ?? null;
  // Defense in depth: clamp the request radius at the service boundary.
  // page.tsx and validateSearchParams both clamp upstream, but this is
  // also called from the saved-trips dashboard with persisted values
  // and any future caller could bypass the upstream gates. Floor at 1
  // so an accidental zero/negative doesn't yield an empty result set.
  const radiusKm = Math.max(1, Math.min(MAX_RADIUS_KM, stop.radiusKm));
  const now = ctx.now;

  // Step 1: Parse + clamp dates.
  // rawEndDate is the user's requested end — uncapped, so we can tell
  // downstream that this was the intent. Two separate derived bounds:
  //   - confirmedEndDate: bounds the confirmed-event DB query. Past the
  //     projection horizon but capped at CONFIRMED_EVENT_HORIZON_DAYS so
  //     a 5-year URL doesn't fan out Event.findMany across every kennel.
  //   - projectionEndDate: bounds the RRULE loop so it doesn't iterate
  //     unboundedly on far-future trips.
  const startDate = parseUtcNoonDate(stop.startDate);
  const rawEndDate = parseUtcNoonDate(stop.endDate);
  const confirmedHorizonMax = new Date(
    now.getTime() + CONFIRMED_EVENT_HORIZON_DAYS * DAY_MS,
  );
  const confirmedEndDate = rawEndDate.getTime() < confirmedHorizonMax.getTime()
    ? rawEndDate
    : confirmedHorizonMax;
  const projectionEndDate = clampToProjectionHorizon(rawEndDate, now);
  const horizonTier = projectionHorizonForStart(startDate, now);

  // Broader pass fires either when primary has no kennels in radius or when
  // primary had kennels but no unfiltered results (dormant-kennel case).
  // Broader excludes primary IDs so results are strictly additional.
  const primary = filterByRadius(ctx.allKennels, latitude, longitude, radiusKm);
  const broaderRadiusKm = Math.min(radiusKm * 3, MAX_RADIUS_KM);
  const computeBroader = () => {
    const primaryIds = new Set(primary.map((k) => k.id));
    return filterByRadius(ctx.allKennels, latitude, longitude, broaderRadiusKm)
      .filter((k) => !primaryIds.has(k.id));
  };

  let broader: NearbyKennel[] = [];
  if (primary.length === 0) {
    broader = computeBroader();
    if (broader.length === 0) {
      return {
        destination: {
          index,
          label: destinationLabel,
          startDate,
          endDate: rawEndDate,
          horizonTier,
          radiusKm,
          kennelsSearched: 0,
          emptyState: "no_coverage",
          broaderRadiusKm,
        },
        primaryRows: { confirmed: [], likely: [], possible: [] },
        weatherInputs: [],
      };
    }
  }

  const runPipelineFor = async (kennels: NearbyKennel[]) => {
    const nearbyIds = kennels.map((k) => k.id);
    const kennelMap = new Map(kennels.map((k) => [k.id, k]));

    // Steps 3–5 + 8: Three independent DB queries run in parallel (saves ~2 round-trips)
    const twelveWeeksAgo = new Date(now.getTime() - TWELVE_WEEKS_MS);
    const [confirmedEvents, scheduleRules, evidenceEvents] = await Promise.all([
    // Step 3: Confirmed events in date window. Allowed past the 365-day
    // projection horizon (real NYE events 18mo out still render) but
    // bounded by CONFIRMED_EVENT_HORIZON_DAYS + a row cap so a pathological
    // date range can't time out the function or bust the RSC payload limit.
    prisma.event.findMany({
      where: {
        ...CANONICAL_EVENT_WHERE,
        kennelId: { in: nearbyIds },
        date: { gte: startDate, lte: confirmedEndDate },
        status: "CONFIRMED",
      },
      include: {
        eventLinks: { select: { url: true, label: true } },
      },
      orderBy: { date: "asc" },
      take: CONFIRMED_EVENT_ROW_CAP,
    }),
    // Step 5: Active schedule rules
    prisma.scheduleRule.findMany({
      where: {
        kennelId: { in: nearbyIds },
        isActive: true,
      },
    }),
    // Step 8: Evidence data for timelines (last 12 weeks, batched — no N+1)
    prisma.event.findMany({
      where: {
        ...CANONICAL_EVENT_WHERE,
        kennelId: { in: nearbyIds },
        status: "CONFIRMED",
        date: { gte: twelveWeeksAgo, lte: now },
      },
      select: { kennelId: true, date: true },
    }),
  ]);
  const evidenceByKennel = groupBy(evidenceEvents, (e) => e.kennelId);

  // Step 6: Project trails
  const ruleInputs: ScheduleRuleInput[] = scheduleRules.map((r) => ({
    id: r.id,
    kennelId: r.kennelId,
    rrule: r.rrule,
    anchorDate: r.anchorDate,
    startTime: r.startTime,
    confidence: r.confidence,
    notes: r.notes,
  }));
  const projections = projectTrails(ruleInputs, startDate, projectionEndDate);

  // Step 7: Score confidence using evidence events (last ~12 weeks ≈ 84 days,
  // close to the 90-day window the scoring function expects)
  const scoredProjections = scoreProjections(projections, kennelMap, scheduleRules, evidenceEvents);

  // Step 9: Deduplicate projections against confirmed events
  const confirmedRefs = confirmedEvents.map((e) => ({
    kennelId: e.kennelId,
    date: e.date,
    startTime: e.startTime,
  }));
  const dedupedProjections = deduplicateAgainstConfirmed(scoredProjections, confirmedRefs);
  const horizonFilteredProjections = filterProjectionsByHorizon(dedupedProjections, horizonTier);

  // Step 10: Classify into likely vs possible
  const likelyProjections = horizonFilteredProjections.filter(
    (p): p is ProjectedTrail & { date: Date; confidence: "high" | "medium" } =>
      p.date !== null && (p.confidence === "high" || p.confidence === "medium"),
  );
  const possibleProjections = horizonFilteredProjections.filter(
    (p) => p.confidence === "low" || p.date === null,
  );

  // Step 11 was: build a per-kennel aggregate of eventLinks. Removed:
  // when kennel X had multiple confirmed events in the window, every
  // result card got the same union of every event's links — wrong
  // attribution. Each confirmed result now reads its own event.eventLinks
  // directly (loaded at step 4); likely/possible results have no event so
  // they continue to get the kennel's own social links only.

  // Weather inputs are collected here and hoisted to the orchestrator so a
  // multi-stop search shares one bounded MAX_WEATHER_API_CALLS batch.
  const weatherInputs: WeatherInput[] = [];

  // Step 13: Assign distance tiers + build result objects
  const confirmedResults: ConfirmedResult[] = confirmedEvents.map((event) => {
    const kennel = kennelMap.get(event.kennelId);
    const eventLat = event.latitude ?? kennel?.latitude;
    const eventLng = event.longitude ?? kennel?.longitude;
    const distanceKm = eventLat != null && eventLng != null
      ? haversineDistance(latitude, longitude, eventLat, eventLng)
      : kennel?.distanceKm ?? 0;

    weatherInputs.push({
      id: event.id,
      date: event.date,
      latitude: eventLat ?? null,
      longitude: eventLng ?? null,
      kennel: { region: kennel?.region ?? "" },
    });

    return {
      type: "confirmed" as const,
      destinationIndex: index,
      destinationLabel,
      eventId: event.id,
      kennelId: event.kennelId,
      kennelSlug: kennel?.slug ?? "",
      kennelName: kennel?.shortName ?? "",
      kennelFullName: kennel?.fullName ?? "",
      kennelRegion: kennel?.region ?? "",
      kennelPinColor: kennel?.regionRef?.pinColor ?? null,
      date: event.date,
      startTime: event.startTime,
      title: event.title,
      runNumber: event.runNumber,
      haresText: event.haresText,
      locationName: event.locationName,
      locationStreet: event.locationStreet,
      locationCity: event.locationCity,
      timezone: event.timezone,
      sourceUrl: event.sourceUrl,
      distanceKm,
      distanceTier: distanceTier(distanceKm),
      sourceLinks: buildSourceLinks(kennel, event.eventLinks, event.sourceUrl),
      weather: null,
    };
  });

  const likelyResults: LikelyResult[] = likelyProjections.map((proj) => {
    const kennel = kennelMap.get(proj.kennelId);
    return {
      type: "likely" as const,
      destinationIndex: index,
      destinationLabel,
      kennelId: proj.kennelId,
      kennelSlug: kennel?.slug ?? "",
      kennelName: kennel?.shortName ?? "",
      kennelFullName: kennel?.fullName ?? "",
      kennelRegion: kennel?.region ?? "",
      kennelPinColor: kennel?.regionRef?.pinColor ?? null,
      date: proj.date,
      startTime: proj.startTime,
      confidence: proj.confidence,
      distanceKm: kennel?.distanceKm ?? 0,
      distanceTier: distanceTier(kennel?.distanceKm ?? 0),
      explanation: proj.explanation,
      evidenceWindow: proj.evidenceWindow,
      evidenceTimeline: buildEvidenceTimeline(
        evidenceByKennel.get(proj.kennelId) ?? [],
        now,
      ),
      sourceLinks: buildSourceLinks(kennel),
    };
  });

  const possibleResults: PossibleResult[] = possibleProjections.map((proj) => {
    const kennel = kennelMap.get(proj.kennelId);
    const evidence = evidenceByKennel.get(proj.kennelId) ?? [];
    const lastConfirmedAt = evidence.length > 0
      ? new Date(evidence.reduce((max, e) => Math.max(max, e.date.getTime()), 0))
      : null;
    return {
      type: "possible" as const,
      destinationIndex: index,
      destinationLabel,
      kennelId: proj.kennelId,
      kennelSlug: kennel?.slug ?? "",
      kennelName: kennel?.shortName ?? "",
      kennelFullName: kennel?.fullName ?? "",
      kennelRegion: kennel?.region ?? "",
      date: proj.date,
      confidence: "low" as const,
      distanceKm: kennel?.distanceKm ?? 0,
      distanceTier: distanceTier(kennel?.distanceKm ?? 0),
      explanation: proj.explanation,
      sourceLinks: buildSourceLinks(kennel),
      lastConfirmedAt,
    };
  });

    const unfilteredTotal =
      confirmedResults.length + likelyResults.length + possibleResults.length;
    const filtered = applyFilters(confirmedResults, likelyResults, possibleResults, ctx.filters);

    filtered.confirmed.sort(byDateTimeDistance);
    filtered.likely.sort(byDateTimeDistance);
    filtered.possible.sort((a, b) => a.distanceKm - b.distanceKm);

    // Possible rows display only "Timing varies" + distance, so multiple
    // cadence hits for the same kennel (weekly rule firing twice in a
    // 14-day window) collapse to one row. Sort-then-dedup keeps the
    // closest distance tier.
    filtered.possible = dedupePossibleByKennel(filtered.possible);

    return { filtered, unfilteredTotal, weatherInputs };
  };

  const firstPassKennels = primary.length > 0 ? primary : broader;
  const firstPass = await runPipelineFor(firstPassKennels);
  let filtered = firstPass.filtered;
  let passWeatherInputs = firstPass.weatherInputs;
  let nearbyKennels = firstPassKennels;
  let primaryEffectivelyEmpty = primary.length === 0;

  // Retry broader only when primary had kennels but produced NO unfiltered
  // results — i.e. the radius is genuinely dormant. If the primary had
  // results that the user's active filters excluded, a broader pass would
  // hit the same filter and waste 3 DB round-trips.
  const shouldRetryBroader =
    primary.length > 0 && firstPass.unfilteredTotal === 0 && horizonTier !== "none";

  if (shouldRetryBroader) {
    broader = computeBroader();
    if (broader.length > 0) {
      const broaderPass = await runPipelineFor(broader);
      if (broaderPass.unfilteredTotal > 0) {
        filtered = broaderPass.filtered;
        passWeatherInputs = broaderPass.weatherInputs;
        nearbyKennels = broader;
        primaryEffectivelyEmpty = true;
      }
    }
  }

  // Step 16: Determine empty state.
  // The empty state reflects what the user should see, independent of filters:
  // - no_coverage: zero kennels found even in broader pass
  // - no_nearby: primary radius had zero kennels, but broader pass found some
  // - no_confirmed: confirmed events empty, but likely/possible exist
  // - out_of_horizon: nothing in range past the 365-day projection horizon
  // - none: has results in the primary radius
  let emptyState: EmptyStateKind = "none";
  let broaderResultsObj: DestinationResult["broaderResults"];

  const totalResults =
    filtered.confirmed.length + filtered.likely.length + filtered.possible.length;

  if (primaryEffectivelyEmpty && broader.length > 0) {
    emptyState = "no_nearby";
    broaderResultsObj = {
      confirmed: filtered.confirmed,
      likely: filtered.likely,
      possible: filtered.possible,
    };
  } else if (totalResults === 0 && horizonTier === "none") {
    // Past the 365-day projection horizon and nobody posted an event that
    // far out. Differentiate from "no_confirmed" so EmptyStates copy can
    // explain the situation instead of implying the filter is the issue.
    emptyState = "out_of_horizon";
  } else if (filtered.confirmed.length === 0 && (filtered.likely.length > 0 || filtered.possible.length > 0)) {
    emptyState = "no_confirmed";
  }

  return {
    destination: {
      index,
      label: destinationLabel,
      startDate,
      endDate: rawEndDate,
      horizonTier,
      radiusKm,
      kennelsSearched: nearbyKennels.length,
      emptyState,
      // Only emit when the broader pass actually ran and was adopted —
      // TripSummary reads this as the "effective" radius and would otherwise
      // label every primary-only search as expanded.
      broaderRadiusKm: primaryEffectivelyEmpty ? broaderRadiusKm : undefined,
      broaderResults: broaderResultsObj,
    },
    primaryRows: {
      confirmed: primaryEffectivelyEmpty ? [] : filtered.confirmed,
      likely: primaryEffectivelyEmpty ? [] : filtered.likely,
      possible: primaryEffectivelyEmpty ? [] : filtered.possible,
    },
    weatherInputs: passWeatherInputs,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Aggregate per-stop empty states into a single top-level banner state.
 * Rule: if any stop has confirmed results, show nothing. Otherwise surface
 * the most "explanatory" state across stops — coverage > horizon > nearby >
 * confirmed. Per-stop states still live on `destinations[i].emptyState`
 * for inline hints.
 */
function aggregateEmptyState(stops: DestinationResult[]): EmptyStateKind {
  if (stops.length === 0) return "no_coverage";
  // "none" wins if any stop has confirmed results — the UI shouldn't
  // suppress a good result from stop 0 because stop 2 is out of horizon.
  const anyNone = stops.some((s) => s.emptyState === "none");
  if (anyNone) return "none";
  if (stops.every((s) => s.emptyState === "no_coverage")) return "no_coverage";
  if (stops.every((s) => s.emptyState === "out_of_horizon")) return "out_of_horizon";
  if (stops.some((s) => s.emptyState === "no_nearby")) return "no_nearby";
  // Mixed empties that aren't uniform coverage/horizon — most common when
  // every stop has likely/possible but no confirmed. Fall back to
  // no_confirmed so the UI surfaces projections instead of the harsher
  // out-of-horizon / no-coverage copy.
  return "no_confirmed";
}

/** Worst-case horizon across stops: "none" > "high" > "all". */
function worstHorizonTier(tiers: ProjectionHorizonTier[]): ProjectionHorizonTier {
  if (tiers.includes("none")) return "none";
  if (tiers.includes("high")) return "high";
  return "all";
}

/** Fetch all non-hidden kennels with their coordinates and region data. */
async function fetchAllVisibleKennels(prisma: PrismaClient) {
  return prisma.kennel.findMany({
    where: { isHidden: false },
    select: {
      id: true,
      slug: true,
      shortName: true,
      fullName: true,
      region: true,
      latitude: true,
      longitude: true,
      lastEventDate: true,
      scheduleDayOfWeek: true,
      scheduleTime: true,
      scheduleFrequency: true,
      website: true,
      facebookUrl: true,
      instagramHandle: true,
      regionRef: { select: { pinColor: true, centroidLat: true, centroidLng: true } },
    },
  });
}

type VisibleKennel = Awaited<ReturnType<typeof fetchAllVisibleKennels>>[number];

/** Filter kennels to those within radiusKm, computing distance and using region centroid fallback. */
function filterByRadius(
  kennels: VisibleKennel[],
  lat: number,
  lng: number,
  radiusKm: number,
): NearbyKennel[] {
  const results: NearbyKennel[] = [];
  for (const k of kennels) {
    const kLat = k.latitude ?? k.regionRef?.centroidLat;
    const kLng = k.longitude ?? k.regionRef?.centroidLng;
    if (kLat == null || kLng == null) continue;

    const dist = haversineDistance(lat, lng, kLat, kLng);
    if (dist <= radiusKm) {
      results.push({ ...k, distanceKm: dist });
    }
  }
  return results;
}

/** Assign a human-friendly distance tier. */
function distanceTier(distanceKm: number): DistanceTier {
  if (distanceKm <= 10) return "nearby";
  if (distanceKm <= 25) return "area";
  return "drive";
}

/** Apply confidence scoring to each projection using kennel activity + rule-specific context. */
function scoreProjections(
  projections: ProjectedTrail[],
  kennelMap: Map<string, NearbyKennel>,
  scheduleRules: { id: string; lastValidatedAt: Date | null; kennelId: string }[],
  evidenceEvents: { kennelId: string }[],
): ProjectedTrail[] {
  // Count evidence events per kennel (last 12 weeks ≈ 84 days,
  // close to the 90-day window scoreConfidence was designed for)
  const eventCounts = new Map<string, number>();
  for (const e of evidenceEvents) {
    eventCounts.set(e.kennelId, (eventCounts.get(e.kennelId) ?? 0) + 1);
  }

  // Map from rule ID to its lastValidatedAt — score per-rule, not per-kennel,
  // to avoid cross-polluting confidence between unrelated rules on the same kennel
  const ruleValidation = new Map<string, Date | null>();
  for (const r of scheduleRules) {
    ruleValidation.set(r.id, r.lastValidatedAt);
  }

  return projections.map((proj) => {
    const kennel = kennelMap.get(proj.kennelId);
    if (!kennel) return proj;

    const kennelCtx: KennelContext = {
      id: kennel.id,
      shortName: kennel.shortName,
      scheduleDayOfWeek: kennel.scheduleDayOfWeek,
      scheduleTime: kennel.scheduleTime,
      scheduleFrequency: kennel.scheduleFrequency,
      lastEventDate: kennel.lastEventDate,
    };

    // Use the specific rule's lastValidatedAt, not the kennel-level aggregate
    const scored = scoreConfidence(
      proj.confidence,
      kennelCtx,
      eventCounts.get(proj.kennelId) ?? 0,
      ruleValidation.get(proj.scheduleRuleId) ?? null,
    );

    return { ...proj, confidence: scored };
  });
}

/** Build source links for a kennel from its social fields + event links. */
/** Build source links, sanitizing all URLs to http/https only (XSS defense). */
function buildSourceLinks(
  kennel?: NearbyKennel | null,
  eventLinks?: { url: string; label: string }[],
  eventSourceUrl?: string | null,
): SourceLink[] {
  const links: SourceLink[] = [];
  if (!kennel) return links;

  // Only add if URL passes the protocol allowlist AND the label is non-empty
  // after trim. Empty/whitespace labels come from DB rows (EventLink.label)
  // and render as "check their  closer to your trip" — silently broken UI.
  function addIfSafe(url: string | null | undefined, label: string, type: SourceLink["type"]) {
    const safe = safeUrl(url);
    const cleanLabel = label.trim();
    if (!safe || !cleanLabel) return;
    if (links.some((l) => l.url === safe)) return;
    links.push({ url: safe, label: cleanLabel, type });
  }

  addIfSafe(kennel.website, "Kennel Website", "website");
  addIfSafe(kennel.facebookUrl, "Facebook", "facebook");

  if (kennel.instagramHandle) {
    const handle = kennel.instagramHandle.replace(/^@/, "");
    addIfSafe(`https://instagram.com/${handle}`, "Instagram", "instagram");
  }

  if (eventLinks) {
    for (const link of eventLinks) {
      addIfSafe(link.url, link.label, inferLinkType(link.url, link.label));
    }
  }

  addIfSafe(eventSourceUrl, "Source", inferLinkType(eventSourceUrl ?? ""));

  return links;
}

/** Infer a SourceLink type from URL or label. */
function inferLinkType(url: string, label?: string): SourceLink["type"] {
  const lower = (url + " " + (label ?? "")).toLowerCase();
  if (lower.includes("facebook.com") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("hashrego.com")) return "hashrego";
  if (lower.includes("meetup.com")) return "meetup";
  return "website";
}

/**
 * Fetch weather for confirmed events using the shared deduping/capped batch
 * helper from src/lib/weather.ts. That helper:
 *   - Groups events by location key (~10km coord grid OR region centroid),
 *     so kennels in the same metro share ONE Google Weather API call (each
 *     call returns 10 days of forecasts).
 *   - Caps total upstream calls at MAX_WEATHER_API_CALLS (15) to avoid
 *     quota exhaustion on dense trips.
 *   - Filters internally to the 10-day forecast window.
 *
 * On any failure the helper returns {} for the affected location, so weather
 * pills disappear gracefully without breaking the search.
 */
async function loadConfirmedWeather(
  inputs: WeatherInput[],
): Promise<Record<string, DailyWeather>> {
  if (inputs.length === 0) return {};
  try {
    return await getWeatherForEvents(inputs);
  } catch (err) {
    console.error("[travel] Weather batch failed; rendering without weather", err);
    return {};
  }
}

/** Apply user-selected filters to results. */
function applyFilters(
  confirmed: ConfirmedResult[],
  likely: LikelyResult[],
  possible: PossibleResult[],
  filters?: TravelSearchParams["filters"],
): { confirmed: ConfirmedResult[]; likely: LikelyResult[]; possible: PossibleResult[] } {
  if (!filters) return { confirmed, likely, possible };

  let fc = confirmed;
  let fl = likely;
  let fp = possible;

  if (filters.confidence && filters.confidence.length > 0) {
    const allowed = new Set(filters.confidence);
    // Confirmed events are always "confirmed" — only filter if the user explicitly deselected
    if (!allowed.has("high") && !allowed.has("medium")) {
      fl = [];
    } else {
      fl = fl.filter((r) => allowed.has(r.confidence));
    }
    if (!allowed.has("low")) {
      fp = [];
    }
  }

  if (filters.distanceTier && filters.distanceTier.length > 0) {
    const allowed = new Set(filters.distanceTier);
    fc = fc.filter((r) => allowed.has(r.distanceTier));
    fl = fl.filter((r) => allowed.has(r.distanceTier));
    fp = fp.filter((r) => allowed.has(r.distanceTier));
  }

  return { confirmed: fc, likely: fl, possible: fp };
}

/** Keep the first row per kennel. Call AFTER distance sort to keep the closest tier. */
function dedupePossibleByKennel(rows: PossibleResult[]): PossibleResult[] {
  const seen = new Set<string>();
  const out: PossibleResult[] = [];
  for (const r of rows) {
    if (seen.has(r.kennelId)) continue;
    seen.add(r.kennelId);
    out.push(r);
  }
  return out;
}

/** Group array elements by a key function. Polyfill-safe alternative to Map.groupBy. */
function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
