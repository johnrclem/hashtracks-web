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

/** Validates repo format (owner/name) to prevent SSRF via crafted repository strings. */
const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

/** Builds a validated GitHub API URL. Throws on invalid inputs. */
function githubApiUrl(repo: string, path: string): string {
  if (!REPO_PATTERN.test(repo)) {
    throw new Error(`Invalid GitHub repository format: ${repo}`);
  }
  return `https://api.github.com/repos/${repo}${path}`;
}

/** Repair log entry shape for auto_file_issue actions. */
interface AutoFileEntry {
  action: string;
  details?: { issueNumber?: number; issueUrl?: string };
}

/** Runtime type guard — validates repairLog entries before use. */
function isAutoFileEntry(value: unknown): value is AutoFileEntry {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.action !== "string") return false;
  if (obj.details !== undefined) {
    if (typeof obj.details !== "object" || obj.details === null) return false;
    const d = obj.details as Record<string, unknown>;
    if (d.issueNumber !== undefined && typeof d.issueNumber !== "number") return false;
  }
  return true;
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

    const rawLog = alert.repairLog as unknown[];
    const entries = rawLog.filter(isAutoFileEntry);
    const autoFileEntry = entries.find(
      (e) => e.action === "auto_file_issue" && e.details?.issueNumber,
    );
    if (!autoFileEntry?.details?.issueNumber) continue;

    // Check if this alert was already successfully verified (avoid duplicate comments)
    const alreadyVerified = entries.some(
      (e) => e.action === "auto_fix_verified" && (e as AutoFileEntry & { result?: string }).result === "success",
    );
    if (alreadyVerified) continue;

    const issueNumber = autoFileEntry.details.issueNumber;

    // Check if the issue has the pending-verification label
    const hasLabel = await issueHasLabel(repo, issueNumber, "pending-verification", token);
    if (!hasLabel) continue;

    // Remove the label and post confirmation
    const labelRemoved = await removeLabelFromIssue(repo, issueNumber, "pending-verification", token);
    const commentPosted = await postVerificationComment(repo, issueNumber, alert.type, token);

    const success = labelRemoved && commentPosted;
    const now = new Date().toISOString();

    // Record verification in repairLog (preserve all original entries)
    await prisma.alert.update({
      where: { id: alert.id },
      data: {
        repairLog: [
          ...rawLog,
          {
            action: "auto_fix_verified",
            timestamp: now,
            adminId: "system",
            result: success ? "success" : "error",
            details: { issueNumber, verifiedAt: now },
          },
        ] as Prisma.InputJsonValue,
      },
    });

    if (success) verified++;
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
      githubApiUrl(repo, `/issues/${issueNumber}/labels`),
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
  } catch (err) {
    console.error(`Failed to check labels on issue #${issueNumber}:`, err);
    return false;
  }
}

/** Remove a label from a GitHub issue. Returns true on success. */
async function removeLabelFromIssue(
  repo: string,
  issueNumber: number,
  label: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      githubApiUrl(repo, `/issues/${issueNumber}/labels/${encodeURIComponent(label)}`),
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    return res.ok;
  } catch (err) {
    console.error(`Failed to remove label from issue #${issueNumber}:`, err);
    return false;
  }
}

/** Post a verification success comment on the GitHub issue. Returns true on success. */
async function postVerificationComment(
  repo: string,
  issueNumber: number,
  alertType: string,
  token: string,
): Promise<boolean> {
  const typeName = alertType.replaceAll("_", " ").toLowerCase();
  const body = `### Fix Verified ✓\n\nThe auto-fix has been verified successfully. The **${typeName}** alert did not recur on the next scrape after the fix was merged.\n\nThis issue can be considered fully resolved.`;

  try {
    const res = await fetch(
      githubApiUrl(repo, `/issues/${issueNumber}/comments`),
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
    return res.ok;
  } catch (err) {
    console.error(`Failed to post verification comment on issue #${issueNumber}:`, err);
    return false;
  }
}
