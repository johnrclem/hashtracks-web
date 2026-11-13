import { prisma } from "@/lib/db";
import { safeUrl } from "@/lib/safe-url";
import { refreshKennelEvidence } from "@/pipeline/kennel-evidence";

/**
 * DB work for the admin kennel-status actions (src/app/admin/kennels/status-actions.ts).
 * Kept out of the "use server" file so these admin-id-taking functions are not
 * exposed as client-callable server actions.
 */

export interface StatusInput {
  /** YYYY-MM-DD, UTC, not in the future. */
  observedOn: string;
  note: string;
  url?: string;
}

type ValidInput = { observedAt: Date; note: string; url: string | null };

export type ConfirmResult = { success: true } | { error: string };
export type StopResult =
  | { success: true; disabledSources: number; deactivatedRules: number }
  | { error: string };
export type RestartResult =
  | { success: true; enabledSources: number; reactivatedRules: number }
  | { error: string };

const NOTE_MIN = 3;
const NOTE_MAX = 500;

function toUtcNoon(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
}

function formatDay(d: Date, now: Date): string {
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(d);
}

/**
 * Refresh the kennel's cached evidence after its write has committed. A failure
 * is logged, not thrown: the write landed, so the action must still report
 * success (a retried stop would otherwise say "Already stopped"), and the
 * nightly refresh repairs the cache.
 */
/** Refresh one kennel's cached evidence after a write; a failure is logged, never thrown. */
export async function refreshAfterWrite(kennelId: string, now: Date): Promise<void> {
  try {
    await refreshKennelEvidence([kennelId], now);
  } catch (err) {
    console.error("[kennel-status] evidence refresh failed; the nightly refresh will repair it", { kennelId }, err);
  }
}

/** Serialize stop/restart per kennel: lock the Kennel row until the transaction ends. */
async function lockKennel(tx: Pick<typeof prisma, "$queryRaw">, kennelId: string) {
  await tx.$queryRaw`SELECT id FROM "Kennel" WHERE id = ${kennelId} FOR UPDATE`;
}

export function validateStatusInput(input: StatusInput, now: Date): ValidInput | { error: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.observedOn ?? "");
  if (!m) return { error: "Enter the date as YYYY-MM-DD" };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const observedAt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  if (
    observedAt.getUTCFullYear() !== y ||
    observedAt.getUTCMonth() !== mo - 1 ||
    observedAt.getUTCDate() !== d
  ) {
    return { error: "That date does not exist" };
  }
  if (observedAt.getTime() > toUtcNoon(now)) return { error: "The date cannot be in the future" };

  const note = (input.note ?? "").trim();
  if (note.length < NOTE_MIN) return { error: `Say how you know, in at least ${NOTE_MIN} characters` };
  if (note.length > NOTE_MAX) return { error: `Keep the note to ${NOTE_MAX} characters or fewer` };

  let url: string | null = null;
  if (input.url?.trim()) {
    url = safeUrl(input.url);
    if (!url) return { error: "The link must start with http:// or https://" };
  }
  return { observedAt, note, url };
}

/** The newest evidence dated after `observedAt`, as a sentence fragment, or null. */
function evidenceAfter(
  k: { lastRunSeenAt: Date | null; lastConfirmedAt: Date | null; nextRunPostedAt: Date | null },
  observedAt: Date,
  now: Date,
): string | null {
  const limit = toUtcNoon(observedAt);
  const candidates = [
    { at: k.lastRunSeenAt, text: (s: string) => `HashTracks saw a run on ${s}` },
    { at: k.lastConfirmedAt, text: (s: string) => `an admin confirmed this kennel running on ${s}` },
    { at: k.nextRunPostedAt, text: (s: string) => `a run is posted for ${s}` },
  ]
    .filter((c): c is { at: Date; text: (s: string) => string } => !!c.at && toUtcNoon(c.at) > limit)
    .sort((a, b) => toUtcNoon(b.at) - toUtcNoon(a.at));
  const newest = candidates[0];
  return newest ? `${newest.text(formatDay(newest.at, now))}, after that date` : null;
}

export async function confirmKennelRunningFor(
  adminId: string,
  kennelId: string,
  input: StatusInput,
  now: Date = new Date(),
): Promise<ConfirmResult> {
  const valid = validateStatusInput(input, now);
  if ("error" in valid) return valid;
  const kennel = await prisma.kennel.findUnique({ where: { id: kennelId }, select: { id: true } });
  if (!kennel) return { error: "Kennel not found" };

  const outcome = await prisma.$transaction(async (tx) => {
    await lockKennel(tx, kennelId);
    // A stop keeps its schedule sources and rules off; a later confirmation
    // would clear stoppedAt and show "Running" while they stay off.
    const open = await tx.kennelConfirmation.findFirst({
      where: { kennelId, kind: "STOPPED", revertedAt: null },
      select: { id: true },
    });
    if (open) return { error: "This kennel is stopped — restart it first." } as const;
    await tx.kennelConfirmation.create({
      data: {
        kennelId,
        kind: "RUNNING",
        observedAt: valid.observedAt,
        note: valid.note,
        url: valid.url,
        createdById: adminId,
      },
    });
    return { success: true } as const;
  });
  if (outcome.success) await refreshAfterWrite(kennelId, now);
  return outcome;
}

export async function stopKennelFor(
  adminId: string,
  kennelId: string,
  input: StatusInput,
  now: Date = new Date(),
): Promise<StopResult> {
  const valid = validateStatusInput(input, now);
  if ("error" in valid) return valid;

  const outcome = await prisma.$transaction(async (tx) => {
    await lockKennel(tx, kennelId);
    const kennel = await tx.kennel.findUnique({
      where: { id: kennelId },
      select: { id: true, lastRunSeenAt: true, lastConfirmedAt: true, nextRunPostedAt: true },
    });
    if (!kennel) return { error: "Kennel not found" } as const;
    const open = await tx.kennelConfirmation.findFirst({
      where: { kennelId, kind: "STOPPED", revertedAt: null },
      select: { id: true },
    });
    if (open) return { error: "Already stopped — restart it first." } as const;
    const later = evidenceAfter(kennel, valid.observedAt, now);
    if (later) return { error: `Can't stop this kennel as of that date: ${later}` } as const;

    // Only STATIC_SCHEDULE sources that feed this kennel and no other.
    const linked = await tx.source.findMany({
      where: {
        type: "STATIC_SCHEDULE",
        enabled: true,
        kennels: { some: { kennelId } },
        NOT: { kennels: { some: { kennelId: { not: kennelId } } } },
      },
      select: { id: true },
    });
    const rules = await tx.scheduleRule.findMany({
      where: { kennelId, isActive: true },
      select: { id: true },
    });
    const disabledSourceIds = linked.map((s) => s.id);
    const deactivatedRuleIds = rules.map((r) => r.id);

    if (disabledSourceIds.length) {
      await tx.source.updateMany({ where: { id: { in: disabledSourceIds } }, data: { enabled: false } });
    }
    if (deactivatedRuleIds.length) {
      await tx.scheduleRule.updateMany({ where: { id: { in: deactivatedRuleIds } }, data: { isActive: false } });
    }
    await tx.kennelConfirmation.create({
      data: {
        kennelId,
        kind: "STOPPED",
        observedAt: valid.observedAt,
        note: valid.note,
        url: valid.url,
        createdById: adminId,
        disabledSourceIds,
        deactivatedRuleIds,
      },
    });
    return {
      success: true,
      disabledSources: disabledSourceIds.length,
      deactivatedRules: deactivatedRuleIds.length,
    } as const;
  });

  if (outcome.success) await refreshAfterWrite(kennelId, now);
  return outcome;
}

export async function restartKennelFor(
  kennelId: string,
  now: Date = new Date(),
): Promise<RestartResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    await lockKennel(tx, kennelId);
    const stops = await tx.kennelConfirmation.findMany({
      where: { kennelId, kind: "STOPPED", revertedAt: null },
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
    });
    if (stops.length === 0) return { error: "This kennel has no stop to undo" } as const;

    const sourceIds = [...new Set(stops.flatMap((s) => s.disabledSourceIds))];
    const ruleIds = [...new Set(stops.flatMap((s) => s.deactivatedRuleIds))];
    if (sourceIds.length) {
      await tx.source.updateMany({ where: { id: { in: sourceIds } }, data: { enabled: true } });
    }
    if (ruleIds.length) {
      await tx.scheduleRule.updateMany({ where: { id: { in: ruleIds } }, data: { isActive: true } });
    }
    await tx.kennelConfirmation.updateMany({
      where: { id: { in: stops.map((s) => s.id) } },
      data: { revertedAt: now },
    });
    return {
      success: true,
      enabledSources: sourceIds.length,
      reactivatedRules: ruleIds.length,
    } as const;
  });

  if (outcome.success) await refreshAfterWrite(kennelId, now);
  return outcome;
}

