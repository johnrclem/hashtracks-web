/**
 * GitHub reads and writes for the ops watchdog and the ops digest.
 *
 * The watchdog reads pull requests, issues and comments to judge the desktop tasks by what they
 * left on GitHub, and files, comments on and closes its own `lane:ops` issues. The digest lists
 * the pull requests waiting on the owner.
 *
 * Auth is `GITHUB_TOKEN` for now (the ops plan's S4 swaps in the server GitHub App; only
 * {@link opsGithubFromEnv} reads the token). Every call fails loudly with
 * {@link GithubUnavailableError}: callers treat that as "couldn't check", never as "nothing there".
 */
import { getValidatedRepo } from "@/lib/github-repo";

const API_ORIGIN = "https://api.github.com";
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
}

const date = (v: unknown): Date | null => (typeof v === "string" ? new Date(v) : null);
const labelNames = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((l) => (typeof l === "string" ? l : String((l as { name?: unknown })?.name ?? ""))).filter(Boolean)
    : [];

type Json = Record<string, unknown>;

function parseIssue(raw: Json): GhIssue {
  const pr = raw.pull_request as Json | undefined;
  return {
    number: Number(raw.number),
    title: String(raw.title ?? ""),
    body: typeof raw.body === "string" ? raw.body : "",
    labels: labelNames(raw.labels),
    createdAt: date(raw.created_at) ?? new Date(0),
    closedAt: date(raw.closed_at),
    pull: pr ? { mergedAt: date(pr.merged_at), draft: raw.draft === true } : null,
  };
}

function parsePull(raw: Json): GhPull {
  return {
    number: Number(raw.number),
    title: String(raw.title ?? ""),
    url: String(raw.html_url ?? ""),
    draft: raw.draft === true,
    labels: labelNames(raw.labels),
    createdAt: date(raw.created_at) ?? new Date(0),
    headSha: String((raw.head as Json | undefined)?.sha ?? ""),
  };
}

function parseComment(raw: Json): GhComment | null {
  // issue_url ends in /issues/<n> for comments on issues and pull requests alike.
  const match = /\/issues\/(\d+)$/.exec(String(raw.issue_url ?? ""));
  if (!match) return null;
  return {
    issueNumber: Number(match[1]),
    createdAt: date(raw.created_at) ?? new Date(0),
    body: typeof raw.body === "string" ? raw.body : "",
    byBot: (raw.user as Json | undefined)?.type === "Bot",
  };
}

export function createOpsGithub(token: string, fetchImpl: typeof fetch = fetch): OpsGithub {
  const repo = getValidatedRepo();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    // The URL constructor anchors every request to api.github.com.
    const url = new URL(`/repos/${repo}${path}`, API_ORIGIN);
    let res: Response;
    try {
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
    for (let page = 1; out.length < limit; page++) {
      params.set("page", String(page));
      const rows = await call(`${path}?${params}`);
      if (!Array.isArray(rows)) throw new GithubUnavailableError(`GitHub GET ${path}: not a list`);
      out.push(...(rows as Json[]));
      if (rows.length < PER_PAGE) break;
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
      const created = (await call("/issues", { method: "POST", body: JSON.stringify({ title, body, labels }) })) as Json;
      const number = Number(created?.number);
      if (!Number.isInteger(number)) throw new GithubUnavailableError("GitHub created an issue without a number");
      return number;
    },
    async comment(issueNumber, body) {
      await call(`/issues/${issueNumber}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    },
    async close(issueNumber) {
      await call(`/issues/${issueNumber}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed", state_reason: "completed" }),
      });
    },
  };
}

/** The ops GitHub client, or null when `GITHUB_TOKEN` is unset. */
export function opsGithubFromEnv(): OpsGithub | null {
  const token = process.env.GITHUB_TOKEN;
  return token ? createOpsGithub(token) : null;
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
