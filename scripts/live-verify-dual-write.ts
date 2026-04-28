/**
 * One-shot manual verification (#1023 step 2): exercises createEventWithKennel
 * against hashtracks_dev to confirm the partial unique index enforces the
 * single-primary invariant and that the helper writes both rows atomically.
 *
 * Run: `npx tsx scripts/live-verify-dual-write.ts`
 *
 * NOT a vitest fixture — this is an interactive smoke test for the dev DB.
 * Idempotent (cleans up rows it creates).
 */
import "dotenv/config";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createEventWithKennel } from "@/lib/event-write";

async function main() {
  const kennel = await prisma.kennel.findFirst({ select: { id: true, shortName: true } });
  if (!kennel) throw new Error("No kennels in hashtracks_dev — bail");

  const baseDate = new Date(Date.UTC(2099, 0, 1, 12));

  console.log(`Using kennel: ${kennel.shortName} (${kennel.id})`);

  const event = await prisma.$transaction((tx) =>
    createEventWithKennel(tx, {
      kennelId: kennel.id,
      date: baseDate,
      trustLevel: 5,
      title: "DUAL_WRITE_PROBE",
    }),
  );
  console.log(`Created Event ${event.id} via dual-write`);

  const ek = await prisma.eventKennel.findUnique({
    where: { eventId_kennelId: { eventId: event.id, kennelId: kennel.id } },
  });
  if (!ek || !ek.isPrimary) {
    throw new Error(`Primary EventKennel row missing or not primary for ${event.id}`);
  }
  console.log("Primary EventKennel row written and isPrimary=true ✓");

  // Both checks below must surface as Prisma P2002 (Unique constraint failed).
  // Prefer typed `meta.target` when populated; fall back to message regex when
  // the adapter-pg path leaves target empty (Prisma 7 quirk on composite PKs).
  const expectP2002 = (err: unknown, includesField: "eventId-only" | "eventId+kennelId", label: string) => {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
      throw err;
    }
    const target = (err.meta?.target ?? []) as string[];
    if (target.length > 0) {
      const hasEventId = target.includes("eventId");
      const hasKennelId = target.includes("kennelId");
      const ok = includesField === "eventId-only" ? (hasEventId && !hasKennelId) : (hasEventId && hasKennelId);
      if (!ok) {
        throw new Error(`${label}: P2002 target ${JSON.stringify(target)} mismatched expected "${includesField}"`);
      }
      return;
    }
    // Adapter left target empty — fall back to message inspection.
    const msg = err.message;
    const hasEventIdMsg = /\beventId\b/.test(msg);
    const hasKennelIdMsg = /\bkennelId\b/.test(msg);
    const ok = includesField === "eventId-only" ? (hasEventIdMsg && !hasKennelIdMsg) : (hasEventIdMsg && hasKennelIdMsg);
    if (!ok) {
      throw new Error(`${label}: P2002 fired but message did not match "${includesField}": ${msg}`);
    }
  };

  try {
    await prisma.eventKennel.create({
      data: { eventId: event.id, kennelId: kennel.id, isPrimary: true },
    });
    throw new Error("PK violation NOT raised — composite PK regression");
  } catch (err) {
    expectP2002(err, "eventId+kennelId", "composite PK check");
    console.log("Composite PK rejects duplicate (eventId, kennelId) ✓");
  }

  const otherKennel = await prisma.kennel.findFirst({
    where: { id: { not: kennel.id } },
    select: { id: true, shortName: true },
  });
  if (otherKennel) {
    try {
      await prisma.eventKennel.create({
        data: { eventId: event.id, kennelId: otherKennel.id, isPrimary: true },
      });
      throw new Error("Partial unique index NOT raised — single-primary regression");
    } catch (err) {
      expectP2002(err, "eventId-only", "partial unique index check");
      console.log("Partial unique index rejects second isPrimary=true row ✓");
    }
  }

  await prisma.eventKennel.deleteMany({ where: { eventId: event.id } });
  await prisma.event.delete({ where: { id: event.id } });
  console.log("Cleanup OK");

  console.log("\nAll dual-write invariants hold ✓");
}

main()
  .catch((err) => {
    console.error("\nDual-write verification failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
