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
  "latitude", "longitude",
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

  // Set state-level parent relationships: metros under their state-province
  const stateMetroLinks: Record<string, string[]> = {
    "New York": [
      "New York City, NY", "Long Island, NY", "Syracuse, NY",
      "Capital District, NY", "Ithaca, NY", "Rochester, NY", "Buffalo, NY",
    ],
    "Pennsylvania": [
      "Philadelphia, PA", "Pittsburgh, PA", "State College, PA",
      "Lehigh Valley, PA", "Reading, PA", "Harrisburg, PA",
    ],
    "Delaware": ["Wilmington, DE"],
    "Virginia": [
      "Northern Virginia", "Fredericksburg, VA", "Richmond, VA",
      "Hampton Roads, VA", "Charlottesville, VA", "Lynchburg, VA",
    ],
    "North Carolina": [
      "Raleigh, NC", "Charlotte, NC", "Asheville, NC",
      "Wilmington, NC", "Fayetteville, NC",
    ],
    "Ohio": [
      "Columbus, OH", "Cincinnati, OH", "Dayton, OH",
      "Cleveland, OH", "Akron, OH",
    ],
    "Washington": ["Seattle, WA", "Tacoma, WA", "Olympia, WA", "Bremerton, WA"],
    "Colorado": ["Denver, CO", "Boulder, CO", "Fort Collins, CO", "Colorado Springs, CO"],
    "Minnesota": ["Minneapolis, MN"],
    "Arizona": ["Phoenix, AZ", "Tucson, AZ"],
    "Oregon": ["Portland, OR", "Salem, OR", "Eugene, OR", "Bend, OR"],
    "California": ["San Francisco, CA", "Oakland, CA", "San Jose, CA", "Marin County, CA", "San Diego, CA", "Santa Cruz, CA", "Los Angeles, CA", "Long Beach, CA", "Orange County, CA", "San Luis Obispo, CA"],
  };

  let stateLinked = 0;
  for (const [stateName, metroNames] of Object.entries(stateMetroLinks)) {
    const stateId = regionMap.get(stateName);
    if (!stateId) continue;
    for (const metroName of metroNames) {
      const metroId = regionMap.get(metroName);
      if (!metroId) continue;
      await prisma.region.update({
        where: { id: metroId },
        data: { parentId: stateId },
      });
      stateLinked++;
    }
  }
  if (stateLinked > 0) {
    console.log(`  ✓ ${stateLinked} metros linked to parent states`);
  }

  return regionMap;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureKennelRecords(prisma: any, kennels: any[], toSlugFn: (s: string) => string, regionMap: Map<string, string>) {
  console.log("Seeding kennels...");
  const kennelRecords = new Map<string, { id: string }>();
  let created = 0;
  let skipped = 0;
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
          skipped++;
          continue;
        }
        // Pre-check slug candidates to find an available one (avoids P2002 errors)
        const slugCandidates = [toSlugFn(kennel.shortName), toSlugFn(kennel.kennelCode)];
        for (let n = 2; slugCandidates.length < 10; n++) slugCandidates.push(`${toSlugFn(kennel.kennelCode)}-${n}`);
        let chosenSlug: string | null = null;
        for (const slug of slugCandidates) {
          const taken = await prisma.kennel.findUnique({ where: { slug }, select: { kennelCode: true, shortName: true } });
          if (!taken) {
            chosenSlug = slug;
            break;
          }
          console.warn(`  ⚠ Slug "${slug}" already taken by ${taken.shortName} (${taken.kennelCode}), trying next...`);
        }
        if (!chosenSlug) {
          console.error(`  ✗ FAILED: all slug candidates exhausted for ${kennel.shortName} (${kennel.kennelCode})`);
          console.error(`    Tried: ${slugCandidates.join(", ")}`);
          skipped++;
          continue;
        }
        try {
          record = await prisma.kennel.create({
            data: { kennelCode: kennel.kennelCode, shortName: kennel.shortName, slug: chosenSlug, fullName: kennel.fullName, region: kennel.region, regionId, country: kennel.country ?? "USA", ...profileFields },
          });
        } catch (e: unknown) {
          if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2002") {
            console.error(`  ✗ FAILED: unique constraint on ${kennel.shortName} (${kennel.kennelCode}) — shortName "${kennel.shortName}" may already exist in region "${kennel.region}"`);
            skipped++;
            continue;
          }
          throw e;
        }
        if (chosenSlug !== slugCandidates[0]) {
          console.log(`  ℹ Slug "${slugCandidates[0]}" taken, using "${chosenSlug}" for ${kennel.shortName}`);
        }
        created++;
        console.log(`  + Created kennel: ${kennel.shortName} (slug: ${record.slug})`);
      } else {
        // Update profile fields + region for existing kennels (idempotent enrichment)
        const profileFields = Object.fromEntries(
          Object.entries(kennel).filter(([k, v]) => PROFILE_FIELDS.has(k) && v !== undefined)
        );
        const regionId = regionMap.get(kennel.region) ?? null;
        const updates: Record<string, unknown> = {};
        // Update region if it changed or regionId is missing
        if (regionId && record.region !== kennel.region) {
          updates.region = kennel.region;
          updates.regionId = regionId;
        } else if (regionId && !record.regionId) {
          updates.regionId = regionId;
        } else if (!regionId && kennel.region && record.region !== kennel.region) {
          console.warn(`  ⚠ Cannot update region for "${kennel.shortName}": no region found for "${kennel.region}"`);
        }
        // Fill in missing profile fields (don't overwrite existing values)
        for (const [k, v] of Object.entries(profileFields)) {
          if (record[k] === null || record[k] === undefined) {
            updates[k] = v;
          }
        }
        if (Object.keys(updates).length > 0) {
          record = await prisma.kennel.update({
            where: { id: record.id },
            data: updates,
          });
          console.log(`  ~ Updated kennel: ${kennel.shortName} (${Object.keys(updates).join(", ")})`);
        }
      }
      kennelRecords.set(kennel.kennelCode, record);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const meta = e != null && typeof e === "object" && "meta" in e ? (e as { meta: unknown }).meta : undefined;
      console.error(`  ✗ FAILED to seed kennel ${kennel.shortName} (${kennel.kennelCode}): ${msg}`);
      if (meta) console.error(`    Prisma meta:`, JSON.stringify(meta));
      throw e;
    }
  }
  console.log(`  ✓ ${kennels.length} kennels checked (${created} created, ${skipped} skipped)`);
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
          { url: sourceData.url, type: sourceData.type },
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
        // Sync mutable fields (config, name, trustLevel) so seed changes get applied
        const updates: Record<string, unknown> = {};
        if (sourceData.trustLevel && sourceData.trustLevel > (existingSource.trustLevel ?? 0)) {
          updates.trustLevel = sourceData.trustLevel;
        }
        if (sourceData.name !== existingSource.name) {
          updates.name = sourceData.name;
        }
        if (JSON.stringify(sourceData.config) !== JSON.stringify(existingSource.config)) {
          updates.config = sourceData.config;
        }
        if (Object.keys(updates).length > 0) {
          await prisma.source.update({
            where: { id: existingSource.id },
            data: updates,
          });
          console.log(`  ~ Updated ${Object.keys(updates).join(", ")} for ${sourceData.name}`);
        }
      }

      await linkKennelsToSource(prisma, activeSource.id, kennelCodes, kennelRecords);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const meta = e != null && typeof e === "object" && "meta" in e ? (e as { meta: unknown }).meta : undefined;
      console.error(`  ✗ FAILED to seed source "${sourceData.name}" (${sourceData.type}): ${msg}`);
      if (meta) console.error(`    Prisma meta:`, JSON.stringify(meta));
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

  // Final summary
  const totalKennelsInDb = await prisma.kennel.count();
  const totalSourcesInDb = await prisma.source.count();
  const totalAliasesInDb = await prisma.kennelAlias.count();
  const totalRegionsInDb = await prisma.region.count();
  console.log("\n══════════════════════════════════");
  console.log("  Seed Summary");
  console.log("══════════════════════════════════");
  console.log(`  Regions in DB:  ${totalRegionsInDb}`);
  console.log(`  Kennels in DB:  ${totalKennelsInDb}`);
  console.log(`  Aliases in DB:  ${totalAliasesInDb}`);
  console.log(`  Sources in DB:  ${totalSourcesInDb}`);
  console.log("══════════════════════════════════");
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
    latitude?: number;
    longitude?: number;
  }> = [
    // NYC area (hashnyc.com source)
    {
      kennelCode: "nych3", shortName: "NYCH3", fullName: "New York City Hash House Harriers", region: "New York City, NY",
      website: "https://hashnyc.com",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$3",
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
    // ===== UPSTATE NEW YORK =====
    // --- Syracuse ---
    {
      kennelCode: "soh4", shortName: "SOH4", fullName: "Syracuse On-On-Dog-A Hash House Harriers & Harriettes", region: "Syracuse, NY",
      website: "https://www.soh4.com/",
      facebookUrl: "https://www.facebook.com/soh4onon/",
      instagramHandle: "syrononh4",
      contactEmail: "syracusehashruns@gmail.com",
      scheduleDayOfWeek: "Monday", scheduleFrequency: "Weekly", scheduleTime: "6:09 PM",
      scheduleNotes: "Mondays 6:09 PM (Apr-Sep); Saturdays 1:00 PM (Oct-Mar).",
      hashCash: "$5", foundedYear: 2012,
      description: "Weekly hash in Central New York with seasonal schedule: Monday evenings in summer, Saturday afternoons in winter.",
      latitude: 43.05, longitude: -76.15,
    },
    // --- Capital District ---
    {
      kennelCode: "halvemein", shortName: "HMHHH", fullName: "Halve Mein Hash House Harriers", region: "Capital District, NY",
      website: "https://www.hmhhh.com/",
      facebookUrl: "https://www.facebook.com/AHHHinc/",
      contactEmail: "halvemeinhash@gmail.com",
      scheduleFrequency: "Biweekly",
      scheduleNotes: "Every other Wednesday 6 PM (summer), 1 PM (winter), with special events on weekends.",
      hashCash: "$5", foundedYear: 2000,
      description: "Albany/Saratoga area hash running every other week in the Capital District.",
      latitude: 42.81, longitude: -73.77,
    },
    // --- Ithaca ---
    {
      kennelCode: "ih3", shortName: "IH3", fullName: "Ithaca Hash House Harriers", region: "Ithaca, NY",
      website: "http://ithacah3.org/hare-line/",
      contactEmail: "ih3goddess@gmail.com",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Biweekly", scheduleTime: "3:00 PM",
      scheduleNotes: "Every other Sunday. 3:00 PM during DST, 2:00 PM during Standard Time.",
      hashCash: "$5", foundedYear: 1988,
      description: "Biweekly Sunday runs in the Finger Lakes region since 1988.",
      latitude: 42.44, longitude: -76.50,
    },
    // --- Rochester ---
    {
      kennelCode: "flour-city", shortName: "Flour City H3", fullName: "Flour City Hash House Harriers", region: "Rochester, NY",
      website: "http://flourcityhhh.com/",
      contactEmail: "flourcitymismanagement@gmail.com",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly", scheduleTime: "1:09 PM",
      scheduleNotes: "Thursdays 6:09 PM (Apr-Sep); Sundays 1:09 PM (Oct-Mar).",
      hashCash: "$5", foundedYear: 1988,
      description: "Weekly hash in Rochester with seasonal schedule: Thursday evenings in summer, Sunday afternoons in winter.",
      latitude: 43.16, longitude: -77.61,
    },
    // --- Buffalo ---
    {
      kennelCode: "bh3", shortName: "Buffalo H3", fullName: "Buffalo Hash House Harriers", region: "Buffalo, NY",
      website: "http://hashinthebuff.com/",
      facebookUrl: "https://www.facebook.com/groups/1692560221019401/",
      contactEmail: "hashinthebuff@gmail.com",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly", scheduleTime: "1:00 PM",
      scheduleNotes: "3rd Saturday monthly. Occasional 1st Tuesday at 6:00 PM.",
      hashCash: "$10", foundedYear: 1990,
      description: "Monthly Saturday hash in the Buffalo area, running since 1990.",
      latitude: 42.89, longitude: -78.88,
    },
    // --- Hudson Valley ---
    {
      kennelCode: "hvh3-ny", shortName: "Hudson Valley H3", fullName: "Hudson Valley Hash House Harriers", region: "New York",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly", scheduleTime: "1:00 PM",
      scheduleNotes: "Monthly when active. Very sporadic -- runs may have months-long gaps.",
      hashCash: "$5", foundedYear: 2015,
      description: "Sporadic monthly runs in the Hudson Valley (Poughkeepsie/Kingston area).",
      latitude: 41.70, longitude: -73.93,
    },
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
    // Massachusetts (non-Boston)
    {
      kennelCode: "hvh3", shortName: "HVH3", fullName: "Happy Valley Hash House Harriers", region: "Pioneer Valley, MA",
      website: "https://happyvalleyh3.org/",
      scheduleDayOfWeek: "Thursday", scheduleFrequency: "Biweekly", scheduleTime: "6:30 PM",
      foundedYear: 1999,
      description: "Biweekly Thursday hashes in Western Massachusetts.",
    },
    {
      kennelCode: "413h3", shortName: "413H3", fullName: "413 Hash House Harriers", region: "Pioneer Valley, MA",
      foundedYear: 2008,
      description: "Annual summer hash in Western Massachusetts.",
    },
    {
      kennelCode: "zigzag", shortName: "ZigZag", fullName: "Zig Zag Hash House Harriers", region: "Boston, MA",
      website: "https://www.meetup.com/zig-zag-hash-house-harriers/",
      hashCash: "$5", foundedYear: 2019,
      description: "Boston-area hash kennel.",
    },
    {
      kennelCode: "e4b", shortName: "E4B", fullName: "Eager 4 Beaver Hash House Harriers", region: "Boston, MA",
      description: "Boston-area hash kennel.",
    },
    {
      kennelCode: "nbh3", shortName: "NbH3", fullName: "Northboro Hash House Harriers", region: "Boston, MA",
      website: "https://www.northboroh3.com/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly", scheduleTime: "12:00 PM",
      foundedYear: 2010, hashCash: "$30",
      description: "Monthly Saturday hashes in Northborough.",
    },
    {
      kennelCode: "poofh3", shortName: "PooFH3", fullName: "PooFlingers Hash House Harriers", region: "Boston, MA",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly", scheduleTime: "2:00 PM",
      description: "Monthly Saturday hashes throughout New England.",
    },
    // Vermont
    {
      kennelCode: "vth3", shortName: "VTH3", fullName: "Von Tramp Hash House Harriers", region: "Vermont",
      website: "https://www.vontramph3.com/",
      facebookUrl: "https://www.facebook.com/vontramph3",
      instagramHandle: "vontramph3",
      scheduleDayOfWeek: "Saturday", scheduleTime: "1:00 PM", scheduleFrequency: "Biweekly",
      foundedYear: 2021, hashCash: "$6.90",
      description: "Year-round biweekly Saturday trails in the Burlington, VT area.",
      latitude: 44.4759, longitude: -73.2121,
    },
    {
      kennelCode: "burlyh3", shortName: "BurlyH3", fullName: "Burlington Hash House Harriers", region: "Vermont",
      website: "https://www.burlingtonh3.com/",
      facebookUrl: "https://www.facebook.com/BurlingtonH3/",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      foundedYear: 2000, hashCash: "$6",
      description: "Weekly Wednesday evening trails in Burlington, VT. Seasonal: April through October.",
      latitude: 44.4759, longitude: -73.2121,
    },
    // Connecticut
    {
      kennelCode: "narwhal-h3", shortName: "Narwhal H3", fullName: "Narwhal Hash House Harriers", region: "Connecticut",
      facebookUrl: "https://www.facebook.com/HashNarwhal/",
      contactEmail: "narwhalh3@gmail.com",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Monthly",
      description: "Monthly Sunday hash in the New London, CT area.",
      latitude: 41.356, longitude: -72.101,
    },
    {
      kennelCode: "sbh3-ct", shortName: "Skull & Boners", fullName: "Skull & Boners Hash House Harriers", region: "Connecticut",
      contactEmail: "SkullAndBonersH3@gmail.com",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Monthly",
      scheduleNotes: "21+ only.",
      foundedYear: 2013,
      description: "Monthly Sunday hash in the New Haven, CT area. 21+ only.",
      latitude: 41.308, longitude: -72.928,
    },
    {
      kennelCode: "rgh3", shortName: "RGH3", fullName: "Rotten Groton Hash House Harriers", region: "Connecticut",
      facebookUrl: "https://www.facebook.com/rottengrotonh3/",
      contactEmail: "rottengrotonh3@gmail.com",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      description: "Biweekly Saturday hash in southeastern Connecticut.",
      latitude: 41.350, longitude: -72.079,
    },
    // Rhode Island
    {
      kennelCode: "rih3", shortName: "RIH3", fullName: "Rhode Island Hash House Harriers", region: "Rhode Island",
      website: "https://rih3.com/",
      facebookUrl: "https://www.facebook.com/groups/120140164667510/",
      contactEmail: "basket@rih3.com",
      scheduleDayOfWeek: "Monday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Weekly Monday evening trails across Rhode Island. Year-round, all weather.",
      latitude: 41.824, longitude: -71.413,
    },
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
      kennelCode: "ch3", shortName: "Chicago H3", fullName: "Chicago Hash House Harriers", region: "Chicago, IL",
      website: "https://chicagohash.org", foundedYear: 1978,
      facebookUrl: "https://www.facebook.com/groups/10638781851/",
      scheduleNotes: "Summer: Mondays 7pm. Winter: Sundays 2pm.",
      description: "Chicago's original kennel (est. 1978). Weekly Sunday afternoon runs (winter) / Monday evening runs (summer).",
    },
    {
      kennelCode: "th3", shortName: "Thirstday H3", fullName: "Thirstday Hash House Harriers", region: "Chicago, IL",
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
      kennelCode: "bmh3", shortName: "Bushman H3", fullName: "Bushman Hash House Harriers", region: "Chicago, IL",
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
      kennelCode: "cch3", shortName: "Charm City H3", fullName: "Charm City Hash House Harriers", region: "Baltimore, MD",
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
      scheduleFrequency: "Biweekly", scheduleNotes: "Twice monthly, Sunday ~12:00 PM",
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
      kennelCode: "h4", shortName: "Hangover H3", fullName: "Hangover Hash House Harriers", region: "Washington, DC",
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
      discordUrl: "https://discord.gg/eGRZMFfHtC",
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
      website: "https://www.fogcityh3.com",
      scheduleDayOfWeek: "Saturday", scheduleTime: "1:00 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "LGBTQ-friendly kennel, special events",
      description: "LGBTQ-friendly hash in San Francisco with irregular/monthly events and special weekends.",
    },
    {
      kennelCode: "sffmh3", shortName: "SFFMH3", fullName: "San Francisco Full Moon Hash", region: "San Francisco, CA",
      scheduleFrequency: "Monthly", scheduleTime: "6:30 PM", scheduleNotes: "On the full moon",
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
    // Santa Cruz
    {
      kennelCode: "sch3-ca", shortName: "SCH3", fullName: "Surf City Hash House Harriers",
      region: "Santa Cruz, CA",
      website: "https://www.sch3.net", foundedYear: 2000,
      facebookUrl: "https://www.facebook.com/groups/SurfCityH3/",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Santa Cruz's weekly Thursday evening hash. Founded 2000. Trails in and around the Santa Cruz coast, 70 miles south of San Francisco.",
      latitude: 36.97, longitude: -122.03,
    },
    // Los Angeles Area
    {
      kennelCode: "lah3", shortName: "LAH3", fullName: "Los Angeles Hash House Harriers", region: "Los Angeles, CA",
      website: "https://www.meetup.com/los-angeles-hash-house-harriers/",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$5", description: "LA's flagship Saturday afternoon hash. Active Meetup group with 176+ members.",
      latitude: 34.05, longitude: -118.24,
    },
    {
      kennelCode: "lbh3", shortName: "LBH3", fullName: "Long Beach Hash House Harriers", region: "Long Beach, CA",
      website: "https://www.lbh3.org",
      scheduleDayOfWeek: "Sunday", scheduleTime: "10:00 AM", scheduleFrequency: "Weekly",
      hashCash: "$5", description: "Long Beach weekly Sunday morning hash. Also hosts the SoCal calendar aggregator at lbh3.org/socal.",
      latitude: 33.77, longitude: -118.19,
    },
    {
      kennelCode: "tdh3-lb", shortName: "TDH3", fullName: "Throw Down Hash House Harriers", region: "Long Beach, CA",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      description: "Long Beach biweekly Thursday evening hash.",
      latitude: 33.77, longitude: -118.19,
    },
    {
      kennelCode: "gal-h3", shortName: "GAL", fullName: "Get A Life Hash House Harriers", region: "Los Angeles, CA",
      scheduleFrequency: "Irregular",
      description: "Los Angeles area hash with irregular schedule.",
      latitude: 34.05, longitude: -118.24,
    },
    {
      kennelCode: "suph3", shortName: "SUPH3", fullName: "Stand Up Paddling Hash House Harriers", region: "Long Beach, CA",
      scheduleFrequency: "Irregular", scheduleNotes: "A few paddle events per year",
      description: "Stand-up paddleboard hash in the Long Beach/Newport Beach area.",
      latitude: 33.77, longitude: -118.19,
    },
    {
      kennelCode: "fth3", shortName: "FtH3", fullName: "Foothill Hash House Harriers", region: "Los Angeles, CA",
      scheduleFrequency: "Irregular",
      description: "Foothill area hash in the San Gabriel Valley / northeast LA.",
      latitude: 34.14, longitude: -117.97,
    },
    {
      kennelCode: "elah3", shortName: "ELAH3", fullName: "East LA Hash House Harriers", region: "Los Angeles, CA",
      scheduleFrequency: "Irregular",
      description: "East Los Angeles hash.",
      latitude: 34.02, longitude: -118.17,
    },
    {
      kennelCode: "sgh3", shortName: "SGH3", fullName: "Signal Hill Hash House Harriers", region: "Long Beach, CA",
      scheduleFrequency: "Irregular",
      description: "Signal Hill area hash near Long Beach.",
      latitude: 33.80, longitude: -118.17,
    },
    // San Diego Area
    {
      kennelCode: "sdh3", shortName: "SDH3", fullName: "San Diego Hash House Harriers", region: "San Diego, CA",
      website: "https://sdh3.com",
      scheduleDayOfWeek: "Friday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Also biweekly Sunday 10am",
      hashCash: "$10", description: "San Diego's flagship kennel. Hosts the sdh3.com multi-kennel hareline aggregator covering 15+ SD area kennels.",
      latitude: 32.72, longitude: -117.16,
    },
    {
      kennelCode: "clh3-sd", shortName: "CLH3", fullName: "California Larrikins Hash House Harriers", region: "San Diego, CA",
      scheduleDayOfWeek: "Monday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      hashCash: "$5", description: "San Diego weekly Monday evening hash.",
      latitude: 32.72, longitude: -117.16,
    },
    {
      kennelCode: "ljh3", shortName: "LJH3", fullName: "La Jolla Hash House Harriers", region: "San Diego, CA",
      scheduleDayOfWeek: "Monday", scheduleTime: "6:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$8", description: "La Jolla weekly Monday evening hash.",
      latitude: 32.84, longitude: -117.28,
    },
    {
      kennelCode: "nch3-sd", shortName: "NCH3", fullName: "North County Hash House Harriers", region: "San Diego, CA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "10:00 AM", scheduleFrequency: "Weekly",
      hashCash: "$8", description: "North County (Carlsbad/Sorrento Valley area) weekly Saturday morning hash.",
      latitude: 33.16, longitude: -117.35,
    },
    {
      kennelCode: "irh3-sd", shortName: "IRH3", fullName: "Iron Rule Hash House Harriers", region: "San Diego, CA",
      scheduleDayOfWeek: "Friday", scheduleTime: "6:00 PM", scheduleFrequency: "Biweekly",
      hashCash: "$8", description: "San Diego biweekly Friday evening hash.",
      latitude: 32.72, longitude: -117.16,
    },
    {
      kennelCode: "humpin-sd", shortName: "Humpin'", fullName: "Humpin' Hash House Harriers", region: "San Diego, CA",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly",
      description: "San Diego Sunday hash.",
      latitude: 32.72, longitude: -117.16,
    },
    {
      kennelCode: "fmh3-sd", shortName: "FMH3", fullName: "San Diego Full Moon Hash", region: "San Diego, CA",
      scheduleFrequency: "Monthly", scheduleNotes: "Full moon evening",
      description: "Monthly full-moon hash in San Diego.",
      latitude: 32.72, longitude: -117.16,
    },
    {
      kennelCode: "hah3-sd", shortName: "HAH3", fullName: "Half-Assed Hash House Harriers", region: "San Diego, CA",
      scheduleFrequency: "Monthly",
      description: "Monthly hash in San Diego.",
      latitude: 32.72, longitude: -117.16,
    },
    {
      kennelCode: "mh4-sd", shortName: "MH4", fullName: "Mission Harriettes", region: "San Diego, CA",
      scheduleFrequency: "Monthly", scheduleNotes: "Monthly Wednesday evening",
      description: "Monthly women's hash in San Diego.",
      latitude: 32.72, longitude: -117.16,
    },
    {
      kennelCode: "drh3-sd", shortName: "DRH3", fullName: "San Diego Diaper Rash Hash", region: "San Diego, CA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "10:00 AM", scheduleFrequency: "Monthly",
      description: "Monthly family-friendly Saturday morning hash in San Diego.",
      latitude: 32.72, longitude: -117.16,
    },
    // Orange County
    {
      kennelCode: "ochhh", shortName: "OCHHH", fullName: "Orange County Hash House Harriers", region: "Orange County, CA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "10:00 AM", scheduleFrequency: "Monthly",
      description: "Orange County monthly Saturday morning hash.",
      latitude: 33.72, longitude: -117.83,
    },
    {
      kennelCode: "ochump", shortName: "OC Hump", fullName: "OC Hump Hash House Harriers", region: "Orange County, CA",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      description: "Orange County biweekly Wednesday evening hash.",
      latitude: 33.72, longitude: -117.83,
    },
    // Central Coast
    {
      kennelCode: "sloh3", shortName: "SLOH3", fullName: "San Luis Obispo Hash House Harriers", region: "San Luis Obispo, CA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:15 PM", scheduleFrequency: "Biweekly",
      description: "San Luis Obispo biweekly Saturday afternoon hash.",
      latitude: 35.28, longitude: -120.66,
    },
    // London, UK
    {
      kennelCode: "lh3", shortName: "London H3", fullName: "London Hash House Harriers", region: "London", country: "UK",
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
      kennelCode: "eh3", shortName: "Enfield H3", fullName: "Enfield Hash House Harriers", region: "London", country: "UK",
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
    // ===== IRELAND =====
    {
      kennelCode: "dh3", shortName: "Dublin H3", fullName: "Dublin Hash House Harriers", region: "Dublin", country: "IE",
      website: "https://dublinhhh.com/",
      facebookUrl: "https://www.facebook.com/groups/dublinhashhouseharriers/",
      instagramHandle: "dublinhashhouseharriers",
      scheduleDayOfWeek: "Sunday / Monday", scheduleTime: "19:30", scheduleFrequency: "Weekly",
      foundedYear: 1986, hashCash: "€2",
      description: "Ireland's only regularly running hash. Alternates between Sunday afternoon and Monday evening runs in the Dublin area.",
      latitude: 53.3498, longitude: -6.2603,
    },
    // ===== PENNSYLVANIA (outside Philly) =====
    // --- Pittsburgh ---
    {
      kennelCode: "pgh-h3", shortName: "PGH H3", fullName: "Pittsburgh Hash House Harriers", region: "Pittsburgh, PA",
      website: "https://pghh3.com/",
      contactEmail: "pghhashcalendar@gmail.com",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly", scheduleTime: "2:00 PM",
      scheduleNotes: "Sundays 2 PM (winter); varies in summer. Sub-kennels run other days.",
      hashCash: "$5", foundedYear: 1983,
      description: "Pittsburgh's main hash kennel with 2,200+ trails.",
      latitude: 40.44, longitude: -79.99,
    },
    {
      kennelCode: "ich3", shortName: "ICH3", fullName: "Iron City Hash House Harriers", region: "Pittsburgh, PA",
      website: "https://ironcityh3.com/",
      scheduleDayOfWeek: "Friday", scheduleFrequency: "Monthly", scheduleTime: "6:30 PM",
      description: "Monthly Friday evening hash in Pittsburgh.",
      latitude: 40.44, longitude: -79.99,
    },
    // --- State College ---
    {
      kennelCode: "nvhhh", shortName: "NVHHH", fullName: "Nittany Valley Hash House Harriers", region: "State College, PA",
      website: "https://www.nvhhh.com/",
      scheduleDayOfWeek: "Monday", scheduleFrequency: "Weekly", scheduleTime: "6:30 PM",
      scheduleNotes: "Mondays 6:30 PM (summer); Sundays 3 PM (winter).",
      hashCash: "$5", foundedYear: 1990,
      description: "Weekly hash in Centre County around Penn State.",
      latitude: 40.79, longitude: -77.86,
    },
    // --- Lehigh Valley ---
    {
      kennelCode: "lvh3", shortName: "LVH3", fullName: "Lehigh Valley Hash House Harriers", region: "Lehigh Valley, PA",
      website: "https://www.lvh3.com/",
      facebookUrl: "https://www.facebook.com/groups/lvh3/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly", scheduleTime: "12:00 PM",
      scheduleNotes: "3rd Saturday monthly. Sub-kennels on other days.",
      hashCash: "$5",
      description: "Monthly hash in the Allentown/Bethlehem/Easton area. Check the LVH3 Facebook page for the latest details.",
      latitude: 40.60, longitude: -75.49,
    },
    // --- Reading ---
    {
      kennelCode: "rh3", shortName: "Reading H3", fullName: "Reading Hash House Harriers", region: "Reading, PA",
      website: "https://readinghhh.blogspot.com/",
      scheduleDayOfWeek: "Monday", scheduleFrequency: "Weekly",
      scheduleNotes: "Mondays (summer); Sundays (winter).",
      hashCash: "$6", foundedYear: 1990,
      description: "Weekly hash in Reading/Berks County with 1,194+ trails.",
      latitude: 40.34, longitude: -75.93,
    },
    // --- Harrisburg ---
    {
      kennelCode: "h5-hash", shortName: "H5", fullName: "Harrisburg-Hershey Hash House Harriers", region: "Harrisburg, PA",
      website: "https://h5hash.com/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "2:30 PM",
      scheduleNotes: "Biweekly Saturdays. Also runs TMI full moon hashes.",
      description: "Biweekly hash in the Harrisburg/Hershey area.",
      latitude: 40.27, longitude: -76.88,
    },
    // ===== DELAWARE =====
    {
      kennelCode: "hockessin", shortName: "Hockessin H3", fullName: "Hockessin Hash House Harriers", region: "Wilmington, DE",
      website: "https://www.hockessinhash.org/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Weekly", scheduleTime: "3:00 PM",
      scheduleNotes: "Saturdays 3 PM (winter); Wednesdays 6:30 PM (summer). Runs in DE/MD/PA/NJ.",
      hashCash: "$5",
      description: "Delaware's most active hash with 1,656+ trails across the tri-state area.",
      latitude: 39.78, longitude: -75.68,
    },
    // ===== VIRGINIA (outside DC metro) =====
    // --- Richmond ---
    {
      kennelCode: "rvah3", shortName: "RH3", fullName: "Richmond Hash House Harriers", region: "Richmond, VA",
      website: "https://rh3.run/",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly", scheduleTime: "1:00 PM",
      foundedYear: 1992,
      description: "Weekly Sunday runs in Richmond since 1992 with 1,685+ trails.",
      latitude: 37.54, longitude: -77.44,
    },
    // --- Hampton Roads ---
    {
      kennelCode: "feh3", shortName: "FEH3", fullName: "Fort Eustis Hash House Harriers", region: "Hampton Roads, VA",
      website: "https://sites.google.com/view/ft-eustis-h3/",
      facebookUrl: "https://www.facebook.com/groups/forteustish3/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "3:00 PM",
      hashCash: "$5", foundedYear: 1971,
      description: "Oldest continuously running hash in the US, est. 1971. Biweekly Saturdays in the Hampton Roads area.",
      latitude: 37.09, longitude: -76.43,
    },
    {
      kennelCode: "bdsmh3", shortName: "BDSMH3", fullName: "Bad Decisions Start Monday Hash House Harriers", region: "Hampton Roads, VA",
      facebookUrl: "https://www.facebook.com/groups/291959117911692/",
      scheduleDayOfWeek: "Monday", scheduleFrequency: "Weekly", scheduleTime: "6:00 PM",
      foundedYear: 2018,
      description: "Weekly Monday evening hash in the Norfolk/Virginia Beach area.",
      latitude: 36.85, longitude: -76.29,
    },
    // --- Charlottesville ---
    {
      kennelCode: "cvilleh3", shortName: "CvilleH3", fullName: "cHARLOTtesville Hash House Harriers", region: "Charlottesville, VA",
      website: "https://cvillehash.com/",
      scheduleDayOfWeek: "Thursday", scheduleFrequency: "Biweekly", scheduleTime: "6:30 PM",
      scheduleNotes: "Odd Thursdays 6:30 PM; also 3rd Sunday 1:00 PM.",
      hashCash: "$7", foundedYear: 1994,
      description: "Biweekly hash in Charlottesville, known as 'the Harlots'.",
      latitude: 38.03, longitude: -78.48,
    },
    // --- Hampton Roads (Tidewater) ---
    {
      kennelCode: "twh3", shortName: "Tidewater H3", fullName: "Tidewater Hash House Harriers", region: "Hampton Roads, VA",
      facebookUrl: "https://www.facebook.com/groups/SEVAHHH",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly", scheduleTime: "2:00 PM",
      scheduleNotes: "Sundays year-round. Gather 1:30 PM, start 2:00 PM (spring/fall). Summer 3:30 PM, winter 1:00 PM. 11 sub-kennels run other days.",
      hashCash: "$5", foundedYear: 1991,
      description: "Hampton Roads' main hash kennel with 1,836+ trails and 11 sub-kennels across the Virginia Beach/Norfolk/Chesapeake area.",
      latitude: 36.85, longitude: -76.13,
    },
    // --- Lynchburg ---
    {
      kennelCode: "7h4", shortName: "7H4", fullName: "Seven Hills Hash House Harriers", region: "Lynchburg, VA",
      website: "https://sites.google.com/view/7h4/home",
      facebookUrl: "https://www.facebook.com/groups/41511405734/",
      contactEmail: "7h4hash@googlegroups.com",
      scheduleDayOfWeek: "Wednesday", scheduleFrequency: "Weekly", scheduleTime: "6:30 PM",
      scheduleNotes: "Wednesdays year-round. Also Sundays 3 PM in winter.",
      hashCash: "$5", foundedYear: 1992,
      description: "Weekly Wednesday evening hash in Lynchburg with 2,000+ trails since 1992.",
      latitude: 37.41, longitude: -79.14,
    },
    // ===== NORTH CAROLINA =====
    // --- Raleigh / Triangle ---
    {
      kennelCode: "swh3", shortName: "SWH3", fullName: "Sir Walter's Hash House Harriers", region: "Raleigh, NC",
      website: "https://swh3.wordpress.com/",
      facebookUrl: "https://www.facebook.com/sirwaltersh3/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Weekly", scheduleTime: "2:00 PM",
      hashCash: "$5",
      description: "The Triangle's main hash kennel. Weekly Saturday runs in the Raleigh-Durham-Chapel Hill area.",
      latitude: 35.78, longitude: -78.64,
    },
    {
      kennelCode: "larrikins", shortName: "Larrikins", fullName: "Carolina Larrikins Hash House Harriers", region: "Raleigh, NC",
      website: "https://www.carolinalarrikins.com/",
      scheduleDayOfWeek: "Wednesday", scheduleFrequency: "Biweekly", scheduleTime: "6:30 PM",
      scheduleNotes: "1st and 3rd Wednesday, 6:30 PM.",
      hashCash: "$1",
      description: "Biweekly Wednesday evening hash in the Triangle area.",
      latitude: 35.78, longitude: -78.64,
    },
    // --- Charlotte ---
    {
      kennelCode: "ch3-nc", shortName: "Charlotte H3", fullName: "Charlotte Hash House Harriers", region: "Charlotte, NC",
      facebookUrl: "https://www.facebook.com/groups/CharlotteH3/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "2:00 PM",
      hashCash: "$10", foundedYear: 1992,
      description: "Biweekly Saturday runs in Charlotte.",
      latitude: 35.23, longitude: -80.84,
    },
    // --- Asheville ---
    {
      kennelCode: "avlh3", shortName: "AVLH3", fullName: "Asheville Hash House Harriers", region: "Asheville, NC",
      website: "https://avlh3.wordpress.com/",
      facebookUrl: "https://www.facebook.com/groups/avlh3/",
      contactEmail: "avlh3.mm@gmail.com",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Weekly", scheduleTime: "2:00 PM",
      hashCash: "$8", foundedYear: 2008,
      description: "Weekly Saturday runs in the Asheville area with 855+ trails.",
      latitude: 35.60, longitude: -82.55,
    },
    // --- Wilmington ---
    {
      kennelCode: "cfh3", shortName: "CFH3", fullName: "Cape Fear Hash House Harriers", region: "Wilmington, NC",
      website: "https://capefearh3.com/",
      facebookUrl: "https://www.facebook.com/CapeFearH3/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "2:00 PM",
      scheduleNotes: "1st, 3rd, and 5th Saturdays, 2:00 PM.",
      hashCash: "$5", foundedYear: 2006,
      description: "Biweekly Saturday runs in the Wilmington/Cape Fear area.",
      latitude: 34.24, longitude: -77.95,
    },
    // --- Fayetteville ---
    {
      kennelCode: "ctrh3", shortName: "CTrH3", fullName: "Carolina Trash Hash House Harriers", region: "Fayetteville, NC",
      facebookUrl: "https://www.facebook.com/groups/carolinatrashH3/",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly", scheduleTime: "1:00 PM",
      hashCash: "$7", foundedYear: 1984,
      description: "Weekly Sunday runs in the Fayetteville area since 1984.",
      latitude: 35.05, longitude: -78.88,
    },
    // ===== TEXAS =====
    // --- Austin ---
    {
      kennelCode: "ah3", shortName: "AH3", fullName: "Austin Hash House Harriers", region: "Austin, TX",
      website: "https://austinh3.org",
      facebookUrl: "https://www.facebook.com/groups/austinh3/",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly",
      description: "Weekly Sunday runs in Austin.",
      latitude: 30.27, longitude: -97.74,
    },
    {
      kennelCode: "kawh3", shortName: "KAW!H3", fullName: "Keep Austin Weird Hash House Harriers", region: "Austin, TX",
      facebookUrl: "https://www.facebook.com/groups/KAWH3/",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Weekly Thursday evening runs in Austin.",
      latitude: 30.27, longitude: -97.74,
    },
    // --- Houston ---
    {
      kennelCode: "h4-tx", shortName: "Houston H3", fullName: "Houston Hash House Harriers", region: "Houston, TX",
      website: "https://h-townhash.com",
      facebookUrl: "https://www.facebook.com/groups/HoustonHash/",
      scheduleDayOfWeek: "Sunday", scheduleTime: "3:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Sunday afternoon runs in Houston.",
      latitude: 29.76, longitude: -95.37,
    },
    {
      kennelCode: "bmh3-tx", shortName: "BMH3", fullName: "Brass Monkey Hash House Harriers", region: "Houston, TX",
      website: "https://teambrassmonkey.blogspot.com",
      facebookUrl: "https://www.facebook.com/groups/teambrassmonkey/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      description: "Biweekly Saturday runs in the Houston area.",
      latitude: 30.04, longitude: -95.46,
    },
    {
      kennelCode: "mosquito-h3", shortName: "Mosquito H3", fullName: "Mosquito Hash House Harriers", region: "Houston, TX",
      facebookUrl: "https://www.facebook.com/groups/MosquitoH3/",
      scheduleFrequency: "Bimonthly", scheduleNotes: "1st & 3rd Wednesdays, 6:30 PM",
      description: "Runs on the 1st and 3rd Wednesday of each month in Houston.",
      latitude: 29.79, longitude: -95.76,
    },
    // --- Dallas-Fort Worth ---
    {
      kennelCode: "dh3-tx", shortName: "Dallas H3", fullName: "Dallas Hash House Harriers", region: "Dallas-Fort Worth, TX",
      website: "http://www.dfwhhh.org",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      description: "Biweekly Saturday runs in the Dallas area.",
      latitude: 32.78, longitude: -96.80,
    },
    {
      kennelCode: "duhhh", shortName: "DUHHH", fullName: "Dallas Urban Hash House Harriers", region: "Dallas-Fort Worth, TX",
      website: "http://www.dfwhhh.org",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Wednesday evening runs in Dallas.",
      latitude: 32.78, longitude: -96.80,
    },
    {
      kennelCode: "noduhhh", shortName: "NODUHHH", fullName: "North of Dallas Urban Hash House Harriers", region: "Dallas-Fort Worth, TX",
      website: "http://www.dfwhhh.org",
      scheduleDayOfWeek: "Monday", scheduleFrequency: "Biweekly",
      description: "Biweekly Monday runs north of Dallas.",
      latitude: 33.02, longitude: -96.70,
    },
    {
      kennelCode: "fwh3", shortName: "FWH3", fullName: "Fort Worth Hash House Harriers", region: "Dallas-Fort Worth, TX",
      website: "http://www.dfwhhh.org",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      description: "Biweekly Saturday runs in Fort Worth.",
      latitude: 32.75, longitude: -97.33,
    },
    // --- San Antonio ---
    {
      kennelCode: "sah3", shortName: "SAH3", fullName: "San Antonio Hash House Harriers", region: "San Antonio, TX",
      website: "https://www.sah3.com/",
      facebookUrl: "https://www.facebook.com/groups/355324508352374",
      scheduleFrequency: "Weekly",
      scheduleNotes: "Seasonal: Fridays 6:30 PM (summer) / Sundays 3:30 PM (winter). $5 trail fee.",
      hashCash: "$5",
      description: "Weekly runs in San Antonio. Schedule switches seasonally between Friday evenings and Sunday afternoons.",
      latitude: 29.42, longitude: -98.49,
    },
    // --- Corpus Christi ---
    {
      kennelCode: "c2h3", shortName: "C2H3", fullName: "Corpus Christi Hash House Harriers", region: "Corpus Christi, TX",
      facebookUrl: "https://www.facebook.com/groups/corpuschristih3/",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Weekly Thursday evening runs in Corpus Christi.",
      latitude: 27.80, longitude: -97.40,
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
      kennelCode: "lh3-fl", shortName: "Lakeland H3", fullName: "Lakeland Hash House Harriers", region: "Tampa Bay, FL",
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
      kennelCode: "sbh3", shortName: "Spring Brooks H3", fullName: "Spring Brooks Hash House Harriers", region: "Tampa Bay, FL",
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
    // ===== GEORGIA =====
    // --- Atlanta Metro ---
    {
      kennelCode: "ah4", shortName: "AH4", fullName: "Atlanta Hash House Harriers & Harriettes", region: "Atlanta, GA",
      website: "https://board.atlantahash.com",
      facebookUrl: "https://www.facebook.com/groups/atlantahash",
      scheduleDayOfWeek: "Saturday", scheduleTime: "1:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$10", foundedYear: 1978,
      description: "Atlanta's original hash. Weekly Saturday runs since 1978.",
    },
    {
      kennelCode: "ph3-atl", shortName: "PH3", fullName: "Pinelake Hash House Harriers", region: "Atlanta, GA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      description: "Alternate Saturday runs in the Atlanta metro area.",
    },
    {
      kennelCode: "bsh3", shortName: "BSH3", fullName: "Black Sheep Hash House Harriers", region: "Atlanta, GA",
      scheduleDayOfWeek: "Sunday", scheduleTime: "1:30 PM", scheduleFrequency: "Biweekly",
      description: "Alternate Sunday runs in Atlanta.",
    },
    {
      kennelCode: "sobh3", shortName: "SOBH3", fullName: "Slow Old Bastards Hash House Harriers", region: "Atlanta, GA",
      scheduleDayOfWeek: "Sunday", scheduleTime: "1:30 PM", scheduleFrequency: "Biweekly",
      description: "Alternate Sunday runs in Atlanta. Easy-going pace.",
    },
    {
      kennelCode: "mlh4", shortName: "MLH4", fullName: "Atlanta Moonlite Hash House Harriers", region: "Atlanta, GA",
      scheduleDayOfWeek: "Monday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      description: "Weekly Monday evening trail runs in Atlanta.",
    },
    {
      kennelCode: "whh3", shortName: "WHH3", fullName: "Wheelhopper Mountain Bike H3", region: "Atlanta, GA",
      scheduleFrequency: "Monthly", scheduleNotes: "3rd Sunday, 1:00 PM. Mountain bike hash.",
      description: "Monthly mountain bike hashing in the Atlanta area.",
    },
    {
      kennelCode: "sluth3", shortName: "SLUT H3", fullName: "Short Lazy Urban Thursday H3", region: "Atlanta, GA",
      scheduleFrequency: "Monthly", scheduleNotes: "1st Thursday, 7:00 PM.",
      description: "Monthly Thursday evening urban trail in Atlanta.",
    },
    {
      kennelCode: "duffh3", shortName: "DUFF H3", fullName: "DUFF Hash House Harriers", region: "Atlanta, GA",
      scheduleFrequency: "Monthly", scheduleNotes: "Monthly Wednesday.",
      description: "Monthly Wednesday hashing in Atlanta.",
    },
    {
      kennelCode: "soco-h3", shortName: "SoCo", fullName: "Southern Coven Hash House Harriers", region: "Atlanta, GA",
      scheduleFrequency: "Monthly", scheduleNotes: "3rd Friday.",
      description: "Monthly Friday hashing in Atlanta.",
    },
    {
      kennelCode: "sch3-atl", shortName: "Southern Comfort H3", fullName: "Southern Comfort Hash House Harriers", region: "Atlanta, GA",
      scheduleDayOfWeek: "Friday", scheduleTime: "7:00 PM", scheduleFrequency: "Biweekly",
      description: "Alternate Friday evening runs in Atlanta.",
    },
    {
      kennelCode: "hmh3", shortName: "HMH3", fullName: "Hog Mountain Hash House Harriers", region: "Atlanta, GA",
      scheduleFrequency: "Monthly", scheduleNotes: "1st Sunday, 1:30 PM.",
      description: "Monthly Sunday runs in the north Georgia foothills.",
    },
    {
      kennelCode: "cunth3-atl", shortName: "CUNT H3", fullName: "C U Next Tuesday H3", region: "Atlanta, GA",
      scheduleFrequency: "Monthly", scheduleNotes: "1st Tuesday, 7:00 PM.",
      description: "Monthly Tuesday evening trail in Atlanta.",
    },
    {
      kennelCode: "dsh3-atl", shortName: "DSH3", fullName: "Dark Side Hash House Harriers", region: "Atlanta, GA",
      scheduleNotes: "New moon schedule — check Facebook for dates.",
      description: "New moon trail runs in Atlanta. Schedule follows lunar calendar.",
    },
    // --- Savannah (update existing SavH3 — region fix + profile enrichment) ---
    {
      kennelCode: "savh3", shortName: "SavH3", fullName: "Savannah Hash House Harriers", region: "Savannah, GA",
      website: "https://www.meetup.com/savannah-hash-house-harriers/",
      facebookUrl: "https://www.facebook.com/groups/savh3",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Weekly",
      hashCash: "$5", foundedYear: 1990,
      description: "Weekly Saturday runs in the Savannah area.",
    },
    // --- Augusta ---
    {
      kennelCode: "pfh3", shortName: "PFH3", fullName: "Peach Fuzz Hash House Harriers", region: "Augusta, GA",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      description: "Alternate Wednesday evening runs in Augusta.",
    },
    {
      kennelCode: "augh3", shortName: "AUGH3", fullName: "Augusta Underground Hash House Harriers", region: "Augusta, GA",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      description: "Alternate Saturday runs in the Augusta area.",
    },
    // --- Macon ---
    {
      kennelCode: "mgh4", shortName: "MGH4", fullName: "Middle Georgia Hash House Harriers", region: "Macon, GA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      description: "Alternate Saturday runs in the Macon area.",
    },
    {
      kennelCode: "w3h3-ga", shortName: "Wed Wed Wed H3", fullName: "Wednesday Wednesday Wednesday H3", region: "Macon, GA",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Weekly Wednesday evening runs in Macon.",
    },
    // --- Columbus ---
    {
      kennelCode: "cvh3", shortName: "CVH3", fullName: "Chattahoochee Valley Hash House Harriers", region: "Columbus, GA",
      scheduleDayOfWeek: "Saturday", scheduleTime: "11:00 AM", scheduleFrequency: "Biweekly",
      description: "Alternate Saturday morning runs in the Columbus/Chattahoochee Valley area.",
    },
    // --- Rome ---
    {
      kennelCode: "r2h3", shortName: "R2H3", fullName: "Rumblin' Roman Hash House Harriers", region: "Rome, GA",
      scheduleFrequency: "Monthly", scheduleNotes: "2nd Saturday, 2:30 PM.",
      description: "Monthly Saturday runs in Rome, GA.",
    },
    // ===== SOUTH CAROLINA =====
    // --- Charleston ---
    {
      kennelCode: "ch3-sc", shortName: "Charleston H3", fullName: "Charleston Hash House Harriers", region: "Charleston, SC",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      foundedYear: 1988,
      description: "Weekly Thursday evening trail runs in Charleston.",
    },
    {
      kennelCode: "chh3", shortName: "CHH3", fullName: "Charleston Happy Heretics Hash House Harriers", region: "Charleston, SC",
      scheduleFrequency: "Biweekly", scheduleNotes: "2nd & 4th Saturdays, 2:00 PM winter / 4:00 PM summer.",
      website: "https://sites.google.com/site/charlestonhappyhereticsh3/",
      facebookUrl: "https://www.facebook.com/charlestonheretics",
      hashCash: "$5", foundedYear: 1997,
      description: "Biweekly Saturday runs in Charleston. Free for virgins.",
    },
    {
      kennelCode: "budh3", shortName: "BUDH3", fullName: "Beaufort Ugly Dog Hash House Harriers", region: "Charleston, SC",
      scheduleDayOfWeek: "Saturday", scheduleTime: "3:00 PM", scheduleFrequency: "Biweekly",
      foundedYear: 2008,
      description: "Alternate Saturday runs in the Beaufort area. Spawned from Savannah H3.",
    },
    // --- Columbia ---
    {
      kennelCode: "colh3", shortName: "ColH3", fullName: "Columbian Hash House Harriers", region: "Columbia, SC",
      scheduleFrequency: "Biweekly", scheduleNotes: "1st & 3rd Sundays, 3:00 PM winter / 5:00 PM summer.",
      facebookUrl: "https://www.facebook.com/groups/columbianh3/",
      hashCash: "$6", foundedYear: 1986,
      description: "Oldest kennel in South Carolina (1986). 1st & 3rd Sunday runs in Columbia. 21+ only.",
    },
    {
      kennelCode: "sech3", shortName: "SecH3", fullName: "Secession Hash House Harriers", region: "Columbia, SC",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      scheduleNotes: "Every other Saturday, 3:00 PM summer / 1:30 PM winter (monthly in winter).",
      foundedYear: 2009,
      description: "Alternate Saturday runs in the Columbia area. Spawned from Columbian H3.",
    },
    {
      kennelCode: "palh3", shortName: "PalH3", fullName: "Palmetto Hash House Harriers", region: "Columbia, SC",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly",
      facebookUrl: "https://www.facebook.com/PalmettoH3/",
      foundedYear: 2018,
      description: "Monthly Saturday runs based in Sumter, SC. Small kennel from Columbia-area hashers.",
    },
    // --- Greenville ---
    {
      kennelCode: "uh3", shortName: "UH3", fullName: "Upstate Hash House Harriers", region: "Greenville, SC",
      scheduleFrequency: "Biweekly", scheduleNotes: "Alternating Sundays & Saturdays (~4x/month).",
      website: "https://www.upstatehashers.com/",
      facebookUrl: "https://www.facebook.com/p/Upstate-Hash-House-Harriers-100087329174970/",
      foundedYear: 1998,
      description: "Most established Greenville kennel (~700 runs). 21+ only.",
    },
    {
      kennelCode: "goth3", shortName: "GOTH3", fullName: "Greenville's Other Hash House Harriers", region: "Greenville, SC",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly",
      scheduleNotes: "Monthly, ~2:30 PM (variable day).",
      foundedYear: 2022,
      description: "Casual walker/runner mix in Greenville.",
    },
    {
      kennelCode: "lth3", shortName: "LTH3", fullName: "Luna Ticks Hash House Harriers", region: "Greenville, SC",
      scheduleNotes: "Every full moon + new moon. Moon-phase schedule.",
      foundedYear: 2020,
      description: "Moon-phase trail runs in the Greenville area.",
    },
    // --- Myrtle Beach ---
    {
      kennelCode: "gsh3", shortName: "GSH3", fullName: "Grand Strand Hash House Harriers", region: "Myrtle Beach, SC",
      scheduleDayOfWeek: "Saturday", scheduleTime: "4:00 PM", scheduleFrequency: "Biweekly",
      facebookUrl: "https://www.facebook.com/GrandStrandHashing/",
      foundedYear: 2018,
      description: "Alternate Saturday runs in the Myrtle Beach area. Also hosts pub crawls.",
    },
    // ===== OREGON =====
    // --- Portland ---
    {
      kennelCode: "n2h3", shortName: "N2H3", fullName: "No Name Hash House Harriers",
      region: "Portland, OR",
      website: "https://beercheck.wixsite.com/nonameh3",
      scheduleDayOfWeek: "Thursday", scheduleTime: "6:45 PM", scheduleFrequency: "Weekly",
      hashCash: "$5",
      description: "Portland's weekly Thursday evening hash. Meet at 6:45, hare off at 7. Headlamp required for night trails.",
      latitude: 45.52, longitude: -122.68,
    },
    {
      kennelCode: "okh3", shortName: "OKH3", fullName: "Oregon Kahuna Hash House Harriers",
      region: "Portland, OR",
      website: "http://oregonkahunah3.pbworks.com/",
      scheduleDayOfWeek: "Monday", scheduleTime: "6:00 PM", scheduleFrequency: "Weekly",
      description: "Portland's Monday evening hash. Also runs as Ka-Three-Na and Katuna for alternating events.",
      latitude: 45.52, longitude: -122.68,
    },
    {
      kennelCode: "ph4", shortName: "PH4", fullName: "Portland Humpin' Hash House Harriers",
      region: "Portland, OR",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Portland's Wednesday evening hump day hash. Meets at 6:30, hare off at 7.",
      latitude: 45.52, longitude: -122.68,
    },
    {
      kennelCode: "stumph3", shortName: "StumpH3", fullName: "Stumptown Hash House Harriers",
      region: "Portland, OR",
      website: "https://stumptownh3.wordpress.com/",
      facebookUrl: "https://www.facebook.com/groups/stumptownh3",
      scheduleDayOfWeek: "Tuesday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      description: "Portland's bi-weekly Tuesday evening hash. Gather at 6:30, hares away at 7, pack follows at 7:15.",
      latitude: 45.52, longitude: -122.68,
    },
    {
      kennelCode: "dwh3", shortName: "DWH3", fullName: "Dead Whores Hash House Harriers",
      region: "Portland, OR",
      website: "https://www.dwh3portland.com/",
      scheduleDayOfWeek: "Sunday", scheduleTime: "12:00 PM", scheduleFrequency: "Monthly",
      foundedYear: 2001,
      description: "Portland's monthly Sunday afternoon hash. Founded 2001 in Lake Oswego. Female-oriented kennel, wankers welcome on analversaries.",
      latitude: 45.52, longitude: -122.68,
    },
    {
      kennelCode: "oh3", shortName: "OH3", fullName: "Oregon Hash House Harriers",
      region: "Portland, OR",
      website: "https://www.oregonhhh.org/",
      scheduleDayOfWeek: "Saturday", scheduleTime: "1:00 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Bi-weekly Saturdays plus full moon runs",
      description: "Oregon's flagship kennel. Bi-weekly Saturday afternoon trails plus full moon evening runs in the Portland metro area.",
      latitude: 45.52, longitude: -122.68,
    },
    {
      kennelCode: "swh3-or", shortName: "Portland SWH3", fullName: "SWH3 Hash House Harriers",
      region: "Portland, OR",
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Monthly",
      hashCash: "$5",
      description: "Monthly Saturday afternoon hash in the Portland-Vancouver metro area. Trails range across Oregon and SW Washington.",
      latitude: 45.52, longitude: -122.68,
    },
    {
      kennelCode: "tgif", shortName: "TGIF", fullName: "TGIF Hash House Harriers",
      region: "Portland, OR",
      scheduleDayOfWeek: "Friday", scheduleTime: "5:30 PM", scheduleFrequency: "Weekly",
      description: "Portland's Friday evening social hash and pubcrawl. A lighter-format end-of-week gathering.",
      latitude: 45.52, longitude: -122.68,
    },
    // --- Salem ---
    {
      kennelCode: "salemh3", shortName: "SalemH3", fullName: "Salem Hash House Harriers",
      region: "Salem, OR",
      facebookUrl: "https://www.facebook.com/groups/106108826725143",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:30 PM", scheduleFrequency: "Biweekly",
      hashCash: "$5",
      scheduleNotes: "Bi-weekly Saturdays plus full moon runs",
      description: "Salem's bi-weekly Saturday afternoon hash with occasional full moon evening runs.",
      latitude: 44.94, longitude: -123.04,
    },
    {
      kennelCode: "cch3-or", shortName: "CCH3", fullName: "Cherry City Hash House Harriers",
      region: "Salem, OR",
      scheduleFrequency: "Monthly",
      description: "Salem-area monthly hash. Named for Salem's cherry blossom heritage. Events held at parks around the Salem-Wilsonville area.",
      latitude: 44.94, longitude: -123.04,
    },
    // --- Eugene ---
    {
      kennelCode: "eh3-or", shortName: "Eugene H3", fullName: "Eugene Hash House Harriers",
      region: "Eugene, OR",
      website: "https://sites.google.com/site/eugenehasher/",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Weekly",
      hashCash: "$5",
      scheduleNotes: "Sundays plus weekly Friday Hashy Hour social",
      description: "Eugene's weekly Sunday hash with a 30-strong pack. Trails run 3-6 miles. Also hosts Friday evening Hashy Hours.",
      latitude: 44.05, longitude: -123.09,
    },
    // --- Bend ---
    {
      kennelCode: "coh3", shortName: "COH3", fullName: "Central Oregon Hash House Harriers",
      region: "Bend, OR",
      website: "https://sites.google.com/site/centraloregonhhh",
      scheduleFrequency: "Monthly",
      description: "Central Oregon's monthly hash based in Bend. 3-4 mile trails through high desert terrain with beer checks. Annual campout at Crescent Lake.",
      latitude: 44.06, longitude: -121.32,
    },
    // ===== WASHINGTON =====
    // --- Seattle ---
    {
      kennelCode: "sh3-wa", shortName: "SH3", fullName: "Seattle Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org", foundedYear: 1983,
      facebookUrl: "https://www.facebook.com/groups/25456554474/",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "2nd and 4th Saturday",
      description: "Seattle's flagship kennel. Founded 1983. Hosts the wh3.org regional aggregator for all Puget Sound area hashes.",
      latitude: 47.61, longitude: -122.33,
    },
    {
      kennelCode: "psh3", shortName: "PSH3", fullName: "Puget Sound Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org", foundedYear: 1981,
      scheduleFrequency: "Biweekly",
      scheduleNotes: "Men's hash. 1st/3rd Saturday 10:30am (winter Nov-Mar), 1st/3rd Thursday 6:30pm (summer Apr-Oct)",
      description: "Men's hash running biweekly across the Puget Sound region. Founded 1981, the oldest kennel in Washington state.",
      latitude: 47.50, longitude: -122.17,
    },
    {
      kennelCode: "nbh3-wa", shortName: "NBH3", fullName: "Puget Sound No Balls Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org", foundedYear: 1989,
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "Last Wednesday of the month. Women only.",
      description: "Women's hash in Seattle. Last Wednesday of the month at 6:30pm. Founded 1989.",
      latitude: 47.61, longitude: -122.33,
    },
    {
      kennelCode: "rch3-wa", shortName: "Rain City H3", fullName: "Rain City Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org",
      facebookUrl: "https://www.facebook.com/groups/25456554474/",
      scheduleDayOfWeek: "Sunday", scheduleTime: "12:00 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "Last Sunday. Shiggy hash.",
      description: "Seattle's shiggy hash. Last Sunday of the month at noon. Known for muddy, off-trail adventures.",
      latitude: 47.61, longitude: -122.26,
    },
    {
      kennelCode: "seamon-h3", shortName: "SeaMon", fullName: "SeaMon Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org",
      scheduleDayOfWeek: "Monday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      description: "Seattle's Monday night runner's hash. Weekly trails focused on running.",
      latitude: 47.61, longitude: -122.33,
    },
    {
      kennelCode: "cunth3-wa", shortName: "CUNTh", fullName: "C.U.N.Th Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org",
      scheduleDayOfWeek: "Thursday", scheduleFrequency: "Biweekly",
      scheduleNotes: "Twice monthly Thursday. Transit-friendly, light shiggy.",
      description: "Seattle-area transit-friendly hash with light shiggy. Runs twice monthly on Thursdays.",
      latitude: 47.61, longitude: -122.33,
    },
    {
      kennelCode: "taint-h3", shortName: "Taint", fullName: "Taint Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Monthly",
      scheduleNotes: "4th Saturday. Between Seattle and Tacoma, along the Hwy 18 corridor.",
      description: "It t'aint Seattle and it t'aint Tacoma. Monthly Saturday hash along the Highway 18 corridor between Seattle and Tacoma.",
      latitude: 47.40, longitude: -122.25,
    },
    {
      kennelCode: "seh3-wa", shortName: "SEH3", fullName: "South End Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org",
      scheduleFrequency: "Biweekly",
      description: "South Puget Sound area hash with happy hours and trails.",
      latitude: 47.40, longitude: -122.25,
    },
    {
      kennelCode: "leapyear-h3", shortName: "Leap Year", fullName: "Leap Year Hash House Harriers", region: "Seattle, WA",
      website: "https://wh3.org",
      scheduleFrequency: "Irregular",
      scheduleNotes: "Special events, not on a regular schedule",
      description: "Seattle-area special event hash.",
      latitude: 47.61, longitude: -122.33,
    },
    // --- Tacoma ---
    {
      kennelCode: "th3-wa", shortName: "Tacoma H3", fullName: "Tacoma Hash House Harriers", region: "Tacoma, WA",
      website: "https://wh3.org", foundedYear: 1987,
      facebookUrl: "https://www.facebook.com/groups/468065553263804/",
      scheduleDayOfWeek: "Saturday", scheduleTime: "3:00 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "1st Saturday",
      description: "Tacoma's monthly Saturday hash. Founded 1987.",
      latitude: 47.24, longitude: -122.44,
    },
    // --- Olympia ---
    {
      kennelCode: "ssh3-wa", shortName: "SSH3", fullName: "South Sound Hash House Harriers", region: "Olympia, WA",
      website: "https://wh3.org", foundedYear: 2008,
      facebookUrl: "https://www.facebook.com/groups/61039539820/",
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "3rd Saturday. Olympia/South Puget Sound/JBLM area.",
      description: "South Sound monthly Saturday hash in the Olympia, Lacey, and JBLM area. Founded 2008.",
      latitude: 47.04, longitude: -122.90,
    },
    // --- Bremerton/Kitsap ---
    {
      kennelCode: "giggity-h3", shortName: "Giggity", fullName: "Giggity Hash House Harriers", region: "Bremerton, WA",
      website: "https://wh3.org", foundedYear: 2015,
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Monthly",
      scheduleNotes: "1st Wednesday. Gig Harbor area.",
      description: "Monthly Wednesday evening hash in the Gig Harbor / Kitsap area. Founded 2015.",
      latitude: 47.33, longitude: -122.59,
    },
    {
      kennelCode: "hswtf-h3", shortName: "HSWTF", fullName: "Holy Sh*t! What the F*ck? Hash House Harriers", region: "Bremerton, WA",
      website: "https://hswtfh3.com", foundedYear: 2012,
      scheduleDayOfWeek: "Sunday", scheduleTime: "12:00 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Every other Sunday. Bremerton/Silverdale/Kitsap area.",
      description: "Biweekly Sunday hash in the Bremerton/Silverdale/Kitsap area. Founded 2012.",
      latitude: 47.57, longitude: -122.63,
    },
    // ===== COLORADO =====
    // Denver Metro
    {
      kennelCode: "dh3-co", shortName: "DH3", fullName: "Denver Hash House Harriers", region: "Denver, CO",
      website: "https://www.denverhash.com",
      facebookUrl: "https://www.facebook.com/groups/278463172274450",
      scheduleDayOfWeek: "Sunday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Every other Sunday",
      description: "Denver's flagship biweekly Sunday afternoon hash. One of Colorado's oldest kennels.",
      latitude: 39.74, longitude: -104.99,
    },
    {
      kennelCode: "mihi-huha", shortName: "MiHiHuHa", fullName: "Mile High Humpin' Hash House Harriers", region: "Denver, CO",
      facebookUrl: "https://www.facebook.com/MileHighH3/",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      description: "Denver's weekly Wednesday evening hash.",
      latitude: 39.74, longitude: -104.99,
    },
    // Boulder
    {
      kennelCode: "bh3-co", shortName: "BH3", fullName: "Boulder Hash House Harriers", region: "Boulder, CO",
      website: "https://boulderh3.com",
      facebookUrl: "https://www.facebook.com/groups/boulderh3/",
      instagramHandle: "boulderh3",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly",
      description: "Boulder's biweekly Saturday hash. Trails in and around Boulder County.",
      latitude: 40.01, longitude: -105.27,
    },
    // Fort Collins
    {
      kennelCode: "fch3-co", shortName: "Fort Collins H3", fullName: "Fort Collins Hash House Harriers", region: "Fort Collins, CO",
      scheduleDayOfWeek: "Saturday", scheduleTime: "12:00 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Last Saturday of month per Half-Mind, biweekly per calendar",
      description: "Fort Collins biweekly Saturday hash. Trail #305+ and counting.",
      latitude: 40.59, longitude: -105.08,
    },
    // Colorado Springs (3 sub-kennels on one calendar)
    {
      kennelCode: "pph4", shortName: "PPH4", fullName: "Pikes Peak Hash House Harriers", region: "Colorado Springs, CO",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      description: "Colorado Springs biweekly Saturday afternoon hash.",
      latitude: 38.83, longitude: -104.82,
    },
    {
      kennelCode: "kimchi-h3", shortName: "Kimchi", fullName: "Colorado Kimchi Hash House Harriers", region: "Colorado Springs, CO",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "Alternating Saturdays with PPH4",
      description: "Colorado Springs biweekly Saturday afternoon hash, alternating weeks with Pikes Peak.",
      latitude: 38.83, longitude: -104.82,
    },
    {
      kennelCode: "dim-h3", shortName: "DIM", fullName: "Damn It's Monday Hash House Harriers", region: "Colorado Springs, CO",
      scheduleDayOfWeek: "Monday", scheduleTime: "6:00 PM", scheduleFrequency: "Biweekly",
      description: "Colorado Springs biweekly Monday evening hash.",
      latitude: 38.83, longitude: -104.82,
    },
    // ===== MINNESOTA =====
    {
      kennelCode: "mh3-mn", shortName: "MH3", fullName: "Minneapolis Hash House Harriers", region: "Minneapolis, MN",
      website: "https://www.minneapolish3.com",
      facebookUrl: "https://www.facebook.com/MinneapolisHashHouseHarriers",
      scheduleDayOfWeek: "Sunday", scheduleTime: "3:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "3 PM during DST, 2 PM in winter",
      hashCash: "$6", foundedYear: 1989,
      description: "Minneapolis's flagship weekly Sunday hash. Minnesota's oldest kennel, founded 1989. Visitors and virgins hash free.",
      latitude: 44.98, longitude: -93.27,
    },
    {
      kennelCode: "t3h3", shortName: "T3H3", fullName: "Twin Titties Thirstday Hash House Harriers", region: "Minneapolis, MN",
      website: "https://www.minneapolish3.com",
      scheduleDayOfWeek: "Thursday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "Year-round. Hare off 7:15, pack off 7:30",
      hashCash: "$5", foundedYear: 2017,
      description: "Minneapolis weekly Thursday evening hash. Sister kennel of MH3, founded 2017. All A-to-A, all live trails, 3-4 miles.",
      latitude: 44.98, longitude: -93.27,
    },
    // ===== ARIZONA =====
    // Phoenix
    {
      kennelCode: "lbh-phx", shortName: "LBH", fullName: "Lost Boobs Hash House Harriers", region: "Phoenix, AZ",
      website: "https://www.phoenixhhh.org",
      scheduleDayOfWeek: "Monday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
      description: "Phoenix weekly Monday evening hash. Part of the phoenixhhh.org collective.",
      latitude: 33.45, longitude: -112.07,
    },
    {
      kennelCode: "hump-d", shortName: "Hump D", fullName: "Hump D Hash House Harriers", region: "Phoenix, AZ",
      website: "https://www.phoenixhhh.org",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "6:30 PM", scheduleFrequency: "Biweekly",
      description: "Phoenix biweekly Wednesday evening hash.",
      latitude: 33.45, longitude: -112.07,
    },
    {
      kennelCode: "wrong-way", shortName: "Wrong Way", fullName: "Phoenix Wrong Way Hash House Harriers", region: "Phoenix, AZ",
      website: "https://www.phoenixhhh.org",
      scheduleDayOfWeek: "Saturday", scheduleTime: "2:00 PM", scheduleFrequency: "Biweekly",
      scheduleNotes: "1st, 3rd, and 5th Saturday",
      description: "Phoenix Saturday afternoon hash. 1st, 3rd, and 5th Saturdays at 2 PM.",
      latitude: 33.45, longitude: -112.07,
    },
    {
      kennelCode: "fdtdd", shortName: "FDTDD", fullName: "From Dusk Till Down-Downs Hash", region: "Phoenix, AZ",
      website: "https://www.phoenixhhh.org",
      scheduleDayOfWeek: "Friday", scheduleTime: "6:30 PM", scheduleFrequency: "Monthly",
      description: "Phoenix monthly Friday evening hash.",
      latitude: 33.45, longitude: -112.07,
    },
    // Tucson
    {
      kennelCode: "jhav-h3", shortName: "jHav", fullName: "jHavelina Hash House Harriers", region: "Tucson, AZ",
      website: "https://tucsonhash.com",
      scheduleDayOfWeek: "Saturday", scheduleTime: "4:00 PM", scheduleFrequency: "Weekly",
      scheduleNotes: "3 PM in winter, 4 PM in spring/fall",
      description: "Tucson's original weekly Saturday hash. The jHavelina HHH, founded as the original Hash of Tucson. Trail #2070+ and counting.",
      latitude: 32.22, longitude: -110.97,
    },
    {
      kennelCode: "mrhappy", shortName: "Mr. Happy's", fullName: "Mr. Happy's Hash House Harriers", region: "Tucson, AZ",
      website: "https://tucsonhash.com",
      scheduleDayOfWeek: "Wednesday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
      description: "Tucson weekly Wednesday evening hash. 2-5 mile trails.",
      latitude: 32.22, longitude: -110.97,
    },
    {
      kennelCode: "pedalfiles", shortName: "Pedal Files", fullName: "Pedal Files Bash", region: "Tucson, AZ",
      website: "https://tucsonhash.com",
      scheduleDayOfWeek: "Sunday", scheduleTime: "10:00 AM", scheduleFrequency: "Monthly",
      scheduleNotes: "3rd Sunday",
      description: "Tucson monthly Sunday morning bike hash.",
      latitude: 32.22, longitude: -110.97,
    },
    // ===== OHIO =====
    // --- Dayton ---
    {
      kennelCode: "dh4", shortName: "DH4", fullName: "Dayton Hash House Harriers and Harriettes", region: "Dayton, OH",
      website: "https://daytonhhh.org/",
      facebookUrl: "https://www.facebook.com/DaytonHash",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "3:00 PM",
      scheduleNotes: "Every other Saturday 3-4 PM + Full Moon evenings 7 PM.",
      description: "Ohio's oldest and longest running hash kennel. Biweekly Saturday runs plus full moon trails.",
      latitude: 39.76, longitude: -84.19,
    },
    {
      kennelCode: "mvh3-day", shortName: "Miami Valley H3", fullName: "Miami Valley Hash House Harriers", region: "Dayton, OH",
      facebookUrl: "https://www.facebook.com/groups/1703366143261426",
      description: "Dayton-area kennel spawned from DH3.",
      latitude: 39.76, longitude: -84.19,
    },
    {
      kennelCode: "swot-h3", shortName: "SWOT", fullName: "South West Ohio Traditional Hash House Harriers", region: "Dayton, OH",
      scheduleDayOfWeek: "Sunday", scheduleFrequency: "Monthly", scheduleTime: "2:00 PM",
      scheduleNotes: "Last Sunday of each month.",
      description: "Traditional hash kennel covering south west Ohio. Monthly last-Sunday runs.",
      latitude: 39.50, longitude: -84.35,
    },
    // --- Cincinnati ---
    {
      kennelCode: "sch4", shortName: "SCH4", fullName: "Sin City Hash House Harriers and Harriettes", region: "Cincinnati, OH",
      website: "https://sincityhash.wordpress.com/",
      facebookUrl: "https://www.facebook.com/groups/114560698574609/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "3:00 PM",
      scheduleNotes: "Every other Saturday 3-4 PM + 3rd Thursday 7 PM.",
      description: "Cincinnati's primary hash kennel with 1,450+ trails.",
      latitude: 39.10, longitude: -84.51,
    },
    {
      kennelCode: "qch4", shortName: "QCH4", fullName: "Queen City Hash House Harriers and Harriettes", region: "Cincinnati, OH",
      facebookUrl: "https://www.facebook.com/groups/795791177265728/",
      scheduleDayOfWeek: "Tuesday", scheduleFrequency: "Biweekly", scheduleTime: "7:00 PM",
      description: "Cincinnati secondary kennel. Biweekly Tuesday evening runs.",
      latitude: 39.10, longitude: -84.51,
    },
    {
      kennelCode: "lvh3-cin", shortName: "Licking Valley H3", fullName: "Licking Valley Hash House Harriers", region: "Cincinnati, OH",
      facebookUrl: "https://www.facebook.com/Licking-Valley-Hash-House-Harriers-841860922532429/",
      scheduleFrequency: "Monthly",
      hashCash: "$8",
      description: "Monthly hash in Cincinnati and Northern Kentucky. Never cancels for weather.",
      latitude: 39.10, longitude: -84.51,
    },
    // --- Cleveland ---
    {
      kennelCode: "cleh4", shortName: "CleH4", fullName: "Cleveland Hash House Harriers and Harriettes", region: "Cleveland, OH",
      facebookUrl: "https://www.facebook.com/clevelandhash",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "3:00 PM",
      scheduleNotes: "1st and 3rd Saturday 3 PM + Full Moon 6:30 PM.",
      foundedYear: 2015,
      description: "Cleveland's hash kennel. 1st and 3rd Saturday runs plus full moon trails.",
      latitude: 41.50, longitude: -81.69,
    },
    // --- Akron ---
    {
      kennelCode: "rch3", shortName: "RCH3", fullName: "Rubber City Hash House Harriers", region: "Akron, OH",
      website: "https://akronhash.weebly.com/",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "3:00 PM",
      scheduleNotes: "2nd & 4th Saturday 3 PM + 1st & 3rd Thursday 6:30 PM (summer).",
      hashCash: "$15", foundedYear: 2004,
      description: "Akron's hash kennel with 1,000+ Meetup members. Also runs summer Thursday evening trails.",
      latitude: 41.08, longitude: -81.52,
    },
    // --- Columbus ---
    {
      kennelCode: "renh3", shortName: "RH3C", fullName: "Renegade Hash House Harriers Columbus", region: "Columbus, OH",
      website: "https://www.renegadeh3.com/",
      facebookUrl: "https://www.facebook.com/rh3columbus/",
      twitterHandle: "RenegadeH3",
      scheduleDayOfWeek: "Saturday", scheduleFrequency: "Biweekly", scheduleTime: "2:00 PM",
      scheduleNotes: "Every other Saturday + monthly Friday night.",
      hashCash: "$8", foundedYear: 2014,
      description: "Columbus's hash kennel, established 2014. Biweekly Saturday trail runs.",
      latitude: 39.96, longitude: -82.99,
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
    // Upstate New York
    "soh4": ["SOH4", "Syracuse Hash", "Syracuse On On Dog A", "Syracuse On-On-Dog-A", "SOOD"],
    "halvemein": ["Halve Mein", "HMHHH", "Albany Hash", "Albany HHH", "Capital District Hash", "Halve Mein Hash"],
    "ih3": ["IH3", "Ithaca Hash", "Ithaca HHH", "Ithaca H3"],
    "flour-city": ["Flour City", "FCH3", "FCHHH", "Flour City Hash", "Rochester Hash", "Flour City HHH"],
    "bh3": ["BH3", "Buffalo Hash", "Hash in the Buff", "Buffalo HHH"],
    "hvh3-ny": ["HVH3 NY", "Hudson Valley Hash", "HV H3", "Hudson Valley HHH", "HVH3"],
    // Pennsylvania (outside Philly)
    "pgh-h3": ["PGH H3", "Pittsburgh Hash", "PGH", "Pittsburgh HHH"],
    "ich3": ["ICH3", "Iron City Hash", "Iron City", "Iron City HHH"],
    "nvhhh": ["NVHHH", "Nittany Valley Hash", "Nittany Valley", "NV Hash", "State College Hash"],
    "lvh3": ["LVH3", "Lehigh Valley Hash", "Lehigh Valley HHH"],
    "rh3": ["RH3", "Reading Hash", "Reading HHH"],
    "h5-hash": ["H5", "Harrisburg Hash", "Harrisburg-Hershey Hash", "H5 Hash", "Hershey Hash"],
    // Delaware
    "hockessin": ["Hockessin", "H4", "Hockessin Hash", "Hockessin HHH"],
    // Virginia (outside DC metro)
    "rvah3": ["RH3", "RVAH3", "Richmond Hash", "Richmond HHH", "RVA Hash"],
    "feh3": ["FEH3", "Fort Eustis Hash", "Fort Eustis", "Ft Eustis Hash", "Fort Eustis HHH"],
    "bdsmh3": ["BDSMH3", "BDSM Hash", "Bad Decisions Hash", "Bad Decisions Start Monday"],
    "cvilleh3": ["CvilleH3", "Charlottesville Hash", "Harlots", "cHARLOTtesville Hash", "Cville Hash"],
    "twh3": ["TH3", "Tidewater Hash", "Tidewater", "Tidewater HHH", "TH3 VA"],
    "7h4": ["7H4", "Seven Hills Hash", "Seven Hills", "7 Hills Hash"],
    // North Carolina
    "swh3": ["SWH3", "Sir Walter's", "Sir Walters", "Sir Walter's Hash", "Sir Walters Hash"],
    "larrikins": ["Larrikins", "Carolina Larrikins", "CLH3", "Larrikins H3"],
    "ch3-nc": ["CH3 NC", "Charlotte Hash", "Charlotte HHH", "Charlotte H3", "CH3"],
    "avlh3": ["AVLH3", "Asheville Hash", "AVL Hash", "Asheville HHH"],
    "cfh3": ["CFH3", "Cape Fear Hash", "Cape Fear", "Cape Fear HHH"],
    "ctrh3": ["CTrH3", "Carolina Trash", "Carolina Trash Hash", "Fayetteville Hash"],
    // Vermont
    "vth3": ["Von Tramp", "Von Tramp H3", "VTH3", "VT Hash"],
    "burlyh3": ["Burlington Hash", "Burlington H3", "BH3 Vermont", "BTVHHH", "BTV H3", "BTVH3"],
    // Connecticut
    "narwhal-h3": ["Narwhal", "Narwhal H3", "Narwhal Hash", "NarH3"],
    "sbh3-ct": ["Skull & Boners", "Skull and Boners", "SBH3", "S&B H3", "Skull Boners"],
    "rgh3": ["Rotten Groton", "Rotten Groton H3", "Groton H3", "Groton Hash", "RGH3"],
    // Rhode Island
    "rih3": ["RIH3", "Rhode Island Hash", "RI H3", "RI Hash", "Rhode Island HHH"],
    // Ohio
    "dh4": ["DH4", "DH3", "Dayton H4", "Dayton H3", "Dayton Hash", "Dayton HHH"],
    "mvh3-day": ["MVH3", "Miami Valley H3", "Miami Valley Hash"],
    "swot-h3": ["SWOT", "SWOT H3", "South West Ohio Traditional"],
    "sch4": ["SCH4", "Sin City H4", "Sin City Hash", "Cincinnati Hash"],
    "qch4": ["QCH4", "QCH3", "Queen City H4", "Queen City Hash"],
    "lvh3-cin": ["LVH3", "Licking Valley H3", "Licking Valley Hash"],
    "cleh4": ["CleH4", "Cleveland H4", "Cleveland Hash", "Cleveland H3"],
    "rch3": ["RCH3", "Rubber City H3", "Rubber City Hash", "Akron Hash", "RCH3-OH"],
    "renh3": ["RH3", "Renegade H3", "Renegade Hash", "RH3 Columbus", "RH3C"],
    // Massachusetts
    "hvh3": ["HVH3", "Happy Valley", "Happy Valley H3", "HV H3"],
    "413h3": ["413H3", "413 H3"],
    "zigzag": ["ZigZag", "Zig Zag", "Zig-Zag", "ZZH3", "Zig Zag H3"],
    "e4b": ["E4B", "E4BH3", "Eager4Beaver", "Eager 4 Beaver", "Eager 4 Beaver H3"],
    "nbh3": ["NbH3", "Northboro H3", "BS Hash", "Boston Suburbs Hash", "BSH3", "Northboro"],
    "poofh3": ["PooFH3", "PooFlingers", "Poo Flingers", "PooF", "PooF H3"],
    "summit": ["Summit", "Summit H3", "Summit Hash", "SH3"],
    "sfm": ["SFM", "SFM H3", "Summit Full Moon", "Summit Full Moon H3"],
    "asssh3": ["ASSSH3", "ASSS H3", "All Seasons Summit Shiggy"],
    "rumson": ["RH3", "Rumson H3", "Rumson Hash", "Rumson HHH"],
    // Chicago area
    "ch3": ["Chicago Hash", "Chicago H3", "CHH3", "CH3"],
    "th3": ["Thirstday", "Thirstday Hash", "Thirstday H3", "Thursday Hash", "TH3"],
    "cfmh3": ["Chicago Full Moon", "Chicago Full Moon Hash", "Chicago Moon Hash"],
    "fcmh3": ["First Crack", "First Crack H3", "First Crack of the Moon", "New Moon Hash"],
    "bdh3": ["Big Dogs", "Big Dogs H3", "Big Dogs Hash"],
    "bmh3": ["Bushman", "Bushman H3", "Bushman Hash", "The Greatest Hash", "BMH3"],
    "2ch3": ["Second City", "Second City H3", "Second City Hash"],
    "wwh3": ["Whiskey Wednesday", "Whiskey Wednesday Hash", "WWW H3"],
    "4x2h4": ["4x2 H4", "Four by Two H4", "4x2 Hash", "Four by Two"],
    "rth3": ["Ragtime", "Ragtime Hash", "Brunch Hash"],
    "dlh3": ["Duneland", "Duneland H3", "South Shore HHH"],
    // DC / DMV area
    "ewh3": ["Everyday is Wednesday", "Every Day is Wednesday"],
    "shith3": ["SHIT H3", "S.H.I.T. H3", "So Happy It's Tuesday"],
    "cch3": ["Charm City", "Charm City Hash", "Charm City H3", "CCH3"],
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
    "h4": ["Hangover Hash", "Hangover H3", "Hangover", "H4"],
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
    "lh3": ["London Hash", "London H3", "London Hash House Harriers", "LH3"],
    "cityh3": ["City Hash", "City H3"],
    "wlh3": ["West London Hash", "West London H3", "WLH"],
    "barnesh3": ["Barnes Hash", "Barnes H3"],
    "och3": ["Old Coulsdon", "Old Coulsdon Hash", "OC Hash"],
    "slh3": ["SLASH", "SLAH3", "South London Hash"],
    "fukfm": ["FUKFMH3", "FUK Full Moon", "First UK Full Moon"],
    "eh3": ["Enfield Hash", "Enfield H3", "EH3"],
    "ch4": ["Catch the Hare", "CTH"],
    "cunth3": ["CUNT H3", "Currently Unnamed North Thames"],
    // Ireland
    "dh3": ["Dublin H3", "Dublin HHH", "Dublin Hash", "DH3", "I Love Monday"],
    // Texas
    "ah3": ["Austin Hash", "Austin H3", "AH3", "Austin HHH"],
    "kawh3": ["Keep Austin Weird", "KAW!H3", "KAW H3", "KAWH3", "Keep Austin Weird Hash"],
    "h4-tx": ["Houston Hash", "Houston H3", "H4 Houston", "Houston HHH", "H-Town Hash", "H4"],
    "bmh3-tx": ["Brass Monkey", "Brass Monkey H3", "Brass Monkey Hash", "Team Brass Monkey"],
    "mosquito-h3": ["Mosquito Hash", "Mosquito H3", "Mosquito HHH"],
    "dh3-tx": ["Dallas Hash", "Dallas H3", "DH3 Dallas", "Dallas HHH", "DH3"],
    "duhhh": ["Dallas Urban Hash", "DUHHH", "DUH H3", "Dallas Urban"],
    "noduhhh": ["NODUHHH", "North Dallas Hash", "North of Dallas Urban", "NoDUHHH"],
    "fwh3": ["Fort Worth Hash", "Fort Worth H3", "FWH3", "Ft Worth Hash"],
    "sah3": ["San Antonio Hash", "San Antonio H3", "SAH3", "SA Hash"],
    "c2h3": ["Corpus Christi Hash", "Corpus Christi H3", "C2H3", "CC Hash"],
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
    "lh3-fl": ["Lakeland Hash", "LH3"],
    "barf-h3": ["BARF Hash", "Bay Area Frolic", "BARF H3"],
    "sbh3": ["Spring Brooks Hash", "SB H3", "SBH3"],
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
    // Georgia
    "ah4": ["Atlanta Hash", "Atlanta H4", "Atlanta HHH", "AH4 Hash", "Atlanta Hash (Saturdays)", "AHHH"],
    "ph3-atl": ["Pinelake Hash", "Pinelake H3", "PH3 ATL"],
    "bsh3": ["Black Sheep Hash", "Black Sheep H3", "BSH3 Hash"],
    "sobh3": ["Slow Old Bastards", "SOB Hash", "SOB H3", "SOBH3 Hash"],
    "mlh4": ["Moonlite Hash", "Atlanta Moonlite", "Moonlite H3", "Moonlite H4"],
    "whh3": ["Wheelhopper Hash", "Wheelhopper H3", "Mountain Bike Hash"],
    "sluth3": ["SLUT Hash", "Short Lazy Urban Thursday"],
    "duffh3": ["DUFF Hash", "DUFF H3"],
    "soco-h3": ["Southern Coven", "SoCo Hash", "SoCo H3"],
    "sch3-atl": ["Southern Comfort Hash", "Southern Comfort H3", "SCH3 ATL", "SCH3"],
    "hmh3": ["Hog Mountain Hash", "Hog Mountain H3"],
    "cunth3-atl": ["C U Next Tuesday", "CUNT Hash ATL"],
    "dsh3-atl": ["Dark Side Hash", "Dark Side H3", "DSH3 ATL"],
    "savh3": ["Savannah Hash", "SavH3", "Savannah H3", "SAV H3"],
    "pfh3": ["Peach Fuzz Hash", "Peach Fuzz H3"],
    "augh3": ["Augusta Underground", "Augusta Hash", "AUG H3"],
    "mgh4": ["Middle Georgia Hash", "Middle GA H3", "MGH4 Hash"],
    "w3h3-ga": ["Wednesday Wednesday Wednesday", "W3H3 Macon", "WWW H3 GA", "W3H3"],
    "cvh3": ["Chattahoochee Valley Hash", "Columbus Hash", "CV H3"],
    "r2h3": ["Rumblin Roman Hash", "Rome Hash", "R2H3 Hash"],
    // South Carolina
    "ch3-sc": ["Charleston Hash", "Charleston H3", "Charleston HHH", "CSCH3", "CH3"],
    "chh3": ["Charleston Heretics", "Charleston Happy Heretics", "Charleston Heretics H3", "Happy Heretics"],
    "budh3": ["Beaufort Ugly Dog", "Beaufort H3", "BUD H3"],
    "colh3": ["Columbian H3", "Columbian Hash", "Columbia H3", "Columbia Hash"],
    "sech3": ["Secession H3", "Secession Hash", "SHHH"],
    "palh3": ["Palmetto H3", "Palmetto Hash"],
    "uh3": ["Upstate H3", "Upstate Hash", "Upstate Hashers", "UHHH"],
    "goth3": ["Greenville's Other H3", "Greenville's Other Hash", "GOH3", "GothH3"],
    "lth3": ["Luna Ticks", "LunaTicks H3", "Luna Ticks Hash"],
    "gsh3": ["Grand Strand H3", "Grand Strand Hash", "Myrtle Beach H3", "Myrtle Beach Hash"],
    // ===== OREGON =====
    "n2h3": ["No Name Hash", "N2H3", "No Name H3", "N3H3", "Portland No Name"],
    "okh3": ["Kahuna Hash", "Kahuna H3", "Ka-Three-Na", "Katuna", "OKH3", "Oregon Kahuna"],
    "ph4": ["Hump Hash", "Portland Hump Hash", "Portland Humpin Hash", "PH4", "Humpin Hash"],
    "stumph3": ["Stumptown Hash", "Stumptown H3", "StumpH3", "Stump"],
    "dwh3": ["Dead Whores Hash", "Dead Whores H3", "DWH3", "DWH"],
    "oh3": ["Oregon Hash", "Oregon H3", "OH3", "OregonH3", "PDXGDRH3"],
    "swh3-or": ["SWH3"],
    "tgif": ["TGIF Hash", "TGIF H3"],
    "salemh3": ["Salem Hash", "Salem H3", "SalemH3", "SH3 Salem"],
    "cch3-or": ["Cherry City Hash", "Cherry City H3", "CCH3", "Cherry City"],
    "eh3-or": ["Eugene Hash", "Eugene H3", "EH3", "Eugene HHH", "EHHH"],
    "coh3": ["Central Oregon Hash", "Central Oregon H3", "COH3", "Bend Hash"],
    // ===== WASHINGTON =====
    "sh3-wa": ["Seattle Hash", "Seattle H3", "SH3", "WAH3"],
    "psh3": ["Puget Sound Hash", "Puget Sound H3", "PSH3"],
    "nbh3-wa": ["No Balls Hash", "No Balls H3", "NBH3", "Puget Sound No Balls"],
    "rch3-wa": ["Rain City Hash", "Rain City H3", "RCH3"],
    "seamon-h3": ["SeaMon Hash", "SeaMon H3", "Sea Monster Hash"],
    "cunth3-wa": ["CUNTh Hash", "CUNTh H3", "CUNTH3"],
    "taint-h3": ["Taint Hash", "Taint H3"],
    "seh3-wa": ["South End Hash", "South End H3", "SEH3"],
    "leapyear-h3": ["Leap Year Hash", "Leap Year H3"],
    "th3-wa": ["Tacoma Hash", "Tacoma H3", "TH3"],
    "ssh3-wa": ["South Sound Hash", "South Sound H3", "SSH3"],
    "giggity-h3": ["Giggity Hash", "Giggity H3"],
    "hswtf-h3": ["HSWTF Hash", "HSWTF H3", "Holy Shit What The Fuck"],
    // ===== COLORADO =====
    "dh3-co": ["Denver Hash", "Denver H3", "DH3", "DenverH3"],
    "mihi-huha": ["Mile High Humpin Hash", "MiHiHuHa", "Mile High H3", "MHHH3"],
    "bh3-co": ["Boulder Hash", "Boulder H3", "BH3"],
    "fch3-co": ["Fort Collins Hash", "Fort Collins H3", "FCH3", "FoCo Hash"],
    "pph4": ["Pikes Peak Hash", "Pikes Peak H3", "PPH3", "PP H3"],
    "kimchi-h3": ["Kimchi Hash", "Colorado Kimchi", "Kimchi H3"],
    "dim-h3": ["Damn Its Monday Hash", "DIM H3", "DIM Hash"],
    // ===== MINNESOTA =====
    "mh3-mn": ["Minneapolis Hash", "Minneapolis H3", "MH3", "MplsH3"],
    "t3h3": ["Twin Titties Hash", "Twin Titties Thirstday", "T3H3", "TTTH3"],
    // ===== ARIZONA =====
    "lbh-phx": ["Lost Boobs Hash", "Lost Boobs H3", "LBH", "Phoenix LBH"],
    "hump-d": ["Hump D Hash", "Hump D H3", "HumpD"],
    "wrong-way": ["Wrong Way Hash", "Wrong Way H3", "Phoenix Wrong Way"],
    "fdtdd": ["From Dusk Till Down-Downs", "Dusk Till Down", "FDTDD"],
    "jhav-h3": ["jHavelina Hash", "jHavelina H3", "jHav", "Tucson Hash"],
    "mrhappy": ["Mr Happy's Hash", "Mr Happy's H3", "Mr Happy"],
    "pedalfiles": ["Pedal Files Hash", "Pedal Files H3", "Tucson Bike Hash"],
    // ===== CALIFORNIA =====
    "sch3-ca": ["Surf City Hash", "Surf City H3", "SCH3", "Santa Cruz Hash"],
    "lah3": ["Los Angeles Hash", "LAH3 Hash", "LA Hash House Harriers"],
    "lbh3": ["Long Beach Hash", "LBH3 Hash", "Long Beach H3"],
    "tdh3-lb": ["Throw Down Hash", "Throw Down H3", "TDH3"],
    "gal-h3": ["Get A Life Hash", "Get A Life H3", "GAL H3"],
    "suph3": ["Stand Up Paddling Hash", "SUP H3", "SUP-H3", "Paddle Hash"],
    "fth3": ["Foothill Hash", "Foothill H3"],
    "elah3": ["East LA Hash", "East LA H3", "East Los Angeles Hash"],
    "sgh3": ["Signal Hill Hash", "Signal Hill H3"],
    "sdh3": ["San Diego Hash", "SD Hash", "SD H3", "San Diego H3"],
    "clh3-sd": ["Larrikins Hash", "California Larrikins", "Larrikins H3", "CLH3"],
    "ljh3": ["La Jolla Hash", "La Jolla H3", "LJH3"],
    "nch3-sd": ["North County Hash", "North County H3", "NCH3"],
    "irh3-sd": ["Iron Rule Hash", "Iron Rule H3", "IRH3"],
    "humpin-sd": ["Humpin Hash", "Humpin H3", "Humpin'"],
    "fmh3-sd": ["Full Moon Hash SD", "SD Full Moon", "FMH3"],
    "hah3-sd": ["Half-Assed Hash", "Half Assed H3", "HAH3"],
    "mh4-sd": ["Mission Harriettes Hash", "Mission H4", "MH4"],
    "drh3-sd": ["Diaper Rash Hash", "Diaper Rash H3", "DRH3"],
    "ochhh": ["Orange County Hash", "OC Hash", "OCHHH", "OC H3"],
    "ochump": ["OC Hump Hash", "OC Hump H3"],
    "sloh3": ["San Luis Obispo Hash", "SLO Hash", "SLO H3", "SLOH3"],
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
          ["CH3|Chicago Hash|Chicago H3", "Chicago H3"],
          ["TH3|Thirstday|Thursday Hash", "Thirstday H3"],
          ["CFMH3|Chicago Full Moon|Full Moon Hash|Full Moon H3|Moon Hash", "CFMH3"],
          ["FCMH3|First Crack", "FCMH3"],
          ["BDH3|Big Dogs", "BDH3"],
          ["BMH3|Bushman", "Bushman H3"],
          ["2CH3|Second City", "2CH3"],
          ["WWH3|Whiskey Wednesday", "WWH3"],
          ["4X2|4x2", "4X2H4"],
          ["RTH3|Ragtime", "RTH3"],
          ["DLH3|Duneland|South Shore", "DLH3"],
        ],
        defaultKennelTag: "Chicago H3",
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
        defaultTitle: "Wild & Wonderful Wednesday Trail",
      },
      kennelCodes: ["w3h3"],
    },
    // London, UK
    {
      name: "City Hash Makesweat",
      url: "https://makesweat.com/cityhash#hashes",
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
    // Ireland
    {
      name: "Dublin H3 Website Hareline",
      url: "https://dublinhhh.com/hareline",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      kennelCodes: ["dh3"],
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
          ["^CCH3", "Charm City H3"],
          ["^Trail\\s*#", "Charm City H3"],
        ],
        defaultKennelTag: "Charm City H3",
        titleHarePattern: "~\\s*(.+)$",
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
        // BAH3 uses emoji-prefixed labels: "🎯 Hares (loud and clear):" and "Where:addr"
        harePatterns: [String.raw`(?:^|\n)\s*[^\n]*Hares?[^:]*:\s*(.+?)(?:\n|$)`],
        locationPatterns: [String.raw`(?:^|\n)\s*Where\s*:?\s*(.+?)(?:\n|$)`],
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
        kennelSlugs: ["BFMH3", "EWH3", "WH4", "GFH3", "Chicago H3", "DCH4", "DCFMH3", "FCH3", "OregonH3"],
      },
      kennelCodes: ["bfm", "ewh3", "wh4", "gfh3", "ch3", "dch4", "dcfmh3", "fch3", "oh3"],
    },
    // ===== TEXAS =====
    // --- Austin (2 Google Calendars) ---
    {
      name: "Austin H3 Calendar",
      url: "austin.ah3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "AH3",
      },
      kennelCodes: ["ah3"],
    },
    {
      name: "Keep Austin Weird H3 Calendar",
      url: "o2v8lpb3bs3kpohpi6hd0g426k@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "KAW!H3",
      },
      kennelCodes: ["kawh3"],
    },
    // --- Houston (1 Google Calendar + 1 Blogger + 2 Static Schedules) ---
    {
      name: "Houston Hash Calendar",
      url: "houstonhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        kennelPatterns: [
          ["Mosquito", "Mosquito H3"],
        ],
        defaultKennelTag: "Houston H3",
      },
      kennelCodes: ["h4-tx", "mosquito-h3"],
    },
    {
      name: "Brass Monkey H3 Blog",
      url: "https://teambrassmonkey.blogspot.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      kennelCodes: ["bmh3-tx"],
    },
    {
      name: "Mosquito H3 Static Schedule (1st Wed)",
      url: "https://www.facebook.com/groups/MosquitoH3/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "Mosquito H3",
        rrule: "FREQ=MONTHLY;BYDAY=1WE",
        startTime: "18:30",
        defaultTitle: "Mosquito H3 Bimonthly Run",
        defaultLocation: "Houston, TX",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/MosquitoH3/ for updates on locations.",
      },
      kennelCodes: ["mosquito-h3"],
    },
    {
      name: "Mosquito H3 Static Schedule (3rd Wed)",
      url: "https://www.facebook.com/groups/MosquitoH3/#3rd-wed",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "Mosquito H3",
        rrule: "FREQ=MONTHLY;BYDAY=3WE",
        startTime: "18:30",
        defaultTitle: "Mosquito H3 Bimonthly Run",
        defaultLocation: "Houston, TX",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/MosquitoH3/ for updates on locations.",
      },
      kennelCodes: ["mosquito-h3"],
    },
    // --- DFW (1 HTML scraper — PHP calendar covering 4 kennels) ---
    {
      name: "DFW Hash Calendar",
      url: "http://www.dfwhhh.org/calendar/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["dh3-tx", "duhhh", "noduhhh", "fwh3"],
    },
    // --- Corpus Christi (1 Google Calendar) ---
    {
      name: "Corpus Christi H3 Calendar",
      url: "c2h3hash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "C2H3",
      },
      kennelCodes: ["c2h3"],
    },
    // ===== UPSTATE NEW YORK =====
    // --- Rochester (Google Calendar) ---
    {
      name: "Flour City H3 Google Calendar",
      url: "flourcitymismanagement@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "Flour City H3",
      },
      kennelCodes: ["flour-city"],
    },
    // --- Syracuse (HTML scraper) ---
    {
      name: "SOH4 Website",
      url: "https://www.soh4.com/trails/feed/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { defaultKennelTag: "SOH4" },
      kennelCodes: ["soh4"],
    },
    // --- Capital District (HTML scraper) ---
    {
      name: "Halve Mein Website",
      url: "https://www.hmhhh.com/index.php?log=upcoming.con",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { defaultKennelTag: "HMHHH" },
      kennelCodes: ["halvemein"],
    },
    // --- Ithaca (HTML scraper) ---
    {
      name: "IH3 Website Hareline",
      url: "http://ithacah3.org/hare-line/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { defaultKennelTag: "IH3" },
      kennelCodes: ["ih3"],
    },
    // --- Buffalo (Google Calendar) ---
    {
      name: "Buffalo H3 Google Calendar",
      url: "hashinthebuff@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "Buffalo H3",
      },
      kennelCodes: ["bh3"],
    },
    // --- Hudson Valley (Meetup) ---
    {
      name: "Hudson Valley H3 Meetup",
      url: "https://www.meetup.com/Hudson-Valley-Hash-House-Harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "Hudson-Valley-Hash-House-Harriers",
        kennelTag: "Hudson Valley H3",
      },
      kennelCodes: ["hvh3-ny"],
    },
    // ===== PENNSYLVANIA (outside Philly) =====
    // --- Pittsburgh (Google Calendar aggregator) ---
    {
      name: "Pittsburgh Hash Calendar",
      url: "pghhashcalendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "PGH H3",
      },
      kennelCodes: ["pgh-h3"],
    },
    // --- Pittsburgh (Iron City iCal feed) ---
    {
      name: "Iron City H3 iCal Feed",
      url: "https://ironcityh3.com/?post_type=tribe_events&ical=1&eventDisplay=list",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        defaultKennelTag: "ICH3",
      },
      kennelCodes: ["ich3"],
    },
    // --- State College (Nittany Valley Google Calendar) ---
    {
      name: "Nittany Valley H3 Calendar",
      url: "55k6rnam11akkav5vljqlsc6lo@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "NVHHH",
      },
      kennelCodes: ["nvhhh"],
    },
    // --- Lehigh Valley (Google Calendar — FB is primary, calendar may be sparse) ---
    {
      name: "LVH3 Hareline Calendar",
      url: "lvh3hashflash@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "LVH3",
        descriptionSuffix: "Check the LVH3 Facebook page for the latest event details and updates: https://www.facebook.com/groups/lvh3/",
      },
      kennelCodes: ["lvh3"],
    },
    // --- Reading (Localendar iCal feed) ---
    {
      name: "Reading H3 Localendar",
      url: "https://localendar.com/public/readinghhh?style=X2",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        defaultKennelTag: "RH3",
      },
      kennelCodes: ["rh3"],
    },
    // --- Harrisburg-Hershey (Google Calendar) ---
    {
      name: "H5 Google Calendar",
      url: "harrisburghersheyh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "H5",
      },
      kennelCodes: ["h5-hash"],
    },
    // ===== DELAWARE =====
    // --- Hockessin (HTML scraper) ---
    {
      name: "Hockessin H3 Website",
      url: "https://www.hockessinhash.org/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { defaultKennelTag: "Hockessin H3" },
      kennelCodes: ["hockessin"],
    },
    // ===== VIRGINIA (outside DC metro) =====
    // --- Richmond (Calendar + Meetup) ---
    {
      name: "Richmond H3 Google Calendar",
      url: "979d12b454f944e14bd00e8d0d0c30b1109d6e5f37ec4817542ae35f86f90ae8@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { defaultKennelTag: "RVAH3" },
      kennelCodes: ["rvah3"],
    },
    {
      name: "Richmond H3 Meetup",
      url: "https://www.meetup.com/richmond-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "richmond-hash-house-harriers", kennelTag: "RVAH3" },
      kennelCodes: ["rvah3"],
    },
    // --- Fort Eustis (Calendar + Meetup) ---
    {
      name: "Fort Eustis H3 Google Calendar",
      url: "ft.eustish3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { defaultKennelTag: "FEH3" },
      kennelCodes: ["feh3"],
    },
    {
      name: "Fort Eustis H3 Meetup",
      url: "https://www.meetup.com/FEH3-Hash/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "FEH3-Hash", kennelTag: "FEH3" },
      kennelCodes: ["feh3"],
    },
    // --- BDSM H3 (Meetup) ---
    {
      name: "BDSM H3 Meetup",
      url: "https://www.meetup.com/BDSM-Hash-House-Harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "BDSM-Hash-House-Harriers", kennelTag: "BDSMH3" },
      kennelCodes: ["bdsmh3"],
    },
    // --- cHARLOTtesville (Meetup) ---
    {
      name: "cHARLOTtesville H3 Meetup",
      url: "https://www.meetup.com/meetup-group-xxcniptw/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { groupUrlname: "meetup-group-xxcniptw", kennelTag: "CvilleH3" },
      kennelCodes: ["cvilleh3"],
    },
    // --- Fredericksburg (Static Schedule — kennel already exists, adding source) ---
    {
      name: "FUH3 Static Schedule",
      url: "https://www.facebook.com/groups/fuh3va/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "FUH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-08",
        startTime: "15:00",
        defaultTitle: "FUH3 Biweekly Run",
        defaultLocation: "Fredericksburg, VA",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/fuh3va/ for updates on locations.",
      },
      kennelCodes: ["fuh3"],
    },
    // --- Tidewater (Static Schedule — main Sunday trail only) ---
    {
      name: "Tidewater H3 Static Schedule",
      url: "https://www.facebook.com/groups/SEVAHHH",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "Tidewater H3",
        rrule: "FREQ=WEEKLY;BYDAY=SU",
        startTime: "14:00",
        defaultTitle: "Tidewater H3 Weekly Run",
        defaultLocation: "Virginia Beach, VA",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/SEVAHHH for updates on locations and times. Times vary seasonally.",
      },
      kennelCodes: ["twh3"],
    },
    // --- Lynchburg (Static Schedule — Wednesday only) ---
    {
      name: "Seven Hills H3 Static Schedule",
      url: "https://www.facebook.com/groups/41511405734/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "7H4",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        startTime: "18:30",
        defaultTitle: "Seven Hills H3 Weekly Run",
        defaultLocation: "Lynchburg, VA",
        defaultDescription: "Check the Facebook page at https://www.facebook.com/groups/41511405734/ for updates on locations.",
      },
      kennelCodes: ["7h4"],
    },
    // ===== NORTH CAROLINA =====
    // --- Raleigh / Triangle ---
    {
      name: "SWH3 Google Calendar",
      url: "sirwaltersh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { defaultKennelTag: "SWH3" },
      kennelCodes: ["swh3"],
    },
    {
      name: "SWH3 Trail Announcements",
      url: "https://swh3.wordpress.com/category/trail-announcements/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      kennelCodes: ["swh3"],
    },
    {
      name: "Carolina Larrikins Google Calendar",
      url: "3p2vupffo2qukm6ee8gg9clo3o@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: { defaultKennelTag: "Larrikins" },
      kennelCodes: ["larrikins"],
    },
    // --- Charlotte (Meetup) ---
    {
      name: "Charlotte H3 Meetup",
      url: "https://www.meetup.com/charlotte-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "charlotte-hash-house-harriers", kennelTag: "CH3" },
      kennelCodes: ["ch3-nc"],
    },
    // --- Asheville (Meetup) ---
    {
      name: "Asheville H3 Meetup",
      url: "https://www.meetup.com/AVLH3-On-On/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: { groupUrlname: "AVLH3-On-On", kennelTag: "AVLH3" },
      kennelCodes: ["avlh3"],
    },
    // --- Wilmington / Cape Fear (WordPress hareline page) ---
    {
      name: "Cape Fear H3 Website",
      url: "https://capefearh3.com/hare-line/",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        defaultKennelTag: "CFH3",
        containerSelector: "table:first-of-type",
        rowSelector: "tr",
        columns: { runNumber: "td:nth-child(1)", date: "td:nth-child(2)", hares: "td:nth-child(3)" },
      },
      kennelCodes: ["cfh3"],
    },
    // --- Fayetteville (Meetup) ---
    {
      name: "Carolina Trash H3 Meetup",
      url: "https://www.meetup.com/fayetteville-running-training-meetup-group/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: { groupUrlname: "fayetteville-running-training-meetup-group", kennelTag: "CTrH3" },
      kennelCodes: ["ctrh3"],
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
        kennelTag: "MIA H3",
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
    // ===== GEORGIA =====
    // --- SavH3 Meetup (already in DB — ensure kennel link + bump trustLevel) ---
    {
      name: "Savannah H3 Meetup",
      url: "https://www.meetup.com/savannah-hash-house-harriers/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "savannah-hash-house-harriers",
        kennelTag: "SavH3",
      },
      kennelCodes: ["savh3"],
    },
    // --- Atlanta Hash Board (phpBB Atom feed — 9 kennels) ---
    {
      name: "Atlanta Hash Board",
      url: "https://board.atlantahash.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        forums: {
          "2": { kennelTag: "AH4", hashDay: "Saturday" },
          "4": { kennelTag: "PH3", hashDay: "Saturday" },
          "5": { kennelTag: "BSH3", hashDay: "Sunday" },
          "6": { kennelTag: "SOBH3", hashDay: "Sunday" },
          "7": { kennelTag: "WHH3", hashDay: "Sunday" },
          "8": { kennelTag: "MLH4", hashDay: "Monday" },
          "9": { kennelTag: "DUFF H3", hashDay: "Wednesday" },
          "10": { kennelTag: "SLUT H3", hashDay: "Thursday" },
          "11": { kennelTag: "SoCo", hashDay: "Friday" },
        },
      },
      kennelCodes: ["ah4", "ph3-atl", "bsh3", "sobh3", "whh3", "mlh4", "duffh3", "sluth3", "soco-h3"],
    },
    // --- Georgia Static Schedule sources ---
    {
      name: "SCH3 Static Schedule",
      url: "https://board.atlantahash.com/viewforum.php?f=3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "Southern Comfort H3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
        anchorDate: "2026-03-06",
        startTime: "19:00",
        defaultTitle: "SCH3 Biweekly Run",
        defaultLocation: "Atlanta, GA",
        defaultDescription: "Alternate Friday evening trail. Check Atlanta Hash Board for details.",
      },
      kennelCodes: ["sch3-atl"],
    },
    {
      name: "HMH3 Static Schedule",
      url: "https://board.atlantahash.com#hmh3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "HMH3",
        rrule: "FREQ=MONTHLY;BYDAY=1SU",
        anchorDate: "2026-03-01",
        startTime: "13:30",
        defaultTitle: "HMH3 Monthly Run",
        defaultLocation: "North Georgia",
        defaultDescription: "First Sunday monthly trail in the north Georgia foothills.",
      },
      kennelCodes: ["hmh3"],
    },
    {
      name: "CUNT H3 ATL Static Schedule",
      url: "https://board.atlantahash.com#cunth3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "CUNT H3",
        rrule: "FREQ=MONTHLY;BYDAY=1TU",
        anchorDate: "2026-03-03",
        startTime: "19:00",
        defaultTitle: "CUNT H3 Monthly Run",
        defaultLocation: "Atlanta, GA",
        defaultDescription: "First Tuesday monthly evening trail in Atlanta.",
      },
      kennelCodes: ["cunth3-atl"],
    },
    {
      name: "PFH3 Static Schedule",
      url: "https://www.facebook.com/groups/peachfuzzh3",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "PFH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
        anchorDate: "2026-03-04",
        startTime: "18:30",
        defaultTitle: "PFH3 Biweekly Run",
        defaultLocation: "Augusta, GA",
        defaultDescription: "Alternate Wednesday evening trail. Check Facebook for start location.",
      },
      kennelCodes: ["pfh3"],
    },
    {
      name: "AUGH3 Static Schedule",
      url: "https://www.facebook.com/groups/augustaundergroundhash",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "AUGH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "14:00",
        defaultTitle: "AUGH3 Biweekly Run",
        defaultLocation: "Augusta, GA",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["augh3"],
    },
    {
      name: "MGH4 Static Schedule",
      url: "https://www.facebook.com/groups/middlegeorgiahash",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "MGH4",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "14:00",
        defaultTitle: "MGH4 Biweekly Run",
        defaultLocation: "Macon, GA",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["mgh4"],
    },
    {
      name: "W3H3 GA Static Schedule",
      url: "https://www.facebook.com/groups/w3h3macon",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "Wed Wed Wed H3",
        rrule: "FREQ=WEEKLY;BYDAY=WE",
        anchorDate: "2026-03-04",
        startTime: "18:30",
        defaultTitle: "W3H3 Weekly Run",
        defaultLocation: "Macon, GA",
        defaultDescription: "Weekly Wednesday evening trail. Check Facebook for start location.",
      },
      kennelCodes: ["w3h3-ga"],
    },
    {
      name: "CVH3 Static Schedule",
      url: "https://www.facebook.com/groups/cvh3columbus",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "CVH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "11:00",
        defaultTitle: "CVH3 Biweekly Run",
        defaultLocation: "Columbus, GA",
        defaultDescription: "Alternate Saturday morning trail. Check Facebook for start location.",
      },
      kennelCodes: ["cvh3"],
    },
    {
      name: "R2H3 Static Schedule",
      url: "https://www.facebook.com/groups/r2h3rome",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "R2H3",
        rrule: "FREQ=MONTHLY;BYDAY=2SA",
        anchorDate: "2026-03-14",
        startTime: "14:30",
        defaultTitle: "R2H3 Monthly Run",
        defaultLocation: "Rome, GA",
        defaultDescription: "Second Saturday monthly trail. Check Facebook for start location.",
      },
      kennelCodes: ["r2h3"],
    },
    // ===== SOUTH CAROLINA =====
    {
      name: "Charleston Heretics Meetup",
      url: "https://www.meetup.com/charlestonheretics/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "charlestonheretics",
        kennelTag: "CHH3",
      },
      kennelCodes: ["chh3"],
    },
    {
      name: "Charleston H3 Static Schedule",
      url: "https://www.facebook.com/groups/charlestonhash/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "Charleston H3",
        rrule: "FREQ=WEEKLY;BYDAY=TH",
        anchorDate: "2026-03-05",
        startTime: "18:30",
        defaultTitle: "CH3 Weekly Run",
        defaultLocation: "Charleston, SC",
        defaultDescription: "Weekly Thursday evening trail. Check Facebook for start location.",
      },
      kennelCodes: ["ch3-sc"],
    },
    {
      name: "BUDH3 Static Schedule",
      url: "https://www.facebook.com/groups/beaufortuglydog/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "BUDH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "15:00",
        defaultTitle: "BUDH3 Biweekly Run",
        defaultLocation: "Beaufort, SC",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["budh3"],
    },
    {
      name: "Columbian H3 Static Schedule (1st Sunday)",
      url: "https://www.facebook.com/groups/columbianh3/#1st-sunday",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "ColH3",
        rrule: "FREQ=MONTHLY;BYDAY=1SU",
        anchorDate: "2026-03-01",
        startTime: "15:00",
        defaultTitle: "ColH3 Biweekly Run",
        defaultLocation: "Columbia, SC",
        defaultDescription: "1st & 3rd Sunday trail. Check Facebook for start location.",
      },
      kennelCodes: ["colh3"],
    },
    {
      name: "Columbian H3 Static Schedule (3rd Sunday)",
      url: "https://www.facebook.com/groups/columbianh3/#3rd-sunday",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "ColH3",
        rrule: "FREQ=MONTHLY;BYDAY=3SU",
        anchorDate: "2026-03-15",
        startTime: "15:00",
        defaultTitle: "ColH3 Biweekly Run",
        defaultLocation: "Columbia, SC",
        defaultDescription: "1st & 3rd Sunday trail. Check Facebook for start location.",
      },
      kennelCodes: ["colh3"],
    },
    {
      name: "Secession H3 Static Schedule",
      url: "https://secessionh3.wordpress.com",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "SecH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-14",
        startTime: "15:00",
        defaultTitle: "SecH3 Biweekly Run",
        defaultLocation: "Columbia, SC",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["sech3"],
    },
    {
      name: "Palmetto H3 Static Schedule",
      url: "https://www.facebook.com/PalmettoH3/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "PalH3",
        rrule: "FREQ=MONTHLY;BYDAY=3SA",
        anchorDate: "2026-03-21",
        startTime: "14:00",
        defaultTitle: "PalH3 Monthly Run",
        defaultLocation: "Sumter, SC",
        defaultDescription: "Third Saturday monthly trail. Check Facebook for start location.",
      },
      kennelCodes: ["palh3"],
    },
    {
      name: "Upstate H3 Static Schedule",
      url: "https://www.upstatehashers.com/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "UH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU",
        anchorDate: "2026-03-08",
        startTime: "14:00",
        defaultTitle: "UH3 Biweekly Run",
        defaultLocation: "Greenville, SC",
        defaultDescription: "Alternate Sunday trail. Check website or Facebook for start location.",
      },
      kennelCodes: ["uh3"],
    },
    {
      name: "GOTH3 Static Schedule",
      url: "https://gothh3.com/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "GOTH3",
        rrule: "FREQ=MONTHLY;BYDAY=3SA",
        anchorDate: "2026-03-21",
        startTime: "14:30",
        defaultTitle: "GOTH3 Monthly Run",
        defaultLocation: "Greenville, SC",
        defaultDescription: "Third Saturday monthly trail. Casual walker/runner mix.",
      },
      kennelCodes: ["goth3"],
    },
    {
      name: "Grand Strand H3 Static Schedule",
      url: "https://www.facebook.com/GrandStrandHashing/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "GSH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
        anchorDate: "2026-03-07",
        startTime: "16:00",
        defaultTitle: "GSH3 Biweekly Run",
        defaultLocation: "Myrtle Beach, SC",
        defaultDescription: "Alternate Saturday trail. Check Facebook for start location.",
      },
      kennelCodes: ["gsh3"],
    },
    // Massachusetts
    {
      name: "Happy Valley H3 Static Schedule",
      url: "https://happyvalleyh3.org/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "HVH3",
        rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH",
        startTime: "18:30",
        timezone: "America/New_York",
        defaultTitle: "HVH3 Biweekly Run",
        defaultLocation: "Western Massachusetts",
        defaultDescription: "Biweekly Thursday hash in the Pioneer Valley.",
      },
      kennelCodes: ["hvh3"],
    },
    {
      name: "PooFlingers H3 Static Schedule",
      url: "https://www.facebook.com/groups/pooflingers/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "PooFH3",
        rrule: "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3",
        startTime: "14:00",
        timezone: "America/New_York",
        defaultTitle: "PooFH3 Monthly Run",
        defaultLocation: "New England",
        defaultDescription: "Monthly 3rd Saturday hash throughout New England.",
      },
      kennelCodes: ["poofh3"],
    },
    {
      name: "Northboro H3 Website",
      url: "https://www.northboroh3.com",
      type: "HTML_SCRAPER" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      kennelCodes: ["nbh3"],
    },
    // ===== VERMONT =====
    {
      name: "Von Tramp H3 Meetup",
      url: "https://www.meetup.com/vontramph3/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        groupUrlname: "vontramph3",
        kennelTag: "VTH3",
      },
      kennelCodes: ["vth3"],
    },
    {
      name: "Burlington H3 Website Hareline",
      url: "https://www.burlingtonh3.com/hareline",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      kennelCodes: ["burlyh3"],
    },
    // ===== RHODE ISLAND =====
    {
      name: "RIH3 Static Schedule",
      url: "https://rih3.com/",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 5,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        kennelTag: "RIH3",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        anchorDate: "2026-03-09",
        startTime: "18:30",
        timezone: "America/New_York",
        defaultTitle: "RIH3 Monday Trail",
        defaultLocation: "Rhode Island",
        defaultDescription: "Weekly Monday evening hash. 6:30 PM sharp.",
      },
      kennelCodes: ["rih3"],
    },
    {
      name: "RIH3 Website Hareline",
      url: "https://rih3.com/hareline.html",
      type: "HTML_SCRAPER" as const,
      trustLevel: 6,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      kennelCodes: ["rih3"],
    },
    // ===== CONNECTICUT =====
    {
      name: "Narwhal H3 Meetup (CTH3)",
      url: "https://www.meetup.com/meetup-group-cwrnpwpc/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 180,
      config: {
        groupUrlname: "meetup-group-cwrnpwpc",
        kennelTag: "Narwhal H3",
      },
      kennelCodes: ["narwhal-h3"],
    },
    // ===== OREGON =====
    // --- Oregon Hashing Calendar aggregator (OH3, TGIF, Cherry City events) ---
    {
      name: "Oregon Hashing Calendar",
      url: "cae3r4u2uhucmmi9rvq5eu6obg@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "cae3r4u2uhucmmi9rvq5eu6obg@group.calendar.google.com",
        kennelPatterns: [
          ["OH3.*Full Moon|OH3 #|OH3 -|OH3$", "OH3"],
          ["TGIF|Friday.*Pubcrawl", "TGIF"],
          ["Cherry City|Cherry Cherry City", "CCH3"],
        ],
        defaultKennelTag: "OH3",
      },
      kennelCodes: ["oh3", "tgif", "cch3-or"],
    },
    // --- Individual kennel calendars ---
    {
      name: "No Name H3 Calendar",
      url: "63h32shgrk48ci0li17lmoijeg@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "63h32shgrk48ci0li17lmoijeg@group.calendar.google.com",
        defaultKennelTag: "N2H3",
      },
      kennelCodes: ["n2h3"],
    },
    {
      name: "Kahuna H3 Calendar",
      url: "e63ac95062e8cb80b4c470e316701cfba3046903bc6662c456efe87d52250e9e@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "e63ac95062e8cb80b4c470e316701cfba3046903bc6662c456efe87d52250e9e@group.calendar.google.com",
        defaultKennelTag: "OKH3",
      },
      kennelCodes: ["okh3"],
    },
    {
      name: "Portland Humpin' Hash Calendar",
      url: "e42428cbbecf52a48618c36aa1654ec0186aa307eb6d608641ef3a9e5c243128@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "e42428cbbecf52a48618c36aa1654ec0186aa307eb6d608641ef3a9e5c243128@group.calendar.google.com",
        defaultKennelTag: "PH4",
      },
      kennelCodes: ["ph4"],
    },
    {
      name: "Stumptown H3 Calendar",
      url: "5e6c1e6bdcb70c74eb924aee3d74f63e13a65c91f86844f50b37f412a768e82c@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "5e6c1e6bdcb70c74eb924aee3d74f63e13a65c91f86844f50b37f412a768e82c@group.calendar.google.com",
        defaultKennelTag: "StumpH3",
      },
      kennelCodes: ["stumph3"],
    },
    {
      name: "Dead Whores H3 Calendar",
      url: "e435782c94f98136bde0957e4f791bdd3a0ac0d13970bbfe1ff34f5ddc676990@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "e435782c94f98136bde0957e4f791bdd3a0ac0d13970bbfe1ff34f5ddc676990@group.calendar.google.com",
        defaultKennelTag: "DWH3",
      },
      kennelCodes: ["dwh3"],
    },
    {
      name: "SWH3 Calendar",
      url: "898ddb527b83d7944c788bfbdb4074be5ee3c5ddf380acbdb206abd2861d6dc2@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "898ddb527b83d7944c788bfbdb4074be5ee3c5ddf380acbdb206abd2861d6dc2@group.calendar.google.com",
        defaultKennelTag: "Portland SWH3",
      },
      kennelCodes: ["swh3-or"],
    },
    {
      name: "Salem H3 Calendar",
      url: "0f125fcba18bfeca585fe7d3592c70159df9c97d620dfd68fd65a73fcd063d8c@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "0f125fcba18bfeca585fe7d3592c70159df9c97d620dfd68fd65a73fcd063d8c@group.calendar.google.com",
        defaultKennelTag: "SalemH3",
      },
      kennelCodes: ["salemh3"],
    },
    {
      name: "Cherry City H3 Calendar",
      url: "711a1cfbec0cfbcc26ba28c79d943700e6b7c33c8c11896a86da701fc96291b6@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "711a1cfbec0cfbcc26ba28c79d943700e6b7c33c8c11896a86da701fc96291b6@group.calendar.google.com",
        defaultKennelTag: "CCH3",
      },
      kennelCodes: ["cch3-or"],
    },
    {
      name: "Eugene H3 Calendar",
      url: "8b593752049f42f9aca8fb04197bfb25d7f4148db8c314991e842bbf6b4ea303@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "8b593752049f42f9aca8fb04197bfb25d7f4148db8c314991e842bbf6b4ea303@group.calendar.google.com",
        defaultKennelTag: "Eugene H3",
      },
      kennelCodes: ["eh3-or"],
    },
    {
      name: "Central Oregon H3 Calendar",
      url: "6ureum96qhgf13kj820i61ovq8@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        calendarId: "6ureum96qhgf13kj820i61ovq8@group.calendar.google.com",
        defaultKennelTag: "COH3",
      },
      kennelCodes: ["coh3"],
    },
    // ===== WASHINGTON =====
    // --- WA Hash Google Calendar (multi-kennel aggregator) ---
    {
      name: "WA Hash Google Calendar",
      url: "8d65om7lrdq538ksqednh2n648@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["^SH3\\b|Seattle H3", "SH3"],
          ["^PSH3\\b|Puget Sound", "PSH3"],
          ["^NBH3\\b|No Balls", "NBH3"],
          ["^RCH3\\b|Rain City", "Rain City H3"],
          ["SeaMon", "SeaMon"],
          ["^TH3\\b|Tacoma H3|^Tacoma", "Tacoma H3"],
          ["^SSH3\\b|South Sound", "SSH3"],
          ["CUNTh", "CUNTh"],
          ["Taint", "Taint"],
          ["Giggity", "Giggity"],
          ["South End|^SEH3|^SEH5", "SEH3"],
          ["HSWTF", "HSWTF"],
          ["Leap Year", "Leap Year"],
        ],
        defaultKennelTag: "SH3",
      },
      kennelCodes: ["sh3-wa", "psh3", "nbh3-wa", "rch3-wa", "seamon-h3", "th3-wa", "ssh3-wa", "cunth3-wa", "taint-h3", "giggity-h3", "seh3-wa", "hswtf-h3", "leapyear-h3"],
    },
    // --- Per-kennel Google Sheets (secondary enrichment) ---
    {
      name: "Seattle H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/1rTa69Z12V4EAdlRGToOiMIIiFiTbqZFN653hs5DwALk",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      config: {
        sheetId: "1rTa69Z12V4EAdlRGToOiMIIiFiTbqZFN653hs5DwALk",
        gid: 0,
        skipRows: 0,
        tabs: ["Sheet1"],
        columns: { runNumber: 0, date: 1, hares: 2, title: 3, location: 4, description: 5 },
        kennelTagRules: { default: "SH3" },
      },
      kennelCodes: ["sh3-wa"],
    },
    {
      name: "Puget Sound H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/1XTN-ivc5NClSt4Z1HVYf0ddEzF3aXcnd1ZH0JFpLXm4",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      config: {
        sheetId: "1XTN-ivc5NClSt4Z1HVYf0ddEzF3aXcnd1ZH0JFpLXm4",
        gid: 237970172,
        skipRows: 2,
        columns: { runNumber: 0, date: 2, hares: 3, title: 4, location: -1 },
        kennelTagRules: { default: "PSH3" },
      },
      kennelCodes: ["psh3"],
    },
    // No Balls H3 Hareline Sheet — DISABLED: sheet is private (401), no 2025/2026 data entered.
    // NBH3 events come through via the shared WA Hash Google Calendar instead.
    // Re-enable if sheet owner makes it publicly viewable.
    {
      name: "Rain City H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/1UOzHLGytOdlzjet7VE25gXAMcuU4oc8fi8gY-4cQUkA",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      config: {
        sheetId: "1UOzHLGytOdlzjet7VE25gXAMcuU4oc8fi8gY-4cQUkA",
        gid: 0,
        skipRows: 2,
        columns: { runNumber: 0, date: 1, hares: 2, title: 3, location: -1 },
        kennelTagRules: { default: "Rain City H3" },
      },
      kennelCodes: ["rch3-wa"],
    },
    {
      name: "SeaMon H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/12Ajped8oyheVayDmHs0d8glLVo23VOg8gRKCe4yQP-g",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 365,
      config: {
        sheetId: "12Ajped8oyheVayDmHs0d8glLVo23VOg8gRKCe4yQP-g",
        gid: 0,
        skipRows: 1,
        columns: { runNumber: 0, date: 1, hares: 2, title: 3, location: -1 },
        kennelTagRules: { default: "SeaMon" },
      },
      kennelCodes: ["seamon-h3"],
    },
    {
      name: "Leap Year H3 Hareline Sheet",
      url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_z30ZkQNOwcAka4qU22bAGYIVjJFc5NyICst9OeUWPvi27lNK8ICkZllzLI0gjLwQDjVvlt3mMlDM/pub",
      type: "GOOGLE_SHEETS" as const,
      trustLevel: 5,
      scrapeFreq: "weekly",
      scrapeDays: 800,
      config: {
        sheetId: "anonymous",
        csvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ_z30ZkQNOwcAka4qU22bAGYIVjJFc5NyICst9OeUWPvi27lNK8ICkZllzLI0gjLwQDjVvlt3mMlDM/pub?output=csv",
        skipRows: 2,
        columns: { runNumber: 0, date: 1, hares: 2, title: 3, location: -1 },
        kennelTagRules: { default: "Leap Year" },
      },
      kennelCodes: ["leapyear-h3"],
    },
    // ===== COLORADO =====
    // --- Denver H3 (Google Calendar) ---
    {
      name: "Denver H3 Google Calendar",
      url: "denverkennel@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "DH3" },
      kennelCodes: ["dh3-co"],
    },
    // --- Mile High Humpin' Hash (Google Calendar) ---
    {
      name: "Mile High Humpin Hash Calendar",
      url: "huhahareraiser@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "MiHiHuHa" },
      kennelCodes: ["mihi-huha"],
    },
    // --- Colorado H3 Aggregator (Google Calendar — covers Boulder H3 + others) ---
    {
      name: "Colorado H3 Aggregator Calendar",
      url: "v94tqngukqr5cdffg9q7rruvl0@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["Boulder H3|^BH3", "BH3"],
          ["MiHiHuHa|MiHiHUHa", "MiHiHuHa"],
        ],
        defaultKennelTag: "BH3",
      },
      kennelCodes: ["bh3-co", "mihi-huha"],
    },
    // --- Fort Collins H3 (Google Calendar) ---
    {
      name: "Fort Collins H3 Google Calendar",
      url: "fc8df0937002479306c3fed0055fb7273cb62a46abe5c7f652e3e318310f9143@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "Fort Collins H3" },
      kennelCodes: ["fch3-co"],
    },
    // --- Colorado Springs H3 (Google Calendar — multi-kennel) ---
    {
      name: "Colorado Springs H3 Calendar",
      url: "cspringsh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["^PPH4|Pikes Peak", "PPH4"],
          ["^Kimchi", "Kimchi"],
          ["^DIM", "DIM"],
        ],
        defaultKennelTag: "PPH4",
      },
      kennelCodes: ["pph4", "kimchi-h3", "dim-h3"],
    },
    // ===== MINNESOTA =====
    {
      name: "Minneapolis H3 Calendar",
      url: "minneapolishash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["\\bT3H3\\b|Twin Titties", "T3H3"],
          ["\\bMH3\\b", "MH3"]
        ],
        defaultKennelTag: "MH3",
      },
      kennelCodes: ["mh3-mn", "t3h3"],
    },
    // ===== ARIZONA =====
    // --- Phoenix (iCal Feed — multi-kennel) ---
    {
      name: "Phoenix H3 Events",
      url: "https://www.phoenixhhh.org/?plugin=events-manager&page=events.ics",
      type: "ICAL_FEED" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelPatterns: [
          ["^LBH\\b|Lost Boobs", "LBH"],
          ["Hump D", "Hump D"],
          ["Wrong Way", "Wrong Way"],
          ["Dusk.*Down|FDTDD", "FDTDD"],
        ],
        defaultKennelTag: "Wrong Way",
      },
      kennelCodes: ["lbh-phx", "hump-d", "wrong-way", "fdtdd"],
    },
    // --- Tucson (Google Calendar — per-kennel) ---
    {
      name: "jHavelina H3 Google Calendar",
      url: "jhavelinahhh@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "jHav" },
      kennelCodes: ["jhav-h3"],
    },
    {
      name: "Mr. Happy's H3 Google Calendar",
      url: "mrhappyshhh@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "Mr. Happy's" },
      kennelCodes: ["mrhappy"],
    },
    {
      name: "Pedal Files Bash Google Calendar",
      url: "tucsonhhh@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "Pedal Files" },
      kennelCodes: ["pedalfiles"],
    },
    // ===== CALIFORNIA =====
    // --- Santa Cruz (Static Schedule) ---
    {
      name: "Surf City H3 Static Schedule",
      url: "https://www.sch3.net",
      type: "STATIC_SCHEDULE" as const,
      trustLevel: 3,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelTag: "SCH3",
        rrule: "FREQ=WEEKLY;BYDAY=TH",
        startTime: "18:30",
        timezone: "America/Los_Angeles",
        defaultTitle: "SCH3 Weekly Thursday Hash",
        defaultLocation: "Santa Cruz, CA — check Facebook for detrails",
        defaultDescription: "Weekly Thursday evening hash in Santa Cruz.",
      },
      kennelCodes: ["sch3-ca"],
    },
    // --- Los Angeles Area (Google Calendar) ---
    {
      name: "LAH3 Google Calendar",
      url: "hash.org_8er4h3q5qct5apu9nl2v7ic4c0@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "LAH3" },
      kennelCodes: ["lah3"],
    },
    {
      name: "LBH3 Google Calendar",
      url: "hash.org_apdt0s7aam1mdl1ckc4n1rcc4k@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "LBH3" },
      kennelCodes: ["lbh3"],
    },
    {
      name: "TDH3 Google Calendar",
      url: "hash.org_efk2ibem9h2lonqgignpcp8uoo@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "TDH3" },
      kennelCodes: ["tdh3-lb"],
    },
    {
      name: "GAL Google Calendar",
      url: "hash.org_vca9alu5cu5q2hkvip31fma6so@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "GAL" },
      kennelCodes: ["gal-h3"],
    },
    {
      name: "SUPH3 Google Calendar",
      url: "c_95c7557021b96e1c88a6df5a9132ac59082e1bfc2c2ba3eb4dc7f70b84155caa@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "SUPH3" },
      kennelCodes: ["suph3"],
    },
    {
      name: "Foothill H3 Google Calendar",
      url: "hash.org_6ocimc04ghdh7652dlvnjs5060@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "FtH3" },
      kennelCodes: ["fth3"],
    },
    {
      name: "East LA H3 Google Calendar",
      url: "hash.org_t92ud36ad0jbao70f22d2eptuc@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "ELAH3" },
      kennelCodes: ["elah3"],
    },
    {
      name: "Signal Hill H3 Google Calendar",
      url: "hash.org_t8of6q45k4cki650d97m0b80dc@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "SGH3" },
      kennelCodes: ["sgh3"],
    },
    // --- Orange County (Google Calendar) ---
    {
      name: "OCHHH Google Calendar",
      url: "hash.org_gr8mpprvpgpiihhkfj0dd0ic4k@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "OCHHH" },
      kennelCodes: ["ochhh"],
    },
    {
      name: "OC Hump Google Calendar",
      url: "hash.org_8jis0j5k0hanmgq2c6inrf93ho@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "OC Hump" },
      kennelCodes: ["ochump"],
    },
    // --- Central Coast (Google Calendar) ---
    {
      name: "SLOH3 Google Calendar",
      url: "blj7esp5ns5sbirko1p7amr4ig@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: { defaultKennelTag: "SLOH3" },
      kennelCodes: ["sloh3"],
    },
    // --- San Diego (HTML Scraper) ---
    {
      name: "SDH3 Hareline",
      url: "https://sdh3.com/hareline.shtml",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "weekly",
      scrapeDays: 90,
      config: {
        kennelCodeMap: {
          "SDH3": "SDH3", "CLH3": "CLH3", "LJH3": "LJH3",
          "NCH3": "NCH3", "IRH3": "IRH3", "H4": "Humpin'",
          "FMH3": "FMH3", "HAH3": "HAH3", "MH4": "MH4",
          "DRH3": "DRH3",
        },
        kennelNameMap: {
          "San Diego": "SDH3", "Larrikins": "CLH3", "La Jolla": "LJH3",
          "North County": "NCH3", "Iron Rule": "IRH3", "Humpin": "Humpin'",
          "Full Moon": "FMH3", "Half-Assed": "HAH3", "Mission Harriettes": "MH4",
          "Diaper Rash": "DRH3",
        },
        includeHistory: true,
      },
      kennelCodes: ["sdh3", "clh3-sd", "ljh3", "nch3-sd", "irh3-sd", "humpin-sd", "fmh3-sd", "hah3-sd", "mh4-sd", "drh3-sd"],
    },
    // ===== OHIO =====
    // --- Cleveland (Meetup) ---
    {
      name: "Cleveland H4 Meetup",
      url: "https://www.meetup.com/cleveland-hash-house-harriers-and-harriettes/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "cleveland-hash-house-harriers-and-harriettes",
        kennelTag: "CleH4",
      },
      kennelCodes: ["cleh4"],
    },
    // --- Akron (Meetup) ---
    {
      name: "Rubber City H3 Meetup",
      url: "https://www.meetup.com/rubber-city-hash-house-harriers-and-harriettes/",
      type: "MEETUP" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 90,
      config: {
        groupUrlname: "rubber-city-hash-house-harriers-and-harriettes",
        kennelTag: "RCH3",
      },
      kennelCodes: ["rch3"],
    },
    // --- Dayton (Google Calendar) ---
    {
      name: "DH4 Google Calendar",
      url: "daytonhash@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "DH4",
      },
      kennelCodes: ["dh4"],
    },
    {
      name: "MVH3 Google Calendar",
      url: "mvh3calendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "Miami Valley H3",
      },
      kennelCodes: ["mvh3-day"],
    },
    {
      name: "SWOT Google Calendar",
      url: "swoth3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "SWOT",
      },
      kennelCodes: ["swot-h3"],
    },
    // --- Cincinnati (Google Calendar) ---
    {
      name: "SCH4 Google Calendar",
      url: "sch4calendar@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "SCH4",
      },
      kennelCodes: ["sch4"],
    },
    {
      name: "QCH4 Google Calendar",
      url: "jjfn26n873ro3qi1ckobikroso@group.calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "QCH4",
      },
      kennelCodes: ["qch4"],
    },
    {
      name: "LVH3 Google Calendar",
      url: "lickingvalleyh3@gmail.com",
      type: "GOOGLE_CALENDAR" as const,
      trustLevel: 7,
      scrapeFreq: "daily",
      scrapeDays: 365,
      config: {
        defaultKennelTag: "Licking Valley H3",
      },
      kennelCodes: ["lvh3-cin"],
    },
    // --- Columbus (Renegade H3 website) ---
    {
      name: "Renegade H3 Website",
      url: "https://www.renegadeh3.com/events",
      type: "HTML_SCRAPER" as const,
      trustLevel: 8,
      scrapeFreq: "daily",
      scrapeDays: 90,
      kennelCodes: ["renh3"],
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
