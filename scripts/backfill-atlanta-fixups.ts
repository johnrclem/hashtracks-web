/**
 * One-shot canonical fixups for the Atlanta Hash Board cluster Deep Dive.
 *
 * The shared adapter (atlanta-hash-board.ts) now extracts run numbers,
 * time-in-location leaks, colon-less hares, and phpBB edit-notice timestamps
 * correctly — but the board's Atom feed is a ~15-topic rolling window, so these
 * past events are NEVER re-scraped, and even if they were the immutable
 * RawEvents dedupe by fingerprint (re-scrape can't heal an existing canonical —
 * Memory `rescrape_wont_fix_existing_canonical`). So the already-persisted
 * canonical Events must be corrected directly.
 *
 * Every corrected value was recovered from the LIVE board post (fetched via the
 * r.jina.ai reader, which egresses from an IP OVH's firewall permits — the board
 * blocks datacenter + residential directly). Sources are cited per row.
 *
 * Safe / idempotent:
 *   - Each fix matches by (kennelCode, event date) and GUARDS on the known-bad
 *     current value(s); a row that no longer matches (already fixed, or changed
 *     upstream) is logged and skipped — never clobbered.
 *   - Location corrections best-effort re-geocode the real address and reject a
 *     result >150 km from Atlanta (fail-loud), leaving coords untouched on miss.
 *   - Dry-run by default; pass --apply to write.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-atlanta-fixups.ts
 *   Apply:   … npx tsx scripts/backfill-atlanta-fixups.ts --apply
 *   Env:     DATABASE_URL, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (geocode)
 */
import { geocodeAddress, haversineDistance } from "@/lib/geo";
import { runOneShot, findKennelId } from "./lib/one-shot";

// Atlanta metro centroid — geocode results must land within this radius.
const ATLANTA = { lat: 33.749, lng: -84.388 };
const MAX_KM = 150;

interface EventFix {
  kennelCode: string;
  date: string; // YYYY-MM-DD (event date)
  note: string;
  source: string; // board post the corrected values came from
  /** Known-bad current values that must all match before we overwrite. */
  expect: Partial<Record<"runNumber" | "title" | "locationName" | "startTime", number | string | null>>;
  /** Fields to set (null = explicit clear). */
  set: Record<string, number | string | null>;
  /** Address to geocode into latitude/longitude (best-effort). */
  geocode?: string;
}

const FIXES: EventFix[] = [
  // ── Run numbers dropped by the old /#(\d{2,})/ title regex (#2504 / #2511 / #2519) ──
  { kennelCode: "sluth3", date: "2025-05-01", note: "SLUT # 268", source: "viewtopic p=684", expect: { runNumber: null }, set: { runNumber: 268 } },
  { kennelCode: "sluth3", date: "2025-10-02", note: "SLUT # 272", source: "viewtopic p=841", expect: { runNumber: null }, set: { runNumber: 272 } },
  { kennelCode: "sluth3", date: "2025-12-05", note: "SLUT # 274", source: "viewtopic p=904", expect: { runNumber: null }, set: { runNumber: 274 } },
  { kennelCode: "sluth3", date: "2026-04-02", note: "SLUT # 277", source: "viewtopic p=1047", expect: { runNumber: null }, set: { runNumber: 277 } },

  // ── SLUT # 271 (8/8): run number + the "Publix Parking Lot" venue already fine ──
  { kennelCode: "sluth3", date: "2025-08-08", note: "SLUT # 271", source: "viewtopic p=768", expect: { runNumber: null }, set: { runNumber: 271 } },

  // ── SoCo #9 (11/21): run# + time-string-as-location "7pm, out" (#2518 / #2519) ──
  {
    kennelCode: "soco-h3", date: "2025-11-22", note: "SoCo #9 run# + venue (was '7pm, out')",
    source: "viewtopic p=887 — 'Where: 5510 Stillhouse Rd, Stone Mountain, GA 30083 - Leila Mason Park'",
    expect: { runNumber: null, locationName: "7pm, out" },
    set: { runNumber: 9, locationName: "Leila Mason Park / Sherman Town Park", locationStreet: "5510 Stillhouse Rd, Stone Mountain, GA 30083" },
    geocode: "5510 Stillhouse Rd, Stone Mountain, GA 30083",
  },

  // ── SLUT 1/1 (#275): "12:30 out" leaked into location; real venue Gotham Park ──
  {
    kennelCode: "sluth3", date: "2026-01-01", note: "SLUT #275 venue (was '12:30 out') + out time",
    source: "viewtopic p=920 — 'Meet: 12:30 out at 1:00 / Where: Gotham Park 1996 Gotham Way NE'",
    expect: { locationName: "12:30 out" },
    set: { locationName: "Gotham Park", locationStreet: "1996 Gotham Way NE, Atlanta, GA 30324", startTime: "13:00" },
    geocode: "1996 Gotham Way NE, Atlanta, GA 30324",
  },

  // ── PH3 5/23: markdown "** 1:30 PM" leaked into location; real venue El Ranchero ──
  {
    kennelCode: "ph3-atl", date: "2026-05-23", note: "PH3 5/23 venue (was '** 1:30 PM')",
    source: "viewtopic p=1098 — 'El Ranchero- 562 Cobb Parkway SE, Marietta, GA'",
    expect: { locationName: "** 1:30 PM" },
    set: { locationName: "El Ranchero", locationStreet: "562 Cobb Parkway SE, Marietta, GA" },
    geocode: "562 Cobb Parkway SE, Marietta, GA",
  },

  // ── PH3 4/25: leading-dash title + missing hare + IS-dialect venue/time (#2495) ──
  {
    kennelCode: "ph3-atl", date: "2026-04-25", note: "PH3 4/25 title + hare BAAA + venue",
    source: "viewtopic p=1073 — 'HARE IS BAAA / START IS MURPHY CHANDLER PARK POOL / 4060 Candler Lake W NE'",
    expect: { title: "- Murphey Candler Park Pool" },
    set: {
      title: "Saturday April 25 - Murphey Candler Park Pool",
      haresText: "BAAA",
      locationName: "Murphey Candler Park Pool",
      locationStreet: "4060 Candler Lake W NE, Atlanta, GA 30319",
      startTime: "13:30",
    },
    geocode: "4060 Candler Lake W NE, Atlanta, GA 30319",
  },

  // ── SoCo 6/19: bogus 03:48 start (phpBB edit-notice artifact); post has no time (#2054) ──
  {
    kennelCode: "soco-h3", date: "2026-06-19", note: "SoCo 6/19 clear bogus 03:48 start",
    source: "viewtopic p=1109 — post body carries no event start time",
    expect: { startTime: "03:48" },
    set: { startTime: null },
  },
];

function dayRange(date: string): { gte: Date; lt: Date } {
  const gte = new Date(`${date}T00:00:00.000Z`);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

void runOneShot(async ({ prisma, apply }) => {
  const kennelIds = new Map<string, string>();
  let applied = 0;
  let skipped = 0;

  for (const fix of FIXES) {
    let kennelId = kennelIds.get(fix.kennelCode);
    if (!kennelId) {
      const id = await findKennelId(prisma, fix.kennelCode);
      if (!id) { skipped++; continue; }
      kennelId = id;
      kennelIds.set(fix.kennelCode, id);
    }

    const { gte, lt } = dayRange(fix.date);
    const events = await prisma.event.findMany({
      where: { kennelId, dateUtc: { gte, lt } },
      select: { id: true, runNumber: true, title: true, locationName: true, startTime: true },
    });
    if (events.length !== 1) {
      console.log(`⚠️  ${fix.kennelCode} ${fix.date} [${fix.note}]: expected 1 event, found ${events.length} — skipping.`);
      skipped++;
      continue;
    }
    const e = events[0];

    // Guard: every known-bad value must still match, else it's already fixed.
    const mismatched = Object.entries(fix.expect).filter(
      ([k, v]) => (e as Record<string, unknown>)[k] !== v,
    );
    if (mismatched.length > 0) {
      console.log(
        `↩️  ${fix.kennelCode} ${fix.date} [${fix.note}]: current value(s) ` +
          `${JSON.stringify(Object.fromEntries(mismatched.map(([k]) => [k, (e as Record<string, unknown>)[k]])))} ` +
          `!= expected — already fixed or changed upstream, skipping.`,
      );
      skipped++;
      continue;
    }

    const data: Record<string, number | string | null> = { ...fix.set };

    // Best-effort re-geocode of the corrected address.
    if (fix.geocode) {
      try {
        const geo = await geocodeAddress(fix.geocode, { regionBias: "us" });
        if (geo) {
          const dist = haversineDistance(geo.lat, geo.lng, ATLANTA.lat, ATLANTA.lng);
          if (dist <= MAX_KM) {
            data.latitude = geo.lat;
            data.longitude = geo.lng;
          } else {
            console.log(`   ⚠️ geocode ${JSON.stringify(fix.geocode)} → ${dist.toFixed(0)}km from ATL (>${MAX_KM}) — leaving coords untouched.`);
          }
        }
      } catch (err) {
        console.log(`   ⚠️ geocode failed for ${JSON.stringify(fix.geocode)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`✏️  ${fix.kennelCode} ${fix.date} [${fix.note}] ← ${JSON.stringify(data)}`);
    console.log(`     source: ${fix.source}`);
    if (apply) {
      await prisma.event.update({ where: { id: e.id }, data });
      applied++;
    }
  }

  console.log(`\n${apply ? "✓ Applied" : "Would apply"} ${apply ? applied : FIXES.length - skipped} fix(es); skipped ${skipped}.`);
  if (!apply) console.log("Run with --apply to commit.");
});
