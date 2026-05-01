/**
 * Shared auth + body-parse prelude for the chrome-stream audit
 * filing endpoints (`mint-filing-nonce` and `file-finding`). Both
 * routes need the same three checks in the same order — Origin →
 * Clerk admin session → JSON-parseable body — so factoring it out
 * keeps the security envelope consistent and avoids drift between
 * the two handlers.
 *
 * The helper returns a discriminated union: callers do
 * `if (!result.ok) return result.response;` and then destructure
 * `result.admin` and `result.body`. The unparsed-body type is
 * `unknown` so the caller still has to run its own shape guard.
 */
import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/auth";
import { isValidOrigin } from "@/lib/audit-nonce";

interface AdminUser {
  id: string;
}

export type AuditApiAuthResult =
  | { ok: true; admin: AdminUser; body: unknown }
  | { ok: false; response: NextResponse };

/**
 * Validate Origin, require an admin session, and parse the JSON
 * body. Returns the parsed body and admin user on success, or a
 * pre-built error response (403 / 401 / 400) on failure.
 */
export async function authorizeAuditApi(
  req: Request,
): Promise<AuditApiAuthResult> {
  if (!isValidOrigin(req.headers.get("origin"))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid origin" }, { status: 403 }),
    };
  }

  const admin = await getAdminUser();
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }

  return { ok: true, admin, body };
}
