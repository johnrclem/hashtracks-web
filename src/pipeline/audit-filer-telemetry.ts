/**
 * Shared Sentry capture for audit-filer GitHub failures.
 *
 * Both filing paths — chrome (`src/app/api/audit/file-finding/route.ts`)
 * and cron (`src/pipeline/audit-issue.ts`) — call this when a GitHub
 * createIssue/postComment side effect fails. Tagged so Sentry-side rules
 * can alert on filer outages without burying us in unrelated chatter —
 * issue #1494 (expired GITHUB_TOKEN) silently broke filing for days
 * before anyone noticed.
 *
 * A degraded token can fan out: cron loops over groups, chrome agents
 * POST in bursts. The in-memory dedup window collapses identical
 * `(origin, stage, githubStatus)` failures within DEDUP_WINDOW_MS to a
 * single Sentry event, so a token outage produces one alert per failure
 * mode per origin instead of dozens per minute. The first failure of
 * each kind is always reported; Sentry's server-side issue grouping
 * handles cross-instance duplication.
 */
import * as Sentry from "@sentry/nextjs";

export type FilerOrigin = "chrome" | "cron";
export type FilerStage = "createIssue" | "postComment";

export interface FilerFailureDetail {
  githubStatus?: number;
  body?: string;
  error?: unknown;
  issueNumber?: number;
}

const DEDUP_WINDOW_MS = 60_000;
const recentlyReported = new Map<string, number>();

function shouldReport(origin: FilerOrigin, stage: FilerStage, status?: number): boolean {
  const key = `${origin}:${stage}:${status ?? "noerr"}`;
  const now = Date.now();
  const last = recentlyReported.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  recentlyReported.set(key, now);
  return true;
}

export function reportAuditFilerFailure(
  origin: FilerOrigin,
  stage: FilerStage,
  detail: FilerFailureDetail,
): void {
  if (!shouldReport(origin, stage, detail.githubStatus)) return;
  Sentry.captureMessage(`audit-filer/${origin} ${stage} failed`, {
    level: "error",
    tags: {
      audit_filer: origin,
      stage,
      github_status: detail.githubStatus?.toString() ?? "n/a",
    },
    extra: { ...detail },
  });
}
