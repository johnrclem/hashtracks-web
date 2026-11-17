import { prisma } from "@/lib/db";

/**
 * Admin-side guards for archive sources (docs/onboarding-backfill-automation-design.md 6.5).
 *
 * An archive source holds one backfill's history. It is never enabled (a DB
 * CHECK backs that), scraped (`scrapeSource` refuses) or deleted, and its
 * name, type, trust and single kennel link stay as the run recorded them.
 */
export const ARCHIVE_SOURCE_LOCKED =
  "This is an archive source holding a backfill's history (onboarding backfill design 6.5). " +
  "It can't be enabled, deleted, scraped, renamed, retyped, re-trusted or relinked.";

export const ARCHIVE_KENNEL_LOCKED =
  "This kennel has an archive source holding a backfill's history (onboarding backfill design 6.5). " +
  "Undo the backfill from /admin/backfills before deleting or merging the kennel.";

export async function isArchiveSource(sourceId: string): Promise<boolean> {
  const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { archiveOnly: true } });
  return source?.archiveOnly === true;
}

/** True when any archive source is linked to the kennel. */
export async function kennelHasArchiveSource(kennelId: string): Promise<boolean> {
  const link = await prisma.sourceKennel.findFirst({
    where: { kennelId, source: { archiveOnly: true } },
    select: { id: true },
  });
  return link !== null;
}
