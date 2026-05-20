/**
 * Bounded reader for upstream error response bodies.
 *
 * GitHub error responses are normally tiny JSON `{message, documentation_url}`
 * blobs, but a proxy or intermediary can return a multi-megabyte HTML error
 * page that reflects request content (#1468). We stream the body and stop
 * reading once we have enough bytes — this keeps the defensive bound on the
 * read itself rather than post-decode slicing, so a misbehaving upstream
 * cannot pressure memory or latency even before truncation. Used by every
 * audit-filer / health-probe / auto-issue site that logs an upstream error
 * body to console or Sentry — keeping the cap consistent here prevents the
 * next defensive review (or runtime OOM) from pointing at one site that
 * forgot the bound.
 */

const DEFAULT_LIMIT = 500;

export async function safeErrorBody(
  res: Response,
  limit: number = DEFAULT_LIMIT,
): Promise<string> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return "<empty body>";
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let collected = "";
    while (collected.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) collected += decoder.decode(value, { stream: true });
    }
    void reader.cancel();
    return collected.length > limit
      ? `${collected.slice(0, limit)}…(truncated)`
      : collected;
  } catch {
    return "<unreadable body>";
  }
}
