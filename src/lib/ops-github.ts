/**
 * GitHub reads and writes for the ops watchdog and the ops digest.
 *
 * The watchdog reads pull requests, issues and comments to judge the desktop tasks by what they
 * left on GitHub, and files, comments on and closes its own `lane:ops` issues. The digest lists
 * the pull requests waiting on the owner.
 *
 * Auth is the server GitHub App (`src/lib/github-app.ts`), with a fresh installation token per call
 * from its cache. Every call fails loudly with
 * {@link GithubUnavailableError}: callers treat that as "couldn't check", never as "nothing there".
 * Every issue and comment it posts passes through `scrubSecrets` first: the repo is public.
 */
import { scrubSecrets } from "@/lib/audit-redact";
import { hasServerGithubCredential, requireServerGithubToken } from "@/lib/github-app";
import { getValidatedRepo, GITHUB_API_ORIGIN, githubHeaders } from "@/lib/github-repo";

const TIMEOUT_MS = 15_000;
const PER_PAGE = 100;

export class GithubUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubUnavailableError";
  }
}

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: Date;
  closedAt: Date | null;
  /** "completed", "not_planned", "reopened" or null (open, or closed before GitHub recorded reasons). */
  stateReason: string | null;
  /** Set for pull requests (the issues API lists both). */
  pull: { mergedAt: Date | null; draft: boolean } | null;
}

export interface GhPull {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  labels: string[];
  createdAt: Date;
  headSha: string;
  headRef: string;
  author: string;
  /** Opened by a GitHub App or other bot account. */
  authorIsBot: boolean;
}

export interface GhComment {
  issueNumber: number;
  createdAt: Date;
  body: string;
  /** Posted by a GitHub App or other bot account. */
  byBot: boolean;
}

export interface IssueQuery {
  /** Comma-separated; GitHub ANDs them. */
  labels: string;
  state: "open" | "closed" | "all";
  sort?: "created" | "updated";
  /** Only issues updated at or after this time. */
  since?: Date;
  /** Results to read, newest first by `sort`; at most 100 per page. */
  limit?: number;
}

export interface OpsGithub {
  listIssues(query: IssueQuery): Promise<GhIssue[]>;
  listOpenPulls(): Promise<GhPull[]>;
  /** Comments on issues and pull requests created or edited at or after `since`, newest first. */
  listIssueComments(since: Date): Promise<GhComment[]>;
  createIssue(input: { title: string; body: string; labels: string[] }): Promise<number>;
  comment(issueNumber: number, body: string): Promise<void>;
  close(issueNumber: number): Promise<void>;
  /** The state of one commit-status context on `sha` ("success", "pending", …), or null if never set. */
  commitStatus(sha: string, context: string): Promise<string | null>;
  /** Rules GitHub enforces on `branch` (rulesets in "active" mode; evaluate-mode rules are not listed). */
  branchRuleCount(branch: string): Promise<number>;
}

const date = (v: unknown): Date | null => (typeof v === "string" ? new Date(v) : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const labelNames = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((l) => (typeof l === "string" ? l : str((l as { name?: unknown } | null)?.name))).filter(Boolean)
    : [];

type Json = Record<string, unknown>;

function parseIssue(raw: Json): GhIssue {
  const pr = raw.pull_request as Json | undefined;
  return {
    number: Number(raw.number),
    title: str(raw.title),
    body: str(raw.body),
    labels: labelNames(raw.labels),
    createdAt: date(raw.created_at) ?? new Date(0),
    closedAt: date(raw.closed_at),
    stateReason: typeof raw.state_reason === "string" ? raw.state_reason : null,
    pull: pr ? { mergedAt: date(pr.merged_at), draft: raw.draft === true } : null,
  };
}

function parsePull(raw: Json): GhPull {
  return {
    number: Number(raw.number),
    title: str(raw.title),
    url: str(raw.html_url),
    draft: raw.draft === true,
    labels: labelNames(raw.labels),
    createdAt: date(raw.created_at) ?? new Date(0),
    headSha: str((raw.head as Json | undefined)?.sha),
    headRef: str((raw.head as Json | undefined)?.ref),
    author: str((raw.user as Json | undefined)?.login),
    authorIsBot: (raw.user as Json | undefined)?.type === "Bot",
  };
}

function parseComment(raw: Json): GhComment | null {
  // issue_url ends in /issues/<n> for comments on issues and pull requests alike.
  const match = /\/issues\/(\d+)$/.exec(str(raw.issue_url));
  if (!match) return null;
  return {
    issueNumber: Number(match[1]),
    createdAt: date(raw.created_at) ?? new Date(0),
    body: str(raw.body),
    byBot: (raw.user as Json | undefined)?.type === "Bot",
  };
}

/** A fixed token, or a function that returns a current one (installation tokens expire hourly). */
export type GithubTokenSource = string | (() => Promise<string>);

export function createOpsGithub(auth: GithubTokenSource, fetchImpl: typeof fetch = fetch): OpsGithub {
  const repo = getValidatedRepo();

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    // The URL constructor anchors every request to api.github.com.
    const url = new URL(`/repos/${repo}${path}`, GITHUB_API_ORIGIN);
    let res: Response;
    try {
      const headers = githubHeaders(typeof auth === "string" ? auth : await auth());
      res = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new GithubUnavailableError(`GitHub ${init.method ?? "GET"} ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new GithubUnavailableError(`GitHub ${init.method ?? "GET"} ${path}: HTTP ${res.status}`);
    if (res.status === 204) return null;
    try {
      return await res.json();
    } catch (err) {
      throw new GithubUnavailableError(`GitHub ${init.method ?? "GET"} ${path}: unreadable body: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function list(path: string, params: URLSearchParams, limit: number): Promise<Json[]> {
    const out: Json[] = [];
    params.set("per_page", String(Math.min(limit, PER_PAGE)));
    let page = 1;
    let more = true;
    while (more && out.length < limit) {
      params.set("page", String(page++));
      const rows = await call(`${path}?${params}`);
      if (!Array.isArray(rows)) throw new GithubUnavailableError(`GitHub GET ${path}: not a list`);
      out.push(...(rows as Json[]));
      more = rows.length === PER_PAGE;
    }
    return out.slice(0, limit);
  }

  return {
    async listIssues({ labels, state, sort = "created", since, limit = PER_PAGE }) {
      const params = new URLSearchParams({ labels, state, sort, direction: "desc" });
      if (since) params.set("since", since.toISOString());
      return (await list("/issues", params, limit)).map(parseIssue);
    },
    async listOpenPulls() {
      const params = new URLSearchParams({ state: "open", sort: "created", direction: "asc" });
      return (await list("/pulls", params, 300)).map(parsePull);
    },
    async listIssueComments(since) {
      const params = new URLSearchParams({ since: since.toISOString(), sort: "created", direction: "desc" });
      return (await list("/issues/comments", params, 300))
        .map(parseComment)
        .filter((c): c is GhComment => c !== null);
    },
    async createIssue({ title, body, labels }) {
      const created = (await call("/issues", {
        method: "POST",
        body: JSON.stringify({ title: scrubSecrets(title).text, body: scrubSecrets(body).text, labels }),
      })) as Json;
      const number = Number(created?.number);
      if (!Number.isInteger(number)) throw new GithubUnavailableError("GitHub created an issue without a number");
      return number;
    },
    async comment(issueNumber, body) {
      await call(`/issues/${issueNumber}/comments`, { method: "POST", body: JSON.stringify({ body: scrubSecrets(body).text }) });
    },
    async close(issueNumber) {
      await call(`/issues/${issueNumber}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed", state_reason: "completed" }),
      });
    },
    async commitStatus(sha, context) {
      // The combined status lists the latest status per context (first page: up to 100 contexts).
      const combined = (await call(`/commits/${encodeURIComponent(sha)}/status?per_page=100`)) as Json | null;
      const statuses = Array.isArray(combined?.statuses) ? (combined.statuses as Json[]) : [];
      const hit = statuses.find((st) => st.context === context);
      return hit ? str(hit.state) || null : null;
    },
    async branchRuleCount(branch) {
      const rules = await call(`/rules/branches/${encodeURIComponent(branch)}`);
      if (!Array.isArray(rules)) throw new GithubUnavailableError(`GitHub GET /rules/branches/${branch}: not a list`);
      return rules.length;
    },
  };
}

/** The ops GitHub client, or null when the server has no GitHub credential configured. */
export function opsGithubFromEnv(): OpsGithub | null {
  return hasServerGithubCredential() ? createOpsGithub(requireServerGithubToken) : null;
}

/** Branches the agents and interactive workstream sessions push from (write-gate's list plus `claude/`). */
const AGENT_BRANCH_PREFIXES = ["claude/", "audit-fix/", "onboarding/", "onboard/", "deep-dive/", "hareline-audit/", "ops-digest/"];
const AGENT_LABELS = new Set(["audit-fix", "onboarding-impl"]);

/** An agent's or workstream session's PR, as opposed to one the owner wrote by hand (scorecard O4). */
export function isAgentOrWorkstreamPr(pr: GhPull): boolean {
  return (
    pr.authorIsBot ||
    AGENT_BRANCH_PREFIXES.some((p) => pr.headRef.startsWith(p)) ||
    pr.labels.some((l) => AGENT_LABELS.has(l))
  );
}

/** Pull requests among `rows` merged at or after `since`. */
export function mergedSince(rows: GhIssue[], since: Date): GhIssue[] {
  return rows.filter((i) => i.pull?.mergedAt && i.pull.mergedAt >= since);
}

/** "N (#a, #b)" for a list of issues or pull requests, "0" when empty. */
export function numberList(rows: Array<{ number: number }>): string {
  if (rows.length === 0) return "0";
  const numbers = rows.map((r) => "#" + r.number).join(", ");
  return `${rows.length} (${numbers})`;
}

/** The owner's approval on an agent PR (`audit-fix`, `onboarding-impl`); the agent then merges it. */
const OWNER_APPROVED_LABEL = "owner-approved";
/** Docs-only handoff PRs the research task merges itself. */
const SELF_MERGED_LABEL = "onboarding-handoff";

/**
 * An open pull request only the owner can move: not a draft, not yet approved, and not one the
 * research task merges itself. In this repo that covers agent PRs and every PR with a migration.
 */
export function isWaitingOnOwner(pr: GhPull): boolean {
  return !pr.draft && !pr.labels.includes(OWNER_APPROVED_LABEL) && !pr.labels.includes(SELF_MERGED_LABEL);
}
