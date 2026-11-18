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
 *
 * Every issue the server files also carries exactly one lane label, which says
 * who works it (docs/ops/system.md "Lanes"). `audit`, `audit:*` and `kennel:*`
 * say where an issue came from; the lane says where it goes.
 */

import { AUDIT_STREAM, type AuditStream } from "@/lib/audit-stream-meta";

export const AUDIT_LABEL = "audit";
/** Applied to meta-issues filed when a base finding has recurred
 *  past the escalation threshold without resolution. Surfaces in
 *  `gh issue list -l audit:needs-decision` for triage. */
export const NEEDS_DECISION_LABEL = "audit:needs-decision";

/**
 * The research task's older name for `lane:coverage`: it works these issues before
 * its own target queue (`docs/kennel-onboarding/daily-onboarding-prompt.md`, Step 1).
 * Filed next to `lane:coverage` as an alias for a month (until 2026-12-18), so the
 * task keeps finding them while its prompt moves over.
 */
export const ONBOARDING_CANDIDATE_LABEL = "onboarding-candidate";

/**
 * Rule slugs for "HashTracks doesn't load this": a source page we don't track,
 * or history a source holds that was never backfilled. That's onboarding work
 * (a new source, adapter or one-shot import), not an adapter bug. The deep-dive
 * prompt asks for the first two; the rest are synonyms earlier runs used.
 * A run missing *inside* a window we already scrape is not on this list: that's
 * an adapter or reconcile bug.
 */
export const SOURCE_GAP_RULE_SLUGS: readonly string[] = [
  "source-coverage-gap",
  "historical-events-gap",
  "historical-coverage-gap",
  "historical-backfill",
  "historical-backfill-archive",
];

/**
 * Rule slugs only the owner can settle. A `schema-gap` is a source field with no
 * Event column: the audit prompts file it for the PRD owner to group, and the fixer
 * may not change the schema.
 */
export const DECISION_RULE_SLUGS: readonly string[] = ["schema-gap"];

/** True when a finding's rule routes it to the onboarding automation. */
export function isSourceGapRule(ruleSlug: string): boolean {
  return SOURCE_GAP_RULE_SLUGS.includes(ruleSlug);
}

// ── Lanes ──

export const LANES = ["incident", "defect", "coverage", "decision", "ops"] as const;
export type Lane = (typeof LANES)[number];

const LANE_PREFIX = "lane:";

/** `lane:<lane>` for each lane. */
export const LANE_LABELS = {
  incident: "lane:incident",
  defect: "lane:defect",
  coverage: "lane:coverage",
  decision: "lane:decision",
  ops: "lane:ops",
} as const satisfies Record<Lane, `lane:${Lane}`>;

export type LaneLabelName = (typeof LANE_LABELS)[Lane];

/** Match a lane label and return its lane, or null. */
export function parseLaneLabel(label: string): Lane | null {
  if (!label.startsWith(LANE_PREFIX)) return null;
  const lane = label.slice(LANE_PREFIX.length);
  return (LANES as readonly string[]).includes(lane) ? (lane as Lane) : null;
}

/**
 * The lane a finding's rule files into. A source or history HashTracks doesn't
 * load yet is coverage work, a schema gap waits on the owner, and everything else
 * an audit finds is a defect a config or adapter fix can repair.
 */
export function laneForRule(ruleSlug: string): Lane {
  if (isSourceGapRule(ruleSlug)) return "coverage";
  if (DECISION_RULE_SLUGS.includes(ruleSlug)) return "decision";
  return "defect";
}

/**
 * The only labels an agent may request on a finding (`AuditFindingDraft.labels`):
 * `lane:decision`, for a finding only the owner can settle. The submit endpoint
 * rejects anything else, so an agent can't route around the lane rules or claim
 * another origin.
 */
export const AGENT_REQUESTABLE_LABELS: readonly string[] = [LANE_LABELS.decision];

/**
 * The full label set for an audit finding filed as a fresh issue: `audit`, the
 * stream sub-label, the kennel label and exactly one lane. A coverage finding also
 * gets the `onboarding-candidate` alias. `requestedLabels` are the agent's
 * (already validated) requests; `lane:decision` there overrides the rule's lane.
 */
export function auditIssueLabels(input: {
  stream: AuditStream;
  kennelCode: string;
  ruleSlug: string;
  requestedLabels?: readonly string[];
}): string[] {
  const lane: Lane = input.requestedLabels?.includes(LANE_LABELS.decision)
    ? "decision"
    : laneForRule(input.ruleSlug);
  const stream = STREAM_LABEL_BY_STREAM[input.stream];
  return [
    AUDIT_LABEL,
    ...(stream ? [stream] : []),
    kennelLabel(input.kennelCode),
    LANE_LABELS[lane],
    ...(lane === "coverage" ? [ONBOARDING_CANDIDATE_LABEL] : []),
  ];
}

export const STREAM_LABELS = {
  AUTOMATED: "audit:automated",
  CHROME_EVENT: "audit:chrome-event",
  CHROME_KENNEL: "audit:chrome-kennel",
} as const;

export type AuditStreamKey = keyof typeof STREAM_LABELS;
export type StreamLabelName = (typeof STREAM_LABELS)[AuditStreamKey];

/** All stream sub-labels as a flat array for `.includes()` checks during sync. */
export const ALL_STREAM_LABELS: readonly string[] = Object.values(STREAM_LABELS);

/** UNKNOWN has no sub-label: it's what an issue without one mirrors as. */
const STREAM_LABEL_BY_STREAM: Record<AuditStream, StreamLabelName | null> = {
  [AUDIT_STREAM.AUTOMATED]: STREAM_LABELS.AUTOMATED,
  [AUDIT_STREAM.CHROME_EVENT]: STREAM_LABELS.CHROME_EVENT,
  [AUDIT_STREAM.CHROME_KENNEL]: STREAM_LABELS.CHROME_KENNEL,
  [AUDIT_STREAM.UNKNOWN]: null,
};

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
export const LANE_DESCRIPTION_PREFIX = "Work lane";

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

/** Canonical color + description for each lane label (docs/ops/system.md "Lanes"). */
export const LANE_LABEL_META: Record<LaneLabelName, { color: string; description: string }> = {
  [LANE_LABELS.incident]: {
    color: "d73a4a",
    description: `${LANE_DESCRIPTION_PREFIX} — a source keeps failing or a feed went silent`,
  },
  [LANE_LABELS.defect]: {
    color: "fbca04",
    description: `${LANE_DESCRIPTION_PREFIX} — wrong or missing data a config or adapter fix repairs`,
  },
  [LANE_LABELS.coverage]: {
    color: "0e8a16",
    description: `${LANE_DESCRIPTION_PREFIX} — a kennel, source or history not loaded yet`,
  },
  [LANE_LABELS.decision]: {
    color: "5319e7",
    description: `${LANE_DESCRIPTION_PREFIX} — blocked until the owner chooses`,
  },
  [LANE_LABELS.ops]: {
    color: "b60205",
    description: `${LANE_DESCRIPTION_PREFIX} — an automation or pipeline stopped`,
  },
};
