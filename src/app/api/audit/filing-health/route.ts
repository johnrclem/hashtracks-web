/**
 * Audit filing-health probe.
 *
 * GET-only, admin-gated. Checks the credential the filing routes use (`serverGithubAuth`: the
 * "HashTracks Server" GitHub App, or the owner's `GITHUB_TOKEN` until cutover) with non-mutating
 * GitHub probes, then renders a single status object the admin audit page surfaces as a chip:
 *
 *   1. `GET /rate_limit` — confirms the token is accepted and reports remaining core-API budget.
 *      Detects an expired or revoked token (401, the #1494 root cause) and rate-limit exhaustion
 *      (403 with `x-ratelimit-remaining: 0`).
 *   2. Write capability. For the App: the installation token's granted permissions include
 *      `issues: write` (GitHub returns them when it mints the token). For the PAT fallback:
 *      `GET /repos/{owner}/{repo}` reports a role that can manage issues (admin, maintain, push or
 *      triage), so a token scoped to the wrong repo or downgraded to read-only can't render green
 *      while every filing 401s (Codex adversarial review on PR #1509).
 *
 * The PAT fallback is reported as `warn` until the App replaces it (docs/ops/system.md#identity).
 * No probe mutates state, so the endpoint is safe to call on every dashboard render. GitHub docs:
 *   https://docs.github.com/en/rest/rate-limit
 *   https://docs.github.com/en/rest/repos/repos#get-a-repository
 *   https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app
 */
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { serverGithubAuth, type ServerGithubAuth } from "@/lib/github-app";
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
  /** `ok` — the App's token works and can write issues.
   *  `warn` — the token works, but it is the owner's PAT fallback, or the remaining core-API
   *  budget is dangerously low.
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
function rateLimitErrorMessageFor(res: Response, body: string, source: ServerGithubAuth["source"]): string {
  if (res.status === 401) {
    return source === "app"
      ? "GitHub rejected the server App's installation token (401). Check the App is installed on the repo and its key in Vercel prod env is current."
      : "GitHub rejected the token (401 Bad Credentials). Rotate GITHUB_TOKEN in Vercel prod env.";
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
  let auth: ServerGithubAuth | null;
  try {
    auth = await serverGithubAuth();
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: `The server GitHub App failed: ${err instanceof Error ? err.message : String(err)}`,
        repo,
      },
      { status: 200 },
    );
  }
  if (!auth) {
    return NextResponse.json(
      {
        status: "error",
        message: "No GitHub credential on this deployment. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID (docs/ops/system.md#identity).",
        repo,
      },
      { status: 200 },
    );
  }
  const token = auth.token;

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
        { status: "error", message: rateLimitErrorMessageFor(res, body, auth.source), repo },
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

  if (auth.source === "app") {
    const issues = auth.permissions?.issues ?? "none";
    if (issues !== "write") {
      return NextResponse.json(
        {
          status: "error",
          message: `The server App's token can't write issues (issues: ${issues}). Give the App Issues: Read and write, then accept the new permission on its installation.`,
          repo,
          remaining: rateLimit.remaining,
          resetAt: rateLimit.reset,
        },
        { status: 200 },
      );
    }
    return budgetResult(rateLimit, repo, `The server App can file issues on ${repo}.`, "ok");
  }

  // Probe 2 (PAT fallback): /repos/{repo} — repo access + write-capability check
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
    // The `permissions` block on `/repos/{repo}` reflects the calling
    // identity's repo-collaborator role. We accept any role that grants
    // issue-management capability for our purposes:
    //   - `admin` / `maintain` / `push` — write-class roles (classic PATs
    //     with `repo`/`public_repo` and the repo owner identity all fall here)
    //   - `triage` — explicitly grants issue / PR management without code
    //     push. Fine-grained PATs scoped to `Issues: Read+Write` but
    //     `Contents: Read` typically report at this level, and they CAN
    //     file issues — flagging them red would be a false positive
    //     (Codex P1 on PR #1509).
    //
    // Pure `pull` (read-only collaborator) or no permissions block at
    // all falls through to the error branch — we can't confirm write
    // capability without a mutating probe, so fail closed.
    const perms = json.permissions ?? {};
    const canWrite =
      perms.admin === true ||
      perms.maintain === true ||
      perms.push === true ||
      perms.triage === true;
    if (!canWrite) {
      return NextResponse.json(
        {
          status: "error",
          message: `Token can read ${repo} but lacks any issue-management role (admin/maintain/push/triage). Rotate to a token with Issues: Read+Write on the repo.`,
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

  return budgetResult(
    rateLimit,
    repo,
    `Filing with the owner's GITHUB_TOKEN fallback, which can write to ${repo}. Create the HashTracks Server App to replace it (docs/ops/system.md#identity).`,
    "warn",
  );
}

/** The final chip: `base` plus the remaining budget, downgraded to `warn` when the budget is low. */
function budgetResult(
  rateLimit: { remaining: number; limit: number; reset: number },
  repo: string,
  base: string,
  status: "ok" | "warn",
): NextResponse<FilingHealthResult> {
  const low = rateLimit.remaining < LOW_REMAINING_THRESHOLD;
  const budget = low
    ? `Only ${rateLimit.remaining}/${rateLimit.limit} core calls remain until reset.`
    : `${rateLimit.remaining}/${rateLimit.limit} core calls remain.`;
  return NextResponse.json(
    {
      status: low ? "warn" : status,
      message: `${base} ${budget}`,
      repo,
      remaining: rateLimit.remaining,
      resetAt: rateLimit.reset,
    },
    { status: 200 },
  );
}
