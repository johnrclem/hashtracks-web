/**
 * The ops digest's `backfills` block (docs/onboarding-backfill-automation-design.md 11.2)
 * and the owner's second-factor check (10.3, the Phase 2 entry and the digest).
 * Read-only.
 */
import { createClerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { WATCH_JOB } from "./agent";

const HOUR = 3_600_000;

export interface BackfillDigest {
  recentRuns: Array<{ id: string; prNumber: number; status: string; counts: unknown }>;
  /** Blocked, halted or failed runs, runs WAITING over 24 hours, leases expired over an hour. */
  needsYou: Array<{ id: string; prNumber: number; status: string; why: string }>;
  /** Runs blocked by the PII guard: a leak, not a bug (8.2). */
  piiLeaks: Array<{ id: string; prNumber: number }>;
  /** Archive drops in the last day's scrapes, by kennel id. */
  archiveDrops24h: Record<string, { cutoff: number; correction: number }>;
  /** Runs or undos that changed their kennel's status line (9.6). */
  statusLineChanges: Array<{ id: string; before: string; after: string }>;
  watch: { lastFinishedAt: string | null; stale: boolean };
}

function line(v: unknown, key: string): string | null {
  const entry = v && typeof v === "object" ? (v as Record<string, { line?: string }>)[key] : undefined;
  return entry?.line ?? null;
}

export async function buildBackfillDigest(now: Date = new Date()): Promise<BackfillDigest> {
  const [recent, attention, logs, lastWatch] = await Promise.all([
    prisma.backfillRun.findMany({
      where: { updatedAt: { gt: new Date(now.getTime() - 7 * 24 * HOUR) }, status: { not: "PREVIEW" } },
      select: { id: true, prNumber: true, status: true, counts: true, reasonCodes: true, statusLines: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.backfillRun.findMany({
      where: {
        OR: [
          { status: { in: ["BLOCKED", "HALTED", "VERIFY_FAILED"] } },
          { status: "WAITING", updatedAt: { lt: new Date(now.getTime() - 24 * HOUR) } },
          { leaseExpiresAt: { lt: new Date(now.getTime() - HOUR) } },
        ],
      },
      select: { id: true, prNumber: true, status: true, reasonCodes: true, leaseExpiresAt: true },
    }),
    prisma.scrapeLog.findMany({
      where: { startedAt: { gt: new Date(now.getTime() - 24 * HOUR) }, diagnosticContext: { path: ["archiveCutoff"], not: "null" } },
      select: { diagnosticContext: true },
    }),
    prisma.automationRun.findFirst({
      where: { automation: WATCH_JOB, status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  const drops: BackfillDigest["archiveDrops24h"] = {};
  for (const log of logs) {
    const byKennel = (log.diagnosticContext as { archiveCutoff?: { byKennel?: Record<string, { cutoff: number; correction: number }> } } | null)?.archiveCutoff?.byKennel ?? {};
    for (const [k, v] of Object.entries(byKennel)) {
      const d = (drops[k] ??= { cutoff: 0, correction: 0 });
      d.cutoff += v.cutoff;
      d.correction += v.correction;
    }
  }
  const changes: BackfillDigest["statusLineChanges"] = [];
  for (const r of recent) {
    for (const [a, b] of [["before", "after"], ["beforeUndo", "afterUndo"]]) {
      const before = line(r.statusLines, a);
      const after = line(r.statusLines, b);
      if (before !== null && after !== null && before !== after) changes.push({ id: r.id, before, after });
    }
  }
  const lastFinished = lastWatch?.finishedAt ?? null;
  return {
    recentRuns: recent.map((r) => ({ id: r.id, prNumber: r.prNumber, status: r.status, counts: r.counts })),
    needsYou: attention.map((r) => ({
      id: r.id,
      prNumber: r.prNumber,
      status: r.status,
      why: r.leaseExpiresAt && r.leaseExpiresAt.getTime() < now.getTime() - HOUR ? "lease expired over an hour ago" : r.reasonCodes.join("; ") || r.status,
    })),
    piiLeaks: recent.filter((r) => r.reasonCodes.some((c) => c.startsWith("G8"))).map((r) => ({ id: r.id, prNumber: r.prNumber })),
    archiveDrops24h: drops,
    statusLineChanges: changes,
    watch: { lastFinishedAt: lastFinished?.toISOString() ?? null, stale: !lastFinished || now.getTime() - lastFinished.getTime() > 26 * HOUR },
  };
}

export interface SecondFactorStatus {
  userId: string;
  totp: boolean;
  backupCodes: boolean;
  /** Phone numbers reserved for a second factor: must be none (10.3). */
  phoneSecondFactors: number;
  ok: boolean;
}

/**
 * The owner's second factors, read through Clerk's Backend API (10.3): TOTP and
 * backup codes on, no phone number reserved for a second factor. The owner's
 * Clerk user id comes from OWNER_CLERK_USER_ID; null when it isn't set.
 */
export async function ownerSecondFactors(): Promise<SecondFactorStatus | null> {
  const userId = process.env.OWNER_CLERK_USER_ID?.trim();
  if (!userId) return null;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const user = await clerk.users.getUser(userId);
  const phoneSecondFactors = user.phoneNumbers.filter((p) => p.reservedForSecondFactor).length;
  return {
    userId,
    totp: user.totpEnabled,
    backupCodes: user.backupCodeEnabled,
    phoneSecondFactors,
    ok: user.totpEnabled && user.backupCodeEnabled && phoneSecondFactors === 0,
  };
}
