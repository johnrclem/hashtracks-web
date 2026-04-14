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
  type ProjectedTrail,
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
  emptyState: "none" | "no_confirmed" | "no_nearby" | "no_coverage";
  meta: {
    kennelsSearched: number;
    radiusKm: number;
    broaderRadiusKm?: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

const TWELVE_WEEKS_MS = 12 * 7 * 24 * 60 * 60 * 1000;

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
  const { latitude, longitude, radiusKm } = params;
  const now = new Date();

  // Step 1: Parse + clamp dates
  const startDate = parseUtcNoonDate(params.startDate);
  const rawEndDate = parseUtcNoonDate(params.endDate);
  const endDate = clampToProjectionHorizon(rawEndDate, now);

  // Step 2: Find nearby kennels — TWO passes
  const allKennels = await fetchAllVisibleKennels(prisma);
  const primary = filterByRadius(allKennels, latitude, longitude, radiusKm);

  let broader: NearbyKennel[] = [];
  let broaderRadiusKm: number | undefined;
  if (primary.length === 0) {
    broaderRadiusKm = Math.min(radiusKm * 3, 250);
    broader = filterByRadius(allKennels, latitude, longitude, broaderRadiusKm);
  }

  const nearbyKennels = primary.length > 0 ? primary : broader;
  const nearbyIds = nearbyKennels.map((k) => k.id);

  // No kennels found even in broader pass → no_coverage
  if (nearbyKennels.length === 0) {
    return {
      confirmed: [],
      likely: [],
      possible: [],
      emptyState: "no_coverage",
      meta: { kennelsSearched: 0, radiusKm, broaderRadiusKm },
    };
  }

  const kennelMap = new Map(nearbyKennels.map((k) => [k.id, k]));

  // Steps 3–5 + 8: Three independent DB queries run in parallel (saves ~2 round-trips)
  const twelveWeeksAgo = new Date(now.getTime() - TWELVE_WEEKS_MS);
  const [confirmedEvents, scheduleRules, evidenceEvents] = await Promise.all([
    // Step 3: Confirmed events in date window
    prisma.event.findMany({
      where: {
        kennelId: { in: nearbyIds },
        date: { gte: startDate, lte: endDate },
        status: "CONFIRMED",
      },
      include: {
        eventLinks: { select: { url: true, label: true } },
      },
      orderBy: { date: "asc" },
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
  const projections = projectTrails(ruleInputs, startDate, endDate);

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

  // Step 10: Classify into likely vs possible
  const likelyProjections = dedupedProjections.filter(
    (p): p is ProjectedTrail & { date: Date; confidence: "high" | "medium" } =>
      p.date !== null && (p.confidence === "high" || p.confidence === "medium"),
  );
  const possibleProjections = dedupedProjections.filter(
    (p) => p.confidence === "low" || p.date === null,
  );

  // Step 11: Build source links for each kennel
  const eventLinksByKennel = groupBy(
    confirmedEvents.flatMap((e) =>
      e.eventLinks.map((link) => ({ kennelId: e.kennelId, ...link })),
    ),
    (l) => l.kennelId,
  );

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
      sourceLinks: buildSourceLinks(kennel, eventLinksByKennel.get(event.kennelId), event.sourceUrl),
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
    };
  });

  // Step 14: Apply filters
  const filtered = applyFilters(confirmedResults, likelyResults, possibleResults, params.filters);

  // Step 15: Rank confirmed + likely by date → startTime → distance.
  filtered.confirmed.sort(byDateTimeDistance);
  filtered.likely.sort(byDateTimeDistance);
  filtered.possible.sort((a, b) => a.distanceKm - b.distanceKm);

  // Step 16: Determine empty state
  // The empty state reflects what the user should see, independent of filters:
  // - no_coverage: zero kennels found even in broader pass
  // - no_nearby: primary radius had zero kennels, but broader pass found some
  // - no_confirmed: confirmed events empty, but likely/possible exist
  // - none: has results in the primary radius
  let emptyState: TravelSearchResults["emptyState"] = "none";
  let broaderResultsObj: TravelSearchResults["broaderResults"];

  if (primary.length === 0 && broader.length > 0) {
    // Primary radius empty, broader found kennels → show broader as fallback
    emptyState = "no_nearby";
    broaderResultsObj = {
      confirmed: filtered.confirmed,
      likely: filtered.likely,
      possible: filtered.possible,
    };
  } else if (primary.length === 0 && broader.length === 0) {
    emptyState = "no_coverage";
  } else if (filtered.confirmed.length === 0 && (filtered.likely.length > 0 || filtered.possible.length > 0)) {
    emptyState = "no_confirmed";
  }

  // When emptyState is no_nearby, main result arrays are empty — results live in broaderResults
  const isPrimaryEmpty = primary.length === 0;

  return {
    confirmed: isPrimaryEmpty ? [] : filtered.confirmed,
    likely: isPrimaryEmpty ? [] : filtered.likely,
    possible: isPrimaryEmpty ? [] : filtered.possible,
    broaderResults: broaderResultsObj,
    emptyState,
    meta: {
      kennelsSearched: nearbyKennels.length,
      radiusKm,
      broaderRadiusKm,
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
