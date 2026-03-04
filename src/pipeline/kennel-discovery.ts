/**
 * Kennel Discovery sync pipeline.
 *
 * Orchestrates: Hash Rego directory parse → API profile enrichment → fuzzy match → upsert.
 * Called by the admin "Sync Now" action.
 */

import { prisma } from "@/lib/db";
import { fuzzyMatch, type FuzzyCandidate } from "@/lib/fuzzy";
import { haversineDistance } from "@/lib/geo";
import { parseKennelDirectory } from "@/adapters/hashrego/kennel-directory-parser";
import {
  fetchKennelProfiles,
  buildScheduleString,
  buildPaymentInfo,
  normalizeTrailDay,
  type HashRegoKennelProfile,
} from "@/adapters/hashrego/kennel-api";
import { Prisma } from "@/generated/prisma/client";
import type { DiscoveredKennel } from "@/adapters/hashrego/kennel-directory-parser";

const EXTERNAL_SOURCE = "HASHREGO";
const AUTO_MATCH_THRESHOLD = 0.95;
const CANDIDATE_THRESHOLD = 0.6;

const DISTANCE_BANDS = [
  { maxKm: 100, penalty: 0 },
  { maxKm: 500, penalty: -0.1 },
  { maxKm: 2000, penalty: -0.3 },
  { maxKm: 5000, penalty: -0.45 },
  { maxKm: Infinity, penalty: -0.55 },
] as const;
const COUNTRY_MISMATCH_PENALTY = -0.15;
const SAME_COUNTRY_NEARBY_BONUS = 0.05;

interface MatchResult {
  status: "NEW" | "MATCHED";
  matchedKennelId: string | null;
  matchScore: number | null;
  matchCandidates: Prisma.InputJsonValue | typeof Prisma.DbNull;
}

/** Geo context for a candidate kennel from the DB. */
export interface KennelGeoData {
  country: string;
  centroidLat: number | null;
  centroidLng: number | null;
}

/** Geo context for a discovered kennel from the external source. */
export interface DiscoveryGeoContext {
  lat: number | null;
  lng: number | null;
  country: string | null;
}

const US_VARIANTS = ["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"];
const GB_VARIANTS = ["UK", "GB", "UNITED KINGDOM", "GREAT BRITAIN", "ENGLAND", "SCOTLAND", "WALES"];

/** Normalize country names/codes to a canonical form for comparison. */
export function normalizeCountry(country: string | null | undefined): string {
  if (!country) return "";
  const c = country.trim().toUpperCase();
  if (US_VARIANTS.includes(c)) return "US";
  if (GB_VARIANTS.includes(c)) return "GB";
  return c;
}

/** Extract a country guess from a location string like "Washington, DC, USA". */
export function parseCountryFromLocation(location: string | undefined): string | null {
  if (!location) return null;
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts.at(-1)!;
  // Reject 2-letter codes (likely US state abbreviations like "DC", "NY")
  if (/^[A-Z]{2}$/i.test(last)) return null;
  if (last.length > 30) return null;
  return last;
}

/**
 * Apply a geographic penalty to a text-based fuzzy score.
 * Returns an adjusted score (may go below 0, caller should clamp).
 *
 * Distance bands:
 * - < 100 km: no penalty (same metro)
 * - 100–500 km: -0.10 (neighboring region)
 * - 500–2000 km: -0.30 (same continent, far)
 * - 2000–5000 km: -0.45 (continent edge)
 * - > 5000 km: -0.55 (different continent)
 *
 * Country mismatch: additional -0.15
 * Same country + < 500 km: +0.05 bonus
 */
export function applyGeoPenalty(
  textScore: number,
  discovery: DiscoveryGeoContext,
  candidate: KennelGeoData,
): number {
  const hasDiscoveryCoords = discovery.lat != null && discovery.lng != null;
  const hasCandidateCoords = candidate.centroidLat != null && candidate.centroidLng != null;

  const discoveryCountry = normalizeCountry(discovery.country);
  const candidateCountry = normalizeCountry(candidate.country);
  const countriesKnown = discoveryCountry !== "" && candidateCountry !== "";
  const countryMatch = countriesKnown && discoveryCountry === candidateCountry;
  const countryMismatch = countriesKnown && discoveryCountry !== candidateCountry;

  // Both have coordinates — use distance-based penalty
  if (hasDiscoveryCoords && hasCandidateCoords) {
    const dist = haversineDistance(
      discovery.lat!, discovery.lng!,
      candidate.centroidLat!, candidate.centroidLng!,
    );

    const band = DISTANCE_BANDS.find(b => dist < b.maxKm)!;
    let penalty = band.penalty;
    if (countryMismatch) penalty += COUNTRY_MISMATCH_PENALTY;
    if (countryMatch && dist < 500) penalty += SAME_COUNTRY_NEARBY_BONUS;

    return textScore + penalty;
  }

  // Fall back to country-only check
  if (countryMismatch) return textScore + COUNTRY_MISMATCH_PENALTY;

  // Both missing or only one side has coords — return text score unchanged
  return textScore;
}

export interface DiscoverySyncResult {
  totalDiscovered: number;
  newKennels: number;
  autoMatched: number;
  updated: number;
  enriched: number;
  errors: string[];
}

/**
 * Fetch the Hash Rego kennel directory, enrich with API profile data,
 * fuzzy-match against existing kennels, and upsert into KennelDiscovery.
 */
export async function syncKennelDiscovery(): Promise<DiscoverySyncResult> {
  const errors: string[] = [];
  let newKennels = 0;
  let autoMatched = 0;
  let updated = 0;
  let enriched = 0;

  // Step 1: Fetch and parse the directory page
  let pageHtml: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch("https://hashrego.com/kennels/", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          totalDiscovered: 0, newKennels: 0, autoMatched: 0, updated: 0, enriched: 0,
          errors: [`Directory fetch failed: HTTP ${res.status}`],
        };
      }
      pageHtml = await res.text();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      totalDiscovered: 0, newKennels: 0, autoMatched: 0, updated: 0, enriched: 0,
      errors: [`Directory fetch error: ${err}`],
    };
  }

  const discovered = parseKennelDirectory(pageHtml);
  if (discovered.length === 0) {
    return {
      totalDiscovered: 0, newKennels: 0, autoMatched: 0, updated: 0, enriched: 0,
      errors: ["No kennels found in directory page — structure may have changed"],
    };
  }

  // Step 2: Load existing discoveries to identify terminal slugs
  const existingDiscoveries = await prisma.kennelDiscovery.findMany({
    where: { externalSource: EXTERNAL_SOURCE },
    select: { externalSlug: true, status: true },
  });

  const discoveryStatusMap = new Map(
    existingDiscoveries.map((d) => [d.externalSlug, d.status]),
  );

  // Step 3: Split slugs — only fetch API profiles for non-terminal discoveries
  const terminalStatuses = new Set(["ADDED", "LINKED", "DISMISSED"]);
  const activeSlugs = discovered
    .filter((k) => !terminalStatuses.has(discoveryStatusMap.get(k.slug) ?? ""))
    .map((k) => k.slug);

  // Step 4: Fetch API profiles (active only) + load kennels/aliases in parallel
  const [profiles, existingKennels, existingAliases] = await Promise.all([
    fetchKennelProfiles(activeSlugs),
    prisma.kennel.findMany({
      select: {
        id: true, shortName: true, fullName: true,
        country: true,
        regionRef: { select: { centroidLat: true, centroidLng: true } },
      },
      where: { isHidden: false },
      orderBy: { shortName: "asc" },
    }),
    prisma.kennelAlias.findMany({
      select: { kennelId: true, alias: true },
    }),
  ]);
  enriched = profiles.size;

  // Build fuzzy candidates with aliases
  const aliasMap = new Map<string, string[]>();
  for (const a of existingAliases) {
    const existing = aliasMap.get(a.kennelId) || [];
    existing.push(a.alias);
    aliasMap.set(a.kennelId, existing);
  }

  const candidates: FuzzyCandidate[] = existingKennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    aliases: aliasMap.get(k.id),
  }));

  // Build geo lookup for candidate kennels (region centroid + country)
  const geoMap = new Map<string, KennelGeoData>();
  for (const k of existingKennels) {
    geoMap.set(k.id, {
      country: k.country,
      centroidLat: k.regionRef?.centroidLat ?? null,
      centroidLng: k.regionRef?.centroidLng ?? null,
    });
  }

  // Step 5: Process each discovered kennel
  const syncTimestamp = new Date();
  for (const kennel of discovered) {
    try {
      const profile = profiles.get(kennel.slug);
      const existingStatus = discoveryStatusMap.get(kennel.slug);
      const isTerminal = existingStatus === "ADDED" ||
        existingStatus === "LINKED" || existingStatus === "DISMISSED";

      const schedule = profile
        ? buildScheduleString(profile.trail_frequency, profile.trail_day) || kennel.schedule
        : kennel.schedule;
      const profileData = buildProfileData(profile);

      if (isTerminal) {
        await updateTerminalDiscovery(kennel, profile, schedule, profileData, syncTimestamp);
        updated++;
        continue;
      }

      const match = computeMatchResult(kennel, profile, candidates, geoMap);

      await prisma.kennelDiscovery.upsert({
        where: {
          externalSource_externalSlug: {
            externalSource: EXTERNAL_SOURCE,
            externalSlug: kennel.slug,
          },
        },
        create: {
          externalSource: EXTERNAL_SOURCE,
          externalSlug: kennel.slug,
          name: profile?.name || kennel.name,
          location: kennel.location,
          latitude: kennel.latitude,
          longitude: kennel.longitude,
          schedule,
          externalUrl: kennel.url,
          ...profileData,
          ...match,
        },
        update: {
          name: profile?.name || kennel.name,
          location: kennel.location || undefined,
          latitude: kennel.latitude,
          longitude: kennel.longitude,
          schedule,
          lastSeenAt: new Date(),
          ...profileData,
          ...match,
        },
      });

      if (existingStatus) {
        updated++;
      } else {
        newKennels++;
        if (match.status === "MATCHED") autoMatched++;
      }
    } catch (err) {
      errors.push(`Error processing ${kennel.slug}: ${err}`);
    }
  }

  return {
    totalDiscovered: discovered.length,
    newKennels,
    autoMatched,
    updated,
    enriched,
    errors,
  };
}

/** Update a terminal-status discovery with fresh profile data (no re-matching). */
async function updateTerminalDiscovery(
  kennel: DiscoveredKennel,
  profile: HashRegoKennelProfile | undefined,
  schedule: string | undefined,
  profileData: Record<string, unknown>,
  syncTimestamp: Date,
) {
  await prisma.kennelDiscovery.update({
    where: {
      externalSource_externalSlug: {
        externalSource: EXTERNAL_SOURCE,
        externalSlug: kennel.slug,
      },
    },
    data: {
      lastSeenAt: syncTimestamp,
      name: profile?.name || kennel.name,
      location: kennel.location || undefined,
      latitude: kennel.latitude,
      longitude: kennel.longitude,
      schedule,
      ...profileData,
    },
  });
}

/** Compute fuzzy match result for a discovered kennel against existing DB kennels. */
function computeMatchResult(
  kennel: DiscoveredKennel,
  profile: HashRegoKennelProfile | undefined,
  candidates: FuzzyCandidate[],
  geoMap: Map<string, KennelGeoData>,
): MatchResult {
  // Increase limit from 3 → 5 so more candidates survive geo filtering
  const slugMatches = fuzzyMatch(kennel.slug, candidates, 5);
  const nameMatches = fuzzyMatch(profile?.name || kennel.name, candidates, 5);

  const allMatches = [...slugMatches, ...nameMatches];
  const bestByKennel = new Map<string, { id: string; shortName: string; score: number }>();
  for (const m of allMatches) {
    const existing = bestByKennel.get(m.id);
    if (!existing || m.score > existing.score) {
      bestByKennel.set(m.id, m);
    }
  }

  // Build discovery geo context from directory coords + profile country
  const discoveryGeo: DiscoveryGeoContext = {
    lat: kennel.latitude ?? null,
    lng: kennel.longitude ?? null,
    country: profile?.country ?? parseCountryFromLocation(kennel.location),
  };

  // Apply geo penalty to each candidate's text score (unclamped for ranking fidelity)
  const geoAdjusted = [...bestByKennel.values()].map((m) => {
    const candidateGeo = geoMap.get(m.id);
    const rawScore = candidateGeo
      ? applyGeoPenalty(m.score, discoveryGeo, candidateGeo)
      : m.score;
    return { ...m, score: rawScore };
  });

  // Rank on unclamped scores for tie-breaking fidelity
  const ranked = geoAdjusted.toSorted((a, b) => b.score - a.score);
  const best = ranked[0];

  // Clamp to [0, 1] only for persistence/display
  const clamp = (s: number) => Math.min(1, Math.max(0, s));

  if (best && best.score >= AUTO_MATCH_THRESHOLD) {
    return {
      status: "MATCHED",
      matchedKennelId: best.id,
      matchScore: Math.round(clamp(best.score) * 100) / 100,
      matchCandidates: Prisma.DbNull,
    };
  }

  if (best && best.score >= CANDIDATE_THRESHOLD) {
    return {
      status: "NEW",
      matchedKennelId: null,
      matchScore: Math.round(clamp(best.score) * 100) / 100,
      matchCandidates: ranked
        .filter((m) => m.score >= CANDIDATE_THRESHOLD)
        .slice(0, 3)
        .map((m) => ({ id: m.id, shortName: m.shortName, score: Math.round(clamp(m.score) * 100) / 100 })) as unknown as Prisma.InputJsonValue,
    };
  }

  return {
    status: "NEW",
    matchedKennelId: null,
    matchScore: null,
    matchCandidates: Prisma.DbNull,
  };
}

/** Extract profile fields from API data for DB upsert. */
function buildProfileData(profile: HashRegoKennelProfile | undefined) {
  if (!profile) return {};

  const paymentInfo = buildPaymentInfo(profile);
  const location = [profile.city, profile.state, profile.country]
    .filter(Boolean)
    .join(", ");

  return {
    website: profile.website || undefined,
    contactEmail: profile.email || undefined,
    yearStarted: profile.year_started,
    trailPrice: profile.trail_price,
    logoUrl: profile.logo_image_url || undefined,
    memberCount: profile.member_count ?? undefined,
    paymentInfo: paymentInfo as Prisma.InputJsonValue | undefined,
    // Prefer API location over directory location if available
    ...(location ? { location } : {}),
  };
}

/**
 * Map a Hash Rego API profile to Kennel creation fields.
 * Used by the "Add Kennel" action to pre-fill the form.
 */
export function mapProfileToKennelFields(
  profile: HashRegoKennelProfile,
): Record<string, string | number | null> {
  const paymentInfo = buildPaymentInfo(profile);
  let paymentLink: string | null = null;
  if (paymentInfo?.venmo) {
    paymentLink = `https://venmo.com/${paymentInfo.venmo.replace("@", "")}`;
  } else if (paymentInfo?.paypal) {
    paymentLink = `https://paypal.me/${paymentInfo.paypal}`;
  } else if (paymentInfo?.squareCash) {
    paymentLink = `https://cash.app/${paymentInfo.squareCash}`;
  }

  return {
    fullName: profile.name,
    website: profile.website,
    contactEmail: profile.email,
    foundedYear: profile.year_started,
    hashCash: profile.trail_price ? `$${profile.trail_price}` : null,
    scheduleFrequency: profile.trail_frequency,
    scheduleDayOfWeek: normalizeTrailDay(profile.trail_day) || null,
    paymentLink,
  };
}
