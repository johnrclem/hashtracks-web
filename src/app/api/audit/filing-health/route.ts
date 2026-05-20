/**
 * Audit filing-health probe.
 *
 * GET-only, admin-gated. Runs two non-mutating GitHub probes with the same
 * `GITHUB_TOKEN` the filing routes use, then renders a single status object
 * the admin audit page surfaces as a chip:
 *
 *   1. `GET /rate_limit` — confirms the token is syntactically accepted and
 *      reports remaining core-API budget. Detects the #1494 root cause
 *      (expired token → 401) and rate-limit exhaustion (403 with
 *      `x-ratelimit-remaining: 0`).
 *   2. `GET /repos/{owner}/{repo}` — confirms the token has access to the
 *      configured repo AND that its permissions include `push: true`, which
 *      is the GitHub-side signal for "can create issues and post comments"
 *      on a fine-grained PAT. Without this second probe, a token that's
 *      valid but scoped to the wrong repo or downgraded to read-only would
 *      pass `/rate_limit` and render a green chip while every actual
 *      filing 401s — Codex adversarial review on PR #1509.
 *
 * Neither probe mutates state, so the endpoint is safe to call on every
 * dashboard render. GitHub docs:
 *   https://docs.github.com/en/rest/rate-limit
 *   https://docs.github.com/en/rest/repos/repos#get-a-repository
 */
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { getValidatedRepo } from "@/lib/github-repo";
import { safeErrorBody } from "@/lib/safe-error-body";

const FETCH_TIMEOUT_MS = 5_000;
const LOW_REMAINING_THRESHOLD = 100;

interface RateLimitResponse {
  resources?: {
    core?: {
      limit: number;
      remaining: number;
      reset: number;
    };
  };
}

interface RepoResponse {
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
}

export interface FilingHealthResult {
  /** `ok` — token validated, repo accessible, write capability confirmed.
   *  `warn` — token works but remaining core-API budget is dangerously low.
   *  `error` — token missing, rejected, lacks repo access or write capability,
   *  or GitHub unreachable. */
  status: "ok" | "warn" | "error";
  /** Human-readable summary suitable for chip + tooltip. */
  message: string;
  /** Repo the filing endpoints will target. */
  repo: string;
  /** Remaining core-API budget reported by GitHub, when available. */
  remaining?: number;
  /** Unix-seconds reset time reported by GitHub, when available. */
  resetAt?: number;
}

/**
 * Surface the most common GitHub failure shapes with actionable hints
 * instead of a generic "GitHub returned N" line. The dashboard chip
 * shows the message verbatim in its tooltip, so a clear sentence here
 * saves the admin a log dive.
 */
function rateLimitErrorMessageFor(res: Response, body: string): string {
  if (res.status === 401) {
    return "GitHub rejected the token (401 Bad Credentials). Rotate GITHUB_TOKEN in Vercel prod env.";
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    // Guard: a misbehaving GitHub proxy or future format change could ship a
    // non-numeric `x-ratelimit-reset` header; `new Date(NaN).toISOString()`
    // throws RangeError and converts a 403 rate-limit response into a
    // generic catch-path error — exactly the diagnostic we lose.
    const reset = res.headers.get("x-ratelimit-reset");
    const resetEpoch = reset ? Number(reset) : Number.NaN;
    const resetHint = Number.isFinite(resetEpoch)
      ? ` (resets at ${new Date(resetEpoch * 1000).toISOString()})`
      : "";
    return `Token works but is rate-limited${resetHint}. Wait for the reset window or rotate to a token with higher quota.`;
  }
  return `GitHub /rate_limit returned ${res.status}: ${body.slice(0, 200)}`;
}

function repoErrorMessageFor(res: Response, body: string, repo: string): string {
  if (res.status === 404) {
    return `Token cannot see repo ${repo} (404). Check the token is scoped to the right repo and has the Metadata permission.`;
  }
  if (res.status === 403) {
    return `Token is forbidden from reading repo ${repo} (403). Check repo-permission scopes.`;
  }
  return `GitHub /repos/${repo} returned ${res.status}: ${body.slice(0, 200)}`;
}

function githubAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}

export async function GET(): Promise<NextResponse<FilingHealthResult>> {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json(
      { status: "error", message: "Not authorized", repo: "" },
      { status: 403 },
    );
  }

  const repo = getValidatedRepo();
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        status: "error",
        message: "GITHUB_TOKEN is not set on this deployment",
        repo,
      },
      { status: 200 },
    );
  }

  // Probe 1: /rate_limit — token liveness + budget
  let rateLimit: { remaining: number; limit: number; reset: number };
  try {
    const url = new URL("/rate_limit", "https://api.github.com");
    const res = await fetch(url, {
      method: "GET",
      headers: githubAuthHeaders(token),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await safeErrorBody(res);
      return NextResponse.json(
        { status: "error", message: rateLimitErrorMessageFor(res, body), repo },
        { status: 200 },
      );
    }
    const json = (await res.json()) as RateLimitResponse;
    const core = json.resources?.core;
    if (!core) {
      return NextResponse.json(
        {
          status: "error",
          message: "GitHub /rate_limit returned a payload with no core block",
          repo,
        },
        { status: 200 },
      );
    }
    rateLimit = core;
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: `Could not reach GitHub /rate_limit: ${err instanceof Error ? err.message : String(err)}`,
        repo,
      },
      { status: 200 },
    );
  }

  // Probe 2: /repos/{repo} — repo access + write-capability check
  try {
    const url = new URL(`/repos/${repo}`, "https://api.github.com");
    const res = await fetch(url, {
      method: "GET",
      headers: githubAuthHeaders(token),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await safeErrorBody(res);
      return NextResponse.json(
        {
          status: "error",
          message: repoErrorMessageFor(res, body, repo),
          repo,
          remaining: rateLimit.remaining,
          resetAt: rateLimit.reset,
        },
        { status: 200 },
      );
    }
    const json = (await res.json()) as RepoResponse;
    // `permissions.push: true` means the calling token can write to the
    // repo, which covers issue creation and comments. `admin`/`maintain`
    // imply push. Read-only tokens (`pull`-only) explicitly fail here so
    // we don't ship a green chip while filings 401 silently.
    const perms = json.permissions ?? {};
    const canWrite = perms.push === true || perms.maintain === true || perms.admin === true;
    if (!canWrite) {
      return NextResponse.json(
        {
          status: "error",
          message: `Token can read ${repo} but lacks write access (permissions.push !== true). Rotate to a token with Issues: Read+Write on the repo.`,
          repo,
          remaining: rateLimit.remaining,
          resetAt: rateLimit.reset,
        },
        { status: 200 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: `Could not reach GitHub /repos/${repo}: ${err instanceof Error ? err.message : String(err)}`,
        repo,
        remaining: rateLimit.remaining,
        resetAt: rateLimit.reset,
      },
      { status: 200 },
    );
  }

  const status = rateLimit.remaining < LOW_REMAINING_THRESHOLD ? "warn" : "ok";
  const message =
    status === "warn"
      ? `Token works and can write to ${repo}, but only ${rateLimit.remaining}/${rateLimit.limit} core calls remain until reset.`
      : `Token works and can write to ${repo}. ${rateLimit.remaining}/${rateLimit.limit} core calls remain.`;
  return NextResponse.json(
    {
      status,
      message,
      repo,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.reset,
    },
    { status: 200 },
  );
}
