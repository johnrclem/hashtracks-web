import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Post-delete safety check shared by the one-shot `cleanup-*.ts` scripts that
 * hard-delete leaked Events via {@link deleteLeakedEvent}: confirm every
 * deleted id is gone and left no dangling RawEvent.
 *
 * Fail loud — a destructive run that left orphans behind must surface a
 * non-zero exit code so an operator/pipeline doesn't read success.
 */
export async function verifyNoOrphans(prisma: PrismaClient, deletedIds: string[]): Promise<void> {
  if (deletedIds.length === 0) return;
  const stillPresent = await prisma.event.count({ where: { id: { in: deletedIds } } });
  const danglingRaw = await prisma.rawEvent.count({ where: { eventId: { in: deletedIds } } });
  if (stillPresent === 0 && danglingRaw === 0) {
    console.log(`Verified: all ${deletedIds.length} Event(s) gone, no dangling RawEvents.`);
    return;
  }
  console.warn(
    `WARNING: ${stillPresent} Event(s) still present, ${danglingRaw} dangling RawEvent(s) remain.`,
  );
  process.exitCode = 1;
}
