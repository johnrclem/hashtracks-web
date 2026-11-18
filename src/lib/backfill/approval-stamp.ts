/**
 * The backfill approval stamp and its A2–A4 checks, shared by the ops `write-gate` workflow
 * (`scripts/ci/write-gate-run.ts`, which sets the stamp and gates every PR on it) and the server
 * (`approval.ts`, which adds A1 and checks it before a backfill and at merge), so the stamp and the
 * check can't drift apart (docs/onboarding-backfill-automation-design.md 6.3, 6.4; ops plan v6 §2).
 * G15 protects this file.
 *
 * The gate sets a commit status `backfill/approved` on the PR head when the owner adds
 * `owner-approved`, with "PR #<n>" in its description. A2–A4 then read GitHub only through the
 * read client below (the server's `GITHUB_APPROVAL_READ_TOKEN`, or the gate's own token).
 *
 * A missing stamp and GitHub errors are retryable; a stamp that fails A3 or A4 is terminal.
 */

export const APPROVAL_LABEL = "owner-approved";
export const STAMP_CONTEXT = "backfill/approved";
/** Statuses set by the workflow come from Actions' token. */
export const STAMP_CREATOR = "github-actions[bot]";
const DEFAULT_OWNER_GITHUB_LOGIN = "johnrclem";

/** The only account whose label approves (A2). The workflow passes the same value. */
export function ownerGithubLogin(): string {
  return process.env.OWNER_GITHUB_LOGIN?.trim() || DEFAULT_OWNER_GITHUB_LOGIN;
}

/** The status description the gate writes for a PR. The check reads only its `#N` (`namesPr`). */
export function stampDescription(prNumber: number): string {
  return `Approved by the owner for PR #${prNumber}`;
}

/** The description names `#n` as a whole number (`#12` isn't `#123`). */
export function namesPr(description: string, n: number): boolean {
  const token = `#${n}`;
  for (let at = description.indexOf(token); at !== -1; at = description.indexOf(token, at + 1)) {
    const next = description[at + token.length] ?? "";
    if (!(next >= "0" && next <= "9")) return true;
  }
  return false;
}

export interface StampStatus {
  context: string;
  state: string;
  description: string | null;
  creator?: { login: string } | null;
}

/** A3's test of one commit status: the approval stamp for this PR, set by Actions. */
export function isApprovalStamp(status: StampStatus, prNumber: number): boolean {
  return (
    status.context === STAMP_CONTEXT &&
    status.state === "success" &&
    status.creator?.login === STAMP_CREATOR &&
    namesPr(status.description ?? "", prNumber)
  );
}

/** The repository approvals are read from. A fork's head never approves. */
export const APPROVAL_REPO = "johnrclem/hashtracks-web";

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
const MAX_LIST_PAGES = 30;
/** GitHub's compare lists at most 300 files: a full list may hide a change (A4). */
const COMPARE_FILE_CAP = 300;
/** Commits A4 walks from the head back to the stamp before giving up. */
const MAX_FIRST_PARENT_STEPS = 100;

/** Read-only GitHub client for the approval checks; every failure is retryable. */
export class GitHub {
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

  /** Every page of a list endpoint (100 per page). Refuses a list too long to read whole, never returns part of one. */
  async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes("?") ? "&" : "?";
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const batch = await this.get<T[]>(`${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) return out;
    }
    throw new RetryableApprovalError(`GitHub list ${path.split("?")[0]} has more than ${MAX_LIST_PAGES * 100} items`);
  }
}

export interface PullRequest {
  number: number;
  state: string;
  merged: boolean;
  merge_commit_sha: string | null;
  head: { sha: string; repo: { full_name: string } | null };
  base: { ref: string; sha: string };
  labels: Array<{ name: string }>;
}
interface IssueEvent { event: string; label?: { name: string }; actor?: { login: string } | null; created_at: string }
export interface CommitStatus { context: string; description: string | null; creator?: { login: string } | null; created_at: string; state: string }
interface CompareFile { filename: string; status: string; sha: string; patch?: string; previous_filename?: string }
interface Commit { sha: string; parents: Array<{ sha: string }> }
export interface Compare { status: string; files?: CompareFile[]; commits?: Commit[] }

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
  const labeled = events.findLast((e) => e.event === "labeled" && e.label?.name === APPROVAL_LABEL);
  if (!labeled) throw new RetryableApprovalError("A2: no labeled event yet");
  if (labeled.actor?.login !== ownerGithubLogin()) throw new TerminalApprovalError(`A2: ${APPROVAL_LABEL} was last added by ${labeled.actor?.login ?? "unknown"}, not the owner`);
  return labeled.created_at;
}

/** A3: the newest commit of the PR carrying the stamp for this PR, made by Actions after the label. */
async function findStamp(gh: GitHub, pr: PullRequest, labeledAt: string): Promise<string> {
  const commits = await gh.list<{ sha: string }>(`/pulls/${pr.number}/commits`);
  for (const { sha } of [...commits].reverse()) {
    const statuses = await gh.list<CommitStatus>(`/commits/${sha}/statuses`);
    const stamp = statuses.find((s) => isApprovalStamp(s, pr.number));
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
 * A4's first-parent rule: walking from M back along first parents reaches H,
 * and every commit on that walk is a merge. Commits those merges bring in from
 * main are not the PR's own and may be ordinary commits.
 */
async function checkFirstParentMerges(gh: GitHub, stamped: string, head: string, compared: readonly Commit[]): Promise<void> {
  const known = new Map(compared.map((c) => [c.sha, c]));
  let sha = head;
  for (let step = 0; step < MAX_FIRST_PARENT_STEPS; step++) {
    if (sha === stamped) return;
    const commit = known.get(sha) ?? (await gh.get<Commit>(`/commits/${sha}`));
    if (commit.parents.length < 2) throw new TerminalApprovalError("A4: a commit after the stamp isn't a merge of main");
    sha = commit.parents[0].sha;
  }
  throw new TerminalApprovalError(`A4: the stamp is more than ${MAX_FIRST_PARENT_STEPS} merges behind the head`);
}

/** A compare's file list, refused when GitHub may have cut it short. */
function comparedFiles(cmp: Compare): CompareFile[] {
  const files = cmp.files ?? [];
  if (files.length >= COMPARE_FILE_CAP) throw new TerminalApprovalError(`A4: the PR changes ${COMPARE_FILE_CAP} or more files, too many to compare`);
  return files;
}

/**
 * A4: M is H, or M follows H only by merges (of main) and the PR's own change
 * is identical at H and M: the same paths with the same statuses, and per path
 * the same blob or the same ordered +/- lines.
 */
async function checkHeadMatchesStamp(gh: GitHub, stamped: string, head: string, base: string): Promise<void> {
  if (stamped === head) return;
  const between = await gh.get<Compare>(`/compare/${stamped}...${head}`);
  if (between.status !== "ahead") throw new TerminalApprovalError("A4: the head isn't a descendant of the stamped commit");
  await checkFirstParentMerges(gh, stamped, head, between.commits ?? []);
  // A fixed base, not today's main: once a PR merges with a merge commit, both
  // diffs against current main would be empty and anything would pass.
  const [atStamp, atHead] = await Promise.all([gh.get<Compare>(`/compare/${base}...${stamped}`), gh.get<Compare>(`/compare/${base}...${head}`)]);
  const key = (f: CompareFile) => `${f.status}:${f.previous_filename ?? ""}:${f.filename}`;
  const a = new Map(comparedFiles(atStamp).map((f) => [f.filename, f]));
  const b = new Map(comparedFiles(atHead).map((f) => [f.filename, f]));
  if (a.size !== b.size) throw new TerminalApprovalError("A4: the PR's own files differ between the stamp and the head");
  for (const [name, fa] of a) {
    const fb = b.get(name);
    if (!fb || key(fa) !== key(fb)) throw new TerminalApprovalError(`A4: ${name} differs between the stamp and the head`);
    if (fa.sha === fb.sha) continue;
    if (fa.patch === undefined || fb.patch === undefined) throw new TerminalApprovalError(`A4: ${name} changed and its patch can't be compared`);
    if (changedLines(fa.patch).join("\n") !== changedLines(fb.patch).join("\n")) throw new TerminalApprovalError(`A4: ${name}'s change differs between the stamp and the head`);
  }
}

/** A fork's head (or a deleted fork's, which GitHub reports as null) never approves. */
export function refuseFork(pr: PullRequest): void {
  if (pr.head.repo?.full_name !== APPROVAL_REPO) throw new TerminalApprovalError("the PR's head isn't in this repository");
}

/**
 * A2–A4 for a PR whose own change is judged against `base`: the newest `owner-approved` label is
 * the owner's, a stamp made after it names this PR, and the head is the stamped head up to merges
 * of main. Returns the stamped SHA. For an open PR `base` is its base SHA; for a merged one, the
 * merge commit's first parent (`approval.ts`), since both diffs against today's main would be empty.
 */
export async function checkStampedHead(gh: GitHub, pr: PullRequest, base: string): Promise<string> {
  const labeledAt = await checkLabel(gh, pr);
  const stamped = await findStamp(gh, pr, labeledAt);
  await checkHeadMatchesStamp(gh, stamped, pr.head.sha, base);
  return stamped;
}

export interface ApprovalContext {
  token?: string;
  fetchImpl?: FetchLike;
}

export function approvalClient(ctx: ApprovalContext): GitHub {
  // The server's read-only token; the gate passes its own.
  const token = ctx.token ?? process.env.GITHUB_APPROVAL_READ_TOKEN;
  if (!token) throw new RetryableApprovalError("GITHUB_APPROVAL_READ_TOKEN is not set");
  return new GitHub(token, ctx.fetchImpl ?? fetch);
}

/**
 * A2–A4 against an open PR's current head: the gate's approval path, and the implementer's
 * code-merge step (6.4). Returns the head the owner approved, to merge with --match-head-commit.
 */
export async function checkOpenPrApproval(prNumber: number, ctx: ApprovalContext = {}): Promise<PrApproval> {
  const gh = approvalClient(ctx);
  const pr = await gh.get<PullRequest>(`/pulls/${prNumber}`);
  refuseFork(pr);
  const stamped = await checkStampedHead(gh, pr, pr.base.sha);
  return { prNumber, stampedSha: stamped, headSha: pr.head.sha, mergeSha: pr.merged ? pr.merge_commit_sha : null };
}
