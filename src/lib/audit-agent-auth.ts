/**
 * Bearer-token auth for the unattended audit agent (`/api/audit/agent/*`).
 *
 * The deep-dive and hareline audits run as scheduled tasks on the operator's
 * own machine. They read public pages and deposit findings into the
 * first-party review queue (`AuditFindingDraft`); a server cron promotes
 * reviewed findings to GitHub issues. Before this, every write needed the
 * operator's Clerk admin session in a browser. When that session lapsed, or
 * the agent balked at an in-browser privileged write, the audits silently
 * stopped (the July 2026 outage).
 *
 * The agent instead presents `Authorization: Bearer <AUDIT_AGENT_TOKEN>`. Scope
 * is deliberately narrow:
 * - read: the next deep-dive kennel and prompt, the hareline prompt,
 *   suppressions, the findings still waiting in the review queue
 * - write: queue a finding, record a deep-dive completion, discard a queued
 *   finding with a reason (it's marked REJECTED, never deleted)
 * Nothing behind this token publishes externally or edits event data.
 *
 * Fails closed: if the env var is unset or shorter than {@link MIN_TOKEN_LENGTH},
 * every request is rejected.
 *
 * Each authenticated call is recorded as an `AGENT_CALL` `AutomationRun`, named by the
 * route the server matched (`agent:submit-finding`, `agent:hareline-prompt`, …). The ops
 * watchdog reads those rows to tell whether each scheduled task is still running; the agent
 * reports nothing about itself.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

/** Minimum accepted secret length (e.g. `openssl rand -hex 32` → 64 chars). */
export const MIN_TOKEN_LENGTH = 32;

/** Recorded as `AuditFindingDraft.submittedByUserId` for agent submissions. */
export const AUDIT_AGENT_SUBMITTER_ID = "audit-agent";

const BEARER_PREFIX = "Bearer ";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * True when the request carries the configured agent token. Both values are
 * hashed to a fixed length first, so `timingSafeEqual` never throws on a
 * length mismatch and the comparison leaks no length information.
 */
export function hasValidAgentToken(req: Request): boolean {
  const expected = process.env.AUDIT_AGENT_TOKEN?.trim();
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return false;

  const header = req.headers.get("authorization");
  if (!header?.startsWith(BEARER_PREFIX)) return false;
  const presented = header.slice(BEARER_PREFIX.length).trim();
  if (presented.length === 0) return false;

  return timingSafeEqual(digest(presented), digest(expected));
}

const AGENT_PATH_PREFIX = "/api/audit/agent/";
const CALL_NAME_MAX = 64;

/**
 * The recorded name of an agent call: `agent:` plus the route path under
 * `/api/audit/agent/`, e.g. `agent:drafts/discard`. Taken from the URL the server
 * routed, never from anything in the request body.
 */
export function agentCallName(req: Request): string {
  const path = new URL(req.url).pathname;
  const rest = path.startsWith(AGENT_PATH_PREFIX) ? path.slice(AGENT_PATH_PREFIX.length) : path;
  const name = rest
    .toLowerCase()
    .replace(/[^a-z0-9/-]/g, "")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, CALL_NAME_MAX);
  return `agent:${name || "unknown"}`;
}

/** Record an authenticated agent call. A failed write never blocks the call. */
async function recordAgentCall(req: Request): Promise<void> {
  const automation = agentCallName(req);
  try {
    await prisma.automationRun.create({
      data: { automation, kind: "AGENT_CALL", status: "SUCCESS", finishedAt: new Date() },
    });
  } catch (err) {
    console.error(`[audit-agent-auth] couldn't record ${automation}:`, err);
    Sentry.captureException(err, { tags: { automation } });
  }
}

/**
 * Null when the request carries the agent token (the call is then recorded);
 * otherwise a ready 401 response.
 */
export async function rejectUnlessAgent(req: Request): Promise<NextResponse | null> {
  if (!hasValidAgentToken(req)) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }
  await recordAgentCall(req);
  return null;
}
