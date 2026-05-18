import { Prisma } from "@/generated/prisma/client";

/**
 * Type guard for Prisma `P2002` unique-constraint violations.
 *
 * Pass `requiredTargetColumns` to narrow to a specific composite constraint;
 * the helper requires every named column to be referenced by the error's
 * `meta.target` (since a unique constraint targets a fixed tuple). Use the
 * no-arg form when you need to handle any P2002 — e.g. when several
 * single-column unique constraints could plausibly fire at the same call
 * site, since the narrowed mode would never match a single-column violation.
 *
 * `meta.target` shape varies by driver (#1464 root cause):
 *   - Array of column names: `["sourceId", "fingerprint"]` — what unit tests
 *     and some Prisma engines emit.
 *   - String constraint name: `"RawEvent_sourceId_fingerprint_key"` — what
 *     the production Postgres engine actually emits at our call sites.
 * Both shapes must match, otherwise the race-window catch in
 * `src/pipeline/merge.ts:1707` silently re-throws and 9 RawEvent inserts
 * leak past per HashNYC scrape.
 *
 * Examples:
 *   isUniqueConstraintViolation(err)                                   // any P2002
 *   isUniqueConstraintViolation(err, ["sourceId", "fingerprint"])      // RawEvent race-window guard (#1286)
 */
export function isUniqueConstraintViolation(
  err: unknown,
  requiredTargetColumns?: string[],
): err is Prisma.PrismaClientKnownRequestError {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  if (!requiredTargetColumns || requiredTargetColumns.length === 0) return true;
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    if (target.length !== requiredTargetColumns.length) return false;
    return requiredTargetColumns.every((col) => target.includes(col));
  }
  if (typeof target === "string") {
    // Postgres-shaped constraint name (e.g. `RawEvent_sourceId_fingerprint_key`).
    // Tokenize on `_` and require every column to appear as an exact token —
    // raw substring matching would false-positive against superstring columns
    // (e.g. `fingerprintVersion` would shadow `fingerprint`) (Codex pass — #1464).
    const tokens = new Set(target.split("_"));
    return requiredTargetColumns.every((col) => tokens.has(col));
  }
  return false;
}
