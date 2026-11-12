/**
 * One-shot repair for venues pinned in the wrong town (#2860, #2914, #2908 and
 * the Herts / H5 / Donnington audit findings). The merge pipeline now geocodes
 * venue + street with `geocodeVenue` and falls back to an address's village in
 * `reverseGeocode`, but existing canonical Events keep their cached pins (the
 * merge only re-geocodes when locationUrl changes), so they need this repair.
 *
 * Only events whose pin came from our geocoder (no source lat/lng, no maps
 * URL, not Harrier Central-only) and whose city is missing or doesn't appear
 * in the venue text are touched:
 *   A. street line present, city missing or not named in the venue/street
 *      → re-geocode with venue + street.
 *   B. no street line, pin over 25 km from the kennel, city missing or not
 *      named in the venue → re-geocode (now rejects areas / roads / wrong towns).
 *   C. bare venue name (no comma), pin present, city missing → city only.
 *
 * Outcomes per event:
 *   MOVE  new pin > 1 km from the old one → new lat/lng + city.
 *   CLEAR no usable pin and the old one was > 25 km out → lat/lng/city null.
 *   CITY  pin kept, city filled.
 *   KEEP  nothing to change (not written).
 *
 * Geocoding API calls are deduplicated by query and by rounded coordinates.
 * Dry run writes the plan to --plan (default scratch file); --apply reads that
 * plan and writes only rows whose stored pin and city still match it, in one
 * transaction. No API calls happen on --apply.
 *
 *   Dry run: BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/repair-ws2-venue-geocoding.ts --plan /tmp/plan.json
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/repair-ws2-venue-geocoding.ts --plan /tmp/plan.json --apply
 *   Env:     DATABASE_URL, GOOGLE_CALENDAR_API_KEY
 */
import { readFileSync, writeFileSync } from "node:fs";
import { geocodeVenue, haversineDistance, reverseGeocode, VENUE_TOWN_CHECK_KM } from "@/lib/geo";
import { suppressRedundantCity } from "@/pipeline/merge";
import { runOneShot } from "./lib/one-shot";

type Bucket = "A" | "B" | "C";
type Outcome = "MOVE" | "CLEAR" | "CITY" | "KEEP";

interface Candidate {
  id: string;
  kennelCode: string;
  country: string | null;
  date: Date;
  runNumber: number | null;
  locationName: string;
  locationStreet: string | null;
  latitude: number;
  longitude: number;
  locationCity: string | null;
  klat: number | null;
  klng: number | null;
  km: number | null;
  bucket: Bucket;
}

interface PlanRow {
  id: string;
  kennelCode: string;
  date: string;
  runNumber: number | null;
  bucket: Bucket;
  outcome: Outcome;
  venue: string;
  street: string | null;
  before: { lat: number; lng: number; city: string | null };
  after: { lat: number | null; lng: number | null; city: string | null };
}

const MOVE_THRESHOLD_KM = 1;

/** Same mapping as merge.ts countryToRegionBias. */
function regionBias(country: string | null): string | undefined {
  const c = country?.toUpperCase();
  if (c === "US" || c === "USA") return "us";
  if (c === "UK" || c === "GB") return "gb";
  if (c === "IE" || c === "IRELAND") return "ie";
  return undefined;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The town part of a stored city ("Wembdon, England" → "Wembdon"). */
const CANDIDATES_SQL = `
WITH ev AS (
  SELECT e.id, e."kennelId", e.date, e."runNumber", e."locationName", e."locationStreet",
         e.latitude, e.longitude, e."locationCity",
         bool_and(s.type = 'HARRIER_CENTRAL') AS hc_only,
         bool_or(r."rawData"->>'latitude' IS NOT NULL OR coalesce(r."rawData"->>'locationUrl', '') <> '') AS src_coords
  FROM "Event" e
  JOIN "RawEvent" r ON r."eventId" = e.id
  JOIN "Source" s ON s.id = r."sourceId"
  WHERE e.latitude IS NOT NULL AND e.longitude IS NOT NULL
    AND e."locationName" IS NOT NULL AND e."locationAddress" IS NULL
  GROUP BY e.id
), d AS (
  SELECT ev.*, k."kennelCode", k.country, k.latitude AS klat, k.longitude AS klng,
         CASE WHEN k.latitude IS NULL THEN NULL ELSE
           6371 * 2 * asin(sqrt(power(sin(radians(ev.latitude - k.latitude) / 2), 2)
             + cos(radians(k.latitude)) * cos(radians(ev.latitude))
             * power(sin(radians(ev.longitude - k.longitude) / 2), 2))) END AS km,
         (ev."locationCity" IS NOT NULL AND (
            coalesce(ev."locationStreet", '') || ' ' || ev."locationName"
          ) ILIKE '%' || split_part(ev."locationCity", ',', 1) || '%') AS city_named
  FROM ev JOIN "Kennel" k ON k.id = ev."kennelId"
  WHERE NOT ev.hc_only AND NOT ev.src_coords
)
SELECT id, "kennelCode", country, date, "runNumber", "locationName", "locationStreet",
       latitude, longitude, "locationCity", klat, klng, km,
       CASE
         WHEN "locationStreet" IS NOT NULL AND NOT city_named THEN 'A'
         WHEN "locationStreet" IS NULL AND km > ${VENUE_TOWN_CHECK_KM} AND NOT city_named THEN 'B'
         ELSE 'C'
       END AS bucket
FROM d
WHERE ("locationStreet" IS NOT NULL AND NOT city_named)
   OR ("locationStreet" IS NULL AND km > ${VENUE_TOWN_CHECK_KM} AND NOT city_named)
   OR ("locationCity" IS NULL AND position(',' in "locationName") = 0)
ORDER BY "kennelCode", date`;

async function buildPlan(candidates: Candidate[]): Promise<PlanRow[]> {
  const venueCache = new Map<string, Promise<{ lat: number; lng: number } | null>>();
  const cityCache = new Map<string, Promise<string | null>>();
  const cityAt = (lat: number, lng: number) => {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (!cityCache.has(key)) cityCache.set(key, reverseGeocode(lat, lng));
    return cityCache.get(key)!;
  };

  const plan: PlanRow[] = [];
  for (const c of candidates) {
    const before = { lat: c.latitude, lng: c.longitude, city: c.locationCity };
    let after: PlanRow["after"] = { ...before };

    if (c.bucket === "C") {
      const city = suppressRedundantCity(c.locationName, await cityAt(c.latitude, c.longitude));
      if (city) after = { ...before, city };
    } else {
      const biasCenter = c.klat != null && c.klng != null ? { lat: c.klat, lng: c.klng } : null;
      const key = JSON.stringify([c.locationName, c.locationStreet, c.country, biasCenter]);
      if (!venueCache.has(key)) {
        venueCache.set(key, geocodeVenue({
          location: c.locationName,
          street: c.locationStreet,
          regionBias: regionBias(c.country),
          biasCenter,
        }));
      }
      const hit = await venueCache.get(key)!;
      if (hit && haversineDistance(hit.lat, hit.lng, c.latitude, c.longitude) > MOVE_THRESHOLD_KM) {
        after = { lat: hit.lat, lng: hit.lng, city: suppressRedundantCity(c.locationName, await cityAt(hit.lat, hit.lng)) };
      } else if (!hit && (c.km ?? 0) > VENUE_TOWN_CHECK_KM) {
        after = { lat: null, lng: null, city: null };
      } else if (!c.locationCity) {
        const city = suppressRedundantCity(c.locationName, await cityAt(c.latitude, c.longitude));
        if (city) after = { ...before, city };
      }
    }

    let outcome: Outcome = "KEEP";
    if (after.lat == null) outcome = "CLEAR";
    else if (after.lat !== before.lat || after.lng !== before.lng) outcome = "MOVE";
    else if (after.city !== before.city) outcome = "CITY";

    plan.push({
      id: c.id,
      kennelCode: c.kennelCode,
      date: c.date.toISOString().slice(0, 10),
      runNumber: c.runNumber,
      bucket: c.bucket,
      outcome,
      venue: c.locationName,
      street: c.locationStreet,
      before,
      after,
    });
  }
  console.log(`Geocoding API: ${venueCache.size} forward queries, ${cityCache.size} reverse lookups (plus fallbacks).`);
  return plan;
}

function summarize(plan: PlanRow[]): void {
  const now = new Date().toISOString().slice(0, 10);
  const byKennel = new Map<string, Record<Outcome, number>>();
  for (const row of plan) {
    const counts = byKennel.get(row.kennelCode) ?? { MOVE: 0, CLEAR: 0, CITY: 0, KEEP: 0 };
    counts[row.outcome]++;
    byKennel.set(row.kennelCode, counts);
  }
  const total = { MOVE: 0, CLEAR: 0, CITY: 0, KEEP: 0 };
  for (const counts of byKennel.values()) for (const o of Object.keys(total) as Outcome[]) total[o] += counts[o];
  const upcoming = plan.filter((r) => r.outcome !== "KEEP" && r.date >= now).length;
  console.log(`\nCandidates ${plan.length}: MOVE ${total.MOVE}, CLEAR ${total.CLEAR}, CITY ${total.CITY}, KEEP ${total.KEEP}; upcoming writes ${upcoming}`);
  console.log("\nkennel                 MOVE CLEAR  CITY  KEEP");
  const rows = [...byKennel.entries()].sort((a, b) => b[1].MOVE + b[1].CLEAR + b[1].CITY - (a[1].MOVE + a[1].CLEAR + a[1].CITY));
  for (const [kennel, c] of rows) {
    if (c.MOVE + c.CLEAR + c.CITY === 0) continue;
    console.log(`${kennel.padEnd(22)} ${String(c.MOVE).padStart(4)} ${String(c.CLEAR).padStart(5)} ${String(c.CITY).padStart(5)} ${String(c.KEEP).padStart(5)}`);
  }
}

void runOneShot(async ({ prisma, apply }) => {
  const planPath = argValue("--plan") ?? "ws2-venue-geocoding-plan.json";

  if (apply) {
    const plan = (JSON.parse(readFileSync(planPath, "utf8")) as PlanRow[]).filter((r) => r.outcome !== "KEEP");
    console.log(`Applying ${plan.length} planned rows from ${planPath}`);
    const written = await prisma.$transaction(async (tx) => {
      let n = 0;
      for (const row of plan) {
        // Only rows whose pin and city are still what the plan saw.
        const res = await tx.event.updateMany({
          where: {
            id: row.id,
            latitude: row.before.lat,
            longitude: row.before.lng,
            locationCity: row.before.city,
          },
          data: { latitude: row.after.lat, longitude: row.after.lng, locationCity: row.after.city },
        });
        n += res.count;
      }
      return n;
    }, { timeout: 600_000, maxWait: 60_000 });
    console.log(`✓ Updated ${written} of ${plan.length} event(s); ${plan.length - written} changed since the plan and were skipped.`);
    return;
  }

  const candidates = (await prisma.$queryRawUnsafe<Candidate[]>(CANDIDATES_SQL)).map((c) => ({
    ...c,
    km: c.km == null ? null : Number(c.km),
  }));
  console.log(`Matched ${candidates.length} candidate event(s): A ${candidates.filter((c) => c.bucket === "A").length}, B ${candidates.filter((c) => c.bucket === "B").length}, C ${candidates.filter((c) => c.bucket === "C").length}`);
  if (process.argv.includes("--count-only")) return;

  const plan = await buildPlan(candidates);
  writeFileSync(planPath, JSON.stringify(plan, null, 1));
  summarize(plan);
  console.log(`\nPlan written to ${planPath}. Re-run with --apply to write it.`);
});
