import { isUniqueConstraintViolation } from "@/lib/prisma-errors";

/**
 * Friendly message when a Source write violates the `(name, type)` unique
 * constraint. The DB enforces seed upsert identity — see prisma/schema.prisma
 * Source and #817.
 */
export function nameTypeConflictError(err: unknown): string | null {
  if (isUniqueConstraintViolation(err, ["name", "type"])) {
    return "A source with that name and type already exists.";
  }
  return null;
}
