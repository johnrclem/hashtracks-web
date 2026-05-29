import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Shared CLI scaffolding for the one-shot `cleanup-*.ts` scripts: the
 * `--apply` dry-run gate and the kennel lookup + targeting log that every
 * script opens with. Extracted so the boilerplate lives once instead of being
 * copy-pasted per script (SonarCloud CPD).
 */

/** Parse the `--apply` flag and log the resulting mode. */
export function parseApplyMode(): boolean {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY (will hard-delete)" : "DRY-RUN"}`);
  return apply;
}

/**
 * Resolve the target kennel by code, or log + return null when it's absent so
 * the caller can bail early.
 */
export async function resolveCleanupKennel(
  prisma: PrismaClient,
  kennelCode: string,
): Promise<{ id: string; shortName: string } | null> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    console.log(`Kennel "${kennelCode}" not found — nothing to do.`);
    return null;
  }
  console.log(`Targeting kennel: ${kennel.shortName} (${kennel.id})`);
  return kennel;
}
