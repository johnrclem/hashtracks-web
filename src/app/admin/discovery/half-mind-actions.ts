"use server";

/**
 * Admin review actions for Half-Mind rows in the discovery queue. The Hash Rego
 * actions in ./actions.ts refuse these rows: a Half-Mind listing never becomes an
 * alias or a SourceKennel, only `Kennel.halfMindListingId` plus credited checks.
 */

import { revalidatePath } from "next/cache";
import type { KennelDiscovery, Prisma } from "@/generated/prisma/client";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { HALF_MIND_DISMISS_NEW_ONLY, HALF_MIND_EXTERNAL_SOURCE, halfMindListingUrl } from "@/lib/half-mind";
import { confirmKennelRunningFor, revertHalfMindChecksFor } from "@/lib/kennel-confirmations";
import { revalidateKennel } from "@/lib/kennel-revalidate";
import { isUniqueConstraintViolation } from "@/lib/prisma-errors";
import { createKennelFromDiscovery } from "@/app/admin/shared/kennel-creation";
import { halfMindCheckInput, rowPassesImportBar, syncHalfMindDiscovery } from "@/pipeline/half-mind-discovery";

/** A stored candidate at or above this score makes "Add" ask for confirmation first. */
const DUPLICATE_SCORE = 0.8;

type Candidate = { id: string; shortName: string; score: number };
type CheckOutcome = "recorded" | "not-alive" | "too-old" | "stopped" | { error: string };

/** The admin plus the Half-Mind row an action works on, or why it must refuse. */
async function loadHalfMindRow(
  discoveryId: string,
): Promise<{ adminId: string; row: KennelDiscovery } | { error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };
  const row = await prisma.kennelDiscovery.findUnique({ where: { id: discoveryId } });
  if (!row) return { error: "Discovery not found" };
  if (row.externalSource !== HALF_MIND_EXTERNAL_SOURCE) return { error: "This is not a Half-Mind row." };
  return { adminId: admin.id, row };
}

function alreadyLinkedTo(shortName: string): string {
  return `That Half-Mind listing is already linked to ${shortName}.`;
}

function kennelHasListing(shortName: string, listingId: string): string {
  return `${shortName} is already linked to Half-Mind listing #${listingId}. Unlink it first.`;
}

const LINK_NEW_ONLY = "Only a NEW Half-Mind row can be linked.";

/** Thrown inside a transaction to refuse and roll back with a message for the admin. */
class Refusal extends Error {}

async function listingHolder(listingId: string) {
  return prisma.kennel.findUnique({
    where: { halfMindListingId: listingId },
    select: { id: true, shortName: true },
  });
}

/** The best stored candidate, read defensively from the row's JSON. */
function bestCandidate(json: Prisma.JsonValue | null): Candidate | null {
  if (!Array.isArray(json)) return null;
  let best: Candidate | null = null;
  for (const c of json) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) continue;
    const { id, shortName, score } = c;
    if (typeof id !== "string" || typeof shortName !== "string" || typeof score !== "number") continue;
    if (!best || score > best.score) best = { id, shortName, score };
  }
  return best;
}

/**
 * Credit the row's Half-Mind check to a kennel an admin just linked or added,
 * when the row still passes the import bar. No `onlyIfNewerForUrl`: a deliberate
 * relink after an unlink records the current check again.
 */
async function recordRowCheck(adminId: string, kennelId: string, row: KennelDiscovery, now: Date): Promise<CheckOutcome> {
  if (row.externalStatus !== "alive") return "not-alive";
  if (!row.externalCheckedAt || !rowPassesImportBar(row, now)) return "too-old";
  const outcome = await confirmKennelRunningFor(
    adminId,
    kennelId,
    halfMindCheckInput(row.externalSlug, row.externalCheckedAt),
    now,
    { via: "HALF_MIND" },
  );
  if ("stopped" in outcome) return "stopped";
  if ("error" in outcome) return outcome;
  return "recorded";
}

/** What to tell the admin when a link or add recorded no check; undefined when it did. */
function checkWarning(done: "Linked" | "Added", outcome: CheckOutcome): string | undefined {
  if (outcome === "recorded") return undefined;
  if (outcome === "too-old") return `${done}; the Half-Mind check is too old to record.`;
  if (outcome === "stopped") return `${done}; the kennel is stopped, so the check was not recorded.`;
  if (outcome === "not-alive") return `${done}; Half-Mind doesn't mark this kennel alive, so the check was not recorded.`;
  return `${done}; the check was not recorded: ${outcome.error}`;
}

/** Run the Half-Mind sync for the pilot scopes. */
export async function runHalfMindSync() {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };
  try {
    const result = await syncHalfMindDiscovery();
    revalidatePath("/admin/discovery");
    return { success: true as const, ...result };
  } catch (err) {
    return { error: `Half-Mind sync failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Link a NEW Half-Mind row to an existing kennel (one listing per kennel). */
export async function linkHalfMindListing(
  discoveryId: string,
  kennelId: string,
): Promise<{ success: true; warning?: string } | { error: string }> {
  const loaded = await loadHalfMindRow(discoveryId);
  if ("error" in loaded) return loaded;
  const { adminId, row } = loaded;
  if (row.status !== "NEW") return { error: LINK_NEW_ONLY };

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { id: true, shortName: true, halfMindListingId: true },
  });
  if (!kennel) return { error: "Kennel not found" };
  if (kennel.halfMindListingId && kennel.halfMindListingId !== row.externalSlug) {
    return { error: kennelHasListing(kennel.shortName, kennel.halfMindListingId) };
  }
  const holder = await listingHolder(row.externalSlug);
  if (holder && holder.id !== kennelId) return { error: alreadyLinkedTo(holder.shortName) };

  const now = new Date();
  try {
    // The checks above are re-made by the writes themselves: a link to this
    // kennel, a link of this row or a dismiss may have landed since.
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.kennel.updateMany({
        where: { id: kennelId, OR: [{ halfMindListingId: null }, { halfMindListingId: row.externalSlug }] },
        data: { halfMindListingId: row.externalSlug },
      });
      if (claimed.count === 0) {
        const current = await tx.kennel.findUnique({
          where: { id: kennelId },
          select: { shortName: true, halfMindListingId: true },
        });
        throw new Refusal(
          current?.halfMindListingId ? kennelHasListing(current.shortName, current.halfMindListingId) : "Kennel not found",
        );
      }
      const marked = await tx.kennelDiscovery.updateMany({
        where: { id: row.id, status: "NEW" },
        data: { status: "LINKED", matchedKennelId: kennelId, processedBy: adminId, processedAt: now },
      });
      if (marked.count === 0) throw new Refusal(LINK_NEW_ONLY);
    });
  } catch (err) {
    if (err instanceof Refusal) return { error: err.message };
    // A concurrent link won the unique halfMindListingId.
    if (!isUniqueConstraintViolation(err, ["halfMindListingId"])) throw err;
    const winner = await listingHolder(row.externalSlug);
    return { error: alreadyLinkedTo(winner?.shortName ?? "another kennel") };
  }

  const warning = checkWarning("Linked", await recordRowCheck(adminId, kennelId, row, now));
  revalidatePath("/admin/discovery");
  await revalidateKennel(kennelId);
  return warning ? { success: true, warning } : { success: true };
}

/** Undo a link: clear the kennel's listing, revert that listing's checks, put the row back to NEW. */
export async function unlinkHalfMindListing(discoveryId: string): Promise<{ success: true } | { error: string }> {
  const loaded = await loadHalfMindRow(discoveryId);
  if ("error" in loaded) return loaded;
  const { row } = loaded;
  if (row.status !== "LINKED" || !row.matchedKennelId) return { error: "Only a linked Half-Mind row can be unlinked." };
  const kennelId = row.matchedKennelId;

  const cleared = await prisma.$transaction(async (tx) => {
    const { count } = await tx.kennel.updateMany({
      where: { id: kennelId, halfMindListingId: row.externalSlug },
      data: { halfMindListingId: null },
    });
    await tx.kennelDiscovery.update({
      where: { id: row.id },
      data: { status: "NEW", matchedKennelId: null, processedBy: null, processedAt: null },
    });
    return count;
  });
  // After the listing id is cleared, so the sync (which re-checks the holder
  // under the kennel lock) can't refresh the kennel again. Only this listing's
  // checks, and only when this unlink cleared it: a kennel that now holds
  // another listing keeps that listing's checks.
  if (cleared > 0) await revertHalfMindChecksFor(kennelId, halfMindListingUrl(row.externalSlug), new Date());
  revalidatePath("/admin/discovery");
  await revalidateKennel(kennelId);
  return { success: true };
}

/** Create a listing-only kennel from a NEW Half-Mind row. */
export async function addListingOnlyKennel(
  discoveryId: string,
  data: { shortName: string; fullName: string; regionId: string },
  opts: { confirmNotDuplicate?: boolean } = {},
): Promise<{ success: true; kennelId: string; warning?: string } | { error: string; duplicateOf?: Candidate }> {
  const loaded = await loadHalfMindRow(discoveryId);
  if ("error" in loaded) return loaded;
  const { adminId, row } = loaded;
  if (row.status !== "NEW") return { error: "Only a NEW Half-Mind row can be added." };
  const shortName = data.shortName?.trim();
  const fullName = data.fullName?.trim();
  if (!shortName || !fullName || !data.regionId) return { error: "Short name, full name and region are required." };

  if (!opts.confirmNotDuplicate) {
    const best = bestCandidate(row.matchCandidates);
    if (best && best.score >= DUPLICATE_SCORE) {
      return { error: `This listing looks like ${best.shortName} (match ${best.score}).`, duplicateOf: best };
    }
  }
  const holder = await listingHolder(row.externalSlug);
  if (holder) return { error: alreadyLinkedTo(holder.shortName) };

  // No alias from the numeric id and no ScheduleRule: the listing is the only evidence.
  const result = await createKennelFromDiscovery(row.id, adminId, {
    shortName,
    fullName,
    regionId: data.regionId,
    website: row.website ?? undefined,
    facebookUrl: row.facebookUrl,
    scheduleNotes: row.schedule,
    latitude: row.latitude,
    longitude: row.longitude,
    listingOnly: true,
    halfMindListingId: row.externalSlug,
  });
  if ("error" in result) return result;

  const warning = checkWarning("Added", await recordRowCheck(adminId, result.kennelId, row, new Date()));
  revalidatePath("/admin/discovery");
  await revalidateKennel(result.kennelId);
  return warning ? { success: true, kennelId: result.kennelId, warning } : { success: true, kennelId: result.kennelId };
}

/** Dismiss a NEW Half-Mind row (a duplicate or a listing we don't want). */
export async function dismissHalfMindListing(discoveryId: string): Promise<{ success: true } | { error: string }> {
  const loaded = await loadHalfMindRow(discoveryId);
  if ("error" in loaded) return loaded;
  const { adminId, row } = loaded;
  if (row.status !== "NEW") return { error: HALF_MIND_DISMISS_NEW_ONLY };

  // Conditional: a link or add may have landed since the row was read.
  const { count } = await prisma.kennelDiscovery.updateMany({
    where: { id: row.id, status: "NEW" },
    data: { status: "DISMISSED", processedBy: adminId, processedAt: new Date() },
  });
  if (count === 0) return { error: HALF_MIND_DISMISS_NEW_ONLY };
  revalidatePath("/admin/discovery");
  return { success: true };
}
