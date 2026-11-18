/**
 * The server's approval checks and the fetch of the files the plan judges
 * (docs/onboarding-backfill-automation-design.md 6.3, 6.4). A2–A4 live in
 * `approval-stamp.ts`, shared with the `write-gate` workflow; this file adds A1
 * (merged and deployed) and the merged-PR form. Read-only, with
 * `GITHUB_APPROVAL_READ_TOKEN`, against this repository only; the server never
 * fetches a URL a caller supplied.
 *
 * A missing stamp, deploy lag and GitHub errors are retryable (WAITING); a
 * stamp that fails A3 or A4 is terminal.
 */

import {
  APPROVAL_LABEL,
  APPROVAL_REPO,
  approvalClient,
  checkStampedHead,
  refuseFork,
  RetryableApprovalError,
  TerminalApprovalError,
  type ApprovalContext,
  type Compare,
  type GitHub,
  type PrApproval,
  type PullRequest,
} from "./approval-stamp";

export {
  APPROVAL_LABEL,
  APPROVAL_REPO,
  checkOpenPrApproval,
  LabelMissingError,
  RetryableApprovalError,
  STAMP_CONTEXT,
  STAMP_CREATOR,
  TerminalApprovalError,
  type ApprovalContext,
  type FetchLike,
  type PrApproval,
} from "./approval-stamp";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ARCHIVE_PATH_RE = /^scripts\/data\/[a-z0-9-]+-history[a-z0-9-]*\.(manifest\.)?json$/;
const MIGRATION_PATH_RE = /^prisma\/migrations\/[^/]+\/migration\.sql$/;

/** A1: S is an ancestor of the deployed commit (the deploy contains the PR). */
async function checkDeployed(gh: GitHub, mergeSha: string, deployedSha: string | null): Promise<void> {
  if (!deployedSha) throw new RetryableApprovalError("A1: the deployed commit is unknown");
  if (mergeSha === deployedSha) return;
  const cmp = await gh.get<Compare>(`/compare/${mergeSha}...${deployedSha}`);
  if (cmp.status !== "ahead" && cmp.status !== "identical") throw new RetryableApprovalError("A1: the deploy doesn't contain the PR yet");
}

/** An open PR's current head, for a preview (which runs before any label). Refuses a fork. */
export async function openPrHead(prNumber: number, ctx: ApprovalContext = {}): Promise<string> {
  const pr = await approvalClient(ctx).get<PullRequest>(`/pulls/${prNumber}`);
  refuseFork(pr);
  return pr.head.sha;
}

/** A1–A4 for a merged PR, before plan and every batch (6.4). */
export async function checkMergedPrApproval(prNumber: number, deployedSha: string | null, ctx: ApprovalContext = {}): Promise<PrApproval & { mergeSha: string }> {
  const gh = approvalClient(ctx);
  const pr = await gh.get<PullRequest>(`/pulls/${prNumber}`);
  if (!pr.merged || !pr.merge_commit_sha) throw new RetryableApprovalError("A1: the PR isn't merged yet");
  if (pr.base.ref !== "main") throw new TerminalApprovalError("A1: the PR didn't merge into main");
  refuseFork(pr);
  await checkDeployed(gh, pr.merge_commit_sha, deployedSha);
  // A4's base is the main the PR merged into: the merge commit's first parent.
  const merge = await gh.get<{ parents: Array<{ sha: string }> }>(`/commits/${pr.merge_commit_sha}`);
  const stamped = await checkStampedHead(gh, pr, merge.parents[0]?.sha ?? pr.base.sha);
  return { prNumber, stampedSha: stamped, headSha: pr.head.sha, mergeSha: pr.merge_commit_sha };
}

/**
 * Merged PRs labelled owner-approved since `since` that carry a backfill
 * manifest, with their merge time, for the watch cron (7.3, 11.3).
 */
export async function listApprovedManifestPrs(since: Date, ctx: ApprovalContext = {}): Promise<Array<{ prNumber: number; mergedAt: string }>> {
  const gh = approvalClient(ctx);
  const q = encodeURIComponent(`repo:${APPROVAL_REPO} is:pr is:merged label:${APPROVAL_LABEL} merged:>=${since.toISOString().slice(0, 10)}`);
  const found = (await gh.get<{ items: Array<{ number: number; pull_request?: { merged_at?: string | null } }> }>(`/search/issues?q=${q}&per_page=100`)).items;
  const withFiles = await Promise.all(found.map(async (item) => ({ item, files: await gh.list<{ filename: string }>(`/pulls/${item.number}/files`) })));
  return withFiles
    .filter(({ files }) => files.some((f) => ARCHIVE_PATH_RE.test(f.filename) && f.filename.endsWith(".manifest.json")))
    .map(({ item }) => ({ prNumber: item.number, mergedAt: item.pull_request?.merged_at ?? "" }));
}

export interface PrFiles {
  changedFiles: string[];
  manifestPath: string;
  manifestBytes: string;
  archivePath: string;
  archiveBytes: string;
  migrationSql: string[];
}

async function fileAt(gh: GitHub, path: string, ref: string): Promise<string> {
  if (!ARCHIVE_PATH_RE.test(path) && !MIGRATION_PATH_RE.test(path)) throw new TerminalApprovalError(`refusing to fetch ${path}`);
  const res = await gh.raw(`/contents/${path}?ref=${ref}`, "application/vnd.github.raw+json");
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_FILE_BYTES) throw new TerminalApprovalError(`${path} is over 10 MB`);
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new TerminalApprovalError(`${path} is over 10 MB`);
  return text;
}

/**
 * The PR's changed paths, its one manifest and the archive it names, and the
 * SQL of every migration it adds, all read at `ref` (S, or the open PR's head).
 */
export async function fetchPrFiles(prNumber: number, ref: string, ctx: ApprovalContext = {}): Promise<PrFiles> {
  const gh = approvalClient(ctx);
  const files = await gh.list<{ filename: string; status: string }>(`/pulls/${prNumber}/files`);
  const changedFiles = files.map((f) => f.filename);
  const manifests = changedFiles.filter((f) => ARCHIVE_PATH_RE.test(f) && f.endsWith(".manifest.json"));
  if (manifests.length !== 1) throw new TerminalApprovalError(`A5: the PR carries ${manifests.length} manifests`);
  const manifestBytes = await fileAt(gh, manifests[0], ref);
  let archivePath: string;
  try {
    archivePath = String((JSON.parse(manifestBytes) as { archivePath?: unknown }).archivePath ?? "");
  } catch {
    throw new TerminalApprovalError("G2: the manifest isn't valid JSON");
  }
  if (!ARCHIVE_PATH_RE.test(archivePath) || archivePath.endsWith(".manifest.json")) throw new TerminalApprovalError("G2: the manifest names an archive outside scripts/data");
  const migrationSql = await Promise.all(
    files.filter((f) => f.status === "added" && MIGRATION_PATH_RE.test(f.filename)).map((f) => fileAt(gh, f.filename, ref)),
  );
  return { changedFiles, manifestPath: manifests[0], manifestBytes, archivePath, archiveBytes: await fileAt(gh, archivePath, ref), migrationSql };
}

/** The archive bytes at the run's merge commit, for advance and verify. */
export async function fetchArchiveAt(path: string, ref: string, ctx: ApprovalContext = {}): Promise<string> {
  return fileAt(approvalClient(ctx), path, ref);
}
