/**
 * Deposit a chrome-stream audit finding into the first-party review queue,
 * OR record a per-kennel deep-dive completion. Both are NON-PUBLISHING,
 * reversible internal writes — this endpoint never creates a GitHub issue or
 * touches any external system. A trusted server cron
 * (`/api/cron/promote-audit-findings`) promotes queued findings into GitHub
 * issues later, with server credentials.
 *
 * This is the decouple that lets the daily Chrome audit run unattended: an
 * interactive Claude-in-Chrome agent refuses unattended *external* writes
 * (filing GitHub issues, admin-UI state changes) regardless of prompt wording,
 * but will deposit findings into an internal, reviewed-before-public queue.
 *
 * Auth: Origin check + Clerk admin session (same envelope as the nonce route,
 * via `authorizeAuditApi`). NO nonce — the nonce hardened an *external publish*
 * (a leaked cookie could make public GitHub issues appear under the org); a
 * non-publishing, reversible internal insert gated by Origin + admin +
 * `contentHash` idempotency doesn't need it, and dropping the mint round-trip
 * removes the two-step privileged pattern the agent balks at.
 */

import { NextResponse } from "next/server";

import { authorizeAuditApi } from "@/lib/audit-api-auth";
import { handleAuditSubmission } from "@/lib/admin/audit-submit";

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await authorizeAuditApi(req);
  if (!auth.ok) return auth.response;
  return handleAuditSubmission(auth.body, auth.admin.id);
}
