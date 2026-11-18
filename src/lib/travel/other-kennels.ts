/**
 * "Other kennels near {place}": quiet kennels in the search radius that a thin
 * single-stop Travel search does not already show. Pure and client-safe.
 */

import { getKennelState, type KennelEvidence } from "@/lib/kennel-status";
import { kennelOwnPageUrl } from "@/lib/safe-url";
import { regionNameToSlug } from "@/lib/region";

export const OTHER_KENNELS_LIMIT = 5;
/** Show the section when confirmed + likely runs number fewer than this. */
export const FEW_RUNS_THRESHOLD = 3;

export type OtherKennelCandidate = KennelEvidence & {
  id: string;
  slug: string;
  shortName: string;
  fullName: string;
  region: string;
  website: string | null;
  facebookUrl: string | null;
  distanceKm: number;
  listingOnly: boolean;
  halfMindListingId: string | null;
};

export interface OtherKennel {
  kennelId: string;
  slug: string;
  shortName: string;
  fullName: string;
  region: string;
  distanceKm: number;
  evidence: KennelEvidence;
  ownPageUrl: string | null;
  listingOnly: boolean;
  halfMindListingId: string | null;
}

export function shouldShowOtherKennels(confirmedCount: number, likelyCount: number): boolean {
  return confirmedCount + likelyCount < FEW_RUNS_THRESHOLD;
}

function qualifies(k: OtherKennelCandidate, now: Date): boolean {
  const state = getKennelState(k, now);
  return state === "quiet" || (k.listingOnly && state === "running");
}

export function selectOtherKennels(
  nearby: OtherKennelCandidate[],
  shownKennelIds: ReadonlySet<string>,
  now: Date,
  limit: number = OTHER_KENNELS_LIMIT,
): OtherKennel[] {
  return nearby
    .filter((k) => !shownKennelIds.has(k.id) && qualifies(k, now))
    .sort((a, b) => a.distanceKm - b.distanceKm || a.shortName.localeCompare(b.shortName))
    .slice(0, limit)
    .map((k) => ({
      kennelId: k.id,
      slug: k.slug,
      shortName: k.shortName,
      fullName: k.fullName,
      region: k.region,
      distanceKm: k.distanceKm,
      evidence: {
        lastRunSeenAt: k.lastRunSeenAt,
        nextRunPostedAt: k.nextRunPostedAt,
        lastConfirmedAt: k.lastConfirmedAt,
        lastConfirmedVia: k.lastConfirmedVia,
        stoppedAt: k.stoppedAt,
      },
      ownPageUrl: kennelOwnPageUrl(k.website, k.facebookUrl),
      listingOnly: k.listingOnly,
      halfMindListingId: k.halfMindListingId,
    }));
}

export function otherKennelsHeading(place: string): string {
  const name = place.trim();
  // A saved trip can have no label, which would leave "Other kennels near " dangling.
  return name ? `Other kennels near ${name}` : "Other kennels nearby";
}

/** Link to the closest listed kennel's region page, or the directory when it has no slug. */
export function otherKennelsBrowseLink(
  kennels: Pick<OtherKennel, "region">[],
): { label: string; href: string } | null {
  if (kennels.length === 0) return null;
  const region = kennels[0].region;
  const slug = regionNameToSlug(region);
  return slug
    ? { label: `Browse kennels in ${region}`, href: `/kennels/region/${slug}` }
    : { label: "Browse the kennel directory", href: "/kennels" };
}
