/**
 * Half-Mind discovery sync.
 *
 * Reads Half-Mind's finder one scope at a time and files listings that pass the
 * import bar into the KennelDiscovery queue as NEW rows for an admin to review.
 * It never matches, links, aliases or creates anything on its own. For listings
 * an admin already linked (or added as a kennel), it refreshes the kennel's
 * Half-Mind check when the listing has a newer one, and flags listings that
 * Half-Mind marks dead or no longer lists.
 */

import { prisma } from "@/lib/db";
import { Prisma, type KennelDiscovery } from "@/generated/prisma/client";
import {
  fetchHalfMindListings,
  passesImportBar,
  scopeKey,
  type HalfMindListing,
  type HalfMindScope,
} from "@/adapters/half-mind/client";
import { HALF_MIND_EXTERNAL_SOURCE, halfMindListingUrl } from "@/lib/half-mind";
import { confirmKennelRunningFor, type StatusInput } from "@/lib/kennel-confirmations";
import { revalidateKennel } from "@/lib/kennel-revalidate";
import {
  loadDiscoveryCandidates,
  rankDiscoveryCandidates,
  roundMatchScore,
  type KennelGeoData,
} from "@/pipeline/kennel-discovery";
import type { FuzzyCandidate } from "@/lib/fuzzy";

export { HALF_MIND_EXTERNAL_SOURCE } from "@/lib/half-mind";

/** Pilot scope. More regions are a one-line change after the owner reviews the pilot. */
export const HALF_MIND_SYNC_SCOPES: HalfMindScope[] = [{ country: "USA", state: "GA" }];

export interface HalfMindSyncResult {
  scopes: number;
  fetched: number;
  passedBar: number;
  created: number;
  updated: number;
  refreshedChecks: number;
  /** Newer checks not recorded because the kennel is stopped. Counted, never an error. */
  skippedStopped: number;
  flaggedDeadOrMissing: number;
  errors: string[];
}

/** The confirmation note for a Half-Mind check, e.g. "Half-Mind listing checked Oct 7, 2026". */
export function halfMindCheckNote(checkedAt: Date): string {
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(checkedAt);
  return `Half-Mind listing checked ${day}`;
}

/** The confirmation input that credits a listing's check. */
export function halfMindCheckInput(listingId: string, checkedAt: Date): StatusInput {
  return {
    observedOn: checkedAt.toISOString().slice(0, 10),
    note: halfMindCheckNote(checkedAt),
    url: halfMindListingUrl(listingId),
  };
}

type BarFields = Pick<
  KennelDiscovery,
  "externalStatus" | "externalCheckedAt" | "website" | "facebookUrl" | "latitude" | "longitude"
>;

/** The import bar, re-checked at action time against what the last sync stored on the row. */
export function rowPassesImportBar(row: BarFields, now: Date): boolean {
  const status = row.externalStatus === "alive" || row.externalStatus === "dead" ? row.externalStatus : "unknown";
  return passesImportBar(
    {
      status,
      lastVerifiedAt: row.externalCheckedAt,
      website: row.website,
      facebookUrl: row.facebookUrl,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    now,
  );
}

const LINKED_STATUSES = new Set(["LINKED", "ADDED"]);

type StoredRow = Pick<
  KennelDiscovery,
  "id" | "externalSlug" | "externalScope" | "status" | "matchedKennelId" | "processedBy"
>;

interface SyncContext {
  now: Date;
  candidates: FuzzyCandidate[];
  geoMap: Map<string, KennelGeoData>;
  result: HalfMindSyncResult;
}

function emptyResult(): HalfMindSyncResult {
  return {
    scopes: 0,
    fetched: 0,
    passedBar: 0,
    created: 0,
    updated: 0,
    refreshedChecks: 0,
    skippedStopped: 0,
    flaggedDeadOrMissing: 0,
    errors: [],
  };
}

/** The ranked top 3 in the shape Hash Rego rows use: `[{ id, shortName, score }]` + best score. */
function rankListing(listing: HalfMindListing, ctx: SyncContext) {
  const ranked = rankDiscoveryCandidates(
    [listing.name],
    { lat: listing.latitude, lng: listing.longitude, country: listing.country },
    ctx.candidates,
    ctx.geoMap,
  ).map((c) => ({ id: c.id, shortName: c.shortName, score: roundMatchScore(c.score) }));
  return {
    matchCandidates: ranked.length > 0 ? (ranked as Prisma.InputJsonValue) : Prisma.DbNull,
    matchScore: ranked[0]?.score ?? null,
  };
}

function listingFields(listing: HalfMindListing, key: string, ctx: SyncContext) {
  return {
    name: listing.name,
    location: [listing.city, listing.state, listing.country].filter(Boolean).join(", ") || null,
    latitude: listing.latitude,
    longitude: listing.longitude,
    schedule: listing.schedule,
    website: listing.website,
    facebookUrl: listing.facebookUrl,
    externalUrl: halfMindListingUrl(listing.id),
    externalStatus: listing.status,
    externalCheckedAt: listing.lastVerifiedAt,
    externalScope: key,
    lastSeenAt: ctx.now,
    ...rankListing(listing, ctx),
  };
}

/** Record a linked kennel's newer Half-Mind check, crediting the admin who linked it. */
async function refreshCheck(
  listing: HalfMindListing,
  checkedAt: Date,
  row: StoredRow,
  kennelId: string,
  ctx: SyncContext,
) {
  if (!row.processedBy) {
    ctx.result.errors.push(`Half-Mind listing ${listing.id}: linked row has no reviewer, so its check was not refreshed`);
    return;
  }
  const url = halfMindListingUrl(listing.id);
  const outcome = await confirmKennelRunningFor(
    row.processedBy,
    kennelId,
    halfMindCheckInput(listing.id, checkedAt),
    ctx.now,
    { via: "HALF_MIND", onlyIfNewerForUrl: url },
  );
  if ("success" in outcome) {
    ctx.result.refreshedChecks++;
    await revalidateKennel(kennelId);
  } else if ("stopped" in outcome) {
    ctx.result.skippedStopped++;
  } else if ("error" in outcome) {
    ctx.result.errors.push(`Half-Mind listing ${listing.id}: ${outcome.error}`);
  }
}

async function syncListing(
  listing: HalfMindListing,
  row: StoredRow | undefined,
  holderId: string | undefined,
  key: string,
  ctx: SyncContext,
) {
  const passes = passesImportBar(listing, ctx.now);
  if (passes) ctx.result.passedBar++;
  // Only listings that pass the bar enter the queue; stored rows always refresh.
  if (!row && !passes) return;

  const fields = listingFields(listing, key, ctx);
  await prisma.kennelDiscovery.upsert({
    where: {
      externalSource_externalSlug: { externalSource: HALF_MIND_EXTERNAL_SOURCE, externalSlug: listing.id },
    },
    create: {
      externalSource: HALF_MIND_EXTERNAL_SOURCE,
      externalSlug: listing.id,
      status: "NEW",
      ...fields,
    },
    // Never `status`: a row stays as the admin left it.
    update: fields,
  });
  if (!row) {
    ctx.result.created++;
    return;
  }
  ctx.result.updated++;
  if (!LINKED_STATUSES.has(row.status)) return;
  if (listing.status === "dead") ctx.result.flaggedDeadOrMissing++;
  // Refresh only while the row's kennel still holds this listing (an unlink clears it).
  // (A listing passing the bar always has a check date.)
  if (passes && listing.lastVerifiedAt && holderId && holderId === row.matchedKennelId) {
    await refreshCheck(listing, listing.lastVerifiedAt, row, holderId, ctx);
  }
}

async function syncScope(scope: HalfMindScope, ctx: SyncContext) {
  const key = scopeKey(scope);
  const response = await fetchHalfMindListings(scope, ctx.now);
  if (response.errors.length > 0) {
    // Any error makes the scope's picture unreliable: write nothing for it.
    ctx.result.errors.push(...response.errors.map((e) => `${key}: ${e}`));
    return;
  }
  const { listings } = response;
  ctx.result.fetched += listings.length;
  const ids = listings.map((l) => l.id);

  const [rows, holders] = await Promise.all([
    prisma.kennelDiscovery.findMany({
      where: {
        externalSource: HALF_MIND_EXTERNAL_SOURCE,
        OR: [{ externalSlug: { in: ids } }, { externalScope: key }],
      },
      select: {
        id: true, externalSlug: true, externalScope: true,
        status: true, matchedKennelId: true, processedBy: true,
      },
    }),
    prisma.kennel.findMany({
      where: { halfMindListingId: { in: ids } },
      select: { id: true, halfMindListingId: true },
    }),
  ]);
  const rowBySlug = new Map(rows.map((r) => [r.externalSlug, r]));
  const holderByListing = new Map(holders.map((k) => [k.halfMindListingId, k.id]));

  for (const listing of listings) {
    try {
      await syncListing(listing, rowBySlug.get(listing.id), holderByListing.get(listing.id), key, ctx);
    } catch (err) {
      ctx.result.errors.push(`Half-Mind listing ${listing.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // A complete response that no longer lists a linked listing: flag it, never stop the kennel.
  if (response.truncated) return;
  const listed = new Set(ids);
  const missing = rows.filter(
    (r) => r.externalScope === key && LINKED_STATUSES.has(r.status) && !listed.has(r.externalSlug),
  );
  if (missing.length === 0) return;
  await prisma.kennelDiscovery.updateMany({
    where: { id: { in: missing.map((r) => r.id) } },
    data: { externalStatus: "missing" },
  });
  ctx.result.flaggedDeadOrMissing += missing.length;
}

/** Sync Half-Mind listings into the discovery queue, one scope after another. */
export async function syncHalfMindDiscovery(
  scopes: HalfMindScope[] = HALF_MIND_SYNC_SCOPES,
  now: Date = new Date(),
): Promise<HalfMindSyncResult> {
  const { candidates, geoMap } = await loadDiscoveryCandidates();
  const ctx: SyncContext = { now, candidates, geoMap, result: emptyResult() };
  for (const scope of scopes) {
    ctx.result.scopes++;
    try {
      await syncScope(scope, ctx);
    } catch (err) {
      ctx.result.errors.push(`${scopeKey(scope)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return ctx.result;
}
