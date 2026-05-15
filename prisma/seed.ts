import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { REGION_SEED_DATA, regionSlug } from "../src/lib/region";
import { KENNELS } from "./seed-data/kennels";
import type { KennelSeed } from "./seed-data/kennels";
import { KENNEL_ALIASES } from "./seed-data/aliases";
import { SOURCES } from "./seed-data/sources";
import { runScheduleRuleBackfill } from "../scripts/backfill-schedule-rules";
import { composeUtcStart } from "../src/lib/timezone";

/** JSON.stringify with sorted keys — prevents false diffs from key ordering differences between seed objects and DB-returned JSON. */
function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

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
  "twitterHandle", "discordUrl", "mailingListUrl", "contactEmail",
  "contactName", "gm", "hareRaiser", "signatureEvent", "founder", "parentKennelCode",
  "foundedYear", "description", "logoUrl", "latitude", "longitude",
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

  // Set state-level parent relationships: metros under their state-province.
  // Every STATE_PROVINCE region with metros should be listed here so the DB
  // tree (admin region browser, hierarchical queries) reflects geography.
  // Note: STATE_GROUP_MAP in src/lib/region.ts is a separate UI grouping for
  // the kennel directory and is allowed to differ (e.g. Northern Virginia is
  // a "D.C. Metro" group entry but lives under Virginia in the DB tree).
  const stateMetroLinks: Record<string, string[]> = {
    // ── US East Coast ──
    "New York": [
      "New York City, NY", "Long Island, NY", "Syracuse, NY",
      "Capital District, NY", "Ithaca, NY", "Rochester, NY", "Buffalo, NY",
    ],
    "Pennsylvania": [
      "Philadelphia, PA", "Pittsburgh, PA", "State College, PA",
      "Lehigh Valley, PA", "Reading, PA", "Harrisburg, PA",
    ],
    "Delaware": ["Wilmington, DE"],
    "Maryland": ["Baltimore, MD", "Frederick, MD", "Southern Maryland"],
    "Virginia": [
      "Northern Virginia", "Fredericksburg, VA", "Richmond, VA",
      "Hampton Roads, VA", "Charlottesville, VA", "Lynchburg, VA",
    ],
    "West Virginia": ["Jefferson County, WV", "Morgantown, WV"],
    "Arkansas": ["Little Rock, AR"],
    "North Carolina": [
      "Raleigh, NC", "Charlotte, NC", "Asheville, NC",
      "Wilmington, NC", "Fayetteville, NC",
    ],
    "South Carolina": [
      "Charleston, SC", "Columbia, SC", "Greenville, SC", "Myrtle Beach, SC",
    ],
    // ── New England ──
    "Massachusetts": ["Boston, MA", "Pioneer Valley, MA"],
    "Maine": ["Portland, ME"],
    // ── US Southeast ──
    "Florida": [
      "Miami, FL", "Tampa Bay, FL", "Orlando, FL", "Jacksonville, FL",
      "Daytona Beach, FL", "Tallahassee, FL", "Florida Keys", "Florida Panhandle",
    ],
    "Georgia": [
      "Atlanta, GA", "Savannah, GA", "Augusta, GA", "Macon, GA",
      "Columbus, GA", "Rome, GA",
    ],
    "Alabama": ["Mobile, AL", "Birmingham, AL", "Enterprise, AL"],
    "Tennessee": ["Nashville, TN", "Memphis, TN", "Chattanooga, TN"],
    "Louisiana": ["New Orleans, LA"],
    // ── US Midwest ──
    "Ohio": [
      "Columbus, OH", "Cincinnati, OH", "Dayton, OH",
      "Cleveland, OH", "Akron, OH",
    ],
    "Illinois": ["Chicago, IL"],
    "Indiana": ["South Shore, IN", "Indianapolis, IN", "Bloomington, IN"],
    "Michigan": ["Detroit, MI", "Lansing, MI"],
    "Minnesota": ["Minneapolis, MN"],
    "Wisconsin": ["Madison, WI", "Milwaukee, WI"],
    "Missouri": ["Kansas City, MO", "St. Louis, MO"],
    "Kansas": ["Wichita, KS", "Lawrence, KS"],
    // ── US South Central / West ──
    "Texas": [
      "Austin, TX", "Houston, TX", "Dallas-Fort Worth, TX",
      "San Antonio, TX", "Corpus Christi, TX", "El Paso",
    ],
    "New Mexico": ["Albuquerque, NM"],
    "Nevada": ["Las Vegas, NV", "Reno, NV"],
    "Utah": ["Salt Lake City, UT"],
    "Arizona": ["Phoenix, AZ", "Tucson, AZ"],
    "Colorado": ["Denver, CO", "Boulder, CO", "Fort Collins, CO", "Colorado Springs, CO"],
    // ── US West Coast ──
    "Washington": ["Seattle, WA", "Tacoma, WA", "Olympia, WA", "Bremerton, WA"],
    "Oregon": ["Portland, OR", "Salem, OR", "Eugene, OR", "Bend, OR"],
    "California": [
      "San Francisco, CA", "Oakland, CA", "San Jose, CA", "Marin County, CA",
      "San Diego, CA", "Santa Cruz, CA", "Los Angeles, CA", "Long Beach, CA",
      "Orange County, CA", "San Luis Obispo, CA",
    ],
    "Hawaii": ["Honolulu, HI"],
    // ── Canada ──
    "Quebec": ["Montreal, QC"],
    "Ontario": ["Ottawa, ON", "Toronto, ON"],
    "Alberta": ["Calgary, AB", "Edmonton, AB"],
    // ── UK ──
    "Scotland": ["Edinburgh", "Glasgow"],
    // ── Australia (Phase 1a: Perth + Darwin + Canberra) ──
    // Note: Australian Capital Territory is a Federal Territory
    // (state-equivalent like Kuala Lumpur). Canberra is its own
    // top-level state region, NOT parented under NSW. Same pattern as
    // KL vs Selangor — see reference_kl_federal_territory memory.
    "Western Australia": ["Perth, WA"],
    "Northern Territory": ["Darwin, NT"],
    "New South Wales": ["Sydney, NSW"],
    "South Australia": ["Adelaide, SA"],
    "Queensland": ["Gold Coast, QLD"],
    // ── Malaysia (Phase 1: KL + Penang founder pack) ──
    // Kuala Lumpur is a Federal Territory, NOT part of Selangor — KL is
    // administratively state-equivalent. Selangor surrounds KL but KL
    // itself is its own top-level region. Kennels in KL proper attach
    // to the Kuala Lumpur state region; suburb kennels (Petaling Jaya,
    // Kelana Jaya, etc.) attach to Selangor.
    "Penang": ["Penang Island, MY", "Butterworth, MY"],
    // Malaysia Phase 2 — Sarawak, Sabah, Perak, Johor
    "Sarawak": ["Kuching, MY"],
    "Sabah": ["Kota Kinabalu, MY"],
    "Perak": ["Ipoh, MY"],
    "Johor": ["Johor Bahru, MY"],
    // Australia Phase 2 — Victoria
    "Victoria": ["Melbourne, VIC"],
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
async function ensureKennelRecords(prisma: any, kennels: KennelSeed[], toSlugFn: (s: string) => string, regionMap: Map<string, string>) {
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
        // Explicit slug in seed data takes priority; otherwise derive from shortName/kennelCode
        const slugCandidates = kennel.slug
          ? [kennel.slug]
          : [toSlugFn(kennel.shortName), toSlugFn(kennel.kennelCode)];
        if (!kennel.slug) {
          for (let n = 2; slugCandidates.length < 10; n++) slugCandidates.push(`${toSlugFn(kennel.kennelCode)}-${n}`);
        }
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
        // Update region if it changed, regionId is missing, OR regionId points
        // at a stale row (can happen when an alias collision earlier mapped the
        // string region name to the wrong Region — see issue #984 Bull Moon).
        if (regionId && record.region !== kennel.region) {
          updates.region = kennel.region;
          updates.regionId = regionId;
        } else if (regionId && record.regionId !== regionId) {
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
        // Explicit slug override: update slug if seed specifies a different one
        if (kennel.slug && record.slug !== kennel.slug) {
          updates.slug = kennel.slug;
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
  // Identity is (name, type), not url — config-driven adapters
  // (HARRIER_CENTRAL, MEETUP, some GOOGLE_CALENDAR aggregators) legitimately
  // share a url across multiple sources. Matching by url collapsed all three
  // HARRIER_CENTRAL sources into a single DB row (#817). Renames are a
  // two-step: alias first, then seed. Sources dropped from SOURCES are
  // soft-disabled (not deleted) below so their RawEvents / ScrapeLogs survive.
  const seededKeys = new Set<string>(
    sources.map((s) => `${s.name}::${s.type}`),
  );
  for (const source of sources) {
    const { kennelCodes, kennelSlugMap, ...sourceData } = source;

    const matchingSources = await prisma.source.findMany({
      where: { name: sourceData.name, type: sourceData.type },
      orderBy: { createdAt: "asc" },
      take: 2,
    });
    if (matchingSources.length > 1) {
      throw new Error(
        `Duplicate Source rows for identity ${sourceData.name}::${sourceData.type} — seed cannot disambiguate. Resolve in DB before re-seeding.`,
      );
    }
    const existingSource = matchingSources[0] ?? null;

    let activeSource;
    let updates: Record<string, unknown> | null = null;
    try {
      if (!existingSource) {
        activeSource = await prisma.source.create({ data: sourceData });
        created++;
        console.log(`  + Created source: ${sourceData.name}`);
      } else {
        activeSource = existingSource;
        // Sync mutable fields (config, name, trustLevel) so seed changes get applied
        updates = {};
        if (sourceData.trustLevel && sourceData.trustLevel > (existingSource.trustLevel ?? 0)) {
          updates.trustLevel = sourceData.trustLevel;
        }
        if (sourceData.name !== existingSource.name) {
          updates.name = sourceData.name;
        }
        if (sourceData.config !== undefined && stableStringify(sourceData.config) !== stableStringify(existingSource.config)) {
          updates.config = sourceData.config;
        }
        // Sync simple scalar fields when the seed sets a truthy value that differs from the DB.
        for (const field of ["url", "scrapeDays", "scrapeFreq"] as const) {
          if (sourceData[field] && sourceData[field] !== existingSource[field]) {
            updates[field] = sourceData[field];
          }
        }
        // `enabled` needs explicit handling: the truthy-guard above would skip
        // `enabled: false`. Sync only when the seed explicitly sets the field.
        if (sourceData.enabled !== undefined && sourceData.enabled !== existingSource.enabled) {
          updates.enabled = sourceData.enabled;
        }
        if (Object.keys(updates).length > 0) {
          await prisma.source.update({
            where: { id: existingSource.id },
            data: updates,
          });
          console.log(`  ~ Updated ${Object.keys(updates).join(", ")} for ${sourceData.name}`);
        }
      }

      await linkKennelsToSource(prisma, activeSource.id, kennelCodes, kennelRecords, kennelSlugMap);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = e != null && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined;
      const meta = e != null && typeof e === "object" && "meta" in e ? (e as { meta: unknown }).meta : undefined;
      console.error(`  ✗ FAILED to seed source "${sourceData.name}" (${sourceData.type}): ${msg}`);
      if (code) console.error(`    Prisma code: ${code}`);
      if (meta) console.error(`    Prisma meta:`, JSON.stringify(meta));
      // Log the full seed entry (including kennelCodes / kennelSlugMap) so failures inside
      // linkKennelsToSource still record the association context that caused them.
      console.error(`    Seed row:`, stableStringify(source));
      // Prefer the just-created row when the create path succeeded but linkKennelsToSource
      // then failed — existingSource is still null in that window.
      const dbRow = activeSource ?? existingSource;
      console.error(
        `    Matched DB row:`,
        dbRow
          ? stableStringify({
              id: dbRow.id,
              name: dbRow.name,
              type: dbRow.type,
              url: dbRow.url,
              enabled: dbRow.enabled,
            })
          : "<none — create-path failure>",
      );
      if (updates && Object.keys(updates).length > 0) {
        console.error(`    Update payload:`, stableStringify(updates));
      }
      if (code === "P2002") {
        try {
          const conflicts = await prisma.source.findMany({
            where: {
              OR: [
                { name: sourceData.name, type: sourceData.type },
                ...(sourceData.url ? [{ url: sourceData.url }] : []),
              ],
            },
            select: { id: true, name: true, type: true, url: true, enabled: true },
            take: 10,
          });
          console.error(`    Rows colliding on (name,type) or url:`);
          for (const row of conflicts) {
            console.error(`      - ${stableStringify(row)}`);
          }
        } catch (lookupErr) {
          const lookupMsg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
          console.error(`    (conflict lookup failed: ${lookupMsg})`);
        }
      }
      throw e;
    }
  }
  console.log(`  ✓ ${sources.length} sources checked (${created} created)`);

  // Reconcile: disable any enabled DB sources that are no longer in SOURCES.
  // Admin-created sources (never present in the seed) would also be caught here,
  // so we only act on sources whose (name,type) pair previously matched a seed
  // entry — we can't tell those apart today, so log candidates and disable only
  // when the operator opts in via SEED_RECONCILE_DISABLE=true.
  const allEnabled = await prisma.source.findMany({
    where: { enabled: true },
    select: { id: true, name: true, type: true },
  });
  const stale = allEnabled.filter(
    (s: { name: string; type: string }) => !seededKeys.has(`${s.name}::${s.type}`),
  );
  if (stale.length > 0) {
    console.log(`  ⚠ ${stale.length} enabled source(s) not present in SOURCES:`);
    for (const s of stale) console.log(`    - ${s.name} (${s.type}) [${s.id}]`);
    if (process.env.SEED_RECONCILE_DISABLE === "true") {
      await prisma.source.updateMany({
        where: { id: { in: stale.map((s: { id: string }) => s.id) } },
        data: { enabled: false },
      });
      const names = stale.map((s: { name: string }) => s.name).join(", ");
      console.log(`  ✓ Disabled ${stale.length} stale source(s): ${names} (SEED_RECONCILE_DISABLE=true)`);
    } else {
      console.log(`    (set SEED_RECONCILE_DISABLE=true to auto-disable)`);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function linkKennelsToSource(prisma: any, sourceId: string, kennelCodes: string[], kennelRecords: Map<string, { id: string }>, slugMap?: Record<string, string>) {
  const validKennelIds: string[] = [];
  for (const code of kennelCodes) {
    const kennel = kennelRecords.get(code);
    if (!kennel) { console.warn(`  ⚠ Kennel code "${code}" not found, skipping source link`); continue; }
    validKennelIds.push(kennel.id);
    const externalSlug = slugMap?.[code] ?? null;
    await prisma.sourceKennel.upsert({
      where: { sourceId_kennelId: { sourceId, kennelId: kennel.id } },
      update: slugMap ? { externalSlug } : {},
      create: { sourceId, kennelId: kennel.id, ...(externalSlug ? { externalSlug } : {}) },
    });
  }
  // Prune stale links (e.g. when a kennel is removed from a source's kennelCodes)
  const removed = await prisma.sourceKennel.deleteMany({
    where: { sourceId, kennelId: { notIn: validKennelIds } },
  });
  if (removed.count > 0) {
    console.log(`  ✓ Pruned ${removed.count} stale SourceKennel row(s) for source ${sourceId}`);
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

// Post-seed timezone reconciliation: every Event whose stored timezone differs
// from its kennel's region.timezone is recomputed using composeUtcStart so the
// dateUtc reflects the corrected zone. Targets the Bull Moon mass mis-tag
// (issue #984 — 435 events stamped America/Chicago instead of Europe/London)
// and protects against future drift across all kennels.
//
// Implementation: a single Event⇄Kennel⇄Region join finds drifted rows in one
// query (Prisma's where can't compare columns from different tables, so the
// raw SQL is the only N+1-free option). Per-event updates remain because
// composeUtcStart needs each row's date + startTime to recompute dateUtc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reconcileEventTimezones(prisma: any) {
  console.log("Reconciling Event timezones against kennel region tz...");
  const stale: Array<{
    id: string;
    kennelCode: string;
    date: Date;
    startTime: string | null;
    expectedTz: string;
  }> = await prisma.$queryRaw`
    SELECT e.id, k."kennelCode", e.date, e."startTime", r.timezone AS "expectedTz"
    FROM "Event" e
    JOIN "Kennel" k ON e."kennelId" = k.id
    JOIN "Region" r ON k."regionId" = r.id
    WHERE e.timezone IS NOT NULL AND e.timezone <> r.timezone
  `;
  if (stale.length === 0) {
    console.log("  ✓ No timezone drift detected");
    return;
  }
  const byKennel = new Map<string, number>();
  for (const e of stale) byKennel.set(e.kennelCode, (byKennel.get(e.kennelCode) ?? 0) + 1);
  for (const [code, count] of byKennel) {
    console.log(`  ⚠ ${code}: ${count} events with wrong timezone`);
  }
  let updated = 0;
  let skipped = 0;
  for (const e of stale) {
    const newDateUtc = e.startTime ? composeUtcStart(e.date, e.startTime, e.expectedTz) : null;
    // Refuse to update only `timezone` when the row has a startTime but
    // dateUtc recompute failed — that would leave the stored UTC moment
    // inconsistent with the new local zone. Better to log and retry next seed.
    if (e.startTime && !newDateUtc) {
      console.error(`  ✗ Failed to recompute dateUtc for event ${e.id} (${e.kennelCode}); skipping to preserve consistency`);
      skipped++;
      continue;
    }
    await prisma.event.update({
      where: { id: e.id },
      data: { timezone: e.expectedTz, ...(newDateUtc ? { dateUtc: newDateUtc } : {}) },
    });
    updated++;
  }
  console.log(`  ✓ ${updated} events reconciled${skipped > 0 ? ` (${skipped} skipped — see errors above)` : ""}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedKennels(prisma: any, kennels: KennelSeed[], kennelAliases: Record<string, string[]>, sources: any[], toSlugFn: (s: string) => string) {
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

  // Check for shortName collisions (different kennels with same display name)
  const shortNameGroups = new Map<string, string[]>();
  for (const kennel of kennels) {
    const sn = kennel.shortName;
    const existing = shortNameGroups.get(sn) || [];
    existing.push(kennel.kennelCode);
    shortNameGroups.set(sn, existing);
  }
  const shortNameCollisions = [...shortNameGroups.entries()].filter(([, codes]) => codes.length > 1);
  if (shortNameCollisions.length > 0) {
    console.warn("⚠ Seed data has kennels with duplicate shortNames:");
    for (const [shortName, entries] of shortNameCollisions) {
      console.warn(`  - shortName "${shortName}": ${entries.join(", ")}`);
    }
  }

  // Check for alias collisions (same alias on different kennels)
  const aliasToKennels = new Map<string, string[]>();
  for (const [code, aliasList] of Object.entries(kennelAliases)) {
    for (const alias of aliasList) {
      const key = alias.toLowerCase();
      const existing = aliasToKennels.get(key) ?? [];
      existing.push(code);
      aliasToKennels.set(key, existing);
    }
  }
  const aliasCollisions = [...aliasToKennels.entries()].filter(([, codes]) => codes.length > 1);
  if (aliasCollisions.length > 0) {
    console.warn("⚠ Alias collisions detected (routing depends on source-scoping):");
    for (const [alias, codes] of aliasCollisions) {
      console.warn(`  - "${alias}": ${codes.join(", ")}`);
    }
  }

  const regionMap = await ensureRegionRecords(prisma);
  const kennelRecords = await ensureKennelRecords(prisma, kennels, toSlugFn, regionMap);
  await ensureAliases(prisma, kennelAliases, kennelRecords);
  await ensureSources(prisma, sources, kennelRecords);
  await reconcileEventTimezones(prisma);

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

  await seedKennels(prisma, KENNELS, KENNEL_ALIASES, SOURCES, toSlug);

  console.log("\n━━━ Seeding ScheduleRules for Travel Mode ━━━");
  const { created, updated, errored } = await runScheduleRuleBackfill(prisma);
  console.log(`  ✓ Created: ${created}, Updated: ${updated}${errored ? `, Errored: ${errored}` : ""}`);
  if (errored > 0) {
    throw new Error(
      `ScheduleRule backfill had ${errored} upsert error(s) — investigate before considering seed successful.`,
    );
  }

  console.log("\nSeed complete!");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
