import { Prisma } from "@/generated/prisma/client";

/**
 * Friendly message when a Source write violates the `(name, type)` unique
 * constraint. The DB enforces seed upsert identity — see prisma/schema.prisma
 * Source and #817.
 */
export function nameTypeConflictError(err: unknown): string | null {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes("name") &&
    (err.meta.target as string[]).includes("type")
  ) {
    return "A source with that name and type already exists.";
  }
  return null;
}
