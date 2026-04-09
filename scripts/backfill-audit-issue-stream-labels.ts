/**
 * One-shot retroactive label backfill for the audit issue corpus.
 *
 * Walks every GitHub issue with the `audit` label (open + closed) and
 * applies the stream sub-label + kennel: label that didn't exist when the
 * issue was originally filed. Honest classification only:
 *
 *   - AUTOMATED  if title starts with "[Audit] " AND body starts with the
 *                automated audit's "Automated audit found" preamble. Both
 *                conditions required to avoid false positives.
 *   - UNKNOWN    everything else. Operators can hand-relabel later and the
 *                next sync will pick up the change.
 *
 * Kennel attribution uses an in-memory shortName + alias index. The title
 * prefix before the first " — " is matched case-insensitively against the
 * index; no match → no kennel label is posted.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-audit-issue-stream-labels.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-audit-issue-stream-labels.ts
 *
 * Idempotent: GitHub's add-labels endpoint is a no-op for already-applied
 * labels.
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  AUDIT_LABEL,
  STREAM_LABELS,
  ALL_STREAM_LABELS,
  kennelLabel,
} from "@/lib/audit-labels";
import { fetchAllAuditIssues, type GitHubIssue, extractLabelNames } from "@/pipeline/audit-issue-sync";

const DEFAULT_REPO = "johnrclem/hashtracks-web";
const FETCH_TIMEOUT_MS = 15_000;
const POLITE_DELAY_MS = 100;
const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

/** Validated repo slug, frozen at module load — kills the Codacy taint flow
 *  from `process.env.GITHUB_REPOSITORY` into the fetch URL. */
const REPO: string = (() => {
  const value = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
  if (!REPO_PATTERN.test(value)) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: ${value}`);
  }
  return value;
})();

/** Number-only path segment for the labels endpoint — refuses non-finite ids. */
function labelsPath(issueNumber: number): string {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid GitHub issue number: ${issueNumber}`);
  }
  return `https://api.github.com/repos/${REPO}/issues/${issueNumber}/labels`;
}

/** Number-only path segment for the issue body fetch. */
function issuePath(issueNumber: number): string {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid GitHub issue number: ${issueNumber}`);
  }
  return `https://api.github.com/repos/${REPO}/issues/${issueNumber}`;
}

/** True iff the issue is identifiably from the automated audit script. */
function isAutomatedIssue(issue: GitHubIssue, body: string | null): boolean {
  const titleMatch = issue.title.startsWith("[Audit] ");
  const bodyMatch =
    (!!body && body.startsWith("Automated audit found"))
    || (body?.startsWith("Automated daily audit found") ?? false);
  return titleMatch && bodyMatch;
}

interface KennelLookup {
  /**
   * Lowercased lookup key → kennelCode, OR null if multiple kennels share
   * the key (e.g. shortName "AH3" is used by both Aloha H3 in Hawaii and
   * Amsterdam H3). Ambiguous keys deliberately resolve to null so we don't
   * misattribute issues to whichever kennel was inserted last.
   */
  byKey: Map<string, string | null>;
}

async function loadKennelLookup(): Promise<KennelLookup> {
  const kennels = await prisma.kennel.findMany({
    select: {
      kennelCode: true,
      shortName: true,
      aliases: { select: { alias: true } },
    },
  });
  const byKey = new Map<string, string | null>();
  const set = (key: string, code: string) => {
    const k = key.toLowerCase();
    if (byKey.has(k) && byKey.get(k) !== code) {
      byKey.set(k, null); // collision → ambiguous
    } else if (!byKey.has(k)) {
      byKey.set(k, code);
    }
  };
  for (const k of kennels) {
    set(k.kennelCode, k.kennelCode); // exact kennelCode is always unambiguous
    if (k.shortName) set(k.shortName, k.kennelCode);
    for (const a of k.aliases) {
      if (a.alias) set(a.alias, k.kennelCode);
    }
  }
  const ambiguous = [...byKey.entries()].filter(([, v]) => v === null).length;
  console.log(`  ${byKey.size} keys total, ${ambiguous} ambiguous (collisions → no label)`);
  return { byKey };
}

/** Extract the title prefix before the first em-dash and resolve via the lookup. */
function resolveKennelFromTitle(title: string, lookup: KennelLookup): string | null {
  // Strip the "[Audit] " prefix if present so the kennel name lands at index 0.
  const withoutPrefix = title.replace(/^\[Audit\]\s+/i, "");
  const dashIdx = withoutPrefix.indexOf(" — ");
  if (dashIdx <= 0) return null;
  const candidate = withoutPrefix.slice(0, dashIdx).trim().toLowerCase();
  // .get() returns undefined for missing keys, null for ambiguous collisions,
  // string for confident matches. Both undefined and null mean "no label".
  return lookup.byKey.get(candidate) ?? null;
}

/** Fetch a single issue's body — needed for the automated-stream classifier. */
async function fetchIssueBody(token: string, number: number): Promise<string | null> {
  const url = issuePath(number);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { body?: string | null };
  return data.body ?? null;
}

async function postLabels(token: string, number: number, labels: string[]): Promise<void> {
  const url = labelsPath(number);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ labels }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`POST labels for #${number} failed: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set in env");

  console.log(`Mode: ${apply ? "APPLY (will POST labels to GitHub)" : "DRY RUN (no writes)"}`);
  const lookup = await loadKennelLookup();
  console.log(`Kennel lookup: ${lookup.byKey.size} keys (shortNames + aliases)`);

  console.log(`\nFetching all '${AUDIT_LABEL}'-labeled issues...`);
  const issues = await fetchAllAuditIssues(token);
  console.log(`Found ${issues.length} issues.\n`);

  const counts = { automated: 0, unknown: 0, alreadyLabeled: 0, kennelMatched: 0, kennelUnmatched: 0 };
  const unmatchedTitles: string[] = [];
  const decisions: Array<{ number: number; needs: string[]; classification: string; kennelCode: string | null }> = [];

  for (const issue of issues) {
    const labelNames = extractLabelNames(issue.labels);
    const hasStreamLabel = labelNames.some((l) => ALL_STREAM_LABELS.includes(l));
    const hasKennelLabel = labelNames.some((l) => l.startsWith("kennel:"));
    if (hasStreamLabel && hasKennelLabel) {
      counts.alreadyLabeled++;
      continue;
    }

    let stream: keyof typeof STREAM_LABELS | "UNKNOWN" = "UNKNOWN";
    let body: string | null = null;
    if (!hasStreamLabel) {
      // Only fetch the body if we need to classify — saves ~150 GET requests
      // when most issues already have a stream label.
      body = await fetchIssueBody(token, issue.number);
      if (isAutomatedIssue(issue, body)) {
        stream = "AUTOMATED";
        counts.automated++;
      } else {
        counts.unknown++;
        if (unmatchedTitles.length < 10) unmatchedTitles.push(`#${issue.number} ${issue.title}`);
      }
    }

    const kennelCode = hasKennelLabel ? null : resolveKennelFromTitle(issue.title, lookup);
    if (!hasKennelLabel) {
      if (kennelCode) counts.kennelMatched++;
      else counts.kennelUnmatched++;
    }

    const needs: string[] = [];
    if (!hasStreamLabel && stream !== "UNKNOWN") needs.push(STREAM_LABELS[stream]);
    if (!hasKennelLabel && kennelCode) needs.push(kennelLabel(kennelCode));
    // UNKNOWN stream gets no label posted — it's the implicit default at sync time.

    if (needs.length > 0) {
      decisions.push({ number: issue.number, needs, classification: stream, kennelCode });
    }
  }

  console.log("\n── Classification summary ──");
  console.log(`AUTOMATED:        ${counts.automated}`);
  console.log(`UNKNOWN:          ${counts.unknown} (no label posted; left for future relabel)`);
  console.log(`Already labeled:  ${counts.alreadyLabeled}`);
  console.log(`Kennel matched:   ${counts.kennelMatched}`);
  console.log(`Kennel unmatched: ${counts.kennelUnmatched}`);
  console.log(`\nIssues needing label POST: ${decisions.length}`);

  if (unmatchedTitles.length > 0) {
    console.log("\nFirst 10 UNKNOWN-stream titles (spot-check that none should be AUTOMATED):");
    for (const t of unmatchedTitles) console.log(`  ${t}`);
  }

  if (decisions.length > 0) {
    console.log("\nFirst 10 decisions:");
    for (const d of decisions.slice(0, 10)) {
      console.log(`  #${d.number} → ${d.needs.join(", ")} (stream=${d.classification} kennel=${d.kennelCode ?? "—"})`);
    }
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to POST labels.");
    return;
  }

  console.log(`\nApplying labels to ${decisions.length} issues...`);
  let posted = 0;
  for (const d of decisions) {
    try {
      await postLabels(token, d.number, d.needs);
      posted++;
      if (posted % 25 === 0) console.log(`  ...${posted}/${decisions.length}`);
    } catch (err) {
      console.error(`  #${d.number} failed: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
  }
  console.log(`\nDone. Posted labels to ${posted} issues.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
