import { Prisma } from "@/generated/prisma/client";

/**
 * Type guard for Prisma `P2002` unique-constraint violations.
 *
 * Pass `requiredTargetColumns` to narrow to a specific composite constraint;
 * the helper requires ALL columns to be present in `err.meta.target` (AND
 * semantics, since a unique constraint targets a fixed tuple). Use the
 * no-arg form when you need to handle any P2002 — e.g. when several
 * single-column unique constraints could plausibly fire at the same call
 * site, since AND mode would never match a single-column violation.
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
  if (!Array.isArray(target)) return false;
  return requiredTargetColumns.every((col) => target.includes(col));
}
