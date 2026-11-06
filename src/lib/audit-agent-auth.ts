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
 * - read: the next deep-dive kennel and prompt, the hareline prompt, suppressions
 * - write: queue a finding, record a deep-dive completion
 * Nothing behind this token publishes externally or edits event data.
 *
 * Fails closed: if the env var is unset or shorter than {@link MIN_TOKEN_LENGTH},
 * every request is rejected.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

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

/** Null when the request carries the agent token; otherwise a ready 401 response. */
export function rejectUnlessAgent(req: Request): NextResponse | null {
  if (hasValidAgentToken(req)) return null;
  return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
}
