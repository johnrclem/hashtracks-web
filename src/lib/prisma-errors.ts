import { Prisma } from "@/generated/prisma/client";

/**
 * Type guard for Prisma `P2002` unique-constraint violations.
 *
 * Pass `requiredTargetColumns` to narrow to a specific composite constraint;
 * the helper requires the exact tuple — same length AND every column
 * present (since a unique constraint targets a fixed tuple, the column-
 * set match is a set-equality, not a subset). Use the no-arg form when
 * you need to handle any P2002 — e.g. when several single-column unique
 * constraints could plausibly fire at the same call site, since the
 * narrowed mode would never match a single-column violation.
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
  if (!Array.isArray(target) || target.length !== requiredTargetColumns.length) return false;
  return requiredTargetColumns.every((col) => target.includes(col));
}
