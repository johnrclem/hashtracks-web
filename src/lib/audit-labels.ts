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
/** Applied to meta-issues filed when a base finding has recurred
 *  past the escalation threshold without resolution. Surfaces in
 *  `gh issue list -l audit:needs-decision` for triage. */
export const NEEDS_DECISION_LABEL = "audit:needs-decision";

export const STREAM_LABELS = {
  AUTOMATED: "audit:automated",
  CHROME_EVENT: "audit:chrome-event",
  CHROME_KENNEL: "audit:chrome-kennel",
} as const;

export type AuditStreamKey = keyof typeof STREAM_LABELS;
export type StreamLabelName = (typeof STREAM_LABELS)[AuditStreamKey];

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

// ── Canonical label style (shared by the label sync cron) ──

/** GitHub default label color; used as an ownership-claim grandfather for
 *  auto-created labels. */
export const GRAY_DEFAULT_COLOR = "ededed";

/** Pale blue — canonical color for `kennel:<code>` labels. */
export const KENNEL_LABEL_COLOR = "d0e8ff";

/** Description prefix that marks a label as owned by the audit pipeline. */
export const KENNEL_DESCRIPTION_PREFIX = "Audit kennel attribution";
export const STREAM_DESCRIPTION_PREFIX = "Audit stream attribution";

/** kennelCode must be URL-safe + GitHub-label-safe (no comma, semicolon, space). */
const KENNEL_CODE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** True when a kennelCode is safe to use as a GitHub label suffix. */
export function isValidKennelCode(code: string): boolean {
  return KENNEL_CODE_PATTERN.test(code);
}

/** Canonical color + description for each stream label. */
export const STREAM_LABEL_META: Record<
  StreamLabelName,
  { color: string; description: string }
> = {
  [STREAM_LABELS.AUTOMATED]: {
    color: "3b82f6",
    description: `${STREAM_DESCRIPTION_PREFIX} — automated audit script`,
  },
  [STREAM_LABELS.CHROME_EVENT]: {
    color: "22c55e",
    description: `${STREAM_DESCRIPTION_PREFIX} — chrome daily hareline audit`,
  },
  [STREAM_LABELS.CHROME_KENNEL]: {
    color: "a855f7",
    description: `${STREAM_DESCRIPTION_PREFIX} — chrome per-kennel deep dive`,
  },
};
