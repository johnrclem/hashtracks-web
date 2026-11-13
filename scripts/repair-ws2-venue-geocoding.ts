/**
 * One-shot repair for venues pinned in the wrong town (#2860, #2914, #2908 and
 * the Herts / H5 / Donnington audit findings). The merge pipeline now geocodes
 * venue + street with `geocodeVenue` and falls back to an address's village in
 * `reverseGeocode`, but existing canonical Events keep their cached pins (the
 * merge only re-geocodes when locationUrl changes), so they need this repair.
 *
 * Candidates (never Harrier Central-only events, never rows with a maps URL):
 *   A. Geocoded pin (no source lat/lng), street line present, city missing or
 *      not named in the venue/street text → re-geocode venue + street.
 *   B. Geocoded pin, no street line, over 25 km from the kennel, city missing
 *      or not named in the venue text → re-geocode the venue.
 *   C. Any other pin with no city whose venue is a bare name or has a street
 *      line (incl. source pins like Cambridge H3) → city only.
 *
 * Outcomes:
 *   MOVE   the new pin is > 1 km from the old one and no further from the
 *          kennel (or within 25 km of it) → new lat/lng + city. A farther
 *          "move" is refused: "The Gate, Bratton" must not jump from a wrong
 *          Birmingham pin to Bratton in Wiltshire.
 *   CLEAR  the old pin is provably wrong: the venue-only lookup that produced
 *          it lands within 1 km of it and `venueGeocodeRejection` rejects it
 *          (an area centroid, a whole road, a far town the text doesn't name).
 *   CITY   the pin is confirmed (or came from the source) → city filled.
 *   KEEP   nothing provable to change; not written.
 *
 * API results are cached in --cache (JSON), so a re-run costs nothing for
 * lookups already made. Dry run writes the plan to --plan; --apply reads that
 * plan and writes only rows whose pin and city still match it, in one
 * transaction, with no API calls.
 *
 *   Dry run: BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/repair-ws2-venue-geocoding.ts --plan plan.json --cache cache.json
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/repair-ws2-venue-geocoding.ts --plan plan.json --apply
 *   Env:     DATABASE_URL, GOOGLE_CALENDAR_API_KEY
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  boundingBoxFromCenter,
  geocodeAddress,
  geocodeVenue,
  haversineDistance,
  reverseGeocode,
  venueGeocodeRejection,
  VENUE_TOWN_CHECK_KM,
  type GeocodeResult,
} from "@/lib/geo";
import { suppressRedundantCity } from "@/pipeline/merge";
import { runOneShot } from "./lib/one-shot";

type Bucket = "A" | "B" | "C";
type Outcome = "MOVE" | "CLEAR" | "CITY" | "KEEP";
type Point = { lat: number; lng: number };

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
  reason: string;
  venue: string;
  street: string | null;
  before: { lat: number; lng: number; city: string | null };
  after: { lat: number | null; lng: number | null; city: string | null };
}

const SAME_PIN_KM = 1;

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
  WHERE NOT ev.hc_only
), b AS (
  SELECT d.*,
    CASE
      WHEN NOT src_coords AND "locationStreet" IS NOT NULL AND NOT city_named THEN 'A'
      WHEN NOT src_coords AND "locationStreet" IS NULL AND km > ${VENUE_TOWN_CHECK_KM} AND NOT city_named THEN 'B'
      WHEN "locationCity" IS NULL AND (position(',' in "locationName") = 0 OR "locationStreet" IS NOT NULL) THEN 'C'
    END AS bucket
  FROM d
)
SELECT id, "kennelCode", country, date, "runNumber", "locationName", "locationStreet",
       latitude, longitude, "locationCity", klat, klng, km, bucket
FROM b WHERE bucket IS NOT NULL
ORDER BY "kennelCode", date`;

/** API lookups memoised in a JSON file so a re-run never pays twice. */
class LookupCache {
  private readonly data: Record<string, unknown>;
  constructor(private readonly path: string | undefined) {
    this.data = path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  }
  async get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    if (!(key in this.data)) this.data[key] = await fetcher();
    return this.data[key] as T;
  }
  save(): void {
    if (this.path) writeFileSync(this.path, JSON.stringify(this.data));
  }
}

async function planRow(c: Candidate, cache: LookupCache): Promise<Pick<PlanRow, "outcome" | "reason" | "after">> {
  const before = { lat: c.latitude, lng: c.longitude, city: c.locationCity };
  const cityAt = async (lat: number, lng: number) =>
    suppressRedundantCity(
      c.locationName,
      await cache.get(`rev|${lat.toFixed(3)},${lng.toFixed(3)}`, () => reverseGeocode(lat, lng)),
    );
  const fillCity = async (reason: string) => {
    const city = await cityAt(c.latitude, c.longitude);
    return city
      ? { outcome: "CITY" as const, reason, after: { ...before, city } }
      : { outcome: "KEEP" as const, reason: `${reason}; no town found`, after: before };
  };

  if (c.bucket === "C") return fillCity("city only");

  const kennel: Point | null = c.klat != null && c.klng != null ? { lat: c.klat, lng: c.klng } : null;
  const venue = { location: c.locationName, street: c.locationStreet };
  const bias = regionBias(c.country);
  const kennelKey = kennel ? `${kennel.lat},${kennel.lng}` : "-";
  const hit = await cache.get<GeocodeResult | null>(
    `venue|${JSON.stringify([c.locationName, c.locationStreet, bias, kennelKey])}`,
    () => geocodeVenue({ ...venue, regionBias: bias, biasCenter: kennel }),
  );

  if (hit) {
    const shift = haversineDistance(hit.lat, hit.lng, c.latitude, c.longitude);
    if (shift <= SAME_PIN_KM) {
      return before.city ? { outcome: "KEEP", reason: "pin confirmed", after: before } : fillCity("pin confirmed");
    }
    const newKm = kennel ? haversineDistance(hit.lat, hit.lng, kennel.lat, kennel.lng) : 0;
    if (newKm <= VENUE_TOWN_CHECK_KM || c.km == null || newKm <= c.km) {
      return {
        outcome: "MOVE",
        reason: `moved ${shift.toFixed(0)}km`,
        after: { lat: hit.lat, lng: hit.lng, city: await cityAt(hit.lat, hit.lng) },
      };
    }
  }

  // No better pin. Clear the old one only if its own lookup is now rejected.
  const original = await cache.get<GeocodeResult | null>(
    `addr|${JSON.stringify([c.locationName, bias, kennelKey])}`,
    () => geocodeAddress(c.locationName, {
      regionBias: bias,
      bounds: kennel ? boundingBoxFromCenter(kennel.lat, kennel.lng) : undefined,
    }),
  );
  const samePin = original && haversineDistance(original.lat, original.lng, c.latitude, c.longitude) <= SAME_PIN_KM;
  const rejection = samePin ? venueGeocodeRejection(original, venue, kennel) : null;
  if (rejection) {
    return { outcome: "CLEAR", reason: `old pin is ${rejection}`, after: { lat: null, lng: null, city: null } };
  }
  return { outcome: "KEEP", reason: hit ? "move would land farther from the kennel" : "unproven", after: before };
}

function summarize(plan: PlanRow[]): void {
  const today = new Date().toISOString().slice(0, 10);
  const byKennel = new Map<string, Record<Outcome, number>>();
  const total: Record<Outcome, number> = { MOVE: 0, CLEAR: 0, CITY: 0, KEEP: 0 };
  for (const row of plan) {
    const counts = byKennel.get(row.kennelCode) ?? { MOVE: 0, CLEAR: 0, CITY: 0, KEEP: 0 };
    counts[row.outcome]++;
    total[row.outcome]++;
    byKennel.set(row.kennelCode, counts);
  }
  const writes = (c: Record<Outcome, number>) => c.MOVE + c.CLEAR + c.CITY;
  const upcoming = plan.filter((r) => r.outcome !== "KEEP" && r.date >= today).length;
  console.log(`\nCandidates ${plan.length}: MOVE ${total.MOVE}, CLEAR ${total.CLEAR}, CITY ${total.CITY}, KEEP ${total.KEEP}; upcoming writes ${upcoming}`);
  console.log("\nkennel                 MOVE CLEAR  CITY  KEEP");
  for (const [kennel, c] of [...byKennel.entries()].sort((a, b) => writes(b[1]) - writes(a[1]))) {
    if (writes(c) === 0) continue;
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
          where: { id: row.id, latitude: row.before.lat, longitude: row.before.lng, locationCity: row.before.city },
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
  const count = (b: Bucket) => candidates.filter((c) => c.bucket === b).length;
  console.log(`Matched ${candidates.length} candidate event(s): A ${count("A")}, B ${count("B")}, C ${count("C")}`);
  if (process.argv.includes("--count-only")) return;

  const cache = new LookupCache(argValue("--cache"));
  const plan: PlanRow[] = [];
  try {
    for (const c of candidates) {
      plan.push({
        id: c.id,
        kennelCode: c.kennelCode,
        date: c.date.toISOString().slice(0, 10),
        runNumber: c.runNumber,
        bucket: c.bucket,
        venue: c.locationName,
        street: c.locationStreet,
        before: { lat: c.latitude, lng: c.longitude, city: c.locationCity },
        ...(await planRow(c, cache)),
      });
    }
  } finally {
    cache.save();
  }
  writeFileSync(planPath, JSON.stringify(plan, null, 1));
  summarize(plan);
  console.log(`\nPlan written to ${planPath}. Re-run with --apply to write it.`);
});
