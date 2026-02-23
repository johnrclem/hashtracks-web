import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

const ROLE_RANK: Record<string, number> = { ADMIN: 3, MISMAN: 2, MEMBER: 1 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveUserKennelDuplicates(prisma: any, sourceKennelId: string, targetKennelId: string) {
  const userKennels = await prisma.userKennel.findMany({ where: { kennelId: sourceKennelId }, select: { id: true, role: true, userId: true } });
  for (const uk of userKennels) {
    const existing = await prisma.userKennel.findUnique({ where: { userId_kennelId: { userId: uk.userId, kennelId: targetKennelId } }, select: { id: true, role: true } });
    if (!existing) continue;
    if (ROLE_RANK[uk.role] > ROLE_RANK[existing.role]) {
      await prisma.userKennel.update({ where: { id: existing.id }, data: { role: uk.role } });
      console.log(`  Updated ${uk.userId} role to ${uk.role}`);
    }
    await prisma.userKennel.delete({ where: { id: uk.id } });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveHasherDuplicates(prisma: any, sourceKennelId: string, targetKennelId: string) {
  const hashers = await prisma.kennelHasher.findMany({ where: { kennelId: sourceKennelId }, select: { id: true, hashName: true, nerdName: true, email: true, phone: true, notes: true } });
  for (const hasher of hashers) {
    const existing = await prisma.kennelHasher.findFirst({ where: { kennelId: targetKennelId, hashName: { equals: hasher.hashName, mode: "insensitive" } } });
    if (!existing) continue;
    const sourceComplete = [hasher.email, hasher.phone, hasher.notes].filter(Boolean).length;
    const targetComplete = [existing.email, existing.phone, existing.notes].filter(Boolean).length;
    if (sourceComplete > targetComplete) {
      await prisma.kennelHasher.update({ where: { id: existing.id }, data: { nerdName: hasher.nerdName || existing.nerdName, email: hasher.email || existing.email, phone: hasher.phone || existing.phone, notes: hasher.notes || existing.notes } });
      console.log(`  Merged hasher: ${hasher.hashName}`);
    }
    await prisma.kennelHasher.delete({ where: { id: hasher.id } });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveSourceKennelDuplicates(prisma: any, sourceKennelId: string, targetKennelId: string) {
  const sourceLinks = await prisma.sourceKennel.findMany({ where: { kennelId: sourceKennelId }, select: { sourceId: true } });
  for (const link of sourceLinks) {
    const existingLink = await prisma.sourceKennel.findUnique({ where: { sourceId_kennelId: { sourceId: link.sourceId, kennelId: targetKennelId } } });
    if (!existingLink) continue;
    await prisma.sourceKennel.delete({ where: { sourceId_kennelId: { sourceId: link.sourceId, kennelId: sourceKennelId } } });
    console.log(`  Removed duplicate source link for source ${link.sourceId}`);
  }
}

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  // 1. Find both kennels
  const sourceKennel = await prisma.kennel.findFirst({
    where: { shortName: "NYC H3" },
    include: {
      _count: {
        select: {
          events: true,
          members: true,
          kennelHashers: true,
          mismanRequests: true,
          sources: true,
          aliases: true,
        },
      },
    },
  });

  const targetKennel = await prisma.kennel.findFirst({
    where: { shortName: "NYCH3" },
    select: { id: true, shortName: true, slug: true },
  });

  if (!sourceKennel) {
    console.log("✅ NYC H3 kennel not found (already merged?)");
    return;
  }

  if (!targetKennel) {
    throw new Error("NYCH3 kennel not found!");
  }

  // 2. Print preview
  console.log("=== Kennel Merge Preview ===");
  console.log(`Source: "${sourceKennel.shortName}" (${sourceKennel.id})`);
  console.log(`Target: "${targetKennel.shortName}" (${targetKennel.id})`);
  console.log("\nRecords to reassign:");
  console.log(`  Events: ${sourceKennel._count.events}`);
  console.log(`  Subscriptions: ${sourceKennel._count.members}`);
  console.log(`  Roster entries: ${sourceKennel._count.kennelHashers}`);
  console.log(`  Misman requests: ${sourceKennel._count.mismanRequests}`);
  console.log(`  Source links: ${sourceKennel._count.sources}`);
  console.log(`  Aliases: ${sourceKennel._count.aliases}`);

  // 3. Safety check for execute flag
  if (!process.argv.includes("--execute")) {
    console.log("\n⚠️  DRY RUN — no changes made. Use --execute to proceed.");
    return;
  }

  console.log("\n🔄 Executing merge...");

  // 4. Check for Event date conflicts
  const eventDates = await prisma.event.findMany({
    where: { kennelId: sourceKennel.id },
    select: { date: true },
  });

  const existingEventDates = await prisma.event.findMany({
    where: {
      kennelId: targetKennel.id,
      date: { in: eventDates.map((e) => e.date) },
    },
    select: { date: true },
  });

  if (existingEventDates.length > 0) {
    console.error("❌ Event date conflicts detected:");
    existingEventDates.forEach((e) =>
      console.error(`  - ${e.date.toISOString()}`),
    );
    console.error("Cannot proceed with merge. Manual resolution required.");
    return;
  }

  // 5. Handle UserKennel duplicates
  await resolveUserKennelDuplicates(prisma, sourceKennel.id, targetKennel.id);

  // 6. Handle KennelHasher duplicates (by hashName, case-insensitive)
  await resolveHasherDuplicates(prisma, sourceKennel.id, targetKennel.id);

  // 7. Handle SourceKennel duplicates (source linked to both kennels)
  await resolveSourceKennelDuplicates(prisma, sourceKennel.id, targetKennel.id);

  // 8. Execute transaction for remaining reassignments
  await prisma.$transaction([
    // Events (no conflicts checked above)
    prisma.event.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),

    // UserKennel (duplicates handled above)
    prisma.userKennel.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),

    // KennelHasher (duplicates handled above)
    prisma.kennelHasher.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),

    // MismanRequest
    prisma.mismanRequest.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),

    // SourceKennel (duplicates handled above)
    prisma.sourceKennel.updateMany({
      where: { kennelId: sourceKennel.id },
      data: { kennelId: targetKennel.id },
    }),

    // Delete aliases
    prisma.kennelAlias.deleteMany({
      where: { kennelId: sourceKennel.id },
    }),

    // Delete roster group links
    prisma.rosterGroupKennel.deleteMany({
      where: { kennelId: sourceKennel.id },
    }),

    // Delete the source kennel
    prisma.kennel.delete({
      where: { id: sourceKennel.id },
    }),
  ]);

  console.log("✅ Merge complete!");

  // 9. Print verification queries
  const finalEvents = await prisma.event.count({
    where: { kennelId: targetKennel.id },
  });
  console.log(`\nNYCH3 now has ${finalEvents} events`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
