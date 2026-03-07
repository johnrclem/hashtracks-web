import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { REGION_SEED_DATA, regionSlug } from "../src/lib/region";

function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replace(/[()]/g, "")    // Remove parens
    .replace(/\s+/g, "-")    // Spaces to hyphens
    .replace(/-+/g, "-")     // Collapse multiple hyphens
    .replace(/^-|-$/g, "");  // Trim leading/trailing hyphens
}

const PROFILE_FIELDS = new Set([
  "website", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency",
  "scheduleNotes", "hashCash", "facebookUrl", "instagramHandle",
  "twitterHandle", "discordUrl", "contactEmail", "foundedYear", "description",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureRegionRecords(prisma: any) {
  console.log("Seeding regions...");
  const regionMap = new Map<string, string>(); // name → id
  let created = 0;
  for (const r of REGION_SEED_DATA) {
    const slug = regionSlug(r.name);
    let record = await prisma.region.findUnique({ where: { name: r.name } });
    if (!record) {
      record = await prisma.region.create({
        data: {
          name: r.name, slug,
          country: r.country, level: r.level ?? "METRO",
          timezone: r.timezone, abbrev: r.abbrev,
          colorClasses: r.colorClasses, pinColor: r.pinColor,
          centroidLat: r.centroidLat, centroidLng: r.centroidLng,
        },
      });
      created++;
      console.log(`  + Created region: ${r.name}`);
    }
    regionMap.set(r.name, record.id);
    if (r.aliases) {
      for (const alias of r.aliases) {
        regionMap.set(alias, record.id);
      }
    }
  }
  console.log(`  ✓ ${REGION_SEED_DATA.length} regions checked (${created} created)`);

  // Set parent relationships: all non-COUNTRY regions get their country as parent
  const countryMap = new Map<string, string>(); // country code → region id
  for (const r of REGION_SEED_DATA) {
    if (r.level === "COUNTRY") {
      countryMap.set(r.country, regionMap.get(r.name)!);
    }
  }

  let parentLinked = 0;
  for (const r of REGION_SEED_DATA) {
    if (r.level === "COUNTRY") continue;
    const parentId = countryMap.get(r.country);
    if (!parentId) continue;
    const regionId = regionMap.get(r.name);
    if (!regionId) continue;
    await prisma.region.update({
      where: { id: regionId },
      data: { parentId },
    });
    parentLinked++;
  }
  if (parentLinked > 0) {
    console.log(`  ✓ ${parentLinked} regions linked to parent countries`);
  }

  return regionMap;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureKennelRecords(prisma: any, kennels: any[], toSlugFn: (s: string) => string, regionMap: Map<string, string>) {
  console.log("Seeding kennels...");
  const kennelRecords = new Map<string, { id: string }>();
  let created = 0;
  for (const kennel of kennels) {
    try {
      let record = await prisma.kennel.findUnique({ where: { kennelCode: kennel.kennelCode } });
      if (!record) {
        const profileFields = Object.fromEntries(
          Object.entries(kennel).filter(([k, v]) => PROFILE_FIELDS.has(k) && v !== undefined)
        );
        const regionId = regionMap.get(kennel.region) ?? null;
        if (!regionId) {
          console.warn(`  ⚠ No region found for "${kennel.region}" (kennel: ${kennel.shortName}), skipping`);
          continue;
        }
        // Try slug candidates until one succeeds: shortName → kennelCode → kennelCode-N
        const slugCandidates = [toSlugFn(kennel.shortName), toSlugFn(kennel.kennelCode)];
        for (let n = 2; slugCandidates.length < 10; n++) slugCandidates.push(`${toSlugFn(kennel.kennelCode)}-${n}`);
        for (const slug of slugCandidates) {
          try {
            record = await prisma.kennel.create({
              data: { kennelCode: kennel.kennelCode, shortName: kennel.shortName, slug, fullName: kennel.fullName, region: kennel.region, regionId, country: kennel.country ?? "USA", ...profileFields },
            });
            if (slug !== slugCandidates[0]) {
              console.log(`  ℹ Slug "${slugCandidates[0]}" taken, using "${slug}" for ${kennel.shortName}`);
            }
            break;
          } catch (e: any) {
            if (e.code !== "P2002") throw e;
            // Log which slug collided and which constraint
            const field = e.meta?.target ?? e.meta?.modelName ?? "unknown field";
            console.warn(`  ⚠ Slug "${slug}" collided (${field}), trying next candidate...`);
          }
        }
        if (!record) {
          console.error(`  ✗ FAILED to create kennel ${kennel.shortName} (${kennel.kennelCode}) — all slug candidates exhausted`);
          continue;
        }
        created++;
        console.log(`  + Created kennel: ${kennel.shortName} (slug: ${record.slug})`);
      }
      kennelRecords.set(kennel.kennelCode, record);
    } catch (e: any) {
      console.error(`  ✗ FAILED to seed kennel ${kennel.shortName} (${kennel.kennelCode}): ${e.message}`);
      if (e.meta) console.error(`    Prisma meta:`, JSON.stringify(e.meta));
      throw e;
    }
  }
  console.log(`  ✓ ${kennels.length} kennels checked (${created} created)`);
  return kennelRecords;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureAliases(prisma: any, kennelAliases: Record<string, string[]>, kennelRecords: Map<string, { id: string }>) {
  let aliasCount = 0;
  for (const [code, aliases] of Object.entries(kennelAliases)) {
    if (!kennelRecords.has(code)) { console.warn(`  ⚠ Kennel code "${code}" not found, skipping aliases`); continue; }
    const kennel = kennelRecords.get(code)!;
    for (const alias of aliases) {
      await prisma.kennelAlias.upsert({
        where: { kennelId_alias: { kennelId: kennel.id, alias } },
        update: {},
        create: { kennelId: kennel.id, alias },
      });
      aliasCount++;
    }
  }
  console.log(`  ✓ ${aliasCount} kennel aliases upserted`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureSources(prisma: any, sources: any[], kennelRecords: Map<string, { id: string }>) {
  console.log("Seeding sources...");
  let created = 0;
  for (const source of sources) {
    const { kennelCodes, ...sourceData } = source;

    // Check if source already exists by URL or name+type
    const existingSource = await prisma.source.findFirst({
      where: {
        OR: [
          { url: sourceData.url },
          { name: sourceData.name, type: sourceData.type },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    let activeSource;
    try {
      if (!existingSource) {
        activeSource = await prisma.source.create({ data: sourceData });
        created++;
        console.log(`  + Created source: ${sourceData.name}`);
      } else {
        activeSource = existingSource;
      }

      await linkKennelsToSource(prisma, activeSource.id, kennelCodes, kennelRecords);
    } catch (e: any) {
      console.error(`  ✗ FAILED to seed source "${sourceData.name}" (${sourceData.type}): ${e.message}`);
      if (e.meta) console.error(`    Prisma meta:`, JSON.stringify(e.meta));
      throw e;
    }
  }
  console.log(`  ✓ ${sources.length} sources checked (${created} created)`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function linkKennelsToSource(prisma: any, sourceId: string, kennelCodes: string[], kennelRecords: Map<string, { id: string }>) {
  for (const code of kennelCodes) {
    const kennel = kennelRecords.get(code);
    if (!kennel) { console.warn(`  ⚠ Kennel code "${code}" not found, skipping source link`); continue; }
    await prisma.sourceKennel.upsert({
      where: { sourceId_kennelId: { sourceId, kennelId: kennel.id } },
      update: {},
      create: { sourceId, kennelId: kennel.id },
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertRosterGroups(prisma: any, rosterGroups: { name: string; kennelCodes: string[] }[], kennelRecords: Map<string, { id: string }>) {
  console.log("Seeding roster groups...");
  for (const group of rosterGroups) {
    let rosterGroup = await prisma.rosterGroup.findFirst({ where: { name: group.name } });
    if (!rosterGroup) {
      rosterGroup = await prisma.rosterGroup.create({ data: { name: group.name } });
      console.log(`  ✓ Created roster group: ${group.name}`);
    } else {
      console.log(`  ✓ Roster group already exists: ${group.name}`);
    }
    await linkKennelsToRosterGroup(prisma, rosterGroup.id, group.kennelCodes, kennelRecords);
    console.log(`  ✓ Linked ${group.kennelCodes.length} kennels to ${group.name}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function linkKennelsToRosterGroup(prisma: any, groupId: string, kennelCodes: string[], kennelRecords: Map<string, { id: string }>) {
  for (const code of kennelCodes) {
    const kennel = kennelRecords.get(code);
    if (!kennel) { console.warn(`  ⚠ Kennel code "${code}" not found, skipping roster group link`); continue; }
    await prisma.rosterGroupKennel.upsert({
      where: { kennelId: kennel.id },
      update: { groupId },
      create: { groupId, kennelId: kennel.id },
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureAllKennelsHaveGroup(prisma: any, kennelRecords: Map<string, { id: string }>, codeToShortName: Map<string, string>) {
  console.log("Ensuring all kennels have a roster group...");
  for (const [code, record] of kennelRecords) {
    const existing = await prisma.rosterGroupKennel.findUnique({ where: { kennelId: record.id } });
    if (existing) continue;
    const groupName = codeToShortName.get(code) ?? code;
    let group = await prisma.rosterGroup.findFirst({ where: { name: groupName } });
    if (!group) {
      group = await prisma.rosterGroup.create({ data: { name: groupName } });
    }
    await prisma.rosterGroupKennel.upsert({
      where: { kennelId: record.id },
      update: { groupId: group.id },
      create: { groupId: group.id, kennelId: record.id },
    });
    console.log(`  + Created standalone group for ${groupName}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedKennels(prisma: any, kennels: any[], kennelAliases: Record<string, string[]>, sources: any[], toSlugFn: (s: string) => string) {
  // Pre-flight: detect duplicate kennelCodes in seed data
  const codeCounts = new Map<string, string[]>();
  for (const k of kennels) {
    const existing = codeCounts.get(k.kennelCode) ?? [];
    existing.push(k.shortName);
    codeCounts.set(k.kennelCode, existing);
  }
  const dupCodes = [...codeCounts.entries()].filter(([, names]) => names.length > 1);
  if (dupCodes.length > 0) {
    console.error("✗ Duplicate kennelCodes in seed data:");
    for (const [code, names] of dupCodes) console.error(`  - "${code}" used by: ${names.join(", ")}`);
    throw new Error("Seed data contains duplicate kennelCodes — fix before seeding");
  }

  // Pre-flight: warn about duplicate shortNames (will cause slug fallbacks)
  const nameCounts = new Map<string, string[]>();
  for (const k of kennels) {
    const slug = toSlugFn(k.shortName);
    const existing = nameCounts.get(slug) ?? [];
    existing.push(`${k.shortName} (${k.kennelCode})`);
    nameCounts.set(slug, existing);
  }
  const dupSlugs = [...nameCounts.entries()].filter(([, names]) => names.length > 1);
  if (dupSlugs.length > 0) {
    console.warn("⚠ Seed data has kennels that will produce the same slug (fallbacks will be used):");
    for (const [slug, names] of dupSlugs) console.warn(`  - slug "${slug}": ${names.join(", ")}`);
  }

  const regionMap = await ensureRegionRecords(prisma);
  const kennelRecords = await ensureKennelRecords(prisma, kennels, toSlugFn, regionMap);
  await ensureAliases(prisma, kennelAliases, kennelRecords);
  await ensureSources(prisma, sources, kennelRecords);

  const rosterGroups = [
    { name: "NYC Metro", kennelCodes: ["nych3", "brh3", "nah3", "knick", "qbk", "si", "columbia", "harriettes-nyc", "ggfm", "nawwh3"] },
    { name: "Philly Area", kennelCodes: ["bfm", "philly-h3"] },
  ];
  await upsertRosterGroups(prisma, rosterGroups, kennelRecords);

  const codeToShortName = new Map<string, string>();
  for (const k of kennels) codeToShortName.set(k.kennelCode, k.shortName);
  await ensureAllKennelsHaveGroup(prisma, kennelRecords, codeToShortName);

  // Post-seed validation: check for duplicate fullNames
  const dupes: Array<{ fullName: string; cnt: bigint }> = await prisma.$queryRaw`
    SELECT "fullName", COUNT(*) as cnt FROM "Kennel" GROUP BY "fullName" HAVING COUNT(*) > 1
  `;
  if (dupes.length > 0) {
    console.warn("\n⚠ Duplicate fullNames found:");
    for (const d of dupes) console.warn(`  - "${d.fullName}" (${d.cnt} records)`);
  }
}

// Dynamic import of the generated client to handle ESM
async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  // ── KENNEL DATA (PRD Section 8 + Appendix D.3) ──

  const kennels: Array<{
    kennelCode: string;
    shortName: string;
    fullName: string;
    region: string;
    country?: string;
    website?: string;
    scheduleDayOfWeek?: string;
    scheduleTime?: string;
    scheduleFrequency?: string;
    scheduleNotes?: string;
    hashCash?: string;
    facebookUrl?: string;
    instagramHandle?: string;
    twitterHandle?: string;
    discordUrl?: string;
    contactEmail?: string;
    foundedYear?: number;
    description?: string;
  }> = [
    // NYC area (hashnyc.com source)
    {
      kennelCode: "nych3", shortName: "NYCH3", fullName: "New York City Hash House Harriers", region: "New York City, NY",
      website: "https://hashnyc.com",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$8",
      facebookUrl: "https://www.facebook.com/groups/nychash",
    },
    {
      kennelCode: "brh3", shortName: "BrH3", fullName: "Brooklyn Hash House Harriers", region: "New York City, NY",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
    },
    {
      kennelCode: "nah3", shortName: "NAH3", fullName: "New Amsterdam Hash House Harriers", region: "New York City, NY",
      scheduleDayOfWeek: "Saturday", scheduleTime: "3:00 PM", scheduleFrequency: "Biweekly",
    },
    { kennelCode: "knick", shortName: "Knick", fullName: "Knickerbocker Hash House Harriers", region: "New York City, NY" },
    {
      kennelCode: "lil", shortName: "LIL", fullName: "Long Island Lunatics Hash House Harriers", region: "Long Island, NY",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Weekly",
    },
    { kennelCode: "qbk", shortName: "QBK", fullName: "Queens Black Knights Hash House Harriers", region: "New York City, NY" },
    { kennelCode: "si", shortName: "SI", fullName: "Staten Island Hash House Harriers", region: "New York City, NY" },
    { kennelCode: "columbia", shortName: "Columbia", fullName: "Columbia Hash House Harriers", region: "New York City, NY" },
    { kennelCode: "harriettes-nyc", shortName: "Harriettes", fullName: "Harriettes Hash House Harriers", region: "New York City, NY" },
    {
      kennelCode: "ggfm", shortName: "GGFM", fullName: "GGFM Hash House Harriers", region: "New York City, NY",
      scheduleFrequency: "Full Moon",
    },
    { kennelCode: "nawwh3", shortName: "NAWWH3", fullName: "North American Woman Woman Hash", region: "New York City, NY" },
    { kennelCode: "drinking-practice-nyc", shortName: "Drinking Practice (NYC)", fullName: "NYC Drinking Practice", region: "New York City, NY" },
    // Boston area (Google Calendar source)
    {
      kennelCode: "boh3", shortName: "BoH3", fullName: "Boston Hash House Harriers", region: "Boston, MA",
      scheduleDayOfWeek: "Sunday", scheduleTime: "2:30 PM", scheduleFrequency: "Weekly",
    },
    {
      kennelCode: "bobbh3", shortName: "BoBBH3", fullName: "Boston Ballbuster Hardcore Hash House Harriers", region: "Boston, MA",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly",
    },
    { kennelCode: "beantown", shortName: "Beantown", fullName: "Beantown City Hash House Harriers", region: "Boston, MA" },
    {
      kennelCode: "bos-moon", shortName: "Bos Moon", fullName: "Boston Moon Hash House Harriers", region: "Boston, MA",
      scheduleFrequency: "Full Moon",
    },
    { kennelCode: "pink-taco", shortName: "Pink Taco", fullName: "Pink Taco Hash House Harriers", region: "Boston, MA" },
    // New Jersey
    {
      kennelCode: "summit", shortName: "Summit", fullName: "Summit Hash House Harriers", region: "North NJ",
      scheduleDayOfWeek: "Monday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Summer: Mondays 7pm. Winter: Saturdays 3pm.",
    },
    {
      kennelCode: "sfm", shortName: "SFM", fullName: "Summit Full Moon H3", region: "North NJ",
      scheduleFrequency: "Full Moon",
    },
    { kennelCode: "asssh3", shortName: "ASSSH3", fullName: "All Seasons Summit Shiggy H3", region: "North NJ" },
    {
      kennelCode: "rumson", shortName: "Rumson", fullName: "Rumson Hash House Harriers", region: "New Jersey",
      scheduleDayOfWeek: "Saturday", scheduleTime: "10:17 AM", scheduleFrequency: "Weekly",
      facebookUrl: "https://www.facebook.com/p/Rumson-H3-100063637060523/",
      description: "Weekly Saturday morning trail in the Rumson area. Check Facebook for start location.",
    },
    // Philadelphia
    {
      kennelCode: "bfm", shortName: "BFM", fullName: "Ben Franklin Mob H3", region: "Philadelphia, PA",
      website: "https://benfranklinmob.com",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
    },
    {
      kennelCode: "philly-h3", shortName: "Philly H3", fullName: "Philly Hash House Harriers", region: "Philadelphia, PA",
      website: "https://hashphilly.com/nexthash/",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
    },
    // Chicago area (Chicagoland Google Calendar aggregator)
    {
      kennelCode: "ch3", shortName: "CH3", fullName: "Chicago Hash House Harriers", region: "Chicago, IL",
      website: "https://chicagohash.org", foundedYear: 1978,
      facebookUrl: "https://www.facebook.com/groups/10638781851/",
      scheduleNotes: "Summer: Mondays 7pm. Winter: Sundays 2pm.",
      description: "Chicago's original kennel (est. 1978). Weekly Sunday afternoon runs (winter) / Monday evening runs (summer).",
    },
    {
      kennelCode: "th3", shortName: "TH3", fullName: "Thirstday Hash House Harriers", region: "Chicago, IL",
      website: "https://chicagoth3.com", foundedYear: 2003,
      scheduleDayOfWeek: "Thursday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Thursday evening hash. 7 PM meet, 7:30 on-out. Urban trails accessible via public transit.",
    },
    {
      kennelCode: "cfmh3", shortName: "CFMH3", fullName: "Chicago Full Moon Hash House Harriers", region: "Chicago, IL",
      website: "https://www.hhhinchicago.com", foundedYear: 1987,
      facebookUrl: "https://www.facebook.com/groups/570636943051356/",
      scheduleFrequency: "Monthly", scheduleNotes: "Evenings near the full moon",
      description: "Monthly hash near the full moon (est. 1987). Day of week varies with the lunar cycle.",
    },
    {
      kennelCode: "fcmh3", shortName: "FCMH3", fullName: "First Crack of the Moon Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/570636943051356/",
      scheduleFrequency: "Monthly", scheduleNotes: "Evenings near the new moon",
      description: "Monthly hash near the new moon. Sister kennel to Chicago Full Moon H3.",
    },
    {
      kennelCode: "bdh3", shortName: "BDH3", fullName: "Big Dogs Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/137255643022023/",
      scheduleFrequency: "Monthly", scheduleNotes: "2nd Saturday afternoon",
      description: "Monthly 2nd Saturday afternoon hash. Off-the-beaten-path trails.",
    },
    {
      kennelCode: "bmh3", shortName: "BMH3", fullName: "Bushman Hash House Harriers", region: "Chicago, IL",
      website: "https://www.hhhinchicago.com",
      scheduleFrequency: "Monthly", scheduleNotes: "3rd Saturday afternoon",
      description: "Monthly 3rd Saturday afternoon hash. All-woods trails in Cook County Forest Preserves.",
    },
    {
      kennelCode: "2ch3", shortName: "2CH3", fullName: "Second City Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/secondcityhhh",
      scheduleFrequency: "Irregular",
      description: "Runs on an as-desired basis. Trails typically further from city center.",
    },
    {
      kennelCode: "wwh3", shortName: "WWH3", fullName: "Whiskey Wednesday Hash House Harriers", region: "Chicago, IL",
      website: "http://www.whiskeywednesdayhash.org",
      facebookUrl: "https://www.facebook.com/groups/wwwhhh",
      scheduleFrequency: "Monthly", scheduleNotes: "Last Wednesday evening, 7:00 PM.",
      hashCash: "Free",
      description: "Monthly last Wednesday evening hash. Free to runners. Features whiskey.",
    },
    {
      kennelCode: "4x2h4", shortName: "4X2H4", fullName: "4x2 Hash House Harriers and Harriettes", region: "Chicago, IL",
      website: "https://www.4x2h4.org",
      facebookUrl: "https://www.facebook.com/groups/833761823403207",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "6:30 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "1st Tuesday. $2 hash cash, 4 miles, 2 beers.", hashCash: "$2",
      description: "Monthly 1st Tuesday evening hash. $2 hash cash, ~4 mile trail, 2 beers, brief circle.",
    },
    {
      kennelCode: "rth3", shortName: "RTH3", fullName: "Ragtime Hash House Harriers", region: "Chicago, IL",
      facebookUrl: "https://www.facebook.com/groups/213336255431069/",
      scheduleFrequency: "Irregular", scheduleNotes: "Brunch hash, various Saturdays",
      description: "Brunch hash on various Saturdays, late morning.",
    },
    {
      kennelCode: "dlh3", shortName: "DLH3", fullName: "Duneland Hash House Harriers", region: "South Shore, IN",
      facebookUrl: "https://www.facebook.com/groups/SouthShoreHHH/",
      scheduleFrequency: "Irregular",
      description: "NW Indiana hash considered part of the Chicagoland community. Irregular schedule.",
    },
    // DC / DMV area
    {
      kennelCode: "ewh3", shortName: "EWH3", fullName: "Everyday is Wednesday Hash House Harriers", region: "Washington, DC",
      website: "https://www.ewh3.com", foundedYear: 1999,
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:45 PM", scheduleFrequency: "Weekly",
      discordUrl: "https://tinyurl.com/ewh3discord",
      description: "Weekly Thursday evening hash in DC. One of the largest and most active DC kennels (est. 1999).",
    },
    {
      kennelCode: "shith3", shortName: "SHITH3", fullName: "So Happy It's Tuesday Hash House Harriers", region: "Northern Virginia",
      website: "https://shith3.com", foundedYear: 2002,
      facebookUrl: "https://www.facebook.com/groups/756148277731360/",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Weekly Tuesday evening hash in Northern Virginia / DC Metro. All live trails (est. 2002).",
    },
    {
      kennelCode: "cch3", shortName: "CCH3", fullName: "Charm City Hash House Harriers", region: "Baltimore, MD",
      website: "https://charmcityh3.com",
      facebookUrl: "https://www.facebook.com/CharmCityH3",
      scheduleFrequency: "Biweekly", scheduleNotes: "Alternating Friday 7:00 PM and Saturday afternoons",
      description: "Biweekly hash in Baltimore, alternating Friday evenings and Saturday afternoons.",
    },
    {
      kennelCode: "w3h3", shortName: "W3H3", fullName: "Wild and Wonderful Wednesday Hash House Harriers", region: "Jefferson County, WV",
      website: "https://sites.google.com/view/w3h3",
      facebookUrl: "https://www.facebook.com/groups/273947756839837/",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:09 PM", scheduleFrequency: "Weekly",
      description: "Weekly Wednesday 6:09 PM hash in Jefferson County, West Virginia (Harpers Ferry area).",
    },
    {
      kennelCode: "dch4", shortName: "DCH4", fullName: "DC Harriettes and Harriers Hash House", region: "Washington, DC",
      website: "https://dch4.org", foundedYear: 1978,
      facebookUrl: "https://www.facebook.com/groups/dch4hashhouse",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "2:00 PM daylight, 3:00 PM standard time",
      description: "Weekly Saturday afternoon hash. First co-ed kennel in DC (est. 1978). 2299+ trails.",
    },
    {
      kennelCode: "wh4", shortName: "WH4", fullName: "White House Hash House Harriers", region: "Washington, DC",
      website: "https://whitehousehash.com", foundedYear: 1987,
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly",
      scheduleNotes: "3:00 PM Labor Day–Memorial Day, 5:00 PM Memorial Day–Labor Day",
      description: "Weekly Sunday hash in the DC/NoVA area (est. 1987). 2100+ trails.",
    },
    {
      kennelCode: "bah3", shortName: "BAH3", fullName: "Baltimore Annapolis Hash House Harriers", region: "Baltimore, MD",
      website: "https://www.bah3.org",
      scheduleDayOfWeek: "Sunday", scheduleTime: "3:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Sunday 3 PM hash in the Baltimore/Annapolis area.",
    },
    {
      kennelCode: "mvh3", shortName: "MVH3", fullName: "Mount Vernon Hash House Harriers", region: "Washington, DC",
      website: "http://www.dchashing.org/mvh3/", foundedYear: 1985,
      scheduleDayOfWeek: "Saturday", scheduleTime: "10:00 AM", scheduleFrequency: "Weekly",
      description: "Weekly Saturday 10 AM hash in the DC metro area (est. 1985).",
    },
    {
      kennelCode: "ofh3", shortName: "OFH3", fullName: "Old Frederick Hash House Harriers", region: "Frederick, MD",
      website: "https://www.ofh3.com", foundedYear: 2000,
      scheduleFrequency: "Monthly", scheduleNotes: "2nd Saturday, 10:30 AM sign-in, 11:00 AM hares away",
      description: "Monthly 2nd Saturday hash in Frederick, western Maryland (est. ~2000).",
    },
    {
      kennelCode: "dcfmh3", shortName: "DCFMH3", fullName: "DC Full Moon Hash House Harriers", region: "Washington, DC",
      website: "https://sites.google.com/site/dcfmh3/home",
      scheduleFrequency: "Monthly", scheduleNotes: "Friday/Saturday on or near the full moon",
      contactEmail: "dcfullmoonh3@gmail.com",
      description: "Monthly hash on or near the full moon. Hosted by rotating DC-area kennels.",
    },
    {
      kennelCode: "gfh3", shortName: "GFH3", fullName: "Great Falls Hash House Harriers", region: "Northern Virginia",
      website: "http://www.gfh3.org", foundedYear: 1982,
      scheduleNotes: "Wednesday 7:00 PM (Spring/Summer), Saturday 3:00 PM (Fall/Winter)",
      description: "Seasonal schedule: Wednesday evenings (spring/summer), Saturday afternoons (fall/winter). Est. 1982, 1400+ runs.",
    },
    {
      kennelCode: "dch3", shortName: "DCH3", fullName: "DC Hash House Harriers", region: "Washington, DC",
      foundedYear: 1972,
      scheduleNotes: "Monday 7:00 PM (Summer), Saturday 3:00 PM",
      description: "The original DC kennel (est. 1972). Men only. Monday evenings (summer) and Saturday afternoons.",
    },
    {
      kennelCode: "oth4", shortName: "OTH4", fullName: "Over the Hump Hash House Harriers", region: "Washington, DC",
      facebookUrl: "https://www.facebook.com/share/g/6ZoFa1A5jD7Ukiv9/",
      foundedYear: 1991,
      scheduleFrequency: "Biweekly", scheduleNotes: "Sunday 2:00 PM + Wednesday 7:00 PM",
      description: "Biweekly Sunday 2 PM and Wednesday 7 PM hashes (est. 1991).",
    },
    {
      kennelCode: "smuttycrab", shortName: "SMUTTyCrab", fullName: "SMUTTy Crab Hash House Harriers", region: "Southern Maryland",
      website: "http://smuttycrabh3.com", foundedYear: 2007,
      scheduleFrequency: "Biweekly", scheduleNotes: "Saturday 1:00 PM",
      description: "Biweekly Saturday 1 PM hash in Southern Maryland (est. 2007).",
    },
    {
      kennelCode: "hillbillyh3", shortName: "HillbillyH3", fullName: "Hillbilly Hash House Harriers", region: "Washington, DC",
      website: "https://sites.google.com/site/hillbillyh3/home",
      scheduleFrequency: "Twice monthly", scheduleNotes: "Sunday ~12:00 PM",
      description: "Twice-monthly Sunday hash in the DC metro / western Maryland area.",
    },
    {
      kennelCode: "dcrt", shortName: "DCRT", fullName: "DC Red Tent Harriettes", region: "Washington, DC",
      website: "https://sites.google.com/site/dcredtent/",
      facebookUrl: "https://m.facebook.com/groups/636027323156298/",
      scheduleFrequency: "Monthly", scheduleNotes: "Sunday 10:00 AM. Ladies only.",
      description: "Monthly Sunday 10 AM ladies-only hash in DC.",
    },
    {
      kennelCode: "h4", shortName: "H4", fullName: "Hangover Hash House Harriers", region: "Washington, DC",
      website: "https://hangoverhash.com", foundedYear: 2012,
      scheduleFrequency: "Monthly", scheduleNotes: "Sunday 10:00 AM",
      description: "Monthly Sunday 10 AM hash. Hashing the DC area since 2012.",
    },
    {
      kennelCode: "fuh3", shortName: "FUH3", fullName: "Fredericksburg Urban Hash House Harriers", region: "Fredericksburg, VA",
      website: "https://fuh3.net",
      scheduleFrequency: "Biweekly", scheduleNotes: "Saturday 3:00 PM",
      description: "Biweekly Saturday 3 PM hash in Fredericksburg, VA (~50 miles south of DC).",
    },
    {
      kennelCode: "dcph4", shortName: "DCPH4", fullName: "DC Powder/Pedal/Paddle Hounds", region: "Washington, DC",
      facebookUrl: "https://www.facebook.com/groups/DCPH4/",
      scheduleFrequency: "Quarterly", scheduleNotes: "Multi-sport hash (skiing, biking, paddling)",
      description: "Multi-sport hash (skiing, biking, paddling). Quarterly schedule.",
    },
    // San Francisco Bay Area (sfh3.com MultiHash platform)
    {
      kennelCode: "sfh3", shortName: "SFH3", fullName: "San Francisco Hash House Harriers", region: "San Francisco, CA",
      website: "https://www.sfh3.com", foundedYear: 1982,
      facebookUrl: "https://www.facebook.com/sfhash",
      twitterHandle: "@sfh3",
      scheduleDayOfWeek: "Monday", scheduleTime: "6:15 PM", scheduleFrequency: "Weekly",
      description: "The flagship Bay Area kennel (est. 1982). Weekly Monday evening runs in San Francisco. Hosts the sfh3.com aggregator platform.",
    },
    {
      kennelCode: "gph3", shortName: "GPH3", fullName: "Gypsies in the Palace Hash House Harriers", region: "San Francisco, CA",
      website: "https://www.gypsiesh3.com",
      twitterHandle: "@gypsiesh3",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:15 PM", scheduleFrequency: "Weekly",
      description: "Traditional Thursday night hash in San Francisco. Run #1696+.",
    },
    {
      kennelCode: "ebh3", shortName: "EBH3", fullName: "East Bay Hash House Harriers", region: "Oakland, CA",
      website: "https://www.ebh3.com",
      facebookUrl: "https://www.facebook.com/groups/Ebhhh/",
      scheduleDayOfWeek: "Sunday", scheduleTime: "1:00 PM", scheduleFrequency: "Biweekly",
      hashCash: "$6",
      description: "Biweekly Sunday afternoon runs in the East Bay. Run #1159+.",
    },
    {
      kennelCode: "svh3", shortName: "SVH3", fullName: "Silicone Valley Hash House Harriers", region: "San Jose, CA",
      website: "https://svh3.com",
      facebookUrl: "https://www.facebook.com/SIliconeValleyHash",
      twitterHandle: "@SiliconValleyH3",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      hashCash: "$6",
      description: "Biweekly Saturday afternoon runs from South Bay to mid-peninsula. Run #1266+. Note: deliberate 'Silicone' spelling.",
    },
    {
      kennelCode: "fhac-u", shortName: "FHAC-U", fullName: "FHAC-U Hash House Harriers", region: "San Jose, CA",
      website: "https://svh3.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Alternates Thursdays with Agnews",
      hashCash: "$7",
      description: "Biweekly Thursday evening traditional hash in the South Bay. Shorter trails, more pubs. Alternates with Agnews.",
    },
    {
      kennelCode: "agnews", shortName: "Agnews", fullName: "Agnews State Hash House Harriers", region: "San Jose, CA",
      website: "https://svh3.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Alternates Thursdays with FHAC-U",
      description: "Biweekly Thursday evening hash in the South Bay. Longer trails, more family-friendly. Alternates with FHAC-U. Run #1510+.",
    },
    {
      kennelCode: "barh3", shortName: "BARH3", fullName: "Bay Area Rabble Hash", region: "San Francisco, CA",
      twitterHandle: "@BARH3",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Bar-to-bar live hare hash starting at various BART stations",
      description: "Weekly Wednesday evening bar-to-bar live hare hash. Starts at BART stations across the Bay Area.",
    },
    {
      kennelCode: "marinh3", shortName: "MarinH3", fullName: "Marin Hash House Harriers", region: "Marin County, CA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "1:00 PM", scheduleFrequency: "Monthly",
      description: "Monthly Saturday afternoon hash in Marin County. Run #290+. No dedicated website.",
    },
    {
      kennelCode: "fch3", shortName: "FCH3", fullName: "Fog City Hash House Harriers", region: "San Francisco, CA",
      scheduleFrequency: "Monthly", scheduleNotes: "LGBTQ-friendly kennel, special events",
      description: "LGBTQ-friendly hash in San Francisco with irregular/monthly events and special weekends.",
    },
    {
      kennelCode: "sffmh3", shortName: "SFFMH3", fullName: "San Francisco Full Moon Hash", region: "San Francisco, CA",
      scheduleFrequency: "Monthly", scheduleNotes: "On the full moon",
      description: "Monthly full-moon hash in San Francisco. Previously known as SF Full Moon Zombies HHH.",
    },
    {
      kennelCode: "vmh3", shortName: "VMH3", fullName: "Vine & Malthouse Hash House Harriers", region: "San Francisco, CA",
      scheduleFrequency: "Irregular",
      description: "Specialty hash in the Bay Area. Occasional events listed on sfh3.com.",
    },
    {
      kennelCode: "mwh3", shortName: "MWH3", fullName: "Muir Woods Hash House Harriers", region: "Marin County, CA",
      website: "http://www.mwh3.com",
      scheduleFrequency: "Annual", scheduleNotes: "Anti-Ranger run in August",
      description: "Annual hash event in the Muir Woods area of Marin County.",
    },
    {
      kennelCode: "262h3", shortName: "26.2H3", fullName: "26.2 Hash House Harriers", region: "San Francisco, CA",
      scheduleFrequency: "Irregular", scheduleNotes: "Marathon-themed specialty events",
      description: "Marathon-themed specialty hash in the Bay Area. Events listed on sfh3.com.",
    },
    // London, UK
    {
      kennelCode: "lh3", shortName: "LH3", fullName: "London Hash House Harriers", region: "London", country: "UK",
      website: "https://www.londonhash.org", foundedYear: 1975,
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Summer: sometimes Monday evenings at 7pm",
      instagramHandle: "@london_hash_house_harriers",
    },
    {
      kennelCode: "cityh3", shortName: "CityH3", fullName: "City Hash House Harriers", region: "London", country: "UK",
      website: "https://cityhash.org.uk",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      instagramHandle: "@cityhashhouseharriers",
    },
    {
      kennelCode: "wlh3", shortName: "WLH3", fullName: "West London Hash House Harriers", region: "London", country: "UK",
      website: "https://westlondonhash.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
    },
    {
      kennelCode: "barnesh3", shortName: "BarnesH3", fullName: "Barnes Hash House Harriers", region: "London", country: "UK",
      website: "http://www.barnesh3.com",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:30 PM", scheduleFrequency: "Weekly",
      hashCash: "£2",
    },
    {
      kennelCode: "och3", shortName: "OCH3", fullName: "Old Coulsdon Hash House Harriers", region: "Surrey", country: "UK",
      website: "http://www.och3.org.uk",
      scheduleFrequency: "Weekly", scheduleNotes: "Alternating Sunday 11 AM and Monday 7:30 PM",
      hashCash: "£2",
    },
    {
      kennelCode: "slh3", shortName: "SLH3", fullName: "SLASH (South London Hash House Harriers)", region: "London", country: "UK",
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "2nd Saturday of the month",
    },
    {
      kennelCode: "fukfm", shortName: "FUKFM", fullName: "First UK Full Moon Hash House Harriers", region: "London", country: "UK",
      website: "https://fukfmh3.co.uk", foundedYear: 1990,
      scheduleFrequency: "Monthly", scheduleNotes: "Every full moon evening, 7:30 PM",
    },
    {
      kennelCode: "eh3", shortName: "EH3", fullName: "Enfield Hash House Harriers", region: "London", country: "UK",
      website: "https://enfieldhash.org", foundedYear: 1999,
      scheduleFrequency: "Monthly", scheduleNotes: "3rd Wednesday, 7:30 PM",
    },
    {
      kennelCode: "ch4", shortName: "CH4", fullName: "Catch the Hare Hash House Harriers", region: "London", country: "UK",
      website: "http://www.catchtheharehash.org.uk",
      scheduleFrequency: "Monthly", scheduleNotes: "~3rd Sunday, 3:00 PM. Live hare format.",
    },
    {
      kennelCode: "cunth3", shortName: "CUNTH3", fullName: "Currently Unnamed North Thames Hash House Harriers", region: "London", country: "UK",
      facebookUrl: "https://www.facebook.com/groups/1822849584637512",
      scheduleFrequency: "Monthly", scheduleNotes: "Fridays, 7:00 PM. Pub trail format.",
    },
    // ===== FLORIDA =====
    // --- Miami / South Florida ---
    {
      kennelCode: "mia-h3", shortName: "MIA H3", fullName: "Miami Hash House Harriers", region: "Miami, FL",
      website: "https://miamih3.com",
      facebookUrl: "https://www.facebook.com/groups/miami.hash.house.harriers",
      instagramHandle: "@miami_h3",
      scheduleDayOfWeek: "Thursday", scheduleFrequency: "Weekly",
      hashCash: "$5",
      description: "Weekly Thursday runs in the Miami/Dade County area.",
    },
    {
      kennelCode: "wildcard-h3", shortName: "Wildcard H3", fullName: "Fort Lauderdale Wildcard Hash House Harriers", region: "Miami, FL",
      facebookUrl: "https://www.facebook.com/groups/373426549449867/",
      scheduleDayOfWeek: "Monday", scheduleFrequency: "Weekly",
      contactEmail: "wildcardh3@gmail.com",
      description: "Weekly Monday evening runs in the Fort Lauderdale area.",
    },
    {
      kennelCode: "h6", shortName: "H6", fullName: "Hollyweird Hash House Harriers Happy Hour", region: "Miami, FL",
      facebookUrl: "https://www.facebook.com/HollyweirdH6/",
      scheduleDayOfWeek: "Friday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      hashCash: "Free",
      description: "Weekly Friday evening runs in the Hollywood/Dania Beach/Hallandale area. BYOB.",
    },
    {
      kennelCode: "pbh3", shortName: "PBH3", fullName: "Palm Beach Hash House Harriers", region: "Miami, FL",
      website: "http://www.pbh3.org",
      facebookUrl: "https://www.facebook.com/groups/pbhhh/",
      scheduleDayOfWeek: "Wednesday", scheduleFrequency: "Weekly",
      description: "Weekly Wednesday runs in the Palm Beach County area.",
    },
    {
      kennelCode: "cbh3", shortName: "CBH3", fullName: "Corned Beef Hash House Harriers", region: "Miami, FL",
      description: "Palm Beach County hashing community.",
    },
    {
      kennelCode: "tch3-fl", shortName: "TCH3", fullName: "Treasure Coast Hash House Harriers", region: "Miami, FL",
      contactEmail: "pgakids2001@gmail.com",
      description: "Hashing in the Stuart / Treasure Coast area.",
    },
    // --- Florida Keys ---
    {
      kennelCode: "kwh3", shortName: "KWH3", fullName: "Key West Hash House Harriers", region: "Florida Keys",
      website: "https://keywesthash.com",
      contactEmail: "keywesthash@gmail.com",
      scheduleDayOfWeek: "Wednesday", scheduleFrequency: "Biweekly",
      scheduleNotes: "Every other Wednesday/Saturday; ~6 PM winter, ~7 PM summer",
      description: "Biweekly hashing in Key West with pickup hashes on off-weeks.",
    },
    // --- Tampa Bay ---
    {
      kennelCode: "tbh3-fl", shortName: "TBH3", fullName: "Tampa Bay Hash House Harriers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/908538665893063/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      foundedYear: 1988,
      description: "The original Tampa Bay Hash. Biweekly Saturday/Sunday runs.",
    },
    {
      kennelCode: "jrh3", shortName: "JRH3", fullName: "Tampa Bay Jolly Roger Hash House Harriers", region: "Tampa Bay, FL",
      website: "https://www.jollyrogerh3.com",
      facebookUrl: "https://www.facebook.com/groups/139148932829915/",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$7", foundedYear: 2003,
      contactEmail: "dab@jollyrogerh3.com",
      scheduleNotes: "Show 6 PM, Go 7 PM. Currently on hiatus — looking for new GM.",
      description: "Weekly Wednesday evening runs in the Tampa area.",
    },
    {
      kennelCode: "sph3-fl", shortName: "SPH3", fullName: "St Pete Hash House Harriers", region: "Tampa Bay, FL",
      website: "https://sph3.com",
      facebookUrl: "https://www.facebook.com/groups/stpetehashhouseharriers/",
      scheduleDayOfWeek: "Friday", scheduleFrequency: "Biweekly",
      description: "Every other Friday evening runs in St. Petersburg.",
    },
    {
      kennelCode: "circus-h3", shortName: "Circus H3", fullName: "Sarasota Circus Hash House Harriers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/circushash/",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Biweekly",
      hashCash: "$5",
      description: "Every other Sunday afternoon runs in the Sarasota area.",
    },
    {
      kennelCode: "nsah3", shortName: "NSAH3", fullName: "No Strings Attached Hash House Harriers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/NSAH3",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Biweekly",
      description: "Every other Sunday afternoon runs in the Tampa Bay area.",
    },
    {
      kennelCode: "lush", shortName: "LUSH", fullName: "Loosely-United Sun-Coast Hashers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/324974571563311/",
      scheduleFrequency: "Monthly",
      scheduleNotes: "As requested; represents all WCF kennels.",
      description: "Pan-West Central Florida kennel for inter-kennel events.",
    },
    {
      kennelCode: "b2b-h3", shortName: "B2BH3", fullName: "Bay 2 Beaches Hash House Harriers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/1387039994854156",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Monthly",
      scheduleNotes: "1st Sunday afternoon of each month.",
      description: "Monthly Sunday runs in the Tampa Bay area.",
    },
    {
      kennelCode: "lh3-fl", shortName: "LH3", fullName: "Lakeland Hash House Harriers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/283053549709909",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Monthly",
      scheduleNotes: "1st Sunday afternoon of each month.",
      description: "Monthly Sunday runs in Lakeland.",
    },
    {
      kennelCode: "barf-h3", shortName: "BARFH3", fullName: "Bay Area Frolic Hash House Harriers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/712867073080299",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly",
      scheduleNotes: "Occasional Saturday afternoons as scheduled.",
      description: "Monthly Saturday runs in the Tampa Bay area.",
    },
    {
      kennelCode: "sbh3", shortName: "SBH3", fullName: "Spring Brooks Hash House Harriers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/1704337600123871",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      scheduleNotes: "Saturdays opposite TBH3 or BARFH3.",
      description: "Biweekly Saturday runs in the Tampa Bay area.",
    },
    {
      kennelCode: "tth3-fl", shortName: "TTH3", fullName: "Taco Tuesday Hash House Harriers", region: "Tampa Bay, FL",
      facebookUrl: "https://www.facebook.com/groups/tacotuesdayh3private/",
      scheduleDayOfWeek: "Tuesday", scheduleFrequency: "Monthly",
      scheduleNotes: "4th Tuesday evening of each month.",
      description: "Monthly Tuesday evening runs in the Tampa Bay area.",
    },
    // --- Orlando / Central Florida ---
    {
      kennelCode: "o2h3", shortName: "O2H3", fullName: "Other Orlando Hash House Harriers", region: "Orlando, FL",
      website: "https://www.o2h3.net",
      facebookUrl: "https://www.facebook.com/OtherOrlandoH3/",
      contactEmail: "hashcalendar@gmail.com",
      scheduleDayOfWeek: "Saturday", scheduleTime: "1:25 PM", scheduleFrequency: "Weekly",
      foundedYear: 1986,
      scheduleNotes: "Every Saturday afternoon + full moon evenings.",
      description: "Central Florida's longest-running kennel (est. 1986). Weekly Saturday runs, 2000+ hashes completed.",
    },
    {
      kennelCode: "okissme-h3", shortName: "OKissMe H3", fullName: "OKissMe Hash House Harriers", region: "Orlando, FL",
      website: "https://okissmeh3.com",
      contactEmail: "OKissMeH3@gmail.com",
      scheduleDayOfWeek: "Sunday", scheduleTime: "11:00 AM", scheduleFrequency: "Monthly",
      foundedYear: 2022,
      description: "Monthly Sunday morning trails on the Orlando/Kissimmee border.",
    },
    {
      kennelCode: "bvd-h3", shortName: "BVDH3", fullName: "BVD Hash House Harriers", region: "Orlando, FL",
      website: "http://www.bvdh3.com",
      facebookUrl: "https://www.facebook.com/groups/506635549502193/",
      hashCash: "$5", foundedYear: 1999,
      description: "Hashing in the Melbourne / Palm Bay / Brevard County area.",
    },
    {
      kennelCode: "h3sc", shortName: "H3SC", fullName: "Space Coast Hash House Harriers", region: "Orlando, FL",
      website: "http://h3sc.com",
      scheduleDayOfWeek: "Wednesday", scheduleFrequency: "Weekly",
      description: "Weekly Wednesday runs in Brevard County (Mims to Malabar). 21+ only.",
    },
    {
      kennelCode: "gatr-h3", shortName: "GATR H3", fullName: "Gainesville Area Thirsty Runners", region: "Orlando, FL",
      website: "https://gatrh3.wordpress.com",
      contactEmail: "gatrh3@gmail.com",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Monthly",
      hashCash: "$5",
      description: "Monthly Saturday trail runs in the Gainesville area.",
    },
    // --- Daytona Beach ---
    {
      kennelCode: "dbh3", shortName: "DBH3", fullName: "Daytona Beach Hash House Harriers", region: "Daytona Beach, FL",
      website: "http://dbh3.us",
      scheduleDayOfWeek: "Wednesday", scheduleFrequency: "Weekly",
      foundedYear: 1989,
      description: "Weekly Wednesday runs in Daytona Beach. Hosts annual Bike Week Hash.",
    },
    // --- Jacksonville ---
    {
      kennelCode: "jax-h3", shortName: "JaxH3", fullName: "Jacksonville Hash House Harriers", region: "Jacksonville, FL",
      website: "https://www.jaxh3.com",
      facebookUrl: "https://www.facebook.com/groups/JaxH3/",
      contactEmail: "Tikiguy0317@gmail.com",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      description: "Every other Saturday runs in Jacksonville.",
    },
    // --- Tallahassee ---
    {
      kennelCode: "tna-h3", shortName: "T&AH3", fullName: "Tallahassee & Area Hash House Harriers", region: "Tallahassee, FL",
      website: "https://tnah3.wordpress.com",
      contactEmail: "gmtallyh3@gmail.com",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      foundedYear: 1993,
      scheduleNotes: "Every other Saturday afternoon. Thursday social dinner/drinks.",
      description: "Biweekly Saturday runs in the Tallahassee area.",
    },
    // --- Florida Panhandle ---
    {
      kennelCode: "pch3", shortName: "PCH3", fullName: "Panama City Hash House Harriers", region: "Florida Panhandle",
      website: "https://www.pch3.com",
      facebookUrl: "https://www.facebook.com/PCH3FL/",
      contactEmail: "pch3gm@gmail.com",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      description: "Every other Saturday runs in Panama City. 501(c) registered.",
    },
    {
      kennelCode: "survivor-h3", shortName: "Survivor H3", fullName: "Survivor Hash House Harriers", region: "Florida Panhandle",
      website: "http://survivorh3.com",
      facebookUrl: "https://www.facebook.com/SurvivorH3/",
      contactEmail: "mismanagement@survivorh3.com",
      scheduleFrequency: "Monthly",
      description: "Monthly trail runs in the Pensacola area. Hosts annual Red Dress Run.",
    },
    {
      kennelCode: "ech3-fl", shortName: "ECH3", fullName: "Emerald Coast Hash House Harriers", region: "Florida Panhandle",
      facebookUrl: "https://www.facebook.com/FWBAreaHHH",
      description: "Hashing in the Fort Walton Beach / Destin area.",
    },
  ];

  // ── ALIAS DATA (PRD Appendix D.3) ──

  // Aliases keyed by kennelCode (matches kennelRecords keys)
  const kennelAliases: Record<string, string[]> = {
    "nych3": ["NYC", "HashNYC", "NYC Hash", "NYCH3", "New York Hash", "NYC H3"],
    "boh3": ["Boston", "BH3", "BoH3", "Boston Hash"],
    "brh3": ["Brooklyn", "BrH3", "Brooklyn Hash", "Brooklyn H3"],
    "bobbh3": ["Ballbuster", "BoBBH3", "Boston Ballbuster", "Ballbuster Hash", "B3H4", "Boston Ballbuster Hardcore", "Boston Ballbuster H4"],
    "nawwh3": ["NAWW", "NAWWH3", "NAWW Hash"],
    "nah3": ["New Amsterdam", "NAH3", "NASS", "New Amsterdam Hash"],
    "qbk": ["Queens Black Knights", "QBK", "QBK Hash", "Queens", "Queens Hash"],
    "lil": ["Long Island Lunatics", "LIL", "Long Island", "LI Hash", "Lunatics"],
    "bfm": ["Ben Franklin Mob", "BFM", "BFM H3", "BFMH3"],
    "philly-h3": ["Philly Hash", "Philly H3", "Philadelphia H3", "Philadelphia Hash", "hashphilly"],
    "bos-moon": ["Moon", "Moom", "Boston Moon", "Bos Moon", "Bos Moom", "Boston Moon H3", "Boston Moon Hash"],
    "pink-taco": ["Pink Taco", "Pink Taco Hash", "PT2H3", "Pink Taco Trotters"],
    "beantown": ["Beantown", "Beantown Hash", "Beantown City", "Beantown City H3", "Beantown City Hash"],
    "knick": ["Knick", "Knickerbocker", "Knickerbocker Hash"],
    "columbia": ["Columbia", "Columbia Hash"],
    "ggfm": ["GGFM", "GGFM Hash"],
    "harriettes-nyc": ["Harriettes", "Harriettes Hash", "Harriettes (NYC)", "Harriettes NYC"],
    "si": ["Staten Island", "SI", "SI Hash", "Staten Island Hash"],
    "drinking-practice-nyc": ["Drinking Practice", "NYC Drinking Practice", "NYC DP", "DP"],
    "summit": ["Summit", "Summit H3", "Summit Hash", "SH3"],
    "sfm": ["SFM", "SFM H3", "Summit Full Moon", "Summit Full Moon H3"],
    "asssh3": ["ASSSH3", "ASSS H3", "All Seasons Summit Shiggy"],
    "rumson": ["RH3", "Rumson H3", "Rumson Hash", "Rumson HHH"],
    // Chicago area
    "ch3": ["Chicago Hash", "Chicago H3", "CHH3"],
    "th3": ["Thirstday", "Thirstday Hash", "Thirstday H3", "Thursday Hash"],
    "cfmh3": ["Chicago Full Moon", "Chicago Full Moon Hash", "Chicago Moon Hash"],
    "fcmh3": ["First Crack", "First Crack H3", "First Crack of the Moon", "New Moon Hash"],
    "bdh3": ["Big Dogs", "Big Dogs H3", "Big Dogs Hash"],
    "bmh3": ["Bushman", "Bushman H3", "Bushman Hash", "The Greatest Hash"],
    "2ch3": ["Second City", "Second City H3", "Second City Hash"],
    "wwh3": ["Whiskey Wednesday", "Whiskey Wednesday Hash", "WWW H3"],
    "4x2h4": ["4x2 H4", "Four by Two H4", "4x2 Hash", "Four by Two"],
    "rth3": ["Ragtime", "Ragtime Hash", "Brunch Hash"],
    "dlh3": ["Duneland", "Duneland H3", "South Shore HHH"],
    // DC / DMV area
    "ewh3": ["Everyday is Wednesday", "Every Day is Wednesday"],
    "shith3": ["SHIT H3", "S.H.I.T. H3", "So Happy It's Tuesday"],
    "cch3": ["Charm City", "Charm City Hash", "Charm City H3"],
    "w3h3": ["Wild and Wonderful Wednesday"],
    "dch4": ["DC Harriettes", "DC Harriettes and Harriers", "Harriettes and Harriers"],
    "wh4": ["White House Hash", "White House H3", "White House"],
    "bah3": ["Baltimore Annapolis", "Baltimore Annapolis Hash"],
    "mvh3": ["Mount Vernon Hash", "Mount Vernon H3", "Mount Vernon"],
    "ofh3": ["Old Frederick", "Old Frederick Hash"],
    "dcfmh3": ["DC Full Moon", "DC Full Moon Hash"],
    "gfh3": ["Great Falls", "Great Falls Hash"],
    "dch3": ["DC Hash", "DC Hash House Harriers", "the Men's Hash"],
    "oth4": ["Over the Hump"],
    "smuttycrab": ["SMUTTy Crab", "SMUTT", "Smutty Crab H3"],
    "hillbillyh3": ["Hillbilly Hash", "Hillbilly H3"],
    "dcrt": ["DC Red Tent", "Red Tent H3", "Red Tent Harriettes"],
    "h4": ["Hangover Hash", "Hangover H3", "Hangover"],
    "fuh3": ["Fredericksburg Urban Hash", "FXBG H3"],
    "dcph4": ["DC Powder Pedal Paddle"],
    // San Francisco Bay Area
    "sfh3": ["SF Hash", "San Francisco Hash", "San Francisco H3", "SF H3"],
    "gph3": ["Gypsies", "Gypsies H3", "Gypsies in the Palace", "GIP H3", "Gypsies Hash"],
    "ebh3": ["East Bay", "East Bay Hash", "East Bay H3", "EB Hash"],
    "svh3": ["Silicone Valley", "Silicone Valley H3", "Silicon Valley Hash", "SV Hash"],
    "fhac-u": ["FHACU", "FHAC-U H3", "FHAgnews"],
    "agnews": ["Agnews H3", "Agnews State H3", "Agnews Hash"],
    "barh3": ["Bay Area Rabble", "BAR H3"],
    "marinh3": ["Marin Hash", "Marin H3", "Marin HHH"],
    "fch3": ["Fog City", "Fog City Hash", "Fog City H3"],
    "sffmh3": ["SF Full Moon", "SF Full Moon Hash", "FMH3", "Full Moon H3 (SF)"],
    "vmh3": ["Vine & Malthouse", "Vine and Malthouse H3"],
    "mwh3": ["Muir Woods H3", "Muir Woods Hash", "Muir Woods"],
    "262h3": ["Marathon Hash", "Marathon H3", "26.2 Hash"],
    // London, UK
    "lh3": ["London Hash", "London H3", "London Hash House Harriers"],
    "cityh3": ["City Hash", "City H3"],
    "wlh3": ["West London Hash", "West London H3", "WLH"],
    "barnesh3": ["Barnes Hash", "Barnes H3"],
    "och3": ["Old Coulsdon", "Old Coulsdon Hash", "OC Hash"],
    "slh3": ["SLASH", "SLAH3", "South London Hash"],
    "fukfm": ["FUKFMH3", "FUK Full Moon", "First UK Full Moon"],
    "eh3": ["Enfield Hash", "Enfield H3"],
    "ch4": ["Catch the Hare", "CTH"],
    "cunth3": ["CUNT H3", "Currently Unnamed North Thames"],
    // Florida
    "mia-h3": ["Miami Hash", "Miami H3", "Dade H3", "MH3"],
    "wildcard-h3": ["Wildcard Hash", "FTL Wildcard", "Fort Lauderdale Wildcard"],
    "h6": ["Hollyweird H6", "Hollyweird Hash", "HHHH", "Hollywood Hash"],
    "pbh3": ["Palm Beach Hash", "PB H3", "PBHHH"],
    "cbh3": ["Corned Beef Hash"],
    "tch3-fl": ["Treasure Coast Hash", "TCH3"],
    "kwh3": ["Key West Hash", "KW H3", "KWHH3"],
    "tbh3-fl": ["Tampa Bay Hash", "Tampa Hash", "TBH3"],
    "jrh3": ["Jolly Roger Hash", "Jolly Roger H3", "JR H3"],
    "sph3-fl": ["St Pete Hash", "SPH3", "St Petersburg Hash"],
    "circus-h3": ["Circus Hash", "Sarasota Hash", "CH3 Sarasota"],
    "nsah3": ["No Strings Hash", "NSA Hash"],
    "lush": ["LUSH Hash", "Sun-Coast Hashers"],
    "b2b-h3": ["Bay 2 Beaches", "B2B Hash"],
    "lh3-fl": ["Lakeland Hash"],
    "barf-h3": ["BARF Hash", "Bay Area Frolic", "BARF H3"],
    "sbh3": ["Spring Brooks Hash", "SB H3"],
    "tth3-fl": ["Taco Tuesday Hash", "Taco Tuesday H3"],
    "o2h3": ["Other Orlando", "Other Orlando Hash", "O2H3 Hash", "Orlando Hash"],
    "okissme-h3": ["OKissMe Hash", "Kissimmee Hash"],
    "bvd-h3": ["BVD Hash", "Melbourne Hash", "Brevard Hash"],
    "h3sc": ["Space Coast Hash", "H3SC Hash"],
    "gatr-h3": ["GATR Hash", "Gainesville Hash", "GATRH3"],
    "dbh3": ["Daytona Hash", "Daytona Beach Hash", "DB H3"],
    "jax-h3": ["Jax Hash", "Jacksonville Hash", "Jax H3"],
    "tna-h3": ["T&A Hash", "Tally Hash", "Tallahassee Hash", "TNAH3"],
    "pch3": ["Panama City Hash", "PC H3", "PCH3"],
    "survivor-h3": ["Survivor Hash", "Pensacola Hash"],
    "ech3-fl": ["Emerald Coast Hash", "Fort Walton Hash", "FWB Hash"],
  };

  // ── SHARED SFH3 CONFIG (used by both iCal and HTML sources) ──

  const sfh3KennelPatterns: Array<[string, string]> = [
    ["^SFH3", "SFH3"],
    ["^GPH3", "GPH3"],
    ["^EBH3", "EBH3"],
    ["^SVH3", "SVH3"],
    ["^FHAgnews", "FHAC-U"],
    ["^FHAC-U", "FHAC-U"],
    ["^Agnews", "Agnews"],
    ["^Marin H3", "MarinH3"],
    ["^FCH3", "FCH3"],
    ["^FMH3", "SFFMH3"],
    ["^BARH3", "BARH3"],
    ["^VMH3", "VMH3"],
    ["^MWH3", "MWH3"],
    ["^26\\.2H3", "26.2H3"],
  ];

  const sfh3Config = {
    kennelPatterns: sfh3KennelPatterns,
    defaultKennelTag: "SFH3",
    skipPatterns: ["^Hand Pump", "^Workday"],
  };

  const sfh3KennelCodes = [
    "sfh3", "gph3", "ebh3", "svh3", "fhac-u", "agnews",
    "barh3", "marinh3", "fch3", "sffmh3", "vmh3", "mwh3", "262h3",
  ];

  // ── SOURCE DATA (PRD Section 8) ──

  const sources = [
    {
      name: "HashNYC Website",
      url: "https://hashnyc.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["nych3", "brh3", "nah3", "knick", "lil", "qbk", "si", "columbia", "harriettes-nyc", "ggfm", "nawwh3"],
    },
    {
      name: "Boston Hash Calendar",
      url: "bostonhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["boh3", "bobbh3", "beantown", "bos-moon", "pink-taco"],
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
      kennelCodes: ["summit", "sfm", "asssh3"],
    },
    {
      name: "Rumson H3 Static Schedule",
      url: "https://www.facebook.com/p/Rumson-H3-100063637060523/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "Rumson",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        anchorDate: "2026-01-03",
        startTime: "10:17",
        defaultTitle: "Rumson H3 Weekly Run",
        defaultLocation: "Rumson, NJ",
        defaultDescription: "Weekly Saturday morning trail. Check Facebook for start location and hare details.",
      },
      kennelCodes: ["rumson"],
    },
    {
      name: "BFM Google Calendar",
      url: "bfmhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["BFM|Ben Franklin|BFMH3", "BFM"],
          ["Philly Hash|hashphilly|Philly H3", "Philly H3"],
          ["Main Line", "Main Line H3"],
          ["TTH3", "TTH3"],
        ],
        defaultKennelTag: "BFM",
      },
      kennelCodes: ["bfm", "philly-h3"],
    },
    {
      name: "Philly H3 Google Calendar",
      url: "36ed6654c946ca632f71f400c1236c45d1bdd4e38c88c7c4da57619a72bfd7f8@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["BFM|Ben Franklin|BFMH3", "BFM"],
          ["Philly Hash|hashphilly|Philly H3", "Philly H3"],
        ],
        defaultKennelTag: "Philly H3",
      },
      kennelCodes: ["bfm", "philly-h3"],
    },
    {
      name: "BFM Website",
      url: "https://benfranklinmob.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["bfm"],
    },
    {
      name: "Philly H3 Website",
      url: "https://hashphilly.com/nexthash/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["philly-h3"],
    },
    {
      name: "Chicagoland Hash Calendar",
      url: "30c33n8c8s46icrd334mm5p3vc@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["CH3|Chicago Hash|Chicago H3", "CH3"],
          ["TH3|Thirstday|Thursday Hash", "TH3"],
          ["CFMH3|Chicago Full Moon|Full Moon Hash|Full Moon H3|Moon Hash", "CFMH3"],
          ["FCMH3|First Crack", "FCMH3"],
          ["BDH3|Big Dogs", "BDH3"],
          ["BMH3|Bushman", "BMH3"],
          ["2CH3|Second City", "2CH3"],
          ["WWH3|Whiskey Wednesday", "WWH3"],
          ["4X2|4x2", "4X2H4"],
          ["RTH3|Ragtime", "RTH3"],
          ["DLH3|Duneland|South Shore", "DLH3"],
        ],
        defaultKennelTag: "CH3",
      },
      kennelCodes: ["ch3", "th3", "cfmh3", "fcmh3", "bdh3", "bmh3", "2ch3", "wwh3", "4x2h4", "rth3", "dlh3"],
    },
    {
      name: "Chicago Hash Website",
      url: "https://chicagohash.org/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["ch3"],
    },
    {
      name: "Thirstday Hash Website",
      url: "https://chicagoth3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      kennelCodes: ["th3"],
    },
    {
      name: "EWH3 Google Calendar",
      url: "ewh3harerazor@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "EWH3",
      },
      kennelCodes: ["ewh3"],
    },
    {
      name: "SHITH3 Google Calendar",
      url: "jackschitt.shit@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "SHITH3",
      },
      kennelCodes: ["shith3"],
    },
    {
      name: "SHITH3 Website",
      url: "https://shith3.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["shith3"],
    },
    {
      name: "W3H3 Hareline Spreadsheet",
      url: "https://docs.google.com/spreadsheets/d/19mNka1u64ZNOHS7z_EoqRIrAOdqg5HkY9Uk8u6LwAsI",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 9999,
      config: {
        sheetId: "19mNka1u64ZNOHS7z_EoqRIrAOdqg5HkY9Uk8u6LwAsI",
        tabs: ["W3H3 Hareline"],
        columns: { runNumber: 0, date: 1, hares: 2, location: 3, title: 4 },
        kennelTagRules: { default: "W3H3" },
        startTimeRules: { byDayOfWeek: { "Wed": "18:09" }, default: "18:09" },
      },
      kennelCodes: ["w3h3"],
    },
    // London, UK
    {
      name: "City Hash Website",
      url: "https://cityhash.org.uk/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["cityh3"],
    },
    {
      name: "West London Hash Website",
      url: "https://westlondonhash.com/runs/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["wlh3"],
    },
    {
      name: "London Hash Run List",
      url: "https://www.londonhash.org/runlist.php",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["lh3"],
    },
    {
      name: "Barnes Hash Hare Line",
      url: "http://www.barnesh3.com/HareLine.htm",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      kennelCodes: ["barnesh3"],
    },
    {
      name: "Old Coulsdon Hash Run List",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      kennelCodes: ["och3"],
    },
    {
      name: "SLASH Run List",
      url: "https://www.londonhash.org/slah3/runlist/slash3list.html",
      type: "HTML_SCRAPER" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      kennelCodes: ["slh3"],
    },
    {
      name: "Enfield Hash Blog",
      url: "https://enfieldhash.org/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      kennelCodes: ["eh3"],
    },
    // Bay Area iCal feed (sfh3.com aggregator — ~11 kennels)
    {
      name: "SFH3 MultiHash iCal Feed",
      url: "https://www.sfh3.com/calendar.ics?kennels=all",
      type: "ICAL_FEED" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: sfh3Config,
      kennelCodes: sfh3KennelCodes,
    },
    // Bay Area HTML scraper (sfh3.com hareline — enrichment/fallback)
    {
      name: "SFH3 MultiHash HTML Hareline",
      url: "https://www.sfh3.com/runs?kennels=all",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: sfh3Config,
      kennelCodes: sfh3KennelCodes,
    },
    // DC / DMV area — iCal feeds (ai1ec WordPress plugin)
    {
      name: "Charm City H3 iCal Feed",
      url: "https://charmcityh3.com/?plugin=all-in-one-event-calendar&controller=ai1ec_exporter_controller&action=export_events&no_html=true",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        kennelPatterns: [
          ["^CCH3", "CCH3"],
          ["^Trail\\s*#", "CCH3"],
        ],
        defaultKennelTag: "CCH3",
      },
      kennelCodes: ["cch3"],
    },
    {
      name: "BAH3 iCal Feed",
      url: "https://www.bah3.org/?plugin=all-in-one-event-calendar&controller=ai1ec_exporter_controller&action=export_events&no_html=true",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        defaultKennelTag: "BAH3",
      },
      kennelCodes: ["bah3"],
    },
    // DC / DMV area — HTML scraper sources
    {
      name: "EWH3 WordPress Trail News",
      url: "https://www.ewh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["ewh3"],
    },
    {
      name: "DCH4 WordPress Trail Posts",
      url: "https://dch4.org/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["dch4"],
    },
    {
      name: "OFH3 Blogspot Trail Posts",
      url: "https://www.ofh3.com/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      kennelCodes: ["ofh3"],
    },
    {
      name: "Hangover H3 DigitalPress Blog",
      url: "https://hangoverhash.digitalpress.blog/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      kennelCodes: ["h4"],
    },
    // Hash Rego (hashrego.com — multi-kennel registration platform)
    {
      name: "Hash Rego",
      url: "https://hashrego.com/events",
      type: "HASHREGO" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        kennelSlugs: ["BFMH3", "EWH3", "WH4", "GFH3", "CH3", "DCH4", "DCFMH3", "FCH3"],
      },
      kennelCodes: ["bfm", "ewh3", "wh4", "gfh3", "ch3", "dch4", "dcfmh3", "fch3"],
    },
    // ===== FLORIDA =====
    // --- API-based sources ---
    {
      name: "Miami H3 Meetup",
      url: "https://www.meetup.com/miami-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "miami-hash-house-harriers",
      },
      kennelCodes: ["mia-h3"],
    },
    {
      name: "Key West H3 Google Calendar",
      url: "264vvpn7002rqbm1f82489fl8c@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "KWH3",
      },
      kennelCodes: ["kwh3"],
    },
    {
      name: "O2H3 Google Calendar",
      url: "hashcalendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "O2H3",
      },
      kennelCodes: ["o2h3"],
    },
    // --- WCFH Calendar (11 Tampa Bay kennels) ---
    {
      name: "West Central FL Hash Calendar",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["barf-h3", "b2b-h3", "jrh3", "lh3-fl", "sbh3", "lush", "nsah3", "circus-h3", "sph3-fl", "tth3-fl", "tbh3-fl"],
    },
    // --- Static schedule sources ---
    {
      name: "Wildcard H3 Static Schedule",
      url: "https://www.facebook.com/groups/373426549449867/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "Wildcard H3",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        anchorDate: "2026-03-02",
        startTime: "18:30",
        defaultTitle: "Wildcard H3 Weekly Run",
        defaultLocation: "Fort Lauderdale, FL",
        defaultDescription: "Weekly Monday evening trail. Check Facebook for start location.",
      },
      kennelCodes: ["wildcard-h3"],
    },
    {
      name: "H6 Static Schedule",
      url: "https://www.facebook.com/HollyweirdH6/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "H6",
        rrule: "FREQ=WEEKLY;BYDAY=FR",
        anchorDate: "2026-03-06",
        startTime: "18:30",
        defaultTitle: "H6 Weekly Run",
        defaultLocation: "Hollywood, FL",
        defaultDescription: "Weekly Friday evening trail. BYOB. Check Facebook for start location.",
      },
      kennelCodes: ["h6"],
    },
    {
      name: "PBH3 Static Schedule",
      url: "https://www.facebook.com/groups/pbhhh/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "PBH3",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        anchorDate: "2026-03-04",
        startTime: "18:30",
        defaultTitle: "PBH3 Weekly Run",
        defaultLocation: "Palm Beach County, FL",
        defaultDescription: "Weekly Wednesday trail. Check Facebook for start location.",
      },
      kennelCodes: ["pbh3"],
    },
    {
      name: "GATR H3 Static Schedule",
      url: "https://gatrh3.wordpress.com",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "GATR H3",
        rrule: "FREQ=MONTHLY;BYDAY=3SA",
        anchorDate: "2026-03-21",
        startTime: "14:00",
        defaultTitle: "GATR H3 Monthly Trail",
        defaultLocation: "Gainesville, FL",
        defaultDescription: "Monthly Saturday trail run. Check WordPress blog for start location and details.",
      },
      kennelCodes: ["gatr-h3"],
    },
  ];

  await seedKennels(prisma, kennels, kennelAliases, sources, toSlug);

  console.log("\nSeed complete!");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
