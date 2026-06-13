"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { detectRuleDrift, writeRuleDriftSnapshot } from "@/pipeline/rule-drift";

/** Server actions are POST endpoints anyone can hit — gate every one on admin (Codex review). */
async function requireAdmin(): Promise<void> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("Unauthorized");
}

const RECOMPUTE_TIMEOUT_MS = 25_000;

export type RecomputeResult = { ok: true; driftCount: number } | { ok: false; error: string };

/**
 * Admin-only on-demand rule-drift recompute. Runs the heavy live sweep (bounded by a timeout so a
 * slow query can't hang the request), persists a fresh `RuleDriftSnapshot`, and revalidates the
 * page. Returns an explicit error result on failure — the caller MUST surface it (never a silent
 * "no drift" green).
 */
export async function recomputeRuleDrift(): Promise<RecomputeResult> {
  await requireAdmin();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const findings = await Promise.race([
      detectRuleDrift(prisma),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("rule-drift recompute timed out")), RECOMPUTE_TIMEOUT_MS);
      }),
    ]);
    await writeRuleDriftSnapshot(prisma, findings);
    revalidatePath("/admin/predictions");
    return { ok: true, driftCount: findings.length };
  } catch (err) {
    Sentry.captureException(err);
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
