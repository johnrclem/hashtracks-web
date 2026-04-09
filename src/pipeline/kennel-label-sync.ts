/**
 * Kennel + stream label sync for the GitHub audit pipeline.
 *
 * Ensures every kennel in the DB has a canonical `kennel:<kennelCode>` label
 * and every audit stream has a canonical `audit:<stream>` label. Cleans up
 * legacy gray labels that the PR #580 side-effect POSTs left behind.
 *
 * Ownership is claimed by either (a) an empty description, (b) a description
 * that starts with the canonical prefix, or (c) the GitHub default `#ededed`
 * color — which grandfathers the gray auto-created labels from earlier work.
 * Any other label with a non-matching description is logged as externally
 * owned and left alone, so an unrelated workflow's labels in the same
 * namespace are never silently overwritten.
 */

import { prisma } from "@/lib/db";
import { getValidatedRepo } from "@/lib/github-repo";
import {
  STREAM_LABEL_META,
  GRAY_DEFAULT_COLOR,
  KENNEL_LABEL_COLOR,
  KENNEL_DESCRIPTION_PREFIX,
  STREAM_DESCRIPTION_PREFIX,
  isValidKennelCode,
  kennelLabel,
  type StreamLabelName,
} from "@/lib/audit-labels";

const FETCH_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const POLITE_DELAY_MS = 100;

export interface GitHubLabel {
  name: string;
  color: string;
  description: string | null;
}

interface CanonicalLabel {
  name: string;
  color: string;
  description: string;
  /** Description prefix that identifies labels owned by this sync pass. */
  ownershipPrefix: string;
}

export type LabelAction =
  | { kind: "create"; name: string; color: string; description: string }
  | { kind: "update"; name: string; color: string; description: string; reason: string }
  | { kind: "skip"; name: string }
  | { kind: "external"; name: string; description: string | null };

export interface SyncLabelsResult {
  created: number;
  updated: number;
  skippedCanonical: number;
  skippedExternal: number;
  invalidKennelCodes: string[];
  actions: LabelAction[];
  errors: string[];
}

/** Summary projection for the cron route's JSON response. */
export function summarizeLabelSync(result: SyncLabelsResult) {
  return {
    created: result.created,
    updated: result.updated,
    skippedCanonical: result.skippedCanonical,
    skippedExternal: result.skippedExternal,
    invalid: result.invalidKennelCodes.length,
    errors: result.errors.length,
  };
}

/** True when the sync may safely PATCH the label — either we already own it,
 *  the description is blank, or it's still the GitHub gray default. */
function isOwnedLabel(label: GitHubLabel, ownershipPrefix: string): boolean {
  if (label.color.toLowerCase() === GRAY_DEFAULT_COLOR) return true;
  const desc = label.description ?? "";
  if (desc === "") return true;
  return desc.startsWith(ownershipPrefix);
}

/** Single diff that handles both kennel and stream labels. */
function diffLabel(
  canonical: CanonicalLabel,
  existing: GitHubLabel | undefined,
): LabelAction {
  if (!existing) {
    return {
      kind: "create",
      name: canonical.name,
      color: canonical.color,
      description: canonical.description,
    };
  }
  if (!isOwnedLabel(existing, canonical.ownershipPrefix)) {
    return {
      kind: "external",
      name: canonical.name,
      description: existing.description,
    };
  }
  const sameColor = existing.color.toLowerCase() === canonical.color;
  const sameDescription = (existing.description ?? "") === canonical.description;
  if (sameColor && sameDescription) {
    return { kind: "skip", name: canonical.name };
  }
  return {
    kind: "update",
    name: canonical.name,
    color: canonical.color,
    description: canonical.description,
    reason: existing.description ? "description drift" : "legacy auto-created",
  };
}

/** Paginate all labels in the repo. No server-side name filter exists, so
 *  we pull everything and filter in memory. */
export async function fetchAllLabels(token: string): Promise<GitHubLabel[]> {
  const repo = getValidatedRepo();
  const out: GitHubLabel[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${repo}/labels?per_page=${PAGE_SIZE}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`GitHub label list ${res.status} page ${page}: ${await res.text()}`);
    }
    const batch = (await res.json()) as GitHubLabel[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

/** Build the canonical label list for every kennel + every audit stream. */
function buildCanonicalLabels(
  kennels: ReadonlyArray<{ kennelCode: string; shortName: string | null }>,
  invalid: string[],
): CanonicalLabel[] {
  const canonical: CanonicalLabel[] = [];
  for (const k of kennels) {
    if (!isValidKennelCode(k.kennelCode)) {
      invalid.push(k.kennelCode);
      continue;
    }
    canonical.push({
      name: kennelLabel(k.kennelCode),
      color: KENNEL_LABEL_COLOR,
      description: `${KENNEL_DESCRIPTION_PREFIX} — ${k.shortName ?? k.kennelCode}`,
      ownershipPrefix: KENNEL_DESCRIPTION_PREFIX,
    });
  }
  for (const [name, meta] of Object.entries(STREAM_LABEL_META) as Array<
    [StreamLabelName, { color: string; description: string }]
  >) {
    canonical.push({
      name,
      color: meta.color,
      description: meta.description,
      ownershipPrefix: STREAM_DESCRIPTION_PREFIX,
    });
  }
  return canonical;
}

/** Tally counts from the action list — single source of truth. */
function tallyActions(actions: ReadonlyArray<LabelAction>): {
  created: number;
  updated: number;
  skippedCanonical: number;
  skippedExternal: number;
} {
  const counts = { created: 0, updated: 0, skippedCanonical: 0, skippedExternal: 0 };
  for (const action of actions) {
    if (action.kind === "create") counts.created++;
    else if (action.kind === "update") counts.updated++;
    else if (action.kind === "skip") counts.skippedCanonical++;
    else counts.skippedExternal++;
  }
  return counts;
}

/**
 * Pure-function planner — no I/O. Builds the action list from a kennel list
 * and a pre-fetched label list. The bulk of the test coverage lives here.
 */
export function planKennelLabelSync(
  kennels: ReadonlyArray<{ kennelCode: string; shortName: string | null }>,
  existingLabels: ReadonlyArray<GitHubLabel>,
): SyncLabelsResult {
  const invalidKennelCodes: string[] = [];
  const canonical = buildCanonicalLabels(kennels, invalidKennelCodes);
  const byName = new Map(existingLabels.map((l) => [l.name, l]));
  const actions = canonical.map((c) => diffLabel(c, byName.get(c.name)));
  const counts = tallyActions(actions);
  return {
    ...counts,
    invalidKennelCodes,
    actions,
    errors: [],
  };
}

function assertHexColor(value: string): void {
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Invalid hex color: ${value}`);
  }
}

function assertSafeLabelName(value: string): void {
  if (!/^[a-z0-9][a-z0-9:\-]*$/i.test(value)) {
    throw new Error(`Unsafe label name: ${value}`);
  }
}

/** Single writer — POST creates a new label, PATCH updates existing. */
async function writeLabel(
  method: "POST" | "PATCH",
  token: string,
  name: string,
  color: string,
  description: string,
): Promise<void> {
  assertSafeLabelName(name);
  assertHexColor(color);
  const repo = getValidatedRepo();
  const url =
    method === "POST"
      ? `https://api.github.com/repos/${repo}/labels`
      : `https://api.github.com/repos/${repo}/labels/${encodeURIComponent(name)}`;
  const body =
    method === "POST" ? { name, color, description } : { color, description };
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${method} /labels/${name} ${res.status}: ${await res.text()}`);
  }
}

/** Apply the planned actions to GitHub. Delay only fires after real writes. */
async function applyLabelActions(
  token: string,
  actions: ReadonlyArray<LabelAction>,
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  for (const action of actions) {
    if (action.kind !== "create" && action.kind !== "update") continue;
    try {
      await writeLabel(
        action.kind === "create" ? "POST" : "PATCH",
        token,
        action.name,
        action.color,
        action.description,
      );
    } catch (err) {
      errors.push(`${action.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Only sleep after an actual network round-trip. On idempotent re-runs
    // this loop exits immediately after the skip filter above.
    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
  }
  return { errors };
}

/**
 * Top-level sync entry point. The cron route calls this wrapped in a
 * try/catch so a label-sync failure never blocks the audit-issue mirror
 * refresh that runs in the same route.
 */
export async function syncKennelLabels(opts: { apply: boolean }): Promise<SyncLabelsResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");

  const [kennels, existingLabels] = await Promise.all([
    prisma.kennel.findMany({
      select: { kennelCode: true, shortName: true },
      orderBy: { kennelCode: "asc" },
    }),
    fetchAllLabels(token),
  ]);

  const plan = planKennelLabelSync(kennels, existingLabels);

  if (plan.invalidKennelCodes.length > 0) {
    console.warn(
      `[kennel-label-sync] ${plan.invalidKennelCodes.length} kennelCodes failed label-safety check:`,
      plan.invalidKennelCodes,
    );
  }

  if (opts.apply) {
    const { errors } = await applyLabelActions(token, plan.actions);
    plan.errors = errors;
  }

  console.log(
    `[kennel-label-sync] mode=${opts.apply ? "apply" : "dry-run"} created=${plan.created} updated=${plan.updated} skippedCanonical=${plan.skippedCanonical} skippedExternal=${plan.skippedExternal} invalid=${plan.invalidKennelCodes.length} errors=${plan.errors.length}`,
  );

  return plan;
}
