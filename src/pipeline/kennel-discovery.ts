/**
 * Kennel Discovery sync pipeline.
 *
 * Orchestrates: Hash Rego directory parse → API profile enrichment → fuzzy match → upsert.
 * Called by the admin "Sync Now" action.
 */

import { prisma } from "@/lib/db";
import { fuzzyMatch, type FuzzyCandidate } from "@/lib/fuzzy";
import { parseKennelDirectory } from "@/adapters/hashrego/kennel-directory-parser";
import {
  fetchKennelProfiles,
  buildScheduleString,
  buildPaymentInfo,
  normalizeTrailDay,
  type HashRegoKennelProfile,
} from "@/adapters/hashrego/kennel-api";
import { Prisma } from "@/generated/prisma/client";

const EXTERNAL_SOURCE = "HASHREGO";
const AUTO_MATCH_THRESHOLD = 0.95;
const CANDIDATE_THRESHOLD = 0.6;

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
    const res = await fetch("https://hashrego.com/kennels/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
    });
    if (!res.ok) {
      return {
        totalDiscovered: 0, newKennels: 0, autoMatched: 0, updated: 0, enriched: 0,
        errors: [`Directory fetch failed: HTTP ${res.status}`],
      };
    }
    pageHtml = await res.text();
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

  // Step 2: Fetch API profiles + load DB data in parallel
  const slugs = discovered.map((k) => k.slug);
  const [profiles, existingKennels, existingAliases, existingDiscoveries] = await Promise.all([
    fetchKennelProfiles(slugs),
    prisma.kennel.findMany({
      select: { id: true, shortName: true, fullName: true },
      where: { isHidden: false },
    }),
    prisma.kennelAlias.findMany({
      select: { kennelId: true, alias: true },
    }),
    prisma.kennelDiscovery.findMany({
      where: { externalSource: EXTERNAL_SOURCE },
      select: { externalSlug: true, status: true },
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

  const discoveryStatusMap = new Map(
    existingDiscoveries.map((d) => [d.externalSlug, d.status]),
  );

  // Step 5: Process each discovered kennel
  const syncTimestamp = new Date();
  for (const kennel of discovered) {
    try {
      const profile = profiles.get(kennel.slug);
      const existingStatus = discoveryStatusMap.get(kennel.slug);
      const isTerminal = existingStatus === "MATCHED" || existingStatus === "ADDED" ||
        existingStatus === "LINKED" || existingStatus === "DISMISSED";

      // Build enriched data from directory + API profile
      const schedule = profile
        ? buildScheduleString(profile.trail_frequency, profile.trail_day) || kennel.schedule
        : kennel.schedule;

      const profileData = buildProfileData(profile);

      if (isTerminal) {
        // Only update lastSeenAt + profile fields for terminal statuses
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
        updated++;
        continue;
      }

      // Fuzzy match against slug and full name
      const slugMatches = fuzzyMatch(kennel.slug, candidates, 3);
      const nameMatches = fuzzyMatch(
        profile?.name || kennel.name,
        candidates,
        3,
      );

      // Take the best score across both
      const allMatches = [...slugMatches, ...nameMatches];
      const bestByKennel = new Map<string, { id: string; shortName: string; score: number }>();
      for (const m of allMatches) {
        const existing = bestByKennel.get(m.id);
        if (!existing || m.score > existing.score) {
          bestByKennel.set(m.id, m);
        }
      }
      const ranked = [...bestByKennel.values()].sort((a, b) => b.score - a.score);
      const best = ranked[0];

      let status: "NEW" | "MATCHED" = "NEW";
      let matchedKennelId: string | null = null;
      let matchScore: number | null = null;
      let matchCandidates: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;

      if (best && best.score >= AUTO_MATCH_THRESHOLD) {
        status = "MATCHED";
        matchedKennelId = best.id;
        matchScore = best.score;
      } else if (best && best.score >= CANDIDATE_THRESHOLD) {
        matchScore = best.score;
        matchCandidates = ranked
          .filter((m) => m.score >= CANDIDATE_THRESHOLD)
          .slice(0, 3)
          .map((m) => ({ id: m.id, shortName: m.shortName, score: Math.round(m.score * 100) / 100 })) as unknown as Prisma.InputJsonValue;
      }

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
          status,
          matchedKennelId,
          matchScore,
          matchCandidates,
        },
        update: {
          name: profile?.name || kennel.name,
          location: kennel.location || undefined,
          latitude: kennel.latitude,
          longitude: kennel.longitude,
          schedule,
          lastSeenAt: new Date(),
          ...profileData,
          // Re-run matching for NEW entries (aliases may have changed)
          status,
          matchedKennelId,
          matchScore,
          matchCandidates,
        },
      });

      if (existingStatus) {
        updated++;
      } else {
        newKennels++;
        if (status === "MATCHED") autoMatched++;
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
    memberCount: profile.member_count || undefined,
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
