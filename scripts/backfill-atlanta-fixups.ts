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
import type { PrismaClient } from "@/generated/prisma/client";
import { geocodeAddress, haversineDistance } from "@/lib/geo";
import { runOneShot, findKennelId } from "./lib/one-shot";

/** The event fields the fix guard reads. */
interface FixTargetEvent {
  id: string;
  runNumber: number | null;
  title: string | null;
  locationName: string | null;
  startTime: string | null;
  haresText: string | null;
}

// Atlanta metro centroid — geocode results must land within this radius.
const ATLANTA = { lat: 33.749, lng: -84.388 };
const MAX_KM = 150;

/** A canonical field value (or explicit clear). */
type FixValue = number | string | null;

interface EventFix {
  kennelCode: string;
  date: string; // YYYY-MM-DD (event date)
  note: string;
  source: string; // board post the corrected values came from
  /** Known-bad current values that must all match before we overwrite. */
  expect: Partial<Record<"runNumber" | "title" | "locationName" | "startTime" | "haresText", FixValue>>;
  /** Fields to set (null = explicit clear). */
  set: Record<string, FixValue>;
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

  // ── Second batch: remaining per-event stale-canonical gaps (dash/emoji/prose
  //    dialects the live parser can't retro-fill; values recovered from the board). ──

  // PH3 Feb 12 → the event is Valentine's Day = Sat Feb 14, 2026, not Feb 12 (#2497).
  {
    kennelCode: "ph3-atl", date: "2026-02-12", note: "PH3 Valentine's date Feb 12 → Feb 14 + venue/time",
    source: "viewtopic p=991 — 'This Valentine's Day' (Feb 14 is the Saturday); 'When: Meet at 1:30, out at 2'",
    expect: { locationName: "Decatur (exact address coming soon)" },
    set: {
      date: "2026-02-14T12:00:00.000Z",
      dateUtc: "2026-02-14T12:00:00.000Z",
      locationName: "Decatur",
      startTime: "13:30",
    },
  },

  // PH3 Feb 28: missing hare (location already present) (#2499).
  {
    kennelCode: "ph3-atl", date: "2026-02-28", note: "PH3 2/28 hare + gather time",
    source: "viewtopic p=1006 — 'Who: Chinchin Chiller'; 'When: 2/28, 1:30 (gather)'",
    expect: { haresText: null },
    set: { haresText: "Chinchin Chiller", startTime: "13:30" },
  },

  // SLUT Apr 2: missing location (#2509). Hare not stated in the post — left blank.
  {
    kennelCode: "sluth3", date: "2026-04-02", note: "SLUT 4/2 venue + out time",
    source: "viewtopic p=1047 — 'Start/End: 415 Tamarron Parkway / Meet at 7:00, out at 7:30'",
    expect: { locationName: null },
    set: { locationName: "415 Tamarron Parkway", locationStreet: "415 Tamarron Parkway, Atlanta, GA", startTime: "19:30" },
    geocode: "415 Tamarron Parkway, Atlanta, GA",
  },

  // SoCo Dec 19: fully empty — dash-label dialect ('HARES - …', 'Time - …') (#2521).
  {
    kennelCode: "soco-h3", date: "2025-12-19", note: "SoCo 12/19 hare + venue + out time (dash-label post)",
    source: "viewtopic p=919 — 'HARES - Surly and Sani'; 'gather at 4920 N. Royal Atlanta Dr'; 'hounds off at 7:30'",
    expect: { haresText: null },
    set: {
      haresText: "Surly and Sani",
      locationName: "4920 N Royal Atlanta Dr, Atlanta, GA 30340",
      locationStreet: "4920 N Royal Atlanta Dr, Atlanta, GA 30340",
      startTime: "19:30",
    },
    geocode: "4920 N Royal Atlanta Dr, Atlanta, GA 30340",
  },

  // SoCo #11 (1/16): title truncated to 'SoCo #11 on' — restore the full topic title (#2522).
  {
    kennelCode: "soco-h3", date: "2026-01-16", note: "SoCo #11 truncated title + out time",
    source: "viewtopic p=944 — topic title 'SoCo #11 on 1/16/26'; 'Meet up at 7, on out at 7:30'",
    expect: { title: "SoCo #11 on" },
    set: { title: "SoCo #11 on 1/16/26", startTime: "19:30" },
  },

  // SoCo #12 (2/20): missing venue + time (#2520). Hare not stated in the post.
  {
    kennelCode: "soco-h3", date: "2026-02-20", note: "SoCo #12 venue + out time",
    source: "viewtopic p=998 — 'Meet at Trammell Crow Park. In at 7, out at 7:30'",
    expect: { locationName: null },
    set: { locationName: "Trammell Crow Park", locationStreet: "Trammell Crow Park, Atlanta, GA", startTime: "19:30" },
    geocode: "Trammell Crow Park, Atlanta, GA",
  },
];

function dayRange(date: string): { gte: Date; lt: Date } {
  const gte = new Date(`${date}T00:00:00.000Z`);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

/** Best-effort re-geocode of a corrected address, merged into `data`. */
async function addGeocode(data: Record<string, FixValue>, address: string): Promise<void> {
  try {
    const geo = await geocodeAddress(address, { regionBias: "us" });
    if (!geo) return;
    const dist = haversineDistance(geo.lat, geo.lng, ATLANTA.lat, ATLANTA.lng);
    if (dist <= MAX_KM) {
      data.latitude = geo.lat;
      data.longitude = geo.lng;
    } else {
      console.log(`   ⚠️ geocode ${JSON.stringify(address)} → ${dist.toFixed(0)}km from ATL (>${MAX_KM}) — leaving coords untouched.`);
    }
  } catch (err) {
    console.log(`   ⚠️ geocode failed for ${JSON.stringify(address)}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The single event on `fix.date` for the kennel, or null (logs why). */
async function findFixTarget(
  prisma: PrismaClient,
  kennelId: string,
  fix: EventFix,
): Promise<FixTargetEvent | null> {
  const { gte, lt } = dayRange(fix.date);
  const events = await prisma.event.findMany({
    where: { kennelId, dateUtc: { gte, lt } },
    select: { id: true, runNumber: true, title: true, locationName: true, startTime: true, haresText: true },
  });
  if (events.length !== 1) {
    console.log(`⚠️  ${fix.kennelCode} ${fix.date} [${fix.note}]: expected 1 event, found ${events.length} — skipping.`);
    return null;
  }
  return events[0];
}

/** Known-bad values that no longer match (empty → safe to apply). */
function guardMismatches(event: FixTargetEvent, fix: EventFix): [string, unknown][] {
  const row = event as unknown as Record<string, unknown>;
  return Object.entries(fix.expect).filter(([k, v]) => row[k] !== v);
}

/** Process one fix: find → guard → (geocode) → update. Returns whether applied. */
async function processFix(
  prisma: PrismaClient,
  kennelId: string,
  fix: EventFix,
  apply: boolean,
): Promise<boolean> {
  const event = await findFixTarget(prisma, kennelId, fix);
  if (!event) return false;

  const mismatched = guardMismatches(event, fix);
  if (mismatched.length > 0) {
    const row = event as unknown as Record<string, unknown>;
    const current = Object.fromEntries(mismatched.map(([k]) => [k, row[k]]));
    console.log(`↩️  ${fix.kennelCode} ${fix.date} [${fix.note}]: current ${JSON.stringify(current)} != expected — already fixed / changed upstream, skipping.`);
    return false;
  }

  const data: Record<string, FixValue> = { ...fix.set };
  if (fix.geocode) await addGeocode(data, fix.geocode);

  console.log(`✏️  ${fix.kennelCode} ${fix.date} [${fix.note}] ← ${JSON.stringify(data)}`);
  console.log(`     source: ${fix.source}`);
  if (apply) await prisma.event.update({ where: { id: event.id }, data });
  return true;
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
    const ok = await processFix(prisma, kennelId, fix, apply);
    if (ok) applied++;
    else skipped++;
  }

  console.log(`\n${apply ? "✓ Applied" : "Would apply"} ${applied} fix(es); skipped ${skipped}.`);
  if (!apply) console.log("Run with --apply to commit.");
});
