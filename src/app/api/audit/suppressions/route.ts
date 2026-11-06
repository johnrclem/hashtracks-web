import {
  SUPPRESSIONS_RESPONSE_HEADERS,
  renderSuppressionsMarkdown,
} from "@/lib/admin/audit-suppressions-md";

/**
 * Markdown endpoint listing active audit suppressions, so audit agents pick up
 * accepted false positives without a manual doc update. Sits behind the Clerk
 * session like the rest of `/api/audit/*`; the scheduled agent reads the same
 * list from `/api/audit/agent/suppressions` with its token.
 */
export async function GET() {
  return new Response(await renderSuppressionsMarkdown(), {
    headers: SUPPRESSIONS_RESPONSE_HEADERS,
  });
}
