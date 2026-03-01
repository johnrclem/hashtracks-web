/**
 * Post-merge verification for the self-healing automation loop.
 *
 * After an auto-fix PR is merged, the linked GitHub issue gets a
 * "pending-verification" label. On the next scrape, if the alert for that
 * source does not recur (or auto-resolves), this module removes the label
 * and posts a confirmation comment.
 *
 * Called from runHealthAndAlerts() in scrape.ts after alert persistence.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/** GitHub API timeout (10 seconds). */
const FETCH_TIMEOUT_MS = 10_000;

/** Repair log entry shape for auto_file_issue actions. */
interface AutoFileEntry {
  action: string;
  details?: { issueNumber?: number; issueUrl?: string };
}

/**
 * Check recently resolved alerts for auto-filed issues that need verification
 * confirmation on GitHub.
 *
 * When an alert transitions to RESOLVED and its repairLog shows an
 * auto_file_issue entry, we remove "pending-verification" and post a
 * success comment.
 */
export async function verifyResolvedAutoFixes(sourceId: string): Promise<{ verified: number }> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return { verified: 0 };

  // Find recently resolved alerts that had auto-filed issues
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days
  const resolvedAlerts = await prisma.alert.findMany({
    where: {
      sourceId,
      status: "RESOLVED",
      resolvedAt: { gte: cutoff },
      repairLog: { not: { equals: null } },
    },
    select: { id: true, type: true, repairLog: true },
  });

  let verified = 0;

  for (const alert of resolvedAlerts) {
    if (!Array.isArray(alert.repairLog)) continue;

    const entries = alert.repairLog as unknown as AutoFileEntry[];
    const autoFileEntry = entries.find(
      (e) => e.action === "auto_file_issue" && e.details?.issueNumber,
    );
    if (!autoFileEntry?.details?.issueNumber) continue;

    // Check if this alert was already verified (avoid duplicate comments)
    const alreadyVerified = entries.some((e) => e.action === "auto_fix_verified");
    if (alreadyVerified) continue;

    const issueNumber = autoFileEntry.details.issueNumber;

    // Check if the issue has the pending-verification label
    const hasLabel = await issueHasLabel(repo, issueNumber, "pending-verification", token);
    if (!hasLabel) continue;

    // Remove the label and post confirmation
    await removeLabelFromIssue(repo, issueNumber, "pending-verification", token);
    await postVerificationComment(repo, issueNumber, alert.type, token);

    // Record verification in repairLog
    await prisma.alert.update({
      where: { id: alert.id },
      data: {
        repairLog: [
          ...entries,
          {
            action: "auto_fix_verified",
            timestamp: new Date().toISOString(),
            adminId: "system",
            result: "success",
            details: { issueNumber, verifiedAt: new Date().toISOString() },
          },
        ] as Prisma.InputJsonValue,
      },
    });

    verified++;
  }

  return { verified };
}

/** Check if a GitHub issue has a specific label. */
async function issueHasLabel(
  repo: string,
  issueNumber: number,
  label: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return false;
    const labels = (await res.json()) as { name: string }[];
    return labels.some((l) => l.name === label);
  } catch {
    return false;
  }
}

/** Remove a label from a GitHub issue. */
async function removeLabelFromIssue(
  repo: string,
  issueNumber: number,
  label: string,
  token: string,
): Promise<void> {
  try {
    await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
  } catch {
    // Non-fatal
  }
}

/** Post a verification success comment on the GitHub issue. */
async function postVerificationComment(
  repo: string,
  issueNumber: number,
  alertType: string,
  token: string,
): Promise<void> {
  const typeName = alertType.replaceAll("_", " ").toLowerCase();
  const body = `### Fix Verified ✓\n\nThe auto-fix has been verified successfully. The **${typeName}** alert did not recur on the next scrape after the fix was merged.\n\nThis issue can be considered fully resolved.`;

  try {
    await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
  } catch {
    // Non-fatal
  }
}
