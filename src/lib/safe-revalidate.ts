/**
 * Safe wrappers for `revalidateTag` / `revalidatePath` — swallow the Next.js
 * "outside request scope" invariant (E263) so CLI scripts and workers don't
 * crash when calling request-scoped cache helpers. All other errors propagate.
 *
 * Use from code paths that run in both contexts (server action *and* CLI).
 */

import { revalidateTag, revalidatePath } from "next/cache";

/**
 * Next.js sets `__NEXT_ERROR_CODE = "E263"` on the synchronous Error thrown
 * when a request-scoped cache helper is called without a workAsyncStorage
 * store — i.e. from a CLI script, a non-Next worker, or any code path that
 * doesn't run through the Next.js server runtime.
 *
 * Source: node_modules/next/dist/server/web/spec-extension/revalidate.js
 *   throw new Error(`Invariant: static generation store missing in ${expression}`)
 *   where expression is `revalidateTag <tag>` or `revalidatePath <path>`.
 *
 * The message-shape fallback exists so we still recognize the case if a
 * future Next version drops `__NEXT_ERROR_CODE`. It deliberately requires
 * the full `in revalidateTag ` / `in revalidatePath ` suffix so a different
 * invariant that happens to share the prefix is NOT silently suppressed.
 */
const STATIC_STORE_MISSING_RE =
  /^Invariant: static generation store missing in revalidate(Tag|Path) /;

function isStaticStoreMissing(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as { __NEXT_ERROR_CODE?: string }).__NEXT_ERROR_CODE === "E263") return true;
  return STATIC_STORE_MISSING_RE.test(err.message);
}

/**
 * Calls `revalidateTag(tag, profile)`, swallowing the specific "outside
 * request scope" invariant. Use from code that may run in either context
 * (request-scoped server action *or* CLI/worker script). Trade-off: when
 * called from a CLI scrape, the in-process Hareline cache won't be busted —
 * it falls back to the underlying `unstable_cache` TTL. QStash/cron scrapes
 * still run inside a request, so production cache-busting is unchanged.
 *
 * All other errors propagate normally.
 */
export function safeRevalidateTag(
  tag: string,
  profile: Parameters<typeof revalidateTag>[1],
): void {
  try {
    revalidateTag(tag, profile);
  } catch (err) {
    if (isStaticStoreMissing(err)) {
      console.warn(`[safe-revalidate] revalidateTag(${tag}) skipped: no request scope`, err);
      return;
    }
    throw err;
  }
}

/**
 * Calls `revalidatePath(path, type)`, swallowing the same request-scope
 * invariant as {@link safeRevalidateTag}. All other errors propagate.
 */
export function safeRevalidatePath(
  path: string,
  type?: "layout" | "page",
): void {
  try {
    revalidatePath(path, type);
  } catch (err) {
    if (isStaticStoreMissing(err)) {
      console.warn(`[safe-revalidate] revalidatePath(${path}) skipped: no request scope`, err);
      return;
    }
    throw err;
  }
}
