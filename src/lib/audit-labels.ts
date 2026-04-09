/**
 * Centralized GitHub label constants for the audit issue pipeline.
 *
 * Three audit streams file issues to the same repo with the `audit` label.
 * To distinguish them on the dashboard we attach a per-stream sub-label at
 * file time. The sync cron at /api/cron/sync-audit-issues reads these labels
 * to populate the AuditIssue mirror.
 *
 * Stream taxonomy:
 * - AUTOMATED      — scripts/audit-data-quality.ts (regex checks on RawEvents)
 * - CHROME_EVENT   — daily hareline audit prompt (docs/audit-chrome-prompt.md)
 * - CHROME_KENNEL  — per-kennel deep-dive prompt (src/lib/admin/deep-dive-prompt.ts)
 * - UNKNOWN        — historical issues that pre-date the sub-labeling cutover
 */

export const AUDIT_LABEL = "audit";
export const ALERT_LABEL = "alert";

export const STREAM_LABELS = {
  AUTOMATED: "audit:automated",
  CHROME_EVENT: "audit:chrome-event",
  CHROME_KENNEL: "audit:chrome-kennel",
} as const;

export type AuditStreamKey = keyof typeof STREAM_LABELS;

/** All stream sub-labels as a flat array for `.includes()` checks during sync. */
export const ALL_STREAM_LABELS: readonly string[] = Object.values(STREAM_LABELS);

/** Build the kennel attribution label for a given kennelCode. */
export function kennelLabel(kennelCode: string): string {
  return `kennel:${kennelCode}`;
}

/** Match a kennel label and return the kennelCode, or null. */
export function parseKennelLabel(label: string): string | null {
  if (!label.startsWith("kennel:")) return null;
  const code = label.slice("kennel:".length).trim();
  return code.length > 0 ? code : null;
}

/** Match a stream label and return the canonical stream key, or null. */
export function parseStreamLabel(label: string): AuditStreamKey | null {
  for (const [key, value] of Object.entries(STREAM_LABELS) as [AuditStreamKey, string][]) {
    if (value === label) return key;
  }
  return null;
}
