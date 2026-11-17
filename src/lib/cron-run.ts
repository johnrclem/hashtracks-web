/**
 * `withCronRun()`: the wrapper every daily, weekly and QStash cron route runs in.
 *
 * It authenticates the request (QStash signature or Bearer CRON_SECRET), records an
 * `AutomationRun` row for the run (RUNNING, then SUCCESS or FAILED with the response's scalar
 * metrics), and sends any exception to Sentry before answering 500. The ops watchdog judges each
 * cron by these rows (`src/lib/automation-registry.ts`).
 *
 * Recording never blocks the job: if the run row can't be written, the job still runs and the
 * failure goes to Sentry. An unauthenticated request records nothing.
 */
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import type { AutomationRunKind, AutomationRunStatus } from "@/generated/prisma/client";
import type { CronJobId } from "@/lib/automation-registry";
import { verifyCronAuth, type CronAuthResult } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";

export type CronHandler = (request: Request, auth: CronAuthResult) => Promise<Response>;

const SUMMARY_MAX = 500;
const METRIC_STRING_MAX = 200;
const METRICS_MAX_KEYS = 30;

type Metric = string | number | boolean | null;

/** Scalar fields of a `{ data: {...} }` body: counts and flags, never arrays or nested objects. */
export function scalarMetrics(body: unknown): Record<string, Metric> | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const out: Record<string, Metric> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Object.keys(out).length >= METRICS_MAX_KEYS) break;
    if (typeof value === "number" || typeof value === "boolean" || value === null) out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, METRIC_STRING_MAX);
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}

/**
 * Write a run row (RUNNING unless `done` says otherwise). Returns its id, or null (reported to
 * Sentry) when the row can't be written: recording never blocks the work it records.
 */
export async function startAutomationRun(
  automation: string,
  kind: AutomationRunKind,
  done?: { status: AutomationRunStatus; finishedAt: Date },
): Promise<string | null> {
  try {
    const run = await prisma.automationRun.create({ data: { automation, kind, ...done }, select: { id: true } });
    return run.id;
  } catch (err) {
    console.error(`[cron-run] couldn't record the start of ${automation}:`, err);
    Sentry.captureException(err, { tags: { automation } });
    return null;
  }
}

async function finishAutomationRun(
  id: string | null,
  status: AutomationRunStatus,
  summary: string | null,
  metrics: Record<string, Metric> | null,
): Promise<void> {
  if (!id) return;
  try {
    await prisma.automationRun.update({
      where: { id },
      data: {
        status,
        finishedAt: new Date(),
        summary: summary?.slice(0, SUMMARY_MAX) ?? null,
        ...(metrics ? { metrics } : {}),
      },
    });
  } catch (err) {
    console.error(`[cron-run] couldn't record the end of run ${id}:`, err);
    Sentry.captureException(err);
  }
}

/**
 * Wrap a cron route. Export the result as both `POST` (QStash, manual) and `GET` (Vercel Cron):
 *
 *     export const POST = withCronRun("cron:audit", async () => NextResponse.json({ data }));
 *     export const GET = POST;
 *
 * A response with status 400 or above is recorded as FAILED, with its `error` as the summary.
 */
export function withCronRun(
  automation: CronJobId,
  handler: CronHandler,
  { kind = "CRON" }: { kind?: AutomationRunKind } = {},
): (request: Request) => Promise<Response> {
  return async (request) => {
    const auth = await verifyCronAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
    }

    const runId = await startAutomationRun(automation, kind);
    try {
      const res = await handler(request, auth);
      const body = await readBody(res);
      const error = (body as { error?: unknown } | null)?.error;
      const failed = res.status >= 400;
      const summary =
        typeof error === "string" ? error : failed || res.status !== 200 ? `HTTP ${res.status}` : null;
      await finishAutomationRun(runId, failed ? "FAILED" : "SUCCESS", summary, scalarMetrics(body));
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[${automation}] failed:`, err);
      Sentry.captureException(err, { tags: { automation } });
      await finishAutomationRun(runId, "FAILED", message, null);
      return NextResponse.json({ data: null, error: message }, { status: 500 });
    }
  };
}
