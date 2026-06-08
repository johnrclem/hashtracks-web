import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./db-pool";

/**
 * Shared scaffolding for one-shot maintenance scripts. Parses the `--apply`
 * flag, logs the dry-run/apply banner, opens a script DB pool, runs `fn`, and
 * always closes the pool (and sets a non-zero exit code on error). Keeps the
 * per-script body focused on the actual query/filter/update logic so each
 * script stays small and they don't duplicate boilerplate.
 *
 *   runOneShot(async ({ prisma, apply }) => { ... });
 */
export async function runOneShot(
  fn: (ctx: { prisma: PrismaClient; apply: boolean }) => Promise<void>,
): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "✏️  APPLYING changes" : "🔍 DRY RUN — no changes will be made");
  const pool = createScriptPool();
  try {
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    await fn({ prisma, apply });
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

/**
 * Look up a kennel id by kennelCode. Logs and returns null when absent so the
 * caller can bail with `if (!id) return;`.
 */
export async function findKennelId(
  prisma: PrismaClient,
  kennelCode: string,
): Promise<string | null> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode },
    select: { id: true },
  });
  if (!kennel) {
    console.log(`Kennel "${kennelCode}" not found — nothing to do.`);
    return null;
  }
  return kennel.id;
}
