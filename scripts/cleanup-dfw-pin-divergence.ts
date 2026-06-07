/**
 * One-shot map-pin correction (#2020 follow-up) for DFW events whose stored
 * coordinates diverge from where their address actually geocodes.
 *
 * Built on the read-only audit in scripts/audit-dfw-pin-accuracy.ts, which
 * showed the DFW pin corpus is overwhelmingly accurate — a blanket re-geocode
 * would DEGRADE the many events whose address is vague/prose (Google falls back
 * to a city centroid or, worse, the wrong state — "Lake Ray Roberts Greenbelt"
 * → Greenbelt, MD). So this correction fires only when ALL of the following
 * hold, i.e. Google resolved the exact street address and the stored pin is
 * meaningfully off:
 *
 *   1. stored pin is > MIN_DIVERGENCE_KM and < MAX_DIVERGENCE_KM from the fresh
 *      geocode (a sane window — never relocate a pin wildly),
 *   2. the source address carries a 5-digit zip that the fresh formatted
 *      address echoes (right city), AND
 *   3. the source address's leading street number appears in the fresh
 *      formatted address (Google resolved the exact street, not an approximation).
 *
 * On a match it re-geocodes and writes lat/lng + a suppressed locationCity. The
 * address text is left as-is (locationName is not a fingerprint input and the
 * adapter's normalizeStateZipTail handles new scrapes).
 *
 * Self-verifying + idempotent: once a pin is corrected it falls under
 * MIN_DIVERGENCE_KM and the signature misses on re-run.
 *
 * Run:
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-dfw-pin-divergence.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-dfw-pin-divergence.ts --apply
 *   Env:     DATABASE_URL, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { geocodeAddress, reverseGeocode, haversineDistance } from "@/lib/geo";
import { normalizeStateZipTail } from "@/adapters/html-scraper/dfw-hash";
import { suppressRedundantCity } from "@/pipeline/merge";

const KENNEL_CODES = ["dh3-tx", "duhhh", "noduhhh", "fwh3", "yakh3"];
const MIN_DIVERGENCE_KM = 1.0;
const MAX_DIVERGENCE_KM = 15.0; // never relocate a pin further than this — guards against bad geocodes

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;
const LEADING_NUMBER_RE = /\b(\d{1,6})\b/; // first house/street number in the address
// Bounded quantifiers (no unbounded `\d{3,}`/`\d+`) keep this linear (Sonar S5852).
const EMBEDDED_COORDS_RE = /-?\d{1,3}\.\d{3,9}|\d{1,3}°/;

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "✏️  APPLYING changes" : "🔍 DRY RUN — no changes will be made");

  const pool = createScriptPool();
  try {
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const kennels = await prisma.kennel.findMany({
      where: { kennelCode: { in: KENNEL_CODES } },
      select: { id: true, kennelCode: true },
    });
    const codeById = new Map(kennels.map((k) => [k.id, k.kennelCode]));

    const events = await prisma.event.findMany({
      where: {
        kennelId: { in: kennels.map((k) => k.id) },
        latitude: { not: null },
        longitude: { not: null },
        locationName: { not: null },
      },
      select: {
        id: true, kennelId: true, runNumber: true, dateUtc: true,
        locationName: true, locationCity: true, latitude: true, longitude: true,
      },
      orderBy: { dateUtc: "asc" },
    });

    let matched = 0;
    for (const e of events) {
      const loc = e.locationName ?? "";
      if (EMBEDDED_COORDS_RE.test(loc)) continue;
      const zip = ZIP_RE.exec(loc)?.[1];
      const streetNo = LEADING_NUMBER_RE.exec(loc)?.[1];
      if (!zip || !streetNo) continue;

      const normalized = normalizeStateZipTail(loc);
      const geo = await geocodeAddress(normalized, { regionBias: "us" });
      if (!geo) continue;
      const dist = haversineDistance(e.latitude!, e.longitude!, geo.lat, geo.lng);
      if (dist <= MIN_DIVERGENCE_KM || dist >= MAX_DIVERGENCE_KM) continue;

      const fa = geo.formattedAddress ?? "";
      // Confidence gates: right city (zip echoed) AND exact street (the leading
      // house number appears as a standalone numeric token in the fresh address).
      // Token-split avoids a non-literal RegExp (Codacy) and substring false hits.
      if (!fa.includes(zip)) continue;
      if (!fa.split(/\D+/).includes(streetNo)) continue;

      matched++;
      const rawCity = await reverseGeocode(geo.lat, geo.lng);
      const newCity = suppressRedundantCity(normalized, rawCity);
      console.log(`\n  ${codeById.get(e.kennelId)} #${e.runNumber ?? "?"} ${e.dateUtc?.toISOString().slice(0, 10) ?? "?"} — ${dist.toFixed(1)} km off`);
      console.log(`    addr:   ${JSON.stringify(loc)}`);
      console.log(`    coords: ${e.latitude!.toFixed(5)},${e.longitude!.toFixed(5)} → ${geo.lat.toFixed(5)},${geo.lng.toFixed(5)} (${fa})`);
      console.log(`    city:   ${JSON.stringify(e.locationCity)} → ${JSON.stringify(newCity)}`);

      if (apply) {
        await prisma.event.update({
          where: { id: e.id },
          data: { latitude: geo.lat, longitude: geo.lng, locationCity: newCity },
        });
        console.log(`    ✓ corrected.`);
      }
    }

    console.log(`\nMatched ${matched} event(s)${apply ? " (applied)" : ""}.`);
    if (!apply) console.log("Run with --apply to commit changes.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
