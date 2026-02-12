import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[()]/g, "")    // Remove parens
    .replace(/\s+/g, "-")    // Spaces to hyphens
    .replace(/-+/g, "-")     // Collapse multiple hyphens
    .replace(/^-|-$/g, "");  // Trim leading/trailing hyphens
}

// Dynamic import of the generated client to handle ESM
async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  // ── KENNEL DATA (PRD Section 8 + Appendix D.3) ──

  const kennels = [
    // NYC area (hashnyc.com source)
    { shortName: "NYCH3", fullName: "New York City Hash House Harriers", region: "New York City, NY" },
    { shortName: "BrH3", fullName: "Brooklyn Hash House Harriers", region: "New York City, NY" },
    { shortName: "NAH3", fullName: "New Amsterdam Hash House Harriers", region: "New York City, NY" },
    { shortName: "Knick", fullName: "Knickerbocker Hash House Harriers", region: "New York City, NY" },
    { shortName: "LIL", fullName: "Long Island Lunatics Hash House Harriers", region: "Long Island, NY" },
    { shortName: "QBK", fullName: "Queens Black Knights Hash House Harriers", region: "New York City, NY" },
    { shortName: "SI", fullName: "Staten Island Hash House Harriers", region: "New York City, NY" },
    { shortName: "Columbia", fullName: "Columbia Hash House Harriers", region: "New York City, NY" },
    { shortName: "Harriettes", fullName: "Harriettes Hash House Harriers", region: "New York City, NY" },
    { shortName: "GGFM", fullName: "GGFM Hash House Harriers", region: "New York City, NY" },
    { shortName: "NAWWH3", fullName: "North American Woman Woman Hash", region: "New York City, NY" },
    { shortName: "Drinking Practice (NYC)", fullName: "NYC Drinking Practice", region: "New York City, NY" },
    // Boston area (Google Calendar source)
    { shortName: "BoH3", fullName: "Boston Hash House Harriers", region: "Boston, MA" },
    { shortName: "BoBBH3", fullName: "Boston Ballbuster Hash House Harriers", region: "Boston, MA" },
    { shortName: "Beantown", fullName: "Beantown Hash House Harriers", region: "Boston, MA" },
    { shortName: "Bos Moon", fullName: "Boston Moon Hash", region: "Boston, MA" },
    { shortName: "Pink Taco", fullName: "Pink Taco Hash House Harriers", region: "Boston, MA" },
    // New Jersey
    { shortName: "Summit", fullName: "Summit Hash House Harriers", region: "North NJ" },
    { shortName: "SFM", fullName: "Summit Full Moon H3", region: "North NJ" },
    { shortName: "ASSSH3", fullName: "All Seasons Summit Shiggy H3", region: "North NJ" },
    { shortName: "Rumson", fullName: "Rumson Hash House Harriers", region: "New Jersey" },
    // Philadelphia
    { shortName: "BFM", fullName: "Ben Franklin Mob H3", region: "Philadelphia, PA" },
    // Chicago
    { shortName: "CH3", fullName: "Chicago Hash House Harriers", region: "Chicago, IL" },
  ];

  // ── ALIAS DATA (PRD Appendix D.3) ──

  const kennelAliases: Record<string, string[]> = {
    "NYCH3": ["NYC", "HashNYC", "NYC Hash", "NYCH3", "New York Hash"],
    "BoH3": ["Boston", "BH3", "BoH3", "Boston Hash"],
    "BrH3": ["Brooklyn", "BrH3", "Brooklyn Hash"],
    "BoBBH3": ["Ballbuster", "BoBBH3", "Boston Ballbuster", "Ballbuster Hash"],
    "NAWWH3": ["NAWW", "NAWWH3", "NAWW Hash"],
    "NAH3": ["New Amsterdam", "NAH3", "NASS", "New Amsterdam Hash"],
    "QBK": ["Queens Black Knights", "QBK", "QBK Hash", "Queens", "Queens Hash"],
    "LIL": ["Long Island Lunatics", "LIL", "Long Island", "LI Hash", "Lunatics"],
    "BFM": ["Ben Franklin Mob", "BFM", "BFM H3", "Philadelphia Hash"],
    "Bos Moon": ["Moon", "Moom", "Boston Moon", "Bos Moon", "Bos Moom"],
    "Pink Taco": ["Pink Taco", "Pink Taco Hash"],
    "Beantown": ["Beantown", "Beantown Hash"],
    "Knick": ["Knick", "Knickerbocker", "Knickerbocker Hash"],
    "Columbia": ["Columbia", "Columbia Hash"],
    "GGFM": ["GGFM", "GGFM Hash"],
    "Harriettes": ["Harriettes", "Harriettes Hash"],
    "SI": ["Staten Island", "SI", "SI Hash", "Staten Island Hash"],
    "Drinking Practice (NYC)": ["Drinking Practice", "NYC Drinking Practice", "NYC DP", "DP"],
    "Summit": ["Summit", "Summit H3", "Summit Hash", "SH3"],
    "SFM": ["SFM", "SFM H3", "Summit Full Moon", "Summit Full Moon H3"],
    "ASSSH3": ["ASSSH3", "ASSS H3", "All Seasons Summit Shiggy"],
  };

  // ── SOURCE DATA (PRD Section 8) ──

  const sources = [
    {
      name: "HashNYC Website",
      url: "https://hashnyc.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelShortNames: ["NYCH3", "BrH3", "NAH3", "Knick", "LIL", "QBK", "SI", "Columbia", "Harriettes", "GGFM", "NAWWH3"],
    },
    {
      name: "Boston Hash Calendar",
      url: "bostonhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelShortNames: ["BoH3", "BoBBH3", "Beantown", "Bos Moon", "Pink Taco"],
    },
    {
      name: "Summit H3 Spreadsheet",
      url: "https://docs.google.com/spreadsheets/d/1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZMdQtCBbYaMk",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 9999,
      config: {
        sheetId: "1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZMdQtCBbYaMk",
        columns: { runNumber: 0, specialRun: 1, date: 2, hares: 3, location: 4, title: 6, description: 9 },
        kennelTagRules: { default: "Summit", specialRunMap: { "ASSSH3": "ASSSH3" }, numericSpecialTag: "SFM" },
        startTimeRules: { byDayOfWeek: { "Mon": "19:00", "Sat": "15:00", "Fri": "19:00" }, default: "15:00" },
      },
      kennelShortNames: ["Summit", "SFM", "ASSSH3"],
    },
  ];

  console.log("Seeding kennels...");

  // Upsert all kennels
  const kennelRecords: Record<string, { id: string }> = {};
  for (const kennel of kennels) {
    const slug = toSlug(kennel.shortName);
    const record = await prisma.kennel.upsert({
      where: { shortName: kennel.shortName },
      update: {
        fullName: kennel.fullName,
        region: kennel.region,
        slug,
      },
      create: {
        shortName: kennel.shortName,
        slug,
        fullName: kennel.fullName,
        region: kennel.region,
        country: "USA",
      },
    });
    kennelRecords[kennel.shortName] = record;
  }
  console.log(`  ✓ ${kennels.length} kennels upserted`);

  // Upsert all aliases
  let aliasCount = 0;
  for (const [shortName, aliases] of Object.entries(kennelAliases)) {
    const kennel = kennelRecords[shortName];
    if (!kennel) {
      console.warn(`  ⚠ Kennel "${shortName}" not found, skipping aliases`);
      continue;
    }
    for (const alias of aliases) {
      await prisma.kennelAlias.upsert({
        where: {
          kennelId_alias: { kennelId: kennel.id, alias },
        },
        update: {},
        create: {
          kennelId: kennel.id,
          alias,
        },
      });
      aliasCount++;
    }
  }
  console.log(`  ✓ ${aliasCount} kennel aliases upserted`);

  // Upsert sources and source-kennel links
  console.log("Seeding sources...");
  for (const source of sources) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { kennelShortNames, ...sourceData } = source;

    let existingSource = await prisma.source.findFirst({
      where: { url: sourceData.url },
    });

    if (!existingSource) {
      existingSource = await prisma.source.create({
        // Cast needed because Prisma's InputJsonValue doesn't accept deep object literals
        data: sourceData as Parameters<typeof prisma.source.create>[0]["data"],
      });
      console.log(`  ✓ Created source: ${sourceData.name}`);
    } else {
      // Update config and scrapeDays if present
      await prisma.source.update({
        where: { id: existingSource.id },
        data: sourceData as Parameters<typeof prisma.source.update>[0]["data"],
      });
      console.log(`  ✓ Source already exists: ${sourceData.name}`);
    }

    // Create SourceKennel links
    for (const shortName of kennelShortNames) {
      const kennel = kennelRecords[shortName];
      if (!kennel) continue;

      await prisma.sourceKennel.upsert({
        where: {
          sourceId_kennelId: {
            sourceId: existingSource.id,
            kennelId: kennel.id,
          },
        },
        update: {},
        create: {
          sourceId: existingSource.id,
          kennelId: kennel.id,
        },
      });
    }
    console.log(`  ✓ Linked ${kennelShortNames.length} kennels to ${sourceData.name}`);
  }

  console.log("\nSeed complete!");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
