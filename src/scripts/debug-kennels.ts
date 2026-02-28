import { prisma } from "@/lib/db";

async function main() {
    // Check kennel regions
    const kennels = await prisma.kennel.findMany({
        where: { shortName: { in: ['CityH3', 'NAH3', 'LH3'] } },
        select: { shortName: true, region: true }
    });
    console.log("Kennels:", JSON.stringify(kennels, null, 2));

    // Check recent NAH3 events for startTime and dateUtc
    const nah3Events = await prisma.event.findMany({
        where: { kennel: { shortName: 'NAH3' }, date: { gte: new Date('2026-02-01') } },
        select: { date: true, startTime: true, dateUtc: true, timezone: true },
        take: 3,
        orderBy: { date: 'asc' }
    });
    console.log("NAH3 events:", JSON.stringify(nah3Events, null, 2));

    // Check recent CityH3 events for startTime and dateUtc
    const cityH3Events = await prisma.event.findMany({
        where: { kennel: { shortName: 'CityH3' }, date: { gte: new Date('2026-02-20') } },
        select: { date: true, startTime: true, dateUtc: true, timezone: true },
        take: 2,
        orderBy: { date: 'asc' }
    });
    console.log("CityH3 events:", JSON.stringify(cityH3Events, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
