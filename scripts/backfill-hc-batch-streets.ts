/**
 * One-shot null-fill of Event.locationStreet for the 13 HC batch (Nov 2026) kennels (#2819).
 *
 * The frozen archive (scripts/data/hc-batch-nov-history.json) kept only the venue name, so
 * every backfilled run lost the street address and postcode Harrier Central holds. HC's
 * getEvents is future-only, so a scrape never revisits these runs. This reads hashruns.org
 * `/api/global-runs?isFuture=0`, matches each row to the existing Event on (kennel, date),
 * and writes "street, postcode" only where locationStreet is still NULL. Nothing else on
 * the row changes, RawEvents are untouched, and a re-run is a no-op.
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-hc-batch-streets.ts
 *   Apply:    BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-hc-batch-streets.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import type { HCGlobalRun } from "@/adapters/harrier-central/adapter";

const GLOBAL_RUNS_URL = "https://www.hashruns.org/api/global-runs";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const FIRST_YEAR = 2015;
const KENNEL_CODES = [
  "yh3", "oph3", "bdh3-uk", "da2b", "bbch3", "cernh3", "ph3-sr",
  "abujah3", "blhhh", "hannover-h3", "mobh3", "bbh3", "sunh3",
];
const SAMPLES_PER_KENNEL = 2;

/** A full year can exceed what the feed will serve (HTTP 500), so read four months at a time. */
const WINDOWS = [["01-01", "04-30"], ["05-01", "08-31"], ["09-01", "12-31"]];

async function fetchWindow(from: string, to: string): Promise<HCGlobalRun[]> {
  const url = `${GLOBAL_RUNS_URL}?isFuture=0&pageSize=20000&minEventDate=${from}&maxEventDate=${to}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`global-runs ${from}: HTTP ${res.status}`);
  const json = (await res.json()) as { runs?: HCGlobalRun[] };
  if (!Array.isArray(json.runs)) throw new Error(`global-runs ${from}: unexpected shape`);
  return json.runs;
}

/** "19 Boston Manor Road, TW8 8EA", or undefined when HC holds no usable street. */
function streetLine(run: HCGlobalRun): string | undefined {
  const street = run.LocationStreet?.trim();
  if (!street || /^-?\d+(?:\.\d+)?\s*,\s*-?\d+/.test(street)) return undefined;
  const postcode = run.LocationPostCode?.trim();
  return postcode && !street.includes(postcode) ? `${street}, ${postcode}` : street;
}

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);

  const links = await prisma.sourceKennel.findMany({
    where: { kennel: { kennelCode: { in: KENNEL_CODES } }, source: { type: "HARRIER_CENTRAL" } },
    select: { kennelId: true, kennel: { select: { kennelCode: true } }, source: { select: { config: true } } },
  });
  const byPublicId = new Map<string, { kennelId: string; code: string }>();
  for (const link of links) {
    const publicKennelId = (link.source.config as { publicKennelId?: string } | null)?.publicKennelId;
    if (publicKennelId) byPublicId.set(publicKennelId, { kennelId: link.kennelId, code: link.kennel.kennelCode });
  }

  const streets = new Map<string, string>(); // `${kennelId}|${date}` → street
  const thisYear = new Date().getUTCFullYear();
  for (let year = FIRST_YEAR; year <= thisYear; year++) {
    for (const [from, to] of WINDOWS) {
      for (const run of await fetchWindow(`${year}-${from}`, `${year}-${to}`)) { // NOSONAR S7735 — one request at a time
        const kennel = run.PublicKennelId ? byPublicId.get(run.PublicKennelId) : undefined;
        const street = streetLine(run);
        if (kennel && street && run.EventStartDatetime) {
          streets.set(`${kennel.kennelId}|${run.EventStartDatetime.slice(0, 10)}`, street);
        }
      }
    }
  }

  const events = await prisma.event.findMany({
    where: { kennelId: { in: [...byPublicId.values()].map((k) => k.kennelId) }, locationStreet: null },
    select: { id: true, date: true, kennelId: true, runNumber: true },
  });
  const codeOf = new Map([...byPublicId.values()].map((k) => [k.kennelId, k.code]));
  const perKennel = new Map<string, { fill: number; none: number; samples: string[] }>();
  let written = 0;
  for (const event of events) {
    const code = codeOf.get(event.kennelId) ?? "?";
    const tally = perKennel.get(code) ?? { fill: 0, none: 0, samples: [] };
    perKennel.set(code, tally);
    const date = event.date.toISOString().slice(0, 10);
    const street = streets.get(`${event.kennelId}|${date}`);
    if (!street) {
      tally.none++;
      continue;
    }
    tally.fill++;
    if (tally.samples.length < SAMPLES_PER_KENNEL) tally.samples.push(`#${event.runNumber ?? "?"} ${date}: ${street}`);
    if (apply) {
      const { count } = await prisma.event.updateMany({ where: { id: event.id, locationStreet: null }, data: { locationStreet: street } }); // NOSONAR S7735
      written += count;
    }
  }

  for (const [code, tally] of [...perKennel].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${code}: fill ${tally.fill}, no HC street ${tally.none}`);
    for (const sample of tally.samples) console.log(`   ${sample}`);
  }
  const total = [...perKennel.values()].reduce((sum, t) => sum + t.fill, 0);
  console.log(`\nTotal to fill: ${total}${apply ? ` | written: ${written}` : ""}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
