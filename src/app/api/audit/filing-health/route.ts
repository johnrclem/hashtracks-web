/**
 * Audit filing-health probe.
 *
 * GET-only, admin-gated. Hits GitHub's `/rate_limit` endpoint with the same
 * `GITHUB_TOKEN` the filing routes use, and reports back a small status
 * object the admin audit page renders as a chip. Exists so that an expired
 * or revoked token (the #1494 root cause) surfaces on the dashboard the
 * moment an admin loads `/admin/audit` instead of after a chrome agent
 * stalls on a 502 loop.
 *
 * `/rate_limit` is the canonical "does this token work and what's its
 * remaining budget" endpoint — it does not file an issue, post a
 * comment, or otherwise mutate state, so it's safe to call on every
 * dashboard render. GitHub docs: https://docs.github.com/en/rest/rate-limit
 */
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { getValidatedRepo } from "@/lib/github-repo";

const FETCH_TIMEOUT_MS = 5_000;

interface RateLimitResponse {
  resources?: {
    core?: {
      limit: number;
      remaining: number;
      reset: number;
    };
  };
}

export interface FilingHealthResult {
  /** `ok` — token validated against /rate_limit, has remaining budget.
   *  `warn` — token works but remaining budget is dangerously low.
   *  `error` — token missing, rejected, or GitHub unreachable. */
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

const LOW_REMAINING_THRESHOLD = 100;

/**
 * Surface the most common GitHub failure shapes with actionable hints
 * instead of a generic "GitHub returned N" line. The dashboard chip
 * shows the message verbatim in its tooltip, so a clear sentence here
 * saves the admin a log dive.
 */
function errorMessageFor(res: Response, body: string): string {
  if (res.status === 401) {
    return "GitHub rejected the token (401 Bad Credentials). Rotate GITHUB_TOKEN in Vercel prod env.";
  }
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = res.headers.get("x-ratelimit-reset");
    const resetHint = reset ? ` (resets at ${new Date(Number(reset) * 1000).toISOString()})` : "";
    return `Token works but is rate-limited${resetHint}. Wait for the reset window or rotate to a token with higher quota.`;
  }
  return `GitHub /rate_limit returned ${res.status}: ${body.slice(0, 200)}`;
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

  try {
    const url = new URL("/rate_limit", "https://api.github.com");
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const message = errorMessageFor(res, body);
      return NextResponse.json(
        { status: "error", message, repo },
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
    const status = core.remaining < LOW_REMAINING_THRESHOLD ? "warn" : "ok";
    const message =
      status === "warn"
        ? `Token works but only ${core.remaining}/${core.limit} core calls remain until reset.`
        : `Token works. ${core.remaining}/${core.limit} core calls remain.`;
    return NextResponse.json(
      {
        status,
        message,
        repo,
        remaining: core.remaining,
        resetAt: core.reset,
      },
      { status: 200 },
    );
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
}
