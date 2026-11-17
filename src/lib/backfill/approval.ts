/**
 * The PR approval checks A1–A4 and the fetch of the files the plan judges
 * (docs/onboarding-backfill-automation-design.md 6.3, 6.4). Read-only, with
 * `GITHUB_APPROVAL_READ_TOKEN`, against this repository only; the server never
 * fetches a URL a caller supplied.
 *
 * A missing stamp, deploy lag and GitHub errors are retryable (WAITING); a
 * stamp that fails A3 or A4 is terminal.
 */

export const APPROVAL_REPO = "johnrclem/hashtracks-web";
/** The only account whose label approves (A2). */
export const OWNER_GITHUB_LOGIN = "johnrclem";
export const APPROVAL_LABEL = "owner-approved";
export const STAMP_CONTEXT = "backfill/approved";
export const STAMP_CREATOR = "github-actions[bot]";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ARCHIVE_PATH_RE = /^scripts\/data\/[a-z0-9-]+-history[a-z0-9-]*\.(manifest\.)?json$/;
const MIGRATION_PATH_RE = /^prisma\/migrations\/[^/]+\/migration\.sql$/;

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

/** GitHub said no for a reason that may pass later (missing stamp, deploy lag, API error). */
export class RetryableApprovalError extends Error {}
/** The approval can never pass for this PR content (A3/A4 failed, wrong actor, not merged). */
export class TerminalApprovalError extends Error {}
/**
 * The label isn't on the PR. Retryable before a run exists (the owner hasn't
 * labelled yet); for a run already applying it means the label was removed,
 * which halts the run (10.2).
 */
export class LabelMissingError extends RetryableApprovalError {}
/** A stamp older than the label this recent may just be Actions catching up (A3). */
const STAMP_GRACE_MS = 15 * 60 * 1000;

class GitHub {
  constructor(private readonly token: string, private readonly fetchImpl: FetchLike) {}

  async get<T>(path: string, accept = "application/vnd.github+json"): Promise<T> {
    const res = await this.raw(path, accept);
    return (await res.json()) as T;
  }

  async raw(path: string, accept: string): Promise<Response> {
    // Repo-relative paths, or the search API (the only absolute endpoint used).
    const url = path.startsWith("/search/") ? `https://api.github.com${path}` : `https://api.github.com/repos/${APPROVAL_REPO}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28" },
      });
    } catch (err) {
      throw new RetryableApprovalError(`GitHub unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new RetryableApprovalError(`GitHub ${res.status} for ${path.split("?")[0]}`);
    return res;
  }

  /** Every page of a list endpoint (100 per page, at most 30 pages). */
  async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 30; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const batch = await this.get<T[]>(`${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }
}

interface PullRequest {
  number: number;
  state: string;
  merged: boolean;
  merge_commit_sha: string | null;
  head: { sha: string; repo: { full_name: string } | null };
  base: { ref: string; sha: string };
  labels: Array<{ name: string }>;
}
interface IssueEvent { event: string; label?: { name: string }; actor?: { login: string } | null; created_at: string }
interface CommitStatus { context: string; description: string | null; creator?: { login: string } | null; created_at: string; state: string }
interface CompareFile { filename: string; status: string; sha: string; patch?: string; previous_filename?: string }
interface Compare { status: string; files?: CompareFile[]; commits?: Array<{ sha: string; parents: Array<{ sha: string }> }> }

export interface PrApproval {
  prNumber: number;
  /** H: the stamped head. */
  stampedSha: string;
  /** M: the PR's head now (at merge, for a merged PR). */
  headSha: string;
  /** S: the merge commit, for a merged PR. */
  mergeSha: string | null;
}

/** A2: the label is on now, and its newest `labeled` event was made by the owner. Returns that event's time. */
async function checkLabel(gh: GitHub, pr: PullRequest): Promise<string> {
  if (!pr.labels.some((l) => l.name === APPROVAL_LABEL)) throw new LabelMissingError(`A2: the PR doesn't carry ${APPROVAL_LABEL}`);
  const events = await gh.list<IssueEvent>(`/issues/${pr.number}/events`);
  const labeled = events.filter((e) => e.event === "labeled" && e.label?.name === APPROVAL_LABEL).at(-1);
  if (!labeled) throw new RetryableApprovalError("A2: no labeled event yet");
  if (labeled.actor?.login !== OWNER_GITHUB_LOGIN) throw new TerminalApprovalError(`A2: ${APPROVAL_LABEL} was last added by ${labeled.actor?.login ?? "unknown"}, not the owner`);
  return labeled.created_at;
}

/** The description names `#n` as a whole number (`#12` isn't `#123`). */
function namesPr(description: string, n: number): boolean {
  const token = `#${n}`;
  for (let at = description.indexOf(token); at !== -1; at = description.indexOf(token, at + 1)) {
    const next = description[at + token.length] ?? "";
    if (!(next >= "0" && next <= "9")) return true;
  }
  return false;
}

/** A3: the newest commit of the PR carrying the stamp for this PR, made by Actions after the label. */
async function findStamp(gh: GitHub, pr: PullRequest, labeledAt: string): Promise<string> {
  const commits = await gh.list<{ sha: string }>(`/pulls/${pr.number}/commits`);
  for (const { sha } of [...commits].reverse()) {
    const statuses = await gh.list<CommitStatus>(`/commits/${sha}/statuses`);
    const stamp = statuses.find(
      (s) =>
        s.context === STAMP_CONTEXT &&
        s.state === "success" &&
        s.creator?.login === STAMP_CREATOR &&
        namesPr(s.description ?? "", pr.number),
    );
    if (!stamp) continue;
    if (stamp.created_at < labeledAt) {
      // Actions may not have stamped the new head yet; only an old label makes this final.
      if (Date.now() - Date.parse(labeledAt) < STAMP_GRACE_MS) throw new RetryableApprovalError("A3: waiting for the stamp of the latest label");
      throw new TerminalApprovalError("A3: the newest stamp predates the owner's label");
    }
    return sha;
  }
  throw new RetryableApprovalError("A3: no stamp yet");
}

/** The +/- lines of a patch, in order, without hunk headers or context. */
function changedLines(patch: string): string[] {
  return patch.split("\n").filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"));
}

/**
 * A4: M is H, or every commit after H up to M is a merge (of main) and the
 * PR's own change is identical at H and M: the same paths with the same
 * statuses, and per path the same blob or the same ordered +/- lines.
 */
async function checkHeadMatchesStamp(gh: GitHub, stamped: string, head: string, base: string): Promise<void> {
  if (stamped === head) return;
  const between = await gh.get<Compare>(`/compare/${stamped}...${head}`);
  if (between.status !== "ahead") throw new TerminalApprovalError("A4: the head isn't a descendant of the stamped commit");
  if ((between.commits ?? []).some((c) => c.parents.length < 2)) throw new TerminalApprovalError("A4: a commit after the stamp isn't a merge of main");
  // A fixed base, not today's main: once a PR merges with a merge commit, both
  // diffs against current main would be empty and anything would pass.
  const [atStamp, atHead] = await Promise.all([gh.get<Compare>(`/compare/${base}...${stamped}`), gh.get<Compare>(`/compare/${base}...${head}`)]);
  const key = (f: CompareFile) => `${f.status}:${f.previous_filename ?? ""}:${f.filename}`;
  const a = new Map((atStamp.files ?? []).map((f) => [f.filename, f]));
  const b = new Map((atHead.files ?? []).map((f) => [f.filename, f]));
  if (a.size !== b.size) throw new TerminalApprovalError("A4: the PR's own files differ between the stamp and the head");
  for (const [name, fa] of a) {
    const fb = b.get(name);
    if (!fb || key(fa) !== key(fb)) throw new TerminalApprovalError(`A4: ${name} differs between the stamp and the head`);
    if (fa.sha === fb.sha) continue;
    if (fa.patch === undefined || fb.patch === undefined) throw new TerminalApprovalError(`A4: ${name} changed and its patch can't be compared`);
    if (changedLines(fa.patch).join("\n") !== changedLines(fb.patch).join("\n")) throw new TerminalApprovalError(`A4: ${name}'s change differs between the stamp and the head`);
  }
}

/** A1: S is an ancestor of the deployed commit (the deploy contains the PR). */
async function checkDeployed(gh: GitHub, mergeSha: string, deployedSha: string | null): Promise<void> {
  if (!deployedSha) throw new RetryableApprovalError("A1: the deployed commit is unknown");
  if (mergeSha === deployedSha) return;
  const cmp = await gh.get<Compare>(`/compare/${mergeSha}...${deployedSha}`);
  if (cmp.status !== "ahead" && cmp.status !== "identical") throw new RetryableApprovalError("A1: the deploy doesn't contain the PR yet");
}

export interface ApprovalContext {
  token?: string;
  fetchImpl?: FetchLike;
}

function client(ctx: ApprovalContext): GitHub {
  const token = ctx.token ?? process.env.GITHUB_APPROVAL_READ_TOKEN;
  if (!token) throw new RetryableApprovalError("GITHUB_APPROVAL_READ_TOKEN is not set");
  return new GitHub(token, ctx.fetchImpl ?? fetch);
}

/**
 * A2–A4 against the PR's current head, for the implementer's code-merge step
 * (6.4): returns the head the owner approved, to merge with --match-head-commit.
 */
export async function checkOpenPrApproval(prNumber: number, ctx: ApprovalContext = {}): Promise<PrApproval> {
  const gh = client(ctx);
  const pr = await gh.get<PullRequest>(`/pulls/${prNumber}`);
  if (pr.head.repo?.full_name !== APPROVAL_REPO) throw new TerminalApprovalError("the PR's head isn't in this repository");
  const labeledAt = await checkLabel(gh, pr);
  const stamped = await findStamp(gh, pr, labeledAt);
  await checkHeadMatchesStamp(gh, stamped, pr.head.sha, pr.base.sha);
  return { prNumber, stampedSha: stamped, headSha: pr.head.sha, mergeSha: pr.merged ? pr.merge_commit_sha : null };
}

/** An open PR's current head, for a preview (which runs before any label). Refuses a fork. */
export async function openPrHead(prNumber: number, ctx: ApprovalContext = {}): Promise<string> {
  const pr = await client(ctx).get<PullRequest>(`/pulls/${prNumber}`);
  if (pr.head.repo?.full_name !== APPROVAL_REPO) throw new TerminalApprovalError("the PR's head isn't in this repository");
  return pr.head.sha;
}

/** A1–A4 for a merged PR, before plan and every batch (6.4). */
export async function checkMergedPrApproval(prNumber: number, deployedSha: string | null, ctx: ApprovalContext = {}): Promise<PrApproval & { mergeSha: string }> {
  const gh = client(ctx);
  const pr = await gh.get<PullRequest>(`/pulls/${prNumber}`);
  if (!pr.merged || !pr.merge_commit_sha) throw new RetryableApprovalError("A1: the PR isn't merged yet");
  if (pr.base.ref !== "main") throw new TerminalApprovalError("A1: the PR didn't merge into main");
  await checkDeployed(gh, pr.merge_commit_sha, deployedSha);
  const labeledAt = await checkLabel(gh, pr);
  const stamped = await findStamp(gh, pr, labeledAt);
  // The main the PR merged into: the merge commit's first parent.
  const merge = await gh.get<{ parents: Array<{ sha: string }> }>(`/commits/${pr.merge_commit_sha}`);
  await checkHeadMatchesStamp(gh, stamped, pr.head.sha, merge.parents[0]?.sha ?? pr.base.sha);
  return { prNumber, stampedSha: stamped, headSha: pr.head.sha, mergeSha: pr.merge_commit_sha };
}

/**
 * Merged PRs labelled owner-approved since `since` that carry a backfill
 * manifest, with their merge time, for the watch cron (7.3, 11.3).
 */
export async function listApprovedManifestPrs(since: Date, ctx: ApprovalContext = {}): Promise<Array<{ prNumber: number; mergedAt: string }>> {
  const gh = client(ctx);
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
  const gh = client(ctx);
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
  return fileAt(client(ctx), path, ref);
}
