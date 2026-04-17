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

export interface TravelSearchParams {
  latitude: number;
  longitude: number;
  radiusKm: number;
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  timezone?: string;
  filters?: {
    confidence?: ("high" | "medium" | "low")[];
    distanceTier?: DistanceTier[];
  };
}

export interface SourceLink {
  url: string;
  label: string;
  type: "website" | "facebook" | "hashrego" | "instagram" | "meetup" | "other";
}

export interface ConfirmedResult {
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

export interface LikelyResult {
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

export interface PossibleResult {
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
  /**
   * Most recent confirmed event for this kennel in the 12-week evidence
   * window, if any. Rendered as "Last posted {date}" so the card gives
   * users a concrete "was this kennel active recently?" signal instead
   * of just a cadence string.
   */
  lastConfirmedAt: Date | null;
}

export interface TravelSearchResults {
  confirmed: ConfirmedResult[];
  likely: LikelyResult[];
  possible: PossibleResult[];
  broaderResults?: {
    confirmed: ConfirmedResult[];
    likely: LikelyResult[];
    possible: PossibleResult[];
  };
  emptyState: "none" | "no_confirmed" | "no_nearby" | "no_coverage" | "out_of_horizon";
  meta: {
    kennelsSearched: number;
    radiusKm: number;
    broaderRadiusKm?: number;
    /**
     * Which projection tier the search's start date falls into:
     *   "all" — within 180d, MEDIUM + HIGH projections both render
     *   "high" — 181-365d, only HIGH-confidence RRULE projections render
     *   "none" — past 365d, confirmed events only
     * UI surfaces this so TripSummary can explain why Likely looks sparse
     * for far-out searches.
     */
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

export async function executeTravelSearch(
  prisma: PrismaClient,
  params: TravelSearchParams,
): Promise<TravelSearchResults> {
  const { latitude, longitude } = params;
  // Defense in depth: clamp the request radius at the service boundary.
  // page.tsx and validateSearchParams both clamp upstream, but this is
  // also called from the saved-trips dashboard with persisted values
  // and any future caller could bypass the upstream gates. Floor at 1
  // so an accidental zero/negative doesn't yield an empty result set.
  const radiusKm = Math.max(1, Math.min(MAX_RADIUS_KM, params.radiusKm));
  const now = new Date();

  // Step 1: Parse + clamp dates
  // rawEndDate is the user's requested end — uncapped, so we can tell
  // downstream that this was the intent. Two separate derived bounds:
  //   - confirmedEndDate: bounds the confirmed-event DB query. Past the
  //     projection horizon but capped at CONFIRMED_EVENT_HORIZON_DAYS so
  //     a 5-year URL doesn't fan out Event.findMany across every kennel.
  //   - projectionEndDate: bounds the RRULE loop so it doesn't iterate
  //     unboundedly on far-future trips.
  const startDate = parseUtcNoonDate(params.startDate);
  const rawEndDate = parseUtcNoonDate(params.endDate);
  const confirmedHorizonMax = new Date(
    now.getTime() + CONFIRMED_EVENT_HORIZON_DAYS * DAY_MS,
  );
  const confirmedEndDate = rawEndDate.getTime() < confirmedHorizonMax.getTime()
    ? rawEndDate
    : confirmedHorizonMax;
  const projectionEndDate = clampToProjectionHorizon(rawEndDate, now);
  const horizonTier = projectionHorizonForStart(startDate, now);

  // Step 2: Find nearby kennels — primary pass always; broader pass fires
  // EITHER when primary is empty (no kennels in radius) OR when primary has
  // kennels but the full pipeline returns zero results (dormant-kennel case
  // — Codex finding from PR #739 review). `computeBroader` is lazy so we
  // only pay the second pipeline if the first truly came up empty.
  const allKennels = await fetchAllVisibleKennels(prisma);
  const primary = filterByRadius(allKennels, latitude, longitude, radiusKm);
  const broaderRadiusKm = Math.min(radiusKm * 3, MAX_RADIUS_KM);
  const computeBroader = () => {
    const primaryIds = new Set(primary.map((k) => k.id));
    return filterByRadius(allKennels, latitude, longitude, broaderRadiusKm)
      .filter((k) => !primaryIds.has(k.id));
  };

  // Case A: zero kennels even at the primary radius. Try broader upfront.
  // If broader is also empty → no_coverage; otherwise fall through with
  // broader kennels as the pipeline's input.
  let broader: NearbyKennel[] = [];
  if (primary.length === 0) {
    broader = computeBroader();
    if (broader.length === 0) {
      return {
        confirmed: [],
        likely: [],
        possible: [],
        emptyState: "no_coverage",
        meta: { kennelsSearched: 0, radiusKm, broaderRadiusKm, horizonTier },
      };
    }
  }

  // Steps 3-15 wrapped in a closure so we can run the full pipeline a second
  // time against a broader kennel set if primary comes back empty post-filter.
  // Closes over prisma + date bounds + filters from the outer executeTravelSearch
  // scope so the call-site stays short.
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

  // Step 12: Fetch weather. Reuses the deduping/capped batch from
  // src/lib/weather.ts: kennels in the same metro share one Google Weather
  // API call (one call returns 10 days), and total calls are capped at
  // MAX_WEATHER_API_CALLS (15). Earlier per-event Promise.all path could
  // burst 20+ concurrent upstream requests for a dense trip after the
  // 5→10 day window expansion; this avoids that.
  const weatherRecord = await loadConfirmedWeather(confirmedEvents, kennelMap);

  // Step 13: Assign distance tiers + build result objects
  const confirmedResults: ConfirmedResult[] = confirmedEvents.map((event) => {
    const kennel = kennelMap.get(event.kennelId);
    const eventLat = event.latitude ?? kennel?.latitude;
    const eventLng = event.longitude ?? kennel?.longitude;
    const distanceKm = eventLat != null && eventLng != null
      ? haversineDistance(latitude, longitude, eventLat, eventLng)
      : kennel?.distanceKm ?? 0;

    return {
      type: "confirmed" as const,
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
      weather: weatherRecord[event.id] ?? null,
    };
  });

  const likelyResults: LikelyResult[] = likelyProjections.map((proj) => {
    const kennel = kennelMap.get(proj.kennelId);
    return {
      type: "likely" as const,
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
    // Most recent confirmed event in the 12-week evidence window powers
    // the "Last posted …" metadata line on the Possible card. Null when
    // the kennel hasn't posted a run in the last ~84 days — we hide the
    // line rather than render "Last posted never".
    const lastConfirmedAt = evidence.length > 0
      ? new Date(Math.max(...evidence.map((e) => e.date.getTime())))
      : null;
    return {
      type: "possible" as const,
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

    // Step 14: Apply filters
    const filtered = applyFilters(confirmedResults, likelyResults, possibleResults, params.filters);

    // Step 15: Rank confirmed + likely by date → startTime → distance.
    filtered.confirmed.sort(byDateTimeDistance);
    filtered.likely.sort(byDateTimeDistance);
    filtered.possible.sort((a, b) => a.distanceKm - b.distanceKm);

    // Possible rows don't carry dates in the display ("Timing varies" is the
    // only meaningful content), so multiple cadence hits in the window for
    // the same kennel should collapse to one row. Sort-then-dedup keeps the
    // closest occurrence — matches the distance-ascending ordering users see.
    filtered.possible = dedupePossibleByKennel(filtered.possible);

    return filtered;
  };

  // Run the pipeline against primary (or upfront-broader when primary had
  // zero kennels). If primary had kennels but the pipeline returned nothing
  // actionable, expand the kennel set and try again — this is the Codex
  // dormant-kennel case (#783): a single kennel in the radius with no events
  // and no rules used to suppress the broader pass entirely.
  const firstPassKennels = primary.length > 0 ? primary : broader;
  let filtered = await runPipelineFor(firstPassKennels);
  let nearbyKennels = firstPassKennels;
  // Treats "primary kennels exist but yielded no results after broader
  // fallback" the same as "primary had no kennels at all" downstream — both
  // are the no_nearby empty state with broader promoted to broaderResults.
  let primaryEffectivelyEmpty = primary.length === 0;

  const totalFirstPass =
    filtered.confirmed.length + filtered.likely.length + filtered.possible.length;
  const shouldRetryBroader =
    primary.length > 0 && totalFirstPass === 0 && horizonTier !== "none";

  if (shouldRetryBroader) {
    broader = computeBroader();
    if (broader.length > 0) {
      const broaderFiltered = await runPipelineFor(broader);
      const totalBroader =
        broaderFiltered.confirmed.length +
        broaderFiltered.likely.length +
        broaderFiltered.possible.length;
      if (totalBroader > 0) {
        filtered = broaderFiltered;
        nearbyKennels = broader;
        primaryEffectivelyEmpty = true;
      }
    }
  }

  // Step 16: Determine empty state
  // The empty state reflects what the user should see, independent of filters:
  // - no_coverage: zero kennels found even in broader pass
  // - no_nearby: primary radius had zero kennels, but broader pass found some
  // - no_confirmed: confirmed events empty, but likely/possible exist
  // - none: has results in the primary radius
  let emptyState: TravelSearchResults["emptyState"] = "none";
  let broaderResultsObj: TravelSearchResults["broaderResults"];

  const totalResults =
    filtered.confirmed.length + filtered.likely.length + filtered.possible.length;

  if (primaryEffectivelyEmpty && broader.length > 0) {
    // Primary radius empty (literally, or pipeline yielded nothing and broader
    // filled in), broader found kennels → show broader as fallback.
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
    confirmed: primaryEffectivelyEmpty ? [] : filtered.confirmed,
    likely: primaryEffectivelyEmpty ? [] : filtered.likely,
    possible: primaryEffectivelyEmpty ? [] : filtered.possible,
    broaderResults: broaderResultsObj,
    emptyState,
    meta: {
      kennelsSearched: nearbyKennels.length,
      radiusKm,
      broaderRadiusKm,
      horizonTier,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

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
  events: { id: string; kennelId: string; date: Date; latitude: number | null; longitude: number | null }[],
  kennelMap: Map<string, NearbyKennel>,
): Promise<Record<string, DailyWeather>> {
  if (events.length === 0) return {};
  const enriched = events.map((e) => {
    const kennel = kennelMap.get(e.kennelId);
    return {
      id: e.id,
      date: e.date,
      latitude: e.latitude ?? kennel?.latitude ?? null,
      longitude: e.longitude ?? kennel?.longitude ?? null,
      kennel: { region: kennel?.region ?? "" },
    };
  });
  try {
    return await getWeatherForEvents(enriched);
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

/**
 * Collapse Possible rows to one per kennel, keeping the first occurrence.
 * Call AFTER distance sort so we keep the closest distance-tier card per
 * kennel. Two cadence rules on the same kennel (or one rule firing twice
 * inside the window) would otherwise show up as duplicate rows — QA flagged
 * this on London + Tokyo in PR #792 verification.
 */
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
